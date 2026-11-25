// 순수: 거리·선 붙이기 한 벌(설계 원칙 '중복 최소화' — Geo 하나). FixCheck·Locate·Speed 가 인자로 받아 쓴다.
// 값(지구 반지름·각도 바꿈 값·한 바퀴 각도·m↔km)은 규칙 g = config_geo 로 받는다. 로그 없음, 틀린 입력은 던진다.
export const NEEDS = [];

function num(v, name) {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new TypeError(name);
  return v;
}

// 두 점 사이 거리(m). a·b = {lat, lng}. 구면 코사인 법칙(작은 거리도 m 아래 오차 — 반올림을 0~1 로 묶음)
export function distM(a, b, g) {
  const k = g.deg_to_rad;
  const p1 = num(a.lat, 'lat') * k;
  const p2 = num(b.lat, 'lat') * k;
  const dl = (num(b.lng, 'lng') - num(a.lng, 'lng')) * k;
  const c = Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(dl);
  return g.earth_radius_m * Math.acos(Math.min(1, Math.max(-1, c)));
}

// 방향 각도(도, 0 이상 한 바퀴 미만)로 맞춤
export function normDeg(d, g) {
  const t = g.full_turn_deg;
  return ((num(d, 'deg') % t) + t) % t;
}

// 두 방향 사이 각도(도, 0 ~ 반 바퀴)
export function angleDiff(a, b, g) {
  const d = Math.abs(normDeg(a, g) - normDeg(b, g));
  return Math.min(d, g.full_turn_deg - d);
}

// 점 p 를 선(꼭짓점 [[위도, 경도]…])에 붙인다 → {km: 선 첫 점부터 선을 따라 잰 거리, off_m: 선에서 떨어진 거리,
// bearing_deg: 붙은 조각의 방향, seg: 조각 번호, lat·lng: 붙은 자리}. 조각 안의 비율은 점 둘레의 평면 근사로 셈한다
export function snap(p, points, g) {
  if (!Array.isArray(points) || points.length < g.min_line_points) throw new TypeError('points');
  num(p.lat, 'lat');
  num(p.lng, 'lng');
  const k = g.deg_to_rad;
  const cos = Math.cos(p.lat * k);
  const xy = (q) => [num(q[1], 'lng') * k * cos, num(q[0], 'lat') * k];
  const [px, py] = xy([p.lat, p.lng]);
  let best = null;
  let along = 0;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const [ax, ay] = xy(a);
    const [bx, by] = xy(b);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    const segM = distM({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] }, g);
    const on = { lat: a[0] + (b[0] - a[0]) * t, lng: a[1] + (b[1] - a[1]) * t };
    const off = distM(p, on, g);
    if (!best || off < best.off_m) {
      best = {
        off_m: off,
        km: (along + segM * t) / g.m_per_km,
        bearing_deg: normDeg(Math.atan2(dx, dy) * g.rad_to_deg, g),
        seg: i,
        lat: on.lat,
        lng: on.lng,
      };
    }
    along += segM;
  }
  return best;
}
