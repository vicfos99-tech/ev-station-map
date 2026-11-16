/*
 * 통합 흐름(계획 세션 참조 scenario.js 를 옮겨 바꿈 다섯을 미리 적용): 가짜 화면으로 web/app.js 를 띄워 '새로 받기'·지도·설정을 눌러 본다.
 *   node tests/test_integration_relay.js   (파이썬 쪽 tests/test_integration_relay.py 가 부른다)
 * 바꿈: (1) 가짜 화면은 ./test_integration_dom.js  (2) 변형은 모두 base(web/ 의 지금 파일 그대로, 참조 고침 없음)
 *       (3) relay.js 는 web/relay.js  (4) S3 의 badge 에 부른 주소  (5) 끝의 파일 쓰기 대신 기준 파일과 견주기
 * 기대값: tests/test_integration_data_base.json 의 S1·S2(고치기 전 app.js 로 뽑음)와 S3~S9(참조 고침으로 뽑은 값).
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { boot } = require("./test_integration_dom.js");
const T = require("./test_p0_fake.js");
const PROJ = path.join(__dirname, ".."), WEB = path.join(PROJ, "web");
const read = (f) => fs.readFileSync(path.join(WEB, f), "utf8");
const S = (f) => JSON.parse(fs.readFileSync(path.join(PROJ, "ref", "relay_sample", f), "utf8"));

const RELAY = "https://vicfos99-tech.github.io/ev-station-map/relay/";
const PUBLIC = "https://apis.data.go.kr/B552584/EvCharger/";
const NOW = 1767571920000; // 2026-01-05 09:12:00 한국 시각. meta.json 의 at(09:10) 2분 뒤
const CENTER = [37.3801, 127.1185];
const EVIL = "<img src=x onerror=alert(1)>";
// 작은 live.js: 견본 routes.json 의 두 노선 + 경부선 앞부분 설정
const MINI = (() => {
  const r = S("routes.json");
  const cfg = { endpoint: PUBLIC + "getChargerInfo", zcodes: ["41"], slow_types: ["02", "08"], default_kw: { fast: 50, slow: 7 },
    status: { 1: "comm_error", 2: "available", 3: "charging", 4: "out_of_service", 5: "maintenance", 9: "comm_error" }, tariffs: { default: 391, "환경부": 347 },
    price_note: r.price_note, max_offset_km: 2, hint_max_km: 5, merge_km: 1.5, hint_names: {}, manual_hints: {},
    highways: { gb: { name: "경부고속도로", zcodes: ["41"], points: [[37.527, 127.012], [37.46, 127.042], [37.332, 127.105], [37.236, 127.105], [37.077, 127.133], [36.943, 127.19]],
      forward: { key: "live-gb-down", direction: "부산 방향", tokens: ["부산", "하행"] }, backward: { key: "live-gb-up", direction: "서울 방향", tokens: ["서울", "상행"] } } } };
  const d = { fetched_at: r.fetched_at, source: r.source, price_note: r.price_note, routes: r.routes, skipped: r.skipped, config: cfg };
  return `(function (root) { root.EvLive = ${JSON.stringify(d)}; })(typeof self !== "undefined" ? self : this);`;
})();
function scripts(variant) {
  const index = read("index.html");
  const names = [...index.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  return names.map((name) => ({ name, code: name === "live.js" ? MINI : name === "relay.js" ? fs.readFileSync(path.join(WEB, "relay.js"), "utf8") : read(name) }));
}
// 공공 데이터 가짜 답: 휴게소 받기(zcode·kindDetail)와 주변 받기(zscode), 상태 받기
const item = (o) => Object.assign({ statId: "KP000101", statNm: "기흥휴게소(부산방향)", chgerId: "01", chgerType: "06", lat: "37.2361", lng: "127.1052", stat: "2", output: "100",
  busiNm: "한국전력", maker: "가나전기", kindDetail: "C001", limitYn: "N", delYn: "N", addr: "경부고속도로 기흥", lastTedt: "20260105083000" }, o);
function publicAnswer(url) {
  const u = new URL(url), z = u.searchParams.get("zscode");
  let items = [];
  if (url.includes("getChargerInfo") && u.searchParams.get("kindDetail") === "C001") items = [item({}), item({ chgerId: "02", stat: "3" }), item({ statId: "KP000102", statNm: "기흥휴게소(서울방향)", lat: "37.2365", lng: "127.1047", output: "200" })];
  else if (url.includes("getChargerInfo") && z) items = [item({ statId: "D" + z, statNm: EVIL, lat: String(CENTER[0]), lng: String(CENTER[1]), kindDetail: "A001", maker: "<b>가나</b>", addr: "어디 <i>1</i>" })];
  return { ok: true, status: 200, text: async () => JSON.stringify({ resultCode: "00", totalCount: items.length, items: { item: items } }) };
}
// 중계 가짜 답: 견본 파일 + 어느 시군구든 견본 41135 를 그 코드로 바꿔 준다(첫 충전소 이름에 태그)
function relayAnswer(url, o) {
  const rel = url.slice((o.base || RELAY).length);
  let v = 404;
  const m = rel.match(/^(stations|status)\/([0-9]{5})\.json$/);
  if (o.down) v = 404;
  else if (rel === "meta.json") v = Object.assign(S("meta.json"), o.meta || {});
  else if (rel === "routes.json") v = S("routes.json");
  else if (/^status\/rest\/KP00010[12]\.json$/.test(rel)) v = Object.assign(S(rel), o.restAt ? { at: o.restAt } : {});
  else if (m && m[1] === "stations") { v = S("stations/41135.json"); v.zscode = m[2]; v.stations.forEach((s, i) => { s.id += "-" + m[2]; s.loc = [CENTER[0] + i * 0.001, CENTER[1]]; }); v.stations[0].name = EVIL; v.stations[0].maker = "<b>가나</b>"; }
  else if (m) { const t = S("status/41135.json"); v = { at: t.at, s: {} }; for (const k of Object.keys(t.s)) v.s[k + "-" + m[2]] = t.s[k]; }
  if (typeof v === "number") return { ok: false, status: v, text: async () => "" };
  return { ok: true, status: 200, text: async () => JSON.stringify(v) };
}
const KEY = "ev-charge-planner/";
function start(variant, o) {
  o = o || {};
  const app = boot({ scripts: scripts(variant), storage: o.storage || {}, now: o.now || NOW, href: o.href,
    fetch: async (url) => (url.startsWith(o.base || RELAY) ? relayAnswer(url, o) : url.startsWith(PUBLIC) ? publicAnswer(url) : { ok: false, status: 404, text: async () => "" }) });
  app.short = () => app.calls().map((c) => (c.startsWith(PUBLIC) ? "공공:" + c.slice(PUBLIC.length).replace(/serviceKey=[^&]*/, "serviceKey=*") : c.startsWith(o.base || RELAY) ? "중계:" + c.slice((o.base || RELAY).length) : c));
  app.liveBrief = () => app.win.EvData.LIVE.routes.map((r) => `${r.key}=` + r.rest_areas.map((a) => a.stations.map((s) => `${s.id}:${s.chargers.map((c) => c.status).join(",")}`).join(";")).join("/"));
  return app;
}
async function refresh(app, key) {
  if (key) app.el("#k-key").value = key;
  app.fire("#live-form", "submit");
  await app.settle();
  return { msg: app.el("#live-msg").textContent, tone: app.el("#live-msg").dataset.tone, modalHidden: app.el("#rf-modal").hidden, rfText: app.el("#rf-text").textContent, badge: app.el("#btn-refresh").textContent };
}
async function openMap(app, zoom) {
  app.tab("map");
  await app.settle();
  app.leaf.map.setView(CENTER, zoom || 15);
  app.leaf.map.fire("moveend");
  await new Promise((r) => setTimeout(r, 30));
  await app.settle();
  return markers(app);
}
const markers = (app) => ({ note: app.el("#map-note").textContent, around: app.leaf.groups[0].layers.map((l) => ({ html: l.icon.html, popup: l.popup })), btn: app.el("#map-around").textContent });

// 중계를 끈 흐름: 고치기 전 app.js 로 뽑은 기준(S1·S2)과 같아야 한다
async function offFlow(variant, withKey) {
  const storage = { [KEY + "relay"]: "off" };
  if (withKey) storage[KEY + "apikey"] = "TESTKEY";
  const app = start(variant, { storage });
  const out = { loadErrors: app.errors(), badge: app.el("#btn-refresh").textContent, route: app.el("#route-select").value, strip: app.el("#strip").children.length };
  out.refresh = await refresh(app);
  out.live = app.liveBrief();
  out.map15 = await openMap(app, 15);
  app.leaf.map.setView(CENTER, 13); app.leaf.map.fire("moveend"); await new Promise((r) => setTimeout(r, 30)); await app.settle();
  out.map13 = markers(app);
  app.clock.t += 3 * 60000; app.tick(180000); await app.settle();
  out.afterTick = markers(app);
  out.calls = app.short();
  out.stored = [...app.store.keys()].filter((k) => !k.startsWith(KEY + "relay")).sort();
  out.savedLive = app.store.has(KEY + "live") ? JSON.parse(app.store.get(KEY + "live")).routes.length : null;
  out.errors = app.errors();
  app.close();
  return out;
}

// 기준과 견주기. 글자 값 가운데 '받고 있어요'·'껐어요'(안내 문구의 표현이 갈릴 수 있는 글)와 badge 칸만 견줌에서 뺀다.
// 배열·객체는 빼지 않는다(S7 off 의 저장값 'off' 는 그대로 견준다: 통과 기준 14).
const j = (x) => JSON.stringify(x, (k, y) => (k == "badge" || (typeof y == "string" && /받고 있어요|껐어요/.test(y)) ? void 0 : y));
function SC(o) {
  const v = Object.values(o), B = require("./test_integration_data_base.json"), a = read("app.js");
  const q = (a.match(/(\w+) = window\.EvRelay\b/) || [, "EvRelay"])[1], L = a.match(RegExp(`\\b(EvRelay|${q})\\.\\w+`, "g")), E = require(path.join(WEB, "relay.js"));
  T.eq("c1", v[0].base, B.S1); T.eq("c2", v[1].base, B.S2);
  for (let i = 2; i < 9; i++) T.eq("s" + (i + 1), j(v[i]), j(B["S" + (i + 1)]));
  T.eq("s3c", v[2].badge.length, 12);
  T.check("c18", L && L.every((n) => n.split(".")[1] in E), L);
  T.finish();
}

(async () => {
  const out = {};
  // 1) 중계 끔: 고치기 전과 같다
  for (const [name, withKey] of [["S1 끔·키 있음", true], ["S2 끔·키 없음", false]]) {
    const a = await offFlow("base", withKey), b = await offFlow("base", withKey);
    out[name] = { same: T.show(a) === T.show(b), base: a, patched: T.show(a) === T.show(b) ? "(같음)" : b };
  }
  // 2) 중계 켬(기본 주소)·키 없음
  {
    const app = start("base", {});
    const o = { loadErrors: app.errors(), relayOn: app.el("#relay-on").checked, relayBase: app.el("#relay-base").value };
    o.refresh = await refresh(app); o.calls1 = app.short(); o.live = app.liveBrief(); o.relay = app.win.EvData.LIVE.relay; o.updated = app.win.EvData.LIVE.routes[0].rest_areas[0].stations[0].updated;
    app.el("#route-select").value = "live-gb-up"; app.fire("#route-select", "change"); o.hint = app.el("#live-msg-route").textContent;
    app.el("#route-select").value = "live-gb-down"; app.fire("#route-select", "change"); o.hintBack = app.el("#live-msg-route").textContent;
    o.map15 = await openMap(app, 15);
    app.leaf.map.setView(CENTER, 13); app.leaf.map.fire("moveend"); await new Promise((r) => setTimeout(r, 30)); await app.settle(); o.map13 = markers(app);
    o.badge = app.short(); const before = app.calls().length;
    app.clock.t += 3 * 60000; app.tick(180000); await app.settle();
    o.tickCalls = app.short().slice(before); o.afterTick = markers(app);
    o.public = app.calls().filter((c) => c.startsWith(PUBLIC)).length; o.tags = T.show(o.map15).includes("<img") || T.show(o.map13).includes("<img"); o.errors = app.errors();
    // 3분 뒤 차례가 아니라 그냥 40분이 흐른 뒤(중계는 그대로): 화면이 다시 그려질 때 빈자리를 세지 않는다
    app.clock.t = NOW + 40 * 60000; app.tab("route"); await app.settle(); o.liveAfter40 = app.liveBrief();
    app.tab("map"); await app.settle(); app.leaf.map.fire("moveend"); await new Promise((r) => setTimeout(r, 30)); await app.settle(); o.mapAfter40 = markers(app).around.map((m) => m.html.replace(/<span.*?<\/span>/g, ""));
    app.close(); out["S3 켬·키 없음"] = o;
  }
  // 3) 중계가 40분째 멈춤(meta·상태 모두 40분 전)
  {
    const app = start("base", { now: 1767571800000 + 40 * 60000 });
    const o = { refresh: await refresh(app), live: app.liveBrief() };
    o.map15 = (await openMap(app, 15)); o.public = app.calls().filter((c) => c.startsWith(PUBLIC)).length; o.errors = app.errors();
    app.close(); out["S4 켬·40분 전"] = o;
  }
  // 4) 중계 404 + 키 있음 → 직접 받기
  {
    const app = start("base", { down: true, storage: { [KEY + "apikey"]: "TESTKEY" } });
    const o = { refresh: await refresh(app), calls1: app.short(), live: app.liveBrief(), hasRelayMark: "relay" in app.win.EvData.LIVE };
    o.map15 = await openMap(app, 15); o.calls2 = app.short().slice(o.calls1.length); o.errors = app.errors();
    app.close(); out["S5 켬·중계 404·키 있음"] = o;
  }
  // 5) 중계 404 + 키 없음 → 오류 글
  {
    const app = start("base", { down: true });
    const o = { refresh: await refresh(app), calls1: app.short(), live: app.liveBrief() };
    o.map15 = await openMap(app, 15); o.public = app.calls().filter((c) => c.startsWith(PUBLIC)).length; o.errors = app.errors();
    app.close(); out["S6 켬·중계 404·키 없음"] = o;
  }
  // 6) 설정 칸
  {
    const B2 = "https://x.example/r/";
    const app = start("base", { base: B2 });
    const o = {};
    app.el("#relay-base").value = "http://x.example/r/"; app.fire("#relay-form", "submit");
    o.bad = [app.el("#relay-msg").textContent, app.el("#relay-msg").dataset.tone, app.store.has(KEY + "relay-base")];
    app.el("#relay-base").value = " https://x.example/r "; app.fire("#relay-form", "submit");
    o.good = [app.el("#relay-msg").textContent, app.store.get(KEY + "relay-base"), app.el("#relay-base").value];
    o.refresh = await refresh(app); o.calls = app.calls();
    app.el("#relay-on").checked = false; app.fire("#relay-on", "change");
    o.off = [app.store.get(KEY + "relay"), app.el("#relay-msg").textContent];
    o.refreshOff = await refresh(app); o.callsOff = app.calls().length;
    app.el("#relay-base").value = ""; app.fire("#relay-form", "submit"); o.cleared = [app.store.has(KEY + "relay-base"), app.el("#relay-msg").textContent];
    o.errors = app.errors(); app.close(); out["S7 설정"] = o;
    const app2 = start("base", { storage: { [KEY + "relay"]: "off", [KEY + "relay-base"]: B2 } });
    out["S7 설정"].boot = [app2.el("#relay-on").checked, app2.el("#relay-base").value]; app2.close();
  }
  // 7) 받아 둔 중계 자료가 오래된 채로 앱을 다시 엶 / 웹 주소에서 엶
  {
    const first = start("base", {}); await refresh(first); const saved = first.store.get(KEY + "live"); first.close();
    const app = start("base", { storage: { [KEY + "live"]: saved }, now: NOW + 27 * 60000 }); const a = app.liveBrief(); app.close(); // 09:39 = 확인 시각(09:10) 29분 뒤
    const app2 = start("base", { storage: { [KEY + "live"]: saved }, now: NOW + 40 * 60000 }); const b = app2.liveBrief(); const e = app2.errors(); app2.close();
    const web = start("base", { href: "https://me.example/ev/index.html", base: "https://me.example/ev/relay/" }); await refresh(web); const c = web.calls().slice(0, 2); web.close();
    out["S8 다시 엶"] = { after29: a, after40: b, errors: e, webCalls: c };
  }
  // 8) 조용한 충전소(상태 at 만 40분 전) / 중계가 마지막 받기에 실패
  {
    const a = start("base", { restAt: "20260105083200" }); const ra = await refresh(a); const la = a.liveBrief(); a.close();
    const b = start("base", { meta: { ok: false, error: "상태 받기 실패: HTTP 500 https://apis.data.go.kr/x?serviceKey=abcd" } }); const rb = await refresh(b); const lb = b.liveBrief(); const mb = await openMap(b, 15); b.close();
    out["S9 조용함·실패 까닭"] = { quiet: [ra.msg, la], failed: [rb.msg, rb.tone, lb, mb.note] };
  }
  SC(out);
})();
