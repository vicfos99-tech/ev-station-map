/*
 * p0 시험(JS 쪽): 가짜 fetch·저장소(test_p0_fake.js)와 web/relay.js 틀 (plan.md 5절 p0 통과 기준 3·4·5·7).
 * test_p0_relay.py 가 run_js("test_p0_relay.js") 로 돌려 확인 하나를 pytest 테스트 하나로 보인다.
 * relay.js 가 없거나 깨져도 확인 이름은 모두 나온다(실패로). 이름 집합은 파이썬 쪽 JS_NAMES 와 같아야 한다.
 */
"use strict";
const T = require("./test_p0_fake.js");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { check, eq } = T;

const RELAY_PATH = path.join(__dirname, "..", "web", "relay.js");
const ANDROID = "https://vicfos99-tech.github.io/ev-station-map/relay/";

async function fakeFetchChecks() {
  const B = "https://r.example/relay/";
  const f = T.makeFetch({
    "meta.json": { v: 1, at: "20260105091000", 글: "한글" },
    "plain.txt": "글 그대로 {not json",
    "busy.json": 503,
    "empty.json": 204,
    "s200.json": 200, "s299.json": 299, "s300.json": 300, "s199.json": 199,
    "down.json": T.DOWN,
    "fn.json": (url) => ({ got: url }),
    "fn503.json": () => 503,
    "fndown.json": () => T.DOWN,
    "https://r.example/relay/full.json": "주소 전체 열쇠",
    "https://other.example/x.json": { other: true },
  }, { base: B });

  let r = await f(B + "meta.json", { cache: "no-cache" });
  check("fetch 객체 ok", r.ok === true, show(r));
  eq("fetch 객체 status", r.status, 200);
  eq("fetch 객체 글", await r.text(), JSON.stringify({ v: 1, at: "20260105091000", 글: "한글" }));
  r = await f(B + "plain.txt");
  eq("fetch 글 그대로", [r.ok, r.status, await r.text()], [true, 200, "글 그대로 {not json"]);
  r = await f(B + "busy.json");
  eq("fetch 503", [r.ok, r.status], [false, 503]);
  r = await f(B + "empty.json");
  eq("fetch 204", [r.ok, r.status], [true, 204]);
  const st = [];
  for (const k of ["s200", "s299", "s300", "s199"]) { r = await f(B + k + ".json"); st.push([r.status, r.ok]); }
  eq("fetch 숫자 경계 200·299 ok, 300·199 아님", st, [[200, true], [299, true], [300, false], [199, false]]);
  let err = null;
  try { await f(B + "down.json"); } catch (e) { err = e; }
  check("fetch DOWN 은 TypeError 로 거절", err instanceof TypeError, show(err && err.name));
  r = await f(B + "fn.json");
  eq("fetch 함수 값(주소 전체를 받음)", [r.status, JSON.parse(await r.text())], [200, { got: B + "fn.json" }]);
  r = await f(B + "fn503.json");
  eq("fetch 함수가 숫자", [r.ok, r.status], [false, 503]);
  err = null;
  try { await f(B + "fndown.json"); } catch (e) { err = e; }
  check("fetch 함수가 DOWN", err instanceof TypeError, show(err && err.name));
  r = await f(B + "nothing.json");
  eq("fetch 없는 주소 404", [r.ok, r.status], [false, 404]);
  r = await f(B + "full.json");
  eq("fetch 주소 전체 열쇠", [r.status, await r.text()], [200, "주소 전체 열쇠"]);
  r = await f("https://other.example/x.json");
  eq("fetch base 밖 주소 전체 열쇠", JSON.parse(await r.text()), { other: true });
  r = await f("https://other.example/meta.json");
  eq("fetch base 밖이면 뒷부분 열쇠로 찾지 않음", r.status, 404);
  const calls = f.calls();
  eq("fetch calls 순서", calls.slice(0, 3), [B + "meta.json", B + "plain.txt", B + "busy.json"]);
  eq("fetch calls 수", calls.length, 16);
  calls.push("x");
  eq("fetch calls 는 사본", f.calls().length, 16);
  const inits = f.inits();
  eq("fetch inits 둘째 인자", inits[0], { cache: "no-cache" });
  check("fetch inits 없으면 undefined", inits.length === 16 && inits[1] === undefined, show(inits.length));
  eq("fetch 하나씩 부르면 maxActive 1", f.maxActive(), 1);

  const g = T.makeFetch({ "a": 1 }, { delay: 5 });
  await Promise.all([g("a"), g("b"), g("c")]);
  eq("fetch delay 5 로 셋을 같이 부르면 maxActive 3", g.maxActive(), 3);
  const h = T.makeFetch({ "k.json": { a: 1 } });
  r = await h("k.json");
  eq("fetch opts 없이도 됨", [r.status, await r.text()], [200, '{"a":1}']);
}

function storageChecks() {
  const s = T.makeStorage({ a: "1" });
  eq("storage 처음 값", [s.getItem("a"), s.getItem("없음")], ["1", null]);
  s.setItem("k", "v"); s.setItem("n", 5); s.removeItem("a"); s.setItem("k", "w");
  eq("storage 넣고 읽기", [s.getItem("k"), s.getItem("n"), s.getItem("a")], ["w", "5", null]);
  eq("storage log 순서", s.log(), [["set", "k", "v"], ["set", "n", "5"], ["remove", "a"], ["set", "k", "w"]]);
  eq("storage dump", s.dump(), { k: "w", n: "5" });
  const e0 = T.makeStorage();
  eq("storage init 없음", [e0.getItem("x"), e0.log()], [null, []]);
  const outcome = (fn) => { try { fn(); return "ok"; } catch (e) { return "throw"; } };
  for (const op of ["get", "set", "remove"]) {
    const b = T.makeStorage({ x: "1" }, [op]);
    const got = [outcome(() => b.getItem("x")), outcome(() => b.setItem("y", "2")), outcome(() => b.removeItem("x"))];
    const want = ["get", "set", "remove"].map((o) => (o === op ? "throw" : "ok"));
    eq(`storage fail ${op} 만 던짐`, got, want);
    if (op === "set") eq("storage fail set 은 저장·기록하지 않음", [b.dump().y, b.log().filter((l) => l[0] === "set")], [undefined, []]);
  }
}

function relayChecks() {
  let R = null, loadErr = "";
  try { R = require("../web/relay.js"); } catch (e) { loadErr = String(e && e.message).slice(0, 200); }
  check("relay require 가 객체", R !== null && typeof R === "object", loadErr || show(typeof R));
  const g = (k) => (R ? R[k] : undefined);
  eq("relay ANDROID_BASE", g("ANDROID_BASE"), ANDROID);
  eq("relay NOTE_MIN", g("NOTE_MIN"), 15);
  eq("relay DROP_MIN", g("DROP_MIN"), 30);
  eq("relay FUTURE_MIN", g("FUTURE_MIN"), 5);
  eq("relay POOL", g("POOL"), 6);
  eq("relay KEY_ON", g("KEY_ON"), "ev-charge-planner/relay");
  eq("relay KEY_BASE", g("KEY_BASE"), "ev-charge-planner/relay-base");
  eq("relay NOTE_FALLBACK", g("NOTE_FALLBACK"), "중계에 연결하지 못해 직접 받았어요");
  eq("relay NOTE_SUSPECT", g("NOTE_SUSPECT"), "이 지역은 충전소 목록을 확인하는 중이라 빠진 곳이 있을 수 있어요.");
  check("relay 숫자 상수는 number", ["NOTE_MIN", "DROP_MIN", "FUTURE_MIN", "POOL"].every((k) => typeof g(k) === "number"),
    show(["NOTE_MIN", "DROP_MIN", "FUTURE_MIN", "POOL"].map((k) => typeof g(k))));
  const RE = g("RelayError");
  check("relay RelayError 는 함수", typeof RE === "function", show(typeof RE));
  let e = null, e2 = null;
  try { e = new RE("shape", "글"); e2 = new RE("network"); } catch (x) { /* 아래 확인이 실패로 남긴다 */ }
  check("RelayError 는 Error", e instanceof Error, show(e));
  check("RelayError 는 RelayError", typeof RE === "function" && e instanceof RE, show(e));
  eq("RelayError 이름·코드·글", e && [e.name, e.code, e.message], ["RelayError", "shape", "글"]);
  eq("RelayError 글 없으면 코드", e2 && [e2.name, e2.code, e2.message], ["RelayError", "network", "network"]);
  check("RelayError 던지고 잡힘", (() => { try { throw new RE("bad_id", "x"); } catch (x) { return x.code === "bad_id" && typeof x.stack === "string"; } })(), "throw/catch 실패");
  check("RelayError 의 code 는 객체마다", e && e2 && e.code !== e2.code, "code 가 공유됨");

  // 브라우저 꼴: window 만 있는 문맥(module·require·process 없음)
  let src = "";
  try { src = fs.readFileSync(RELAY_PATH, "utf8"); } catch (x) { /* 빈 글이면 아래가 실패 */ }
  const ctx = { window: {} };
  let vmErr = "";
  try { vm.createContext(ctx); vm.runInContext(src, ctx, { filename: "relay.js" }); } catch (x) { vmErr = String(x && x.message).slice(0, 200); }
  const W = ctx.window.EvRelay;
  eq("브라우저 꼴 window.EvRelay.ANDROID_BASE", W && W.ANDROID_BASE, ANDROID);
  eq("브라우저 꼴 window.EvRelay.POOL", W && W.POOL, 6);
  check("브라우저 꼴 오류 없음·module 안 만듦", vmErr === "" && typeof ctx.module === "undefined", vmErr || "module 이 생김");
}

const show = T.show;
(async () => {
  await fakeFetchChecks();
  storageChecks();
  relayChecks();
  T.finish();
})();
