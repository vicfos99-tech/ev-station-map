/*
 * r5_around 시험(JS 쪽): web/relay.js 의 overlayRegion·regionStations·loadRegion·refreshRegion
 * (plan.md 5절 r5_around 365~395행, 2.1 N1·N11·N13, 2.2 D1·D2·D3·D5·D7·D11·D12, 3절 C1~C6, 3.1·3.2).
 * test_r5_around_relay.py 가 run_js 로 돌려 확인 하나를 pytest 테스트 하나로 보인다(C7).
 * relay.js 가 없거나 함수가 없어도 확인 이름은 모두 나온다(실패로).
 * 견본은 ref/relay_sample/ 을 읽기만 한다(plan.md 21행). 기대값은 참조 구현으로 검산했다(.orchestra/logs/tests_r5_around.md).
 */
"use strict";
const T = require("./test_p0_fake.js");
const path = require("path");
const fs = require("fs");
const { check } = T;

let R = null, loadErr = "";
try { R = require(path.join(__dirname, "..", "web", "relay.js")); } catch (e) { loadErr = String(e && e.message).slice(0, 200); }
let AROUND = null;
try { AROUND = require(path.join(__dirname, "..", "web", "around.js")); } catch (e) { AROUND = null; }

const FUNCS = ["overlayRegion", "regionStations", "loadRegion", "refreshRegion"];
const MIN = 60000;
const NOW0 = 1767571920000, T_META = 1767571800000, T_LIST = 1767571200000, T_915 = 1767572100000;
const B = "https://a.example/relay/";
const ANDROID = "https://vicfos99-tech.github.io/ev-station-map/relay/";
const FB = "중계에 연결하지 못해 직접 받았어요";
const SUS = "이 지역은 충전소 목록을 확인하는 중이라 빠진 곳이 있을 수 있어요.";
const TAIL = ". 공공 데이터 키를 넣으면 직접 받을 수 있어요.";
const CE = "comm_error";
const TARIFF = { default: 391, "환경부": 347 };
const J = (x) => JSON.parse(JSON.stringify(x));
const RAW = {};
for (const p of ["meta.json", "stations/41135.json", "status/41135.json", "stations/41463.json"]) RAW[p] = fs.readFileSync(path.join(__dirname, "..", "ref", "relay_sample", p), "utf8");
const SAMPLE = (p) => JSON.parse(RAW[p]);
const META = () => SAMPLE("meta.json");
const ST = () => SAMPLE("stations/41135.json");
const STA = () => SAMPLE("status/41135.json");

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
// f() 의 값이 want 와 같은지(열쇠 순서는 보지 않음). 던지면 실패
function same(name, f, want) {
  let got, d = "";
  try { got = f(); } catch (e) { d = `던짐: ${e && e.name}: ${e && e.message}`; }
  check(name, !d && canon(got) === canon(want), d || `받은 값 ${canon(got)} != 기대 ${canon(want)}`);
}
// 열쇠 순서까지 같은지(JSON 글자)
function exact(name, f, want) {
  let got, d = "";
  try { got = JSON.stringify(f()); } catch (e) { d = `던짐: ${e && e.name}: ${e && e.message}`; }
  check(name, !d && got === JSON.stringify(want), d || `받은 값 ${got} != 기대 ${JSON.stringify(want)}`);
}
function ok(name, f, detail) {
  let v = false, d = "";
  try { v = f(); } catch (e) { d = `던짐: ${e && e.name}: ${e && e.message}`; }
  check(name, v === true, d || (typeof detail === "function" ? safe(detail) : detail) || "거짓");
}
const safe = (g) => { try { return g(); } catch (e) { return "detail 오류"; } };
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
  if (e && e.cause !== undefined) why.push("cause 가 있음");
  const t = errText(e);
  for (const s of secrets || []) if (t.includes(s)) why.push(`글에 '${s}' 가 남음`);
  return why;
}
function deepFreeze(o) { if (o && typeof o === "object") { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; }
// parse… 결과 모양(plan.md 308·310행). r3 의 parse 함수를 쓰지 않고 손으로 만든다(r5 만 시험)
const PST = (doc) => ({ v: 1, zscode: doc.zscode, zcodes: doc.zcodes, stations: doc.stations.map((s) => Object.assign({ id: s.id, name: s.name, operator: s.operator, maker: s.maker, loc: s.loc, chargers: s.chargers.map((c) => ({ id: c.id, type: c.type, kw: c.kw })) }, s.indoor === true ? { indoor: true } : {})) });
const PSA = (doc) => { const s = Object.create(null); for (const [k, v] of Object.entries(doc.s)) { s[k] = Object.create(null); for (const [c, a] of Object.entries(v)) s[k][c] = Array.isArray(a) ? a[0] : a; } return { at: doc.at, s }; };
const PMETA = (m) => ({ v: 1, at: m.at, ok: m.ok, error: m.error || "", suspect: m.suspect || [], fresh: m.fresh || [] });
const STD = () => PST(ST()), STS = () => PSA(STA()), MT = (x) => PMETA(Object.assign(META(), x || {}));
const RS = (o, stDoc, staDoc, meta) => fn("regionStations")(stDoc || STD(), staDoc || STS(), meta === undefined ? MT() : meta, Object.assign({ now: NOW0, tariffs: TARIFF }, o || {}));
const byId = (list, id) => (list || []).find((s) => s && s.id === id);
const stats = (list) => (list || []).map((s) => s.chargers.map((c) => c.status).join(",")).join(" / ");
const SUM = (st) => AROUND.summary(st);
const W1 = { id: "ME000201", name: "분당 지어낸 충전소", operator: "환경부", maker: "가나전기·마바전기", addr: "", price: 347, loc: [37.38012, 127.11854], updated: T_META,
  chargers: [{ id: "01", type: "fast", power_kw: 50, status: "available" }, { id: "02", type: "slow", power_kw: 7, status: "charging" }] };
const W2 = { id: "ME000202", name: "판교주차장", operator: "한국전력", maker: "가나전기", addr: "", price: 391, loc: [37.39471, 127.11112], updated: T_META,
  chargers: [{ id: "01", type: "fast", power_kw: 350, status: CE }], indoor: true };

for (const n of FUNCS) check(`내보냄 ${n}`, !!R && typeof R[n] === "function", `relay.js 에 ${n} 함수가 없음 ${loadErr}`);

// ---------- regionStations (369행, 기준 1~7) ----------
exact("regionStations 기본 ME000201", () => byId(RS(), "ME000201"), W1);
exact("regionStations 기본 ME000202", () => byId(RS(), "ME000202"), W2);
exact("regionStations 기본 전체", () => RS(), [W1, W2]);
ok("regionStations indoor 없으면 칸 없음", () => !("indoor" in byId(RS(), "ME000201")));
ok("regionStations 새 충전소 객체", () => { const d = STD(), r = RS({}, d); return r[0] !== d.stations[0] && r[0].chargers[0] !== d.stations[0].chargers[0] && r[0].chargers !== d.stations[0].chargers && r[0].loc !== d.stations[0].loc; });
// 기준 2: around.js 와 같은 모양
ok("같은 모양 summary ME000201", () => canon(SUM(byId(RS(), "ME000201"))) === canon({ free: 1, busy: 0, total: 1, broken: 0, kw: 50 }), () => canon(SUM(byId(RS(), "ME000201"))));
ok("같은 모양 summary ME000202", () => canon(SUM(byId(RS(), "ME000202"))) === canon({ free: 0, busy: 0, total: 1, broken: 1, kw: 350 }), () => canon(SUM(byId(RS(), "ME000202"))));
const CFG = { slow_types: ["02", "07"], default_kw: { fast: 50, slow: 7 }, status: { "1": CE, "2": "available", "3": "charging", "4": "out_of_service", "5": "maintenance", "9": CE }, tariffs: TARIFF };
const ITEMS = [
  { statId: "ME000201", statNm: "분당 지어낸 충전소", busiNm: "환경부", maker: "가나전기", lat: "37.38012", lng: "127.11854", chgerId: "01", chgerType: "01", output: "50", stat: "2" },
  { statId: "ME000201", statNm: "분당 지어낸 충전소", busiNm: "환경부", maker: "마바전기", lat: "37.38012", lng: "127.11854", chgerId: "02", chgerType: "02", output: "7", stat: "3" },
  { statId: "ME000202", statNm: "판교주차장", busiNm: "한국전력", maker: "가나전기", lat: "37.39471", lng: "127.11112", chgerId: "01", chgerType: "01", output: "350", stat: "9" },
];
const keysOf = (o) => Object.keys(o).sort().join(",");
ok("같은 모양 stationsOf 열쇠 집합", () => {
  const a = AROUND.stationsOf(ITEMS, CFG, T_META), r = RS();
  return a.length === 2 && r.length === 2 && a.every((s, i) => { const x = Object.assign({}, r[i]); delete x.indoor; return keysOf(s) === keysOf(x) && s.chargers.every((c, j) => keysOf(c) === keysOf(r[i].chargers[j])); });
});
exact("같은 모양 stationsOf ME000201 값", () => byId(RS(), "ME000201"), AROUND ? AROUND.stationsOf(ITEMS, CFG, T_META)[0] : "around.js 없음");
// 기준 3: 요금표(D5)
const TAR = [
  [null, [null, null]], [undefined, [null, null]], [{ "환경부": 347 }, [347, null]], [{ default: 391 }, [391, 391]],
  [{ default: 391, "환경부": 0 }, [0, 391]], [{ default: 391, "한국전력": 280 }, [391, 280]], [{ default: 0 }, [0, 0]], [{}, [null, null]],
  [{ default: 391, "환경부 ": 1 }, [391, 391]],
];
TAR.forEach(([tr, want], i) => same(`요금표 ${String(i + 1).padStart(2, "0")}`, () => RS({ tariffs: tr }).map((s) => s.price), want));
same("요금표 tariffs 칸 없음", () => fn("regionStations")(STD(), STS(), MT(), { now: NOW0 }).map((s) => s.price), [null, null]);
// 기준 4: 보증(N1)
const F0 = () => MT({ fresh: [] });
same("보증 없음 updated", () => RS({}, null, null, F0()).map((s) => s.updated), [T_LIST, T_LIST]);
same("보증 없음 지금은 셈", () => RS({}, null, null, F0()).map((s) => SUM(s).free), [1, 0]);
same("보증 없음 31분", () => RS({ now: T_LIST + 31 * MIN }, null, null, F0()).map((s) => [SUM(s).free, SUM(s).broken]), [[0, 1], [0, 1]]);
same("보증 없음 30분 정각", () => RS({ now: T_LIST + 30 * MIN }, null, null, F0()).map((s) => SUM(s).free), [1, 0]);
same("meta ok false updated", () => RS({}, null, null, MT({ ok: false })).map((s) => s.updated), [T_LIST, T_LIST]);
same("meta null updated", () => RS({}, null, null, null).map((s) => s.updated), [T_LIST, T_LIST]);
same("zcodes 하나 모자람 updated", () => { const d = STD(); d.zcodes = ["41", "11"]; return RS({}, d).map((s) => s.updated); }, [T_LIST, T_LIST]);
same("zcodes 빈 배열 updated", () => { const d = STD(); d.zcodes = []; return RS({}, d).map((s) => s.updated); }, [T_LIST, T_LIST]);
same("보증 있음 31분", () => RS({ now: T_META + 31 * MIN }).map((s) => SUM(s).free), [0, 0]);
same("보증 있음 30분 정각", () => RS({ now: T_META + 30 * MIN }).map((s) => SUM(s).free), [1, 0]);
same("보증 있음 30분 1밀리초 상태", () => stats(RS({ now: T_META + 30 * MIN + 1 })), [CE, CE].join(",") + " / " + CE);
same("파일 at 이 meta 보다 늦음", () => { const s = STS(); s.at = "20260105091500"; return RS({}, null, s).map((x) => x.updated); }, [T_915, T_915]);
same("앞선 시각 5분", () => stats(RS({ now: T_META - 5 * MIN })), "available,charging / " + CE);
same("앞선 시각 5분 넘음", () => stats(RS({ now: T_META - 5 * MIN - 1 })), CE + "," + CE + " / " + CE);
// 기준 5: 상태 파일에 없는 충전기
const SDROP = (f) => { const s = STS(); f(s.s); return s; };
same("상태에 ME000201 없음", () => { const r = RS({}, null, SDROP((s) => { delete s.ME000201; })); return [stats(r), SUM(r[0]).free, SUM(r[0]).broken]; }, [CE + "," + CE + " / " + CE, 0, 1]);
same("ME000202 를 2 로", () => SUM(byId(RS({}, null, SDROP((s) => { s.ME000202["01"] = "2"; })), "ME000202")).free, 1);
same("충전기 하나만 없음", () => stats(RS({}, null, SDROP((s) => { delete s.ME000201["02"]; }))), "available," + CE + " / " + CE);
same("충전기 id 1 은 01 이 아님", () => stats(RS({}, null, SDROP((s) => { s.ME000201 = Object.assign(Object.create(null), { "1": "2", "2": "3" }); }))), CE + "," + CE + " / " + CE);
same("충전소 id 소문자는 다름", () => stats(RS({}, null, SDROP((s) => { delete s.ME000202; s.me000202 = Object.assign(Object.create(null), { "01": "2" }); }))), "available,charging / " + CE);
// 기준 6: 급속 없는 충전소·좌표
same("급속 없는 충전소 빠짐", () => { const d = STD(); d.stations[1].chargers[0].type = "slow"; return RS({}, d).map((s) => s.id); }, ["ME000201"]);
same("완속뿐인 충전소가 앞", () => { const d = STD(); d.stations[0].chargers.forEach((c) => { c.type = "slow"; }); return RS({}, d).map((s) => s.id); }, ["ME000202"]);
same("급속이 뒤 충전기", () => { const d = STD(); d.stations[0].chargers.reverse(); d.stations[0].chargers[0].type = "slow"; d.stations[0].chargers[1].type = "fast"; return RS({}, d).map((s) => s.id); }, ["ME000201", "ME000202"]);
const LOCS = [[[37.123456, 127.654321], [37.12346, 127.65432]], [[37.38012, 127.11854], [37.38012, 127.11854]], [[35.1, 129.000001], [35.1, 129]], [[-33.123454, -70.987656], [-33.12345, -70.98766]]];
LOCS.forEach(([loc, want], i) => same(`좌표 ${String(i + 1).padStart(2, "0")}`, () => { const d = STD(); d.stations[0].loc = loc; return RS({}, d)[0].loc; }, want));
same("빈 목록", () => { const d = STD(); d.stations = []; return RS({}, d); }, []);
same("넣은 순서 그대로", () => { const d = STD(); d.stations.reverse(); return RS({}, d).map((s) => s.id); }, ["ME000202", "ME000201"]);
same("이름·업체·제조사 그대로", () => { const d = STD(); Object.assign(d.stations[0], { name: "<b>새</b>", operator: "알 수 없음", maker: "" }); const s = RS({}, d)[0]; return [s.name, s.operator, s.maker, s.addr]; }, ["<b>새</b>", "알 수 없음", "", ""]);
same("power_kw 는 kw", () => { const d = STD(); d.stations[1].chargers[0].kw = 99.5; return RS({}, d)[1].chargers[0].power_kw; }, 99.5);
// 기준 7: 입력을 고치지 않는다(C5)
ok("regionStations 입력 그대로", () => { const d = STD(), s = STS(), m = MT(); const a = JSON.stringify([d, s.at, PSA(STA()).s, m]); RS({ now: T_META + 99 * MIN }, d, s, m); return JSON.stringify([d, s.at, PSA(STA()).s, m]) === a && JSON.stringify(s.s) === JSON.stringify(PSA(STA()).s); });
ok("regionStations 얼린 입력", () => RS({}, deepFreeze(STD()), deepFreeze(STS()), deepFreeze(MT())).length === 2);

// ---------- overlayRegion (370행, 기준 8) ----------
const OV = (list, doc, t, now) => fn("overlayRegion")(list, doc, t, now);
const DOC8 = () => PSA({ at: "20260105091400", s: { ME000201: { "01": "3", "02": "2" }, ME000202: { "01": "2" } } });
(() => {
  let L = null, a, b;
  try { L = RS(); a = OV(L, DOC8(), T_915, NOW0 + 3 * MIN); } catch (e) { a = "던짐 " + e.message; }
  check("overlay 3", a === 3, `받은 값 ${a}`);
  check("overlay 상태", L && stats(L) === "charging,available / available", L && stats(L));
  check("overlay updated", L && L.every((s) => s.updated === T_915), L && canon(L.map((s) => s.updated)));
  try { b = OV(L, DOC8(), T_915, NOW0 + 3 * MIN); } catch (e) { b = "던짐 " + e.message; }
  check("overlay 한 번 더", b === 0, `받은 값 ${b}`);
})();
same("overlay s 빈 객체", () => { const L = RS(); return [OV(L, { at: "x", s: Object.create(null) }, T_META, NOW0), stats(L)]; }, [2, CE + "," + CE + " / " + CE]);
same("overlay 30분 1밀리초", () => { const L = RS(); return [OV(L, STS(), T_META, T_META + 30 * MIN + 1), stats(L)]; }, [2, CE + "," + CE + " / " + CE]);
same("overlay 30분 정각", () => { const L = RS(); return [OV(L, DOC8(), T_META, T_META + 30 * MIN), stats(L)]; }, [3, "charging,available / available"]);
same("overlay t null", () => { const L = RS(); return [OV(L, DOC8(), null, NOW0), stats(L), L.map((s) => s.updated)]; }, [2, CE + "," + CE + " / " + CE, [null, null]]);
same("overlay 없는 충전소도 updated", () => { const L = RS(); const d = PSA({ at: "x", s: { ME000201: { "01": "2", "02": "3" } } }); return [OV(L, d, T_915, NOW0), L.map((s) => s.updated)]; }, [0, [T_915, T_915]]);
same("overlay 빈 목록", () => OV([], DOC8(), T_META, NOW0), 0);
same("overlay 같은 배열·객체", () => { const L = RS(), a = L[0], c = L[0].chargers[0]; OV(L, DOC8(), T_915, NOW0); return [L[0] === a, L[0].chargers[0] === c, L.length]; }, [true, true, 2]);
// D3: stat → 상태
const D3 = [["1", CE], ["2", "available"], ["3", "charging"], ["4", "out_of_service"], ["5", "maintenance"], ["9", CE], ["7", CE], ["", CE], ["02", CE], [" 2", CE], ["2 ", CE]];
same("overlay stat 표", () => {
  const L = [{ id: "X", updated: 0, chargers: D3.map((_, i) => ({ id: String(i), type: "fast", power_kw: 50, status: "available" })) }];
  const s = Object.create(null); s.X = Object.create(null); D3.forEach(([st], i) => { s.X[String(i)] = st; });
  const n = OV(L, { at: "x", s }, T_META, NOW0);
  return [n, L[0].chargers.map((c) => c.status)];
}, [D3.filter(([, w]) => w !== "available").length, D3.map(([, w]) => w)]);

// ---------- loadRegion·refreshRegion (371~378행, 기준 9~15) ----------
function files(fx) {
  const base = { "meta.json": META(), "stations/41135.json": ST(), "status/41135.json": STA() };
  return Object.assign(base, fx || {});
}
function setup(fx, extra, dl) {
  const f = T.makeFetch(files(fx), { base: B });
  const D = { n: 0, arr: [{ id: "D1" }], fetched_at: 1767570000000 };
  const o = Object.assign({ settings: { on: true, base: B }, href: "https://x.example/p/", fetch: f, now: NOW0, key: "", zscode: "41135", tariffs: TARIFF,
    direct: async () => { D.n += 1; return dl === undefined ? { stations: D.arr, fetched_at: D.fetched_at } : dl; } }, extra || {});
  return { f, D, o };
}
async function call(name, o) { const out = { res: undefined, err: undefined }; try { out.res = await fn(name)(o); } catch (e) { out.err = e; } return out; }
const LR = (o) => call("loadRegion", o), RR = (o) => call("refreshRegion", o);
const rel = (f) => f.calls().map((u) => (u.startsWith(B) ? u.slice(B.length) : u));
const res = (x) => (x.err ? `던짐 ${x.err && x.err.name}/${x.err && x.err.code}/${x.err && x.err.message}` : canon(x.res));
const DIRECT_REG = (D, note) => ({ zscode: "41135", stations: D.arr, fetched_at: D.fetched_at, status_at: D.fetched_at, zcodes: [], source: "direct", note, suspect: false });
const META915 = () => Object.assign(META(), { at: "20260105091500" });
const STA914 = () => ({ at: "20260105091400", s: { ME000201: { "01": ["3"], "02": ["2"] }, ME000202: { "01": ["2"] } } });

async function asyncPart() {
  // 기준 9: 켬
  {
    const { f, D, o } = setup();
    const x = await LR(o);
    const c = rel(f);
    check("켬 부른 주소", c.length === 3 && c[0] === "meta.json" && c.slice(1).sort().join(" ") === "stations/41135.json status/41135.json", canon(c));
    check("켬 fetch 둘째 인자", f.inits().length === 3 && f.inits().every((i) => canon(i) === canon({ cache: "no-cache" })), canon(f.inits()));
    const r = x.res || {};
    check("켬 결과", !x.err && canon(Object.assign({}, r, { stations: 0 })) === canon({ zscode: "41135", stations: 0, fetched_at: NOW0, status_at: T_META, zcodes: ["41"], source: "relay", note: "", suspect: false }), res(x));
    check("켬 stations", !x.err && JSON.stringify(r.stations) === JSON.stringify([W1, W2]), res(x));
    check("켬 direct 0번", D.n === 0, `direct ${D.n}번`);
  }
  const L1 = async (fx, extra) => { const s = setup(fx, extra); s.x = await LR(s.o); return s; };
  // 기준 10: suspect·meta 실패·오래됨
  const LOADS = [
    ["suspect 41", { "meta.json": Object.assign(META(), { suspect: ["41"] }) }, null, { suspect: true, note: SUS }],
    ["suspect 견본 29", null, null, { suspect: false, note: "" }],
    ["suspect zcodes 로", { "meta.json": Object.assign(META(), { suspect: ["11"] }), "stations/41135.json": Object.assign(ST(), { zcodes: ["11"] }) }, null, { suspect: true }],
    ["suspect 부분 일치 아님", { "meta.json": Object.assign(META(), { suspect: ["4", "411", "41135", " 41"] }) }, null, { suspect: false, note: "" }],
    ["meta 실패 한도", { "meta.json": Object.assign(META(), { ok: false, error: "한도 넘음" }) }, null, { note: "중계가 마지막 받기에 실패했어요(한도 넘음).", status_at: T_LIST }],
    ["18분", null, { now: T_META + 18 * MIN }, { note: "18분 전 상태예요.", fetched_at: T_META + 18 * MIN, status_at: T_META }],
    ["15분 정각", null, { now: T_META + 15 * MIN }, { note: "" }],
    ["40분", null, { now: T_META + 40 * MIN }, { note: "40분 전 상태라 빈자리를 세지 않았어요.", status_at: T_META }],
    ["글 셋 잇기", { "meta.json": Object.assign(META(), { ok: false, error: "한도 넘음", suspect: ["41"] }) }, { now: T_LIST + 18 * MIN },
      { note: "중계가 마지막 받기에 실패했어요(한도 넘음). 18분 전 상태예요. " + SUS, suspect: true, status_at: T_LIST }],
  ];
  for (const [name, fx, extra, want] of LOADS) {
    const { x } = await L1(fx, extra);
    const r = x.res || {};
    check(name, !x.err && Object.keys(want).every((k) => canon(r[k]) === canon(want[k])), res(x));
  }
  {
    const { x } = await L1(null, { now: T_META + 40 * MIN });
    check("40분 모두 comm_error", !x.err && stats(x.res.stations) === CE + "," + CE + " / " + CE, res(x));
    const y = (await L1(null, { now: T_META + 18 * MIN })).x;
    check("18분 상태는 셈", !y.err && stats(y.res.stations) === "available,charging / " + CE, res(y));
    const z = (await L1(null, { tariffs: { "환경부": 347 } })).x;
    check("tariffs 전달", !z.err && canon(z.res.stations.map((s) => s.price)) === canon([347, null]), res(z));
    const w = (await L1(null, { tariffs: undefined })).x;
    check("tariffs 없음", !w.err && canon(w.res.stations.map((s) => s.price)) === canon([null, null]), res(w));
    const n = (await L1(null, { now: undefined })).x, t0 = Date.now();
    check("now 없음", !n.err && Math.abs(n.res.fetched_at - t0) < 5 * MIN && stats(n.res.stations) === CE + "," + CE + " / " + CE, res(n));
  }
  // 기준 11: 예비(키 있음)
  const FALL = [
    ["stations 404", { "stations/41135.json": 404 }], ["meta 404", { "meta.json": 404 }], ["status 503", { "status/41135.json": 503 }],
    ["status 깨짐", { "status/41135.json": "{" }], ["meta v2", { "meta.json": Object.assign(META(), { v: 2 }) }],
    ["다른 시군구 파일", { "stations/41135.json": SAMPLE("stations/41463.json") }], ["meta 연결 실패", { "meta.json": T.DOWN }],
  ];
  for (const [name, fx] of FALL) {
    const { D, x } = await L1(fx, { key: "K" });
    check("예비 " + name, !x.err && canon(x.res) === canon(DIRECT_REG(D, FB)) && x.res.stations === D.arr && D.n === 1, res(x) + ` direct ${D.n}번`);
  }
  {
    const { D, x } = await L1(null, { key: "K", zscode: "4113" });
    check("예비 zscode 4자리", !x.err && canon(x.res) === canon(Object.assign(DIRECT_REG(D, FB), { zscode: "4113" })) && D.n === 1, res(x));
  }
  // 예비 없음
  const NOFB = [
    ["status 404", { "status/41135.json": 404 }, {}, "중계에 파일이 없어요" + TAIL],
    ["stations 404", { "stations/41135.json": 404 }, {}, "중계에 파일이 없어요" + TAIL],
    ["meta 연결 실패", { "meta.json": T.DOWN }, {}, "중계에 연결하지 못했어요" + TAIL],
    ["zscode 4자리", null, { zscode: "4113" }, "중계 파일 이름이 맞지 않아요" + TAIL],
    ["zscode 숫자", null, { zscode: 41135 }, "중계 파일 이름이 맞지 않아요" + TAIL],
    ["다른 시군구 파일", { "stations/41135.json": SAMPLE("stations/41463.json") }, {}, "중계 파일을 읽지 못했어요" + TAIL],
    ["status 500", { "status/41135.json": 500 }, {}, "중계가 500 로 답했어요" + TAIL],
    ["direct null", { "meta.json": 404 }, { key: "K", direct: null }, "중계에 파일이 없어요" + TAIL],
    ["키 빈 글", { "meta.json": 404 }, { key: "" }, "중계에 파일이 없어요" + TAIL],
  ];
  for (const [name, fx, extra, msg] of NOFB) {
    const { D, x } = await L1(fx, extra);
    const why = x.err ? isRelayErr(x.err, "relay_failed", msg, ["https", "a.example"]) : ["던지지 않음 " + res(x)];
    check("예비 없음 " + name, why.length === 0 && D.n === 0, why.join("; ") + ` direct ${D.n}번`);
  }
  {
    const { f } = await L1({ "meta.json": T.DOWN });
    check("meta 연결 실패 부른 주소", canon(rel(f)) === canon(["meta.json"]), canon(rel(f)));
    const g = await L1(null, { settings: { on: true, base: "" }, href: "file:///android_asset/index.html" });
    check("기본 주소 안드로이드", g.f.calls()[0] === ANDROID + "meta.json", canon(g.f.calls()));
    const h = await L1(null, { settings: undefined, href: "https://me.example/ev/index.html" });
    check("settings 없음", h.f.calls()[0] === "https://me.example/ev/relay/meta.json", canon(h.f.calls()));
    const ab = new Error("멈춤"); ab.name = "AbortError";
    const k = await L1({ "stations/41135.json": () => { throw ab; } }, { key: "K" });
    check("AbortError 그대로", k.x.err === ab && k.D.n === 0, res(k.x));
  }
  // 기준 12: 끔(C1)
  {
    const { f, D, x } = await L1(null, { settings: { on: false, base: B }, key: "K" });
    check("끔 키 있음", !x.err && canon(x.res) === canon(DIRECT_REG(D, "")) && x.res.stations === D.arr && f.calls().length === 0 && D.n === 1, res(x) + ` fetch ${f.calls().length} direct ${D.n}`);
    const y = await L1(null, { settings: { on: false, base: B }, key: "" });
    check("끔 키 없음", y.x.err && isRelayErr(y.x.err, "no_key").length === 0 && y.f.calls().length === 0 && y.D.n === 0, res(y.x));
    const z = await L1(null, { settings: { on: false, base: B }, key: "K", direct: undefined });
    check("끔 direct 없음", z.x.err && isRelayErr(z.x.err, "no_direct").length === 0 && z.f.calls().length === 0, res(z.x));
    const X = new Error("직접 실패"); X.code = "X";
    const thrower = async () => { throw X; };
    const a = await L1(null, { settings: { on: false, base: B }, key: "K", direct: thrower });
    check("direct 오류 그대로 끔", a.x.err === X, res(a.x));
    const b = await L1({ "meta.json": 404 }, { key: "K", direct: thrower });
    check("direct 오류 그대로 예비", b.x.err === X, res(b.x));
  }
  // 기준 13~15: refreshRegion
  async function R2(fx, extra, now) {
    const s0 = await L1();
    // loadRegion 이 없거나 실패해도 확인 이름은 모두 나오게 빈 시군구로 이어 간다
    const region = s0.x.res || { stations: [], zcodes: [], status_at: null };
    const s = setup(fx, Object.assign({ region, now: now === undefined ? NOW0 + 3 * MIN : now }, extra || {}));
    const before = JSON.stringify(region.stations), arr = region.stations;
    s.x = await RR(s.o);
    return Object.assign(s, { region, before, arr });
  }
  {
    const { f, x, D } = await R2();
    check("refresh 부른 주소", canon(rel(f)) === canon(["meta.json", "status/41135.json"]), canon(rel(f)));
    check("refresh 같은 파일", !x.err && canon(x.res) === canon({ changed: 0, status_at: T_META, source: "relay", failed: false, replaced: null, note: "" }) && D.n === 0, res(x));
    check("refresh fetch 둘째 인자", f.inits().every((i) => canon(i) === canon({ cache: "no-cache" })), canon(f.inits()));
  }
  {
    const { x, region, arr } = await R2({ "meta.json": META915(), "status/41135.json": STA914() });
    check("refresh 바뀜 3", !x.err && x.res.changed === 3 && x.res.status_at === T_915 && x.res.failed === false && x.res.note === "", res(x));
    check("refresh 바뀜 상태", stats(region.stations) === "charging,available / available" && region.stations === arr, stats(region.stations));
    check("refresh 바뀜 updated", region.stations.every((s) => s.updated === T_915), canon(region.stations.map((s) => s.updated)));
  }
  {
    const { x, region } = await R2({ "status/41135.json": { at: "20260105090000", s: {} } });
    check("refresh s 빈 객체", !x.err && x.res.changed === 2 && stats(region.stations) === CE + "," + CE + " / " + CE, res(x));
  }
  {
    const { x } = await R2(null, null, T_META + 18 * MIN);
    check("refresh 18분", !x.err && x.res.note === "18분 전 상태예요." && x.res.changed === 0, res(x));
    const y = (await R2({ "meta.json": Object.assign(META(), { ok: false, error: "한도 넘음" }) })).x;
    check("refresh meta 실패", !y.err && y.res.note === "중계가 마지막 받기에 실패했어요(한도 넘음)." && y.res.status_at === T_LIST && y.res.failed === false, res(y));
  }
  {
    // region.zcodes 로 보증을 본다(376행)
    const s0 = await L1();
    const region = Object.assign({ stations: [] }, s0.x.res, { zcodes: ["11"] });
    const s = setup(null, { region, now: NOW0 + 3 * MIN });
    const x = await RR(s.o);
    check("refresh region.zcodes", !x.err && x.res.status_at === T_LIST && region.stations.every((st) => st.updated === T_LIST), res(x));
  }
  // 기준 14: 실패·키 없음
  {
    const { x, region, before, arr, D } = await R2({ "meta.json": 404 });
    check("refresh 실패 키 없음", !x.err && canon(x.res) === canon({ changed: 0, status_at: T_META, source: "relay", failed: true, replaced: null, note: "중계에 파일이 없어요." }) && D.n === 0, res(x));
    check("refresh 실패 상태 그대로", JSON.stringify(region.stations) === before && region.stations === arr, stats(region.stations));
  }
  {
    const { x, region } = await R2({ "meta.json": 404 }, null, T_META + 31 * MIN);
    check("refresh 실패 31분", !x.err && x.res.changed === 1 && x.res.note === "중계에 파일이 없어요. 31분 전 상태라 빈자리를 세지 않았어요." && x.res.status_at === T_META && x.res.failed === true, res(x));
    check("refresh 실패 31분 상태", stats(region.stations) === CE + "," + CE + " / " + CE, stats(region.stations));
  }
  const RFAIL = [
    ["깨진 상태", { "status/41135.json": "{" }, {}, "중계 파일을 읽지 못했어요."],
    ["연결 실패", { "meta.json": T.DOWN }, {}, "중계에 연결하지 못했어요."],
    ["상태 503", { "status/41135.json": 503 }, {}, "중계가 503 로 답했어요."],
    ["상태 404", { "status/41135.json": 404 }, {}, "중계에 파일이 없어요."],
    ["zscode 틀림", null, { zscode: "4113" }, "중계 파일 이름이 맞지 않아요."],
    ["direct null", { "meta.json": 404 }, { key: "K", direct: null }, "중계에 파일이 없어요."],
  ];
  for (const [name, fx, extra, note] of RFAIL) {
    const { x, D } = await R2(fx, extra);
    check("refresh 실패 " + name, !x.err && x.res.note === note && x.res.failed === true && x.res.changed === 0 && x.res.source === "relay" && x.res.replaced === null && D.n === 0, res(x));
  }
  // 기준 15: 실패·키 있음
  {
    const { x, region, before, arr, D } = await R2({ "status/41135.json": 404 }, { key: "K" });
    const r = x.res || {};
    check("refresh 키 있음 결과", !x.err && canon(Object.assign({}, r, { replaced: 0 })) === canon({ changed: 0, status_at: null, source: "direct", failed: true, replaced: 0, note: FB }), res(x));
    check("refresh 키 있음 replaced", !x.err && canon(r.replaced) === canon(DIRECT_REG(D, FB)) && r.replaced.stations === D.arr, res(x));
    check("refresh 키 있음 region 그대로", region.stations === arr && JSON.stringify(region.stations) === before, stats(region.stations));
    check("refresh 키 있음 direct 1번", D.n === 1, `direct ${D.n}번`);
    const y = await R2({ "meta.json": 404 }, { key: "K" }, T_META + 31 * MIN);
    check("refresh 키 있음 31분 그대로", !y.x.err && y.region.stations === y.arr && JSON.stringify(y.region.stations) === y.before && y.x.res.changed === 0, res(y.x));
    const X = new Error("직접 실패"); X.code = "X";
    const z = await R2({ "meta.json": 404 }, { key: "K", direct: async () => { throw X; } });
    check("refresh direct 오류 그대로", z.x.err === X, res(z.x));
    const ab = new Error("멈춤"); ab.name = "AbortError";
    const w = await R2({ "meta.json": () => { throw ab; } }, { key: "K" });
    check("refresh AbortError 그대로", w.x.err === ab && w.D.n === 0, res(w.x));
  }
}
asyncPart().catch((e) => check("r5 시험 중 오류", false, e && e.stack)).then(() => T.finish());
