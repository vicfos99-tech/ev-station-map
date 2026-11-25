// 순수: 그 길의 제한 속도 찾기(설계 5-1-나 LimitMatch · 5-8 나). StateCalc 가 부른다:
//   (입력 조각들, 같은 셈의 앞 결과 done, 규칙 r = config_limitmatch, lib = {parts, rules}, 내 앞 결과) → limit 조각.
// 후보 ① 고속도로: 같은 셈의 pos(선·km·방향 — Locate 가 한 번 붙인 것)가 선 위이고 방향을 알 때, 받은 고속도로 표에서 그 선·그 방향·그 km 를 품은 구간.
// 후보 ② 일반 도로: 지금 칸과 이웃 칸(r.cell.match_ring)의 도로 조각 가운데 r.road_dist_m 안이고 진행 방향이 r.road_dir_max_deg 안인 것(양방향 조각은 반대 방향도).
// 값이 범위(중계 파일 검사와 같은 설정 — config_relay_parse.limit) 밖이거나 0·빈 값인 후보는 '없음'으로 친다. 남은 후보의 값이 둘 이상이면 '없음'(갈림 — 고가도로 아래 길처럼).
// limit = {t, kmh: 숫자 | null, src: 고속도로·일반 도로 | null, why: 찾음·자료 없음·후보 없음·갈림, n: 후보 수}. 로그 없음, 틀린 입력은 던진다.
// cellKey·cellsAround 는 relay_limit(받을 칸 고르기)과 시험 도구가 함께 쓴다 — 칸 셈은 이 파일 한 곳.
export const NEEDS = [];

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function cellIndex(v, r) {
  if (!isNum(v)) throw new TypeError(r.why_words.bad_input);
  return Math.floor(v / r.cell.deg);
}

// 칸 열쇠: 위도·경도를 칸 크기(도)로 나눈 내림 두 수를 이음표로
export function cellKey(lat, lng, r) {
  return cellIndex(lat, r) + r.cell.sep + cellIndex(lng, r);
}

// 지금 칸(맨 앞)과 둘레 ring 바퀴의 칸 열쇠들
export function cellsAround(lat, lng, r, ring) {
  const y = cellIndex(lat, r);
  const x = cellIndex(lng, r);
  const out = [y + r.cell.sep + x];
  for (let dy = -ring; dy <= ring; dy += 1) {
    for (let dx = -ring; dx <= ring; dx += 1) {
      if (dy === 0 && dx === 0) continue;
      out.push((y + dy) + r.cell.sep + (x + dx));
    }
  }
  return out;
}

// 값 범위는 중계 파일 검사와 같은 한 곳(r.range_rule 설정의 limit 칸)
function okKmh(v, rng) {
  return isNum(v) && v >= rng.kmh_min && v <= rng.kmh_max;
}

function highwayCands(pos, data, r) {
  const out = [];
  if (!pos || !pos.on_line || !pos.line || !isNum(pos.km)) return out;
  const key = pos.dir === r.dir_words.forward ? r.fwd_key : pos.dir === r.dir_words.backward ? r.back_key : null;
  if (!key) return out; // 방향을 모르면(선과 엇갈림·멈춤) 고속도로 값을 짐작하지 않는다
  const hw = data[r.highway_key];
  const secs = hw && Array.isArray(hw[r.sections_key]) ? hw[r.sections_key] : [];
  for (const s of secs) {
    if (s.line !== pos.line || !(pos.km >= s.from_km && pos.km < s.to_km)) continue;
    out.push({ src: r.src_words.highway, kmh: s[key], id: s.line + r.cell.sep + s.from_km });
  }
  return out;
}

function roadCands(fix, data, r, lib) {
  const out = [];
  const cells = data[r.cells_key] || {};
  const geo = lib.parts[r.geo_part];
  const g = lib.rules[r.geo_rule];
  if (!geo || !g) throw new TypeError(r.geo_part);
  const head = isNum(fix.heading_deg) ? fix.heading_deg : null;
  const seen = new Set();
  for (const key of cellsAround(fix.lat, fix.lng, r, r.cell.match_ring)) {
    const cell = cells[key];
    const segs = cell && Array.isArray(cell[r.segs_key]) ? cell[r.segs_key] : [];
    for (const seg of segs) {
      if (seen.has(seg.id)) continue; // 칸 둘에 걸친 조각은 한 번만
      const b = seg.box;
      if (b && (fix.lat < b.lat0 - r.road_box_deg || fix.lat > b.lat1 + r.road_box_deg || fix.lng < b.lng0 - r.road_box_deg || fix.lng > b.lng1 + r.road_box_deg)) continue;
      const s = geo.snap({ lat: fix.lat, lng: fix.lng }, seg.pts, g);
      if (s.off_m > r.road_dist_m) continue;
      if (head !== null) {
        const d = geo.angleDiff(head, s.bearing_deg, g);
        const along = d <= r.road_dir_max_deg;
        const against = seg.both && d >= g.half_turn_deg - r.road_dir_max_deg;
        if (!along && !against) continue;
      }
      seen.add(seg.id);
      out.push({ src: r.src_words.road, kmh: seg.kmh, id: seg.id });
    }
  }
  return out;
}

export function limitOf(inputs, done, r, lib, own) {
  const fix = inputs[r.fix_input];
  if (!fix) return own || null;
  if (!isNum(fix.lat) || !isNum(fix.lng)) throw new TypeError(r.fix_input);
  const base = { t: fix.t, kmh: null, src: null, why: null, n: 0 };
  const data = inputs[r.data_input];
  if (!data) return { ...base, why: r.why_words.no_data };
  const rr = lib.rules[r.range_rule];
  if (!rr || !rr.limit) throw new TypeError(r.range_rule);
  const all = [...highwayCands(done[r.pos_piece], data, r), ...roadCands(fix, data, r, lib)];
  const good = all.filter((c) => okKmh(c.kmh, rr.limit)); // 0·빈 값·범위 밖 = 그 후보는 '없음'
  if (!good.length) return { ...base, why: r.why_words.none, n: all.length };
  const vals = [...new Set(good.map((c) => c.kmh))];
  if (vals.length > 1) return { ...base, why: r.why_words.split, n: good.length };
  const srcs = [...new Set(good.map((c) => c.src))];
  return { ...base, kmh: vals[0], src: srcs.length === 1 ? srcs[0] : r.src_words.both, why: r.why_words.found, n: good.length };
}
