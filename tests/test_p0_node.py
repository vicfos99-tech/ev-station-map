# -*- coding: utf-8 -*-
"""시험 틀(파이썬 쪽): pytest 에서 node 를 불러 JS 시험 파일의 결과를 읽는다(plan.md 5절 p0).

다른 부분의 테스트는
    from test_p0_node import run_js
로 쓴다(tests/ 에 __init__.py 가 없어 이 이름으로 import 된다).
이 파일에는 도우미만 둔다. test_ 로 시작하는 함수는 두지 않는다(시험은 test_p0_relay.py).
node 가 없으면 건너뛰지 않고 AssertionError 로 실패한다(plan.md 5절 p0 통과 기준 8).
"""
import json
import shutil
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent


def node_path():
    """PATH 에서 찾은 node 실행 파일 경로(없으면 None)."""
    return shutil.which("node")


def run_node(args, cwd=None, timeout=180):
    """node 를 돌려 (종료 코드, 표준 출력, 표준 오류)를 준다. 글자는 UTF-8(errors="replace").

    node 를 찾지 못하면 AssertionError(까닭을 글에 적는다). 건너뛰지 않는다.
    """
    exe = node_path()
    assert exe, "node 를 찾을 수 없어요: PATH 에 node 가 없어 JS 시험을 돌리지 못함(건너뛰지 않고 실패로 둔다)"
    p = subprocess.run([exe] + [str(a) for a in args], cwd=str(cwd or HERE), capture_output=True, timeout=timeout)
    return p.returncode, p.stdout.decode("utf-8", "replace"), p.stderr.decode("utf-8", "replace")


def run_js(name, args=(), cwd=None):
    """tests/<name>(절대 경로면 그 파일)을 node 로 돌려 {확인 이름: {"ok": bool, "detail": str}} 을 준다.

    표준 출력에서 "RESULT " 로 시작하는 마지막 줄의 JSON({"checks": [{"name","ok","detail"}]})을 읽는다.
    종료 코드가 0 이 아니거나 RESULT 줄이 없으면 AssertionError(표준 오류 끝 2000자를 붙인다).
    """
    code, out, err = run_node([HERE / name, *args], cwd=cwd)
    lines = [ln for ln in out.splitlines() if ln.startswith("RESULT ")]
    assert code == 0 and lines, "node %s 가 결과를 내지 못함(exit %d)\n%s\n%s" % (name, code, out[-1000:], err[-2000:])
    data = json.loads(lines[-1][len("RESULT "):])
    return {c["name"]: {"ok": bool(c["ok"]), "detail": c.get("detail", "")} for c in data["checks"]}
