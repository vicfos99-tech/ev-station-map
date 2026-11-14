from dataclasses import dataclass
from datetime import datetime

from .models import Route, User, Vehicle
from .recommend import Recommendation, recommend
from .route_list import RouteList, build_route_list


@dataclass
class PlanResult:
    route_list: RouteList
    recommendation: Recommendation


def plan(route: Route, vehicle: Vehicle, user: User, now: datetime,
         position_km: float = 0.0, stale_minutes: float = 30) -> PlanResult:
    route_list = build_route_list(route, vehicle, user, now, position_km, stale_minutes)
    recommendation = recommend(route_list, vehicle)
    return PlanResult(route_list=route_list, recommendation=recommendation)
