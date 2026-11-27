"""제한 속도 출처 원본 → 우리 선의 km 구간별 제한 속도 표(파이썬 기본 모듈만).

쓰는 법:  py tools/limit_table.py <제한 속도 출처 설정> <선 이름> [원본 파일 — 없으면 출처 raw_dir 에서 그 선의 가장 새 것] [--write]
  예)    py tools/limit_table.py config/limit_source.json gyeongbu_down_osm --write

- 출처는 설정 source 한 줄(지금 osm). 출처마다 읽는 법(reader)·원본 자리·꼬리표 이름·단위 바꾸기는 설정 sources.<출처> 에.
- osm_ways 읽개: 선의 점 둘 사이마다 두 점을 잇는 오픈스트리트맵 길(way)을 찾아, 선 방향으로 지나면 앞 방향 꼬리표,
  거꾸로 지나면 뒤 방향 꼬리표를 읽는다. 한쪽 길(oneway)이 아니면 반대 방향(back) 값도 읽는다.
- 값이 없거나 못 읽은 구간은 짐작하지 않고 null(빈 값). 0·기본값으로 채우지 않는다.
- 같은 값이 이어지는 구간은 하나로 붙인다. 표는 빈틈·겹침 없이 선 전체(km 0 ~ 선 길이)를 덮는다.
- --write 면 설정 lines.<선>.table 에 쓴다(원본·받은 때·저작권을 함께). 없으면 셈과 요약만.
- 시작·끝·실패는 기록장(tblog)에.
"""
import glob
import itertools
import json
import os
import re
import sys

import geo
import realcfg
import tbconfig
import tblog

WHERE = "limit_table"
OK_CODE = 0
FAIL_CODE = 1
WRITE_FLAG = "--write"
MIN_ARGS = len(("prog", "config", "line"))
MAX_ARGS = MIN_ARGS + 1
WAY = "way"
NODE = "node"
TAGS_KEY = "tags"
ONEWAY_KEY = "oneway"
GLOB_ANY = "*"
NUM_GROUP = "num"    # 설정 value_re 의 이름 붙은 묶음(숫자)
UNIT_GROUP = "unit"  # 같은 꼴의 단위 묶음


class LimitError(Exception):
    pass


class LimitConfig:
    """제한 속도 출처 설정 — 실자료 설정(realline_config)으로 작업 폴더·테스트 베드 설정·선 자리를 함께 연다."""

    def __init__(self, path):
        self.path = os.path.abspath(path)
        self.folder = os.path.dirname(self.path)
        try:
            self.data = tbconfig.read_json(self.path)
        except (OSError, ValueError) as e:
            raise LimitError("제한 속도 출처 설정을 읽지 못함: " + self.path + " — " + str(e))
        try:
            self.rc = realcfg.RealConfig(self.resolve(self.data["realline_config"]))
        except realcfg.RealError as e:
            raise LimitError(str(e))
        self.tb = self.rc.tb
        if self.data["source"] not in self.data["sources"]:
            raise LimitError("설정 sources 에 없는 출처: " + self.data["source"])

    def resolve(self, rel):
        return os.path.normpath(os.path.join(self.folder, rel))

    def source(self):
        return self.data["source"], self.data["sources"][self.data["source"]]

    def table_path(self, line):
        return self.resolve(self.data["lines"][line]["table"])

    def __getitem__(self, key):
        return self.data[key]


def parse_kmh(text, src):
    """꼬리표 글 → km/h 정수. 못 읽으면(낱말·모르는 단위·서로 다른 여러 값·범위 밖) None."""
    if text is None:
        return None
    rx = re.compile(src["value_re"])
    got = set()
    for part in str(text).split(src["multi_sep"]):
        m = rx.match(part)
        if not m:
            return None
        unit = m.group(UNIT_GROUP).lower()
        if unit not in src["unit_factor"]:
            return None
        got.add(round(float(m.group(NUM_GROUP)) * src["unit_factor"][unit]))
    if len(got) != 1:
        return None
    v = got.pop()
    return v if src["kmh_min"] <= v <= src["kmh_max"] else None


def first_tag(tags, names, src):
    for n in names:
        if n in tags:
            return parse_kmh(tags[n], src)
    return None


def read_osm_ways(points, raw, src, spec, decimals):
    """선의 점 사이(조각)마다 (fwd, back) 값 목록과 셈 정보. spec = 실자료 설정의 그 선 칸(한쪽 길 낱말)."""
    at = {}
    for e in raw["elements"]:
        if e["type"] == NODE:
            at.setdefault((round(e["lat"], decimals), round(e["lon"], decimals)), []).append(e["id"])
    edge = {}
    for e in raw["elements"]:
        if e["type"] != WAY:
            continue
        ids = e["nodes"]
        for a, b in zip(ids, ids[1:]):
            edge.setdefault((a, b), (e, True))
            edge.setdefault((b, a), (e, False))
    one_way = set(spec["oneway_forward"]) | set(spec["oneway_backward"])
    vals = []
    missing = 0
    for p, q in zip(points, points[1:]):
        hit = None
        for a, b in itertools.product(at.get((round(p[0], decimals), round(p[1], decimals)), ()),
                                      at.get((round(q[0], decimals), round(q[1], decimals)), ())):
            if (a, b) in edge:
                hit = edge[(a, b)]
                break
        if hit is None:
            missing += 1
            vals.append((None, None))
            continue
        way, along = hit
        tags = way.get(TAGS_KEY, {})
        fwd_names, back_names = (src["tags_forward"], src["tags_backward"]) if along else (src["tags_backward"], src["tags_forward"])
        fwd = first_tag(tags, fwd_names, src)
        back = None if tags.get(ONEWAY_KEY) in one_way else first_tag(tags, back_names, src)
        vals.append((fwd, back))
    return vals, {"pieces": len(vals), "no_way": missing}


READERS = {"osm_ways": read_osm_ways}


def latest_raw(lc, src, line):
    found = sorted(glob.glob(os.path.join(lc.rc.work_path(src["raw_dir"]), line + src["stamp_sep"] + GLOB_ANY + src["raw_suffix"])))
    return found[-1] if found else None


def merge(points, vals, radius, km_dec):
    """조각 값 → 같은 값끼리 붙인 구간 [(from, to, fwd, back)] — 선 전체를 빈틈 없이."""
    cum = [0.0]
    for p, q in zip(points, points[1:]):
        cum.append(cum[-1] + geo.sphere_km(p, q, radius))
    out = []  # [시작 km, 끝 km, (fwd, back)]
    for i, v in enumerate(vals):
        if out and out[-1][-1] == v:
            out[-1][1] = cum[i + 1]
        else:
            out.append([cum[i], cum[i + 1], v])
    return [(round(a, km_dec), round(b, km_dec), f, k) for a, b, (f, k) in out], cum[-1]


def summarize(sections, length, dec):
    by = {}
    blank = 0.0
    for a, b, f, k in sections:
        if f is None and k is None:
            blank += b - a
        if f is not None:
            by[str(f)] = by.get(str(f), 0.0) + (b - a)
    valued = sum(b - a for a, b, f, _ in sections if f is not None)
    return {"sections": len(sections), "valued_sections": sum(1 for _, _, f, k in sections if f is not None or k is not None),
            "line_km": round(length, dec), "valued_km": round(valued, dec), "blank_km": round(blank, dec),
            "km_by_kmh": {k: round(v, dec) for k, v in sorted(by.items())}}


def build(lc, line, raw_path):
    """(표 dict, 셈 정보). 원본·선이 없거나 못 읽으면 LimitError."""
    name, src = lc.source()
    if src["reader"] not in READERS:
        raise LimitError("모르는 읽개: " + src["reader"] + " (출처 " + name + ")")
    if line not in lc["lines"] or line not in lc.rc["lines"]:
        raise LimitError("설정 lines 에 없는 선: " + line)
    raw_path = raw_path or latest_raw(lc, src, line)
    if raw_path is None:
        raise LimitError("원본이 없음 — " + lc.rc.work_path(src["raw_dir"]) + " 에 " + line + " 의 원본")
    try:
        raw = tbconfig.read_json(raw_path)
        meta = tbconfig.read_json(raw_path[:-len(src["raw_suffix"])] + src["meta_suffix"])
        points = tbconfig.read_json(lc.rc.line_path(line))["points"]
    except (OSError, ValueError, KeyError) as e:
        raise LimitError("원본·선을 읽지 못함: " + repr(e))
    spec = lc.rc["lines"][line]
    vals, info = READERS[src["reader"]](points, raw, src, spec, spec["coord_decimals"])
    T = lc["table"]
    sections, length = merge(points, vals, lc.tb["geo"]["earth_radius_km"], T["km_decimals"])
    summary = summarize(sections, length, lc.tb["units"]["report_decimals"])
    lic = meta["license"]
    table = {
        "line": line, "source": name, "real": True,
        "from": lic["source"] + " — " + lic["attribution"] + ", " + lic["license"] + " (" + lic["license_url"] + "). 원본: " + os.path.basename(raw_path)
                + " (작업 폴더의 " + src["raw_place_text"] + "). 만든 도구: " + T["tool_text"],
        "taken_at": meta["taken_at_kst"] + " (받은 때, 한국 시각) · 자료 시각 " + str(meta["osm_base"]) + " (UTC)",
        "note": "선(scenes/lines/" + line + ") 첫 점에서 잰 km 구간별 제한 속도(km/h). 값 없는 구간은 null(짐작 없음). 꼬리표: 앞 방향 " + ", ".join(src["tags_forward"])
                + " / 뒤 방향 " + ", ".join(src["tags_backward"]) + ". 길을 못 찾은 조각 " + str(info["no_way"]) + " / " + str(info["pieces"]),
        "summary": summary,
        T["sections_key"]: [{T["from_key"]: a, T["to_key"]: b, T["fwd_key"]: f, T["back_key"]: k} for a, b, f, k in sections],
    }
    return table, dict(info, raw=raw_path, line_km=length)


def main(argv):
    args = [a for a in argv if a != WRITE_FLAG]
    write = WRITE_FLAG in argv
    if not (MIN_ARGS <= len(args) <= MAX_ARGS):
        print("쓰는 법: py limit_table.py <config/limit_source.json> <선 이름> [원본 파일] [--write]")
        return FAIL_CODE
    try:
        lc = LimitConfig(args[1])
    except LimitError as e:
        print(str(e))
        return FAIL_CODE
    log = tblog.from_config(lc.tb, lc.tb.resolve)
    line = args[MIN_ARGS - 1]
    log.write(WHERE + ".main", "시작", line=line, source=lc["source"], write=write)
    try:
        table, info = build(lc, line, args[MAX_ARGS - 1] if len(args) == MAX_ARGS else None)
    except LimitError as e:
        print(str(e))
        log.write(WHERE + ".main", "끝", result="실패", error=str(e))
        return FAIL_CODE
    s = table["summary"]
    print("| 선 | 출처 | 구간 | 값 있는 구간 | 선 길이 km | 값 있는 km | 빈 km | 값별 km | 길 못 찾은 조각 |")
    print("|---|---|---|---|---|---|---|---|---|")
    print("| " + " | ".join(str(v) for v in (line, table["source"], s["sections"], s["valued_sections"], s["line_km"], s["valued_km"], s["blank_km"],
                                               json.dumps(s["km_by_kmh"], ensure_ascii=False), str(info["no_way"]) + " / " + str(info["pieces"]))) + " |")
    print("원본: " + info["raw"])
    if write:
        path = lc.table_path(line)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            json.dump(table, f, ensure_ascii=False, indent=lc.tb["units"]["json_indent"])
            f.write("\n")
        print("씀: " + path)
    log.write(WHERE + ".main", "끝", result="뽑음", sections=s["sections"], valued_km=s["valued_km"], blank_km=s["blank_km"], no_way=info["no_way"], wrote=write)
    return OK_CODE


if __name__ == "__main__":
    sys.exit(main(sys.argv))
