# -*- coding: utf-8 -*-
"""A7 시험 도우미(try_a7.mjs 가 부른다): 파이썬 엔진(src/ev_charge_planner — 읽기만)으로 같은 입력을 셈해 JSON 으로 돌려준다.

표준 입력: {"src": 파이썬 엔진 폴더의 부모, "cases": [{"route", "vehicle", "user", "now", "position_km", "stale_minutes"}]} (시각은 밀리초)
표준 출력: {"results": [plan 결과(dataclass → dict, 열거형은 값, 시각은 밀리초)]}
"""
import dataclasses
import enum
import json
import sys
from datetime import datetime, timezone


def main():
    data = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    sys.path.insert(0, data["src"])
    from ev_charge_planner import models as m
    from ev_charge_planner.planner import plan

    def ms_dt(ms):
        return datetime.fromtimestamp(ms / 1000, tz=timezone.utc)

    def station(s):
        return m.Station(id=s["id"], operator=s["operator"],
                         chargers=[m.Charger(type=m.ChargerType(c["type"]), power_kw=c["power_kw"], status=m.ChargerStatus(c["status"])) for c in s["chargers"]],
                         price_per_kwh=s["price_per_kwh"], status_updated_at=ms_dt(s["status_updated_at"]))

    def route(r):
        return m.Route(highway=r["highway"], direction=r["direction"], rest_areas=[
            m.RestArea(id=a["id"], name=a["name"], distance_km=a["distance_km"], stations=[station(s) for s in a["stations"]],
                       nearby=[m.NearbyStation(station=station(n["station"]), detour_km=n["detour_km"]) for n in a.get("nearby", [])])
            for a in r["rest_areas"]])

    def user(u):
        sub = u.get("subscription")
        return m.User(subscription=None if not sub else m.Subscription(operator=sub["operator"], rate=sub["rate"], excluded_rest_area_ids=frozenset(sub.get("excluded_rest_area_ids", []))),
                      cards=[m.DiscountCard(name=c["name"], rate=c["rate"], operators=None if c.get("operators") is None else frozenset(c["operators"])) for c in u.get("cards", [])])

    def plain(o):
        if dataclasses.is_dataclass(o):
            return {f.name: plain(getattr(o, f.name)) for f in dataclasses.fields(o)}
        if isinstance(o, enum.Enum):
            return o.value
        if isinstance(o, (list, tuple)):
            return [plain(x) for x in o]
        if isinstance(o, (set, frozenset)):
            return sorted(plain(x) for x in o)
        if isinstance(o, dict):
            return {str(k.value if isinstance(k, enum.Enum) else k): plain(v) for k, v in o.items()}
        if isinstance(o, datetime):
            return int(o.timestamp() * 1000)
        return o

    out = []
    for c in data["cases"]:
        v = c["vehicle"]
        veh = m.Vehicle(soc_pct=v["soc_pct"], battery_kwh=v["battery_kwh"], efficiency_km_per_kwh=v["efficiency_km_per_kwh"],
                        safety_margin_ratio=v["safety_margin_ratio"], min_arrival_soc_pct=v["min_arrival_soc_pct"])
        res = plan(route(c["route"]), veh, user(c["user"]), ms_dt(c["now"]), c["position_km"], c["stale_minutes"])
        out.append(plain(res))
    sys.stdout.buffer.write(json.dumps({"results": out}, ensure_ascii=False).encode("utf-8"))


if __name__ == "__main__":
    main()
