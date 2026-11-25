"""시험 다리 — 앱이 다리에 묻는 길 다섯 + 1초 흐름 + 조종 길(파이썬 기본 모듈만).

쓰는 법:  py server/bridge.py <설정 파일 경로>
  예)    py server/bridge.py config/testbed.json
  - 앱 비밀 값은 설정 bridge.secret_env 이름의 환경변수에서 읽는다(설정·코드에 값이 없다). 없으면 시작하지 않는다.
  - 시험 모드만 있다: 설정 bridge.run_seconds 초 뒤 스스로 끝난다.

길(이름·방식은 설정 bridge.paths·methods — 설계 5-5 (가)):
  GET  /v1/data/<파일>   중계 꼴 그대로(meta·stations/<시군구>·status/<시군구>·status/rest/<id>) — 장면의 충전소와 지금 상태
  POST /v1/place        장면(없으면 기본 답 파일)의 정해 둔 답
  POST /v1/route        같음 — 기본은 장면의 길을 우리 모양 길 답으로
  POST /v1/odd          '이상해' 기록 받음·거절
  GET  /v1/health       {v, ok, at, src:{data, home}}
  GET  /v1/test/stream  서버 보냄 이벤트: 틱마다 위치·속도·방향·정확도와 그 틱의 사건
  GET|POST /v1/test/scene  지금 상태 / {action: select·restart·pause·resume·seek·inject}
들어올 때 검사(설계 5-5 (다) 차례): 허용 출처 → 막힌 주소 → 앱 비밀 값 → 아는 길 → 방식 → 크기 → 출처 끊김.
실패 답은 설계 꼴 {v, ok:false, code, src}. 모든 물음의 시작·끝·결과는 기록장에(비밀 값·물음 본문은 싣지 않음).
"""
import datetime
import hmac
import json
import os
import re
import sys
import threading
import time
import traceback
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

TOOLS_DIR = "tools"
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir, TOOLS_DIR))

import relay_view  # noqa: E402
import scene_play  # noqa: E402
import schemacheck  # noqa: E402
import tbconfig  # noqa: E402
import tblog  # noqa: E402

WHERE = "bridge"
OK_CODE = 0
FAIL_CODE = 1
SCENE_NAME_KEY = "name"
ACTIONS = ("select", "restart", "pause", "resume", "seek", "inject", "status")
SSE_SEP = "\n"


class Fail(Exception):
    """정한 실패 답으로 끝낼 때 던진다."""

    def __init__(self, code, src, why=""):
        super().__init__(code)
        self.code = code
        self.src = src
        self.why = why


class Bridge:
    def __init__(self, cfg, log, secret):
        self.cfg = cfg
        self.b = cfg["bridge"]
        self.log = log
        self._secret = secret.encode("utf-8")
        self.player = scene_play.Player(cfg)
        self.stop = threading.Event()
        self.lock = threading.Lock()
        self.wrong = {}
        self.blocked = {}
        self.odd_count = 0
        self.offset = datetime.timedelta(hours=cfg["kst_offset_hours"])
        self.file_rx = {k: re.compile(v) for k, v in self.b["data_files"].items()}
        schema = tbconfig.read_json(cfg.resolve(cfg["scenes"]["schema_file"]))
        self.response_schema = schema["$defs"]["response"]
        self.schema_root = schema
        self.defaults = self._load_responses(tbconfig.read_json(cfg.resolve(self.b["default_responses_file"])),
                                             self.b["default_responses_file"])

    # ---- 바탕 ----
    def _load_responses(self, data, label):
        known = set(self.b["paths"].values())
        out = {}
        for path, items in data.items():
            if path not in known:
                continue
            for i, r in enumerate(items):
                errors = schemacheck.validate(r, self.response_schema, self.schema_root)
                if errors:
                    raise tbconfig.ConfigError(label + " " + path + "[" + str(i) + "]: " + "; ".join(errors))
            out[path] = items
        return out

    def text_at(self, when):
        return (when + self.offset).strftime(self.b["relay_time_format"])

    def now_text(self):
        return self.text_at(datetime.datetime.now(datetime.timezone.utc))

    def fail_body(self, code, src):
        return {"v": self.b["v"], "ok": False, "code": code, "src": src}

    def check_secret(self, value):
        return value is not None and hmac.compare_digest(value.encode("utf-8"), self._secret)

    # ---- 길 고르기 ----
    def route_name(self, path):
        p = self.b["paths"]
        if path.startswith(p["data"]):
            return "data"
        for name, value in p.items():
            if name != "data" and path == value:
                return name
        return None

    def ensure_source(self, name, snap):
        src = self.b["source_of_path"].get(name)
        if src is not None and src in snap["state"]["down"]:
            raise Fail(self.b["down_code"][src], src, "출처 끊김")

    # ---- 정해 둔 답 ----
    def pick(self, path, snap, text):
        src = self.b["source_of_path"].get(self.route_name(path), self.b["gate_source"])
        scene_resp = snap["scene"].data.get("responses", {})
        items = scene_resp.get(path) or self.defaults.get(path)
        if not items:
            raise Fail(self.b["codes"]["none"], src, "정해 둔 답이 없음")
        mode = snap["state"]["modes"].get(path, items[0]["mode"])
        for r in items:
            if r["mode"] == mode and ("match" not in r or re.search(r["match"], text)):
                return r
        raise Fail(self.b["codes"]["none"], src, "mode 에 맞는 답이 없음")

    def answer_body(self, r, snap, body):
        build = r.get("build")
        if build == "scene_route":
            pieces = scene_play.route_pieces(self.cfg, snap["scene"].data)
            nd = self.cfg["units"]["coord_decimals"]
            for pc in pieces:
                pc["line"] = [[round(a, nd), round(b, nd)] for a, b in pc["line"]]
                pc["km"] = round(pc["km"], self.cfg["units"]["report_decimals"])
            now = self.now_text()
            return {"v": self.b["v"], "ok": True, "source": self.b["route_source"], "at": now, "stored_at": now,
                    "dist_km": round(sum(pc["km"] for pc in pieces), self.cfg["units"]["report_decimals"]),
                    "pieces": pieces}
        if build == "odd_check":
            return self.odd_accept(body)
        if "body_file" in r:
            folder = self.cfg.resolve(self.cfg["scenes"]["dir"])
            target = os.path.normpath(os.path.join(folder, r["body_file"]))
            if os.path.commonpath([target, folder]) != folder:
                raise Fail(self.b["codes"]["gate"], self.b["gate_source"], "body_file 이 장면 폴더 밖")
            return tbconfig.read_json(target)
        return r.get("body", {})

    def odd_accept(self, body):
        o = self.b["odd"]
        home = self.b["source_of_path"]["odd"]
        bad = self.b["codes"]["bad"]
        unknown = [k for k in body if k not in o["fields"]]
        missing = [k for k in o["required"] if k not in body]
        if unknown or missing:
            raise Fail(bad, home, "모르는 칸 " + repr(unknown) + " · 빠진 칸 " + repr(missing))
        if body["v"] != self.b["v"]:
            raise Fail(bad, home, "판 번호가 다름")
        memo = body.get("memo", "")
        if not isinstance(memo, str) or len(memo) > o["memo_max_chars"] or any(ord(c) < ord(" ") for c in memo):
            raise Fail(bad, home, "메모 꼴·길이·제어 문자")
        if "state" in body and not isinstance(body["state"], dict):
            raise Fail(bad, home, "state 가 객체가 아님")
        with self.lock:
            if self.odd_count >= o["max_per_run"]:
                raise Fail(self.b["codes"]["busy"], home, "받는 개수 한도")
            self.odd_count += 1
            seq = self.odd_count
        name = (datetime.datetime.now(datetime.timezone.utc) + self.offset).strftime(o["name_format"]) + str(seq)
        return {"v": self.b["v"], "ok": True, "name": name}

    # ---- 길마다 ----
    def do_data(self, rest, snap):
        b = self.b
        src = b["source_of_path"]["data"]
        if len(rest) > b["data_file_max_chars"]:
            raise Fail(b["codes"]["bad"], b["gate_source"], "파일 이름이 김")
        kind, m = None, None
        for k, rx in self.file_rx.items():
            m = rx.fullmatch(rest)
            if m:
                kind = k
                break
        if kind is None:
            raise Fail(b["codes"]["bad"], b["gate_source"], "허용 목록 밖 파일 이름")
        for target in snap["state"]["startup_fail"]:
            if kind in b["startup_fail_files"].get(target, []):
                raise Fail(b["codes"]["upstream"], src, "켤 때 실패: " + target)
        scene = snap["scene"]
        player = self.player

        def when(tick):
            return self.text_at(snap["start_wall"] + datetime.timedelta(seconds=tick * player.dt))

        codes = self.cfg["status_codes"]
        chargers = snap["state"]["chargers"]
        if kind == "meta":
            out = relay_view.meta(scene.operators, b["v"], when(snap["tick"]), when(0))
        elif kind == "stations":
            out = relay_view.stations(scene.operators, m.group(1), b["v"])
        elif kind == "status":
            out = relay_view.status(scene.operators, chargers, m.group(1), codes, when)
        else:
            out = relay_view.status_rest(scene.operators, chargers, m.group(1), codes, when)
        if out is None:
            raise Fail(b["codes"]["none"], src, "장면에 없는 파일")
        return out

    def do_health(self, snap):
        down = snap["state"]["down"]
        w = self.b["health_words"]
        srcs = {s: (w["bad"] if s in down else w["good"]) for s in sorted(set(self.b["source_of_path"].values()))}
        return {"v": self.b["v"], "ok": all(v == w["good"] for v in srcs.values()), "at": self.now_text(), "src": srcs}

    def _latlng_ok(self, v):
        g = self.cfg["geo"]
        return (isinstance(v, list) and len(v) == len(("lat", "lng"))
                and all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in v)
                and g["lat_min"] <= v[0] <= g["lat_max"] and g["lng_min"] <= v[1] <= g["lng_max"])

    def do_ask(self, name, body, snap):
        b = self.b
        home = b["source_of_path"][name]
        bad = b["codes"]["bad"]
        text = ""
        if name == "place":
            q = body.get("q")
            if set(body) != {"q"} or not isinstance(q, str) or not q.strip() or len(q) > b["place_q_max_chars"]:
                raise Fail(bad, home, "q 꼴·길이")
            text = q
        elif name == "route":
            if set(body) != {"from", "to"} or not (self._latlng_ok(body["from"]) and self._latlng_ok(body["to"])):
                raise Fail(bad, home, "from·to 꼴·범위")
        r = self.pick(b["paths"][name], snap, text)
        if r["delay_ms"]:
            time.sleep(r["delay_ms"] / self.cfg["units"]["ms_per_second"])
        return r["status"], self.answer_body(r, snap, body)

    def do_scene(self, method, body):
        if method == "POST":
            action = body.get("action")
            if action not in ACTIONS:
                raise Fail(self.b["codes"]["bad"], self.b["gate_source"], "모르는 action")
            try:
                if action == "select":
                    self.player.select(str(body.get(SCENE_NAME_KEY, "")))
                elif action == "restart":
                    self.player.restart()
                elif action in ("pause", "resume"):
                    self.player.pause(action == "pause")
                elif action == "seek":
                    tick = body.get("tick")
                    if not isinstance(tick, int) or isinstance(tick, bool):
                        raise scene_play.SceneError("tick 은 정수")
                    self.player.seek(tick)
                elif action == "inject":
                    ev = body.get("event")
                    if not isinstance(ev, dict):
                        raise scene_play.SceneError("event 는 객체")
                    self.player.inject(ev)
            except scene_play.SceneError as e:
                raise Fail(self.b["codes"]["bad"], self.b["gate_source"], str(e))
            self.log.write(WHERE + ".scene", action, detail=json.dumps(body, ensure_ascii=False))
        return {"v": self.b["v"], "ok": True, "status": self.status()}

    def status(self):
        snap = self.player.snapshot()
        st = snap["state"]
        return {"scene": snap["scene"].name, "gen": snap["gen"], "tick": snap["tick"],
                "last_tick": snap["scene"].last_tick, "t_s": snap["tick"] * self.player.dt,
                "paused": snap["paused"], "ended": snap["ended"], "down": sorted(st["down"]),
                "startup_fail": st["startup_fail"], "modes": st["modes"]}

    # ---- 흐름 ----
    def tick_payload(self, snap, first, last, inj_from):
        """틱 first~last 의 장면 사건 + 넣은 사건(inject_log 의 inj_from 번째부터)을 지금 틱 자리와 함께."""
        scene = snap["scene"]
        emit = scene.data["emit"]
        tick = snap["tick"]
        events = []
        with self.player.cond:
            for t in range(first, last + 1):
                events.extend(self.player.scene_events_at(t))
            events.extend(self.player.inject_log[inj_from:snap["inject_count"]])
        codes = self.cfg["status_codes"]
        out_events = []
        for ev in events:
            e = dict(ev)
            if e["type"] == scene_play.EV_CHARGER and e["status"] in codes:
                e["stat"] = codes[e["status"]]
            out_events.append(e)
        pos = None
        if self.b["loc_source"] not in snap["state"]["down"]:
            s = scene.track[tick]
            nd = self.cfg["units"]["coord_decimals"]
            rd = self.cfg["units"]["report_decimals"]
            wall = snap["start_wall"] + datetime.timedelta(seconds=tick * self.player.dt)
            full = {"t": int(wall.timestamp() * self.cfg["units"]["ms_per_second"]),
                    "lat": round(s["lat"], nd), "lng": round(s["lng"], nd),
                    "speed_kmh": round(s["speed_kmh"], rd) if emit.get("speed", "device") == "device" else None,
                    "heading_deg": round(s["heading_deg"], rd) if emit["heading"] == "from_path" else None,
                    "accuracy_m": emit["accuracy_m"]}
            pos = {k: full[k] for k in emit["fields"]}
        st = snap["state"]
        return {"scene": scene.name, "gen": snap["gen"], "tick": tick, "t_s": tick * self.player.dt,
                "pos": pos, "events": out_events, "down": sorted(st["down"]), "startup_fail": st["startup_fail"]}


def make_handler(bridge):
    b = bridge.b
    cfg = bridge.cfg

    class Handler(BaseHTTPRequestHandler):
        server_version = "ev-testbed-bridge"

        def log_message(self, fmt, *args):
            bridge.log.write(WHERE + ".http", "알림", detail=fmt % args)

        def _cors(self):
            origin = self.headers.get("Origin")
            if origin and origin in b["allowed_origins"]:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")

        def _send_json(self, status, obj):
            data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", b["content_types"]["json"])
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self._cors()
            self.end_headers()
            self.wfile.write(data)
            return len(data)

        def do_GET(self):
            self._handle("GET")

        def do_POST(self):
            self._handle("POST")

        def do_OPTIONS(self):
            self._handle("OPTIONS")

        def _read_body(self):
            length = self.headers.get("Content-Length")
            try:
                n = int(length) if length is not None else 0
            except ValueError:
                raise Fail(b["codes"]["bad"], b["gate_source"], "Content-Length 꼴")
            if n < 0 or n > b["max_body_bytes"]:
                raise Fail(b["codes"]["bad"], b["gate_source"], "물음 크기 한도 넘음")
            raw = self.rfile.read(n) if n else b""
            try:
                body = json.loads(raw.decode("utf-8")) if raw else {}
            except (UnicodeDecodeError, ValueError):
                raise Fail(b["codes"]["bad"], b["gate_source"], "JSON 이 아님")
            if not isinstance(body, dict):
                raise Fail(b["codes"]["bad"], b["gate_source"], "JSON 객체가 아님")
            return body

        def _handle(self, method):
            t0 = time.monotonic()
            ip = self.client_address[0]
            path = urlsplit(self.path).path
            name = bridge.route_name(path)
            result = {"status": None, "code": "", "why": "", "bytes": 0}
            bridge.log.write(WHERE + ".req", "시작", method=method, route=name or "(모름)", ip=ip)
            try:
                self._route(method, path, name, ip, result)
            except Fail as f:
                result["code"], result["why"] = f.code, f.why
                result["status"] = b["fail_http"][f.code]
                result["bytes"] = self._send_json(result["status"], bridge.fail_body(f.code, f.src))
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError) as e:
                result["why"] = "손님이 끊음: " + type(e).__name__
            except Exception as e:  # 삼키지 않는다 — 로그에 남기고 다리 실패 답으로 끝낸다
                result["code"], result["why"] = b["codes"]["gate"], repr(e)
                bridge.log.write(WHERE + ".req", "예외", route=name, error=repr(e),
                                 trace=traceback.format_exc().replace(SSE_SEP, " / "))
                try:
                    result["status"] = b["fail_http"][b["codes"]["gate"]]
                    result["bytes"] = self._send_json(result["status"], bridge.fail_body(b["codes"]["gate"], b["gate_source"]))
                except OSError as e2:
                    bridge.log.write(WHERE + ".req", "실패 답도 못 보냄", error=repr(e2))
            ms = round((time.monotonic() - t0) * cfg["units"]["ms_per_second"])
            bridge.log.write(WHERE + ".req", "끝", method=method, route=name or "(모름)", status=result["status"],
                             code=result["code"], why=result["why"], ms=ms, bytes=result["bytes"])

        def _route(self, method, path, name, ip, result):
            origin = self.headers.get("Origin")
            if origin and origin not in b["allowed_origins"]:
                raise Fail(b["codes"]["bad"], b["gate_source"], "허용 밖 출처")
            if method == "OPTIONS":
                self.send_response(HTTPStatus.NO_CONTENT)
                self._cors()
                self.send_header("Access-Control-Allow-Methods", ", ".join(sorted(set(b["methods"].values()))))
                self.send_header("Access-Control-Allow-Headers", "Content-Type, " + b["secret_header"])
                self.send_header("Access-Control-Max-Age", str(b["cors_max_age_s"]))
                self.end_headers()
                result["status"] = HTTPStatus.NO_CONTENT
                return
            snap = bridge.player.snapshot()
            exempt = name in b["no_secret_paths"]
            if b["gate_source"] in snap["state"]["down"] and not exempt:
                result["why"] = "다리 끊김 사건 — 답 없이 닫음"
                self.close_connection = True
                return
            now = time.monotonic()
            with bridge.lock:
                until = bridge.blocked.get(ip)
                if until is not None and until <= now:
                    bridge.blocked.pop(ip, None)
                    bridge.wrong.pop(ip, None)
                    until = None
            if until is not None and not exempt:
                raise Fail(b["codes"]["busy"], b["gate_source"], "막힌 주소")
            if not exempt:
                given = self.headers.get(b["secret_header"])
                forced = any(t in b["startup_fail_lock"] for t in snap["state"]["startup_fail"])
                if forced or not bridge.check_secret(given):
                    if not forced:
                        with bridge.lock:
                            bridge.wrong[ip] = bridge.wrong.get(ip, 0) + 1
                            if bridge.wrong[ip] >= b["lock_max_wrong"]:
                                bridge.blocked[ip] = now + b["lock_block_s"]
                    raise Fail(b["codes"]["lock"], b["gate_source"],
                               "앱 비밀 값 " + ("켤 때 실패 사건" if forced else ("없음" if given is None else "틀림")))
            if name is None:
                raise Fail(b["codes"]["bad"], b["gate_source"], "모르는 길")
            allowed = {b["methods"][name]} | ({"GET"} if name == "scene" else set())
            if method not in allowed:
                raise Fail(b["codes"]["bad"], b["gate_source"], "방식이 다름")
            body = self._read_body() if method == "POST" else {}
            if name == "stream":
                self._stream(result)
                return
            if name == "scene":
                result["status"] = HTTPStatus.OK
                result["bytes"] = self._send_json(HTTPStatus.OK, bridge.do_scene(method, body))
                return
            bridge.ensure_source(name, snap)
            if name == "health":
                out, status = bridge.do_health(snap), HTTPStatus.OK
            elif name == "data":
                out, status = bridge.do_data(path[len(b["paths"]["data"]):], snap), HTTPStatus.OK
            else:
                status, out = bridge.do_ask(name, body, snap)
            result["status"] = status
            result["bytes"] = self._send_json(status, out)

        def _sse(self, event, obj):
            data = json.dumps(obj, ensure_ascii=False)
            text = "event: " + event + SSE_SEP + "data: " + data + SSE_SEP + SSE_SEP
            self.wfile.write(text.encode("utf-8"))
            self.wfile.flush()

        def _stream(self, result):
            ev = b["stream_events"]
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", b["content_types"]["sse"])
            self.send_header("Cache-Control", "no-store")
            self._cors()
            self.end_headers()
            result["status"] = HTTPStatus.OK
            player = bridge.player
            gen_seen, last, end_sent, sent, inj_seen = None, None, False, 0, 0
            while not bridge.stop.is_set():
                with player.cond:
                    player.cond.wait_for(lambda: bridge.stop.is_set() or player.gen != gen_seen or player.tick != last
                                         or len(player.inject_log) != inj_seen, timeout=player.dt)
                snap = player.snapshot()
                if bridge.stop.is_set():
                    break
                if snap["gen"] != gen_seen:
                    self._sse(ev["hello"], bridge.status())
                    gen_seen, last, end_sent, inj_seen = snap["gen"], snap["tick"] - 1, False, 0
                if snap["tick"] != last or snap["inject_count"] != inj_seen:
                    first = last + 1 if last is not None and last < snap["tick"] else snap["tick"] + 1
                    self._sse(ev["tick"], bridge.tick_payload(snap, first, snap["tick"], inj_seen))
                    last, inj_seen = snap["tick"], snap["inject_count"]
                    sent += 1
                    if snap["ended"] and not end_sent:
                        self._sse(ev["end"], bridge.status())
                        end_sent = True
                else:
                    self.wfile.write((":" + SSE_SEP + SSE_SEP).encode("utf-8"))
                    self.wfile.flush()
            result["why"] = "흐름 끝(보낸 틱 " + str(sent) + ")"

    return Handler


def main(argv):
    args = argv[1:]
    if len(args) != 1:
        print("쓰는 법: py bridge.py <설정 파일 경로>")
        return FAIL_CODE
    try:
        cfg = tbconfig.Config(args[0])
    except tbconfig.ConfigError as e:
        print(str(e))
        return FAIL_CODE
    log = tblog.from_config(cfg, cfg.resolve)
    b = cfg["bridge"]
    secret = os.environ.get(b["secret_env"])
    if secret is None or len(secret) < b["secret_min_chars"]:
        msg = "앱 비밀 값 환경변수 " + b["secret_env"] + " 이(가) 없거나 짧음 — 시작하지 않음"
        print(msg)
        log.write(WHERE + ".main", "시작 못 함", why=msg)
        return FAIL_CODE
    try:
        bridge = Bridge(cfg, log, secret)
        bridge.player.select(cfg["active_scene"])
        server = ThreadingHTTPServer((cfg["server"]["host"], cfg["server"]["port"]), make_handler(bridge))
    except (tbconfig.ConfigError, scene_play.SceneError, OSError, ValueError) as e:
        print("시작 못 함: " + str(e))
        log.write(WHERE + ".main", "시작 못 함", error=repr(e))
        return FAIL_CODE
    server.daemon_threads = True

    def ticker():
        while not bridge.stop.wait(bridge.player.dt):
            bridge.player.advance()

    def finish():
        log.write(WHERE + ".main", "시험 모드 시간 끝 — 닫음", run_seconds=b["run_seconds"])
        bridge.stop.set()
        with bridge.player.cond:
            bridge.player.cond.notify_all()
        server.shutdown()

    timer = threading.Timer(b["run_seconds"], finish)
    timer.daemon = True
    threading.Thread(target=ticker, daemon=True).start()
    timer.start()
    snap = bridge.player.snapshot()
    log.write(WHERE + ".main", "시작", host=cfg["server"]["host"], port=cfg["server"]["port"],
              scene=snap["scene"].name, ticks=snap["scene"].last_tick + 1, run_seconds=b["run_seconds"],
              secret_env=b["secret_env"])
    print("시험 다리 시작: " + cfg["server"]["host"] + ":" + str(cfg["server"]["port"]) + " · 장면 " + snap["scene"].name
          + " · " + str(b["run_seconds"]) + "초 뒤 스스로 끝남", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.write(WHERE + ".main", "멈춤(키보드)")
        bridge.stop.set()
    finally:
        timer.cancel()
        server.server_close()
    log.write(WHERE + ".main", "끝")
    print("시험 다리 끝", flush=True)
    return OK_CODE


if __name__ == "__main__":
    sys.exit(main(sys.argv))
