"""전국 충전기를 훑어 '위치 → 시군구 코드(zscode)' 표를 만든다 → web/regions.js

    py tools/make_regions.py            전국을 다시 받아서 만든다(20분쯤)
    py tools/make_regions.py --add 12   받아 둔 점에 이 시도 코드만 새로 받아 더한다
    py tools/make_regions.py --points   받아 둔 점(30_자료/ev-charge/region_points.json)으로 표만 다시 만든다

- 지도 탭이 지금 위치의 시군구를 알아내 그 시군구의 충전소만 공공 데이터에서 받는 데 쓴다.
- 지도를 STEP 도(약 2km) 칸으로 나누고, 칸마다 충전기가 많은 시군구 코드를 많은 순으로 적는다
  (그 칸 충전기의 SHARE 이상인 것만, 셋까지 — 구 경계에 걸친 칸은 둘 다 받아야 빠지는 충전소가 없다).
- 키는 환경변수 EV_CHARGER_API_KEY(없으면 윈도우 사용자 환경변수). 키는 찍지 않는다.
"""
from __future__ import annotations

import json
import math
import sys
import time
import urllib.parse
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import charger_api as ca  # noqa: E402
import fetch_near_highway as fn  # noqa: E402

STEP = 0.02
ROWS = 5000
SHARE = 0.15
OUT = HERE.parent / "web" / "regions.js"
POINTS = HERE.parent.parent.parent / "30_자료" / "ev-charge" / "region_points.json"  # 칸 크기를 바꿀 때 다시 받지 않게 남겨 둔다


def cell_of(lat, lng):
    return f"{math.floor(lat / STEP)}_{math.floor(lng / STEP)}"


def write_table(cells, seen):
    table = {}
    for c, cnt in sorted(cells.items()):
        total = sum(cnt.values())
        table[c] = ",".join(z for z, n in cnt.most_common(3) if n >= SHARE * total)
    body = json.dumps({"step": STEP, "cells": table}, ensure_ascii=False, separators=(",", ":"))
    OUT.write_text("/* tools/make_regions.py 가 만든 '위치 → 시군구 코드' 표. 손으로 고치지 않는다. */\n"
                   "(function (root) { root.EvRegions = " + body + "; })(typeof window !== \"undefined\" ? window : globalThis);\n",
                   encoding="utf-8")
    zs = {z for v in table.values() for z in v.split(",")}
    print(f"전국 {seen}건 → 칸 {len(table)}개, 시군구 {len(zs)}곳 → {OUT}")


def main():
    if "--points" in sys.argv[1:]:
        cells = defaultdict(Counter)
        seen = 0
        for lat, lng, zs, n in json.loads(POINTS.read_text(encoding="utf-8")):
            cells[cell_of(lat, lng)][zs] += n
            seen += n
        write_table(cells, seen)
        return 0
    key = fn.key_from_env()
    if not key:
        print(f"환경변수 {ca.KEY_ENV} 가 없다.")
        return 2
    k = key if "%" in key else urllib.parse.quote(key, safe="")
    cells = defaultdict(Counter)
    points = Counter()  # (위도, 경도 소수 셋째 자리, 시군구) → 충전기 수
    seen = 0
    zcodes = ca.ZCODES
    if "--add" in sys.argv[1:]:  # 받아 둔 점에 몇 지역만 더한다
        zcodes = sys.argv[sys.argv.index("--add") + 1:]
        for lat, lng, zs, n in json.loads(POINTS.read_text(encoding="utf-8")):
            if zs[:2] in zcodes:
                continue  # 다시 받는 지역의 옛 점은 버린다
            cells[cell_of(lat, lng)][zs] += n
            points[(lat, lng, zs)] += n
            seen += n
    for z in zcodes:
        page, got = 1, 0
        while True:
            q = urllib.parse.urlencode({"pageNo": page, "numOfRows": ROWS, "zcode": z, "dataType": "JSON"})
            part, total = ca.parse_page(ca._get(f"{ca.ENDPOINT}?serviceKey={k}&{q}", f"지역 {z}, {page}쪽", tries=6, wait=10.0))
            got += len(part)
            for it in part:
                zs = str(it.get("zscode") or "").strip()
                try:
                    lat, lng = float(it["lat"]), float(it["lng"])
                except (KeyError, TypeError, ValueError):
                    continue
                if not zs or not (33.0 <= lat <= 38.7 and 124.5 <= lng <= 132.0):
                    continue
                cells[cell_of(lat, lng)][zs] += 1
                points[(round(lat, 3), round(lng, 3), zs)] += 1
            if not part or got >= total:
                break
            page += 1
            time.sleep(0.3)
        seen += got
        print(f"  지역 {z}: {got}건 (누적 {seen}, 칸 {len(cells)})", flush=True)
    POINTS.write_text(json.dumps([[a, b, z, n] for (a, b, z), n in points.items()], separators=(",", ":")), encoding="utf-8")
    write_table(cells, seen)
    return 0


if __name__ == "__main__":
    sys.exit(main())
