"""p7_integration 통과 기준 테스트 (docs/plan.md 5절 p7_integration, 354~374행).

구현 전에는 실패하는 것이 정상이다. 수집 오류가 나지 않도록
planner 모듈과 plan 은 모듈 맨 위가 아니라 각 테스트 안에서 불러온다.
데이터는 4절 표준 예시 데이터(4.1~4.3)를 이 파일이 스스로 만들고(공용 conftest 없음, 0절),
팩토리 이름은 plan 363행대로 make_route(ra2_down=False), make_vehicle(soc) 이다.
기대값은 4.5 시나리오 표(141~157행)에서 가져온다. 기준 시각은 2026-01-01 12:00 (3.2절).
"""
import dataclasses
import importlib
from datetime import datetime, timezone

import pytest

NOW = datetime(2026, 1, 1, 12, 0)


def m():
    return importlib.import_module("ev_charge_planner")


def pl():
    return importlib.import_module("ev_charge_planner.planner")


def codes(alerts):
    return [a.code for a in alerts]


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


def make_route(ra2_down=False):
    """4.2·4.3 표. ra2_down=True 면 시나리오 B(s21 E×3, s22 O×2, 4.5 (B))."""
    mm = m()
    if ra2_down:
        s21 = station("s21", "한빛이브이", "FE FE FE", 320.0, 11, 45)
        s22 = station("s22", "별빛차지", "FO FO", 350.0, 11, 55)
    else:
        s21 = station("s21", "한빛이브이", "FA FA FA", 320.0, 11, 45)
        s22 = station("s22", "별빛차지", "FA FO", 350.0, 11, 55)
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
            mm.RestArea("ra4", "별마루 휴게소(민자)", 108.0,
                        [station("s41", "별빛차지", "FA FA", 400.0, 11, 59)]),
            mm.RestArea("ra5", "하늘길 휴게소", 135.0,
                        [station("s51", "한빛이브이", "FA FA FA FA", 300.0, 11, 50)]),
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


def run(ra2_down=False, soc=60.0, **kw):
    return pl().plan(make_route(ra2_down), make_vehicle(soc), make_user(), NOW, **kw)


def entry(result, ra_id):
    found = [e for e in result.route_list.entries if e.rest_area_id == ra_id]
    assert len(found) == 1, f"{ra_id} 항목이 정확히 하나여야 한다"
    return found[0]


def station_entry(result, sid):
    found = [s for e in result.route_list.entries for s in [*e.stations, *e.nearby]
             if s.station_id == sid]
    assert len(found) == 1, f"{sid} 충전소 항목이 정확히 하나여야 한다"
    return found[0]


def all_station_entries(result):
    return [s for e in result.route_list.entries for s in [*e.stations, *e.nearby]]


# ---------------------------------------------------------------- 공개 API (기준 8)

def test_public_imports_from_package():
    """기준 8: from ev_charge_planner import plan, PlanResult, Route, Vehicle, User.

    __all__ 은 잠긴 __init__ 17~20행에 있음.
    """
    from ev_charge_planner import plan, PlanResult, Route, Vehicle, User  # noqa: F401
    assert callable(plan)
    assert "plan" in m().__all__ and "PlanResult" in m().__all__


def test_package_plan_is_planner_plan():
    """__init__ 은 planner 의 것을 export 만 한다(plan 356행)."""
    assert m().plan is pl().plan
    assert m().PlanResult is pl().PlanResult


def test_plan_result_is_dataclass_with_two_fields():
    """plan 360행: PlanResult(route_list, recommendation)."""
    names = [f.name for f in dataclasses.fields(pl().PlanResult)]
    assert names == ["route_list", "recommendation"]


def test_plan_returns_plan_result_with_route_list_and_recommendation():
    r = run()
    rl = importlib.import_module("ev_charge_planner.route_list")
    rc = importlib.import_module("ev_charge_planner.recommend")
    assert isinstance(r, pl().PlanResult)
    assert isinstance(r.route_list, rl.RouteList)
    assert isinstance(r.recommendation, rc.Recommendation)
    assert r.route_list.highway == "경부고속도로"
    assert r.route_list.direction == "부산방향"


# ---------------------------------------------------------------- 시나리오 A (기준 1)

def test_scenario_a_entries_and_picks():
    r = run()
    assert [e.rest_area_id for e in r.route_list.entries] == ["ra1", "ra2", "ra3", "ra4", "ra5"]
    rec = r.recommendation
    assert rec.status == "ok"
    assert rec.primary.station_id == "s21"
    assert rec.primary.rest_area_id == "ra2"
    assert rec.primary.score == 5
    assert rec.primary.final_price == pytest.approx(288)
    assert rec.backup.station_id == "n31"
    assert rec.backup.rest_area_id == "ra3"
    assert rec.backup.is_nearby is True
    assert rec.backup.detour_km == pytest.approx(10.8)
    assert rec.backup.final_price == pytest.approx(240)
    assert rec.alerts == []


def test_scenario_a_roles_marked_in_route_list():
    r = run()
    assert entry(r, "ra2").stations[0].station_id == "s21"
    assert entry(r, "ra2").stations[0].role == "primary"
    ra3 = entry(r, "ra3")
    assert ra3.nearby[0].station_id == "n31"
    assert ra3.nearby[0].role == "backup"
    others = [s.role for s in all_station_entries(r) if s.station_id not in ("s21", "n31")]
    assert others == [None] * 5


def test_scenario_a_route_list_numbers():
    """4.2·4.3 손 계산표: 도착 잔량·최저 가격·경고가 plan 을 거쳐도 같다."""
    r = run()
    es = r.route_list.entries
    assert [e.remaining_km for e in es] == pytest.approx([27, 54, 81, 108, 135])
    assert [e.arrival_soc_pct for e in es] == pytest.approx([50, 40, 30, 20, 10])
    assert [e.reachable for e in es] == [True, True, True, True, False]
    assert [e.lowest_price for e in es] == pytest.approx([280, 280, 270, 360, 270])
    AC = m().AlertCode
    assert codes(entry(r, "ra5").alerts) == [AC.UNREACHABLE]
    assert codes(station_entry(r, "s31").alerts) == [AC.STALE_INFO]
    assert codes(station_entry(r, "s22").alerts) == [AC.UNUSABLE_CHARGERS]


# ---------------------------------------------------------------- 시나리오 B (기준 2, 통합 흐름)

def test_scenario_b_rest_area_all_unavailable():
    """status_counts 는 dict[ChargerStatus, int](route_list.py 52·112행), operators·applicable_cards 는 list(49행)."""
    r = run(ra2_down=True)
    AC = m().AlertCode
    CS = m().ChargerStatus
    ra2 = entry(r, "ra2")
    assert AC.ALL_UNAVAILABLE in codes(ra2.alerts)
    assert codes(ra2.alerts) == [AC.ALL_UNAVAILABLE]
    assert ra2.usable_fast == 0
    assert ra2.lowest_price is None
    assert ra2.status_counts[CS.COMM_ERROR] == 3
    assert ra2.status_counts[CS.OUT_OF_SERVICE] == 2
    assert ra2.status_counts[CS.AVAILABLE] == 0
    assert codes(station_entry(r, "s21").alerts) == [AC.UNUSABLE_CHARGERS]
    assert codes(station_entry(r, "s22").alerts) == [AC.UNUSABLE_CHARGERS]


def test_scenario_b_backup_moves_up_to_primary():
    """A 의 예비(n31)가 B 에서 1순위로 올라오고, 예비는 s41(도착 20 − 4 = 16 ≥ 15)."""
    a = run()
    b = run(ra2_down=True)
    assert a.recommendation.backup.station_id == "n31"
    rec = b.recommendation
    assert rec.status == "ok"
    assert rec.primary.station_id == "n31"
    assert rec.primary.rest_area_id == "ra3"
    assert rec.primary.score == 4
    assert rec.primary.final_price == pytest.approx(240)
    assert rec.backup.station_id == "s41"
    assert rec.backup.rest_area_id == "ra4"
    assert rec.backup.final_price == pytest.approx(360)
    assert rec.alerts == []
    assert station_entry(b, "n31").role == "primary"
    assert station_entry(b, "s41").role == "backup"
    assert station_entry(b, "s21").role is None


def test_scenario_b_down_stations_are_not_candidates():
    r = run(ra2_down=True)
    assert station_entry(r, "s21").is_candidate is False
    assert station_entry(r, "s22").is_candidate is False


# ---------------------------------------------------------------- 시나리오 C·D·E (기준 3~5)

def test_scenario_c_soc_30_no_backup():
    r = run(soc=30.0)
    rec = r.recommendation
    assert rec.status == "ok"
    assert rec.primary.station_id == "s11"
    assert rec.backup is None
    assert codes(rec.alerts) == [m().AlertCode.NO_BACKUP]


def test_scenario_d_soc_20_no_safe_station_but_full_list():
    r = run(soc=20.0)
    AC = m().AlertCode
    rec = r.recommendation
    assert rec.status == "no_safe_station"
    assert rec.primary is None
    assert rec.backup is None
    assert codes(rec.alerts) == [AC.NO_SAFE_STATION]
    es = r.route_list.entries
    assert len(es) == 5
    assert all(AC.UNREACHABLE in codes(e.alerts) for e in es)
    assert all(e.reachable is False for e in es)
    assert all(s.role is None for s in all_station_entries(r))


def test_scenario_e_soc_35_boundary_exactly_15_is_reachable():
    r = run(soc=35.0)
    rec = r.recommendation
    assert rec.primary.station_id == "s11"
    assert rec.backup.station_id == "s21"
    assert rec.alerts == []
    ra2 = entry(r, "ra2")
    assert ra2.arrival_soc_pct == pytest.approx(15.0)
    assert ra2.reachable is True
    assert entry(r, "ra3").reachable is False


# ---------------------------------------------------------------- 시나리오 F (기준 6)

def test_scenario_f_position_27_all_reachable():
    r = run(position_km=27.0)
    es = r.route_list.entries
    assert len(es) == 5
    assert entry(r, "ra5").reachable is True
    assert entry(r, "ra5").arrival_soc_pct == pytest.approx(20)
    assert entry(r, "ra1").remaining_km == pytest.approx(0)
    assert entry(r, "ra1").arrival_soc_pct == pytest.approx(60)


def test_scenario_f_position_30_drops_passed_rest_area():
    r = run(position_km=30.0)
    assert [e.rest_area_id for e in r.route_list.entries] == ["ra2", "ra3", "ra4", "ra5"]


def test_position_passed_positionally():
    """plan 361행 시그니처: plan(route, vehicle, user, now, position_km, stale_minutes).

    두 값을 다르게 둬 순서 뒤바뀜을 가른다(27 ≠ 60). s31 은 11:00 갱신, 정확히 60분 → 신선.
    """
    r = pl().plan(make_route(), make_vehicle(), make_user(), NOW, 27.0, 60)
    assert len(r.route_list.entries) == 5
    assert entry(r, "ra1").remaining_km == pytest.approx(0)
    assert station_entry(r, "s31").status.is_stale is False


def test_stale_minutes_is_passed_through():
    """D3: stale_minutes 가 build_route_list 로 넘어간다. 60 이면 s31(11:00, 정확히 60분)은 신선."""
    default = run()
    relaxed = run(stale_minutes=60)
    assert station_entry(default, "s31").status.is_stale is True
    assert station_entry(relaxed, "s31").status.is_stale is False
    assert station_entry(relaxed, "s31").alerts == []


def test_plan_equals_build_then_recommend():
    """plan 361행: plan = build_route_list → recommend 순서."""
    rl = importlib.import_module("ev_charge_planner.route_list")
    rc = importlib.import_module("ev_charge_planner.recommend")
    for kw in ({}, {"soc": 30.0}, {"ra2_down": True}):
        v = make_vehicle(kw.get("soc", 60.0))
        route = make_route(kw.get("ra2_down", False))
        expected_list = rl.build_route_list(route, v, make_user(), NOW)
        expected_rec = rc.recommend(expected_list, v)
        got = pl().plan(make_route(kw.get("ra2_down", False)), v, make_user(), NOW)
        assert got.recommendation == expected_rec
        assert got.route_list == expected_list


def test_non_integer_price_passes_through_unrounded():
    """plan 50행 3.1절 엔진은 반올림하지 않는다; p4·p6 판정 [계획 보완] 과 같은 사례.

    s21(한빛이브이, 구독 없음·카드 10%) 333.33 → 299.997. ra2 최저는 s22 350×0.8 = 280 유지.
    """
    route = make_route()
    route.rest_areas[1].stations[0].price_per_kwh = 333.33
    r = pl().plan(route, make_vehicle(), make_user(), NOW)
    assert station_entry(r, "s21").quote.final_price == pytest.approx(299.997)
    assert r.recommendation.primary.station_id == "s21"
    assert r.recommendation.primary.final_price == pytest.approx(299.997)
    assert entry(r, "ra2").lowest_price == pytest.approx(280)


# ---------------------------------------------------------------- 입력 불변 (기준 7)

def snapshot(route, vehicle, user):
    return (
        [[c.status for s in ra.stations for c in s.chargers] for ra in route.rest_areas],
        [[c.status for n in ra.nearby for c in n.station.chargers] for ra in route.rest_areas],
        [s.price_per_kwh for ra in route.rest_areas for s in ra.stations],
        [n.station.price_per_kwh for ra in route.rest_areas for n in ra.nearby],
        [n.detour_km for ra in route.rest_areas for n in ra.nearby],
        [ra.distance_km for ra in route.rest_areas],
        [ra.id for ra in route.rest_areas],
        [len(ra.stations) for ra in route.rest_areas],
        vehicle.soc_pct,
        vehicle.min_arrival_soc_pct,
        user.subscription.rate,
        [c.name for c in user.cards],
    )


@pytest.mark.parametrize("ra2_down", [False, True])
def test_plan_does_not_change_inputs(ra2_down):
    route, vehicle, user = make_route(ra2_down), make_vehicle(), make_user()
    before = snapshot(route, vehicle, user)
    pl().plan(route, vehicle, user, NOW, position_km=27.0)
    assert snapshot(route, vehicle, user) == before


def test_plan_twice_same_result_and_no_leftover_roles():
    """recommend 가 role 을 그 자리에서 채우지만(plan 336행) plan 은 매번 새 리스트를 만든다."""
    route, vehicle, user = make_route(), make_vehicle(), make_user()
    first = pl().plan(route, vehicle, user, NOW)
    second = pl().plan(route, vehicle, user, NOW)
    assert first.recommendation == second.recommendation
    roles = [s.role for s in all_station_entries(second)]
    assert roles.count("primary") == 1
    assert roles.count("backup") == 1
    assert first.route_list is not second.route_list


# ---------------------------------------------------------------- 잘못된 입력 (기준 8, plan 362행)

def test_invalid_vehicle_soc_101_raises():
    """ValueError 는 make_vehicle(101.0) 즉 p1 Vehicle.__post_init__ 에서 나며 plan 본문에 닿기 전이다.

    기준 8 문구 그대로. plan 안에서 그대로 올라오는지(362행)는
    negative_position·negative_stale·naive/aware 셋이 확인한다.
    """
    with pytest.raises(ValueError):
        pl().plan(make_route(), make_vehicle(101.0), make_user(), NOW)


def test_negative_position_raises():
    """p5 의 ValueError 가 그대로 올라온다(plan 298·362행)."""
    with pytest.raises(ValueError):
        run(position_km=-1.0)


def test_negative_stale_minutes_raises():
    """p3 의 ValueError 가 그대로 올라온다(plan 242·362행)."""
    with pytest.raises(ValueError):
        run(stale_minutes=-1)


def test_mixed_naive_aware_now_raises():
    """3.2절: now 가 aware, 갱신 시각이 naive → ValueError(감싸지 않음)."""
    with pytest.raises(ValueError):
        pl().plan(make_route(), make_vehicle(), make_user(), NOW.replace(tzinfo=timezone.utc))


def test_empty_route_is_no_safe_station_not_error():
    """3.3절·p6 337행: 결과 없음은 예외가 아니다."""
    mm = m()
    route = mm.Route(highway="경부고속도로", direction="부산방향", rest_areas=[])
    r = pl().plan(route, make_vehicle(), make_user(), NOW)
    assert r.route_list.entries == []
    assert r.recommendation.status == "no_safe_station"
    assert codes(r.recommendation.alerts) == [mm.AlertCode.NO_SAFE_STATION]


# ---------------------------------------------------------------- 화면 필드 (기준 9)

REST_AREA_FIELDS = [
    "name", "remaining_km", "arrival_soc_pct", "operators", "subscription_applicable",
    "applicable_cards", "status_counts", "usable_fast", "lowest_price", "alerts", "nearby",
]


def test_rest_area_entry_has_screen_fields():
    r = run()
    for e in r.route_list.entries:
        for name in REST_AREA_FIELDS:
            assert hasattr(e, name), f"RestAreaEntry 에 {name} 없음"


def test_station_entry_has_role_and_alerts():
    """1순위·예비 표시(role)는 StationEntry 에 있다(plan 290행)."""
    r = run()
    for s in all_station_entries(r):
        for name in ("role", "alerts", "remaining_km", "arrival_soc_pct", "operator", "quote", "status"):
            assert hasattr(s, name), f"StationEntry 에 {name} 없음"


def test_screen_field_values_for_ra1():
    r = run()
    ra1 = entry(r, "ra1")
    CS = m().ChargerStatus
    assert ra1.name == "달빛 휴게소"
    assert ra1.operators == ["별빛차지"]
    assert ra1.subscription_applicable is True
    assert ra1.applicable_cards == ["그린카드"]
    assert ra1.status_counts[CS.AVAILABLE] == 3
    assert ra1.status_counts[CS.CHARGING] == 1
    assert ra1.usable_fast == 2
    assert ra1.lowest_price == pytest.approx(280)
    assert ra1.alerts == []
    assert ra1.nearby == []
