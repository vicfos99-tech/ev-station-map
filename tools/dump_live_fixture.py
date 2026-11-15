"""파이썬 build_routes 의 기대값을 뽑아 JS 판(web/live_build.js)과 대조할 자료를 만든다.

    py tools/dump_live_fixture.py [받아 둔 원본.json]   → web/test/live_fixture.json

원본을 주면 그 안의 휴게소 충전기(실제 이름·좌표)를 쓰고, 없으면 이미 있는 fixture 의 항목을 다시 쓴다.
여기에 일부러 까다로운 가짜 항목(이름 변형, 방향 없음, 빈 좌표, 삭제, 공백 업체명 등)을 더한다.
"""
import json
import random
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import charger_api as ca  # noqa: E402

OUT = HERE.parent / "web" / "test" / "live_fixture.json"
FIELDS = ["statNm", "statId", "chgerId", "chgerType", "lat", "lng", "stat", "output", "busiNm", "bnm",
          "kindDetail", "delYn", "addr", "addrDetail", "location"]
FETCHED = 1_763_164_000_000


def tricky(rng):
    """실제 데이터에 드물게 나오는 모양을 일부러 만든다."""
    gb = ca.HIGHWAYS["gb"]["points"]
    yd = ca.HIGHWAYS["yd"]["points"]
    names = ["{}휴게소(부산)", "{}휴게소 (서울방향) (급)", "워터 {}휴게소 부산방향", "{}(서울) 휴게소",
             "{}휴게소 E-pit", "{}휴게소", "{}휴게소(하행)", "{}휴게소 서울방면", "(고속도로){}휴게소 강릉방향",
             "{}휴게소(인천)", "{}E-pit휴게소(부산)", "{}휴게소(부산·서울)"]
    bases = ["가람", "나래", "다솜", "라온", "마루", "바다", "사랑", "아라"]
    out = []
    for i in range(300):
        pts = gb if rng.random() < 0.6 else yd
        j = rng.randrange(len(pts) - 1)
        t = rng.random()
        lat = pts[j][0] + (pts[j + 1][0] - pts[j][0]) * t + rng.uniform(-0.03, 0.03)
        lng = pts[j][1] + (pts[j + 1][1] - pts[j][1]) * t + rng.uniform(-0.03, 0.03)
        it = {
            "statNm": rng.choice(names).format(rng.choice(bases)) + rng.choice(["", " ", "  "]),
            "statId": f"T{rng.randrange(60):03d}", "chgerId": f"{i:02d}",
            "chgerType": rng.choice(["01", "02", "04", "07", "08", "4", "2", "8", "", "99"]),
            "lat": rng.choice([f"{lat:.6f}", f"{lat:.6f}", "", "abc"]) if rng.random() < 0.1 else f"{lat:.6f}",
            "lng": rng.choice([f"{lng:.6f}", "", " ", "x"]) if rng.random() < 0.1 else f"{lng:.6f}",
            "stat": rng.choice(["1", "2", "2", "3", "4", "5", "9", "7", ""]),
            "output": rng.choice(["50", "100", "200", "350", "", "0", "7", "abc"]),
            "busiNm": rng.choice(["채비", "SK시그넷 ", "환경부", "", " 이지차저"]),
            "bnm": rng.choice(["채비", "", "한국전력"]),
            "kindDetail": rng.choice(["C001", "C001", "C002", "A001"]),
            "delYn": rng.choice(["N", "N", "N", "Y", "y", ""]),
            # 주소 속 고속도로 이름(노선 정하기), 다루지 않는 고속도로, 띄어 쓴 것, 없는 것
            "addr": rng.choice(["", "", None, "경기도 어딘가 경부고속도로 12", "중부내륙고속도로 3", "충북 서해안 고속도로",
                                "수도권제1순환고속도로 9", "서울양양고속도로", "영동고속도로 1 경부고속도로 2", "통영대전중부고속도로"]),
            "addrDetail": rng.choice(["", None, "중앙고속도로 상행"]),
        }
        out.append(it)
    return out


def main():
    if len(sys.argv) > 1:
        raw = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))["items"]["item"]
        real = [{k: it.get(k) for k in FIELDS} for it in raw if ca.is_rest_area(it)]
    else:
        real = [it for it in json.loads(OUT.read_text(encoding="utf-8"))["items"] if not str(it.get("statId", "")).startswith("T")]
    items = real + tricky(random.Random(20261115))
    routes, skipped = ca.build_routes(items, FETCHED)
    cases = {"main": {"routes": routes, "skipped": skipped}}
    # 업체별 요금이 있을 때도 같게
    t2 = dict(ca.TARIFFS, **{"채비": 300.0})
    r2, s2 = ca.build_routes(items, FETCHED, t2)
    cases["tariff"] = {"tariffs": t2, "routes": r2, "skipped": s2}
    # 파이썬 round 의 '딱 반이면 짝수로'를 JS 가 따라 하는지(실제 데이터엔 거의 안 나와서 따로)
    xs = [0.25, 0.35, 0.45, 2.5, 3.5, 12.25, 12.75, 0.15, 1.05, 2.675, 99.95, 383.5, 384.5, 7.0]
    rounds = [[x, nd, round(x, nd)] for x in xs for nd in (0, 1)]
    OUT.write_text(json.dumps({"fetched_ms": FETCHED, "config": ca.config(), "items": items, "cases": cases,
                               "rounds": rounds},
                              ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    n = sum(len(r["rest_areas"]) for r in routes)
    print(f"항목 {len(items)}개(실제 {len(real)} + 가짜 300) → 노선 {len(routes)}개, 휴게소 {n}곳 → {OUT}")


if __name__ == "__main__":
    main()
