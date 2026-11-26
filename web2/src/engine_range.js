// 순수: 충전소 고르기 엔진의 한 조각(정비 나 ③ — engine.js 를 일 단위로 나눔. 본문은 옛 engine.js 그대로, 계산 차례·부동소수 결과 같음). 로그 없음.
// 일: 갈 수 있는 거리(p2 driving_range).
import { ValueError } from './engine_model.js';

export const NEEDS = [];

export function conservative_range_km(v, r) {
  return v.soc_pct / r.pct * v.battery_kwh * v.efficiency_km_per_kwh * (1 - v.safety_margin_ratio);
}
export function km_per_pct(v, r) {
  return v.battery_kwh * v.efficiency_km_per_kwh * (1 - v.safety_margin_ratio) / r.pct;
}
export function arrival_soc_pct(v, distance_km, r) {
  if (distance_km < 0) throw new ValueError(r.why.distance + distance_km);
  return v.soc_pct - distance_km / km_per_pct(v, r);
}
export function can_reach(v, distance_km, r) {
  return arrival_soc_pct(v, distance_km, r) >= v.min_arrival_soc_pct - r.tolerance;
}
