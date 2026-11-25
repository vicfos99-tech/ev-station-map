"""장면의 충전소·충전기 id 를 중계 실제 자료 사본에 맞춘다(파이썬 기본 모듈만).

쓰는 법:  py tools/match_ids.py <설정 파일 경로> <중계 자료 사본 폴더> [--write]
  예)    py tools/match_ids.py config/testbed.json C:/Claude_work/90_임시/중계자료_사본_2026-11-25 --write

- 사본의 stations/<시군구>.json 에서 장면의 충전소 id(station_id)를 찾는다.
- 충전기는 '차례와 (종류, 출력)'이 모두 같을 때만 사본의 id 로 바꾼다(아니면 바꾸지 않고 '못 맞춤'으로 찍음).
- 맞춘 충전소에는 사본의 name·zscode·zcodes·rest·indoor 를 적는다(시험 다리가 중계 꼴로 내줄 때 씀).
- 시간표의 charger_status 사건의 충전기 id 도 같은 표로 바꾼다.
- --write 가 없으면 바꿀 것만 찍고 파일은 그대로 둔다. 시작·끝·못 맞춤은 기록장에.
"""
import glob
import json
import os
import sys

import tbconfig
import tblog

WHERE = "match_ids"
OK_CODE = 0
FAIL_CODE = 1
WRITE_FLAG = "--write"
STATIONS_DIR = "stations"
COPY_FIELDS = ("name", "zscode", "zcodes", "rest", "indoor")


def load_relay(relay_dir):
    """{충전소 id: (시군구 코드, 지역 코드 목록, 충전소)}."""
    found = {}
    for p in sorted(glob.glob(os.path.join(relay_dir, STATIONS_DIR, "*" + os.extsep + "json"))):
        data = tbconfig.read_json(p)
        for st in data["stations"]:
            found[st["id"]] = (data["zscode"], data["zcodes"], st)
    return found


def match_operator(op, relay):
    """(바꿀 충전기 id 표 {옛: 새}, 못 맞춘 까닭 또는 None)."""
    hit = relay.get(op["station_id"])
    if hit is None:
        return {}, "중계 사본에 충전소 id 가 없음"
    zscode, zcodes, st = hit
    mine = [(c["type"], float(c["kw"])) for c in op["chargers"]]
    real = [(c["type"], float(c["kw"])) for c in st["chargers"]]
    if mine != real:
        return {}, "충전기 (종류, 출력) 차례가 다름 — 장면 " + repr(mine) + " / 사본 " + repr(real)
    mapping = {c["id"]: r["id"] for c, r in zip(op["chargers"], st["chargers"])}
    for c in op["chargers"]:
        c["id"] = mapping[c["id"]]
    op["name"] = st["name"]
    op["zscode"] = zscode
    op["zcodes"] = list(zcodes)
    for key in ("rest", "indoor"):
        if key in st:
            op[key] = st[key]
    return mapping, None


def match_scene(scene, relay):
    """장면 하나를 맞춘다. (바뀐 줄 목록, 못 맞춘 줄 목록)."""
    changed, missed = [], []
    maps = {}
    for place in scene["stations"]:
        for op in place["operators"]:
            mapping, why = match_operator(op, relay)
            if why is not None:
                missed.append(op["station_id"] + ": " + why)
                continue
            maps[op["station_id"]] = mapping
            moved = {a: b for a, b in mapping.items() if a != b}
            changed.append(op["station_id"] + " (" + op["zscode"] + ", " + op["name"] + "): "
                           + (", ".join(a + "→" + b for a, b in moved.items()) if moved else "충전기 id 같음"))
    for ev in scene["timeline"]:
        if ev["type"] == "charger_status" and ev["station_id"] in maps:
            old = ev["charger_id"]
            new = maps[ev["station_id"]].get(old)
            if new is None:
                missed.append("시간표 " + ev["station_id"] + "/" + old + ": 충전기 id 가 표에 없음")
            elif new != old:
                ev["charger_id"] = new
                changed.append("시간표 " + ev["station_id"] + "/" + old + "→" + new)
    return changed, missed


def main(argv):
    args = [a for a in argv[1:] if a != WRITE_FLAG]
    write = WRITE_FLAG in argv[1:]
    if len(args) != len(("config", "relay")):
        print("쓰는 법: py match_ids.py <설정 파일 경로> <중계 자료 사본 폴더> [--write]")
        return FAIL_CODE
    try:
        cfg = tbconfig.Config(args[0])
    except tbconfig.ConfigError as e:
        print(str(e))
        return FAIL_CODE
    log = tblog.from_config(cfg, cfg.resolve)
    log.write(WHERE + ".main", "시작", relay=args[1], write=write)
    try:
        relay = load_relay(args[1])
        if not relay:
            print("중계 사본에서 충전소를 하나도 못 읽음: " + args[1])
            log.write(WHERE + ".main", "끝", result="실패", why="사본 비었음")
            return FAIL_CODE
        folder = cfg.resolve(cfg["scenes"]["dir"])
        total_missed = 0
        for p in sorted(glob.glob(os.path.join(folder, cfg["scenes"]["glob"]))):
            scene = tbconfig.read_json(p)
            changed, missed = match_scene(scene, relay)
            total_missed += len(missed)
            print("## " + os.path.basename(p))
            for c in changed:
                print("  맞춤: " + c)
            for m in missed:
                print("  못 맞춤: " + m)
                log.write(WHERE + ".main", "못 맞춤", scene=os.path.basename(p), detail=m)
            if write:
                with open(p, "w", encoding="utf-8", newline="\n") as f:
                    json.dump(scene, f, ensure_ascii=False, indent=cfg["units"]["json_indent"])
                    f.write("\n")
        log.write(WHERE + ".main", "끝", result="통과" if not total_missed else "못 맞춤 있음",
                  missed=total_missed, wrote=write)
    except Exception as e:
        log.write(WHERE + ".main", "예외", error=repr(e))
        raise
    return OK_CODE if not total_missed else FAIL_CODE


if __name__ == "__main__":
    sys.exit(main(sys.argv))
