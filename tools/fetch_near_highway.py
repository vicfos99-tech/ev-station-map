"""전국 충전기를 받아, 고속도로 선에서 NEAR_LINE_KM 안의 '휴게소 밖 급속' 충전기만 저장한다.

    py tools/fetch_near_highway.py 저장할파일.json

- tools/ic_nearby.py --chargers 에 넣을 파일을 만든다(전국 원본은 수십만 건이라 그대로 두지 않는다).
- 키는 환경변수 EV_CHARGER_API_KEY. 없으면 윈도우 사용자 환경변수(레지스트리)에서 읽는다. 키는 찍지 않는다.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.parse
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import charger_api as ca  # noqa: E402

NEAR_LINE_KM = 6.0   # 나들목은 선에서 2km 안, 충전소는 나들목에서 3km 안 → 넉넉히 6km
ROWS = 5000          # 한 번에 받는 건수(9999 는 큰 지역에서 서버 시간 초과가 잦다)
FIELDS = ["statNm", "statId", "chgerId", "chgerType", "lat", "lng", "stat", "output", "busiNm", "bnm", "kindDetail", "delYn", "addr", "limitYn", "limitDetail", "useTime", "floorNum", "floorType", "location", "note", "kind", "parkingFree", "lastTedt"]


def key_from_env():
    key = os.environ.get(ca.KEY_ENV, "").strip()
    if key or os.name != "nt":
        return key
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as k:
            return str(winreg.QueryValueEx(k, ca.KEY_ENV)[0]).strip()
    except OSError:
        return ""


def near_any_line(pt, boxes):
    """선의 테두리 상자로 먼저 거르고, 걸리면 실제 거리로 본다."""
    for hk, (la0, la1, lo0, lo1) in boxes.items():
        if la0 <= pt[0] <= la1 and lo0 <= pt[1] <= lo1:
            if ca.project(pt, ca.HIGHWAYS[hk]["points"])[1] <= NEAR_LINE_KM:
                return True
    return False


def keep(it, boxes):
    if ca.is_rest_area(it) or str(it.get("delYn", "N")).upper() == "Y":
        return False
    if ca.charger_of(it)["type"] != "fast":
        return False
    try:
        pt = (float(it["lat"]), float(it["lng"]))
    except (KeyError, TypeError, ValueError):
        return False
    return near_any_line(pt, boxes)


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) != 1:
        print(__doc__)
        return 2
    key = key_from_env()
    if not key:
        print(f"환경변수 {ca.KEY_ENV} 가 없다.")
        return 2
    pad = NEAR_LINE_KM / 100.0  # 위도 1도 ≈ 111km, 경도 1도 ≈ 88km → 0.06도면 넉넉
    boxes = {}
    for hk, hw in ca.HIGHWAYS.items():
        las = [p[0] for p in hw["points"]]
        los = [p[1] for p in hw["points"]]
        boxes[hk] = (min(las) - pad, max(las) + pad, min(los) - pad * 1.3, max(los) + pad * 1.3)
    k = key if "%" in key else urllib.parse.quote(key, safe="")
    out = Path(argv[0])
    parts = out.with_name(out.name + ".parts")  # 지역마다 받은 것을 저장해 두고, 실패하면 다음에 그 지역부터 이어 받는다
    parts.mkdir(parents=True, exist_ok=True)
    kept, seen, started = [], 0, int(time.time() * 1000)
    for z in ca.ZCODES:
        pf = parts / f"{z}.json"
        if pf.exists():
            saved = json.loads(pf.read_text(encoding="utf-8"))
            kept += saved["kept"]
            seen += saved["got"]
            started = min(started, saved["at"])
            print(f"  지역 {z}: 받아 둔 것 사용 {saved['got']}건", flush=True)
            continue
        page, got, mine, at = 1, 0, [], int(time.time() * 1000)
        while True:
            q = urllib.parse.urlencode({"pageNo": page, "numOfRows": ROWS, "zcode": z, "dataType": "JSON"})
            part, total = ca.parse_page(ca._get(f"{ca.ENDPOINT}?serviceKey={k}&{q}", f"지역 {z}, {page}쪽", tries=6, wait=10.0))
            got += len(part)
            mine += [{f: it.get(f) for f in FIELDS} for it in part if keep(it, boxes)]
            if not part or got >= total:
                break
            page += 1
            time.sleep(0.3)
        pf.write_text(json.dumps({"at": at, "got": got, "kept": mine}, ensure_ascii=False), encoding="utf-8")
        kept += mine
        seen += got
        started = min(started, at)
        print(f"  지역 {z}: {got}건 (누적 {seen}, 남긴 것 {len(kept)})", flush=True)
    # 상태 시각은 가장 먼저 받은 지역 기준(가장 오래된 쪽으로 잡는다)
    out.write_text(json.dumps({"fetched_ms": started, "items": {"item": kept}}, ensure_ascii=False), encoding="utf-8")
    print(f"전국 {seen}건 중 고속도로 {NEAR_LINE_KM:g}km 안 휴게소 밖 급속 {len(kept)}건 → {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
