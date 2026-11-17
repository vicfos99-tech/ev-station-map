# -*- coding: utf-8 -*-
"""integration — 화면 흐름과 빌드(plan.md 4.2 I1·I2).

I1: 표 S 10줄을 이 파일의 표로 두고 test_integration_rawbase.js 에 넘겨 가짜 화면(잠긴 test_integration_dom.js)으로
    실제 web/ 을 띄워 '새로 받기'를 누른다. JS 는 본 것만 내고 기대값은 여기(표 S)에만 있다.
I2: tmp_path 에 복사한 web/(dist·test 빼고)에서 build.js 를 돌려 dist/index.html 에 RAW 가 드는지, 저장소 web/dist/ 가 그대로인지 본다.
    "전체 테스트 명령이 실패 0"은 여기서 다시 돌리지 않는다(plan.md 262행 — 지휘 스크립트·검증이 돌린다).
"""
import json
import shutil

import pytest

from test_p0_node import HERE, run_node

P = HERE.parent
W = P / "web"
RAW = "https://raw.githubusercontent.com/vicfos99-tech/ev-station-map/relay-data/"
SITE = "https://vicfos99-tech.github.io/ev-station-map/"
APP = "https://localhost/"
MY = "https://b.example/r/"
KEY = "ev-charge-planner/"
OK = "중계에서 받았어요 09:12 · 휴게소 충전기 3대"
OFF = "인증키를 넣고 '새로 받기'를 누르세요. 공공데이터포털 마이페이지의 일반 인증키입니다."
TAIL = ["meta.json", "routes.json", "status/rest/KP000101.json"]

# 표 S (plan.md 249~260행): id, href(None = 안 줌 → 가짜 화면 기본값 file:///android_asset/index.html), 저장값, 중계 머리(None = 부른 주소 없음), #live-msg
S = [
    ("S1", SITE, {}, RAW, OK),
    ("S2", "HTTPS://VICFOS99-TECH.GITHUB.IO/ev-station-map/index.html?x=1", {}, RAW, OK),
    ("S3", APP, {}, RAW, OK),
    ("S4", None, {}, RAW, OK),
    ("S5", "http://localhost:8000/web/index.html", {}, "http://localhost:8000/web/relay/", OK),
    ("S6", "https://a.example/x/", {}, "https://a.example/x/relay/", OK),
    ("S7", "https://vicfos99-tech.github.io.evil.example/", {}, "https://vicfos99-tech.github.io.evil.example/relay/", OK),
    ("S8", SITE, {KEY + "relay-base": MY}, MY, OK),
    ("S9", APP, {KEY + "relay-base": MY}, MY, OK),
    ("S10", SITE, {KEY + "relay": "off"}, None, OFF),
]
IDS = [r[0] for r in S]


@pytest.fixture(scope="module")
def seen():
    """표 S 의 모든 줄을 node 한 번으로 돌려 {id: 본 것} 을 준다(같은 id 가 두 번 오면 목록으로 남겨 실패시킨다)."""
    cases = [{"id": i, "href": h, "storage": st} for i, h, st, _, _ in S]
    code, out, err = run_node([HERE / "test_integration_rawbase.js", json.dumps(cases, ensure_ascii=False)], cwd=P)
    lines = [ln for ln in out.splitlines() if ln.startswith("RESULT ")]
    assert code == 0 and lines, "node 가 결과를 내지 못함(exit %d)\n%s\n%s" % (code, out[-1000:], err[-2000:])
    got = {}
    for r in json.loads(lines[-1][len("RESULT "):]):
        got.setdefault(r["id"], []).append(r)
    return got


def one(seen, i):
    rows = seen.get(i, [])
    assert len(rows) == 1, (i, rows)
    r = rows[0]
    assert "crash" not in r, r.get("crash")
    return r


@pytest.mark.parametrize("row", S, ids=IDS)
def test_flow(seen, row):
    """I1: 부른 주소가 표의 머리 + 세 꼬리(차례대로, 그 밖의 주소 없음), #live-msg 글, 띄울 때·누른 뒤 errors 가 빈 목록."""
    i, href, storage, head, msg = row
    r = one(seen, i)
    want = [] if head is None else [head + t for t in TAIL]
    assert r["calls"] == want, (i, r["calls"])
    assert r["msg"] == msg, (i, r["msg"])
    assert r["loadErrors"] == [], (i, r["loadErrors"])
    assert r["errors"] == [], (i, r["errors"])


def test_flow_covers_table(seen):
    """표 S 10줄이 모두 한 번씩 돌았다(빠진 줄·겹친 줄이 없다)."""
    assert sorted(seen) == sorted(IDS) and all(len(v) == 1 for v in seen.values()), sorted(seen)
    assert len(IDS) == len(set(IDS)) == 10


def test_flow_uses_real_web(seen):
    """가짜 화면에 web/index.html 의 스크립트 순서대로 실제 파일이 들어갔다(relay.js 가 app.js 앞, live.js 만 작은 것).
    근거: plan.md 238행. 이것이 없으면 '부른 주소 0개'가 relay.js 를 못 읽어서인지 가릴 수 없다."""
    names = one(seen, "S1")["scripts"]
    assert "relay.js" in names and "app.js" in names and "live.js" in names, names
    assert names.index("relay.js") < names.index("app.js"), names


def test_raw_vs_old_differ(seen):
    """우리 사이트(S1)·앱 화면(S3)·주소 안 줌(S4)이 부른 곳은 RAW 하나뿐이고 옛 중계 폴더·https://localhost/relay/ 가 아니다.
    고치기 전 코드는 S1·S4 가 옛 주소, S3 이 https://localhost/relay/ 를 부른다(plan.md 263행)."""
    for i in ("S1", "S2", "S3", "S4"):
        calls = one(seen, i)["calls"]
        assert calls and all(c.startswith(RAW) for c in calls), (i, calls)
        assert not any("/ev-station-map/relay/" in c or c.startswith(APP + "relay/") for c in calls), (i, calls)


def test_build(tmp_path):
    """I2: tmp_path 의 web/ 복사본(dist·test 빼고)에서 build.js → 종료 코드 0, dist/index.html 에 RAW, 저장소 web/dist/ 는 그대로."""
    dist = W / "dist"
    snap = lambda: {p.name: p.read_bytes() for p in dist.iterdir()} if dist.exists() else None
    before = snap()
    x = tmp_path / "web"
    shutil.copytree(W, x, ignore=shutil.ignore_patterns("dist", "test"))
    assert not (x / "dist").exists() and not (x / "test").exists()
    code, out, err = run_node([x / "build.js"], cwd=tmp_path)
    assert code == 0, (code, out[-1000:], err[-2000:])
    built = (x / "dist" / "index.html").read_text("utf-8")
    assert RAW in built
    assert snap() == before, "저장소의 web/dist/ 가 바뀜"


def test_build_raw_is_from_relay(tmp_path):
    """빌드한 앱의 RAW 는 web/relay.js 에서 온다: 복사본 relay.js 의 RAW 를 다른 주소로 바꾸면 빌드 결과에 RAW 가 없다(잘못된 입력 대조).
    근거: plan.md 3.1 — app.js·index.html 은 이 일이 고치지 않으므로 RAW 가 다른 곳에서 올 수 없어야 한다."""
    x = tmp_path / "web"
    shutil.copytree(W, x, ignore=shutil.ignore_patterns("dist", "test"))
    rel = x / "relay.js"
    src = rel.read_text("utf-8")
    assert RAW in src
    rel.write_text(src.replace(RAW, "https://other.example/relay-data/"), "utf-8")
    code, out, err = run_node([x / "build.js"], cwd=tmp_path)
    assert code == 0, (code, err[-2000:])
    built = (x / "dist" / "index.html").read_text("utf-8")
    assert RAW not in built and "https://other.example/relay-data/" in built
