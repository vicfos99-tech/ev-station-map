/*
 * 파이썬 build_routes(tools/charger_api.py)와 JS buildRoutes(web/live_build.js)가 같은 답을 내는지.
 *   py tools/dump_live_fixture.py [원본.json]   (기대값 만들기)
 *   node web/test/compare_live.js
 */
"use strict";
const path = require("path");
const fs = require("fs");
const LB = require(path.join(__dirname, "..", "live_build.js"));

const fx = JSON.parse(fs.readFileSync(path.join(__dirname, "live_fixture.json"), "utf8"));
const failures = [];
let checks = 0;

function diff(a, b, where) {
  checks += 1;
  if (typeof a === "number" && typeof b === "number") {
    if (Math.abs(a - b) > 1e-9) failures.push(`${where}: JS ${a} ≠ 파이썬 ${b}`);
    return;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      failures.push(`${where}: 길이/모양 다름 (JS ${Array.isArray(a) ? a.length : typeof a}, 파이썬 ${Array.isArray(b) ? b.length : typeof b})`);
      return;
    }
    a.forEach((x, i) => diff(x, b[i], `${where}[${i}]`));
    return;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) diff(a[k], b[k], `${where}.${k}`);
    return;
  }
  if (a !== b) failures.push(`${where}: JS ${JSON.stringify(a)} ≠ 파이썬 ${JSON.stringify(b)}`);
}

for (const [name, c] of Object.entries(fx.cases)) {
  const got = LB.buildRoutes(fx.items, fx.fetched_ms, fx.config, c.tariffs);
  diff(got.routes, c.routes, `${name}.routes`);
  diff(got.skipped, c.skipped, `${name}.skipped`);
}

for (const [x, nd, want] of fx.rounds || []) diff(LB.pyRound(x, nd), want, `round(${x}, ${nd})`);

console.log(`items: ${fx.items.length}, checks: ${checks}, failures: ${failures.length}`);
for (const f of failures.slice(0, 20)) console.log("  " + f);
process.exit(failures.length ? 1 : 0);
