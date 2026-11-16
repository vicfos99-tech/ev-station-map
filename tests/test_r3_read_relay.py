# -*- coding: utf-8 -*-
"""r3_read 읽기와 모양 검사 시험 (plan.md 5절 r3_read 287~323행, 3.2 글 표 129~133행, C3·C5·C6·C7, D3·D4·D7, N10).

- test_r3_read_relay.js 의 확인 하나를 pytest 테스트 하나로 보인다(C7). 이름 집합도 견준다.
- 표는 JS 쪽 배열 길이만큼 '이름 NN' 으로 나온다. 길이를 여기 적어 두어 JS 가 조용히 줄인 줄을 잡는다.
- 값 단언은 JS 안에만 둔다(r2_fresh 와 같은 방식). 견본은 ref/relay_sample/ 을 읽기만 한다(plan.md 21행).
- 기대값은 참조 구현(.orchestra/logs/ref_relay/relay.js)으로 검산했다(.orchestra/logs/tests_r3_read.md).
"""
import functools

import pytest

from test_p0_node import run_js

FUNCS = ("urlOf", "getJson", "parseMeta", "parseRoutes", "parseStations", "parseStatus", "parseRest")
PARSES = ("parseMeta", "parseRoutes", "parseStations", "parseStatus", "parseRest")
COUNTS = (
    ("urlOf 주소", 14), ("urlOf bad_id", 34), ("urlOf bad_kind", 13), ("urlOf bad_base", 14),
    ("parseMeta 거부", 20), ("parseMeta 통과", 10),
    ("parseRoutes 거부", 45), ("parseRoutes 통과", 45), ("parseRoutes 머리", 7),
    ("parseStations 거부", 28), ("parseStations 통과", 21),
    ("parseStatus 거부", 11), ("parseStatus 거부 통째", 4), ("parseStatus 통과", 12),
    ("parseRest 거부", 14), ("parseRest 거부 통째", 3), ("parseRest 통과", 14),
)
GET_CASES = (
    "404", "503", "304", "500", "403", "연결 실패", "SECRET html", "빈 글", "빈칸 글", "반쪽 JSON",
    "ok false status 없음", "답 null", "답 undefined", "status 글자 404", "status 소수",
    "ok false status 200", "ok false status 404", "text 던짐", "거절 Error", "거절 null", "거절 글자",
)


def _nums(prefix, n):
    return ["%s %02d" % (prefix, i) for i in range(1, n + 1)]


JS_NAMES = (
    ["내보냄 " + n for n in FUNCS]
    + [x for p, n in COUNTS for x in _nums(p, n)]
    + ["urlOf 순서 base 먼저", "urlOf 순서 kind 다음", "urlOf 누출 base", "urlOf 누출 id", "urlOf 누출 kind"]
    + ["parseMeta 견본", "parseMeta 견본 열쇠", "parseMeta 누출 없음"]
    + ["parseRoutes 견본 routes 글자", "parseRoutes 견본 열쇠", "parseRoutes 견본 머리",
       "parseRoutes 거부 null", "parseRoutes 거부 배열", "parseRoutes 모르는 칸 없음"]
    + ["parseStations 견본 41135", "parseStations 견본 41463 rest", "parseStations 거부 null", "parseStations 거부 배열"]
    + ["parseStatus 견본", "parseStatus 열쇠 __proto__", "parseStatus 프로토타입 없음", "parseStatus __proto__ 값", "parseStatus 오염 없음"]
    + ["parseRest 견본 KP000101", "parseRest 견본 KP000102"]
    + ["%s %s" % (k, n) for n in PARSES for k in ("입력 그대로", "새 객체", "얼린 입력")]
    + ["결과 따로 " + n for n in ("parseRoutes", "parseMeta", "parseStations", "parseRest")]
    + ["getJson 좋은 답", "getJson fetch 한 번·주소 그대로", "getJson 둘째 인자", "getJson 받은 글을 그대로 풂", "getJson 주소 그대로 2"]
    + [x for c in GET_CASES for x in ("getJson " + c, "getJson %s 부른 수" % c)]
    + ["getJson 주소 누출 " + c for c in ("404", "503", "연결 실패", "모양")]
    + [x for c in ("DOMException", "Error 이름") for x in ("getJson AbortError " + c, "getJson AbortError %s 부른 수" % c)]
)


@functools.lru_cache(maxsize=None)
def _results():
    return run_js("test_r3_read_relay.js")


@pytest.mark.parametrize("name", JS_NAMES)
def test_js_check(name):
    res = _results()
    assert name in res, "JS 가 이 확인을 내지 않음: %s" % name
    assert res[name]["ok"], "%s: %s" % (name, res[name]["detail"])


def test_js_names_match():
    """JS 가 낸 확인 이름 집합 == 파이썬이 아는 이름 집합(C7: 조용히 건너뛴 확인·겹친 이름·잡히지 않은 오류를 잡는다)."""
    assert len(JS_NAMES) == len(set(JS_NAMES))
    assert set(_results()) == set(JS_NAMES)
