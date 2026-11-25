// 순수: 경로 따라 앞의 충전소(설계 5-8 가-6 '경로가 있으면 경로 위 차례로 센다 — 고속도로를 갈아타는 곳 너머까지' · 5-1 navi).
// Ahead 가 같은 셈에서 route(naviroute 가 바꾼 노선 꼴)가 있을 때 부른다:
//   aheadOnRoute({fix, route, places, lines}, ra = config_ahead, rn = config_navi, rl = config_locate, geo, g) → {my_km, off_m, items} | null(경로에서 벗어남)
//   · 내 위치를 경로 선에 붙여 경로 km(my_km)를 셈 — rn.off_route_m 보다 멀면 null(부르는 쪽이 선·주변 셈으로 돌아감)
//   · 휴게소 자리마다 경로 선에 붙여(rn.station_route_m 안) 그 자리의 경로 방향이 휴게소 방향과 맞는 곳만(경로가 그 선을 같은 쪽으로 지날 때) 경로 km 차례로
//   · 경로 위에서 모자라면 경로 끝의 고속도로를 끝 방향으로 이어서 채운다(rn.fill_after_end — 도착지 너머 그 선의 휴게소, 거리 = 남은 경로 + 끝에서)
//   items = [{key, ids, name, ops, rest, dir, line, km, dist_km, straight:false, lat, lng, on_route}] — 번호는 부르는 쪽이 붙인다.
// 로그 없음, 틀린 입력은 던진다.
export const NEEDS = [];

const projCache = new WeakMap();

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

// 휴게소 자리의 방향(선 방향·거꾸로)으로 그 선을 따라갈 때의 진행 방향 각도 — 선에 붙인 조각의 방향(거꾸로면 반 바퀴 돌림)
function lineBearing(place, lines, rl, geo, g) {
  const ln = lines.find((x) => x && x.name === place.line);
  if (!ln) return null;
  return geo.snap({ lat: place.lat, lng: place.lng }, ln.points, g).bearing_deg;
}

// 경로가 그 자리에서 선을 어느 쪽으로 지나나: 선 방향 / 거꾸로 / 엇갈림(null)
function routeDirAt(routeBearing, lineDeg, rl, geo, g) {
  if (!isNum(lineDeg)) return null;
  const diff = geo.angleDiff(routeBearing, lineDeg, g);
  if (diff <= rl.dir_max_deg) return rl.dir_words.forward;
  if (diff >= g.half_turn_deg - rl.dir_max_deg) return rl.dir_words.backward;
  return null;
}

function dirOk(place, dir, ra) {
  if (!dir) return false;
  return place.dir === dir || (place.dir === null && ra.dir_unknown_keep);
}

// 경로 하나·자리 목록 하나마다 한 번만: 자리마다 경로 km(경로 위 휴게소만)
function onRoutePlaces(route, places, lines, ra, rn, rl, geo, g) {
  let byPlaces = projCache.get(route);
  if (!byPlaces) { byPlaces = new WeakMap(); projCache.set(route, byPlaces); }
  const hit = byPlaces.get(places);
  if (hit) return hit;
  const out = [];
  for (const p of places) {
    if (!p.rest || !isNum(p.lat) || !isNum(p.lng)) continue;
    const s = geo.snap({ lat: p.lat, lng: p.lng }, route.points, g);
    if (s.off_m > rn.station_route_m) continue;
    const dir = routeDirAt(s.bearing_deg, lineBearing(p, lines, rl, geo, g), rl, geo, g);
    if (p.line !== null && !dirOk(p, dir, ra)) continue;
    out.push({ p, route_km: s.km });
  }
  byPlaces.set(places, out);
  return out;
}

// 경로 끝의 고속도로와 끝 방향: 끝 점을 선들에 붙여 rn.end_line_m 안의 가장 가까운 선, 끝 조각의 방향을 그 선 방향과 견줌
function endOf(route, lines, rn, rl, geo, g) {
  const n = route.points.length;
  const endPt = { lat: route.points[n - 1][0], lng: route.points[n - 1][1] };
  const before = route.points[n - 1 - 1];
  const bearing = geo.snap(endPt, [before, route.points[n - 1]], g).bearing_deg;
  let best = null;
  for (const ln of lines) {
    if (!ln || !Array.isArray(ln.points)) continue;
    const s = geo.snap(endPt, ln.points, g);
    if (!best || s.off_m < best.off_m) best = { ...s, line: ln.name };
  }
  if (!best || best.off_m > rn.end_line_m) return null;
  const dir = routeDirAt(bearing, best.bearing_deg, rl, geo, g);
  return dir ? { line: best.line, km: best.km, dir } : null;
}

function item(p, distKm, onRoute, ra) {
  const k = ra.km_round;
  return {
    key: p.key, ids: p.ids, name: p.name, ops: p.ops, rest: p.rest, dir: p.dir, line: p.line,
    km: isNum(p.km) ? Math.round(p.km * k) / k : null, dist_km: Math.round(Math.max(0, distKm) * k) / k,
    straight: false, lat: p.lat, lng: p.lng, on_route: onRoute,
  };
}

export function aheadOnRoute(input, ra, rn, rl, geo, g) {
  const { fix, route, places, lines } = input;
  if (!fix || !isNum(fix.lat) || !isNum(fix.lng)) throw new TypeError(ra.fix_input);
  if (!route || !Array.isArray(route.points) || route.points.length < g.min_line_points) throw new TypeError(rn.route_piece);
  if (!Array.isArray(places)) throw new TypeError(ra.list_key);
  const ls = Array.isArray(lines) ? lines : [];
  const me = geo.snap({ lat: fix.lat, lng: fix.lng }, route.points, g);
  if (me.off_m > rn.off_route_m) return null;
  const front = onRoutePlaces(route, places, ls, ra, rn, rl, geo, g)
    .map((x) => ({ p: x.p, rem: x.route_km - me.km }))
    .filter((x) => x.rem >= -ra.pass_margin_km)
    .sort((a, b) => a.rem - b.rem)
    .slice(0, ra.count)
    .map((x) => item(x.p, x.rem, true, ra));
  if (front.length < ra.count && rn.fill_after_end) {
    const end = endOf(route, ls, rn, rl, geo, g);
    if (end) {
      const taken = new Set(front.map((x) => x.key));
      const sign = end.dir === rl.dir_words.forward ? 1 : -1;
      const left = route.km[route.km.length - 1] - me.km;
      const more = places
        .filter((p) => p.rest && p.line === end.line && isNum(p.km) && !taken.has(p.key) && dirOk(p, end.dir, ra))
        .map((p) => ({ p, rem: sign * (p.km - end.km) }))
        .filter((x) => x.rem > rn.end_pass_km)
        .sort((a, b) => a.rem - b.rem)
        .slice(0, ra.count - front.length)
        .map((x) => item(x.p, left + x.rem, false, ra));
      front.push(...more);
    }
  }
  return { my_km: me.km, off_m: me.off_m, items: front };
}
