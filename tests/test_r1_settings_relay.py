# -*- coding: utf-8 -*-
"""r1_settings 설정과 주소 시험 (plan.md 5절 r1_settings 191~233행, 3.1 상수, 3.2 '주소 검사' 글, 2.1 N8·N9, 2.2 D8).

- test_r1_settings_relay.js 의 확인 하나를 pytest 테스트 하나로 보인다(C7). 이름 집합도 견준다.
- 표(defaultBase·checkBase·loadSettings·saveOn·baseOf)는 JS 쪽 배열 길이만큼 '이름 NN' 으로 나온다.
  표 길이를 여기 적어 두어 JS 가 조용히 줄인 줄을 잡는다.
- 결과 객체는 열쇠 순서와 상관없이 견준다(JS 쪽 canon).
"""
import functools

import pytest

from test_p0_node import run_js

N_DEFAULT = 23     # defaultBase 표
N_CHECK_OK = 15    # checkBase 통과
N_BAD_HTTPS = 11   # checkBase 'https' 까닭 거부
N_BAD_SHAPE = 27  # checkBase '모양' 까닭 거부
N_LOAD = 16        # loadSettings 저장소 표
N_ON = 9           # saveOn 값 표


def _nums(prefix, n, suffixes=("",)):
    return ["%s %02d%s" % (prefix, i, s) for i in range(1, n + 1) for s in suffixes]


JS_NAMES = (
    ["내보냄 " + n for n in ("defaultBase", "checkBase", "loadSettings", "saveOn", "saveBase", "baseOf")]
    + _nums("defaultBase", N_DEFAULT)
    + _nums("checkBase 통과", N_CHECK_OK)
    + _nums("checkBase https 거부", N_BAD_HTTPS)
    + _nums("checkBase 모양 거부", N_BAD_SHAPE)
    + ["checkBase 까닭에 입력 없음 " + s for s in ("http", "모양", "골뱅이")]
    + _nums("loadSettings", N_LOAD, ("", " 쓰지 않음"))
    + [
        "loadSettings null", "loadSettings undefined", "loadSettings getItem 이 던짐",
        "loadSettings getItem 이 던짐(off 저장돼 있어도 기본값)",
    ]
    + _nums("saveOn", N_ON, (" 돌려줌", " 기록", " relay-base 그대로"))
    + ["saveOn set 이 던지면 false", "saveOn set 이 던지면 저장값 그대로", "saveOn remove 가 던지는 저장소도 됨"]
    + [
        "saveBase http 거부", "saveBase 모양 거부", "saveBase 글자 아님 거부",
        "saveBase 거부는 저장소를 안 부름", "saveBase 거부 뒤 전 주소 그대로", "saveBase 거부가 저장 실패보다 먼저",
        "saveBase 좋은 주소", "saveBase 좋은 주소 기록", "saveBase 빈 글", "saveBase 빈 글 기록", "saveBase relay 열쇠 그대로",
    ]
    + ["saveBase %s %s" % (label, s) for label in ("null", "빈칸뿐", "undefined") for s in ("은 지움", "기록")]
    + [
        "saveBase set 이 던짐", "saveBase set 이 던지면 전 주소 그대로", "saveBase set 이 던져도 빈 글은 remove 만 써서 됨",
        "saveBase remove 가 던짐", "saveBase remove 가 던져도 좋은 주소는 set 만 써서 됨", "saveBase remove 실패 저장소 기록",
    ]
    + _nums("baseOf", 12)
)


@functools.lru_cache(maxsize=None)
def _results():
    return run_js("test_r1_settings_relay.js")


@pytest.mark.parametrize("name", JS_NAMES)
def test_js_check(name):
    res = _results()
    assert name in res, "JS 가 이 확인을 내지 않음: %s" % name
    assert res[name]["ok"], "%s: %s" % (name, res[name]["detail"])


def test_js_names_match():
    """JS 가 낸 확인 이름 집합 == 파이썬이 아는 이름 집합(C7: 조용히 건너뛴 확인·겹친 이름·잡히지 않은 오류를 잡는다)."""
    assert len(JS_NAMES) == len(set(JS_NAMES))
    assert set(_results()) == set(JS_NAMES)
