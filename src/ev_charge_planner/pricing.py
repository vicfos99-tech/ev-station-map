"""실제 가격: 구독·할인카드 중 더 큰 할인 하나만 적용 (docs/plan.md 5절 p4_pricing)."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from .models import ChargerType, Station, User


@dataclass
class PriceQuote:
    base_price: float
    final_price: float
    subscription_applicable: bool
    applicable_cards: list[str]
    applied: Optional[str]


def quote(station: Station, rest_area_id: str, user: User,
          charger_type: ChargerType = ChargerType.FAST) -> PriceQuote:
    if not isinstance(charger_type, ChargerType):
        raise ValueError(f"charger_type 은 ChargerType 이어야 한다: {charger_type!r}")

    base = float(station.price_per_kwh)
    sub = user.subscription
    sub_ok = (
        sub is not None
        and station.operator == sub.operator
        and charger_type == ChargerType.FAST
        and rest_area_id not in sub.excluded_rest_area_ids
    )
    cards = [c for c in user.cards
             if c.operators is None or station.operator in c.operators]

    # 후보: 구독 먼저, 그다음 카드 순서. 할인율이 엄격히 더 클 때만 교체하므로 동률은 앞선 것이 남는다.
    best_name: Optional[str] = None
    best_rate = 0.0
    if sub_ok:
        best_name, best_rate = "subscription", sub.rate
    for c in cards:
        if best_name is None or c.rate > best_rate:
            best_name, best_rate = c.name, c.rate

    final = base if best_name is None else base * (1 - best_rate)
    return PriceQuote(
        base_price=base,
        final_price=final,
        subscription_applicable=bool(sub_ok),
        applicable_cards=[c.name for c in cards],
        applied=best_name,
    )
