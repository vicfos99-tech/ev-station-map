"""장면 검사기 — 장면 파일이 꼴과 뜻에 맞는지 본다(파이썬 기본 모듈만).

쓰는 법:  py tools/check_scenes.py <설정 파일 경로>
  예)    py tools/check_scenes.py config/testbed.json

1) 꼴: scenes/scene.schema.json (필수 칸, 칸의 꼴, 시속 0 이상 등)
2) 뜻: 이름 = 파일 이름, 좌표가 설정의 범위 안, 선 파일과 km 구간, 속도 표가 길을 빈틈·겹침 없이 덮나,
   시간표가 시각 순서이고 주행 시간 안인가, 시간표의 충전소·충전기 id 가 목록에 있나,
   상태·출처·켤 때 실패 낱말이 설정에 있나, 손으로 만든 선을 실제 자료라 적지 않았나.
틀리면 어느 파일의 어디가 무엇이 틀렸는지 찍고 0 아닌 코드로 끝난다. 시작·끝·오류는 기록장에.
"""
import glob
import json
import math
import os
import sys

import geo
import schemacheck
import tbconfig
import tblog

WHERE = "check_scenes"
OK_CODE = 0
FAIL_CODE = 1


class Ctx:
    """한 번 검사에 쓰는 것들(설정·꼴·선 파일 저장)."""

    def __init__(self, cfg):
        self.cfg = cfg
        self.geo = cfg["geo"]
        self.scene_schema = tbconfig.read_json(cfg.resolve(cfg["scenes"]["schema_file"]))
        self.line_schema = tbconfig.read_json(cfg.resolve(cfg["scenes"]["line_schema_file"]))
        self.lines = {}

    def in_range(self, latlng):
        lat, lng = latlng
        g = self.geo
        return g["lat_min"] <= lat <= g["lat_max"] and g["lng_min"] <= lng <= g["lng_max"]

    def line(self, name):
        """선 파일을 읽어 (자료, 길이 km, 오류 목록)을 돌려준다. 한 번 읽은 것은 다시 읽지 않는다."""
        if name in self.lines:
            return self.lines[name]
        sc = self.cfg["scenes"]
        path = os.path.join(self.cfg.resolve(sc["lines_dir"]), name + sc["line_suffix"])
        errors = []
        data, length = None, None
        try:
            data = tbconfig.read_json(path)
        except (OSError, ValueError) as e:
            errors.append("선 파일 '" + name + "' 을(를) 읽지 못함: " + str(e))
        if data is not None:
            errors.extend("선 " + name + " " + e for e in schemacheck.validate(data, self.line_schema))
        if data is not None and not errors:
            if data["name"] != name:
                errors.append("선 " + name + ": 안의 name 이 파일 이름과 다름(" + data["name"] + ")")
            for i, p in enumerate(data["points"]):
                if not self.in_range(p):
                    errors.append("선 " + name + " $.points[" + str(i) + "]: 좌표가 설정 범위 밖 " + repr(p))
            length = geo.line_length_km(data["points"], self.geo["earth_radius_km"])
        self.lines[name] = (data, length, errors)
        return self.lines[name]


def _leg_ranges(scene, ctx, err, real):
    """길 조각마다 (낮은 km, 높은 km, 길이 km)를 낸다. 못 셈하면 None."""
    out = []
    for i, leg in enumerate(scene["route"]["legs"]):
        at = "$.route.legs[" + str(i) + "]"
        if leg["kind"] == "line":
            _, length, lerr = ctx.line(leg["line"])
            for e in lerr:
                err(at + ": " + e)
            lo, hi = sorted((leg["from_km"], leg["to_km"]))
            if lo == hi:
                err(at + ": from_km 과 to_km 이 같음 — 달릴 길이 없음")
            if length is not None and hi > length:
                err(at + ": km " + repr(hi) + " 이(가) 선 길이 " + repr(round(length, ctx.cfg["units"]["report_decimals"])) + " km 를 넘음")
            out.append((lo, hi, hi - lo) if length is not None else None)
        else:
            for j, p in enumerate(leg["points"]):
                if not ctx.in_range(p):
                    err(at + ".points[" + str(j) + "]: 좌표가 설정 범위 밖 " + repr(p))
            if leg["handmade"] and real:
                err(at + ": 손으로 만든 선(handmade=true)인데 data_source.real 이 true — 짐작 좌표를 실제처럼 쓰지 않는다")
            length = geo.line_length_km(leg["points"], ctx.geo["earth_radius_km"])
            out.append((0, length, length))
    return out


def _check_cover(items, ranges, name, err, check_cover):
    """구간 목록이 조각의 km 범위 안에 있고 겹치지 않는지(check_cover 면 빈틈도) 본다."""
    by_leg = {}
    for i, it in enumerate(items):
        at = "$." + name + "[" + str(i) + "]"
        if it["leg"] >= len(ranges):
            err(at + ": leg " + str(it["leg"]) + " 이(가) 없는 길 조각")
            continue
        if it["from_km"] >= it["to_km"]:
            err(at + ": from_km 이 to_km 보다 작아야 함(진행 방향과 관계없이 작은 km 를 from 에)")
            continue
        rng = ranges[it["leg"]]
        if rng is None:
            continue
        lo, hi, _ = rng
        if it["from_km"] < lo or it["to_km"] > hi:
            err(at + ": km " + repr(it["from_km"]) + "~" + repr(it["to_km"]) + " 이(가) 길 조각 범위 " + repr(lo) + "~" + repr(hi) + " 밖")
            continue
        by_leg.setdefault(it["leg"], []).append((it["from_km"], it["to_km"], i))
    for leg, rng in enumerate(ranges):
        if rng is None:
            continue
        lo, hi, _ = rng
        segs = sorted(by_leg.get(leg, []))
        pos = lo
        for a, b, i in segs:
            at = "$." + name + "[" + str(i) + "]"
            if a < pos:
                err(at + ": 앞 구간과 겹침(km " + repr(a) + " < " + repr(pos) + ")")
            elif check_cover and a > pos:
                err(at + ": 앞에 빈틈(km " + repr(pos) + "~" + repr(a) + " 에 시속이 없음)")
            pos = max(pos, b)
        if check_cover and pos < hi:
            err("$." + name + ": 길 조각 " + str(leg) + " 의 km " + repr(pos) + "~" + repr(hi) + " 에 시속이 없음")


def _duration_s(scene, ranges, ctx, err):
    per_hour = ctx.cfg["units"]["seconds_per_hour"]
    total = 0.0
    for i, sp in enumerate(scene["speeds"]):
        at = "$.speeds[" + str(i) + "]"
        if sp["kmh"] > ctx.geo["speed_max_kmh"]:
            err(at + ": 시속 " + repr(sp["kmh"]) + " 이(가) 설정 상한 " + repr(ctx.geo["speed_max_kmh"]) + " 을(를) 넘음")
        length = sp["to_km"] - sp["from_km"]
        if sp["kmh"] == 0:
            if length > 0:
                err(at + ": 시속 0 인 구간은 끝나지 않음 — 멈춤은 stops 에 쓴다")
            continue
        total += max(length, 0) / sp["kmh"] * per_hour
    for i, st in enumerate(scene.get("stops", [])):
        at = "$.stops[" + str(i) + "]"
        if st["leg"] >= len(ranges):
            err(at + ": leg " + str(st["leg"]) + " 이(가) 없는 길 조각")
        elif ranges[st["leg"]] is not None:
            lo, hi, _ = ranges[st["leg"]]
            if not lo <= st["at_km"] <= hi:
                err(at + ": km " + repr(st["at_km"]) + " 이(가) 길 조각 범위 밖")
        total += st["duration_s"]
    return total


def _check_stations(scene, ctx, err):
    """충전소 목록을 보고 {충전소 id: {충전기 id, …}} 를 돌려준다."""
    codes = ctx.cfg["status_codes"]
    chargers_of = {}
    seen_places = set()
    for i, st in enumerate(scene["stations"]):
        at = "$.stations[" + str(i) + "]"
        if st["id"] in seen_places:
            err(at + ": 자리 id '" + st["id"] + "' 이(가) 겹침")
        seen_places.add(st["id"])
        if not ctx.in_range(st["loc"]):
            err(at + ".loc: 좌표가 설정 범위 밖 " + repr(st["loc"]))
        if (st["line"] is None) != (st["km"] is None):
            err(at + ": line 과 km 은 둘 다 있거나 둘 다 null 이어야 함")
        elif st["line"] is not None:
            _, length, lerr = ctx.line(st["line"])
            for e in lerr:
                err(at + ": " + e)
            if length is not None and st["km"] > length:
                err(at + ": km " + repr(st["km"]) + " 이(가) 선 길이를 넘음")
        for j, op in enumerate(st["operators"]):
            oat = at + ".operators[" + str(j) + "]"
            if op["station_id"] in chargers_of:
                err(oat + ": 충전소 id '" + op["station_id"] + "' 이(가) 겹침")
            if not ctx.in_range(op["loc"]):
                err(oat + ".loc: 좌표가 설정 범위 밖 " + repr(op["loc"]))
            ids = set()
            for k, ch in enumerate(op["chargers"]):
                cat = oat + ".chargers[" + str(k) + "]"
                if ch["id"] in ids:
                    err(cat + ": 충전기 id '" + ch["id"] + "' 이(가) 겹침")
                ids.add(ch["id"])
                if ch["status"] not in codes:
                    err(cat + ": 상태 '" + ch["status"] + "' 이(가) 설정 status_codes 에 없음")
            chargers_of[op["station_id"]] = ids
    return chargers_of


def _check_timeline(scene, chargers_of, duration, ctx, err):
    cfg = ctx.cfg
    responses = scene.get("responses", {})
    last = None
    for i, ev in enumerate(scene["timeline"]):
        at = "$.timeline[" + str(i) + "]"
        if last is not None and ev["t_s"] < last:
            err(at + ": 시각 " + repr(ev["t_s"]) + " 이(가) 앞 사건(" + repr(last) + ")보다 이름 — 시간표는 시각 순서로")
        last = ev["t_s"]
        if duration is not None and ev["t_s"] > duration:
            err(at + ": 시각 " + repr(ev["t_s"]) + " 초가 주행 시간 " + repr(round(duration)) + " 초 뒤 — 장면이 끝난 뒤의 사건")
        kind = ev["type"]
        if kind == "charger_status":
            if ev["station_id"] not in chargers_of:
                err(at + ": 충전소 id '" + ev["station_id"] + "' 이(가) 충전소 목록에 없음")
            elif ev["charger_id"] not in chargers_of[ev["station_id"]]:
                err(at + ": 충전기 id '" + ev["charger_id"] + "' 이(가) 충전소 " + ev["station_id"] + " 에 없음")
            if ev["status"] not in cfg["status_codes"]:
                err(at + ": 상태 '" + ev["status"] + "' 이(가) 설정 status_codes 에 없음")
        elif kind in ("source_down", "source_up"):
            if ev["source"] not in cfg["sources"]:
                err(at + ": 출처 '" + ev["source"] + "' 이(가) 설정 sources 에 없음")
        elif kind == "startup_fail":
            if ev["target"] not in cfg["startup_fail_targets"]:
                err(at + ": 켤 때 실패 대상 '" + ev["target"] + "' 이(가) 설정 startup_fail_targets 에 없음")
        elif kind == "response_mode":
            modes = [r["mode"] for r in responses.get(ev["path"], [])]
            if ev["mode"] not in modes:
                err(at + ": 길 '" + ev["path"] + "' 의 답 '" + ev["mode"] + "' 이(가) responses 에 없음")


def check_scene(path, ctx, scene_names):
    """장면 한 개를 본다. (오류 목록, 요약 사전 또는 None)."""
    errors = []
    label = os.path.basename(path)

    def err(msg):
        errors.append(label + " " + msg)

    try:
        scene = tbconfig.read_json(path)
    except (OSError, ValueError) as e:
        err(": 읽지 못함 — " + str(e))
        return errors, None
    for e in schemacheck.validate(scene, ctx.scene_schema):
        err(e)
    if errors:
        return errors, None

    stem = os.path.splitext(label)[0]
    if scene["name"] != stem:
        err("$.name: '" + scene["name"] + "' 이(가) 파일 이름 '" + stem + "' 과 다름")
    compose = scene.get("compose")
    if not scene["route"]["legs"] and compose is None:
        err("$.route.legs: 길 조각이 없음(compose 장면만 비울 수 있음)")
    if compose is not None:
        for j, name in enumerate(compose["scenes"]):
            if name not in scene_names or name == scene["name"]:
                err("$.compose.scenes[" + str(j) + "]: 장면 '" + name + "' 이(가) 없거나 자기 자신")
    if scene["emit"]["accuracy_m"] > ctx.geo["accuracy_max_m"]:
        err("$.emit.accuracy_m: 설정 상한 " + repr(ctx.geo["accuracy_max_m"]) + " 을(를) 넘음")

    ranges = _leg_ranges(scene, ctx, err, scene["data_source"]["real"])
    _check_cover(scene["speeds"], ranges, "speeds", err, True)
    _check_cover(scene["limits"], ranges, "limits", err, False)
    duration = _duration_s(scene, ranges, ctx, err)
    chargers_of = _check_stations(scene, ctx, err)
    _check_timeline(scene, chargers_of, None if compose is not None else duration, ctx, err)

    known = [r for r in ranges if r is not None]
    summary = {
        "name": scene["name"],
        "real": scene["data_source"]["real"],
        "legs": len(scene["route"]["legs"]),
        "km": sum(r[-1] for r in known),
        "duration_s": duration,
        "ticks": math.ceil(duration / ctx.cfg["tick_interval_s"]),
        "stations": len(scene["stations"]),
        "events": len(scene["timeline"]),
    }
    return errors, summary


def run(cfg, log):
    """모든 장면을 본다. (통과 여부, 오류 목록, 요약 목록). 찍기는 부르는 쪽이 한다."""
    log.write(WHERE + ".run", "시작", config=cfg.path)
    ctx = Ctx(cfg)
    folder = cfg.resolve(cfg["scenes"]["dir"])
    paths = sorted(glob.glob(os.path.join(folder, cfg["scenes"]["glob"])))
    names = [os.path.splitext(os.path.basename(p))[0] for p in paths]
    errors, summaries = [], []
    if not paths:
        errors.append("장면 파일이 하나도 없음: " + folder)
    if cfg["active_scene"] not in names:
        errors.append("설정 active_scene '" + cfg["active_scene"] + "' 인 장면 파일이 없음")
    for p in paths:
        errs, summary = check_scene(p, ctx, names)
        errors.extend(errs)
        if summary is not None:
            summaries.append(summary)
    for e in errors:
        log.write(WHERE + ".run", "오류", detail=e)
    log.write(WHERE + ".run", "끝", scenes=len(paths), errors=len(errors))
    return not errors, errors, summaries


def print_result(ok, errors, summaries, decimals):
    print_summaries(summaries, decimals)
    for e in errors:
        print("  틀림: " + e)
    print("장면 검사: " + ("통과" if ok else "실패 — 틀린 곳 " + str(len(errors)) + "개"))


def print_summaries(summaries, decimals):
    for s in summaries:
        print("  " + s["name"] + ": 실제 자료=" + ("예" if s["real"] else "아니오")
              + " · 길 조각 " + str(s["legs"]) + " · " + str(round(s["km"], decimals)) + " km"
              + " · 주행 " + str(round(s["duration_s"], decimals)) + " 초 · 틱 " + str(s["ticks"])
              + " · 충전소 자리 " + str(s["stations"]) + " · 사건 " + str(s["events"]))


def main(argv):
    args = argv[1:]
    if len(args) != 1:
        print("쓰는 법: py check_scenes.py <설정 파일 경로>")
        return FAIL_CODE
    try:
        cfg = tbconfig.Config(args[0])
    except tbconfig.ConfigError as e:
        print(str(e))
        return FAIL_CODE
    log = tblog.from_config(cfg, cfg.resolve)
    try:
        ok, errors, summaries = run(cfg, log)
    except Exception as e:
        log.write(WHERE + ".main", "예외", config=args[0], error=repr(e))
        raise
    print_result(ok, errors, summaries, cfg["units"]["report_decimals"])
    return OK_CODE if ok else FAIL_CODE


if __name__ == "__main__":
    sys.exit(main(sys.argv))
