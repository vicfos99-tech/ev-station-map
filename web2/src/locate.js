// 순수: 지금 위치를 고속도로 선·km 에 붙인다(설계 5-1 locate · 원칙 '위치를 선·km 에 붙이기는 StateCalc 가 Locate 에 시켜 한 번만').
// StateCalc 가 부른다: (입력 조각들, 같은 셈의 앞 결과, 규칙 r = config_locate, lib = {parts, rules}) → pos 조각.
// 선 붙이기 자체는 Geo(lib.parts[r.geo_part], 규칙 lib.rules[r.geo_rule]). 로그 없음, 틀린 입력은 던진다.
// pos = {t, line, km, off_m, on_line, dir} — 선에서 r.on_line_m 보다 멀면 on_line 거짓·line·km 빔.
// dir: 진행 방향이 선의 방향과 r.dir_max_deg 안이면 '선 방향', 반대쪽이면 '거꾸로', 그 밖·방향 없음은 null.
export const NEEDS = [];

export function locate(inputs, done, r, lib) {
  const fix = inputs[r.fix_input];
  if (!fix) return null;
  const geo = lib.parts[r.geo_part];
  const g = lib.rules[r.geo_rule];
  if (!geo || !g) throw new TypeError(r.geo_part);
  const st = inputs[r.stations_input];
  const lines = (st && Array.isArray(st[r.lines_key])) ? st[r.lines_key] : [];
  let best = null;
  for (const line of lines) {
    const s = geo.snap({ lat: fix.lat, lng: fix.lng }, line.points, g);
    if (!best || s.off_m < best.off_m) best = { ...s, line: line.name };
  }
  if (!best) return { t: fix.t, line: null, km: null, off_m: null, on_line: false, dir: null };
  const on = best.off_m <= r.on_line_m;
  let dir = null;
  if (on && typeof fix.heading_deg === 'number' && Number.isFinite(fix.heading_deg)) {
    const diff = geo.angleDiff(fix.heading_deg, best.bearing_deg, g);
    if (diff <= r.dir_max_deg) dir = r.dir_words.forward;
    else if (diff >= g.half_turn_deg - r.dir_max_deg) dir = r.dir_words.backward;
  }
  return {
    t: fix.t,
    line: on ? best.line : null,
    km: on ? Math.round(best.km * r.km_round) / r.km_round : null,
    off_m: Math.round(best.off_m),
    on_line: on,
    dir,
  };
}
