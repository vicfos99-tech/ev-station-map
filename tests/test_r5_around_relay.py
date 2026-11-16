# -*- coding: utf-8 -*-
"""r5_around 지도 주변 충전소 시험 (plan.md 5절 r5_around 365~395행, 2.1 N1·N11·N13, 2.2 D1·D2·D3·D5·D11·D12, 3절 C1~C6).

- test_r5_around_relay.js 의 확인 하나를 pytest 테스트 하나로 보인다(C7). 이름 집합도 견준다.
- 표는 JS 쪽 배열 길이만큼 '이름 NN' 으로 나온다. 길이를 여기 적어 두어 JS 가 조용히 줄인 줄을 잡는다.
- 값 단언은 JS 안에만 둔다(r2~r4 와 같은 방식). 견본은 ref/relay_sample/ 을 읽기만 한다(plan.md 21행).
- 기대값은 참조 구현(.orchestra/logs/ref_relay/relay.js)으로 검산했다(.orchestra/logs/tests_r5_around.md).
"""
import functools

import pytest

from test_p0_node import run_js

FUNCS = ("overlayRegion", "regionStations", "loadRegion", "refreshRegion")
COUNTS = (("요금표", 9), ("좌표", 4))
LOADS = ("suspect 41", "suspect 견본 29", "suspect zcodes 로", "suspect 부분 일치 아님", "meta 실패 한도",
         "18분", "15분 정각", "40분", "글 셋 잇기")
FALL = ("stations 404", "meta 404", "status 503", "status 깨짐", "meta v2", "다른 시군구 파일", "meta 연결 실패")
NOFB = ("status 404", "stations 404", "meta 연결 실패", "zscode 4자리", "zscode 숫자", "다른 시군구 파일",
        "status 500", "direct null", "키 빈 글")
RFAIL = ("깨진 상태", "연결 실패", "상태 503", "상태 404", "zscode 틀림", "direct null")


def _nums(prefix, n):
    return ["%s %02d" % (prefix, i) for i in range(1, n + 1)]


JS_NAMES = (
    ["내보냄 " + n for n in FUNCS]
    + [x for p, n in COUNTS for x in _nums(p, n)]
    # regionStations (기준 1~7)
    + ["regionStations 기본 " + x for x in ("ME000201", "ME000202", "전체")]
    + ["regionStations indoor 없으면 칸 없음", "regionStations 새 충전소 객체"]
    + ["같은 모양 summary ME000201", "같은 모양 summary ME000202", "같은 모양 stationsOf 열쇠 집합", "같은 모양 stationsOf ME000201 값"]
    + ["요금표 tariffs 칸 없음"]
    + ["보증 없음 updated", "보증 없음 지금은 셈", "보증 없음 31분", "보증 없음 30분 정각", "meta ok false updated",
       "meta null updated", "zcodes 하나 모자람 updated", "zcodes 빈 배열 updated", "보증 있음 31분", "보증 있음 30분 정각",
       "보증 있음 30분 1밀리초 상태", "파일 at 이 meta 보다 늦음", "앞선 시각 5분", "앞선 시각 5분 넘음"]
    + ["상태에 ME000201 없음", "ME000202 를 2 로", "충전기 하나만 없음", "충전기 id 1 은 01 이 아님", "충전소 id 소문자는 다름"]
    + ["급속 없는 충전소 빠짐", "완속뿐인 충전소가 앞", "급속이 뒤 충전기", "빈 목록", "넣은 순서 그대로",
       "이름·업체·제조사 그대로", "power_kw 는 kw", "regionStations 입력 그대로", "regionStations 얼린 입력"]
    # overlayRegion (기준 8, D3)
    + ["overlay " + x for x in ("3", "상태", "updated", "한 번 더", "s 빈 객체", "30분 1밀리초", "30분 정각", "t null",
                                "없는 충전소도 updated", "빈 목록", "같은 배열·객체", "stat 표")]
    # loadRegion (기준 9~12)
    + ["켬 부른 주소", "켬 fetch 둘째 인자", "켬 결과", "켬 stations", "켬 direct 0번"]
    + list(LOADS)
    + ["40분 모두 comm_error", "18분 상태는 셈", "tariffs 전달", "tariffs 없음", "now 없음"]
    + ["예비 " + x for x in FALL] + ["예비 zscode 4자리"]
    + ["예비 없음 " + x for x in NOFB]
    + ["meta 연결 실패 부른 주소", "기본 주소 안드로이드", "settings 없음", "AbortError 그대로"]
    + ["끔 키 있음", "끔 키 없음", "끔 direct 없음", "direct 오류 그대로 끔", "direct 오류 그대로 예비"]
    # refreshRegion (기준 13~15)
    + ["refresh " + x for x in ("부른 주소", "같은 파일", "fetch 둘째 인자", "바뀜 3", "바뀜 상태", "바뀜 updated",
                                "s 빈 객체", "18분", "meta 실패", "region.zcodes")]
    + ["refresh 실패 키 없음", "refresh 실패 상태 그대로", "refresh 실패 31분", "refresh 실패 31분 상태"]
    + ["refresh 실패 " + x for x in RFAIL]
    + ["refresh 키 있음 " + x for x in ("결과", "replaced", "region 그대로", "direct 1번", "31분 그대로")]
    + ["refresh direct 오류 그대로", "refresh AbortError 그대로"]
)


@functools.lru_cache(maxsize=None)
def _results():
    return run_js("test_r5_around_relay.js")


@pytest.mark.parametrize("name", JS_NAMES)
def test_js_check(name):
    res = _results()
    assert name in res, "JS 가 이 확인을 내지 않음: %s" % name
    assert res[name]["ok"], "%s: %s" % (name, res[name]["detail"])


def test_js_names_match():
    """JS 가 낸 확인 이름 집합 == 파이썬이 아는 이름 집합(C7: 조용히 건너뛴 확인·겹친 이름·잡히지 않은 오류를 잡는다)."""
    assert len(JS_NAMES) == len(set(JS_NAMES))
    assert set(_results()) == set(JS_NAMES)
