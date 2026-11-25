"""시험 DB 스스로 시험 — 다리를 시험 모드로 띄워 장면(설정 db.try.scene)을 실제 시간으로 돌리고, DB 에 쌓인 것을 표로 맞춰 본다.

쓰는 법:  py tools/try_db.py <설정 파일 경로>
  예)    py tools/try_db.py config/testbed.json      (설정 db.try.run_seconds 초 + 끝맺음 — 약 6분)
보는 것:
  ① 마스터 줄이 판 종류(설정 db.kinds)만큼이고 표 정의가 맞나
  ② 흐름 틱 수가 그 실행이 돈 초와 맞나(± 설정 db.try.tick_tolerance)
  ③ 장면의 충전기 상태 바뀜이 장면 시간표 그대로, 시각 순서대로 쌓였나
  ④ '이상해' 받음 1 · 거절 1 이 다리의 답과 DB 기록에서 같나
  ⑤ 같은 장면을 다시 돌려도(처음부터 = 새 실행 번호) 앞 실행의 줄이 그대로인가
  ⑥ 쓰기 실패·버림 0, 다리가 스스로 끝남
  ⑦ 쓰기 실패를 일부러 냈을 때 기록장에 남고 다음 줄은 쓰이나(따로 만든 빈 DB 에서)
하나라도 실패면 0 아닌 코드로 끝난다. 시작·끝·줄마다 결과는 기록장에.
"""
import os
import secrets
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import types
from urllib.error import URLError

import db_peek
import tbconfig
import tblog
import tbdb
import try_server

SERVER_DIR = "server"
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir, SERVER_DIR))

import recorder  # noqa: E402

WHERE = "try_db"
OK_CODE = 0
FAIL_CODE = 1
EV_CHARGER = "charger_status"
LOG_SEP = " | "
FAIL_MARK = "실패"
TEMP_PREFIX = "tb_try_db_"
STUB_SCENE = "쓰기실패_시험"
STUB_STATION = "STUB0001"
STUB_CHARGER = "01"
HTTP_OK = try_server.HTTP_OK


def read_log_from(cfg, offset):
    path = os.path.join(cfg.resolve(cfg["log"]["dir"]), cfg["log"]["file"])
    with open(path, encoding="utf-8") as f:
        f.seek(offset)
        return f.read().splitlines()


def log_size(cfg):
    path = os.path.join(cfg.resolve(cfg["log"]["dir"]), cfg["log"]["file"])
    return os.path.getsize(path) if os.path.exists(path) else 0


def recorder_failures(lines):
    out = []
    for line in lines:
        parts = line.split(LOG_SEP)
        if len(parts) > len(("시각", "어디")) and parts[1] == recorder.WHERE and FAIL_MARK in parts[len(("시각", "어디"))]:
            out.append(line)
    return out


def expected_changes(cfg, scene_name):
    folder = cfg.resolve(cfg["scenes"]["dir"])
    scene = tbconfig.read_json(os.path.join(folder, scene_name + cfg["scenes"]["line_suffix"]))
    dt = cfg["tick_interval_s"]
    changes = [(int(ev["t_s"] // dt), ev["station_id"] + recorder.CHARGER_SEP + ev["charger_id"], ev["status"])
               for ev in scene["timeline"] if ev["type"] == EV_CHARGER]
    chargers = sum(len(op["chargers"]) for place in scene["stations"] for op in place["operators"])
    return changes, chargers, scene


def detail_tables(cfg, conn):
    return {m["kind"]: m["detail_table"] for m in tbdb.masters(cfg, conn)}


def run_counts(cfg, conn, run):
    out = {}
    for kind, table in detail_tables(cfg, conn).items():
        out[kind] = conn.execute("SELECT COUNT(*) FROM " + tbdb.ident(table) + " WHERE run = ?", (run,)).fetchone()[0]
    return out


def scene_status(c):
    s, body, _ = c.call("GET", c.b["paths"]["scene"], secret=None)
    return body["status"] if s == HTTP_OK else None


def live(cfg, c, t, info):
    """다리가 도는 동안: 장면 고르기 → '이상해' 둘 → 마지막 상태 바뀜 뒤까지 기다림 → 처음부터(새 실행)."""
    d = cfg["db"]
    tr = d["try"]
    b = cfg["bridge"]
    s, body, _ = c.scene(action="select", name=tr["scene"])
    r1 = body["status"]["run"] if s == HTTP_OK else None
    info["r1"] = r1
    t.add("장면 고르기 " + tr["scene"] + " → 실행 번호", "200 · 실행 번호 있음", str(s) + " · 실행 " + str(r1),
          s == HTTP_OK and r1 is not None)

    s_ok, b_ok, _ = c.call("POST", b["paths"]["odd"], body=tr["odd_good"])
    s_bad, b_bad, _ = c.call("POST", b["paths"]["odd"], body=tr["odd_bad"])
    info["odd"] = (s_ok, b_ok, s_bad, b_bad)
    t.add("'이상해' 둘 보냄(받을 것 · 거절될 것)", "200 받음 · 400 거절",
          try_server.fail_of(s_ok, b_ok) + " / " + try_server.fail_of(s_bad, b_bad),
          s_ok == HTTP_OK and s_bad == b["fail_http"][b["codes"]["bad"]])

    changes = info["changes"]
    target = max(tick for tick, _, _ in changes) + tr["after_ticks"]
    deadline = time.monotonic() + (target + tr["after_ticks"]) * cfg["tick_interval_s"]
    st = scene_status(c)
    while st is not None and st["tick"] < target and time.monotonic() < deadline:
        time.sleep(tr["poll_s"])
        st = scene_status(c)
    reached = st is not None and st["tick"] >= target and st["run"] == r1
    t.add("실시간으로 틱 " + str(target) + " 까지 돌림(마지막 상태 바뀜 + " + str(tr["after_ticks"]) + ")",
          "같은 실행에서 그 틱에 닿음", "틱 " + str(st["tick"] if st else None) + " · 실행 " + str(st["run"] if st else None),
          reached)

    s, body, _ = c.scene(action="restart")
    r2 = body["status"]["run"] if s == HTTP_OK else None
    info["r2"] = r2
    t.add("같은 장면 처음부터 → 새 실행 번호", "200 · 앞 실행과 다른 번호", str(s) + " · 실행 " + str(r2),
          s == HTTP_OK and r2 is not None and r2 != r1)

    # 앞 실행이 닫혀 DB 에 끝이 적힐 때까지 기다린 뒤(줄 세우기는 차례대로라 그 앞 줄은 다 쓰임) 앞 실행의 줄 수를 찍어 둔다
    conn = tbdb.connect(cfg, create=False)
    try:
        rt = tbdb.ident(d["run_table"])
        wait_until = time.monotonic() + d["close_wait_s"]
        ended = None
        while time.monotonic() < wait_until:
            row = conn.execute("SELECT ended_at FROM " + rt + " WHERE run = ?", (r1,)).fetchone()
            ended = row[0] if row else None
            if ended:
                break
            time.sleep(d["flush_s"])
        info["r1_snapshot"] = run_counts(cfg, conn, r1) if ended else None
    finally:
        conn.close()
    time.sleep(tr["run2_seconds"])


def db_checks(cfg, t, info):
    d = cfg["db"]
    tr = d["try"]
    b = cfg["bridge"]
    dt = cfg["tick_interval_s"]
    rd = cfg["units"]["report_decimals"]
    r1, r2 = info.get("r1"), info.get("r2")
    conn = tbdb.connect(cfg, create=False)
    try:
        # ① 마스터
        def master_ok():
            rows = tbdb.masters(cfg, conn)
            kinds = sorted(r["kind"] for r in rows)
            errors = tbdb.check_schema(cfg, conn)
            want = sorted(d["kinds"].values())
            return ("마스터 " + str(len(rows)) + "줄 " + repr(kinds) + " · 표 정의 틀린 곳 " + str(len(errors))), \
                kinds == want and not errors
        t.check("① 마스터 줄 = 판 종류", str(len(d["kinds"])) + "줄 " + repr(sorted(d["kinds"].values())) + " · 틀린 곳 0",
                master_ok)

        tables = detail_tables(cfg, conn)

        # ② 흐름 틱 수 = 돈 초
        def flow_ok():
            run = db_peek.run_rows(cfg, conn, r1)[0]
            ticks = [r[0] for r in conn.execute("SELECT tick FROM " + tbdb.ident(tables[d["kinds"]["flow"]])
                                                + " WHERE run = ? ORDER BY id", (r1,))]
            n = len(ticks)
            steps = run["secs"] / dt
            contiguous = ticks == list(range(ticks[0], ticks[0] + n)) if ticks else False
            return ("흐름 " + str(n) + "줄(틱 " + str(ticks[0] if ticks else None) + "~" + str(ticks[-1] if ticks else None)
                    + ") · 돈 초 " + str(round(run["secs"], rd)) + " → 기대 " + str(round(steps + 1, rd)) + "줄"), \
                contiguous and abs((n - 1) - steps) <= tr["tick_tolerance"]
        t.check("② 흐름 틱 수 = 돈 초(실행 " + str(r1) + ")", "틱 0 부터 빠짐없이 · 줄 수 − 1 = 돈 초 ± " + str(tr["tick_tolerance"]),
                flow_ok)

        # ③ 충전기 상태 바뀜
        def changes_ok():
            rows = db_peek.timeline_rows(cfg, conn, r1)
            got = [(r["tick"], r["key"], r["status"]) for r in rows]
            ats = [r["at"] for r in rows]
            in_order = ats == sorted(ats) and [g[0] for g in got] == sorted(g[0] for g in got)
            codes = cfg["status_codes"]
            stat_ok = all(r["stat"] == codes[r["status"]] for r in rows)
            text = " → ".join(str(r["tick"]) + "틱 " + str(r["before"]) + ">" + r["status"] + "(" + r["stat"] + ") "
                              + str(tbdb.kst_text(cfg, r["at"])) for r in rows)
            return text, got == info["changes"] and in_order and stat_ok
        exp = " → ".join(str(tk) + "틱 " + st for tk, _, st in info["changes"])
        t.check("③ " + tr["scene"] + " 충전기 상태 바뀜 " + str(len(info["changes"])) + "번", exp + " · 시각 순서", changes_ok)

        # ④ '이상해'
        def odd_ok():
            s_ok, b_ok, s_bad, b_bad = info["odd"]
            rows = [dict(r) for r in conn.execute("SELECT * FROM " + tbdb.ident(tables[d["kinds"]["odd"]])
                                                  + " WHERE run = ? ORDER BY id", (r1,))]
            oks = [r for r in rows if r["result"] == recorder.RESULT_OK]
            bads = [r for r in rows if r["result"] == recorder.RESULT_REJECTED]
            good = (len(oks) == len(bads) == 1 and oks[0]["key"] == b_ok.get("name") and oks[0]["http"] == s_ok
                    and oks[0]["memo"] == tr["odd_good"]["memo"] and bads[0]["http"] == s_bad
                    and bads[0]["code"] == b_bad.get("code") and bool(bads[0]["why"]))
            return ("받음 " + str(len(oks)) + " (" + str(oks[0]["key"] if oks else None) + ") · 거절 " + str(len(bads)) + " ("
                    + str(bads[0]["http"] if bads else None) + " " + str(bads[0]["code"] if bads else None) + " — "
                    + str(bads[0]["why"] if bads else None) + ")"), good
        t.check("④ '이상해' 받음 1 · 거절 1", "받음 1(다리가 지은 이름 같음) · 거절 1(400 " + b["codes"]["bad"] + ", 까닭 있음)", odd_ok)

        # ⑤ 두 번 돌려도 앞 실행 그대로
        def runs_ok():
            before = info.get("r1_snapshot")
            after = run_counts(cfg, conn, r1)
            second = run_counts(cfg, conn, r2)
            runs = {r["run"]: r for r in db_peek.run_rows(cfg, conn) if r["run"] in (r1, r2)}
            ordered = runs[r1]["ended_at"] <= runs[r2]["started_at"] and runs[r1]["scene"] == runs[r2]["scene"]
            late = 0
            for table in tables.values():
                late += conn.execute("SELECT COUNT(*) FROM " + tbdb.ident(table) + " WHERE run = ? AND at > ?",
                                     (r1, runs[r1]["ended_at"])).fetchone()[0]
            start_rows = conn.execute("SELECT COUNT(*) FROM " + tbdb.ident(tables[d["kinds"]["charger"]])
                                      + " WHERE run = ? AND cause = ?", (r2, recorder.CAUSE_START)).fetchone()[0]
            return ("실행 " + str(r1) + " 앞 " + repr(before) + " / 뒤 " + repr(after) + " · 실행 " + str(r2) + " "
                    + repr(second) + " · 끝난 뒤 쓰인 줄 " + str(late)), \
                before is not None and before == after and ordered and late == 0 \
                and second[d["kinds"]["flow"]] > 0 and start_rows == info["chargers"]
        t.check("⑤ 같은 장면 두 번(실행 " + str(r1) + " → " + str(r2) + ")",
                "앞 실행 줄 수가 새 실행 뒤에도 같음 · 새 실행은 제 줄(충전기 시작 " + str(info["chargers"]) + "줄) · 끝난 뒤 쓰인 줄 0",
                runs_ok)
    finally:
        conn.close()


def broken_write_test(cfg, log, t):
    """⑦ 따로 만든 빈 DB 에 일부러 틀린 줄(표의 CHECK 에 걸리는 원인 값)을 넣는다 → 기록장에 남고, 다음 줄은 쓰이고, 쌓기는 계속."""
    tr = cfg["db"]["try"]
    folder = tempfile.mkdtemp(prefix=TEMP_PREFIX)
    path = os.path.join(folder, tr["temp_db_name"])
    start = log_size(cfg)
    try:
        rec = recorder.Recorder(cfg, log, path)
        stub = types.SimpleNamespace(name=STUB_SCENE, initial={}, data={"route": {"legs": []}})
        run = rec.new_run(stub, WHERE)
        rec.charger(0, STUB_STATION, STUB_CHARGER, next(iter(cfg["status_codes"])), tr["broken_cause"])
        rec.charger(0, STUB_STATION, STUB_CHARGER, next(iter(cfg["status_codes"])), recorder.CAUSE_EVENT)
        counts = rec.close(WHERE)
        fails = recorder_failures(read_log_from(cfg, start))
        conn = tbdb.connect(cfg, path, create=False)
        try:
            table = detail_tables(cfg, conn)[cfg["db"]["kinds"]["charger"]]
            n = conn.execute("SELECT COUNT(*) FROM " + tbdb.ident(table) + " WHERE run = ?", (run,)).fetchone()[0]
        finally:
            conn.close()
        actual = ("실패 " + str(counts["failed"]) + " · 쓰임 " + str(counts["written"]) + " · 기록장 실패 줄 " + str(len(fails))
                  + " · 남은 충전기 줄 " + str(n))
        ok = counts["failed"] == 1 and len(fails) >= 1 and n == 1
    except Exception as e:
        actual, ok = "예외 " + repr(e), False
    finally:
        shutil.rmtree(folder, ignore_errors=True)
    t.add("⑦ 쓰기 실패를 일부러 냄(빈 시험 DB)", "틀린 줄 1 만 잃음 · 기록장에 실패 줄 · 다음 줄 1 은 쓰임", actual, ok)


def main(argv):
    args = argv[1:]
    if len(args) != 1:
        print("쓰는 법: py try_db.py <설정 파일 경로>")
        return FAIL_CODE
    try:
        cfg = tbconfig.Config(args[0])
    except tbconfig.ConfigError as e:
        print(str(e))
        return FAIL_CODE
    log = tblog.from_config(cfg, cfg.resolve)
    b, tr, d = cfg["bridge"], cfg["try"], cfg["db"]
    secret = secrets.token_urlsafe()
    env = dict(os.environ)
    env[b["secret_env"]] = secret
    env["PYTHONIOENCODING"] = "utf-8"
    start = log_size(cfg)
    log.write(WHERE + ".main", "시작", config=cfg.path, run_seconds=d["try"]["run_seconds"])
    changes, chargers, _ = expected_changes(cfg, d["try"]["scene"])
    info = {"changes": changes, "chargers": chargers}
    started = time.monotonic()
    proc = subprocess.Popen([sys.executable, "-X", "utf8", cfg.resolve(b["script"]), cfg.path, str(d["try"]["run_seconds"])],
                            env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    c = try_server.Client(cfg, secret)
    t = try_server.Table(log)
    up = False
    while time.monotonic() - started < tr["health_wait_s"] and proc.poll() is None:
        try:
            s, _, _ = c.call("GET", b["paths"]["health"])
            up = s == HTTP_OK
            if up:
                break
        except (URLError, ConnectionError, OSError):
            time.sleep(tr["poll_s"])
    t.add("시험 모드로 띄움(" + str(d["try"]["run_seconds"]) + "초)", "다리가 " + str(tr["health_wait_s"]) + "초 안에 답함",
          "답함" if up else "안 답함", up)
    if up:
        try:
            live(cfg, c, t, info)
        except Exception as e:
            log.write(WHERE + ".main", "예외", error=repr(e))
            t.add("시험 진행", "끝까지", "예외 " + repr(e), False)
    limit = d["try"]["run_seconds"] + tr["exit_grace_s"]
    try:
        out, _ = proc.communicate(timeout=max(limit - (time.monotonic() - started), tr["poll_s"]))
        t.add("⑥ 다리가 스스로 끝남", "코드 0", "코드 " + str(proc.returncode), proc.returncode == OK_CODE)
    except subprocess.TimeoutExpired:
        proc.kill()
        out, _ = proc.communicate()
        t.add("⑥ 다리가 스스로 끝남", "코드 0", str(limit) + "초에도 안 끝나 죽임", False)
    text = out.decode("utf-8", "replace")
    print("--- 다리 화면 ---")
    print(text.strip())
    fails = recorder_failures(read_log_from(cfg, start))
    t.add("⑥ 쓰기 실패·버림", "기록장의 쌓기 실패 줄 0 · 다리 화면 '실패 0 · 버림 0'",
          "기록장 " + str(len(fails)) + "줄 · " + ("다리 화면 맞음" if "실패 0 · 버림 0" in text else "다리 화면 다름"),
          not fails and "실패 0 · 버림 0" in text)
    if info.get("r1") is not None and info.get("r2") is not None:
        try:
            db_checks(cfg, t, info)
        except (sqlite3.Error, tbdb.DbError, KeyError, IndexError, TypeError) as e:
            log.write(WHERE + ".main", "DB 확인 예외", error=repr(e))
            t.add("DB 확인", "끝까지", "예외 " + repr(e), False)
    broken_write_test(cfg, log, t)
    if info.get("r1") is not None:
        conn = tbdb.connect(cfg, create=False)
        try:
            print("--- 꺼내 보기: 판마다 ---")
            db_peek.print_counts(cfg, conn)
            print("--- 꺼내 보기: 실행 " + str(info["r1"]) + " 시간표 ---")
            db_peek.print_timeline(cfg, conn, str(info["r1"]))
        finally:
            conn.close()
    ok = t.print()
    log.write(WHERE + ".main", "끝", result=try_server.PASS_WORD if ok else try_server.FAIL_WORD, rows=len(t.rows))
    return OK_CODE if ok else FAIL_CODE


if __name__ == "__main__":
    sys.exit(main(sys.argv))
