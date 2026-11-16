"""전국 충전기를 훑어 '위치 → 시군구 코드(zscode)' 표를 만든다 → web/regions.js

    py tools/make_regions.py

- 지도 탭이 지금 위치의 시군구를 알아내 그 시군구의 충전소만 공공 데이터에서 받는 데 쓴다.
- 지도를 STEP 도(약 5km) 칸으로 나누고, 칸마다 충전기가 가장 많은 시군구 코드를 적는다.
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

STEP = 0.05
ROWS = 5000
OUT = HERE.parent / "web" / "regions.js"


def cell_of(lat, lng):
    return f"{math.floor(lat / STEP)}_{math.floor(lng / STEP)}"


def main():
    key = fn.key_from_env()
    if not key:
        print(f"환경변수 {ca.KEY_ENV} 가 없다.")
        return 2
    k = key if "%" in key else urllib.parse.quote(key, safe="")
    cells = defaultdict(Counter)
    seen = 0
    for z in ca.ZCODES:
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
            if not part or got >= total:
                break
            page += 1
            time.sleep(0.3)
        seen += got
        print(f"  지역 {z}: {got}건 (누적 {seen}, 칸 {len(cells)})", flush=True)
    table = {c: cnt.most_common(1)[0][0] for c, cnt in sorted(cells.items())}
    body = json.dumps({"step": STEP, "cells": table}, ensure_ascii=False, separators=(",", ":"))
    OUT.write_text("/* tools/make_regions.py 가 만든 '위치 → 시군구 코드' 표. 손으로 고치지 않는다. */\n"
                   "(function (root) { root.EvRegions = " + body + "; })(typeof window !== \"undefined\" ? window : globalThis);\n",
                   encoding="utf-8")
    print(f"전국 {seen}건 → 칸 {len(table)}개, 시군구 {len(set(table.values()))}곳 → {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
