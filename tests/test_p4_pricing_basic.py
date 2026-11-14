"""p4_pricing 통과 기준 테스트 (docs/plan.md 5절 p4_pricing, 256~279행).

구현 전에는 실패하는 것이 정상이다. 수집 오류가 나지 않도록
pricing 모듈은 모듈 맨 위가 아니라 각 테스트 안에서 불러온다.
갱신 시각은 2026-01-01 11:50 (3.2절, 작업일과 먼 고정값). 가격 계산에는 쓰이지 않는다.
"""
import copy
import dataclasses
import importlib
from datetime import datetime

import pytest


def pr():
    return importlib.import_module("ev_charge_planner.pricing")


def m():
    return importlib.import_module("ev_charge_planner")


def station(operator, price, sid="s1", charger_type=None):
    mm = m()
    kind = mm.ChargerType.FAST if charger_type is None else charger_type
    return mm.Station(
        id=sid,
        operator=operator,
        chargers=[mm.Charger(type=kind, power_kw=100.0, status=mm.ChargerStatus.AVAILABLE)],
        price_per_kwh=price,
        status_updated_at=datetime(2026, 1, 1, 11, 50),
    )


def sub(operator="별빛차지", rate=0.2, excluded=frozenset({"ra4"})):
    return m().Subscription(operator=operator, rate=rate, excluded_rest_area_ids=excluded)


def card(name="그린카드", rate=0.1, operators=None):
    return m().DiscountCard(name=name, rate=rate, operators=operators)


def user_u():
    """4.1절 사용자 U: 구독 별빛차지 20 % 제외 {ra4}, 그린카드 10 % 모든 업체."""
    return m().User(subscription=sub(), cards=[card()])


def quote(st, ra, user, *args, **kw):
    return pr().quote(st, ra, user, *args, **kw)


# ---------------------------------------------------------------- 기준 1~4: 사용자 U

def test_1_subscription_wins_at_ra1_fast():
    q = quote(station("별빛차지", 350.0), "ra1", user_u(), m().ChargerType.FAST)
    assert isinstance(q, pr().PriceQuote)
    assert q.base_price == pytest.approx(350.0)
    assert q.final_price == pytest.approx(280.0)
    assert q.applied == "subscription"
    assert q.subscription_applicable is True
    assert q.applicable_cards == ["그린카드"]


def test_1_default_charger_type_is_fast():
    """charger_type 을 생략하면 FAST (plan 263행 기본값)."""
    q = quote(station("별빛차지", 350.0), "ra1", user_u())
    assert q.final_price == pytest.approx(280.0)
    assert q.applied == "subscription"
    assert q.subscription_applicable is True


def test_2_other_operator_gets_card():
    q = quote(station("한빛이브이", 320.0), "ra2", user_u())
    assert q.base_price == pytest.approx(320.0)
    assert q.final_price == pytest.approx(288.0)
    assert q.applied == "그린카드"
    assert q.subscription_applicable is False
    assert q.applicable_cards == ["그린카드"]


def test_3_excluded_rest_area_gets_card():
    q = quote(station("별빛차지", 400.0), "ra4", user_u())
    assert q.final_price == pytest.approx(360.0)
    assert q.applied == "그린카드"
    assert q.subscription_applicable is False
    assert q.applicable_cards == ["그린카드"]


def test_4_slow_charger_no_subscription():
    mm = m()
    q = quote(station("별빛차지", 350.0, charger_type=mm.ChargerType.SLOW), "ra1",
              user_u(), mm.ChargerType.SLOW)
    assert q.final_price == pytest.approx(315.0)
    assert q.applied == "그린카드"
    assert q.subscription_applicable is False
    assert q.applicable_cards == ["그린카드"]


def test_4_slow_excluded_by_argument_not_by_station_chargers():
    """구독 적용은 인자 charger_type 으로 판정한다(plan 264행). 충전소에 급속이 있어도 SLOW 면 안 됨."""
    q = quote(station("별빛차지", 350.0), "ra1", user_u(), m().ChargerType.SLOW)
    assert q.subscription_applicable is False
    assert q.applied == "그린카드"


# ---------------------------------------------------------------- 기준 5: 할인 없음

def test_5_user_without_discounts():
    q = quote(station("별빛차지", 350.0), "ra1", m().User())
    assert q.base_price == pytest.approx(350.0)
    assert q.final_price == pytest.approx(350.0)
    assert q.applied is None
    assert q.applicable_cards == []
    assert q.subscription_applicable is False


def test_5_subscription_only_but_not_applicable_gives_base():
    """구독만 있고 제외 휴게소 → 후보가 비어 applied None, final = base (plan 266행)."""
    q = quote(station("별빛차지", 400.0), "ra4", m().User(subscription=sub()))
    assert q.final_price == pytest.approx(400.0)
    assert q.applied is None
    assert q.applicable_cards == []
    assert q.subscription_applicable is False


def test_5_subscription_only_applicable():
    q = quote(station("별빛차지", 350.0), "ra1", m().User(subscription=sub()))
    assert q.final_price == pytest.approx(280.0)
    assert q.applied == "subscription"
    assert q.applicable_cards == []


def test_subscription_operator_mismatch():
    """구독 업체와 충전소 업체가 다르면 구독 불가 (plan 264행)."""
    u = m().User(subscription=sub(operator="한빛이브이", excluded=frozenset()))
    q = quote(station("별빛차지", 350.0), "ra1", u)
    assert q.subscription_applicable is False
    assert q.applied is None
    assert q.final_price == pytest.approx(350.0)


# ---------------------------------------------------------------- 기준 6: 큰 할인 하나만, 동률은 구독

def test_6_tie_prefers_subscription():
    u = m().User(subscription=sub(rate=0.1), cards=[card(rate=0.1)])
    q = quote(station("별빛차지", 350.0), "ra1", u)
    assert q.applied == "subscription"
    assert q.final_price == pytest.approx(315.0)
    assert q.subscription_applicable is True
    assert q.applicable_cards == ["그린카드"]


def test_6_bigger_card_beats_subscription():
    u = m().User(subscription=sub(rate=0.2), cards=[card(name="골드카드", rate=0.3)])
    q = quote(station("별빛차지", 350.0), "ra1", u)
    assert q.applied == "골드카드"
    assert q.final_price == pytest.approx(245.0)
    # 구독은 적용 안 됐어도 '적용 가능'이다
    assert q.subscription_applicable is True
    assert q.applicable_cards == ["골드카드"]


def test_6_no_stacking():
    """중복 적용 없음 (plan 267행): 0.2 와 0.1 을 겹치면 252 또는 245 가 되지만 답은 280."""
    q = quote(station("별빛차지", 350.0), "ra1", user_u())
    assert q.final_price == pytest.approx(280.0)
    assert q.final_price != pytest.approx(252.0)
    assert q.final_price != pytest.approx(245.0)


def test_6_rate_is_multiplicative():
    """final = base × (1 − rate) (plan 266행). base − rate 나 base × rate 가 아님."""
    u = m().User(cards=[card(rate=0.25)])
    q = quote(station("한빛이브이", 1000.0), "ra1", u)
    assert q.final_price == pytest.approx(750.0)


def test_6_tie_between_cards_prefers_earlier_card():
    """카드끼리 동률이면 사용자 카드 순서에서 앞선 것 (plan 266행)."""
    u = m().User(cards=[card(name="앞카드", rate=0.15), card(name="뒤카드", rate=0.15)])
    q = quote(station("한빛이브이", 400.0), "ra2", u)
    assert q.applied == "앞카드"
    assert q.final_price == pytest.approx(340.0)


# ---------------------------------------------------------------- 기준 7: 카드 업체 제한

def test_7_card_limited_to_other_operator():
    u = m().User(cards=[card(name="카드", rate=0.1, operators={"한빛이브이"})])
    q1 = quote(station("별빛차지", 350.0), "ra1", u)
    assert q1.applicable_cards == []
    assert q1.applied is None
    assert q1.final_price == pytest.approx(350.0)

    q2 = quote(station("한빛이브이", 320.0), "ra2", u)
    assert q2.applicable_cards == ["카드"]
    assert q2.applied == "카드"
    assert q2.final_price == pytest.approx(288.0)


def test_7_empty_operators_applies_nowhere():
    u = m().User(cards=[card(name="카드", rate=0.1, operators=frozenset())])
    for op in ["별빛차지", "한빛이브이", "초록전력"]:
        q = quote(station(op, 300.0), "ra1", u)
        assert q.applicable_cards == []
        assert q.applied is None
        assert q.final_price == pytest.approx(300.0)


def test_7_restricted_bigger_card_not_used_elsewhere():
    """적용 안 되는 카드의 큰 할인율이 선택되면 안 된다."""
    u = m().User(cards=[card(name="작은카드", rate=0.1),
                        card(name="큰카드", rate=0.5, operators={"한빛이브이"})])
    q = quote(station("별빛차지", 300.0), "ra1", u, m().ChargerType.SLOW)
    assert q.applicable_cards == ["작은카드"]
    assert q.applied == "작은카드"
    assert q.final_price == pytest.approx(270.0)


# ---------------------------------------------------------------- 기준 8: 카드 두 장

def test_8_two_cards_order_and_bigger_applied():
    u = m().User(cards=[card(name="첫카드", rate=0.1), card(name="둘째카드", rate=0.15)])
    q = quote(station("한빛이브이", 400.0), "ra2", u)
    assert q.applicable_cards == ["첫카드", "둘째카드"]
    assert q.applied == "둘째카드"
    assert q.final_price == pytest.approx(340.0)


def test_8_two_cards_reverse_order_kept():
    u = m().User(cards=[card(name="둘째카드", rate=0.15), card(name="첫카드", rate=0.1)])
    q = quote(station("한빛이브이", 400.0), "ra2", u)
    assert q.applicable_cards == ["둘째카드", "첫카드"]
    assert q.applied == "둘째카드"


# ---------------------------------------------------------------- 기준 9: 경계와 잘못된 입력

def test_9_zero_base_price():
    q = quote(station("별빛차지", 0.0), "ra1", user_u())
    assert q.base_price == pytest.approx(0.0)
    assert q.final_price == pytest.approx(0.0)
    assert q.applied == "subscription"


@pytest.mark.parametrize("bad", ["fast", "slow", None, 1])
def test_9_charger_type_not_enum_raises(bad):
    """ChargerType 이 아니면 ValueError (plan 268행). str Enum 이라 'fast' == FAST 지만 거부해야 한다."""
    with pytest.raises(ValueError):
        quote(station("별빛차지", 350.0), "ra1", user_u(), bad)


def test_9_charger_type_string_keyword_raises():
    with pytest.raises(ValueError):
        quote(station("별빛차지", 350.0), "ra1", user_u(), charger_type="fast")


def test_unknown_excluded_id_is_ignored():
    """노선에 없는 id 가 제외 목록에 있어도 오류 아님 (plan 195·268행)."""
    u = m().User(subscription=sub(excluded=frozenset({"없는휴게소", "ra4"})))
    q = quote(station("별빛차지", 350.0), "ra1", u)
    assert q.subscription_applicable is True
    assert q.final_price == pytest.approx(280.0)


def test_unknown_rest_area_id_argument_is_not_error():
    """rest_area_id 는 문자열이면 된다. 제외 목록에 없으면 구독 적용 (plan 264·268행)."""
    q = quote(station("별빛차지", 350.0), "ra99", user_u())
    assert q.subscription_applicable is True
    assert q.applied == "subscription"


# ---------------------------------------------------------------- 자료형과 부수 효과

def test_pricequote_is_dataclass_with_fields():
    """PriceQuote 필드 5개 (plan 262행)."""
    PQ = pr().PriceQuote
    assert dataclasses.is_dataclass(PQ)
    names = [f.name for f in dataclasses.fields(PQ)]
    assert names == ["base_price", "final_price", "subscription_applicable",
                     "applicable_cards", "applied"]


def test_quote_does_not_change_inputs():
    """순수 계산: 입력을 바꾸지 않는다. 비교 전에 값을 복사해 둔다(교훈 '테스트')."""
    u = m().User(subscription=sub(), cards=[card(name="첫카드", rate=0.1), card(name="둘째카드", rate=0.15)])
    s = station("별빛차지", 350.0)
    before_cards = [(c.name, c.rate, c.operators) for c in u.cards]
    before_sub = copy.deepcopy(u.subscription)
    before_price = s.price_per_kwh

    q = quote(s, "ra1", u)
    q.applicable_cards.append("밖에서 추가")

    assert [(c.name, c.rate, c.operators) for c in u.cards] == before_cards
    assert u.subscription == before_sub
    assert s.price_per_kwh == before_price
    # 결과 리스트를 바꿔도 다음 호출에 새지 않는다
    q2 = quote(s, "ra1", u)
    assert q2.applicable_cards == ["첫카드", "둘째카드"]


def test_results_do_not_share_lists():
    """호출마다 새 applicable_cards 리스트 (p3 테스트의 '결과 객체 공유 없음'과 같은 원칙).
    앞 결과가 뒤 호출로 바뀌면 p5 가 휴게소 항목을 모을 때 값이 섞인다."""
    u = m().User(cards=[card(name="카드", rate=0.1, operators={"한빛이브이"})])
    q1 = quote(station("한빛이브이", 320.0), "ra2", u)
    q2 = quote(station("별빛차지", 350.0), "ra1", u)
    assert q1.applicable_cards == ["카드"]
    assert q2.applicable_cards == []
    assert q1.applicable_cards is not q2.applicable_cards
    assert q1.applicable_cards is not u.cards
