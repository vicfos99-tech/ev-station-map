"""a1_allow: plan.md 4.1 기준 1~13. 가짜 키는 4.0 표대로 이어 붙임(C2)."""
import hashlib
import importlib.util as iu
from pathlib import Path

s = iu.spec_from_file_location("check_secrets", Path(__file__).resolve().parent.parent / "tools" / "check_secrets.py")
m = iu.module_from_spec(s)
s.loader.exec_module(m)
ck = lambda d, a: m.count_keys(d, a)
SK = b"service" + b"Key="
A = b"serviceKey=AbCdEfGhIjKlMnOpQrSt"
LONG = A + b"XYZ" + b"123"
OTHER = SK + b"Zz" * 10
BOT = b"bot" + b"123456:" + b"abcdefghijklmnopqrst_-"
KAKAO = b"Kakao" + b"AK " + b"0123456789abcdefghij"
PEM = b"-----BEGIN RSA " + b"PRIVATE KEY"
V = b"Zx9Yw8Vu7Ts6Rq5Po4Nm3Lk2"
T0 = b"T0-zzzz-1111-qqqq"
EV, EX = "EV_CHARGER_API_KEY", "EX_API_KEY"
SEC = {EV: T0, EX: V}
K = ": 키처럼 생긴 글자가 있다"


def wr(p, b):
    p.write_bytes(b)
    return str(p)


def test_load(tmp_path):
    assert m.load_allow(str(tmp_path / "no"), {}) == (frozenset(), [])
    assert m.load_allow(str(tmp_path), {}) == (frozenset(), [])
    b = b"\xef\xbb\xbf" + "# 설명\r\n\r\n  ".encode() + A + b" \t\r\n#" + OTHER + b"\n" + KAKAO
    assert m.load_allow(wr(tmp_path / "a", b), {}) == (frozenset({A, KAKAO}), [])
    assert A in m.load_allow(wr(tmp_path / "b", b"\xff\xfe\n" + A), {})[0]  # D2
    b = b"\n".join([b"# c " + V, A, b"", b"xx" + V + b"yy", T0 + b" " + V, LONG])
    w = "경고: 허용 목록 {}번째 줄에 환경변수 {} 의 값이 들어 있어 그 줄은 무시한다"
    assert m.load_allow(wr(tmp_path / "c", b), SEC) == (frozenset({A, LONG}), [w.format(4, EX), w.format(5, EV)])


def test_count():
    d = b"x?" + A + b"&y"
    assert ck(d, {A}) == (0, 1) and ck(d, frozenset()) == (1, 0)
    for i in range(3):
        x = [A, A]
        x.insert(i, OTHER)
        assert ck(b" ".join(x), {A}) == (1, 2)
    assert ck(LONG, {A}) == (1, 0) == ck(A, {LONG})
    assert ck(A, {A.swapcase()}) == (1, 0) == ck(A, {A[:-1]})
    assert ck(A + b"=", {A}) == (1, 0) == ck(A + A, {A})
    for x, a in ((BOT, BOT), (KAKAO, KAKAO), (PEM + b"-----", PEM)):
        assert ck(x, {A}) == (1, 0) and ck(x, {a}) == (0, 1)
    assert ck(b"hello " + SK + b"short", {A}) == (0, 0) == ck(b"", {A})


def test_files(tmp_path):
    f1 = wr(tmp_path / "f1", A + b"\n")
    f2 = wr(tmp_path / "f2", OTHER + b"\n" + A + b"\n" + LONG + b"\n")
    f3 = wr(tmp_path / "f3", b"k=" + V + b"\n")
    f4 = wr(tmp_path / "f4", T0 + b" " + SK + V + b" " + A + b"\n")
    e = ": 환경변수 {} 의 값이 들어 있다"
    r = m.check_files([f1, str(tmp_path / "no"), f2, f3, f4], SEC, frozenset({A, V, SK + V}))
    assert r == ([f2 + K, f3 + e.format(EX), f4 + e.format(EV), f4 + e.format(EX)], 4)
    assert m.check_files([], SEC, frozenset()) == ([], 0)
    assert m.check_files([f1], {}, frozenset()) == ([f1 + K], 0)


def test_fixed():
    assert hashlib.sha256(m.PATTERN.pattern).hexdigest() == "78cced60b4d2612c0e83f43bb80ed07e294f6ff8ba584424e78100087a12ecbf"
    assert m.SECRET_ENVS == (EV, EX, "TELEGRAM_BOT_TOKEN", "KAKAO_REST_API_KEY", "KAKAO_REST_KEY", "OPENAI_API_KEY")
    assert ck(Path(__file__).read_bytes(), {A, LONG})[0] == 0
