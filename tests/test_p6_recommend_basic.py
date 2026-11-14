"""p6_recommend 통과 기준 테스트 (docs/plan.md 5절 p6_recommend, 314~350행).

구현 전에는 실패하는 것이 정상이다. 수집 오류가 나지 않도록
recommend 모듈은 모듈 맨 위가 아니라 각 테스트 안에서 불러온다.
데이터는 4절 표준 예시 데이터(4.1~4.3)를 이 파일이 스스로 만들고(공용 conftest 없음, 0절),
경로 리스트는 잠긴 p5 `build_route_list` 로 만든다(plan 339행).
기준 시각은 2026-01-01 12:00 (3.2절).
"""
import dataclasses
import importlib
from datetime import datetime

import pytest

NOW = datetime(2026, 1, 1, 12, 0)


def m():
    return importlib.import_module("ev_charge_planner")


def rl():
    return importlib.import_module("ev_charge_planner.route_list")


def rc():
    return importlib.import_module("ev_charge_planner.recommend")


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


def station(sid, operator, spec, price, hh=11, mi=50):
    """spec 예: "FA FA FC SA" (F=급속, S=완속 + 상태 글자)."""
    return m().Station(
        id=sid,
        operator=operator,
        chargers=[charger(tok[0], tok[1]) for tok in spec.split()],
        price_per_kwh=price,
        status_updated_at=datetime(2026, 1, 1, hh, mi),
    )


def make_route(ra2_down=False, ra4_distance=108.0, s11_spec="FA FA FC SA", s11_price=350.0,
               ra2_nearby=None, n31_spec="FA FA FA FA", n31_detour=10.8, ra4_nearby=None,
               ra2_twin=None):
    """4.2·4.3 표. ra2_down=True 면 시나리오 B(s21 E×3, s22 O×2).

    ra2_twin: 주면 ra2 와 같은 거리(54)의 휴게소 "ra2b" 를 ra2 뒤에 넣는다(plan 188행: 같은 거리 허용).
    """
    mm = m()
    if ra2_down:
        s21 = station("s21", "한빛이브이", "FE FE FE", 320.0, 11, 45)
        s22 = station("s22", "별빛차지", "FO FO", 350.0, 11, 55)
    else:
        s21 = station("s21", "한빛이브이", "FA FA FA", 320.0, 11, 45)
        s22 = station("s22", "별빛차지", "FA FO", 350.0, 11, 55)
    twin = [] if ra2_twin is None else [mm.RestArea("ra2b", "쌍둥이 휴게소", 54.0, [ra2_twin])]
    return mm.Route(
        highway="경부고속도로",
        direction="부산방향",
        rest_areas=[
            mm.RestArea("ra1", "달빛 휴게소", 27.0,
                        [station("s11", "별빛차지", s11_spec, s11_price, 11, 50)]),
            mm.RestArea("ra2", "소나무 휴게소", 54.0, [s21, s22], list(ra2_nearby or [])),
            *twin,
            mm.RestArea("ra3", "강바람 휴게소", 81.0,
                        [station("s31", "초록전력", "FA FA", 300.0, 11, 0)],
                        [mm.NearbyStation(
                            station=station("n31", "별빛차지", n31_spec, 300.0, 11, 58),
                            detour_km=n31_detour)]),
            mm.RestArea("ra4", "별마루 휴게소", ra4_distance,
                        [station("s41", "별빛차지", "FA FA", 400.0, 11, 59)],
                        list(ra4_nearby or [])),
            mm.RestArea("ra5", "하늘길 휴게소", 135.0,
                        [station("s51", "한빛이브이", "FA FA FA FA", 300.0, 11, 50)]),
        ],
    )


def make_vehicle(soc=60.0, min_arrival=15.0):
    return m().Vehicle(soc_pct=soc, battery_kwh=60.0, efficiency_km_per_kwh=5.0,
                       min_arrival_soc_pct=min_arrival)


def make_user():
    mm = m()
    return mm.User(
        subscription=mm.Subscription(operator="별빛차지", rate=0.2,
                                     excluded_rest_area_ids=frozenset({"ra4"})),
        cards=[mm.DiscountCard(name="그린카드", rate=0.1)],
    )


def build(route=None, vehicle=None):
    return rl().build_route_list(
        make_route() if route is None else route,
        make_vehicle() if vehicle is None else vehicle,
        make_user(),
        NOW,
    )


def run(route=None, soc=60.0, min_arrival=15.0):
    """(route_list, recommendation) — 같은 차량으로 경로 리스트와 추천을 만든다."""
    v = make_vehicle(soc, min_arrival)
    r = build(route=route, vehicle=v)
    return r, rc().recommend(r, v)


def stations_of(route_list):
    """station_id → StationEntry (안 → 나들목 인근, 휴게소 순서)."""
    out = {}
    for e in route_list.entries:
        for s in [*e.stations, *e.nearby]:
            out[s.station_id] = s
    return out


def codes(alerts):
    return [a.code for a in alerts]


def roles(route_list):
    return {sid: s.role for sid, s in stations_of(route_list).items()}


def ac():
    return m().AlertCode


# ---------------------------------------------------------------- 기준 1: 점수 (4.4 표)

def test_1_scores_standard_data():
    v = make_vehicle()
    st = stations_of(build(vehicle=v))
    got = {sid: rc().score_candidate(st[sid], v) for sid in ("s11", "s21", "s22", "s31", "n31", "s41")}
    assert got == {"s11": 4, "s21": 5, "s22": 3, "s31": 2, "n31": 4, "s41": 2}


def test_1_score_is_int():
    v = make_vehicle()
    s = rc().score_candidate(stations_of(build(vehicle=v))["s21"], v)
    assert isinstance(s, int)


def test_1_score_does_not_change_entry():
    """점수 계산은 entry 를 바꾸지 않는다(role 은 recommend 만 채운다, plan 336행)."""
    v = make_vehicle()
    e = stations_of(build(vehicle=v))["n31"]
    before = (e.arrival_soc_pct, e.status.usable_fast, e.status.is_stale, e.role, e.remaining_km)
    rc().score_candidate(e, v)
    assert (e.arrival_soc_pct, e.status.usable_fast, e.status.is_stale, e.role, e.remaining_km) == before


# ---------------------------------------------------------------- 기준 2: 점수 경계

def _entry(usable_fast=2, arrival=50.0, stale=False):
    """표준 s11 entry 를 바탕으로 점수 요소만 바꾼 복사본 (plan 321~324행: 세 값만 본다)."""
    base = stations_of(build())["s11"]
    status = dataclasses.replace(base.status, usable_fast=usable_fast, is_stale=stale)
    return dataclasses.replace(base, status=status, arrival_soc_pct=arrival)


@pytest.mark.parametrize("uf, c", [(1, 0), (2, 1), (3, 2), (7, 2)])
def test_2_charger_count_points(uf, c):
    """여유 35(m=2), 신선(f=1) 고정 → 점수 = c + 3."""
    assert rc().score_candidate(_entry(usable_fast=uf, arrival=50.0), make_vehicle()) == c + 3


@pytest.mark.parametrize("margin, mpts", [
    (0.0, 0), (9.99, 0), (10.0, 1), (19.99, 1), (20.0, 2), (45.0, 2),
])
def test_2_margin_points(margin, mpts):
    """usable_fast 1(c=0), 신선(f=1) 고정 → 점수 = m + 1. 여유 = 도착 − 15."""
    e = _entry(usable_fast=1, arrival=15.0 + margin)
    assert rc().score_candidate(e, make_vehicle()) == mpts + 1


def test_2_stale_points():
    v = make_vehicle()
    assert rc().score_candidate(_entry(usable_fast=1, arrival=50.0, stale=False), v) == 3
    assert rc().score_candidate(_entry(usable_fast=1, arrival=50.0, stale=True), v) == 2
    assert rc().score_candidate(_entry(usable_fast=3, arrival=50.0, stale=True), v) == 4


def test_2_min_score_zero_and_max_five():
    v = make_vehicle()
    assert rc().score_candidate(_entry(usable_fast=1, arrival=16.0, stale=True), v) == 0
    assert rc().score_candidate(_entry(usable_fast=5, arrival=80.0, stale=False), v) == 5


def test_2_margin_uses_vehicle_min_arrival():
    """여유 = arrival − vehicle.min_arrival_soc_pct (plan 323행). 최소 10 % 차량이면 s31(도착 30) 여유 20 → m 2."""
    e = stations_of(build())["s31"]
    assert rc().score_candidate(e, make_vehicle(min_arrival=15.0)) == 2
    assert rc().score_candidate(e, make_vehicle(min_arrival=10.0)) == 3


# ---------------------------------------------------------------- 기준 3: 시나리오 A

def test_3_scenario_a_types_and_status():
    r, rec = run()
    assert isinstance(rec, rc().Recommendation)
    assert isinstance(rec.primary, rc().Pick)
    assert isinstance(rec.backup, rc().Pick)
    assert rec.status == "ok"
    assert rec.alerts == []


def test_3_scenario_a_primary():
    _, rec = run()
    p = rec.primary
    assert p.station_id == "s21"
    assert p.rest_area_id == "ra2"
    assert p.rest_area_name == "소나무 휴게소"
    assert p.operator == "한빛이브이"
    assert p.is_nearby is False
    assert p.detour_km == pytest.approx(0.0)
    assert p.remaining_km == pytest.approx(54.0)
    assert p.arrival_soc_pct == pytest.approx(40.0)
    assert p.score == 5
    assert p.final_price == pytest.approx(288.0)


def test_3_scenario_a_backup():
    _, rec = run()
    b = rec.backup
    assert b.station_id == "n31"
    assert b.rest_area_id == "ra3"
    assert b.rest_area_name == "강바람 휴게소"
    assert b.operator == "별빛차지"
    assert b.is_nearby is True
    assert b.detour_km == pytest.approx(10.8)
    assert b.remaining_km == pytest.approx(91.8)
    assert b.arrival_soc_pct == pytest.approx(26.0)  # 1순위가 안 충전소라 원점 기준과 같다 (plan 332행)
    assert b.score == 4
    assert b.final_price == pytest.approx(240.0)


def test_3_scenario_a_roles_in_place():
    r, _ = run()
    assert roles(r) == {"s11": None, "s21": "primary", "s22": None, "s31": None,
                        "n31": "backup", "s41": None, "s51": None}
    # 그 자리에서 채운다: route_list 안의 바로 그 객체 (plan 336행)
    assert r.entries[1].stations[0].role == "primary"
    assert r.entries[2].nearby[0].role == "backup"


# ---------------------------------------------------------------- 기준 4: 시나리오 B

def test_4_scenario_b():
    r, rec = run(route=make_route(ra2_down=True))
    assert rec.status == "ok"
    assert rec.primary.station_id == "n31"
    assert rec.primary.rest_area_id == "ra3"
    assert rec.primary.score == 4
    assert rec.primary.final_price == pytest.approx(240.0)
    assert rec.backup.station_id == "s41"
    assert rec.backup.rest_area_id == "ra4"
    assert rec.backup.final_price == pytest.approx(360.0)
    assert rec.backup.score == 2
    assert rec.alerts == []
    assert roles(r) == {"s11": None, "s21": None, "s22": None, "s31": None,
                        "n31": "primary", "s41": "backup", "s51": None}
    # 예비 entry 의 도착 잔량은 원점 기준 그대로 (plan 336행은 role 만 채운다)
    assert stations_of(r)["s41"].arrival_soc_pct == pytest.approx(20.0)


def test_4_scenario_b_tie_broken_by_price_not_order():
    """s11(4, 280) 이 입력에서 먼저지만 n31(4, 240) 이 이긴다 — 정렬 키 둘째가 가격 (plan 326행)."""
    v = make_vehicle()
    st = stations_of(build(route=make_route(ra2_down=True), vehicle=v))
    assert rc().score_candidate(st["s11"], v) == rc().score_candidate(st["n31"], v) == 4
    assert rc().recommend(build(route=make_route(ra2_down=True), vehicle=v), v).primary.station_id == "n31"


# ---------------------------------------------------------------- 기준 5: 시나리오 C

def test_5_scenario_c_no_backup():
    r, rec = run(soc=30.0)
    assert rec.status == "ok"
    assert rec.primary.station_id == "s11"
    assert rec.primary.rest_area_id == "ra1"
    assert rec.primary.score == 2  # c1 + m0(여유 5) + f1 (4.5절 C)
    assert rec.backup is None
    assert codes(rec.alerts) == [ac().NO_BACKUP]
    assert roles(r)["s11"] == "primary"
    assert [sid for sid, role in roles(r).items() if role is not None] == ["s11"]


# ---------------------------------------------------------------- 기준 6: 시나리오 D

def test_6_scenario_d_no_safe_station():
    r, rec = run(soc=20.0)
    assert rec.status == "no_safe_station"
    assert rec.primary is None
    assert rec.backup is None
    assert codes(rec.alerts) == [ac().NO_SAFE_STATION]
    assert all(role is None for role in roles(r).values())


# ---------------------------------------------------------------- 기준 7: 시나리오 E (경계 15.0)

def test_7_scenario_e():
    r, rec = run(soc=35.0)
    assert rec.status == "ok"
    assert rec.primary.station_id == "s11"
    assert rec.primary.score == 3
    assert rec.primary.final_price == pytest.approx(280.0)
    assert rec.backup.station_id == "s21"
    assert rec.backup.score == 3
    assert rec.backup.final_price == pytest.approx(288.0)
    assert rec.backup.station_id != "s22"
    assert rec.alerts == []
    assert roles(r)["s22"] is None


def test_7_scenario_e_scores():
    v = make_vehicle(35.0)
    st = stations_of(build(vehicle=v))
    assert rc().score_candidate(st["s11"], v) == 3
    assert rc().score_candidate(st["s21"], v) == 3
    assert rc().score_candidate(st["s22"], v) == 1


# ---------------------------------------------------------------- 기준 8: 앞쪽 규칙

def test_8_s11_upgraded_becomes_primary_backup_ahead():
    r, rec = run(route=make_route(s11_spec="FA FA FA"))
    assert rec.primary.station_id == "s11"
    assert rec.primary.score == 5
    assert rec.backup.station_id == "s21"
    assert rec.backup.score == 5
    assert rec.alerts == []


def test_8_passed_rest_area_is_not_backup():
    """기준 3(primary s21)에서 뒤쪽 s11(점수 4)은 예비가 아니다."""
    _, rec = run()
    assert rec.primary.station_id == "s21"
    assert rec.backup.station_id != "s11"


def test_8_passed_rest_area_not_backup_even_if_best():
    """뒤쪽 s11 이 예비 후보 중 정렬상 최고여도(4, 200 < n31 240) 예비가 아니다 (plan 330행, D8).

    s11 1kWh 250원 → 구독 20 % → 200. 앞쪽 규칙을 빼먹은 구현은 s11 을 고른다.
    """
    r, rec = run(route=make_route(s11_price=250.0))
    assert rec.primary.station_id == "s21"
    assert rec.backup.station_id == "n31"
    assert roles(r)["s11"] is None


def test_8_forward_rule_uses_rest_area_distance_not_detour():
    """앞쪽 판정은 휴게소의 남은 거리(detour 제외)로 한다 (plan 330행).

    시나리오 B + ra4 거리 90: 1순위 n31(휴게소 81, 왕복 포함 91.8). s41 은 90 > 81 이라 앞쪽.
    s41 도착 60 − 90/2.7 ≈ 26.67, 1순위 왕복 4 를 빼도 ≈ 22.67 ≥ 15.
    s41 점수는 c1 + m1(여유 ≈ 11.67) + f1 = 3.
    1순위의 remaining_km(91.8)로 비교하는 구현은 예비를 못 찾는다.
    """
    _, rec = run(route=make_route(ra2_down=True, ra4_distance=90.0))
    assert rec.primary.station_id == "n31"
    assert rec.backup.station_id == "s41"
    assert rec.alerts == []


def test_8_same_distance_other_rest_area_is_not_ahead():
    """앞쪽은 '>' 엄격 비교 (plan 330행). 같은 거리(54)의 다른 휴게소는 앞쪽이 아니다.

    ra2b(54)에 s2b(별빛차지 급속A×3, 100 → 80, 점수 5)를 두면 1순위 s2b.
    같은 거리 ra2 의 s21(5, 288)은 예비가 아니고, 예비는 n31.
    """
    r, rec = run(route=make_route(ra2_twin=station("s2b", "별빛차지", "FA FA FA", 100.0, 11, 55)))
    assert rec.primary.station_id == "s2b"
    assert rec.primary.rest_area_id == "ra2b"
    assert rec.primary.final_price == pytest.approx(80.0)
    assert rec.backup.station_id == "n31"
    assert roles(r)["s21"] is None


# ---------------------------------------------------------------- 기준 9: 예비 도달 규칙

def test_9_backup_reach_subtracts_primary_detour():
    """B + ra4 113.4: s41 원점 도착 18, n31 왕복 10.8/2.7 = 4 를 빼면 14 < 15 → 예비 없음."""
    r, rec = run(route=make_route(ra2_down=True, ra4_distance=113.4))
    assert stations_of(r)["s41"].arrival_soc_pct == pytest.approx(18.0)
    assert stations_of(r)["s41"].is_candidate is True
    assert rec.status == "ok"
    assert rec.primary.station_id == "n31"
    assert rec.backup is None
    assert codes(rec.alerts) == [ac().NO_BACKUP]
    assert roles(r)["s41"] is None


def test_9_backup_reach_boundary_exact_15_allowed():
    """B + ra4 110.7: s41 원점 도착 19, 왕복 4 를 빼면 정확히 15 → 허용 (plan 331행, 3.1절 1e-9)."""
    _, rec = run(route=make_route(ra2_down=True, ra4_distance=110.7))
    assert rec.primary.station_id == "n31"
    assert rec.backup.station_id == "s41"
    assert rec.alerts == []


def test_9_backup_reach_tolerance_float_error():
    """허용 오차 1e-9 가 실제로 필요한 경계 (plan 51·331행).

    B + n31 왕복 1.1, ra4 120.4: 수학으로는 60 − 120.4/2.7 − 1.1/2.7 = 15 정확히지만
    float 로는 14.999999999999996 이 나온다 → 오차 없이 비교하면 예비를 잃는다.
    n31: 도착 ≈ 29.6, c2 + m1 + f1 = 4, 240 → 1순위 그대로. s41: 도착 ≈ 15.4, 점수 2.
    """
    _, rec = run(route=make_route(ra2_down=True, n31_detour=1.1, ra4_distance=120.4))
    assert rec.primary.station_id == "n31"
    assert rec.backup.station_id == "s41"
    assert rec.alerts == []


def test_9_backup_reach_uses_vehicle_min_arrival():
    """도달 기준은 vehicle.min_arrival_soc_pct (plan 331행), 15 고정이 아니다.

    B + ra4 113.4 + 최소 잔량 10: s41 은 18 − 4 = 14 ≥ 10 → 예비. (최소 15 면 예비 없음 — 위 테스트)
    ra5 s51(도착 ≈ 10, 점수 3, 270)이 정렬상 앞이지만 10 − 4 = 6 < 10 이라 탈락.
    s31(도착 30, 최소 10 이면 점수 3·270 으로 새 후보)은 1순위 휴게소 ra3 라 제외.
    """
    _, rec = run(route=make_route(ra2_down=True, ra4_distance=113.4), min_arrival=10.0)
    assert rec.primary.station_id == "n31"
    assert rec.backup.station_id == "s41"
    assert rec.alerts == []


def test_9_backup_own_detour_not_subtracted_twice():
    """빼는 것은 1순위의 왕복뿐이다 (plan 331행). 예비 후보의 왕복은 이미 arrival_soc_pct 에 들어 있다.

    n31 을 못 쓰게 하고 ra4 에 나들목 n41(한빛이브이 급속A×3, 300 → 270, 왕복 10.8)을 둔다.
    n41 도착 = 60 − 118.8/2.7 = 16 → c2 + m0 + f1 = 3. 1순위 s21 은 안 충전소라 16 ≥ 15 → 예비 n41.
    자기 왕복을 한 번 더 빼면 12 가 되어 s31 을 고르게 된다.
    """
    mm = m()
    n41 = mm.NearbyStation(station=station("n41", "한빛이브이", "FA FA FA", 300.0, 11, 58),
                           detour_km=10.8)
    r, rec = run(route=make_route(n31_spec="FO FO FO FO", ra4_nearby=[n41]))
    assert stations_of(r)["n41"].arrival_soc_pct == pytest.approx(16.0)
    assert rec.primary.station_id == "s21"
    assert rec.backup.station_id == "n41"
    assert rec.backup.is_nearby is True
    assert rec.backup.score == 3


# ---------------------------------------------------------------- 기준 10: 같은 휴게소는 예비 아님

def test_10_same_rest_area_station_not_backup():
    r, rec = run()
    assert rec.backup.rest_area_id != rec.primary.rest_area_id
    assert rec.backup.station_id != "s22"
    assert roles(r)["s22"] is None


def test_10_same_rest_area_nearby_not_backup():
    """1순위 휴게소 ra2 의 나들목 인근 n21(왕복 2 km, 남은 56 > 54, 점수 4, 80원)은 예비가 아니다.

    plan 329~330행: 휴게소 id 가 같으면 안 되고, 앞쪽 판정은 detour 를 뺀 휴게소 거리로 한다.
    n21: c1 + m2(도착 ≈ 39.3) + f1 = 4, 100원 × 0.8 = 80 → 정렬상 n31(4, 240) 보다 앞이지만 제외.
    """
    mm = m()
    n21 = mm.NearbyStation(station=station("n21", "별빛차지", "FA FA", 100.0, 11, 55), detour_km=2.0)
    r, rec = run(route=make_route(ra2_nearby=[n21]))
    assert rec.primary.station_id == "s21"
    assert rec.backup.station_id == "n31"
    assert roles(r)["n21"] is None


# ---------------------------------------------------------------- 기준 11: 빈 리스트 · 두 번 호출

def test_11_empty_route_list():
    rlist = rl().RouteList("경부고속도로", "부산방향", [])
    rec = rc().recommend(rlist, make_vehicle())
    assert rec.status == "no_safe_station"
    assert rec.primary is None
    assert rec.backup is None
    assert codes(rec.alerts) == [ac().NO_SAFE_STATION]


def test_11_empty_rest_areas_only():
    """충전소 0개 휴게소만 있는 노선도 오류 없이 no_safe_station (plan 337행)."""
    mm = m()
    route = mm.Route("경부고속도로", "부산방향", [mm.RestArea("rx", "시험 휴게소", 10.0, [])])
    _, rec = run(route=route)
    assert rec.status == "no_safe_station"
    assert codes(rec.alerts) == [ac().NO_SAFE_STATION]


def test_11_no_usable_fast_only_is_no_safe_station():
    """갈 수 있어도 쓸 수 있는 급속이 없으면 후보가 아니다(is_candidate, plan 290·325행)."""
    mm = m()
    route = mm.Route("경부고속도로", "부산방향", [mm.RestArea("rx", "시험 휴게소", 10.0, [
        station("x1", "별빛차지", "FC FO SA", 300.0)])])
    r, rec = run(route=route)
    assert rec.status == "no_safe_station"
    assert roles(r) == {"x1": None}


def test_11_recommend_twice_no_duplicate_roles():
    v = make_vehicle()
    r = build(vehicle=v)
    rc().recommend(r, v)
    rec = rc().recommend(r, v)
    vals = list(roles(r).values())
    assert vals.count("primary") == 1
    assert vals.count("backup") == 1
    assert rec.primary.station_id == "s21"
    assert rec.backup.station_id == "n31"


def test_11_stale_roles_are_reset():
    """recommend 는 나머지 role 을 None 으로 리셋한다 (plan 336행). 후보가 아닌 s51 도 포함."""
    v = make_vehicle()
    r = build(vehicle=v)
    st = stations_of(r)
    st["s11"].role = "primary"
    st["s51"].role = "backup"
    st["s22"].role = "backup"
    rc().recommend(r, v)
    assert roles(r) == {"s11": None, "s21": "primary", "s22": None, "s31": None,
                        "n31": "backup", "s41": None, "s51": None}


def test_11_roles_reset_when_no_safe_station():
    """같은 리스트를 다른 상황으로 다시 추천: 시나리오 D 차량이면 모든 role None (plan 336행)."""
    r = build(vehicle=make_vehicle(20.0))
    for s in stations_of(r).values():
        s.role = "primary"
    rec = rc().recommend(r, make_vehicle(20.0))
    assert rec.status == "no_safe_station"
    assert all(role is None for role in roles(r).values())


# ---------------------------------------------------------------- 추가: 정렬 키 동률 (plan 326행)

def _route(*rest_areas):
    mm = m()
    return mm.Route("경부고속도로", "부산방향", [
        mm.RestArea(rid, f"{rid} 휴게소", dist, stations, nearby) for rid, dist, stations, nearby in rest_areas])


def _near(sid, detour, spec="FA FA", price=300.0):
    return m().NearbyStation(station=station(sid, "한빛이브이", spec, price), detour_km=detour)


def test_extra_tie_broken_by_remaining_km():
    """점수·가격 같음 → 남은 거리 짧은 쪽 (정렬 키 셋째).

    na: ra_a 10 + 왕복 10 = 20, nb: ra_b 12 + 왕복 0 = 12. 둘 다 c1 + m2 + f1 = 4, 270원.
    입력 순서는 na 가 먼저라 남은 거리 키를 빼먹은 구현은 na 를 고른다.
    """
    r, rec = run(route=_route(("ra_a", 10.0, [], [_near("na", 10.0)]),
                              ("ra_b", 12.0, [], [_near("nb", 0.0)])))
    v = make_vehicle()
    st = stations_of(r)
    assert rc().score_candidate(st["na"], v) == rc().score_candidate(st["nb"], v) == 4
    assert rec.primary.station_id == "nb"
    assert rec.backup is None  # na 는 뒤쪽 휴게소
    assert codes(rec.alerts) == [ac().NO_BACKUP]


def test_extra_tie_broken_by_is_nearby():
    """점수·가격·남은 거리 같음 → 안 충전소(is_nearby False) 먼저 (정렬 키 넷째).

    na: ra_a 10 + 왕복 10 = 20 (나들목), sb: ra_b 20 (안). 입력 순서는 na 가 먼저.
    """
    r, rec = run(route=_route(("ra_a", 10.0, [], [_near("na", 10.0)]),
                              ("ra_b", 20.0, [station("sb", "한빛이브이", "FA FA", 300.0)], [])))
    st = stations_of(r)
    assert st["na"].remaining_km == pytest.approx(st["sb"].remaining_km)
    assert rec.primary.station_id == "sb"
    assert rec.primary.is_nearby is False


def test_extra_full_tie_keeps_input_order():
    """키가 모두 같으면 입력 순서 (안정 정렬, plan 326행). id 순서(a1 < z1)가 아니다."""
    r, rec = run(route=_route(("rx", 10.0, [
        station("z1", "한빛이브이", "FA FA", 300.0),
        station("a1", "한빛이브이", "FA FA", 300.0),
    ], [])))
    assert rec.primary.station_id == "z1"
    assert rec.backup is None
    assert roles(r) == {"z1": "primary", "a1": None}


def test_extra_backup_is_best_sorted_among_eligible():
    """예비도 같은 정렬 키로 첫째 (plan 333행). n31 을 못 쓰게 하면 자격 있는 s31(2, 270)·s41(2, 360) 중
    점수 동률 → 가격으로 s31. (s31 이 가장 가깝기도 해서 남은 거리 순 구현과는 여기서 갈리지 않는다;
    그 구분은 test_extra_backup_price_beats_distance 가 한다.)"""
    r, rec = run(route=make_route(n31_spec="FO FO FO FO"))  # n31 못 씀
    assert rec.primary.station_id == "s21"
    assert rec.backup.station_id == "s31"
    assert rec.backup.score == 2
    assert stations_of(r)["n31"].is_candidate is False


def test_extra_backup_price_beats_distance():
    """예비 정렬에서 가격이 남은 거리보다 먼저 (plan 326·333행): n31 을 못 쓰게 하고
    s31 을 420원(그린카드 → 378)으로 올리면 점수 2 동률에서 더 먼 s41(360)이 예비."""
    route = make_route(n31_spec="FO FO FO FO")
    route.rest_areas[2].stations[0].price_per_kwh = 420.0
    _, rec = run(route=route)
    assert rec.backup.station_id == "s41"
    assert rec.backup.final_price == pytest.approx(360.0)


def test_extra_backup_score_beats_price():
    """예비 정렬도 점수가 가격보다 먼저: s41 을 아주 싸게(100원 → 90) 해도 n31(4, 240)이 예비 (plan 326·333행)."""
    route = make_route()
    route.rest_areas[3].stations[0].price_per_kwh = 100.0
    _, rec = run(route=route)
    assert rec.backup.station_id == "n31"


# ---------------------------------------------------------------- 추가: 지난 검증의 고칠 점 (라운드 2)

def test_extra_single_fast_charger_can_be_primary():
    """plan 290행 is_candidate = reachable ∧ usable_fast ≥ 1, 325행. 급속 1대도 후보.

    시나리오 C(잔량 30) + s11 급속A×1: 도착 20, c0 + m0(여유 5) + f1 = 1 → 1순위 s11.
    """
    r, rec = run(route=make_route(s11_spec="FA FC SA"), soc=30.0)
    assert rec.status == "ok"
    assert rec.primary.station_id == "s11"
    assert rec.primary.score == 1
    assert rec.backup is None
    assert codes(rec.alerts) == [ac().NO_BACKUP]


def test_extra_primary_detour_uses_km_per_pct_with_margin():
    """plan 331행 primary.detour_km / km_per_pct(vehicle); driving_range.py km_per_pct 는 여유 0.10 반영 2.7.

    B + ra4 111.24: s41 원점 도착 60 − 111.24/2.7 = 18.8, n31 왕복 10.8/2.7 = 4 를 빼면 14.8 < 15 → 예비 없음.
    여유 없는 3.0 으로 빼면 18.8 − 3.6 = 15.2 로 s41 이 예비가 되어 틀림.
    """
    _, rec = run(route=make_route(ra2_down=True, ra4_distance=111.24))
    assert rec.primary.station_id == "n31"
    assert rec.backup is None
    assert codes(rec.alerts) == [ac().NO_BACKUP]


def test_extra_nearby_primary_and_nearby_backup_candidate():
    """plan 331행 entry.arrival_soc_pct(나들목은 자기 왕복이 이미 들어간 값, D9 43행).

    B + ra4 나들목 n41(왕복 5.4): 남은 113.4, 원점 도착 18, c2 + m0 + f1 = 3 → 정렬상 s41(2)보다 앞.
    1순위 n31 왕복 4 를 빼면 14 < 15 → 탈락. s41 은 20 − 4 = 16 → 예비.
    휴게소 도착 잔량(20)으로 검사하면 n41 을 예비로 고름.
    """
    n41 = m().NearbyStation(station=station("n41", "한빛이브이", "FA FA FA", 300.0, 11, 58), detour_km=5.4)
    r, rec = run(route=make_route(ra2_down=True, ra4_nearby=[n41]))
    assert stations_of(r)["n41"].arrival_soc_pct == pytest.approx(18.0)
    assert rec.primary.station_id == "n31"
    assert rec.backup.station_id == "s41"
    assert roles(r)["n41"] is None


def test_extra_same_distance_twin_after_primary_is_not_backup():
    """plan 330행 '>' 엄격 비교. 같은 거리(54) ra2b 의 s2b 는 s21 과 완전 동률(5, 288, 54, False).

    입력 순서로 1순위 s21. entries 인덱스로 앞쪽을 판정하는 구현은 s2b 를 예비로 고른다.
    """
    r, rec = run(route=make_route(ra2_twin=station("s2b", "한빛이브이", "FA FA FA", 320.0, 11, 45)))
    assert rec.primary.station_id == "s21"
    assert rec.backup.station_id == "n31"
    assert roles(r)["s2b"] is None


def test_extra_non_integer_price_not_rounded():
    """plan 50행 3.1절 반올림 금지: s21 319.5원 → 그린카드 10 % → 287.55."""
    route = make_route()
    route.rest_areas[1].stations[0].price_per_kwh = 319.5
    _, rec = run(route=route)
    assert rec.primary.station_id == "s21"
    assert rec.primary.final_price == pytest.approx(287.55)


def test_extra_non_integer_backup_arrival_is_origin_based():
    """B + ra4 110: s41 원점 도착 60 − 110/2.7 ≈ 19.259259, 1순위 왕복 4 를 빼도 ≈ 15.26 ≥ 15 → 예비.

    Pick.arrival_soc_pct 는 원점 기준 그대로(1순위 출발 기준 값은 자격 판정에만 쓴다, 판정 [계획 보완]).
    """
    _, rec = run(route=make_route(ra2_down=True, ra4_distance=110.0))
    assert rec.backup.station_id == "s41"
    assert rec.backup.arrival_soc_pct == pytest.approx(60 - 110 / 2.7)
