"""실자료(4-2) 단위 시험 — 실제 도로 모양 선과 실자료 장면(파이썬 기본 모듈만, 바깥에 묻지 않음).

쓰는 법:  py tools/try_realline.py <실자료 설정(config/realline.json)>

보는 것(표로 찍고 하나라도 틀리면 0 아닌 코드, 시작·끝·결과는 기록장에):
 ① 새 선 파일이 선 꼴에 맞고 real 이며, 점이 km 마다 min_points_per_km 넘게, 점 사이가 max_gap_m 안
 ② 같은 원본으로 다시 이으면 선 파일과 점 하나까지 같음(다시 돌릴 수 있음)
 ③ 실자료 장면의 흐름 자리가 틱마다 새 선에서 on_line_m 안(실제 도로 위를 달림)
 ④ 동탄 자리(고칠 것 일곱 ⑥)가 새 선에서 around_m 넘게(= 고속도로 밖), 옛 직선에서는 old_on_m 안(옛 문제 재현)
 ⑤ 실자료 장면 휴게소 km 가 휴게소 좌표를 새 선에 내린 km 와 같고, 옛 장면(base)의 휴게소 km 는 그대로
 ⑥ 실자료 장면이 장면 검사기를 지남
 ⑦~⑪ 설정 scenes.make 의 실자료 장면 모두(S14~ 포함): 검사기 · 흐름이 새 선(또는 좌표 조각) 위 · 흐름 이어짐(순간 이동 없음)
     · 휴게소 km 다시 셈과 휴게소 정차 자리 · 옛 장면과 같아야 할 칸이 같음(real 은 손 조각 있으면 false)
"""
import importlib
import os
import sys

import check_scenes
import geo
import osm_line
import pick_stations
import realcfg
import tbconfig
import tblog

WHERE = "try_realline"
OK_CODE = 0
FAIL_CODE = 1
ARGC = len(("prog", "config"))
SCENE_PLAY = "scene_play"
PASS = "통과"
FAIL = "실패"


def main(argv):
    if len(argv) != ARGC:
        print("쓰는 법: py try_realline.py <config/realline.json>")
        return FAIL_CODE
    try:
        rc = realcfg.RealConfig(argv[1])
    except realcfg.RealError as e:
        print(str(e))
        return FAIL_CODE
    log = tblog.from_config(rc.tb, rc.tb.resolve)
    log.write(WHERE + ".main", "시작", config=rc.path)
    T = rc["try"]
    tb = rc.tb
    radius = tb["geo"]["earth_radius_km"]
    mpk = tb["units"]["m_per_km"]
    dec = tb["units"]["report_decimals"]
    rows = []

    def row(no, title, expect, actual, ok):
        rows.append((no, title, expect, actual, ok))
        log.write(WHERE + ".row", PASS if ok else FAIL, no=no, expect=expect, actual=actual)

    ctx = check_scenes.Ctx(tb)
    line, length, lerr = ctx.line(T["line"])
    pts = line["points"] if line else []
    gaps = [geo.sphere_km(p, q, radius) * mpk for p, q in zip(pts, pts[1:])]
    per_km = len(pts) / length if length else 0
    ok1 = not lerr and line["real"] and per_km > T["min_points_per_km"] and max(gaps) <= T["max_gap_m"]
    row("①", "새 선 꼴·실제·점 촘촘함", "꼴 맞음 · real · km 당 점 > " + str(T["min_points_per_km"]) + " · 점 사이 ≤ " + str(T["max_gap_m"]) + " m",
        ("꼴 틀림 " + "; ".join(lerr)) if lerr else ("real " + str(line["real"]) + " · 점 " + str(len(pts)) + " · " + str(round(length, dec)) + " km · km 당 " + str(round(per_km, dec)) + " · 가장 긴 사이 " + str(round(max(gaps))) + " m"), ok1)

    raw_path = osm_line.latest_raw(rc, T["line"])
    again, info = osm_line.chain(rc, tbconfig.read_json(raw_path), rc["lines"][T["line"]]) if raw_path else (None, "원본 없음")
    row("②", "같은 원본으로 다시 이으면 같은 선", "점 " + str(len(pts)) + " 개 모두 같음",
        ("못 이음: " + str(info)) if again is None else ("점 " + str(len(again)) + " · 같음 " + str(again == pts)), again == pts)

    sys.path.insert(0, os.path.dirname(tb.resolve(tb["bridge"]["script"])))  # 장면 재생은 시험 다리 폴더에 있다(설정 bridge.script 의 폴더)
    scene_play = importlib.import_module(SCENE_PLAY)
    track = scene_play.Scene(tb, T["scene"]).track
    step = T["rail_check_ticks"]
    worst = max(osm_line.off_m(pts, [t["lat"], t["lng"]], mpk, radius) for t in track[::step])
    row("③", "실자료 장면 흐름이 새 선 위", "틱 " + str(len(track)) + " 개 모두 새 선에서 ≤ " + str(T["on_line_m"]) + " m",
        "가장 먼 틱 " + str(round(worst, dec)) + " m", worst <= T["on_line_m"])

    old_pts = tbconfig.read_json(rc.line_path(T["old_line"]))["points"]
    d_new = osm_line.off_m(pts, T["dongtan"], mpk, radius)
    d_old = osm_line.off_m(old_pts, T["dongtan"], mpk, radius)
    row("④", "동탄 자리 " + str(T["dongtan"]) + " — 새 선에서는 고속도로 밖, 옛 직선에서는 선 위",
        "새 선 > " + str(T["around_m"]) + " m · 옛 직선 ≤ " + str(T["old_on_m"]) + " m",
        "새 선 " + str(round(d_new)) + " m · 옛 직선 " + str(round(d_old, dec)) + " m", d_new > T["around_m"] and d_old <= T["old_on_m"])

    spec = next(s for s in rc["scenes"]["make"] if s["name"] == T["scene"])
    scene = tbconfig.read_json(rc.scene_path(T["scene"]))
    base = tbconfig.read_json(rc.scene_path(spec["base"]))
    ncum = osm_line.cum_km(pts, radius)
    kd = rc["scenes"]["km_decimals"]
    bad5 = [st["name"] for st in scene["stations"] if st["line"] == T["line"]
            and st["km"] != round(pick_stations.project_km(pts, ncum, st["loc"]), kd)]
    base_lines = sorted({st["line"] for st in base["stations"]})
    ok5 = not bad5 and base_lines == [T["old_line"]] and len(scene["stations"]) == len(base["stations"])
    row("⑤", "휴게소 km 를 새 선에 다시 셈(옛 장면은 그대로)", "모든 휴게소 km = 좌표를 새 선에 내린 km · 옛 장면 선 = " + T["old_line"],
        "어긋난 곳 " + str(bad5 or "없음") + " · 옛 장면 선 " + str(base_lines), ok5)

    errs, summary = check_scenes.check_scene(rc.scene_path(T["scene"]), ctx, [T["scene"], spec["base"]])
    row("⑥", "실자료 장면이 장면 검사기를 지남", "틀림 0", ("틀림 " + "; ".join(errs)) if errs else ("틀림 0 · " + str(round(summary["km"], dec)) + " km · " + str(summary["ticks"]) + "틱"), not errs)

    more_rows(rc, row, ctx, pts, ncum, scene_play)

    print("| # | 시험 | 기대 | 실제 | 결과 |")
    print("|---|---|---|---|---|")
    for no, title, expect, actual, ok in rows:
        print("| " + " | ".join(str(v).replace("|", "/") for v in (no, title, expect, actual, PASS if ok else FAIL)) + " |")
    good = all(r[-1] for r in rows)
    print("")
    print("실자료 단위 시험: " + (PASS if good else FAIL) + " (" + str(sum(1 for r in rows if r[-1])) + " / " + str(len(rows)) + ")")
    log.write(WHERE + ".main", "끝", result=PASS if good else FAIL)
    return OK_CODE if good else FAIL_CODE


def more_rows(rc, row, ctx, pts, ncum, scene_play):
    """⑦~⑪ — 설정 scenes.make 의 실자료 장면 모두(S13 뒤에 더한 S14~ 포함)."""
    T = rc["try"]
    tb = rc.tb
    radius = tb["geo"]["earth_radius_km"]
    mpk = tb["units"]["m_per_km"]
    dec = tb["units"]["report_decimals"]
    kd = rc["scenes"]["km_decimals"]
    per_hour = tb["units"]["seconds_per_hour"]
    specs = rc["scenes"]["make"]
    pairs = [(s, tbconfig.read_json(rc.scene_path(s["name"])), tbconfig.read_json(rc.scene_path(s["base"]))) for s in specs]

    bad7 = []
    for s, scene, base in pairs:
        errs, _ = check_scenes.check_scene(rc.scene_path(s["name"]), ctx, [s["name"], s["base"]])
        base_lines = {l["line"] for l in base["route"]["legs"] if l["kind"] == "line"}
        if errs or base_lines != {s["from_line"]}:
            bad7.append(s["name"] + ": " + ("; ".join(errs) if errs else "옛 장면 선 " + str(sorted(base_lines))))
    row("⑦", "실자료 장면 " + str(len(pairs)) + "개 모두 장면 검사기를 지나고 옛 장면은 옛 선 그대로", "틀림 0",
        "틀림 " + str(bad7 or 0), not bad7)

    worst8, worst9, bad9 = [], [], []
    for s, scene, base in pairs:
        track = scene_play.build_track(tb, scene)  # 위치 튐을 넣기 전 자리
        polys = [pts] + [l["points"] for l in scene["route"]["legs"] if l["kind"] != "line"]
        far = max(min(osm_line.off_m(p, [t["lat"], t["lng"]], mpk, radius) for p in polys) for t in track)
        worst8.append((s["name"], round(far, dec)))
        limit = max(sp["kmh"] for sp in scene["speeds"]) * tb["tick_interval_s"] / per_hour * mpk + T["step_slack_m"]
        step = max(geo.sphere_km([a["lat"], a["lng"]], [b["lat"], b["lng"]], radius) * mpk for a, b in zip(track, track[1:]))
        worst9.append((s["name"], round(step), round(limit)))
        if step > limit:
            bad9.append(s["name"])
    row("⑧", "흐름 자리가 틱마다 새 선(좌표 조각이면 그 조각) 위", "모든 장면 ≤ " + str(T["on_line_m"]) + " m",
        "가장 먼 틱 " + str(worst8), all(w <= T["on_line_m"] for _, w in worst8))
    row("⑨", "흐름이 끊기지 않음(조각 사이 순간 이동 없음)", "이웃 틱 사이 ≤ 가장 빠른 시속 × 틱 + " + str(T["step_slack_m"]) + " m",
        "(장면, 가장 긴 걸음 m, 한도 m) " + str(worst9), not bad9)

    bad10 = []
    for s, scene, base in pairs:
        for st in scene["stations"]:
            if st["line"] == s["to_line"] and st["km"] != round(pick_stations.project_km(pts, ncum, st["loc"]), kd):
                bad10.append(s["name"] + " " + st["name"])
        if s.get("pin_stations"):
            kms = {st["km"] for st in scene["stations"] if st["line"] == s["to_line"]}
            bad10.extend(s["name"] + " 멈춤 km " + str(p["at_km"]) for p in scene.get("stops", []) if p["at_km"] not in kms)
    row("⑩", "휴게소 km 를 새 선에 다시 셈 · 휴게소 정차(pin_stations)는 휴게소 새 km 에서", "어긋난 곳 없음",
        "어긋난 곳 " + str(bad10 or "없음"), not bad10)

    bad11 = []
    for s, scene, base in pairs:
        hand = [l for l in scene["route"]["legs"] if l.get("handmade")]
        if scene["data_source"]["real"] == bool(hand):
            bad11.append(s["name"] + " real " + str(scene["data_source"]["real"]))
        for k in T["same_keys"]:
            if scene.get(k) != base.get(k):
                bad11.append(s["name"] + " " + k)
        pick = lambda d: ([x["kmh"] for x in d["speeds"]], [x["limit_kmh"] for x in d["limits"]],
                          [x["duration_s"] for x in d.get("stops", [])], [x["id"] for x in d["stations"]])
        if pick(scene) != pick(base):
            bad11.append(s["name"] + " 시속·제한·멈춤·충전소 차례")
        for nl, ol in zip(scene["route"]["legs"], base["route"]["legs"]):
            if ol["kind"] != "line" and nl["points"][-len(ol["points"]):] != ol["points"]:
                bad11.append(s["name"] + " 좌표 조각 원래 점이 바뀜")
    row("⑪", "옛 장면과 같아야 할 것(사건·답·시속·제한 값·충전소, 좌표 조각 원래 점) · 손 조각 있으면 real false",
        "다른 곳 없음", "다른 곳 " + str(bad11 or "없음"), not bad11)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
