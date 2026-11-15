"""나들목(영업소) 인근 급속 충전소를 노선에 붙인다.

    py tools/ic_nearby.py --ics 나들목.json --chargers 전국충전기.json   (받아 둔 파일로)
    py tools/ic_nearby.py                                               (키로 받기: EX_API_KEY, EV_CHARGER_API_KEY)

- 나들목 위치: 한국도로공사 '영업소 위치정보' API(고속도로 공공데이터 포털 data.ex.co.kr 키, 환경변수 EX_API_KEY).
  2026-11-15 현재 키가 없어 실제 응답 모양을 못 봤다. 필드 이름이 달라도 읽게 후보 이름을 여럿 둔다(NAME_KEYS 등).
  처음 실제로 받으면 --save-ics 로 저장해 필드를 확인하고 여기를 고친다.
- 인근 충전소: 공공 충전소 API 전체(휴게소 제외)에서 급속이 있는 충전소 중 나들목에서 직선 NEAR_KM 안.
- 들렀다 오는 거리(왕복): 직선 거리 × 2 × ROAD_FACTOR (도로가 직선보다 돌아가는 것을 대략 반영). '대략'이다.
- 노선에는 '○○ 나들목' 항목(휴게소 충전기 없음, nearby 만)으로 들어간다. 엔진은 그대로 쓴다.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import charger_api as ca  # noqa: E402

EX_KEY_ENV = "EX_API_KEY"
EX_ENDPOINT = "https://data.ex.co.kr/openapi/locationinfo/locationinfoUnit"  # 키를 받으면 실제 주소 확인
NEAR_KM = 3.0          # 나들목에서 직선 이만큼 안의 충전소만
ROAD_FACTOR = 1.3      # 도로 거리 ≈ 직선 × 1.3
MAX_PER_IC = 3         # 나들목마다 가까운 충전소 몇 곳까지
IC_ON_LINE_KM = 2.0    # 나들목이 고속도로 선에서 이만큼 안이어야 그 노선의 나들목으로 본다
MIN_GAP_KM = 1.0       # 같은 노선에서 이보다 가까운 두 나들목은 하나로(같은 영업소의 입구·출구 등)

NAME_KEYS = ["unitName", "unitNm", "name", "영업소명", "officeName", "icName"]
ROUTE_KEYS = ["routeName", "routeNm", "노선명", "route"]
LAT_KEYS = ["yValue", "lat", "latitude", "위도", "y", "yCrdnt"]
LNG_KEYS = ["xValue", "lng", "lon", "longitude", "경도", "x", "xCrdnt"]


def _first(d, keys):
    for k in keys:
        if k in d and d[k] not in (None, ""):
            return d[k]
    return None


def parse_ics(raw):
    """응답(또는 저장한 파일)의 나들목 목록 → [{name, route, lat, lng}]. 좌표가 없거나 이상하면 뺀다."""
    if isinstance(raw, dict):
        for k in ("list", "items", "item", "data", "result"):
            if k in raw:
                raw = raw[k]
                break
        if isinstance(raw, dict) and "item" in raw:
            raw = raw["item"]
    out = []
    for it in raw if isinstance(raw, list) else []:
        name = str(_first(it, NAME_KEYS) or "").strip()
        try:
            lat = float(_first(it, LAT_KEYS))
            lng = float(_first(it, LNG_KEYS))
        except (TypeError, ValueError):
            continue
        if not name or not (33 <= lat <= 39 and 124 <= lng <= 132):  # 우리나라 밖 좌표(뒤바뀐 것 등)는 뺀다
            continue
        out.append({"name": name, "route": str(_first(it, ROUTE_KEYS) or "").strip(), "lat": lat, "lng": lng})
    return out


def _route_word(s):
    """'경부선', '경부고속도로', '경부' → '경부'"""
    return re.sub(r"(고속도로|고속국도|선|\s)", "", s or "")


def ics_on_highway(ics, hk):
    """이 노선 위의 나들목: 노선 이름이 맞거나(있으면) 선에서 IC_ON_LINE_KM 안. 기점에서의 km 순."""
    hw = ca.HIGHWAYS[hk]
    word = _route_word(hw["name"])
    found = []
    for ic in ics:
        along, off = ca.project((ic["lat"], ic["lng"]), hw["points"])
        named = ic["route"] and _route_word(ic["route"]) and _route_word(ic["route"]) in word
        if off <= IC_ON_LINE_KM and (named or not ic["route"]):
            found.append({**ic, "along": along})
        elif named and off <= ca.HINT_MAX_KM:
            found.append({**ic, "along": along})
    found.sort(key=lambda x: (x["along"], x["name"]))
    merged = []
    for ic in found:
        if merged and ic["along"] - merged[-1]["along"] < MIN_GAP_KM:
            continue
        merged.append(ic)
    return merged


def nearby_stations(ic, stations):
    """나들목에서 직선 NEAR_KM 안의 급속 충전소, 왕복 거리 짧은 순 MAX_PER_IC 곳."""
    near = []
    for st in stations:
        d = ca.haversine_km((ic["lat"], ic["lng"]), st["pt"])
        if d <= NEAR_KM:
            near.append((round(d * 2 * ROAD_FACTOR, 1), st["id"], st))
    near.sort(key=lambda x: (x[0], x[1]))
    return [{"station": {k: v for k, v in st.items() if k != "pt"}, "detour": detour} for detour, _, st in near[:MAX_PER_IC]]


def stations_from_items(items, fetched_ms, tariffs=ca.TARIFFS):
    """휴게소가 아닌 충전기 → 급속이 하나라도 있는 충전소 목록(좌표 포함)."""
    by = {}
    for it in items:
        if ca.is_rest_area(it) or str(it.get("delYn", "N")).upper() == "Y":
            continue
        try:
            pt = (float(it["lat"]), float(it["lng"]))
        except (KeyError, TypeError, ValueError):
            continue
        sid = str(it.get("statId") or "")
        if not sid:
            continue
        operator = str(it.get("busiNm") or it.get("bnm") or "").strip() or "알 수 없음"
        st = by.setdefault(sid, {"id": sid, "name": str(it.get("statNm") or "").strip(), "operator": operator,
                                 "price": tariffs.get(operator, tariffs["default"]), "updated": fetched_ms,
                                 "chargers": [], "pt": pt})
        st["chargers"].append(ca.charger_of(it))
    return [s for s in by.values() if any(c["type"] == "fast" for c in s["chargers"])]


def attach(routes, ics, stations):
    """노선 목록(live.js 모양)에 '○○ 나들목' 항목을 끼워 넣는다. 같은 충전소가 노선 안에 두 번 들어가지 않게 한다."""
    by_key = {r["key"]: r for r in routes}
    added = 0
    for hk, hw in ca.HIGHWAYS.items():
        length = ca.line_length_km(hw["points"])
        on = ics_on_highway(ics, hk)
        for side in ("forward", "backward"):
            r = by_key.get(hw[side]["key"])
            if r is None:
                continue
            used = {s["id"] for a in r["rest_areas"] for s in a["stations"]}
            for i, ic in enumerate(on):
                near = [n for n in nearby_stations(ic, stations) if n["station"]["id"] not in used]
                if not near:
                    continue
                for n in near:
                    used.add(n["station"]["id"])
                km = ic["along"] if side == "forward" else length - ic["along"]
                r["rest_areas"].append({"id": f"{r['key']}-ic{i + 1}", "name": f"{ic['name']} 나들목", "km": round(km, 1),
                                        "kind": "ic", "stations": [], "nearby": near})
                added += 1
            r["rest_areas"].sort(key=lambda a: (a["km"], a["name"]))
    return added


def fetch_ics(key, rows=1000, log=print):
    out, page = [], 1
    while True:
        q = urllib.parse.urlencode({"key": key, "type": "json", "numOfRows": rows, "pageNo": page})
        text = ca._get(f"{EX_ENDPOINT}?{q}", f"나들목 {page}쪽", log=log)
        data = json.loads(text)
        part = data.get("list") or data.get("items") or []
        out += part
        total = int(data.get("count") or data.get("totalCount") or len(out))
        if not part or len(out) >= total:
            return out
        page += 1
        time.sleep(0.3)


def fetch_all_chargers(key, log=print):
    """휴게소가 아닌 것까지 전국 충전기 전부(수십만 건, PC 에서 몇 분)."""
    items = []
    for z in ca.ZCODES:
        out, page = [], 1
        while True:
            q = urllib.parse.urlencode({"pageNo": page, "numOfRows": 9999, "zcode": z, "dataType": "JSON"})
            k = key if "%" in key else urllib.parse.quote(key, safe="")
            part, total = ca.parse_page(ca._get(f"{ca.ENDPOINT}?serviceKey={k}&{q}", f"지역 {z}, {page}쪽", log=log))
            out += part
            if not part or len(out) >= total:
                break
            page += 1
            time.sleep(0.3)
        log(f"  지역 {z}: {len(out)}")
        items += out
    return items


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--ics", type=Path, help="나들목 목록 파일(JSON). 없으면 EX_API_KEY 로 받는다")
    ap.add_argument("--save-ics", type=Path, help="받은 나들목 원본을 저장(필드 확인용)")
    ap.add_argument("--chargers", type=Path, help="전국 충전기 원본(JSON, items.item). 없으면 키로 받는다")
    ap.add_argument("--live", type=Path, default=ca.ROOT / "web" / "live.js", help="나들목 항목을 붙일 live.js")
    a = ap.parse_args(argv)

    if a.ics:
        raw_ics = json.loads(a.ics.read_text(encoding="utf-8"))
    else:
        key = os.environ.get(EX_KEY_ENV, "").strip()
        if not key:
            print(f"나들목 위치가 없다. 고속도로 공공데이터 포털(data.ex.co.kr) 키를 환경변수 {EX_KEY_ENV} 로 넣거나 --ics 파일을 준다.")
            return 2
        raw_ics = fetch_ics(key)
    if a.save_ics:
        a.save_ics.write_text(json.dumps(raw_ics, ensure_ascii=False), encoding="utf-8")
    ics = parse_ics(raw_ics)
    print(f"나들목 {len(ics)}곳")

    text = a.live.read_text(encoding="utf-8")
    live = json.loads(text[text.index("var d = ") + 8:text.index(";\n  if (typeof module")])
    if a.chargers:
        items = json.loads(a.chargers.read_text(encoding="utf-8"))["items"]["item"]
    else:
        key = os.environ.get(ca.KEY_ENV, "").strip()
        if not key:
            print(f"환경변수 {ca.KEY_ENV} 가 없다.")
            return 2
        items = fetch_all_chargers(key)
    stations = stations_from_items(items, live["fetched_at"])
    for r in live["routes"]:  # 다시 돌려도 겹치지 않게 예전 나들목 항목은 지운다
        r["rest_areas"] = [x for x in r["rest_areas"] if x.get("kind") != "ic"]
    added = attach(live["routes"], ics, stations)
    live["ic_note"] = f"나들목 인근 충전소는 직선 {NEAR_KM:g}km 안, 왕복 거리는 직선×2×{ROAD_FACTOR:g} 대략"
    ca.write_live_js(live["routes"], live["fetched_at"], a.live, live.get("skipped"))
    # write_live_js 는 ic_note 를 모르므로 덧붙인다
    t = a.live.read_text(encoding="utf-8")
    a.live.write_text(t.replace('"config":', f'"ic_note":{json.dumps(live["ic_note"], ensure_ascii=False)},"config":', 1), encoding="utf-8")
    print(f"급속 충전소(휴게소 밖) {len(stations)}곳 중 나들목 인근을 붙인 항목 {added}개 → {a.live}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
