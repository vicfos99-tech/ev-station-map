// 순수: 집 PC 중계 서버의 답(우리 모양 — 설계 5-5 (1))을 들어오는 자리에서 검사하고(5-7 (1) RouteClient 줄), 길 답을 노선 꼴로 바꾼다(5-1 naviroute · 5-8 바 2).
//   checkPlaces(data, r) → {source, places: [{kind, name, addr, lat, lng}]} — 판·ok·칸 이름(모르는 칸은 무시하지 않고 거절)·좌표 범위·글 길이·개수 한도. 틀리면 던진다
//   checkRoute(data, r)  → {source, at, stored_at, dist_km, pieces: [{road, line: [[위도, 경도]…], km}]} — 같은 검사 + 조각 수·점 수 한도. 틀리면 던진다
//   routeOf(inputs, done, r, lib, own) → route 조각 | null — StateCalc 표 한 줄(입력 route.answer·route.clear). 같은 셈의 앞 결과를 쓰지 않는다.
//     route = {seq, dest: {name, lat, lng}, source, at, stored_at, dist_km, total_km, points: [[위도, 경도]…], km: [첫 점부터 누적 km…], roads: [{road, from_km, to_km}]}
//     지우기(route.clear 의 seq 가 답의 seq 이상)면 null — 지운 뒤 늦게 온 앞 물음의 답도 그리지 않는다.
// 값(판 번호·칸 이름 목록·한도·좌표 범위)은 규칙 r = config_naviroute. 로그 없음.
export const NEEDS = [];

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function bad(why) {
  return new TypeError(why);
}

function onlyKeys(obj, allowed, where) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw bad(where);
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) throw bad(where + ':' + k);
}

// 글 칸: 글이고, 길이 한도 안이고, 막을 글자(제어 문자 — 설정 무늬)가 없어야 한다
function text(v, r, max, where, mayEmpty) {
  if (typeof v !== 'string' || [...v].length > max || (!mayEmpty && !v.length)) throw bad(where);
  if (new RegExp(r.ctrl_re).test(v)) throw bad(where);
  return v;
}

function latlng(v, r, where) {
  if (!Array.isArray(v) || v.length !== r.latlng_len) throw bad(where);
  const lat = v[0];
  const lng = v[1];
  if (!isNum(lat) || !isNum(lng) || lat < r.lat_min || lat > r.lat_max || lng < r.lng_min || lng > r.lng_max) throw bad(where);
  return [lat, lng];
}

function head(data, r, allowed) {
  onlyKeys(data, allowed, r.words.answer);
  if (data[r.v_key] !== r.v) throw bad(r.v_key);
  if (data[r.ok_key] !== true) throw bad(r.ok_key);
  const source = data[r.source_key];
  if (!r.sources.includes(source)) throw bad(r.source_key);
  return source;
}

function stamp(v, r, key) {
  if (v === null || v === undefined) return null;
  return text(v, r, r.at_max_chars, key, false);
}

export function checkPlaces(data, r) {
  const source = head(data, r, r.place_answer_keys);
  const list = data[r.places_key];
  if (!Array.isArray(list) || list.length > r.max_places) throw bad(r.places_key);
  const places = list.map((p, i) => {
    const w = r.places_key + ':' + i;
    onlyKeys(p, r.place_keys, w);
    if (!r.place_kinds.includes(p.kind)) throw bad(w + ':kind');
    const name = text(p.name, r, r.text_max_chars, w + ':name', false);
    const addr = p.addr === undefined || p.addr === null ? '' : text(p.addr, r, r.text_max_chars, w + ':addr', true);
    const [lat, lng] = latlng(p.loc, r, w + ':loc');
    return { kind: p.kind, name, addr, lat, lng };
  });
  return { source, places };
}

export function checkRoute(data, r) {
  const source = head(data, r, r.route_answer_keys);
  const pieces = data[r.pieces_key];
  if (!Array.isArray(pieces) || !pieces.length || pieces.length > r.max_pieces) throw bad(r.pieces_key);
  let total = 0;
  const out = pieces.map((pc, i) => {
    const w = r.pieces_key + ':' + i;
    onlyKeys(pc, r.piece_keys, w);
    const road = pc.road === undefined || pc.road === null ? '' : text(pc.road, r, r.text_max_chars, w + ':road', true);
    if (!Array.isArray(pc.line) || pc.line.length < r.min_line_points) throw bad(w + ':line');
    total += pc.line.length;
    if (total > r.max_points) throw bad(r.pieces_key + ':points');
    const line = pc.line.map((pt, j) => latlng(pt, r, w + ':line:' + j));
    if (!isNum(pc.km) || pc.km < 0 || pc.km > r.max_km) throw bad(w + ':km');
    return { road, line, km: pc.km };
  });
  const dist = data.dist_km;
  if (dist !== undefined && dist !== null && (!isNum(dist) || dist < 0 || dist > r.max_km)) throw bad('dist_km');
  return { source, at: stamp(data.at, r, 'at'), stored_at: stamp(data.stored_at, r, 'stored_at'), dist_km: isNum(dist) ? dist : null, pieces: out };
}

export function routeOf(inputs, done, r, lib, own) {
  const ans = inputs[r.answer_input];
  const clr = inputs[r.clear_input];
  if (!ans) return null;
  if (!isNum(ans.seq)) throw bad(r.answer_input);
  if (clr && isNum(clr.seq) && clr.seq >= ans.seq) return null;
  if (own && own.seq === ans.seq) return own; // 같은 답 — 다시 셈하지 않는다
  const geo = lib.parts[r.geo_part];
  const g = lib.rules[r.geo_rule];
  if (!geo || !g) throw bad(r.geo_part);
  if (!Array.isArray(ans.pieces) || !ans.pieces.length) throw bad(r.pieces_key);
  const points = [];
  const km = [];
  const roads = [];
  let along = 0;
  for (const pc of ans.pieces) {
    const from = along;
    for (const pt of pc.line) {
      const last = points[points.length - 1];
      if (last && last[0] === pt[0] && last[1] === pt[1]) continue; // 조각 이음매의 같은 점
      if (last) along += geo.distM({ lat: last[0], lng: last[1] }, { lat: pt[0], lng: pt[1] }, g) / g.m_per_km;
      points.push([pt[0], pt[1]]);
      km.push(along);
    }
    roads.push({ road: pc.road, from_km: from, to_km: along });
  }
  if (points.length < g.min_line_points) throw bad(r.pieces_key);
  const d = ans.dest || {};
  return {
    seq: ans.seq,
    dest: { name: typeof d.name === 'string' ? d.name : '', lat: isNum(d.lat) ? d.lat : null, lng: isNum(d.lng) ? d.lng : null },
    source: ans.source,
    at: ans.at || null,
    stored_at: ans.stored_at || null,
    dist_km: isNum(ans.dist_km) ? ans.dist_km : along,
    total_km: along,
    points,
    km,
    roads,
  };
}
