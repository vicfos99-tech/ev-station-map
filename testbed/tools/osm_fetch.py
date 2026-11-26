"""오픈스트리트맵에서 고속도로 차로 선을 받는다(Overpass 공개 질의 — 가입·키 없음, 파이썬 기본 모듈만).

쓰는 법:  py tools/osm_fetch.py <실자료 설정(config/realline.json)> <선 이름>
  예)    py tools/osm_fetch.py config/realline.json gyeongbu_down_osm

- 받는 범위: 옛 선(base_line)의 base_from_km~base_to_km 꼭짓점을 감싼 네모 + bbox_margin_deg.
- 질의: 그 네모 안에서 way_filters 에 맞는 길(way)과 그 길의 점(node) 전부.
- 원본은 설정 raw_dir 에 <선 이름>_<받은 때> 로 세 파일: 받은 그대로(raw_suffix), 질의문(query_suffix),
  받은 때·서버·질의·자료 시각(osm_base)·저작권·이용 조건(meta_suffix).
- 서버를 앞에서부터 하나씩 시도하고 모두 실패하면 0 아닌 코드. 시도마다 시작·끝·결과(오류 문구 그대로)를 기록장에.
"""
import datetime
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

import osm_line
import realcfg
import tbconfig
import tblog

WHERE = "osm_fetch"
OK_CODE = 0
FAIL_CODE = 1
ARGC = len(("prog", "config", "line"))
OSM3S_KEY = "osm3s"
OSM_BASE_KEY = "timestamp_osm_base"
ELEMENTS_KEY = "elements"


def bbox_of(rc, spec):
    base = tbconfig.read_json(rc.line_path(spec["base_line"]))
    pts = base["points"]
    cum = osm_line.cum_km(pts, rc.tb["geo"]["earth_radius_km"])
    # 범위 양 끝을 품는 꼭짓점까지(앞뒤 하나씩 더)
    idx = [i for i, k in enumerate(cum) if spec["base_from_km"] <= k <= spec["base_to_km"]]
    lo = max(0, min(idx) - 1)
    hi = min(len(pts) - 1, max(idx) + 1)
    sel = pts[lo:hi + 1]
    m = spec["bbox_margin_deg"]
    south = min(p[0] for p in sel) - m
    north = max(p[0] for p in sel) + m
    west = min(p[1] for p in sel) - m
    east = max(p[1] for p in sel) + m
    return south, west, north, east


def build_query(rc, spec, box):
    o = rc["overpass"]
    head = "[out:json][timeout:" + str(o["query_timeout_s"]) + "][bbox:" + ",".join(str(v) for v in box) + "];"
    ways = "(" + "".join("way" + f + ";" for f in spec["way_filters"]) + ");"
    return head + "\n" + ways + "\nout body;\n>;\nout skel qt;\n"


def kst_now(rc):
    return datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=rc.tb["kst_offset_hours"])


def fetch(rc, log, query):
    o = rc["overpass"]
    body = urllib.parse.urlencode({o["form_key"]: query}).encode("utf-8")
    tried = []
    for ep in o["endpoints"]:
        started = time.monotonic()
        log.write(WHERE + ".fetch", "시도 시작", endpoint=ep)
        req = urllib.request.Request(ep, data=body, headers={"User-Agent": o["user_agent"], "Content-Type": o["content_type"]})
        try:
            with urllib.request.urlopen(req, timeout=o["http_timeout_s"]) as resp:
                raw = resp.read()
            data = json.loads(raw.decode("utf-8"))
            secs = round(time.monotonic() - started, rc.tb["units"]["report_decimals"])
            log.write(WHERE + ".fetch", "시도 끝", endpoint=ep, result="받음", bytes=len(raw), seconds=secs,
                      elements=len(data.get(ELEMENTS_KEY, [])))
            return ep, raw, data, tried
        except (urllib.error.URLError, OSError, ValueError) as e:
            secs = round(time.monotonic() - started, rc.tb["units"]["report_decimals"])
            log.write(WHERE + ".fetch", "시도 끝", endpoint=ep, result="실패", error=repr(e), seconds=secs)
            tried.append({"endpoint": ep, "error": repr(e), "seconds": secs})
    return None, None, None, tried


def main(argv):
    if len(argv) != ARGC:
        print("쓰는 법: py osm_fetch.py <config/realline.json> <선 이름>")
        return FAIL_CODE
    try:
        rc = realcfg.RealConfig(argv[1])
    except realcfg.RealError as e:
        print(str(e))
        return FAIL_CODE
    log = tblog.from_config(rc.tb, rc.tb.resolve)
    name = argv[-1]
    log.write(WHERE + ".main", "시작", line=name)
    if name not in rc["lines"]:
        print("설정 lines 에 없는 선: " + name)
        log.write(WHERE + ".main", "끝", result="없는 선")
        return FAIL_CODE
    spec = rc["lines"][name]
    box = bbox_of(rc, spec)
    query = build_query(rc, spec, box)
    ep, raw, data, tried = fetch(rc, log, query)
    if raw is None:
        print("모든 서버에서 못 받음:")
        for t in tried:
            print("  " + t["endpoint"] + " — " + t["error"])
        log.write(WHERE + ".main", "끝", result="못 받음")
        return FAIL_CODE
    now = kst_now(rc)
    stem = name + "_" + now.strftime(rc["stamp_format"])
    out_dir = rc.work_path(rc["raw_dir"])
    os.makedirs(out_dir, exist_ok=True)
    raw_path = os.path.join(out_dir, stem + rc["raw_suffix"])
    with open(raw_path, "wb") as f:
        f.write(raw)
    with open(os.path.join(out_dir, stem + rc["query_suffix"]), "w", encoding="utf-8", newline="\n") as f:
        f.write(query)
    els = data.get(ELEMENTS_KEY, [])
    meta = {
        "line": name,
        "taken_at_kst": now.strftime(rc["taken_format"]),
        "endpoint": ep,
        "failed_before": tried,
        "query_file": stem + rc["query_suffix"],
        "query": query,
        "bbox_swne": list(box),
        "osm_base": data.get(OSM3S_KEY, {}).get(OSM_BASE_KEY),
        "ways": sum(1 for e in els if e.get("type") == "way"),
        "nodes": sum(1 for e in els if e.get("type") == "node"),
        "bytes": len(raw),
        "license": rc["license"],
    }
    with open(os.path.join(out_dir, stem + rc["meta_suffix"]), "w", encoding="utf-8", newline="\n") as f:
        json.dump(meta, f, ensure_ascii=False, indent=rc.tb["units"]["json_indent"])
        f.write("\n")
    print("받음: " + raw_path + " · 길 " + str(meta["ways"]) + " · 점 " + str(meta["nodes"]) + " · 자료 시각 " + str(meta["osm_base"]))
    log.write(WHERE + ".main", "끝", result="받음", raw=raw_path, ways=meta["ways"], nodes=meta["nodes"])
    return OK_CODE


if __name__ == "__main__":
    sys.exit(main(sys.argv))
