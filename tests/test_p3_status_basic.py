"""p3_status 통과 기준 테스트 (docs/plan.md 5절 p3_status).

구현 전에는 실패하는 것이 정상이다. 수집 오류가 나지 않도록
status 모듈은 모듈 맨 위가 아니라 각 테스트 안에서 불러온다.
기준 시각 now = 2026-01-01 12:00 (3.2절, 작업일과 먼 고정값).
"""
import importlib
from datetime import datetime, timedelta, timezone

import pytest

NOW = datetime(2026, 1, 1, 12, 0)


def st():
    return importlib.import_module("ev_charge_planner.status")


def m():
    return importlib.import_module("ev_charge_planner")


def at(hour, minute, second=0):
    return datetime(2026, 1, 1, hour, minute, second)


def charger(spec):
    """'FA' = 급속 사용 가능, 'SO' = 완속 운영 중지 ... (A/C/O/M/E)."""
    mm = m()
    kind = {"F": mm.ChargerType.FAST, "S": mm.ChargerType.SLOW}[spec[0]]
    status = {
        "A": mm.ChargerStatus.AVAILABLE,
        "C": mm.ChargerStatus.CHARGING,
        "O": mm.ChargerStatus.OUT_OF_SERVICE,
        "M": mm.ChargerStatus.MAINTENANCE,
        "E": mm.ChargerStatus.COMM_ERROR,
    }[spec[1]]
    power = 100.0 if spec[0] == "F" else 7.0
    return mm.Charger(type=kind, power_kw=power, status=status)


def station(specs, updated=None, sid="s1"):
    return m().Station(
        id=sid,
        operator="별빛차지",
        chargers=[charger(s) for s in specs],
        price_per_kwh=350.0,
        status_updated_at=at(11, 50) if updated is None else updated,
    )


def summarize(specs, updated=None, now=NOW, **kw):
    return st().summarize_station(station(specs, updated), now, **kw)


def codes(alerts):
    return [a.code for a in alerts]


def counts(**kw):
    """A/C/O/M/E 키워드로 5키 전부 있는 기대 counts 를 만든다."""
    S = m().ChargerStatus
    keys = {"A": S.AVAILABLE, "C": S.CHARGING, "O": S.OUT_OF_SERVICE,
            "M": S.MAINTENANCE, "E": S.COMM_ERROR}
    return {keys[k]: kw.get(k, 0) for k in "ACOME"}


# ---------- 통과 기준 1: 기본 집계 (s11) ----------

def test_basic_counts():
    r = summarize(["FA", "FA", "FC", "SA"], at(11, 50))
    assert r.counts == counts(A=3, C=1)


def test_basic_counts_has_all_five_keys():
    r = summarize(["FA", "FA", "FC", "SA"], at(11, 50))
    assert set(r.counts.keys()) == set(m().ChargerStatus)
    assert len(r.counts) == 5


def test_basic_numbers():
    r = summarize(["FA", "FA", "FC", "SA"], at(11, 50))
    assert r.usable_fast == 2
    assert r.waiting_fast == 1
    assert r.usable_slow == 1
    assert r.unusable == 0


def test_basic_not_stale_and_no_alerts():
    r = summarize(["FA", "FA", "FC", "SA"], at(11, 50))
    assert r.is_stale is False
    assert r.alerts == []


def test_returns_station_status_instance():
    r = summarize(["FA"], at(11, 50))
    assert isinstance(r, st().StationStatus)


def test_default_stale_minutes_is_30():
    """기본값 stale_minutes=30 (5절 p3 시그니처, 2절 D3)."""
    s = station(["FA"], at(11, 29))
    assert st().summarize_station(s, NOW).is_stale is True
    s = station(["FA"], at(11, 30))
    assert st().summarize_station(s, NOW).is_stale is False


# ---------- 통과 기준 2·3: 못 쓰는 충전기 ----------

def test_fast_a_and_out_of_service():
    r = summarize(["FA", "FO"], at(11, 55))
    assert r.usable_fast == 1
    assert r.unusable == 1
    assert r.counts == counts(A=1, O=1)
    assert codes(r.alerts) == [m().AlertCode.UNUSABLE_CHARGERS]


def test_three_comm_error():
    r = summarize(["FE", "FE", "FE"], at(11, 59))
    assert r.usable_fast == 0
    assert r.unusable == 3
    assert r.counts == counts(E=3)
    assert codes(r.alerts) == [m().AlertCode.UNUSABLE_CHARGERS]


def test_maintenance_is_unusable():
    r = summarize(["FA", "FM"], at(11, 55))
    assert r.unusable == 1
    assert r.counts == counts(A=1, M=1)
    assert codes(r.alerts) == [m().AlertCode.UNUSABLE_CHARGERS]


def test_all_three_unusable_kinds_counted():
    r = summarize(["FO", "FM", "FE"], at(11, 55))
    assert r.unusable == 3
    assert r.counts == counts(O=1, M=1, E=1)


def test_slow_unusable_counts_too():
    """unusable 은 급속·완속 모두 센다 (5절 p3 StationStatus.unusable)."""
    r = summarize(["SO", "SE"], at(11, 55))
    assert r.unusable == 2
    assert r.usable_fast == 0
    assert r.usable_slow == 0
    assert codes(r.alerts) == [m().AlertCode.UNUSABLE_CHARGERS]


def test_charging_is_not_unusable():
    r = summarize(["FC", "FC"], at(11, 55))
    assert r.unusable == 0
    assert r.waiting_fast == 2
    assert r.usable_fast == 0
    assert r.alerts == []


def test_slow_charging_not_in_waiting_fast():
    """waiting_fast 는 급속 ∧ 충전 중만 (5절 p3)."""
    r = summarize(["SC", "FC"], at(11, 55))
    assert r.waiting_fast == 1
    assert r.counts == counts(C=2)


def test_slow_available_not_in_usable_fast():
    r = summarize(["SA", "SA", "FA"], at(11, 55))
    assert r.usable_fast == 1
    assert r.usable_slow == 2


def test_unusable_charger_alert_only_once():
    """여러 대가 못 써도 UNUSABLE_CHARGERS 는 한 번 (3.4절: 1대 이상이면 붙는 경고 하나)."""
    r = summarize(["FO", "FE", "FM", "FA"], at(11, 55))
    assert codes(r.alerts) == [m().AlertCode.UNUSABLE_CHARGERS]


def test_alerts_are_alert_instances():
    r = summarize(["FO"], at(11, 0))
    assert len(r.alerts) == 2
    for a in r.alerts:
        assert isinstance(a, m().Alert)


# ---------- 통과 기준 4: 오래됨 경계 ----------

def test_stale_exactly_30_minutes_is_fresh():
    r = summarize(["FA"], at(11, 30))
    assert r.is_stale is False
    assert r.alerts == []


def test_stale_31_minutes():
    r = summarize(["FA"], at(11, 29))
    assert r.is_stale is True
    assert r.alerts[0].code == m().AlertCode.STALE_INFO
    assert codes(r.alerts) == [m().AlertCode.STALE_INFO]


def test_stale_one_second_over():
    """'초과' 경계를 초 단위로 확인 (5절 p3 식 `> timedelta(minutes=...)`)."""
    r = summarize(["FA"], at(11, 29, 59))
    assert r.is_stale is True


def test_future_update_is_fresh():
    r = summarize(["FA"], at(12, 10))
    assert r.is_stale is False
    assert r.alerts == []


def test_update_equal_now_is_fresh():
    r = summarize(["FA"], NOW)
    assert r.is_stale is False


def test_stale_minutes_60_boundary():
    assert summarize(["FA"], at(11, 0), stale_minutes=60).is_stale is False
    assert summarize(["FA"], at(10, 59), stale_minutes=60).is_stale is True


def test_stale_minutes_positional():
    s = station(["FA"], at(10, 59))
    assert st().summarize_station(s, NOW, 60).is_stale is True
    s = station(["FA"], at(11, 0))
    assert st().summarize_station(s, NOW, 60).is_stale is False


def test_s31_one_hour_old_is_stale():
    """4.3절 s31: 갱신 11:00, 기준 30분 → 오래됨, [STALE_INFO]."""
    r = summarize(["FA", "FA"], at(11, 0))
    assert r.is_stale is True
    assert codes(r.alerts) == [m().AlertCode.STALE_INFO]
    assert r.usable_fast == 2


def test_stale_minutes_zero_allowed():
    """0 은 음수가 아니므로 허용 (5절 p3: stale_minutes < 0 만 ValueError). 같은 시각은 신선, 1초 전은 오래됨."""
    assert summarize(["FA"], NOW, stale_minutes=0).is_stale is False
    assert summarize(["FA"], NOW - timedelta(seconds=1), stale_minutes=0).is_stale is True


def test_stale_uses_now_argument_not_clock():
    """now 인자를 기준으로 한다 (0절: 소스는 현재 시각을 부르지 않는다). 먼 과거 now 에서는 신선."""
    s = station(["FA"], datetime(2020, 5, 5, 9, 0))
    r = st().summarize_station(s, datetime(2020, 5, 5, 9, 10))
    assert r.is_stale is False


def test_aware_datetimes_work():
    """둘 다 aware 면 정상 (3.2절)."""
    kst = timezone(timedelta(hours=9))
    now = datetime(2026, 1, 1, 12, 0, tzinfo=kst)
    s = station(["FA"], datetime(2026, 1, 1, 11, 30, tzinfo=kst))
    assert st().summarize_station(s, now).is_stale is False
    s = station(["FA"], datetime(2026, 1, 1, 11, 29, tzinfo=kst))
    assert st().summarize_station(s, now).is_stale is True


def test_aware_different_offsets_compared_as_instants():
    """aware 끼리는 시각대가 달라도 같은 순간으로 비교한다 (3.2절, datetime 뺄셈의 성질). 03:00Z = 12:00+09."""
    kst = timezone(timedelta(hours=9))
    now = datetime(2026, 1, 1, 12, 0, tzinfo=kst)
    s = station(["FA"], datetime(2026, 1, 1, 2, 50, tzinfo=timezone.utc))
    assert st().summarize_station(s, now).is_stale is False
    s = station(["FA"], datetime(2026, 1, 1, 2, 29, tzinfo=timezone.utc))
    assert st().summarize_station(s, now).is_stale is True


# ---------- 통과 기준 5: 경고 순서 ----------

def test_alert_order_stale_then_unusable():
    r = summarize(["FA", "FO"], at(11, 0))
    A = m().AlertCode
    assert codes(r.alerts) == [A.STALE_INFO, A.UNUSABLE_CHARGERS]


def test_alert_order_with_only_unusable_and_stale():
    r = summarize(["FE", "FE", "FE"], at(10, 0))
    A = m().AlertCode
    assert codes(r.alerts) == [A.STALE_INFO, A.UNUSABLE_CHARGERS]


# ---------- 통과 기준 6: 충전기 0대 ----------

def test_no_chargers():
    r = summarize([], at(11, 50))
    assert r.counts == counts()
    assert set(r.counts.keys()) == set(m().ChargerStatus)
    assert r.usable_fast == 0
    assert r.waiting_fast == 0
    assert r.usable_slow == 0
    assert r.unusable == 0
    assert r.is_stale is False
    assert r.alerts == []


def test_no_chargers_but_stale():
    """충전기 0대라도 오래됨은 판정한다 (5절 p3: alerts 규칙은 충전기 수와 무관)."""
    r = summarize([], at(11, 0))
    assert codes(r.alerts) == [m().AlertCode.STALE_INFO]


# ---------- 입력을 바꾸지 않음 ----------

def test_does_not_modify_station():
    """요약은 입력을 바꾸지 않는다 (5절 p5·p7 '입력을 바꾸지 않는다'의 바탕)."""
    s = station(["FA", "FO", "SC"], at(11, 0))
    before = ([(c.type, c.power_kw, c.status) for c in s.chargers],
              s.price_per_kwh, s.status_updated_at, s.id, s.operator)
    st().summarize_station(s, NOW)
    after = ([(c.type, c.power_kw, c.status) for c in s.chargers],
             s.price_per_kwh, s.status_updated_at, s.id, s.operator)
    assert before == after


def test_results_are_independent():
    """두 번 부른 결과의 counts·alerts 가 서로 공유되지 않는다 (5절 p3 StationStatus, 클래스 변수 공유 방지)."""
    a = summarize(["FA"], at(11, 50))
    b = summarize(["FO"], at(11, 0))
    assert a.counts is not b.counts
    assert a.alerts is not b.alerts
    assert a.alerts == []
    assert a.counts == counts(A=1)


# ---------- 통과 기준 7: 휴게소 경고 ----------

def status_of(specs, updated=None):
    return summarize(specs, updated)


def test_rest_area_empty_list():
    assert codes(st().rest_area_alerts([])) == [m().AlertCode.ALL_UNAVAILABLE]


def test_rest_area_all_unusable():
    """4.5 (B) ra2: s21 E×3, s22 O×2 → [ALL_UNAVAILABLE]."""
    sts = [status_of(["FE", "FE", "FE"]), status_of(["FO", "FO"])]
    assert codes(st().rest_area_alerts(sts)) == [m().AlertCode.ALL_UNAVAILABLE]


def test_rest_area_slow_only():
    sts = [status_of(["SA"])]
    assert codes(st().rest_area_alerts(sts)) == [m().AlertCode.NO_USABLE_FAST]


def test_rest_area_slow_available_plus_fast_unusable():
    """완속은 쓸 수 있고 급속은 못 씀 → NO_USABLE_FAST 하나만 (3.4절: ALL_UNAVAILABLE 과 동시에 붙지 않음)."""
    sts = [status_of(["FO", "FE"]), status_of(["SA"])]
    assert codes(st().rest_area_alerts(sts)) == [m().AlertCode.NO_USABLE_FAST]


def test_rest_area_one_fast_available_is_ok():
    sts = [status_of(["FE", "FE"]), status_of(["FA"])]
    assert st().rest_area_alerts(sts) == []


def test_rest_area_standard_ra1_ok():
    sts = [status_of(["FA", "FA", "FC", "SA"])]
    assert st().rest_area_alerts(sts) == []


def test_rest_area_standard_ra2_ok():
    sts = [status_of(["FA", "FA", "FA"]), status_of(["FA", "FO"])]
    assert st().rest_area_alerts(sts) == []


def test_rest_area_only_charging_is_all_unavailable():
    """충전 중만 있으면 '사용 가능'이 0 → ALL_UNAVAILABLE (5절 p3: sum(usable_fast + usable_slow) == 0)."""
    sts = [status_of(["FC", "FC", "SC"])]
    assert codes(st().rest_area_alerts(sts)) == [m().AlertCode.ALL_UNAVAILABLE]


def test_rest_area_station_with_no_chargers():
    """충전기 0대 충전소만 → ALL_UNAVAILABLE (3.4절, 6번 기준 '경고는 휴게소 단계에서')."""
    sts = [status_of([])]
    assert codes(st().rest_area_alerts(sts)) == [m().AlertCode.ALL_UNAVAILABLE]


def test_rest_area_stale_does_not_matter():
    """오래됨은 휴게소 경고에 영향 없음 (5절 p3 rest_area_alerts 규칙에 is_stale 없음)."""
    sts = [status_of(["FA"], at(10, 0))]
    assert st().rest_area_alerts(sts) == []


def test_rest_area_alert_is_alert_instance():
    r = st().rest_area_alerts([])
    assert len(r) == 1
    assert isinstance(r[0], m().Alert)


def test_rest_area_does_not_modify_statuses():
    sts = [status_of(["FO"], at(11, 0)), status_of(["SA"])]
    before = [(dict(s.counts), s.usable_fast, s.usable_slow, s.unusable, codes(s.alerts))
              for s in sts]
    st().rest_area_alerts(sts)
    after = [(dict(s.counts), s.usable_fast, s.usable_slow, s.unusable, codes(s.alerts))
             for s in sts]
    assert before == after
    assert len(sts) == 2


def test_rest_area_alerts_fresh_list_each_call():
    """돌려준 목록을 고쳐도 다음 결과에 남지 않는다 (공유 리스트 변이 방지)."""
    r1 = st().rest_area_alerts([])
    r1.append("x")
    r2 = st().rest_area_alerts([])
    assert codes(r2) == [m().AlertCode.ALL_UNAVAILABLE]


# ---------- 통과 기준 8: 잘못된 입력 ----------

def test_negative_stale_minutes():
    with pytest.raises(ValueError):
        summarize(["FA"], at(11, 50), stale_minutes=-1)


def test_negative_stale_minutes_fraction():
    """-0.5 도 음수 (5절 p3: stale_minutes < 0 → ValueError)."""
    with pytest.raises(ValueError):
        summarize(["FA"], at(11, 50), stale_minutes=-0.5)


def test_now_aware_updated_naive():
    now = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)
    with pytest.raises(ValueError):
        summarize(["FA"], at(11, 50), now=now)


def test_now_naive_updated_aware():
    """반대 방향 섞임도 ValueError (3.2절: 섞이면 ValueError)."""
    updated = datetime(2026, 1, 1, 11, 50, tzinfo=timezone.utc)
    with pytest.raises(ValueError):
        summarize(["FA"], updated, now=NOW)


def test_mixed_tz_with_no_chargers_still_error():
    """충전기 0대라도 시각 검증은 한다 (3.2절)."""
    now = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)
    with pytest.raises(ValueError):
        summarize([], at(11, 50), now=now)


def test_mixed_tz_is_not_type_error():
    """naive-aware 뺄셈의 TypeError 를 그대로 내보내지 않고 ValueError 로 (3.2절)."""
    now = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)
    try:
        summarize(["FA"], at(11, 50), now=now)
    except ValueError:
        pass
    except TypeError as e:  # pragma: no cover
        pytest.fail(f"TypeError 대신 ValueError 여야 한다: {e}")
    else:
        pytest.fail("ValueError 가 나야 한다")
