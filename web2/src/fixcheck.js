// 순수: 받은 위치 검사(설계 5-1-나 FixCheck · 1부 0-3). LocationClient 가 들어오는 자리에서 부른다.
// 좌표 범위 · 음수·너무 큰 속도 · 정확도 · 진행 방향 범위 · 시각 거꾸로 · 튐(앞 위치에서 속도로 갈 수 있는 거리보다 멂).
// 값은 규칙 r = config_fixcheck, 거리는 인자로 받은 Geo(lib.geo, 규칙 lib.g). 로그 없음 — 결과 {ok, why, detail} 만 돌려준다.
// ctx = {last: 앞에서 받아들인 위치 | null, rejects: 그 뒤 잇달아 거른 수}. 잇달아 r.reset_after 번 거르면 튐·시각 검사 없이 새 기준으로 받는다
// (터널을 나왔을 때처럼 정말 멀리 온 경우 영영 거르지 않게).
export const NEEDS = [];

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function bad(why, detail) {
  return { ok: false, why, detail };
}

export function check(fix, ctx, r, lib) {
  if (!fix || !isNum(fix.lat) || !isNum(fix.lng)) return bad(r.codes.range, null);
  if (fix.lat < r.lat_min || fix.lat > r.lat_max || fix.lng < r.lng_min || fix.lng > r.lng_max) return bad(r.codes.range, null);
  if (fix.speed_kmh !== null && fix.speed_kmh !== undefined) {
    if (!isNum(fix.speed_kmh) || fix.speed_kmh < r.speed_min_kmh) return bad(r.codes.speed_neg, fix.speed_kmh);
    if (fix.speed_kmh > r.speed_max_kmh) return bad(r.codes.speed_high, fix.speed_kmh);
  }
  if (fix.accuracy_m !== null && fix.accuracy_m !== undefined && (!isNum(fix.accuracy_m) || fix.accuracy_m > r.accuracy_max_m)) {
    return bad(r.codes.accuracy, fix.accuracy_m);
  }
  if (fix.heading_deg !== null && fix.heading_deg !== undefined
    && (!isNum(fix.heading_deg) || fix.heading_deg < r.heading_min_deg || fix.heading_deg > r.heading_max_deg)) {
    return bad(r.codes.heading, fix.heading_deg);
  }
  const last = ctx && ctx.last;
  if (!last || (ctx.rejects || 0) >= r.reset_after) return { ok: true, why: null, detail: null };
  if (!isNum(fix.t) || !isNum(last.t)) return { ok: true, why: null, detail: null };
  if (fix.t < last.t) return bad(r.codes.time_back, last.t - fix.t);
  const dtS = (fix.t - last.t) / r.ms_per_s;
  const moved = lib.geo.distM(last, fix, lib.g);
  const speeds = [fix.speed_kmh, last.speed_kmh].filter(isNum);
  const kmh = speeds.length ? Math.max(...speeds) : r.speed_max_kmh;
  const slack = r.jump_slack_m + (isNum(fix.accuracy_m) ? fix.accuracy_m : r.accuracy_unknown_m)
    + (isNum(last.accuracy_m) ? last.accuracy_m : r.accuracy_unknown_m);
  const reach = kmh * r.kmh_to_mps * dtS + slack;
  if (moved > reach) return bad(r.codes.jump, Math.round(moved));
  return { ok: true, why: null, detail: null };
}
