"""시험 DB 꺼내 보기(파이썬 기본 모듈만). DB 는 읽기만 한다 — 없으면 만들지 않고 알린다.

쓰는 법:  py tools/db_peek.py <설정 파일 경로> <무엇> [장면 이름 또는 실행 번호]
  master            마스터 목록(판 종류·출처·갱신 간격·디테일 표 …)
  counts            판마다 줄 수 · 처음 · 마지막 시각(한국 시각)
  runs              실행 목록(실행 번호 · 장면 · 시작·끝 · 돈 초 · 마지막 틱)
  timeline <장면|번호>  장면 하나(이름이면 그 장면의 마지막 실행)의 충전기 상태 바뀜 시간표
예)  py tools/db_peek.py config/testbed.json timeline S5_충전기상태
시각은 DB 에 UTC 로 있고, 보여 줄 때만 설정 kst_offset_hours 를 더한다.
"""
import sqlite3
import sys

import tbconfig
import tblog
import tbdb

WHERE = "db_peek"
OK_CODE = 0
FAIL_CODE = 1
WHATS = ("master", "counts", "runs", "timeline")
CAUSE_EVENT = "event"
CHARGER_ROLE = "charger"
EMPTY = "-"


def master_rows(cfg, conn):
    return tbdb.masters(cfg, conn)


def count_rows(cfg, conn):
    """[{kind, detail_table, rows, first, last}] — 처음·마지막은 UTC 글."""
    out = []
    for m in tbdb.masters(cfg, conn):
        t = tbdb.ident(m["detail_table"])
        n, first, last = conn.execute("SELECT COUNT(*), MIN(at), MAX(at) FROM " + t).fetchone()
        out.append({"kind": m["kind"], "detail_table": m["detail_table"], "rows": n, "first": first, "last": last})
    return out


def run_rows(cfg, conn, run=None):
    sql = "SELECT * FROM " + tbdb.ident(cfg["db"]["run_table"])
    if run is not None:
        return [dict(r) for r in conn.execute(sql + " WHERE run = ?", (run,))]
    return [dict(r) for r in conn.execute(sql + " ORDER BY run")]


def find_run(cfg, conn, what):
    """실행 번호 글이면 그 번호, 아니면 그 장면의 마지막 실행 번호. 없으면 None."""
    if what.isdigit():
        rows = run_rows(cfg, conn, int(what))
        return rows[0]["run"] if rows else None
    r = conn.execute("SELECT MAX(run) FROM " + tbdb.ident(cfg["db"]["run_table"]) + " WHERE scene = ?",
                     (what,)).fetchone()
    return r[0]


def charger_table(cfg, conn):
    kind = cfg["db"]["kinds"][CHARGER_ROLE]
    r = conn.execute("SELECT detail_table FROM " + tbdb.ident(cfg["db"]["master_table"]) + " WHERE kind = ?",
                     (kind,)).fetchone()
    if r is None:
        raise tbdb.DbError("마스터에 충전기 판이 없음: " + kind)
    return r[0]


def timeline_rows(cfg, conn, run):
    """실행 하나의 충전기 상태 바뀜(cause=event)을 쓴 차례대로 — 바뀌기 전 상태를 곁들인다."""
    t = tbdb.ident(charger_table(cfg, conn))
    rows = [dict(r) for r in conn.execute("SELECT * FROM " + t + " WHERE run = ? ORDER BY id", (run,))]
    last = {}
    out = []
    for r in rows:
        before = last.get(r["key"])
        last[r["key"]] = r["status"]
        if r["cause"] == CAUSE_EVENT:
            out.append(dict(r, before=before))
    return out


def _print_table(head, rows):
    print("| " + " | ".join(head) + " |")
    print("|" + "---|" * len(head))
    for r in rows:
        print("| " + " | ".join(EMPTY if v is None else str(v).replace("|", "/") for v in r) + " |")


def print_master(cfg, conn):
    rows = master_rows(cfg, conn)
    _print_table(["kind", "title", "source", "fetch_sec", "stale_sec", "keep_days", "detail_table", "ver", "key_desc",
                  "file", "on"],
                 [[m["kind"], m["title"], m["source"], m["fetch_sec"], m["stale_sec"], m["keep_days"], m["detail_table"],
                   m["ver"], m["key_desc"], m["file"], m["on"]] for m in rows])
    print("마스터 " + str(len(rows)) + "줄")


def print_counts(cfg, conn):
    _print_table(["판", "디테일 표", "줄 수", "처음(한국)", "마지막(한국)"],
                 [[r["kind"], r["detail_table"], r["rows"], tbdb.kst_text(cfg, r["first"]), tbdb.kst_text(cfg, r["last"])]
                  for r in count_rows(cfg, conn)])


def print_runs(cfg, conn):
    rd = cfg["units"]["report_decimals"]
    _print_table(["실행", "장면", "시작(한국)", "끝(한국)", "돈 초", "마지막 틱", "왜 시작", "왜 끝"],
                 [[r["run"], r["scene"], tbdb.kst_text(cfg, r["started_at"]), tbdb.kst_text(cfg, r["ended_at"]),
                   None if r["secs"] is None else round(r["secs"], rd), r["last_tick"], r["why_start"], r["why_end"]]
                  for r in run_rows(cfg, conn)])


def print_timeline(cfg, conn, what):
    run = find_run(cfg, conn, what)
    if run is None:
        print("그런 장면·실행이 DB 에 없음: " + what)
        return False
    info = run_rows(cfg, conn, run)[0]
    print("실행 " + str(run) + " · 장면 " + info["scene"] + " · 시작 " + str(tbdb.kst_text(cfg, info["started_at"])))
    rows = timeline_rows(cfg, conn, run)
    _print_table(["시각(한국)", "틱", "충전소/충전기", "전", "후", "stat"],
                 [[tbdb.kst_text(cfg, r["at"]), r["tick"], r["key"], r["before"], r["status"], r["stat"]] for r in rows])
    print("상태 바뀜 " + str(len(rows)) + "번")
    return True


def main(argv):
    args = argv[1:]
    if len(args) < len(("설정", "무엇")) or args[1] not in WHATS:
        print("쓰는 법: py db_peek.py <설정 파일 경로> " + "|".join(WHATS) + " [장면 이름 또는 실행 번호]")
        return FAIL_CODE
    try:
        cfg = tbconfig.Config(args[0])
    except tbconfig.ConfigError as e:
        print(str(e))
        return FAIL_CODE
    log = tblog.from_config(cfg, cfg.resolve)
    what = args[1]
    log.write(WHERE, "시작", what=what, arg=args[-1] if len(args) > len(("설정", "무엇")) else "")
    try:
        conn = tbdb.connect(cfg, create=False)
    except (sqlite3.Error, OSError, tbdb.DbError) as e:
        print("DB 를 못 엶: " + str(e))
        log.write(WHERE, "DB 못 엶", error=repr(e))
        return FAIL_CODE
    ok = True
    try:
        if what == "master":
            print_master(cfg, conn)
        elif what == "counts":
            print_counts(cfg, conn)
        elif what == "runs":
            print_runs(cfg, conn)
        else:
            if len(args) <= len(("설정", "무엇")):
                print("timeline 에는 장면 이름 또는 실행 번호가 필요")
                ok = False
            else:
                ok = print_timeline(cfg, conn, args[-1])
    except (sqlite3.Error, tbdb.DbError) as e:
        print("읽기 실패: " + str(e))
        log.write(WHERE, "읽기 실패", what=what, error=repr(e))
        ok = False
    finally:
        conn.close()
    log.write(WHERE, "끝", what=what, ok=ok)
    return OK_CODE if ok else FAIL_CODE


if __name__ == "__main__":
    sys.exit(main(sys.argv))
