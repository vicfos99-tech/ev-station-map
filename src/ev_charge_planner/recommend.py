"""안전 점수와 1순위·예비 추천 (docs/plan.md 5절 p6_recommend)."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from .driving_range import TOLERANCE, km_per_pct
from .models import Alert, AlertCode, Vehicle
from .route_list import RestAreaEntry, RouteList, StationEntry


@dataclass
class Pick:
    rest_area_id: str
    rest_area_name: str
    station_id: str
    operator: str
    is_nearby: bool
    detour_km: float
    remaining_km: float
    arrival_soc_pct: float
    score: int
    final_price: float


@dataclass
class Recommendation:
    status: str
    primary: Optional[Pick]
    backup: Optional[Pick]
    alerts: list[Alert] = field(default_factory=list)


def score_candidate(entry: StationEntry, vehicle: Vehicle) -> int:
    """c(급속 대수) + m(여유) + f(신선도). entry 는 바꾸지 않는다."""
    usable = entry.status.usable_fast
    c = 0 if usable <= 1 else 1 if usable == 2 else 2
    margin = entry.arrival_soc_pct - vehicle.min_arrival_soc_pct
    m = 0 if margin < 10 else 1 if margin < 20 else 2
    f = 0 if entry.status.is_stale else 1
    return c + m + f


def _pick(ra: RestAreaEntry, entry: StationEntry, score: int) -> Pick:
    return Pick(
        rest_area_id=ra.rest_area_id,
        rest_area_name=ra.name,
        station_id=entry.station_id,
        operator=entry.operator,
        is_nearby=entry.is_nearby,
        detour_km=entry.detour_km,
        remaining_km=entry.remaining_km,
        arrival_soc_pct=entry.arrival_soc_pct,
        score=score,
        final_price=entry.quote.final_price,
    )


def recommend(route_list: RouteList, vehicle: Vehicle) -> Recommendation:
    # 안 충전소 → 나들목 인근, 휴게소 순서대로 (입력 순서가 동률의 기준)
    all_entries = [(ra, e) for ra in route_list.entries for e in [*ra.stations, *ra.nearby]]
    for _, e in all_entries:
        e.role = None

    ranked = [(ra, e, score_candidate(e, vehicle)) for ra, e in all_entries if e.is_candidate]
    ranked.sort(key=lambda t: (-t[2], t[1].quote.final_price, t[1].remaining_km, t[1].is_nearby))

    if not ranked:
        return Recommendation("no_safe_station", None, None,
                              [Alert(AlertCode.NO_SAFE_STATION, "안전하게 갈 수 있는 충전소가 없다")])

    p_ra, p_entry, p_score = ranked[0]
    p_entry.role = "primary"
    primary = _pick(p_ra, p_entry, p_score)

    round_trip_pct = p_entry.detour_km / km_per_pct(vehicle)
    backup: Optional[Pick] = None
    for ra, e, score in ranked[1:]:
        if ra.rest_area_id == p_ra.rest_area_id:
            continue
        if not ra.remaining_km > p_ra.remaining_km:
            continue
        if e.arrival_soc_pct - round_trip_pct + TOLERANCE < vehicle.min_arrival_soc_pct:
            continue
        e.role = "backup"
        backup = _pick(ra, e, score)
        break

    alerts = [] if backup else [Alert(AlertCode.NO_BACKUP, "예비 충전소가 없다")]
    return Recommendation("ok", primary, backup, alerts)
