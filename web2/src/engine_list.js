// 순수: 충전소 고르기 엔진의 한 조각(정비 나 ③ — engine.js 를 일 단위로 나눔. 본문은 옛 engine.js 그대로, 계산 차례·부동소수 결과 같음). 로그 없음.
// 일: 노선 목록(p5 route_list — 휴게소마다 충전소 줄).
import { ValueError, statusOrder, alertOf } from './engine_model.js';
import { arrival_soc_pct, can_reach } from './engine_range.js';
import { summarize_station, rest_area_alerts } from './engine_status.js';
import { quote } from './engine_price.js';

export const NEEDS = [];

function station_entry(station, rest_area_id, detour_km, is_nearby, rest_remaining_km, vehicle, user, now, stale_minutes, r) {
  const status = summarize_station(station, now, stale_minutes, r);
  const remaining = rest_remaining_km + detour_km;
  const reachable = can_reach(vehicle, remaining, r);
  const alerts = status.alerts.slice();
  if (is_nearby && !reachable) alerts.push(alertOf(r.alert.unreachable, r.texts.unreachable));
  return {
    station_id: station.id,
    operator: station.operator,
    is_nearby,
    detour_km,
    remaining_km: remaining,
    arrival_soc_pct: arrival_soc_pct(vehicle, remaining, r),
    reachable,
    status,
    quote: quote(station, rest_area_id, user, r.charger_type.fast, r),
    is_candidate: reachable && status.usable_fast >= 1,
    alerts,
    role: null,
  };
}

export function build_route_list(route, vehicle, user, now, position_km, stale_minutes, r) {
  if (position_km < 0) throw new ValueError(r.why.position + position_km);
  const order = statusOrder(r);
  const entries = [];
  for (const ra of route.rest_areas) {
    const remaining = ra.distance_km - position_km;
    if (remaining < 0) continue;
    const reachable = can_reach(vehicle, remaining, r);
    const inner = ra.stations.map((s) => station_entry(s, ra.id, 0, false, remaining, vehicle, user, now, stale_minutes, r));
    const near = ra.nearby.map((n) => station_entry(n.station, ra.id, n.detour_km, true, remaining, vehicle, user, now, stale_minutes, r));

    const operators = [];
    for (const e of inner) if (!operators.includes(e.operator)) operators.push(e.operator);
    const applied_cards = new Set();
    for (const e of inner) for (const name of e.quote.applicable_cards) applied_cards.add(name);
    const counts = {};
    for (const s of order) counts[s] = 0;
    for (const e of inner) for (const s of order) counts[s] += e.status.counts[s];
    const prices = inner.filter((e) => e.status.usable_fast >= 1).map((e) => e.quote.final_price);

    const alerts = [];
    if (!reachable) alerts.push(alertOf(r.alert.unreachable, r.texts.unreachable));
    alerts.push(...rest_area_alerts(inner.map((e) => e.status), r));

    let usable_fast = 0;
    let waiting_fast = 0;
    for (const e of inner) { usable_fast += e.status.usable_fast; waiting_fast += e.status.waiting_fast; }
    entries.push({
      rest_area_id: ra.id,
      name: ra.name,
      distance_km: ra.distance_km,
      remaining_km: remaining,
      arrival_soc_pct: arrival_soc_pct(vehicle, remaining, r),
      reachable,
      stations: inner,
      nearby: near,
      operators,
      subscription_applicable: inner.some((e) => e.quote.subscription_applicable),
      applicable_cards: user.cards.filter((c) => applied_cards.has(c.name)).map((c) => c.name),
      status_counts: counts,
      usable_fast,
      waiting_fast,
      lowest_price: prices.length ? Math.min(...prices) : null,
      alerts,
    });
  }
  return { highway: route.highway, direction: route.direction, entries };
}
