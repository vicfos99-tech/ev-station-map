// 순수: 충전소 고르기 엔진의 한 조각(정비 나 ③ — engine.js 를 일 단위로 나눔. 본문은 옛 engine.js 그대로, 계산 차례·부동소수 결과 같음). 로그 없음.
// 일: 충전기 상태 요약·휴게소 알림(p3 status).
import { ValueError, statusOrder, say, fmtG, alertOf } from './engine_model.js';

export const NEEDS = [];

export function summarize_station(station, now, stale_minutes, r) {
  if (stale_minutes < 0) throw new ValueError(r.why.stale + stale_minutes);
  const S = r.status;
  const counts = {};
  for (const s of statusOrder(r)) counts[s] = 0;
  let usable_fast = 0;
  let waiting_fast = 0;
  let usable_slow = 0;
  let unusable = 0;
  for (const c of station.chargers) {
    counts[c.status] += 1;
    if (r.unusable_statuses.includes(c.status)) {
      unusable += 1;
    } else if (c.type === r.charger_type.fast) {
      if (c.status === S.available) usable_fast += 1;
      else if (c.status === S.charging) waiting_fast += 1;
    } else if (c.status === S.available) {
      usable_slow += 1;
    }
  }
  const is_stale = now - station.status_updated_at > stale_minutes * r.ms_per_minute;
  const alerts = [];
  if (is_stale) alerts.push(alertOf(r.alert.stale_info, say(r.texts.stale_info, r, fmtG(stale_minutes, r))));
  if (unusable >= 1) alerts.push(alertOf(r.alert.unusable_chargers, say(r.texts.unusable_chargers, r, unusable)));
  return { counts, usable_fast, waiting_fast, usable_slow, unusable, is_stale, alerts };
}
export function rest_area_alerts(statuses, r) {
  let usable = 0;
  let fast = 0;
  for (const s of statuses) { usable += s.usable_fast + s.usable_slow; fast += s.usable_fast; }
  if (usable === 0) return [alertOf(r.alert.all_unavailable, r.texts.all_unavailable)];
  if (fast === 0) return [alertOf(r.alert.no_usable_fast, r.texts.no_usable_fast)];
  return [];
}
