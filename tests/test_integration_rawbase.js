/*
 * integration(plan.md 4.2 I1): 잠긴 가짜 화면(test_integration_dom.js)으로 실제 web/ 을 띄워 '새로 받기'를 누른다.
 *   node test_integration_rawbase.js '<사례 JSON 배열>'   사례 = {id, href(null 이면 안 줌), storage}
 * 기대값은 두지 않는다. 본 것(부른 주소·#live-msg·errors)을 RESULT 한 줄로 내고, 단언은 test_integration_rawbase.py 의 표 S 가 한다.
 * live.js(861KB)만 견본 routes.json 으로 만든 작은 것으로 바꾼다(plan.md 238행). 가짜 중계는 주소 끝만 보고 견본을 준다(239행).
 */
"use strict";
const fs = require("fs");
const path = require("path");
const PROJ = path.resolve(__dirname, "..");
const WEB = path.join(PROJ, "web");
const { boot } = require("./test_integration_dom.js");
const read = (f) => fs.readFileSync(path.join(WEB, f), "utf8");
const sample = (f) => fs.readFileSync(path.join(PROJ, "ref", "relay_sample", f), "utf8");
const NOW = 1767571920000;

const MINI = (() => {
  const r = JSON.parse(sample("routes.json"));
  const d = { fetched_at: r.fetched_at, source: r.source, price_note: r.price_note, routes: r.routes, skipped: r.skipped, config: null };
  return `(function (root) { root.EvLive = ${JSON.stringify(d)}; })(typeof self !== "undefined" ? self : this);`;
})();
const SCRIPTS = [...read("index.html").matchAll(/<script src="([^"]+)"><\/script>/g)]
  .map((m) => m[1]).map((name) => ({ name, code: name === "live.js" ? MINI : read(name) }));

function answer(url) {
  const m = url.match(/\/(meta\.json|routes\.json|status\/rest\/KP00010[12]\.json)$/);
  if (!m) return { ok: false, status: 404, text: async () => "" };
  const text = sample(m[1]);
  return { ok: true, status: 200, text: async () => text };
}

async function flow(c) {
  const o = { scripts: SCRIPTS, storage: c.storage || {}, now: NOW, fetch: async (url) => answer(url) };
  if (c.href !== null && c.href !== undefined) o.href = c.href;
  const app = boot(o);
  const loadErrors = app.errors();
  const before = app.calls();
  app.fire("#live-form", "submit");
  await app.settle();
  const out = { id: c.id, scripts: SCRIPTS.map((s) => s.name), loadErrors, before, calls: app.calls(),
    msg: app.el("#live-msg").textContent, errors: app.errors() };
  app.close();
  return out;
}

(async () => {
  const cases = JSON.parse(process.argv[2] || "[]");
  const out = [];
  for (const c of cases) {
    try { out.push(await flow(c)); } catch (e) { out.push({ id: c.id, crash: String(e && e.stack || e) }); }
  }
  console.log("RESULT " + JSON.stringify(out));
})();
