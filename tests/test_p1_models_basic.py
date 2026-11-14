"""p1_models 통과 기준 테스트 (docs/plan.md 5절 p1_models).

구현 전에는 실패하는 것이 정상이다. 수집 오류가 나지 않도록
패키지는 모듈 맨 위가 아니라 각 테스트 안에서 불러온다.
"""
import ast
import importlib
import re
from datetime import datetime
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
T = datetime(2026, 1, 1, 11, 50)  # 3.2: 작업일과 먼 고정 시각


def pkg():
    return importlib.import_module("ev_charge_planner")


def models():
    return importlib.import_module("ev_charge_planner.models")


# ---------- 만들기 도우미 ----------

def charger(**kw):
    m = pkg()
    args = dict(type=m.ChargerType.FAST, power_kw=100.0, status=m.ChargerStatus.AVAILABLE)
    args.update(kw)
    return m.Charger(**args)


def station(id="s11", **kw):
    m = pkg()
    args = dict(id=id, operator="별빛차지", chargers=[charger()], price_per_kwh=350.0,
                status_updated_at=T)
    args.update(kw)
    return m.Station(**args)


def rest_area(id="ra1", distance_km=27.0, stations=None, **kw):
    m = pkg()
    args = dict(id=id, name="달빛 휴게소", distance_km=distance_km,
                stations=[station("s_" + id)] if stations is None else stations)
    args.update(kw)
    return m.RestArea(**args)


def route(rest_areas, **kw):
    m = pkg()
    args = dict(highway="경부고속도로", direction="부산방향", rest_areas=rest_areas)
    args.update(kw)
    return m.Route(**args)


def vehicle(**kw):
    m = pkg()
    args = dict(soc_pct=60.0, battery_kwh=60.0, efficiency_km_per_kwh=5.0)
    args.update(kw)
    return m.Vehicle(**args)


# ---------- 기준 1: 정상 값과 기본값 ----------

def test_exports_all_public_names():
    m = pkg()
    mm = models()
    names = ["Charger", "ChargerType", "ChargerStatus", "Station", "NearbyStation",
             "RestArea", "Route", "Vehicle", "DiscountCard", "Subscription", "User",
             "Alert", "AlertCode"]
    for n in names:
        assert hasattr(m, n), n
        assert getattr(m, n) is getattr(mm, n), n
    assert hasattr(mm, "UNUSABLE_STATUSES")


def test_charger_normal():
    m = pkg()
    c = m.Charger(type=m.ChargerType.FAST, power_kw=100.0, status=m.ChargerStatus.AVAILABLE)
    assert c.type is m.ChargerType.FAST
    assert c.power_kw == pytest.approx(100.0)
    assert c.status is m.ChargerStatus.AVAILABLE


def test_station_normal_and_empty_chargers_allowed():
    s = station()
    assert s.id == "s11"
    assert s.operator == "별빛차지"
    assert len(s.chargers) == 1
    assert s.price_per_kwh == pytest.approx(350.0)
    assert s.status_updated_at == T
    empty = station(chargers=[])
    assert empty.chargers == []


def test_nearby_station_normal():
    m = pkg()
    n = m.NearbyStation(station=station("n31"), detour_km=10.8)
    assert n.station.id == "n31"
    assert n.detour_km == pytest.approx(10.8)


def test_rest_area_normal_and_default_nearby():
    r = rest_area()
    assert r.id == "ra1"
    assert r.name == "달빛 휴게소"
    assert r.distance_km == pytest.approx(27.0)
    assert len(r.stations) == 1
    assert r.nearby == []
    assert rest_area(stations=[]).stations == []


def test_rest_area_default_nearby_not_shared():
    """기본값 [] 가 인스턴스끼리 공유되면 안 된다(5절 p1 표 nearby = [] 는 인스턴스마다 새 리스트)."""
    a = rest_area("ra1")
    b = rest_area("ra2")
    assert a.nearby is not b.nearby
    a.nearby.append("x")
    assert b.nearby == []


def test_route_normal():
    m = pkg()
    ras = [rest_area("ra1", 27.0), rest_area("ra2", 54.0)]
    r = m.Route(highway="경부고속도로", direction="부산방향", rest_areas=ras)
    assert r.highway == "경부고속도로"
    assert r.direction == "부산방향"
    assert [x.id for x in r.rest_areas] == ["ra1", "ra2"]


def test_vehicle_normal_and_defaults():
    v = vehicle()
    assert v.soc_pct == pytest.approx(60.0)
    assert v.battery_kwh == pytest.approx(60.0)
    assert v.efficiency_km_per_kwh == pytest.approx(5.0)
    assert v.safety_margin_ratio == pytest.approx(0.10)
    assert v.min_arrival_soc_pct == pytest.approx(15.0)


def test_user_defaults():
    m = pkg()
    u = m.User()
    assert u.subscription is None
    assert u.cards == []


def test_user_default_cards_not_shared():
    """기본값 [] 가 인스턴스끼리 공유되면 안 된다(5절 p1 표 cards = [])."""
    m = pkg()
    a, b = m.User(), m.User()
    assert a.cards is not b.cards
    a.cards.append("x")
    assert b.cards == []


def test_user_with_subscription_and_cards():
    m = pkg()
    sub = m.Subscription(operator="별빛차지", rate=0.20, excluded_rest_area_ids={"ra4"})
    card = m.DiscountCard(name="그린카드", rate=0.10)
    u = m.User(subscription=sub, cards=[card])
    assert u.subscription.operator == "별빛차지"
    assert u.subscription.rate == pytest.approx(0.20)
    assert u.cards[0].name == "그린카드"


def test_subscription_default_excluded_is_empty_frozenset():
    m = pkg()
    s = m.Subscription(operator="별빛차지", rate=0.2)
    assert s.excluded_rest_area_ids == frozenset()
    assert isinstance(s.excluded_rest_area_ids, frozenset)


def test_subscription_set_converted_to_frozenset():
    m = pkg()
    s = m.Subscription(operator="별빛차지", rate=0.2, excluded_rest_area_ids={"ra4", "ra9"})
    assert isinstance(s.excluded_rest_area_ids, frozenset)
    assert s.excluded_rest_area_ids == frozenset({"ra4", "ra9"})


def test_subscription_unknown_excluded_id_is_not_error():
    """5절 p1: 노선에 없는 id 가 있어도 오류 아님."""
    m = pkg()
    s = m.Subscription(operator="별빛차지", rate=0.2, excluded_rest_area_ids={"없는id"})
    assert "없는id" in s.excluded_rest_area_ids


def test_discount_card_operators_default_none():
    m = pkg()
    c = m.DiscountCard(name="그린카드", rate=0.1)
    assert c.operators is None


def test_discount_card_set_converted_to_frozenset():
    m = pkg()
    c = m.DiscountCard(name="그린카드", rate=0.1, operators={"별빛차지"})
    assert isinstance(c.operators, frozenset)
    assert c.operators == frozenset({"별빛차지"})
    empty = m.DiscountCard(name="빈카드", rate=0.1, operators=set())
    assert isinstance(empty.operators, frozenset)
    assert empty.operators == frozenset()


# ---------- 기준 2: Enum 또는 값 문자열 ----------

def test_enum_values():
    m = pkg()
    assert m.ChargerType.FAST.value == "fast"
    assert m.ChargerType.SLOW.value == "slow"
    assert {s.value for s in m.ChargerStatus} == {
        "available", "charging", "out_of_service", "maintenance", "comm_error"}
    assert len(list(m.ChargerStatus)) == 5
    # 0절: class X(str, Enum)
    assert isinstance(m.ChargerType.FAST, str)
    assert isinstance(m.ChargerStatus.AVAILABLE, str)
    assert isinstance(m.AlertCode.UNREACHABLE, str)


def test_charger_accepts_value_strings():
    m = pkg()
    c = m.Charger(type="fast", status="available", power_kw=100)
    assert c.type is m.ChargerType.FAST
    assert c.status is m.ChargerStatus.AVAILABLE
    c2 = m.Charger(type="slow", status="comm_error", power_kw=7)
    assert c2.type is m.ChargerType.SLOW
    assert c2.status is m.ChargerStatus.COMM_ERROR


@pytest.mark.parametrize("status", ["available", "charging", "out_of_service",
                                    "maintenance", "comm_error"])
def test_charger_every_status_string(status):
    m = pkg()
    c = m.Charger(type="fast", status=status, power_kw=100)
    assert c.status is m.ChargerStatus(status)


def test_charger_unknown_type_string():
    m = pkg()
    with pytest.raises(ValueError):
        m.Charger(type="fastt", status="available", power_kw=100)


def test_charger_unknown_status_string():
    m = pkg()
    with pytest.raises(ValueError):
        m.Charger(type="fast", status="broken", power_kw=100)


# ---------- 기준 3: ValueError 경우 각각 ----------

def test_power_kw_zero():
    with pytest.raises(ValueError):
        charger(power_kw=0)


def test_power_kw_negative():
    with pytest.raises(ValueError):
        charger(power_kw=-7)


def test_power_kw_small_positive_ok():
    assert charger(power_kw=0.001).power_kw == pytest.approx(0.001)


def test_price_negative():
    with pytest.raises(ValueError):
        station(price_per_kwh=-1)


def test_price_zero_ok():
    assert station(price_per_kwh=0).price_per_kwh == 0


def test_station_empty_id():
    with pytest.raises(ValueError):
        station(id="")


def test_station_empty_operator():
    with pytest.raises(ValueError):
        station(operator="")


def test_station_updated_at_not_datetime():
    """5절 p1 표 Station 행: status_updated_at 은 datetime 이어야 한다(검증 열 → ValueError)."""
    with pytest.raises(ValueError):
        station(status_updated_at="2026-01-01 11:50")


def test_detour_negative():
    m = pkg()
    with pytest.raises(ValueError):
        m.NearbyStation(station=station("n31"), detour_km=-1)


def test_detour_zero_ok():
    m = pkg()
    assert m.NearbyStation(station=station("n31"), detour_km=0).detour_km == 0


def test_distance_negative():
    with pytest.raises(ValueError):
        rest_area(distance_km=-1)


def test_distance_zero_ok():
    assert rest_area(distance_km=0).distance_km == 0


def test_rest_area_empty_id():
    with pytest.raises(ValueError):
        rest_area(id="")


def test_rest_area_empty_name():
    with pytest.raises(ValueError):
        rest_area(name="")


def test_route_empty_highway():
    with pytest.raises(ValueError):
        route([rest_area()], highway="")


def test_route_empty_direction():
    with pytest.raises(ValueError):
        route([rest_area()], direction="")


@pytest.mark.parametrize("soc", [101, -1, 100.0001, -0.0001])
def test_soc_out_of_range(soc):
    with pytest.raises(ValueError):
        vehicle(soc_pct=soc)


@pytest.mark.parametrize("soc", [0, 100, 0.0, 100.0])
def test_soc_boundaries_ok(soc):
    assert vehicle(soc_pct=soc).soc_pct == soc


@pytest.mark.parametrize("bad", [0, -60])
def test_battery_not_positive(bad):
    with pytest.raises(ValueError):
        vehicle(battery_kwh=bad)


@pytest.mark.parametrize("bad", [0, -5])
def test_efficiency_not_positive(bad):
    with pytest.raises(ValueError):
        vehicle(efficiency_km_per_kwh=bad)


@pytest.mark.parametrize("bad", [1.0, -0.1, 1.5])
def test_margin_out_of_range(bad):
    with pytest.raises(ValueError):
        vehicle(safety_margin_ratio=bad)


@pytest.mark.parametrize("ok", [0.0, 0.5, 0.99])
def test_margin_boundaries_ok(ok):
    assert vehicle(safety_margin_ratio=ok).safety_margin_ratio == ok


@pytest.mark.parametrize("bad", [101, -1])
def test_min_arrival_out_of_range(bad):
    with pytest.raises(ValueError):
        vehicle(min_arrival_soc_pct=bad)


@pytest.mark.parametrize("ok", [0, 100])
def test_min_arrival_boundaries_ok(ok):
    assert vehicle(min_arrival_soc_pct=ok).min_arrival_soc_pct == ok


@pytest.mark.parametrize("bad", [0, 1, -0.1, 1.5])
def test_card_rate_out_of_range(bad):
    m = pkg()
    with pytest.raises(ValueError):
        m.DiscountCard(name="그린카드", rate=bad)


def test_card_empty_name():
    m = pkg()
    with pytest.raises(ValueError):
        m.DiscountCard(name="", rate=0.1)


@pytest.mark.parametrize("bad", [1.5, 0, 1, -0.2])
def test_subscription_rate_out_of_range(bad):
    m = pkg()
    with pytest.raises(ValueError):
        m.Subscription(operator="별빛차지", rate=bad)


def test_subscription_empty_operator():
    m = pkg()
    with pytest.raises(ValueError):
        m.Subscription(operator="", rate=0.2)


@pytest.mark.parametrize("ok", [0.01, 0.5, 0.99])
def test_rates_inside_range_ok(ok):
    m = pkg()
    assert m.DiscountCard(name="그린카드", rate=ok).rate == ok
    assert m.Subscription(operator="별빛차지", rate=ok).rate == ok


# ---------- 기준 4: Route 검증 ----------

def test_route_reverse_distance():
    with pytest.raises(ValueError):
        route([rest_area("ra2", 54.0), rest_area("ra1", 27.0)])


def test_route_reverse_distance_later_in_list():
    with pytest.raises(ValueError):
        route([rest_area("ra1", 27.0), rest_area("ra2", 54.0), rest_area("ra3", 50.0)])


def test_route_same_distance_allowed():
    r = route([rest_area("ra1", 27.0), rest_area("ra2", 27.0)])
    assert len(r.rest_areas) == 2


def test_route_duplicate_rest_area_id():
    with pytest.raises(ValueError):
        route([rest_area("ra1", 27.0, stations=[station("s1")]),
               rest_area("ra1", 54.0, stations=[station("s2")])])


def test_route_inner_and_nearby_station_id_duplicate():
    m = pkg()
    ra = rest_area("ra3", 81.0, stations=[station("s31")],
                   nearby=[m.NearbyStation(station=station("s31"), detour_km=10.8)])
    with pytest.raises(ValueError):
        route([ra])


def test_route_inner_and_nearby_duplicate_across_rest_areas():
    """5절 p1 표 Route 행: 충전소 id(안 + 나들목 인근)는 노선 전체에서 중복 금지."""
    m = pkg()
    ra1 = rest_area("ra1", 27.0, stations=[station("s11")])
    ra3 = rest_area("ra3", 81.0, stations=[station("s31")],
                    nearby=[m.NearbyStation(station=station("s11"), detour_km=10.8)])
    with pytest.raises(ValueError):
        route([ra1, ra3])


def test_route_inner_station_duplicate_across_rest_areas():
    """5절 p1 표 Route 행: 노선 전체에서 충전소 id 중복 금지."""
    with pytest.raises(ValueError):
        route([rest_area("ra1", 27.0, stations=[station("s1")]),
               rest_area("ra2", 54.0, stations=[station("s1")])])


def test_route_empty_rest_areas_allowed():
    r = route([])
    assert r.rest_areas == []


def test_route_with_nearby_distinct_ids_ok():
    m = pkg()
    ra = rest_area("ra3", 81.0, stations=[station("s31")],
                   nearby=[m.NearbyStation(station=station("n31"), detour_km=10.8)])
    r = route([rest_area("ra1", 27.0, stations=[station("s11")]), ra])
    assert r.rest_areas[1].nearby[0].station.id == "n31"


# ---------- 기준 5: UNUSABLE_STATUSES, AlertCode ----------

def test_unusable_statuses():
    m = pkg()
    mm = models()
    S = m.ChargerStatus
    assert mm.UNUSABLE_STATUSES == frozenset({S.OUT_OF_SERVICE, S.MAINTENANCE, S.COMM_ERROR})
    assert isinstance(mm.UNUSABLE_STATUSES, frozenset)
    assert S.AVAILABLE not in mm.UNUSABLE_STATUSES
    assert S.CHARGING not in mm.UNUSABLE_STATUSES


def test_alert_codes_match_plan_table():
    m = pkg()
    expected = {
        "UNREACHABLE": "unreachable",
        "ALL_UNAVAILABLE": "all_unavailable",
        "NO_USABLE_FAST": "no_usable_fast",
        "UNUSABLE_CHARGERS": "unusable_chargers",
        "STALE_INFO": "stale_info",
        "NO_BACKUP": "no_backup",
        "NO_SAFE_STATION": "no_safe_station",
    }
    assert {a.name: a.value for a in m.AlertCode} == expected


def test_alert_holds_code_and_message():
    m = pkg()
    a = m.Alert(code=m.AlertCode.NO_BACKUP, message="예비 충전소가 없습니다")
    assert a.code is m.AlertCode.NO_BACKUP
    assert a.message == "예비 충전소가 없습니다"
    b = m.Alert(m.AlertCode.STALE_INFO, "오래됨")
    assert b.code is m.AlertCode.STALE_INFO


# ---------- pyproject 뼈대 (0절 표) ----------

def _pyproject_text():
    # 3.10 에는 tomllib 이 없어 정규식으로 읽는다(lessons '테스트')
    path = ROOT / "pyproject.toml"
    assert path.is_file(), "pyproject.toml 이 없다"
    return path.read_text(encoding="utf-8")


def test_pyproject_requires_python():
    text = _pyproject_text()
    assert re.search(r'^\s*requires-python\s*=\s*">=3\.10"\s*$', text, re.M)


def test_pyproject_pytest_pythonpath_src():
    text = _pyproject_text()
    assert re.search(r"^\s*\[tool\.pytest\.ini_options\]\s*$", text, re.M)
    assert re.search(r'^\s*pythonpath\s*=\s*\[\s*"src"\s*,?\s*\]\s*$', text, re.M)


def test_pyproject_project_name():
    text = _pyproject_text()
    assert re.search(r'^\s*name\s*=\s*"ev-charge-planner"\s*$', text, re.M)


# ---------- 기준 6: 현재 시각 호출 금지 (AST) ----------

def test_no_current_time_calls_in_src():
    files = sorted(SRC.rglob("*.py"))
    assert files, "src/ 아래 .py 가 없다"
    bad = []
    for f in files:
        tree = ast.parse(f.read_text(encoding="utf-8"), filename=str(f))
        for node in ast.walk(tree):
            if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                    and node.func.attr in {"now", "utcnow", "today"}):
                bad.append(f"{f.relative_to(ROOT)}:{node.lineno}")
    assert bad == [], bad
