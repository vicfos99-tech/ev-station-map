/*
 * 시험 틀(JS 쪽): 확인 모으기 + 가짜 fetch·저장소 (plan.md 5절 p0).
 *   const T = require("./test_p0_fake.js");
 *   T.check("이름", 조건, "틀렸을 때 보일 글");  T.eq("이름", 받은 값, 기대값);
 *   await T.rejects("이름", () => 약속, "코드");  T.throws("이름", () => 함수, "코드");
 *   const f = T.makeFetch({ "meta.json": {...}, "routes.json": 404, "x.json": "글 그대로", "y.json": T.DOWN }, { base });
 *   f.calls(부른 주소 목록)  f.inits(둘째 인자 목록)  f.maxActive(동시에 열린 최대 수)
 *   T.finish();   // 마지막 줄에 RESULT {...} 한 줄을 찍는다. 파이썬 쪽(test_p0_node.run_js)이 읽는다
 */
"use strict";
const checks = [];
const names = new Set();
function check(name, cond, detail) {
  if (names.has(name)) { checks.push({ name: name + " (이름 겹침)", ok: false, detail: "같은 이름의 확인이 두 번" }); return; }
  names.add(name);
  checks.push({ name, ok: !!cond, detail: cond ? "" : String(detail === undefined ? "" : detail).slice(0, 600) });
}
const show = (v) => { try { return JSON.stringify(v); } catch (e) { return String(v); } };
function eq(name, got, want) { check(name, show(got) === show(want), `받은 값 ${show(got)} != 기대 ${show(want)}`); }
function throws(name, fn, code) {
  try { fn(); } catch (e) { check(name, e && e.code === code, `던진 것: ${e && e.name}/${e && e.code}/${e && e.message}`); return e; }
  check(name, false, "던지지 않음");
  return null;
}
async function rejects(name, fn, code) {
  try { await fn(); } catch (e) { check(name, e && e.code === code, `던진 것: ${e && e.name}/${e && e.code}/${e && e.message}`); return e; }
  check(name, false, "던지지 않음");
  return null;
}
const DOWN = Symbol("연결 실패");
// files: 주소(또는 base 를 뗀 뒷부분) → 객체(JSON 200) | 글(그대로 200) | 숫자(그 상태 코드) | DOWN(연결 실패) | 함수(url) → 앞의 것 중 하나. 없는 주소는 404
function makeFetch(files, opts) {
  const o = opts || {}, calls = [], inits = [];
  let active = 0, maxActive = 0;
  const f = async (url, init) => {
    url = String(url);
    calls.push(url); inits.push(init);
    active += 1; if (active > maxActive) maxActive = active;
    try {
      await new Promise((r) => setTimeout(r, o.delay || 0));
      const key = o.base && url.startsWith(o.base) ? url.slice(o.base.length) : url;
      let v = Object.prototype.hasOwnProperty.call(files, key) ? files[key] : Object.prototype.hasOwnProperty.call(files, url) ? files[url] : 404;
      if (typeof v === "function") v = await v(url);
      if (v === DOWN) throw new TypeError("fetch failed");
      if (typeof v === "number") return { ok: v >= 200 && v < 300, status: v, text: async () => "" };
      const text = typeof v === "string" ? v : JSON.stringify(v);
      return { ok: true, status: 200, text: async () => text };
    } finally { active -= 1; }
  };
  f.calls = () => calls.slice();
  f.inits = () => inits.slice();
  f.maxActive = () => maxActive;
  return f;
}
// localStorage 흉내. fail: "get"·"set"·"remove" 가 들어 있으면 그 동작이 던진다
function makeStorage(init, fail) {
  const m = new Map(Object.entries(init || {})), log = [], bad = fail || [];
  return {
    getItem(k) { if (bad.includes("get")) throw new Error("막힘"); return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { if (bad.includes("set")) throw new Error("막힘"); log.push(["set", k, String(v)]); m.set(k, String(v)); },
    removeItem(k) { if (bad.includes("remove")) throw new Error("막힘"); log.push(["remove", k]); m.delete(k); },
    dump: () => Object.fromEntries(m), log: () => log.slice(),
  };
}
let finished = false;
function finish() {
  if (finished) return;
  finished = true;
  console.log("RESULT " + JSON.stringify({ checks }));
}
process.on("uncaughtException", (e) => { check("잡히지 않은 오류", false, e && e.stack || e); finish(); process.exit(0); });
process.on("unhandledRejection", (e) => { check("잡히지 않은 거절", false, e && e.stack || e); finish(); process.exit(0); });
module.exports = { check, eq, throws, rejects, makeFetch, makeStorage, DOWN, finish, show };
