/*
 * r1_settings 시험(JS 쪽): web/relay.js 의 defaultBase·checkBase·loadSettings·saveOn·saveBase·baseOf
 * (plan.md 5절 r1_settings 195~233행, 3.1 상수 표, 3.2 '주소 검사' 글, 2.1 N8·N9, 2.2 D8).
 * test_r1_settings_relay.py 가 run_js 로 돌려 확인 하나를 pytest 테스트 하나로 보인다(C7).
 * relay.js 가 없거나 함수가 없어도 확인 이름은 모두 나온다(실패로).
 * 결과 객체는 열쇠 순서와 상관없이 견준다(열쇠를 정렬한 JSON 글자로).
 */
"use strict";
const T = require("./test_p0_fake.js");
const path = require("path");
const { check } = T;

let R = null, loadErr = "";
try { R = require(path.join(__dirname, "..", "web", "relay.js")); } catch (e) { loadErr = String(e && e.message).slice(0, 200); }

const ANDROID = "https://raw.githubusercontent.com/vicfos99-tech/ev-station-map/relay-data/";
const HTTPS = "주소는 https:// 로 시작해야 해요.";
const SHAPE = "주소 모양이 맞지 않아요. https://사이트/폴더/ 처럼 적어 주세요.";
const STORE = "이 화면에서는 저장되지 않습니다. 크롬이나 삼성 인터넷으로 열어 주세요.";
const KON = "ev-charge-planner/relay";
const KBASE = "ev-charge-planner/relay-base";
const C = String.fromCharCode;

// 열쇠를 정렬한 JSON 글자(undefined 는 글자 "undefined")
function canon(v) {
  if (v === undefined) return "undefined";
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
}
function same(name, got, want, input) {
  check(name, canon(got) === canon(want), `입력 ${canon(input)} → 받은 값 ${canon(got)} != 기대 ${canon(want)}`);
}
function fn(n) {
  if (!R || typeof R[n] !== "function") throw new Error(`relay.js 에 ${n} 함수가 없음 ${loadErr}`);
  return R[n];
}
// fn() 을 부르고 던지면 실패 확인으로 바꾼다(던지면 안 되는 함수들이다)
function run(name, f, want, input) {
  let got;
  try { got = f(); } catch (e) { check(name, false, `입력 ${canon(input)} 에서 던짐: ${e && e.name}: ${e && e.message}`); return undefined; }
  same(name, got, want, input);
  return got;
}
const num = (i) => String(i + 1).padStart(2, "0");

// ---------- 내보내는 이름 ----------
for (const n of ["defaultBase", "checkBase", "loadSettings", "saveOn", "saveBase", "baseOf"]) {
  check(`내보냄 ${n}`, !!R && typeof R[n] === "function", `relay.js 에 ${n} 함수가 없음 ${loadErr}`);
}

// ---------- defaultBase (195행, 204~211행 표, N9) ----------
const DEFAULT = [
  ["https://vicfos99-tech.github.io/ev-station-map/", ANDROID],
  ["https://vicfos99-tech.github.io/ev-station-map/index.html?x=1#h", ANDROID],
  ["https://a.example/ev", "https://a.example/relay/"],
  ["http://localhost:8000/web/index.html", "http://localhost:8000/web/relay/"],
  ["HTTPS://A.Example/x/", "https://a.example/x/relay/"],
  ["HTTP://A.Example/x/y.html", "http://a.example/x/relay/"],          // 대소문자 무관(http 도)
  ["https://a.example/", "https://a.example/relay/"],
  ["https://a.example/한글/i.html", "https://a.example/%ED%95%9C%EA%B8%80/relay/"],
  ["file:///android_asset/index.html", ANDROID],
  ["capacitor://localhost/", ANDROID],
  ["about:blank", ANDROID],
  ["", ANDROID],
  [null, ANDROID],
  [undefined, ANDROID],
  [3, ANDROID],
  ["https://", ANDROID],                                                // 풀 수 없는 주소
  ["http://", ANDROID],
  ["https://a.example:99999/", ANDROID],                               // 풀 수 없는 주소(포트)
  ["ftp://a.example/x/", ANDROID],
  ["javascript:alert(1)", ANDROID],
  [{}, ANDROID],                                                         // 글자가 아님
  [["https://a.example/"], ANDROID],                                    // 글자가 아님(배열을 글자로 바꾸지 않는다)
  [" https://a.example/x/", ANDROID],                                   // http(s):// 로 "시작"하지 않음(195행)
];
DEFAULT.forEach(([href, want], i) => run(`defaultBase ${num(i)}`, () => fn("defaultBase")(href), want, href));

// ---------- checkBase (196행, 213~224행 표, N8) ----------
const OKB = (base) => ({ ok: true, base });
const CHECK_OK = [
  ["", ""], ["   ", ""], [null, ""], [undefined, ""], ["\t\n ", ""],
  ["https://a.example/relay/", "https://a.example/relay/"],
  [" https://a.example/relay ", "https://a.example/relay/"],
  ["https://a.example", "https://a.example/"],
  ["HTTPS://A.Example/R/", "https://a.example/R/"],
  ["Https://a.example/r/", "https://a.example/r/"],
  ["https://a.example:8443/x/y", "https://a.example:8443/x/y/"],
  ["https://a.example/한글/", "https://a.example/%ED%95%9C%EA%B8%80/"],
  ["https://a.example/a/../b/", "https://a.example/b/"],
  ["https://a.example:443/r/", "https://a.example/r/"],                // URL 이 정리한 주소(기본 포트는 빠진다)
  ["\thttps://a.example/r/x.json\n", "https://a.example/r/x.json/"],    // 앞뒤 빈칸(탭·줄바꿈) 떼고 끝에 /
];
CHECK_OK.forEach(([t, b], i) => run(`checkBase 통과 ${num(i)}`, () => fn("checkBase")(t), OKB(b), t));

const BAD_HTTPS = [
  "http://a.example/relay/", "//a.example/relay/", "a.example/relay/", "javascript:alert(1)",
  "https:/a.example/", "ftp://a.example/", "HTTP://a.example/", " http://a.example/ ",
  "https//a.example/", "httpss://a.example/", "https:\\\\a.example\\",
];
BAD_HTTPS.forEach((t, i) => run(`checkBase https 거부 ${num(i)}`, () => fn("checkBase")(t), { ok: false, reason: HTTPS }, t));

const BAD_SHAPE = [
  "https://", "https://   ", "https://a.example/re lay/", "https://user:pw@a.example/", "https://user@a.example/",
  "https://a.example/?k=1", "https://a.example/?", "https://a.example/#x", "https://a.example/#",
  "https://a.example/<b>/", "https://a.example/\"x\"/", "https://a.example/'x'/", "https://a.example/`x`/",
  "https://a.example/a\\b/", "https://a.example/a" + C(9) + "b/", "https://a.example/a" + C(10) + "b/",
  "https://a.example/a" + C(1) + "b/", "https://a.example/a" + C(0x7f) + "b/", "https://a.example:99999/",
  "https://a.example/a@b/",                                             // 경로 안의 @ 도(196행: @ 가 있으면 모양 틀림)
  5, {}, [], true, false, 0, ["https://a.example/"],
];
BAD_SHAPE.forEach((t, i) => run(`checkBase 모양 거부 ${num(i)}`, () => fn("checkBase")(t), { ok: false, reason: SHAPE }, t));

// 까닭 글에 입력이 없다(227행, C3)
for (const [label, t] of [["http", "http://secret.example/KEY123"], ["모양", "https://secret.example/KEY123?k=KEY123"], ["골뱅이", "https://secret:KEY123@a.example/"]]) {
  let r;
  try { r = fn("checkBase")(t); } catch (e) { r = { reason: "던짐 " + e.message }; }
  const reason = String(r && r.reason);
  check(`checkBase 까닭에 입력 없음 ${label}`, r && r.ok === false && !reason.includes("secret") && !reason.includes("KEY123") && (reason === HTTPS || reason === SHAPE), canon(r));
}

// ---------- loadSettings (197행, 기준 3) ----------
const DEF = { on: true, base: "" };
const LOAD = [
  [{}, DEF],
  [{ [KON]: "off", [KBASE]: "https://a.example/r/" }, { on: false, base: "https://a.example/r/" }],
  [{ [KON]: "on", [KBASE]: "https://a.example/r/" }, { on: true, base: "https://a.example/r/" }],
  [{ [KON]: "OFF" }, DEF], [{ [KON]: "" }, DEF], [{ [KON]: "0" }, DEF], [{ [KON]: "false" }, DEF],
  [{ [KON]: " off" }, DEF], [{ [KON]: "off " }, DEF],
  [{ [KON]: "off" }, { on: false, base: "" }],
  [{ [KBASE]: "http://a.example/r/" }, DEF],
  [{ [KON]: "off", [KBASE]: "http://a.example/r/" }, { on: false, base: "" }],
  [{ [KBASE]: "https://a.example/?k=1" }, DEF],
  [{ [KBASE]: "javascript:alert(1)" }, DEF],
  [{ [KBASE]: "" }, DEF],
  [{ relay: "off", "relay-base": "https://a.example/r/" }, DEF],          // 열쇠는 D8 의 긴 이름
];
LOAD.forEach(([init, want], i) => {
  const s = T.makeStorage(init);
  run(`loadSettings ${num(i)}`, () => fn("loadSettings")(s), want, init);
  check(`loadSettings ${num(i)} 쓰지 않음`, s.log().length === 0, canon(s.log()));
});
run("loadSettings null", () => fn("loadSettings")(null), DEF, null);
run("loadSettings undefined", () => fn("loadSettings")(undefined), DEF, undefined);
run("loadSettings getItem 이 던짐", () => fn("loadSettings")(T.makeStorage({}, ["get"])), DEF, "get 실패");
run("loadSettings getItem 이 던짐(off 저장돼 있어도 기본값)", () => fn("loadSettings")(T.makeStorage({ [KON]: "off", [KBASE]: "https://a.example/r/" }, ["get"])), DEF, "get 실패");

// ---------- saveOn (198행, 기준 6) ----------
const ON = [[false, "off"], [true, "on"], [0, "off"], ["", "off"], [1, "on"], [null, "off"], [undefined, "off"], [NaN, "off"], ["off", "on"]];
ON.forEach(([v, want], i) => {
  const s = T.makeStorage({ [KBASE]: "https://keep.example/r/" });
  run(`saveOn ${num(i)} 돌려줌`, () => fn("saveOn")(s, v), true, v);
  same(`saveOn ${num(i)} 기록`, s.log(), [["set", KON, want]], v);
  same(`saveOn ${num(i)} relay-base 그대로`, s.dump()[KBASE], "https://keep.example/r/", v);
});
{
  const s = T.makeStorage({ [KON]: "on", [KBASE]: "https://keep.example/r/" }, ["set"]);
  run("saveOn set 이 던지면 false", () => fn("saveOn")(s, false), false, "set 실패");
  same("saveOn set 이 던지면 저장값 그대로", s.dump(), { [KON]: "on", [KBASE]: "https://keep.example/r/" }, "set 실패");
}
{
  const s = T.makeStorage({}, ["remove"]);
  run("saveOn remove 가 던지는 저장소도 됨", () => fn("saveOn")(s, false), true, "remove 실패");
}

// ---------- saveBase (199행, 기준 4·5·7) ----------
{
  const s = T.makeStorage({ [KBASE]: "https://good.example/r/" });
  run("saveBase http 거부", () => fn("saveBase")(s, "http://a.example/"), { ok: false, reason: HTTPS, base: null }, "http://a.example/");
  run("saveBase 모양 거부", () => fn("saveBase")(s, "https://a.example/?k=1"), { ok: false, reason: SHAPE, base: null }, "?k=1");
  run("saveBase 글자 아님 거부", () => fn("saveBase")(s, 5), { ok: false, reason: SHAPE, base: null }, 5);
  same("saveBase 거부는 저장소를 안 부름", s.log(), [], "거부 셋");
  same("saveBase 거부 뒤 전 주소 그대로", s.dump(), { [KBASE]: "https://good.example/r/" }, "거부 셋");
}
{
  // 저장소가 무엇이든 던지는데 입력이 틀리면 검사 까닭이 먼저(저장소를 부르지 않으므로)
  const s = T.makeStorage({}, ["get", "set", "remove"]);
  run("saveBase 거부가 저장 실패보다 먼저", () => fn("saveBase")(s, "http://a.example/"), { ok: false, reason: HTTPS, base: null }, "http + 모두 실패");
}
{
  const s = T.makeStorage({ [KON]: "off" });
  run("saveBase 좋은 주소", () => fn("saveBase")(s, " https://a.example/r "), { ok: true, reason: "", base: "https://a.example/r/" }, " https://a.example/r ");
  same("saveBase 좋은 주소 기록", s.log(), [["set", KBASE, "https://a.example/r/"]], "");
  run("saveBase 빈 글", () => fn("saveBase")(s, ""), { ok: true, reason: "", base: "" }, "");
  same("saveBase 빈 글 기록", s.log(), [["set", KBASE, "https://a.example/r/"], ["remove", KBASE]], "");
  same("saveBase relay 열쇠 그대로", s.dump(), { [KON]: "off" }, "");
}
for (const [label, t] of [["null", null], ["빈칸뿐", "   "], ["undefined", undefined]]) {
  const s = T.makeStorage({ [KBASE]: "https://old.example/r/" });
  run(`saveBase ${label} 은 지움`, () => fn("saveBase")(s, t), { ok: true, reason: "", base: "" }, t);
  same(`saveBase ${label} 기록`, s.log(), [["remove", KBASE]], t);
}
{
  const s = T.makeStorage({ [KBASE]: "https://old.example/r/" }, ["set"]);
  run("saveBase set 이 던짐", () => fn("saveBase")(s, "https://a.example/"), { ok: false, reason: STORE, base: null }, "set 실패");
  same("saveBase set 이 던지면 전 주소 그대로", s.dump(), { [KBASE]: "https://old.example/r/" }, "set 실패");
  run("saveBase set 이 던져도 빈 글은 remove 만 써서 됨", () => fn("saveBase")(s, ""), { ok: true, reason: "", base: "" }, "set 실패 + 빈 글");
}
{
  const s = T.makeStorage({ [KBASE]: "https://old.example/r/" }, ["remove"]);
  run("saveBase remove 가 던짐", () => fn("saveBase")(s, ""), { ok: false, reason: STORE, base: null }, "remove 실패");
  run("saveBase remove 가 던져도 좋은 주소는 set 만 써서 됨", () => fn("saveBase")(s, "https://a.example/q"), { ok: true, reason: "", base: "https://a.example/q/" }, "remove 실패 + 좋은 주소");
  same("saveBase remove 실패 저장소 기록", s.log(), [["set", KBASE, "https://a.example/q/"]], "");
}

// ---------- baseOf (200행, 기준 8) ----------
const BASEOF = [
  [{ on: true, base: "" }, "file:///x", ANDROID],
  [{ on: true, base: "https://b.example/r/" }, "https://a.example/p/", "https://b.example/r/"],
  [{ base: "https://b.example/r/" }, "https://a.example/p/", "https://b.example/r/"],
  [null, "https://a.example/p/i.html", "https://a.example/p/relay/"],
  [{ base: 5 }, "file:///x", ANDROID],
  [undefined, "https://a.example/p/", "https://a.example/p/relay/"],
  [{}, "file:///x", ANDROID],
  [{ on: false, base: "https://b.example/r/" }, "file:///x", "https://b.example/r/"],   // on 과 상관없이 주소만 고른다
  [{ base: "" }, "http://localhost:8000/web/", "http://localhost:8000/web/relay/"],
  [{ base: "https://b.example/r/" }, null, "https://b.example/r/"],
  [{ base: ["https://b.example/r/"] }, "file:///x", ANDROID],
  [{ base: null }, "https://a.example/", "https://a.example/relay/"],
];
BASEOF.forEach(([st, href, want], i) => run(`baseOf ${num(i)}`, () => fn("baseOf")(st, href), want, [st, href]));

T.finish();
