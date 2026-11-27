"""제한 속도 표(limit_table.py) 단위 시험 — 파이썬 기본 모듈만, 바깥에 묻지 않음.

쓰는 법:  py tools/try_limit_table.py <제한 속도 출처 설정(config/limit_source.json)>

보는 것(표로 찍고 하나라도 틀리면 0 아닌 코드, 시작·끝·결과는 기록장에):
 ① 꼬리표 값 읽기 — 숫자·단위 바꾸기, 낱말·모르는 단위·서로 다른 여러 값·범위 밖은 빈 값(null)
 ② 손으로 만든 작은 원본·선 — 선 방향으로 지나는 길은 앞 꼬리표, 거꾸로 지나는 길은 뒤 꼬리표, 꼬리표 없는 길은 빈 값(0 아님)
 ③ 테스트 베드 자료 자리의 표가 같은 원본으로 다시 뽑은 표와 구간 하나까지 같음(다시 돌릴 수 있음)
 ④ 표가 선 전체를 빈틈·겹침 없이 덮고, 값은 null 이거나 범위 안(0·짐작 값 없음)
 ⑤ 표에 출처·원본·받은 때·저작권(© OpenStreetMap contributors, ODbL)이 적힘
"""
import sys

import limit_table
import tbconfig
import tblog

WHERE = "try_limit_table"
OK_CODE = 0
FAIL_CODE = 1
ARGC = len(("prog", "config"))
PASS = "통과"
FAIL = "실패"
NODE = "node"
WAY = "way"


def fake_raw(T):
    els = [{"type": NODE, "id": i + 1, "lat": p[0], "lon": p[1]} for i, p in enumerate(T["fake_points"])]
    els += [{"type": WAY, "id": i + 1, "nodes": [n + 1 for n in w["nodes"]], "tags": w["tags"]} for i, w in enumerate(T["fake_ways"])]
    return {"elements": els}


def main(argv):
    if len(argv) != ARGC:
        print("쓰는 법: py try_limit_table.py <config/limit_source.json>")
        return FAIL_CODE
    try:
        lc = limit_table.LimitConfig(argv[1])
    except limit_table.LimitError as e:
        print(str(e))
        return FAIL_CODE
    log = tblog.from_config(lc.tb, lc.tb.resolve)
    log.write(WHERE + ".main", "시작", config=lc.path)
    T = lc["try"]
    TB = lc["table"]
    _, src = lc.source()
    spec = lc.rc["lines"][T["line"]]
    rows = []

    def row(no, title, expect, actual, ok):
        rows.append((no, title, expect, actual, ok))
        log.write(WHERE + ".row", PASS if ok else FAIL, no=no, expect=expect, actual=actual)

    got = [[text, limit_table.parse_kmh(text, src)] for text, _ in T["values"]]
    row("①", "꼬리표 값 읽기(단위·낱말·여러 값·범위 " + str(src["kmh_min"]) + "~" + str(src["kmh_max"]) + ")",
        str(T["values"]), str(got), got == [list(v) for v in T["values"]])

    vals, info = limit_table.read_osm_ways(T["fake_points"], fake_raw(T), src, spec, spec["coord_decimals"])
    fwd = [v[0] for v in vals]
    secs, _ = limit_table.merge(T["fake_points"], vals, lc.tb["geo"]["earth_radius_km"], TB["km_decimals"])
    row("②", "작은 원본 — 정방향 길 앞 꼬리표 · 거꾸로 지나는 길 뒤 꼬리표 · 꼬리표 없는 길 빈 값 · 한쪽 길이라 back 빈 값",
        "fwd " + str(T["fake_expect"]) + " · back 모두 None · 구간 " + str(len(T["fake_expect"])) + " · 길 못 찾음 0",
        "fwd " + str(fwd) + " · back " + str([v[1] for v in vals]) + " · 구간 " + str(len(secs)) + " · 길 못 찾음 " + str(info["no_way"]),
        fwd == T["fake_expect"] and all(v[1] is None for v in vals) and len(secs) == len(T["fake_expect"]) and info["no_way"] == 0)

    path = lc.table_path(T["line"])
    try:
        saved = tbconfig.read_json(path)
    except (OSError, ValueError) as e:
        saved = None
        log.write(WHERE + ".main", "표 못 읽음", path=path, error=repr(e))
    again, ainfo = limit_table.build(lc, T["line"], None)
    same = saved is not None and saved[TB["sections_key"]] == again[TB["sections_key"]]
    row("③", "자료 자리 표 = 같은 원본으로 다시 뽑은 표", "구간 모두 같음",
        ("표 없음: " + path) if saved is None else ("구간 " + str(len(saved[TB["sections_key"]])) + " / 다시 " + str(len(again[TB["sections_key"]])) + " · 같음 " + str(same)), same)

    s = saved[TB["sections_key"]] if saved else []
    line_km = round(ainfo["line_km"], TB["km_decimals"])
    joined = all(a[TB["to_key"]] == b[TB["from_key"]] for a, b in zip(s, s[1:]))
    ends = bool(s) and s[0][TB["from_key"]] == 0 and s[-1][TB["to_key"]] == line_km
    vals_ok = all(v is None or (src["kmh_min"] <= v <= src["kmh_max"]) for x in s for v in (x[TB["fwd_key"]], x[TB["back_key"]]))
    row("④", "선 전체를 빈틈·겹침 없이 · 값은 null 또는 범위 안(0 없음)", "처음 0 · 끝 ≈ 선 길이 " + str(line_km) + " km · 이어짐 · 0·범위 밖 없음",
        "처음 " + (str(s[0][TB["from_key"]]) if s else "-") + " · 끝 " + (str(s[-1][TB["to_key"]]) if s else "-") + " · 이어짐 " + str(joined) + " · 값 맞음 " + str(vals_ok),
        ends and joined and vals_ok)

    lic = tbconfig.read_json(ainfo["raw"][:-len(src["raw_suffix"])] + src["meta_suffix"])["license"]
    text = (saved or {}).get("from", "")
    ok5 = bool(saved) and lic["attribution"] in text and lic["license"] in text and bool(saved.get("taken_at")) and saved.get("source") == lc["source"]
    row("⑤", "출처·원본·받은 때·저작권 적힘", lic["attribution"] + " · " + lic["license"] + " · 받은 때 · 출처 " + lc["source"],
        text + " · " + str((saved or {}).get("taken_at")), ok5)

    print("| # | 시험 | 기대 | 실제 | 결과 |")
    print("|---|---|---|---|---|")
    for no, title, expect, actual, ok in rows:
        print("| " + " | ".join(str(v).replace("|", "/") for v in (no, title, expect, actual, PASS if ok else FAIL)) + " |")
    good = all(r[-1] for r in rows)
    print("")
    print("제한 속도 표 단위 시험: " + (PASS if good else FAIL) + " (" + str(sum(1 for r in rows if r[-1])) + " / " + str(len(rows)) + ")")
    log.write(WHERE + ".main", "끝", result=PASS if good else FAIL)
    return OK_CODE if good else FAIL_CODE


if __name__ == "__main__":
    sys.exit(main(sys.argv))
