/*
 * g1_rawbase 시험(JS 쪽): web/relay.js 의 ANDROID_BASE·defaultBase·baseOf·refreshRest (plan.md 4.1 G1~G6).
 * 사례(입력과 기대값)는 test_g1_rawbase_base.py 의 표에 있다. 파이썬이 그 표를 JSON 파일로 써서
 * 경로를 첫 인자로 넘기면, 이 파일은 함수를 불러 받은 값을 기대값과 견주기만 한다(T.eq).
 * 입력 꼴: ["s", 글] | ["null"] | ["undefined"] | ["num", 수] | ["obj"]  (JSON 에 undefined 를 못 담아서).
 * relay.js 가 없거나 함수가 없어도, 함수가 던져도 확인 이름은 모두 나온다(실패로).
 */
"use strict";
const T = require("./test_p0_fake.js");
const fs = require("fs");
const path = require("path");

let R = null, loadErr = "";
try { R = require(path.join(__dirname, "..", "web", "relay.js")); } catch (e) { loadErr = String(e && e.message).slice(0, 200); }

function val(x) {
  switch (x[0]) {
    case "s": return x[1];
    case "null": return null;
    case "undefined": return undefined;
    case "num": return x[1];
    case "obj": return {};
    default: throw new Error("모르는 입력 꼴 " + JSON.stringify(x));
  }
}
function fn(n) {
  if (!R || typeof R[n] !== "function") throw new Error(`relay.js 에 ${n} 함수가 없음 ${loadErr}`);
  return R[n];
}
// 던지면 받은 값 자리에 "던짐: …" 을 둔다(defaultBase·baseOf 는 던지면 안 된다)
function call(f) {
  try { return f(); } catch (e) { return "던짐: " + (e && e.name) + "/" + (e && e.message); }
}

async function main() {
  const cases = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  T.eq("G1 ANDROID_BASE", R ? R.ANDROID_BASE : "relay.js 못 읽음 " + loadErr, cases.raw);
  for (const c of cases.base) T.eq(c.name, call(() => fn("defaultBase")(val(c.href))), c.want);
  for (const c of cases.baseOf) T.eq(c.name, call(() => fn("baseOf")(c.settings, c.href)), c.want);
  for (const c of cases.rest) {
    const f = T.makeFetch({});
    const o = { href: c.href, fetch: f, now: cases.now };
    if (c.has_settings) o.settings = c.settings;
    let code = "던지지 않음";
    try { await fn("refreshRest")(o); } catch (e) { code = e && e.code ? e.code : "다른 오류: " + (e && e.message); }
    T.eq(c.name + " 부른 주소", f.calls(), c.want_calls);
    T.eq(c.name + " 끝난 코드", code, "relay_failed");
  }
  T.finish();
}
main().catch((e) => { T.check("잡히지 않은 오류(main)", false, e && e.stack || e); T.finish(); });
