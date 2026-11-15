"""tools/charger_api.py 시험 (키 없이, API 응답 모양의 가짜 자료로).

    py -m pytest -q -p no:cacheprovider tools/test_charger_api.py
"""
import io
import json
import shutil
import subprocess
import sys
import urllib.error
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT / "src"))

import charger_api as ca  # noqa: E402
from ev_charge_planner import (  # noqa: E402
    Charger, RestArea, Route, Station, User, Vehicle, plan,
)

NOW_MS = 1_763_100_000_000


def item(name, lat, lng, stat_id, chger_id, stat="2", ctype="04", output="100", busi="환경부", kind="C001"):
    return {"statNm": name, "statId": stat_id, "chgerId": chger_id, "chgerType": ctype, "lat": str(lat),
            "lng": str(lng), "stat": stat, "output": output, "busiNm": busi, "kindDetail": kind,
            "statUpdDt": "20261114093000"}


ITEMS = [
    item("기흥휴게소(부산방향)", 37.230, 127.098, "ME000001", "01", stat="2"),
    item("기흥휴게소(부산방향)", 37.230, 127.098, "ME000001", "02", stat="3"),
    item("기흥휴게소(부산방향)", 37.230, 127.098, "ME000001", "03", stat="2", ctype="02", output=""),
    item("망향휴게소(하행)", 36.951, 127.176, "EV000010", "01", stat="2", output="200", busi="에스케이일렉링크"),
    item("천안삼거리휴게소(부산방향)", 36.788, 127.174, "ME000020", "01", stat="5"),
    item("기흥휴게소(서울방향)", 37.231, 127.100, "ME000002", "01", stat="2"),
    item("죽전휴게소", 37.330, 127.100, "ME000030", "01"),                    # 방향 모름
    item("동해휴게소(삼척방향)", 37.500, 129.100, "ME000040", "01"),          # 고속도로에서 멂
    item("서초구청", 37.480, 127.030, "ME000050", "01", kind="A001"),         # 휴게소 아님
    item("용인휴게소(강릉방향)", 37.245, 127.250, "ME000060", "01", stat="1"),
]


def page(items, total=None, code="00"):
    return json.dumps({"resultCode": code, "resultMsg": "NORMAL SERVICE.", "totalCount": total or len(items),
                       "pageNo": 1, "numOfRows": 9999, "items": {"item": items}}, ensure_ascii=False)


@pytest.fixture(scope="module")
def built():
    return ca.build_routes(ITEMS, NOW_MS)


def route(routes, key):
    return next(r for r in routes if r["key"] == key)


# ---------- 응답 읽기 ----------
def test_parse_page_normal():
    items, total = ca.parse_page(page(ITEMS[:2], total=50))
    assert len(items) == 2 and total == 50


def test_parse_page_single_item_dict_and_wrapped():
    one = json.dumps({"response": {"header": {"resultCode": "00"},
                                   "body": {"items": {"item": ITEMS[0]}, "totalCount": 1}}})
    items, total = ca.parse_page(one)
    assert items == [ITEMS[0]] and total == 1


def test_parse_page_errors_are_readable():
    xml = ("<OpenAPI_ServiceResponse><cmmMsgHeader><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR"
           "</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>")
    with pytest.raises(ca.ApiError, match="SERVICE_KEY_IS_NOT_REGISTERED_ERROR"):
        ca.parse_page(xml)
    with pytest.raises(ca.ApiError, match="API 오류 30"):
        ca.parse_page(page([], code="30"))


def test_fetch_pages_until_total_and_hides_key(monkeypatch):
    pages = [page(ITEMS[:3], total=5), page(ITEMS[3:5], total=5)]
    urls = []

    def fake_open(req, timeout):
        urls.append(req.full_url)
        return io.BytesIO(pages[len(urls) - 1].encode("utf-8"))

    monkeypatch.setattr(ca.urllib.request, "urlopen", fake_open)
    got = ca.fetch_zcode("secret+key/=", "41", pause=0, log=lambda *_: None)
    assert len(got) == 5 and len(urls) == 2
    assert "serviceKey=secret%2Bkey%2F%3D" in urls[0] and "pageNo=2" in urls[1]

    def boom(req, timeout):
        raise urllib.error.HTTPError(req.full_url, 401, "Unauthorized", {}, None)

    monkeypatch.setattr(ca.urllib.request, "urlopen", boom)
    with pytest.raises(ca.ApiError) as e:
        ca.fetch_zcode("secret+key/=", "41", pause=0, log=lambda *_: None, wait=0)
    assert "401" in str(e.value) and "secret" not in str(e.value) and "시도" not in str(e.value)  # 401 은 다시 안 함


def test_server_timeout_is_retried(monkeypatch):
    calls = []

    def flaky(req, timeout):
        calls.append(1)
        if len(calls) < 3:
            raise urllib.error.HTTPError(req.full_url, 504, "Gateway Timeout", {}, None)
        return io.BytesIO(page(ITEMS[:2]).encode("utf-8"))

    monkeypatch.setattr(ca.urllib.request, "urlopen", flaky)
    assert len(ca.fetch_zcode("k", "11", pause=0, log=lambda *_: None, wait=0)) == 2 and len(calls) == 3

    calls.clear()
    monkeypatch.setattr(ca.urllib.request, "urlopen",
                        lambda req, timeout: (_ for _ in ()).throw(urllib.error.HTTPError(req.full_url, 504, "x", {}, None)))
    with pytest.raises(ca.ApiError, match="504.*3번 시도"):
        ca.fetch_zcode("k", "11", pause=0, log=lambda *_: None, wait=0)


def test_encoded_key_is_not_encoded_twice(monkeypatch):
    seen = []
    monkeypatch.setattr(ca.urllib.request, "urlopen",
                        lambda req, timeout: seen.append(req.full_url) or io.BytesIO(page([]).encode()))
    ca.fetch_zcode("abc%2Bdef", "41", pause=0, log=lambda *_: None)
    assert "serviceKey=abc%2Bdef&" in seen[0]


# ---------- 노선 만들기 ----------
def test_projection_on_line():
    pts = ca.HIGHWAYS["gb"]["points"]
    along, off = ca.project(pts[3], pts)
    assert off < 0.01 and abs(along - ca.line_length_km(pts[:4])) < 0.01
    assert 380 < ca.line_length_km(pts) < 460  # 경부 서울~부산 대략 길이


def test_only_highway_rest_areas_with_direction(built):
    routes, skipped = built
    assert {r["key"] for r in routes} == {"live-gb-down", "live-gb-up", "live-yd-east"}
    assert skipped["방향 모름"] == ["죽전휴게소"]
    assert skipped["고속도로에서 멂"] == ["동해휴게소(삼척방향)"]
    names = [a["name"] for r in routes for a in r["rest_areas"]]
    assert "서초구청" not in names


def test_order_and_distance_down(built):
    down = route(built[0], "live-gb-down")
    assert [a["name"] for a in down["rest_areas"]] == ["기흥휴게소", "망향휴게소", "천안삼거리휴게소"]
    kms = [a["km"] for a in down["rest_areas"]]
    assert 30 < kms[0] < 50 and kms == sorted(kms)
    assert [a["id"] for a in down["rest_areas"]] == ["live-gb-down-1", "live-gb-down-2", "live-gb-down-3"]


def test_up_direction_counts_from_busan(built):
    routes, _ = built
    down = route(routes, "live-gb-down")["rest_areas"][0]["km"]
    up = route(routes, "live-gb-up")
    assert abs(up["rest_areas"][0]["km"] - (up["length"] - down)) < 1.0


def test_chargers_grouped_and_mapped(built):
    st = route(built[0], "live-gb-down")["rest_areas"][0]["stations"]
    assert len(st) == 1 and st[0]["id"] == "ME000001" and st[0]["operator"] == "환경부"
    assert st[0]["chargers"] == [
        {"type": "fast", "power_kw": 100.0, "status": "available"},
        {"type": "fast", "power_kw": 100.0, "status": "charging"},
        {"type": "slow", "power_kw": 7.0, "status": "available"},
    ]
    assert st[0]["updated"] == NOW_MS and st[0]["price"] == ca.TARIFFS["default"]
    yd = route(built[0], "live-yd-east")["rest_areas"][0]["stations"][0]
    assert yd["chargers"][0]["status"] == "comm_error"


def test_status_codes_all_known():
    assert {ca.charger_of({"stat": c})["status"] for c in "123459"} == {
        "comm_error", "available", "charging", "out_of_service", "maintenance"}
    assert ca.charger_of({"stat": "7"})["status"] == "comm_error"  # 모르는 코드는 못 쓰는 쪽으로


def test_engine_accepts_live_route(built):
    epoch = datetime(1970, 1, 1)
    r = route(built[0], "live-gb-down")
    eng = Route(r["highway"], r["direction"], [
        RestArea(a["id"], a["name"], a["km"], [
            Station(s["id"], s["operator"], [Charger(**c) for c in s["chargers"]], s["price"],
                    epoch + timedelta(milliseconds=s["updated"])) for s in a["stations"]])
        for a in r["rest_areas"]])
    res = plan(eng, Vehicle(soc_pct=40, battery_kwh=77.4, efficiency_km_per_kwh=5.0), User(),
               epoch + timedelta(milliseconds=NOW_MS + 5 * 60000))
    rec = res.recommendation
    assert rec.primary is not None and rec.primary.station_id in {"ME000001", "EV000010"}


def test_direction_outside_parentheses_and_names():
    hw = ca.HIGHWAYS["gb"]
    assert ca.direction_of("워터 망향휴게소 부산방향", hw) == "forward"
    assert ca.direction_of("천안호두휴게소 (서울방향) (급)", hw) == "backward"
    assert ca.direction_of("벌곡휴게소", hw) is None
    assert ca.direction_of("(고속도로)양산휴게소 서울방면", hw) == "backward"
    assert ca.direction_of("망향휴게소부산방향", hw) == "forward"
    assert ca.base_name("워터 서산휴게소 목포방향") == "서산" and ca.base_name("안성휴게소 E-pit") == "안성"
    assert ca.base_name("망향휴게소부산방향") == "망향" and ca.base_name("(고속도로)언양휴게소 서울방면") == "언양"
    assert {ca.base_name(n) for n in ["망향휴게소 (부산)", "망향휴게소(부산) ", "망향(부산) 휴게소",
                                       "망향휴게소 (부산방향) (급)", "망향휴게소 부산방향"]} == {"망향"}


def test_spelling_variants_and_neighbours_merge_into_one_rest_area():
    items = [
        item("입장휴게소 (서울)", 36.900, 127.172, "ME1", "01"),
        item("입장거봉포도(서울) 휴게소", 36.905, 127.173, "PI1", "01", busi="파워큐브"),
        item("입장휴게소(서울) ", 36.900, 127.172, "ME1", "02", stat="3"),
        item("입장휴게소 (서울)", 36.900, 127.172, "SG1", "01", busi="SK시그넷 "),  # 업체 이름 끝 공백
        item("망향휴게소 (부산)", 36.951, 127.176, "ME2", "01"),
        item("망향휴게소(부산)", 36.951, 127.176, "EV2", "01", busi="에스케이일렉링크"),
        item("망향(부산) 휴게소", 36.951, 127.176, "OLD", "01", stat="4") | {"delYn": "Y"},  # 삭제된 충전기
    ]
    routes, _ = ca.build_routes(items, NOW_MS)
    up = route(routes, "live-gb-up")["rest_areas"]
    assert [a["name"] for a in up] == ["입장거봉포도휴게소"]               # 가장 긴 이름
    assert {s["id"]: len(s["chargers"]) for s in up[0]["stations"]} == {"ME1": 2, "PI1": 1, "SG1": 1}
    assert {s["operator"] for s in up[0]["stations"]} == {"환경부", "파워큐브", "SK시그넷"}
    down = route(routes, "live-gb-down")["rest_areas"]
    assert [a["name"] for a in down] == ["망향휴게소"]
    assert sorted(s["id"] for s in down[0]["stations"]) == ["EV2", "ME2"]   # 삭제된 OLD 는 빠짐


def test_far_apart_same_name_stays_separate_and_ids_stay_unique():
    items = [
        item("가휴게소(부산방향)", 37.230, 127.098, "S1", "01"),
        item("나휴게소(부산방향)", 36.788, 127.174, "S1", "01"),  # 같은 statId 가 멀리 떨어진 곳에
    ]
    down = route(ca.build_routes(items, NOW_MS)[0], "live-gb-down")["rest_areas"]
    assert len(down) == 2
    assert [s["id"] for a in down for s in a["stations"]] == ["S1", "S1-2"]


# ---------- 파일과 앱 ----------
def test_main_with_sample_writes_live_js_for_app(tmp_path, capsys):
    sample = tmp_path / "raw.json"
    sample.write_text(page(ITEMS), encoding="utf-8")
    out = tmp_path / "live.js"
    assert ca.main(["--sample", str(sample), "--out", str(out)]) == 0
    assert "기흥휴게소" in out.read_text(encoding="utf-8")
    assert "빠짐(방향 모름) 1곳" in capsys.readouterr().out
    if shutil.which("node") is None:
        pytest.skip("node 없음")
    # data.js 가 live.js 를 읽어 실제 노선을 앞에 붙이는지
    web = tmp_path / "web"
    web.mkdir()
    shutil.copy(ROOT / "web" / "data.js", web / "data.js")
    shutil.copy(out, web / "live.js")
    js = ("const d=require('./data.js');console.log(JSON.stringify([d.ROUTES[0].key,d.ROUTES[0].live,"
          "d.EXAMPLES.length,d.OPERATORS.includes('환경부'),"
          "d.toRoute(d.ROUTES[0],0).rest_areas[0].stations[0].chargers.length]))")
    got = subprocess.run(["node", "-e", js], cwd=web, capture_output=True, text=True, encoding="utf-8", check=True)
    assert json.loads(got.stdout) == ["live-gb-down", True, 3, True, 3]


def test_main_without_key_says_how(monkeypatch, tmp_path, capsys):
    monkeypatch.delenv(ca.KEY_ENV, raising=False)
    assert ca.main(["--out", str(tmp_path / "live.js")]) == 2
    assert ca.KEY_ENV in capsys.readouterr().out
    assert not (tmp_path / "live.js").exists()
