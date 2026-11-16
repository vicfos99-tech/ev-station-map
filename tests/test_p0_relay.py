# -*- coding: utf-8 -*-
"""p0 테스트 틀 시험 (plan.md 5절 p0 통과 기준 1~8, 0절, 3절 C4·C7, 3.1 상수).

- test_p0_relay.js 의 확인 하나를 pytest 테스트 하나로 보인다(C7). 이름 집합도 견준다.
- 도우미(test_p0_node.run_js·run_node)와 JS 틀(test_p0_fake.js)의 동작은 tmp_path 에 쓴 임시 JS 로 본다.
- web/relay.js 글자 검사는 뒤 부분(r1~r6)이 채운 뒤에도 참인 성질만 단언한다(plan.md 24행).
"""
import ast
import functools
import json
import re
from pathlib import Path

import pytest

from test_p0_node import HERE, run_js, run_node

ROOT = HERE.parent
RELAY = ROOT / "web" / "relay.js"
FAKE = HERE / "test_p0_fake.js"
ANDROID = "https://vicfos99-tech.github.io/ev-station-map/relay/"

JS_NAMES = [
    "fetch 객체 ok", "fetch 객체 status", "fetch 객체 글", "fetch 글 그대로", "fetch 503", "fetch 204",
    "fetch 숫자 경계 200·299 ok, 300·199 아님", "fetch DOWN 은 TypeError 로 거절", "fetch 함수 값(주소 전체를 받음)",
    "fetch 함수가 숫자", "fetch 함수가 DOWN", "fetch 없는 주소 404", "fetch 주소 전체 열쇠", "fetch base 밖 주소 전체 열쇠",
    "fetch base 밖이면 뒷부분 열쇠로 찾지 않음", "fetch calls 순서", "fetch calls 수", "fetch calls 는 사본",
    "fetch inits 둘째 인자", "fetch inits 없으면 undefined", "fetch 하나씩 부르면 maxActive 1",
    "fetch delay 5 로 셋을 같이 부르면 maxActive 3", "fetch opts 없이도 됨",
    "storage 처음 값", "storage 넣고 읽기", "storage log 순서", "storage dump", "storage init 없음",
    "storage fail get 만 던짐", "storage fail set 만 던짐", "storage fail set 은 저장·기록하지 않음", "storage fail remove 만 던짐",
    "relay require 가 객체", "relay ANDROID_BASE", "relay NOTE_MIN", "relay DROP_MIN", "relay FUTURE_MIN", "relay POOL",
    "relay KEY_ON", "relay KEY_BASE", "relay NOTE_FALLBACK", "relay NOTE_SUSPECT", "relay 숫자 상수는 number",
    "relay RelayError 는 함수", "RelayError 는 Error", "RelayError 는 RelayError", "RelayError 이름·코드·글",
    "RelayError 글 없으면 코드", "RelayError 던지고 잡힘", "RelayError 의 code 는 객체마다",
    "브라우저 꼴 window.EvRelay.ANDROID_BASE", "브라우저 꼴 window.EvRelay.POOL", "브라우저 꼴 오류 없음·module 안 만듦",
]


@functools.lru_cache(maxsize=None)
def _results():
    return run_js("test_p0_relay.js")


@pytest.mark.parametrize("name", JS_NAMES)
def test_js_check(name):
    res = _results()
    assert name in res, "JS 가 이 확인을 내지 않음: %s" % name
    assert res[name]["ok"], "%s: %s" % (name, res[name]["detail"])


def test_js_names_match():
    """JS 가 낸 확인 이름 집합 == 파이썬이 아는 이름 집합(C7: 조용히 건너뛴 확인·겹친 이름을 잡는다)."""
    assert set(_results()) == set(JS_NAMES)
    assert len(JS_NAMES) == len(set(JS_NAMES))


# ---------- 임시 JS 로 도우미·틀 보기 ----------

def _js(tmp_path, body, name="t.js"):
    """tmp_path 에 test_p0_fake.js 를 절대 경로로 require 하는 JS 를 쓰고 그 경로를 준다."""
    p = tmp_path / name
    head = '"use strict";\nconst T = require(%s);\n' % json.dumps(str(FAKE))
    p.write_text(head + body, encoding="utf-8")
    return p


def test_ok_and_fail_checks_come_as_dict(tmp_path):
    """기준 1: 실패한 확인은 예외가 아니라 ok=False 로 온다."""
    p = _js(tmp_path, 'T.check("맞음", 1 + 1 === 2, "x");\nT.eq("틀림", [1, "가"], [2, "가"]);\nT.finish();\n')
    res = run_js(str(p))
    assert set(res) == {"맞음", "틀림"}
    assert res["맞음"] == {"ok": True, "detail": ""}
    assert res["틀림"]["ok"] is False
    assert '[1,"가"]' in res["틀림"]["detail"] and '[2,"가"]' in res["틀림"]["detail"]


def test_fake_helpers_semantics(tmp_path):
    """check 의 참거짓 바꾸기, eq 는 JSON 글자로 견줌, throws·rejects 는 .code 를 보고 던진 것을 돌려줌."""
    body = r'''
T.check("참 값", "a", "x"); T.check("거짓 값", 0, "보일 글"); T.check("거짓 글 없음", false);
T.eq("eq 같은 모양", {a: [1, 2]}, {a: [1, 2]}); T.eq("eq 숫자와 글", 1, "1");
const e1 = T.throws("throws 맞는 코드", () => { const e = new Error("m"); e.code = "c1"; throw e; }, "c1");
T.throws("throws 다른 코드", () => { const e = new Error("m"); e.code = "c1"; throw e; }, "c2");
const n1 = T.throws("throws 안 던짐", () => 1, "c1");
T.check("throws 돌려줌", e1 && e1.code === "c1" && n1 === null, "");
(async () => {
  const e2 = await T.rejects("rejects 맞는 코드", async () => { const e = new Error("m"); e.code = "r1"; throw e; }, "r1");
  await T.rejects("rejects 다른 코드", () => Promise.reject(Object.assign(new Error("m"), {code: "r1"})), "r2");
  const n2 = await T.rejects("rejects 안 던짐", async () => 1, "r1");
  T.check("rejects 돌려줌", e2 && e2.code === "r1" && n2 === null, "");
  T.finish(); T.finish();
})();
'''
    p = _js(tmp_path, body)
    code, out, _ = run_node([p])
    assert code == 0
    assert len([ln for ln in out.splitlines() if ln.startswith("RESULT ")]) == 1, "finish 두 번이면 RESULT 도 한 번"
    res = run_js(str(p))
    ok = {k: v["ok"] for k, v in res.items()}
    assert ok == {
        "참 값": True, "거짓 값": False, "거짓 글 없음": False, "eq 같은 모양": True, "eq 숫자와 글": False,
        "throws 맞는 코드": True, "throws 다른 코드": False, "throws 안 던짐": False, "throws 돌려줌": True,
        "rejects 맞는 코드": True, "rejects 다른 코드": False, "rejects 안 던짐": False, "rejects 돌려줌": True,
    }
    assert res["거짓 값"]["detail"] == "보일 글"
    assert "던지지 않음" in res["throws 안 던짐"]["detail"] and "던지지 않음" in res["rejects 안 던짐"]["detail"]
    assert "c1" in res["throws 다른 코드"]["detail"]


def test_no_result_line_raises(tmp_path):
    """기준 2: RESULT 를 찍지 않는 JS → AssertionError(예외 글에 파일 이름·표준 오류 끝)."""
    p = tmp_path / "quiet.js"
    p.write_text('console.log("그냥 글"); console.error("표준오류꼬리XYZ");\n', encoding="utf-8")
    with pytest.raises(AssertionError) as ei:
        run_js(str(p))
    assert "quiet.js" in str(ei.value) and "표준오류꼬리XYZ" in str(ei.value)


def test_missing_js_raises(tmp_path):
    with pytest.raises(AssertionError):
        run_js(str(tmp_path / "없는파일.js"))
    with pytest.raises(AssertionError):
        run_js("test_p0_없는_파일.js")


def test_nonzero_exit_after_result_raises(tmp_path):
    """종료 코드가 0 이 아니면 RESULT 줄이 있어도 AssertionError(plan.md 168행)."""
    p = _js(tmp_path, 'T.check("a", true); T.finish(); process.exitCode = 3;\n')
    with pytest.raises(AssertionError) as ei:
        run_js(str(p))
    assert "3" in str(ei.value)


def test_uncaught_throw_becomes_failed_check(tmp_path):
    """기준 2: 중간에 throw → '잡히지 않은 오류' ok=False, 앞의 확인은 남고 종료 코드 0."""
    p = _js(tmp_path, 'T.check("앞", true);\nthrow new Error("일부러꽝");\n')
    code, out, _ = run_node([p])
    assert code == 0 and out.count("RESULT ") == 1
    res = run_js(str(p))
    assert res["앞"]["ok"] is True
    assert res["잡히지 않은 오류"]["ok"] is False
    assert "일부러꽝" in res["잡히지 않은 오류"]["detail"]


def test_unhandled_rejection_becomes_failed_check(tmp_path):
    p = _js(tmp_path, 'T.check("앞", true);\nPromise.reject(new Error("거절꽝"));\n')
    res = run_js(str(p))
    assert res["앞"]["ok"] is True
    assert res["잡히지 않은 거절"]["ok"] is False and "거절꽝" in res["잡히지 않은 거절"]["detail"]


def test_duplicate_name_is_failed_check(tmp_path):
    """기준 2: 같은 이름 확인 두 번 → '<이름> (이름 겹침)' 실패, 처음 것은 그대로."""
    p = _js(tmp_path, 'T.check("겹", true);\nT.check("겹", true);\nT.eq("겹", 1, 1);\nT.finish();\n')
    res = run_js(str(p))
    assert res["겹"] == {"ok": True, "detail": ""}
    assert res["겹 (이름 겹침)"]["ok"] is False


def test_last_result_line_wins_and_args_cwd(tmp_path):
    """RESULT 로 시작하는 마지막 줄을 읽고, args·cwd 가 node 에 닿는다."""
    sub = tmp_path / "작업"
    sub.mkdir()
    body = (
        'console.log("RESULT " + JSON.stringify({checks: [{name: "옛것", ok: true, detail: ""}]}));\n'
        'T.eq("인자", process.argv.slice(2), ["가", "b c"]);\n'
        'T.eq("폴더", require("path").basename(process.cwd()), "작업");\n'
        'T.finish();\n'
    )
    p = _js(tmp_path, body)
    res = run_js(str(p), args=("가", "b c"), cwd=sub)
    assert set(res) == {"인자", "폴더"}
    assert res["인자"]["ok"] and res["폴더"]["ok"], res


def test_run_node_returns_utf8_triplet(tmp_path):
    p = tmp_path / "u.js"
    p.write_text('console.log("한글출력"); console.error("한글오류"); process.exit(7);\n', encoding="utf-8")
    code, out, err = run_node([p])
    assert (code, out.strip(), err.strip()) == (7, "한글출력", "한글오류")


def test_node_missing_fails_not_skips(tmp_path, monkeypatch):
    """기준 8: node 가 없으면 건너뛰지 않고 AssertionError, 글에 node 가 보인다."""
    monkeypatch.setenv("PATH", str(tmp_path))
    with pytest.raises(AssertionError) as ei:
        run_node(["--version"])
    assert "node" in str(ei.value)
    with pytest.raises(AssertionError):
        run_js("test_p0_relay.js")


def test_node_helper_has_no_tests_and_no_skip():
    """기준 8·9: test_p0_node.py 에 test_ 로 시작하는 함수가 없고, p0 파이썬 파일에 건너뛰기가 없다."""
    tree = ast.parse((HERE / "test_p0_node.py").read_text(encoding="utf-8"))
    funcs = [n.name for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]
    assert "run_node" in funcs and "run_js" in funcs
    assert [f for f in funcs if f.startswith("test")] == []
    for f in HERE.glob("test_p0_*.py"):
        text = f.read_text(encoding="utf-8")
        assert ("pytest." + "skip") not in text and ("import" + "orskip") not in text, f.name


# ---------- web/relay.js 글자 (끝까지 참인 성질만) ----------

def _relay_text():
    assert RELAY.is_file(), "web/relay.js 가 없음"
    return RELAY.read_text(encoding="utf-8")


def test_relay_android_host_exactly_once():
    assert _relay_text().count("vicfos99-tech.github.io") == 1


@pytest.mark.parametrize("word", ["require(", "console.", "localStorage", "document."])
def test_relay_forbidden_words_absent(word):
    """C4·C3: 다른 파일 require 없음, console 없음, localStorage·document 를 스스로 읽지 않음."""
    assert _relay_text().count(word) == 0, word


def test_relay_umd_shape_and_strict():
    """plan.md 178행: around.js 와 같은 꼴(module.exports / root.EvRelay)과 "use strict"."""
    text = _relay_text()
    assert "module.exports" in text and re.search(r"\.EvRelay\s*=", text)
    assert '"use strict"' in text or "'use strict'" in text
