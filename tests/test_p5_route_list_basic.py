"""p5_route_list 통과 기준 테스트 (docs/plan.md 5절 p5_route_list, 283~310행).

구현 전에는 실패하는 것이 정상이다. 수집 오류가 나지 않도록
route_list 모듈은 모듈 맨 위가 아니라 각 테스트 안에서 불러온다.
데이터는 4절 표준 예시 데이터(4.1~4.3)를 이 파일이 스스로 만든다(공용 conftest 없음, 0절).
기준 시각은 2026-01-01 12:00 (3.2절, 작업일과 먼 고정값).
"""
import importlib
from datetime import datetime, timezone

import pytest

NOW = datetime(2026, 1, 1, 12, 0)


def m():
    return importlib.import_module("ev_charge_planner")


def rl():
    return importlib.import_module("ev_charge_planner.route_list")


# ---------------------------------------------------------------- 표준 데이터 (4절)

def charger(kind, status):
    mm = m()
    t = mm.ChargerType.FAST if kind == "F" else mm.ChargerType.SLOW
    s = {
        "A": mm.ChargerStatus.AVAILABLE,
        "C": mm.ChargerStatus.CHARGING,
        "O": mm.ChargerStatus.OUT_OF_SERVICE,
        "M": mm.ChargerStatus.MAINTENANCE,
        "E": mm.ChargerStatus.COMM_ERROR,
    }[status]
    return mm.Charger(type=t, power_kw=100.0 if kind == "F" else 7.0, status=s)


def station(sid, operator, spec, price, hh, mi):
    """spec 예: "FA FA FC SA" (F=급속, S=완속 + 상태 글자)."""
    return m().Station(
        id=sid,
        operator=operator,
        chargers=[charger(tok[0], tok[1]) for tok in spec.split()],
        price_per_kwh=price,
        status_updated_at=datetime(2026, 1, 1, hh, mi),
    )


def make_route(ra2_down=False, ra4_nearby_detour=None, ra5_nearby=False, ra4_distance=108.0):
    """4.2·4.3 표. ra2_down=True 면 시나리오 B(s21 E×3, s22 O×2)."""
    mm = m()
    if ra2_down:
        s21 = station("s21", "한빛이브이", "FE FE FE", 320.0, 11, 45)
        s22 = station("s22", "별빛차지", "FO FO", 350.0, 11, 55)
    else:
        s21 = station("s21", "한빛이브이", "FA FA FA", 320.0, 11, 45)
        s22 = station("s22", "별빛차지", "FA FO", 350.0, 11, 55)
    ra4_nearby = []
    if ra4_nearby_detour is not None:
        ra4_nearby = [mm.NearbyStation(
            station=station("n41", "한빛이브이", "FA FA", 300.0, 11, 58),
            detour_km=ra4_nearby_detour)]
    ra5_near = []
    if ra5_nearby:
        ra5_near = [mm.NearbyStation(
            station=station("n51", "한빛이브이", "FA FA", 300.0, 11, 58), detour_km=2.0)]
    return mm.Route(
        highway="경부고속도로",
        direction="부산방향",
        rest_areas=[
            mm.RestArea("ra1", "달빛 휴게소", 27.0,
                        [station("s11", "별빛차지", "FA FA FC SA", 350.0, 11, 50)]),
            mm.RestArea("ra2", "소나무 휴게소", 54.0, [s21, s22]),
            mm.RestArea("ra3", "강바람 휴게소", 81.0,
                        [station("s31", "초록전력", "FA FA", 300.0, 11, 0)],
                        [mm.NearbyStation(
                            station=station("n31", "별빛차지", "FA FA FA FA", 300.0, 11, 58),
                            detour_km=10.8)]),
            mm.RestArea("ra4", "별마루 휴게소", ra4_distance,
                        [station("s41", "별빛차지", "FA FA", 400.0, 11, 59)], ra4_nearby),
            mm.RestArea("ra5", "하늘길 휴게소", 135.0,
                        [station("s51", "한빛이브이", "FA FA FA FA", 300.0, 11, 50)], ra5_near),
        ],
    )


def make_vehicle(soc=60.0):
    return m().Vehicle(soc_pct=soc, battery_kwh=60.0, efficiency_km_per_kwh=5.0)


def make_user():
    mm = m()
    return mm.User(
        subscription=mm.Subscription(operator="별빛차지", rate=0.2,
                                     excluded_rest_area_ids=frozenset({"ra4"})),
        cards=[mm.DiscountCard(name="그린카드", rate=0.1)],
    )


def build(route=None, vehicle=None, user=None, now=NOW, **kw):
    return rl().build_route_list(
        make_route() if route is None else route,
        make_vehicle() if vehicle is None else vehicle,
        make_user() if user is None else user,
        now,
        **kw,
    )


def by_id(result):
    return {e.rest_area_id: e for e in result.entries}


def codes(alerts):
    return [a.code for a in alerts]


def counts(**kw):
    """ChargerStatus 5개 키 전부 있는 dict. 예: counts(A=3, C=1)."""
    mm = m()
    key = {
        "A": mm.ChargerStatus.AVAILABLE,
        "C": mm.ChargerStatus.CHARGING,
        "O": mm.ChargerStatus.OUT_OF_SERVICE,
        "M": mm.ChargerStatus.MAINTENANCE,
        "E": mm.ChargerStatus.COMM_ERROR,
    }
    out = {s: 0 for s in mm.ChargerStatus}
    for k, v in kw.items():
        out[key[k]] = v
    return out


def all_station_entries(result):
    for e in result.entries:
        yield from e.stations
        yield from e.nearby


# ---------------------------------------------------------------- 기준 1: 순서·남은 거리·도착 잔량

def test_1_types_and_route_header():
    r = build()
    assert isinstance(r, rl().RouteList)
    assert r.highway == "경부고속도로"
    assert r.direction == "부산방향"
    assert all(isinstance(e, rl().RestAreaEntry) for e in r.entries)
    assert all(isinstance(s, rl().StationEntry) for s in all_station_entries(r))


def test_1_entries_order_remaining_arrival_reachable():
    r = build()
    assert [e.rest_area_id for e in r.entries] == ["ra1", "ra2", "ra3", "ra4", "ra5"]
    assert [e.name for e in r.entries] == [
        "달빛 휴게소", "소나무 휴게소", "강바람 휴게소", "별마루 휴게소", "하늘길 휴게소"]
    assert [e.distance_km for e in r.entries] == pytest.approx([27, 54, 81, 108, 135])
    assert [e.remaining_km for e in r.entries] == pytest.approx([27, 54, 81, 108, 135])
    assert [e.arrival_soc_pct for e in r.entries] == pytest.approx([50, 40, 30, 20, 10])
    assert [e.reachable for e in r.entries] == [True, True, True, True, False]


def test_1_ra5_unreachable_alert_and_reachable_have_no_unreachable():
    e = by_id(build())
    assert codes(e["ra5"].alerts) == [m().AlertCode.UNREACHABLE]
    for rid in ("ra1", "ra2", "ra3", "ra4"):
        assert m().AlertCode.UNREACHABLE not in codes(e[rid].alerts)


def test_1_inner_station_entry_fields():
    """안 충전소: is_nearby False, detour 0, remaining = 휴게소 남은 거리 (plan 290행)."""
    s11 = by_id(build())["ra1"].stations[0]
    assert s11.station_id == "s11"
    assert s11.operator == "별빛차지"
    assert s11.is_nearby is False
    assert s11.detour_km == pytest.approx(0.0)
    assert s11.remaining_km == pytest.approx(27.0)
    assert s11.arrival_soc_pct == pytest.approx(50.0)
    assert s11.reachable is True
    assert s11.is_candidate is True
    assert isinstance(s11.status, importlib.import_module("ev_charge_planner.status").StationStatus)
    assert isinstance(s11.quote, importlib.import_module("ev_charge_planner.pricing").PriceQuote)


# ---------------------------------------------------------------- 기준 2: ra1

def test_2_ra1_aggregate():
    ra1 = by_id(build())["ra1"]
    assert ra1.operators == ["별빛차지"]
    assert ra1.subscription_applicable is True
    assert ra1.applicable_cards == ["그린카드"]
    assert ra1.status_counts == counts(A=3, C=1)
    assert ra1.usable_fast == 2
    assert ra1.waiting_fast == 1
    assert ra1.lowest_price == pytest.approx(280.0)
    assert ra1.alerts == []
    assert ra1.nearby == []


def test_2_status_counts_has_all_five_keys():
    for e in build().entries:
        assert set(e.status_counts.keys()) == set(m().ChargerStatus)


# ---------------------------------------------------------------- 기준 3: ra2

def test_3_ra2_stations_and_aggregate():
    ra2 = by_id(build())["ra2"]
    assert [s.station_id for s in ra2.stations] == ["s21", "s22"]
    assert ra2.operators == ["한빛이브이", "별빛차지"]
    assert ra2.usable_fast == 4
    assert ra2.waiting_fast == 0
    assert ra2.status_counts == counts(A=4, O=1)
    assert ra2.lowest_price == pytest.approx(280.0)
    assert ra2.subscription_applicable is True
    assert ra2.applicable_cards == ["그린카드"]
    assert ra2.alerts == []


def test_3_ra2_station_alerts_and_quotes():
    s21, s22 = by_id(build())["ra2"].stations
    assert s21.alerts == []
    assert codes(s22.alerts) == [m().AlertCode.UNUSABLE_CHARGERS]
    assert s21.quote.applied == "그린카드"
    assert s21.quote.final_price == pytest.approx(288.0)
    assert s22.quote.applied == "subscription"
    assert s22.quote.final_price == pytest.approx(280.0)
    assert s21.is_candidate is True
    assert s22.is_candidate is True


# ---------------------------------------------------------------- 기준 4: ra3 + 나들목 인근

def test_4_ra3_stale_station():
    ra3 = by_id(build())["ra3"]
    s31 = ra3.stations[0]
    assert s31.station_id == "s31"
    assert s31.status.is_stale is True
    assert codes(s31.alerts) == [m().AlertCode.STALE_INFO]
    # 오래된 정보여도 후보에서 빼지 않는다: is_candidate = reachable ∧ usable_fast ≥ 1 (plan 290행, 4.4 표 136행)
    assert s31.is_candidate is True
    assert ra3.lowest_price == pytest.approx(270.0)  # 나들목 인근 240 은 제외
    assert ra3.subscription_applicable is False
    assert ra3.operators == ["초록전력"]  # 나들목 인근 업체는 안 넣음
    assert ra3.usable_fast == 2  # 나들목 인근 4대는 합에 안 넣음
    assert ra3.status_counts == counts(A=2)


def test_4_ra3_nearby_n31():
    ra3 = by_id(build())["ra3"]
    assert len(ra3.nearby) == 1
    n31 = ra3.nearby[0]
    assert n31.station_id == "n31"
    assert n31.operator == "별빛차지"
    assert n31.is_nearby is True
    assert n31.detour_km == pytest.approx(10.8)
    assert n31.remaining_km == pytest.approx(91.8)
    assert n31.arrival_soc_pct == pytest.approx(26.0)
    assert n31.reachable is True
    assert n31.is_candidate is True
    assert n31.quote.final_price == pytest.approx(240.0)
    assert n31.quote.applied == "subscription"
    assert n31.quote.subscription_applicable is True
    assert n31.alerts == []


# ---------------------------------------------------------------- 기준 5: ra4·ra5

def test_5_ra4_excluded_subscription():
    ra4 = by_id(build())["ra4"]
    assert ra4.subscription_applicable is False
    assert ra4.lowest_price == pytest.approx(360.0)
    assert ra4.stations[0].quote.applied == "그린카드"
    assert ra4.reachable is True
    assert ra4.stations[0].is_candidate is True


def test_5_ra5_price_computed_but_unreachable():
    ra5 = by_id(build())["ra5"]
    assert ra5.lowest_price == pytest.approx(270.0)
    assert ra5.reachable is False
    assert ra5.usable_fast == 4
    for s in [*ra5.stations, *ra5.nearby]:
        assert s.reachable is False
        assert s.is_candidate is False


def test_5_unreachable_inner_station_has_no_unreachable_alert():
    """안 충전소는 못 가도 UNREACHABLE 을 붙이지 않는다 (plan 291행: 휴게소 경고로 충분)."""
    s51 = by_id(build())["ra5"].stations[0]
    assert s51.alerts == []


# ---------------------------------------------------------------- 기준 6: 시나리오 B

def test_6_scenario_b_ra2_all_unavailable():
    r = build(route=make_route(ra2_down=True))
    ra2 = by_id(r)["ra2"]
    assert ra2.status_counts == counts(E=3, O=2)
    assert ra2.usable_fast == 0
    assert codes(ra2.alerts) == [m().AlertCode.ALL_UNAVAILABLE]
    assert ra2.lowest_price is None
    assert ra2.reachable is True
    for s in ra2.stations:
        assert codes(s.alerts) == [m().AlertCode.UNUSABLE_CHARGERS]
        assert s.is_candidate is False  # 갈 수 있어도 쓸 수 있는 급속 0
    # 다른 휴게소는 A 와 같다
    assert by_id(r)["ra1"].lowest_price == pytest.approx(280.0)


# ---------------------------------------------------------------- 기준 7: 완속만 / 충전소 0개

def _single_ra_route(stations, ra_id="rx", distance=10.0):
    mm = m()
    return mm.Route("경부고속도로", "부산방향", [mm.RestArea(ra_id, "시험 휴게소", distance, stations)])


def test_7_slow_only_rest_area():
    r = build(route=_single_ra_route([station("x1", "별빛차지", "SA", 300.0, 11, 50)]))
    e = r.entries[0]
    assert codes(e.alerts) == [m().AlertCode.NO_USABLE_FAST]
    assert e.lowest_price is None
    assert e.usable_fast == 0
    assert e.stations[0].is_candidate is False


def test_7_empty_rest_area():
    e = build(route=_single_ra_route([])).entries[0]
    assert codes(e.alerts) == [m().AlertCode.ALL_UNAVAILABLE]
    assert e.status_counts == counts()
    assert e.operators == []
    assert e.applicable_cards == []
    assert e.subscription_applicable is False
    assert e.usable_fast == 0
    assert e.waiting_fast == 0
    assert e.lowest_price is None
    assert e.stations == []
    assert e.nearby == []


def test_7_unreachable_then_rest_area_alert_order():
    """alerts 순서: UNREACHABLE → rest_area_alerts (plan 293행)."""
    e = build(route=_single_ra_route([], distance=200.0)).entries[0]
    assert codes(e.alerts) == [m().AlertCode.UNREACHABLE, m().AlertCode.ALL_UNAVAILABLE]


def test_7_lowest_price_ignores_station_without_usable_fast():
    """lowest_price 는 usable_fast ≥ 1 인 안 충전소만 (plan 292행). 싼 곳이 충전 중뿐이면 제외.

    waiting_fast 는 급속 ∧ 충전 중만 센다(plan 237행, status.py 44~45행): 완속 충전 중(SC)은 안 센다.
    충전 중 급속만 있는 x1 은 후보가 아니다(plan 290행: usable_fast ≥ 1).
    """
    r = build(route=_single_ra_route([
        station("x1", "한빛이브이", "FC FC SC", 100.0, 11, 50),
        station("x2", "한빛이브이", "FA", 300.0, 11, 50),
    ]))
    e = r.entries[0]
    assert e.lowest_price == pytest.approx(270.0)
    assert e.waiting_fast == 2
    assert e.usable_fast == 1
    assert e.stations[0].is_candidate is False
    assert e.stations[1].is_candidate is True


def test_7_lowest_price_not_rounded():
    """엔진은 반올림하지 않는다 (plan 50행 3.1절). 355×0.9 = 319.5, 333.33×0.9 = 299.997."""
    e = build(route=_single_ra_route([
        station("x1", "한빛이브이", "FA", 355.0, 11, 50)])).entries[0]
    assert e.lowest_price == pytest.approx(319.5)
    e = build(route=_single_ra_route([
        station("x1", "한빛이브이", "FA", 333.33, 11, 50)])).entries[0]
    assert e.lowest_price == pytest.approx(299.997)
    assert e.stations[0].quote.final_price == pytest.approx(299.997)


def test_7_operators_dedup_in_input_order():
    """operators: 안 충전소 업체, 입력 순서, 중복 제거 (plan 292행)."""
    e = build(route=_single_ra_route([
        station("x1", "별빛차지", "FA", 300.0, 11, 50),
        station("x2", "한빛이브이", "FA", 300.0, 11, 50),
        station("x3", "별빛차지", "FA", 300.0, 11, 50),
    ])).entries[0]
    assert e.operators == ["별빛차지", "한빛이브이"]


def test_7_applicable_cards_union_in_user_card_order():
    """applicable_cards: 안 충전소들의 합집합, 사용자 카드 순서 (plan 292행). 나들목 인근은 안 넣는다.

    '다카드' operators=frozenset() 는 어디에도 안 됨: plan 41행 D7(None = 모든 업체, 빈 집합 = 어디에도 안 됨),
    잠긴 pricing.py 33행 `c.operators is None or station.operator in c.operators`.
    make_user 의 '그린카드'는 operators 기본값 None(models.py DiscountCard) 이라 모든 업체에 적용된다.
    '라카드'는 나들목 인근(초록전력)에만 맞으므로 휴게소 applicable_cards 에 들어가면 안 된다.
    """
    mm = m()
    user = mm.User(cards=[
        mm.DiscountCard(name="가카드", rate=0.1, operators={"한빛이브이"}),
        mm.DiscountCard(name="나카드", rate=0.1, operators={"별빛차지"}),
        mm.DiscountCard(name="다카드", rate=0.1, operators=frozenset()),
        mm.DiscountCard(name="라카드", rate=0.1, operators={"초록전력"}),
    ])
    near = mm.NearbyStation(station=station("n1", "초록전력", "FA", 300.0, 11, 50), detour_km=2.0)
    route = mm.Route("경부고속도로", "부산방향", [mm.RestArea("rx", "시험 휴게소", 10.0, [
        station("x1", "별빛차지", "FA", 300.0, 11, 50),
        station("x2", "한빛이브이", "FA", 300.0, 11, 50),
    ], [near])])
    e = build(route=route, user=user).entries[0]
    assert e.applicable_cards == ["가카드", "나카드"]
    assert e.subscription_applicable is False
    assert e.operators == ["별빛차지", "한빛이브이"]
    assert e.nearby[0].quote.applicable_cards == ["라카드"]


def test_7_user_without_discounts():
    e = build(user=m().User()).entries[0]
    assert e.subscription_applicable is False
    assert e.applicable_cards == []
    assert e.lowest_price == pytest.approx(350.0)


# ---------------------------------------------------------------- 기준 8: 나들목 인근 못 감

def test_8_nearby_of_unreachable_rest_area_ends_with_unreachable():
    ra5 = by_id(build(route=make_route(ra5_nearby=True)))["ra5"]
    n51 = ra5.nearby[0]
    assert n51.reachable is False
    assert n51.is_candidate is False
    assert codes(n51.alerts)[-1] == m().AlertCode.UNREACHABLE
    assert codes(n51.alerts) == [m().AlertCode.UNREACHABLE]
    # UNREACHABLE 은 entry.alerts 에만 붙고 status.alerts 는 그대로 (plan 291행: status.alerts 그대로 + 끝에 추가)
    assert n51.status.alerts == []


def test_8_nearby_detour_makes_unreachable():
    """ra4 108 km + 왕복 30 km = 138 km → 도착 60 − 138/2.7 ≈ 8.89 < 15."""
    ra4 = by_id(build(route=make_route(ra4_nearby_detour=30.0)))["ra4"]
    assert ra4.reachable is True
    assert m().AlertCode.UNREACHABLE not in codes(ra4.alerts)
    n41 = ra4.nearby[0]
    assert n41.is_nearby is True
    assert n41.remaining_km == pytest.approx(138.0)
    assert n41.arrival_soc_pct == pytest.approx(60 - 138 / 2.7)
    assert n41.reachable is False
    assert n41.is_candidate is False
    assert codes(n41.alerts) == [m().AlertCode.UNREACHABLE]
    # 나들목 인근은 휴게소 집계에 안 들어간다
    assert ra4.usable_fast == 2
    assert ra4.operators == ["별빛차지"]


def test_8_nearby_status_alerts_come_before_unreachable():
    """nearby alerts = status.alerts 그대로 + 끝에 UNREACHABLE (plan 291행).

    status.alerts 순서 STALE_INFO → UNUSABLE_CHARGERS 는 plan 240행, 잠긴 status.py 51~56행 그대로.
    휴게소 경고는 안 충전소만 본다(plan 44행 D10·241행): 안 0개라 나들목 n9 급속A 가 있어도 ALL_UNAVAILABLE.
    """
    mm = m()
    near = mm.NearbyStation(station=station("n9", "한빛이브이", "FA FO", 300.0, 11, 0), detour_km=5.0)
    route = mm.Route("경부고속도로", "부산방향", [
        mm.RestArea("rx", "시험 휴게소", 200.0, [], [near])])
    entry = build(route=route).entries[0]
    n9 = entry.nearby[0]
    assert codes(n9.alerts) == [
        mm.AlertCode.STALE_INFO, mm.AlertCode.UNUSABLE_CHARGERS, mm.AlertCode.UNREACHABLE]
    assert codes(entry.alerts) == [mm.AlertCode.UNREACHABLE, mm.AlertCode.ALL_UNAVAILABLE]


def test_8_nearby_reachable_boundary_detour_exact():
    """n41 왕복 = 121.5 − 108 = 13.5 → 도착 정확히 15.0 → 갈 수 있음 (3.1절 허용 오차 1e-9)."""
    n41 = by_id(build(route=make_route(ra4_nearby_detour=13.5)))["ra4"].nearby[0]
    assert n41.arrival_soc_pct == pytest.approx(15.0)
    assert n41.reachable is True
    assert n41.is_candidate is True
    assert n41.alerts == []


# ---------------------------------------------------------------- 기준 9: position_km

def test_9_position_27_all_reachable():
    r = build(position_km=27.0)
    assert len(r.entries) == 5
    assert [e.reachable for e in r.entries] == [True] * 5
    e = by_id(r)
    assert e["ra1"].remaining_km == pytest.approx(0.0)
    assert e["ra1"].arrival_soc_pct == pytest.approx(60.0)
    assert e["ra1"].distance_km == pytest.approx(27.0)
    assert e["ra5"].remaining_km == pytest.approx(108.0)
    assert e["ra5"].arrival_soc_pct == pytest.approx(20.0)
    assert e["ra5"].alerts == []
    assert [x.remaining_km for x in r.entries] == pytest.approx([0, 27, 54, 81, 108])
    # 나들목 인근 남은 거리도 위치 기준
    assert e["ra3"].nearby[0].remaining_km == pytest.approx(54 + 10.8)
    assert e["ra5"].stations[0].is_candidate is True
    # 안 충전소도 위치 기준 (plan 290행: remaining = 휴게소 남은 거리 + detour 0)
    assert e["ra5"].stations[0].remaining_km == pytest.approx(108.0)
    assert e["ra5"].stations[0].arrival_soc_pct == pytest.approx(20.0)
    assert e["ra1"].stations[0].remaining_km == pytest.approx(0.0)
    assert e["ra1"].stations[0].arrival_soc_pct == pytest.approx(60.0)


def test_9_position_30_drops_passed_rest_area():
    r = build(position_km=30.0)
    assert [e.rest_area_id for e in r.entries] == ["ra2", "ra3", "ra4", "ra5"]
    assert r.entries[0].remaining_km == pytest.approx(24.0)


def test_9_position_past_all():
    assert build(position_km=200.0).entries == []


def test_9_negative_position_raises():
    with pytest.raises(ValueError):
        build(position_km=-1.0)


def test_9_default_position_is_zero():
    assert build().entries[0].remaining_km == pytest.approx(27.0)


# ---------------------------------------------------------------- 기준 10: 빈 노선·role·입력 불변

def test_10_empty_route():
    r = build(route=m().Route("경부고속도로", "부산방향", []))
    assert r.entries == []
    assert r.highway == "경부고속도로"


def test_10_all_roles_none():
    """s11, s21, s22, s31, n31, s41, n41, s51, n51 = 9개 (ra4·ra5 나들목 인근 포함)."""
    r = build(route=make_route(ra4_nearby_detour=30.0, ra5_nearby=True))
    entries = list(all_station_entries(r))
    assert len(entries) == 9
    assert all(s.role is None for s in entries)


def _route_snapshot(route):
    """호출 전 값을 복사해 둔다 (같은 참조 비교는 항상 통과하므로)."""
    stations = [
        (st.id, st.operator, st.price_per_kwh, st.status_updated_at,
         [(c.type, c.status, c.power_kw) for c in st.chargers])
        for ra in route.rest_areas
        for st in [*ra.stations, *(n.station for n in ra.nearby)]
    ]
    ras = [(ra.id, ra.distance_km, len(ra.stations), [n.detour_km for n in ra.nearby])
           for ra in route.rest_areas]
    return stations, ras


@pytest.mark.parametrize("route_kw", [
    {},
    {"ra2_down": True, "ra4_nearby_detour": 30.0, "ra5_nearby": True},
])
def test_10_input_route_not_changed(route_kw):
    route = make_route(**route_kw)
    before = _route_snapshot(route)
    build(route=route, position_km=30.0)
    build(route=route)
    assert _route_snapshot(route) == before


def test_10_vehicle_not_changed():
    v = make_vehicle()
    before = (v.soc_pct, v.battery_kwh, v.efficiency_km_per_kwh)
    build(vehicle=v)
    assert (v.soc_pct, v.battery_kwh, v.efficiency_km_per_kwh) == before


# ---------------------------------------------------------------- 추가 경계·전달 (근거 명시)

def test_extra_scenario_d_all_unreachable_still_listed():
    """4.5절 (D): 잔량 20 → 5개 항목 모두 UNREACHABLE 로 그대로 나온다."""
    r = build(vehicle=make_vehicle(20.0))
    assert len(r.entries) == 5
    for e in r.entries:
        assert e.reachable is False
        assert codes(e.alerts)[0] == m().AlertCode.UNREACHABLE
    assert not any(s.is_candidate for s in all_station_entries(r))
    # 도착 잔량은 음수여도 깎지 않는다 (plan 52행 3.1절): 20 − 135/2.7 = −30
    assert by_id(r)["ra5"].arrival_soc_pct == pytest.approx(-30.0)


def test_extra_scenario_e_boundary_exact_15_reachable():
    """4.5절 (E): 잔량 35 → ra2 도착 정확히 15.0 → 갈 수 있음, ra3 5 → 못 감."""
    e = by_id(build(vehicle=make_vehicle(35.0)))
    assert e["ra2"].arrival_soc_pct == pytest.approx(15.0)
    assert e["ra2"].reachable is True
    assert m().AlertCode.UNREACHABLE not in codes(e["ra2"].alerts)
    assert e["ra3"].reachable is False
    assert e["ra3"].nearby[0].reachable is False


def test_extra_stale_minutes_passed_through():
    """stale_minutes 인자가 summarize_station 으로 전달된다 (plan 295행, D3). 60 분이면 11:00 은 신선.

    경계는 '초과'만 오래됨: plan 239·248행, 잠긴 status.py 49행 `(now − updated) > timedelta(minutes=stale_minutes)`.
    """
    s31 = by_id(build(stale_minutes=60))["ra3"].stations[0]
    assert s31.status.is_stale is False
    assert s31.alerts == []
    s31_fresh_limit = by_id(build(stale_minutes=59))["ra3"].stations[0]
    assert s31_fresh_limit.status.is_stale is True


def test_extra_negative_stale_minutes_raises():
    """p3 summarize_station 의 ValueError 가 그대로 올라온다 (plan 242·298행)."""
    with pytest.raises(ValueError):
        build(stale_minutes=-1)


def test_extra_mixed_naive_aware_now_raises():
    """3.2절: now 가 aware, 갱신 시각이 naive → ValueError (p3 검증이 그대로 올라옴)."""
    with pytest.raises(ValueError):
        build(now=datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc))
