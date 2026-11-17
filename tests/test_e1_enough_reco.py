# -*- coding: utf-8 -*-
"""e1_enough — 추천 칸의 안심 안내(plan.md 4.1 E1~E6).

표 T(32줄, 사례 24개)를 이 파일의 표로 두고 test_e1_enough_reco.js 에 넘겨 가짜 화면(잠긴 test_integration_dom.js)으로
실제 web/ 을 띄운다. JS 는 본 것만 내고 기대값은 여기(표 T·3.2·3.3절 글)에만 있다. node 는 한 번만 돈다.
칸 기호: P 1순위 · B 예비 · RB 빨간 "예비 없음" · RN 빨간 "충전소 없음" · C 차분한 칸(plan.md 3.2절).
web/app.js 의 글자(함수·변수 이름)는 보지 않는다(plan.md 3.5 C1). 화면에서 본 값만 본다.
"""
import json
import re

import pytest

from test_p0_node import HERE, run_node

P = HERE.parent
C_HEAD = "목적지까지 충전 없이 갈 수 있어요"
C_TAIL = " 1순위는 들르고 싶을 때 참고하세요."
C_STYLE = "background: var(--good-soft); color: var(--good)"
RB = ["예비 충전소가 없습니다", "1순위에서 충전하지 못하면 갈 수 있는 다음 충전소가 없습니다. 1순위에서 꼭 충전하세요."]
RN = ["안전하게 갈 수 있는 충전소가 없습니다",
      "지금 잔량으로 닿는 곳에 빈 급속 충전기가 없습니다. 가까운 나들목으로 나가 충전소를 찾거나, 속도를 줄여 전비를 높이세요."]
RANGE = "안전하게 갈 수 있는 거리 약 %dkm (여유 %d%%, 도착 때 15%% 남김)"


def NAVI(**o):
    return dict({"routeKey": "navi", "soc": 80, "pos": 0}, **o)


def HW(**o):
    return dict({"routeKey": "live-gb-down", "soc": 80, "pos": 0}, **o)


def step(sel, value):
    return {"sel": sel, "value": value, "type": "input"}


# 사례(plan.md 4.1 표 T 의 자료·길이·저장값·걸음): id, 자료, 길이(None = 받아 둔 길 없음), 저장값, 목적지, 걸음
CASES = [
    ("T1", "one", 60, NAVI(), None, []),
    ("T2", "one", 60, NAVI(pos=10), None, []),
    ("T3", "one", 60, NAVI(), None, [step("#pos", "30"), step("#pos", "30.4"), step("#pos", "30.6")]),
    ("T4", "one", 60, NAVI(soc=50), None, []),
    ("T5", "one", 175, NAVI(), None, []),
    ("T6", "one", 195, NAVI(margin=0), None, []),
    ("T7", "one", 60, NAVI(), "<b>횡성</b>", []),
    ("T8", "one", 60, NAVI(pos=50), None, []),
    ("T9", "broken", 60, NAVI(), None, []),
    ("T10", "one", 60, NAVI(pos=60), None, []),
    ("T11", "one", 300, NAVI(), None, []),
    ("T12", "one", 176, NAVI(), None, []),
    ("T13", "one", 196, NAVI(margin=0), None, []),
    ("T14", "one", None, HW(), None, []),
    ("T15", "one", 60, HW(), None, []),
    ("T16", "one", 300, NAVI(pos=50), None, []),
    ("T17", "one", None, HW(pos=50), None, []),
    ("T18", "one", 60, NAVI(soc=10, pos=60), None, []),
    ("T19", "two", 60, NAVI(), None, []),
    ("T20", "two", 300, NAVI(), None, []),
    ("T21", "one", 60, NAVI(soc=20), None, [step("#soc", "80")]),
    ("T22", "one", 60, NAVI(height=2.5), None, []),
    ("T23", "one", 176, NAVI(), None, [step("#pos", "0.4"), step("#pos", "0.6")]),
    ("T24", "one", 196, NAVI(margin=0), None, [step("#pos", "0.6"), step("#pos", "1")]),
]
CASE_IDS = [c[0] for c in CASES]

# 표 T 의 본 것: 줄 id(사례-걸음), 칸, N(None = C 칸 없음), M
T = [
    ("T1-0", "P C", 60, 176), ("T2-0", "P C", 50, 176), ("T3-0", "P C", 60, 176), ("T3-1", "C", 30, 176),
    ("T3-2", "C", 30, 176), ("T3-3", "C", 29, 176), ("T4-0", "P C", 60, 95), ("T5-0", "P C", 175, 176),
    ("T6-0", "P C", 195, 195), ("T7-0", "P C", 60, 176), ("T8-0", "C", 10, 176), ("T9-0", "C", 60, 176),
    ("T10-0", "C", 0, 176), ("T11-0", "P RB", None, 176), ("T12-0", "P RB", None, 176), ("T13-0", "P RB", None, 195),
    ("T14-0", "P RB", None, 176), ("T15-0", "P RB", None, 176), ("T16-0", "RN", None, 176), ("T17-0", "RN", None, 176),
    ("T18-0", "RN", None, 0), ("T19-0", "P B", None, 176), ("T20-0", "P B", None, 176), ("T21-0", "RN", None, 14),
    ("T21-1", "P C", 60, 176), ("T22-0", "P C", 60, 176),
    # 경계(판정 보완): 남은 거리 176·175.6·175.4 / 196·195.4·195, 안전 거리 175.5 / 195 — 반올림 전 값끼리 견준다
    ("T23-0", "P RB", None, 176), ("T23-1", "P RB", None, 176), ("T23-2", "P C", 175, 176),
    ("T24-0", "P RB", None, 195), ("T24-1", "P RB", None, 195), ("T24-2", "P C", 195, 195),
]
T_IDS = [r[0] for r in T]

# 3.3절: #range-line 글 전체
RANGE_FULL = {
    "T1-0": RANGE % (176, 10), "T4-0": RANGE % (95, 10), "T6-0": RANGE % (195, 0), "T18-0": RANGE % (0, 10),
    "T21-0": RANGE % (14, 10),
    "T22-0": RANGE % (176, 10) + " · 차 높이 2.5m: 건물 안·지하 충전소 0곳 숨김",
}
# E1: P 칸의 셋째 글(1순위까지 거리)
P_THIRD = {"T1-0": "26.1km", "T2-0": "16.1km"}


@pytest.fixture(scope="module")
def seen():
    """사례 24개를 node 한 번으로 돌려 {id: [본 것…]} 을 준다(겹친 id 는 목록으로 남겨 실패시킨다)."""
    cases = [{"id": i, "data": d, "len": n, "state": st, "dest": dest, "steps": steps}
             for i, d, n, st, dest, steps in CASES]
    code, out, err = run_node([HERE / "test_e1_enough_reco.js", json.dumps(cases, ensure_ascii=False)], cwd=P)
    lines = [ln for ln in out.splitlines() if ln.startswith("RESULT ")]
    assert code == 0 and lines, "node 가 결과를 내지 못함(exit %d)\n%s\n%s" % (code, out[-1000:], err[-2000:])
    got = {}
    for r in json.loads(lines[-1][len("RESULT "):]):
        got.setdefault(r["id"], []).append(r)
    return got


def one(seen, cid):
    rows = seen.get(cid, [])
    assert len(rows) == 1, (cid, rows)
    r = rows[0]
    assert "crash" not in r, r.get("crash")
    return r


def snap(seen, rid):
    cid, k = rid.split("-")
    shots = one(seen, cid).get("shots") or []
    assert len(shots) > int(k), (rid, len(shots))
    return shots[int(k)]


def c_text(n, m, tail):
    return "남은 거리 약 %d km · 안전하게 갈 수 있는 거리 약 %d km." % (n, m) + (C_TAIL if tail else "")


def check_box(rid, kind, b, n, m, has_p):
    """3.2절 표의 칸 하나. P·B 는 class·data-role·앞 두 글, RB·RN·C 는 자식 태그·글 전부."""
    if kind in ("P", "B"):
        assert b["cls"] == "pick" and b["role"] == ("primary" if kind == "P" else "backup"), (rid, b)
        first = "1순위 충전소" if kind == "P" else "예비 (1순위가 안 되면)"
        name = "기흥휴게소" if kind == "P" else "안성휴게소"
        assert b["texts"][:2] == [first, name], (rid, b["texts"])
    else:
        assert b["cls"] == "none" and b["role"] is None, (rid, b)
        assert b["tags"] == ["B", "SPAN"], (rid, b["tags"])
        want = {"RB": RB, "RN": RN, "C": [C_HEAD, c_text(n, m, has_p) if n is not None else None]}[kind]
        assert b["texts"] == want, (rid, b["texts"])
    if kind == "C":
        assert b["tone"] == "good" and b["style"] == C_STYLE, (rid, b["tone"], b["style"])  # E4
    else:
        assert b["tone"] is None and b["style"] is None, (rid, b["tone"], b["style"])  # E3


@pytest.mark.parametrize("row", T, ids=T_IDS)
def test_row(seen, row):
    """E1·E2·E3·E4: 묶음의 자식 수·차례·칸마다의 값이 표 T 와 3.2절 표와 같다. E5: #range-line 의 '약 ' 뒤 숫자가 M."""
    rid, kinds, n, m = row
    s = snap(seen, rid)
    assert s["recoCount"] == 1 and s["recoCls"] == "reco", (rid, s["recoCount"], s["recoCls"])  # 3.2절 첫 줄
    want = kinds.split()
    boxes = s["boxes"]
    assert [b["cls"] for b in boxes] and len(boxes) == len(want), (rid, want, boxes)
    for kind, b in zip(want, boxes):
        check_box(rid, kind, b, n, m, "P" in want)
    texts = [t for b in boxes for t in b["texts"]] + [s["range"]]
    if "C" in want:
        assert n is not None and want[-1] == "C"
        assert not any("예비 충전소가 없습니다" in t or "안전하게 갈 수 있는 충전소가 없습니다" in t for t in texts), (rid, texts)
        assert ("거리 약 %d km" % m) in boxes[-1]["texts"][1], (rid, boxes[-1]["texts"])
    else:
        assert n is None
        assert not any("충전 없이" in t for t in texts), (rid, texts)
    got_m = re.findall(r"약 (\d+)", s["range"])
    assert got_m[:1] == [str(m)], (rid, s["range"])
    if rid in P_THIRD:
        assert boxes[0]["texts"][2] == P_THIRD[rid], (rid, boxes[0]["texts"])


@pytest.mark.parametrize("rid", sorted(RANGE_FULL), ids=sorted(RANGE_FULL))
def test_range_line_full(seen, rid):
    """E5: 3.3절 표의 #range-line 글 전체(고치기 전과 글자까지 같다 — T22 는 뒤쪽 차 높이 글까지)."""
    assert snap(seen, rid)["range"] == RANGE_FULL[rid]


def test_c_box_ignores_dest(seen):
    """E4: 목적지 글이 '<b>횡성</b>' 인 T7-0 의 C 칸 두 글이 T1-0 과 글자까지 같다(목적지 이름이 글에 안 들어간다, K8)."""
    a, b = snap(seen, "T1-0")["boxes"], snap(seen, "T7-0")["boxes"]
    assert len(a) == len(b) == 2 and a[1]["texts"] == b[1]["texts"] == [C_HEAD, c_text(60, 176, True)], (a, b)
    assert not any("횡성" in t or "<b>" in t for t in b[1]["texts"]), b


def test_p_box_same_with_or_without_c(seen):
    """P 칸은 C 칸이 붙어도 그대로다(plan.md 2.0 6번): 같은 길·위치·잔량에서 길이만 다른 T1-0(P C)·T11-0·T12-0(P RB)의
    P 칸이 통째로 같다. T12 는 고치기 전 코드와 같은 값이다(plan.md 4.1 표 아래 202행)."""
    p = [snap(seen, rid)["boxes"][0] for rid in ("T1-0", "T11-0", "T12-0")]
    assert p[0] == p[1] == p[2], p


@pytest.mark.parametrize("case", CASES, ids=CASE_IDS)
def test_case_clean(seen, case):
    """E6: 띄운 직후 loadErrors·끝난 뒤 errors 가 빈 목록, fetch 부른 주소 0개, 저장된 routeKey 가 사례 값 그대로,
    스냅숏 수가 걸음 수 + 1(근거: plan.md 3.4 의 shots 약속)."""
    cid, _, _, st, _, steps = case
    r = one(seen, cid)
    assert r["loadErrors"] == [], (cid, r["loadErrors"])
    assert r["errors"] == [], (cid, r["errors"])
    assert r["calls"] == [], (cid, r["calls"])
    assert r["route"] == st["routeKey"], (cid, r["route"])
    assert len(r["shots"]) == len(steps) + 1, (cid, len(r["shots"]))


def test_cases_cover_table(seen):
    """E6: 사례 24개가 정확히 하나씩 결과를 낸다(빠진 사례·겹친 사례 없음). 표 T 32줄이 사례마다 걸음 0..끝을 빠짐없이 덮는다."""
    assert len(CASE_IDS) == len(set(CASE_IDS)) == 24 and CASE_IDS == ["T%d" % i for i in range(1, 25)]
    assert len(T_IDS) == len(set(T_IDS)) == 32
    assert sorted(seen) == sorted(CASE_IDS) and all(len(v) == 1 for v in seen.values()), sorted(seen)
    for cid, _, _, _, _, steps in CASES:
        assert [r for r in T_IDS if r.split("-")[0] == cid] == ["%s-%d" % (cid, k) for k in range(len(steps) + 1)], cid
