// 순수: 누른 지점 거리(설계 5-1 213줄 · 6절 차례 8 — TapDist). StateCalc 표 한 줄이 부른다:
//   (입력 조각들, 같은 셈의 앞 결과 done, 규칙 r = config_tap, lib = {parts, rules}, 내 앞 결과 prev) → tap 조각.
// 입력: 지도 누름 요청(map.tap — {seq, lat, lng}, ui_map 이 냄) · 닫기 요청(tap.close — {seq}, ui_tap 이 냄) · 지금 위치(fix) · 고속도로 선(stations.lines).
// 보임 규칙: 새 누름(seq 가 바뀜)이 오면 앞 표시가 보이고 있었으면 지우고(다시 누르면 사라짐), 아니면 보인다. 닫기 요청이 지금 seq 면 지운다.
//   위치만 바뀌면(seq 그대로) 보임은 그대로 두고 거리만 다시 셈한다.
// 거리: 직선 = Geo.distM(지금 위치, 누른 곳). 길 따라 = 지금 고속도로 위(같은 셈의 pos — on_line)이고 누른 곳이 그 선에서 r.on_line_m 안이면
//   선 위 km 차이(Geo.snap — 기존 순수 모듈을 불러 쓰기만), 진행 방향(pos.dir)으로 앞·뒤. 아니면 비움.
// tap = null(누름 없음) | {seq, shown:false} | {seq, shown:true, lat, lng, straight_km, along_km, side, line}. 로그 없음, 틀린 입력은 던진다.
export const NEEDS = [];

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function checkPoint(p, r) {
  if (!p || typeof p !== 'object') throw new TypeError(r.tap_input);
  if (!Number.isInteger(p.seq) || p.seq < r.seq_min) throw new TypeError(r.seq_word);
  if (!isNum(p.lat) || p.lat < r.lat_range[0] || p.lat > r.lat_range[1]) throw new TypeError(r.lat_word);
  if (!isNum(p.lng) || p.lng < r.lng_range[0] || p.lng > r.lng_range[1]) throw new TypeError(r.lng_word);
}

function round(km, r) {
  return Math.round(km * r.km_round) / r.km_round;
}

// 보이나: 새 누름이면 앞 표시의 반대, 같은 누름이면 앞 그대로(닫기 요청이 이 누름이면 지움)
export function shownOf(req, close, prev) {
  const closed = !!close && close.seq === req.seq;
  if (prev && prev.seq === req.seq) return !!prev.shown && !closed;
  return !(prev && prev.shown) && !closed;
}

// 길 따라: 지금 선 위이고 누른 곳도 그 선 가까이면 km 차이와 앞·뒤
export function alongOf(pt, pos, lines, geo, g, r) {
  if (!pos || !pos.on_line || !pos.line || !isNum(pos.km)) return null;
  const line = lines.find((l) => l && l.name === pos.line);
  if (!line) return null;
  const s = geo.snap({ lat: pt.lat, lng: pt.lng }, line.points, g);
  if (s.off_m > r.on_line_m) return null;
  const d = s.km - pos.km;
  let side = null;
  if (Math.abs(d) < r.side_min_km) side = null;
  else if (pos.dir === r.dir_words.forward) side = d >= 0 ? r.sides.ahead : r.sides.behind;
  else if (pos.dir === r.dir_words.backward) side = d <= 0 ? r.sides.ahead : r.sides.behind;
  return { km: round(Math.abs(d), r), side, line: pos.line };
}

export function tapOf(inputs, done, r, lib, prev) {
  const req = inputs[r.tap_input];
  if (!req) return null;
  checkPoint(req, r);
  const close = inputs[r.close_input] || null;
  if (!shownOf(req, close, prev)) return { seq: req.seq, shown: false };
  const geo = lib.parts[r.geo_part];
  const g = lib.rules[r.geo_rule];
  if (!geo || !g) throw new TypeError(r.geo_part);
  const fix = inputs[r.fix_input];
  const straight = fix && isNum(fix.lat) && isNum(fix.lng) ? round(geo.distM(fix, req, g) / g.m_per_km, r) : null;
  const st = inputs[r.stations_input];
  const lines = st && Array.isArray(st[r.lines_key]) ? st[r.lines_key] : [];
  const along = fix ? alongOf(req, done[r.pos_piece], lines, geo, g, r) : null;
  return {
    seq: req.seq,
    shown: true,
    lat: req.lat,
    lng: req.lng,
    straight_km: straight,
    along_km: along ? along.km : null,
    side: along ? along.side : null,
    line: along ? along.line : null,
  };
}
