"""T4 스스로 시험 — 다리를 배속으로 띄워 모든 장면을 차례로 끝까지 돌리고, 장면마다 핵심이 흐름·길·시험 DB 에 보이는지 표로 찍는다.

쓰는 법:  py tools/try_t4.py <설정 파일 경로> [장면 이름 ...]
  예)    py tools/try_t4.py config/testbed.json                 (설정 try_t4.order 의 모든 장면 — 약 4~5분)
         py tools/try_t4.py config/testbed.json S6_정차출발튐     (그 장면만)
- 배속은 설정 try_t4.scale(설정 time_scale 은 그대로 1 — 다리 셋째 인자로만 넘김).
- 장면마다: 멈춘 채 고르기 → 흐름을 열고 → 다시 감 → 끝(end)까지 흐름을 받음 → 멈춤 → 시험 DB 를 봄 → 필요한 틱으로 건너뛰어 길을 불러 봄.
- 기대 값은 다리 코드가 아니라 장면 파일과 설정에서 바로 셈한다(장면 검사기 요약·시간표·속도 표).
- 어떤 장면에 어떤 시험을 하는지는 설정 try_t4.checks(장면 이름 → 시험 종류).
하나라도 실패면 0 아닌 코드로 끝난다. 시작·끝·줄마다 결과는 기록장에.
"""
import glob
import json
import math
import os
import re
import secrets
import subprocess
import sys
import time
from http import HTTPStatus
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import check_scenes
import geo
import tbconfig
import tbdb
import tblog
import try_server

WHERE = "try_t4"
OK_CODE = 0
FAIL_CODE = 1
HTTP_OK = HTTPStatus.OK
EV_CHARGER = "charger_status"
EV_DOWN = "source_down"
EV_UP = "source_up"
EV_STARTUP = "startup_fail"
EV_JUMP = "gps_jump"
EV_MODE = "response_mode"
EV_BAD = "bad_payload"
EV_PART = "scene_part"
KIND_REST = "rest"
KIND_AROUND = "around"
BAD_RANGE = "out_of_range"
BAD_SPEED = "negative_speed"
BAD_BROKEN = "broken_json"
BAD_BIG = "oversize"
DB_CLEAN = "실패 0 · 버림 0"


# ---------------- 바탕 ----------------
class Stream:
    """흐름 읽개 — (event, 날 글) 을 하나씩. 깨진 JSON 도 날 글로 받는다."""

    def __init__(self, c, timeout):
        self.r = urlopen(Request(c.url(c.b["paths"]["stream"])), timeout=timeout)

    def next(self):
        event, data = None, []
        while True:
            line = self.r.readline().decode("utf-8", "replace")
            if not line:
                raise EOFError("흐름이 닫힘")
            line = line.rstrip("\r\n")
            if not line:
                if event is not None:
                    return event, "".join(data)
                continue
            if line.startswith(":"):
                continue
            key, _, value = line.partition(":")
            value = value.lstrip(" ")
            if key == "event":
                event = value
            elif key == "data":
                data.append(value)

    def close(self):
        self.r.close()


def parse(raw):
    try:
        return json.loads(raw)
    except ValueError:
        return None


def raw_call(c, method, path, body=None, raw=None):
    """(HTTP 코드 또는 None(답 없이 닫힘), 날 바이트, 걸린 ms)."""
    h = {c.b["secret_header"]: c.secret}
    data = raw
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        h["Content-Type"] = "application/json"
    t0 = time.monotonic()
    ms = lambda: round((time.monotonic() - t0) * c.cfg["units"]["ms_per_second"])  # noqa: E731
    try:
        with urlopen(Request(c.url(path), data=data, method=method, headers=h), timeout=c.timeout) as r:
            return r.status, r.read(), ms()
    except HTTPError as e:
        return e.code, e.read(), ms()
    except (URLError, ConnectionError, OSError):
        return None, b"", ms()


def angle_diff(a, b):
    d = math.radians(a - b)
    return abs(math.degrees(math.atan2(math.sin(d), math.cos(d))))


def dist_to_line_km(points, p, step_km, radius):
    """p 에서 선(꼭짓점 목록)까지 가장 가까운 거리 — 조각마다 step_km 간격으로 찍어 잰다(다리 코드와 따로 셈)."""
    best = None
    for a, b in zip(points, points[1:]):
        n = max(int(geo.sphere_km(a, b, radius) / step_km), 1)
        for i in range(n + 1):
            f = i / n
            q = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]
            d = geo.sphere_km(p, q, radius)
            best = d if best is None or d < best else best
    return best


class Ctx:
    """한 장면 시험에 쓰는 것들."""

    def __init__(self, cfg, c, t, conn, name):
        self.cfg, self.c, self.t, self.conn, self.name = cfg, c, t, conn, name
        self.tt = cfg["try_t4"]
        self.b = cfg["bridge"]
        self.dt = cfg["tick_interval_s"]
        self.radius = cfg["geo"]["earth_radius_km"]
        folder = cfg.resolve(cfg["scenes"]["dir"])
        self.scene = tbconfig.read_json(os.path.join(folder, name + cfg["scenes"]["line_suffix"]))
        _, self.summary = check_scenes.check_scene(os.path.join(folder, name + cfg["scenes"]["line_suffix"]),
                                                   check_scenes.Ctx(cfg), list(check_scenes_names(cfg)))
        self.tables = {m["kind"]: m["detail_table"] for m in tbdb.masters(cfg, conn)}
        self.kinds = cfg["db"]["kinds"]
        self.run = None
        self.flow = []
        self.got = None

    def label(self, what):
        return self.name + " · " + what

    def check(self, what, expect, fn):
        self.t.check(self.label(what), expect, fn)

    def tick_of(self, t_s):
        return int(t_s // self.dt)

    def rows(self, role, where="", params=()):
        sql = ("SELECT * FROM " + tbdb.ident(self.tables[self.kinds[role]]) + " WHERE run = ?" + where + " ORDER BY id")
        return [dict(r) for r in self.conn.execute(sql, (self.run,) + tuple(params))]

    def seek(self, tick):
        s, body, _ = self.c.scene(action="seek", tick=tick)
        if s != HTTP_OK:
            raise RuntimeError("건너뛰기 실패 " + try_server.fail_of(s, body))

    def stream_one(self):
        """지금 틱의 흐름 한 개(hello 뒤 첫 tick)의 날 글."""
        st = Stream(self.c, self.c.timeout)
        try:
            ev = self.b["stream_events"]
            while True:
                event, raw = st.next()
                if event == ev["tick"]:
                    return raw
        finally:
            st.close()

    def flow_at(self, tick):
        return next(r for r in self.flow if r["tick"] == tick)

    def is_fail(self, status, raw, code, src):
        return try_server.is_fail(self.cfg, status, parse(raw.decode("utf-8", "replace")), code, src)


def check_scenes_names(cfg):
    folder = cfg.resolve(cfg["scenes"]["dir"])
    for p in sorted(glob.glob(os.path.join(folder, cfg["scenes"]["glob"]))):
        yield os.path.splitext(os.path.basename(p))[0]


# ---------------- 한 장면 돌리기 ----------------
def play(x):
    """멈춘 채 고르기 → 흐름 열기 → 다시 감 → end 까지 받기 → 멈춤. 흐름에서 받은 것을 x.got 에."""
    c, ev = x.c, x.b["stream_events"]
    s, body, _ = c.scene(action="select", name=x.name, paused=True)
    if s != HTTP_OK:
        raise RuntimeError("장면 고르기 실패 " + try_server.fail_of(s, body))
    x.run = body["status"]["run"]
    x.status = body["status"]
    got = {"hello": 0, "end": 0, "ticks": [], "broken": 0, "events": []}
    deadline = time.monotonic() + (x.status["last_tick"] + 1) * x.dt / x.tt["scale"] + x.tt["per_scene_s"]
    st = Stream(c, x.tt["http_timeout_s"])
    try:
        event, raw = st.next()
        got["hello"] += event == ev["hello"]
        c.scene(action="resume")
        while time.monotonic() < deadline:
            event, raw = st.next()
            if event == ev["hello"]:
                got["hello"] += 1
            elif event == ev["end"]:
                got["end"] += 1
                break
            elif event == ev["tick"]:
                obj = parse(raw)
                if obj is None:
                    got["broken"] += 1
                    continue
                got["ticks"].append(obj["tick"])
                # 배속이면 흐름 한 개에 여러 틱의 사건이 함께 온다 — 사건의 틱은 그 사건의 t_s 로 셈
                got["events"].extend(dict(e, at_tick=x.tick_of(e["t_s"]) if "t_s" in e else obj["tick"])
                                     for e in obj["events"])
    finally:
        st.close()
        c.scene(action="pause")
    x.got = got
    # 쌓기 줄기가 흐름 줄을 다 쓸 때까지 기다림
    want = x.status["last_tick"] + 1
    until = time.monotonic() + x.tt["db_wait_s"]
    while time.monotonic() < until:
        x.flow = x.rows("flow")
        if len(x.flow) >= want:
            break
        time.sleep(x.tt["poll_s"])


def check_common(x):
    def fn():
        g = x.got
        ticks = [r["tick"] for r in x.flow]
        n = len(ticks)
        contiguous = ticks == list(range(n))
        rising = all(b > a for a, b in zip(g["ticks"], g["ticks"][1:]))
        expect_n = x.summary["ticks"]
        return ("hello " + str(g["hello"]) + " · end " + str(g["end"]) + " · 흐름 틱 " + str(len(g["ticks"])) + "개(늘기만 함 "
                + str(rising) + ") · DB 흐름 " + str(n) + "줄(틱 0~" + str(ticks[-1] if ticks else None) + " 빠짐 없음 "
                + str(contiguous) + ") · 장면 검사기 틱 " + str(expect_n)), \
            g["hello"] == 1 and g["end"] == 1 and rising and contiguous and abs(n - expect_n) <= tol
    # 속도 구간·멈춤의 끝마다 틱 하나가 덜 찬 채 넘어갈 수 있어 그 수만큼 더 봐준다
    tol = x.tt["tick_tolerance"] + len(x.scene["speeds"]) + len(x.scene.get("stops", []))
    x.check("흐름 이어짐(배속 " + str(x.tt["scale"]) + ")", "hello 1 · end 1 · 틱 늘기만 함 · DB 흐름 틱 0 부터 빠짐 없음 · 줄 수 = 장면 틱 ± "
            + str(tol), fn)


# ---------------- 장면마다의 시험 ----------------
def near_rest(x, places):
    def fn():
        out, ok = [], True
        for p in places:
            d = min(geo.sphere_km([r["lat"], r["lng"]], p["loc"], x.radius) for r in x.flow)
            out.append(p["name"] + "(" + p.get("direction", "") + ") " + str(round(d, x.cfg["units"]["report_decimals"])) + " km")
            ok = ok and d <= x.tt["near_km"]
        return " · ".join(out), ok
    return fn


def rest_in_route(x):
    lo = min(min(l["from_km"], l["to_km"]) for l in x.scene["route"]["legs"] if l["kind"] == "line")
    hi = max(max(l["from_km"], l["to_km"]) for l in x.scene["route"]["legs"] if l["kind"] == "line")
    return [p for p in x.scene["stations"] if p["kind"] == KIND_REST and p["km"] is not None and lo <= p["km"] <= hi]


def t_plain(x):
    kmh = [s["kmh"] for s in x.scene["speeds"]]

    def speed_fn():
        sp = [r["speed_kmh"] for r in x.flow]
        return "시속 " + str(min(sp)) + "~" + str(max(sp)), min(sp) >= min(kmh) and max(sp) <= max(kmh)
    x.check("시속이 속도 표 안", "시속 " + str(min(kmh)) + "~" + str(max(kmh)), speed_fn)
    places = rest_in_route(x)
    x.check("길 위 휴게소를 지남", "휴게소 " + str(len(places)) + "곳 모두 " + str(x.tt["near_km"]) + " km 안", near_rest(x, places))


def t_speeding(x):
    t_plain_speed_max = max(s["kmh"] for s in x.scene["speeds"])

    def fn():
        sp = max(r["speed_kmh"] for r in x.flow)
        return "가장 빠른 시속 " + str(sp), sp == t_plain_speed_max
    x.check("제한 넘는 시속이 흐름에", "시속 " + str(t_plain_speed_max), fn)
    want = sorted((l["limit_kmh"] for l in x.scene["limits"]), key=str)

    def lim_fn():
        got = sorted((r["limit_kmh"] for r in x.rows("speed")), key=str)
        return "DB 제한 속도 " + repr(got), got == want
    x.check("제한 속도 구간이 DB 에", repr(want), lim_fn)


def t_updown(x):
    legs = x.scene["route"]["legs"]

    def flip_fn():
        n = len(x.flow)
        k = x.tt["edge_ticks"]
        h1, h2 = x.flow[k]["heading_deg"], x.flow[n - 1 - k]["heading_deg"]
        d = angle_diff(h1, h2)
        return "처음 방향 " + str(h1) + " · 끝 방향 " + str(h2) + " · 차 " + str(round(d)), d >= x.tt["heading_flip_min_deg"]
    x.check("하행 → 상행 진행 방향 뒤집힘", "방향 차 " + str(x.tt["heading_flip_min_deg"]) + "° 이상", flip_fn)
    places = rest_in_route(x)
    x.check("같은 휴게소 상행·하행을 다 지남", "휴게소 " + str(len(places)) + "곳 모두 " + str(x.tt["near_km"]) + " km 안",
            near_rest(x, places))
    by_z = {}
    for p in places:
        for op in p["operators"]:
            by_z.setdefault(op["zscode"], []).append((op["station_id"], p["direction"]))

    def data_fn():
        out, ok = [], True
        for z, ids in sorted(by_z.items()):
            s, raw, _ = raw_call(x.c, "GET", x.b["paths"]["data"] + x.cfg["try"]["files"]["stations"].format(z))
            body = parse(raw.decode("utf-8")) or {}
            have = {st["id"] for st in body.get("stations", [])}
            miss = [i for i, _ in ids if i not in have]
            out.append(z + " " + str(s) + " 빠짐 " + repr(miss))
            ok = ok and s == HTTP_OK and not miss
        dirs = sorted({d for v in by_z.values() for _, d in v})
        return " · ".join(out) + " · 방향 " + repr(dirs), ok and len(dirs) > len(dirs[:1])
    x.check("자료 길에 두 방향 휴게소 충전소", "시군구 파일마다 장면 충전소 다 있음 · 방향 둘", data_fn)

    def route_fn():
        s, raw, _ = raw_call(x.c, "POST", x.b["paths"]["route"], body={"from": places[0]["loc"], "to": places[-1]["loc"]})
        body = parse(raw.decode("utf-8")) or {}
        pieces = body.get("pieces", [])
        joined = len(pieces) == len(legs) and all(a["line"][-1] == b["line"][0] for a, b in zip(pieces, pieces[1:]))
        return str(s) + " 조각 " + str(len(pieces)) + " · 이어짐 " + str(joined), s == HTTP_OK and joined
    x.check("경로 답이 하행·상행 두 조각", "200 · 조각 " + str(len(legs)) + " · 앞 조각 끝 = 뒤 조각 처음", route_fn)


def t_exit(x):
    sc = x.cfg["scenes"]
    line_legs = [l for l in x.scene["route"]["legs"] if l["kind"] == "line"]
    line = tbconfig.read_json(os.path.join(x.cfg.resolve(sc["lines_dir"]), line_legs[0]["line"] + sc["line_suffix"]))
    road = [l for l in x.scene["route"]["legs"] if l["kind"] == "points"][-1]
    last_kmh = [s for s in x.scene["speeds"]][-1]["kmh"]

    def off_fn():
        last = x.flow[-1]
        d = dist_to_line_km(line["points"], [last["lat"], last["lng"]], x.tt["line_sample_km"], x.radius)
        return ("끝 자리가 고속도로 선에서 " + str(round(d, x.cfg["units"]["report_decimals"])) + " km · 끝 시속 "
                + str(last["speed_kmh"])), d >= x.tt["off_line_km"] and last["speed_kmh"] == last_kmh
    x.check("나들목 나가 일반 도로로", "끝 자리가 고속도로에서 " + str(x.tt["off_line_km"]) + " km 넘게 · 끝 시속 " + str(last_kmh), off_fn)

    def lim_fn():
        got = [r["limit_kmh"] for r in x.rows("speed")]
        return "DB 제한 속도 " + repr(got), len(got) == len(x.scene["limits"]) and None in got
    x.check("제한속도 자료 없는 길(null)이 DB 에", "구간 " + str(len(x.scene["limits"])) + "개 · 그 가운데 null 있음", lim_fn)
    around = [p for p in x.scene["stations"] if p["kind"] == KIND_AROUND]

    def around_fn():
        zs = sorted({op["zscode"] for p in around for op in p["operators"]})
        have = {}
        for z in zs:
            s, raw, _ = raw_call(x.c, "GET", x.b["paths"]["data"] + x.cfg["try"]["files"]["stations"].format(z))
            for st in (parse(raw.decode("utf-8")) or {}).get("stations", []):
                have[st["id"]] = st
        miss = [p["id"] for p in around if p["id"] not in have]
        rest = [i for i in have if have[i].get("rest") and i in {p["id"] for p in around}]
        near = [round(dist_to_line_km(road["points"], p["loc"], x.tt["line_sample_km"], x.radius),
                      x.cfg["units"]["report_decimals"]) for p in around]
        return ("주변 " + str(len(around)) + "곳 · 빠짐 " + repr(miss) + " · 휴게소 표시 " + repr(rest)
                + " · 일반 도로까지 km " + repr(near)), not miss and not rest and max(near) <= x.tt["near_km"]
    x.check("주변 충전소가 자료 길에", "주변 " + str(len(around)) + "곳 모두 · 휴게소 표시 없음 · 일반 도로에서 " + str(x.tt["near_km"]) + " km 안",
            around_fn)


def t_charger(x):
    want = [(x.tick_of(e["t_s"]), e["station_id"], e["charger_id"], e["status"]) for e in x.scene["timeline"]
            if e["type"] == EV_CHARGER]

    def fn():
        got = [(e["at_tick"], e["station_id"], e["charger_id"], e["status"]) for e in x.got["events"] if e["type"] == EV_CHARGER]
        db = [r for r in x.rows("charger") if r["cause"] != "start"]
        return "흐름 " + repr([(g[0], g[-1]) for g in got]) + " · DB 바뀜 " + str(len(db)) + "줄", got == want and len(db) == len(want)
    x.check("충전기 상태 바뀜이 흐름·DB 에", repr([(w[0], w[-1]) for w in want]), fn)


def t_stop(x):
    stops = x.scene["stops"]
    want_stop = sum(math.ceil(s["duration_s"] / x.dt) for s in stops)

    def stop_fn():
        zero = [r["tick"] for r in x.flow if r["speed_kmh"] == 0]
        run = zero == list(range(zero[0], zero[0] + len(zero))) if zero else False
        after = [r["speed_kmh"] for r in x.flow if zero and r["tick"] > zero[-1]]
        return ("시속 0 틱 " + str(len(zero)) + "개(" + (str(zero[0]) + "~" + str(zero[-1]) if zero else "-") + ", 이어짐 " + str(run)
                + ") · 그 뒤 시속 > 0 " + str(bool(after) and all(v > 0 for v in after))), \
            len(zero) == want_stop and run and bool(after) and all(v > 0 for v in after)
    x.check("휴게소 정차 → 다시 출발", "시속 0 이 " + str(want_stop) + "틱 이어짐 · 그 뒤 다시 움직임", stop_fn)
    back = [l for l in x.scene["route"]["legs"] if l["from_km"] > l["to_km"]]
    back_idx = [i for i, l in enumerate(x.scene["route"]["legs"]) if l["from_km"] > l["to_km"]]
    back_kmh = [s["kmh"] for s in x.scene["speeds"] if s["leg"] in back_idx]

    def back_fn():
        zero = [r for r in x.flow if r["speed_kmh"] == 0]
        before = x.flow[zero[0]["tick"] - 1]["heading_deg"]
        rev = [r for r in x.flow if r["speed_kmh"] in back_kmh]
        flipped = [r for r in rev if angle_diff(r["heading_deg"], before) >= x.tt["heading_flip_min_deg"]]
        return "후진 틱 " + str(len(rev)) + " · 방향 뒤집힌 틱 " + str(len(flipped)), bool(back) and bool(rev) and len(flipped) == len(rev)
    x.check("후진(짧게 거꾸로)", "시속 " + repr(back_kmh) + " 틱 모두 진행 방향이 들어올 때와 반대", back_fn)

    for ev in [e for e in x.scene["timeline"] if e["type"] == EV_JUMP]:
        k = x.tick_of(ev["t_s"])

        def jump_fn(ev=ev, k=k):
            p0 = x.flow_at(k - 1)
            pj = x.flow_at(k)
            pb = x.flow_at(k + ev["ticks"])
            m = x.cfg["units"]["m_per_km"]
            dj = geo.sphere_km([p0["lat"], p0["lng"]], [pj["lat"], pj["lng"]], x.radius) * m
            db = geo.sphere_km([p0["lat"], p0["lng"]], [pb["lat"], pb["lng"]], x.radius) * m
            limit = ev["offset_m"] * x.tt["jump_ratio"]
            return ("틱 " + str(k) + " 튐 " + str(round(dj)) + " m · " + str(ev["ticks"]) + "틱 뒤 " + str(round(db)) + " m"), \
                dj >= limit and db < limit
        x.check("위치 튐 " + str(ev["offset_m"]) + " m(틱 " + str(k) + ", " + str(ev["ticks"]) + "틱)",
                "튄 거리 ≥ " + str(ev["offset_m"]) + " × " + str(x.tt["jump_ratio"]) + " · 끝나면 제자리로", jump_fn)


def down_at(x, tick):
    down = set()
    for e in x.scene["timeline"]:
        if x.tick_of(e["t_s"]) > tick:
            break
        if e["type"] == EV_DOWN:
            down.add(e["source"])
        elif e["type"] == EV_UP:
            down.discard(e["source"])
    return sorted(down)


def t_down(x):
    want = [(x.tick_of(e["t_s"]), e["type"], e["source"]) for e in x.scene["timeline"] if e["type"] in (EV_DOWN, EV_UP)]

    def ev_fn():
        got = [(e["at_tick"], e["type"], e["source"]) for e in x.got["events"] if e["type"] in (EV_DOWN, EV_UP)]
        return "흐름 사건 " + str(len(got)) + "개 · 차례 같음 " + str(got == want), got == want
    x.check("끊김·복구 사건이 흐름에(틱 그대로)", str(len(want)) + "개 " + repr([(w[0], w[-1]) for w in want]), ev_fn)
    probes = sorted({w[0] + x.tt["probe_after_ticks"] for w in want})
    home, data = x.b["source_of_path"]["route"], x.b["source_of_path"]["data"]
    for k in probes:
        down = down_at(x, k)

        def fn(k=k, down=down):
            x.seek(k)
            s1, r1, _ = raw_call(x.c, "POST", x.b["paths"]["route"], body={"from": x.scene["stations"][0]["loc"],
                                                                           "to": x.scene["stations"][-1]["loc"]})
            s2, r2, _ = raw_call(x.c, "GET", x.b["paths"]["data"] + x.cfg["try"]["files"]["meta"])
            s3, r3, _ = raw_call(x.c, "GET", x.b["paths"]["health"])
            h = parse(r3.decode("utf-8")) or {}
            row = x.flow_at(k)
            ok_route = x.is_fail(s1, r1, x.b["down_code"][home], home) if home in down else s1 == HTTP_OK
            ok_data = x.is_fail(s2, r2, x.b["down_code"][data], data) if data in down else s2 == HTTP_OK
            ok_health = h.get("ok") is (not down) and all((h.get("src", {}).get(sname) == x.b["health_words"]["bad"]) == (sname in down)
                                                          for sname in (home, data))
            return ("route " + str(s1) + " · data " + str(s2) + " · health ok=" + str(h.get("ok")) + " · DB 흐름 down "
                    + row["down"]), ok_route and ok_data and ok_health and json.loads(row["down"]) == down
        x.check("틱 " + str(k) + " 끊긴 출처 " + repr(down), "끊긴 길만 실패(home 504 · data 502) · health · DB 흐름 down 같음", fn)


def t_startup(x):
    target = [e["target"] for e in x.scene["timeline"] if e["type"] == EV_STARTUP][0]

    def stream_fn():
        g = x.got
        return "흐름 틱 " + str(len(g["ticks"])) + "개 · 켤 때 실패 사건 " + str(sum(1 for e in g["events"] if e["type"] == EV_STARTUP)), \
            len(g["ticks"]) > 0 and sum(1 for e in g["events"] if e["type"] == EV_STARTUP) == 1
    x.check("흐름은 그대로 돎 · 켤 때 실패 사건 1", "틱 있음 · 사건 1", stream_fn)

    def fn():
        x.seek(x.tt["probe_after_ticks"])
        s1, r1, _ = raw_call(x.c, "GET", x.b["paths"]["data"] + x.cfg["try"]["files"]["meta"])
        tries = [raw_call(x.c, "GET", x.b["paths"]["health"]) for _ in range(x.b["lock_max_wrong"] + 1)]
        s2, r2, _ = tries[-1]
        gate, data = x.b["gate_source"], x.b["source_of_path"]["data"]
        if target in x.b["startup_fail_close"]:
            ok = s1 is None and all(s is None for s, _, _ in tries)
            want = "답 없이 닫힘"
        elif target in x.b["startup_fail_lock"]:
            ok = all(x.is_fail(s, r, x.b["codes"]["lock"], gate) for s, r, _ in tries) and x.is_fail(s1, r1, x.b["codes"]["lock"], gate)
            want = "401 lock(되풀이해도 429 로 막히지 않음)"
        else:
            ok = x.is_fail(s1, r1, x.b["codes"]["upstream"], data) and s2 == HTTP_OK
            want = "목록 502 upstream · health 200"
        return ("data " + str(s1) + " · health " + str(len(tries)) + "번 " + repr(sorted({str(s) for s, _, _ in tries}))
                + " (기대 " + want + ")"), ok
    x.check("켤 때 실패 " + target + " 가 길에", "갈래마다: 목록 502 / 비밀 값 401 / 다리 주소 답 없음", fn)


def modes_at(x, tick):
    modes = {}
    for e in x.scene["timeline"]:
        if x.tick_of(e["t_s"]) > tick:
            break
        if e["type"] == EV_MODE:
            modes[e["path"]] = e["mode"]
    return modes


def t_ask(x):
    resp = x.scene["responses"]
    pp, pr = x.b["paths"]["place"], x.b["paths"]["route"]
    probes = sorted({x.tt["probe_after_ticks"]} | {x.tick_of(e["t_s"]) + x.tt["probe_after_ticks"]
                                                   for e in x.scene["timeline"] if e["type"] == EV_MODE})
    for k in probes:
        modes = modes_at(x, k)
        mp = modes.get(pp, resp[pp][0]["mode"])
        mr = modes.get(pr, resp[pr][0]["mode"])
        ip = [r for r in resp[pp] if r["mode"] == mp]
        ir = [r for r in resp[pr] if r["mode"] == mr][0]

        def fn(k=k, ip=ip, ir=ir):
            x.seek(k)
            s1, r1, ms1 = raw_call(x.c, "POST", pp, body={"q": x.tt["place_q_hit"]})
            s2, r2, ms2 = raw_call(x.c, "POST", pp, body={"q": x.tt["place_q_miss"]})
            s3, r3, ms3 = raw_call(x.c, "POST", pr, body={"from": x.scene["stations"][0]["loc"], "to": x.scene["stations"][-1]["loc"]})
            b1, b2, b3 = (parse(r.decode("utf-8")) or {} for r in (r1, r2, r3))
            hit = next(r for r in ip if "match" not in r or re.search(r["match"], x.tt["place_q_hit"]))
            miss = next(r for r in ip if "match" not in r or re.search(r["match"], x.tt["place_q_miss"]))
            ok = (s1 == hit["status"] and s2 == miss["status"] and s3 == ir["status"]
                  and ms1 >= hit["delay_ms"] and ms3 >= ir["delay_ms"]
                  and (b1.get("places") == hit["body"].get("places") if "body" in hit else True)
                  and (b2.get("places") == miss["body"].get("places") if "body" in miss else True)
                  and (bool(b3.get("pieces")) if ir.get("build") else b3 == ir["body"]))
            return ("place '" + x.tt["place_q_hit"] + "' " + str(s1) + " " + str(len(b1.get("places", []))) + "곳 " + str(ms1) + " ms · '"
                    + x.tt["place_q_miss"] + "' " + str(s2) + " " + str(len(b2.get("places", []))) + "곳 · route " + str(s3) + " "
                    + str(ms3) + " ms " + (b3.get("code") or ("조각 " + str(len(b3.get("pieces", [])))))), ok
        x.check("틱 " + str(k) + " 답: 검색 " + mp + " · 경로 " + mr,
                "검색 " + str(ip[0]["status"]) + " · 경로 " + str(ir["status"]) + " · 늦춤 ≥ " + str(max(ip[0]["delay_ms"], ir["delay_ms"])) + " ms",
                fn)


def t_odd(x):
    resp = x.scene["responses"][x.b["paths"]["odd"]]
    po = x.b["paths"]["odd"]
    o = x.b["odd"]
    good = x.tt["odd_good"]
    probes = sorted({x.tt["probe_after_ticks"]} | {x.tick_of(e["t_s"]) + x.tt["probe_after_ticks"]
                                                   for e in x.scene["timeline"] if e["type"] == EV_MODE})
    sent = {"ok": 0, "rejected": 0}
    for k in probes:
        mode = modes_at(x, k).get(po, resp[0]["mode"])
        r = [r for r in resp if r["mode"] == mode][0]

        def fn(k=k, r=r, mode=mode):
            x.seek(k)
            s, raw, _ = raw_call(x.c, "POST", po, body=good)
            b = parse(raw.decode("utf-8")) or {}
            if r.get("build"):
                ok = s == HTTP_OK and bool(b.get("name"))
                sent["ok" if ok else "rejected"] += 1
                return str(s) + " 이름 " + str(b.get("name")), ok
            sent["rejected"] += 1
            return str(s) + " " + json.dumps(b, ensure_ascii=False), s == r["status"] and b == r["body"]
        x.check("틱 " + str(k) + " '이상해' 받기(" + mode + ")", str(r["status"]) + (" · 이름" if r.get("build") else " · 정해 둔 실패 답"), fn)
        if r.get("build"):
            bad_cases = [("모르는 칸", dict(good, **x.tt["odd_unknown"]), None),
                         ("메모 너무 김", dict(good, memo=x.tt["odd_memo_char"] * (o["memo_max_chars"] + 1)), None),
                         ("크기 한도 넘음", None, b"{" + b" " * x.b["max_body_bytes"] + b"}")]

            def bad_fn(cases=bad_cases):
                out, ok = [], True
                for what, body, raw in cases:
                    s, rr, _ = raw_call(x.c, "POST", po, body=body, raw=raw)
                    bb = parse(rr.decode("utf-8")) or {}
                    sent["rejected"] += 1
                    out.append(what + " " + str(s) + " " + str(bb.get("code")))
                    ok = ok and s == x.b["fail_http"][x.b["codes"]["bad"]] and bb.get("code") == x.b["codes"]["bad"]
                return " · ".join(out), ok
            x.check("틱 " + str(k) + " '이상해' 거절(꼴·크기)", "셋 다 400 bad", bad_fn)

    def db_fn():
        until = time.monotonic() + x.tt["db_wait_s"]
        while True:  # 쌓기 줄기가 쓸 때까지 기다림
            rows = x.rows("odd")
            if len(rows) >= sent["ok"] + sent["rejected"] or time.monotonic() > until:
                break
            time.sleep(x.tt["poll_s"])
        oks = sum(1 for r in rows if r["result"] == "ok")
        bads = sum(1 for r in rows if r["result"] == "rejected")
        return "DB 받음 " + str(oks) + " · 거절 " + str(bads) + " (보낸 것 받음 " + str(sent["ok"]) + " · 거절 " + str(sent["rejected"]) + ")", \
            oks == sent["ok"] and bads == sent["rejected"]
    x.check("'이상해' 받음·거절이 DB 에", "보낸 것과 같은 수", db_fn)


def t_bad(x):
    c = x.cfg["bad_payload"]
    stream_t = x.b["stream_target"]
    for ev in [e for e in x.scene["timeline"] if e["type"] == EV_BAD]:
        k = x.tick_of(ev["t_s"])

        def fn(ev=ev, k=k):
            x.seek(k)
            target, bad = ev["target"], ev["bad"]
            if target == stream_t:
                raw = x.stream_one()
                obj = parse(raw)
                row = x.flow_at(k)
                g = x.cfg["geo"]
                sane = g["lat_min"] <= row["lat"] <= g["lat_max"] and g["lng_min"] <= row["lng"] <= g["lng_max"] and row["speed_kmh"] >= 0
                evs = [json.loads(r["detail"]) for r in x.rows("event") if r["type"] == EV_BAD and r["tick"] == k]
                db_ok = sane and any(e.get("target") == target and e.get("bad") == bad for e in evs)
                db_text = " · DB 흐름 줄은 참 자리 " + str(sane) + " · DB 사건 줄 " + repr([e.get("bad") for e in evs])
                if bad == BAD_BROKEN:
                    return "흐름 날 글 " + str(len(raw)) + "자 · JSON 아님 " + str(obj is None) + db_text, obj is None and db_ok
                if bad == BAD_BIG:
                    return "흐름 한 줄 " + str(len(raw)) + "자" + db_text, obj is not None and len(raw) >= c["oversize_bytes"] and db_ok
                if bad == BAD_RANGE:
                    got = [obj["pos"]["lat"], obj["pos"]["lng"]]
                    return "흐름 자리 " + repr(got) + db_text, got == c["out_of_range_latlng"] and db_ok
                got = obj["pos"]["speed_kmh"]
                return "흐름 시속 " + str(got) + db_text, got == c["negative_speed_kmh"] and db_ok
            if target == "data":
                path = x.b["paths"]["data"] + (x.cfg["try"]["files"]["stations"].format(x.scene["stations"][0]["operators"][0]["zscode"])
                                               if bad == BAD_RANGE else x.cfg["try"]["files"]["meta"])
                s, raw, _ = raw_call(x.c, "GET", path)
            elif target == "place":
                s, raw, _ = raw_call(x.c, "POST", x.b["paths"]["place"], body={"q": x.tt["place_q_hit"]})
            else:
                s, raw, _ = raw_call(x.c, "POST", x.b["paths"][target],
                                     body={"from": x.scene["stations"][0]["loc"], "to": x.scene["stations"][-1]["loc"]})
            text = raw.decode("utf-8", "replace")
            obj = parse(text)
            if bad == BAD_BROKEN:
                return str(s) + " · " + str(len(raw)) + " 바이트 · JSON 아님 " + str(obj is None), obj is None
            if bad == BAD_BIG:
                return str(s) + " · " + str(len(raw)) + " 바이트", obj is not None and len(raw) >= c["oversize_bytes"]
            found = []

            def walk(node):
                if isinstance(node, dict):
                    for kk, v in node.items():
                        if kk in c["coord_keys"]:
                            found.append(v)
                        else:
                            walk(v)
                elif isinstance(node, list):
                    for v in node:
                        walk(v)
            walk(obj)
            flat = [v for v in found if v and not isinstance(v[0], list)] + [p for v in found if v and isinstance(v[0], list) for p in v]
            return str(s) + " · 좌표 " + str(len(flat)) + "개 모두 범위 밖 " + str(all(p == c["out_of_range_latlng"] for p in flat)), \
                bool(flat) and all(p == c["out_of_range_latlng"] for p in flat)
        x.check("틱 " + str(k) + " 나쁜 자료 " + ev["target"] + " " + ev["bad"], "그 대상의 답이 " + ev["bad"], fn)

    def after_fn():
        last = max(x.tick_of(e["t_s"]) + e["ticks"] for e in x.scene["timeline"] if e["type"] == EV_BAD)
        x.seek(last + x.tt["probe_after_ticks"])
        s1, r1, _ = raw_call(x.c, "GET", x.b["paths"]["data"] + x.cfg["try"]["files"]["meta"])
        s2, r2, _ = raw_call(x.c, "GET", x.b["paths"]["health"])
        raw = x.stream_one()
        return ("나쁜 자료 끝난 뒤 data " + str(s1) + " · health " + str(s2) + " · 흐름 JSON " + str(parse(raw) is not None)), \
            s1 == HTTP_OK and parse(r1.decode("utf-8")) is not None and s2 == HTTP_OK and parse(raw) is not None
    x.check("나쁜 자료 뒤 다리가 그대로 돎", "data 200 · health 200 · 흐름 JSON", after_fn)


def t_long(x):
    comp = x.scene["compose"]
    folder = x.cfg.resolve(x.cfg["scenes"]["dir"])
    cc = check_scenes.Ctx(x.cfg)
    names = list(check_scenes_names(x.cfg))
    lens = []
    for n in comp["scenes"]:
        _, s = check_scenes.check_scene(os.path.join(folder, n + x.cfg["scenes"]["line_suffix"]), cc, names)
        lens.append((n, s["ticks"]))
    want, off, i = [], 0, 0
    total = x.tick_of(comp["repeat_until_s"])
    while off <= total:
        n, ln = lens[i % len(lens)]
        want.append((n, off))
        off += ln
        i += 1

    def parts_fn():
        got_stream = [(e["part"], e["at_tick"]) for e in x.got["events"] if e["type"] == EV_PART]
        got_db = [(json.loads(r["detail"])["part"], r["tick"]) for r in x.rows("event") if r["type"] == EV_PART]
        tol = x.tt["tick_tolerance"]
        close = len(got_db) == len(want) and all(a[0] == b[0] and abs(a[1] - b[1]) <= tol * (j + 1)
                                                for j, (a, b) in enumerate(zip(got_db, want)))
        return "흐름 " + repr(got_stream) + " · DB 같음 " + str(got_stream == got_db), close and got_stream == got_db
    x.check("장면 바뀜(scene_part)이 흐름·DB 에 차례대로", repr(want) + " (틱은 장면마다 ± " + str(x.tt["tick_tolerance"]) + ")", parts_fn)

    def jumps_fn():
        parts = [(e["part"], e["at_tick"]) for e in x.got["events"] if e["type"] == EV_PART][1:]
        out = []
        for name, k in parts:
            a, b = x.flow_at(k - 1), x.flow_at(k)
            out.append(name + " 앞 " + str(round(geo.sphere_km([a["lat"], a["lng"]], [b["lat"], b["lng"]], x.radius),
                                                x.cfg["units"]["report_decimals"])) + " km")
        return "장면 사이 자리 넘어감: " + " · ".join(out), True
    x.check("장면 사이 자리(알림 — 실패로 보지 않음)", "다음 장면의 처음 자리로 넘어감", jumps_fn)

    def db_fn():
        counts = {k: len(x.rows(k)) for k in ("flow", "event", "charger", "speed")}
        runs = x.conn.execute("SELECT COUNT(*) FROM " + tbdb.ident(x.cfg["db"]["run_table"]) + " WHERE run = ? AND scene = ?",
                              (x.run, x.name)).fetchone()[0]
        n = x.tick_of(comp["repeat_until_s"]) + 1
        return "실행 " + str(x.run) + "(" + str(runs) + "줄) · DB " + json.dumps(counts, ensure_ascii=False), \
            runs == 1 and counts["flow"] == n
    x.check("한 실행 · DB 흐름 줄 = 1시간 틱", "실행 1 · 흐름 " + str(x.tick_of(comp["repeat_until_s"]) + 1) + "줄", db_fn)


CHECKS = {"plain": t_plain, "speeding": t_speeding, "updown": t_updown, "exit": t_exit, "charger": t_charger,
          "stop": t_stop, "down": t_down, "startup": t_startup, "ask": t_ask, "odd": t_odd, "bad": t_bad, "long": t_long}


def total_ticks(cfg, names):
    cc = check_scenes.Ctx(cfg)
    folder = cfg.resolve(cfg["scenes"]["dir"])
    all_names = list(check_scenes_names(cfg))
    n = 0
    for name in names:
        _, s = check_scenes.check_scene(os.path.join(folder, name + cfg["scenes"]["line_suffix"]), cc, all_names)
        n += s["ticks"]
    return n


def main(argv):
    args = argv[1:]
    if not args:
        print("쓰는 법: py try_t4.py <설정 파일 경로> [장면 이름 ...]")
        return FAIL_CODE
    try:
        cfg = tbconfig.Config(args[0])
    except tbconfig.ConfigError as e:
        print(str(e))
        return FAIL_CODE
    log = tblog.from_config(cfg, cfg.resolve)
    b, tr, tt = cfg["bridge"], cfg["try"], cfg["try_t4"]
    names = args[1:] or tt["order"]
    unknown = [n for n in names if n not in tt["checks"]]
    if unknown:
        print("설정 try_t4.checks 에 없는 장면: " + repr(unknown))
        return FAIL_CODE
    ticks = total_ticks(cfg, names)
    run_seconds = ticks * cfg["tick_interval_s"] / tt["scale"] + tt["per_scene_s"] * len(names) + tt["margin_s"]
    secret = secrets.token_urlsafe()
    env = dict(os.environ)
    env[b["secret_env"]] = secret
    env["PYTHONIOENCODING"] = "utf-8"
    log.write(WHERE + ".main", "시작", scenes=len(names), ticks=ticks, scale=tt["scale"], run_seconds=round(run_seconds))
    print("장면 " + str(len(names)) + "개 · 틱 " + str(ticks) + " · 배속 " + str(tt["scale"]) + " · 다리 " + str(round(run_seconds)) + "초",
          flush=True)
    started = time.monotonic()
    proc = subprocess.Popen([sys.executable, "-X", "utf8", cfg.resolve(b["script"]), cfg.path, str(run_seconds), str(tt["scale"])],
                            env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    c = try_server.Client(cfg, secret)
    c.timeout = tt["http_timeout_s"]
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
    t.add("시험 모드로 띄움(배속 " + str(tt["scale"]) + ")", "다리가 " + str(tr["health_wait_s"]) + "초 안에 답함", "답함" if up else "안 답함", up)
    if up:
        conn = tbdb.connect(cfg, create=False)
        try:
            for name in names:
                t0 = time.monotonic()
                try:
                    x = Ctx(cfg, c, t, conn, name)
                    play(x)
                    check_common(x)
                    CHECKS[tt["checks"][name]](x)
                except Exception as e:
                    log.write(WHERE + ".main", "예외", scene=name, error=repr(e))
                    t.add(name + " · 시험 진행", "끝까지", "예외 " + repr(e), False)
                print("  " + name + " 끝 (" + str(round(time.monotonic() - t0, cfg["units"]["report_decimals"])) + "초)", flush=True)
        finally:
            conn.close()
    limit = run_seconds + tr["exit_grace_s"]
    try:
        out, _ = proc.communicate(timeout=max(limit - (time.monotonic() - started), tr["poll_s"]))
        t.add("다리가 스스로 끝남", "코드 0", "코드 " + str(proc.returncode), proc.returncode == OK_CODE)
    except subprocess.TimeoutExpired:
        proc.kill()
        out, _ = proc.communicate()
        t.add("다리가 스스로 끝남", "코드 0", str(round(limit)) + "초에도 안 끝나 죽임", False)
    text = out.decode("utf-8", "replace")
    print("--- 다리 화면 ---")
    print(text.strip())
    clean = DB_CLEAN in text
    t.add("시험 DB 쓰기 실패·버림", "다리 화면 '" + DB_CLEAN + "'", "맞음" if clean else "다름(위 다리 화면)", clean)
    ok = t.print()
    log.write(WHERE + ".main", "끝", result=try_server.PASS_WORD if ok else try_server.FAIL_WORD, rows=len(t.rows),
              secs=round(time.monotonic() - started))
    return OK_CODE if ok else FAIL_CODE


if __name__ == "__main__":
    sys.exit(main(sys.argv))
