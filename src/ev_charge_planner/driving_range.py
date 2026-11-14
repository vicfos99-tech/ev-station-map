"""주행 가능 거리와 도착 잔량 (docs/plan.md p2 절). 모두 순수 함수."""
from .models import Vehicle

TOLERANCE = 1e-9


def conservative_range_km(vehicle: Vehicle) -> float:
    """보수적 주행 가능 거리 = soc/100 * 배터리 * 효율 * (1 - 안전 여유)."""
    return float(
        vehicle.soc_pct / 100
        * vehicle.battery_kwh
        * vehicle.efficiency_km_per_kwh
        * (1 - vehicle.safety_margin_ratio)
    )


def km_per_pct(vehicle: Vehicle) -> float:
    """잔량 1 % 당 보수적 주행 거리. soc 와 무관하다."""
    return float(
        vehicle.battery_kwh
        * vehicle.efficiency_km_per_kwh
        * (1 - vehicle.safety_margin_ratio)
        / 100
    )


def arrival_soc_pct(vehicle: Vehicle, distance_km: float) -> float:
    """distance_km 달린 뒤의 잔량(%). 음수도 깎지 않고 그대로 돌려준다."""
    if distance_km < 0:
        raise ValueError(f"distance_km must be >= 0, got {distance_km}")
    return float(vehicle.soc_pct - distance_km / km_per_pct(vehicle))


def can_reach(vehicle: Vehicle, distance_km: float) -> bool:
    """도착 잔량이 최소 잔량 이상이면 True (허용 오차 1e-9, 경계 포함)."""
    return bool(
        arrival_soc_pct(vehicle, distance_km)
        >= vehicle.min_arrival_soc_pct - TOLERANCE
    )
