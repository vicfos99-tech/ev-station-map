/*
 * r4_rest 시험(JS 쪽): web/relay.js 의 wantedIds·expire·expireLive·buildLive·routeHint·refreshRest
 * (plan.md 5절 r4_rest 325~363행, 2.1 N1~N4, 2.2 D1·D3·D6·D7·D10, 3절 C1~C5, 3.2 글 표).
 * test_r4_rest_relay.py 가 run_js 로 돌려 확인 하나를 pytest 테스트 하나로 보인다(C7).
 * relay.js 가 없거나 함수가 없어도 확인 이름은 모두 나온다(실패로).
 * 견본은 ref/relay_sample/ 을 읽기만 한다(plan.md 21행). 기대값은 참조 구현으로 검산했다(.orchestra/logs/tests_r4_rest.md).
 */
"use strict";
const T = require("./test_p0_fake.js");
const path = require("path");
const fs = require("fs");
const { check } = T;

let R = null, loadErr = "";
try { R = require(path.join(__dirname, "..", "web", "relay.js")); } catch (e) { loadErr = String(e && e.message).slice(0, 200); }

const FUNCS = ["wantedIds", "expire", "expireLive", "buildLive", "routeHint", "refreshRest"];
const MIN = 60000;
const NOW0 = 1767571920000, T_META = 1767571800000, T_LIST = 1767571200000, T_REST1 = 1767571500000, T_LAST = 1767569400000;
const B = "https://a.example/relay/";
const ANDROID = "https://vicfos99-tech.github.io/ev-station-map/relay/";
const HINT = "이 노선의 상태는 아직 받지 않았어요. '새로 받기'를 눌러 주세요.";
const FB = "중계에 연결하지 못해 직접 받았어요";
const TAIL = ". 공공 데이터 키를 넣으면 직접 받을 수 있어요.";
const CE = "comm_error";
const J = (x) => JSON.parse(JSON.stringify(x));
const RAW = {};
for (const p of ["meta.json", "routes.json", "status/rest/KP000101.json", "status/rest/KP000102.json"]) RAW[p] = fs.readFileSync(path.join(__dirname, "..", "ref", "relay_sample", p), "utf8");
const SAMPLE = (p) => JSON.parse(RAW[p]);
const ROUTES = () => SAMPLE("routes.json");      // parseRoutes(견본) 와 JSON 이 같다(plan.md 319행 기준 5)
const META = () => SAMPLE("meta.json");
const SR = () => ROUTES().routes;
// parseRest 결과 모양(plan.md 312행): {rest, at, chargers:[{id, stat, last_end}]} — id 글자 순
const REST = (id, at, list) => ({ rest: id, at, chargers: list.map(([cid, stat, le]) => ({ id: cid, stat, last_end: le === undefined ? T_LAST : le })) });
const REST1 = () => REST("KP000101", "20260105090500", [["01", "3"], ["02", "3"]]);
const REST2 = () => REST("KP000102", "20260105090000", [["01", "2"]]);

function canon(v) {
  if (v === undefined) return "undefined";
  if (typeof v === "number" && !Number.isFinite(v)) return String(v);
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
}
function fn(n) {
  if (!R || typeof R[n] !== "function") throw new Error(`relay.js 에 ${n} 함수가 없음 ${loadErr}`);
  return R[n];
}
const errs = [];
const tryCall = (f) => { try { return f(); } catch (e) { errs.push(e); return undefined; } };
// f() 의 값이 want 와 같은지(열쇠 순서는 보지 않음). 던지면 실패
function same(name, f, want) {
  let got, d = "";
  try { got = f(); } catch (e) { d = `던짐: ${e && e.name}: ${e && e.message}`; }
  check(name, !d && canon(got) === canon(want), d || `받은 값 ${canon(got)} != 기대 ${canon(want)}`);
}
function ok(name, f, detail) {
  let v = false, d = "";
  try { v = f(); } catch (e) { d = `던짐: ${e && e.name}: ${e && e.message}`; }
  check(name, v === true, d || detail || "거짓");
}
function errText(e) {
  if (!e || typeof e !== "object") return String(e);
  const own = Object.getOwnPropertyNames(e).map((k) => (typeof e[k] === "string" ? e[k] : ""));
  return [e.message, e.stack, String(e), ...own].join("\n");
}
function isRelayErr(e, code, msg, secrets) {
  const RE = R && R.RelayError, why = [];
  if (!(typeof RE === "function" && e instanceof RE)) why.push("RelayError 가 아님");
  if (!e || e.code !== code) why.push(`code ${e && e.code} != ${code}`);
  if (msg !== undefined && (!e || e.message !== msg)) why.push(`message ${JSON.stringify(e && e.message)}`);
  if (e && e.name !== "RelayError") why.push(`name ${e && e.name}`);
  if (e && e.cause !== undefined) why.push("cause 가 있음");
  const t = errText(e);
  for (const s of secrets || []) if (t.includes(s)) why.push(`글에 '${s}' 가 남음`);
  return why;
}
function deepFreeze(o) { if (o && typeof o === "object") { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; }
function stationOf(live, id) {
  for (const r of (live && live.routes) || []) for (const a of (r && r.rest_areas) || []) for (const s of (a && a.stations) || []) if (s && s.id === id) return s;
  return null;
}
const stats = (live, id) => { const s = stationOf(live, id); return s ? s.chargers.map((c) => c.status) : null; };
const allStats = (live) => live.routes.flatMap((r) => r.rest_areas.flatMap((a) => a.stations.flatMap((s) => s.chargers.map((c) => c.status))));
// 시험용 노선 문서(parseRoutes 결과 모양)
const STN = (id, types, extra) => Object.assign({ id, operator: "o", price: 1, updated: T_LIST, chargers: types.map((t) => ({ type: t, power_kw: 50, status: "available", last_end: T_LAST })) }, extra || {});
const DOC = (stations) => ({ v: 1, fetched_at: T_LIST, source: "S", price_note: "P", routes: [{ key: "k", highway: "h", direction: "d", length: 1, live: true, rest_areas: [{ name: "r", km: 1, stations, id: "r1" }] }], skipped: {} });
const BL = (rest, o, doc, meta) => tryCall(() => fn("buildLive")(doc || ROUTES(), rest, meta === undefined ? META() : meta, Object.assign({ now: NOW0, wanted: ["KP000101"] }, o || {})));
const num = (i) => String(i + 1).padStart(2, "0");

for (const n of FUNCS) check(`내보냄 ${n}`, !!R && typeof R[n] === "function", `relay.js 에 ${n} 함수가 없음 ${loadErr}`);

// ---------- wantedIds (329행, 기준 1) ----------
const CR = () => [
  { key: "a", rest_areas: [{ stations: [{ id: "S2" }, { id: "S1" }] }, { stations: [{ id: "S3" }, { id: "S2" }] }] },
  { key: "b", rest_areas: [{ stations: [{ id: "S9" }] }] },
  { key: "e", rest_areas: [] },
];
const WANT = [
  [SR, "live-gb-down", undefined, ["KP000101"]],
  [SR, "live-gb-up", undefined, ["KP000102"]],
  [SR, "navi", ["KP000102", "X", "KP000102", 3], ["KP000102"]],
  [SR, "없음", undefined, ["KP000101"]],
  [SR, "live-gb-down", ["KP000102", "KP000101"], ["KP000101", "KP000102"]],
  [SR, undefined, [], ["KP000101"]],
  [() => [], "x", undefined, []],
  [SR, "navi", ["KP000102", "KP000101"], ["KP000102", "KP000101"]],
  [SR, "live-gb-up", "KP000101", ["KP000102"]],
  [SR, "live-gb-up", null, ["KP000102"]],
  [CR, "a", undefined, ["S2", "S1", "S3"]],
  [CR, "b", ["S1", "S9", "S4"], ["S9", "S1"]],
  [CR, "zz", ["S4"], ["S2", "S1", "S3"]],
  [CR, "zz", ["S9"], ["S9"]],
  [CR, "b", ["s9"], ["S9"]],
  [CR, "B", undefined, ["S2", "S1", "S3"]],
  [CR, "e", undefined, ["S2", "S1", "S3"]],
  [CR, "a", ["S1", "S3"], ["S2", "S1", "S3"]],
  [CR, "e", ["S3", "S9"], ["S3", "S9"]],
  [() => [], "x", ["S1"], []],
  [SR, "live-gb-down", [{ id: "KP000102" }], ["KP000101"]],
];
WANT.forEach(([mk, key, extra, want], i) => same(`wantedIds ${num(i)}`, () => fn("wantedIds")(mk(), key, extra), want));
{
  const rs = CR(), ex = ["S9", "S1"], before = JSON.stringify([rs, ex]);
  tryCall(() => fn("wantedIds")(rs, "a", ex));
  check("wantedIds 입력 그대로", JSON.stringify([rs, ex]) === before, "routes·extraIds 가 바뀜");
}

// ---------- buildLive 기본 (332~336행, 기준 2) ----------
const CFG = { tariffs: { default: 391 } };
const L0 = BL({ KP000101: REST1() });
same("buildLive 기본 KP000101 상태", () => stats(L0, "KP000101"), ["charging", "charging"]);
same("buildLive 기본 KP000101 updated", () => stationOf(L0, "KP000101").updated, T_META);
same("buildLive 기본 KP000101 last_end", () => stationOf(L0, "KP000101").chargers.map((c) => c.last_end), [T_LAST, T_LAST]);
same("buildLive 기본 KP000102 그대로", () => [stats(L0, "KP000102"), stationOf(L0, "KP000102").updated], [["available"], T_LIST]);
same("buildLive 기본 relay", () => L0.relay, { at: T_META, ok: true, ids: ["KP000101"], missing: [], mixed: [], oldest: T_META });
same("buildLive 기본 머리", () => [L0.fetched_at, L0.item_count, L0.config], [NOW0, 3, null]);
same("buildLive 기본 열쇠 순서", () => Object.keys(L0), ["fetched_at", "source", "price_note", "routes", "skipped", "config", "item_count", "relay"]);
same("buildLive 기본 출처 칸", () => [L0.source, L0.price_note, L0.skipped], [ROUTES().source, ROUTES().price_note, ROUTES().skipped]);
{
  const want = ROUTES().routes;
  want[0].rest_areas[0].stations[0].chargers.forEach((c) => { c.status = "charging"; });
  want[0].rest_areas[0].stations[0].updated = T_META;
  same("buildLive 기본 routes 전체", () => L0.routes, want);
}
{
  const L = BL({ KP000101: REST1() }, { config: CFG });
  ok("buildLive config 같은 객체", () => L.config === CFG, "config 가 준 객체가 아님");
  ok("buildLive config 없음 null", () => { const x = BL({}, { config: undefined }); return "config" in x && x.config === null; });
}
same("buildLive item_count 0개 충전소", () => BL({}, { wanted: [] }, DOC([STN("Z0", []), STN("Z1", ["fast", "fast", "slow"])])).item_count, 3);

// ---------- meta 가 보증하지 않을 때 (N1, 기준 3) ----------
{
  const mf = Object.assign(META(), { ok: false, error: "x" });
  const L = BL({ KP000101: REST1() }, {}, null, mf);
  same("meta ok false updated", () => stationOf(L, "KP000101").updated, T_REST1);
  same("meta ok false relay", () => [L.relay.at, L.relay.ok, L.relay.oldest], [null, false, T_REST1]);
  same("meta ok false 지금은 셈", () => stats(L, "KP000101"), ["charging", "charging"]);
  same("meta ok false 31분", () => stats(BL({ KP000101: REST1() }, { now: T_REST1 + 31 * MIN }, null, mf), "KP000101"), [CE, CE]);
  same("meta ok false 30분 정각", () => stats(BL({ KP000101: REST1() }, { now: T_REST1 + 30 * MIN }, null, mf), "KP000101"), ["charging", "charging"]);
  const Ln = BL({ KP000101: REST1() }, {}, null, null);
  same("meta null", () => [stationOf(Ln, "KP000101").updated, Ln.relay.at, Ln.relay.ok], [T_REST1, null, false]);
  const Lt = BL({ KP000101: REST("KP000101", "20260105091100", [["01", "3"], ["02", "3"]]) });
  same("meta 보다 늦은 파일 at", () => [stationOf(Lt, "KP000101").updated, Lt.relay.oldest], [T_META + MIN, T_META + MIN]);
}

// ---------- 30분 경계 (D1, 기준 4) ----------
{
  const L30 = BL({ KP000101: REST1() }, { now: T_META + 30 * MIN });
  same("30분 정각 KP000101", () => stats(L30, "KP000101"), ["charging", "charging"]);
  same("30분 정각 KP000102", () => stats(L30, "KP000102"), [CE]);
  same("30분 1밀리초 KP000101", () => stats(BL({ KP000101: REST1() }, { now: T_META + 30 * MIN + 1 }), "KP000101"), [CE, CE]);
  const L31 = BL({ KP000101: REST1() }, { now: T_META + 31 * MIN });
  same("31분 둘 다", () => [stats(L31, "KP000101"), stats(L31, "KP000102")], [[CE, CE], [CE]]);
}

// ---------- 자료가 없을 때 (기준 5) ----------
{
  const L = BL({});
  same("자료 없음 상태", () => [stats(L, "KP000101"), stationOf(L, "KP000101").updated], [["available", "charging"], T_LIST]);
  same("자료 없음 relay", () => [L.relay.ids, L.relay.missing, L.relay.mixed, L.relay.oldest], [[], ["KP000101"], [], null]);
  same("자료 없음 29분", () => stats(BL({}, { now: T_LIST + 29 * MIN }), "KP000101"), ["available", "charging"]);
  const Lw = BL({ KP000102: REST2() }, { wanted: ["KP000101"] });
  same("wanted 밖 자료는 안 씀", () => [stats(Lw, "KP000102"), stationOf(Lw, "KP000102").updated, Lw.relay.ids, Lw.relay.missing], [["available"], T_LIST, [], ["KP000101"]]);
  const L2 = BL({ KP000101: REST1(), KP000102: REST2() }, { wanted: ["KP000102", "KP000101"] });
  same("둘 다 덮어씀", () => [stats(L2, "KP000101"), stats(L2, "KP000102"), stationOf(L2, "KP000102").updated], [["charging", "charging"], ["available"], T_META]);
  same("둘 다 덮어씀 relay", () => [[...L2.relay.ids].sort(), L2.relay.missing, L2.relay.oldest], [["KP000101", "KP000102"], [], T_META]);
  const L2f = BL({ KP000101: REST1(), KP000102: REST2() }, { wanted: ["KP000102", "KP000101"] }, null, Object.assign(META(), { ok: false }));
  same("둘 다 meta 실패 oldest", () => [L2f.relay.oldest, stationOf(L2f, "KP000101").updated, stationOf(L2f, "KP000102").updated], [T_LIST, T_REST1, T_LIST]);
}

// ---------- 수가 다를 때 (N4, 기준 6) ----------
{
  const one = (list, o, doc) => BL({ KP000101: REST("KP000101", "20260105090500", list) }, o, doc);
  const L1 = one([["01", "3"]]);
  same("상태 1개", () => [stats(L1, "KP000101"), L1.relay.mixed, L1.relay.ids], [["charging", CE], [], ["KP000101"]]);
  const L3 = one([["01", "3"], ["02", "3"], ["03", "2"]]);
  same("상태 3개", () => [stats(L3, "KP000101"), L3.relay.mixed, L3.relay.ids, stationOf(L3, "KP000101").updated], [[CE, CE], ["KP000101"], ["KP000101"], T_META]);
  const L00 = one([]);
  same("상태 0개", () => [stats(L00, "KP000101"), L00.relay.mixed, L00.relay.ids], [[CE, CE], [], ["KP000101"]]);
  same("stat 7·2", () => stats(one([["01", "7"], ["02", "2"]]), "KP000101"), [CE, "available"]);
  const slowDoc = ROUTES();
  slowDoc.routes[0].rest_areas[0].stations[0].chargers[1].type = "slow";
  const Ls = one([["01", "3"], ["02", "3"]], {}, slowDoc);
  same("섞인 종류", () => [stats(Ls, "KP000101"), Ls.relay.mixed], [[CE, CE], ["KP000101"]]);
  const allSlow = ROUTES();
  allSlow.routes[0].rest_areas[0].stations[0].chargers.forEach((c) => { c.type = "slow"; });
  same("모두 완속은 한 종류", () => { const L = one([["01", "3"], ["02", "2"]], {}, allSlow); return [stats(L, "KP000101"), L.relay.mixed]; }, [["charging", "available"], []]);
  same("last_end null 은 그대로", () => stationOf(one([["01", "3", null], ["02", "3", null]]), "KP000101").chargers.map((c) => c.last_end), [T_LAST, T_LAST]);
  same("last_end 숫자 5", () => stationOf(one([["01", "3", 5], ["02", "3", null]]), "KP000101").chargers.map((c) => c.last_end), [5, T_LAST]);
  same("last_end 새 값", () => stationOf(one([["01", "3", T_LAST + 1], ["02", "3", T_LAST + 2]]), "KP000101").chargers.map((c) => c.last_end), [T_LAST + 1, T_LAST + 2]);
  const noLe = DOC([{ id: "Z1", operator: "o", price: 1, updated: T_LIST, chargers: [{ type: "fast", power_kw: 50, status: "available" }] }]);
  same("last_end 없던 칸에 null", () => J(BL({ Z1: REST("Z1", "20260105090500", [["01", "3", null]]) }, { wanted: ["Z1"] }, noLe).routes[0].rest_areas[0].stations[0].chargers[0]), { type: "fast", power_kw: 50, status: "charging" });
  const Lz = BL({ Z0: REST("Z0", "20260105090500", [["01", "2"]]) }, { wanted: ["Z0"] }, DOC([STN("Z0", [])]));
  same("목록 충전기 0개", () => [stats(Lz, "Z0"), Lz.relay.mixed, Lz.relay.ids], [[], ["Z0"], ["Z0"]]);
  const Lzz = BL({ Z0: REST("Z0", "20260105090500", []) }, { wanted: ["Z0"] }, DOC([STN("Z0", [])]));
  same("목록 0개·상태 0개", () => [Lzz.relay.mixed, Lzz.relay.ids], [["Z0"], ["Z0"]]);
  // D3 stat 표: 1·2·3·4·5·9·그 밖(7·빈 글·__proto__·toString·" 2")
  const CODES = ["1", "2", "3", "4", "5", "9", "7", "", "__proto__", "toString", " 2"];
  const WANTS = [CE, "available", "charging", "out_of_service", "maintenance", CE, CE, CE, CE, CE, CE];
  const Ld = BL({ Z1: REST("Z1", "20260105090500", CODES.map((s, i) => [num(i), s])) }, { wanted: ["Z1"] }, DOC([STN("Z1", CODES.map(() => "fast"))]));
  same("stat 표", () => stats(Ld, "Z1"), WANTS);
}

// ---------- 입력을 고치지 않음 (C5, 기준 7) ----------
{
  const doc = ROUTES(), rest = { KP000101: REST("KP000101", "20260105090500", [["01", "3", 5]]), KP000102: REST2() }, meta = META();
  const before = JSON.stringify([doc, rest, meta]);
  const L = tryCall(() => fn("buildLive")(doc, rest, meta, { now: T_META + 31 * MIN, wanted: ["KP000101", "KP000102"] }));
  check("buildLive 입력 그대로", JSON.stringify([doc, rest, meta]) === before, "routesDoc·restById·meta 가 바뀜");
  ok("buildLive 새 충전소 객체", () => ["KP000101", "KP000102"].every((id) => !!stationOf(L, id) && stationOf(L, id) !== stationOf(doc, id)));
  ok("buildLive 새 충전기 객체", () => ["KP000101", "KP000102"].every((id) => stationOf(L, id).chargers.every((c, i) => c !== stationOf(doc, id).chargers[i])));
  ok("buildLive 새 배열", () => L.routes !== doc.routes && L.routes[0].rest_areas !== doc.routes[0].rest_areas && L.routes[0].rest_areas[0].stations !== doc.routes[0].rest_areas[0].stations);
  const fz = deepFreeze(ROUTES()), fr = deepFreeze({ KP000101: REST1() }), fm = deepFreeze(META());
  same("buildLive 얼린 입력", () => { const x = fn("buildLive")(fz, fr, fm, { now: NOW0, wanted: ["KP000101"] }); return [stats(x, "KP000101"), x.relay]; }, [["charging", "charging"], { at: T_META, ok: true, ids: ["KP000101"], missing: [], mixed: [], oldest: T_META }]);
}

// ---------- expire·expireLive (330~331행, N12, 기준 8) ----------
{
  const L2 = BL({ KP000101: REST1(), KP000102: REST2() }, { wanted: ["KP000101", "KP000102"] });
  const s0 = JSON.stringify(L2);
  same("expireLive 30분 정각", () => [fn("expireLive")(L2, T_META + 30 * MIN), JSON.stringify(L2) === s0], [0, true]);
  same("expireLive 30분 1밀리초", () => [fn("expireLive")(L2, T_META + 30 * MIN + 1), allStats(L2)], [2, [CE, CE, CE]]);
  same("expireLive 한 번 더", () => fn("expireLive")(L2, T_META + 30 * MIN + 1), 0);
  const plain = ROUTES(), p0 = JSON.stringify(plain);
  same("expireLive 표식 없음", () => [fn("expireLive")(plain, T_LIST + 99 * 3600000), JSON.stringify(plain) === p0], [0, true]);
  const weird = { relay: {}, routes: [null, 3, { rest_areas: [null, { stations: [null, { chargers: null, updated: 0 }, { chargers: [null, { status: "available" }], updated: 0 }] }] }] };
  same("expireLive 모양 다름", () => [fn("expireLive")(weird, NOW0), weird.routes[2].rest_areas[1].stations[2].chargers], [1, [null, { status: CE }]]);
  const oldRoute = () => ({ rest_areas: [{ stations: [{ updated: 0, chargers: [{ status: "available" }] }] }] });
  const SHAPES = [
    [{ relay: {}, routes: "x" }, 0], [null, 0], [{ relay: true, routes: [] }, 0], [{ relay: true, routes: [oldRoute()] }, 0],
    [{ relay: "x", routes: [oldRoute()] }, 0], [{ relay: null, routes: [oldRoute()] }, 0], [{ relay: {}, routes: null }, 0],
    [{ relay: {}, routes: [{ rest_areas: "x" }, { rest_areas: [{ stations: "x" }] }, oldRoute()] }, 1], [undefined, 0], ["x", 0],
  ];
  SHAPES.forEach(([live, want], i) => same(`expireLive 모양 ${num(i)}`, () => fn("expireLive")(live, NOW0), want));
  const nb = { relay: {}, routes: [{ rest_areas: [], nearby: [{ updated: 0, chargers: [{ status: "available" }] }] }], nearby: [{ updated: 0, chargers: [{ status: "available" }] }] };
  const nb0 = JSON.stringify(nb);
  same("expireLive nearby 그대로", () => [fn("expireLive")(nb, NOW0), JSON.stringify(nb) === nb0], [0, true]);
  const st = (u, ...ss) => ({ updated: u, chargers: ss.map((s) => ({ status: s })) });
  const EXP = [
    [() => null, NOW0, 0, null],
    [() => [st(0, "charging")], NOW0, 1, [[CE]]],
    [() => [st(NOW0 - 30 * MIN, "available")], NOW0, 0, [["available"]]],
    [() => [st(NOW0 - 30 * MIN - 1, "available", "charging")], NOW0, 1, [[CE, CE]]],
    [() => [st(0, CE, CE)], NOW0, 0, [[CE, CE]]],
    [() => [st(0, CE, "available")], NOW0, 1, [[CE, CE]]],
    [() => [st(null, "available")], NOW0, 1, [[CE]]],
    [() => [st(String(NOW0), "available")], NOW0, 1, [[CE]]],
    [() => [st(NOW0 + 6 * MIN, "available")], NOW0, 1, [[CE]]],
    [() => [st(NOW0 + 5 * MIN, "available")], NOW0, 0, [["available"]]],
    [() => [st(NOW0, "available")], NaN, 1, [[CE]]],
    [() => [st(NOW0, "available"), st(0, "charging"), st(0, CE), null, 5, { updated: 0 }, { updated: 0, chargers: "x" }, st(1, "maintenance", "out_of_service")], NOW0, 2, null],
    [() => "x", NOW0, 0, null],
    [() => ({ updated: 0, chargers: [{ status: "available" }] }), NOW0, 0, null],
  ];
  EXP.forEach(([mk, now, n, after], i) => {
    const s = mk();
    same(`expire ${num(i)}`, () => { const c = fn("expire")(s, now); return after === null ? c : [c, s.map((x) => x.chargers.map((y) => y.status))]; }, after === null ? n : [n, after]);
  });
}

// ---------- routeHint (337행, 기준 9) ----------
{
  const HINTS = [
    [() => L0, ["KP000101"], ""], [() => L0, ["KP000102"], HINT], [() => L0, ["KP000102", "KP000101"], ""], [() => L0, [], ""],
    [() => ROUTES(), ["KP000102"], ""], [() => null, ["KP000102"], ""], [() => L0, "KP000102", ""], [() => L0, null, ""],
    [() => ({ relay: {} }), ["KP000102"], ""], [() => ({ relay: { ids: [] } }), ["KP000102"], HINT],
    [() => ({ relay: { ids: ["A", "B"] } }), ["C", "D", "B"], ""], [() => ({ relay: { ids: ["A"] } }), ["a"], HINT],
  ];
  HINTS.forEach(([mk, ids, want], i) => same(`routeHint ${num(i)}`, () => fn("routeHint")(mk(), ids), want));
}

// ---------- refreshRest (338~343행, 기준 10~18) ----------
const files = (extra) => Object.assign({ "meta.json": RAW["meta.json"], "routes.json": RAW["routes.json"], "status/rest/KP000101.json": RAW["status/rest/KP000101.json"], "status/rest/KP000102.json": RAW["status/rest/KP000102.json"] }, extra || {});
function setup(fx, extra, delay) {
  const f = T.makeFetch(files(fx), { base: B, delay });
  const D = { n: 0, obj: { direct: "자료" } }, prog = [];
  const o = Object.assign({ settings: { on: true, base: B }, href: "https://x.example/p/", fetch: f, now: NOW0, key: "", direct: async () => { D.n += 1; return D.obj; }, routeKey: "live-gb-down", onProgress: (a, b) => prog.push([a, b]) }, extra || {});
  return { o, f, D, prog };
}
async function RR(o) { const out = { res: undefined, err: undefined }; try { out.res = await fn("refreshRest")(o); } catch (e) { out.err = e; } return out; }
const restRaw = (id, at, list) => JSON.stringify({ rest: id, at, chargers: list.map(([c, s]) => ({ statId: id, chgerId: c, stat: s, lastTedt: "20260105083000" })) });
const metaRaw = (o) => JSON.stringify(Object.assign(META(), o));
function failCheck(name, out, msg, D) {
  const why = out.res !== undefined ? ["던지지 않음"] : isRelayErr(out.err, "relay_failed", msg + TAIL, ["https", "a.example", "SECRET"]);
  if (D && D.n !== 0) why.push(`direct ${D.n}번`);
  check(name, why.length === 0, why.join("; ") + ` (${out.err && out.err.name}: ${out.err && out.err.message})`);
}
const U = (p) => B + p;

async function asyncPart() {
  {
    const s = setup(null, { config: CFG });
    const out = await RR(s.o), r = out.res || {};
    same("켬 부른 주소", () => s.f.calls(), [U("meta.json"), U("routes.json"), U("status/rest/KP000101.json")]);
    same("켬 결과", () => [r.source, r.note, r.tone, s.D.n, Object.keys(r).sort()], ["relay", "", "good", 0, ["live", "note", "source", "tone"]]);
    same("켬 onProgress", () => s.prog, [[1, 1]]);
    ok("켬 fetch 둘째 인자", () => s.f.inits().length === 3 && s.f.inits().every((x) => canon(x) === canon({ cache: "no-cache" })));
    same("켬 live", () => [stats(r.live, "KP000101"), stats(r.live, "KP000102"), r.live.fetched_at, r.live.item_count, r.live.relay], [["charging", "charging"], ["available"], NOW0, 3, { at: T_META, ok: true, ids: ["KP000101"], missing: [], mixed: [], oldest: T_META }]);
    ok("켬 config 전달", () => r.live.config === CFG);
  }
  {
    const s = setup(null, { routeKey: "live-gb-up" });
    const r = (await RR(s.o)).res || {};
    same("켬 live-gb-up", () => [s.f.calls()[2], s.f.calls().length, r.live.relay.ids, stats(r.live, "KP000102")], [U("status/rest/KP000102.json"), 3, ["KP000102"], ["available"]]);
  }
  {
    const s = setup(null, { routeKey: "navi", extraIds: ["KP000102", "KP000101"] });
    const r = (await RR(s.o)).res || {};
    same("켬 navi 둘", () => [s.f.calls().slice(2), s.prog, r.source, r.note], [[U("status/rest/KP000102.json"), U("status/rest/KP000101.json")], [[1, 2], [2, 2]], "relay", ""]);
  }
  // 오래됨 (기준 11, N1)
  {
    const r = (await RR(setup(null, { now: T_META + 40 * MIN }).o)).res || {};
    same("오래됨 40분", () => [r.note, r.tone, allStats(r.live)], ["40분 전 상태라 빈자리를 세지 않았어요.", "warn", [CE, CE, CE]]);
    const quiet = { "status/rest/KP000101.json": restRaw("KP000101", "20260105083200", [["01", "3"], ["02", "3"]]) };
    const q = (await RR(setup(quiet).o)).res || {};
    same("조용한 충전소", () => [q.note, q.tone, stats(q.live, "KP000101"), stationOf(q.live, "KP000101").updated], ["", "good", ["charging", "charging"], T_META]);
    const bad = Object.assign({ "meta.json": metaRaw({ ok: false, error: "상태 받기 실패: HTTP 500" }) }, quiet);
    const b = (await RR(setup(bad).o)).res || {};
    same("meta 실패 + 40분", () => [b.note, b.tone, stats(b.live, "KP000101")], ["중계가 마지막 받기에 실패했어요(상태 받기 실패: HTTP 500). 40분 전 상태라 빈자리를 세지 않았어요.", "warn", [CE, CE]]);
    const t = (await RR(setup(null, { now: T_META + 18 * MIN }).o)).res || {};
    same("18분", () => [t.note, t.tone, stats(t.live, "KP000101")], ["18분 전 상태예요.", "warn", ["charging", "charging"]]);
  }
  // 글을 잇는 차례: metaNote → staleNote → 없음 → 목록 다름 (341행)
  {
    const fx = { "meta.json": metaRaw({ ok: false, error: "E1" }), "status/rest/KP000101.json": restRaw("KP000101", "20260105090500", [["01", "3"], ["02", "3"], ["03", "2"]]), "status/rest/KP000102.json": 404 };
    const r = (await RR(setup(fx, { extraIds: ["KP000102"] }).o)).res || {};
    same("글 잇기", () => [r.note, r.tone, r.live.relay.missing, r.live.relay.mixed], ["중계가 마지막 받기에 실패했어요(E1). 충전소 1곳은 상태 파일이 없어 미확인이에요. 충전소 1곳은 충전기 목록이 달라 미확인이에요.", "warn", ["KP000102"], ["KP000101"]]);
  }
  // now 가 수가 아니면 Date.now() (343행)
  for (const [label, now] of [["없음", undefined], ["글자", "1767571920000"], ["NaN", NaN]]) {
    const a = Date.now(), r = (await RR(setup(null, { now }).o)).res || {}, b = Date.now();
    ok(`now ${label}`, () => r.live.fetched_at >= a && r.live.fetched_at <= b, `fetched_at ${r.live && r.live.fetched_at}`);
  }
  // 예비(키 있음) (기준 12)
  const FALL = [
    ["meta 404", { "meta.json": 404 }, 1], ["routes 503", { "routes.json": 503 }, 2], ["상태 깨짐", { "status/rest/KP000101.json": "{" }, 3],
    ["meta 연결 실패", { "meta.json": T.DOWN }, 1], ["routes 모양", { "routes.json": { v: 2 } }, 2], ["상태 다른 휴게소", { "status/rest/KP000101.json": RAW["status/rest/KP000102.json"] }, 3],
    ["상태 500", { "status/rest/KP000101.json": 500 }, 3],
  ];
  for (const [label, fx, n] of FALL) {
    const s = setup(fx, { key: "K" });
    const out = await RR(s.o), r = out.res || {};
    ok(`예비 ${label}`, () => r.source === "direct" && r.note === FB && r.tone === "warn" && r.live === s.D.obj && s.D.n === 1 && s.f.calls().length === n,
      `${out.err && out.err.message} / ${r.source} ${r.note} ${r.tone} direct ${s.D.n} 부른 수 ${s.f.calls().length}`);
  }
  // 예비 없음 (기준 13)
  const NOFB = [
    ["meta 404", { "meta.json": 404 }, {}, "중계에 파일이 없어요"],
    ["연결 실패", { "meta.json": T.DOWN }, {}, "중계에 연결하지 못했어요"],
    ["meta v2", { "meta.json": { v: 2 } }, {}, "중계 파일을 읽지 못했어요"],
    ["상태 500", { "status/rest/KP000101.json": 500 }, {}, "중계가 500 로 답했어요"],
    ["direct null", { "meta.json": 404 }, { key: "K", direct: null }, "중계에 파일이 없어요"],
    ["direct 글자", { "routes.json": 503 }, { key: "K", direct: "x" }, "중계가 503 로 답했어요"],
    ["키 빈 글", { "meta.json": 404 }, { key: "" }, "중계에 파일이 없어요"],
    ["키 없음", { "status/rest/KP000101.json": "{" }, { key: undefined }, "중계 파일을 읽지 못했어요"],
  ];
  for (const [label, fx, extra, msg] of NOFB) {
    const s = setup(fx, extra);
    failCheck(`예비 없음 ${label}`, await RR(s.o), msg, s.D);
  }
  // 404 한 파일 (N2, 기준 14)
  {
    const s = setup({ "status/rest/KP000101.json": 404 });
    failCheck("404 하나뿐", await RR(s.o), "중계에 파일이 없어요", s.D);
    same("404 하나뿐 onProgress", () => s.prog, [[1, 1]]);
    const s2 = setup({ "status/rest/KP000102.json": 404 }, { extraIds: ["KP000102"] });
    const r = (await RR(s2.o)).res || {};
    same("404 둘 중 하나", () => [r.source, r.note, r.tone, r.live.relay.missing, r.live.relay.ids, stats(r.live, "KP000102"), stats(r.live, "KP000101"), s2.prog],
      ["relay", "충전소 1곳은 상태 파일이 없어 미확인이에요.", "warn", ["KP000102"], ["KP000101"], ["available"], ["charging", "charging"], [[1, 2], [2, 2]]]);
    const s3 = setup({ "status/rest/KP000101.json": 404, "status/rest/KP000102.json": 404 }, { extraIds: ["KP000102"], key: "K" });
    const r3 = (await RR(s3.o)).res || {};
    same("404 둘 다·키 있음", () => [r3.source, r3.note, s3.D.n], ["direct", FB, 1]);
  }
  // rest 이름 규칙에 안 맞는 id 는 받지 않고 '없음' (340행)
  {
    const doc = ROUTES();
    const st = doc.routes[0].rest_areas[0].stations;
    st.unshift(Object.assign(J(st[0]), { id: "a.b" }));
    const s = setup({ "routes.json": JSON.stringify(doc) });
    const r = (await RR(s.o)).res || {};
    same("이름 틀린 id", () => [s.f.calls(), r.live.relay.missing, r.live.relay.ids, r.note, s.prog.length, s.prog[1]],
      [[U("meta.json"), U("routes.json"), U("status/rest/KP000101.json")], ["a.b"], ["KP000101"], "충전소 1곳은 상태 파일이 없어 미확인이에요.", 2, [2, 2]]);
    doc.routes[0].rest_areas[0].stations = [st[0]];
    const s2 = setup({ "routes.json": JSON.stringify(doc) });
    failCheck("이름 틀린 id 뿐", await RR(s2.o), "중계에 파일이 없어요", s2.D);
    same("이름 틀린 id 뿐 부른 수", () => s2.f.calls().length, 2);
  }
  // 끔 (C1, 기준 15)
  {
    const s = setup(null, { settings: { on: false, base: B }, key: "K" });
    const r = (await RR(s.o)).res || {};
    ok("끔 키 있음", () => s.f.calls().length === 0 && s.D.n === 1 && r.live === s.D.obj && r.source === "direct" && r.note === "" && r.tone === "good",
      `부른 수 ${s.f.calls().length} direct ${s.D.n} ${r.source} ${r.note} ${r.tone}`);
    for (const [label, extra, code, msg] of [
      ["키 없음", {}, "no_key", "인증키가 필요해요"], ["direct 없음", { key: "K", direct: undefined }, "no_direct", "직접 받기 설정이 없어요"],
      ["둘 다 없음", { direct: undefined }, "no_key", "인증키가 필요해요"], ["on 0", { settings: { on: 0, base: B } }, "no_key", "인증키가 필요해요"],
    ]) {
      const s2 = setup(null, Object.assign({ settings: { on: false, base: B } }, extra));
      const out = await RR(s2.o);
      const why = out.res !== undefined ? ["던지지 않음"] : isRelayErr(out.err, code, msg);
      if (s2.f.calls().length) why.push(`fetch ${s2.f.calls().length}번`);
      if (s2.D.n) why.push(`direct ${s2.D.n}번`);
      check(`끔 ${label}`, why.length === 0, why.join("; "));
    }
    const X = Object.assign(new Error("직접 받기 실패"), { code: "X" });
    const thrower = async () => { throw X; };
    for (const [label, extra] of [["끔", { settings: { on: false, base: B } }], ["예비", { files: { "meta.json": 404 } }]]) {
      const s3 = setup(extra.files || null, Object.assign({ key: "K", direct: thrower }, extra.settings ? { settings: extra.settings } : {}));
      const out = await RR(s3.o);
      check(`direct 오류 그대로 ${label}`, out.err === X, `받은 것 ${out.err && out.err.name}/${out.err && out.err.code}/${out.err && out.err.message}`);
    }
  }
  // 기본 주소 (기준 16)
  for (const [label, href, want] of [
    ["안드로이드", "file:///android_asset/index.html", ANDROID + "meta.json"],
    ["github", "https://vicfos99-tech.github.io/ev-station-map/index.html", ANDROID + "meta.json"],
    ["다른 사이트", "https://me.example/ev/index.html", "https://me.example/ev/relay/meta.json"],
  ]) {
    const f = T.makeFetch({});
    await RR({ settings: { on: true, base: "" }, href, fetch: f, now: NOW0 });
    same(`기본 주소 ${label}`, () => f.calls()[0], want);
  }
  {
    const f = T.makeFetch({});
    await RR({ href: "https://me.example/ev/index.html", fetch: f, now: NOW0 });
    same("settings 없음", () => f.calls(), ["https://me.example/ev/relay/meta.json"]);
  }
  // 한 번에 여는 수 (D6, 기준 17)
  {
    const doc = ROUTES();
    const ids = Array.from({ length: 20 }, (_, i) => "R" + num(i));
    doc.routes.push({ key: "big", highway: "h", direction: "d", length: 100, live: true, rest_areas: ids.map((id, i) => ({ name: "휴" + i, km: i, stations: [{ id, operator: "o", price: 1, updated: T_LIST, chargers: [{ type: "fast", power_kw: 50, status: "comm_error" }] }], id: "big-" + i })) });
    const fx = { "routes.json": JSON.stringify(doc) };
    ids.forEach((id) => { fx[`status/rest/${id}.json`] = restRaw(id, "20260105090500", [["01", "2"]]); });
    const s = setup(fx, { routeKey: "big" }, 3);
    const r = (await RR(s.o)).res || {};
    same("20곳 부른 수", () => s.f.calls().length, 22);
    ok("20곳 maxActive", () => s.f.maxActive() >= 1 && s.f.maxActive() <= 6, `maxActive ${s.f.maxActive()}`);
    same("20곳 받은 주소", () => s.f.calls().slice(2).sort(), ids.map((id) => U(`status/rest/${id}.json`)));
    same("20곳 relay.ids", () => [...r.live.relay.ids].sort(), ids);
    same("20곳 onProgress", () => [s.prog.length, s.prog[19], s.prog.map((p) => p[0]), s.prog.every((p) => p[1] === 20)], [20, [20, 20], ids.map((_, i) => i + 1), true]);
    same("20곳 상태", () => ids.map((id) => stats(r.live, id)[0]), ids.map(() => "available"));
  }
  // fetch 가 던지는 것 (기준 18)
  {
    const thrower = (e) => async () => { throw e; };
    const s = setup(null, {});
    s.o.fetch = thrower(new RangeError("SECRET https://a.example/relay/meta.json"));
    failCheck("RangeError", await RR(s.o), "중계에 연결하지 못했어요", s.D);
    const s2 = setup(null, { key: "K" });
    s2.o.fetch = thrower(new RangeError("SECRET"));
    const r2 = (await RR(s2.o)).res || {};
    same("RangeError 키 있음", () => [r2.source, r2.note, s2.D.n], ["direct", FB, 1]);
    const ab = new Error("멈춤"); ab.name = "AbortError";
    const s3 = setup(null, { key: "K" });
    s3.o.fetch = thrower(ab);
    const o3 = await RR(s3.o);
    check("AbortError 그대로", o3.err === ab && s3.D.n === 0, `받은 것 ${o3.err && o3.err.name}/${o3.err && o3.err.code} direct ${s3.D.n}`);
  }
}

asyncPart().catch((e) => check("refreshRest 시험 중 오류", false, e && e.stack)).then(() => T.finish());
