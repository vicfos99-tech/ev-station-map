"""p2_range 통과 기준 테스트 (docs/plan.md 5절 p2_range).

구현 전에는 실패하는 것이 정상이다. 수집 오류가 나지 않도록
driving_range 는 모듈 맨 위가 아니라 각 테스트 안에서 불러온다.
기준 차량 V = 60 %, 60 kWh, 5 km/kWh, 안전 여유 0.10, 최소 잔량 15 % (4.1절).
"""
import importlib
from dataclasses import asdict

import pytest


def dr():
    return importlib.import_module("ev_charge_planner.driving_range")


def vehicle(**kw):
    m = importlib.import_module("ev_charge_planner")
    args = dict(soc_pct=60.0, battery_kwh=60.0, efficiency_km_per_kwh=5.0,
                safety_margin_ratio=0.10, min_arrival_soc_pct=15.0)
    args.update(kw)
    return m.Vehicle(**args)


# ---------- 통과 기준 1: 보수적 주행 거리와 1 % 당 거리 ----------

def test_conservative_range_standard():
    assert dr().conservative_range_km(vehicle()) == pytest.approx(162.0)


def test_km_per_pct_standard():
    assert dr().km_per_pct(vehicle()) == pytest.approx(2.7)


def test_conservative_range_margin_zero():
    assert dr().conservative_range_km(vehicle(safety_margin_ratio=0.0)) == pytest.approx(180.0)


def test_km_per_pct_margin_zero():
    assert dr().km_per_pct(vehicle(safety_margin_ratio=0.0)) == pytest.approx(3.0)


def test_conservative_range_soc_zero():
    assert dr().conservative_range_km(vehicle(soc_pct=0.0)) == pytest.approx(0.0)


def test_conservative_range_soc_full():
    assert dr().conservative_range_km(vehicle(soc_pct=100.0)) == pytest.approx(270.0)


def test_km_per_pct_does_not_depend_on_soc():
    """1 % 당 거리 식(5절 p2)에 soc 가 없다."""
    assert dr().km_per_pct(vehicle(soc_pct=0.0)) == pytest.approx(2.7)
    assert dr().km_per_pct(vehicle(soc_pct=100.0)) == pytest.approx(2.7)


def test_results_are_float():
    d = dr()
    v = vehicle(soc_pct=60, battery_kwh=60, efficiency_km_per_kwh=5)  # 정수로 줘도
    assert isinstance(d.conservative_range_km(v), float)
    assert isinstance(d.km_per_pct(v), float)
    assert isinstance(d.arrival_soc_pct(v, 27), float)
    assert isinstance(d.can_reach(v, 27), bool)


# ---------- 통과 기준 2: 도착 잔량 ----------

@pytest.mark.parametrize("distance, expected", [
    (0, 60.0),
    (27, 50.0),
    (54, 40.0),
    (91.8, 26.0),   # 4.3절 n31 (81 + 왕복 10.8)
    (121.5, 15.0),
    (135, 10.0),
    (162, 0.0),     # 보수적 주행 거리 끝
    (189, -10.0),   # 음수 그대로(3.1절, 깎지 않음)
])
def test_arrival_soc_pct_standard(distance, expected):
    assert dr().arrival_soc_pct(vehicle(), distance) == pytest.approx(expected)


def test_arrival_soc_negative_is_not_clamped():
    assert dr().arrival_soc_pct(vehicle(), 189) < 0
    assert dr().arrival_soc_pct(vehicle(), 270) == pytest.approx(-40.0)


def test_arrival_soc_soc_zero_vehicle():
    assert dr().arrival_soc_pct(vehicle(soc_pct=0.0), 0) == pytest.approx(0.0)
    assert dr().arrival_soc_pct(vehicle(soc_pct=0.0), 27) == pytest.approx(-10.0)


# ---------- 통과 기준 3: 갈 수 있는지 ----------

def test_can_reach_boundary_inclusive():
    assert dr().can_reach(vehicle(), 121.5) is True


def test_can_reach_just_beyond_boundary():
    assert dr().can_reach(vehicle(), 121.51) is False


def test_can_reach_too_far():
    assert dr().can_reach(vehicle(), 135) is False


def test_can_reach_zero_distance():
    assert dr().can_reach(vehicle(), 0) is True


@pytest.mark.parametrize("distance, ok", [(27, True), (54, True), (81, True), (108, True), (135, False)])
def test_can_reach_standard_rest_areas(distance, ok):
    """4.2절 표: ra1~ra4 갈 수 있음, ra5 못 감."""
    assert dr().can_reach(vehicle(), distance) is ok


def test_can_reach_boundary_scenario_e():
    """4.5절 (E): 잔량 35 % 에서 ra2(54 km) 도착 정확히 15.0 → 갈 수 있음."""
    v = vehicle(soc_pct=35.0)
    assert dr().arrival_soc_pct(v, 54) == pytest.approx(15.0)
    assert dr().can_reach(v, 54) is True
    assert dr().can_reach(v, 81) is False


def test_can_reach_uses_vehicle_min_arrival():
    """판정 기준은 vehicle.min_arrival_soc_pct (5절 p2 can_reach 식)."""
    v = vehicle(min_arrival_soc_pct=50.0)
    assert dr().can_reach(v, 27) is True
    assert dr().can_reach(v, 27.01) is False


def test_can_reach_tolerance_absorbs_float_error():
    """3.1절 허용 오차 1e-9: 2.7 류 부동소수 오차로 경계가 뒤집히지 않는다."""
    d = dr()
    for soc, dist in [(35.0, 54.0), (60.0, 121.5), (45.0, 81.0), (16.0, 2.7)]:
        v = vehicle(soc_pct=soc)
        assert d.can_reach(v, dist) is True, (soc, dist)


# ---------- 통과 기준 4: 최소 잔량 0 인 차량 ----------

def test_min_arrival_zero_reaches_up_to_conservative_range():
    d = dr()
    v = vehicle(min_arrival_soc_pct=0.0)
    rng = d.conservative_range_km(v)
    assert rng == pytest.approx(162.0)
    assert d.can_reach(v, rng) is True
    assert d.can_reach(v, rng + 0.01) is False


def test_min_arrival_zero_other_vehicle():
    d = dr()
    v = vehicle(soc_pct=33.0, battery_kwh=77.4, efficiency_km_per_kwh=4.3,
                safety_margin_ratio=0.07, min_arrival_soc_pct=0.0)
    rng = d.conservative_range_km(v)
    assert d.can_reach(v, rng) is True
    assert d.can_reach(v, rng + 0.01) is False


def test_soc_zero_min_arrival_zero_only_zero_distance():
    d = dr()
    v = vehicle(soc_pct=0.0, min_arrival_soc_pct=0.0)
    assert d.can_reach(v, 0) is True
    assert d.can_reach(v, 0.01) is False


# ---------- 통과 기준 5: 잘못된 입력 ----------

def test_arrival_soc_negative_distance_raises():
    with pytest.raises(ValueError):
        dr().arrival_soc_pct(vehicle(), -1)


def test_can_reach_negative_distance_raises():
    with pytest.raises(ValueError):
        dr().can_reach(vehicle(), -1)


def test_small_negative_distance_raises():
    """5절 p2: distance_km < 0 이면 ValueError (−1 만이 아니라 0 미만 전부)."""
    with pytest.raises(ValueError):
        dr().arrival_soc_pct(vehicle(), -0.5)


def test_zero_distance_is_not_error():
    assert dr().arrival_soc_pct(vehicle(), 0.0) == pytest.approx(60.0)


# ---------- 통과 기준 6: 각 값의 영향 ----------

def test_battery_doubled():
    d = dr()
    v = vehicle(battery_kwh=120.0)
    assert d.km_per_pct(v) == pytest.approx(5.4)
    assert d.conservative_range_km(v) == pytest.approx(324.0)
    assert d.arrival_soc_pct(v, 27) == pytest.approx(55.0)
    assert d.can_reach(v, 243) is True   # 60 − 243/5.4 = 15
    assert d.can_reach(v, 243.01) is False


def test_efficiency_doubled():
    d = dr()
    v = vehicle(efficiency_km_per_kwh=10.0)
    assert d.km_per_pct(v) == pytest.approx(5.4)
    assert d.conservative_range_km(v) == pytest.approx(324.0)
    assert d.arrival_soc_pct(v, 54) == pytest.approx(50.0)


def test_soc_halved():
    d = dr()
    v = vehicle(soc_pct=30.0)
    assert d.km_per_pct(v) == pytest.approx(2.7)
    assert d.conservative_range_km(v) == pytest.approx(81.0)
    assert d.arrival_soc_pct(v, 27) == pytest.approx(20.0)   # 4.5절 (C) ra1
    assert d.can_reach(v, 27) is True
    assert d.can_reach(v, 54) is False                        # (C) ra2 10 ✗


def test_margin_changed():
    d = dr()
    v = vehicle(safety_margin_ratio=0.20)
    assert d.km_per_pct(v) == pytest.approx(2.4)
    assert d.conservative_range_km(v) == pytest.approx(144.0)
    assert d.arrival_soc_pct(v, 24) == pytest.approx(50.0)


def test_margin_reduces_range_monotonically():
    d = dr()
    ranges = [d.conservative_range_km(vehicle(safety_margin_ratio=m)) for m in (0.0, 0.1, 0.3, 0.5)]
    assert ranges == pytest.approx([180.0, 162.0, 126.0, 90.0])


def test_min_arrival_does_not_change_range_or_arrival():
    """최소 잔량은 거리·도착 잔량 식(5절 p2)에 없고 can_reach 에만 쓰인다."""
    d = dr()
    v = vehicle(min_arrival_soc_pct=40.0)
    assert d.conservative_range_km(v) == pytest.approx(162.0)
    assert d.km_per_pct(v) == pytest.approx(2.7)
    assert d.arrival_soc_pct(v, 27) == pytest.approx(50.0)


# ---------- 순수 함수 ----------

def test_functions_do_not_modify_vehicle():
    d = dr()
    v = vehicle()
    before = dict(asdict(v))
    d.conservative_range_km(v)
    d.km_per_pct(v)
    d.arrival_soc_pct(v, 27)
    d.can_reach(v, 27)
    d.can_reach(v, 500)
    assert asdict(v) == before


def test_same_input_same_output():
    d = dr()
    v = vehicle()
    assert d.arrival_soc_pct(v, 27) == d.arrival_soc_pct(v, 27)
    assert d.can_reach(v, 121.5) == d.can_reach(v, 121.5)
