"""옛 장면을 실제 도로 모양 선 위로 옮긴 새 장면 파일을 만든다(옛 장면은 읽기만, 파이썬 기본 모듈만).

쓰는 법:  py tools/real_scene.py <실자료 설정> [만들 장면 이름 …] [--write]
  예)    py tools/real_scene.py config/realline.json S13_고속도로_실선 --write
  이름이 없으면 설정 scenes.make 의 것 모두.

- 선 조각(kind line, line = from_line): from_km·to_km 와 그 조각의 속도·제한·멈춤 km 를 '옛 선의 그 km 자리를 새 선(to_line)에 내린 km' 로.
  같은 옛 km 는 같은 새 km 로 옮겨(한 번 셈해 둠) 구간 사이 빈틈·겹침이 생기지 않는다. 옮긴 뒤 차례가 뒤집히면 못 만듦.
- 충전소: line 이 from_line 인 자리는 line 을 to_line 으로, km 는 그 자리 좌표(loc)를 새 선에 내린 km.
- 거꾸로 달리는 선 조각(from_km > to_km — 상행 S3·후진 S6)도 같은 선 위에서 그대로 거꾸로(옮긴 뒤 방향이 같아야 함).
- spec pin_stations: 휴게소 옛 km 둘레(설정 pin_window_km) km 는 휴게소 새 km 에 붙인다(S6 휴게소 정차·후진 — 옛 거리 그대로).
- spec join_points: 옮긴 선 조각 뒤의 좌표 조각(S4 일반 도로)이 새 선 끝과 떨어지면 새 선 끝 점 하나를 앞에 더해 잇는다(원래 점은 그대로).
  손으로 찍은 조각이 남으면 data_source.real 은 false.
- 좌표 조각(kind points)의 원래 점·시간표·답(responses)·멈춤 시간·이어 달리기 칸은 그대로. name·title·description·data_source 는 설정대로 바꾼다.
- 만든 뒤 장면 검사기(check_scenes)로 그 장면을 보고, 틀리면 쓰지 않고 0 아닌 코드.
"""
import copy
import glob
import json
import os
import sys

import check_scenes
import geo
import osm_line
import pick_stations
import realcfg
import tbconfig
import tblog

WHERE = "real_scene"
OK_CODE = 0
FAIL_CODE = 1
WRITE_FLAG = "--write"
KIND_LINE = "line"
RANGE_PARTS = ("speeds", "limits")
STOP_PART = "stops"


class MakeError(Exception):
    pass


class KmMap:
    """옛 선 km → 새 선 km (옛 자리를 새 선에 내림). 한 번 셈한 값은 다시 쓴다.

    pins [(옛 km, 새 km)] · window: 옛 km 가 핀에서 window 안이면 '핀의 새 km + 옛 km 와의 차이'(휴게소 정차처럼
    휴게소 자리에 붙여야 하는 km — 그 둘레는 옛 거리 그대로). 핀 둘이 window 안에 같이 들면 가까운 핀.
    """

    def __init__(self, rc, old_name, new_name, decimals, pins=(), window=0.0):
        self.radius = rc.tb["geo"]["earth_radius_km"]
        self.old = tbconfig.read_json(rc.line_path(old_name))["points"]
        self.new = tbconfig.read_json(rc.line_path(new_name))["points"]
        self.ocum = osm_line.cum_km(self.old, self.radius)
        self.ncum = osm_line.cum_km(self.new, self.radius)
        self.dec = decimals
        self.pins = list(pins)
        self.window = window
        self.memo = {}

    def __call__(self, km):
        if km not in self.memo:
            near = sorted((abs(km - o), o, n) for o, n in self.pins if abs(km - o) <= self.window)
            if near:
                _, o, n = near[0]
                self.memo[km] = round(n + (km - o), self.dec)
            else:
                p = osm_line.point_at_km(self.old, self.ocum, km)
                self.memo[km] = round(pick_stations.project_km(self.new, self.ncum, p), self.dec)
        return self.memo[km]

    def new_point(self, km):
        return osm_line.point_at_km(self.new, self.ncum, km)

    def of_loc(self, loc):
        return round(pick_stations.project_km(self.new, self.ncum, loc), self.dec)


def make(rc, spec):
    sc = rc["scenes"]
    base = tbconfig.read_json(rc.scene_path(spec["base"]))
    if base.get("compose") is not None:
        raise MakeError(spec["base"] + ": 이어 달리기 장면은 옮기지 않음")
    out = copy.deepcopy(base)
    kmap = KmMap(rc, spec["from_line"], spec["to_line"], sc["km_decimals"])
    if spec.get("pin_stations"):
        kmap.pins = [(st["km"], kmap.of_loc(st["loc"])) for st in base["stations"] if st["line"] == spec["from_line"]]
        kmap.window = sc["pin_window_km"]
    moved = set()
    for i, leg in enumerate(out["route"]["legs"]):
        if leg["kind"] != KIND_LINE or leg["line"] != spec["from_line"]:
            continue
        moved.add(i)
        a, b = kmap(leg["from_km"]), kmap(leg["to_km"])
        if (a < b) != (leg["from_km"] < leg["to_km"]):
            raise MakeError("조각 " + str(i) + ": 옮긴 뒤 방향이 뒤집힘 (" + str(a) + " → " + str(b) + ")")
        leg["line"] = spec["to_line"]
        if "note" in leg:
            leg["note"] = leg["note"] + sc["leg_note_add"]
        leg["from_km"], leg["to_km"] = a, b
    for part in RANGE_PARTS:
        for item in out.get(part, []):
            if item["leg"] in moved:
                lo, hi = kmap(item["from_km"]), kmap(item["to_km"])
                if lo >= hi:
                    raise MakeError(part + " 조각 " + str(item["leg"]) + ": 옮긴 뒤 구간이 비거나 뒤집힘 (" + str(lo) + "~" + str(hi) + ")")
                item["from_km"], item["to_km"] = lo, hi
    for item in out.get(STOP_PART, []):
        if item["leg"] in moved:
            item["at_km"] = kmap(item["at_km"])
    joins = join_points_legs(rc, spec, out, kmap, moved)
    changes = []
    for st in out["stations"]:
        if st["line"] == spec["from_line"]:
            new_km = kmap.of_loc(st["loc"])
            changes.append((st["name"], st.get("direction"), st["km"], new_km))
            st["line"] = spec["to_line"]
            st["km"] = new_km
    out["name"] = spec["name"]
    out["title"] = spec["title"]
    out["description"] = base["description"] + spec["description_add"]
    ds = out["data_source"]
    handmade = any(leg.get("handmade") for leg in out["route"]["legs"])
    ds["real"] = not handmade  # 손으로 찍은 조각이 남으면 실제 자료가 아니다(README 규칙 — 검사기도 봄)
    ds["from"] = sc["data_source_from"] + ds["from"]
    ds["note"] = ds["note"] + sc["data_source_note_add"] + (sc["data_source_note_handmade"] if handmade else "")
    return out, changes + joins


def join_points_legs(rc, spec, out, kmap, moved):
    """옮긴 선 조각 바로 뒤의 좌표 조각이 새 선 끝과 떨어졌으면(설정 join_gap_m 넘게) 이어 준다.

    좌표 조각의 처음 점은 옛 선 위 점이라 새 선에서 떨어져 흐름이 순간 이동한다. spec join_points 가 참이면
    새 선 끝 점을 그 조각 맨 앞에 한 점 더하고(원래 점들은 그대로), 그 조각의 속도·제한·멈춤 km 를 늘어난 길이만큼 민다
    (0 은 0 그대로 — 앞 구간이 이음 길까지 덮음, 조각 끝은 새 길이). 참이 아니면 못 만듦.
    """
    sc = rc["scenes"]
    radius = kmap.radius
    mpk = rc.tb["units"]["m_per_km"]
    dec = rc["lines"][spec["to_line"]]["coord_decimals"]
    legs = out["route"]["legs"]
    rows = []
    for i in range(1, len(legs)):
        leg, prev = legs[i], legs[i - 1]
        if leg["kind"] == KIND_LINE or (i - 1) not in moved:
            continue
        end = [round(v, dec) for v in kmap.new_point(prev["to_km"])]
        gap_km = geo.sphere_km(end, leg["points"][0], radius)
        if gap_km * mpk <= sc["join_gap_m"]:
            continue
        if not spec.get("join_points"):
            raise MakeError("조각 " + str(i) + ": 새 선 끝과 좌표 조각 처음이 " + str(round(gap_km * mpk)) + " m 떨어짐(설정 join_points 없음)")
        old_len = geo.line_length_km(leg["points"], radius)
        leg["points"] = [end] + leg["points"]
        new_len = geo.line_length_km(leg["points"], radius)

        def shift(v, old_len=old_len, new_len=new_len):
            if v == 0:
                return v
            if abs(v - old_len) <= sc["join_len_eps_km"]:
                return new_len
            return round(v + (new_len - old_len), sc["km_decimals"])

        for part in RANGE_PARTS:
            for item in out.get(part, []):
                if item["leg"] == i:
                    item["from_km"], item["to_km"] = shift(item["from_km"]), shift(item["to_km"])
        for item in out.get(STOP_PART, []):
            if item["leg"] == i:
                item["at_km"] = shift(item["at_km"])
        leg["note"] = leg.get("note", "") + sc["join_note_add"].format(m=round(gap_km * mpk))
        rows.append(("이음 길(조각 " + str(i) + ")", None, 0, round(new_len - old_len, sc["km_decimals"])))
    return rows


def scene_names(rc):
    sc = rc.tb["scenes"]
    return [os.path.splitext(os.path.basename(p))[0] for p in glob.glob(os.path.join(rc.tb.resolve(sc["dir"]), sc["glob"]))]


def main(argv):
    write = WRITE_FLAG in argv
    args = [a for a in argv[1:] if a != WRITE_FLAG]
    if not args:
        print("쓰는 법: py real_scene.py <config/realline.json> [장면 이름 …] [--write]")
        return FAIL_CODE
    try:
        rc = realcfg.RealConfig(args[0])
    except realcfg.RealError as e:
        print(str(e))
        return FAIL_CODE
    log = tblog.from_config(rc.tb, rc.tb.resolve)
    want = args[1:]
    specs = [s for s in rc["scenes"]["make"] if not want or s["name"] in want]
    log.write(WHERE + ".main", "시작", scenes=" ".join(s["name"] for s in specs), write=write)
    if not specs or (want and len(specs) != len(want)):
        print("설정 scenes.make 에 없는 이름이 있음: " + " ".join(want))
        log.write(WHERE + ".main", "끝", result="없는 이름")
        return FAIL_CODE
    bad = False
    for spec in specs:
        try:
            scene, changes = make(rc, spec)
        except (MakeError, OSError, ValueError, KeyError) as e:
            print("못 만듦 " + spec["name"] + ": " + str(e))
            log.write(WHERE + ".main", "못 만듦", scene=spec["name"], error=repr(e))
            bad = True
            continue
        legs = [(l["from_km"], l["to_km"]) for l in scene["route"]["legs"] if l["kind"] == KIND_LINE]
        print(spec["name"] + " ← " + spec["base"] + " · 선 조각 " + str(legs))
        print("| 휴게소 | 방향 | 옛 km | 새 km |")
        print("|---|---|---|---|")
        for n, d, o, k in changes:
            print("| " + " | ".join(str(v) for v in (n, d, o, k)) + " |")
        if write:
            path = rc.scene_path(spec["name"])
            if os.path.exists(path):
                old = tbconfig.read_json(path)
                if old.get("name") != spec["name"]:
                    print("못 씀: 같은 이름의 다른 파일이 있음 — " + path)
                    bad = True
                    continue
            before = None
            if os.path.exists(path):
                with open(path, encoding="utf-8") as f:
                    before = f.read()
            with open(path, "w", encoding="utf-8", newline="\n") as f:
                json.dump(scene, f, ensure_ascii=False, indent=rc.tb["units"]["json_indent"])
                f.write("\n")
            errors, summary = check_scenes.check_scene(path, check_scenes.Ctx(rc.tb), scene_names(rc))
            if errors:
                if before is None:
                    os.remove(path)
                else:
                    with open(path, "w", encoding="utf-8", newline="\n") as f:
                        f.write(before)
                print("못 씀(장면 검사 틀림 — 되돌림): " + "; ".join(errors))
                log.write(WHERE + ".main", "못 씀", scene=spec["name"], errors="; ".join(errors))
                bad = True
                continue
            print("씀: " + path + " · 검사 맞음 · " + str(round(summary["km"], rc.tb["units"]["report_decimals"]))
                  + " km · " + str(summary["ticks"]) + "틱")
            log.write(WHERE + ".main", "씀", scene=spec["name"], path=path, ticks=summary["ticks"])
    log.write(WHERE + ".main", "끝", result="실패 있음" if bad else "다 만듦")
    return FAIL_CODE if bad else OK_CODE


if __name__ == "__main__":
    sys.exit(main(sys.argv))
