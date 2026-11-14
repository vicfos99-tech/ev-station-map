"""입력 자료형·열거형·경고 (docs/plan.md 5절 p1_models)."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Optional


class ChargerType(str, Enum):
    FAST = "fast"
    SLOW = "slow"


class ChargerStatus(str, Enum):
    AVAILABLE = "available"
    CHARGING = "charging"
    OUT_OF_SERVICE = "out_of_service"
    MAINTENANCE = "maintenance"
    COMM_ERROR = "comm_error"


UNUSABLE_STATUSES = frozenset({
    ChargerStatus.OUT_OF_SERVICE,
    ChargerStatus.MAINTENANCE,
    ChargerStatus.COMM_ERROR,
})


class AlertCode(str, Enum):
    UNREACHABLE = "unreachable"
    ALL_UNAVAILABLE = "all_unavailable"
    NO_USABLE_FAST = "no_usable_fast"
    UNUSABLE_CHARGERS = "unusable_chargers"
    STALE_INFO = "stale_info"
    NO_BACKUP = "no_backup"
    NO_SAFE_STATION = "no_safe_station"


@dataclass
class Alert:
    code: AlertCode
    message: str


def _need(cond, message):
    if not cond:
        raise ValueError(message)


def _need_text(value, label):
    _need(isinstance(value, str) and value != "",
          f"{label} 은(는) 비어 있지 않은 문자열이어야 한다: {value!r}")


@dataclass
class Charger:
    type: ChargerType
    power_kw: float
    status: ChargerStatus

    def __post_init__(self):
        self.type = ChargerType(self.type)
        self.status = ChargerStatus(self.status)
        _need(self.power_kw > 0, f"power_kw 는 0 보다 커야 한다: {self.power_kw}")


@dataclass
class Station:
    id: str
    operator: str
    chargers: list[Charger]
    price_per_kwh: float
    status_updated_at: datetime

    def __post_init__(self):
        _need_text(self.id, "충전소 id")
        _need_text(self.operator, "충전소 업체")
        _need(self.price_per_kwh >= 0, f"price_per_kwh 는 0 이상이어야 한다: {self.price_per_kwh}")
        _need(isinstance(self.status_updated_at, datetime),
              f"status_updated_at 은 datetime 이어야 한다: {self.status_updated_at!r}")


@dataclass
class NearbyStation:
    station: Station
    detour_km: float

    def __post_init__(self):
        _need(self.detour_km >= 0, f"detour_km 는 0 이상이어야 한다: {self.detour_km}")


@dataclass
class RestArea:
    id: str
    name: str
    distance_km: float
    stations: list[Station]
    nearby: list[NearbyStation] = field(default_factory=list)

    def __post_init__(self):
        _need_text(self.id, "휴게소 id")
        _need_text(self.name, "휴게소 이름")
        _need(self.distance_km >= 0, f"distance_km 는 0 이상이어야 한다: {self.distance_km}")


@dataclass
class Route:
    highway: str
    direction: str
    rest_areas: list[RestArea]

    def __post_init__(self):
        _need_text(self.highway, "고속도로 이름")
        _need_text(self.direction, "방향")
        rest_ids = set()
        station_ids = set()
        prev = None
        for ra in self.rest_areas:
            _need(prev is None or ra.distance_km >= prev,
                  f"휴게소 거리가 줄어든다: {ra.id} ({ra.distance_km} < {prev})")
            prev = ra.distance_km
            _need(ra.id not in rest_ids, f"휴게소 id 중복: {ra.id}")
            rest_ids.add(ra.id)
            for st in [*ra.stations, *(n.station for n in ra.nearby)]:
                _need(st.id not in station_ids, f"충전소 id 중복: {st.id}")
                station_ids.add(st.id)


@dataclass
class Vehicle:
    soc_pct: float
    battery_kwh: float
    efficiency_km_per_kwh: float
    safety_margin_ratio: float = 0.10
    min_arrival_soc_pct: float = 15.0

    def __post_init__(self):
        _need(0 <= self.soc_pct <= 100, f"soc_pct 는 0~100: {self.soc_pct}")
        _need(self.battery_kwh > 0, f"battery_kwh 는 0 보다 커야 한다: {self.battery_kwh}")
        _need(self.efficiency_km_per_kwh > 0,
              f"efficiency_km_per_kwh 는 0 보다 커야 한다: {self.efficiency_km_per_kwh}")
        _need(0 <= self.safety_margin_ratio < 1,
              f"safety_margin_ratio 는 0 이상 1 미만: {self.safety_margin_ratio}")
        _need(0 <= self.min_arrival_soc_pct <= 100,
              f"min_arrival_soc_pct 는 0~100: {self.min_arrival_soc_pct}")


@dataclass
class DiscountCard:
    name: str
    rate: float
    operators: Optional[frozenset[str]] = None

    def __post_init__(self):
        _need_text(self.name, "카드 이름")
        _need(0 < self.rate < 1, f"rate 는 0 초과 1 미만: {self.rate}")
        if self.operators is not None:
            self.operators = frozenset(self.operators)


@dataclass
class Subscription:
    operator: str
    rate: float
    excluded_rest_area_ids: frozenset[str] = frozenset()

    def __post_init__(self):
        _need_text(self.operator, "구독 업체")
        _need(0 < self.rate < 1, f"rate 는 0 초과 1 미만: {self.rate}")
        self.excluded_rest_area_ids = frozenset(self.excluded_rest_area_ids)


@dataclass
class User:
    subscription: Optional[Subscription] = None
    cards: list[DiscountCard] = field(default_factory=list)
