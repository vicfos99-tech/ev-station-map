# -*- coding: utf-8 -*-
"""r2_fresh 시각과 신선함 시험 (plan.md 5절 r2_fresh 235~285행, 2.1 N1, 2.2 D1·D2, 3.1 상수, 3.2 '오래됨'·'중계 실패 까닭' 글, C2·C3).

- test_r2_fresh_relay.js 의 확인 하나를 pytest 테스트 하나로 보인다(C7). 이름 집합도 견준다.
- 표는 JS 쪽 배열 길이만큼 '이름 NN' 으로 나온다. 표 길이를 여기 적어 두어 JS 가 조용히 줄인 줄을 잡는다.
- 값 단언은 JS 안에만 둔다(p0 판정 보완 517행과 같은 방식). 기대값은 참조 구현
  (.orchestra/logs/ref_relay/relay.js)으로 검산했다(.orchestra/logs/tests_r2_fresh.md).
- JS 는 맨 앞에서 TZ 를 미국 서부로 둔다: kstMs 가 지역 시각으로 푸는 구현을 한국 시간대 PC 에서도 잡으려고.
"""
import functools

import pytest

from test_p0_node import run_js

FUNCS = ("kstMs", "trustAt", "ageMs", "level", "staleNote", "cleanText", "metaNote")
N_KST_OK = 12
N_KST_BAD = 34
N_AGE = 26
N_ZERO = 3
N_BADT = 15
N_CLEAN = 37
N_CLEAN_MAX = 11
N_LEAK = 4
N_META = 20

TRUST_LABELS = (
    "zcodes 안 줌", "파일이 meta 보다 늦음", "ok false", "ok 1", "ok 글자 true", "ok 없음",
    "meta.at null", "meta.at 못 읽음", "meta.at 없는 날", "meta.at 숫자", "meta null", "meta undefined", "meta 글자",
    "zcodes 41", "zcodes undefined 를 줌", "zcodes null", "zcodes 41·11", "zcodes 11·41(앞이 없음)", "zcodes 빈 배열",
    "zcodes 글자 41", "zcodes 숫자 41", "fresh 없음", "fresh 가 글자", "fresh 둘·zcodes 순서 다름",
    "fresh 없음이어도 zcodes 안 주면 meta", "zcodes 41·ok false", "zcodes 41·파일이 늦음",
    "파일 at 2026", "파일 at null", "파일 at undefined", "파일 at NaN", "파일 at Infinity", "파일 at 13자리 글자",
    "파일 at 없는 날(meta 는 좋음)", "파일 at 숫자", "파일 at 숫자·늦음", "파일 at 숫자·ok false", "파일 at 숫자·meta null",
)


def _nums(prefix, n, suffixes=("",)):
    return ["%s %02d%s" % (prefix, i, s) for i in range(1, n + 1) for s in suffixes]


TRIPLE = (" ageMs", " level", " staleNote")

JS_NAMES = (
    ["내보냄 " + n for n in FUNCS]
    + _nums("kstMs 읽음", N_KST_OK)
    + _nums("kstMs null", N_KST_BAD)
    + ["kstMs 시간대 " + tz for tz in ("Asia/Seoul", "UTC", "Pacific/Auckland")]
    + ["trustAt %02d %s" % (i + 1, label) for i, label in enumerate(TRUST_LABELS)]
    + ["trustAt 입력 그대로"]
    + _nums("시각", N_AGE, TRIPLE)
    + _nums("영", N_ZERO, TRIPLE)
    + _nums("깨진 시각", N_BADT, TRIPLE)
    + [
        "흐름 NOW0 fresh", "흐름 T_META+40분", "흐름 T_META+18분",
        "흐름 파일 기준 30분", "흐름 파일 기준 30분 넘음", "흐름 시각 없음",
    ]
    + _nums("cleanText", N_CLEAN)
    + _nums("cleanText max", N_CLEAN_MAX)
    + _nums("cleanText 누출", N_LEAK)
    + _nums("metaNote", N_META)
    + ["metaNote 누출 없음"]
)


@functools.lru_cache(maxsize=None)
def _results():
    return run_js("test_r2_fresh_relay.js")


@pytest.mark.parametrize("name", JS_NAMES)
def test_js_check(name):
    res = _results()
    assert name in res, "JS 가 이 확인을 내지 않음: %s" % name
    assert res[name]["ok"], "%s: %s" % (name, res[name]["detail"])


def test_js_names_match():
    """JS 가 낸 확인 이름 집합 == 파이썬이 아는 이름 집합(C7: 조용히 건너뛴 확인·겹친 이름·잡히지 않은 오류를 잡는다)."""
    assert len(JS_NAMES) == len(set(JS_NAMES))
    assert set(_results()) == set(JS_NAMES)
