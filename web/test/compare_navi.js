/*
 * web/navi.js 가 파이썬 ev_route_navi 와 같은 답을 내는지 대조한다.
 *   node web/test/compare_navi.js
 * 대조 자료: web/test/navi_fixture.json (ev-route-navi/tools/dump_js_fixture.py 가 만든다)
 */
"use strict";
const fs = require("fs");
const path = require("path");
const N = require("../navi.js");

const fx = JSON.parse(fs.readFileSync(path.join(__dirname, "navi_fixture.json"), "utf8"));
const TOL = 1e-9;
let checks = 0, failures = 0;
function fail(where, got, want) {
  failures += 1;
  if (failures <= 20) console.log(`다름 ${where}: JS=${JSON.stringify(got)} 파이썬=${JSON.stringify(want)}`);
}
function same(where, got, want) {
  checks += 1;
  if (typeof want === "number" && typeof got === "number") {
    if (!(Math.abs(got - want) <= TOL * Math.max(1, Math.abs(want)))) fail(where, got, want);
  } else if (JSON.stringify(got) !== JSON.stringify(want)) fail(where, got, want);
}
function sameList(where, got, want, keys) {
  same(`${where}.length`, got.length, want.length);
  for (let i = 0; i < Math.min(got.length, want.length); i++) for (const k of keys) same(`${where}[${i}].${k}`, got[i][k], want[i][k]);
}

fx.cases.forEach((c, ci) => {
  const tag = `${ci}:${c.name}`;
  let pieces = c.pieces;
  if (c.kakao) { // 카카오 응답 변환도 대조
    const kr = N.piecesFromKakao(c.kakao);
    sameList(`${tag}.kakao`, kr.pieces, c.pieces, ["name", "length_m"]);
    kr.pieces.forEach((p, i) => same(`${tag}.kakao[${i}].points`, p.points, c.pieces[i].points));
    pieces = kr.pieces;
  }
  const res = N.matchRoute(c.name, pieces, c.highways, c.sites, c.options);
  const e = c.expect;
  same(`${tag}.total_km`, res.total_km, e.total_km);
  same(`${tag}.bridged_km`, res.bridged_km, e.bridged_km);
  same(`${tag}.unmatched`, res.unmatched_highway_names, e.unmatched);
  sameList(`${tag}.sections`, res.sections, e.sections, ["highway_id", "direction", "direction_name", "start_km", "end_km", "first_vertex", "last_vertex", "line_start_km", "line_end_km"]);
  sameList(`${tag}.unknown`, res.unknown_intervals, e.unknown, ["start_km", "end_km", "names"]);
  sameList(`${tag}.warnings`, res.warnings, e.warnings, ["piece_index", "gap_km", "at_km"]);
  sameList(`${tag}.stops`, res.stops, e.stops, ["id", "route_km", "offset_km", "section_index", "at_end"]);
  sameList(`${tag}.excluded`, res.excluded, e.excluded, ["id", "reason"]);
  c.locate.forEach((L, li) => {
    const w = `${tag}.locate[${li}]`;
    let pos = null, err = false;
    try { pos = N.locate(res.route, L.point, L.last_km, c.options); } catch (x) { err = true; }
    if (L.error) { same(`${w}.error`, err, true); return; }
    if (err) { fail(`${w}.error`, true, false); return; }
    same(`${w}.route_km`, pos.route_km, L.route_km);
    same(`${w}.offset_km`, pos.offset_km, L.offset_km);
    same(`${w}.off_route`, pos.off_route, L.off_route);
    const ahead = pos.off_route ? null : N.stopsAhead(res.stops, pos.route_km, res.options.ahead_min_km).map((s) => s.id);
    same(`${w}.ahead`, ahead, L.ahead);
  });
});
console.log(`cases: ${fx.cases.length}, checks: ${checks}, failures: ${failures}`);
process.exit(failures ? 1 : 0);
