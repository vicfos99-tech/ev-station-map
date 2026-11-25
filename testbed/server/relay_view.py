"""장면의 충전소·충전기 상태를 중계 자료 꼴(`ref/relay_format.md`)로 만든다(순수 — 로그 없음, 값은 인자로만).

만드는 것: meta.json · stations/<시군구>.json · status/<시군구>.json · status/rest/<휴게소 id>.json.
- operators : 장면의 충전소 목록(match_ids 가 채운 name·zscode·zcodes·rest 를 가진 것)
- chargers  : {(충전소 id, 충전기 id): {"word", "since_tick", "last_end_tick"}} — 장면 재생의 지금 상태
- codes     : 상태 낱말 → 중계 stat 코드(설정 status_codes)
- when(tick): 그 틱의 시각 글(중계 꼴 14자리, 한국 시각) — 부르는 쪽이 준다
없는 파일이면 None 을 돌려준다(부르는 쪽이 '없음' 답을 낸다).
"""

CHARGING_WORD = "charging"
STATION_FIELDS = ("id", "name", "operator", "maker", "loc")
FLAG_FIELDS = ("indoor", "rest")


def _ops_in(operators, zscode):
    return [op for op in operators if op.get("zscode") == zscode]


def _triple(ch, codes, when):
    now = when(ch["since_tick"]) if ch["word"] == CHARGING_WORD else None
    last = when(ch["last_end_tick"] if ch["last_end_tick"] is not None else 0)
    return [codes[ch["word"]], last, now]


def meta(operators, v, at_text, start_text):
    fresh = sorted({z for op in operators for z in op.get("zcodes", [])})
    return {"v": v, "at": at_text, "stations_at": start_text, "calls_today": 0, "ok": True,
            "error": "", "suspect": [], "fresh": fresh, "unknown": 0}


def stations(operators, zscode, v):
    ops = _ops_in(operators, zscode)
    if not ops:
        return None
    zcodes = sorted({z for op in ops for z in op.get("zcodes", [])})
    out = []
    for op in ops:
        st = {"id": op["station_id"], "name": op.get("name", op["operator"]), "operator": op["operator"],
              "maker": op.get("maker", ""), "loc": op["loc"]}
        for flag in FLAG_FIELDS:
            if op.get(flag):
                st[flag] = True
        st["chargers"] = [{"id": c["id"], "type": c["type"], "kw": c["kw"]} for c in op["chargers"]]
        out.append(st)
    return {"v": v, "zscode": zscode, "zcodes": zcodes, "stations": out}


def _file_at(ops, chargers, when):
    ticks = [chargers[(op["station_id"], c["id"])]["since_tick"] for op in ops for c in op["chargers"]]
    return when(max(ticks) if ticks else 0)


def status(operators, chargers, zscode, codes, when):
    ops = _ops_in(operators, zscode)
    if not ops:
        return None
    s = {op["station_id"]: {c["id"]: _triple(chargers[(op["station_id"], c["id"])], codes, when)
                            for c in op["chargers"]} for op in ops}
    return {"at": _file_at(ops, chargers, when), "s": s}


def status_rest(operators, chargers, rest_id, codes, when):
    ops = [op for op in operators if op["station_id"] == rest_id and op.get("rest")]
    if not ops:
        return None
    op = ops[0]
    rows = []
    for c in op["chargers"]:
        stat, last, now = _triple(chargers[(op["station_id"], c["id"])], codes, when)
        rows.append({"statId": op["station_id"], "chgerId": c["id"], "stat": stat, "lastTedt": last, "nowTsdt": now})
    return {"rest": rest_id, "at": _file_at(ops, chargers, when), "chargers": rows}
