/*
 * r3_read 시험(JS 쪽): web/relay.js 의 urlOf·getJson·parseMeta·parseRoutes·parseStations·parseStatus·parseRest
 * (plan.md 5절 r3_read 287~323행, 3.2 글 표 129~133행, C3·C5·C6 107~113행, 2.2 D3·D4·D7).
 * test_r3_read_relay.py 가 run_js 로 돌려 확인 하나를 pytest 테스트 하나로 보인다(C7).
 * relay.js 가 없거나 함수가 없어도 확인 이름은 모두 나온다(실패로).
 * 견본은 ref/relay_sample/ 을 읽기만 한다(plan.md 21행). 기대값은 참조 구현으로 검산했다(.orchestra/logs/tests_r3_read.md).
 */
"use strict";
const T = require("./test_p0_fake.js");
const path = require("path");
const fs = require("fs");
const { check } = T;

let R = null, loadErr = "";
try { R = require(path.join(__dirname, "..", "web", "relay.js")); } catch (e) { loadErr = String(e && e.message).slice(0, 200); }

const FUNCS = ["urlOf", "getJson", "parseMeta", "parseRoutes", "parseStations", "parseStatus", "parseRest"];
const MSG = {
  bad_base: "중계 주소가 맞지 않아요", bad_id: "중계 파일 이름이 맞지 않아요", bad_kind: "모르는 중계 파일이에요",
  network: "중계에 연결하지 못했어요", missing: "중계에 파일이 없어요", shape: "중계 파일을 읽지 못했어요",
};
const J = (x) => JSON.parse(JSON.stringify(x));
const SAMPLE = (p) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "ref", "relay_sample", p), "utf8"));
const num = (i) => String(i + 1).padStart(2, "0");
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
// 오류의 모든 글(message·stack·String·자기 칸의 글자 값)
function errText(e) {
  if (!e || typeof e !== "object") return String(e);
  const own = Object.getOwnPropertyNames(e).map((k) => (typeof e[k] === "string" ? e[k] : ""));
  return [e.message, e.stack, String(e), ...own].join("\n");
}
// 던진 것이 RelayError(code) 이고 글이 3.2 표와 같고(msg 를 주면 그 글) 비밀 글자가 없는지
function isRelayErr(e, code, msg, secrets) {
  const RE = R && R.RelayError;
  const why = [];
  if (!(typeof RE === "function" && e instanceof RE)) why.push("RelayError 가 아님");
  if (!e || e.code !== code) why.push(`code ${e && e.code} != ${code}`);
  if (!e || e.message !== (msg || MSG[code])) why.push(`message ${JSON.stringify(e && e.message)}`);
  if (e && e.name !== "RelayError") why.push(`name ${e && e.name}`);
  const t = errText(e);
  for (const s of secrets || []) if (t.includes(s)) why.push(`글에 '${s}' 가 남음`);
  return why;
}
function rejSync(name, f, code, input, secrets) {
  let e = null;
  try { const got = f(); check(name, false, `던지지 않음: 입력 ${canon(input)} → ${canon(got)}`); return; } catch (x) { e = x; }
  const why = isRelayErr(e, code, null, secrets);
  check(name, why.length === 0, `입력 ${canon(input)}: ${why.join("; ")} (${e && e.name}: ${e && e.message})`);
}
function run(name, f, want, input) {
  let got;
  try { got = f(); } catch (e) { check(name, false, `입력 ${canon(input)} 에서 던짐: ${e && e.name}: ${e && e.message}`); return undefined; }
  check(name, canon(got) === canon(want), `입력 ${canon(input)} → 받은 값 ${canon(got)} != 기대 ${canon(want)}`);
  return got;
}
const tryCall = (f) => { try { return f(); } catch (e) { return undefined; } };
function deepFreeze(o) { if (o && typeof o === "object") { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; }

for (const n of FUNCS) check(`내보냄 ${n}`, !!R && typeof R[n] === "function", `relay.js 에 ${n} 함수가 없음 ${loadErr}`);

// ---------- urlOf (291행, 기준 1·2) ----------
const B = "https://a.example/relay/";
const X40 = "x".repeat(40);
const URL_OK = [
  [B, "meta", undefined, B + "meta.json"],
  [B, "routes", undefined, B + "routes.json"],
  [B, "stations", "41135", B + "stations/41135.json"],
  [B, "status", "41135", B + "status/41135.json"],
  [B, "rest", "KP000101", B + "status/rest/KP000101.json"],
  [B, "rest", "live-gb-down_1", B + "status/rest/live-gb-down_1.json"],
  [B, "rest", X40, B + `status/rest/${X40}.json`],
  ["http://localhost:8000/relay/", "meta", undefined, "http://localhost:8000/relay/meta.json"],
  ["http://localhost:8000/relay/", "status", "00000", "http://localhost:8000/relay/status/00000.json"],
  [B, "rest", "41135", B + "status/rest/41135.json"],
  [B, "rest", "a", B + "status/rest/a.json"],                 // 1자
  [B, "rest", "_-_", B + "status/rest/_-_.json"],
  [B, "meta", "../evil", B + "meta.json"],                   // meta·routes 는 id 를 쓰지 않는다(291행: id 규칙은 셋에만)
  ["https://b.example/x/y/", "routes", undefined, "https://b.example/x/y/routes.json"],
];
URL_OK.forEach(([b, k, id, want], i) => run(`urlOf 주소 ${num(i)}`, () => fn("urlOf")(b, k, id), want, [b, k, id]));

const BAD_ID = [
  ["stations", "4113"], ["stations", "411355"], ["stations", "4113a"], ["stations", 41135],
  ["status", "../41"], ["rest", ""], ["rest", "a/b"], ["rest", "a.b"], ["rest", ".."], ["rest", "a b"],
  ["rest", "가"], ["rest", "x".repeat(41)], ["rest", "KP000101\n"], ["rest", undefined],
  // 더한 사례: 앞뒤 빈칸·줄바꿈(정규식 닻)·배열(글자로 바꾸면 통과하는 값)·전각 숫자·없는 id·점 자리
  ["stations", " 41135"], ["stations", "41135 "], ["stations", "41135\n"], ["stations", ["41135"]],
  ["stations", "４１１３５"], ["stations", undefined], ["stations", null], ["status", "4113"],
  ["status", "KP000101"], ["status", 41135], ["status", ["41135"]], ["rest", ["KP000101"]],
  ["rest", null], ["rest", 101], ["rest", "KP000101.json"], ["rest", "a\\b"], ["rest", "a?b"], ["rest", "a#b"],
  ["rest", "a%2Fb"], ["rest", "\nKP000101"],
];
BAD_ID.forEach(([k, id], i) => rejSync(`urlOf bad_id ${num(i)}`, () => fn("urlOf")(B, k, id), "bad_id", [k, id]));

const BAD_KIND = ["meta.json", "Meta", "META", "status/rest", "rests", "", undefined, null, "toString", "constructor", "__proto__", "hasOwnProperty", "metaxjson"];
BAD_KIND.forEach((k, i) => rejSync(`urlOf bad_kind ${num(i)}`, () => fn("urlOf")(B, k, "41135"), "bad_kind", k));

const BAD_BASE = [
  "https://a.example/relay", "", null, "ftp://a.example/", undefined, 5, ["https://a.example/relay/"],
  "a.example/relay/", "//a.example/relay/", "https:/a.example/", "file:///relay/", "javascript://a.example/",
  "https://", "httpx://a.example/",
];
BAD_BASE.forEach((b, i) => rejSync(`urlOf bad_base ${num(i)}`, () => fn("urlOf")(b, "meta"), "bad_base", b));

// 검사 순서 base → kind → id (291행), 오류 글에 입력이 없다(C3)
rejSync("urlOf 순서 base 먼저", () => fn("urlOf")("nope", "meta.json", "../x"), "bad_base", "nope");
rejSync("urlOf 순서 kind 다음", () => fn("urlOf")(B, "meta.json", "../x"), "bad_kind", "meta.json");
rejSync("urlOf 누출 base", () => fn("urlOf")("https://secret-host.example/K9SECRET", "meta"), "bad_base", "base", ["secret-host", "K9SECRET"]);
rejSync("urlOf 누출 id", () => fn("urlOf")(B, "rest", "SECRETID/../x"), "bad_id", "id", ["SECRETID"]);
rejSync("urlOf 누출 kind", () => fn("urlOf")(B, "SECRETKIND", "41135"), "bad_kind", "kind", ["SECRETKIND"]);

// ---------- parseMeta (295~304행, 기준 4) ----------
const META = SAMPLE("meta.json");
const META_WANT = { v: 1, at: "20260105091000", ok: true, error: "", suspect: ["29"], fresh: ["41"] };
{
  const got = run("parseMeta 견본", () => fn("parseMeta")(J(META)), META_WANT, "meta.json");
  check("parseMeta 견본 열쇠", got !== undefined && canon(Object.keys(got).sort()) === canon(["at", "error", "fresh", "ok", "suspect", "v"]), canon(got));
}
const mm = (patch, del) => { const o = Object.assign(J(META), patch); (del || []).forEach((k) => delete o[k]); return o; };
const META_BAD = [
  mm({ v: 2 }), mm({ v: "1" }), mm({}, ["v"]), mm({ at: "2026" }), mm({}, ["at"]),
  mm({ ok: 1 }), mm({}, ["ok"]), mm({ ok: "true" }), null, [], "x", 1,
  // 더한 사례: 없는 날·숫자 시각·빈 글·ok null·0·v true·undefined
  mm({ at: "20260230091000" }), mm({ at: 20260105091000 }), mm({ at: "" }), mm({ ok: null }), mm({ ok: 0 }),
  mm({ v: true }), undefined, mm({ at: undefined }),
];
META_BAD.forEach((o, i) => rejSync(`parseMeta 거부 ${num(i)}`, () => fn("parseMeta")(o), "shape", o));
const mw = (patch) => Object.assign(J(META_WANT), patch);
const META_OK = [
  [mm({ at: null }), mw({ at: null })],
  [mm({ error: 5 }), mw({ error: "" })],
  [mm({ suspect: "29" }), mw({ suspect: [] })],
  [mm({ fresh: ["41", 11, null] }), mw({ fresh: ["41"] })],
  [mm({}, ["error", "suspect", "fresh"]), mw({ suspect: [], fresh: [] })],
  [mm({ ok: false, error: "상태 받기 실패" }), mw({ ok: false, error: "상태 받기 실패" })],
  [mm({ error: null, suspect: null, fresh: { 0: "41" } }), mw({ suspect: [], fresh: [] })],
  [mm({ suspect: [29, "29", "11", ["11"]], fresh: [] }), mw({ suspect: ["29", "11"], fresh: [] })],
  [mm({ ok: false, error: "serviceKey=abc" }), mw({ ok: false, error: "serviceKey=abc" })], // 가리기는 metaNote 의 일
  [mm({ evil: 1, kind: "x", nearby: [] }), META_WANT],
];
META_OK.forEach(([o, want], i) => run(`parseMeta 통과 ${num(i)}`, () => fn("parseMeta")(o), want, o));
rejSync("parseMeta 누출 없음", () => fn("parseMeta")(mm({ at: "SECRETAT" })), "shape", "at", ["SECRETAT"]);

// ---------- parseRoutes (306행, 기준 5) ----------
const ROUTES = SAMPLE("routes.json");
{
  const got = tryCall(() => fn("parseRoutes")(J(ROUTES)));
  check("parseRoutes 견본 routes 글자", got !== undefined && JSON.stringify(got.routes) === JSON.stringify(ROUTES.routes), got && JSON.stringify(got.routes).slice(0, 400));
  check("parseRoutes 견본 열쇠", got !== undefined && canon(Object.keys(got)) === canon(["v", "fetched_at", "source", "price_note", "routes", "skipped"]), canon(got && Object.keys(got)));
  check("parseRoutes 견본 머리", got !== undefined && canon([got.v, got.fetched_at, got.source, got.price_note, got.skipped]) === canon([1, ROUTES.fetched_at, ROUTES.source, ROUTES.price_note, ROUTES.skipped]), canon(got && [got.v, got.fetched_at, got.source]));
}
// d: 견본 복사본, r0·r1: 노선, a0·a1: 첫 휴게소, s0·s1: 첫 충전소, c0·c1: 첫 충전기
function rt(f) {
  const d = J(ROUTES);
  const r0 = d.routes[0], r1 = d.routes[1], a0 = r0.rest_areas[0], a1 = r1.rest_areas[0];
  const s0 = a0.stations[0], s1 = a1.stations[0];
  f({ d, r0, r1, a0, a1, s0, s1, c0: s0.chargers[0], c1: s1.chargers[0] });
  return d;
}
const ROUTES_BAD = [
  ["v 2", (x) => { x.d.v = 2; }], ["routes []", (x) => { x.d.routes = []; }], ["routes {}", (x) => { x.d.routes = {}; }],
  ["fetched_at 1 글자", (x) => { x.d.fetched_at = "1"; }], ["key 빈 글", (x) => { x.r1.key = ""; }],
  ["length -1", (x) => { x.r1.length = -1; }], ["rest_areas 없음", (x) => { delete x.r1.rest_areas; }],
  ["휴게소 id 없음", (x) => { delete x.a1.id; }], ["km 33.9 글자", (x) => { x.a0.km = "33.9"; }], ["km NaN", (x) => { x.a1.km = NaN; }],
  ["충전소 id 빈 글", (x) => { x.s1.id = ""; }], ["operator 숫자", (x) => { x.s1.operator = 5; }], ["price -1", (x) => { x.s1.price = -1; }],
  ["updated 없음", (x) => { delete x.s1.updated; }], ["chargers 없음", (x) => { delete x.s1.chargers; }],
  ["power_kw 0", (x) => { x.c1.power_kw = 0; }], ["power_kw 100 글자(둘째 충전기)", (x) => { x.s0.chargers[1].power_kw = "100"; }],
  // 더한 사례: 칸마다 그 칸만 틀림, 둘째 노선·둘째 충전기에 둔다(첫 항목만 보는 구현을 잡는다)
  ["v 1 글자", (x) => { x.d.v = "1"; }], ["fetched_at NaN", (x) => { x.d.fetched_at = NaN; }], ["fetched_at 없음", (x) => { delete x.d.fetched_at; }],
  ["routes 없음", (x) => { delete x.d.routes; }], ["노선 null", (x) => { x.d.routes[1] = null; }], ["key 없음", (x) => { delete x.r1.key; }],
  ["highway 숫자", (x) => { x.r1.highway = 5; }], ["direction 없음", (x) => { delete x.r1.direction; }],
  ["length 글자", (x) => { x.r1.length = "383"; }], ["length Infinity", (x) => { x.r1.length = Infinity; }],
  ["rest_areas 객체", (x) => { x.r1.rest_areas = {}; }], ["휴게소 null", (x) => { x.r1.rest_areas.push(null); }],
  ["휴게소 id 빈 글", (x) => { x.a1.id = ""; }], ["휴게소 name 없음", (x) => { delete x.a1.name; }], ["km 없음", (x) => { delete x.a1.km; }],
  ["stations 없음", (x) => { delete x.a1.stations; }], ["충전소 null", (x) => { x.a1.stations.push(null); }],
  ["충전소 id 없음", (x) => { delete x.s1.id; }], ["operator 없음", (x) => { delete x.s1.operator; }],
  ["price 글자", (x) => { x.s1.price = "391"; }], ["price NaN", (x) => { x.s1.price = NaN; }], ["updated 글자", (x) => { x.s1.updated = "1767571200000"; }],
  ["chargers 객체", (x) => { x.s1.chargers = {}; }], ["충전기 null", (x) => { x.s0.chargers[1] = null; }], ["충전기 글자", (x) => { x.s1.chargers.push("fast"); }],
  ["power_kw -100", (x) => { x.c1.power_kw = -100; }], ["power_kw Infinity", (x) => { x.c1.power_kw = Infinity; }], ["power_kw 없음", (x) => { delete x.c1.power_kw; }],
];
ROUTES_BAD.forEach(([label, f], i) => rejSync(`parseRoutes 거부 ${num(i)}`, () => fn("parseRoutes")(rt(f)), "shape", label));
rejSync("parseRoutes 거부 null", () => fn("parseRoutes")(null), "shape", null);
rejSync("parseRoutes 거부 배열", () => fn("parseRoutes")([J(ROUTES)]), "shape", "[견본]");

const NONE = "(칸 없음)";
const pick = (o, k) => (o && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : NONE);
// 결과에서 꺼내는 길: R0/R1 노선, A0/A1 휴게소, S0/S1 충전소, C0/C1 충전기
const G = {
  R1: (r) => r.routes[1], A0: (r) => r.routes[0].rest_areas[0], A1: (r) => r.routes[1].rest_areas[0],
  S1: (r) => r.routes[1].rest_areas[0].stations[0], C0: (r) => r.routes[0].rest_areas[0].stations[0].chargers[0],
  C1: (r) => r.routes[1].rest_areas[0].stations[0].chargers[0], S0: (r) => r.routes[0].rest_areas[0].stations[0],
};
const ROUTES_OK = [
  ["length 0", (x) => { x.r1.length = 0; }, "R1", "length", 0],
  ["rest_areas []", (x) => { x.r1.rest_areas = []; }, "R1", "rest_areas", []],
  ["휴게소 loc [37]", (x) => { x.a1.loc = [37]; }, "A1", "loc", NONE],
  ["휴게소 loc 없음", (x) => { delete x.a0.loc; }, "A0", "loc", NONE],
  ["operator 빈칸", (x) => { x.s1.operator = "  "; }, "S1", "operator", "알 수 없음"],
  ["operator 빈 글", (x) => { x.s1.operator = ""; }, "S1", "operator", "알 수 없음"],
  ["price 0", (x) => { x.s1.price = 0; }, "S1", "price", 0],
  ["chargers []", (x) => { x.s1.chargers = []; }, "S1", "chargers", []],
  ["type ultra", (x) => { x.c1.type = "ultra"; }, "C1", "type", "slow"],
  ["type 없음", (x) => { delete x.c1.type; }, "C1", "type", "slow"],
  ["type FAST", (x) => { x.c1.type = "FAST"; }, "C1", "type", "slow"],
  ["type slow", (x) => { x.c1.type = "slow"; }, "C1", "type", "slow"],
  ["status free", (x) => { x.c1.status = "free"; }, "C1", "status", "comm_error"],
  ["status 없음", (x) => { delete x.c1.status; }, "C1", "status", "comm_error"],
  ["status AVAILABLE", (x) => { x.c1.status = "AVAILABLE"; }, "C1", "status", "comm_error"],
  ["status 2(숫자 stat)", (x) => { x.c1.status = 2; }, "C1", "status", "comm_error"],
  ["status charging", (x) => { x.c1.status = "charging"; }, "C1", "status", "charging"],
  ["status out_of_service", (x) => { x.c1.status = "out_of_service"; }, "C1", "status", "out_of_service"],
  ["status maintenance", (x) => { x.c1.status = "maintenance"; }, "C1", "status", "maintenance"],
  ["status comm_error", (x) => { x.c1.status = "comm_error"; }, "C1", "status", "comm_error"],
  ["last_end x", (x) => { x.c1.last_end = "x"; }, "C1", "last_end", NONE],
  ["last_end 0", (x) => { x.c1.last_end = 0; }, "C1", "last_end", NONE],
  ["last_end -1", (x) => { x.c1.last_end = -1; }, "C1", "last_end", NONE],
  ["last_end Infinity", (x) => { x.c1.last_end = Infinity; }, "C1", "last_end", NONE],
  ["last_end 글자 숫자", (x) => { x.c1.last_end = "1767569400000"; }, "C1", "last_end", NONE],
  ["last_end 없음", (x) => { delete x.c1.last_end; }, "C1", "last_end", NONE],
  ["last_end 1", (x) => { x.c1.last_end = 1; }, "C1", "last_end", 1],
  ["maker 3", (x) => { x.s1.maker = 3; }, "S1", "maker", ""],
  ["maker 없음", (x) => { delete x.s1.maker; }, "S1", "maker", ""],
  ["충전소 loc [0,0]", (x) => { x.s1.loc = [0, 0]; }, "S1", "loc", NONE],
  ["충전소 loc 위도 91", (x) => { x.s1.loc = [91, 127]; }, "S1", "loc", NONE],
  ["충전소 loc 경도 181", (x) => { x.s1.loc = [37, 181]; }, "S1", "loc", NONE],
  ["충전소 loc 글자 경도", (x) => { x.s1.loc = [37, "127"]; }, "S1", "loc", NONE],
  ["충전소 loc NaN", (x) => { x.s1.loc = [NaN, 127]; }, "S1", "loc", NONE],
  ["충전소 loc 글자", (x) => { x.s1.loc = "37,127"; }, "S1", "loc", NONE],
  ["충전소 loc 끝값", (x) => { x.s1.loc = [-90, -180]; }, "S1", "loc", [-90, -180]],
  ["충전소 loc 위도 0", (x) => { x.s1.loc = [0, 127.5]; }, "S1", "loc", [0, 127.5]],
  ["live false", (x) => { x.r1.live = false; }, "R1", "live", true],
  ["live 없음", (x) => { delete x.r1.live; }, "R1", "live", true],
  ["노선 evil", (x) => { x.r1.evil = 1; }, "R1", "evil", NONE],
  ["충전기 kind", (x) => { x.c1.kind = "x"; }, "C1", "kind", NONE],
  ["충전기 id(옮기지 않음)", (x) => { x.c0.id = "01"; }, "C0", "id", NONE],
  ["휴게소 evil", (x) => { x.a1.evil = 1; }, "A1", "evil", NONE],
  ["충전소 evil", (x) => { x.s0.evil = "<b>"; }, "S0", "evil", NONE],
  ["휴게소 id 그대로", () => {}, "A1", "id", "live-gb-up-1"],
];
ROUTES_OK.forEach(([label, f, where, key, want], i) => run(`parseRoutes 통과 ${num(i)}`, () => pick(G[where](fn("parseRoutes")(rt(f))), key), want, label));
const ROUTES_TOP = [
  ["skipped []", (x) => { x.d.skipped = []; }, "skipped", {}],
  ["skipped null", (x) => { x.d.skipped = null; }, "skipped", {}],
  ["skipped 없음", (x) => { delete x.d.skipped; }, "skipped", {}],
  ["source 5", (x) => { x.d.source = 5; }, "source", ""],
  ["price_note 없음", (x) => { delete x.d.price_note; }, "price_note", ""],
  ["nearby 옮기지 않음", (x) => { x.d.nearby = [{ id: "a" }]; }, "nearby", NONE],
  ["v 그대로 1", () => {}, "v", 1],
];
ROUTES_TOP.forEach(([label, f, key, want], i) => run(`parseRoutes 머리 ${num(i)}`, () => pick(fn("parseRoutes")(rt(f)), key), want, label));
{
  // 모르는 칸이 결과 어디에도 없다
  const got = tryCall(() => fn("parseRoutes")(rt((x) => { x.d.evil = 1; x.r0.evil = 1; x.a0.evil = 1; x.s0.evil = 1; x.c0.evil = 1; x.c0.kind = "evil"; })));
  check("parseRoutes 모르는 칸 없음", got !== undefined && !JSON.stringify(got).includes("evil"), got && JSON.stringify(got).slice(0, 300));
}

// ---------- parseStations (308행, 기준 6) ----------
const ST = SAMPLE("stations/41135.json");
const ST_WANT = {
  v: 1, zscode: "41135", zcodes: ["41"], stations: [
    { id: "ME000201", name: "분당 지어낸 충전소", operator: "환경부", maker: "가나전기·마바전기", loc: [37.38012, 127.11854],
      chargers: [{ id: "01", type: "fast", kw: 50 }, { id: "02", type: "slow", kw: 7 }] },
    { id: "ME000202", name: "판교주차장", operator: "한국전력", maker: "가나전기", loc: [37.39471, 127.11112], indoor: true,
      chargers: [{ id: "01", type: "fast", kw: 350 }] },
  ],
};
run("parseStations 견본 41135", () => fn("parseStations")(J(ST), "41135"), ST_WANT, "41135");
{
  const g = tryCall(() => fn("parseStations")(SAMPLE("stations/41463.json"), "41463"));
  check("parseStations 견본 41463 rest", g !== undefined && g.stations.length === 2 && g.stations.every((s) => s.rest === true && !("indoor" in s)), canon(g));
}
function sx(f) { const d = J(ST); const s0 = d.stations[0], s1 = d.stations[1]; f({ d, s0, s1, c0: s0.chargers[0], c1: s1.chargers[0] }); return d; }
const ST_BAD = [
  ["zscode 인자 41463", (x) => {}, "41463"], ["v 없음", (x) => { delete x.d.v; }], ["loc 없음", (x) => { delete x.s1.loc; }],
  ["글자 좌표", (x) => { x.s1.loc = ["37.39471", "127.11112"]; }], ["id 빈 글", (x) => { x.s1.id = ""; }],
  ["충전기 id 숫자", (x) => { x.c1.id = 1; }], ["kw 0", (x) => { x.c1.kw = 0; }], ["stations {}", (x) => { x.d.stations = {}; }],
  ["충전소 null", (x) => { x.d.stations[1] = null; }],
  // 더한 사례(둘째 충전소·둘째 충전기에)
  ["zscode 인자 숫자", (x) => {}, 41135], ["zscode 인자 없음", (x) => {}, undefined],
  ["둘 다 zscode 없음", (x) => { delete x.d.zscode; }, undefined], ["v 2", (x) => { x.d.v = 2; }],
  ["loc [0,0]", (x) => { x.s1.loc = [0, 0]; }], ["loc 경도 200", (x) => { x.s1.loc = [37, 200]; }], ["loc [37]", (x) => { x.s1.loc = [37]; }],
  ["id 숫자", (x) => { x.s1.id = 7; }], ["id 없음", (x) => { delete x.s1.id; }],
  ["chargers 없음", (x) => { delete x.s1.chargers; }], ["chargers 객체", (x) => { x.s1.chargers = {}; }],
  ["충전기 null", (x) => { x.s0.chargers[1] = null; }], ["충전기 id 없음", (x) => { delete x.s0.chargers[1].id; }],
  ["kw 글자", (x) => { x.s0.chargers[1].kw = "7"; }], ["kw 음수", (x) => { x.c1.kw = -1; }], ["kw NaN", (x) => { x.c1.kw = NaN; }],
  ["kw 없음", (x) => { delete x.c1.kw; }], ["stations 없음", (x) => { delete x.d.stations; }], ["충전소 글자", (x) => { x.d.stations.push("x"); }],
];
ST_BAD.forEach(([label, f, z], i) => {
  const zz = ST_BAD[i].length > 2 ? z : "41135";
  rejSync(`parseStations 거부 ${num(i)}`, () => fn("parseStations")(sx(f), zz), "shape", label);
});
rejSync("parseStations 거부 null", () => fn("parseStations")(null, "41135"), "shape", null);
rejSync("parseStations 거부 배열", () => fn("parseStations")([J(ST)], "41135"), "shape", "[견본]");
const S1P = (r) => r.stations[1];
const ST_OK = [
  ["zcodes 없음", (x) => { delete x.d.zcodes; }, (r) => r.zcodes, []],
  ["zcodes 글자", (x) => { x.d.zcodes = "41"; }, (r) => r.zcodes, []],
  ["zcodes 섞임", (x) => { x.d.zcodes = ["41", 41, null, "11"]; }, (r) => r.zcodes, ["41", "11"]],
  ["name 없음", (x) => { delete x.s1.name; }, (r) => S1P(r).name, ""],
  ["name 앞뒤 빈칸", (x) => { x.s1.name = "  판교  "; }, (r) => S1P(r).name, "판교"],
  ["name 숫자", (x) => { x.s1.name = 5; }, (r) => S1P(r).name, ""],
  ["operator 없음", (x) => { delete x.s1.operator; }, (r) => S1P(r).operator, "알 수 없음"],
  ["operator 빈칸", (x) => { x.s1.operator = "   "; }, (r) => S1P(r).operator, "알 수 없음"],
  ["operator 숫자", (x) => { x.s1.operator = 3; }, (r) => S1P(r).operator, "알 수 없음"],
  ["maker 3", (x) => { x.s1.maker = 3; }, (r) => S1P(r).maker, ""],
  ["type x", (x) => { x.c1.type = "x"; }, (r) => S1P(r).chargers[0].type, "slow"],
  ["type 없음", (x) => { delete x.c1.type; }, (r) => S1P(r).chargers[0].type, "slow"],
  ["indoor 글자 true", (x) => { x.s1.indoor = "true"; }, (r) => pick(S1P(r), "indoor"), NONE],
  ["indoor 1", (x) => { x.s1.indoor = 1; }, (r) => pick(S1P(r), "indoor"), NONE],
  ["indoor false", (x) => { x.s1.indoor = false; }, (r) => pick(S1P(r), "indoor"), NONE],
  ["rest true", (x) => { x.s1.rest = true; }, (r) => pick(S1P(r), "rest"), true],
  ["rest 글자", (x) => { x.s1.rest = "true"; }, (r) => pick(S1P(r), "rest"), NONE],
  ["모르는 칸", (x) => { x.s1.addr = "주소"; x.s1.evil = 1; x.c1.stat = "2"; x.d.evil = 1; }, (r) => [Object.keys(S1P(r)).sort(), Object.keys(S1P(r).chargers[0]).sort(), pick(r, "evil")],
    [["chargers", "id", "indoor", "loc", "maker", "name", "operator"], ["id", "kw", "type"], NONE]],
  ["stations []", (x) => { x.d.stations = []; }, (r) => r.stations, []],
  ["chargers []", (x) => { x.s1.chargers = []; }, (r) => S1P(r).chargers, []],
  ["좌표 끝값", (x) => { x.s1.loc = [-90, 180]; }, (r) => S1P(r).loc, [-90, 180]],
];
ST_OK.forEach(([label, f, g, want], i) => run(`parseStations 통과 ${num(i)}`, () => g(fn("parseStations")(sx(f), "41135")), want, label));

// ---------- parseStatus (310행, 기준 7) ----------
const SS = SAMPLE("status/41135.json");
const SS_WANT = { at: "20260105090000", s: { ME000201: { "01": "2", "02": "3" }, ME000202: { "01": "9" } } };
run("parseStatus 견본", () => fn("parseStatus")(J(SS)), SS_WANT, "status/41135.json");
function ssx(f) { const d = J(SS); f(d); return d; }
const SS_BAD = [
  (d) => { d.v = 2; }, (d) => { delete d.at; }, (d) => { d.at = "20260230000000"; }, (d) => { d.s = []; }, (d) => { delete d.s; },
  (d) => { d.v = "1"; }, (d) => { d.v = null; }, (d) => { d.at = 20260105090000; }, (d) => { d.at = null; }, (d) => { d.s = null; }, (d) => { d.s = "x"; },
];
SS_BAD.forEach((f, i) => rejSync(`parseStatus 거부 ${num(i)}`, () => fn("parseStatus")(ssx(f)), "shape", f.toString()));
[null, [], "x", 1].forEach((o, i) => rejSync(`parseStatus 거부 통째 ${num(i)}`, () => fn("parseStatus")(o), "shape", o));
const SS_OK = [
  [(d) => { d.v = 1; }, SS_WANT],
  [(d) => { d.s.ME000201 = ["2"]; }, { at: SS_WANT.at, s: { ME000202: { "01": "9" } } }],
  [(d) => { d.s.ME000201 = null; }, { at: SS_WANT.at, s: { ME000202: { "01": "9" } } }],
  [(d) => { d.s.ME000202 = "x"; }, { at: SS_WANT.at, s: { ME000201: { "01": "2", "02": "3" } } }],
  [(d) => { d.s.ME000201["01"] = "2"; }, { at: SS_WANT.at, s: { ME000201: { "01": "9", "02": "3" }, ME000202: { "01": "9" } } }],
  [(d) => { d.s.ME000201["01"] = [2, null, null]; }, { at: SS_WANT.at, s: { ME000201: { "01": "9", "02": "3" }, ME000202: { "01": "9" } } }],
  [(d) => { d.s.ME000201["02"] = []; }, { at: SS_WANT.at, s: { ME000201: { "01": "2", "02": "9" }, ME000202: { "01": "9" } } }],
  [(d) => { d.s.ME000201["02"] = null; }, { at: SS_WANT.at, s: { ME000201: { "01": "2", "02": "9" }, ME000202: { "01": "9" } } }],
  [(d) => { d.s.ME000201["02"] = { 0: "3" }; }, { at: SS_WANT.at, s: { ME000201: { "01": "2", "02": "9" }, ME000202: { "01": "9" } } }],
  [(d) => { d.s.ME000202["01"] = ["4"]; }, { at: SS_WANT.at, s: { ME000201: { "01": "2", "02": "3" }, ME000202: { "01": "4" } } }],
  [(d) => { d.s = {}; }, { at: SS_WANT.at, s: {} }],
  [(d) => { d.evil = 1; d.v = 1; }, SS_WANT],
];
SS_OK.forEach(([f, want], i) => run(`parseStatus 통과 ${num(i)}`, () => fn("parseStatus")(ssx(f)), want, f.toString()));
{
  const o = JSON.parse('{"at":"20260105090000","s":{"__proto__":{"01":["2"]},"constructor":{"01":["2"]}}}');
  const g = tryCall(() => fn("parseStatus")(o));
  const s = g && g.s;
  check("parseStatus 열쇠 __proto__", !!s && canon(Object.keys(s)) === canon(["__proto__", "constructor"]), canon(s && Object.keys(s)));
  check("parseStatus 프로토타입 없음", !!s && Object.getPrototypeOf(s) === null, "Object.getPrototypeOf(결과.s) 가 null 이 아님");
  const d = s && Object.getOwnPropertyDescriptor(s, "__proto__");
  check("parseStatus __proto__ 값", !!d && d.value && d.value["01"] === "2", canon(d && d.value));
  check("parseStatus 오염 없음", ({})["01"] === undefined && Object.prototype["01"] === undefined, "Object.prototype 에 01 이 생김");
}

// ---------- parseRest (312행, 기준 8) ----------
const RS = SAMPLE("status/rest/KP000101.json");
const T_LAST = 1767569400000;
const RS_WANT = { rest: "KP000101", at: "20260105090500", chargers: [{ id: "01", stat: "3", last_end: T_LAST }, { id: "02", stat: "3", last_end: T_LAST }] };
run("parseRest 견본 KP000101", () => fn("parseRest")(J(RS), "KP000101"), RS_WANT, "KP000101");
run("parseRest 견본 KP000102", () => fn("parseRest")(SAMPLE("status/rest/KP000102.json"), "KP000102"),
  { rest: "KP000102", at: "20260105090000", chargers: [{ id: "01", stat: "2", last_end: T_LAST }] }, "KP000102");
function rsx(f) { const d = J(RS); f(d, d.chargers[0], d.chargers[1]); return d; }
const RS_BAD = [
  ["id 인자 KP000102", () => {}, "KP000102"], ["rest 없음", (d) => { delete d.rest; }], ["at 1", (d) => { d.at = 1; }],
  ["chargers {}", (d) => { d.chargers = {}; }], ["항목 null", (d) => { d.chargers[1] = null; }], ["v 2", (d) => { d.v = 2; }],
  ["둘 다 없음", (d) => { delete d.rest; }, undefined], ["at 없음", (d) => { delete d.at; }], ["at 없는 날", (d) => { d.at = "20260230090500"; }],
  ["chargers 없음", (d) => { delete d.chargers; }], ["항목 글자", (d) => { d.chargers.push("01"); }], ["항목 배열", (d) => { d.chargers.push(["01", "2"]); }],
  ["v 1 글자", (d) => { d.v = "1"; }], ["id 인자 소문자", () => {}, "kp000101"],
];
RS_BAD.forEach(([label, f, id], i) => rejSync(`parseRest 거부 ${num(i)}`, () => fn("parseRest")(rsx(f), RS_BAD[i].length > 2 ? id : "KP000101"), "shape", label));
[null, [], "x"].forEach((o, i) => rejSync(`parseRest 거부 통째 ${num(i)}`, () => fn("parseRest")(o, "KP000101"), "shape", o));
const rw = (chargers) => ({ rest: "KP000101", at: "20260105090500", chargers });
const C01 = { id: "01", stat: "3", last_end: T_LAST }, C02 = { id: "02", stat: "3", last_end: T_LAST };
const RS_OK = [
  ["v 1", (d) => { d.v = 1; }, RS_WANT],
  ["chargers []", (d) => { d.chargers = []; }, rw([])],
  ["stat 숫자", (d, a) => { a.stat = 2; }, rw([{ id: "01", stat: "9", last_end: T_LAST }, C02])],
  ["stat null", (d, a, b) => { b.stat = null; }, rw([C01, { id: "02", stat: "9", last_end: T_LAST }])],
  ["stat 없음", (d, a, b) => { delete b.stat; }, rw([C01, { id: "02", stat: "9", last_end: T_LAST }])],
  ["chgerId 없음", (d, a, b) => { delete b.chgerId; }, rw([{ id: "", stat: "3", last_end: T_LAST }, C01])],
  ["chgerId 숫자", (d, a, b) => { b.chgerId = 2; }, rw([{ id: "", stat: "3", last_end: T_LAST }, C01])],
  ["lastTedt x", (d, a, b) => { b.lastTedt = "x"; }, rw([C01, { id: "02", stat: "3", last_end: null }])],
  ["lastTedt 없음", (d, a) => { delete a.lastTedt; }, rw([{ id: "01", stat: "3", last_end: null }, C02])],
  ["lastTedt 없는 날", (d, a) => { a.lastTedt = "20260230083000"; }, rw([{ id: "01", stat: "3", last_end: null }, C02])],
  ["lastTedt 밀리초 숫자", (d, a) => { a.lastTedt = T_LAST; }, rw([{ id: "01", stat: "3", last_end: null }, C02])],
  ["항목 뒤집음", (d) => { d.chargers.reverse(); }, RS_WANT],
  ["id 글자 순(수 순 아님)", (d) => {
    d.chargers = [{ chgerId: "10", stat: "4", lastTedt: "20260105080000" }, { chgerId: "02", stat: "2", lastTedt: "20260105083000" }, { chgerId: "1", stat: "5" }];
  }, rw([{ id: "02", stat: "2", last_end: T_LAST }, { id: "1", stat: "5", last_end: null }, { id: "10", stat: "4", last_end: 1767567600000 }])],
  ["모르는 칸", (d) => { d.evil = 1; d.statId = "x"; }, RS_WANT],
];
RS_OK.forEach(([label, f, want], i) => run(`parseRest 통과 ${num(i)}`, () => fn("parseRest")(rsx(f), "KP000101"), want, label));

// ---------- 받은 객체를 고치지 않는다·새 객체를 준다 (293행, 기준 9, C5) ----------
// 정리할 거리가 있는 입력(빈칸 operator·live false·뒤집힌 항목 등)으로 본다: 그 자리에서 고치는 구현을 잡는다
const MESSY = {
  parseMeta: [() => mm({ fresh: ["41", 11, null], suspect: "29", error: 5 })],
  parseRoutes: [() => rt((x) => { x.s1.operator = "  "; x.r1.live = false; x.c1.status = "free"; x.c1.type = "ultra"; x.c1.last_end = "x"; x.s1.loc = [0, 0]; x.r0.evil = 1; x.d.skipped = []; x.d.source = 5; })],
  parseStations: [() => sx((x) => { x.s1.name = "  판교 "; x.s1.indoor = "true"; x.d.zcodes = ["41", 5]; x.s1.operator = " "; x.c1.type = "x"; x.s1.addr = "a"; }), "41135"],
  parseStatus: [() => ssx((d) => { d.s.ME000201["01"] = "2"; d.s.ME000202 = ["9"]; d.evil = 1; })],
  parseRest: [() => rsx((d, a, b) => { d.chargers.reverse(); b.stat = 3; d.statId = "x"; }), "KP000101"],
};
for (const name of Object.keys(MESSY)) {
  const [mk, arg] = MESSY[name];
  const o = mk(), before = JSON.stringify(o);
  const got = tryCall(() => fn(name)(o, arg));
  check(`입력 그대로 ${name}`, got !== undefined && JSON.stringify(o) === before, got === undefined ? "던짐" : JSON.stringify(o).slice(0, 300));
  check(`새 객체 ${name}`, got !== undefined && got !== o, "받은 객체를 그대로 돌려줌");
  const fz = deepFreeze(mk());
  const g2 = tryCall(() => fn(name)(fz, arg));
  check(`얼린 입력 ${name}`, got !== undefined && canon(g2) === canon(got), `얼린 입력에서 던지거나 결과가 다름: ${canon(g2).slice(0, 200)}`);
}
{
  // 결과를 고쳐도 받은 객체가 바뀌지 않는다(뒤 부분 expire 가 결과 충전기의 status 를 그 자리에서 바꾼다, 330행)
  const o1 = J(ROUTES), b1 = JSON.stringify(o1), g1 = tryCall(() => fn("parseRoutes")(o1));
  if (g1) { g1.routes[0].rest_areas[0].stations[0].chargers[0].status = "comm_error"; g1.routes[0].rest_areas[0].stations[0].operator = "x"; g1.routes[1].rest_areas.push({}); }
  check("결과 따로 parseRoutes", !!g1 && JSON.stringify(o1) === b1, "결과를 고치니 받은 객체가 바뀜");
  const o2 = J(META), b2 = JSON.stringify(o2), g2 = tryCall(() => fn("parseMeta")(o2));
  if (g2) { g2.fresh.push("11"); g2.suspect.length = 0; }
  check("결과 따로 parseMeta", !!g2 && JSON.stringify(o2) === b2, "결과를 고치니 받은 객체가 바뀜");
  const o3 = J(ST), b3 = JSON.stringify(o3), g3 = tryCall(() => fn("parseStations")(o3, "41135"));
  if (g3) { g3.stations[0].chargers[0].kw = 1; g3.stations[0].name = "x"; g3.stations.pop(); }
  check("결과 따로 parseStations", !!g3 && JSON.stringify(o3) === b3, "결과를 고치니 받은 객체가 바뀜");
  const o4 = J(RS), b4 = JSON.stringify(o4), g4 = tryCall(() => fn("parseRest")(o4, "KP000101"));
  if (g4) { g4.chargers[0].stat = "9"; g4.chargers.reverse(); }
  check("결과 따로 parseRest", !!g4 && JSON.stringify(o4) === b4, "결과를 고치니 받은 객체가 바뀜");
}

// ---------- getJson (292행, 기준 3, D7, N10, C3) ----------
const URL0 = "https://relay-host.example/relay/meta.json";
const LEAKS = ["relay-host", "SECRET", "x.example", "K9KEY"];
// 고정 답을 주는 가짜 fetch
function fixed(resp) {
  const calls = [];
  const f = async (u, init) => { calls.push([u, init]); return typeof resp === "function" ? resp() : resp; };
  f.calls = () => calls.slice();
  return f;
}
const textOf = (s) => async () => s;
async function rejA(name, f, code, msg) {
  let e = null;
  try { const got = await f(); check(name, false, `던지지 않음: ${canon(got)}`); return null; } catch (x) { e = x; }
  const why = isRelayErr(e, code, msg, LEAKS);
  if (e && e.cause !== undefined) why.push("cause 가 있음");
  check(name, why.length === 0, `${why.join("; ")} (${e && e.name}: ${e && e.message})`);
  return e;
}
const gj = (fetchFn, url) => fn("getJson")(url || URL0, { fetch: fetchFn });

async function asyncPart() {
  {
    const f = T.makeFetch({ "meta.json": META }, { base: "https://relay-host.example/relay/" });
    let got, err = "";
    try { got = await gj(f); } catch (e) { err = `${e && e.name}: ${e && e.message}`; }
    check("getJson 좋은 답", canon(got) === canon(META), `받은 값 ${canon(got)} ${err}`);
    check("getJson fetch 한 번·주소 그대로", canon(f.calls()) === canon([URL0]), canon(f.calls()));
    check("getJson 둘째 인자", canon(f.inits()) === canon([{ cache: "no-cache" }]), canon(f.inits()));
  }
  {
    const f = fixed({ ok: true, status: 200, text: textOf('{"v":1,"a":[1,"가"]}') });
    let got; try { got = await gj(f, "https://b.example/r/routes.json"); } catch (e) { got = e && e.message; }
    check("getJson 받은 글을 그대로 풂", canon(got) === canon({ v: 1, a: [1, "가"] }), canon(got));
    check("getJson 주소 그대로 2", f.calls().length === 1 && f.calls()[0][0] === "https://b.example/r/routes.json", canon(f.calls()));
  }
  const CASES = [
    // [이름, fetch, code, 글(없으면 3.2 표), 부른 수]
    ["404", T.makeFetch({}), "missing", null, 1],
    ["503", T.makeFetch({ [URL0]: 503 }), "http", "중계가 503 로 답했어요", 1],
    ["304", T.makeFetch({ [URL0]: 304 }), "http", "중계가 304 로 답했어요", 1],
    ["500", T.makeFetch({ [URL0]: 500 }), "http", "중계가 500 로 답했어요", 1],
    ["403", T.makeFetch({ [URL0]: 403 }), "http", "중계가 403 로 답했어요", 1],
    ["연결 실패", T.makeFetch({ [URL0]: T.DOWN }), "network", null, 1],
    ["SECRET html", T.makeFetch({ [URL0]: "<html>SECRET https://x.example/</html>" }), "shape", null, 1],
    ["빈 글", T.makeFetch({ [URL0]: "" }), "shape", null, 1],
    ["빈칸 글", fixed({ ok: true, status: 200, text: textOf("  \n") }), "shape", null, 1],
    ["반쪽 JSON", fixed({ ok: true, status: 200, text: textOf('{"v":1,"SECRET":"x.example"') }), "shape", null, 1],
    ["ok false status 없음", fixed({ ok: false }), "http", "중계가 0 로 답했어요", 1],
    ["답 null", fixed(null), "http", "중계가 0 로 답했어요", 1],
    ["답 undefined", fixed(undefined), "http", "중계가 0 로 답했어요", 1],
    ["status 글자 404", fixed({ ok: false, status: "404" }), "http", "중계가 0 로 답했어요", 1],
    ["status 소수", fixed({ ok: false, status: 503.5 }), "http", "중계가 0 로 답했어요", 1],
    ["ok false status 200", fixed({ ok: false, status: 200, text: textOf("{}") }), "http", "중계가 200 로 답했어요", 1],
    ["ok false status 404", fixed({ ok: false, status: 404 }), "missing", null, 1],
    ["text 던짐", fixed({ ok: true, status: 200, text: async () => { throw new Error("SECRET x.example"); } }), "network", null, 1],
    ["거절 Error", fixed(() => Promise.reject(new Error("SECRET https://x.example/ K9KEY"))), "network", null, 1],
    ["거절 null", fixed(() => Promise.reject(null)), "network", null, 1],
    ["거절 글자", fixed(() => Promise.reject("SECRET")), "network", null, 1],
  ];
  for (const [label, f, code, msg, n] of CASES) {
    const nm = `getJson ${label}`;
    await rejA(nm, () => gj(f), code, msg);
    const c = f.calls();
    check(`${nm} 부른 수`, c.length === n, `fetch 를 ${c.length}번 부름`);
  }
  {
    // 주소에 키가 있어도 오류 글에 없다(C3)
    const url = "https://relay-host.example/relay/meta.json?serviceKey=K9KEY";
    const LEAK_CASES = [["404", 404, "missing", null], ["503", 503, "http", "중계가 503 로 답했어요"], ["연결 실패", T.DOWN, "network", null], ["모양", "SECRET", "shape", null]];
    for (const [label, v, code, msg] of LEAK_CASES) await rejA(`getJson 주소 누출 ${label}`, () => gj(T.makeFetch({ [url]: v }), url), code, msg);
  }
  for (const [label, mk] of [
    ["DOMException", () => new DOMException("SECRET 멈춤", "AbortError")],
    ["Error 이름", () => { const e = new Error("멈춤"); e.name = "AbortError"; return e; }],
  ]) {
    const ab = mk();
    const f = fixed(() => Promise.reject(ab));
    let e = null;
    try { await gj(f); } catch (x) { e = x; }
    const RE = R && R.RelayError;
    check(`getJson AbortError ${label}`, e === ab && !(typeof RE === "function" && e instanceof RE), `받은 것: ${e && e.name}/${e && e.code}/${e && e.message}`);
    check(`getJson AbortError ${label} 부른 수`, f.calls().length === 1, `fetch 를 ${f.calls().length}번 부름`);
  }
}

asyncPart().catch((e) => check("getJson 시험 중 오류", false, e && e.stack)).then(() => T.finish());
