"""장면 재생 — 장면 파일을 틱마다의 자리·사건으로 펴고, 지금 틱과 상태를 들고 있는다(파이썬 기본 모듈만).

- 자리: 길 조각(선의 km 구간 또는 좌표 목록)을 속도 표대로 틱 간격(설정)마다 나아가며 미리 다 셈한다.
  멈춤(stops)은 그 km 에서 정한 초만큼 시속 0, 위치 튐(gps_jump)은 그 틱들만 자리를 옮긴다.
- 사건: 시간표의 t_s 를 틱 번호로 바꿔 틱마다 묶는다. 조종 길로 넣은 사건(inject)은 그때의 틱에 붙는다.
- 상태: 어느 틱에서든 '처음 상태 + 그 틱까지의 사건'으로 다시 셈한다(앞으로 건너뛰기·뒤로 가기가 같은 셈).
숫자·경로는 모두 설정과 장면 파일에서 온다.
"""
import bisect
import datetime
import glob
import math
import os
import threading

import geo
import schemacheck
import tbconfig


class SceneError(Exception):
    pass


EV_CHARGER = "charger_status"
EV_DOWN = "source_down"
EV_UP = "source_up"
EV_STARTUP = "startup_fail"
EV_JUMP = "gps_jump"
EV_MODE = "response_mode"
KIND_LINE = "line"
CHARGING_WORD = "charging"


class Path:
    """좌표 목록 하나와 그 위의 누적 km."""

    def __init__(self, points, radius_km):
        if not points[1:]:
            raise SceneError("길 좌표가 둘보다 적음")
        self.points = points
        self.cum = [0.0]
        for p, q in zip(points, points[1:]):
            self.cum.append(self.cum[-1] + geo.sphere_km(p, q, radius_km))

    def _seg(self, km):
        i = bisect.bisect_right(self.cum, km) - 1
        return max(0, min(i, len(self.points) - 1 - 1))

    def at(self, km):
        i = self._seg(km)
        a, b = self.points[i], self.points[i + 1]
        span = self.cum[i + 1] - self.cum[i]
        f = (km - self.cum[i]) / span if span > 0 else 0.0
        f = max(0.0, min(1.0, f))
        return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]

    def heading(self, km, forward):
        i = self._seg(km)
        a, b = self.points[i], self.points[i + 1]
        return geo.bearing_deg(a, b) if forward else geo.bearing_deg(b, a)


def _leg_path(cfg, leg, lines):
    radius = cfg["geo"]["earth_radius_km"]
    if leg["kind"] == KIND_LINE:
        name = leg["line"]
        if name not in lines:
            sc = cfg["scenes"]
            data = tbconfig.read_json(os.path.join(cfg.resolve(sc["lines_dir"]), name + sc["line_suffix"]))
            lines[name] = Path(data["points"], radius)
        return lines[name], leg["from_km"], leg["to_km"]
    path = Path(leg["points"], radius)
    return path, 0.0, path.cum[-1]


def _speed_at(speeds, km, forward):
    for s in speeds:
        if (s["from_km"] <= km < s["to_km"]) if forward else (s["from_km"] < km <= s["to_km"]):
            return s["kmh"]
    for s in speeds:
        if s["from_km"] <= km <= s["to_km"]:
            return s["kmh"]
    raise SceneError("km " + repr(km) + " 에 시속이 없음")


def build_track(cfg, scene):
    """틱마다의 자리 목록 [{lat, lng, speed_kmh, heading_deg}]."""
    dt = cfg["tick_interval_s"]
    per_hour = cfg["units"]["seconds_per_hour"]
    lines = {}
    track = []
    for li, leg in enumerate(scene["route"]["legs"]):
        path, a, b = _leg_path(cfg, leg, lines)
        forward = b >= a
        speeds = [s for s in scene["speeds"] if s["leg"] == li]
        stops = sorted((s for s in scene.get("stops", []) if s["leg"] == li),
                       key=lambda s: s["at_km"], reverse=not forward)
        done_stops = set()

        def sample(km, kmh):
            lat, lng = path.at(km)
            return {"lat": lat, "lng": lng, "speed_kmh": kmh, "heading_deg": path.heading(km, forward)}

        km = a
        if not track:
            track.append(sample(km, _speed_at(speeds, km, forward)))
        while km != b:
            kmh = _speed_at(speeds, km, forward)
            step = kmh * dt / per_hour
            nxt = km + step if forward else km - step
            passed = (nxt >= b) if forward else (nxt <= b)
            if passed:
                nxt = b
            stop = next((s for i, s in enumerate(stops) if i not in done_stops
                         and ((km < s["at_km"] <= nxt) if forward else (nxt <= s["at_km"] < km))), None)
            if stop is not None:
                done_stops.add(stops.index(stop))
                km = stop["at_km"]
                for _ in range(math.ceil(stop["duration_s"] / dt)):
                    track.append(sample(km, 0.0))
                continue
            km = nxt
            track.append(sample(km, kmh))
    return track


def route_pieces(cfg, scene):
    """장면의 길 조각을 우리 모양 길 답의 조각 [{road, line, km}] 으로(꼭짓점만 — 틱 자리 아님)."""
    pieces = []
    for leg in scene["route"]["legs"]:
        if leg["kind"] == KIND_LINE:
            sc = cfg["scenes"]
            data = tbconfig.read_json(os.path.join(cfg.resolve(sc["lines_dir"]), leg["line"] + sc["line_suffix"]))
            path = Path(data["points"], cfg["geo"]["earth_radius_km"])
            road = data["highway"]
            a, b = leg["from_km"], leg["to_km"]
        else:
            path = Path(leg["points"], cfg["geo"]["earth_radius_km"])
            road = leg.get("road", "")
            a, b = 0.0, path.cum[-1]
        lo, hi = sorted((a, b))
        inner = [p for p, k in zip(path.points, path.cum) if lo < k < hi]
        line = [path.at(lo)] + inner + [path.at(hi)]
        if b < a:
            line.reverse()
        pieces.append({"road": road, "line": line, "km": hi - lo})
    return pieces


def _apply_jumps(cfg, track, events):
    dt = cfg["tick_interval_s"]
    radius = cfg["geo"]["earth_radius_km"]
    for ev in events:
        if ev["type"] != EV_JUMP:
            continue
        first = int(ev["t_s"] // dt)
        for n in range(first, min(first + ev["ticks"], len(track))):
            lat, lng = geo.offset_point([track[n]["lat"], track[n]["lng"]],
                                        ev["offset_m"] / cfg["units"]["m_per_km"], ev["bearing_deg"], radius)
            track[n] = dict(track[n], lat=lat, lng=lng)


def scene_files(cfg):
    """{장면 이름: 파일 경로} — 설정의 장면 폴더·무늬로 찾은 것만(받은 글자로 경로를 만들지 않는다)."""
    sc = cfg["scenes"]
    found = glob.glob(os.path.join(cfg.resolve(sc["dir"]), sc["glob"]))
    return {os.path.splitext(os.path.basename(p))[0]: p for p in sorted(found)}


class Scene:
    """읽어 편 장면 하나(바뀌지 않음)."""

    def __init__(self, cfg, name):
        sc = cfg["scenes"]
        known = scene_files(cfg)
        if name not in known:
            raise SceneError("장면 '" + name + "' 이(가) 장면 목록에 없음")
        path = known[name]
        try:
            data = tbconfig.read_json(path)
        except (OSError, ValueError) as e:
            raise SceneError("장면 '" + name + "' 을(를) 읽지 못함: " + str(e))
        schema = tbconfig.read_json(cfg.resolve(sc["schema_file"]))
        errors = schemacheck.validate(data, schema)
        if errors:
            raise SceneError("장면 '" + name + "' 이(가) 꼴에 맞지 않음: " + "; ".join(errors))
        if data.get("compose") is not None:
            raise SceneError("이어 달리기(compose) 장면은 아직 재생하지 않음(T4)")
        self.name = name
        self.data = data
        self.event_schema = schema["$defs"]["event"]
        self.schema_root = schema
        self.track = build_track(cfg, data)
        _apply_jumps(cfg, self.track, data["timeline"])
        dt = cfg["tick_interval_s"]
        self.events = {}
        for ev in data["timeline"]:
            self.events.setdefault(int(ev["t_s"] // dt), []).append(ev)
        self.operators = [op for place in data["stations"] for op in place["operators"]]
        self.initial = {(op["station_id"], ch["id"]): ch["status"]
                        for op in self.operators for ch in op["chargers"]}

    @property
    def last_tick(self):
        return len(self.track) - 1


class Player:
    """지금 장면·틱·멈춤과 넣은 사건을 들고 있는 것(여러 줄기에서 부름 — 잠금 하나로 지킴)."""

    def __init__(self, cfg):
        self.cfg = cfg
        self.dt = cfg["tick_interval_s"]
        self.cond = threading.Condition()
        self.scene = None
        self.gen = 0
        self.tick = 0
        self.paused = False
        self.injected = {}
        self.inject_log = []
        self.start_wall = self._now()

    @staticmethod
    def _now():
        return datetime.datetime.now(datetime.timezone.utc)

    def _reset(self, tick):
        self.inject_log = []
        self.tick = tick
        self.start_wall = self._now() - datetime.timedelta(seconds=tick * self.dt)
        self.gen += 1
        self.cond.notify_all()

    def select(self, name):
        scene = Scene(self.cfg, name)
        with self.cond:
            self.scene = scene
            self.injected = {}
            self.paused = False
            self._reset(0)
        return scene

    def restart(self):
        with self.cond:
            self.injected = {}
            self._reset(0)

    def pause(self, on):
        with self.cond:
            self.paused = on
            if not on:
                self.start_wall = self._now() - datetime.timedelta(seconds=self.tick * self.dt)
            self.cond.notify_all()

    def seek(self, tick):
        with self.cond:
            if not 0 <= tick <= self.scene.last_tick:
                raise SceneError("틱 " + repr(tick) + " 이(가) 장면 범위 0~" + str(self.scene.last_tick) + " 밖")
            self._reset(tick)

    def inject(self, ev):
        with self.cond:
            probe = dict(ev, t_s=0)
            errors = schemacheck.validate(probe, self.scene.event_schema, self.scene.schema_root)
            if errors:
                raise SceneError("넣을 사건이 꼴에 맞지 않음: " + "; ".join(errors))
            ev = dict(ev, t_s=self.tick * self.dt)
            self.injected.setdefault(self.tick, []).append(ev)
            self.inject_log.append(ev)
            self.cond.notify_all()
            return ev

    def advance(self):
        """틱 하나 나아감(멈춤·끝이면 그대로). 나아갔으면 참."""
        with self.cond:
            if self.scene is None or self.paused or self.tick >= self.scene.last_tick:
                return False
            self.tick += 1
            self.cond.notify_all()
            return True

    def events_at(self, tick):
        return list(self.scene.events.get(tick, [])) + list(self.injected.get(tick, []))

    def scene_events_at(self, tick):
        """장면 파일의 사건만(넣은 사건은 inject_log 차례로 흐름에 따로 간다 — 이미 보낸 틱에 붙어도 놓치지 않게)."""
        return list(self.scene.events.get(tick, []))

    def state_at(self, tick):
        """그 틱까지의 사건을 처음 상태에 얹은 상태(잠금 안에서 부른다)."""
        chargers = {k: {"word": w, "since_tick": 0, "last_end_tick": None}
                    for k, w in self.scene.initial.items()}
        down, startup, modes = {}, [], {}
        codes = self.cfg["status_codes"]
        ticks = sorted(t for t in set(self.scene.events) | set(self.injected) if t <= tick)
        for t in ticks:
            for ev in self.events_at(t):
                kind = ev["type"]
                if kind == EV_CHARGER:
                    key = (ev["station_id"], ev["charger_id"])
                    old = chargers.get(key)
                    if old is None or ev["status"] not in codes:
                        continue
                    was_charging = old["word"] == CHARGING_WORD
                    chargers[key] = {"word": ev["status"], "since_tick": t,
                                     "last_end_tick": t if was_charging and ev["status"] != CHARGING_WORD
                                     else old["last_end_tick"]}
                elif kind == EV_DOWN:
                    down.setdefault(ev["source"], t)
                elif kind == EV_UP:
                    down.pop(ev["source"], None)
                elif kind == EV_STARTUP:
                    if ev["target"] not in startup:
                        startup.append(ev["target"])
                elif kind == EV_MODE:
                    modes[ev["path"]] = ev["mode"]
        return {"chargers": chargers, "down": down, "startup_fail": startup, "modes": modes}

    def wall_of(self, tick):
        return self.start_wall + datetime.timedelta(seconds=tick * self.dt)

    def snapshot(self):
        with self.cond:
            if self.scene is None:
                return None
            return {"scene": self.scene, "gen": self.gen, "tick": self.tick, "paused": self.paused,
                    "ended": self.tick >= self.scene.last_tick, "state": self.state_at(self.tick),
                    "start_wall": self.start_wall, "inject_count": len(self.inject_log)}

