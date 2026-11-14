"""경로 리스트: p2 도착 잔량·p3 상태·p4 가격을 합친다 (docs/plan.md 5절 p5_route_list)."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

from .driving_range import arrival_soc_pct, can_reach
from .models import (
    Alert,
    AlertCode,
    ChargerStatus,
    ChargerType,
    Route,
    Station,
    User,
    Vehicle,
)
from .pricing import PriceQuote, quote
from .status import StationStatus, rest_area_alerts, summarize_station


@dataclass
class StationEntry:
    station_id: str
    operator: str
    is_nearby: bool
    detour_km: float
    remaining_km: float
    arrival_soc_pct: float
    reachable: bool
    status: StationStatus
    quote: PriceQuote
    is_candidate: bool
    alerts: list[Alert] = field(default_factory=list)
    role: Optional[str] = None


@dataclass
class RestAreaEntry:
    rest_area_id: str
    name: str
    distance_km: float
    remaining_km: float
    arrival_soc_pct: float
    reachable: bool
    stations: list[StationEntry]
    nearby: list[StationEntry]
    operators: list[str]
    subscription_applicable: bool
    applicable_cards: list[str]
    status_counts: dict[ChargerStatus, int]
    usable_fast: int
    waiting_fast: int
    lowest_price: Optional[float]
    alerts: list[Alert] = field(default_factory=list)


@dataclass
class RouteList:
    highway: str
    direction: str
    entries: list[RestAreaEntry]


def _station_entry(station: Station, rest_area_id: str, detour_km: float, is_nearby: bool,
                   rest_remaining_km: float, vehicle: Vehicle, user: User,
                   now: datetime, stale_minutes: float) -> StationEntry:
    status = summarize_station(station, now, stale_minutes)
    remaining = rest_remaining_km + detour_km
    reachable = can_reach(vehicle, remaining)
    alerts = list(status.alerts)
    if is_nearby and not reachable:
        alerts.append(Alert(AlertCode.UNREACHABLE, "남은 잔량으로 갈 수 없다"))
    return StationEntry(
        station_id=station.id,
        operator=station.operator,
        is_nearby=is_nearby,
        detour_km=float(detour_km),
        remaining_km=remaining,
        arrival_soc_pct=arrival_soc_pct(vehicle, remaining),
        reachable=reachable,
        status=status,
        quote=quote(station, rest_area_id, user, ChargerType.FAST),
        is_candidate=reachable and status.usable_fast >= 1,
        alerts=alerts,
    )


def build_route_list(route: Route, vehicle: Vehicle, user: User, now: datetime,
                     position_km: float = 0.0, stale_minutes: float = 30) -> RouteList:
    if position_km < 0:
        raise ValueError(f"position_km 는 0 이상이어야 한다: {position_km}")

    entries: list[RestAreaEntry] = []
    for ra in route.rest_areas:
        remaining = ra.distance_km - position_km
        if remaining < 0:
            continue
        reachable = can_reach(vehicle, remaining)
        inner = [_station_entry(s, ra.id, 0.0, False, remaining, vehicle, user, now, stale_minutes)
                 for s in ra.stations]
        near = [_station_entry(n.station, ra.id, n.detour_km, True, remaining, vehicle, user,
                               now, stale_minutes)
                for n in ra.nearby]

        operators: list[str] = []
        for e in inner:
            if e.operator not in operators:
                operators.append(e.operator)
        applied_cards = {name for e in inner for name in e.quote.applicable_cards}
        counts = {s: 0 for s in ChargerStatus}
        for e in inner:
            for s, n in e.status.counts.items():
                counts[s] += n
        prices = [e.quote.final_price for e in inner if e.status.usable_fast >= 1]

        alerts: list[Alert] = []
        if not reachable:
            alerts.append(Alert(AlertCode.UNREACHABLE, "남은 잔량으로 갈 수 없다"))
        alerts.extend(rest_area_alerts([e.status for e in inner]))

        entries.append(RestAreaEntry(
            rest_area_id=ra.id,
            name=ra.name,
            distance_km=float(ra.distance_km),
            remaining_km=float(remaining),
            arrival_soc_pct=arrival_soc_pct(vehicle, remaining),
            reachable=reachable,
            stations=inner,
            nearby=near,
            operators=operators,
            subscription_applicable=any(e.quote.subscription_applicable for e in inner),
            applicable_cards=[c.name for c in user.cards if c.name in applied_cards],
            status_counts=counts,
            usable_fast=sum(e.status.usable_fast for e in inner),
            waiting_fast=sum(e.status.waiting_fast for e in inner),
            lowest_price=min(prices) if prices else None,
            alerts=alerts,
        ))
    return RouteList(route.highway, route.direction, entries)
