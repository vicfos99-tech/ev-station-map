// 순수: 충전소 고르기 엔진의 한 조각(정비 나 ③ — engine.js 를 일 단위로 나눔. 본문은 옛 engine.js 그대로, 계산 차례·부동소수 결과 같음). 로그 없음.
// 일: 추천(p6 recommend — 점수·첫째·예비).
import { alertOf } from './engine_model.js';
import { km_per_pct } from './engine_range.js';

export const NEEDS = [];

// 점수 = 빈 급속 수 단계 + 도착 여유 단계 + 신선함(규칙 r.score)
export function score_candidate(entry, vehicle, r) {
  const sc = r.score;
  const usable = entry.status.usable_fast;
  const c = usable <= sc.usable_low ? 0 : usable === sc.usable_mid ? 1 : sc.usable_top_points;
  const margin = entry.arrival_soc_pct - vehicle.min_arrival_soc_pct;
  const m = margin < sc.margin_low ? 0 : margin < sc.margin_mid ? 1 : sc.margin_top_points;
  const f = entry.status.is_stale ? 0 : 1;
  return c + m + f;
}
function pick(ra, entry, score) {
  return {
    rest_area_id: ra.rest_area_id,
    rest_area_name: ra.name,
    station_id: entry.station_id,
    operator: entry.operator,
    is_nearby: entry.is_nearby,
    detour_km: entry.detour_km,
    remaining_km: entry.remaining_km,
    arrival_soc_pct: entry.arrival_soc_pct,
    score,
    final_price: entry.quote.final_price,
  };
}
export function recommend(route_list, vehicle, r) {
  // 안 충전소 → 나들목 인근, 휴게소 순서대로 (입력 순서가 동률의 기준)
  const all = [];
  for (const ra of route_list.entries) for (const e of [...ra.stations, ...ra.nearby]) all.push([ra, e]);
  for (const [, e] of all) e.role = null;

  const ranked = all.filter(([, e]) => e.is_candidate).map(([ra, e]) => ({ ra, e, score: score_candidate(e, vehicle, r) }));
  // Array.prototype.sort 는 안정 정렬 (파이썬 sort 와 같다)
  ranked.sort((a, b) => (b.score - a.score)
    || (a.e.quote.final_price - b.e.quote.final_price)
    || (a.e.remaining_km - b.e.remaining_km)
    || ((a.e.is_nearby ? 1 : 0) - (b.e.is_nearby ? 1 : 0)));

  if (ranked.length === 0) {
    return { status: r.reco.none, primary: null, backup: null, alerts: [alertOf(r.alert.no_safe_station, r.texts.no_safe_station)] };
  }
  const { ra: p_ra, e: p_entry, score: p_score } = ranked[0];
  p_entry.role = r.roles.primary;
  const primary = pick(p_ra, p_entry, p_score);

  const round_trip_pct = p_entry.detour_km / km_per_pct(vehicle, r);
  let backup = null;
  for (const { ra, e, score } of ranked.slice(1)) {
    if (ra.rest_area_id === p_ra.rest_area_id) continue;
    if (!(ra.remaining_km > p_ra.remaining_km)) continue;
    if (e.arrival_soc_pct - round_trip_pct + r.tolerance < vehicle.min_arrival_soc_pct) continue;
    e.role = r.roles.backup;
    backup = pick(ra, e, score);
    break;
  }
  const alerts = backup ? [] : [alertOf(r.alert.no_backup, r.texts.no_backup)];
  return { status: r.reco.ok, primary, backup, alerts };
}
