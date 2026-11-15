"""tools/ic_nearby.py 시험 (키 없이, 가짜 나들목·충전기로).

    py -m pytest -q -p no:cacheprovider tools/test_ic_nearby.py
"""
import json
import sys
from datetime import datetime, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "src"))

import charger_api as ca  # noqa: E402
import ic_nearby as icn  # noqa: E402
from ev_charge_planner import (  # noqa: E402
    Charger, NearbyStation, RestArea, Route, Station, User, Vehicle, plan,
)

NOW = 1_763_164_000_000
# 경부 선 위의 점 두 개(기흥·안성 사이, 천안 부근)
GIHEUNG = (37.236, 127.105)
OSAN_IC = (37.161, 127.115)     # 기흥-안성 사이 선 근처(가짜 '오산' 나들목)
CHEONAN_IC = (36.800, 127.176)  # 망향-천안삼거리 사이(가짜 '천안' 나들목)


def ch(name, sid, lat, lng, stat="2", ctype="04", kind="B001", busi="채비"):
    return {"statNm": name, "statId": sid, "chgerId": "01", "chgerType": ctype, "lat": str(lat), "lng": str(lng),
            "stat": stat, "output": "100", "busiNm": busi, "kindDetail": kind, "delYn": "N"}


def test_parse_ics_handles_various_shapes():
    a = icn.parse_ics({"list": [{"unitName": "오산", "routeName": "경부선", "xValue": "127.115", "yValue": "37.161"}]})
    b = icn.parse_ics([{"영업소명": "천안", "노선명": "경부고속도로", "경도": 127.176, "위도": 36.8}])
    c = icn.parse_ics({"items": {"item": [{"name": "x", "lat": "", "lng": "127"}, {"name": "뒤바뀜", "lat": 127.1, "lng": 37.1}]}})
    assert a == [{"name": "오산", "route": "경부선", "lat": 37.161, "lng": 127.115}]
    assert b[0]["name"] == "천안" and b[0]["route"] == "경부고속도로"
    assert c == []  # 빈 좌표, 위경도가 뒤바뀐 것은 뺀다


def test_ics_on_highway_by_name_and_distance():
    ics = [
        {"name": "오산", "route": "경부선", "lat": OSAN_IC[0], "lng": OSAN_IC[1]},
        {"name": "천안", "route": "", "lat": CHEONAN_IC[0], "lng": CHEONAN_IC[1]},          # 노선 이름 없음 → 거리로
        {"name": "오산2", "route": "경부선", "lat": OSAN_IC[0] + 0.003, "lng": OSAN_IC[1]},  # 1km 안 → 하나로
        {"name": "남이", "route": "중부선", "lat": 37.150, "lng": 127.110},                 # 다른 노선 이름 → 경부 아님
        {"name": "먼곳", "route": "", "lat": 36.0, "lng": 126.0},
    ]
    on = icn.ics_on_highway(ics, "gb")
    assert len(on) == 2 and on[0]["name"] in ("오산", "오산2") and on[1]["name"] == "천안"  # 1km 안 둘은 앞의 것 하나만
    assert on[0]["along"] < on[1]["along"]


def test_nearby_stations_distance_and_limit():
    ic = {"name": "오산", "route": "경부선", "lat": OSAN_IC[0], "lng": OSAN_IC[1]}
    items = [
        ch("가까운", "A", OSAN_IC[0] + 0.009, OSAN_IC[1]),          # 약 1km
        ch("조금 먼", "B", OSAN_IC[0] + 0.018, OSAN_IC[1]),          # 약 2km
        ch("완속만", "C", OSAN_IC[0] + 0.005, OSAN_IC[1], ctype="02"),
        ch("너무 먼", "D", OSAN_IC[0] + 0.05, OSAN_IC[1]),           # 약 5.6km
        ch("휴게소", "E", OSAN_IC[0], OSAN_IC[1], kind="C001"),      # 휴게소는 따로 다룬다
        ch("또 가까운", "F", OSAN_IC[0] - 0.012, OSAN_IC[1]),
        ch("넷째", "G", OSAN_IC[0] - 0.020, OSAN_IC[1]),
    ]
    st = icn.stations_from_items(items, NOW)
    assert sorted(s["id"] for s in st) == ["A", "B", "D", "F", "G"]
    near = icn.nearby_stations(ic, st)
    assert [n["station"]["id"] for n in near] == ["A", "F", "B"]  # 가까운 순 3곳
    d = ca.haversine_km(OSAN_IC, (OSAN_IC[0] + 0.009, OSAN_IC[1]))
    assert near[0]["detour"] == round(d * 2 * icn.ROAD_FACTOR, 1)
    assert "pt" not in near[0]["station"] and near[0]["station"]["updated"] == NOW
    # 먼 충전소(직선 3km 밖)만 있으면 붙이지 않는다
    only_far = [s for s in st if s["id"] == "D"]
    assert icn.nearby_stations(ic, only_far) == []


def _engine(route):
    epoch = datetime(1970, 1, 1)

    def station(s):
        return Station(s["id"], s["operator"], [Charger(**c) for c in s["chargers"]], s["price"],
                       epoch + timedelta(milliseconds=s["updated"]))
    return Route(route["highway"], route["direction"], [
        RestArea(a["id"], a["name"], a["km"], [station(s) for s in a["stations"]],
                 [NearbyStation(station(n["station"]), n["detour"]) for n in a.get("nearby", [])])
        for a in route["rest_areas"]])


def test_attach_adds_ic_entries_both_directions_and_engine_uses_them():
    # 기흥 휴게소(충전기 모두 고장) + 오산 나들목 인근 채비 충전소

    items = [ch("기흥휴게소(부산방향)", "R1", *GIHEUNG, stat="4", kind="C001", busi="환경부"),
             ch("기흥휴게소(서울방향)", "R2", *GIHEUNG, stat="2", kind="C001", busi="환경부")]
    routes, _ = ca.build_routes(items, NOW)
    ics = [{"name": "오산", "route": "경부선", "lat": OSAN_IC[0], "lng": OSAN_IC[1]}]
    st = icn.stations_from_items([ch("오산충전소", "N1", OSAN_IC[0] + 0.009, OSAN_IC[1])], NOW)
    added = icn.attach(routes, ics, st)
    assert added == 2  # 두 방향
    down = next(r for r in routes if r["key"] == "live-gb-down")
    ic = [a for a in down["rest_areas"] if a.get("kind") == "ic"][0]
    assert ic["name"] == "오산 나들목" and ic["stations"] == [] and ic["nearby"][0]["station"]["id"] == "N1"
    kms = [a["km"] for a in down["rest_areas"]]
    assert kms == sorted(kms)
    up = next(r for r in routes if r["key"] == "live-gb-up")
    up_ic = [a for a in up["rest_areas"] if a.get("kind") == "ic"][0]
    length = ca.line_length_km(ca.HIGHWAYS["gb"]["points"])
    assert abs(up_ic["km"] + ic["km"] - length) < 0.2
    # 엔진: 휴게소 충전기가 고장이면 나들목 인근을 1순위로
    res = plan(_engine(down), Vehicle(soc_pct=50, battery_kwh=77.4, efficiency_km_per_kwh=5.0), User(),
               datetime(1970, 1, 1) + timedelta(milliseconds=NOW + 60000))
    assert res.recommendation.primary.station_id == "N1" and res.recommendation.primary.is_nearby


def test_attach_twice_does_not_duplicate_and_skips_rest_area_station_ids():
    items = [ch("기흥휴게소(부산방향)", "R1", *GIHEUNG, kind="C001")]
    routes, _ = ca.build_routes(items, NOW)
    ics = [{"name": "기흥", "route": "경부", "lat": GIHEUNG[0], "lng": GIHEUNG[1]}]
    # 휴게소와 같은 id 의 충전소는 나들목 쪽에 다시 넣지 않는다
    st = icn.stations_from_items([ch("같은곳", "R1", GIHEUNG[0] + 0.005, GIHEUNG[1], kind="B001")], NOW)
    assert icn.attach(routes, ics, st) == 0


def test_main_reads_files_and_rewrites_live_js(tmp_path, capsys):
    items = [ch("기흥휴게소(부산방향)", "R1", *GIHEUNG, kind="C001")]
    routes, skipped = ca.build_routes(items, NOW)
    live = tmp_path / "live.js"
    ca.write_live_js(routes, NOW, live, skipped)
    (tmp_path / "ics.json").write_text(json.dumps({"list": [{"unitName": "오산", "routeName": "경부선",
                                                             "xValue": OSAN_IC[1], "yValue": OSAN_IC[0]}]}), encoding="utf-8")
    (tmp_path / "all.json").write_text(json.dumps({"items": {"item": [ch("오산충전소", "N1", OSAN_IC[0] + 0.009, OSAN_IC[1])]}},
                                                  ensure_ascii=False), encoding="utf-8")
    args = ["--ics", str(tmp_path / "ics.json"), "--chargers", str(tmp_path / "all.json"), "--live", str(live)]
    assert icn.main(args) == 0
    assert icn.main(args) == 0  # 두 번 돌려도 겹치지 않음
    text = live.read_text(encoding="utf-8")
    assert text.count("오산 나들목") == 1 and '"ic_note"' in text and '"config"' in text
    assert "항목 1개" in capsys.readouterr().out


def test_main_without_key_or_file_says_how(monkeypatch, tmp_path, capsys):
    monkeypatch.delenv(icn.EX_KEY_ENV, raising=False)
    assert icn.main(["--live", str(tmp_path / "x.js")]) == 2
    assert icn.EX_KEY_ENV in capsys.readouterr().out


def test_parse_osm_keeps_only_real_interchanges():
    raw = {"elements": [
        {"type": "node", "lat": OSM_LAT, "lon": 127.115, "tags": {"highway": "motorway_junction", "name": "오산 나들목", "ref": "5"}},
        {"type": "node", "lat": 36.8, "lon": 127.176, "tags": {"name": "천안IC"}},
        {"type": "node", "lat": 36.5, "lon": 127.4, "tags": {"name": "서대전"}},            # 꼬리말 없는 이름도 나들목
        {"type": "node", "lat": 37.28, "lon": 127.1, "tags": {"name": "신갈 분기점"}},       # 분기점: 나갈 수 없음
        {"type": "node", "lat": 37.2, "lon": 127.1, "tags": {"name": "용인 휴게소 (강릉 방향)"}},
        {"type": "node", "lat": 37.1, "lon": 127.1, "tags": {"highway": "motorway_junction"}},  # 이름 없음
        {"type": "node", "lat": 33.9, "lon": 130.9, "tags": {"name": "新門司IC"}},           # 일본
        {"type": "node", "lat": 35.8, "lon": 128.6, "tags": {"name": "성북교지하차도"}},
        {"type": "node", "lon": 127.0, "tags": {"name": "좌표없음 나들목"}},
    ]}
    got = icn.parse_osm(raw)
    assert [g["name"] for g in got] == ["오산", "천안", "서대전"]
    assert all(g["route"] == "" for g in got) and got[0]["lat"] == OSM_LAT
    assert icn.parse_osm({}) == [] and icn.parse_osm([]) == []


OSM_LAT = OSAN_IC[0]


def test_main_with_osm_file_uses_charger_fetch_time(tmp_path, capsys):
    items = [ch("기흥휴게소(부산방향)", "R1", *GIHEUNG, kind="C001")]
    routes, skipped = ca.build_routes(items, NOW)
    live = tmp_path / "live.js"
    ca.write_live_js(routes, NOW, live, skipped)
    (tmp_path / "osm.json").write_text(json.dumps({"elements": [
        {"type": "node", "lat": OSAN_IC[0], "lon": OSAN_IC[1], "tags": {"name": "오산IC"}},
        {"type": "node", "lat": OSAN_IC[0] + 0.002, "lon": OSAN_IC[1], "tags": {"name": "오산IC"}},  # 반대 방향 차로의 같은 나들목
        {"type": "node", "lat": 37.28, "lon": 127.105, "tags": {"name": "신갈JC"}},
    ]}, ensure_ascii=False), encoding="utf-8")
    later = NOW + 3_600_000
    (tmp_path / "near.json").write_text(json.dumps({"fetched_ms": later, "items": {"item": [
        ch("오산충전소", "N1", OSAN_IC[0] + 0.009, OSAN_IC[1])]}}, ensure_ascii=False), encoding="utf-8")
    assert icn.main(["--osm", str(tmp_path / "osm.json"), "--chargers", str(tmp_path / "near.json"), "--live", str(live)]) == 0
    text = live.read_text(encoding="utf-8")
    data = json.loads(text[text.index("var d = ") + 8:text.index(";\n  if (typeof module")])
    down = next(r for r in data["routes"] if r["key"] == "live-gb-down")
    ics = [a for a in down["rest_areas"] if a.get("kind") == "ic"]
    assert [a["name"] for a in ics] == ["오산 나들목"]                      # 두 노드는 하나로, 분기점은 빠짐
    assert ics[0]["nearby"][0]["station"]["updated"] == later              # 충전기 상태를 받은 시각
    assert "OpenStreetMap" in data["ic_note"]
    assert "OpenStreetMap" in capsys.readouterr().out


def test_osm_refs_keep_only_this_highways_interchanges():
    # 오산(경부 길 위, ref 1), 옆 도로의 나들목(ref 171), 번호 없는 길의 나들목
    raw = {"elements": [
        {"type": "node", "id": 1, "lat": OSAN_IC[0], "lon": OSAN_IC[1], "tags": {"name": "오산 나들목"}},
        {"type": "node", "id": 2, "lat": OSAN_IC[0] + 0.004, "lon": OSAN_IC[1] + 0.004, "tags": {"name": "서오산IC"}},
        {"type": "node", "id": 3, "lat": OSAN_IC[0] - 0.004, "lon": OSAN_IC[1], "tags": {"name": "어딘가 나들목"}},
        {"type": "node", "id": 4, "lat": OSAN_IC[0] + 0.03, "lon": OSAN_IC[1], "tags": {"name": "오산 나들목"}},  # 같은 이름, 3km 남짓 떨어짐
        {"type": "node", "id": 5, "lat": 36.8, "lon": 127.176, "tags": {"name": "삼성IC(하이패스)"}},
    ]}
    ways = {"elements": [
        {"type": "way", "id": 10, "nodes": [1, 4, 99], "tags": {"highway": "motorway", "ref": "1"}},
        {"type": "way", "id": 11, "nodes": [2], "tags": {"highway": "motorway", "ref": "171"}},
        {"type": "way", "id": 12, "nodes": [5], "tags": {"highway": "motorway", "ref": "1;AH1"}},
        {"type": "way", "id": 13, "nodes": [3], "tags": {"highway": "motorway"}},
    ]}
    ics = icn.parse_osm(raw, ways)
    assert {i["name"]: i["refs"] for i in ics if i["name"] != "오산"} == {"서오산": ["171"], "어딘가": [], "삼성": ["1", "AH1"]}
    on = icn.ics_on_highway(ics, "gb")
    assert [i["name"] for i in on] == ["오산", "삼성"]          # 다른 번호·번호 없는 것은 빠지고, 같은 이름은 하나로
    assert icn.ics_on_highway(ics, "yd") == []                 # 영동(50)의 나들목이 아님
    # 길 목록을 안 주면 예전처럼 거리로만(옆 도로 것도 섞임)
    assert len(icn.ics_on_highway(icn.parse_osm(raw), "gb")) >= 3


def test_private_chargers_are_not_offered():
    base = (OSAN_IC[0] + 0.005, OSAN_IC[1])
    items = [
        ch("공영주차장", "P1", *base),
        ch("한빛아파트 지하2층", "P2", *base, kind="H001"),            # 공동주택
        ch("기숙사 급속", "P3", *base, kind="H003"),
        ch("군인공제회관 급속충전소(직원전용)", "P4", *base, kind="G001"),
        {**ch("제한 있는 곳", "P5", *base), "limitYn": "Y"},
        {**ch("제한 없는 곳", "P6", *base), "limitYn": "N"},
    ]
    assert sorted(s["id"] for s in icn.stations_from_items(items, NOW)) == ["P1", "P6"]
