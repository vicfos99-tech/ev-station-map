"""올리기 전 비밀값 검사.  py tools/check_secrets.py   (저장소 루트에서)

git 이 추적하는 파일에 다음이 있으면 실패(종료 코드 1)한다. 값은 절대 찍지 않고 파일 이름만 알려 준다.
- 환경변수(윈도우는 사용자 환경변수 레지스트리 포함)에 든 키·토큰 값 그대로
- 키처럼 생긴 글자: serviceKey=…, 텔레그램 bot 토큰, KakaoAK …, 개인 키 블록
시험용 가짜 글은 tools/secret_allow.txt (한 줄에 하나, 글자까지 같아야 함)에 적으면 넘어간다.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys

ALLOW_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "secret_allow.txt")
SECRET_ENVS = ("EV_CHARGER_API_KEY", "EX_API_KEY", "TELEGRAM_BOT_TOKEN", "KAKAO_REST_API_KEY", "KAKAO_REST_KEY", "OPENAI_API_KEY")
PATTERN = re.compile(rb"(serviceKey=[A-Za-z0-9%+/=]{20,}|bot\d{6,}:[A-Za-z0-9_-]{20,}|KakaoAK [A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY)")


def env_value(name):
    v = os.environ.get(name, "").strip()
    if v or os.name != "nt":
        return v
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as k:
            return str(winreg.QueryValueEx(k, name)[0]).strip()
    except OSError:
        return ""


def load_allow(path, secrets):
    """허용 목록 파일을 읽어 (허용 글 frozenset, 경고 글 list) 를 돌려준다. 못 읽으면 빈 결과."""
    try:
        with open(path, "rb") as fh:
            raw = fh.read()
    except OSError:
        return frozenset(), []
    if raw.startswith(b"\xef\xbb\xbf"):
        raw = raw[3:]
    allow = set()
    warns = []
    for no, line in enumerate(raw.split(b"\n"), 1):
        line = line.strip()
        if not line or line.startswith(b"#"):
            continue
        hit = next((n for n, v in secrets.items() if v in line), None)
        if hit is not None:
            warns.append(f"경고: 허용 목록 {no}번째 줄에 환경변수 {hit} 의 값이 들어 있어 그 줄은 무시한다")
            continue
        allow.add(line)
    return frozenset(allow), warns


def count_keys(data, allow):
    """(허용 안 된 수, 허용돼 넘어간 수). PATTERN 에 걸린 글이 허용 글과 글자까지 같을 때만 넘어간다."""
    bad = ok = 0
    for m in PATTERN.finditer(data):
        if m.group(0) in allow:
            ok += 1
        else:
            bad += 1
    return bad, ok


def check_files(files, secrets, allow):
    """(실패 줄 list, 넘어간 수 합계). 못 여는 파일은 건너뛴다."""
    bad = []
    skipped = 0
    for f in files:
        try:
            with open(f, "rb") as fh:
                data = fh.read()
        except OSError:
            continue
        for n, v in secrets.items():
            if v in data:
                bad.append(f"{f}: 환경변수 {n} 의 값이 들어 있다")
        nbad, nok = count_keys(data, allow)
        skipped += nok
        if nbad:
            bad.append(f"{f}: 키처럼 생긴 글자가 있다")
    return bad, skipped


def main():
    out = subprocess.run(["git", "ls-files", "-z"], capture_output=True, check=True).stdout
    files = [f.decode("utf-8") for f in out.split(b"\0") if f]
    secrets = {n: env_value(n).encode() for n in SECRET_ENVS}
    secrets = {n: v for n, v in secrets.items() if len(v) >= 8}  # 너무 짧은 값은 우연히 겹칠 수 있어 뺀다
    allow, warns = load_allow(ALLOW_FILE, secrets)
    for w in warns:
        print(w)
    bad, skipped = check_files(files, secrets, allow)
    if skipped:
        print(f"허용 목록으로 넘어간 시험용 가짜 글: {skipped}개")
    if bad:
        print("비밀값 검사 실패 — 올리지 않는다:")
        for b in bad:
            print("  " + b)
        return 1
    print(f"비밀값 검사 통과: 파일 {len(files)}개, 확인한 환경변수 {len(secrets)}개")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
