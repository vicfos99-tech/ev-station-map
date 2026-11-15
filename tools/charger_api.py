"""공공 충전소 API(한국환경공단 전기자동차 충전소 정보) → 앱용 실제 노선 데이터.

    py tools/charger_api.py                 # 환경변수 EV_CHARGER_API_KEY 의 키로 받아 web/live.js 생성
    py tools/charger_api.py --sample f.json # 저장해 둔 응답으로 (키 없이) 시험
    py tools/charger_api.py --save raw.json # 받은 원본도 파일로 남김

- 키는 환경변수로만 받는다. 화면이나 파일에 키를 찍지 않는다(오류 메시지에도 URL 을 넣지 않는다).
- 폰 앱(Artifact)은 바깥 서버를 부를 수 없어서, 여기서 받아 web/live.js 로 만든 뒤 build 해 다시 배포한다.
- 고속도로 휴게소 충전소만 골라 노선 위 거리(km)를 붙인다. 거리는 고속도로를 대략 따라가는 점들에
  충전소 좌표를 투영해 구한 '대략 거리'다.
- 충전소 상태 시각은 받은 시각으로 둔다. API 의 statUpdDt 는 '상태가 마지막으로 바뀐 때'라서
  오래 쉬는 충전기도 낡아 보이기 때문이다. 받은 지 오래되면 엔진이 '정보 오래됨'으로 알린다.
- 가격은 API 에 없어서 업체 요금표(TARIFFS)로 넣는다. 지금은 추정값이다.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ENDPOINT = "https://apis.data.go.kr/B552584/EvCharger/getChargerInfo"
KEY_ENV = "EV_CHARGER_API_KEY"
KST = timezone(timedelta(hours=9))
ROOT = Path(__file__).resolve().parent.parent

# 충전기 상태 코드 → 엔진 상태
STATUS = {
    "1": "comm_error",      # 통신 이상
    "2": "available",       # 충전 대기
    "3": "charging",        # 충전 중
    "4": "out_of_service",  # 운영 중지
    "5": "maintenance",     # 점검 중
    "9": "comm_error",      # 상태 미확인
}
SLOW_TYPES = {"02", "08"}  # AC 완속, DC 콤보(완속). 나머지(01,03~07)는 급속
DEFAULT_KW = {"fast": 50.0, "slow": 7.0}

# 원/kWh. API 응답에 요금 필드가 없다(2026-11-15 확인). 환경부 급속 요금(묘성이 알려 준 2026-11 기준 391원)을
# 모든 업체에 쓴다. 업체별 실제 요금을 알게 되면 {"채비": 000, ...} 처럼 업체 이름(busiNm)으로 더한다.
TARIFFS = {"default": 391.0}
PRICE_NOTE = "가격은 환경부 급속 391원/kWh 기준 추정(업체마다 다를 수 있음)"

# 고속도로를 따라가는 점(위도, 경도). 기점 → 종점. forward = 기점→종점 방향(하행)
# 2026-11-15 실제 API 의 고속도로 휴게소(C001) 좌표로 다시 그렸다(처음 손으로 찍은 선은 황간 10km, 추풍령 7km 어긋남).
HIGHWAYS = {
    "gb": {
        "name": "경부고속도로",
        "zcodes": ["11", "41", "44", "43", "30", "36", "47", "27", "31", "48", "26"],
        "points": [
            (37.527, 127.012),  # 한남
            (37.460, 127.042),  # 서울만남
            (37.332, 127.105),  # 죽전
            (37.236, 127.105),  # 기흥
            (37.077, 127.133),  # 안성
            (36.943, 127.190),  # 입장
            (36.854, 127.180),  # 망향
            (36.788, 127.174),  # 천안삼거리
            (36.730, 127.264),  # 천안호두
            (36.716, 127.349),  # 청주
            (36.657, 127.370),  # 옥산
            (36.497, 127.430),  # 죽암
            (36.427, 127.418),  # 신탄진
            (36.366, 127.443),  # 대전 나들목
            (36.308, 127.573),  # 옥천만남
            (36.297, 127.595),  # 옥천
            (36.279, 127.674),  # 금강
            (36.249, 127.855),  # 황간
            (36.200, 128.003),  # 추풍령
            (36.129, 128.164),  # 김천
            (36.020, 128.429),  # 칠곡
            (35.979, 128.429),  # 왜관 영업소
            (35.906, 128.581),  # 북대구 나들목
            (35.848, 128.689),  # 가천 졸음쉼터
            (35.879, 128.811),  # 경산
            (35.885, 128.866),  # 평사
            (35.830, 129.110),  # 건천
            (35.813, 129.195),  # 경주 나들목
            (35.726, 129.194),  # 경주
            (35.599, 129.142),  # 언양
            (35.490, 129.092),  # 통도사
            (35.323, 129.056),  # 양산
            (35.279, 129.105),  # 부산 영업소
        ],
        "forward": {"key": "live-gb-down", "direction": "부산 방향", "tokens": ["부산", "하행"]},
        "backward": {"key": "live-gb-up", "direction": "서울 방향", "tokens": ["서울", "상행"]},
    },
    "yd": {
        "name": "영동고속도로",
        "zcodes": ["28", "41", "42", "51"],
        "points": [
            (37.430, 126.750),  # 서창 분기점
            (37.351, 126.818),  # 경기안산복합
            (37.340, 126.940),  # 군포
            (37.300, 127.000),  # 동수원
            (37.284, 127.100),  # 신갈 분기점
            (37.246, 127.243),  # 용인
            (37.241, 127.390),  # 덕평자연
            (37.236, 127.570),  # 여주
            (37.270, 127.640),  # 여주 분기점
            (37.335, 127.858),  # 문막
            (37.370, 127.900),  # 만종 분기점
            (37.420, 128.050),  # 새말
            (37.465, 128.135),  # 횡성
            (37.510, 128.230),  # 둔내
            (37.606, 128.453),  # 평창
            (37.640, 128.550),  # 진부
            (37.757, 128.807),  # 강릉대관령
            (37.730, 128.870),  # 강릉 분기점
        ],
        "forward": {"key": "live-yd-east", "direction": "강릉 방향", "tokens": ["강릉", "하행"]},
        "backward": {"key": "live-yd-west", "direction": "인천 방향", "tokens": ["인천", "서울", "상행"]},
    },
}
MAX_OFFSET_KM = 2.0  # 고속도로 선에서 이만큼보다 멀면 그 고속도로 휴게소로 보지 않는다


class ApiError(Exception):
    pass


# ---------- 거리 계산 ----------
def haversine_km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(h))


def line_length_km(points):
    return sum(haversine_km(points[i], points[i + 1]) for i in range(len(points) - 1))


def project(point, points):
    """점을 선에 투영한다. (기점에서 선을 따라간 km, 선에서 떨어진 km)."""
    best = (math.inf, 0.0)
    along = 0.0
    for i in range(len(points) - 1):
        a, b = points[i], points[i + 1]
        seg = haversine_km(a, b)
        # 짧은 구간이라 위경도를 평면으로 보고 비율을 구한다(경도는 위도 코사인으로 줄인다)
        k = math.cos(math.radians((a[0] + b[0]) / 2))
        ax, ay, bx, by = a[1] * k, a[0], b[1] * k, b[0]
        px, py = point[1] * k, point[0]
        dx, dy = bx - ax, by - ay
        t = 0.0 if dx == dy == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
        foot = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
        off = haversine_km(point, foot)
        if off < best[0]:
            best = (off, along + seg * t)
        along += seg
    return best[1], best[0]


# ---------- 응답 읽기 ----------
def parse_page(text):
    """한 페이지 응답 → (항목 목록, 전체 개수). 오류 응답이면 ApiError."""
    try:
        data = json.loads(text)
    except ValueError:
        m = re.search(r"<returnAuthMsg>([^<]+)</returnAuthMsg>|<resultMsg>([^<]+)</resultMsg>", text)
        msg = (m.group(1) or m.group(2)) if m else text.strip()[:120]
        raise ApiError(f"API 가 JSON 이 아닌 답을 줬다: {msg}")
    if isinstance(data, dict) and "response" in data:  # 감싼 모양도 받는다
        data = data["response"].get("body", data["response"])
    code = str(data.get("resultCode", data.get("header", {}).get("resultCode", "00")))
    if code not in ("00", "0"):
        raise ApiError(f"API 오류 {code}: {data.get('resultMsg', '')}")
    items = data.get("items") or {}
    items = items.get("item", []) if isinstance(items, dict) else items
    if isinstance(items, dict):
        items = [items]
    return list(items), int(data.get("totalCount") or len(items))


def _get(url, where, tries=3, wait=5.0, log=print):
    """한 쪽 받기. 서버 쪽 일시 오류(5xx·연결 끊김)는 쉬었다가 다시. URL(키 포함)은 찍지 않는다."""
    for n in range(1, tries + 1):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "ev-charge-planner"}),
                                        timeout=120) as r:
                return r.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as e:
            msg, again = f"HTTP {e.code} {e.reason} ({where})", e.code >= 500
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            msg, again = f"연결 실패: {getattr(e, 'reason', e)} ({where})", True
        if not again or n == tries:
            raise ApiError(msg + (f", {tries}번 시도" if again else ""))
        log(f"  {msg} → {wait * n:.0f}초 뒤 다시")
        time.sleep(wait * n)


def fetch_zcode(key, zcode, rows=9999, pause=0.3, log=print, wait=5.0):
    out, page = [], 1
    while True:
        q = urllib.parse.urlencode({"pageNo": page, "numOfRows": rows, "zcode": zcode, "dataType": "JSON"})
        # 포털의 '인코딩' 키(%가 들어 있음)는 그대로, '디코딩' 키는 인코딩해서 붙인다
        k = key if "%" in key else urllib.parse.quote(key, safe="")
        text = _get(f"{ENDPOINT}?serviceKey={k}&{q}", f"지역 {zcode}, {page}쪽", wait=wait, log=log)
        items, total = parse_page(text)
        out += items
        log(f"  지역 {zcode}: {len(out)}/{total}")
        if not items or len(out) >= total:
            return out
        page += 1
        time.sleep(pause)


# ---------- 노선 만들기 ----------
def charger_of(item):
    t = str(item.get("chgerType", "")).zfill(2)
    kind = "slow" if t in SLOW_TYPES else "fast"
    try:
        kw = float(item.get("output") or 0)
    except ValueError:
        kw = 0.0
    return {"type": kind, "power_kw": kw if kw > 0 else DEFAULT_KW[kind],
            "status": STATUS.get(str(item.get("stat", "")), "comm_error")}


def is_rest_area(item):
    return str(item.get("kindDetail", "")) == "C001" or "휴게소" in str(item.get("statNm", ""))


def direction_of(name, hw):
    """이름의 괄호 안 글자나 'OO방향'·'OO방면'으로 방향을 고른다. 모르면 None."""
    spaced = name.replace("휴게소", " ")
    inside = " ".join(re.findall(r"\(([^)]*)\)", name) + re.findall(r"(\S+?)\s*방[향면]", spaced))
    hits = [side for side in ("forward", "backward") if any(t in inside for t in hw[side]["tokens"])]
    return hits[0] if len(hits) == 1 else None


def base_name(name):
    """업체마다 다르게 쓴 휴게소 이름을 맞춘다: 괄호·'휴게소'·'OO방향'·띄어쓰기를 뺀다."""
    s = re.sub(r"\([^)]*\)", "", name).replace("휴게소", " ")
    s = re.sub(r"\S+?\s*방[향면]", "", s)
    s = re.sub(r"^\s*워터\s*|\s*E-?pit\b", " ", s, flags=re.I)  # 충전 업체가 붙인 상표(워터, E-pit)
    return re.sub(r"\s+", "", s) or name.strip()


MERGE_KM = 2.0  # 같은 방향에서 이만큼 안에 있는 휴게소는 이름이 달라도 한 곳으로 본다


def build_routes(items, fetched_ms, tariffs=TARIFFS):
    """API 항목들 → 노선 목록(앱 data.js 가 읽는 모양)과 빠진 것 집계."""
    skipped = {"방향 모름": set(), "고속도로에서 멂": set()}
    buckets = {}  # (hw, side) → {휴게소 이름: {"km":[], "stations":{statId: station}}}
    for it in items:
        if not is_rest_area(it) or str(it.get("delYn", "N")).upper() == "Y":
            continue
        name = str(it.get("statNm", "")).strip()
        try:
            pt = (float(it["lat"]), float(it["lng"]))
        except (KeyError, TypeError, ValueError):
            continue
        near = None
        for hk, hw in HIGHWAYS.items():
            along, off = project(pt, hw["points"])
            if off <= MAX_OFFSET_KM and (near is None or off < near[2]):
                near = (hk, along, off)
        if near is None:
            skipped["고속도로에서 멂"].add(name)
            continue
        hk, along, _ = near
        hw = HIGHWAYS[hk]
        side = direction_of(name, hw)
        if side is None:
            skipped["방향 모름"].add(name)
            continue
        km = along if side == "forward" else line_length_km(hw["points"]) - along
        area = buckets.setdefault((hk, side), {}).setdefault(base_name(name), {"km": [], "stations": {}})
        area["km"].append(km)
        sid = str(it.get("statId", "")) or name
        operator = str(it.get("busiNm") or it.get("bnm") or "").strip() or "알 수 없음"  # "SK시그넷 " 처럼 끝 공백이 있다
        st = area["stations"].setdefault(sid, {
            "id": sid, "operator": operator,
            "price": tariffs.get(operator, tariffs["default"]),
            "updated": fetched_ms, "chargers": [],
        })
        st["chargers"].append(charger_of(it))

    routes = []
    for hk, hw in HIGHWAYS.items():
        length = round(line_length_km(hw["points"]))
        for side in ("forward", "backward"):
            areas = buckets.get((hk, side), {})
            if not areas:
                continue
            # 이름별로 모은 뒤, 거리순으로 놓고 MERGE_KM 안에 붙은 것은 한 휴게소로 합친다
            groups = sorted(((sum(a["km"]) / len(a["km"]), base, a) for base, a in areas.items()),
                            key=lambda g: (g[0], g[1]))
            merged = []
            for km, base, a in groups:
                if merged and km - merged[-1]["last"] <= MERGE_KM:
                    m = merged[-1]
                else:
                    m = {"kms": [], "bases": [], "stations": {}, "last": km}
                    merged.append(m)
                m["kms"] += a["km"]
                m["bases"].append(base)
                m["last"] = km
                for sid, st in a["stations"].items():
                    m["stations"].setdefault(sid, {**st, "chargers": []})["chargers"] += st["chargers"]
            rest = []
            for m in merged:
                name = max(m["bases"], key=lambda b: (len(b), b)) + "휴게소"  # 가장 긴(정식) 이름
                rest.append({"name": name, "km": round(sum(m["kms"]) / len(m["kms"]), 1),
                             "stations": sorted(m["stations"].values(), key=lambda s: s["id"])})
            rest.sort(key=lambda r: (r["km"], r["name"]))
            for i, r in enumerate(rest, 1):
                r["id"] = f"{hw[side]['key']}-{i}"
            seen = set()  # 엔진은 노선 안 충전소 id 중복을 거부한다 → 드물게 겹치면 뒤에 번호를 붙인다
            for r in rest:
                for st in r["stations"]:
                    base_id, n = st["id"], 1
                    while st["id"] in seen:
                        n += 1
                        st["id"] = f"{base_id}-{n}"
                    seen.add(st["id"])
            routes.append({"key": hw[side]["key"], "highway": hw["name"], "direction": hw[side]["direction"],
                           "length": length, "live": True, "rest_areas": rest})
    return routes, {k: sorted(v) for k, v in skipped.items()}


def write_live_js(routes, fetched_ms, path, skipped=None):
    payload = {"fetched_at": fetched_ms, "source": "한국환경공단 전기자동차 충전소 정보(공공데이터포털)",
               "price_note": PRICE_NOTE, "routes": routes, "skipped": skipped or {}}
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    path.write_text(
        "/* tools/charger_api.py 가 만든 실제 충전소 데이터. 손으로 고치지 않는다. */\n"
        f"(function (root) {{ var d = {body};\n"
        "  if (typeof module === \"object\" && module.exports) module.exports = d; else root.EvLive = d;\n"
        "})(typeof self !== \"undefined\" ? self : this);\n",
        encoding="utf-8")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--sample", type=Path, help="저장해 둔 API 응답(JSON)으로 시험")
    ap.add_argument("--save", type=Path, help="받은 원본 항목을 이 파일에 저장")
    ap.add_argument("--zcode", action="append", help="이 지역 코드만 받기(여러 번 가능)")
    ap.add_argument("--out", type=Path, default=ROOT / "web" / "live.js")
    a = ap.parse_args(argv)

    fetched_ms = int(time.time() * 1000)
    if a.sample:  # 저장해 둔 응답이면 그 파일을 만든 때를 받은 시각으로 본다
        fetched_ms = int(a.sample.stat().st_mtime * 1000)
        items, _ = parse_page(a.sample.read_text(encoding="utf-8"))
    else:
        key = os.environ.get(KEY_ENV, "").strip()
        if not key:
            print(f"환경변수 {KEY_ENV} 가 없다. 공공데이터포털에서 받은 키를 환경변수로 넣고 터미널을 새로 연다.")
            return 2
        zcodes = a.zcode or sorted({z for hw in HIGHWAYS.values() for z in hw["zcodes"]})
        items = []
        for z in zcodes:
            items += fetch_zcode(key, z)
    if a.save:
        a.save.write_text(json.dumps({"items": {"item": items}, "totalCount": len(items)}, ensure_ascii=False), encoding="utf-8")

    routes, skipped = build_routes(items, fetched_ms)
    write_live_js(routes, fetched_ms, a.out, skipped)
    when = datetime.fromtimestamp(fetched_ms / 1000, KST).strftime("%m-%d %H:%M")
    print(f"받은 항목 {len(items)}개, {when} 기준")
    for r in routes:
        n = sum(len(s["chargers"]) for ra in r["rest_areas"] for s in ra["stations"])
        print(f"  {r['highway']} {r['direction']}: 휴게소 {len(r['rest_areas'])}곳, 충전기 {n}대")
    for why, names in skipped.items():
        if names:
            print(f"  빠짐({why}) {len(names)}곳: {', '.join(names[:5])}{' …' if len(names) > 5 else ''}")
    print(f"→ {a.out}  (다음: node web/build.js)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
