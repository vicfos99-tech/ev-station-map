"""장면의 충전소 자리(stations)를 중계 실제 자료 사본에서 뽑는다(파이썬 기본 모듈만).

쓰는 법:  py tools/pick_stations.py <설정 파일 경로> <중계 자료 사본 폴더> <장면 이름> <선 이름> <자리>... [--write]
  자리 = rest:<노선 key>:<휴게소 id>   (사본 routes.json 의 휴게소 — 예: rest:live-gb-up:live-gb-up-11)
       | around:<충전소 id>            (사본 stations/<시군구>.json 의 고속도로 밖 충전소 — 예: around:ME21B220)
  예)    py tools/pick_stations.py config/testbed.json C:/Claude_work/90_임시/중계자료_사본_2026-11-25 S3_상행하행 gyeongbu_down rest:live-gb-down:live-gb-down-7 --write

- 휴게소: 이름·자리·방향(노선 direction)은 routes.json, 충전기 id 는 stations/<시군구>.json 에서 '차례와 (종류, 출력)'이
  모두 같을 때만 가져온다(tools/match_ids.py 와 같은 규칙). 처음 상태는 routes.json 의 상태 낱말.
  선 위 km 는 휴게소 자리를 그 선에 가장 가깝게 내린 점의 km(상행 휴게소도 같은 선의 km 로).
- 고속도로 밖 충전소: kind around · line·km 없음. 처음 상태는 status/<시군구>.json 의 stat 코드를 설정 status_codes 로 낱말로.
- --write 가 없으면 뽑은 것만 찍는다. 있으면 그 장면 파일의 stations 칸만 바꾼다.
못 뽑으면(없는 id·충전기 차례 다름·모르는 상태) 0 아닌 코드로 끝난다. 시작·끝·못 뽑음은 기록장에.
"""
import json
import math
import os
import sys

import geo
import match_ids
import tbconfig
import tblog

WHERE = "pick_stations"
OK_CODE = 0
FAIL_CODE = 1
WRITE_FLAG = "--write"
SPEC_SEP = ":"
ROUTES_FILE = "routes" + os.extsep + "json"
STATUS_DIR = "status"
KIND_REST = "rest"
KIND_AROUND = "around"
FIXED_ARGS = ("config", "relay", "scene", "line")


class PickError(Exception):
    pass


def project_km(points, cum, loc):
    """loc 를 선(points, 누적 km cum)에 가장 가깝게 내린 점의 km. 조각마다 평면 근사(경도에 cos 위도)로 내린다."""
    best = None
    for i, (a, b) in enumerate(zip(points, points[1:])):
        k = math.cos(math.radians(a[0]))
        ax, ay = a[1] * k, a[0]
        bx, by = b[1] * k, b[0]
        px, py = loc[1] * k, loc[0]
        dx, dy = bx - ax, by - ay
        span = dx * dx + dy * dy
        f = ((px - ax) * dx + (py - ay) * dy) / span if span > 0 else 0.0
        f = max(0.0, min(1.0, f))
        gap = math.hypot(px - (ax + dx * f), py - (ay + dy * f))
        if best is None or gap < best[0]:
            best = (gap, cum[i] + (cum[i + 1] - cum[i]) * f)
    return best[1]


def status_word(cfg, stat):
    for word, code in cfg["status_codes"].items():
        if code == stat:
            return word
    raise PickError("stat 코드 " + repr(stat) + " 이(가) 설정 status_codes 에 없음")


def operator_from(relay, sid, chargers_src):
    """충전소 하나를 장면 꼴로. chargers_src = [(종류, 출력, 상태 낱말)] — 사본 stations 의 차례와 맞아야 함."""
    hit = relay.get(sid)
    if hit is None:
        raise PickError("충전소 id " + sid + " 이(가) 사본 stations 에 없음")
    zscode, zcodes, st = hit
    op = {"station_id": sid, "operator": st["operator"], "maker": st.get("maker", ""), "loc": st["loc"],
          "chargers": [{"id": str(n), "type": t, "kw": float(kw), "status": w} for n, (t, kw, w) in enumerate(chargers_src)]}
    _, why = match_ids.match_operator(op, relay)
    if why is not None:
        raise PickError(sid + ": " + why)
    return op


def pick_rest(cfg, relay, routes, line_pts, cum, route_key, rest_id):
    route = next((r for r in routes["routes"] if r["key"] == route_key), None)
    if route is None:
        raise PickError("노선 key " + route_key + " 이(가) routes.json 에 없음")
    ra = next((x for x in route["rest_areas"] if x["id"] == rest_id), None)
    if ra is None:
        raise PickError("휴게소 id " + rest_id + " 이(가) 노선 " + route_key + " 에 없음")
    ops = []
    for st in ra["stations"]:
        src = [(c["type"], c["power_kw"], c["status"]) for c in st["chargers"]]
        for _, _, w in src:
            if w not in cfg["status_codes"]:
                raise PickError(st["id"] + ": 상태 낱말 " + repr(w) + " 이(가) 설정 status_codes 에 없음")
        op = operator_from(relay, st["id"], src)
        op["loc"] = st["loc"]
        ops.append(op)
    km = round(project_km(line_pts, cum, ra["loc"]), cfg["units"]["report_decimals"])
    return {"id": rest_id, "name": ra["name"], "kind": KIND_REST, "direction": route["direction"],
            "line": None, "km": km, "loc": ra["loc"], "operators": ops}


def pick_around(cfg, relay, status_dir, sid):
    hit = relay.get(sid)
    if hit is None:
        raise PickError("충전소 id " + sid + " 이(가) 사본 stations 에 없음")
    zscode, _, st = hit
    status = tbconfig.read_json(os.path.join(status_dir, zscode + os.extsep + "json"))["s"].get(sid)
    if status is None:
        raise PickError(sid + ": status/" + zscode + " 에 상태가 없음")
    src = []
    for c in st["chargers"]:
        if c["id"] not in status:
            raise PickError(sid + "/" + c["id"] + ": 상태가 없음")
        src.append((c["type"], c["kw"], status_word(cfg, status[c["id"]][0])))
    op = operator_from(relay, sid, src)
    return {"id": sid, "name": st["name"], "kind": KIND_AROUND, "line": None, "km": None, "loc": st["loc"],
            "operators": [op]}


def main(argv):
    args = [a for a in argv[1:] if a != WRITE_FLAG]
    write = WRITE_FLAG in argv[1:]
    if len(args) <= len(FIXED_ARGS):
        print("쓰는 법: py pick_stations.py <설정> <중계 사본 폴더> <장면 이름> <선 이름> <rest:노선:휴게소 | around:충전소>... [--write]")
        return FAIL_CODE
    try:
        cfg = tbconfig.Config(args[0])
    except tbconfig.ConfigError as e:
        print(str(e))
        return FAIL_CODE
    log = tblog.from_config(cfg, cfg.resolve)
    _, relay_dir, scene_name, line_name = args[:len(FIXED_ARGS)]
    specs = args[len(FIXED_ARGS):]
    log.write(WHERE + ".main", "시작", relay=relay_dir, scene=scene_name, line=line_name, specs=" ".join(specs), write=write)
    sc = cfg["scenes"]
    try:
        relay = match_ids.load_relay(relay_dir)
        routes = tbconfig.read_json(os.path.join(relay_dir, ROUTES_FILE))
        line = tbconfig.read_json(os.path.join(cfg.resolve(sc["lines_dir"]), line_name + sc["line_suffix"]))
        pts = line["points"]
        cum = [0.0]
        for p, q in zip(pts, pts[1:]):
            cum.append(cum[-1] + geo.sphere_km(p, q, cfg["geo"]["earth_radius_km"]))
        places = []
        for spec in specs:
            parts = spec.split(SPEC_SEP)
            if parts[0] == KIND_REST and len(parts) == len(("kind", "route", "rest")):
                _, route_key, rest_id = parts
                place = pick_rest(cfg, relay, routes, pts, cum, route_key, rest_id)
                place["line"] = line_name
            elif parts[0] == KIND_AROUND and len(parts) == len(("kind", "station")):
                place = pick_around(cfg, relay, os.path.join(relay_dir, STATUS_DIR), parts[1])
            else:
                raise PickError("자리 꼴이 틀림: " + spec)
            places.append(place)
            print("뽑음: " + place["id"] + " " + place["name"] + " · " + place["kind"] + " · km " + str(place["km"])
                  + " · 충전소 " + ", ".join(op["station_id"] + "(" + str(len(op["chargers"])) + ")" for op in place["operators"]))
        if write:
            path = os.path.join(cfg.resolve(sc["dir"]), scene_name + sc["line_suffix"])
            scene = tbconfig.read_json(path)
            scene["stations"] = places
            with open(path, "w", encoding="utf-8", newline="\n") as f:
                json.dump(scene, f, ensure_ascii=False, indent=cfg["units"]["json_indent"])
                f.write("\n")
            print("씀: " + path)
    except (PickError, OSError, ValueError, KeyError) as e:
        print("못 뽑음: " + str(e))
        log.write(WHERE + ".main", "못 뽑음", error=repr(e))
        return FAIL_CODE
    log.write(WHERE + ".main", "끝", places=len(places), wrote=write)
    return OK_CODE


if __name__ == "__main__":
    sys.exit(main(sys.argv))
