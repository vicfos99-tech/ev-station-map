// 순수: 충전소 고르기 엔진의 한 조각(정비 나 ③ — engine.js 를 일 단위로 나눔. 본문은 옛 engine.js 그대로, 계산 차례·부동소수 결과 같음). 로그 없음.
// 일: 요금(p4 pricing — 구독·카드 할인).
import { ValueError, chargerTypes } from './engine_model.js';

export const NEEDS = [];

export function quote(station, rest_area_id, user, charger_type, r) {
  if (!chargerTypes(r).includes(charger_type)) throw new ValueError(r.why.charger_type + charger_type);
  const base = station.price_per_kwh;
  const sub = user.subscription;
  const sub_ok = sub !== null
    && station.operator === sub.operator
    && charger_type === r.charger_type.fast
    && !sub.excluded_rest_area_ids.includes(rest_area_id);
  const cards = user.cards.filter((c) => c.operators === null || c.operators.includes(station.operator));
  // 후보: 구독 먼저, 그다음 카드 순서. 할인율이 엄격히 더 클 때만 교체하므로 동률은 앞선 것이 남는다.
  let best_name = null;
  let best_rate = 0;
  if (sub_ok) { best_name = r.subscription_word; best_rate = sub.rate; }
  for (const c of cards) {
    if (best_name === null || c.rate > best_rate) { best_name = c.name; best_rate = c.rate; }
  }
  const final = best_name === null ? base : base * (1 - best_rate);
  return {
    base_price: base,
    final_price: final,
    subscription_applicable: sub_ok,
    applicable_cards: cards.map((c) => c.name),
    applied: best_name,
  };
}
