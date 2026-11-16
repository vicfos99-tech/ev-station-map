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

SAME_NAME_KM = 5.0     # 같은 이름의 나들목이 이 안에 또 있으면 하나로

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
        ic = {"name": name, "route": str(_first(it, ROUTE_KEYS) or "").strip(), "lat": lat, "lng": lng}
        no = str(it.get("routeNo") or "").strip()
        if no:  # 도로공사 실제 응답: 노선 번호가 있다 → 번호로 고속도로를 가린다(EX_ROUTE_NOS)
            if EX_SKIP.search(name) or name in EX_MAINLINE:
                continue
            ic["route_no"] = no
        out.append(ic)
    return out


# 도로공사 '영업소 위치정보'(2026-11-15 실제 응답 확인: unitName, routeNo, routeName, xValue=경도, yValue=위도, 590곳 중 192곳은 좌표 없음)
EX_SKIP = re.compile(r"휴게소|JC|분기점|테스트|\(개\)")
# 본선 위 요금소: 여기서는 고속도로를 빠져나갈 수 없어 '나들목'이 아니다
EX_MAINLINE = {"서울", "서서울", "동서울", "군자", "북부산", "남양주", "동산", "목포", "광주", "동광주", "대동", "서부산"}
# 도로공사 노선 번호(오픈스트리트맵 ref 와 다른 곳이 있다: 순천완주 627, 당진영덕 030+032, 동해 065+066)
EX_ROUTE_NOS = {"gb": {"001"}, "yd": {"050"}, "sh": {"015"}, "jb": {"035"}, "jn": {"045"}, "hn": {"025"}, "nh": {"010"}, "sy": {"060"},
                "ja": {"055"}, "dy": {"030", "032"}, "pj": {"040"}, "gd": {"012"}, "nc": set(), "sw": {"627"},
                "dhs": {"065", "066"}, "dhn": {"065"}}


OSM_SKIP = re.compile(r"분기점|JC|JCT|휴게소|쉼터|SA|PA|지하차도|터널")  # 나갈 수 없거나 나들목이 아닌 것
OSM_SUFFIX = re.compile(r"\s*(나들목|인터체인지|교차로|IC|I\.C\.?)\s*$", re.I)


# 고속도로 노선 번호(오픈스트리트맵 ref). 나들목 노드가 올라앉은 도로의 번호로 '어느 고속도로의 나들목인지' 가린다.
HW_REFS = {"gb": {"1"}, "yd": {"50"}, "sh": {"15"}, "jb": {"35"}, "jn": {"45"}, "hn": {"25"}, "nh": {"10"}, "sy": {"60"},
           "ja": {"55"}, "dy": {"30"}, "pj": {"40"}, "gd": {"12"}, "nc": {"25"}, "sw": {"27"}, "dhs": {"65"}, "dhn": {"65"}}
REF_ON_LINE_KM = 5.0   # 노선 번호가 맞는 나들목은 우리 선(대략 그림)에서 이만큼까지 받아 준다


def osm_node_refs(ways):
    """고속도로 길(way) 목록 → {노드 id: 그 노드를 지나는 길들의 노선 번호 집합}."""
    refs = {}
    for w in (ways.get("elements") or []) if isinstance(ways, dict) else []:
        mine = {r.strip() for r in str((w.get("tags") or {}).get("ref") or "").split(";") if r.strip()}
        if not mine:
            continue
        for nid in w.get("nodes") or []:
            refs.setdefault(nid, set()).update(mine)
    return refs


def parse_osm(raw, ways=None):
    """오픈스트리트맵(Overpass)의 highway=motorway_junction 노드 → [{name, route, lat, lng[, refs]}].

    도로공사 키가 없을 때 쓰는 나들목 위치. 노선 이름이 없어서(route="") ways(고속도로 길 목록)를 주면 노드가 놓인
    길의 노선 번호(refs)를 달아 준다. ways 가 없으면 고속도로 선까지 거리로만 노선을 정한다(옆 도로 나들목이 섞일 수 있다).
    분기점·휴게소 진출입·이름 없는 노드는 뺀다. 이름 끝의 '나들목/IC'는 뗀다(붙일 때 '○○ 나들목'으로 다시 붙임).
    """
    node_refs = osm_node_refs(ways) if ways is not None else None
    out = []
    for e in (raw.get("elements") or []) if isinstance(raw, dict) else []:
        tags = e.get("tags") or {}
        name = str(tags.get("name") or "").strip()
        if not name or OSM_SKIP.search(name) or re.search(r"[぀-ヿ一-鿿]", name):  # 일본(한자·가나) 노드 제외
            continue
        try:
            lat, lng = float(e["lat"]), float(e["lon"])
        except (KeyError, TypeError, ValueError):
            continue
        if not (33 <= lat <= 39 and 124 <= lng <= 132):
            continue
        name = re.sub(r"\s*\(?하이패스\)?\s*$", "", OSM_SUFFIX.sub("", name)).strip()  # '삼성IC(하이패스)' → '삼성'
        name = OSM_SUFFIX.sub("", name).strip()
        if not name:
            continue
        ic = {"name": name, "route": "", "lat": lat, "lng": lng}
        if node_refs is not None:
            ic["refs"] = sorted(node_refs.get(e.get("id"), ()))
        out.append(ic)
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
        if "route_no" in ic:  # 도로공사 영업소: 도로공사 노선 번호가 이 고속도로 것일 때만
            if ic["route_no"] in EX_ROUTE_NOS.get(hk, set()) and off <= REF_ON_LINE_KM:
                found.append({**ic, "along": along})
            continue
        if "refs" in ic:  # 노선 번호를 아는 나들목: 번호가 이 고속도로 것일 때만(옆을 지나는 다른 도로의 나들목은 뺀다)
            if set(ic["refs"]) & HW_REFS.get(hk, set()) and off <= REF_ON_LINE_KM:
                found.append({**ic, "along": along})
            continue
        named =ic["route"] and _route_word(ic["route"]) and _route_word(ic["route"]) in word
        if off <= IC_ON_LINE_KM and (named or not ic["route"]):
            found.append({**ic, "along": along})
        elif named and off <= ca.HINT_MAX_KM:
            found.append({**ic, "along": along})
    found.sort(key=lambda x: (x["along"], x["name"]))
    merged = []
    for ic in found:
        if merged and ic["along"] - merged[-1]["along"] < MIN_GAP_KM:
            continue
        # 같은 이름이 가까이 또 나오면(방향별 진출 지점이 따로 찍혔거나, 두 자료에 다 있는 것) 앞의 것 하나만
        key = ic["name"].replace(" ", "")
        if any(m["name"].replace(" ", "") == key and ic["along"] - m["along"] < SAME_NAME_KM for m in merged):
            continue
        merged.append(ic)
    return merged


def nearby_stations(ic, stations):
    """나들목에서 직선 NEAR_KM 안의 급속 충전소, 왕복 거리 짧은 순.

    가까운 MAX_PER_IC 곳 + 야외(건물 안·지하가 아닌) 가까운 MAX_PER_IC 곳을 합쳐 준다(최대 2×MAX_PER_IC).
    탑차·윙바디처럼 높은 차는 화면에서 건물 안 충전소를 숨기므로, 가까운 곳이 모두 건물 안이어도 야외 후보가 남게 한다.
    화면은 걸러 낸 뒤 가까운 MAX_PER_IC 곳만 쓴다.
    """
    near = []
    for st in stations:
        d = ca.haversine_km((ic["lat"], ic["lng"]), st["pt"])
        if d <= NEAR_KM:
            near.append((round(d * 2 * ROAD_FACTOR, 1), st["id"], st))
    near.sort(key=lambda x: (x[0], x[1]))
    outdoor = [n for n in near if not n[2].get("indoor")][:MAX_PER_IC]
    picked = sorted({n[1]: n for n in near[:MAX_PER_IC] + outdoor}.values(), key=lambda x: (x[0], x[1]))
    return [{"station": {k: v for k, v in st.items() if k != "pt"}, "detour": detour} for detour, _, st in picked]


PRIVATE_NAME = re.compile(r"전용|입주민|임직원|관계자|전기버스|버스 ?충전|차고지|택배")


def open_to_public(it):
    """지나가다 들러 쓸 수 있는 곳인가. 공동주택(아파트·연립·기숙사, kindDetail H…), 이용 제한(limitYn=Y),
    이름에 '직원전용·입주민' 등이 든 곳은 뺀다. 그래도 남는 제한(영업시간·주차비)은 못 거른다."""
    if str(it.get("kindDetail") or "").upper().startswith("H"):
        return False
    if str(it.get("limitYn") or "N").upper() == "Y":
        return False
    return not PRIVATE_NAME.search(str(it.get("statNm") or ""))


INDOOR_NAME = re.compile(r"지하|(?<![A-Za-z])[Bb]\s?[1-9](?![0-9A-Za-z])|주차타워|주차빌딩|주차동|옥내|실내|건물 ?[내안]|옥상|(?<![0-9])[2-9]층")


def is_indoor(it):
    """건물 안·지하 충전기인가(탑차·윙바디처럼 높은 차가 못 들어갈 수 있는 곳).

    공공 데이터의 지상/지하 구분(floorType: F 지상, B 지하)과 층(floorNum), 이름·상세 위치의 글자로 본다.
    높이 제한 수치는 데이터에 없다. 야외인데 높이 제한이 있는 곳은 이걸로 못 거른다(화면에서 사람이 적는다).
    """
    if str(it.get("floorType") or "").strip().upper() == "B":
        return True
    m = re.match(r"\s*-?\d+", str(it.get("floorNum") or ""))
    if m and (int(m.group()) >= 2 or int(m.group()) < 0):
        return True
    return bool(INDOOR_NAME.search(f"{it.get('statNm') or ''} {it.get('location') or ''}"))


def stations_from_items(items, fetched_ms, tariffs=ca.TARIFFS):
    """휴게소가 아닌 충전기 → 급속이 하나라도 있는 충전소 목록(좌표 포함)."""
    by = {}
    for it in items:
        if ca.is_rest_area(it) or str(it.get("delYn", "N")).upper() == "Y":
            continue
        if not open_to_public(it):
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
                                 "chargers": [], "pt": pt,
                                 "loc": [round(pt[0], 5), round(pt[1], 5)], "maker": ""})
        st["chargers"].append(ca.charger_of(it))
        ca.add_maker(st, it)
        if is_indoor(it):
            st["indoor"] = True  # 충전기 하나라도 건물 안·지하면 그 충전소는 건물 안으로 본다
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
                                        "kind": "ic", "loc": [round(ic["lat"], 5), round(ic["lng"], 5)],
                                        "stations": [], "nearby": near})
                added += 1
            r["rest_areas"].sort(key=lambda a: (a["km"], a["name"]))
    return added


def fetch_ics(key, rows=100, log=print):  # 한 번에 100건까지만 준다(2026-11-15 확인)
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
    ap.add_argument("--osm", type=Path, help="오픈스트리트맵 motorway_junction 파일(Overpass JSON). 도로공사 키가 없을 때")
    ap.add_argument("--osm-ways", type=Path, help="오픈스트리트맵 고속도로 길 목록(way, ref 포함). 주면 노선 번호로 나들목의 고속도로를 가린다")
    ap.add_argument("--save-ics", type=Path, help="받은 나들목 원본을 저장(필드 확인용)")
    ap.add_argument("--chargers", type=Path, help="전국 충전기 원본(JSON, items.item). 없으면 키로 받는다")
    ap.add_argument("--live", type=Path, default=ca.ROOT / "web" / "live.js", help="나들목 항목을 붙일 live.js")
    a = ap.parse_args(argv)

    # 나들목 위치: 도로공사 영업소(--ics 파일 또는 키)와 오픈스트리트맵(--osm)을 같이 줄 수 있다. 둘 다 주면 합친다
    # (도로공사는 좌표가 빈 곳·요금소 없는 나들목이 빠지고, 오픈스트리트맵은 일부 나들목이 빠진다. 같은 이름은 하나로).
    ics, sources = [], []
    raw_ics = None
    if a.ics:
        raw_ics = json.loads(a.ics.read_text(encoding="utf-8"))
    elif not a.osm:
        key = os.environ.get(EX_KEY_ENV, "").strip()
        if not key:
            print(f"나들목 위치가 없다. 고속도로 공공데이터 포털(data.ex.co.kr) 키를 환경변수 {EX_KEY_ENV} 로 넣거나 --ics / --osm 파일을 준다.")
            return 2
        raw_ics = fetch_ics(key)
    if raw_ics is not None:
        if a.save_ics:
            a.save_ics.write_text(json.dumps(raw_ics, ensure_ascii=False), encoding="utf-8")
        ex = parse_ics(raw_ics)
        ics += ex
        sources.append("한국도로공사 영업소 위치정보")
        print(f"도로공사 영업소 {len(ex)}곳")
    if a.osm:
        ways = json.loads(a.osm_ways.read_text(encoding="utf-8")) if a.osm_ways else None
        osm = parse_osm(json.loads(a.osm.read_text(encoding="utf-8")), ways)
        ics += osm
        sources.append("© OpenStreetMap contributors")
        print(f"오픈스트리트맵 나들목 {len(osm)}곳")
    source = ", ".join(sources)
    print(f"나들목 {len(ics)}곳 ({source})")

    text = a.live.read_text(encoding="utf-8")
    live = json.loads(text[text.index("var d = ") + 8:text.index(";\n  if (typeof module")])
    status_ms = live["fetched_at"]
    if a.chargers:
        data = json.loads(a.chargers.read_text(encoding="utf-8"))
        items = data["items"]["item"]
        status_ms = data.get("fetched_ms", status_ms)  # 충전기 상태를 받은 시각(tools/fetch_near_highway.py 가 적어 둠)
    else:
        key = os.environ.get(ca.KEY_ENV, "").strip()
        if not key:
            print(f"환경변수 {ca.KEY_ENV} 가 없다.")
            return 2
        items = fetch_all_chargers(key)
    stations = stations_from_items(items, status_ms)
    for r in live["routes"]:  # 다시 돌려도 겹치지 않게 예전 나들목 항목은 지운다
        r["rest_areas"] = [x for x in r["rest_areas"] if x.get("kind") != "ic"]
    added = attach(live["routes"], ics, stations)
    live["ic_note"] = f"나들목 인근 충전소는 직선 {NEAR_KM:g}km 안, 왕복 거리는 직선×2×{ROAD_FACTOR:g} 대략. 나들목 위치: {source}"
    ca.write_live_js(live["routes"], live["fetched_at"], a.live, live.get("skipped"))
    # write_live_js 는 ic_note 를 모르므로 덧붙인다
    t = a.live.read_text(encoding="utf-8")
    a.live.write_text(t.replace('"config":', f'"ic_note":{json.dumps(live["ic_note"], ensure_ascii=False)},"config":', 1), encoding="utf-8")
    print(f"급속 충전소(휴게소 밖) {len(stations)}곳 중 나들목 인근을 붙인 항목 {added}개 → {a.live}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
