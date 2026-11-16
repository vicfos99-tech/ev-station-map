# -*- coding: utf-8 -*-
"""r5_around 지도 주변 충전소 시험 (plan.md 5절 r5_around 365~395행, 2.1 N1·N11·N13, 2.2 D1·D2·D3·D5·D11·D12, 3절 C1~C6).

꼴(라운드 2 에서 바꿈):
- 입력을 만들고 web/relay.js 를 부르는 JS 는 이 파일 안의 JS_SRC 글로 둔다(검토 대상 한 파일에 입력·기대값이 다 보이게).
  pytest 가 그 글을 임시 폴더에 써서 node 로 돌린다. JS 는 **값만** 낸다(단언 없음).
- 기대값은 모두 아래 EXPECT 표(파이썬)에 있다. 확인 이름 하나 = pytest 테스트 하나.
- JS 가 낸 이름은 배열로 받아 겹침(같은 이름 두 번)과 빠짐·남음을 따로 단언한다(test_names_unique·test_names_match).
- 비교: 기본은 열쇠 순서를 보지 않는 JSON 글자 비교(sort_keys, 참/거짓과 0/1 을 가른다).
  ORDERED 에 든 이름은 열쇠 순서까지 같은 JSON 글자여야 한다(기준 1 의 열쇠 순서).
- 값 표기: 던짐 → {"$throw": {name, code, message}}, undefined → "$undefined",
  충전소 목록 → 충전기 상태 배열(stats), direct 가 준 바로 그 배열(===) → "=direct 배열".
- 견본은 ref/relay_sample/ 을 읽기만 한다(plan.md 21행). 기대값은 참조 구현(.orchestra/logs/ref_relay/relay.js)으로 검산했다
  (.orchestra/logs/tests_r5_around.md).
- 입력은 r3 의 parse 함수를 쓰지 않고 parse 결과 모양(plan.md 308·310행)을 손으로 만든다(r5 만 시험).

갈린 판단(통과 기준 문장 밖)과 근거:
- 요금표 칸은 정확히 같은 이름만, 값 0 은 기록된 값, {} → null: D5(81행).
- 좌표는 369행 `Number(x.toFixed(5))`. 반값 [37.123455, 127.000035] → [37.12345, 127.00003] 은 Math.round(x*1e5)/1e5 와 갈린다.
- 상태 열쇠는 정확히 같을 때만, stat "02"·" 2"·""·"7" → comm_error: D3(79행), 370행.
- 30분 정각은 셈·넘으면 미확인, 미래 5분까지 셈: D1·D2(77·78행), r2 level.
- suspect 는 코드가 정확히 같을 때만, 시군구 zcodes 에 든 코드도 참: D11(87행). 결과 zcodes 는 시군구 파일의 zcodes(373행 `zcodes`).
- 글 차례 metaNote → staleNote → NOTE_SUSPECT: 373행.
- 예비 zscode "4113"·키 있음 → direct: 374행 "중계 실패(셋 중 어느 것이든 연결·404·모양·`zscode` 가 5자리가 아님):
  키와 `direct` 가 있으면 `direct()` 결과에 `note: NOTE_FALLBACK`". 기준 11 의 relay_failed 는 키 없을 때.
- AbortError·direct 가 던진 오류는 그대로 나간다: r4 342행 규칙을 374행 "r4 와 같은 예비 규칙"으로 이음.
- refreshRegion 은 region.zcodes 로 보증(376행), 실패·키 있음이면 region.stations 를 건드리지 않음(377행).
- loadRegion 의 now 없음 → Date.now(): r4 343행과 같은 규칙(C4).
"""
import collections
import json
from pathlib import Path

import pytest

from test_p0_node import run_node

HERE = Path(__file__).resolve().parent

MIN = 60000
NOW0, T_META, T_LIST, T_915 = 1767571920000, 1767571800000, 1767571200000, 1767572100000
D_AT = 1767570000000  # 가짜 direct 가 주는 fetched_at
CE = "comm_error"
FB = "중계에 연결하지 못해 직접 받았어요"
SUS = "이 지역은 충전소 목록을 확인하는 중이라 빠진 곳이 있을 수 있어요."
TAIL = ". 공공 데이터 키를 넣으면 직접 받을 수 있어요."
ANDROID = "https://vicfos99-tech.github.io/ev-station-map/relay/"
NOCACHE = {"cache": "no-cache"}

# 기준 1: 열쇠 순서까지 이대로(369행)
W1 = {"id": "ME000201", "name": "분당 지어낸 충전소", "operator": "환경부", "maker": "가나전기·마바전기", "addr": "",
      "price": 347, "loc": [37.38012, 127.11854], "updated": T_META,
      "chargers": [{"id": "01", "type": "fast", "power_kw": 50, "status": "available"},
                   {"id": "02", "type": "slow", "power_kw": 7, "status": "charging"}]}
W2 = {"id": "ME000202", "name": "판교주차장", "operator": "한국전력", "maker": "가나전기", "addr": "",
      "price": 391, "loc": [37.39471, 127.11112], "updated": T_META,
      "chargers": [{"id": "01", "type": "fast", "power_kw": 350, "status": CE}], "indoor": True}
SK = ["addr", "chargers", "id", "loc", "maker", "name", "operator", "price", "updated"]  # 충전소 열쇠 집합(indoor 뺌)
CK = ["id", "power_kw", "status", "type"]  # 충전기 열쇠 집합
KEYSETS = [[SK, [CK, CK]], [SK, [CK]]]

BASE_ST = [["available", "charging"], [CE]]  # 견본 상태 그대로
ALL_CE = [[CE, CE], [CE]]
ST_915 = [["charging", "available"], ["available"]]  # 09:14 상태 파일


def REG(note="", **kw):
    """loadRegion 켬 결과(stations 는 상태 배열)."""
    d = {"zscode": "41135", "stations": BASE_ST, "fetched_at": NOW0, "status_at": T_META, "zcodes": ["41"],
         "source": "relay", "note": note, "suspect": False}
    d.update(kw)
    return d


def DIRECT(note, **kw):
    """직접 받은 시군구(372·374행). stations 는 direct 가 준 바로 그 배열."""
    d = {"zscode": "41135", "stations": "=direct 배열", "fetched_at": D_AT, "status_at": D_AT, "zcodes": [],
         "source": "direct", "note": note, "suspect": False}
    d.update(kw)
    return d


def RERR(code, message=None):
    """RelayError 모양: RelayError 의 인스턴스, cause 없음, 글에 주소(https·a.example) 없음."""
    d = {"relay": True, "code": code, "cause": "없음", "leaks": []}
    if message is not None:
        d["message"] = message
    return d


def REFRESH(changed=0, status_at=T_META, note="", failed=False, source="relay", replaced=None):
    return {"changed": changed, "status_at": status_at, "source": source, "failed": failed, "replaced": replaced,
            "note": note}


EXPECT = {}


def E(name, want):
    assert name not in EXPECT, name
    EXPECT[name] = want


for _n in ("overlayRegion", "regionStations", "loadRegion", "refreshRegion"):
    E("내보냄 " + _n, "function")

# ---------- regionStations (369행, 기준 1~7) ----------
E("regionStations 기본 ME000201", W1)
E("regionStations 기본 ME000202", W2)
E("regionStations 기본 전체", [W1, W2])
E("regionStations indoor 없으면 칸 없음", False)
E("regionStations 새 충전소 객체", {"충전소": True, "충전기": True, "chargers 배열": True, "loc 배열": True})
# 기준 2: around.js 와 같은 모양
E("같은 모양 summary ME000201", {"free": 1, "busy": 0, "total": 1, "broken": 0, "kw": 50})
E("같은 모양 summary ME000202", {"free": 0, "busy": 0, "total": 1, "broken": 1, "kw": 350})
E("같은 모양 stationsOf 열쇠 집합", {"stationsOf": KEYSETS, "regionStations": KEYSETS})
E("같은 모양 stationsOf ME000201 값", {"stationsOf": W1, "regionStations": W1})
# 기준 3: 요금표(D5) — 통과 기준의 필수 사례는 이름으로 둔다
E("요금표 null", [None, None])
E("요금표 환경부만 default 없음", [347, None])
E("요금표 undefined", [None, None])
E("요금표 default 만", [391, 391])
E("요금표 환경부 0", [0, 391])
E("요금표 한국전력만 따로", [391, 280])
E("요금표 default 0", [0, 0])
E("요금표 빈 객체", [None, None])
E("요금표 칸 이름 뒤 빈칸", [391, 391])
E("요금표 tariffs 칸 없음", [None, None])
# 기준 4: 보증(N1)
E("보증 없음 updated", [T_LIST, T_LIST])
E("보증 없음 지금은 셈", [1, 0])
E("보증 없음 31분", [[0, 1], [0, 1]])
E("보증 없음 30분 정각", [1, 0])
E("meta ok false updated", [T_LIST, T_LIST])
E("meta null updated", [T_LIST, T_LIST])
E("zcodes 하나 모자람 updated", [T_LIST, T_LIST])
E("zcodes 빈 배열 updated", [T_LIST, T_LIST])
E("보증 있음 31분", [0, 0])
E("보증 있음 30분 정각", [1, 0])
E("보증 있음 30분 1밀리초 상태", ALL_CE)
E("파일 at 이 meta 보다 늦음", [T_915, T_915])
E("앞선 시각 5분", BASE_ST)
E("앞선 시각 5분 넘음", ALL_CE)
# 기준 5: 상태 파일에 없는 충전기
E("상태에 ME000201 없음", {"stats": ALL_CE, "free": 0, "broken": 1})
E("ME000202 를 2 로", 1)
E("충전기 하나만 없음", [["available", CE], [CE]])
E("충전기 id 1 은 01 이 아님", ALL_CE)
E("충전소 id 소문자는 다름", BASE_ST)
# 기준 6: 급속 없는 충전소·좌표
E("급속 없는 충전소 빠짐", ["ME000201"])
E("완속뿐인 충전소가 앞", ["ME000202"])
E("급속이 뒤 충전기", ["ME000201", "ME000202"])
E("좌표 기준 37.123456", [37.12346, 127.65432])
E("좌표 견본 그대로", [37.38012, 127.11854])
E("좌표 129.000001", [35.1, 129])
E("좌표 남반구 음수", [-33.12345, -70.98766])
E("좌표 반값 toFixed", [37.12345, 127.00003])  # Math.round(x*1e5)/1e5 면 [37.12346, 127.00004]
E("빈 목록", [])
E("넣은 순서 그대로", ["ME000202", "ME000201"])
E("이름·업체·제조사 그대로", ["<b>새</b>", "알 수 없음", "", ""])
E("power_kw 는 kw", 99.5)
# 기준 7: 입력을 고치지 않는다(C5)
E("regionStations 입력 그대로", {"stDoc": True, "statusDoc": True, "meta": True})
E("regionStations 얼린 입력", 2)

# ---------- overlayRegion (370행, 기준 8) ----------
E("overlay 3", 3)
E("overlay 상태", ST_915)
E("overlay updated", [T_915, T_915])
E("overlay 한 번 더", 0)
E("overlay s 빈 객체", [2, ALL_CE])
E("overlay 30분 1밀리초", [2, ALL_CE])
E("overlay 30분 정각", [3, ST_915])
E("overlay t null", [2, ALL_CE, [None, None]])
E("overlay 없는 충전소도 updated", [0, [T_915, T_915]])
E("overlay 빈 목록", 0)
E("overlay 같은 배열·객체", [True, True, 2])
# D3: stat → 상태. 바뀐 수 = available 이 아닌 것 10
E("overlay stat 표", [10, [["1", CE], ["2", "available"], ["3", "charging"], ["4", "out_of_service"],
                          ["5", "maintenance"], ["9", CE], ["7", CE], ["", CE], ["02", CE], [" 2", CE], ["2 ", CE]]])

# ---------- loadRegion 켬 (373행, 기준 9) ----------
E("켬 부른 주소", {"수": 3, "첫째": "meta.json", "나머지": ["stations/41135.json", "status/41135.json"]})
E("켬 fetch 둘째 인자", [NOCACHE, NOCACHE, NOCACHE])
E("켬 결과", REG(stations="(켬 stations 에서 봄)"))
E("켬 stations", [W1, W2])
E("켬 direct 0번", 0)
# 기준 10: suspect·meta 실패·오래됨(결과 전체, stations 는 상태 배열)
E("suspect 41", REG(SUS, suspect=True))
E("suspect 견본 29", REG())
# zcodes ["11"] 은 fresh ["41"] 에 없어 보증 없음 → status_at 이 파일 at. 결과 zcodes 는 파일의 ["11"]
E("suspect zcodes 로", REG(SUS, suspect=True, zcodes=["11"], status_at=T_LIST))
E("suspect 부분 일치 아님", REG())
E("meta 실패 한도", REG("중계가 마지막 받기에 실패했어요(한도 넘음).", status_at=T_LIST))
E("18분", REG("18분 전 상태예요.", fetched_at=T_META + 18 * MIN))
E("15분 정각", REG("", fetched_at=T_META + 15 * MIN))
E("40분", REG("40분 전 상태라 빈자리를 세지 않았어요.", fetched_at=T_META + 40 * MIN, stations=ALL_CE))
E("글 셋 잇기", REG("중계가 마지막 받기에 실패했어요(한도 넘음). 18분 전 상태예요. " + SUS, suspect=True,
                   status_at=T_LIST, fetched_at=T_LIST + 18 * MIN))
E("tariffs 전달", [347, None])
E("tariffs 없음", [None, None])
E("now 없음", {"fetched_at 이 지금 5분 안": True, "stats": ALL_CE})
# 기준 11: 예비(키 있음) — stations 404 는 결과·같은 배열·direct 수를 따로 본다
E("예비 stations 404 결과", DIRECT(FB))
E("예비 stations 404 같은 배열", True)
E("예비 stations 404 direct 1번", 1)
E("예비 stations 404 부른 주소에 meta 첫째", "meta.json")
for _n in ("meta 404", "status 503", "status 깨짐", "meta v2", "다른 시군구 파일", "meta 연결 실패"):
    E("예비 " + _n, {"결과": DIRECT(FB), "direct": 1})
E("예비 zscode 4자리", {"결과": DIRECT(FB, zscode="4113"), "direct": 1})  # 374행(docstring)
# 예비 없음(키 없음·direct 없음) → relay_failed, direct 0번
for _n, _m in (("status 404", "중계에 파일이 없어요"), ("stations 404", "중계에 파일이 없어요"),
               ("meta 연결 실패", "중계에 연결하지 못했어요"), ("zscode 4자리", "중계 파일 이름이 맞지 않아요"),
               ("zscode 숫자", "중계 파일 이름이 맞지 않아요"), ("다른 시군구 파일", "중계 파일을 읽지 못했어요"),
               ("status 500", "중계가 500 로 답했어요"), ("direct null", "중계에 파일이 없어요"),
               ("키 빈 글", "중계에 파일이 없어요")):
    E("예비 없음 " + _n, {"오류": RERR("relay_failed", _m + TAIL), "direct": 0})
E("meta 연결 실패 부른 주소", ["meta.json"])
E("기본 주소 안드로이드", ANDROID + "meta.json")
E("settings 없음", "https://me.example/ev/relay/meta.json")
E("AbortError 그대로", {"같은 오류": True, "direct": 0})
# 기준 12: 끔(372행, C1)
E("끔 키 있음", {"결과": DIRECT(""), "fetch": 0, "direct": 1})
E("끔 키 없음", {"오류": RERR("no_key"), "fetch": 0, "direct": 0})
E("끔 direct 없음", {"오류": RERR("no_direct"), "fetch": 0})
E("direct 오류 그대로 끔", True)
E("direct 오류 그대로 예비", True)

# ---------- refreshRegion (375~378행, 기준 13~15) ----------
E("refresh 부른 주소", ["meta.json", "status/41135.json"])
E("refresh 같은 파일", {"결과": REFRESH(), "direct": 0})
E("refresh fetch 둘째 인자", [NOCACHE, NOCACHE])
E("refresh 바뀜 결과", REFRESH(changed=3, status_at=T_915))
E("refresh 바뀜 상태", {"stats": ST_915, "같은 배열": True})
E("refresh 바뀜 updated", [T_915, T_915])
E("refresh s 빈 객체", {"결과": REFRESH(changed=2), "stats": ALL_CE})
E("refresh 18분", REFRESH(note="18분 전 상태예요."))
E("refresh meta 실패", REFRESH(status_at=T_LIST, note="중계가 마지막 받기에 실패했어요(한도 넘음)."))
E("refresh region.zcodes", {"status_at": T_LIST, "updated": [T_LIST, T_LIST]})
# 기준 14: 실패·키 없음 — 던지지 않는다
E("refresh 실패 키 없음", {"결과": REFRESH(failed=True, note="중계에 파일이 없어요."), "direct": 0})
E("refresh 실패 상태 그대로", {"stats": BASE_ST, "같은 배열": True, "글자 그대로": True})
E("refresh 실패 31분", REFRESH(changed=1, failed=True, note="중계에 파일이 없어요. 31분 전 상태라 빈자리를 세지 않았어요."))
E("refresh 실패 31분 상태", ALL_CE)
for _n, _note in (("깨진 상태", "중계 파일을 읽지 못했어요."), ("연결 실패", "중계에 연결하지 못했어요."),
                  ("상태 503", "중계가 503 로 답했어요."), ("상태 404", "중계에 파일이 없어요."),
                  ("zscode 틀림", "중계 파일 이름이 맞지 않아요."), ("direct null", "중계에 파일이 없어요.")):
    E("refresh 실패 " + _n, {"결과": REFRESH(failed=True, note=_note), "direct": 0})
# 기준 15: 실패·키 있음
E("refresh 키 있음 결과", REFRESH(status_at=None, source="direct", failed=True, note=FB, replaced=DIRECT(FB)))
E("refresh 키 있음 replaced 같은 배열", True)
E("refresh 키 있음 region 그대로", {"stats": BASE_ST, "같은 배열": True, "글자 그대로": True})
E("refresh 키 있음 direct 1번", 1)
E("refresh 키 있음 31분 그대로", {"같은 배열": True, "글자 그대로": True, "changed": 0})
E("refresh direct 오류 그대로", True)
E("refresh AbortError 그대로", {"같은 오류": True, "direct": 0})

# 열쇠 순서까지 보는 이름(기준 1)
ORDERED = {"regionStations 기본 ME000201", "regionStations 기본 ME000202", "regionStations 기본 전체",
           "같은 모양 stationsOf ME000201 값", "켬 stations"}


JS_SRC = r'''
"use strict";
const path = require("path");
const fs = require("fs");
const T = require(path.join(HERE, "test_p0_fake.js"));
const ROOT = path.join(HERE, "..");
let R = null, loadErr = "";
try { R = require(path.join(ROOT, "web", "relay.js")); } catch (e) { loadErr = String(e && e.message).slice(0, 200); }
let AROUND = null;
try { AROUND = require(path.join(ROOT, "web", "around.js")); } catch (e) { AROUND = null; }

const MIN = 60000;
const NOW0 = 1767571920000, T_META = 1767571800000, T_LIST = 1767571200000, T_915 = 1767572100000;
const B = "https://a.example/relay/";
const CE = "comm_error";
const TARIFF = { default: 391, "환경부": 347 };
const RAW = {};
for (const p of ["meta.json", "stations/41135.json", "status/41135.json", "stations/41463.json"]) RAW[p] = fs.readFileSync(path.join(ROOT, "ref", "relay_sample", p), "utf8");
const SAMPLE = (p) => JSON.parse(RAW[p]);
const META = () => SAMPLE("meta.json");
const ST = () => SAMPLE("stations/41135.json");
const STA = () => SAMPLE("status/41135.json");

// ---- 값 내기(단언 없음). 기대값은 파이썬 EXPECT 에 있다 ----
const OUT = [];
const rep = (k, v) => (v === undefined ? "$undefined" : typeof v === "function" ? "$function" : typeof v === "symbol" ? "$symbol"
  : typeof v === "number" && !Number.isFinite(v) ? "$" + String(v) : v);
function enc(x) { const s = JSON.stringify(x, rep); return s === undefined ? "$undefined" : JSON.parse(s); }
const errOf = (e) => ({ $throw: { name: e && e.name, code: e && e.code, message: e && e.message } });
function put(name, f) { let v; try { v = enc(f()); } catch (e) { v = errOf(e); } OUT.push([name, v]); }

function fn(n) {
  if (!R || typeof R[n] !== "function") throw new Error(`relay.js 에 ${n} 함수가 없음 ${loadErr}`);
  return R[n];
}
function errText(e) {
  if (!e || typeof e !== "object") return String(e);
  const own = Object.getOwnPropertyNames(e).map((k) => (typeof e[k] === "string" ? e[k] : ""));
  return [e.message, e.stack, String(e), ...own].join("\n");
}
// RelayError 모양. withMsg 가 참이면 message 도 낸다
function relayErr(e, withMsg) {
  if (!e) return "던지지 않음";
  const RE = R && R.RelayError, t = errText(e);
  const o = { relay: typeof RE === "function" && e instanceof RE, code: e.code, cause: e.cause === undefined ? "없음" : "있음",
    leaks: ["https", "a.example"].filter((s) => t.includes(s)) };
  if (withMsg) o.message = e.message;
  return o;
}
function deepFreeze(o) { if (o && typeof o === "object") { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; }
// parse… 결과 모양(plan.md 308·310행)
const PST = (doc) => ({ v: 1, zscode: doc.zscode, zcodes: doc.zcodes, stations: doc.stations.map((s) => Object.assign({ id: s.id, name: s.name, operator: s.operator, maker: s.maker, loc: s.loc, chargers: s.chargers.map((c) => ({ id: c.id, type: c.type, kw: c.kw })) }, s.indoor === true ? { indoor: true } : {})) });
const PSA = (doc) => { const s = Object.create(null); for (const [k, v] of Object.entries(doc.s)) { s[k] = Object.create(null); for (const [c, a] of Object.entries(v)) s[k][c] = Array.isArray(a) ? a[0] : a; } return { at: doc.at, s }; };
const PMETA = (m) => ({ v: 1, at: m.at, ok: m.ok, error: m.error || "", suspect: m.suspect || [], fresh: m.fresh || [] });
const STD = () => PST(ST()), STS = () => PSA(STA()), MT = (x) => PMETA(Object.assign(META(), x || {}));
const RS = (o, stDoc, staDoc, meta) => fn("regionStations")(stDoc || STD(), staDoc || STS(), meta === undefined ? MT() : meta, Object.assign({ now: NOW0, tariffs: TARIFF }, o || {}));
const byId = (list, id) => (list || []).find((s) => s && s.id === id);
const stats = (list) => list.map((s) => s.chargers.map((c) => c.status));
const SUM = (st) => AROUND.summary(st);

for (const n of ["overlayRegion", "regionStations", "loadRegion", "refreshRegion"]) put(`내보냄 ${n}`, () => (R ? typeof R[n] : "relay.js 못 읽음 " + loadErr));

// ---------- regionStations (369행, 기준 1~7) ----------
put("regionStations 기본 ME000201", () => byId(RS(), "ME000201"));
put("regionStations 기본 ME000202", () => byId(RS(), "ME000202"));
put("regionStations 기본 전체", () => RS());
put("regionStations indoor 없으면 칸 없음", () => "indoor" in byId(RS(), "ME000201"));
put("regionStations 새 충전소 객체", () => { const d = STD(), r = RS({}, d); return { "충전소": r[0] !== d.stations[0], "충전기": r[0].chargers[0] !== d.stations[0].chargers[0], "chargers 배열": r[0].chargers !== d.stations[0].chargers, "loc 배열": r[0].loc !== d.stations[0].loc }; });
put("같은 모양 summary ME000201", () => SUM(byId(RS(), "ME000201")));
put("같은 모양 summary ME000202", () => SUM(byId(RS(), "ME000202")));
// 같은 내용의 공공 데이터 항목(제조사 둘)으로 EvAround.stationsOf 가 만든 충전소
const CFG = { slow_types: ["02", "07"], default_kw: { fast: 50, slow: 7 }, status: { "1": CE, "2": "available", "3": "charging", "4": "out_of_service", "5": "maintenance", "9": CE }, tariffs: TARIFF };
const ITEMS = [
  { statId: "ME000201", statNm: "분당 지어낸 충전소", busiNm: "환경부", maker: "가나전기", lat: "37.38012", lng: "127.11854", chgerId: "01", chgerType: "01", output: "50", stat: "2" },
  { statId: "ME000201", statNm: "분당 지어낸 충전소", busiNm: "환경부", maker: "마바전기", lat: "37.38012", lng: "127.11854", chgerId: "02", chgerType: "02", output: "7", stat: "3" },
  { statId: "ME000202", statNm: "판교주차장", busiNm: "한국전력", maker: "가나전기", lat: "37.39471", lng: "127.11112", chgerId: "01", chgerType: "01", output: "350", stat: "9" },
];
const keysets = (list) => list.map((s) => { const x = Object.assign({}, s); delete x.indoor; return [Object.keys(x).sort(), s.chargers.map((c) => Object.keys(c).sort())]; });
put("같은 모양 stationsOf 열쇠 집합", () => ({ stationsOf: keysets(AROUND.stationsOf(ITEMS, CFG, T_META)), regionStations: keysets(RS()) }));
put("같은 모양 stationsOf ME000201 값", () => ({ stationsOf: AROUND.stationsOf(ITEMS, CFG, T_META)[0], regionStations: byId(RS(), "ME000201") }));
// 기준 3: 요금표(D5)
const prices = (tr) => RS({ tariffs: tr }).map((s) => s.price);
put("요금표 null", () => prices(null));
put("요금표 환경부만 default 없음", () => prices({ "환경부": 347 }));
put("요금표 undefined", () => prices(undefined));
put("요금표 default 만", () => prices({ default: 391 }));
put("요금표 환경부 0", () => prices({ default: 391, "환경부": 0 }));
put("요금표 한국전력만 따로", () => prices({ default: 391, "한국전력": 280 }));
put("요금표 default 0", () => prices({ default: 0 }));
put("요금표 빈 객체", () => prices({}));
put("요금표 칸 이름 뒤 빈칸", () => prices({ default: 391, "환경부 ": 1 }));
put("요금표 tariffs 칸 없음", () => fn("regionStations")(STD(), STS(), MT(), { now: NOW0 }).map((s) => s.price));
// 기준 4: 보증(N1)
const F0 = () => MT({ fresh: [] });
put("보증 없음 updated", () => RS({}, null, null, F0()).map((s) => s.updated));
put("보증 없음 지금은 셈", () => RS({}, null, null, F0()).map((s) => SUM(s).free));
put("보증 없음 31분", () => RS({ now: T_LIST + 31 * MIN }, null, null, F0()).map((s) => [SUM(s).free, SUM(s).broken]));
put("보증 없음 30분 정각", () => RS({ now: T_LIST + 30 * MIN }, null, null, F0()).map((s) => SUM(s).free));
put("meta ok false updated", () => RS({}, null, null, MT({ ok: false })).map((s) => s.updated));
put("meta null updated", () => RS({}, null, null, null).map((s) => s.updated));
put("zcodes 하나 모자람 updated", () => { const d = STD(); d.zcodes = ["41", "11"]; return RS({}, d).map((s) => s.updated); });
put("zcodes 빈 배열 updated", () => { const d = STD(); d.zcodes = []; return RS({}, d).map((s) => s.updated); });
put("보증 있음 31분", () => RS({ now: T_META + 31 * MIN }).map((s) => SUM(s).free));
put("보증 있음 30분 정각", () => RS({ now: T_META + 30 * MIN }).map((s) => SUM(s).free));
put("보증 있음 30분 1밀리초 상태", () => stats(RS({ now: T_META + 30 * MIN + 1 })));
put("파일 at 이 meta 보다 늦음", () => { const s = STS(); s.at = "20260105091500"; return RS({}, null, s).map((x) => x.updated); });
put("앞선 시각 5분", () => stats(RS({ now: T_META - 5 * MIN })));
put("앞선 시각 5분 넘음", () => stats(RS({ now: T_META - 5 * MIN - 1 })));
// 기준 5: 상태 파일에 없는 충전기
const SDROP = (f) => { const s = STS(); f(s.s); return s; };
put("상태에 ME000201 없음", () => { const r = RS({}, null, SDROP((s) => { delete s.ME000201; })); return { stats: stats(r), free: SUM(r[0]).free, broken: SUM(r[0]).broken }; });
put("ME000202 를 2 로", () => SUM(byId(RS({}, null, SDROP((s) => { s.ME000202["01"] = "2"; })), "ME000202")).free);
put("충전기 하나만 없음", () => stats(RS({}, null, SDROP((s) => { delete s.ME000201["02"]; }))));
put("충전기 id 1 은 01 이 아님", () => stats(RS({}, null, SDROP((s) => { s.ME000201 = Object.assign(Object.create(null), { "1": "2", "2": "3" }); }))));
put("충전소 id 소문자는 다름", () => stats(RS({}, null, SDROP((s) => { delete s.ME000202; s.me000202 = Object.assign(Object.create(null), { "01": "2" }); }))));
// 기준 6: 급속 없는 충전소·좌표
put("급속 없는 충전소 빠짐", () => { const d = STD(); d.stations[1].chargers[0].type = "slow"; return RS({}, d).map((s) => s.id); });
put("완속뿐인 충전소가 앞", () => { const d = STD(); d.stations[0].chargers.forEach((c) => { c.type = "slow"; }); return RS({}, d).map((s) => s.id); });
put("급속이 뒤 충전기", () => { const d = STD(); d.stations[0].chargers.reverse(); d.stations[0].chargers[0].type = "slow"; d.stations[0].chargers[1].type = "fast"; return RS({}, d).map((s) => s.id); });
const locOf = (loc) => { const d = STD(); d.stations[0].loc = loc; return RS({}, d)[0].loc; };
put("좌표 기준 37.123456", () => locOf([37.123456, 127.654321]));
put("좌표 견본 그대로", () => locOf([37.38012, 127.11854]));
put("좌표 129.000001", () => locOf([35.1, 129.000001]));
put("좌표 남반구 음수", () => locOf([-33.123454, -70.987656]));
put("좌표 반값 toFixed", () => locOf([37.123455, 127.000035]));
put("빈 목록", () => { const d = STD(); d.stations = []; return RS({}, d); });
put("넣은 순서 그대로", () => { const d = STD(); d.stations.reverse(); return RS({}, d).map((s) => s.id); });
put("이름·업체·제조사 그대로", () => { const d = STD(); Object.assign(d.stations[0], { name: "<b>새</b>", operator: "알 수 없음", maker: "" }); const s = RS({}, d)[0]; return [s.name, s.operator, s.maker, s.addr]; });
put("power_kw 는 kw", () => { const d = STD(); d.stations[1].chargers[0].kw = 99.5; return RS({}, d)[1].chargers[0].power_kw; });
// 기준 7: 입력을 고치지 않는다(C5). 미리 글자로 떠 두고 견준다
put("regionStations 입력 그대로", () => {
  const d = STD(), s = STS(), m = MT();
  const a = [JSON.stringify(d), JSON.stringify([s.at, s.s]), JSON.stringify(m)];
  RS({ now: T_META + 99 * MIN }, d, s, m);
  return { stDoc: JSON.stringify(d) === a[0], statusDoc: JSON.stringify([s.at, s.s]) === a[1] && JSON.stringify(s.s) === JSON.stringify(STS().s), meta: JSON.stringify(m) === a[2] };
});
put("regionStations 얼린 입력", () => RS({}, deepFreeze(STD()), deepFreeze(STS()), deepFreeze(MT())).length);

// ---------- overlayRegion (370행, 기준 8) ----------
const OV = (list, doc, t, now) => fn("overlayRegion")(list, doc, t, now);
const DOC8 = () => PSA({ at: "20260105091400", s: { ME000201: { "01": "3", "02": "2" }, ME000202: { "01": "2" } } });
{
  let L = null;
  put("overlay 3", () => { L = RS(); return OV(L, DOC8(), T_915, NOW0 + 3 * MIN); });
  put("overlay 상태", () => stats(L));
  put("overlay updated", () => L.map((s) => s.updated));
  put("overlay 한 번 더", () => OV(L, DOC8(), T_915, NOW0 + 3 * MIN));
}
put("overlay s 빈 객체", () => { const L = RS(); return [OV(L, { at: "x", s: Object.create(null) }, T_META, NOW0), stats(L)]; });
put("overlay 30분 1밀리초", () => { const L = RS(); return [OV(L, STS(), T_META, T_META + 30 * MIN + 1), stats(L)]; });
put("overlay 30분 정각", () => { const L = RS(); return [OV(L, DOC8(), T_META, T_META + 30 * MIN), stats(L)]; });
put("overlay t null", () => { const L = RS(); return [OV(L, DOC8(), null, NOW0), stats(L), L.map((s) => s.updated)]; });
put("overlay 없는 충전소도 updated", () => { const L = RS(); const d = PSA({ at: "x", s: { ME000201: { "01": "2", "02": "3" } } }); return [OV(L, d, T_915, NOW0), L.map((s) => s.updated)]; });
put("overlay 빈 목록", () => OV([], DOC8(), T_META, NOW0));
put("overlay 같은 배열·객체", () => { const L = RS(), a = L[0], c = L[0].chargers[0]; OV(L, DOC8(), T_915, NOW0); return [L[0] === a, L[0].chargers[0] === c, L.length]; });
// D3: stat → 상태. 충전기는 모두 available 에서 시작
const D3 = ["1", "2", "3", "4", "5", "9", "7", "", "02", " 2", "2 "];
put("overlay stat 표", () => {
  const L = [{ id: "X", updated: 0, chargers: D3.map((_, i) => ({ id: String(i), type: "fast", power_kw: 50, status: "available" })) }];
  const s = Object.create(null); s.X = Object.create(null); D3.forEach((st, i) => { s.X[String(i)] = st; });
  const n = OV(L, { at: "x", s }, T_META, NOW0);
  return [n, L[0].chargers.map((c, i) => [D3[i], c.status])];
});

// ---------- loadRegion·refreshRegion (371~378행, 기준 9~15) ----------
function files(fx) { return Object.assign({ "meta.json": META(), "stations/41135.json": ST(), "status/41135.json": STA() }, fx || {}); }
function setup(fx, extra) {
  const f = T.makeFetch(files(fx), { base: B });
  const D = { n: 0, arr: [{ id: "D1" }], fetched_at: 1767570000000 };
  const o = Object.assign({ settings: { on: true, base: B }, href: "https://x.example/p/", fetch: f, now: NOW0, key: "", zscode: "41135", tariffs: TARIFF,
    direct: async () => { D.n += 1; return { stations: D.arr, fetched_at: D.fetched_at }; } }, extra || {});
  return { f, D, o };
}
async function call(name, o) { const out = { res: undefined, err: undefined }; try { out.res = await fn(name)(o); } catch (e) { out.err = e; } return out; }
const LR = (o) => call("loadRegion", o), RR = (o) => call("refreshRegion", o);
const rel = (f) => f.calls().map((u) => (u.startsWith(B) ? u.slice(B.length) : u));
// 시군구 결과 보기: stations 는 상태 배열, direct 가 준 바로 그 배열이면 "=direct 배열"
const regView = (r, D) => Object.assign({}, r, { stations: D && r.stations === D.arr ? "=direct 배열" : stats(r.stations) });
const view = (x, D) => (x.err ? errOf(x.err) : regView(x.res, D));
const rview = (x, D) => (x.err ? errOf(x.err) : Object.assign({}, x.res, { replaced: x.res.replaced ? regView(x.res.replaced, D) : x.res.replaced }));
const META915 = () => Object.assign(META(), { at: "20260105091500" });
const STA914 = () => ({ at: "20260105091400", s: { ME000201: { "01": ["3"], "02": ["2"] }, ME000202: { "01": ["2"] } } });

async function asyncPart() {
  const L1 = async (fx, extra) => { const s = setup(fx, extra); s.x = await LR(s.o); return s; };
  // 기준 9: 켬
  {
    const { f, D, x } = await L1();
    put("켬 부른 주소", () => { const c = rel(f); return { "수": c.length, "첫째": c[0], "나머지": c.slice(1).sort() }; });
    put("켬 fetch 둘째 인자", () => f.inits());
    put("켬 결과", () => (x.err ? errOf(x.err) : Object.assign({}, x.res, { stations: "(켬 stations 에서 봄)" })));
    put("켬 stations", () => (x.err ? errOf(x.err) : x.res.stations));
    put("켬 direct 0번", () => D.n);
  }
  // 기준 10: suspect·meta 실패·오래됨
  const LOADS = [
    ["suspect 41", { "meta.json": Object.assign(META(), { suspect: ["41"] }) }, null],
    ["suspect 견본 29", null, null],
    ["suspect zcodes 로", { "meta.json": Object.assign(META(), { suspect: ["11"] }), "stations/41135.json": Object.assign(ST(), { zcodes: ["11"] }) }, null],
    ["suspect 부분 일치 아님", { "meta.json": Object.assign(META(), { suspect: ["4", "411", "41135", " 41"] }) }, null],
    ["meta 실패 한도", { "meta.json": Object.assign(META(), { ok: false, error: "한도 넘음" }) }, null],
    ["18분", null, { now: T_META + 18 * MIN }],
    ["15분 정각", null, { now: T_META + 15 * MIN }],
    ["40분", null, { now: T_META + 40 * MIN }],
    ["글 셋 잇기", { "meta.json": Object.assign(META(), { ok: false, error: "한도 넘음", suspect: ["41"] }) }, { now: T_LIST + 18 * MIN }],
  ];
  for (const [name, fx, extra] of LOADS) {
    const { x } = await L1(fx, extra);
    put(name, () => view(x));
  }
  {
    const z = (await L1(null, { tariffs: { "환경부": 347 } })).x;
    put("tariffs 전달", () => z.res.stations.map((s) => s.price));
    const w = (await L1(null, { tariffs: undefined })).x;
    put("tariffs 없음", () => w.res.stations.map((s) => s.price));
    const n = (await L1(null, { now: undefined })).x, t0 = Date.now();
    put("now 없음", () => ({ "fetched_at 이 지금 5분 안": Math.abs(n.res.fetched_at - t0) < 5 * MIN, stats: stats(n.res.stations) }));
  }
  // 기준 11: 예비(키 있음)
  {
    const { f, D, x } = await L1({ "stations/41135.json": 404 }, { key: "K" });
    put("예비 stations 404 결과", () => view(x, D));
    put("예비 stations 404 같은 배열", () => x.res.stations === D.arr);
    put("예비 stations 404 direct 1번", () => D.n);
    put("예비 stations 404 부른 주소에 meta 첫째", () => rel(f)[0]);
  }
  const FALL = [
    ["meta 404", { "meta.json": 404 }], ["status 503", { "status/41135.json": 503 }],
    ["status 깨짐", { "status/41135.json": "{" }], ["meta v2", { "meta.json": Object.assign(META(), { v: 2 }) }],
    ["다른 시군구 파일", { "stations/41135.json": SAMPLE("stations/41463.json") }], ["meta 연결 실패", { "meta.json": T.DOWN }],
  ];
  for (const [name, fx] of FALL) {
    const { D, x } = await L1(fx, { key: "K" });
    put("예비 " + name, () => ({ "결과": view(x, D), direct: D.n }));
  }
  {
    const { D, x } = await L1(null, { key: "K", zscode: "4113" });
    put("예비 zscode 4자리", () => ({ "결과": view(x, D), direct: D.n }));
  }
  // 예비 없음
  const NOFB = [
    ["status 404", { "status/41135.json": 404 }, {}], ["stations 404", { "stations/41135.json": 404 }, {}],
    ["meta 연결 실패", { "meta.json": T.DOWN }, {}], ["zscode 4자리", null, { zscode: "4113" }],
    ["zscode 숫자", null, { zscode: 41135 }], ["다른 시군구 파일", { "stations/41135.json": SAMPLE("stations/41463.json") }, {}],
    ["status 500", { "status/41135.json": 500 }, {}], ["direct null", { "meta.json": 404 }, { key: "K", direct: null }],
    ["키 빈 글", { "meta.json": 404 }, { key: "" }],
  ];
  for (const [name, fx, extra] of NOFB) {
    const { D, x } = await L1(fx, extra);
    put("예비 없음 " + name, () => ({ "오류": x.err ? relayErr(x.err, true) : { "던지지 않음": view(x, D) }, direct: D.n }));
  }
  {
    const { f } = await L1({ "meta.json": T.DOWN });
    put("meta 연결 실패 부른 주소", () => rel(f));
    const g = await L1(null, { settings: { on: true, base: "" }, href: "file:///android_asset/index.html" });
    put("기본 주소 안드로이드", () => g.f.calls()[0]);
    const h = await L1(null, { settings: undefined, href: "https://me.example/ev/index.html" });
    put("settings 없음", () => h.f.calls()[0]);
    const ab = new Error("멈춤"); ab.name = "AbortError";
    const k = await L1({ "stations/41135.json": () => { throw ab; } }, { key: "K" });
    put("AbortError 그대로", () => ({ "같은 오류": k.x.err === ab, direct: k.D.n }));
  }
  // 기준 12: 끔(C1)
  {
    const OFF = { on: false, base: B };
    const a = await L1(null, { settings: OFF, key: "K" });
    put("끔 키 있음", () => ({ "결과": view(a.x, a.D), fetch: a.f.calls().length, direct: a.D.n }));
    const y = await L1(null, { settings: OFF, key: "" });
    put("끔 키 없음", () => ({ "오류": y.x.err ? relayErr(y.x.err, false) : { "던지지 않음": view(y.x) }, fetch: y.f.calls().length, direct: y.D.n }));
    const z = await L1(null, { settings: OFF, key: "K", direct: undefined });
    put("끔 direct 없음", () => ({ "오류": z.x.err ? relayErr(z.x.err, false) : { "던지지 않음": view(z.x) }, fetch: z.f.calls().length }));
    const X = new Error("직접 실패"); X.code = "X";
    const thrower = async () => { throw X; };
    const p = await L1(null, { settings: OFF, key: "K", direct: thrower });
    put("direct 오류 그대로 끔", () => p.x.err === X);
    const q = await L1({ "meta.json": 404 }, { key: "K", direct: thrower });
    put("direct 오류 그대로 예비", () => q.x.err === X);
  }
  // 기준 13~15: refreshRegion. region 은 기준 9 로 받은 것
  async function R2(fx, extra, now) {
    const s0 = await L1();
    // loadRegion 이 없거나 실패해도 이름은 모두 나오게 빈 시군구로 이어 간다
    const region = s0.x.res || { stations: [], zcodes: [], status_at: null };
    const s = setup(fx, Object.assign({ region, now: now === undefined ? NOW0 + 3 * MIN : now }, extra || {}));
    const before = JSON.stringify(region.stations), arr = region.stations;
    s.x = await RR(s.o);
    return Object.assign(s, { region, before, arr });
  }
  const kept = (s) => ({ stats: stats(s.region.stations), "같은 배열": s.region.stations === s.arr, "글자 그대로": JSON.stringify(s.region.stations) === s.before });
  {
    const { f, x, D } = await R2();
    put("refresh 부른 주소", () => rel(f));
    put("refresh 같은 파일", () => ({ "결과": rview(x, D), direct: D.n }));
    put("refresh fetch 둘째 인자", () => f.inits());
  }
  {
    const { x, region, arr } = await R2({ "meta.json": META915(), "status/41135.json": STA914() });
    put("refresh 바뀜 결과", () => rview(x));
    put("refresh 바뀜 상태", () => ({ stats: stats(region.stations), "같은 배열": region.stations === arr }));
    put("refresh 바뀜 updated", () => region.stations.map((s) => s.updated));
  }
  {
    const { x, region } = await R2({ "status/41135.json": { at: "20260105090000", s: {} } });
    put("refresh s 빈 객체", () => ({ "결과": rview(x), stats: stats(region.stations) }));
  }
  {
    const { x } = await R2(null, null, T_META + 18 * MIN);
    put("refresh 18분", () => rview(x));
    const y = (await R2({ "meta.json": Object.assign(META(), { ok: false, error: "한도 넘음" }) })).x;
    put("refresh meta 실패", () => rview(y));
  }
  {
    // region.zcodes 로 보증을 본다(376행)
    const s0 = await L1();
    const region = Object.assign({ stations: [] }, s0.x.res, { zcodes: ["11"] });
    const s = setup(null, { region, now: NOW0 + 3 * MIN });
    const x = await RR(s.o);
    put("refresh region.zcodes", () => ({ status_at: x.err ? errOf(x.err) : x.res.status_at, updated: region.stations.map((st) => st.updated) }));
  }
  // 기준 14: 실패·키 없음
  {
    const s = await R2({ "meta.json": 404 });
    put("refresh 실패 키 없음", () => ({ "결과": rview(s.x, s.D), direct: s.D.n }));
    put("refresh 실패 상태 그대로", () => kept(s));
  }
  {
    const { x, region } = await R2({ "meta.json": 404 }, null, T_META + 31 * MIN);
    put("refresh 실패 31분", () => rview(x));
    put("refresh 실패 31분 상태", () => stats(region.stations));
  }
  const RFAIL = [
    ["깨진 상태", { "status/41135.json": "{" }, {}], ["연결 실패", { "meta.json": T.DOWN }, {}],
    ["상태 503", { "status/41135.json": 503 }, {}], ["상태 404", { "status/41135.json": 404 }, {}],
    ["zscode 틀림", null, { zscode: "4113" }], ["direct null", { "meta.json": 404 }, { key: "K", direct: null }],
  ];
  for (const [name, fx, extra] of RFAIL) {
    const { x, D } = await R2(fx, extra);
    put("refresh 실패 " + name, () => ({ "결과": rview(x, D), direct: D.n }));
  }
  // 기준 15: 실패·키 있음
  {
    const s = await R2({ "status/41135.json": 404 }, { key: "K" });
    put("refresh 키 있음 결과", () => rview(s.x, s.D));
    put("refresh 키 있음 replaced 같은 배열", () => s.x.res.replaced.stations === s.D.arr);
    put("refresh 키 있음 region 그대로", () => kept(s));
    put("refresh 키 있음 direct 1번", () => s.D.n);
    const y = await R2({ "meta.json": 404 }, { key: "K" }, T_META + 31 * MIN);
    put("refresh 키 있음 31분 그대로", () => { const k = kept(y); return { "같은 배열": k["같은 배열"], "글자 그대로": k["글자 그대로"], changed: y.x.err ? errOf(y.x.err) : y.x.res.changed }; });
    const X = new Error("직접 실패"); X.code = "X";
    const z = await R2({ "meta.json": 404 }, { key: "K", direct: async () => { throw X; } });
    put("refresh direct 오류 그대로", () => z.x.err === X);
    const ab = new Error("멈춤"); ab.name = "AbortError";
    const w = await R2({ "meta.json": () => { throw ab; } }, { key: "K" });
    put("refresh AbortError 그대로", () => ({ "같은 오류": w.x.err === ab, direct: w.D.n }));
  }
}
asyncPart()
  .catch((e) => { OUT.push(["r5 시험 중 오류", String(e && e.stack)]); })
  .then(() => { console.log("VALUES " + JSON.stringify(OUT)); });
'''


@pytest.fixture(scope="module")
def emitted(tmp_path_factory):
    """JS_SRC 를 임시 폴더에 써서 node 로 돌리고 [이름, 값] 배열을 그대로(겹친 이름도 지우지 않고) 준다."""
    d = tmp_path_factory.mktemp("r5js")
    p = d / "r5_around_values.js"
    p.write_text("const HERE = %s;\n%s" % (json.dumps(str(HERE)), JS_SRC), encoding="utf-8")
    code, out, err = run_node([p], cwd=HERE)
    lines = [ln for ln in out.splitlines() if ln.startswith("VALUES ")]
    assert code == 0 and lines, "node 가 값을 내지 못함(exit %d)\n%s\n%s" % (code, out[-1500:], err[-2000:])
    pairs = json.loads(lines[-1][len("VALUES "):])
    assert isinstance(pairs, list) and all(isinstance(x, list) and len(x) == 2 for x in pairs)
    return pairs


def _dump(x, ordered):
    return json.dumps(x, ensure_ascii=False, sort_keys=not ordered)


@pytest.mark.parametrize("name", list(EXPECT))
def test_value(emitted, name):
    got = dict(emitted)
    assert name in got, "JS 가 이 값을 내지 않음: %s" % name
    want = EXPECT[name]
    ordered = name in ORDERED
    assert _dump(got[name], ordered) == _dump(want, ordered), "%s\n받은 값 %s\n기대   %s" % (
        name, _dump(got[name], ordered), _dump(want, ordered))


def test_names_unique(emitted):
    """JS 가 같은 이름을 두 번 내면(뒤 값이 앞 값을 덮어 앞의 실패가 사라질 수 있음) 실패한다. dict 로 바꾸기 전 배열로 센다."""
    dup = [n for n, c in collections.Counter(n for n, _ in emitted).items() if c > 1]
    assert dup == []


def test_names_match(emitted):
    """JS 가 낸 이름 집합 == EXPECT 이름 집합(조용히 건너뛴 값·잡히지 않은 오류 'r5 시험 중 오류' 를 잡는다)."""
    names = [n for n, _ in emitted]
    assert sorted(set(names) - set(EXPECT)) == []
    assert sorted(set(EXPECT) - set(names)) == []


def test_ordered_is_order_sensitive():
    """ORDERED 비교가 열쇠 순서를 실제로 가르는지(자기 검사): W1 의 addr 를 앞으로 옮기면 글자가 달라진다."""
    moved = {"addr": ""}
    moved.update({k: v for k, v in W1.items() if k != "addr"})
    assert _dump(moved, True) != _dump(W1, True)
    assert _dump(moved, False) == _dump(W1, False)
    assert _dump(True, False) != _dump(1, False) and _dump(0, False) != _dump(False, False)
