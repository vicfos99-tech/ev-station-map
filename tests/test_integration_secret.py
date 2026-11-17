"""integration: plan.md 4.2 기준 1~12. [선택] S4·S8 은 글자 한도로 뺌. 가짜 키는 이어 붙임(C2)."""
import importlib.util as iu, os, re, shutil, subprocess as sp, sys
from pathlib import Path
import pytest

R = Path(__file__).resolve().parent.parent
s = iu.spec_from_file_location("check_secrets", R / "tools" / "check_secrets.py")
m = iu.module_from_spec(s)
s.loader.exec_module(m)
SK = b"service" + b"Key="
A = SK + b"AbCdEfGhIjKlMnOpQrSt"
LONG = A + b"XYZ123"
V = "Zx9Yw8Vu7Ts6Rq5Po4Nm3Lk2"
T2 = "T2-zzzz-2222-qqqq"
E = dict(os.environ)
E.update({n: f"T{i}-zzzz-{str(i or 1) * 4}-qqqq" for i, n in enumerate(m.SECRET_ENVS)}, EX_API_KEY=V)
AL = "# 시험용 가짜 글\n".encode() + A + b"\n"
TJ = b'fetch("https://x/api?' + A + b'&a=1"); // ' + A + b"\n"
TA = "tools/secret_allow.txt"
S1 = {TA: AL, "t.js": TJ}
P = "허용 목록으로 넘어간 시험용 가짜 글: {}개"
OK = "비밀값 검사 통과: 파일 {}개, 확인한 환경변수 6개"
K = ": 키처럼 생긴 글자가 있다"
X = ": 환경변수 EX_API_KEY 의 값이 들어 있다"
Q = lambda *a: ["비밀값 검사 실패 — 올리지 않는다:"] + ["  " + x for x in a]
C = [
    (S1, 0, [P.format(3), OK.format(3)]),
    ({**S1, "u.js": b"x=" + LONG + b"\n"}, 1, [P.format(3), *Q("u.js" + K)]),
    ({**S1, "v.js": A + b"&\n" + SK + b"Zz" * 10 + b"\n" + A + b"\n"}, 1, [P.format(5), *Q("v.js" + K)]),
    ({"secret_allow.txt": AL, "t.js": TJ}, 1, Q("secret_allow.txt" + K, "t.js" + K)),
    ({"c.txt": "아무것도 없음 ".encode() + SK + b"short\n"}, 0, [OK.format(2)]),
    ({TA: AL + SK + V.encode() + b"\n", "t.js": TJ, "x.js": SK + V.encode() + b"\n"}, 1,
     ["경고: 허용 목록 3번째 줄에 환경변수 EX_API_KEY 의 값이 들어 있어 그 줄은 무시한다", P.format(3),
      *Q(TA + X, TA + K, "x.js" + X, "x.js" + K)]),
]


def run(cwd, env):
    r = sp.run([sys.executable, "tools/check_secrets.py"], cwd=cwd, env=env, capture_output=True, timeout=120)
    o = r.stdout.decode("utf-8").replace("\r\n", "\n")
    assert all(x not in o for x in ("AbCdEfGhIjKlMnOpQrSt", V, T2))
    return r.returncode, o.splitlines()


@pytest.mark.parametrize("fs,rc,want", C, ids="S1 S2 S3 S5 S6 S7".split())
def test_flow(tmp_path, fs, rc, want):
    (tmp_path / "tools").mkdir()
    shutil.copy(R / "tools" / "check_secrets.py", tmp_path / "tools")
    for k, v in fs.items():
        (tmp_path / k).write_bytes(v)
    for c in ("init", "-q"), ("add", "-A"):
        sp.run(["git", *c], cwd=tmp_path, check=True)
    assert run(tmp_path, E) == (rc, want)


def test_real_allow():
    f = R / "tools" / "secret_allow.txt"
    assert Path(m.ALLOW_FILE) == f
    assert m.load_allow(m.ALLOW_FILE, {}) == (frozenset({A, LONG}), [])
    b = f.read_bytes()
    assert b"\r" not in b and any(x.startswith(b"#") for x in b.split(b"\n"))


def test_real_repo():
    rc, o = run(R, os.environ)
    n = [int(x[22:-1]) for x in o if re.fullmatch(P.format(r"\d+"), x)]
    assert rc == 0 and o[-1].startswith("비밀값 검사 통과: 파일 ") and n and n[0] >= 1


def test_self():
    assert m.count_keys(Path(__file__).read_bytes(), {A, LONG})[0] == 0
