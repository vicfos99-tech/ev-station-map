# -*- coding: utf-8 -*-
"""g1_rawbase 기본 중계 주소 시험 (plan.md 4.1 G1~G6, 3.1, 2.2 K1~K7).

- 사례의 입력과 기대값은 이 파일의 표 A~F 에 있다(plan.md 139~231행을 글자 그대로 옮김).
  표를 JSON 으로 tmp 폴더에 써서 test_g1_rawbase_base.js 에 넘기고, JS 는 web/relay.js 를 불러
  받은 값을 기대값과 견주기만 한다(잠긴 test_p0_node.run_js · test_p0_fake.js 의 eq·makeFetch).
- JS 확인 하나를 pytest 테스트 하나로 보이고, 이름 집합도 견준다(조용히 빠진 확인·겹친 이름을 잡는다).
- G1 의 글자 조건(3.1)은 파이썬이 web/relay.js 를 UTF-8 로 직접 읽어 센다.
- 건너뛰기(skip)는 쓰지 않는다. 구현 전에는 실패하는 것이 정상이다.
"""
import functools
import json
import tempfile
from pathlib import Path

import pytest

from test_p0_node import run_js

ROOT = Path(__file__).resolve().parent.parent
RELAY_JS = ROOT / "web" / "relay.js"

RAW = "https://raw.githubusercontent.com/vicfos99-tech/ev-station-map/relay-data/"
HOST = "vicfos99-tech.github.io"
OLD_SHAPE = "vicfos99-tech.github.io/ev-station-map/relay/"
SITE = "https://vicfos99-tech.github.io/ev-station-map/"
APP = "https://localhost/"
MY = "https://b.example/r/"
NOW = 1767571920000


def S(text):
    return ["s", text]


# 표 A — 우리 사이트 → RAW (G2). 대문자·쿼리·#·경로 없음·다른 경로·http·포트(:443 은 기본 포트, :8443)·사용자 이름
TABLE_A = [
    ("A1", "https://vicfos99-tech.github.io/ev-station-map/"),
    ("A2", "HTTPS://VICFOS99-TECH.GITHUB.IO/ev-station-map/index.html?x=1"),
    ("A3", "https://vicfos99-tech.github.io/ev-station-map/index.html?x=1#h"),
    ("A4", "https://Vicfos99-Tech.GitHub.io/"),
    ("A5", "https://vicfos99-tech.github.io"),
    ("A6", "https://vicfos99-tech.github.io/other/deep/page.html"),
    ("A7", "http://vicfos99-tech.github.io/ev-station-map/"),
    ("A8", "https://vicfos99-tech.github.io:443/ev-station-map/"),
    ("A9", "https://vicfos99-tech.github.io:8443/ev-station-map/"),
    ("A10", "https://user@vicfos99-tech.github.io/ev-station-map/"),
]

# 표 B — 폰 앱 화면 https://localhost/ → RAW (G3, 2.1 N1, K5)
TABLE_B = [
    ("B1", "https://localhost/"),
    ("B2", "https://localhost/index.html?x=1#h"),
    ("B3", "HTTPS://LOCALHOST/"),
    ("B4", "https://localhost"),
    ("B5", "https://localhost:443/"),
]

# 표 C — 그 밖의 http(s) → 페이지 기준 ./relay/ (G4). 잡는 틀린 구현은 plan.md 190행
TABLE_C = [
    ("C1", "https://a.example/x/", "https://a.example/x/relay/"),
    ("C2", "http://localhost:8000/web/index.html", "http://localhost:8000/web/relay/"),
    ("C3", "http://localhost/", "http://localhost/relay/"),
    ("C4", "http://localhost/web/index.html", "http://localhost/web/relay/"),
    ("C5", "https://localhost:8443/web/index.html", "https://localhost:8443/web/relay/"),
    ("C6", "https://localhost.evil.example/", "https://localhost.evil.example/relay/"),
    ("C7", "https://xlocalhost/", "https://xlocalhost/relay/"),
    ("C8", "https://127.0.0.1/", "https://127.0.0.1/relay/"),
    ("C9", "https://vicfos99-tech.github.io.evil.example/", "https://vicfos99-tech.github.io.evil.example/relay/"),
    ("C10", "https://evil-vicfos99-tech.github.io/", "https://evil-vicfos99-tech.github.io/relay/"),
    ("C11", "https://xvicfos99-tech.github.io/", "https://xvicfos99-tech.github.io/relay/"),
    ("C12", "https://a.vicfos99-tech.github.io/", "https://a.vicfos99-tech.github.io/relay/"),
    ("C13", "https://vicfos99-tech.github.io./", "https://vicfos99-tech.github.io./relay/"),
    ("C14", "https://vicfos99-techxgithub.io/", "https://vicfos99-techxgithub.io/relay/"),
    ("C15", "https://vicfos99-tech.githubxio/", "https://vicfos99-tech.githubxio/relay/"),
    ("C16", "https://vicfos99-tech.github.io@evil.example/", "https://vicfos99-tech.github.io@evil.example/relay/"),
    ("C17", "https://evil.example/vicfos99-tech.github.io/", "https://evil.example/vicfos99-tech.github.io/relay/"),
    ("C18", "https://evil.example/?h=vicfos99-tech.github.io", "https://evil.example/relay/"),
    ("C19", "https://evil.example/#vicfos99-tech.github.io", "https://evil.example/relay/"),
    ("C20", "https://github.io/", "https://github.io/relay/"),
    ("C21", RAW, RAW + "relay/"),
]

# 표 D — http(s) 가 아니거나 풀 수 없음 → RAW, 던지지 않음 (G5, C1, K6)
TABLE_D = [
    ("D1", S("file:///android_asset/index.html")),
    ("D2", S("capacitor://localhost/")),
    ("D3", S("https://")),
    ("D4", S("http://")),
    ("D5", S("https://vicfos99-tech.github.io:99999/")),
    ("D6", S("https://localhost:99999/")),
    ("D7", S(" https://vicfos99-tech.github.io/")),
    ("D8", S("ftp://vicfos99-tech.github.io/")),
    ("D9", S("")),
    ("D10", ["null"]),
    ("D11", ["undefined"]),
    ("D12", ["num", 3]),
    ("D13", ["obj"]),
]

# K6 ① 보강(표 D 밖, plan.md 75행): "http(s):// 로 시작"은 글 맨 앞부터다. 표 D7 은 호스트가 우리 사이트라
# 앞머리 검사를 빼도 RAW 가 나와(plan.md 204행 '동치') 가르지 못하므로, 그 밖 호스트로 같은 꼴을 둔다.
TABLE_K6 = [
    ("K6a", S(" https://a.example/x/")),
    ("K6b", S("xhttps://a.example/x/")),
]

# 표 C 밖 보강(판정 고칠 점): 그 밖 호스트라 기대값은 페이지 기준 주소. ① K6 스킴 대소문자 무관
# (스킴·호스트만 소문자, 경로 /X/ 는 그대로) ② G4 포트 있는 https localhost 는 앱 화면이 아님.
TABLE_G4X = [
    ("K6c", "HTTPS://A.EXAMPLE/X/", "https://a.example/X/relay/"),
    ("C5b", "https://localhost:3000/", "https://localhost:3000/relay/"),
]

# 표 E — baseOf(settings, href) (G6). 설정 주소가 기본값보다 먼저
TABLE_E = [
    ("E1", {"on": True, "base": MY}, SITE, MY),
    ("E2", {"on": True, "base": MY}, APP, MY),
    ("E3", {"on": True, "base": MY}, "file:///x", MY),
    ("E4", {"on": True, "base": MY}, "https://a.example/x/", MY),
    ("E5", {"on": True, "base": ""}, SITE, RAW),
    ("E6", {"on": True, "base": ""}, APP, RAW),
    ("E7", {"on": True, "base": ""}, "https://a.example/x/", "https://a.example/x/relay/"),
    ("E8", None, SITE, RAW),
    ("E9", {"base": 5}, APP, RAW),
]

MISSING = object()  # F8: settings 열쇠를 아예 넣지 않음

# 표 F — refreshRest 가 부른 주소(전부, 한 개) (G6). 가짜 fetch 는 모두 404 → relay_failed 로 끝남
TABLE_F = [
    ("F1", {"on": True, "base": ""}, SITE, RAW + "meta.json"),
    ("F2", {"on": True, "base": ""}, "HTTPS://VICFOS99-TECH.GITHUB.IO/ev-station-map/index.html?x=1", RAW + "meta.json"),
    ("F3", {"on": True, "base": ""}, APP, RAW + "meta.json"),
    ("F4", {"on": True, "base": ""}, "http://localhost:8000/web/index.html", "http://localhost:8000/web/relay/meta.json"),
    ("F5", {"on": True, "base": ""}, "https://vicfos99-tech.github.io.evil.example/",
     "https://vicfos99-tech.github.io.evil.example/relay/meta.json"),
    ("F6", {"on": True, "base": MY}, SITE, "https://b.example/r/meta.json"),
    ("F7", {"on": True, "base": MY}, APP, "https://b.example/r/meta.json"),
    ("F8", MISSING, SITE, RAW + "meta.json"),
]


def _cases():
    return {
        "raw": RAW,
        "now": NOW,
        "base": [{"name": "G2 " + i, "href": S(h), "want": RAW} for i, h in TABLE_A]
        + [{"name": "G3 " + i, "href": S(h), "want": RAW} for i, h in TABLE_B]
        + [{"name": "G4 " + i, "href": S(h), "want": w} for i, h, w in TABLE_C]
        + [{"name": "G4 " + i, "href": S(h), "want": w} for i, h, w in TABLE_G4X]
        + [{"name": "G5 " + i, "href": x, "want": RAW} for i, x in TABLE_D]
        + [{"name": "G5 " + i, "href": x, "want": RAW} for i, x in TABLE_K6],
        "baseOf": [{"name": "G6 " + i, "settings": s, "href": h, "want": w} for i, s, h, w in TABLE_E],
        "rest": [
            {"name": "G6 " + i, "has_settings": s is not MISSING, "settings": None if s is MISSING else s,
             "href": h, "want_calls": [w]}
            for i, s, h, w in TABLE_F
        ],
    }


JS_NAMES = (
    ["G1 ANDROID_BASE"]
    + [c["name"] for k in ("base", "baseOf") for c in _cases()[k]]
    + [c["name"] + s for c in _cases()["rest"] for s in (" 부른 주소", " 끝난 코드")]
)


@functools.lru_cache(maxsize=None)
def _results():
    d = tempfile.mkdtemp(prefix="g1_rawbase_")
    p = Path(d) / "cases.json"
    p.write_text(json.dumps(_cases(), ensure_ascii=False), encoding="utf-8")
    return run_js("test_g1_rawbase_base.js", [p])


def test_table_sizes():
    """plan.md 4.1 의 표 줄 수 그대로(A10·B5·C21·D13·E9·F8). 표를 조용히 줄이는 것을 막는다."""
    assert [len(t) for t in (TABLE_A, TABLE_B, TABLE_C, TABLE_D, TABLE_E, TABLE_F)] == [10, 5, 21, 13, 9, 8]
    assert len(TABLE_K6) == 2
    assert len(TABLE_G4X) == 2
    assert len(JS_NAMES) == len(set(JS_NAMES)) == 1 + 10 + 5 + 21 + 13 + 2 + 9 + 8 * 2 + 2


@pytest.mark.parametrize("name", JS_NAMES)
def test_js_check(name):
    res = _results()
    assert name in res, "JS 가 이 확인을 내지 않음: %s" % name
    assert res[name]["ok"], "%s: %s" % (name, res[name]["detail"])


def test_js_names_match():
    """JS 가 낸 확인 이름 집합 == 파이썬이 아는 이름 집합(잡히지 않은 오류·겹친 이름도 여기서 걸린다)."""
    assert set(_results()) == set(JS_NAMES)


def _text():
    return RELAY_JS.read_text(encoding="utf-8")


def test_g1_host_exactly_once():
    """G1·3.1: web/relay.js 글 전체(주석 포함)에 사이트 호스트 이름이 정확히 1번."""
    assert _text().count(HOST) == 1


def test_g1_host_once_is_old_relay_shape():
    """G1·3.1: 그 1번이 vicfos99-tech.github.io/ev-station-map/relay/ 꼴(잠긴 test_build 가 빌드 글에서 찾는다)."""
    assert _text().count(OLD_SHAPE) == 1
