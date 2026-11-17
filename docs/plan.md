# ev-navi-enough 계획서 — 길찾기 노선에서 목적지까지 충전 없이 갈 수 있으면 빨간 경고 대신 안심 안내

작성: 2026-11-17 계획 세션. 출처 요구사항: `specs/ev-navi-enough.md`.
교훈 반영: `.orchestra/memory/lessons.md` 의 '공통'·'계획'.
앞 단계 계획서: 엔진 `docs/plan_stage1.md`, 앱 중계 `docs/plan_stage2.md`, 비밀값 허용 목록 `docs/plan_stage3.md`, 기본 중계 주소(ev-app-relay-raw) **`docs/plan_stage4.md`**(이번에 옮겨 둠 — 계획 밖 파일. 까닭: 이 파일을 덮어쓰면 잠긴 테스트의 "plan.md N행" 인용이 죽는다). 잠긴 `tests/test_g1_rawbase_…`·`test_integration_rawbase…` 의 "plan.md N행"은 `plan_stage4.md` 다.

**한 줄 결론:** `web/app.js` 한 파일에서 `render` 가 안전 거리를 한 번만 계산해 `#range-line` 과 `renderReco` 에 같이 넘기고, `renderReco` 가 "길찾기 노선이고 안전 거리 ≥ 남은 거리"일 때 빨간 칸 자리에 차분한 칸을 넣는다. 다만 **(1) `web/style.css` 는 잠긴 테스트가 해시로 묶어 두어 새 CSS 를 못 넣는다 — 차분한 칸의 색은 `app.js` 가 `style` 속성으로 입힌다(N2). (2) 견줌은 반올림하기 전 값으로 한다 — 화면에 "약 176km"로 보여도 실제 175.5 km 이면 목적지 176 km 에는 빨간 칸이 그대로 뜬다(K1). (3) 이 실행은 코드만 고친다. 올리기(push)와 APK 다시 만들기를 해야 사이트·폰에 보인다(묘성이 정할 것 3번).**

## 0. 실행 환경 (가장 먼저 확인)

| 항목 | 값 |
|---|---|
| 실행 PC 파이썬 | **Python 3.10.0**. 표준 라이브러리만. 3.11 전용(`tomllib`·`StrEnum`·`datetime.UTC`·`typing.Self`)은 쓰지 않는다. `pyproject.toml` 은 고치지 않는다 |
| 테스트 명령(글자 그대로) | `py -m pytest -q --tb=short -p no:cacheprovider` |
| 바깥 도구 | **node**(잠긴 `tests/test_p0_node.py` 의 `run_node` 로만 부른다. 셸에서 `node …` 를 바로 치면 거부된다). 네트워크 없음 |
| 고치는 소스 | **`web/app.js` 하나뿐**(`render` 의 `#range-line` 줄과 `renderReco` 부르는 줄, `renderReco` 와 그 바로 위 새 도우미 하나) |
| 고치지 않는 것 | `web/` 의 다른 파일 전부(`engine.js`·`navi.js`·`relay.js`·`style.css`·`index.html`·`dist/` 포함), `app/`, `src/`, `tools/`, `ref/`, `specs/`, 잠긴 `tests/` 전부, `tests.lock.json` |
| 새 테스트 파일 | e1_enough: `tests/test_e1_enough_reco.js`, `tests/test_e1_enough_reco.py` / integration: `tests/test_integration_enough.py`. **이 셋뿐.** `tests/data/`·`conftest.py` 는 만들지 않는다 |
| 시험 자료 | 테스트 파일 안의 글자(3.4절의 작은 `live.js`·받아 둔 길)와 `tmp_path` |
| 파일 인코딩 | 모두 UTF-8. `web/app.js` 의 줄 끝은 지금 LF 다(참조 `out_info.txt`) — 그대로 둔다 |
| 참조 구현 | `.orchestra/logs/ref_enough/` (5절). 제품이 아니다. 이 계획서의 표·글·숫자는 전부 그 실행 출력에서 옮겼다 |

- **부분 id** 는 `e1_enough`, `integration`. `integration` 은 앞 단계와 이름이 같으므로 **새 테스트 파일 이름을 `tests/test_integration_enough.py` 하나로 못박는다.** 이미 있는 `tests/test_integration_*` 일곱 파일(55,254자, 참조 `out_chars.txt`)은 잠긴 파일이니 고치지 않는다(읽고 `require`·`import` 하는 것은 된다).
- **테스트 글자 수**(글자 수 = UTF-8 로 읽은 `len`. 이 셸의 `wc -m` 은 바이트를 낸다): e1 새 파일 둘 합쳐 **30,000자 이하**, integration 새 파일 **3,000자 이하**. 한도 때문에 사례를 빼지 않는다 — 4절의 줄은 전부 필수다.
- **수용 기준은 모두 8개**(e1 6개 + integration 2개). 요구사항의 "8개 이하"를 두 부분을 합쳐 지킨다.
- **저장소 안에 산출물을 만들지 않는다.** 빌드는 `tmp_path` 에 복사한 `web/` 에서만 돌린다(`web/dist/` 를 건드리지 않는다). 세션은 `bash tools/push.sh` 를 돌리지 않는다.
- 지금 작업 트리에서 계획 세션이 돌린 전체 테스트: **1949 passed**(25초).

## 1. 개요

지금: `renderReco(result)` 는 추천이 없으면 빨간 "안전하게 갈 수 있는 충전소가 없습니다", 1순위만 있으면 빨간 "예비 충전소가 없습니다 … 1순위에서 꼭 충전하세요"를 그린다. 길찾기 노선은 목적지에서 끝나므로 1순위가 마지막 휴게소면 늘 빨간 칸이 뜬다 — 목적지가 안전 거리 안이어도.

고친 뒤: 지금 노선이 길찾기 노선(`route.navi === true`)이고 안전 거리(반올림 전) ≥ 목적지까지 남은 거리(`노선 길이 − 지금 위치`)이면 그 두 빨간 칸 자리에 차분한 칸 "목적지까지 충전 없이 갈 수 있어요"를 그린다. 예비가 있으면 지금처럼 예비 칸. 그 밖은 지금과 글자까지 같다.

| id | 이름 | 소스 | 의존 | 하는 일 |
|---|---|---|---|---|
| `e1_enough` | 추천 칸의 안심 안내 | `web/app.js` | - | `render`·`renderReco` 를 고친다. 요구사항의 수용 기준 여덟을 이 부분 혼자 다 채운다 |
| `integration` | 노선 바꾸기 흐름과 빌드 | `web/app.js` | e1_enough | 한 화면에서 노선·위치·잔량을 바꿔 가며 칸이 바뀌는지, 빌드한 한 파일 앱에 새 글이 들었는지 본다. **개발 몫은 없는 것이 정상**(e1 이 끝나면 새 통합 테스트가 그대로 통과해야 한다. 실패하면 `web/app.js` 만 고친다) |

두 부분이 `web/app.js` 한 파일을 본다. e1 테스트는 끝까지 참인 것만 단언하므로 충돌이 없다(integration 은 그 파일을 더 고치지 않는다).

## 2. 결정 목록

### 2.0 묘성이 정할 것 (맨 위부터 중요한 순)

1. **1순위가 없을 때(닿는 충전소 0)는 차분한 칸의 꼬리 문장 "1순위는 들르고 싶을 때 참고하세요."를 뺐다(N1).** 요구사항은 "같은 차분한 칸"이라고 했지만 그때는 화면에 1순위 칸이 없어 가리키는 것이 없다. 작은 글은 "남은 거리 약 N km · 안전하게 갈 수 있는 거리 약 M km." 에서 끝난다. **싫으면:** 4절 E2 의 "꼬리 문장 없음"을 빼고 참조 `enoughEl` 의 둘째 인자를 늘 `true` 로 두면 된다(잠긴 뒤라면 `tests/test_e1_enough_…` 를 풀어야 한다).
2. **"갈 수 있다"의 견줌은 반올림 전 값으로 한다(K1).** 기본 설정·잔량 80% 의 안전 거리는 정확히는 175.5 km 이고 화면에는 "약 176km"로 보인다. 목적지가 176 km 남았으면 화면 숫자는 같아 보여도 **빨간 칸이 그대로** 뜬다(표 T12). 175 km 남았으면 차분한 칸(T5). 반올림한 숫자끼리 견주면 0.5 km 모자란데도 "갈 수 있어요"가 뜨기 때문이다. 잃는 것: 숫자가 같아 보이는데 빨간 칸인 경우가 드물게 있다.
3. **이 실행은 코드만 고친다. 사람이(또는 대화에서) 해야 보인다:** (a) `master` 로 올리면(`tools/push.sh`) GitHub 가 다시 만들어 사이트에 낸다. (b) 폰 앱(APK)은 `node web/build.js` → `node app/copy-web.js` → APK 다시 만들기·설치를 해야 바뀐다. (c) 저장소에 들어 있는 `web/dist/` 세 파일(`index.html`·`artifact.html`·`충전길잡이.html`)에는 지금 옛 빨간 글이 한 번씩 들어 있고(Grep 으로 셈) 이 실행 뒤에도 옛 것 그대로다. `app/` 아래 `.html`·`.js` 에는 그 글이 0번이다(앱 화면 파일이 저장소에 없다).
4. **차분한 칸의 색은 `app.js` 가 `style` 속성으로 입힌다(N2).** 잠긴 `tests/test_integration_relay.py::test_same` 이 `web/style.css` 의 해시를 묶어 두어 새 CSS 줄을 넣으면 그 테스트가 깨진다. 그래서 빨간 칸과 같은 틀(class `none` — 여백·글 크기를 그대로 쓴다)에 `data-tone="good"` 과 `style="background: var(--good-soft); color: var(--good)"` 를 붙였다(두 색 변수는 `style.css` 에 이미 있다 — 칩의 good 색과 같다). 깔끔히 하려면 `style.css` 에 `.none[data-tone="good"]` 줄을 넣고 그 해시 테스트를 풀어야 한다.
5. **부분이 둘이다(N3).** 요구사항은 "부분 하나"였는데 계획 지시문이 `integration` 부분을 꼭 넣으라고 한다. e1 혼자 요구사항의 수용 기준을 다 채우게 했으므로, integration 이 글자 수 한도나 "개발할 것이 없음" 때문에 막혀도 고침 자체는 e1 에서 끝나 있다. 막히면 그 부분만 버려도 된다.
6. **차분한 칸이 떠도 1순위 칸·아래 휴게소 띠·지도 풍선은 지금 그대로다.** 엔진(`engine.js`)의 추천 규칙과 경고는 고치지 않는다. 화면의 빨간 칸 둘만 바뀐다.
7. 숫자 사이를 요구사항 글자대로 "약 60 km"(숫자와 km 사이 한 칸)로 적었다. `#range-line` 은 지금처럼 "약 176km"(붙여 씀)다.

### 2.1 요구사항과 다름

| # | 요구사항 | 이 계획 | 까닭 / 잃는 것 |
|---|---|---|---|
| N1 | 1순위·예비가 다 없을 때도 "같은 차분한 칸" | 굵은 글·숫자 문장은 같고 꼬리 문장만 뺀다 | 2.0 의 1번 |
| N2 | 차분한(good) 칸 | class `none` + `data-tone="good"` + `style` 속성 | 2.0 의 4번. 잃는 것: 색이 CSS 파일이 아니라 `app.js` 에 있다 |
| N3 | 부분 하나 | 부분 둘. 기준은 합쳐 8개, 새 테스트는 합쳐 33,000자 이하 | 2.0 의 5번 |

### 2.2 비워 둔 곳을 채움

| # | 정한 것 |
|---|---|
| K1 | 견줌은 `안전 거리(반올림 전, 0 으로 자르기 전) >= 노선 길이 − 지금 위치(반올림 전)`. 같으면 차분한 칸(T6: 195 대 195). 화면 숫자만 반올림한다 |
| K2 | 안전 거리가 음수(잔량이 '도착 때 남길 %'보다 적음)면 `#range-line` 은 지금처럼 "약 0km"이고, 남은 거리가 0 이어도 차분한 칸은 안 뜬다(T18 — 0 으로 자른 값으로 견주지 않는다) |
| K3 | N = `Math.round(노선 길이 − 지금 위치)`, M = `#range-line` 에 쓰는 그 값(`Math.max(0, Math.round(안전 거리))`). 위치 30.4 → N 30, 위치 30.6 → N 29(T3) |
| K4 | 길찾기 노선에서 위치가 노선 끝(남은 거리 0)이면 차분한 칸에 "남은 거리 약 0 km"(T10) |
| K5 | 길찾기 노선인지는 지금 고른 노선의 `navi === true` 로 본다. 받아 둔 길이 있어도 고속도로 노선을 골랐으면 지금 그대로다(T15). `navi` 가 `true` 가 아닌 참 값인 노선은 앱이 만들지 않는다 — `=== true` 와 "참이면"은 동치(검사 불가) |
| K6 | 충전기가 모두 고장이라 추천이 없을 때(T9)와 휴게소를 다 지나쳐 추천이 없을 때(T8)를 가리지 않는다. 둘 다 "1순위 없음"이다 |
| K7 | 예비가 있으면 안전 거리가 넉넉해도 차분한 칸을 더하지 않는다(T19) |
| K8 | 차분한 칸의 글에는 숫자 둘 말고 바뀌는 글이 없다. 목적지 이름(사용자 입력)은 넣지 않는다. 모두 `textContent` 로 넣는다 |
| K9 | `EV.plan` 이 던져 "설정을 확인해 주세요"가 뜨는 갈래는 고치지 않는다(`renderReco` 를 부르지 않는 갈래) |

### 2.3 막지 못함 / 남는 것

| # | 내용 |
|---|---|
| M1 | "갈 수 있다"는 목적지에 '도착 때 남길 %'(기본 15%)를 남기고 닿는다는 뜻이다. 목적지에 충전기가 있는지, 돌아올 길은 보지 않는다 |
| M2 | 남은 거리는 화면의 위치 값(`#pos`)으로 센다. 위치를 안 잡았거나 길에서 벗어났으면 틀린 남은 거리로 차분한 칸이 뜰 수 있다(추천 계산도 지금 같은 값을 쓴다 — 새로 생긴 틈은 아니다) |
| M3 | 어제 받아 둔 길이라도 길찾기 노선을 골라 두었으면 이 규칙이 걸린다 |
| M4 | 노선 길이는 지금처럼 올림한 정수 km(`Math.ceil`)다. 남은 거리가 실제보다 최대 1 km 길게 잡힌다(안전한 쪽) |
| M5 | 색 변수 이름(`--good-soft`·`--good`)이 `style.css` 에서 바뀌면 차분한 칸의 색이 빠진다(테스트는 속성 글자만 본다) |

### 2.4 앞 단계 최종 검수에서 남았던 것

| 앞 단계 지적 | 이번 설계에서 |
|---|---|
| 저장소의 빌드 결과(`web/dist/`·APK)가 옛 것(ev-app-relay-raw T2·D1) | **그대로 남음** — 2.0 의 3번 |
| 지도 탭 30분 규칙(ev-app-relay Q1), 신선도(`meta.at`) | 이 일과 무관. 그대로 |
| 새 clone 에서 CRLF 로 1 failed(ev-secret-allow T1) | 이 일과 무관. 그대로 |

## 3. 공통 규칙

### 3.1 잠긴 테스트가 거는 조건 (참조를 잠긴 테스트 전체에 돌려 확인)

| 잠긴 테스트 | 조건 | 이 일에서 |
|---|---|---|
| `tests/test_integration_relay.py::test_same` | `web/engine.js`·`navi.js`·`data.js`·`style.css`·`around.js`·`regions.js`·`live_build.js` 와 `web/test/` 여섯 파일의 해시가 그대로 | `web/app.js` 만 고친다. **`style.css` 에 줄을 더하지 않는다** |
| `tests/test_integration_relay.py::test_text` | `web/app.js` 글에 `<b>`·`<br>`·`<div class="mk`·`innerHTML`·`outerHTML`·`insertAdjacentHTML`·`document.write`·`const esc =`·`vicfos99-tech.github.io` 가 없다 | 주석에도 `<b>` 를 적지 않는다. 칸은 지금처럼 `h("b", { text })` 로 만든다 |
| `tests/test_integration_relay.py::test_flow`, `test_integration_rawbase.py` | 가짜 화면 흐름이 기준 파일과 같다 | 고속도로 노선에서는 아무것도 안 바뀐다 |

참조 고침을 적용한 복사본에서 전체 테스트: 고치기 전 복사본과 똑같이 **1948 passed, 1 failed**(그 1개는 `.git` 없는 복사본이라 실패하는 `test_integration_secret.py::test_real_repo` — 고치기 전 복사본에서도 같다). 즉 잠긴 테스트 가운데 이 고침으로 깨지는 것은 0개다.

### 3.2 칸의 꼴 (가짜 화면에서 보는 값)

`#reco` 의 자식은 하나(class `reco` 인 묶음)이고, 그 묶음의 자식이 칸이다. 칸마다 보는 값: class, `data-role` 속성, `data-tone` 속성, `style` 속성, 자식들의 태그와 글.

| 기호 | 칸 | class | `data-role` | `data-tone` | `style` | 자식 글(차례대로) |
|---|---|---|---|---|---|---|
| P | 1순위 칸 | `pick` | `primary` | 없음 | 없음 | 첫째 `1순위 충전소`, 둘째 휴게소 이름, 셋째 거리 … (지금 그대로) |
| B | 예비 칸 | `pick` | `backup` | 없음 | 없음 | 첫째 `예비 (1순위가 안 되면)`, 둘째 휴게소 이름 … (지금 그대로) |
| RB | 빨간 "예비 없음" | `none` | 없음 | 없음 | 없음 | `예비 충전소가 없습니다` / `1순위에서 충전하지 못하면 갈 수 있는 다음 충전소가 없습니다. 1순위에서 꼭 충전하세요.` |
| RN | 빨간 "충전소 없음" | `none` | 없음 | 없음 | 없음 | `안전하게 갈 수 있는 충전소가 없습니다` / `지금 잔량으로 닿는 곳에 빈 급속 충전기가 없습니다. 가까운 나들목으로 나가 충전소를 찾거나, 속도를 줄여 전비를 높이세요.` |
| C | **차분한 칸(새로)** | `none` | 없음 | `good` | `background: var(--good-soft); color: var(--good)` | `목적지까지 충전 없이 갈 수 있어요` / `남은 거리 약 N km · 안전하게 갈 수 있는 거리 약 M km.` (+ 1순위가 있으면 ` 1순위는 들르고 싶을 때 참고하세요.`) |

RB·RN·C 의 자식은 태그 `B`·`SPAN` 둘뿐이다. P·B·RB·RN 의 값은 고치기 전 코드의 출력(참조 `out_flow_old.json`)과 글자까지 같아야 한다.

### 3.3 `#range-line` 글 (고치기 전과 글자까지 같다)

| 사례 | 글 |
|---|---|
| T1-0 (잔량 80) | `안전하게 갈 수 있는 거리 약 176km (여유 10%, 도착 때 15% 남김)` |
| T4-0 (잔량 50) | `안전하게 갈 수 있는 거리 약 95km (여유 10%, 도착 때 15% 남김)` |
| T6-0 (여유 0) | `안전하게 갈 수 있는 거리 약 195km (여유 0%, 도착 때 15% 남김)` |
| T18-0 (잔량 10) | `안전하게 갈 수 있는 거리 약 0km (여유 10%, 도착 때 15% 남김)` |
| T21-0 (잔량 20) | `안전하게 갈 수 있는 거리 약 14km (여유 10%, 도착 때 15% 남김)` |
| T22-0 (차 높이 2.5) | `안전하게 갈 수 있는 거리 약 176km (여유 10%, 도착 때 15% 남김) · 차 높이 2.5m: 건물 안·지하 충전소 0곳 숨김` |

### 3.4 시험 자료와 도우미 (테스트 파일 안의 글자로 둔다)

가짜 화면은 잠긴 `tests/test_integration_dom.js` 의 `boot` 를 `require` 해 쓴다. `web/index.html` 의 `<script src>` 순서대로 `web/` 의 파일을 읽어 넣되 `live.js` 만 아래 작은 것으로 바꾼다. 참조 `ref_flow.js` 가 그대로 본보기다(`live`·`saved`·`scripts`·`shot`·`run` 함수).

- **시각:** `now` = `1767571920000`. 충전소 상태 시각(`fetched_at`·`updated`) = `1767571200000`(12분 전).
- **작은 `live.js`**(`root.EvLive`): 고속도로 `gb`("경부고속도로", 점 `[37.527,127.012] [37.46,127.042] [37.332,127.105] [37.236,127.105] [37.077,127.133] [36.943,127.19]`, 앞 방향 노선 `live-gb-down`, 뒤 방향 `live-gb-up`), 두 노선 모두 `length` 100·`live: true`.
  - 자료 `one`: `live-gb-down` 에 기흥휴게소(`km` 33.9, 위치 `[37.2361,127.1052]`, 충전소 `KP000101` 급속 100 kW 둘: `available`·`charging`).
  - 자료 `two`: 거기에 안성휴게소(`km` 45, 위치 `[37.15,127.1201]`, 충전소 `KP000201` 급속 `available` 하나)를 더한다.
  - 자료 `broken`: `one` 인데 `KP000101` 의 충전기 둘이 `out_of_service`.
  - `live-gb-up` 에는 늘 기흥휴게소(`KP000102`) 하나.
- **받아 둔 길**(저장 열쇠 `ev-charge-planner/navi`), 노선 길이 L(정수, 45 이상): `{ dest, fetched_at: now, pieces: [ {name: "경부고속도로", points: [[37.46,127.042],[37.332,127.105],[37.236,127.105],[37.077,127.133]], length_m: 44000}, {name: "국도42호선", points: [[37.077,127.133],[37.2,127.5]], length_m: (L−44)×1000} ] }`. 이러면 길찾기 노선의 길이가 정확히 L 이고 기흥휴게소가 길 위 26.1 km, (자료 `two` 면) 안성휴게소가 그 뒤에 놓인다. `dest` 기본값 `횡성`.
- **저장값**(열쇠 `ev-charge-planner/v1`): `{ chaeviSet: true, routeKey, soc, pos, … }`. 표에 없는 칸은 앱 기본값(배터리 60, 전비 5, 여유 10, 도착 때 15). 중계는 끈다(`ev-charge-planner/relay` = `off`). `fetch` 는 무엇이든 404.
- **걸음:** `app.el(sel).value = 값; app.fire(sel, type); await app.settle();`
- **도우미의 약속**(integration 이 불러 쓴다): `tests/test_e1_enough_reco.js` 는 `node tests/test_e1_enough_reco.js '<사례 목록 JSON>'` 으로 불리면 사례 `{ id, data, len, state, dest, steps: [{sel, value, type}] }` 마다 `{ id, loadErrors, errors, calls, route, shots }` 를 `RESULT ` 한 줄(JSON 목록)로 낸다. `shots` 는 띄운 직후와 걸음마다의 `{ range, boxes: [{ cls, role, tone, style, tags, texts }] }`. **JS 는 본 것만 내고 기대값은 파이썬 쪽 표에만 둔다.** `len` 이 `null` 이면 받아 둔 길을 저장하지 않는다.

### 3.5 그 밖

- C1. 테스트 세션은 `web/app.js` 의 글자(함수 이름·변수 이름)를 단언하지 않는다. 화면에서 본 값만 단언한다.
- C2. 테스트·검증 세션은 빌드·흐름을 `tmp_path` 나 메모리에서만 돌린다.
- C3. 건너뛰기(`skip`)를 쓰지 않는다. node 가 없으면 실패한다(잠긴 `run_node` 가 그렇게 한다).

## 4. 부분별 통과 기준

### 4.1 e1_enough — 추천 칸의 안심 안내

- 소스: `web/app.js`. 테스트: `tests/test_e1_enough_reco.js`(3.4절의 도우미) + `tests/test_e1_enough_reco.py`(표 T 를 사례 목록으로 넘기고 줄마다 pytest 하나로 보인다).
- 고치는 곳: `render` 안에서 안전 거리를 한 번 계산해 `#range-line` 과 `renderReco` 에 넘긴다. `renderReco` 는 추천이 없을 때·예비가 없을 때 두 곳에서 "넉넉한가"를 보고 C 칸 또는 지금의 빨간 칸을 넣는다.
- 잘못된 입력: 새로 받는 입력이 없다. 저장값이 틀려 `EV.plan` 이 던지는 갈래는 지금 그대로(K9).

**통과 기준**

- **E1.** 표 T 에서 칸이 `P C` 인 줄(T1-0·T2-0·T3-0·T4-0·T5-0·T6-0·T7-0·T21-1·T22-0) 모두, 묶음의 자식이 정확히 둘이고 차례로 P 칸(둘째 글 `기흥휴게소`, 셋째 글은 T1-0 에서 `26.1km`·T2-0 에서 `16.1km`)과 C 칸이며, C 칸의 굵은 글이 `목적지까지 충전 없이 갈 수 있어요`, 작은 글이 `남은 거리 약 N km · 안전하게 갈 수 있는 거리 약 M km. 1순위는 들르고 싶을 때 참고하세요.`(N·M 은 표의 값)와 글자까지 같고, 어느 칸에도 `예비 충전소가 없습니다` 가 없다.
- **E2.** 표 T 에서 칸이 `C` 인 줄(T3-1·T3-2·T3-3·T8-0·T9-0·T10-0) 모두, 묶음의 자식이 C 칸 하나뿐이고 그 작은 글이 `남은 거리 약 N km · 안전하게 갈 수 있는 거리 약 M km.`(N·M 은 표의 값, 꼬리 문장 없음)와 글자까지 같으며, 어느 칸에도 `안전하게 갈 수 있는 충전소가 없습니다` 가 없다.
- **E3.** 표 T 에서 칸이 `P RB`·`RN`·`P B` 인 줄(T11-0·T12-0·T13-0·T14-0·T15-0·T16-0·T17-0·T18-0·T19-0·T20-0·T21-0) 모두, 묶음의 자식 수와 차례가 표와 같고 칸마다 class·`data-role`·자식 글이 3.2절 표와 글자까지 같으며(B 칸의 둘째 글은 `안성휴게소`) `data-tone`·`style` 속성을 가진 칸이 없고 `충전 없이` 라는 글이 어디에도 없다.
- **E4.** C 칸은 나오는 모든 줄에서 class 가 `none`, `data-tone` 이 `good`, `style` 속성 글이 `background: var(--good-soft); color: var(--good)`, `data-role` 이 없고 자식이 태그 `B`·`SPAN` 둘뿐이며, 목적지 글이 `<b>횡성</b>` 인 T7-0 의 C 칸 두 글이 T1-0 과 글자까지 같다.
- **E5.** 표 T 의 모든 줄에서 `#range-line` 글의 `약 ` 바로 뒤 숫자가 표의 M 이고 C 칸이 있는 줄에서는 C 칸 글의 `거리 약 M km` 숫자와 같으며, T1-0·T4-0·T6-0·T18-0·T21-0·T22-0 의 `#range-line` 글 전체가 3.3절 표와 글자까지 같다.
- **E6.** 표 T 의 모든 사례(T1~T22)에서 띄운 직후의 `loadErrors` 와 끝난 뒤의 `errors` 가 빈 목록이고 `fetch` 를 부른 주소가 0개이며 끝난 뒤 저장된 `routeKey` 가 사례의 값 그대로이고, 사례마다 결과가 정확히 하나씩 나온다(빠진 사례·겹친 사례 없음).

**표 T — 사례와 본 것.** `id-k` 의 k 는 0 = 띄운 직후, 1 이상 = 그 번째 걸음 뒤. 저장값은 `routeKey·soc·pos`(+ 더한 칸). 길이 `-` 는 받아 둔 길 없음. N `-` 는 C 칸 없음.

| id | 자료 | 길이 | 저장값 | 이 줄 앞의 걸음 | 칸 | N | M |
|---|---|---|---|---|---|---|---|
| T1-0 | one | 60 | navi·80·0 | - | P C | 60 | 176 |
| T2-0 | one | 60 | navi·80·10 | - | P C | 50 | 176 |
| T3-0 | one | 60 | navi·80·0 | - | P C | 60 | 176 |
| T3-1 | | | | `#pos` = `30`, `input` | C | 30 | 176 |
| T3-2 | | | | `#pos` = `30.4`, `input` | C | 30 | 176 |
| T3-3 | | | | `#pos` = `30.6`, `input` | C | 29 | 176 |
| T4-0 | one | 60 | navi·50·0 | - | P C | 60 | 95 |
| T5-0 | one | 175 | navi·80·0 | - | P C | 175 | 176 |
| T6-0 | one | 195 | navi·80·0 + margin 0 | - | P C | 195 | 195 |
| T7-0 | one, dest `<b>횡성</b>` | 60 | navi·80·0 | - | P C | 60 | 176 |
| T8-0 | one | 60 | navi·80·50 | - | C | 10 | 176 |
| T9-0 | broken | 60 | navi·80·0 | - | C | 60 | 176 |
| T10-0 | one | 60 | navi·80·60 | - | C | 0 | 176 |
| T11-0 | one | 300 | navi·80·0 | - | P RB | - | 176 |
| T12-0 | one | 176 | navi·80·0 | - | P RB | - | 176 |
| T13-0 | one | 196 | navi·80·0 + margin 0 | - | P RB | - | 195 |
| T14-0 | one | - | live-gb-down·80·0 | - | P RB | - | 176 |
| T15-0 | one | 60 | live-gb-down·80·0 | - | P RB | - | 176 |
| T16-0 | one | 300 | navi·80·50 | - | RN | - | 176 |
| T17-0 | one | - | live-gb-down·80·50 | - | RN | - | 176 |
| T18-0 | one | 60 | navi·10·60 | - | RN | - | 0 |
| T19-0 | two | 60 | navi·80·0 | - | P B | - | 176 |
| T20-0 | two | 300 | navi·80·0 | - | P B | - | 176 |
| T21-0 | one | 60 | navi·20·0 | - | RN | - | 14 |
| T21-1 | | | | `#soc` = `80`, `input` | P C | 60 | 176 |
| T22-0 | one | 60 | navi·80·0 + height 2.5 | - | P C | 60 | 176 |

줄마다 잡는 틀린 구현: T12(반올림한 숫자끼리 견줌), T6·T13(`>=` 를 `>` 로, 또는 문턱을 1 어긋나게), T18(0 으로 자른 값으로 견줌), T2·T3-1(남은 거리에서 위치를 안 뺌), T3-2·T3-3(N 을 올림·내림), T4·T6(M 을 다른 식으로 계산 — 잔량·여유가 달라도 `#range-line` 과 같아야 한다), T14·T15·T17(고속도로 노선에도 차분한 칸), T19(예비가 있는데도 차분한 칸), T8·T9·T10(추천 없음 갈래를 안 고침, 꼬리 문장을 늘 붙임), T16·T11(길찾기 노선이면 무조건 차분한 칸), T21-1(잔량을 바꿔도 칸이 안 바뀜), T22(`#range-line` 뒤쪽 글이 잘림), T7(목적지 이름이 글에 들어감).

고치기 전 코드로 같은 사례를 돌리면 C 가 있는 자리가 모두 빨간 칸이다: `P C` → `P RB`, `C` → `RN`(참조 `out_flow_old.txt`). `P RB`·`RN`·`P B` 줄은 고치기 전에도 같은 값이다.

요구사항 수용 기준과의 대응: 1번째 → T1-0, 2번째 → T3-1(위치 30)·T2-0, 3번째 → T11-0, 4번째 → T14-0·T15-0, 5번째 → T8-0·T9-0, 6번째 → T19-0·T20-0, 7번째 → E5, 8번째 → I2 와 지휘 스크립트의 전체 실행.

### 4.2 integration — 노선 바꾸기 흐름과 빌드

- 소스: `web/app.js`(더 고칠 것이 없는 것이 정상). 테스트: `tests/test_integration_enough.py` **하나뿐, 3,000자 이하.** 잠긴 `test_p0_node.run_node` 로 e1 의 도우미 `tests/test_e1_enough_reco.js` 에 사례 F1 하나를 넘겨 돌린다(새 JS 파일을 만들지 않는다).
- 사례 F1: 자료 `one`, 길이 60, 저장값 `live-gb-down·80·0`. 걸음 다섯은 표 F 의 차례대로.

**통과 기준**

- **I1.** 사례 F1 의 스냅숏 여섯(F1-0~F1-5)이 표 F 와 같다: 칸의 차례, C 칸이 있는 줄은 3.2절의 C 칸 글(N·M 은 표의 값, F1-1 은 꼬리 문장 있음·F1-2 와 F1-4 는 없음), C 칸이 없는 줄은 3.2절의 빨간 칸 글이고 `충전 없이` 가 없으며, `#range-line` 의 `약 ` 뒤 숫자가 표의 M 이고, `loadErrors`·`errors` 가 빈 목록이며 끝난 뒤 저장된 `routeKey` 가 `live-gb-down` 이다.
- **I2.** `tmp_path` 에 복사한 `web/`(`dist`·`test` 폴더 빼고)에서 `build.js` 를 돌리면 종료 코드 0 이고 만들어진 `dist/index.html` 에 `목적지까지 충전 없이 갈 수 있어요` 가 정확히 1번 들어 있으며 저장소의 `web/dist/` 파일 내용은 그대로이고, 전체 테스트 명령 `py -m pytest -q --tb=short -p no:cacheprovider` 가 실패 0 으로 끝난다.

**표 F — 한 화면에서 이어지는 흐름 (I1)**

| id | 이 줄 앞의 걸음 | 칸 | N | M |
|---|---|---|---|---|
| F1-0 | (고속도로 노선으로 띄움) | P RB | - | 176 |
| F1-1 | `#route-select` = `navi`, `change` | P C | 60 | 176 |
| F1-2 | `#pos` = `30`, `input` | C | 30 | 176 |
| F1-3 | `#soc` = `20`, `input` | RN | - | 14 |
| F1-4 | `#soc` = `80`, `input` | C | 30 | 176 |
| F1-5 | `#route-select` = `live-gb-down`, `change` | P RB | - | 176 |

- 노선을 바꾸면 앱이 위치를 0 으로 되돌린다(지금 동작). 그래서 F1-1 의 N 은 60, F1-5 는 다시 1순위 칸이 보인다.
- I2 의 "전체 테스트 명령이 실패 0"은 새 테스트로 다시 싸지 않는다(테스트 안에서 전체를 또 돌리지 않는다). 지휘 스크립트·검증·최종 검수가 그 명령을 돌려 본다. 새 테스트가 보는 것은 빌드 쪽이다.
- 고치기 전 코드로는 F1-1 이 `P RB`, F1-2·F1-4 가 `RN` 이다(참조 `out_flow_old.txt`).

## 5. 참조 구현 (`.orchestra/logs/ref_enough/`)

| 파일 | 내용 |
|---|---|
| `ref_patch.json` | `web/app.js` 의 글자 바꾸기 목록 넷(안전 거리 계산 줄, `renderReco` 부르는 줄, `renderReco` 머리 + 새 도우미 `enoughEl`, 예비 없음 갈래). 큰 파일을 통째로 쓰지 않는다 |
| `ref_flow.js` | `node ref_flow.js <프로젝트 폴더> [사례 JSON]` — 가짜 화면으로 그 폴더의 `web/` 을 띄워 표 T·F 의 본 것을 낸다. e1 테스트 도우미의 본보기 |
| `test_ref_enough.py` | 프로젝트를 임시 폴더 둘(old: 지금 그대로 / new: 바꾸기 적용)에 베껴 흐름·전체 테스트·빌드를 돌리는 드라이버 |
| `out_flow_old.json`·`.txt`, `out_flow_new.json`·`.txt` | 고치기 전·후에 본 것(`.txt` 는 한 줄 요약) |
| `out_locked_old.txt`·`out_locked_new.txt`, `out_build.txt`, `out_info.txt` | 전체 테스트 끝부분, 빌드 결과, `app.js` 줄 끝 |
| `test_ref_keep_plan.py`, `out_chars.txt` | 앞 단계 계획서 옮기기, 이미 있는 `tests/test_integration_*` 글자 수 |
| `test_ref_make_plan_json.py`, `test_ref_plan_check.py` | 이 계획서의 통과 기준 문장을 글자 그대로 뽑아 `.orchestra/outbox/plan.json` 을 만들고, 표 T·F·3.2·3.3 을 참조 출력과 대조 |

돌린 결과(계획 세션, 2026-11-17):

- 드라이버: `py -m pytest -q --tb=short -p no:cacheprovider .orchestra/logs/ref_enough/test_ref_enough.py` → 5 passed(흐름 old·new, 전체 테스트 old·new, 빌드).
- 전체 테스트: 작업 트리 **1949 passed**. 복사본 old **1948 passed, 1 failed** = 복사본 new **1948 passed, 1 failed**(같은 한 개, 3.1절).
- 빌드: 바꾸기를 적용한 `web/` 을 임시 폴더에서 빌드하면 종료 코드 0, `dist/index.html` 에 새 굵은 글 1번(`out_build.txt`).
- 계획서 자기 검사: `test_ref_make_plan_json.py`·`test_ref_plan_check.py` → 4 passed(plan.json 의 문장이 이 계획서 글자 그대로, 표 T 26줄·표 F 6줄·3.2·3.3절의 글이 참조 출력과 같음, 칸이 `P RB`·`RN`·`P B` 인 줄은 고치기 전 출력과 통째로 같음).
- 참조 첫 실행에서 잡은 것: 손으로 잡았던 "위치 30 에서도 1순위가 보인다"가 틀렸다(기흥휴게소가 길 위 26.1 km 라 위치 30 이면 이미 지났다) → T2 를 위치 10 으로 바꾸고 T3-1 은 `C` 로 적었다.
- **돌려 보지 않은 것:** 실제 브라우저·폰에서의 색(가짜 화면은 `style` 속성의 글자만 본다), 실제 카카오 길찾기 응답으로 만든 노선(받아 둔 길을 손으로 지었다), new 를 진짜 저장소(`.git` 있음)에 적용한 전체 테스트.

참조 고침의 뼈대:

```js
// render 안
const safeRaw = EV.conservative_range_km(v) - v.min_arrival_soc_pct * EV.km_per_pct(v);
const safeKm = Math.max(0, Math.round(safeRaw));
const leftRaw = r.navi === true ? r.length - state.pos : null;
const enough = leftRaw !== null && safeRaw >= leftRaw ? { left: Math.round(leftRaw), safe: safeKm } : null;
$("#range-line").textContent = `안전하게 갈 수 있는 거리 약 ${safeKm}km ` + /* 뒤는 지금 그대로 */;
renderReco(result, enough);

function enoughEl(enough, hasPrimary) {
  return h("div", { class: "none", "data-tone": "good", style: "background: var(--good-soft); color: var(--good)" },
    h("b", { text: "목적지까지 충전 없이 갈 수 있어요" }),
    h("span", { text: `남은 거리 약 ${enough.left} km · 안전하게 갈 수 있는 거리 약 ${enough.safe} km.` + (hasPrimary ? " 1순위는 들르고 싶을 때 참고하세요." : "") }));
}
// renderReco(result, enough): 추천 없음 → enough ? enoughEl(enough, false) : 지금의 RN 칸
//                             예비 없음 → enough ? enoughEl(enough, true) : 지금의 RB 칸
```

## 6. 세션별 귀띔

- 첫 응답의 도구 호출은 지시문 Read 하나, 둘째는 `.orchestra/memory/lessons.md` Read 하나. `00_위키` 는 열지 않는다.
- bash 는 명령 하나씩. `node …` 를 셸에서 바로 치지 않는다 — pytest 안의 `run_node`·`subprocess` 로 돌린다.
- 개발 세션: `web/app.js` 는 Edit 로 네 곳만 고친다. 주석에 `<b>` 같은 꺾쇠 태그를 적지 않는다(3.1). `style.css` 는 열어도 고치지 않는다. 끝나기 전에 `.orchestra/logs/dev_e1_enough.md` 를 쓴다.
- 테스트 세션(e1): JS 도우미는 참조 `ref_flow.js` 를 옮기되 프로젝트 폴더는 `path.join(__dirname, "..")`, 사례는 `process.argv[2]` 의 JSON 으로 받는다. 파이썬 쪽은 잠긴 `tests/test_integration_rawbase.py` 와 같은 꼴(표 → node 한 번 → 줄마다 `parametrize`). 표 T 의 줄 수(26)와 사례 수(22)를 세는 확인을 둔다.
- 테스트 세션(integration): 파일 하나, 3,000자 이하. docstring 은 짧게. 글자 수는 `len(파일.read_bytes().decode("utf-8"))` 로 센다.
- 검증·최종 검수: 탐침은 참조 `ref_flow.js` 에 프로젝트 폴더를 인자로 주면 제품 `web/app.js` 로 같은 표가 나온다. 새 clone 에서도 전체 테스트를 한 번 돌리고, 저장소의 `web/dist/` 에서 새 글의 글자를 센다(2.0 의 3번).

## 판정 보완 (지휘 스크립트가 자동으로 붙임)
- [e1_enough] 판정(e1_enough 테스트 라운드 1): K1 의 '남은 거리도 반올림 전 값으로 견준다'를 잠그기 위해 표 T 에 사례 둘(줄 여섯)을 더한다 — T23: 자료 one·길이 176·저장값 navi·80·0, T23-0 은 P RB(M 176), 걸음 `#pos` = `0.4` input 뒤 T23-1 은 P RB(M 176, 남은 거리 175.6 > 안전 거리 175.5), 걸음 `#pos` = `0.6` input 뒤 T23-2 는 P C(N 175, M 176, 남은 거리 175.4).
- [e1_enough] 판정(e1_enough 테스트 라운드 1): T24: 자료 one·길이 196·저장값 navi·80·0 + margin 0, T24-0 은 P RB(M 195), 걸음 `#pos` = `0.6` input 뒤 T24-1 은 P RB(M 195, 남은 거리 195.4 > 안전 거리 195 — 화면 숫자 N 은 195 로 같아 보여도 빨간 칸), 걸음 `#pos` = `1` input 뒤 T24-2 는 P C(N 195, M 195).
- [e1_enough] 판정(e1_enough 테스트 라운드 1): 이 보강으로 표 T 는 사례 24개(T1~T24)·32줄이 되고, 통과 기준 E1 의 `P C` 줄에 T23-2·T24-2 가, E3 의 `P RB` 줄에 T23-0·T23-1·T24-0·T24-1 이 더해지며, E6 의 '모든 사례(T1~T22)'는 T1~T24 로 읽는다(6절 귀띔의 '줄 수 26·사례 수 22'도 32·24).
- [e1_enough] 판정(e1_enough 테스트 라운드 1): 줄마다 잡는 틀린 구현 — T23-1(남은 거리를 내림해 견줌), T23-2(남은 거리를 올림하거나 안전 거리를 내림해 견줌), T24-1(화면에 내는 N = 반올림한 남은 거리를 견줌에 다시 씀, 또는 내림).
