"""기계 검사 네 가지(테스트 베드 폴더용, 파이썬 기본 모듈만).

쓰는 법:  py tools/check4.py <설정 파일 경로>
  예)    py tools/check4.py config/testbed.json

① 빌드      : 모든 .py 가 컴파일되고, 모든 .json 이 읽히고, 장면 검사기를 통과하고,
              시험 DB 표 정의(설정 db.schema_file)가 메모리 DB 에 깔리며 마스터·디테일이 맞나
② 박힌 값   : .py 안의 숫자(설정 allowed_numbers 밖)와 경로·주소처럼 생긴 글(설정 path_patterns)
              — 설명 글(docstring)과 설정 exclude_files 는 뺀다
③ 순환 의존 : 이 폴더 .py 끼리의 import 고리
④ 직접 불러 쓰기 : 설정 imports_allowed 밖의 이 폴더 모듈끼리 import, 그리고 기본 모듈이 아닌 바깥 묶음
넷 결과를 표로 찍고 하나라도 실패면 0 아닌 코드로 끝난다. 시작·끝·걸린 곳은 기록장에.
"""
import ast
import glob
import json
import os
import re
import sys

import check_scenes
import tbconfig
import tbdb
import tblog

WHERE = "check4"
OK_CODE = 0
FAIL_CODE = 1
PASS_WORD = "통과"
FAIL_WORD = "실패"


def _files(cfg, pattern):
    c = cfg["checks"]
    root = cfg.resolve(c["root"])
    out = []
    for p in sorted(glob.glob(os.path.join(root, pattern), recursive=True)):
        parts = os.path.relpath(p, root).split(os.sep)
        if any(part in c["skip_dirs"] for part in parts):
            continue
        out.append(p)
    return root, out


def _rel(root, path):
    return os.path.relpath(path, root).replace(os.sep, "/")


def _parse(path, root, bad):
    """파일을 읽어 구문 나무를 돌려준다. 못 읽으면 bad 에 까닭을 넣고 None (삼키지 않고 걸린 곳으로 셈)."""
    try:
        with open(path, encoding="utf-8") as f:
            src = f.read()
        return ast.parse(src, filename=path)
    except (SyntaxError, ValueError, OSError) as e:
        bad.append(_rel(root, path) + ": 읽지 못해 이 검사를 못 함 — " + str(e))
        return None


def check_build(cfg, log):
    root, pys = _files(cfg, cfg["checks"]["py_glob"])
    _, jsons = _files(cfg, cfg["checks"]["json_glob"])
    bad = []
    for p in pys:
        try:
            with open(p, encoding="utf-8") as f:
                compile(f.read(), p, "exec")
        except (SyntaxError, ValueError, OSError) as e:
            bad.append(_rel(root, p) + ": 컴파일 안 됨 — " + str(e))
    for p in jsons:
        try:
            with open(p, encoding="utf-8") as f:
                json.load(f)
        except (ValueError, OSError) as e:
            bad.append(_rel(root, p) + ": JSON 이 안 읽힘 — " + str(e))
    ok, errors, summaries = check_scenes.run(cfg, log)
    bad.extend("장면: " + e for e in errors)
    schema_errors = tbdb.check_schema(cfg)
    bad.extend("표 정의: " + e for e in schema_errors)
    counts = (".py " + str(len(pys)) + " · .json " + str(len(jsons)) + " · 장면 " + str(len(summaries))
              + " · 표 정의 " + ("맞음" if not schema_errors else "틀림"))
    return bad, counts, summaries


def _docstring_ids(tree):
    ids = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and node.body:
            first = node.body[0]
            if isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant) and isinstance(first.value.value, str):
                ids.add(id(first.value))
    return ids


def check_hardcode(cfg):
    h = cfg["checks"]["hardcode"]
    allowed = h["allowed_numbers"]
    patterns = [re.compile(p) for p in h["path_patterns"]]
    root, pys = _files(cfg, cfg["checks"]["py_glob"])
    excluded = {os.path.normpath(os.path.join(root, e)) for e in h["exclude_files"]}
    bad = []
    seen = 0
    for p in pys:
        if os.path.normpath(p) in excluded:
            continue
        seen += 1
        tree = _parse(p, root, bad)
        if tree is None:
            continue
        docs = _docstring_ids(tree)
        for node in ast.walk(tree):
            if not isinstance(node, ast.Constant) or id(node) in docs:
                continue
            v = node.value
            where = _rel(root, p) + ":" + str(node.lineno)
            if isinstance(v, (int, float)) and not isinstance(v, bool) and v not in allowed:
                bad.append(where + ": 숫자 " + repr(v))
            elif isinstance(v, str) and any(rx.search(v) for rx in patterns):
                bad.append(where + ": 경로·주소 같은 글 " + repr(v))
    return bad, ".py " + str(seen) + " 개 봄"


def _imports(cfg, bad):
    """{모듈 이름: [(가져온 모듈 이름, 줄)]} — 이 폴더 .py 전부. 못 읽은 파일은 bad 에."""
    root, pys = _files(cfg, cfg["checks"]["py_glob"])
    graph = {}
    paths = {}
    for p in pys:
        name = os.path.splitext(os.path.basename(p))[0]
        paths[name] = _rel(root, p)
        found = []
        tree = _parse(p, root, bad)
        graph[name] = found
        if tree is None:
            continue
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                found.extend((a.name.split(".")[0], node.lineno) for a in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module and not node.level:
                found.append((node.module.split(".")[0], node.lineno))
    return graph, paths


def check_cycles(cfg):
    bad = []
    graph, _ = _imports(cfg, bad)
    local = {m: sorted({t for t, _ in deps if t in graph}) for m, deps in graph.items()}
    state = {}
    stack = []

    def visit(m):
        state[m] = "on"
        stack.append(m)
        for t in local[m]:
            if state.get(t) == "on":
                cycle = stack[stack.index(t):] + [t]
                bad.append(" → ".join(cycle))
            elif t not in state:
                visit(t)
        stack.pop()
        state[m] = "done"

    for m in sorted(local):
        if m not in state:
            visit(m)
    edges = sum(len(v) for v in local.values())
    return bad, "모듈 " + str(len(local)) + " · 이음 " + str(edges)


def check_direct(cfg):
    allowed = cfg["checks"]["imports_allowed"]
    bad = []
    graph, paths = _imports(cfg, bad)
    std = set(sys.stdlib_module_names)
    seen = 0
    for m, deps in sorted(graph.items()):
        for t, line in deps:
            seen += 1
            where = paths[m] + ":" + str(line)
            if t in graph:
                if m not in allowed:
                    bad.append(where + ": 모듈 '" + m + "' 이(가) 허용 목록에 없는데 '" + t + "' 을(를) 불러 씀")
                elif t not in allowed[m]:
                    bad.append(where + ": '" + m + "' → '" + t + "' 는 허용 목록 밖")
            elif t not in std:
                bad.append(where + ": 기본 모듈이 아닌 '" + t + "' 을(를) 불러 씀")
    return bad, "import " + str(seen) + " 곳 봄"


def run(cfg, log):
    log.write(WHERE + ".run", "시작", config=cfg.path)
    rows = []
    build_bad, build_count, summaries = check_build(cfg, log)
    rows.append(("① 빌드", build_bad, build_count))
    for title, fn in (("② 박힌 값", check_hardcode), ("③ 순환 의존", check_cycles), ("④ 직접 불러 쓰기", check_direct)):
        bad, count = fn(cfg)
        rows.append((title, bad, count))
    for title, bad, _ in rows:
        for b in bad:
            log.write(WHERE + ".run", "걸림", check=title, detail=b)
    ok = not any(bad for _, bad, _ in rows)
    log.write(WHERE + ".run", "끝", result=PASS_WORD if ok else FAIL_WORD,
              failed=sum(len(bad) for _, bad, _ in rows))
    return ok, rows, summaries


def print_table(ok, rows, summaries, decimals):
    print("| 검사 | 결과 | 걸린 곳 | 본 것 |")
    print("|---|---|---|---|")
    for title, bad, count in rows:
        print("| " + title + " | " + (FAIL_WORD if bad else PASS_WORD) + " | " + str(len(bad)) + " | " + count + " |")
    for title, bad, _ in rows:
        for b in bad:
            print("  [" + title + "] " + b)
    print("장면 요약:")
    check_scenes.print_summaries(summaries, decimals)
    print("기계 검사 네 가지: " + (PASS_WORD if ok else FAIL_WORD))


def main(argv):
    args = argv[1:]
    if len(args) != 1:
        print("쓰는 법: py check4.py <설정 파일 경로>")
        return FAIL_CODE
    try:
        cfg = tbconfig.Config(args[0])
    except tbconfig.ConfigError as e:
        print(str(e))
        return FAIL_CODE
    log = tblog.from_config(cfg, cfg.resolve)
    try:
        ok, rows, summaries = run(cfg, log)
    except Exception as e:
        log.write(WHERE + ".main", "예외", config=args[0], error=repr(e))
        raise
    print_table(ok, rows, summaries, cfg["units"]["report_decimals"])
    return OK_CODE if ok else FAIL_CODE


if __name__ == "__main__":
    sys.exit(main(sys.argv))
