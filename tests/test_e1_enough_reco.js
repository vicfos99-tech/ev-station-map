/*
 * e1_enough 도우미(plan.md 3.4절): node tests/test_e1_enough_reco.js '<사례 목록 JSON>'
 * 가짜 화면(잠긴 test_integration_dom.js 의 boot)으로 이 저장소의 web/ 을 띄워 추천 칸(#reco)과 #range-line 을 본 대로 낸다.
 * 기대값은 여기 없다(파이썬 쪽 표에만 있다). 본 것만 RESULT 한 줄(JSON 목록)로 낸다.
 *
 * 사례: { id, data: "one"|"two"|"broken", len: 길찾기 노선 길이(정수 km ≥ 45) 또는 null(받아 둔 길 없음),
 *         state: ev-charge-planner/v1 에 둘 값, dest: 목적지 글(기본 "횡성"), steps: [{ sel, value, type }] }
 * 결과: { id, loadErrors, errors, calls, route, shots: [띄운 직후, 걸음 1 뒤, …] }
 *   shot = { range, boxes: [#reco 묶음의 자식마다 { cls, role, tone, style, tags, texts }] }
 */
"use strict";
const fs = require("fs");
const path = require("path");
const PROJ = path.join(__dirname, ".."), WEB = path.join(PROJ, "web");
const { boot } = require(path.join(__dirname, "test_integration_dom.js"));
const read = (f) => fs.readFileSync(path.join(WEB, f), "utf8");

const NOW = 1767571920000; // 2026-01-05 09:12 한국 시각
const AT = 1767571200000;  // 충전소 상태를 받은 시각(12분 전)
const KEY = "ev-charge-planner/";
const fast = (status) => ({ type: "fast", power_kw: 100.0, status, last_end: AT - 1800000 });
const station = (id, statuses, loc) => ({ id, operator: "한국전력", price: 391.0, updated: AT, chargers: statuses.map(fast), loc, maker: "가나전기" });
// 작은 live.js: one = 기흥휴게소 하나, two = 안성휴게소까지 둘, broken = 기흥 하나인데 충전기가 모두 고장
function live(kind) {
  const down = [{ id: "live-gb-down-1", name: "기흥휴게소", km: 33.9, loc: [37.2361, 127.1052],
    stations: [station("KP000101", kind === "broken" ? ["out_of_service", "out_of_service"] : ["available", "charging"], [37.2361, 127.1052])] }];
  if (kind === "two") down.push({ id: "live-gb-down-2", name: "안성휴게소", km: 45.0, loc: [37.15, 127.1201], stations: [station("KP000201", ["available"], [37.15, 127.1201])] });
  const up = [{ id: "live-gb-up-1", name: "기흥휴게소", km: 66.1, loc: [37.2365, 127.1047], stations: [station("KP000102", ["available"], [37.2365, 127.1047])] }];
  const cfg = { endpoint: "https://apis.data.go.kr/B552584/EvCharger/getChargerInfo", zcodes: ["41"], slow_types: ["02", "08"], default_kw: { fast: 50, slow: 7 },
    status: { 1: "comm_error", 2: "available", 3: "charging", 4: "out_of_service", 5: "maintenance", 9: "comm_error" }, tariffs: { default: 391 },
    price_note: "추정", max_offset_km: 2, hint_max_km: 5, merge_km: 1.5, hint_names: {}, manual_hints: {},
    highways: { gb: { name: "경부고속도로", zcodes: ["41"], points: [[37.527, 127.012], [37.46, 127.042], [37.332, 127.105], [37.236, 127.105], [37.077, 127.133], [36.943, 127.19]],
      forward: { key: "live-gb-down", direction: "부산 방향", tokens: ["부산", "하행"] }, backward: { key: "live-gb-up", direction: "서울 방향", tokens: ["서울", "상행"] } } } };
  return { fetched_at: AT, source: "시험", price_note: "추정", skipped: {}, config: cfg, routes: [
    { key: "live-gb-down", highway: "경부고속도로", direction: "부산 방향", length: 100, live: true, rest_areas: down },
    { key: "live-gb-up", highway: "경부고속도로", direction: "서울 방향", length: 100, live: true, rest_areas: up }] };
}
// 받아 둔 길: 경부선 44 km + 고속도로 아닌 길 (len − 44) km → 길찾기 노선 길이가 정확히 len
const saved = (len, dest) => ({ dest: dest === undefined || dest === null ? "횡성" : dest, fetched_at: NOW, pieces: [
  { name: "경부고속도로", points: [[37.46, 127.042], [37.332, 127.105], [37.236, 127.105], [37.077, 127.133]], length_m: 44000 },
  { name: "국도42호선", points: [[37.077, 127.133], [37.2, 127.5]], length_m: (len - 44) * 1000 }] });
function scripts(kind) {
  const mini = `(function (root) { root.EvLive = ${JSON.stringify(live(kind))}; })(typeof self !== "undefined" ? self : this);`;
  const names = [...read("index.html").matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  return names.map((name) => ({ name, code: name === "live.js" ? mini : read(name) }));
}
function shot(app) {
  const reco = app.el("#reco").children[0];
  const boxes = (reco ? reco.children : []).map((c) => ({ cls: c.className, role: c.getAttribute("data-role"), tone: c.getAttribute("data-tone"),
    style: c.getAttribute("style"), tags: c.children.map((x) => x.tagName), texts: c.children.map((x) => x.textContent) }));
  return { range: app.el("#range-line").textContent, recoCls: reco ? reco.className : null, recoCount: app.el("#reco").children.length, boxes };
}
async function run(c) {
  const storage = { [KEY + "relay"]: "off", [KEY + "v1"]: JSON.stringify(Object.assign({ chaeviSet: true }, c.state || {})) };
  if (c.len !== null && c.len !== undefined) storage[KEY + "navi"] = JSON.stringify(saved(c.len, c.dest));
  const app = boot({ scripts: scripts(c.data || "one"), storage, now: NOW, fetch: async () => ({ ok: false, status: 404, text: async () => "" }) });
  const out = { id: c.id, loadErrors: app.errors(), shots: [shot(app)] };
  for (const s of c.steps || []) {
    app.el(s.sel).value = s.value;
    app.fire(s.sel, s.type);
    await app.settle();
    out.shots.push(shot(app));
  }
  const st = app.store.get(KEY + "v1");
  out.route = st ? JSON.parse(st).routeKey : null;
  out.calls = app.calls();
  out.errors = app.errors();
  app.close();
  return out;
}
(async () => {
  const cases = JSON.parse(process.argv[2] || "[]");
  const out = [];
  for (const c of cases) {
    try { out.push(await run(c)); } catch (e) { out.push({ id: c.id, crash: String((e && e.stack) || e) }); }
  }
  console.log("RESULT " + JSON.stringify(out));
})();
