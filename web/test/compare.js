/*
 * 파이썬 엔진이 뽑은 기대값(fixtures.json)으로 자바스크립트 엔진을 대조한다.
 *
 *   py tools/dump_fixtures.py      ← 먼저 기대값을 만들고
 *   node web/test/compare.js       ← 저장소 루트에서
 *
 * 하나라도 다르면 종료 코드 1.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const EV = require("../engine.js");

const fx = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures.json"), "utf8"));
let checks = 0;
const failed = [];

// 깊은 비교. 숫자는 1e-9 안이면 같다고 본다. 다르면 첫 번째 다른 자리의 경로를 돌려준다
function diff(a, b, where) {
  if (typeof a === "number" && typeof b === "number") {
    return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)) ? null : `${where}: ${a} != ${b}`;
  }
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    return a === b ? null : `${where}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return `${where}: 배열/객체가 다르다`;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return `${where}: 길이 ${a.length} != ${b.length}`;
    for (let i = 0; i < a.length; i++) { const d = diff(a[i], b[i], `${where}[${i}]`); if (d) return d; }
    return null;
  }
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  if (ka.join() !== kb.join()) return `${where}: 키가 다르다 (${ka.join()} / ${kb.join()})`;
  for (const k of ka) { const d = diff(a[k], b[k], `${where}.${k}`); if (d) return d; }
  return null;
}
function check(label, fn) {
  checks += 1;
  try {
    const d = fn();
    if (d) failed.push(`${label}: ${d}`);
  } catch (err) {
    failed.push(`${label}: 예외 ${err.name} ${err.message}`);
  }
}
const run = (i) => EV.plan(i.route, i.vehicle, i.user, i.now, i.position_km, i.stale_minutes);

for (const c of fx.plans) {
  check(c.name, () => diff(run(c.input), c.expected, "plan"));
}
for (const [k, r] of fx.ranges.entries()) {
  const v = EV.makeVehicle(r.vehicle);
  check(`range-${k}`, () => diff(
    { range: EV.conservative_range_km(v), per_pct: EV.km_per_pct(v), arrival: EV.arrival_soc_pct(v, r.distance_km), reach: EV.can_reach(v, r.distance_km) },
    { range: r.range, per_pct: r.per_pct, arrival: r.arrival, reach: r.reach }, "range"));
}
for (const c of fx.errors) {
  check(`error ${c.name}`, () => {
    try { run(c.input); } catch (err) { return err.name === "ValueError" ? null : `ValueError 가 아니라 ${err.name}`; }
    return "오류가 나야 하는데 통과했다";
  });
}

console.log(`fixtures: ${fx.generator}`);
console.log(`checks: ${checks}, failures: ${failed.length}`);
for (const f of failed.slice(0, 20)) console.log("  " + f);
process.exit(failed.length ? 1 : 0);
