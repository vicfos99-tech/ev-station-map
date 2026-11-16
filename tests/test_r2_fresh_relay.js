/*
 * r2_fresh 시험(JS 쪽): web/relay.js 의 kstMs·trustAt·ageMs·level·staleNote·cleanText·metaNote
 * (plan.md 5절 r2_fresh 235~285행, 2.1 N1, 2.2 D1·D2, 3.1 NOTE_MIN·DROP_MIN·FUTURE_MIN, 3.2 '오래됨'·'중계 실패 까닭' 글, C2·C3).
 * test_r2_fresh_relay.py 가 run_js 로 돌려 확인 하나를 pytest 테스트 하나로 보인다(C7).
 * relay.js 가 없거나 함수가 없어도 확인 이름은 모두 나온다(실패로).
 *
 * 시간대: 이 파일은 맨 앞에서 process.env.TZ 를 미국 서부로 둔다. kstMs 는 "한국 시각 14자리"를 읽는 함수라
 * 폰·PC 의 시간대와 상관없이 같은 밀리초를 내야 한다(이 PC 는 한국 시간대라 지역 시각으로 푸는 구현이
 * 그냥 돌리면 통과해 버린다). 한국·UTC 시간대에서도 같은 값인지 따로 본다('kstMs 시간대').
 */
"use strict";
process.env.TZ = "America/Los_Angeles";
const T = require("./test_p0_fake.js");
const path = require("path");
const { check } = T;

let R = null, loadErr = "";
try { R = require(path.join(__dirname, "..", "web", "relay.js")); } catch (e) { loadErr = String(e && e.message).slice(0, 200); }

const C = String.fromCharCode;
const UNKNOWN = "상태 시각을 알 수 없어 빈자리를 세지 않았어요.";
const FAIL = "중계가 마지막 받기에 실패했어요";
const NAMES = ["kstMs", "trustAt", "ageMs", "level", "staleNote", "cleanText", "metaNote"];

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
// 던지면 실패 확인(모두 던지면 안 되는 함수다). 결과는 열쇠 순서와 상관없이 견준다.
function run(name, f, want, input) {
  let got;
  try { got = f(); } catch (e) { check(name, false, `입력 ${canon(input)} 에서 던짐: ${e && e.name}: ${e && e.message}`); return undefined; }
  check(name, canon(got) === canon(want), `입력 ${canon(input)} → 받은 값 ${canon(got)} != 기대 ${canon(want)}`);
  return got;
}
const num = (i) => String(i + 1).padStart(2, "0");

// ---------- 내보내는 이름 ----------
for (const n of NAMES) check(`내보냄 ${n}`, !!R && typeof R[n] === "function", `relay.js 에 ${n} 함수가 없음 ${loadErr}`);

// ---------- kstMs (239행, 249~252행 표) ----------
// 값은 참조 구현(.orchestra/logs/ref_relay/relay.js)으로 검산했다. 앞 넷이 계획서 표, 나머지는 경계(2000년·윤년·말일·23시·59초).
const KST_OK = [
  ["20260105090000", 1767571200000], ["20260105091000", 1767571800000],
  ["20260105000000", 1767538800000], ["20240229120000", 1709175600000],
  ["20000101000000", 946652400000],   // 연도 2000 은 된다(< 2000 만 null)
  ["20000229000000", 951750000000],   // 400 으로 나뉘는 해는 윤년
  ["20280229000000", 1835362800000],
  ["20261231235959", 1798729199000],  // 23시 59분 59초·12월 31일
  ["20260228235959", 1772290799000],  // 평년 2월 말일
  ["20260430000000", 1777474800000],  // 4월 30일(31일은 null)
  ["20260105230000", 1767621600000],
  ["20260105085959", 1767571199000],
];
KST_OK.forEach(([v, want], i) => run(`kstMs 읽음 ${num(i)}`, () => fn("kstMs")(v), want, v));

const FULLWIDTH = "20260105090000".replace(/[0-9]/g, (d) => C(0xff10 + Number(d)));
const KST_BAD = [
  // 계획서 표(252행)
  "20250229120000", "20260431000000", "20261301000000", "20260100000000", "20260105240000",
  "20260105126000", "20260105120060", "19991231235959", "2026010509000", "202601050900000",
  "2026010509000a", " 20260105090000", 20260105090000, null, undefined, "",
  // 더한 경계: 그 달에 없는 날·월 0·32일·평년 2월 29일(100 으로 나뉘고 400 으로 안 나뉘는 해 포함)
  "20270229000000", "21000229000000", "20260631000000", "20260931000000", "20261131000000",
  "20260230000000", "20260001000000", "20260132000000", "00000101000000",
  // 더한 모양: 뒤 빈칸·줄바꿈·부호·구분자·전각 숫자·밀리초 숫자·글자가 아닌 것
  "20260105090000 ", "20260105090000\n", "+2026010509000", "2026-01-05 0900", FULLWIDTH,
  1767571200000, ["20260105090000"], {}, true,
];
KST_BAD.forEach((v, i) => run(`kstMs null ${num(i)}`, () => fn("kstMs")(v), null, v));

// 시간대가 바뀌어도 같은 값(한국 시각은 늘 UTC+9)
for (const tz of ["Asia/Seoul", "UTC", "Pacific/Auckland"]) {
  process.env.TZ = tz;
  run(`kstMs 시간대 ${tz}`, () => [0, 1, 2, 3, 6].map((i) => fn("kstMs")(KST_OK[i][0])), [0, 1, 2, 3, 6].map((i) => KST_OK[i][1]), tz);
}
process.env.TZ = "America/Los_Angeles";

// ---------- trustAt (240행, 254~264행 표, N1) ----------
const M_AT = 1767571800000, F_AT = 1767571500000; // meta.at 09:10, 파일 at 09:05
const META = () => ({ v: 1, at: "20260105091000", ok: true, fresh: ["41"], suspect: ["29"] });
const mm = (patch) => Object.assign(META(), patch);
const BY_META = (at) => ({ at, by: "meta" });
const BY_FILE = (at) => ({ at, by: "file" });
const NONE = { at: null, by: "none" };
const F = "20260105090500";
const noFresh = META(); delete noFresh.fresh;
const TRUST = [
  // [label, meta, fileAt, zcodes(없으면 인자를 안 줌), 기대]
  ["zcodes 안 줌", META(), F, "-", BY_META(M_AT)],
  ["파일이 meta 보다 늦음", META(), "20260105092000", "-", BY_META(1767572400000)],
  ["ok false", mm({ ok: false }), F, "-", BY_FILE(F_AT)],
  ["ok 1", mm({ ok: 1 }), F, "-", BY_FILE(F_AT)],
  ["ok 글자 true", mm({ ok: "true" }), F, "-", BY_FILE(F_AT)],
  ["ok 없음", (() => { const m = META(); delete m.ok; return m; })(), F, "-", BY_FILE(F_AT)],
  ["meta.at null", mm({ at: null }), F, "-", BY_FILE(F_AT)],
  ["meta.at 못 읽음", mm({ at: "2026" }), F, "-", BY_FILE(F_AT)],
  ["meta.at 없는 날", mm({ at: "20260231091000" }), F, "-", BY_FILE(F_AT)],
  // meta.at 은 14자리 글자만(240행 '읽히고' = kstMs). 숫자 허용은 fileAt 에만 적혀 있다.
  ["meta.at 숫자", mm({ at: M_AT }), F, "-", BY_FILE(F_AT)],
  ["meta null", null, F, "-", BY_FILE(F_AT)],
  ["meta undefined", undefined, F, "-", BY_FILE(F_AT)],
  ["meta 글자", "ok", F, "-", BY_FILE(F_AT)],
  ["zcodes 41", META(), F, ["41"], BY_META(M_AT)],
  ["zcodes undefined 를 줌", META(), F, undefined, BY_META(M_AT)],
  ["zcodes null", META(), F, null, BY_META(M_AT)],
  ["zcodes 41·11", META(), F, ["41", "11"], BY_FILE(F_AT)],
  ["zcodes 11·41(앞이 없음)", META(), F, ["11", "41"], BY_FILE(F_AT)],
  ["zcodes 빈 배열", META(), F, [], BY_FILE(F_AT)],
  ["zcodes 글자 41", META(), F, "41", BY_FILE(F_AT)],
  ["zcodes 숫자 41", META(), F, [41], BY_FILE(F_AT)],          // fresh 의 원소는 글자 "41"
  ["fresh 없음", noFresh, F, ["41"], BY_FILE(F_AT)],
  ["fresh 가 글자", mm({ fresh: "41" }), F, ["41"], BY_FILE(F_AT)], // 배열이 아니면 보증하지 않는다
  ["fresh 둘·zcodes 순서 다름", mm({ fresh: ["41", "11"] }), F, ["11", "41"], BY_META(M_AT)],
  ["fresh 없음이어도 zcodes 안 주면 meta", noFresh, F, "-", BY_META(M_AT)],
  ["zcodes 41·ok false", mm({ ok: false }), F, ["41"], BY_FILE(F_AT)],
  ["zcodes 41·파일이 늦음", META(), "20260105092000", ["41"], BY_META(1767572400000)],
  ["파일 at 2026", META(), "2026", "-", NONE],
  ["파일 at null", META(), null, "-", NONE],
  ["파일 at undefined", META(), undefined, "-", NONE],
  ["파일 at NaN", META(), NaN, "-", NONE],
  ["파일 at Infinity", META(), Infinity, "-", NONE],
  ["파일 at 13자리 글자", META(), "1767571500000", "-", NONE],
  ["파일 at 없는 날(meta 는 좋음)", META(), "20260230090500", ["41"], NONE],
  ["파일 at 숫자", META(), F_AT, "-", BY_META(M_AT)],
  ["파일 at 숫자·늦음", META(), 1767572400000, "-", BY_META(1767572400000)],
  ["파일 at 숫자·ok false", mm({ ok: false }), F_AT, "-", BY_FILE(F_AT)],
  ["파일 at 숫자·meta null", null, 1767571500123, "-", BY_FILE(1767571500123)],
];
TRUST.forEach(([label, meta, fileAt, z, want], i) => {
  const f = () => (z === "-" ? fn("trustAt")(meta, fileAt) : fn("trustAt")(meta, fileAt, z));
  run(`trustAt ${num(i)} ${label}`, f, want, [meta, fileAt, z]);
});
{
  // 받은 meta·zcodes 를 바꾸지 않는다(C5 의 정신. 순수 함수)
  const m = mm({ fresh: ["41", "11"] }), z = ["41", "11"], before = canon([m, z]); // 정렬되지 않은 배열(제자리 정렬을 잡는다)
  try { fn("trustAt")(m, F, z); } catch (e) { /* 위 표가 잡는다 */ }
  check("trustAt 입력 그대로", canon([m, z]) === before, canon([m, z]));
}

// ---------- ageMs·level·staleNote (241~243행, 266~279행 표, D1·D2) ----------
const t = 1767571800000;
const OLD = (a) => `${a} 상태예요.`;
const DROP = (a) => `${a} 상태라 빈자리를 세지 않았어요.`;
const AGE = [
  // [d, ageMs, level, staleNote]
  [0, 0, "fresh", ""], [1, 1, "fresh", ""], [899999, 899999, "fresh", ""], [900000, 900000, "fresh", ""],
  [900001, 900001, "old", OLD("15분 전")],
  [959999, 959999, "old", OLD("15분 전")],            // 15분 59.999초: 내림(반올림이면 16분)
  [1110000, 1110000, "old", OLD("18분 전")],
  [1139999, 1139999, "old", OLD("18분 전")],          // 18분 59.999초
  [1799999, 1799999, "old", OLD("29분 전")],
  [1800000, 1800000, "old", OLD("30분 전")],
  [1800001, 1800001, "drop", DROP("30분 전")],
  [2400000, 2400000, "drop", DROP("40분 전")],
  [3599999, 3599999, "drop", DROP("59분 전")],
  [3600000, 3600000, "drop", DROP("1시간 전")],
  [7199999, 7199999, "drop", DROP("1시간 전")],       // 119.99분: 내림(반올림이면 2시간)
  [7800000, 7800000, "drop", DROP("2시간 전")],
  [86399999, 86399999, "drop", DROP("23시간 전")],    // 1439분대
  [86400000, 86400000, "drop", DROP("1일 전")],
  [151200000, 151200000, "drop", DROP("1일 전")],     // 1.75일(42시간): 내림(반올림이면 2일)
  [180000000, 180000000, "drop", DROP("2일 전")],
  [-1, 0, "fresh", ""], [-299999, 0, "fresh", ""], [-300000, 0, "fresh", ""],
  [-300001, null, "drop", UNKNOWN], [-3600000, null, "drop", UNKNOWN],
  [-86400000, null, "drop", UNKNOWN],                  // 하루 앞: abs 로 재면 '1일 전'이 된다
];
AGE.forEach(([d, a, lv, note], i) => {
  const now = t + d;
  run(`시각 ${num(i)} ageMs`, () => fn("ageMs")(now, t), a, [now, t]);
  run(`시각 ${num(i)} level`, () => fn("level")(now, t), lv, [now, t]);
  run(`시각 ${num(i)} staleNote`, () => fn("staleNote")(now, t), note, [now, t]);
});

// 0 은 유한한 수다(거짓 같은 값을 '없음'으로 보지 않는다)
const ZERO = [
  [0, 0, 0, "fresh", ""],
  [900001, 0, 900001, "old", OLD("15분 전")],
  [0, 300000, 0, "fresh", ""],
];
ZERO.forEach(([now, tt, a, lv, note], i) => {
  run(`영 ${num(i)} ageMs`, () => fn("ageMs")(now, tt), a, [now, tt]);
  run(`영 ${num(i)} level`, () => fn("level")(now, tt), lv, [now, tt]);
  run(`영 ${num(i)} staleNote`, () => fn("staleNote")(now, tt), note, [now, tt]);
});

// 깨진 시각(282행): 유한한 수가 아니면 ageMs null·drop·'알 수 없어'. 글자·true 를 수로 바꾸지 않는다.
const BADT = [
  [t + 60000, null], [t + 60000, NaN], [t + 60000, "1767571800000"], [t + 60000, undefined],
  [t + 60000, Infinity], [t + 60000, -Infinity], [t + 60000, true], [t + 60000, [t]],
  [null, t], [NaN, t], [undefined, t], ["1767571860000", t], [Infinity, t], [true, t], [null, null],
];
BADT.forEach(([now, tt], i) => {
  run(`깨진 시각 ${num(i)} ageMs`, () => fn("ageMs")(now, tt), null, [now, tt]);
  run(`깨진 시각 ${num(i)} level`, () => fn("level")(now, tt), "drop", [now, tt]);
  run(`깨진 시각 ${num(i)} staleNote`, () => fn("staleNote")(now, tt), UNKNOWN, [now, tt]);
});

// kstMs·trustAt 결과를 그대로 넣는 흐름(4절 표준 시각: T_META 09:10, NOW0 09:12)
{
  const at = (() => { try { return fn("trustAt")(META(), F, ["41"]).at; } catch (e) { return null; } })();
  run("흐름 NOW0 fresh", () => fn("level")(1767571920000, at), "fresh", "NOW0");
  run("흐름 T_META+40분", () => fn("staleNote")(M_AT + 2400000, at), DROP("40분 전"), "T_META+40분");
  run("흐름 T_META+18분", () => fn("staleNote")(M_AT + 1080000, at), OLD("18분 전"), "T_META+18분");
  // 보증이 없으면 파일 at(09:05) 기준: 09:35 는 30분 → old, 09:35:00.001 은 drop
  const fat = (() => { try { return fn("trustAt")(mm({ ok: false }), F).at; } catch (e) { return null; } })();
  run("흐름 파일 기준 30분", () => fn("level")(F_AT + 1800000, fat), "old", "09:35");
  run("흐름 파일 기준 30분 넘음", () => fn("level")(F_AT + 1800001, fat), "drop", "09:35:00.001");
  run("흐름 시각 없음", () => fn("staleNote")(M_AT, fn("trustAt")(META(), "2026").at), UNKNOWN, "by none");
}

// ---------- cleanText (244행, 기준 3·4, C3) ----------
const GA = (n) => "가".repeat(n);
const LONGKEY = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789%2B%2F==";
const CLEAN = [
  ["상태 받기 실패: 연결 시간 초과", "상태 받기 실패: 연결 시간 초과"],
  ["HTTP 401 https://apis.data.go.kr/B552584/EvCharger/getChargerStatus?serviceKey=abcd", "HTTP 401 (주소)"],
  ["serviceKey=abc123 틀림", "serviceKey=(가림) 틀림"],
  ["token: xyz 만료", "token=(가림) 만료"],
  ["api_key = k1 Authorization: Bearer", "api_key=(가림) Authorization=(가림)"],
  [`키 ${LONGKEY} 거부`, "키 (가림) 거부"],
  ["줄\n바꿈\t과  빈칸", "줄 바꿈 과 빈칸"],
  ["ftp://x.example/a b", "(주소) b"],
  [GA(70), GA(60) + "…"],
  ["", ""], [null, ""], [5, ""], [undefined, ""], [{}, ""], [["가"], ""],
  ["<b>굵게</b>", "<b>굵게</b>"],
  // 이름마다(대소문자 무관), '=' 와 ':' 둘 다
  ["SERVICEKEY=abc 틀림", "SERVICEKEY=(가림) 틀림"],
  ["service_key=abc", "service_key=(가림)"],
  ["apikey:abc 끝", "apikey=(가림) 끝"],
  ["key=abc 끝", "key=(가림) 끝"],
  ["authorization=xyz", "authorization=(가림)"],
  ["Token = xyz", "Token=(가림)"],
  // ② 가 ③ 보다 먼저: 이름과 값이 이어져 20자가 넘어도 이름은 남는다
  ["serviceKey=AbCdEfGhIjKlMnOpQrSt 틀림", "serviceKey=(가림) 틀림"],
  // ① 주소: http·https·대문자, 뒤 글은 남김
  ["https://a.example/x?serviceKey=abcd 실패", "(주소) 실패"],
  ["실패 HTTP://A.EXAMPLE/X 끝", "실패 (주소) 끝"],
  // ③ 20자 경계·문자 종류
  ["값 AbCdEfGhIjKlMnOpQrS 끝", "값 AbCdEfGhIjKlMnOpQrS 끝"],    // 19자: 남김
  ["값 AbCdEfGhIjKlMnOpQrSt 끝", "값 (가림) 끝"],                  // 20자: 가림
  ["값 12345678901234567890 끝", "값 (가림) 끝"],
  ["값 abcd%efgh+ijkl/mnop_qr-s 끝", "값 (가림) 끝"],
  [`값 ${"가나다라마바사아자차카".repeat(2)} 끝`, `값 ${"가나다라마바사아자차카".repeat(2)} 끝`], // 한글은 가리지 않음
  ["HTTP 500", "HTTP 500"],
  // ④ 제어 문자·앞뒤 빈칸
  ["a" + C(7) + "b" + C(0x7f) + "c" + C(0) + "d", "a b c d"],
  ["   가나다   ", "가나다"],
  ["\r\n가\r\n\r\n나\r\n", "가 나"],
  // ④ 가 ⑤ 보다 먼저: 빈칸을 줄인 뒤 길이를 잰다
  ["가" + " ".repeat(10) + GA(55), "가 " + GA(55)],
  // ⑤ 60자 경계
  [GA(60), GA(60)],
  [GA(61), GA(60) + "…"],
];
CLEAN.forEach(([s, want], i) => run(`cleanText ${num(i)}`, () => fn("cleanText")(s), want, s));

const CLEAN_MAX = [
  ["가나다라마바사", 3, "가나다…"], ["가나다", 3, "가나다"],
  ["가나다라", 0, "가나다라"], ["가나다라", -1, "가나다라"], ["가나다라", 2.9, "가나…"],
  ["가나", 1, "가…"], [GA(61), NaN, GA(60) + "…"], [GA(61), undefined, GA(60) + "…"], [GA(61), 0, GA(60) + "…"],
  [GA(100), 80, GA(80) + "…"],
  // 가린 뒤에 자른다(자른 뒤 가리면 값 앞부분 'abc1' 이 남거나 '…' 이 사라진다)
  ["serviceKey=abc123 틀림", 15, "serviceKey=(가림)…"],
];
CLEAN_MAX.forEach(([s, m, want], i) => run(`cleanText max ${num(i)}`, () => fn("cleanText")(s, m), want, [s, m]));

// 값이 남지 않는다(C3)
const LEAK = [
  ["HTTP 401 https://apis.data.go.kr/B552584/EvCharger/getChargerStatus?serviceKey=abcd", ["http", "abcd", "apis", "serviceKey"]],
  ["serviceKey=abc123 틀림", ["abc123"]],
  ["Authorization: Bearer", ["Bearer"]],
  [`키 ${LONGKEY} 거부`, ["AbCd", "%2B"]],
];
LEAK.forEach(([s, bad], i) => {
  let r;
  try { r = fn("cleanText")(s); } catch (e) { r = "던짐"; }
  check(`cleanText 누출 ${num(i)}`, typeof r === "string" && r !== "던짐" && bad.every((b) => !r.includes(b)), canon(r));
});

// ---------- metaNote (245행, 기준 5) ----------
const NOTE = (why) => `${FAIL}(${why}).`;
const PLAIN = `${FAIL}.`;
const META_NOTE = [
  [{ v: 1, ok: true, at: "20260105091000" }, ""],
  [null, ""], [undefined, ""], ["ok", ""], [5, ""],
  [{ ok: true, error: "상태 받기 실패: 연결 시간 초과" }, ""],     // ok 가 참이면 error 가 있어도 빈 글
  [{ ok: false, error: "상태 받기 실패: 연결 시간 초과" }, NOTE("상태 받기 실패: 연결 시간 초과")],
  [{ ok: false, error: "" }, PLAIN], [{ ok: false, error: 7 }, PLAIN], [{ ok: false, error: null }, PLAIN],
  [{ ok: false }, PLAIN], [{ ok: false, error: "  \n " }, PLAIN],
  [{ ok: false, error: "HTTP 401 https://apis.data.go.kr/x?serviceKey=abcd" }, NOTE("HTTP 401 (주소)")],
  [{ ok: false, error: "serviceKey=abc123 틀림" }, NOTE("serviceKey=(가림) 틀림")],
  [{ ok: false, error: "상태 받기 실패: HTTP 500" }, NOTE("상태 받기 실패: HTTP 500")],
  [{ ok: false, error: GA(70) }, NOTE(GA(60) + "…")],                // 기본 60자
  [{ ok: false, error: "줄\n바꿈" }, NOTE("줄 바꿈")],
  // ok === true 만 보증(1·"true"·없음은 실패로 본다)
  [{ ok: 1, error: "x" }, NOTE("x")], [{ ok: "true" }, PLAIN], [{}, PLAIN],
];
META_NOTE.forEach(([m, want], i) => run(`metaNote ${num(i)}`, () => fn("metaNote")(m), want, m));
{
  let r;
  try { r = fn("metaNote")({ ok: false, error: "HTTP 401 https://apis.data.go.kr/x?serviceKey=abcd" }); } catch (e) { r = "던짐"; }
  check("metaNote 누출 없음", typeof r === "string" && r.startsWith(FAIL) && !r.includes("http") && !r.includes("abcd"), canon(r));
}

T.finish();
