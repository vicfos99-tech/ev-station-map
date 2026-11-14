"""파이썬 엔진으로 입력·기대값을 뽑아 web/test/fixtures.json 에 쓴다.

자바스크립트 판(web/engine.js)이 같은 입력에 같은 답을 내는지 web/test/compare.js 가 대조한다.
테스트만 옮기면 테스트가 잘못 옮겨져도 모르므로, 원본 엔진의 답을 기준으로 삼는다.

실행(저장소 루트에서):  py tools/dump_fixtures.py
"""
import dataclasses
import json
import random
import sys
from datetime import datetime, timedelta
from enum import Enum
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from ev_charge_planner import (  # noqa: E402
    Charger, DiscountCard, NearbyStation, RestArea, Route, Station, Subscription, User, Vehicle, plan,
)
from ev_charge_planner import driving_range  # noqa: E402

EPOCH = datetime(1970, 1, 1)
OPERATORS = ["별빛차지", "한빛이브이", "초록전력", "달무리충전"]
STATUSES = ["available", "charging", "out_of_service", "maintenance", "comm_error"]


def ms(dt):
    return int((dt - EPOCH).total_seconds() * 1000)


def to_json(x):
    # dataclass·Enum·datetime·frozenset 을 JSON 으로
    if dataclasses.is_dataclass(x) and not isinstance(x, type):
        return {f.name: to_json(getattr(x, f.name)) for f in dataclasses.fields(x)}
    if isinstance(x, Enum):
        return x.value
    if isinstance(x, datetime):
        return ms(x)
    if isinstance(x, (frozenset, set)):
        return sorted(to_json(v) for v in x)
    if isinstance(x, dict):
        return {(k.value if isinstance(k, Enum) else k): to_json(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [to_json(v) for v in x]
    return x


def rand_station(rng, sid, now, stale_minutes):
    chargers = []
    for _ in range(rng.randint(0, 5)):
        chargers.append(Charger(
            type=rng.choice(["fast", "fast", "fast", "slow"]),
            power_kw=rng.choice([7.0, 50.0, 100.0, 200.0, 350.0]),
            status=rng.choices(STATUSES, weights=[5, 3, 1, 1, 1])[0],
        ))
    # 갱신 시각: 경계(정확히 stale_minutes 전)도 섞는다
    age = rng.choice([0, 1, 5, 29, 30, 31, 60, 180, stale_minutes, stale_minutes + 0.5])
    price = rng.choice([280.0, 300.0, 320.0, 333.3, 347.2, 350.0, 400.0, 0.0])
    return Station(sid, rng.choice(OPERATORS), chargers, price, now - timedelta(minutes=age))


def rand_case(rng, k):
    now = datetime(2026, 1, 1, 12, 0) + timedelta(minutes=rng.randint(0, 100000))
    stale = rng.choice([0, 10, 30, 30, 30, 45.5, 120])
    rest_areas = []
    dist = 0.0
    n = 0
    for i in range(rng.randint(0, 8)):
        dist += rng.choice([0.0, 13.5, 27.0, 31.7, 40.0, 54.3])
        stations = []
        for _ in range(rng.randint(0, 3)):
            n += 1
            stations.append(rand_station(rng, f"s{n}", now, stale))
        nearby = []
        for _ in range(rng.choice([0, 0, 0, 1, 2])):
            n += 1
            nearby.append(NearbyStation(rand_station(rng, f"n{n}", now, stale), rng.choice([0.0, 2.4, 5.4, 10.8, 21.6])))
        rest_areas.append(RestArea(f"ra{i + 1}", f"휴게소{i + 1}", dist, stations, nearby))
    route = Route("시험고속도로", rng.choice(["상행", "하행"]), rest_areas)
    vehicle = Vehicle(
        soc_pct=rng.choice([100.0, 80.0, 60.0, 45.0, 33.3, 20.0, 15.0, 5.0, 0.0]),
        battery_kwh=rng.choice([60.0, 77.4, 99.8, 58.0]),
        efficiency_km_per_kwh=rng.choice([5.0, 4.2, 3.1, 6.0]),
        safety_margin_ratio=rng.choice([0.10, 0.10, 0.0, 0.2]),
        min_arrival_soc_pct=rng.choice([15.0, 15.0, 10.0, 20.0, 0.0]),
    )
    sub = None
    if rng.random() < 0.6:
        excluded = frozenset(f"ra{rng.randint(1, 8)}" for _ in range(rng.randint(0, 2)))
        sub = Subscription(rng.choice(OPERATORS), rng.choice([0.1, 0.2, 0.3]), excluded)
    cards = []
    for j in range(rng.randint(0, 3)):
        ops = rng.choice([None, None, frozenset(), frozenset(rng.sample(OPERATORS, rng.randint(1, 3)))])
        cards.append(DiscountCard(f"카드{j + 1}", rng.choice([0.05, 0.1, 0.15, 0.2, 0.3]), ops))
    user = User(sub, cards)
    position = rng.choice([0.0, 0.0, 0.0, 13.5, 27.0, 50.0, 200.0])
    inp = {
        "route": to_json(route), "vehicle": to_json(vehicle), "user": to_json(user),
        "now": ms(now), "position_km": position, "stale_minutes": stale,
    }
    result = plan(route, vehicle, user, now, position, stale)
    return {"name": f"random-{k}", "input": inp, "expected": to_json(result)}


def error_cases():
    # 입력을 JSON 으로 주고 ValueError 가 나는지만 본다
    now = datetime(2026, 1, 1, 12, 0)
    ok_station = {"id": "s1", "operator": "별빛차지", "chargers": [{"type": "fast", "power_kw": 50.0, "status": "available"}],
                  "price_per_kwh": 300.0, "status_updated_at": ms(now)}
    ok_route = {"highway": "시험", "direction": "상행",
                "rest_areas": [{"id": "ra1", "name": "휴게소1", "distance_km": 10.0, "stations": [ok_station], "nearby": []}]}
    ok_vehicle = {"soc_pct": 60.0, "battery_kwh": 60.0, "efficiency_km_per_kwh": 5.0}
    ok_user = {"subscription": None, "cards": []}

    def variant(path, value, base):
        obj = json.loads(json.dumps(base))
        cur = obj
        for p in path[:-1]:
            cur = cur[p]
        cur[path[-1]] = value
        return obj

    cases = [
        ("soc 101", {"vehicle": variant(["soc_pct"], 101.0, ok_vehicle)}),
        ("battery 0", {"vehicle": variant(["battery_kwh"], 0.0, ok_vehicle)}),
        ("margin 1", {"vehicle": dict(ok_vehicle, safety_margin_ratio=1.0)}),
        ("price -1", {"route": variant(["rest_areas", 0, "stations", 0, "price_per_kwh"], -1.0, ok_route)}),
        ("power 0", {"route": variant(["rest_areas", 0, "stations", 0, "chargers", 0, "power_kw"], 0.0, ok_route)}),
        ("status unknown", {"route": variant(["rest_areas", 0, "stations", 0, "chargers", 0, "status"], "broken", ok_route)}),
        ("highway empty", {"route": variant(["highway"], "", ok_route)}),
        ("distance -1", {"route": variant(["rest_areas", 0, "distance_km"], -1.0, ok_route)}),
        ("card rate 1", {"user": {"subscription": None, "cards": [{"name": "c", "rate": 1.0, "operators": None}]}}),
        ("sub rate 0", {"user": {"subscription": {"operator": "별빛차지", "rate": 0.0, "excluded_rest_area_ids": []}, "cards": []}}),
        ("position -1", {"position_km": -1.0}),
        ("stale -1", {"stale_minutes": -1}),
    ]
    out = []
    for name, change in cases:
        inp = {"route": ok_route, "vehicle": ok_vehicle, "user": ok_user, "now": ms(now), "position_km": 0.0, "stale_minutes": 30}
        inp.update(change)
        out.append({"name": name, "input": inp})
    # 파이썬에서도 정말 ValueError 인지 확인하고 싣는다
    for c in out:
        try:
            build_and_plan(c["input"])
        except ValueError:
            continue
        raise SystemExit(f"오류 사례가 파이썬에서 통과해 버림: {c['name']}")
    return out


def build_and_plan(inp):
    def station(s):
        return Station(s["id"], s["operator"], [Charger(**c) for c in s["chargers"]], s["price_per_kwh"],
                       EPOCH + timedelta(milliseconds=s["status_updated_at"]))
    r = inp["route"]
    route = Route(r["highway"], r["direction"], [
        RestArea(a["id"], a["name"], a["distance_km"], [station(s) for s in a["stations"]],
                 [NearbyStation(station(n["station"]), n["detour_km"]) for n in a["nearby"]])
        for a in r["rest_areas"]])
    vehicle = Vehicle(**inp["vehicle"])
    u = inp["user"]
    sub = None if u["subscription"] is None else Subscription(
        u["subscription"]["operator"], u["subscription"]["rate"], frozenset(u["subscription"]["excluded_rest_area_ids"]))
    cards = [DiscountCard(c["name"], c["rate"], None if c["operators"] is None else frozenset(c["operators"])) for c in u["cards"]]
    return plan(route, vehicle, User(sub, cards), EPOCH + timedelta(milliseconds=inp["now"]),
                inp["position_km"], inp["stale_minutes"])


def main():
    rng = random.Random(20261114)
    cases = [rand_case(rng, k) for k in range(400)]
    # JSON 으로 다시 읽어 만든 입력이 같은 답을 내는지(왕복 변환 확인)
    for c in cases[:50]:
        assert to_json(build_and_plan(c["input"])) == c["expected"], c["name"]
    ranges = []
    for _ in range(60):
        v = Vehicle(rng.choice([100.0, 73.3, 45.0, 15.0, 0.0]), rng.choice([60.0, 77.4]), rng.choice([5.0, 4.2]),
                    rng.choice([0.1, 0.0, 0.25]), rng.choice([15.0, 10.0]))
        d = rng.choice([0.0, 27.0, 54.0, 121.5, 300.0])
        ranges.append({"vehicle": to_json(v), "distance_km": d,
                       "range": driving_range.conservative_range_km(v), "per_pct": driving_range.km_per_pct(v),
                       "arrival": driving_range.arrival_soc_pct(v, d), "reach": driving_range.can_reach(v, d)})
    # 경계: 도착 잔량이 수학적으로는 정확히 최소 잔량인 거리. 부동소수 오차로 살짝 모자라게 나오는 것도 있어
    # 허용 오차(1e-9)가 빠진 구현을 가려낸다
    below = 0
    for soc in [100.0, 90.0, 73.3, 60.0, 45.0, 33.3, 21.7]:
        for batt, eff, margin in [(60.0, 5.0, 0.1), (77.4, 4.2, 0.1), (99.8, 3.1, 0.2), (58.0, 6.0, 0.0)]:
            v = Vehicle(soc, batt, eff, margin, 15.0)
            d = (soc - 15.0) * driving_range.km_per_pct(v)
            if driving_range.arrival_soc_pct(v, d) < 15.0:
                below += 1
            ranges.append({"vehicle": to_json(v), "distance_km": d,
                           "range": driving_range.conservative_range_km(v), "per_pct": driving_range.km_per_pct(v),
                           "arrival": driving_range.arrival_soc_pct(v, d), "reach": driving_range.can_reach(v, d)})
    assert below >= 1, "허용 오차를 가려낼 경계 사례가 하나도 없다"
    data = {"generator": f"tools/dump_fixtures.py (python {sys.version.split()[0]})",
            "plans": cases, "ranges": ranges, "errors": error_cases()}
    out = ROOT / "web" / "test" / "fixtures.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8", newline="\n")
    ok = sum(1 for c in cases if c["expected"]["recommendation"]["status"] == "ok")
    backup = sum(1 for c in cases if c["expected"]["recommendation"]["backup"])
    print(f"wrote {out.name}: plans {len(cases)} (ok {ok}, backup {backup}), ranges {len(ranges)}, errors {len(data['errors'])}")


if __name__ == "__main__":
    main()
