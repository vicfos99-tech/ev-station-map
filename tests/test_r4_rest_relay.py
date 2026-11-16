# -*- coding: utf-8 -*-
"""r4_rest 휴게소 새로 받기 시험 (plan.md 5절 r4_rest 325~363행, 2.1 N1~N4, 2.2 D1·D3·D6·D7·D10, 3절 C1~C5, 3.2 글 표).

- test_r4_rest_relay.js 의 확인 하나를 pytest 테스트 하나로 보인다(C7). 이름 집합도 견준다.
- 표는 JS 쪽 배열 길이만큼 '이름 NN' 으로 나온다. 길이를 여기 적어 두어 JS 가 조용히 줄인 줄을 잡는다.
- 값 단언은 JS 안에만 둔다(r2·r3 과 같은 방식). 견본은 ref/relay_sample/ 을 읽기만 한다(plan.md 21행).
- 기대값은 참조 구현(.orchestra/logs/ref_relay/relay.js)으로 검산했다(.orchestra/logs/tests_r4_rest.md).
"""
import functools

import pytest

from test_p0_node import run_js

FUNCS = ("wantedIds", "expire", "expireLive", "buildLive", "routeHint", "refreshRest")
COUNTS = (("wantedIds", 21), ("expireLive 모양", 10), ("expire", 14), ("routeHint", 12))
FALL = ("meta 404", "routes 503", "상태 깨짐", "meta 연결 실패", "routes 모양", "상태 다른 휴게소", "상태 500")
NOFB = ("meta 404", "연결 실패", "meta v2", "상태 500", "direct null", "direct 글자", "키 빈 글", "키 없음")


def _nums(prefix, n):
    return ["%s %02d" % (prefix, i) for i in range(1, n + 1)]


JS_NAMES = (
    ["내보냄 " + n for n in FUNCS]
    + [x for p, n in COUNTS for x in _nums(p, n)]
    + ["wantedIds 입력 그대로"]
    # buildLive (기준 2·3·4·5·6·7)
    + ["buildLive 기본 " + x for x in ("KP000101 상태", "KP000101 updated", "KP000101 last_end", "KP000102 그대로",
                                      "relay", "머리", "열쇠 순서", "출처 칸", "routes 전체")]
    + ["buildLive config 같은 객체", "buildLive config 없음 null", "buildLive item_count 0개 충전소"]
    + ["meta ok false " + x for x in ("updated", "relay", "지금은 셈", "31분", "30분 정각")]
    + ["meta null", "meta 보다 늦은 파일 at"]
    + ["30분 정각 KP000101", "30분 정각 KP000102", "30분 1밀리초 KP000101", "31분 둘 다"]
    + ["자료 없음 상태", "자료 없음 relay", "자료 없음 29분", "wanted 밖 자료는 안 씀", "둘 다 덮어씀", "둘 다 덮어씀 relay",
       "둘 다 meta 실패 oldest"]
    + ["상태 1개", "상태 3개", "상태 0개", "stat 7·2", "섞인 종류", "모두 완속은 한 종류", "last_end null 은 그대로",
       "last_end 숫자 5", "last_end 새 값", "last_end 없던 칸에 null", "목록 충전기 0개", "목록 0개·상태 0개", "stat 표"]
    + ["buildLive 입력 그대로", "buildLive 새 충전소 객체", "buildLive 새 충전기 객체", "buildLive 새 배열", "buildLive 얼린 입력"]
    # expire·expireLive (기준 8)
    + ["expireLive 30분 정각", "expireLive 30분 1밀리초", "expireLive 한 번 더", "expireLive 표식 없음",
       "expireLive 모양 다름", "expireLive nearby 그대로"]
    # refreshRest (기준 10~18)
    + ["켬 부른 주소", "켬 결과", "켬 onProgress", "켬 fetch 둘째 인자", "켬 live", "켬 config 전달", "켬 live-gb-up", "켬 navi 둘"]
    + ["오래됨 40분", "조용한 충전소", "meta 실패 + 40분", "18분", "글 잇기"]
    + ["now 없음", "now 글자", "now NaN"]
    + ["예비 " + x for x in FALL]
    + ["예비 없음 " + x for x in NOFB]
    + ["404 하나뿐", "404 하나뿐 onProgress", "404 둘 중 하나", "404 둘 다·키 있음"]
    + ["이름 틀린 id", "이름 틀린 id 뿐", "이름 틀린 id 뿐 부른 수"]
    + ["끔 키 있음", "끔 키 없음", "끔 direct 없음", "끔 둘 다 없음", "끔 on 0", "direct 오류 그대로 끔", "direct 오류 그대로 예비"]
    + ["기본 주소 안드로이드", "기본 주소 github", "기본 주소 다른 사이트", "settings 없음"]
    + ["20곳 " + x for x in ("부른 수", "maxActive", "받은 주소", "relay.ids", "onProgress", "상태")]
    + ["RangeError", "RangeError 키 있음", "AbortError 그대로"]
)


@functools.lru_cache(maxsize=None)
def _results():
    return run_js("test_r4_rest_relay.js")


@pytest.mark.parametrize("name", JS_NAMES)
def test_js_check(name):
    res = _results()
    assert name in res, "JS 가 이 확인을 내지 않음: %s" % name
    assert res[name]["ok"], "%s: %s" % (name, res[name]["detail"])


def test_js_names_match():
    """JS 가 낸 확인 이름 집합 == 파이썬이 아는 이름 집합(C7: 조용히 건너뛴 확인·겹친 이름·잡히지 않은 오류를 잡는다)."""
    assert len(JS_NAMES) == len(set(JS_NAMES))
    assert set(_results()) == set(JS_NAMES)
