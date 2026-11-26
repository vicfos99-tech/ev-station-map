"""받은 오픈스트리트맵 원본 → 시험 선 파일(scenes/lines/<선 이름>.json), 그리고 옛 직선과 견주기(파이썬 기본 모듈만).

쓰는 법:  py tools/osm_line.py <실자료 설정> <선 이름> [원본 파일 — 없으면 raw_dir 에서 그 선의 가장 새 것] [--write]
  예)    py tools/osm_line.py config/realline.json gyeongbu_down_osm --write

- 잇기: 받은 길(way)을 점(node) 사이 한쪽 길(oneway)로 이은 그림을 만들고, 옛 선의 base_from_km 자리에서 snap_m 안의 점 가운데
  base_to_km 자리까지 갈 수 있는 가장 가까운 점에서 출발해, 끝 자리 snap_m 안의 점 가운데 끝 자리에 가장 가까운 점까지 가장 짧은 길.
  한쪽 길이라 반대 방향 차로(상행)는 저절로 빠진다. 못 이으면(길이 끊김) 0 아닌 코드와 끊긴 곳.
- --write 면 선 파일을 쓴다(옛 선 파일은 건드리지 않음 — 이름이 다르다). 없으면 셈만.
- 견주기: 중계 사본 휴게소를 옛 선·새 선에 내린 km 와 그 차이, 장면 km 범위에서 새 선이 옛 선에서 가장 멀리 떨어진 곳(m).
  표를 찍고 설정 compare.report_file 로 기록장 폴더에 남긴다. 시작·끝·못 이음은 기록장에.
"""
import glob
import heapq
import json
import math
import os
import sys

import geo
import pick_stations
import realcfg
import tbconfig
import tblog

WHERE = "osm_line"
OK_CODE = 0
FAIL_CODE = 1
WRITE_FLAG = "--write"
MIN_ARGS = len(("prog", "config", "line"))
MAX_ARGS = MIN_ARGS + 1
WAY = "way"
NODE = "node"
ONEWAY_KEY = "oneway"
TAGS_KEY = "tags"
GLOB_ANY = "*"
STAMP_SEP = "_"


def cum_km(points, radius):
    cum = [0.0]
    for p, q in zip(points, points[1:]):
        cum.append(cum[-1] + geo.sphere_km(p, q, radius))
    return cum


def point_at_km(points, cum, km):
    for i in range(len(points) - 1):
        if cum[i + 1] >= km:
            span = cum[i + 1] - cum[i]
            f = (km - cum[i]) / span if span > 0 else 0.0
            a, b = points[i], points[i + 1]
            return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]
    return list(points[-1])


def off_m(points, loc, m_per_km, radius):
    """loc 에서 선(points)까지 가장 짧은 거리(m) — 조각마다 평면 근사(경도에 cos 위도)."""
    best = None
    k_m = math.radians(radius * m_per_km)  # 위도 1도의 m
    for a, b in zip(points, points[1:]):
        k = math.cos(math.radians(a[0]))
        ax, ay = a[1] * k, a[0]
        bx, by = b[1] * k, b[0]
        px, py = loc[1] * k, loc[0]
        dx, dy = bx - ax, by - ay
        span = dx * dx + dy * dy
        f = ((px - ax) * dx + (py - ay) * dy) / span if span > 0 else 0.0
        f = max(0.0, min(1.0, f))
        gap = math.hypot(px - (ax + dx * f), py - (ay + dy * f)) * k_m
        if best is None or gap < best:
            best = gap
    return best


def latest_raw(rc, name):
    found = sorted(glob.glob(os.path.join(rc.work_path(rc["raw_dir"]), name + STAMP_SEP + GLOB_ANY + rc["raw_suffix"])))
    return found[-1] if found else None


def build_graph(raw, spec):
    nodes = {}
    edges = {}
    for e in raw["elements"]:
        if e["type"] == NODE:
            nodes[e["id"]] = (e["lat"], e["lon"])
    for e in raw["elements"]:
        if e["type"] != WAY:
            continue
        ow = e.get(TAGS_KEY, {}).get(ONEWAY_KEY)
        ids = e["nodes"]
        pairs = []
        if ow in spec["oneway_backward"]:
            pairs = list(zip(ids[1:], ids))
        else:
            pairs = list(zip(ids, ids[1:]))
            if ow not in spec["oneway_forward"]:
                pairs += list(zip(ids[1:], ids))
        for a, b in pairs:
            if a in nodes and b in nodes:
                edges.setdefault(a, []).append(b)
    return nodes, edges


def dijkstra(nodes, edges, start, radius):
    dist = {start: 0.0}
    prev = {}
    heap = [(0.0, start)]
    while heap:
        d, n = heapq.heappop(heap)
        if d > dist[n]:
            continue
        for m in edges.get(n, ()):
            nd = d + geo.sphere_km(nodes[n], nodes[m], radius)
            if nd < dist.get(m, math.inf):
                dist[m] = nd
                prev[m] = n
                heapq.heappush(heap, (nd, m))
    return dist, prev


def chain(rc, raw, spec):
    """(점 목록, 정보) — 못 이으면 (None, 까닭)."""
    tbg = rc.tb["geo"]
    radius = tbg["earth_radius_km"]
    snap_km = spec["snap_m"] / rc.tb["units"]["m_per_km"]
    base = tbconfig.read_json(rc.line_path(spec["base_line"]))
    bpts = base["points"]
    bcum = cum_km(bpts, radius)
    s_at = point_at_km(bpts, bcum, spec["base_from_km"])
    e_at = point_at_km(bpts, bcum, spec["base_to_km"])
    nodes, edges = build_graph(raw, spec)
    near = lambda at: sorted((geo.sphere_km(at, ll, radius), nid) for nid, ll in nodes.items() if geo.sphere_km(at, ll, radius) <= snap_km)
    starts = near(s_at)
    ends = near(e_at)
    if not starts or not ends:
        return None, "처음·끝 자리 " + str(spec["snap_m"]) + " m 안에 받은 점이 없음 (처음 " + str(len(starts)) + " · 끝 " + str(len(ends)) + ")"
    end_ids = {nid for _, nid in ends}
    tried = 0
    for _, sid in starts:
        tried += 1
        dist, prev = dijkstra(nodes, edges, sid, radius)
        reached = [(d, nid) for d, nid in ends if nid in dist]
        if not reached:
            continue
        _, eid = reached[0]
        path = [eid]
        while path[-1] != sid:
            path.append(prev[path[-1]])
        path.reverse()
        dec = spec["coord_decimals"]
        pts = [[round(nodes[n][0], dec), round(nodes[n][1], dec)] for n in path]
        dedup = [pts[0]] + [p for p, q in zip(pts[1:], pts) if p != q]
        info = {"start_node": sid, "end_node": eid, "start_off_m": round(starts[tried - 1][0] * rc.tb["units"]["m_per_km"]),
                "end_off_m": round(ends[[n for _, n in ends].index(eid)][0] * rc.tb["units"]["m_per_km"]),
                "tried_starts": tried, "graph_nodes": len(nodes), "graph_from": len(edges), "end_ids": len(end_ids)}
        return dedup, info
    return None, "처음 자리 가까운 점 " + str(len(starts)) + " 곳 모두에서 끝 자리로 갈 길이 없음(받은 길이 끊김 — 질의 필터나 범위를 넓혀야)"


def compare(rc, name, spec, new_pts):
    c = rc["compare"]
    tb = rc.tb
    radius = tb["geo"]["earth_radius_km"]
    mpk = tb["units"]["m_per_km"]
    dec = tb["units"]["report_decimals"]
    old = tbconfig.read_json(rc.line_path(spec["base_line"]))["points"]
    ocum = cum_km(old, radius)
    ncum = cum_km(new_pts, radius)
    routes = tbconfig.read_json(os.path.join(rc.work_path(c["relay_copy"]), c["routes_file"]))
    rows = []
    for r in routes["routes"]:
        if r["key"] not in c["route_keys"].get(name, []):
            continue
        for ra in r["rest_areas"]:
            ok = pick_stations.project_km(old, ocum, ra["loc"])
            if not (c["scene_from_km"] <= ok <= c["scene_to_km"]):
                continue
            nk = pick_stations.project_km(new_pts, ncum, ra["loc"])
            rows.append({"id": ra["id"], "name": ra["name"], "dir": r["direction"], "relay_km": ra.get("km"),
                         "old_km": round(ok, dec), "new_km": round(nk, dec), "diff_km": round(nk - ok, dec),
                         "old_off_m": round(off_m(old, ra["loc"], mpk, radius)), "new_off_m": round(off_m(new_pts, ra["loc"], mpk, radius))})
    rows.sort(key=lambda x: x["old_km"])
    # 장면 범위(옛 km)를 새 km 로: 범위 양 끝 옛 자리를 새 선에 내림
    lo = pick_stations.project_km(new_pts, ncum, point_at_km(old, ocum, c["scene_from_km"]))
    hi = pick_stations.project_km(new_pts, ncum, point_at_km(old, ocum, c["scene_to_km"]))
    far = None
    over = 0
    samples = 0
    km = lo
    while km <= hi:
        p = point_at_km(new_pts, ncum, km)
        d = off_m(old, p, mpk, radius)
        samples += 1
        if d > c["far_m"]:
            over += 1
        if far is None or d > far["m"]:
            far = {"m": d, "km": km, "at": p}
        km += c["sample_km"]
    seg = [geo.sphere_km(p, q, radius) * mpk for p, q in zip(new_pts, new_pts[1:])]
    summary = {"new_len_km": round(ncum[-1], dec), "old_len_km": round(ocum[-1], dec), "points": len(new_pts),
               "scene_new_km": [round(lo, dec), round(hi, dec)], "far_m": round(far["m"]), "far_new_km": round(far["km"], dec),
               "far_at": [round(v, tb["units"]["coord_decimals"]) for v in far["at"]], "samples": samples, "over_far_m": over,
               "max_gap_m": round(max(seg)), "far_limit_m": c["far_m"]}
    return rows, summary


def report_text(name, rows, s, info, raw_path, c):
    out = ["# 옛 직선 vs 새 선(" + name + ")", "",
           "- 원본: " + raw_path,
           "- 새 선: 점 " + str(s["points"]) + " · 길이 " + str(s["new_len_km"]) + " km (옛 직선 전체 " + str(s["old_len_km"]) + " km) · 점 사이 가장 긴 곳 " + str(s["max_gap_m"]) + " m",
           "- 잇기: 처음 점이 옛 처음 자리에서 " + str(info["start_off_m"]) + " m · 끝 점이 옛 끝 자리에서 " + str(info["end_off_m"]) + " m (받은 점 " + str(info["graph_nodes"]) + ")",
           "- 장면 범위(옛 km " + str(c["scene_from_km"]) + "~" + str(c["scene_to_km"]) + ")의 새 km: " + str(s["scene_new_km"][0]) + " ~ " + str(s["scene_new_km"][1]),
           "- 가장 먼 어긋남: " + str(s["far_m"]) + " m (새 선 km " + str(s["far_new_km"]) + ", 위도·경도 " + str(s["far_at"]) + ") · " + str(c["sample_km"]) + " km 마다 " + str(s["samples"]) + " 곳 가운데 " + str(s["far_limit_m"]) + " m 넘게 어긋난 곳 " + str(s["over_far_m"]),
           "", "| 휴게소 | 방향 | 중계 km | 옛 직선 km | 새 선 km | 차이 km | 옛 선에서 m | 새 선에서 m |", "|---|---|---|---|---|---|---|---|"]
    for r in rows:
        out.append("| " + " | ".join(str(v) for v in (r["name"], r["dir"], r["relay_km"], r["old_km"], r["new_km"], r["diff_km"], r["old_off_m"], r["new_off_m"])) + " |")
    return "\n".join(out) + "\n"


def main(argv):
    args = [a for a in argv if a != WRITE_FLAG]
    write = WRITE_FLAG in argv
    if not (MIN_ARGS <= len(args) <= MAX_ARGS):
        print("쓰는 법: py osm_line.py <config/realline.json> <선 이름> [원본 파일] [--write]")
        return FAIL_CODE
    try:
        rc = realcfg.RealConfig(args[1])
    except realcfg.RealError as e:
        print(str(e))
        return FAIL_CODE
    log = tblog.from_config(rc.tb, rc.tb.resolve)
    name = args[MIN_ARGS - 1]
    log.write(WHERE + ".main", "시작", line=name, write=write)
    if name not in rc["lines"]:
        print("설정 lines 에 없는 선: " + name)
        log.write(WHERE + ".main", "끝", result="없는 선")
        return FAIL_CODE
    spec = rc["lines"][name]
    raw_path = args[MAX_ARGS - 1] if len(args) == MAX_ARGS else latest_raw(rc, name)
    if raw_path is None:
        print("원본이 없음 — 먼저 py tools/osm_fetch.py " + args[1] + " " + name)
        log.write(WHERE + ".main", "끝", result="원본 없음")
        return FAIL_CODE
    try:
        raw = tbconfig.read_json(raw_path)
        meta = tbconfig.read_json(raw_path[:-len(rc["raw_suffix"])] + rc["meta_suffix"])
    except (OSError, ValueError) as e:
        print("원본을 읽지 못함: " + str(e))
        log.write(WHERE + ".main", "끝", result="원본 못 읽음", error=repr(e))
        return FAIL_CODE
    pts, info = chain(rc, raw, spec)
    if pts is None:
        print("못 이음: " + info)
        log.write(WHERE + ".main", "끝", result="못 이음", why=info)
        return FAIL_CODE
    rows, summary = compare(rc, name, spec, pts)
    text = report_text(name, rows, summary, info, raw_path, rc["compare"])
    print(text)
    lic = meta["license"]
    line = {
        "name": name, "highway": spec["highway"], "direction": spec["direction"], "real": True,
        "from": lic["source"] + " — " + lic["attribution"] + ", " + lic["license"] + " (" + lic["license_url"] + "). 원본: " + os.path.basename(raw_path) + " (작업 폴더의 " + rc["raw_place_text"] + "). 만든 도구: " + rc["tools_text"],
        "taken_at": meta["taken_at_kst"] + " (받은 때, 한국 시각) · 자료 시각 " + str(meta["osm_base"]) + " (UTC)",
        "note": "실제 도로 모양 선(오픈스트리트맵 고속도로 " + spec["direction"] + " 차로 — 한쪽 길만 이어서 상행 차로는 없다). 옛 직선(" + spec["base_line"] + ") km " + str(spec["base_from_km"]) + "~" + str(spec["base_to_km"]) + " 를 덮는 만큼. km 는 이 선 첫 점에서 잰 거리라 옛 직선 km·도로공사 이정과 다르다(차이는 tools/osm_line.py 견주기 표). 점 사이는 오픈스트리트맵 점 그대로(곧은 구간은 점이 드묾 — 점 사이 가장 긴 곳 " + str(summary["max_gap_m"]) + " m)",
        "points": pts,
    }
    dir_ = os.path.join(rc.tb.resolve(rc.tb["log"]["dir"]))
    os.makedirs(dir_, exist_ok=True)
    with open(os.path.join(dir_, rc["compare"]["report_file"]), "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    if write:
        path = rc.line_path(name)
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            json.dump(line, f, ensure_ascii=False)
            f.write("\n")
        print("씀: " + path)
    log.write(WHERE + ".main", "끝", result="이음", points=len(pts), far_m=summary["far_m"], wrote=write)
    return OK_CODE


if __name__ == "__main__":
    sys.exit(main(sys.argv))
