"""충전기 상태 집계와 경고 (docs/plan.md 5절 p3_status)."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

from .models import (
    UNUSABLE_STATUSES,
    Alert,
    AlertCode,
    ChargerStatus,
    ChargerType,
    Station,
)


@dataclass
class StationStatus:
    counts: dict[ChargerStatus, int] = field(default_factory=dict)
    usable_fast: int = 0
    waiting_fast: int = 0
    usable_slow: int = 0
    unusable: int = 0
    is_stale: bool = False
    alerts: list[Alert] = field(default_factory=list)


def summarize_station(station: Station, now: datetime, stale_minutes: float = 30) -> StationStatus:
    if stale_minutes < 0:
        raise ValueError(f"stale_minutes 는 0 이상이어야 한다: {stale_minutes}")
    updated = station.status_updated_at
    if (now.tzinfo is None) != (updated.tzinfo is None):
        raise ValueError("now 와 status_updated_at 의 시각대(naive/aware)가 섞여 있다")

    counts = {status: 0 for status in ChargerStatus}
    usable_fast = waiting_fast = usable_slow = unusable = 0
    for c in station.chargers:
        counts[c.status] += 1
        if c.status in UNUSABLE_STATUSES:
            unusable += 1
        elif c.type == ChargerType.FAST:
            if c.status == ChargerStatus.AVAILABLE:
                usable_fast += 1
            elif c.status == ChargerStatus.CHARGING:
                waiting_fast += 1
        elif c.status == ChargerStatus.AVAILABLE:
            usable_slow += 1

    is_stale = (now - updated) > timedelta(minutes=stale_minutes)
    alerts: list[Alert] = []
    if is_stale:
        alerts.append(Alert(AlertCode.STALE_INFO,
                            f"충전 상태 갱신이 {stale_minutes:g}분을 넘어 오래되었다"))
    if unusable >= 1:
        alerts.append(Alert(AlertCode.UNUSABLE_CHARGERS,
                            f"사용할 수 없는 충전기가 {unusable}대 있다"))
    return StationStatus(counts, usable_fast, waiting_fast, usable_slow, unusable, is_stale, alerts)


def rest_area_alerts(statuses: list[StationStatus]) -> list[Alert]:
    if sum(s.usable_fast + s.usable_slow for s in statuses) == 0:
        return [Alert(AlertCode.ALL_UNAVAILABLE, "사용 가능한 충전기가 하나도 없다")]
    if sum(s.usable_fast for s in statuses) == 0:
        return [Alert(AlertCode.NO_USABLE_FAST, "사용 가능한 급속 충전기가 없다")]
    return []
