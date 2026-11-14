"""테스트 파일 지문 잠금.

테스트 세션이 끝나면 테스트 파일들의 지문(해시)을 잠금 파일에 적어 둔다.
그 뒤로 테스트 파일이 하나라도 바뀌면 검사에서 실패한다.
이 파일은 프로젝트에 tools/check_tests_lock.py 로 복사돼
커밋 전 검사와 GitHub Actions 에서도 그대로 쓰인다.
"""
import hashlib
import json
import sys
from pathlib import Path

LOCK_NAME = "tests.lock.json"


def file_hash(path: Path) -> str:
    # 윈도우/리눅스 줄바꿈 차이로 지문이 달라지지 않게 맞춘다
    data = path.read_bytes().replace(b"\r\n", b"\n")
    return hashlib.sha256(data).hexdigest()


def scan(project: Path, tests_dir: str) -> dict:
    # 테스트 폴더 안 모든 파일의 지문을 모은다 (캐시 폴더는 뺀다)
    root = project / tests_dir
    result = {}
    if not root.exists():
        return result
    for p in sorted(root.rglob("*")):
        if p.is_file() and "__pycache__" not in p.parts:
            rel = p.relative_to(project).as_posix()
            result[rel] = file_hash(p)
    return result


def write_lock(project: Path, tests_dir: str) -> dict:
    # 지금 테스트 파일 상태를 잠근다
    files = scan(project, tests_dir)
    lock = {"tests_dir": tests_dir, "files": files}
    (project / LOCK_NAME).write_text(
        json.dumps(lock, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return lock


def check_lock(project: Path) -> list:
    # 잠금과 다른 점을 돌려준다. 빈 목록이면 통과
    lock_path = project / LOCK_NAME
    if not lock_path.exists():
        return ["잠금 파일이 없음"]
    lock = json.loads(lock_path.read_text(encoding="utf-8"))
    now = scan(project, lock["tests_dir"])
    before = lock["files"]
    problems = []
    for path, h in before.items():
        if path not in now:
            problems.append(f"지워짐: {path}")
        elif now[path] != h:
            problems.append(f"바뀜: {path}")
    for path in now:
        if path not in before:
            problems.append(f"새로 생김: {path}")
    return problems


if __name__ == "__main__":
    # 커밋 전 검사, CI 에서 실행: python tools/check_tests_lock.py
    here = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(".")
    issues = check_lock(here.resolve())
    if issues:
        print("테스트 파일이 잠금과 다릅니다:")
        for i in issues:
            print("  -", i)
        sys.exit(1)
    print("테스트 잠금 확인: 통과")
