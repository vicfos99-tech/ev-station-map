# -*- coding: utf-8 -*-
"""integration(plan.md 4.2 I1·I2). 기대값(표 F·3.2절 글)은 여기, 본 것은 e1 도우미가 낸다."""
import hashlib
import json
import re
import shutil

import pytest

from test_p0_node import HERE, run_node

P = HERE.parent
HEAD = "목적지까지 충전 없이 갈 수 있어요"
RB = ["예비 충전소가 없습니다", "1순위에서 충전하지 못하면 갈 수 있는 다음 충전소가 없습니다. 1순위에서 꼭 충전하세요."]
RN = ["안전하게 갈 수 있는 충전소가 없습니다",
      "지금 잔량으로 닿는 곳에 빈 급속 충전기가 없습니다. 가까운 나들목으로 나가 충전소를 찾거나, 속도를 줄여 전비를 높이세요."]
GOOD = ("good", "background: var(--good-soft); color: var(--good)")
R, S = "#route-select", "#soc"
STEPS = [(R, "navi", "change"), ("#pos", "30", "input"), (S, "20", "input"), (S, "80", "input"),
         (R, "live-gb-down", "change")]
# 표 F: 칸, N, M, 꼬리 문장
F = [("P RB", 0, 176, 0), ("P C", 60, 176, 1), ("C", 30, 176, 0), ("RN", 0, 14, 0), ("C", 30, 176, 0),
     ("P RB", 0, 176, 0)]


@pytest.fixture(scope="module")
def f1():
    c = {"id": "F1", "data": "one", "len": 60, "state": {"routeKey": "live-gb-down", "soc": 80, "pos": 0},
         "steps": [{"sel": s, "value": v, "type": t} for s, v, t in STEPS]}
    code, out, err = run_node([HERE / "test_e1_enough_reco.js", json.dumps([c])], cwd=P)
    rows = [json.loads(x[7:]) for x in out.splitlines() if x.startswith("RESULT ")]
    assert code == 0 and rows and len(rows[-1]) == 1, err[-999:]
    return rows[-1][0]


def test_f1_clean(f1):
    assert f1.get("loadErrors") == f1.get("errors") == [], f1
    assert (f1["route"], len(f1["shots"])) == ("live-gb-down", 6)


@pytest.mark.parametrize("k", range(6), ids=["F1-%d" % k for k in range(6)])
def test_f1_row(f1, k):
    kinds, n, m, tail = F[k]
    s = f1["shots"][k]
    bx = s["boxes"]
    assert len(bx) == len(kinds.split()), bx
    for kind, b in zip(kinds.split(), bx):
        if kind == "P":
            assert (b["cls"], b["role"], b["texts"][1]) == ("pick", "primary", "기흥휴게소"), b
        else:
            c = "남은 거리 약 %d km · 안전하게 갈 수 있는 거리 약 %d km." % (n, m) + tail * " 1순위는 들르고 싶을 때 참고하세요."
            want = {"RB": RB, "RN": RN, "C": [HEAD, c]}[kind]
            assert (b["cls"], b["role"], b["tags"], b["texts"]) == ("none", None, ["B", "SPAN"], want), b
        assert (b["tone"], b["style"]) == (GOOD if kind == "C" else (None, None)), b
    if "C" not in kinds:
        assert "충전 없이" not in json.dumps(s, ensure_ascii=False), s
    assert re.findall(r"약 (\d+)", s["range"])[:1] == [str(m)], s["range"]


def _h(d):
    return {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(d.iterdir())}


def test_build(tmp_path):
    """I2(plan.md 4.2)."""
    before = _h(P / "web/dist")
    w = tmp_path / "web"
    shutil.copytree(P / "web", w, ignore=shutil.ignore_patterns("dist", "test"))
    code, _, err = run_node([w / "build.js"], cwd=tmp_path)
    assert code == 0, err[-999:]
    assert (w / "dist/index.html").read_text("utf-8").count(HEAD) == 1
    assert _h(P / "web/dist") == before
