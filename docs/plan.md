# ev-charge-planner 계획서 — 충전소 고르기 엔진

작성: 2026-11-14 계획 세션. 출처 요구사항: `specs/ev-charge-planner.md`.
교훈 반영: `.orchestra/memory/lessons.md` 의 '공통'·'계획' 항목.

## 0. 실행 환경 (가장 먼저 확인)

| 항목 | 값 |
|---|---|
| 실행 PC 파이썬 | **Python 3.10.0** (지휘 스크립트가 알려 줌) |
| pyproject `requires-python` | `>=3.10` (실행 PC 와 맞춤) |
| 쓰지 않는 표준 모듈 | `tomllib`(3.11), `enum.StrEnum`(3.11), `datetime.UTC`(3.11), `typing.Self`(3.11) |
| Enum 문자열 | `class X(str, Enum)` 로 만든다 |
| 테스트 명령 (글자 그대로) | `py -m pytest -q --tb=short -p no:cacheprovider` |
| 외부 패키지 | 없음. 표준 라이브러리 + pytest 만 |
| 파일 인코딩 | 모두 UTF-8 |
| 소스 / 테스트 위치 | `src/ev_charge_planner/` / `tests/` |
| 테스트가 src 를 찾는 방법 | `pyproject.toml` 의 `[tool.pytest.ini_options] pythonpath = ["src"]`, `testpaths = ["tests"]` |

- `tests/` 에는 **공용 conftest.py 를 두지 않는다.** 부분마다 테스트 파일 하나(`tests/test_p1_models.py` …)이고, 예시 데이터는 각 파일이 스스로 만든다. (테스트 파일은 부분이 끝나면 지문 잠금되어 뒤 부분이 고칠 수 없다.)
- 소스는 **현재 시각을 부르지 않는다**(`datetime.now/utcnow/today` 금지). 기준 시각 `now` 는 항상 인자로 받는다.

## 1. 개요

고속도로 한 방향의 휴게소·충전소 데이터와 차량·사용자 정보를 받아
(1) 화면이 그대로 그릴 수 있는 **경로 리스트**와 (2) **1순위·예비 충전소 추천**을 돌려주는 순수 파이썬 엔진.
화면·API·서버·DB 는 범위 밖. 입력은 파이썬 데이터클래스로 받는다(JSON 파싱 없음).

우선순위(요구사항 그대로): ① 안전한 충전(항상 1순위 + 예비) → ② 정확한 상태(운영 중지·점검·통신 이상은 못 쓰는 것으로 보고 경고) → ③ 비용(같은 안전이면 할인 반영 실제 가격이 싼 곳).

## 2. 내가 정한 기본값 — 묘성이 정할 것 (요구사항의 ⚠)

| # | 항목 | 이번 기본값 | 바꾸는 곳 |
|---|---|---|---|
| D1 | 노후 배터리 안전 여유 | 주행 가능 거리를 **10 % 깎음** (`safety_margin_ratio = 0.10`) | `Vehicle` 기본값 |
| D2 | 도착 시 최소 남길 잔량 | **15 %** (`min_arrival_soc_pct = 15.0`) | `Vehicle` 기본값 |
| D3 | 상태 정보 오래됨 기준 | **30 분 초과** (`stale_minutes = 30`) | `plan()` / `build_route_list()` 인자 |
| D4 | 안전 점수 | 세 요소 정수 합 **0~5점** (5.1 참조) | `recommend.py` |
| D5 | 휴게소별 별도 가격 체계 | 충전소마다 `price_per_kwh` 를 따로 받는 것으로 표현. 별도 구조 없음 | `Station.price_per_kwh` |
| D6 | 민자 휴게소 구독 할인 제외 | 구독 정보에 `excluded_rest_area_ids` (휴게소 id 집합)로 받는다 | `Subscription` |
| D7 | 할인카드 적용 업체 | 카드마다 `operators` (None = 모든 업체, 집합 = 그 업체만, 빈 집합 = 어디에도 안 됨) | `DiscountCard` |
| D8 | 예비 충전소 위치 | 1순위와 다른 휴게소이고 **진행 방향 앞쪽**(지나온 휴게소는 못 돌아감) | `recommend.py` |
| D9 | 나들목 인근 왕복 거리 | 요구사항대로 **왕복 추가 거리 전부**를 남은 거리에 더해 도착 잔량을 계산 | `route_list.py` |
| D10 | '전체 사용 불가' 판정 범위 | 휴게소 **안** 충전소만 본다(나들목 인근은 따로 경고) | `status.py` |
| D11 | 충전기 상태 값 | 입력 4종 + 원칙에 나온 '점검'을 더해 5종 | `ChargerStatus` |

## 3. 공통 규칙

### 3.1 수치와 비교
- 모든 계산은 float. **엔진은 반올림하지 않는다**(화면이 한다). 테스트는 `pytest.approx` 로 비교한다.
- 경계 비교(갈 수 있는지, 예비 도달 가능)는 **허용 오차 `1e-9`** 를 둔다: `arrival + 1e-9 >= min_soc`. 2.7 같은 값의 부동소수 오차로 경계가 뒤집히지 않게 하기 위함.
- 도착 잔량은 음수가 나와도 깎지 않는다(그냥 '못 감').

### 3.2 시각
- `now` 와 `status_updated_at` 은 `datetime`. 둘 다 naive 이거나 둘 다 aware 여야 한다. 섞이면 `ValueError`.
- 예시·테스트의 기준 시각은 **2026-01-01 12:00** 처럼 작업일과 먼 고정값을 쓴다.

### 3.3 잘못된 입력
- 데이터클래스는 `__post_init__` 에서 검증하고 틀리면 **`ValueError`** (조용히 고치지 않는다).
- 함수 인자가 틀린 경우도 `ValueError`. 타입이 완전히 다른 것(문자열 자리에 숫자)은 그냥 `TypeError` 가 나도 된다(검증하지 않는다).
- "결과 없음"은 예외가 아니다: 후보가 없으면 `status="no_safe_station"` 과 경고로 돌려준다(요구사항 "빈 결과로 넘기지 않는다").

### 3.4 경고(Alert)
`Alert(code: AlertCode, message: str)`. **테스트는 `code` 만 검사**하고 `message`(한글 자유 문장)는 검사하지 않는다.

| AlertCode | 값 | 붙는 곳 | 뜻 |
|---|---|---|---|
| `UNREACHABLE` | `"unreachable"` | 휴게소 항목 / 나들목 인근 항목 | 도착 잔량 < 최소 잔량 |
| `ALL_UNAVAILABLE` | `"all_unavailable"` | 휴게소 항목 | 휴게소 안에 '사용 가능' 충전기(급속·완속 모두)가 하나도 없음(충전소 0개 포함) |
| `NO_USABLE_FAST` | `"no_usable_fast"` | 휴게소 항목 | 완속은 쓸 수 있지만 쓸 수 있는 급속이 없음(ALL_UNAVAILABLE 과 동시에 붙지 않음) |
| `UNUSABLE_CHARGERS` | `"unusable_chargers"` | 충전소 항목 | 운영 중지·점검·통신 이상 충전기가 1대 이상 |
| `STALE_INFO` | `"stale_info"` | 충전소 항목 | 상태 갱신이 기준 분을 **초과**해 오래됨 |
| `NO_BACKUP` | `"no_backup"` | 추천 결과 | 1순위는 있지만 예비가 없음 |
| `NO_SAFE_STATION` | `"no_safe_station"` | 추천 결과 | 후보가 하나도 없음 |

### 3.5 공개 API 한눈에
```
from ev_charge_planner import (Charger, ChargerType, ChargerStatus, Station, NearbyStation,
                               RestArea, Route, Vehicle, DiscountCard, Subscription, User,
                               Alert, AlertCode)                      # p1
from ev_charge_planner.driving_range import conservative_range_km, km_per_pct, arrival_soc_pct, can_reach   # p2
from ev_charge_planner.status import summarize_station, rest_area_alerts, StationStatus                     # p3
from ev_charge_planner.pricing import quote, PriceQuote                                                     # p4
from ev_charge_planner.route_list import build_route_list, RouteList, RestAreaEntry, StationEntry           # p5
from ev_charge_planner.recommend import score_candidate, recommend, Recommendation, Pick                    # p6
from ev_charge_planner.planner import plan, PlanResult                                                      # p7 (p7 에서 __init__ 에도 export)
```

## 4. 표준 예시 데이터와 손 계산표 (p5·p6·p7 이 함께 쓴다)

값은 모두 **지어낸 예시**다(업체·휴게소·가격 전부 가짜). 각 테스트 파일이 이 데이터를 스스로 만든다.

### 4.1 차량·사용자·시각
- 차량 V: 잔량 **60 %**, 배터리 **60 kWh**, 효율 **5 km/kWh**, 안전 여유 0.10, 최소 잔량 15 %.
  - 원래 주행 가능 거리 = 0.6 × 60 × 5 = 180 km. 보수적 = 180 × 0.9 = **162 km**. **1 % 당 2.7 km**.
  - 갈 수 있는 최대 거리(도착 15 %) = 45 × 2.7 = **121.5 km**.
- 사용자 U: 구독 **별빛차지 20 %**, 제외 휴게소 `{"ra4"}`. 카드 **그린카드 10 %**, `operators=None`(모든 업체).
- now = **2026-01-01 12:00**, stale_minutes = 30, position_km = 0.
- 노선: 고속도로 "경부고속도로"(이름만 실제, 값은 예시), 방향 "부산방향".

### 4.2 휴게소 (출발점에서의 거리 순)

| id | 이름 | 거리 km | 도착 잔량 % (60 − 거리/2.7) | 갈 수 있음(≥15) |
|---|---|---|---|---|
| ra1 | 달빛 휴게소 | 27 | 50 | ✓ |
| ra2 | 소나무 휴게소 | 54 | 40 | ✓ |
| ra3 | 강바람 휴게소 | 81 | 30 | ✓ |
| ra4 | 별마루 휴게소(민자) | 108 | 20 | ✓ |
| ra5 | 하늘길 휴게소 | 135 | 10 | ✗ → UNREACHABLE |

### 4.3 충전소 (급속 = 100 kW, 완속 = 7 kW. A=사용 가능, C=충전 중, O=운영 중지, E=통신 이상)

| id | 휴게소 | 업체 | 충전기 | 갱신 시각 | 쓸 수 있는 급속 | 대기(충전 중) | 못 쓰는 수 | 오래됨 | 1kWh 가격 | 구독 적용 가능 | 적용 가능 카드 | 실제 가격 | 적용된 할인 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| s11 | ra1 | 별빛차지 | 급속A, 급속A, 급속C, 완속A | 11:50 | 2 | 1 | 0 | no | 350 | yes | 그린카드 | **280** | subscription |
| s21 | ra2 | 한빛이브이 | 급속A ×3 | 11:45 | 3 | 0 | 0 | no | 320 | no | 그린카드 | **288** | 그린카드 |
| s22 | ra2 | 별빛차지 | 급속A, 급속O | 11:55 | 1 | 0 | 1 → UNUSABLE_CHARGERS | no | 350 | yes | 그린카드 | **280** | subscription |
| s31 | ra3 | 초록전력 | 급속A ×2 | 11:00 | 2 | 0 | 0 | **yes**(60분) → STALE_INFO | 300 | no | 그린카드 | **270** | 그린카드 |
| n31 | ra3 **나들목 인근**, 왕복 +10.8 km | 별빛차지 | 급속A ×4 | 11:58 | 4 | 0 | 0 | no | 300 | yes | 그린카드 | **240** | subscription |
| s41 | ra4 | 별빛차지 | 급속A ×2 | 11:59 | 2 | 0 | 0 | no | 400 | **no(제외 휴게소)** | 그린카드 | **360** | 그린카드 |
| s51 | ra5 | 한빛이브이 | 급속A ×4 | 11:50 | 4 | 0 | 0 | no | 300 | no | 그린카드 | 270 | 그린카드 |

- n31 의 남은 거리 = 81 + 10.8 = **91.8 km**, 도착 잔량 = 60 − 34 = **26 %** ✓.
- 휴게소 집계: ra1 상태별 수 {A:3, C:1, O:0, 점검:0, E:0}, 쓸 수 있는 급속 2, 대기 1, 실제 최저 가격 280. ra2 {A:4, O:1}, 급속 4, 최저 280(s22). ra3 {A:2}, 급속 2, 최저 270(나들목 인근은 휴게소 최저가에 넣지 않음). ra4 {A:2}, 최저 360. ra5 {A:4}, 최저 270(못 가지만 값은 계산).
- 휴게소 구독 적용 가능: ra1 yes, ra2 yes(s22), ra3 no(안 충전소 기준; n31 은 자기 항목에 yes), ra4 no, ra5 no.

### 4.4 안전 점수 (5.1 의 규칙) — 후보(갈 수 있고 쓸 수 있는 급속 ≥ 1)만

점수 = 충전기 수 점수 c + 도착 여유 점수 m + 신선도 f. 여유 = 도착 잔량 − 15.

| 후보 | c (1대→0, 2대→1, 3대↑→2) | 여유 | m (<10→0, 10~<20→1, ≥20→2) | f (오래됨→0, 아니면→1) | 점수 | 실제 가격 |
|---|---|---|---|---|---|---|
| s11 | 1 | 35 | 2 | 1 | **4** | 280 |
| s21 | 2 | 25 | 2 | 1 | **5** | 288 |
| s22 | 0 | 25 | 2 | 1 | **3** | 280 |
| s31 | 1 | 15 | 1 | 0 | **2** | 270 |
| n31 | 2 | 11 | 1 | 1 | **4** | 240 |
| s41 | 1 | 5 | 0 | 1 | **2** | 360 |
| s51 | — 못 감, 후보 아님 | | | | | |

### 4.5 시나리오별 기대 결과 (끝까지 따라간 것)

**(A) 기본**: 1순위 = **s21**(ra2 소나무, 점수 5, 288원). 같은 휴게소의 s22 가 280원으로 더 싸지만 점수 3 이라 밀린다.
예비 = ra2 와 다른 휴게소, ra2 보다 앞쪽(남은 거리 > 54), 1순위(왕복 0)에서 출발해도 15 % 이상 남는 후보 중 최고: s31(2, 270) · n31(4, 240) · s41(2, 360) → **n31**(ra3 나들목 인근, 240원). 결과 경고 없음.

**(B) ra2 전체 사용 불가로 바뀜**: s21 충전기 3대 모두 E(통신 이상), s22 2대 모두 O(운영 중지).
→ ra2 항목: 상태별 수 {E:3, O:2}, 쓸 수 있는 급속 0, 경고 **[ALL_UNAVAILABLE]**, 최저 가격 None. s21·s22 경고 [UNUSABLE_CHARGERS].
→ 후보 s11(4, 280), s31(2, 270), n31(4, 240), s41(2, 360). 점수 4 동점 → 가격 → 1순위 = **n31**(옛 예비가 올라옴).
→ 예비: ra3 보다 앞쪽 후보 s41 만. 1순위에서 출발한 도착 잔량 = s41 도착 잔량 20 − (1순위 왕복 10.8 ÷ 2.7 = 4) = **16 ≥ 15** ✓ → 예비 = **s41**(360원). 결과 경고 없음.

**(C) 잔량 30 %**: 1 % 당 2.7 그대로. ra1 도착 20 ✓, ra2 10 ✗, 나머지 ✗. 후보 s11 만(c1 + m0 + f1 = 2). 1순위 s11, 예비 없음 → status `"ok"`, 경고 **[NO_BACKUP]**.

**(D) 잔량 20 %**: ra1 도착 10 < 15 → 모두 못 감. status **`"no_safe_station"`**, primary·backup None, 경고 **[NO_SAFE_STATION]**. 경로 리스트는 5개 항목 모두 UNREACHABLE 로 그대로 나온다.

**(E) 잔량 35 % (경계)**: ra1 도착 25, ra2 도착 **정확히 15.0 → 갈 수 있음**, ra3 5 ✗. 후보 s11(c1+m1+f1 = 3, 280), s21(c2+m0+f1 = 3, 288), s22(0+0+1 = 1, 280). 1순위: 점수 3 동점 → 가격 → **s11**. 예비: ra1 앞쪽, 1순위 왕복 0 → s21 도착 15.0 ✓ → **s21**. 경고 없음.

**(F) position_km = 27**: 남은 거리 ra1 0(포함, 도착 60), ra2 27 → 50, ra3 54 → 40, ra4 81 → 30, ra5 108 → **20 ✓**. 5개 항목 모두 갈 수 있음. position_km = 30 이면 ra1 은 지나쳐서(남은 거리 −3) 리스트에서 빠지고 4개 항목.

## 5. 부분(part) 나누기

의존 그래프: p1 → {p2, p3, p4} → p5 → p6 → p7.

```
p1 models ──┬─ p2 driving_range ─┐
            ├─ p3 status ────────┼─ p5 route_list ─ p6 recommend ─ p7 planner(통합)
            └─ p4 pricing ───────┘
```

---

### p1_models — 자료형과 뼈대
**목표** 입력 데이터클래스·열거형·Alert 와 검증, 패키지 뼈대(pyproject).
**파일** `pyproject.toml`, `src/ev_charge_planner/__init__.py`, `src/ev_charge_planner/models.py`
**테스트** `tests/test_p1_models.py`
**의존** 없음

자료형(모두 `@dataclass`, frozen 아님, `from __future__ import annotations`):

| 이름 | 필드 | 검증(틀리면 ValueError) |
|---|---|---|
| `ChargerType(str, Enum)` | `FAST="fast"`, `SLOW="slow"` | |
| `ChargerStatus(str, Enum)` | `AVAILABLE="available"`, `CHARGING="charging"`, `OUT_OF_SERVICE="out_of_service"`, `MAINTENANCE="maintenance"`, `COMM_ERROR="comm_error"` | |
| `UNUSABLE_STATUSES` | `frozenset({OUT_OF_SERVICE, MAINTENANCE, COMM_ERROR})` | |
| `Charger` | `type: ChargerType`, `power_kw: float`, `status: ChargerStatus` | type/status 는 Enum 또는 그 값 문자열을 받아 Enum 으로 바꾼다(모르는 문자열 → ValueError). `power_kw > 0` |
| `Station` | `id: str`, `operator: str`, `chargers: list[Charger]`, `price_per_kwh: float`, `status_updated_at: datetime` | id·operator 빈 문자열 금지, `price_per_kwh >= 0`, `status_updated_at` 은 datetime. chargers 빈 리스트 허용 |
| `NearbyStation` | `station: Station`, `detour_km: float` | `detour_km >= 0` |
| `RestArea` | `id: str`, `name: str`, `distance_km: float`, `stations: list[Station]`, `nearby: list[NearbyStation] = []` | id·name 비어 있으면 금지, `distance_km >= 0`. stations 빈 리스트 허용 |
| `Route` | `highway: str`, `direction: str`, `rest_areas: list[RestArea]` | highway·direction 비어 있으면 금지. `distance_km` 가 **감소하지 않아야** 함(같은 값 허용), 휴게소 id 중복 금지, 충전소 id(안 + 나들목 인근) 노선 전체에서 중복 금지. 빈 rest_areas 허용 |
| `Vehicle` | `soc_pct: float`, `battery_kwh: float`, `efficiency_km_per_kwh: float`, `safety_margin_ratio: float = 0.10`, `min_arrival_soc_pct: float = 15.0` | `0 <= soc <= 100`, `battery > 0`, `efficiency > 0`, `0 <= margin < 1`, `0 <= min_arrival <= 100` |
| `DiscountCard` | `name: str`, `rate: float`, `operators: Optional[frozenset[str]] = None` | name 빈 문자열 금지, `0 < rate < 1`. set 을 주면 frozenset 으로 바꿔 저장 |
| `Subscription` | `operator: str`, `rate: float`, `excluded_rest_area_ids: frozenset[str] = frozenset()` | operator 빈 문자열 금지, `0 < rate < 1`. set 은 frozenset 으로 |
| `User` | `subscription: Optional[Subscription] = None`, `cards: list[DiscountCard] = []` | |
| `AlertCode(str, Enum)`, `Alert` | 3.4 표의 7개 코드, `Alert(code, message)` | |

- 잘못된 입력: 위 표의 조건을 어기면 `ValueError`. 입력 형식: 파이썬 데이터클래스만(JSON·dict 파싱 없음). 없는 id: `Subscription.excluded_rest_area_ids` 에 노선에 없는 id 가 있어도 오류 아님(그냥 무시, p4 에서).
- `__init__.py` 는 위 자료형을 모두 export 한다. `pyproject.toml` 은 0절 표대로(`[project] name="ev-charge-planner"`, `version="0.1.0"`, `requires-python=">=3.10"`, pytest 설정).

**통과 기준**
1. 정상 값으로 7종(Charger, Station, NearbyStation, RestArea, Route, Vehicle, User) 모두 만들어지고 기본값(`safety_margin_ratio` 0.10, `min_arrival_soc_pct` 15.0, `nearby` [], `cards` [], `excluded_rest_area_ids` frozenset())이 맞다.
2. `Charger(type="fast", status="available", power_kw=100)` 처럼 값 문자열을 주면 Enum 으로 저장되고, `"fastt"` 같은 모르는 문자열은 ValueError.
3. ValueError 가 나는 경우 각각: power_kw 0, price_per_kwh −1, detour_km −1, distance_km −1, soc 101, soc −1, battery_kwh 0, efficiency 0, margin 1.0, margin −0.1, min_arrival 101, 카드 rate 0, 카드 rate 1, 구독 rate 1.5, 빈 id/이름/업체/고속도로 이름.
4. Route: 거리 역순(54 뒤에 27) → ValueError. 같은 거리 두 휴게소 → 허용. 휴게소 id 중복 → ValueError. 안 충전소와 나들목 인근 충전소 id 가 같음 → ValueError. 빈 `rest_areas` → 허용.
5. `UNUSABLE_STATUSES` 는 정확히 운영 중지·점검·통신 이상 3개. `AlertCode` 멤버 7개의 값이 3.4 표와 같다.
6. `src/` 아래 어떤 .py 도 `datetime.now/utcnow/today` 를 부르지 않는다(AST 로 검사).

---

### p2_range — 주행 가능 거리와 도착 잔량
**목표** 보수적 주행 가능 거리, 거리별 도착 잔량, 갈 수 있는지 판정.
**파일** `src/ev_charge_planner/driving_range.py`
**테스트** `tests/test_p2_range.py`
**의존** p1

함수(모두 순수 함수):
- `conservative_range_km(vehicle) -> float` = `soc/100 × battery × efficiency × (1 − margin)`
- `km_per_pct(vehicle) -> float` = `battery × efficiency × (1 − margin) / 100`
- `arrival_soc_pct(vehicle, distance_km) -> float` = `soc − distance_km / km_per_pct(vehicle)` (음수도 그대로)
- `can_reach(vehicle, distance_km) -> bool` = `arrival_soc_pct(...) + 1e-9 >= vehicle.min_arrival_soc_pct`
- 잘못된 입력: `distance_km < 0` → ValueError. 입력 형식: Vehicle 데이터클래스 + float. 없는 id: 해당 없음.

**통과 기준** (V = 60 %, 60 kWh, 5 km/kWh, 0.10, 15 %)
1. `conservative_range_km(V) ≈ 162`, `km_per_pct(V) ≈ 2.7`. margin 0 이면 180. soc 0 이면 0.
2. `arrival_soc_pct(V, 0) ≈ 60`, `(V, 27) ≈ 50`, `(V, 121.5) ≈ 15`, `(V, 135) ≈ 10`, `(V, 189) ≈ −10`(깎지 않음).
3. `can_reach(V, 121.5)` True(경계 = 포함), `can_reach(V, 121.51)` False, `can_reach(V, 135)` False, `can_reach(V, 0)` True.
4. min_arrival 0 인 차량은 거리 = 보수적 주행 거리까지 True, 그보다 0.01 더 멀면 False.
5. `distance_km = −1` → ValueError.
6. 계산이 `soc`·`battery`·`efficiency`·`margin` 각각에 비례/반비례함을 하나씩 바꿔 확인(예: 배터리 120 kWh → 1 % 당 5.4 km).

---

### p3_status — 충전기 상태 집계와 경고
**목표** 충전소 하나의 상태별 수·쓸 수 있는 급속 수·대기 수·오래됨 판정과 충전소/휴게소 경고.
**파일** `src/ev_charge_planner/status.py`
**테스트** `tests/test_p3_status.py`
**의존** p1

- `@dataclass StationStatus`: `counts: dict[ChargerStatus, int]`(5개 키 전부 있음, 없으면 0), `usable_fast: int`(급속 ∧ 사용 가능), `waiting_fast: int`(급속 ∧ 충전 중), `usable_slow: int`(완속 ∧ 사용 가능), `unusable: int`(상태 ∈ UNUSABLE_STATUSES, 급속·완속 모두), `is_stale: bool`, `alerts: list[Alert]`
- `summarize_station(station, now, stale_minutes=30) -> StationStatus`
  - `is_stale = (now − status_updated_at) > timedelta(minutes=stale_minutes)` (같으면 신선, 미래 시각이면 신선).
  - alerts 순서: `STALE_INFO`(오래됨이면) → `UNUSABLE_CHARGERS`(unusable ≥ 1 이면).
- `rest_area_alerts(statuses: list[StationStatus]) -> list[Alert]`: 휴게소 **안** 충전소들의 StationStatus 목록을 받아 `sum(usable_fast + usable_slow) == 0` 이면 `[ALL_UNAVAILABLE]`(빈 목록도 포함), 아니면 `sum(usable_fast) == 0` 이면 `[NO_USABLE_FAST]`, 아니면 `[]`.
- 잘못된 입력: `stale_minutes < 0` → ValueError. naive/aware 섞임 → ValueError. 입력 형식: Station 데이터클래스 + datetime. 없는 id: 해당 없음.

**통과 기준** (now = 2026-01-01 12:00)
1. 급속A, 급속A, 급속C, 완속A (갱신 11:50) → counts {A:3, C:1, 나머지 0}, usable_fast 2, waiting_fast 1, usable_slow 1, unusable 0, is_stale False, alerts [].
2. 급속A, 급속O (갱신 11:55) → usable_fast 1, unusable 1, alerts [UNUSABLE_CHARGERS].
3. 급속E ×3 (갱신 11:59) → usable_fast 0, unusable 3, alerts [UNUSABLE_CHARGERS]. 점검(MAINTENANCE)도 unusable 에 들어간다.
4. 오래됨 경계: 갱신 11:30 → False(정확히 30분), 11:29 → True 그리고 alerts 첫 번째가 STALE_INFO, 12:10(미래) → False. `stale_minutes=60` 이면 11:00 → False, 10:59 → True.
5. 오래됨 + 못 쓰는 충전기 → alerts 순서 [STALE_INFO, UNUSABLE_CHARGERS].
6. 충전기 0대 → counts 모두 0, alerts [] (경고는 휴게소 단계에서).
7. `rest_area_alerts([])` → [ALL_UNAVAILABLE]; 전부 못 쓰는 충전소들 → [ALL_UNAVAILABLE]; 완속A 만 있는 충전소 → [NO_USABLE_FAST]; 급속A 하나라도 있으면 [].
8. `stale_minutes=-1` → ValueError. now 가 aware, 갱신 시각이 naive → ValueError.

---

### p4_pricing — 실제 가격
**목표** 1kWh 가격에 구독 할인·할인카드 중 더 싼 하나를 적용한 실제 가격과 적용 내역.
**파일** `src/ev_charge_planner/pricing.py`
**테스트** `tests/test_p4_pricing.py`
**의존** p1

- `@dataclass PriceQuote`: `base_price: float`, `final_price: float`, `subscription_applicable: bool`, `applicable_cards: list[str]`(사용자 카드 순서), `applied: Optional[str]`(`"subscription"` | 카드 이름 | None)
- `quote(station, rest_area_id, user, charger_type=ChargerType.FAST) -> PriceQuote`
  - `subscription_applicable` = 구독이 있고 ∧ `station.operator == subscription.operator` ∧ `charger_type == FAST` ∧ `rest_area_id ∉ excluded_rest_area_ids`.
  - `applicable_cards` = `card.operators is None` 또는 `station.operator ∈ card.operators` 인 카드 이름들, 사용자 카드 순서.
  - 후보 할인율 목록 = [구독(적용 가능하면)] + [적용 가능 카드들]. 비어 있으면 `applied=None`, `final=base`. 아니면 **할인율이 가장 큰 하나**만 적용(`final = base × (1 − rate)`), 동률이면 구독 → 카드 순서(앞선 것).
  - 중복 적용 없음.
- 잘못된 입력: `charger_type` 이 ChargerType 이 아니면 ValueError. 입력 형식: Station·User 데이터클래스, rest_area_id 문자열. 없는 id: `excluded_rest_area_ids` 에 노선에 없는 id 가 있어도 무시(오류 아님).

**통과 기준** (U = 구독 별빛차지 0.2 제외 {"ra4"}, 카드 그린카드 0.1 operators None)
1. 별빛차지 350원, ra1, FAST → final ≈ 280, applied "subscription", subscription_applicable True, applicable_cards ["그린카드"].
2. 한빛이브이 320원, ra2 → ≈ 288, applied "그린카드", subscription_applicable False.
3. 별빛차지 400원, **ra4**(제외) → ≈ 360, applied "그린카드", subscription_applicable False.
4. 별빛차지 350원, ra1, **SLOW** → ≈ 315, applied "그린카드", subscription_applicable False(구독은 급속만).
5. 구독·카드 없는 사용자 → final = base, applied None, applicable_cards [].
6. 구독 0.1 + 카드 0.1 동률 → applied "subscription", final ≈ 315. 카드 0.3 > 구독 0.2 → applied 카드, final ≈ 245.
7. 카드 `operators={"한빛이브이"}` 이면 별빛차지 충전소에서 applicable_cards [], 한빛이브이 충전소에서 ["카드"]. `operators=frozenset()`(빈 집합) → 어디에도 안 됨.
8. 카드 두 장(0.1, 0.15) → applicable_cards 는 입력 순서 그대로 두 개, applied 는 0.15 카드.
9. base 0원 → final 0, 오류 없음. `charger_type="fast"`(문자열) → ValueError.

---

### p5_route_list — 경로 리스트
**목표** 진행 순서대로 휴게소 항목(남은 거리·도착 잔량·업체·할인·상태별 수·쓸 수 있는 급속·실제 최저 가격·경고·나들목 인근 하위 목록)을 만든다. p2·p3·p4 를 합친다.
**파일** `src/ev_charge_planner/route_list.py`
**테스트** `tests/test_p5_route_list.py`
**의존** p1, p2, p3, p4

자료형:
- `@dataclass StationEntry`: `station_id`, `operator`, `is_nearby: bool`, `detour_km: float`(안 충전소는 0), `remaining_km: float`(휴게소 남은 거리 + detour), `arrival_soc_pct: float`, `reachable: bool`, `status: StationStatus`, `quote: PriceQuote`(FAST 기준), `is_candidate: bool`(= reachable ∧ usable_fast ≥ 1), `alerts: list[Alert]`, `role: Optional[str] = None`(`"primary"`/`"backup"`, p6 가 채움)
  - `alerts` = `status.alerts` 그대로. **나들목 인근 항목만** 못 가면 끝에 `UNREACHABLE` 추가(안 충전소는 휴게소 항목의 경고로 충분).
- `@dataclass RestAreaEntry`: `rest_area_id`, `name`, `distance_km`, `remaining_km`(= distance − position), `arrival_soc_pct`, `reachable`, `stations: list[StationEntry]`(안), `nearby: list[StationEntry]`, `operators: list[str]`(안 충전소 업체, 입력 순서, 중복 제거), `subscription_applicable: bool`(안 충전소 중 하나라도), `applicable_cards: list[str]`(안 충전소들의 합집합, 사용자 카드 순서), `status_counts: dict[ChargerStatus, int]`(안 충전소 합, 5개 키), `usable_fast: int`(합), `waiting_fast: int`(합), `lowest_price: Optional[float]`(안 충전소 중 usable_fast ≥ 1 인 것들의 `quote.final_price` 최솟값, 없으면 None), `alerts: list[Alert]`
  - `alerts` 순서: `UNREACHABLE`(못 가면) → `rest_area_alerts(...)` 결과.
- `@dataclass RouteList`: `highway`, `direction`, `entries: list[RestAreaEntry]`
- `build_route_list(route, vehicle, user, now, position_km=0.0, stale_minutes=30) -> RouteList`
  - `remaining_km < 0`(지나친 휴게소)은 리스트에서 뺀다. 정확히 0 은 넣는다.
  - 입력 `route` 를 바꾸지 않는다.
- 잘못된 입력: `position_km < 0` → ValueError(그 외 검증은 p1~p4 가 함). 입력 형식: p1 데이터클래스. 없는 id: 해당 없음(id 로 찾는 입력이 없음).

**통과 기준** (4절 표준 데이터, 시나리오 A 기준)
1. entries 5개, 순서 ra1→ra5, `remaining_km` [27, 54, 81, 108, 135], `arrival_soc_pct` ≈ [50, 40, 30, 20, 10], `reachable` [T, T, T, T, F]. ra5 alerts == [UNREACHABLE].
2. ra1: operators ["별빛차지"], subscription_applicable True, applicable_cards ["그린카드"], status_counts {A:3, C:1, 나머지 0}, usable_fast 2, waiting_fast 1, lowest_price ≈ 280, alerts [].
3. ra2: stations 2개 순서 s21, s22. usable_fast 4, status_counts {A:4, O:1}, lowest_price ≈ 280(s22), s22 entry.alerts [UNUSABLE_CHARGERS], s21 quote.applied "그린카드", s22 quote.applied "subscription".
4. ra3: s31 entry status.is_stale True, alerts [STALE_INFO], lowest_price ≈ 270(나들목 인근 제외). nearby 1개 n31: is_nearby True, detour_km 10.8, remaining_km ≈ 91.8, arrival ≈ 26, reachable True, is_candidate True, quote.final ≈ 240. ra3 의 subscription_applicable False(안 충전소 기준), n31.quote.subscription_applicable True.
5. ra4: subscription_applicable False, lowest_price ≈ 360. ra5: lowest_price ≈ 270 이지만 reachable False, 모든 StationEntry.is_candidate False.
6. 시나리오 B 데이터로: ra2 status_counts {E:3, O:2, 나머지 0}, usable_fast 0, alerts [ALL_UNAVAILABLE], lowest_price None, s21·s22 alerts [UNUSABLE_CHARGERS].
7. 완속A 만 있는 충전소 하나뿐인 휴게소 → alerts [NO_USABLE_FAST], lowest_price None. 충전소 0개 휴게소 → alerts [ALL_UNAVAILABLE], status_counts 전부 0, operators [], applicable_cards [].
8. 못 가는 휴게소에 나들목 인근이 있으면 그 nearby entry 의 alerts 끝이 UNREACHABLE. 갈 수 있는 휴게소라도 왕복을 더해 못 가는 나들목 인근(예: ra4 에 왕복 30 km → 108+30 = 138 → 도착 ≈ 8.9)은 reachable False, is_candidate False, alerts 에 UNREACHABLE.
9. 시나리오 F: position_km 27 → 5개 모두 reachable, ra1 remaining 0·arrival ≈ 60, ra5 arrival ≈ 20. position_km 30 → entries 4개(ra1 없음). position_km −1 → ValueError.
10. 빈 노선(rest_areas []) → entries []. 모든 role 은 None. 호출 뒤 입력 route 의 충전기 상태·가격이 바뀌지 않았다(호출 전 값을 복사해 두고 비교).

---

### p6_recommend — 안전 점수와 1순위·예비 추천
**목표** 경로 리스트의 후보에 안전 점수를 매기고 1순위와 예비를 고른다. 리스트의 role 을 채운다.
**파일** `src/ev_charge_planner/recommend.py`
**테스트** `tests/test_p6_recommend.py`
**의존** p1, p2, p5

규칙 (5.1 안전 점수):
- `score_candidate(entry: StationEntry, vehicle) -> int` = c + m + f
  - c: `usable_fast` 1대 → 0, 2대 → 1, 3대 이상 → 2
  - m: 여유 = `entry.arrival_soc_pct − vehicle.min_arrival_soc_pct`; 여유 < 10 → 0, 10 ≤ 여유 < 20 → 1, 여유 ≥ 20 → 2
  - f: `status.is_stale` 이면 0, 아니면 1
- 후보 = 모든 entry(안 충전소 → 나들목 인근 순, 휴게소 순서대로)의 `is_candidate` 인 것.
- 정렬 키(안정 정렬): `(−점수, quote.final_price, remaining_km, is_nearby)` → 남은 동률은 입력 순서.
- 1순위 = 정렬 첫째.
- 예비 자격 (셋 모두):
  1. `rest_area_id` 가 1순위와 다름
  2. 그 휴게소의 남은 거리(detour 제외) > 1순위 휴게소의 남은 거리 (진행 방향 앞쪽, D8)
  3. 1순위에서 출발해도 도달: `entry.arrival_soc_pct − primary.detour_km / km_per_pct(vehicle) + 1e-9 >= min_arrival_soc_pct`
     (= 원점 기준 도착 잔량에서 1순위의 왕복 거리만큼 더 뺀 것. 1순위가 안 충전소면 원점 기준과 같다)
- 예비 = 자격 있는 후보 중 같은 정렬 키로 첫째.
- `@dataclass Pick`: `rest_area_id`, `rest_area_name`, `station_id`, `operator`, `is_nearby`, `detour_km`, `remaining_km`, `arrival_soc_pct`, `score`, `final_price`
- `@dataclass Recommendation`: `status: str`(`"ok"` | `"no_safe_station"`), `primary: Optional[Pick]`, `backup: Optional[Pick]`, `alerts: list[Alert]`
- `recommend(route_list, vehicle) -> Recommendation`: 1순위 entry 의 `role="primary"`, 예비 entry 의 `role="backup"` 으로 **그 자리에서** 채우고(나머지 None 으로 리셋), 후보가 없으면 `status="no_safe_station"`, alerts `[NO_SAFE_STATION]`; 1순위만 있으면 alerts `[NO_BACKUP]`; 둘 다 있으면 `[]`.
- 잘못된 입력: entries 가 비어 있어도 오류 아님(no_safe_station). 입력 형식: p5 의 RouteList + Vehicle. 없는 id: 해당 없음.

**통과 기준** (4절 표준 데이터를 `build_route_list` 로 만들어서)
1. 점수: s11 4, s21 5, s22 3, s31 2, n31 4, s41 2 (4.4 표).
2. 점수 경계: usable_fast 1/2/3/7 → c 0/1/2/2. 여유 9.99 → 0, 10 → 1, 19.99 → 1, 20 → 2. stale → f 0.
3. 시나리오 A: primary.station_id "s21", rest_area_id "ra2", score 5, final_price ≈ 288, is_nearby False. backup.station_id "n31", rest_area_id "ra3", is_nearby True, detour_km 10.8, score 4, final_price ≈ 240. status "ok", alerts []. s21 entry.role "primary", n31 entry.role "backup", 그 외 role None.
4. 시나리오 B: primary "n31"(점수 4, 240 — s11 과 점수 동률을 가격으로 이김), backup "s41"(1순위에서 출발한 도착 잔량 16 ≥ 15), alerts [].
5. 시나리오 C(잔량 30): primary "s11", backup None, status "ok", alerts [NO_BACKUP].
6. 시나리오 D(잔량 20): status "no_safe_station", primary None, backup None, alerts [NO_SAFE_STATION], 모든 role None.
7. 시나리오 E(잔량 35): primary "s11"(점수 3 동률 → 280 < 288), backup "s21"(도착 정확히 15.0 → 허용). s22(점수 1)는 예비가 아니다.
8. 앞쪽 규칙: 표준 데이터에서 s11 의 충전기를 급속 A ×3 으로 바꾸면 점수 5(c2+m2+f1) 로 s21 과 동률 → 가격 280 < 288 → primary "s11", backup 은 ra1 앞쪽의 s21. 반대로 기준 3(primary s21)에서 뒤쪽(ra1) s11 은 점수 4 인데도 예비가 아니다 — 지나온 휴게소는 예비가 못 된다.
9. 예비 도달 규칙: 시나리오 B 에서 ra4 의 거리를 108 → 113.4 로 바꾸면 s41 원점 도착 18, 1순위(n31) 왕복을 빼면 14 < 15 → 예비 없음, alerts [NO_BACKUP].
10. 같은 휴게소의 두 충전소가 정렬 첫째·둘째여도 예비는 다른 휴게소에서 고른다(시나리오 A 에서 s22 가 예비가 아님).
11. 빈 RouteList → no_safe_station. recommend 를 두 번 불러도 role 이 중복으로 남지 않는다.

---

### p7_integration — 엔진 파사드와 통합 흐름
**목표** `plan()` 한 번으로 경로 리스트 + 추천을 돌려주고, 요구사항의 통합 흐름(1순위 휴게소가 전체 사용 불가로 바뀌면 예비가 1순위로 올라오고 경고가 붙음)을 끝에서 끝까지 확인한다.
**파일** `src/ev_charge_planner/planner.py`, `src/ev_charge_planner/__init__.py`(p1 것에 `plan`, `PlanResult` export 만 추가)
**테스트** `tests/test_p7_integration.py`
**의존** p1~p6 전부

- `@dataclass PlanResult`: `route_list: RouteList`, `recommendation: Recommendation`
- `plan(route, vehicle, user, now, position_km=0.0, stale_minutes=30) -> PlanResult` = `build_route_list(...)` → `recommend(...)` 순서. 입력을 바꾸지 않는다.
- 잘못된 입력: p1~p6 의 ValueError 가 그대로 올라온다(감싸지 않음). 입력 형식: p1 데이터클래스. 없는 id: 해당 없음.
- 통합 테스트의 데이터는 테스트 파일 안의 팩토리 함수(`make_route(ra2_down=False)`, `make_vehicle(soc)`)로 만든다.

**통과 기준**
1. 시나리오 A: `plan()` 결과 route_list.entries 5개, recommendation.primary "s21"/"ra2", backup "n31"/"ra3"(is_nearby True), alerts []. route_list 에서 s21 entry.role "primary", ra3.nearby[0].role "backup".
2. 시나리오 B(ra2 전체 사용 불가로 바꿔 다시 `plan()`): ra2 entry.alerts 에 ALL_UNAVAILABLE, usable_fast 0, lowest_price None; primary 가 "n31"(A 의 예비)로 올라오고 backup "s41"; recommendation.alerts []. s21·s22 entry.alerts [UNUSABLE_CHARGERS].
3. 시나리오 C(잔량 30): primary "s11", backup None, alerts [NO_BACKUP].
4. 시나리오 D(잔량 20): status "no_safe_station", alerts [NO_SAFE_STATION], 그래도 route_list.entries 는 5개이고 모두 UNREACHABLE 경고를 가진다(빈 결과가 아님).
5. 시나리오 E(잔량 35): primary "s11", backup "s21", ra2 arrival ≈ 15 reachable True.
6. 시나리오 F: position_km 27 → ra5 reachable True 이고 5개 항목; position_km 30 → 4개 항목.
7. `plan()` 호출 전후 입력 route 의 각 충전기 status, 각 충전소 price, vehicle.soc_pct 가 같다(호출 전 값을 리스트로 복사해 두고 비교).
8. `from ev_charge_planner import plan, PlanResult, Route, Vehicle, User` 가 된다. 잘못된 차량(soc 101)으로 `plan()` → ValueError.
9. 경로 리스트 항목이 요구사항의 화면 필드(이름, 남은 거리, 도착 잔량, 업체, 구독 적용 여부, 적용 카드, 상태별 수, 쓸 수 있는 급속 수, 실제 최저 가격, 경고, 나들목 인근 하위 목록, 1순위·예비 표시)를 모두 속성으로 가진다(`hasattr` 로 확인).

## 6. 테스트 배치와 진행 순서

| 부분 | 소스 | 테스트 파일 | 앞 부분 |
|---|---|---|---|
| p1_models | pyproject.toml, `__init__.py`, models.py | tests/test_p1_models.py | — |
| p2_range | driving_range.py | tests/test_p2_range.py | p1 |
| p3_status | status.py | tests/test_p3_status.py | p1 |
| p4_pricing | pricing.py | tests/test_p4_pricing.py | p1 |
| p5_route_list | route_list.py | tests/test_p5_route_list.py | p1~p4 |
| p6_recommend | recommend.py | tests/test_p6_recommend.py | p1, p2, p5 |
| p7_integration | planner.py, `__init__.py`(export 추가) | tests/test_p7_integration.py | p1~p6 |

- 테스트 세션 주의: 계획에 없는 동작을 테스트에 넣으면 docstring 에 근거(이 문서의 절 번호)를 한 줄 적는다. 기대값은 4절 손 계산표에서 가져온다.
- 개발 세션 주의: src_files 밖 파일을 만들지 않는다. 환경이 어긋나면(파이썬 버전 등) 결과 첫 줄에 "환경 불일치"로 보고한다.

## 7. 범위 밖 (이번엔 안 함)
화면, 지도·경로 API, 공공데이터 수집, 예약, 서버, JSON/dict 입력 파싱, 가격 반올림(화면 담당), 완속 충전기 추천(집계만 한다), 충전 시간 계산.
