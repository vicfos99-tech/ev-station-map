"""시험 DB 쌓기 — 시험 다리가 쏜 것을 마스터-디테일 표에 쌓는다(파이썬 기본 모듈만).

- 부르는 쪽(다리의 틱·물음 줄기)은 줄을 줄 세우기(queue)에 넣기만 하고 기다리지 않는다.
- 쓰는 줄기 하나가 설정 db.flush_s 마다 깨어 db.batch_max 개씩 한 트랜잭션으로 쓴다.
- 쓰기 실패는 삼키지 않는다: 묶음이 실패하면 한 줄씩 다시 써서 틀린 줄만 잃고, 잃은 줄은 기록장에 까닭과 함께.
  다리는 계속 돈다. 줄 세우기가 차면(설정 db.queue_max) 그 줄은 버리고 기록장에(처음 한 번 + 끝에 합계).
- DB 를 열지 못하면 쌓기 없이 다리는 계속 돈다(기록장에 '쌓기 없이 계속').
판 종류 이름은 설정 db.kinds, 디테일 표 이름은 마스터 detail_table 에서 읽는다.
"""
import datetime
import json
import queue
import sqlite3
import threading
import time

import tbdb

WHERE = "recorder"
OP_SQL = "sql"
OP_ROW = "row"
ORIGIN_SCENE = "scene"
ORIGIN_INJECT = "inject"
ORIGIN_CONTROL = "control"
CAUSE_START = "start"
CAUSE_EVENT = "event"
RESULT_OK = "ok"
RESULT_REJECTED = "rejected"
LOG_OK = "ok"
EV_CHARGER = "charger_status"
KEY_SEP = ":"
CHARGER_SEP = "/"
AT_SEP = "@"
RANGE_SEP = "-"
LEG_WORD = "leg"


class Recorder:
    def __init__(self, cfg, log, path=None):
        self.cfg = cfg
        self.d = cfg["db"]
        self.log = log
        self.path = path or tbdb.db_path(cfg)
        self.q = queue.Queue(maxsize=self.d["queue_max"])
        self.lock = threading.Lock()
        self.stop = threading.Event()
        self.ok = False
        self.run = None
        self.run_t0 = None
        self.last_tick = None
        self.known = set()
        self.codes = cfg["status_codes"]
        self.counts = {"written": 0, "failed": 0, "dropped": 0}
        self.thread = None
        try:
            conn = tbdb.connect(cfg, self.path)
            try:
                tbdb.apply_schema(cfg, conn)
                errors = tbdb.check_schema(cfg, conn)
                if errors:
                    raise tbdb.DbError("; ".join(errors))
                self.master = {m["kind"]: m for m in tbdb.masters(cfg, conn)}
                self.cols = {k: set(tbdb.columns(conn, m["detail_table"])) for k, m in self.master.items()}
                row = conn.execute("SELECT MAX(run) FROM " + tbdb.ident(self.d["run_table"])).fetchone()
                self.next_run = (row[0] or 0) + 1
            finally:
                conn.close()
        except (sqlite3.Error, OSError, tbdb.DbError) as e:
            self.log.write(WHERE, "DB 못 엶 — 쌓기 없이 계속", path=self.path, error=repr(e))
            return
        self.ok = True
        self.thread = threading.Thread(target=self._loop, name=WHERE, daemon=True)
        self.thread.start()
        self.log.write(WHERE, "시작", path=self.path, next_run=self.next_run, kinds=",".join(sorted(self.master)))

    # ---- 넣기(부르는 쪽 — 기다리지 않음) ----
    def _put(self, item):
        if not self.ok:
            return
        try:
            self.q.put_nowait(item)
        except queue.Full:
            with self.lock:
                self.counts["dropped"] += 1
                first = self.counts["dropped"] == 1
            if first:
                self.log.write(WHERE, "줄 세우기 참 — 버림 시작", queue_max=self.d["queue_max"], what=item[0])

    def _text(self, value):
        text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
        return text[:self.d["text_max_chars"]]

    def row(self, role, tick, key, fields, at=None):
        """판(설정 db.kinds 의 역할 이름) 디테일 표에 한 줄. 공통 칸은 여기서 채운다."""
        kind = self.d["kinds"][role]
        when = at or tbdb.now_utc()
        stale = datetime.timedelta(seconds=self.master[kind]["stale_sec"]) if self.ok else datetime.timedelta()
        with self.lock:
            run = self.run
        if run is None:
            return
        common = {"run": run, "tick": tick, "key": key, "at": tbdb.utc_text(self.cfg, when),
                  "good_until": tbdb.utc_text(self.cfg, when + stale), "src": self.d["src_of_kind"][role]}
        self._put((OP_ROW, kind, dict(common, **fields)))

    # ---- 실행 ----
    def new_run(self, scene, why):
        """실행 하나를 연다(앞 실행은 닫는다). 시작 때의 충전기 상태와 제한 속도를 쌓는다. 실행 번호를 돌려준다."""
        if not self.ok:
            return None
        self.end_run(why)
        now = tbdb.now_utc()
        rt = tbdb.ident(self.d["run_table"])
        with self.lock:
            run = self.next_run
            self.next_run += 1
            self.run, self.run_t0, self.last_tick = run, time.monotonic(), None
            self.known = set(scene.initial)
        self._put((OP_SQL, "INSERT INTO " + rt + " (run, scene, started_at, why_start) VALUES (?, ?, ?, ?)",
                   (run, scene.name, tbdb.utc_text(self.cfg, now), why)))
        for (sid, cid), word in sorted(scene.initial.items()):
            self.charger(0, sid, cid, word, CAUSE_START, now)
        legs = scene.data["route"]["legs"]
        for lim in scene.data.get("limits", []):
            leg = legs[lim["leg"]]
            route_id = leg.get("line") or (LEG_WORD + str(lim["leg"]))
            key = route_id + KEY_SEP + str(lim["from_km"]) + RANGE_SEP + str(lim["to_km"])
            self.row("speed", 0, key, {"route_id": route_id, "km_from": lim["from_km"], "km_to": lim["to_km"],
                                       "limit_kmh": lim["limit_kmh"]}, now)
        self.log.write(WHERE, "실행 시작", run=run, scene=scene.name, why=why)
        return run

    def end_run(self, why):
        with self.lock:
            run, t0, last = self.run, self.run_t0, self.last_tick
            self.run = None
        if run is None:
            return
        secs = time.monotonic() - t0
        self._put((OP_SQL, "UPDATE " + tbdb.ident(self.d["run_table"])
                   + " SET ended_at = ?, secs = ?, last_tick = ?, why_end = ? WHERE run = ?",
                   (tbdb.utc_text(self.cfg), secs, last, why, run)))
        self.log.write(WHERE, "실행 끝", run=run, secs=round(secs, self.cfg["units"]["report_decimals"]),
                       last_tick=last, why=why)

    # ---- 판마다 ----
    def flow(self, payload):
        tick = payload["tick"]
        pos = payload.get("pos") or {}
        with self.lock:
            self.last_tick = tick
        self.row("flow", tick, str(tick), {"t_ms": pos.get("t"), "lat": pos.get("lat"), "lng": pos.get("lng"),
                                           "speed_kmh": pos.get("speed_kmh"), "heading_deg": pos.get("heading_deg"),
                                           "accuracy_m": pos.get("accuracy_m"), "down": self._text(payload["down"])})

    def event(self, tick, origin, ev):
        subject = (ev.get("source") or ev.get("target") or ev.get("station_id") or ev.get("path") or ev.get("action")
                   or ev.get("part"))
        if ev.get("type") == EV_CHARGER:
            subject = ev["station_id"] + CHARGER_SEP + ev["charger_id"]
        key = str(ev.get("type")) + KEY_SEP + str(subject)
        self.row("event", tick, key, {"origin": origin, "type": str(ev.get("type")), "subject": subject,
                                      "detail": self._text(ev)})
        if ev.get("type") == EV_CHARGER:
            sid, cid = ev["station_id"], ev["charger_id"]
            with self.lock:
                known = (sid, cid) in self.known
            if known and ev["status"] in self.codes:
                self.charger(tick, sid, cid, ev["status"], CAUSE_EVENT)
            else:
                self.log.write(WHERE, "충전기 상태 사건을 쌓지 않음(모르는 충전기·상태)", tick=tick,
                               station=sid, charger=cid, status=ev.get("status"))

    def charger(self, tick, sid, cid, word, cause, at=None):
        if word not in self.codes:
            self.log.write(WHERE, "충전기 상태 낱말을 모름 — 쌓지 않음", station=sid, charger=cid, status=word)
            return
        self.row("charger", tick, sid + CHARGER_SEP + cid,
                 {"station_id": sid, "charger_id": cid, "status": word, "stat": self.codes[word], "cause": cause}, at)

    def odd(self, tick, status, code, why, name, body):
        ok = bool(name) and not code
        now = tbdb.now_utc()
        key = name if ok else (code or str(status)) + AT_SEP + tbdb.utc_text(self.cfg, now)
        body = body if isinstance(body, dict) else {}
        state = body.get("state")
        self.row("odd", tick, key, {"result": RESULT_OK if ok else RESULT_REJECTED, "http": status, "code": code or None,
                                    "why": why or None, "client_at": self._text(body["at"]) if "at" in body else None,
                                    "memo": self._text(body["memo"]) if "memo" in body else None,
                                    "state": self._text(state) if state is not None else None}, now)

    # ---- 쓰기 줄기 ----
    def _take(self):
        items = []
        while len(items) < self.d["batch_max"]:
            try:
                items.append(self.q.get_nowait())
            except queue.Empty:
                break
        return items

    def _sql_of(self, item):
        op, what, data = item
        if op == OP_SQL:
            return what, data, None
        kind, row = what, data
        unknown = [k for k in row if k not in self.cols[kind]]
        if unknown:
            raise tbdb.DbError(self.master[kind]["detail_table"] + " 에 없는 칸: " + ", ".join(unknown))
        names = list(row)
        sql = ("INSERT INTO " + tbdb.ident(self.master[kind]["detail_table"]) + " ("
               + ", ".join(tbdb.ident(n) for n in names) + ") VALUES (" + ", ".join("?" for _ in names) + ")")
        return sql, [row[n] for n in names], kind

    def _write(self, conn, items):
        t0 = time.monotonic()
        per_kind = {}
        try:
            with conn:
                for item in items:
                    sql, params, kind = self._sql_of(item)
                    conn.execute(sql, params)
                    if kind:
                        per_kind[kind] = per_kind.get(kind, 0) + 1
                self._log_rows(conn, per_kind, t0)
            with self.lock:
                self.counts["written"] += len(items)
            return
        except (sqlite3.Error, tbdb.DbError) as e:
            self.log.write(WHERE, "묶음 쓰기 실패 — 한 줄씩 다시", n=len(items), error=repr(e))
        for item in items:
            try:
                with conn:
                    sql, params, kind = self._sql_of(item)
                    conn.execute(sql, params)
                with self.lock:
                    self.counts["written"] += 1
            except (sqlite3.Error, tbdb.DbError) as e:
                with self.lock:
                    self.counts["failed"] += 1
                self.log.write(WHERE, "쓰기 실패 — 이 줄을 잃음", what=item[1] if item[0] == OP_ROW else item[0],
                               error=repr(e), row=self._text(item[-1]))

    def _log_rows(self, conn, per_kind, t0):
        ms = round((time.monotonic() - t0) * self.cfg["units"]["ms_per_second"])
        at = tbdb.utc_text(self.cfg)
        sql = ("INSERT INTO " + tbdb.ident(self.d["log_table"]) + " (kind, at, code, n, ms) VALUES (?, ?, ?, ?, ?)")
        for kind, n in sorted(per_kind.items()):
            conn.execute(sql, (kind, at, LOG_OK, n, ms))

    def _loop(self):
        conn = None
        while True:
            stopping = self.stop.wait(self.d["flush_s"])
            while True:
                items = self._take()
                if not items:
                    break
                if conn is None:
                    try:
                        conn = tbdb.connect(self.cfg, self.path)
                    except (sqlite3.Error, OSError, tbdb.DbError) as e:
                        with self.lock:
                            self.counts["failed"] += len(items)
                        self.log.write(WHERE, "쓰기 실패 — DB 를 못 엶, 이 묶음을 잃음", n=len(items), error=repr(e))
                        continue
                self._write(conn, items)
            if stopping:
                break
        if conn is not None:
            conn.close()

    def close(self, why):
        """앞 실행을 닫고 남은 줄을 다 쓴 뒤 멈춘다(설정 db.close_wait_s 까지 기다림)."""
        if not self.ok:
            return dict(self.counts)
        self.end_run(why)
        self.stop.set()
        self.thread.join(self.d["close_wait_s"])
        with self.lock:
            counts = dict(self.counts)
        left = self.q.qsize()
        self.log.write(WHERE, "끝", written=counts["written"], failed=counts["failed"], dropped=counts["dropped"],
                       left=left, alive=self.thread.is_alive())
        return counts

    def current_run(self):
        with self.lock:
            return self.run
