"""시험 DB 바탕 — 열기·표 깔기·마스터 읽기·시각 글(파이썬 기본 모듈 sqlite3 만).

표 정의는 설정 db.schema_file 한 파일(마스터 board_master + 판마다 디테일 표). 코드는 표 이름을 박지 않고
마스터의 detail_table 과 설정의 표 이름을 읽는다. 표·칸 이름은 SQL 에 넣기 전에 꼴(영문·숫자·밑줄)을 본다.
"""
import datetime
import os
import re
import sqlite3

IDENT = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
MEMORY = ":memory:"


class DbError(Exception):
    pass


def ident(name):
    """표·칸 이름을 SQL 에 넣을 수 있게 따옴표로 감싼다. 꼴이 틀리면 DbError."""
    if not isinstance(name, str) or not IDENT.fullmatch(name):
        raise DbError("표·칸 이름 꼴이 틀림: " + repr(name))
    return '"' + name + '"'


def now_utc():
    return datetime.datetime.now(datetime.timezone.utc)


def utc_text(cfg, when=None):
    return (when or now_utc()).strftime(cfg["db"]["time_format"])


def parse_utc(cfg, text):
    return datetime.datetime.strptime(text, cfg["db"]["time_format"]).replace(tzinfo=datetime.timezone.utc)


def kst_text(cfg, text):
    """DB 의 UTC 시각 글 → 한국 시각 글(설정 kst_offset_hours · log.time_format). 빈 값은 그대로."""
    if text is None:
        return None
    when = parse_utc(cfg, text) + datetime.timedelta(hours=cfg["kst_offset_hours"])
    return when.strftime(cfg["log"]["time_format"])


def db_path(cfg):
    return cfg.resolve(cfg["db"]["path"])


def connect(cfg, path=None, create=True):
    """DB 를 연다. create 가 거짓이면 파일이 없을 때 DbError(꺼내 보기가 빈 DB 를 만들지 않게)."""
    d = cfg["db"]
    path = path or db_path(cfg)
    if path != MEMORY:
        if not create and not os.path.exists(path):
            raise DbError("DB 파일이 없음: " + path)
        folder = os.path.dirname(path)
        if folder:
            os.makedirs(folder, exist_ok=True)
    conn = sqlite3.connect(path, timeout=d["busy_timeout_s"])
    conn.row_factory = sqlite3.Row
    if path != MEMORY:
        conn.execute("PRAGMA journal_mode=" + d["journal_mode"])
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def schema_text(cfg):
    with open(cfg.resolve(cfg["db"]["schema_file"]), encoding="utf-8") as f:
        return f.read()


def apply_schema(cfg, conn):
    conn.executescript(schema_text(cfg))
    conn.execute("PRAGMA foreign_keys=ON")


def masters(cfg, conn):
    """마스터 줄 목록(dict) — kind 차례."""
    sql = "SELECT * FROM " + ident(cfg["db"]["master_table"]) + " ORDER BY kind"
    return [dict(r) for r in conn.execute(sql)]


def columns(conn, table):
    return [r[1] for r in conn.execute("PRAGMA table_info(" + ident(table) + ")")]


def check_schema(cfg, conn=None):
    """표 정의를 (메모리 DB 에) 깔아 보고 틀린 곳 목록을 돌려준다(빈 목록 = 맞음).

    - 설정의 마스터·실행·기록 표가 있나
    - 마스터 줄마다 detail_table 이 있고 공통 칸을 다 가졌나
    - 설정 db.kinds 의 판 종류가 모두 마스터에 켜져 있나
    """
    d = cfg["db"]
    own = conn is None
    errors = []
    try:
        if own:
            conn = connect(cfg, MEMORY)
            apply_schema(cfg, conn)
        for t in (d["master_table"], d["run_table"], d["log_table"]):
            if not columns(conn, t):
                errors.append("표가 없음: " + t)
        if errors:
            return errors
        rows = masters(cfg, conn)
        on = {r["kind"] for r in rows if r["on"]}
        for r in rows:
            cols = columns(conn, r["detail_table"])
            if not cols:
                errors.append("마스터 " + r["kind"] + " 의 디테일 표가 없음: " + r["detail_table"])
                continue
            missing = [c for c in d["common_columns"] if c not in cols]
            if missing:
                errors.append(r["detail_table"] + " 에 공통 칸이 없음: " + ", ".join(missing))
        for role, kind in d["kinds"].items():
            if kind not in on:
                errors.append("설정 db.kinds." + role + " = " + kind + " 이(가) 마스터에 없거나 꺼짐")
    except (sqlite3.Error, OSError, DbError) as e:
        errors.append("표 정의를 깔지 못함: " + repr(e))
    finally:
        if own and conn is not None:
            conn.close()
    return errors
