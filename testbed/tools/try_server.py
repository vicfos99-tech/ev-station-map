"""시험 다리 스스로 시험 — 다리를 시험 모드로 띄우고 길마다 불러 기대한 답이 오는지 표로 찍는다(파이썬 기본 모듈만).

쓰는 법:  py tools/try_server.py <설정 파일 경로>
  예)    py tools/try_server.py config/testbed.json
- 앱 비밀 값은 이번 시험에만 쓰는 값을 새로 만들어 다리의 환경변수(설정 bridge.secret_env)로만 넘긴다.
- 다리는 설정 bridge.run_seconds 뒤 스스로 끝나야 한다 — 그것도 시험한다(끝날 때까지 기다림).
- 기록장에 비밀 값이 남지 않았는지도 본다.
하나라도 실패면 0 아닌 코드로 끝난다. 시작·끝·실패 줄은 기록장에.
"""
import json
import os
import secrets
import subprocess
import sys
import time
from http import HTTPStatus
from urllib.error import HTTPError, URLError
from urllib.parse import urlunsplit
from urllib.request import Request, urlopen

import check_scenes
import tbconfig
import tblog

WHERE = "try_server"
OK_CODE = 0
FAIL_CODE = 1
SCHEME = "http"
HTTP_OK = HTTPStatus.OK
HTTP_NO_CONTENT = HTTPStatus.NO_CONTENT
PASS_WORD = "통과"
FAIL_WORD = "실패"


class Client:
    def __init__(self, cfg, secret):
        self.cfg = cfg
        self.b = cfg["bridge"]
        self.secret = secret
        self.timeout = cfg["try"]["http_timeout_s"]
        self.netloc = cfg["server"]["host"] + ":" + str(cfg["server"]["port"])

    def url(self, path):
        return urlunsplit((SCHEME, self.netloc, path, "", ""))

    def call(self, method, path, body=None, secret="keep", headers=None, raw=None):
        """(HTTP 코드, JSON 답 또는 None, 머리). secret: 'keep' 이 시험 값, None 이면 안 붙임, 글이면 그 값."""
        h = dict(headers or {})
        value = self.secret if secret == "keep" else secret
        if value is not None:
            h[self.b["secret_header"]] = value
        data = raw
        if body is not None:
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
            h["Content-Type"] = "application/json"
        req = Request(self.url(path), data=data, method=method, headers=h)
        try:
            with urlopen(req, timeout=self.timeout) as r:
                text = r.read().decode("utf-8")
                return r.status, (json.loads(text) if text else None), dict(r.headers)
        except HTTPError as e:
            text = e.read().decode("utf-8")
            return e.code, (json.loads(text) if text else None), dict(e.headers)

    def data(self, name):
        return self.call("GET", self.b["paths"]["data"] + name)

    def scene(self, **body):
        return self.call("POST", self.b["paths"]["scene"], body=body, secret=None)


class Sse:
    """서버 보냄 이벤트 읽개 — (event, data) 를 하나씩."""

    def __init__(self, client):
        self.r = urlopen(Request(client.url(client.b["paths"]["stream"])), timeout=client.timeout)

    def next(self):
        event, data = None, []
        while True:
            line = self.r.readline().decode("utf-8")
            if not line:
                raise EOFError("흐름이 닫힘")
            line = line.rstrip("\r\n")
            if not line:
                if event is not None:
                    return event, json.loads("".join(data))
                continue
            if line.startswith(":"):
                continue
            key, _, value = line.partition(":")
            value = value.lstrip(" ")
            if key == "event":
                event = value
            elif key == "data":
                data.append(value)

    def until(self, kind, limit, pred=None):
        """kind 이벤트 가운데 pred 가 참인 것을 limit 개 안에서 찾는다. 못 찾으면 None."""
        seen = 0
        while seen < limit:
            event, data = self.next()
            if event != kind:
                continue
            seen += 1
            if pred is None or pred(data):
                return data
        return None

    def close(self):
        self.r.close()


class Table:
    def __init__(self, log):
        self.rows = []
        self.log = log

    def add(self, what, expect, actual, ok):
        self.rows.append((what, expect, str(actual), bool(ok)))
        self.log.write(WHERE + ".row", PASS_WORD if ok else FAIL_WORD, what=what, expect=expect, actual=actual)

    def check(self, what, expect, fn):
        """fn() → (실제 글, 통과). 예외도 실패로 적는다(삼키지 않고 표·기록장에)."""
        try:
            actual, ok = fn()
        except Exception as e:
            actual, ok = "예외 " + repr(e), False
        self.add(what, expect, actual, ok)

    def print(self):
        print("| # | 무엇 | 기대 | 실제 | 결과 |")
        print("|---|---|---|---|---|")
        for i, (what, expect, actual, ok) in enumerate(self.rows, 1):
            print("| " + str(i) + " | " + what + " | " + expect + " | " + actual.replace("|", "/") + " | "
                  + (PASS_WORD if ok else FAIL_WORD) + " |")
        bad = sum(1 for r in self.rows if not r[-1])
        print("스스로 시험: " + (PASS_WORD if not bad else FAIL_WORD + " " + str(bad)) + " / 모두 " + str(len(self.rows)))
        return not bad


def fail_of(status, body):
    return str(status) + " " + (json.dumps(body, ensure_ascii=False) if body is not None else "")


def is_fail(cfg, status, body, code, src):
    b = cfg["bridge"]
    return (status == b["fail_http"][code] and isinstance(body, dict) and body.get("ok") is False
            and body.get("code") == code and body.get("src") == src)


def summary_of(cfg, name):
    ctx = check_scenes.Ctx(cfg)
    folder = cfg.resolve(cfg["scenes"]["dir"])
    _, summary = check_scenes.check_scene(os.path.join(folder, name + cfg["scenes"]["line_suffix"]), ctx, [name])
    return summary


def first_charger_event(cfg, name):
    folder = cfg.resolve(cfg["scenes"]["dir"])
    scene = tbconfig.read_json(os.path.join(folder, name + cfg["scenes"]["line_suffix"]))
    zs = {op["station_id"]: op.get("zscode") for place in scene["stations"] for op in place["operators"]}
    for ev in scene["timeline"]:
        if ev["type"] == "charger_status":
            return ev, zs[ev["station_id"]], scene
    return None, None, scene


def stat_in(body, sid, cid):
    return body["s"][sid][cid]


def run_tests(cfg, c, t):
    b = cfg["bridge"]
    tr = cfg["try"]
    codes = cfg["status_codes"]
    gate, data_src, home = b["gate_source"], tr["drop_source"], tr["drop_source_home"]
    lock, bad, none = b["codes"]["lock"], b["codes"]["bad"], b["codes"]["none"]
    fs = tr["files"]
    P = b["paths"]

    # ---- 살아 있나 · 비밀 값 ----
    def health_ok():
        s, body, _ = c.call("GET", b["paths"]["health"])
        good = b["health_words"]["good"]
        return fail_of(s, body), s == HTTP_OK and body["ok"] is True and set(body["src"].values()) == {good} \
            and body["v"] == b["v"] and bool(body["at"])
    t.check(P["health"] + " (비밀 값 맞음)", "200 · ok 참 · src 모두 good", health_ok)
    t.check(P["health"] + " 비밀 값 없음", "401 lock · src gate", lambda: (lambda r: (fail_of(r[0], r[1]), is_fail(cfg, r[0], r[1], lock, gate)))(
        c.call("GET", b["paths"]["health"], secret=None)))
    for i in range(tr["wrong_tries"] - 1):
        c.call("GET", b["paths"]["health"], secret=c.secret + "x")
    t.check(P["health"] + " 비밀 값 틀림", "401 lock · src gate", lambda: (lambda r: (fail_of(r[0], r[1]), is_fail(cfg, r[0], r[1], lock, gate)))(
        c.call("GET", b["paths"]["health"], secret=c.secret + "x")))

    # ---- S1 흐름 ----
    a = tr["scene_a"]
    s, body, _ = c.scene(action="select", name=a)
    summ = summary_of(cfg, a)

    def s1_len():
        st = body["status"]
        n = st["last_tick"] + 1
        return (a + " 틱 " + str(n) + " · 장면 검사기 " + str(summ["ticks"]),
                s == HTTP_OK and abs(n - summ["ticks"]) <= tr["tick_tolerance"])
    t.check("조종: 장면 고르기 " + a + " · 길 펴기", "200 · 틱 수가 장면 검사기와 같음(± " + str(tr["tick_tolerance"]) + ")", s1_len)

    def s1_stream():
        sse = Sse(c)
        try:
            hello_ev, hello = sse.next()
            ticks = [sse.until(b["stream_events"]["tick"], 1) for _ in range(tr["stream_ticks"])]
        finally:
            sse.close()
        nums = [x["tick"] for x in ticks]
        g = cfg["geo"]
        pos_ok = all(x["pos"] and g["lat_min"] <= x["pos"]["lat"] <= g["lat_max"] and g["lng_min"] <= x["pos"]["lng"] <= g["lng_max"]
                     and x["pos"]["speed_kmh"] > 0 and x["pos"]["heading_deg"] is not None and x["pos"]["accuracy_m"] > 0
                     for x in ticks)
        moved = ticks[0]["pos"]["lat"] != ticks[-1]["pos"]["lat"] or ticks[0]["pos"]["lng"] != ticks[-1]["pos"]["lng"]
        last = ticks[-1]["pos"]
        actual = ("hello " + hello["scene"] + " · 틱 " + repr(nums) + " · 마지막 자리 " + repr([last["lat"], last["lng"]])
                  + " 시속 " + str(last["speed_kmh"]) + " 방향 " + str(last["heading_deg"]))
        return actual, hello_ev == b["stream_events"]["hello"] and nums == list(range(nums[0], nums[0] + len(nums))) \
            and pos_ok and moved
    t.check("흐름 " + a + " " + str(tr["stream_ticks"]) + " 틱", "hello 뒤 이어진 틱 번호 · 자리·시속·방향·정확도 · 자리가 움직임", s1_stream)

    # ---- 자료 길 ----
    ev, zs, s5 = first_charger_event(cfg, tr["scene_b"])
    sid, cid = ev["station_id"], ev["charger_id"]

    def meta_ok():
        s, body, _ = c.data(fs["meta"])
        return fail_of(s, body), s == HTTP_OK and body["ok"] is True and body["v"] == b["v"] and len(body["at"]) == len(body["stations_at"])
    t.check(P["data"] + fs["meta"], "200 · 중계 meta 꼴(v·at·ok·fresh)", meta_ok)

    def stations_ok():
        s, body, _ = c.data(fs["stations"].format(zs))
        found = [st for st in body["stations"] if st["id"] == sid] if s == HTTP_OK else []
        ids = [ch["id"] for ch in found[0]["chargers"]] if found else []
        return str(s) + " " + sid + " 충전기 " + repr(ids), s == HTTP_OK and body["zscode"] == zs and bool(found)
    t.check(P["data"] + fs["stations"].format(zs), "200 · " + sid + " 가 실제 충전기 id 로", stations_ok)
    t.check(P["data"] + " 허용 밖 이름(../config)", "400 bad · src gate",
            lambda: (lambda r: (fail_of(r[0], r[1]), is_fail(cfg, r[0], r[1], bad, gate)))(c.data(fs["outside"])))
    t.check(P["data"] + " 장면에 없는 시군구", "404 none · src data",
            lambda: (lambda r: (fail_of(r[0], r[1]), is_fail(cfg, r[0], r[1], none, data_src)))(c.data(fs["stations"].format(fs["missing_zscode"]))))

    # ---- 묻는 길 ----
    def place_ok():
        s, body, _ = c.call("POST", b["paths"]["place"], body={"q": tr["place_q"]})
        return str(s) + " 찾은 곳 " + str(len(body.get("places", []))), s == HTTP_OK and body["ok"] is True and body["places"]
    t.check(P["place"] + "", "200 · 찾은 곳 1개 이상", place_ok)
    t.check(P["place"] + " 모르는 칸", "400 bad · src home",
            lambda: (lambda r: (fail_of(r[0], r[1]), is_fail(cfg, r[0], r[1], bad, home)))(
                c.call("POST", b["paths"]["place"], body={"q": tr["place_q"], "x": True})))

    def route_ok():
        s, body, _ = c.call("POST", b["paths"]["route"], body={"from": s5_from, "to": s5_to})
        km = summ["km"]
        return (str(s) + " 조각 " + str(len(body.get("pieces", []))) + " · " + str(body.get("dist_km")) + " km(장면 "
                + str(round(km, cfg["units"]["report_decimals"])) + ")",
                s == HTTP_OK and body["ok"] is True and body["pieces"] and
                round(body["dist_km"], cfg["units"]["report_decimals"]) == round(km, cfg["units"]["report_decimals"]))
    s5_from, s5_to = s5["stations"][0]["loc"], s5["stations"][-1]["loc"]
    t.check(P["route"] + " (" + a + " 길)", "200 · 조각 있음 · 거리 = 장면 길이", route_ok)
    t.check(P["route"] + " 범위 밖 좌표", "400 bad · src home",
            lambda: (lambda r: (fail_of(r[0], r[1]), is_fail(cfg, r[0], r[1], bad, home)))(
                c.call("POST", b["paths"]["route"], body={"from": [0, 0], "to": s5_to})))

    def odd_ok():
        s, body, _ = c.call("POST", b["paths"]["odd"], body={"v": b["v"], "at": "t", "memo": "시험", "state": {}})
        return fail_of(s, body), s == HTTP_OK and body["ok"] is True and bool(body.get("name"))
    t.check(P["odd"] + " 받음", "200 · ok 참 · 서버가 지은 이름", odd_ok)
    t.check(P["odd"] + " 거절(모르는 칸)", "400 bad · src home",
            lambda: (lambda r: (fail_of(r[0], r[1]), is_fail(cfg, r[0], r[1], bad, home)))(
                c.call("POST", b["paths"]["odd"], body={"v": b["v"], "at": "t", "evil": "x"})))
    t.check("방식 틀림(GET /v1/route)", "400 bad · src gate",
            lambda: (lambda r: (fail_of(r[0], r[1]), is_fail(cfg, r[0], r[1], bad, gate)))(c.call("GET", b["paths"]["route"])))
    t.check("물음 크기 한도 넘음", "400 bad · src gate",
            lambda: (lambda r: (fail_of(r[0], r[1]), is_fail(cfg, r[0], r[1], bad, gate)))(
                c.call("POST", b["paths"]["odd"], raw=b"{" + b" " * b["max_body_bytes"] + b"}")))

    def cors_ok():
        origin = b["allowed_origins"][0]
        s, _, h = c.call("OPTIONS", b["paths"]["route"], secret=None, headers={"Origin": origin})
        allow = h.get("Access-Control-Allow-Origin")
        heads = h.get("Access-Control-Allow-Headers", "")
        return str(s) + " " + str(allow) + " · " + heads, s == HTTP_NO_CONTENT and allow == origin and b["secret_header"] in heads
    t.check("사전 물음(OPTIONS) 허용 출처", "204 · Allow-Origin 이 그 출처 · 비밀 값 머리 허용", cors_ok)
    t.check("허용 밖 출처", "400 bad · src gate",
            lambda: (lambda r: (fail_of(r[0], r[1]), is_fail(cfg, r[0], r[1], bad, gate)))(
                c.call("GET", b["paths"]["health"], headers={"Origin": tr["bad_origin"]})))

    # ---- S5 상태 바뀜: 흐름과 /v1/data 둘 다 ----
    name_b = tr["scene_b"]
    c.scene(action="select", name=name_b)
    c.scene(action="pause")
    ev_tick = int(ev["t_s"] // cfg["tick_interval_s"])
    c.scene(action="seek", tick=ev_tick - tr["seek_lead_ticks"])
    before_code = codes[s5_initial(s5, sid, cid)]
    after_code = codes[ev["status"]]

    def s5_before():
        s, body, _ = c.data(fs["status"].format(zs))
        got = stat_in(body, sid, cid)
        return str(s) + " " + sid + "/" + cid + " " + repr(got), s == HTTP_OK and got[0] == before_code and got[-1] is None
    t.check(name_b + " 바뀌기 전 /v1/data/status/" + zs, "stat " + before_code + " · 지금 충전 시작 없음", s5_before)

    def s5_stream():
        sse = Sse(c)
        try:
            c.scene(action="resume")
            hit = sse.until(b["stream_events"]["tick"], tr["stream_wait_ticks"],
                            lambda d: any(e["type"] == "charger_status" and e["station_id"] == sid for e in d["events"]))
        finally:
            sse.close()
        if hit is None:
            return "흐름에 사건이 안 옴", False
        e = [x for x in hit["events"] if x["type"] == "charger_status"][0]
        return ("틱 " + str(hit["tick"]) + " 사건 " + e["status"] + " stat " + e.get("stat", "")), \
            hit["tick"] == ev_tick and e.get("stat") == after_code
    t.check(name_b + " 흐름의 상태 바뀜", "틱 " + str(ev_tick) + " 에 charger_status · stat " + after_code, s5_stream)

    def s5_after():
        s, body, _ = c.data(fs["status"].format(zs))
        got = stat_in(body, sid, cid)
        s2, rest, _ = c.data(fs["rest"].format(sid))
        row = [r for r in rest["chargers"] if r["chgerId"] == cid][0] if s2 == HTTP_OK else {}
        return (str(s) + " " + repr(got) + " · rest " + str(s2) + " " + str(row.get("stat")),
                s == HTTP_OK and got[0] == after_code and got[-1] is not None and row.get("stat") == after_code)
    t.check(name_b + " 바뀐 뒤 /v1/data(시군구·휴게소 둘)", "stat " + after_code + " · 지금 충전 시작 있음", s5_after)

    # ---- 끊김 사건 → 길이 정말 실패 ----
    def drop_data():
        sse = Sse(c)
        try:
            sse.until(b["stream_events"]["tick"], 1)
            c.scene(action="inject", event={"type": "source_down", "source": data_src, "reason": "시험"})
            hit = sse.until(b["stream_events"]["tick"], tr["stream_wait_ticks"],
                            lambda d: any(e["type"] == "source_down" for e in d["events"]))
        finally:
            sse.close()
        s, body, _ = c.data(fs["meta"])
        s2, body2, _ = c.call("GET", b["paths"]["health"])
        s3, _, _ = c.call("POST", b["paths"]["place"], body={"q": tr["place_q"]})
        return ("흐름 " + ("사건 옴" if hit else "사건 안 옴") + " · data " + fail_of(s, body) + " · health ok=" + str(body2.get("ok"))
                + " · place " + str(s3)), \
            hit is not None and is_fail(cfg, s, body, b["down_code"][data_src], data_src) and body2["ok"] is False \
            and body2["src"][data_src] == b["health_words"]["bad"] and s3 == HTTP_OK
    t.check("끊김: 자료 길(data) 끊김 사건", "흐름에 사건 · /v1/data 502 upstream · health data bad · 집 길은 그대로",
            drop_data)

    def up_data():
        c.scene(action="inject", event={"type": "source_up", "source": data_src})
        s, body, _ = c.data(fs["meta"])
        return str(s), s == HTTP_OK
    t.check("복구: 자료 길(data) 돌아옴", P["data"] + " 200", up_data)

    def drop_home():
        c.scene(action="inject", event={"type": "source_down", "source": home})
        s, body, _ = c.call("POST", b["paths"]["route"], body={"from": s5_from, "to": s5_to})
        s2, _, _ = c.data(fs["meta"])
        c.scene(action="inject", event={"type": "source_up", "source": home})
        s3, _, _ = c.call("POST", b["paths"]["route"], body={"from": s5_from, "to": s5_to})
        return ("route " + fail_of(s, body) + " · data " + str(s2) + " · 돌아온 뒤 route " + str(s3)), \
            is_fail(cfg, s, body, b["down_code"][home], home) and s2 == HTTP_OK and s3 == HTTP_OK
    t.check("끊김: 집 PC(home) 끊김 → 복구", "route 504 home_off · src home · 자료 길 그대로 · 돌아오면 200", drop_home)

    def drop_gate():
        c.scene(action="inject", event={"type": "source_down", "source": gate})
        try:
            c.call("GET", b["paths"]["health"])
            closed = False
        except (URLError, ConnectionError, OSError):
            closed = True
        c.scene(action="inject", event={"type": "source_up", "source": gate})
        s, _, _ = c.call("GET", b["paths"]["health"])
        return ("끊김 때 " + ("연결 닫힘" if closed else "답이 옴") + " · 돌아온 뒤 " + str(s)), closed and s == HTTP_OK
    t.check("끊김: 다리 자체(gate) → 복구", "답 없이 연결 닫힘 · 돌아오면 200", drop_gate)

    def startup_fail():
        c.scene(action="inject", event={"type": "startup_fail", "target": "stations"})
        s, body, _ = c.data(fs["stations"].format(zs))
        c.scene(action="inject", event={"type": "startup_fail", "target": "app_secret"})
        s2, body2, _ = c.call("GET", b["paths"]["health"])
        c.scene(action="restart")
        s3, _, _ = c.data(fs["stations"].format(zs))
        return ("stations " + fail_of(s, body) + " · health " + fail_of(s2, body2) + " · 처음부터 뒤 " + str(s3)), \
            is_fail(cfg, s, body, b["down_code"][data_src], data_src) and is_fail(cfg, s2, body2, lock, gate) and s3 == HTTP_OK
    t.check("켤 때 실패(stations·app_secret) → 처음부터", "목록 502 upstream · 비밀 값 401 lock · 처음부터 뒤 200", startup_fail)

    # ---- 맨 끝: 틀린 비밀 값이 이어지면 막힘(이 뒤로는 묻지 않는다) ----
    def block():
        for _ in range(b["lock_max_wrong"]):
            c.call("GET", b["paths"]["health"], secret=c.secret + "x")
        s, body, _ = c.call("GET", b["paths"]["health"])
        return fail_of(s, body), is_fail(cfg, s, body, b["codes"]["busy"], gate)
    t.check("틀린 비밀 값 " + str(b["lock_max_wrong"]) + "번 뒤 맞는 값", "429 busy · src gate(그 주소 막힘)", block)


def s5_initial(scene, sid, cid):
    for place in scene["stations"]:
        for op in place["operators"]:
            if op["station_id"] == sid:
                for ch in op["chargers"]:
                    if ch["id"] == cid:
                        return ch["status"]
    raise KeyError(sid + "/" + cid)


def main(argv):
    args = argv[1:]
    if len(args) != 1:
        print("쓰는 법: py try_server.py <설정 파일 경로>")
        return FAIL_CODE
    try:
        cfg = tbconfig.Config(args[0])
    except tbconfig.ConfigError as e:
        print(str(e))
        return FAIL_CODE
    log = tblog.from_config(cfg, cfg.resolve)
    b, tr = cfg["bridge"], cfg["try"]
    secret = secrets.token_urlsafe()
    env = dict(os.environ)
    env[b["secret_env"]] = secret
    env["PYTHONIOENCODING"] = "utf-8"
    log.write(WHERE + ".main", "시작", config=cfg.path)
    started = time.monotonic()
    proc = subprocess.Popen([sys.executable, "-X", "utf8", cfg.resolve(b["script"]), cfg.path], env=env,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    c = Client(cfg, secret)
    t = Table(log)
    up = False
    while time.monotonic() - started < tr["health_wait_s"] and proc.poll() is None:
        try:
            s, _, _ = c.call("GET", b["paths"]["health"])
            up = s == HTTP_OK
            if up:
                break
        except (URLError, ConnectionError, OSError):
            time.sleep(tr["poll_s"])
    t.add("시험 모드로 띄움", "다리가 " + str(tr["health_wait_s"]) + "초 안에 답함", "답함" if up else "안 답함", up)
    if up:
        try:
            run_tests(cfg, c, t)
        except Exception as e:
            log.write(WHERE + ".main", "예외", error=repr(e))
            t.add("시험 진행", "끝까지", "예외 " + repr(e), False)
    limit = b["run_seconds"] + tr["exit_grace_s"]
    try:
        out, _ = proc.communicate(timeout=max(limit - (time.monotonic() - started), tr["poll_s"]))
        ended = round(time.monotonic() - started, cfg["units"]["report_decimals"])
        t.add("시험 모드 스스로 끝남", str(b["run_seconds"]) + "초 뒤 코드 0 으로 끝남",
              str(ended) + "초 · 코드 " + str(proc.returncode), proc.returncode == OK_CODE and ended >= b["run_seconds"])
    except subprocess.TimeoutExpired:
        proc.kill()
        out, _ = proc.communicate()
        t.add("시험 모드 스스로 끝남", str(b["run_seconds"]) + "초 뒤 코드 0 으로 끝남", str(limit) + "초에도 안 끝나 죽임", False)
    text = out.decode("utf-8", "replace")
    print("--- 다리 화면 ---")
    print(text.strip())
    with open(os.path.join(cfg.resolve(cfg["log"]["dir"]), cfg["log"]["file"]), encoding="utf-8") as f:
        leaked = secret in f.read()
    t.add("기록장에 비밀 값 없음", "이번 비밀 값이 기록장에 0번", "있음" if leaked else "0번", not leaked)
    ok = t.print()
    log.write(WHERE + ".main", "끝", result=PASS_WORD if ok else FAIL_WORD, rows=len(t.rows))
    return OK_CODE if ok else FAIL_CODE


if __name__ == "__main__":
    sys.exit(main(sys.argv))
