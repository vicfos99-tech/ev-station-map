# ev-app-relay 계획서 — 충전 길잡이 앱이 공공 데이터를 중계에서 읽게 바꾸기

작성: 2026-11-17 계획 세션. 출처 요구사항: `specs/ev-app-relay.md`. 파일 모양: `ref/relay_format.md`, 견본 `ref/relay_sample/`.
교훈 반영: `.orchestra/memory/lessons.md` 의 '공통'·'계획'.
앞 단계(충전소 고르기 엔진) 계획서는 `docs/plan_stage1.md` 로 옮겨 두었다(잠긴 테스트가 "plan.md N행"으로 가리키는 것은 그 파일이다).

## 0. 실행 환경 (가장 먼저 확인)

| 항목 | 값 |
|---|---|
| 실행 PC 파이썬 | **Python 3.10.0**. `requires-python >=3.10` 그대로. 3.11 전용(`tomllib`·`StrEnum`·`datetime.UTC`·`typing.Self`)은 쓰지 않는다 |
| 실행 PC node | **v24.19.0** (계획 세션이 pytest 안에서 `node --version` 으로 확인). 외부 패키지 없음(`npm install` 없음) |
| 테스트 명령(글자 그대로) | `py -m pytest -q --tb=short -p no:cacheprovider` |
| node 를 돌리는 법 | **pytest 안의 `subprocess` 로만.** 세션에서 `node …` 를 바로 치면 승인이 안 난다(계획 세션에서 거부됨) |
| 고치는 소스 | `web/relay.js`(새 파일), `web/app.js`, `web/index.html`, `web/build.js` 넷뿐 |
| 고치지 않는 것 | `web/engine.js`·`live_build.js`·`around.js`·`navi.js`·`data.js`·`regions.js`·`live.js`·`style.css`, `web/test/` 전부, `src/`, `tests/test_p1_…`~`test_p7_…`(잠김), `ref/` |
| 테스트 위치 | `tests/test_<부분 id>_…` 만. `tests/data/`·`conftest.py` 는 만들지 않는다 |
| 파일 인코딩 | 모두 UTF-8 |

- **부분 id 는 앞 단계(`p1_models`~`p7_integration`)와 겹치지 않게** `p0`, `r1_settings`~`r6_text`, `integration` 으로 한다. 새 테스트 파일은 모두 `tests/test_p0_`·`tests/test_r1_settings_`…·`tests/test_integration_` 로 시작한다(잠긴 `tests/test_p7_integration_basic.py` 와 이름이 다르다).
- 테스트 세션은 `web/` 을 고칠 수 없고, 자기 부분 이름으로 시작하는 `tests/` 파일만 만든다. 시험 자료는 테스트 파일 안에 글자로 넣거나 `tests/test_<부분>_data_*.json` 으로 둔다. `ref/relay_sample/` 의 견본은 **읽기만** 해도 된다(저장소에 든 파일이다).
- **부분마다 `tests/test_<부분>_` 파일을 다 합쳐 45000자 이하.** 같은 모양 사례는 표(배열)로 묶는다.
- **저장소 안에 산출물을 만들지 않는다.** 빌드 시험은 `web/` 을 `tmp_path` 에 베껴 거기서 돌린다(`web/dist/` 를 건드리지 않는다). 테스트·검증 세션은 프로젝트 폴더에서 `node web/build.js` 를 돌리지 않는다.
- `web/relay.js` 는 한 파일을 p0·r1~r6 일곱 부분이 차례로 채운다. 그래서 **의존을 한 줄로 세웠다**(p0 → r1 → r2 → r3 → r4 → r5 → r6 → integration). 앞 부분 테스트는 그 파일에 대해 **끝까지 참인 것만** 단언한다: "이 이름이 있다"는 되지만 "내보내는 이름이 이것뿐이다"·"줄 수가 몇이다"는 안 된다.

## 1. 개요

집 PC 의 중계가 공공 데이터를 받아 정적 파일(`meta.json`·`routes.json`·`stations/…`·`status/…`)로 올려 두고, 앱은 그 파일을 **읽기만** 한다. 앱은 데이터 받는 곳만 바꾸고, 폰이 직접 받는 지금 방식은 예비로 남긴다.

새 코드는 `web/relay.js`(브라우저 전역 `EvRelay`, Node 에서는 `require`)에 **순수 함수**로 모은다. 네트워크(`fetch`)·시각(`now`)·저장소(`storage`)·직접 받기(`direct`)는 모두 인자로 받는다. `app.js` 는 부르는 곳만 바꾼다.

| id | 이름 | 소스 | 의존 | 하는 일 |
|---|---|---|---|---|
| `p0` | 테스트 틀 | `web/relay.js`(틀) | - | pytest 에서 node 를 부르는 도우미, 가짜 fetch, `relay.js` 의 빈 틀과 상수 |
| `r1_settings` | 설정과 주소 | `web/relay.js` | p0 | 기본 중계 주소, 주소 검사, 켜기/끄기·주소 저장 |
| `r2_fresh` | 시각과 신선함 | `web/relay.js` | r1 | 한국 시각 읽기, 확인 시각, 15분·30분 규칙, 안내 글 |
| `r3_read` | 읽기와 모양 검사 | `web/relay.js` | r2 | 파일 주소 만들기, 받아 오기, 다섯 가지 파일 모양 검사 |
| `r4_rest` | 휴게소 새로 받기 | `web/relay.js` | r3 | `meta`→`routes`→`status/rest` 를 읽어 노선 자료 만들기, 실패하면 직접 받기 |
| `r5_around` | 지도 주변 충전소 | `web/relay.js` | r4 | 시군구 `stations`+`status` 로 `EvAround` 와 같은 모양 만들기, 상태만 다시 읽기 |
| `r6_text` | 글자 안전 | `web/relay.js` | r5 | 이스케이프, 지도 풍선·팝업 html 만들기 |
| `integration` | 앱 연결과 통합 흐름 | `web/app.js`, `web/index.html`, `web/build.js` | r6 | 설정 화면, 새로 받기·지도를 `EvRelay` 로 잇기, 가짜 화면으로 흐름 전체 확인, 빌드 |

## 2. 결정 목록 — 묘성이 정할 것

### 2.0 묘성이 정할 것 (맨 위부터 중요한 순)

1. **오래됨을 재는 기준 시각(N1).** 요구사항은 "상태 파일의 `at`"이라고 했지만, `ref/relay_format.md` 규칙 1 은 "`at` 은 마지막으로 다시 쓴 시각일 뿐이고 신선함은 `meta.json` 으로 본다"고 적는다. 이 계획은 규칙 1 을 따랐다. 그대로 둘지.
2. **⚠ 15분(안내)·30분(빈자리로 세지 않음)·3분(지도 상태 다시 읽기)** — `relay.js` 맨 위 `NOTE_MIN`·`DROP_MIN`, `app.js` 의 `AR_STATUS_MIN`. 중계가 10분마다 올리므로 한 번 걸러도(20분) 안내만 뜨고, 세 번 거르면(30분 넘음) 세지 않는다.
3. **`routes.json` 의 충전기에 id 가 없다(N4).** 급속·완속이 섞인 휴게소 충전소는 어느 상태가 어느 충전기인지 알 수 없어 통째로 '미확인'이 된다. 중계가 `routes.json` 충전기에 `id` 를 넣어 주면 풀린다 — 중계 쪽을 고칠지.
4. **고른 노선만 받는다(N3).** 다른 노선으로 바꾸면 "이 노선의 상태는 아직 받지 않았어요" 안내가 뜨고 '새로 받기'를 눌러야 한다. 노선을 바꿀 때 저절로 받게 할지.
5. **'상태 미확인'을 화면에 어떻게 보일지(N13).** 지금은 기존 앱이 stat 9 를 그리는 방식(`comm_error` → '고장·점검'으로 셈) 그대로다. '미확인'을 따로 보일지.
6. **배포 쪽(이 실행 범위 밖).** `.github/workflows/pages.yml` 이 `relay-data` 브랜치 내용을 `_site/relay/` 에 넣고 그 브랜치에 올릴 때도 배포되게 하는 일, `web/dist/` 다시 만들기(`node web/build.js`)·push 는 실행 뒤 대화에서 한다.
7. 작업 트리의 `.github/workflows/ci.yml` 이 커밋되지 않은 채 바뀌어 있다(JS 대조 단계가 지워짐). 이 실행은 건드리지 않는다. 새 pytest 는 node 가 있어야 돈다(GitHub ubuntu 러너에는 기본으로 있다).

### 2.1 요구사항과 다름

| # | 요구사항 | 이 계획 | 잃는 것 / 얻는 것 |
|---|---|---|---|
| N1 | 상태 파일의 `at` 과 지금의 차이로 15분·30분을 잰다 | **확인 시각**으로 잰다: `meta.json` 이 보증하면(`ok` 가 참, 시군구 파일은 `zcodes` 가 모두 `fresh` 에 있을 때) `meta.at` 과 파일 `at` 중 늦은 쪽, 아니면 파일 `at` (r2 `trustAt`) | 얻음: 3시간째 아무도 안 쓴 충전소가 '미확인'으로 바뀌지 않는다(파일 `at` 은 바뀐 게 없으면 안 움직인다). 잃음: 중계가 살아 있는데 그 충전소 상태만 못 받고 있는 경우를 못 가린다(중계가 `ok`·`fresh` 로 알려 줘야 한다) |
| N2 | 읽기 실패(연결·404·모양 틀림)면 직접 받기 | `meta.json`·`routes.json`·시군구 파일은 그대로. **휴게소 상태 파일 하나의 404 는 실패가 아니라 그 충전소만 미확인**(받으려던 파일이 전부 404 면 실패) | 파일 하나가 없다고 전체가 직접 받기(10~30초, 키 필요)로 넘어가지 않는다. 화면에 "충전소 N곳은 상태 파일이 없어 미확인이에요." |
| N3 | 지금 노선에 든 휴게소의 상태를 덮어쓴다 | 그대로. 그 결과 **다른 노선은 목록을 받은 때의 상태**라서 30분 규칙에 걸려 미확인이 되고, 노선을 바꾸면 안내 글이 뜬다 | 2.0-4 |
| N4 | 상태를 덮어쓴다 | `routes.json` 충전기에 id 가 없어서: 그 충전소 충전기가 **한 종류뿐이고 상태 수 ≤ 충전기 수**일 때만 `chgerId` 순서대로 앞에서부터 채우고(모자란 것은 미확인), 섞였거나 상태가 더 많으면 그 충전소 전부 미확인 | 빈자리를 실제보다 많게 세지 않는다. 섞인 충전소의 상태를 잃는다 |
| N5 | "언어는 파이썬"(지시문) | 고치는 것은 자바스크립트다. 파이썬은 테스트 틀(pytest → node)뿐. `plan.json` 의 `src_files` 는 `web/*.js`·`index.html` | - |
| N6 | `app.js` 는 부르는 곳만 바꾼다 | 지도 풍선·팝업의 html 만드는 글틀을 `app.js` 에서 `relay.js` 로 옮긴다(길 위 충전소 풍선 포함). 보통 글자에서는 **만들어지는 html 이 지금과 글자 하나까지 같다**(참조 대조) | 풍선 html 을 node 로 시험할 수 있다 |
| N7 | `node build.js` | 실제 파일은 `web/build.js`. 테스트는 임시 폴더에 베껴 `node <임시>/web/build.js`. 저장소의 `web/dist/` 는 이 실행이 다시 만들지 않는다 | 테스트가 저장소 파일을 바꾸지 않는다 |
| N8 | 바꾼 주소는 `https://` 로 시작해야 한다 | 더 좁힘: 빈칸·따옴표·꺾쇠·`?`·`#`·`@` 가 든 주소, 사이트 이름이 없는 주소도 거부 | 주소에 키·비밀번호가 실려 저장되는 것을 막는다 |
| N9 | 기본 주소는 페이지 주소 기준 `./relay/` | 페이지가 `http://`(PC 에서 시험)면 기본 주소도 `http://…/relay/`. "https 로 시작" 은 사람이 바꾼 주소에만 건다 | - |
| N10 | (없음) | 중계 읽기는 **다시 시도하지 않는다**(한 번 실패하면 예비 규칙). 직접 받기는 지금처럼 세 번 | 단순함. 순간 끊김에 직접 받기로 넘어갈 수 있다 |
| N11 | 지도 상태 실패는 2 와 같은 예비 규칙 | 받아 둔 시군구의 상태 다시 읽기가 실패하고 키가 있으면 **그 시군구를 직접 받기로 통째로 다시 받는다**(수 MB). 그 뒤 그 시군구는 지금 방식(바뀐 것만)으로 간다 | 중계와 직접 받기의 상태를 섞지 않는다 |
| N12 | 30분 넘으면 빈자리로 세지 않는다 | 받을 때뿐 아니라 **화면을 다시 그릴 때마다**(1분마다, 앱을 다시 열 때, 지도를 다시 그릴 때) 확인 시각을 다시 재어 30분이 넘었으면 미확인으로 바꾼다 | 받아 놓고 40분 켜 둔 화면이 옛 빈자리를 보이지 않는다 |
| N13 | 상태 미확인으로 본다 | 미확인 = 충전기 상태 `"comm_error"`. 기존 앱이 stat 9(상태 미확인)를 그리는 값과 같다. 새 표시는 만들지 않는다 | 화면에는 '고장·점검'으로 세어진다(2.0-5) |

### 2.2 비워 둔 곳을 채움

| # | 정한 것 |
|---|---|
| D1 | "넘으면"은 **초과**다. 정확히 15분 0초 0밀리초는 안내 없음, 1밀리초 넘으면 안내. 30분도 같다 |
| D2 | 확인 시각이 폰 시계보다 앞서 있으면: 5분(`FUTURE_MIN`) 이하는 0분 전으로 보고, 5분을 넘으면 시각을 모르는 것으로 보아 빈자리를 세지 않는다 |
| D3 | stat 코드: `1`→comm_error, `2`→available, `3`→charging, `4`→out_of_service, `5`→maintenance, `9`→comm_error, **그 밖·없음·글자가 아님 → comm_error** |
| D4 | 충전기 `type` 이 `"fast"` 가 아니면 모두 `"slow"`(모르는 종류를 빈 급속으로 세지 않는다). `routes.json` 의 `status` 가 아는 다섯 가지가 아니면 comm_error |
| D5 | 주변 충전소 요금: 앱의 요금표(`config.tariffs`)에 업체가 있으면 그 값, 없으면 `default`, 요금표가 없으면 `null`(팝업에서 요금을 뺀다) |
| D6 | 휴게소 상태 파일은 한 번에 최대 6개(`POOL`)까지 같이 받는다 |
| D7 | 중계 fetch 는 `fetch(url, { cache: "no-cache" })` 한 가지 모양(늘 서버에 새 것인지 물어본다) |
| D8 | 저장 열쇠: `ev-charge-planner/relay`(`"on"`/`"off"`, 정확히 `"off"` 일 때만 끔), `ev-charge-planner/relay-base` |
| D9 | 화면 요소 id: `#relay-form`·`#relay-on`(체크박스)·`#relay-base`·`#relay-msg` |
| D10 | 받은 자료에 표식 `live.relay = {at, ok, ids, missing, mixed, oldest}` 를 단다. 이 표식이 있는 자료에만 30분 규칙을 건다(직접 받은 자료는 지금과 같다) |
| D11 | `suspect` 에 그 시군구의 지역 코드(앞 두 자리 또는 `zcodes`)가 있으면 지도에 "이 지역은 충전소 목록을 확인하는 중이라 빠진 곳이 있을 수 있어요." |
| D12 | 중계에서 받은 주변 충전소에는 주소(`addr`)가 없다 → 빈 글. `indoor`(건물 안)는 그대로 실어 준다(지금 지도는 쓰지 않는다) |

### 2.3 막지 못함·돌려 보지 않음

| # | 내용 |
|---|---|
| M1 | 실제 GitHub Pages 에서의 캐시(10분)·CORS·안드로이드 웹뷰 동작은 **돌려 보지 않음**. 폰에서 확인할 것 |
| M2 | `status/rest/<id>.json` 의 id 가 `routes.json` 충전소 `id` 와 늘 같은지(같은 충전소가 두 휴게소에 나와 `-2` 가 붙은 id) **미확인**. 다르면 그 충전소는 404 → 미확인(N2) |
| M3 | 중계가 모든 시군구를 올리는지 미확인. 없는 시군구는 404 → 키가 있으면 직접 받기, 없으면 안내 글 |
| M4 | 나들목 인근 충전소는 중계에 없다(`relay_format.md` 규칙 4). PC 에서 만든 옛 상태가 지금처럼 그대로 옮겨지고 **30분 규칙이 닿지 않는다**(기존 동작. 화면에 "나들목 인근 충전소는 '새로 받기'로 갱신되지 않고…" 안내가 이미 있다) |
| M5 | 한국 밖 좌표를 막지 않는다(위도 ±90·경도 ±180·(0,0) 만 본다) |
| M6 | fetch 에 시간 제한이 없다(지금의 직접 받기와 같다). '새로 받기'는 취소 단추가 있다 |
| M7 | 폰 시계가 **느리면** 낡은 상태를 새 것으로 본다. 막지 못함 |
| M8 | `app.js` 는 가짜 화면(가짜 요소·가짜 Leaflet)으로만 돌려 본다. 실제 화면 배치·지도 그리기는 폰에서 확인 |
| M9 | `meta.fresh`·`suspect` 의 뜻은 `relay_format.md` 글자대로 읽었다. 중계가 다르게 채우면 N1 의 보증이 어긋난다 |
| M10 | 참조 구현으로 **돌려 본 것**: r1~r6 의 모든 표, 통합 흐름 S1~S8, 임시 폴더 빌드. **돌려 보지 않은 것**: p0 의 자기 시험(도우미가 틀린 JS 를 어떻게 알리는지)은 쓰는 쪽에서만 확인함 |

## 3. 공통 규칙

- **C1 중계를 끄면 지금과 같다.** `settings.on` 이 거짓이면 `EvRelay` 는 중계 주소를 한 번도 부르지 않고, 직접 받기 함수(`direct`)를 그대로 부르고, 그 결과·예외를 **같은 객체 그대로** 돌려준다. 통합에서는 고치기 전 `app.js` 와 부른 주소·화면 글·풍선 html 이 글자 하나까지 같아야 한다.
- **C2 오래된·모르는 것은 빈자리로 세지 않는다.** 미확인은 `"comm_error"`. 상태 파일에 없는 충전기, 모르는 stat, 30분 넘은 것, 시각을 모르는 것 모두.
- **C3 키·주소를 오류 글·기록에 넣지 않는다.** `RelayError` 의 `message` 는 3.2 표의 고정된 글(와 상태 코드 숫자)뿐이다. 받은 주소·파일 내용·입력한 글자를 넣지 않는다. `console.log`·`console.error` 를 부르지 않는다. 예외를 바꿔 던질 때는 **catch 블록 밖에서** 새 예외를 던진다(`cause` 를 달지 않는다).
- **C4 순수 함수.** `relay.js` 는 `Date.now()` 를 `now` 인자가 없을 때만 쓰고, `localStorage`·`document`·`window.location` 을 스스로 읽지 않는다(모두 인자). 다른 파일을 `require` 하지 않는다.
- **C5 입력을 바꾸지 않는다.** `parse…`·`buildLive`·`regionStations` 는 받은 객체를 고치지 않고 새 객체를 만든다. 고치는 함수는 이름으로 알 수 있는 셋뿐이다: `expire`·`expireLive`·`overlayRegion`(과 그것을 부르는 `refreshRegion`).
- **C6 모르는 칸은 무시**하고(새 객체에 옮기지 않는다), `v` 가 1 이 아니면 읽지 않는다. 상태 파일 둘(`status/<zscode>.json`·`status/rest/…`)에는 `v` 가 없다 — 없으면 통과, 있는데 1 이 아니면 거부.
- **C7 테스트 틀.** 부분마다 `tests/test_<부분>_relay.js` 가 확인을 모아 마지막에 `RESULT {…}` 한 줄을 찍고, `tests/test_<부분>_relay.py` 가 `run_js` 로 읽어 **확인 하나를 pytest 테스트 하나로**(`parametrize`) 보이고, "JS 가 낸 확인 이름 집합 == 파이썬이 아는 이름 집합"도 테스트한다(JS 가 조용히 건너뛴 확인을 잡는다).

### 3.1 상수 (모두 `relay.js` 맨 위 한 곳)

| 이름 | 값 |
|---|---|
| `ANDROID_BASE` | `"https://vicfos99-tech.github.io/ev-station-map/relay/"` — 이 글자(`vicfos99-tech.github.io`)는 `relay.js` 에 **딱 한 번**, `app.js`·`index.html` 에는 0번 |
| `NOTE_MIN` / `DROP_MIN` / `FUTURE_MIN` / `POOL` | 15 / 30 / 5 / 6 |
| `KEY_ON` / `KEY_BASE` | `"ev-charge-planner/relay"` / `"ev-charge-planner/relay-base"` |
| `NOTE_FALLBACK` | `"중계에 연결하지 못해 직접 받았어요"` |
| `NOTE_SUSPECT` | `"이 지역은 충전소 목록을 확인하는 중이라 빠진 곳이 있을 수 있어요."` |

### 3.2 글 (글자 그대로)

| 어디서 | 글 |
|---|---|
| `RelayError("network")` | `중계에 연결하지 못했어요` |
| `RelayError("missing")` (404) | `중계에 파일이 없어요` |
| `RelayError("http")` (그 밖의 상태 코드 N, 모르면 0) | `` `중계가 ${N} 로 답했어요` `` |
| `RelayError("shape")` | `중계 파일을 읽지 못했어요` |
| `RelayError("bad_base")` / `("bad_id")` / `("bad_kind")` | `중계 주소가 맞지 않아요` / `중계 파일 이름이 맞지 않아요` / `모르는 중계 파일이에요` |
| `RelayError("no_key")` / `("no_direct")` | `인증키가 필요해요` / `직접 받기 설정이 없어요` |
| `RelayError("relay_failed")` | `` `${앞의 실패 글}. 공공 데이터 키를 넣으면 직접 받을 수 있어요.` `` |
| 주소 검사 | `주소는 https:// 로 시작해야 해요.` / `주소 모양이 맞지 않아요. https://사이트/폴더/ 처럼 적어 주세요.` / (저장 실패) `이 화면에서는 저장되지 않습니다. 크롬이나 삼성 인터넷으로 열어 주세요.` |
| 오래됨 | `` `${A} 상태예요.` `` / `` `${A} 상태라 빈자리를 세지 않았어요.` `` / `상태 시각을 알 수 없어 빈자리를 세지 않았어요.` — A 는 `18분 전`(60분 미만), `2시간 전`(1440분 미만), `3일 전` (모두 내림) |
| 중계 실패 까닭 | `중계가 마지막 받기에 실패했어요.` / `` `중계가 마지막 받기에 실패했어요(${까닭}).` `` |
| 휴게소 받기 | `` `충전소 ${n}곳은 상태 파일이 없어 미확인이에요.` `` / `` `충전소 ${n}곳은 충전기 목록이 달라 미확인이에요.` `` |
| 노선 안내 | `이 노선의 상태는 아직 받지 않았어요. '새로 받기'를 눌러 주세요.` |

## 4. 표준 자료

견본은 `ref/relay_sample/` 그대로 쓴다(지어낸 자료). 시각:

| 이름 | 한국 시각 | 밀리초 | 어디에 |
|---|---|---|---|
| T_LAST | 2026-01-05 08:30:00 | 1767569400000 | 충전기 `last_end`·`lastTedt` |
| T_LIST | 09:00:00 | 1767571200000 | `routes.json` 의 `fetched_at`·`updated`, `status/41135.json`·`status/rest/KP000102.json` 의 `at` |
| T_REST1 | 09:05:00 | 1767571500000 | `status/rest/KP000101.json` 의 `at` |
| T_META | 09:10:00 | 1767571800000 | `meta.json` 의 `at` (`ok` 참, `fresh` `["41"]`, `suspect` `["29"]`) |
| **NOW0** | 09:12:00 | 1767571920000 | 표준 '지금' |

- `routes.json`: 노선 둘. `live-gb-down` 의 기흥휴게소에 `KP000101`(급속 100kW 둘: available·charging), `live-gb-up` 의 기흥휴게소에 `KP000102`(급속 200kW 하나: available).
- `status/rest/KP000101.json`: 충전기 `01`·`02` 모두 stat `3`. `status/rest/KP000102.json`: `01` stat `2`.
- `stations/41135.json`(`zcodes` `["41"]`): `ME000201`(환경부, `01` 급속 50kW·`02` 완속 7kW, 좌표 37.38012,127.11854), `ME000202`(한국전력, `01` 급속 350kW, `indoor`). `status/41135.json`: `ME000201` `01`→`2`·`02`→`3`, `ME000202` `01`→`9`.

## 5. 부분별 계획

아래 값은 모두 참조 구현(`.orchestra/logs/ref_relay/relay.js`)을 돌려 나온 출력(`ref_values_out.txt`·`scenario_out.json`)에서 옮겼다. 표에 없는 사례의 답이 궁금하면 그 파일을 본다.

### p0 — 테스트 틀

**만드는 것(테스트 세션):** `tests/test_p0_node.py`, `tests/test_p0_fake.js`, 그 둘을 시험하는 `tests/test_p0_relay.py`·`tests/test_p0_relay.js`. 참조: `.orchestra/logs/ref_relay/test_p0_node.py`·`test_p0_fake.js`(그대로 옮겨 써도 된다). **개발 세션:** `web/relay.js` 의 틀.

`tests/test_p0_node.py` (뒤 부분 테스트가 `from test_p0_node import run_js` 로 쓴다 — `tests/` 에 `__init__.py` 가 없어 그 이름으로 import 된다):
- `run_node(args, cwd=None, timeout=180) -> (종료 코드, 표준 출력, 표준 오류)` — `subprocess.run(["node", …], capture_output=True)`, 글자는 UTF-8(`errors="replace"`).
- `run_js(name, args=(), cwd=None) -> {확인 이름: {"ok": bool, "detail": str}}` — `tests/<name>`(절대 경로를 주면 그 파일)을 node 로 돌려 표준 출력에서 `RESULT ` 로 시작하는 **마지막 줄**의 JSON(`{"checks":[{"name","ok","detail"}]}`)을 읽는다. 종료 코드가 0 이 아니거나 `RESULT` 줄이 없으면 `AssertionError`(표준 오류 끝부분을 글에 붙인다).
- 이 파일 안에 `test_` 로 시작하는 함수를 두지 않는다(도우미만. 시험은 `test_p0_relay.py` 에).

`tests/test_p0_fake.js` (`require("./test_p0_fake.js")`):
- `check(name, cond, detail)`, `eq(name, got, want)`(JSON 글자로 견줌), `throws(name, fn, code)`, `await rejects(name, fn, code)`(던진 것의 `.code` 를 본다. 던진 것을 돌려준다), `finish()`(`RESULT {…}` 한 줄. 두 번 불러도 한 번만), `show(v)`.
- 같은 이름으로 `check` 를 두 번 부르면 `"<이름> (이름 겹침)"` 실패 확인이 더해진다. 잡히지 않은 오류·거절은 실패 확인 `잡히지 않은 오류`·`잡히지 않은 거절` 로 바뀌고 `RESULT` 를 찍은 뒤 종료 코드 0 으로 끝난다.
- `makeFetch(files, {base, delay})` → `fetch` 처럼 부르는 함수. `files` 의 열쇠는 `base` 를 뗀 뒷부분 또는 주소 전체, 값은 객체(JSON, 200)·글(그대로, 200)·숫자(그 상태 코드, `ok` 는 200~299)·`DOWN`(`TypeError` 로 거절)·함수(url → 앞의 것 중 하나). **없는 주소는 404.** `f.calls()`(부른 주소), `f.inits()`(둘째 인자), `f.maxActive()`(동시에 열려 있던 최대 수).
- `makeStorage(init, fail)` → `getItem`/`setItem`/`removeItem`, `dump()`, `log()`(`["set", 열쇠, 값]`·`["remove", 열쇠]`). `fail` 에 `"get"`·`"set"`·`"remove"` 가 있으면 그 동작이 던진다.

`web/relay.js` 틀:
- 맨 앞이 `around.js` 와 같은 꼴: Node 에서는 `module.exports`, 아니면 `root.EvRelay`. `"use strict"`.
- 3.1 의 상수와 `RelayError` 를 내보낸다. `new RelayError("shape", "글")` → `instanceof Error`, `.name === "RelayError"`, `.code === "shape"`, `.message === "글"`; 글을 안 주면 `.message === 코드`.

통과 기준:
1. `run_js("test_p0_relay.js")` 가 딕셔너리를 주고, 실패한 확인은 `ok` 가 거짓으로 온다(예외가 아니다). 일부러 틀린 확인 하나·맞는 확인 하나를 둔 임시 JS(`tmp_path` 에 쓰고 절대 경로로 `test_p0_fake.js` 를 require)로 본다.
2. `RESULT` 를 찍지 않는 JS, 없는 JS → `AssertionError`. 중간에 `throw` 하는 JS → 결과에 `잡히지 않은 오류` 가 `ok=False` 로 있다. 같은 이름 두 번 → `(이름 겹침)` 실패.
3. `makeFetch`: 객체 → `ok` 참·`status` 200·`await r.text()` 가 JSON 글, 글 → 그대로, `503` → `ok` 거짓·`status` 503, `204` → `ok` 참, `DOWN` → `TypeError` 거절, 함수 값, 없는 주소 → 404, `base` 를 뗀 열쇠와 주소 전체 열쇠 둘 다 됨, `calls()` 순서, `inits()` 에 둘째 인자, `delay: 5` 로 셋을 같이 부르면 `maxActive() === 3`.
4. `makeStorage`: 넣고 읽기, `log()` 순서, `fail` 세 가지.
5. `require("../web/relay.js")` 가 객체이고 `ANDROID_BASE === "https://vicfos99-tech.github.io/ev-station-map/relay/"`, `NOTE_MIN === 15`, `DROP_MIN === 30`, `FUTURE_MIN === 5`, `POOL === 6`, `KEY_ON`·`KEY_BASE`·`NOTE_FALLBACK` 가 3.1 표와 같다. `RelayError` 는 위와 같다.
6. `web/relay.js` 글자에 `vicfos99-tech.github.io` 가 **정확히 한 번**, `require(` 가 0번, `console.` 이 0번, `localStorage`·`document.` 가 0번(끝까지 참이어야 하는 성질이다).
7. 브라우저 꼴: `vm` 으로 `{window: {}}` 뿐인 문맥(`module` 없음)에서 파일을 돌리면 `window.EvRelay.ANDROID_BASE` 가 있다.
8. node 가 없으면 건너뛰지 않고 실패한다(까닭이 글에 보인다).

### r1_settings — 설정과 주소

함수: `defaultBase(href)`, `checkBase(text)`, `loadSettings(storage)`, `saveOn(storage, on)`, `saveBase(storage, text)`, `baseOf(settings, href)`.

- `defaultBase(href)`: `href` 가 글자이고 `http://`·`https://` 로 시작하면(대소문자 무관) `new URL("./relay/", href).href`, 아니면(글자가 아님·빈 글·`file:`·`capacitor:`·`about:blank`·풀 수 없는 주소) `ANDROID_BASE`. **던지지 않는다.**
- `checkBase(text)` → `{ok: true, base}` 또는 `{ok: false, reason}`. `null`·`undefined`·빈 글·빈칸뿐 → `{ok:true, base:""}`(기본 주소를 쓴다는 뜻). 글자가 아니면 모양 틀림. 앞뒤 빈칸은 뗀다. `https://` 로 시작하지 않으면(대소문자 무관) "https" 까닭. 그 뒤 빈칸·제어 문자·`<>"'` 백틱·역슬래시·`?`·`#`·`@` 가 있거나 `new URL` 이 못 풀면 모양 틀림. 통과하면 `URL` 이 정리한 주소(`href`) 끝에 `/` 가 없으면 붙여 준다. **까닭 글에 입력을 넣지 않는다.**
- `loadSettings(storage)` → `{on, base}`. `on` 은 `getItem(KEY_ON) !== "off"`, `base` 는 저장된 값을 `checkBase` 에 넣어 통과하면 그 값·아니면 `""`. `storage` 가 없거나 `getItem` 이 던지면 `{on:true, base:""}`(둘 다 기본값).
- `saveOn(storage, on)` → `setItem(KEY_ON, on ? "on" : "off")` 하고 `true`, 던지면 `false`. `KEY_BASE` 는 건드리지 않는다.
- `saveBase(storage, text)` → `checkBase` 가 떨어지면 **저장소를 한 번도 부르지 않고** `{ok:false, reason, base:null}`. 통과하고 `base` 가 빈 글이면 `removeItem(KEY_BASE)` 만, 아니면 `setItem(KEY_BASE, base)` 만 하고 `{ok:true, reason:"", base}`. 저장소가 던지면 `{ok:false, reason:"이 화면에서는 저장되지 않습니다. …", base:null}`. `KEY_ON` 은 건드리지 않는다.
- `baseOf(settings, href)` → `settings.base` 가 빈 글이 아닌 글자면 그 값, 아니면 `defaultBase(href)`. `settings` 가 `null` 이어도 된다.

통과 기준(값은 참조 출력):

| `defaultBase` 입력 | 결과 |
|---|---|
| `https://vicfos99-tech.github.io/ev-station-map/` | `https://vicfos99-tech.github.io/ev-station-map/relay/` |
| `https://vicfos99-tech.github.io/ev-station-map/index.html?x=1#h` | 위와 같음 |
| `https://a.example/ev` (끝에 `/` 없음) | `https://a.example/relay/` |
| `http://localhost:8000/web/index.html` | `http://localhost:8000/web/relay/` |
| `HTTPS://A.Example/x/` | `https://a.example/x/relay/` |
| `file:///android_asset/index.html`, `capacitor://localhost/`, `about:blank`, `""`, `null`, `undefined`, `3`, `"https://"` | `ANDROID_BASE` |

| `checkBase` 입력 | 결과 |
|---|---|
| `""`, `"   "`, `null`, `undefined` | `{ok:true, base:""}` |
| `"https://a.example/relay/"` | base 그대로 |
| `" https://a.example/relay "` | `https://a.example/relay/` |
| `"https://a.example"` | `https://a.example/` |
| `"HTTPS://A.Example/R/"` | `https://a.example/R/` |
| `"https://a.example:8443/x/y"` | `https://a.example:8443/x/y/` |
| `"https://a.example/한글/"` | `https://a.example/%ED%95%9C%EA%B8%80/` |
| `"https://a.example/a/../b/"` | `https://a.example/b/` |
| `"http://a.example/relay/"`, `"//a.example/relay/"`, `"a.example/relay/"`, `"javascript:alert(1)"`, `"https:/a.example/"`, `"ftp://a.example/"` | `ok:false`, 까닭 `주소는 https:// 로 시작해야 해요.` |
| `"https://"`, `"https://a.example/re lay/"`, `"https://user:pw@a.example/"`, `"https://a.example/?k=1"`, `"https://a.example/#x"`, `"https://a.example/<b>/"`, `"https://a.example/\"x\"/"`, `5`, `{}` | `ok:false`, 까닭 `주소 모양이 맞지 않아요. https://사이트/폴더/ 처럼 적어 주세요.` |

1. 위 두 표.
2. `checkBase("http://secret.example/KEY123")` 의 까닭 글에 `secret`·`KEY123` 이 없다(다른 거부 사례도 까닭은 3.2 의 두 글 중 하나와 **같다**).
3. `loadSettings`: 빈 저장소 → `{on:true, base:""}`; `null` → 같음; `{relay:"off", relay-base:"https://a.example/r/"}` → `{on:false, base:"https://a.example/r/"}`; `relay` 가 `"OFF"`·`""`·`"0"`·`"false"` → `on` 참; 저장된 주소가 `http://a.example/r/` → `base` `""`; `getItem` 이 던짐 → `{on:true, base:""}`.
4. `saveBase(s, "http://a.example/")` → `{ok:false, reason:"주소는 https:// 로 시작해야 해요.", base:null}` 이고 `s.log()` 가 **빈 목록**. 이미 저장된 좋은 주소가 있었다면 그대로 남는다.
5. `saveBase(s, " https://a.example/r ")` → `{ok:true, reason:"", base:"https://a.example/r/"}`, `log` 는 `[["set","ev-charge-planner/relay-base","https://a.example/r/"]]` 한 줄. 이어서 `saveBase(s, "")` → `{ok:true, reason:"", base:""}`, `log` 에 `["remove","ev-charge-planner/relay-base"]` 가 더해짐.
6. `saveOn(s, false)` → `true`, 저장값 `"off"`; `saveOn(s, true)` → `"on"`; `saveOn(s, 0)`·`saveOn(s, "")` → `"off"`; `saveOn(s, 1)` → `"on"`. `set` 이 던지는 저장소 → `false`. `saveOn` 은 `relay-base` 를, `saveBase` 는 `relay` 를 건드리지 않는다(`log` 로 확인).
7. `set` 이 던지는 저장소에 `saveBase(s, "https://a.example/")` → `{ok:false, reason:"이 화면에서는 저장되지 않습니다. 크롬이나 삼성 인터넷으로 열어 주세요.", base:null}`. `remove` 가 던지는 저장소에 `saveBase(s, "")` 도 같다.
8. `baseOf({on:true, base:""}, "file:///x")` → `ANDROID_BASE`; `baseOf({on:true, base:"https://b.example/r/"}, "https://a.example/p/")` → `https://b.example/r/`; `baseOf(null, "https://a.example/p/i.html")` → `https://a.example/p/relay/`; `baseOf({base: 5}, "file:///x")` → `ANDROID_BASE`.

### r2_fresh — 시각과 신선함

함수: `kstMs(v)`, `trustAt(meta, fileAt, zcodes)`, `ageMs(now, t)`, `level(now, t)`, `staleNote(now, t)`, `cleanText(s, max)`, `metaNote(meta)`.

- `kstMs(v)`: 한국 시각 14자리 글자 → 밀리초(정수). **글자가 아니거나**(숫자 `20260105090000` 도 `null`), 14자리 숫자가 아니거나(앞뒤 빈칸 포함), 연도 < 2000, 월 1~12 밖, 일 < 1 또는 그 달에 없는 날(2월 30일, 평년 2월 29일, 4월 31일), 시 > 23, 분·초 > 59 면 `null`.
- `trustAt(meta, fileAt, zcodes)` → `{at, by}`. `fileAt` 은 14자리 글자 또는 밀리초 숫자(유한한 수). 못 읽으면 `{at:null, by:"none"}`. `meta` 가 보증하면 `{at: max(meta.at 밀리초, 파일 밀리초), by:"meta"}`, 아니면 `{at: 파일 밀리초, by:"file"}`. **보증** = `meta` 가 객체이고 `meta.ok === true`(1·`"true"` 는 아님)이고 `meta.at` 이 읽히고, `zcodes` 를 줬다면(`undefined`·`null` 이 아니면) 그것이 **비어 있지 않은 배열이고 모든 원소가 `meta.fresh` 배열에 있을 때**.
- `ageMs(now, t)`: 둘 다 유한한 수가 아니면 `null`. `d = now - t`. `d < -5분` 이면 `null`, `d < 0` 이면 `0`, 아니면 `d`. 반올림하지 않는다.
- `level(now, t)`: `ageMs` 가 `null` 이거나 30분(1 800 000) **초과**면 `"drop"`, 15분(900 000) 초과면 `"old"`, 아니면 `"fresh"`.
- `staleNote(now, t)`: 3.2 의 글. `fresh` 면 빈 글.
- `cleanText(s, max=60)`: 글자가 아니면 빈 글. 차례로 ① `글자://…`(빈칸 전까지)을 `(주소)` 로 ② `serviceKey`·`service_key`·`apikey`·`api_key`·`key`·`token`·`authorization` 뒤의 `=`·`:` 와 값(빈칸 전까지)을 `이름=(가림)` 으로 ③ 영문·숫자·`%+/=_-` 가 20자 이상 이어진 것을 `(가림)` 으로 ④ 제어 문자·줄바꿈을 빈칸으로, 빈칸 여럿을 하나로, 앞뒤를 뗀다 ⑤ `max` 자를 넘으면 `max` 자 + `…`. `max` 가 양수가 아니면 60, 소수면 내림.
- `metaNote(meta)`: `meta` 가 객체가 아니거나 `ok === true` 면 빈 글. 아니면 `cleanText(meta.error)` 를 넣은 3.2 의 글.

통과 기준:

| `kstMs` 입력 | 결과 |
|---|---|
| `"20260105090000"` / `"20260105091000"` / `"20260105000000"` / `"20240229120000"` | 1767571200000 / 1767571800000 / 1767538800000 / 1709175600000 |
| `"20250229120000"`, `"20260431000000"`, `"20261301000000"`, `"20260100000000"`, `"20260105240000"`, `"20260105126000"`, `"20260105120060"`, `"19991231235959"`, `"2026010509000"`(13자리), `"202601050900000"`(15자리), `"2026010509000a"`, `" 20260105090000"`, 숫자 `20260105090000`, `null`, `undefined`, `""` | `null` |

`trustAt` (meta 는 `{v:1, at:"20260105091000", ok:true, fresh:["41"], …}`, 파일 `at` 은 `"20260105090500"` = 1767571500000):

| 경우 | 결과 |
|---|---|
| zcodes 안 줌 | `{at:1767571800000, by:"meta"}` |
| 파일 `at` 이 `"20260105092000"`(meta 보다 늦음) | `{at:1767572400000, by:"meta"}` |
| `ok:false` / `ok:1` / `meta.at:null` / `meta` 가 `null` | `{at:1767571500000, by:"file"}` |
| zcodes `["41"]` | `{at:1767571800000, by:"meta"}` |
| zcodes `["41","11"]` / `[]` / `"41"`(글자) / `meta.fresh` 없음 | `{at:1767571500000, by:"file"}` |
| 파일 `at` 이 `"2026"` | `{at:null, by:"none"}` |
| 파일 `at` 이 숫자 1767571500000 | `{at:1767571800000, by:"meta"}` |

`level`·`staleNote` (t = 1767571800000, now = t + d):

| d (밀리초) | `ageMs` | `level` | `staleNote` |
|---|---|---|---|
| 0 / 1 / 899 999 / **900 000** | 그대로 | fresh | `""` |
| **900 001** | 900001 | old | `15분 전 상태예요.` |
| 1 110 000 (18분 30초) | | old | `18분 전 상태예요.` |
| 1 799 999 / **1 800 000** | | old | `29분 전 상태예요.` / `30분 전 상태예요.` |
| **1 800 001** | | drop | `30분 전 상태라 빈자리를 세지 않았어요.` |
| 2 400 000 (40분) | | drop | `40분 전 상태라 빈자리를 세지 않았어요.` |
| 3 599 999 / 3 600 000 / 7 800 000 | | drop | `59분 전 …` / `1시간 전 …` / `2시간 전 …` |
| 86 400 000 / 180 000 000 | | drop | `1일 전 …` / `2일 전 …` |
| −1 / **−300 000** | 0 | fresh | `""` |
| **−300 001** / −3 600 000 | `null` | drop | `상태 시각을 알 수 없어 빈자리를 세지 않았어요.` |

1. 위 세 표. `ageMs` 는 반올림하지 않는다(`ageMs(t+1110000, t) === 1110000`, `ageMs(t+1, t) === 1`).
2. `t` 가 `null`·`NaN`·글자 `"1767571800000"`, `now` 가 `null`·`NaN` → `ageMs` `null`, `level` `"drop"`, `staleNote` 는 "상태 시각을 알 수 없어…".
3. `cleanText`: `"상태 받기 실패: 연결 시간 초과"` → 그대로; `"HTTP 401 https://apis.data.go.kr/B552584/EvCharger/getChargerStatus?serviceKey=abcd"` → `HTTP 401 (주소)`; `"serviceKey=abc123 틀림"` → `serviceKey=(가림) 틀림`; `"token: xyz 만료"` → `token=(가림) 만료`; `"api_key = k1 Authorization: Bearer"` → `api_key=(가림) Authorization=(가림)`; `"키 AbCdEfGhIjKlMnOpQrStUvWxYz0123456789%2B%2F== 거부"` → `키 (가림) 거부`; `"줄\n바꿈\t과  빈칸"` → `줄 바꿈 과 빈칸`; `"ftp://x.example/a b"` → `(주소) b`; `"가"` 70자 → `"가"` 60자 + `…`; `""`·`null`·`5` → `""`; `"<b>굵게</b>"` → 그대로(이스케이프는 화면에 넣을 때 한다).
4. `cleanText("가나다라마바사", 3)` → `가나다…`; `("가나다", 3)` → `가나다`; `("가나다라", 0)`·`(…, -1)` → `가나다라`; `("가나다라", 2.9)` → `가나…`.
5. `metaNote`: `ok:true` → `""`; `{ok:false, error:"상태 받기 실패: 연결 시간 초과"}` → `중계가 마지막 받기에 실패했어요(상태 받기 실패: 연결 시간 초과).`; `{ok:false, error:""}`·`{ok:false, error:7}` → `중계가 마지막 받기에 실패했어요.`; `{ok:false, error:"HTTP 401 https://apis.data.go.kr/x?serviceKey=abcd"}` → `중계가 마지막 받기에 실패했어요(HTTP 401 (주소)).` — 결과에 `http`·`abcd` 가 없다; `null` → `""`.

### r3_read — 읽기와 모양 검사

함수: `urlOf(base, kind, id)`, `getJson(url, opts)`, `parseMeta(o)`, `parseRoutes(o)`, `parseStations(o, zscode)`, `parseStatus(o)`, `parseRest(o, id)`.

- `urlOf(base, kind, id)`: `base` 는 `http(s)://…/` 꼴(끝이 `/`)이어야 한다 — 아니면 `RelayError("bad_base")`. `kind` 는 `"meta"`→`meta.json`, `"routes"`→`routes.json`, `"stations"`→`stations/<id>.json`, `"status"`→`status/<id>.json`, `"rest"`→`status/rest/<id>.json`, 그 밖은 `bad_kind`. `stations`·`status` 의 id 는 **글자**이고 `^[0-9]{5}$`, `rest` 의 id 는 `^[A-Za-z0-9_-]{1,40}$` — 아니면 `bad_id`. 검사 순서: base → kind → id.
- `getJson(url, {fetch})`: `fetch(url, {cache:"no-cache"})` 를 **한 번** 부른다(다시 시도 없음). 거절 → `network`(단 `name === "AbortError"` 는 그대로 다시 던진다). 답이 없거나 `ok` 가 거짓 → 404 면 `missing`, 그 밖은 `http`(글에 상태 코드, 정수가 아니면 0). `text()` 가 던지면 `network`. JSON 이 아니면 `shape`. **오류 글·`stack` 에 주소와 받은 글이 없고 `cause` 가 없다.**
- `parse…` 는 모양이 틀리면 `RelayError("shape")` 를 던지고, 맞으면 **아는 칸만 옮긴 새 객체**를 준다. 받은 객체는 고치지 않는다.

`parseMeta(o)` → `{v:1, at, ok, error, suspect, fresh}`:

| 칸 | 규칙 |
|---|---|
| `o` | 객체(배열·null·글자·숫자는 거부) |
| `v` | 정확히 숫자 1 (`2`·`"1"`·없음은 거부) |
| `at` | `null` 이거나 `kstMs` 가 읽는 글자. 없음(`undefined`)·틀린 글자는 거부 |
| `ok` | 정확히 `true`·`false`. `1`·`"true"`·없음은 거부 |
| `error` | 글자면 그대로, 아니면 `""` |
| `suspect`·`fresh` | 배열이면 글자인 원소만, 배열이 아니면 `[]` |

`parseRoutes(o)` → `{v:1, fetched_at, source, price_note, routes, skipped}`. 거부: `v !== 1`, `fetched_at` 이 유한한 수가 아님, `routes` 가 배열이 아니거나 **빈 배열**; 노선의 `key`(빈 글 포함)·`highway`·`direction` 이 글자가 아님, `length` 가 유한한 수가 아니거나 음수, `rest_areas` 가 배열이 아님; 휴게소의 `id`(빈 글 포함)·`name` 이 글자가 아님, `km` 이 유한한 수가 아님(`"33.9"`·`NaN`), `stations` 가 배열이 아님; 충전소의 `id`(빈 글 포함)·`operator` 가 글자가 아님, `price` 가 유한한 수가 아니거나 음수, `updated` 가 유한한 수가 아님, `chargers` 가 배열이 아님; 충전기가 객체가 아니거나 `power_kw` 가 유한한 양수가 아님(`0`·`"100"`). 너그러운 곳: `length` 0·`price` 0·`rest_areas` `[]`·`chargers` `[]` 는 통과; `operator` 가 빈칸뿐이면 `"알 수 없음"`; 충전기 `type` 이 `"fast"` 가 아니면 `"slow"`; `status` 가 아는 다섯 가지가 아니면(없음 포함) `"comm_error"`; `last_end` 가 유한한 양수가 아니면 그 칸을 뺀다; `maker` 가 글자가 아니면 `""`; `loc`(휴게소·충전소)이 좋은 좌표(`[위도, 경도]` 유한한 수, |위도| ≤ 90, |경도| ≤ 180, (0,0) 아님)가 아니면 그 칸을 뺀다; `source`·`price_note` 가 글자가 아니면 `""`; `skipped` 가 객체가 아니면(배열 포함) `{}`. 노선에는 늘 `live: true` 를 단다(받은 값이 `false` 여도). 모르는 칸(`evil`·`kind`·`nearby`)은 옮기지 않는다.

`parseStations(o, zscode)` → `{v:1, zscode, zcodes, stations}`. 거부: `v !== 1`, `o.zscode !== zscode`(다른 시군구 파일), `stations` 가 배열이 아님, 충전소가 객체가 아님, `loc` 이 좋은 좌표가 아님(글자 좌표 포함), `id` 가 빈 글·글자가 아님, `chargers` 가 배열이 아님, 충전기의 `id` 가 글자가 아님·`kw` 가 유한한 양수가 아님. 너그러운 곳: `zcodes` 가 배열이 아니면 `[]`; `name` 없음 → `""`(앞뒤 빈칸은 뗀다); `operator` 없음·빈칸 → `"알 수 없음"`; `maker` 가 글자가 아니면 `""`; `type` 이 `"fast"` 아니면 `"slow"`; `indoor`·`rest` 는 정확히 `true` 일 때만 옮긴다.

`parseStatus(o)` → `{at, s}`. 거부: 객체가 아님, `v` 가 있는데 1 이 아님, `at` 을 못 읽음, `s` 가 객체가 아님(배열 포함). `s` 는 **프로토타입 없는 객체**(`Object.create(null)`)에 `{충전소 id: {충전기 id: stat 글자}}` 로 담는다. 충전소 값이 객체가 아니면 그 충전소를 뺀다(모름). 충전기 값이 배열이 아니거나 첫 칸이 글자가 아니면 그 충전기는 `"9"`.

`parseRest(o, id)` → `{rest, at, chargers:[{id, stat, last_end}]}`. 거부: 객체가 아님, `v` 가 있는데 1 이 아님, `o.rest !== id`, `at` 을 못 읽음, `chargers` 가 배열이 아님, 충전기 항목이 객체가 아님. 충전기: `id` 는 `chgerId` 가 글자면 그 값·아니면 `""`, `stat` 은 글자면 그 값·아니면 `"9"`, `last_end` 는 `kstMs(lastTedt)`(못 읽으면 `null`). **`id` 글자 순으로 정렬**해서 준다.

통과 기준:
1. `urlOf("https://a.example/relay/", …)`: `meta` → `…/meta.json`, `routes` → `…/routes.json`, `("stations","41135")` → `…/stations/41135.json`, `("status","41135")` → `…/status/41135.json`, `("rest","KP000101")` → `…/status/rest/KP000101.json`, `("rest","live-gb-down_1")` 통과, `("rest", "x" 40자)` 통과. `"http://localhost:8000/relay/"` 도 통과.
2. `bad_id`: stations `"4113"`·`"411355"`·`"4113a"`·숫자 `41135`, status `"../41"`, rest `""`·`"a/b"`·`"a.b"`·`".."`·`"a b"`·`"가"`·`"x"` 41자·`"KP000101\n"`·id 안 줌. `bad_kind`: `"meta.json"`. `bad_base`: `"https://a.example/relay"`(끝에 `/` 없음)·`""`·`null`·`"ftp://a.example/"`.
3. `getJson`: 좋은 답 → 객체, `fetch` 의 둘째 인자가 `{cache:"no-cache"}`; 404 → `missing`; 503·304 → `http`, 글 `중계가 503 로 답했어요`; 연결 실패 → `network`; `<html>SECRET https://x.example/</html>` → `shape` 이고 `message`·`stack` 에 `SECRET`·`x.example` 이 없고 `cause === undefined`; 빈 글 → `shape`; `{ok:false}`(status 없음)·`null` → `http`, 글 `중계가 0 로 답했어요`; `text()` 가 던짐 → `network`; `AbortError` → 그대로(`RelayError` 가 아니다); 503 에서 `fetch` 는 **한 번만** 불림.
4. `parseMeta(견본)` → `{"v":1,"at":"20260105091000","ok":true,"error":"","suspect":["29"],"fresh":["41"]}`(`calls_today`·`stations_at`·`unknown` 은 없다). 위 표의 칸마다: 거부 12가지(`v` 2·`"1"`·없음, `at` `"2026"`·없음, `ok` 1·없음·`"true"`, 그리고 통째로 `null`·`[]`·`"x"`·`1`), 통과 4가지(`at:null`, `error:5` → `""`, `suspect:"29"` → `[]`, `fresh:["41",11,null]` → `["41"]`).
5. `parseRoutes(견본).routes` 가 견본의 `routes` 와 JSON 글자로 같다(칸 순서 포함). 결과의 열쇠는 `v, fetched_at, source, price_note, routes, skipped`. 위 규칙의 거부·통과 사례를 칸마다 하나씩(거부 17: `v` 2, `routes` `[]`·`{}`, `fetched_at` `"1"`, `key` `""`, `length` −1, `rest_areas` 없음, 휴게소 `id` 없음, `km` `"33.9"`·`NaN`, 충전소 `id` `""`, `operator` 숫자, `price` −1, `updated` 없음, `chargers` 없음, `power_kw` 0·`"100"` / 통과 15: `length` 0, `rest_areas` `[]`, 휴게소 `loc` `[37]` → 칸 빠짐, `operator` `"  "` → `알 수 없음`, `price` 0, `chargers` `[]`, `type` `"ultra"` → `slow`, `status` `"free"`·없음 → `comm_error`, `last_end` `"x"` → 칸 빠짐, `maker` 3 → `""`, 충전소 `loc` `[0,0]` → 칸 빠짐, `live:false` → `true`, 모르는 칸 `evil`·`kind` → 없음, `skipped` `[]` → `{}`).
6. `parseStations(견본 41135, "41135")` → 충전소 둘, `ME000202` 에 `indoor:true`, 충전기는 `{id, type, kw}`. 거부 9(`zscode` 인자 `"41463"`, `v` 없음, `loc` 없음·글자 좌표, `id` `""`, 충전기 `id` 숫자, `kw` 0, `stations` `{}`, 충전소 `null`), 통과 5(`zcodes` 없음 → `[]`, `name` 없음 → `""`, `operator` 없음 → `알 수 없음`, `type` `"x"` → `slow`, `indoor:"true"` → 칸 없음).
7. `parseStatus(견본 41135)` → `{"at":"20260105090000","s":{"ME000201":{"01":"2","02":"3"},"ME000202":{"01":"9"}}}`. `v:1` 통과, `v:2` 거부, `at` 없음·`"20260230000000"` 거부, `s` `[]`·없음 거부. `s.ME000201 = ["2"]`(배열) → 그 충전소가 빠짐; 충전기 값 `"2"`(글자)·`[2,null,null]`·`[]` → `"9"`. `'{"at":"20260105090000","s":{"__proto__":{"01":["2"]},"constructor":{"01":["2"]}}}'` 를 `JSON.parse` 해 넣으면 `Object.keys(결과.s)` 가 `["__proto__","constructor"]` 이고 `Object.getPrototypeOf(결과.s) === null`.
8. `parseRest(견본 KP000101, "KP000101")` → `{"rest":"KP000101","at":"20260105090500","chargers":[{"id":"01","stat":"3","last_end":1767569400000},{"id":"02","stat":"3","last_end":1767569400000}]}`. 거부: id 인자 `"KP000102"`, `rest` 없음, `at` 1, `chargers` `{}`, 항목 `null`, `v:2`. 통과: `chargers` `[]`, `stat` 2(숫자) → `"9"`, `chgerId` 없음 → `""`, `lastTedt` `"x"` → `last_end` `null`, 항목 순서를 뒤집어 넣어도 `01`·`02` 순.
9. `parse…` 다섯 모두 받은 객체를 고치지 않는다(부르기 전후의 JSON 글자가 같다).

### r4_rest — 휴게소 새로 받기

함수: `wantedIds(routes, routeKey, extraIds)`, `expire(stations, now)`, `expireLive(live, now)`, `buildLive(routesDoc, restById, meta, o)`, `routeHint(live, ids)`, `refreshRest(o)`.

- `wantedIds(routes, routeKey, extraIds)`: `routes` 는 `parseRoutes` 결과의 `routes`. `key === routeKey` 인 노선의 휴게소 충전소 id 를 나온 순서대로, 이어서 `extraIds`(배열일 때) 가운데 **`routes` 어딘가에 있는 글자 id** 를 준 순서대로. 겹치는 id 는 한 번만. 결과가 비면 **첫 노선**의 id. `routes` 가 `[]` 면 `[]`.
- `expire(stations, now)` → 바꾼 충전소 수. `level(now, st.updated) === "drop"` 인 충전소의 충전기 상태를 모두 `"comm_error"` 로 **그 자리에서** 바꾼다(이미 다 comm_error 인 충전소는 세지 않는다). 배열이 아니거나 모양이 다른 원소는 건너뛴다(던지지 않는다).
- `expireLive(live, now)` → 바꾼 충전소 수. `live.relay` 표식이 객체일 때만 `live.routes[].rest_areas[].stations` 에 `expire` 를 건다(`nearby` 는 건드리지 않는다). 표식이 없거나 모양이 다르면 0, **던지지 않는다.**
- `buildLive(routesDoc, restById, meta, {now, wanted, config})` → `{fetched_at: now, source, price_note, routes, skipped, config: config || null, item_count: 충전기 총수, relay}`(열쇠 순서 이대로). `routesDoc` 을 고치지 않는다. 충전소마다:
  - id 가 `wanted` 에 있고 `restById` 에 그 id 의 자료가 있으면 **덮어쓴다**: 그 충전소 충전기가 한 개 이상이고 `type` 이 한 종류이고 상태 수 m ≤ 충전기 수 n 이면, 앞에서 m 개에 차례로(상태는 `chgerId` 순) `status`(D3)와 `last_end`(`null` 이 아닐 때만)를 넣고 나머지 n−m 개는 comm_error. 아니면(목록의 충전기가 0개, 종류가 섞임, m > n) 모두 comm_error 이고 `relay.mixed` 에 넣는다(상태가 0개인 것은 m ≤ n 이라 앞 갈래다 — 모두 comm_error, mixed 아님). `updated = trustAt(meta, 자료.at).at`. `relay.ids` 에 넣는다.
  - `wanted` 에 있는데 자료가 없으면 `relay.missing` 에 넣고 목록의 상태·`updated` 를 그대로 둔다. `wanted` 에 없으면 그대로 둔다.
  - 마지막에 `expireLive(결과, now)` 를 건다(덮어쓴 것·안 덮어쓴 것 모두 30분 규칙).
  - `relay = {at: meta 가 ok 면 meta.at 밀리초·아니면 null, ok, ids, missing, mixed, oldest: 덮어쓴 충전소의 가장 이른 updated·없으면 null}`.
- `routeHint(live, ids)`: `live.relay.ids` 가 있고 `ids` 가 비어 있지 않은 배열인데 **하나도** `relay.ids` 에 없으면 3.2 의 안내 글, 아니면 빈 글.
- `refreshRest({settings, href, fetch, now, key, direct, routeKey, extraIds, config, onProgress})` → `{live, source, note, tone}`.
  - `settings.on` 이 거짓: `key` 가 없으면 `RelayError("no_key")`, `direct` 가 함수가 아니면 `no_direct`(이 순서), 아니면 `{live: await direct(), source:"direct", note:"", tone:"good"}`. **`fetch` 를 부르지 않는다.** `direct` 가 던진 것은 그대로 나간다.
  - 켬: `meta.json` → `routes.json` → `wantedIds` 의 휴게소 상태 파일(한 번에 최대 `POOL` 개, id 가 `rest` 규칙에 안 맞으면 받지 않고 '없음') 순으로 읽는다. 상태 파일의 `missing`(404)은 '없음'으로 넘기고, 그 밖의 실패는 전체 실패. 받으려던 id 가 하나 이상인데 **하나도 못 받으면** `missing` 실패. 파일 하나를 끝낼 때마다(없음 포함) `onProgress(끝낸 수, 전체 수)`.
  - 성공: `{live: buildLive(…), source:"relay", note, tone}`. `note` 는 `metaNote(meta)`, `staleNote(now, relay.oldest)`(oldest 가 있을 때), "상태 파일이 없어 미확인"(missing 수), "충전기 목록이 달라 미확인"(mixed 수) 가운데 빈 글이 아닌 것을 빈칸 하나로 이은 것. `tone` 은 `note` 가 있으면 `"warn"`, 없으면 `"good"`.
  - 중계 실패(`RelayError`): `key` 가 있고 `direct` 가 함수면 `{live: await direct(), source:"direct", note: NOTE_FALLBACK, tone:"warn"}`, 아니면 `RelayError("relay_failed")`. `RelayError` 가 아닌 예외(예: `AbortError`)는 그대로.
  - `now` 가 유한한 수가 아니면 `Date.now()`. `settings` 를 안 주면 `{on:true, base:""}`. 주소는 `baseOf(settings, href)`.

통과 기준(견본, NOW0 = 1767571920000, 기준 주소 `https://a.example/relay/`):
1. `wantedIds`: `"live-gb-down"` → `["KP000101"]`; `"live-gb-up"` → `["KP000102"]`; `("navi", ["KP000102","X","KP000102",3])` → `["KP000102"]`; `"없음"` → `["KP000101"]`(첫 노선); `("live-gb-down", ["KP000102","KP000101"])` → `["KP000101","KP000102"]`; `(undefined, [])` → `["KP000101"]`; `([], "x")` → `[]`.
2. `buildLive`(wanted `["KP000101"]`, 자료는 KP000101 것만, meta 견본): KP000101 은 `charging, charging`·`updated` 1767571800000(T_META)·`last_end` 1767569400000, KP000102 는 `available`·`updated` 1767571200000(목록 그대로). `relay` = `{at:1767571800000, ok:true, ids:["KP000101"], missing:[], mixed:[], oldest:1767571800000}`, `fetched_at` 1767571920000, `item_count` 3, 열쇠 순서 `fetched_at, source, price_note, routes, skipped, config, item_count, relay`, `config` 는 준 객체 그대로·안 주면 `null`.
3. `meta.ok` 가 거짓이면 KP000101 의 `updated` 는 1767571500000(T_REST1), `relay.at` `null`·`relay.ok` 거짓. 그때 now 가 T_REST1 + 31분이면 KP000101 이 `comm_error, comm_error`.
4. 30분 경계: now = T_META + 30분 정각이면 KP000101 은 `charging, charging` 그대로이고 **KP000102(목록 09:00, 40분 지남)는 comm_error**; now = T_META + 31분이면 둘 다 comm_error.
5. 자료가 없을 때(`restById` `{}`): KP000101 은 목록 상태 `available, charging` 그대로, `relay.ids` `[]`·`missing` `["KP000101"]`·`oldest` `null`. now 가 T_LIST + 29분이어도 그대로(30분 안).
6. 수가 다를 때: 상태 1개 → `charging, comm_error`(mixed 아님); 상태 3개 → `comm_error, comm_error`·`mixed` `["KP000101"]`; 상태 0개 → `comm_error, comm_error`(mixed 아님); stat `"7"`·`"2"` → `comm_error, available`; 둘째 충전기를 `slow` 로 바꾼 목록 → `comm_error, comm_error`·`mixed` `["KP000101"]`. `last_end` 가 `null` 인 상태는 목록의 `last_end` 를 지우지 않는다(1767569400000 그대로), 숫자 5 면 5 로 바뀐다.
7. `buildLive` 는 `routesDoc`·`restById`·`meta` 를 고치지 않는다(JSON 글자 비교). 결과의 충전소·충전기 객체는 `routesDoc` 의 것과 다른 객체다.
8. `expireLive`: 둘 다 덮어쓴 자료(updated T_META)에 now = T_META + 30분 → 0·그대로; + 30분 1밀리초 → 2·모두 comm_error; 한 번 더 → 0. 표식(`relay`) 없는 자료는 now 가 99시간 뒤여도 0 이고 글자 하나 안 바뀐다. `expireLive({relay:{}, routes:[null, 3, {rest_areas:[null, {stations:[null, {chargers:null, updated:0}, {chargers:[null, {status:"available"}], updated:0}]}]}]}, NOW0)` → 1, `expireLive({relay:{}, routes:"x"}, NOW0)`·`(null, NOW0)`·`({relay:true, routes:[]}, NOW0)` → 0, `expire(null, NOW0)` → 0, `expire([{updated:0, chargers:[{status:"charging"}]}], NOW0)` → 1. 모두 던지지 않는다.
9. `routeHint`(기준 2 의 자료): `["KP000101"]` → `""`; `["KP000102"]` → 안내 글; `["KP000102","KP000101"]` → `""`; `[]` → `""`; 표식 없는 자료·`null` → `""`.
10. `refreshRest` 켬·키 없음: 부른 주소가 차례로 `meta.json`, `routes.json`, `status/rest/KP000101.json` **셋뿐**이고 `direct` 0번, `source:"relay"`, `note:""`, `tone:"good"`, `onProgress` 는 `(1,1)` 한 번, 모든 fetch 의 둘째 인자가 `{cache:"no-cache"}`. 노선 `live-gb-up` 이면 셋째가 `status/rest/KP000102.json`. `routeKey:"navi"`, `extraIds:["KP000102","KP000101"]` 면 그 순서로 둘을 받고 `onProgress` `(1,2)`·`(2,2)`.
11. 오래됨: now = T_META + 40분 → `note` `40분 전 상태라 빈자리를 세지 않았어요.`, `tone` `warn`, 모든 충전기 comm_error. **상태 파일 `at` 만 08:32(40분 전)이고 meta 는 견본 그대로 → `note` `""`, KP000101 은 `charging, charging`(조용한 충전소를 미확인으로 만들지 않는다 — N1).** 같은 파일에 `meta.ok:false, error:"상태 받기 실패: HTTP 500"` → `note` `중계가 마지막 받기에 실패했어요(상태 받기 실패: HTTP 500). 40분 전 상태라 빈자리를 세지 않았어요.`, KP000101 comm_error. now = T_META + 18분 → `note` `18분 전 상태예요.`, 상태는 그대로 셈.
12. 예비(키 있음): `meta.json` 404 / `routes.json` 503 / 상태 파일이 `{` (깨짐) → 세 경우 모두 `source:"direct"`, `note` `중계에 연결하지 못해 직접 받았어요`, `tone` `warn`, `live` 가 `direct` 가 준 **바로 그 객체**, `direct` 1번. 부른 중계 주소는 각각 1·2·3개.
13. 예비 없음: `meta.json` 404·키 없음 → `relay_failed`, 글 `중계에 파일이 없어요. 공공 데이터 키를 넣으면 직접 받을 수 있어요.`; 연결 실패 → `중계에 연결하지 못했어요. 공공…`; `meta` 가 `{v:2}` → `중계 파일을 읽지 못했어요. 공공…`; 상태 파일 500 → `중계가 500 로 답했어요. 공공…`; 키는 있는데 `direct` 가 `null` → `relay_failed`. 모두 `direct` 0번이고 글에 `https`·`a.example` 이 없다.
14. 404 한 파일(N2): 받을 것이 하나뿐인데 404 → `relay_failed`(`중계에 파일이 없어요. …`). 받을 것이 둘(`extraIds` 로)인데 KP000102 만 404 → 성공, `note` `충전소 1곳은 상태 파일이 없어 미확인이에요.`, `relay.missing` `["KP000102"]`, KP000102 는 목록 상태 그대로(now 가 목록 받은 지 12분이라 `available`).
15. 끔: 키 있음 → `fetch` 0번, `direct` 1번, `live` 가 같은 객체, `note` `""`; 키 없음 → `no_key`; 키 있고 `direct` 없음 → `no_direct`; 키도 `direct` 도 없음 → `no_key`. `direct` 가 `code:"X"` 인 오류를 던지면 끔·예비 둘 다 **그 오류가 그대로** 나간다.
16. 기본 주소: `settings.base` 가 빈 글, `href` 가 `file:///android_asset/index.html` → 첫 주소가 `https://vicfos99-tech.github.io/ev-station-map/relay/meta.json`; `href` 가 `https://vicfos99-tech.github.io/ev-station-map/index.html` 이어도 같은 주소; `href` 가 `https://me.example/ev/index.html` → `https://me.example/ev/relay/meta.json`.
17. 한 번에 여는 수: 휴게소 20곳짜리 노선(가짜 fetch 에 3밀리초 지연) → 부른 주소 22개, `maxActive() <= 6`, `relay.ids` 20개, `onProgress` 20번이고 마지막이 `(20,20)`.
18. `fetch` 가 `RangeError("SECRET")` 를 던져도 `relay_failed`(글에 `SECRET` 없음). `AbortError` 는 그대로 나간다.

### r5_around — 지도 주변 충전소

함수: `overlayRegion(stations, statusDoc, t, now)`, `regionStations(stDoc, statusDoc, meta, o)`, `loadRegion(o)`, `refreshRegion(o)`.

- `regionStations(stDoc, statusDoc, meta, {now, tariffs})` → `EvAround.stationsOf` 와 **같은 모양**의 목록. 급속 충전기가 하나라도 있는 충전소만. 충전소 열쇠 순서 `id, name, operator, maker, addr, price, loc, updated, chargers`(+ `indoor: true` 는 있을 때만 끝에), 충전기 열쇠 순서 `id, type, power_kw, status`. `addr` 는 `""`, `price` 는 D5, `loc` 은 소수 다섯 자리(`Number(x.toFixed(5))`), `power_kw` 는 `kw`, `updated` 는 확인 시각 `t = trustAt(meta, statusDoc.at, stDoc.zcodes).at`, 상태는 `overlayRegion` 으로.
- `overlayRegion(stations, statusDoc, t, now)` → **바뀐 충전기 수.** 충전기마다: `level(now, t)` 가 `"drop"` 이면 comm_error, 아니면 `statusDoc.s[충전소 id][충전기 id]` 가 있으면 D3 대로·없으면 comm_error. 모든 충전소의 `updated = t`. 그 자리에서 고친다.
- `loadRegion({settings, href, fetch, now, key, zscode, tariffs, direct})` → `{zscode, stations, fetched_at, status_at, zcodes, source, note, suspect}`.
  - 끔: `no_key` / `no_direct` / 아니면 `r = await direct()` → `{zscode, stations: r.stations(같은 배열), fetched_at: r.fetched_at, status_at: r.fetched_at, zcodes: [], source:"direct", note:"", suspect:false}`. `fetch` 0번.
  - 켬: `meta.json` 을 먼저, 이어서 `stations/<zscode>.json` 과 `status/<zscode>.json`. 성공 → `fetched_at: now`, `status_at: t`, `zcodes`, `source:"relay"`, `suspect`(D11), `note` 는 `metaNote`·`staleNote(now, t)`·(suspect 면)`NOTE_SUSPECT` 를 빈칸으로 이은 것.
  - 중계 실패(셋 중 어느 것이든 연결·404·모양·`zscode` 가 5자리가 아님): 키와 `direct` 가 있으면 `direct()` 결과에 `note: NOTE_FALLBACK`, 아니면 `relay_failed`.
- `refreshRegion({settings, href, fetch, now, key, zscode, region, direct})` → `{changed, status_at, source, failed, replaced, note}`. `region` 은 `{stations, zcodes, status_at, …}`(앱이 들고 있는 것).
  - `meta.json` 과 `status/<zscode>.json` **둘만** 읽는다(`stations/` 는 다시 읽지 않는다). 성공 → `region.stations` 를 `overlayRegion` 으로 고치고 `{changed, status_at: t, source:"relay", failed:false, replaced:null, note}`(`t = trustAt(meta, 상태.at, region.zcodes).at`).
  - 실패 + 키·`direct` 있음 → `{changed:0, status_at:null, source:"direct", failed:true, replaced: 직접 받은 시군구(loadRegion 의 직접 결과와 같은 모양, note 는 NOTE_FALLBACK), note: NOTE_FALLBACK}`. `region.stations` 는 건드리지 않는다.
  - 실패 + 예비 없음 → **던지지 않는다.** `expire(region.stations, now)` 를 걸고 `{changed: 그 수, status_at: region.status_at, source:"relay", failed:true, replaced:null, note: "<실패 글>." + (있으면) " " + staleNote(now, region.status_at)}`.

통과 기준(견본 41135, NOW0, 요금표 `{default:391, "환경부":347}`):
1. `regionStations` 기본: 둘. `ME000201` = `{id, name:"분당 지어낸 충전소", operator:"환경부", maker:"가나전기·마바전기", addr:"", price:347, loc:[37.38012,127.11854], updated:1767571800000, chargers:[{id:"01",type:"fast",power_kw:50,status:"available"},{id:"02",type:"slow",power_kw:7,status:"charging"}]}`, `ME000202` = `price:391`, `chargers:[{id:"01",type:"fast",power_kw:350,status:"comm_error"}]`, `indoor:true`. 열쇠 순서가 위와 같다.
2. **같은 모양**: `require("../web/around.js").summary(충전소)` 가 `ME000201` → `{free:1, busy:0, total:1, broken:0, kw:50}`(완속은 안 센다), `ME000202` → `{free:0, busy:0, total:1, broken:1, kw:350}`. 그리고 같은 내용의 공공 데이터 항목으로 `EvAround.stationsOf` 가 만든 충전소와 열쇠 집합이 같다(`indoor` 만 빼고).
3. 요금표: 없음(`null`) → 둘 다 `price:null`; `{"환경부":347}`(default 없음) → `[347, null]`.
4. 보증이 없을 때: `meta.fresh` 가 `[]` 면 `updated` 가 1767571200000(상태 파일 `at`)이고 NOW0 에서는 그대로 셈, now = T_LIST + 31분이면 둘 다 `free:0`·`broken:1`. meta 견본 그대로·now = T_META + 31분 → 둘 다 `free:0`.
5. 상태 파일에 `ME000201` 이 없으면 그 충전기 둘 다 comm_error(`free:0, broken:1`), `ME000202` 를 `"2"` 로 주면 `free:1`.
6. 둘째 충전소(`ME000202`)의 급속을 완속으로 바꾼 목록이면 결과가 `ME000201` 하나뿐이다(급속이 없는 충전소는 뺀다). 좌표 `[37.123456, 127.654321]` → `[37.12346, 127.65432]`.
7. `regionStations` 는 `stDoc`·`statusDoc`·`meta` 를 고치지 않는다.
8. `overlayRegion`: 기준 1 의 목록에 `{at:"20260105091400", s:{ME000201:{"01":"3","02":"2"}, ME000202:{"01":"2"}}}` 를 `t` 1767572100000·now NOW0+3분으로 걸면 **3** 을 주고 상태가 `charging, available` / `available`, `updated` 가 모두 1767572100000. 같은 것을 한 번 더 걸면 0. 기준 1 의 목록을 새로 만들어 `s` 가 `{}` 인 상태를 걸면 2(이미 comm_error 인 `ME000202` 의 충전기는 세지 않는다). 기준 1 의 목록에 견본 상태를 `t` 1767571800000·now = `t` + 30분 1밀리초로 걸면 2 를 주고 모든 충전기가 comm_error 다(완속 `02` 도 바뀐 수에 든다. 이 한 줄은 참조로 돌려 보지 않고 규칙에서 셌다).
9. `loadRegion` 켬: 부른 주소 `meta.json`, `stations/41135.json`, `status/41135.json` 셋(meta 가 첫째), `source:"relay"`, `fetched_at` 1767571920000, `status_at` 1767571800000, `zcodes` `["41"]`, `note` `""`, `suspect` 거짓, `direct` 0번.
10. `meta.suspect` 가 `["41"]` → `suspect` 참, `note` 가 `NOTE_SUSPECT`. 견본 그대로(`["29"]`)는 거짓. `meta.ok:false, error:"한도 넘음"` → `note` `중계가 마지막 받기에 실패했어요(한도 넘음).`, `status_at` 1767571200000. now = T_META + 18분 → `note` `18분 전 상태예요.`; + 40분 → `note` `40분 전 상태라 빈자리를 세지 않았어요.` 이고 모든 충전기 comm_error.
11. 예비: `stations/41135.json` 404·키 있음 → `source:"direct"`, `note` NOTE_FALLBACK, `stations` 가 `direct` 가 준 **바로 그 배열**, `fetched_at`·`status_at` 가 `direct` 의 `fetched_at`, `zcodes` `[]`, `direct` 1번. `status/41135.json` 404·키 없음 → `relay_failed`(`중계에 파일이 없어요. 공공…`). `meta.json` 연결 실패·키 없음 → `relay_failed`, 부른 주소는 `meta.json` 하나. `zscode:"4113"` → `relay_failed`(`중계 파일 이름이 맞지 않아요. 공공…`). `stations/41135.json` 자리에 41463 견본이 오면(다른 시군구) → `relay_failed`(`중계 파일을 읽지 못했어요. 공공…`).
12. 끔: 키 있음 → `fetch` 0번·`direct` 1번·`note` `""`; 키 없음 → `no_key`.
13. `refreshRegion`(기준 9 로 받은 것을 `region` 으로, now = NOW0 + 3분): 같은 파일 → 부른 주소 `meta.json`, `status/41135.json` **둘뿐**, `{changed:0, status_at:1767571800000, source:"relay", failed:false, replaced:null, note:""}`. 상태 09:14·meta 09:15 로 바뀌면 `changed:3`, `status_at` 1767572100000, 충전소 `updated` 도 그 값. 상태의 `s` 가 `{}` 면 `changed:2`·모두 comm_error.
14. `refreshRegion` 실패·키 없음(3분 뒤): 던지지 않고 `{changed:0, status_at:1767571800000, source:"relay", failed:true, replaced:null, note:"중계에 파일이 없어요."}`, 상태는 그대로. now 가 T_META + 31분이면 `changed:1`, `note` `중계에 파일이 없어요. 31분 전 상태라 빈자리를 세지 않았어요.`, 모두 comm_error. 상태 파일이 깨졌으면 `note` `중계 파일을 읽지 못했어요.`.
15. `refreshRegion` 실패·키 있음 → `{changed:0, status_at:null, source:"direct", failed:true, note: NOTE_FALLBACK}`, `replaced` 는 `{zscode:"41135", stations: direct 의 배열 그대로, fetched_at, status_at, zcodes:[], source:"direct", note: NOTE_FALLBACK, suspect:false}`, `region.stations` 는 그대로, `direct` 1번.

### r6_text — 글자 안전

함수: `esc(s)`, `bubbleHtml(o)`, `lineHtml(o)`, `dotHtml(o)`, `popupHtml(lines)`.

- `esc(s)`: `null`·`undefined` → `""`, 그 밖은 `String(s)` 에서 `& < > " '` 를 `&amp; &lt; &gt; &quot; &#39;` 로.
- 숫자 칸(`free`·`total`): 유한한 **숫자**면 `String(x)`, 아니면(글자 `"3"` 포함) `?`. `tone` 은 `"good"`·`"busy"` 만 그대로, 그 밖은 `"bad"`. `role` 은 `"primary"`·`"backup"` 만, 그 밖은 없음. `dx` 는 유한한 숫자면 `Math.round`, 0 이거나 숫자가 아니면 `style` 을 안 단다. `far`·`around` 는 참·거짓으로만 본다.
- `bubbleHtml({top, free, total, sub, tone, role, far, dx, around})` → `<div class="mk" data-tone="T"[ data-role="R"][ data-far="true"][ data-around="true"][ style="margin-left:Npx"]><span class="mk-top">TOP</span><b class="num">F<i>/N</i></b>[<span class="mk-sub">SUB</span>]</div>` (`sub` 가 빈 글이면 그 칸 없음).
- `lineHtml({top, free, total, tone})` → `<div class="mk mk-line" data-around="true" data-tone="T"><span class="mk-top">TOP</span><b class="num">F<i>/N</i></b></div>`.
- `dotHtml({free, tone, far})` → `<div class="mk-dot num" data-tone="T"[ data-far="true"]>F</div>`.
- `popupHtml(lines)` → `<div class="mk-pop">` + 줄들을 `<br>` 로 이은 것 + `</div>`. 줄이 `{b: 글}` 이면 `<b>esc(글)</b>`, 아니면 `esc(줄)`. `null`·`undefined`·빈 글·`false` 인 줄은 건너뛴다. `lines` 가 배열이 아니면 빈 팝업.

통과 기준:
1. **지금 앱과 같은 글자.** 아래 다섯 입력에서 `bubbleHtml` 이 고치기 전 `app.js` 의 `bubbleIcon` 글틀과 같은 글자를 낸다(테스트 파일 안에 그 글틀을 옮겨 적어 견준다): `("채비",2,3,"가나전기·다라전기","good","primary",false,-43,false)`, `("워터",0,4,"","busy","backup",true,43,false)`, `("한국전력",0,1,"시그넷","bad","",false,0,true)`, `("기흥",5,8,"","good","",true,0,false)`, `("A&B \"c\" 'd'",1,1,"x<y>","good","",false,0,true)`. 첫째의 결과는 `<div class="mk" data-tone="good" data-role="primary" style="margin-left:-43px"><span class="mk-top">채비</span><b class="num">2<i>/3</i></b><span class="mk-sub">가나전기·다라전기</span></div>`, 다섯째는 `<div class="mk" data-tone="good" data-around="true"><span class="mk-top">A&amp;B &quot;c&quot; &#39;d&#39;</span><b class="num">1<i>/1</i></b><span class="mk-sub">x&lt;y&gt;</span></div>`.
2. `lineHtml({top:"시그넷", free:1, total:2, tone:"busy"})` → `<div class="mk mk-line" data-around="true" data-tone="busy"><span class="mk-top">시그넷</span><b class="num">1<i>/2</i></b></div>`; `dotHtml({free:0, tone:"bad", far:true})` → `<div class="mk-dot num" data-tone="bad" data-far="true">0</div>`, `far:false` 면 `data-far` 없음.
3. **태그가 든 이름**(X = `<img src=x onerror=alert(1)>`): `bubbleHtml({top:X, free:1, total:2, sub:X, tone:'"><script>', role:'" onclick="x', far:false, dx:'1;background:url(x)', around:true})` → `<div class="mk" data-tone="bad" data-around="true"><span class="mk-top">&lt;img src=x onerror=alert(1)&gt;</span><b class="num">1<i>/2</i></b><span class="mk-sub">&lt;img src=x onerror=alert(1)&gt;</span></div>` — 결과에 `<img`·`<script`·`onclick`·`background` 가 없다. `lineHtml({top:X, free:X, total:1, tone:X})` 와 `dotHtml({free:X, tone:X, far:X})` 에도 `<img` 가 없고 숫자 칸은 `?`, tone 은 `bad`.
4. 숫자 칸: `bubbleHtml({top:"a", free:"<b>1</b>", total:NaN, tone:"good"})` → `<div class="mk" data-tone="good"><span class="mk-top">a</span><b class="num">?<i>/?</i></b></div>`. `dx`: 1.4 → `margin-left:1px`, 1.5 → `2px`, −0.4·0·`NaN`·`"12"`·`null`·`Infinity` → `style` 없음.
5. `popupHtml([{b:"판교주차장"}, "한국전력 · 충전기 가나전기", "빈 급속 0 / 전체 1 · 고장·점검 1", "최대 350kW · 391원/kWh(추정) · 2분 전 정보", "", null, {b:"1순위"}])` → `<div class="mk-pop"><b>판교주차장</b><br>한국전력 · 충전기 가나전기<br>빈 급속 0 / 전체 1 · 고장·점검 1<br>최대 350kW · 391원/kWh(추정) · 2분 전 정보<br><b>1순위</b></div>`.
6. `popupHtml([{b:X}, X + " & co", {b:null}, 5, undefined, false])` → `<div class="mk-pop"><b>&lt;img src=x onerror=alert(1)&gt;</b><br>&lt;img src=x onerror=alert(1)&gt; &amp; co<br><b></b><br>5</div>`. `popupHtml([])`·`(null)`·`("x")` → `<div class="mk-pop"></div>`.
7. `esc`: X → `&lt;img src=x onerror=alert(1)&gt;`, `"A&B"` → `A&amp;B`, `"\"'"` → `&quot;&#39;`, `null`·`undefined` → `""`, `0` → `"0"`, `12.5` → `"12.5"`, `"&amp;"` → `&amp;amp;`(두 번 하지 않도록 한 번만 부른다).
8. r5 와 이어서: 이름이 X 인 충전소를 `regionStations` 로 만들어 `bubbleHtml`·`lineHtml`·`popupHtml([{b: 이름}, …])` 에 넣은 결과 어디에도 `<img` 가 없다.

### integration — 앱 연결과 통합 흐름

**소스:** `web/app.js`, `web/index.html`, `web/build.js`. **테스트 파일 이름을 못박는다:** `tests/test_integration_relay.py`, `tests/test_integration_relay.js`(흐름), `tests/test_integration_dom.js`(가짜 화면), `tests/test_integration_data_base.json`(기준 출력). 참조: `.orchestra/logs/ref_relay/dom_stub.js`·`scenario.js`·`scenario_out.json`(옮겨 써도 된다), 고침의 참조는 `ref_patch.js`.

**고칠 것(개발 세션):**
1. `index.html`: `<script src="relay.js"></script>` 를 `app.js` 바로 앞에. '내 차·할인' 화면의 `#live-form` 앞에 `#relay-form`(체크박스 `#relay-on` "공공 데이터를 중계에서 받기", 입력 칸 `#relay-base`, 저장 단추, 글 칸 `#relay-msg`). 기존 class(`card stack`·`check`·`field`·`live-msg small`)를 쓴다(`style.css` 는 안 고친다).
2. `build.js`: 묶는 파일 목록에 `relay.js` 를 `app.js` 앞에.
3. `app.js` — 부르는 곳만:
   - 설정: 시작할 때 `EvRelay.loadSettings` 로 `#relay-on`·`#relay-base` 를 채운다. `#relay-on` 을 바꾸면 바로 `saveOn`. `#relay-form` 을 내면 `saveBase` — 떨어지면 **저장하지 않고** 까닭을 `#relay-msg` 에(tone `bad`), 통과하면 `saveOn` 도 하고 `저장했어요 HH:MM`, 칸에는 정리된 주소. 설정이 바뀌면 받아 둔 주변 충전소를 버린다.
   - 새로 받기(`doRefresh`): `EvRelay.refreshRest` 를 부른다. `direct` 는 키와 설정이 있을 때 `() => EvLiveBuild.refresh(key, cfg, {onProgress})`. `routeKey` 는 지금 노선의 key, `extraIds` 는 지금 노선(길찾기 노선 포함)의 휴게소 충전소 id. 중계가 켜져 있으면 키·설정이 없어도 받는다. 끄면 지금과 같다(키가 없으면 지금의 안내 글). 나들목 인근 충전소를 옮기는 지금 코드는 그대로 둔다. 성공 글: 중계면 `중계에서 받았어요 HH:MM · 휴게소 충전기 N대`(+ `. <note>`), 직접이면 지금의 `새로 받았어요 HH:MM · 휴게소 충전기 N대`, 예비면 `중계에 연결하지 못해 직접 받았어요. 새로 받았어요 …`. `RelayError` 는 그 글을 지금의 오류 창에.
   - 오래됨: 시작할 때와 `render()` 때마다 `EvRelay.expireLive(DATA.LIVE, Date.now())`. 노선을 바꾸면 `EvRelay.routeHint` 의 글을 `liveMsg` 로(없으면, 전에 띄운 안내만 지운다).
   - 지도: `arEnsure` 는 `EvRelay.loadRegion`(`direct` 는 `() => AR.fetchRegion(key, cfg, z)`, `tariffs` 는 `cfg.tariffs`). 중계가 켜져 있으면 키·설정이 없어도 받는다. 받은 것에 `source`·`zcodes` 를 함께 들고 있는다. 안내 글은 `주변 충전소: <note>`. `arRefreshStatus` 는 `source` 가 `"relay"` 인 시군구에 `EvRelay.refreshRegion`(`replaced` 가 오면 그것으로 바꾼다), 아니면 지금 코드. `drawAround` 는 그리기 전에 중계 시군구에 `EvRelay.expire`.
   - 글자: `bubbleIcon`·`dotIcon`·한 줄 풍선은 `EvRelay.bubbleHtml`·`dotHtml`·`lineHtml`, 팝업 둘(`popupHtml`·`arPopup`)은 **이스케이프하지 않은 줄**을 모아 `EvRelay.popupHtml` 에 넘긴다. `app.js` 의 `esc` 는 지운다.
   - 카카오 길찾기·장소 찾기·오픈스트리트맵, 노선 계산, 화면 배치는 건드리지 않는다.

**가짜 화면(`test_integration_dom.js`)** — 계획 세션이 고치기 전 `app.js` 로 돌려 보아 되는 것을 확인했다: `document.querySelector(선택자)` 가 선택자마다 같은 가짜 요소(값·글·`dataset`·`addEventListener` 를 기억, `_fire(종류)` 로 누름)를 주고, `.tabbar [data-view]` 는 탭 셋, `localStorage` 는 Map, `Date` 는 못박은 시각, `setInterval` 은 모아 두었다가 `tick(밀리초)` 로 부르고, `setTimeout` 은 5밀리초 안에, `fetch` 는 부른 주소를 적고 가짜 답을 준다. 지도 도구는 가짜 `window.L`(지도는 가운데·확대 값만 기억하고 `fire("moveend")` 로 움직임을 알림, `divIcon` 은 받은 것을 그대로 돌려줘 `html` 을 볼 수 있음, `layerGroup().layers` 에 찍힌 표식이 모임). 스크립트는 **`index.html` 의 `<script src>` 순서대로** `vm` 한 문맥에서 돌린다(`live.js` 자리에는 견본 `routes.json` 두 노선 + 경부선 앞부분 설정으로 만든 작은 것을 넣는다 — 실제 `live.js` 는 861KB 이고 다시 만들면 바뀐다).

**흐름의 가짜 자료:** 지금 09:12(NOW0). 중계 주소는 `https://vicfos99-tech.github.io/ev-station-map/relay/`(페이지가 `file:` 이라서). 중계는 견본 파일을 주고, 시군구 파일은 어느 코드를 물어도 견본 41135 를 그 코드로 바꿔 주되 첫 충전소 이름을 `<img src=x onerror=alert(1)>`, 제조사를 `<b>가나</b>` 로 한다. 공공 데이터는 휴게소 받기(`zcode`·`kindDetail=C001`)에 기흥휴게소 충전기 셋, 주변 받기(`zscode`)에 이름이 `<img …>` 인 충전소 하나를 준다. 지도는 탭을 연 뒤 가운데 `[37.3801, 127.1185]`·확대 15(와 13)로 옮긴다. 그 자리의 시군구 셋은 `EvAround.zscodesNear(EvRegions, …).slice(0, 3)` = `41130, 41610, 41460`.

통과 기준:
1. **끔 = 지금과 같다(S1).** 저장소에 `relay:"off"` 와 키를 두고 ① 시작 ② '새로 받기' ③ 지도 열고 확대 15 ④ 확대 13 ⑤ 3분 뒤 상태 다시 받기 차례. 관찰값(시작 때 화면, 새로 받기 뒤 `#live-msg`·tone·진행 창 글, 자료의 충전기 상태, 세 번의 주변 풍선 html·팝업·`#map-note`·단추 글, **부른 주소 목록 전부**, 저장소 열쇠, 잡히지 않은 오류)을 한 객체로 모은 것이 **고치기 전 `app.js` 로 뽑은 기준(`test_integration_data_base.json`)과 JSON 글자로 같다.** 기준의 값: `#live-msg` `새로 받았어요 09:12 · 휴게소 충전기 3대`, 부른 주소 7개(공공 `getChargerInfo…zcode=41&kindDetail=C001…` 1, `getChargerInfo…zscode=41130`·`41610`·`41460` 3, `getChargerStatus…zscode=…&period=5` 3), 중계 주소 0개, 풍선 셋.
2. **끔·키 없음(S2)** 도 기준과 같다: `#live-msg` `인증키를 넣고 '새로 받기'를 누르세요. 공공데이터포털 마이페이지의 일반 인증키입니다.`, `#map-note` `주변 충전소를 보려면 '내 차·할인'에서 공공 데이터 키를 한 번 넣어 주세요. 지금은 길 위 충전소만 보여요.`, 부른 주소 0개.
3. **기준 파일은 고치기 전 `app.js` 에서만 만든다.** 기준 파일에 그것을 뽑은 `app.js` 의 지문을 적어 두고 테스트가 그 값이 `d201f923e197fa8e0fc7e03e520fbf4f8398bf69c5158b5d1419344f4d15ae87`(줄바꿈을 LF 로 맞춘 sha256, 커밋 20951d8 의 `web/app.js`)인지 본다. 테스트 세션은 흐름 JS 를 '기준 뽑기'로 돌려(지금 `app.js` 의 지문이 그 값일 때만 쓴다) 파일을 만들고, 계획 세션의 `scenario_out.json` 과 큰 값(위 1·2 의 글과 주소 수)이 맞는지 확인한다.
4. **켬(기본 주소)·키 없음(S3).** 시작 때 `#relay-on` 이 체크, `#relay-base` 는 빈 글. '새로 받기' 뒤 부른 주소가 중계의 `meta.json`, `routes.json`, `status/rest/KP000101.json` **셋뿐**(공공 데이터 주소 0번), `#live-msg` `중계에서 받았어요 09:12 · 휴게소 충전기 3대`(tone `good`), 자료는 `live-gb-down` 의 KP000101 이 `charging, charging`·`updated` 1767571800000, `live-gb-up` 의 KP000102 는 `available`, `EvData.LIVE.relay.ids` 가 `["KP000101"]`.
5. 노선을 `live-gb-up` 으로 바꾸면 `#live-msg-route` 가 `이 노선의 상태는 아직 받지 않았어요. '새로 받기'를 눌러 주세요.`, `live-gb-down` 으로 돌아오면 빈 글.
6. **지도 주변이 같은 모양(S3 이어서).** 확대 15: 풍선 6개(시군구 셋 × 충전소 둘), 부른 주소는 시군구마다 `meta.json`·`stations/<코드>.json`·`status/<코드>.json`. 이름이 태그인 충전소의 풍선은 `<div class="mk" data-tone="good" data-around="true"><span class="mk-top">환경부</span><b class="num">1<i>/1</i></b><span class="mk-sub">&lt;b&gt;가나&lt;/b&gt;</span></div>`, 팝업은 `<div class="mk-pop"><b>&lt;img src=x onerror=alert(1)&gt;</b><br>환경부 · 충전기 &lt;b&gt;가나&lt;/b&gt;<br>빈 급속 1 / 전체 1<br>최대 50kW · 347원/kWh(추정) · 2분 전 정보</div>`. 판교주차장은 `0<i>/1</i>`·tone `bad`. 확대 13 의 한 줄 풍선은 `<div class="mk mk-line" data-around="true" data-tone="good"><span class="mk-top">&lt;b&gt;가나&lt;/b&gt;</span><b class="num">1<i>/1</i></b></div>`. **모든 풍선 html·팝업에 `<img` 가 없다.** 공공 데이터 주소 0번.
7. 3분 뒤 상태 다시 읽기: 새로 부른 주소가 시군구마다 `meta.json`·`status/<코드>.json` **둘씩 여섯뿐**(`stations/` 는 다시 안 부름), 풍선은 그대로.
8. **받아 둔 채 40분이 흐름(N12).** 같은 화면에서 시계만 NOW0 + 40분으로 돌리고 '경로' 탭을 다시 열면 자료의 충전기가 모두 `comm_error`, 지도 탭으로 가 움직이면 주변 풍선이 모두 `0<i>/1</i>`·tone `bad`.
9. **중계가 40분째 멈춤(S4).** 지금을 T_META + 40분으로 두고 시작 → '새로 받기' 뒤 `#live-msg` `중계에서 받았어요 09:50 · 휴게소 충전기 3대. 40분 전 상태라 빈자리를 세지 않았어요.`(tone `warn`), 자료의 충전기 모두 `comm_error`, 지도 `#map-note` `주변 충전소: 40분 전 상태라 빈자리를 세지 않았어요.`, 풍선 모두 `0<i>/1</i>`. 공공 데이터 주소 0번.
10. **조용한 충전소(N1).** `status/rest/KP000101.json` 의 `at` 만 08:32 로 바꾸고 meta 는 그대로 → '새로 받기' 뒤 KP000101 이 `charging, charging` 이고 `#live-msg` 에 "세지 않았어요" 가 없다.
11. **중계 실패 까닭.** `meta.json` 을 `ok:false, error:"상태 받기 실패: HTTP 500 https://apis.data.go.kr/x?serviceKey=abcd"` 로 주면 `#live-msg` 에 `중계가 마지막 받기에 실패했어요(상태 받기 실패: HTTP 500 (주소)).` 가 있고 `http`·`abcd` 가 없다.
12. **중계 404 + 키 있음(S5).** '새로 받기': 부른 주소가 중계 `meta.json` 하나 + 공공 `getChargerInfo…zcode=41…` 하나, `#live-msg` `중계에 연결하지 못해 직접 받았어요. 새로 받았어요 09:12 · 휴게소 충전기 3대`(tone `warn`), 자료에 `relay` 표식이 없다. 지도: `#map-note` `주변 충전소: 중계에 연결하지 못해 직접 받았어요`, 풍선 셋(직접 받은 것), 풍선·팝업에 `<img` 없음.
13. **중계 404 + 키 없음(S6).** `#live-msg` `중계에 파일이 없어요. 공공 데이터 키를 넣으면 직접 받을 수 있어요.`(tone `bad`), 오류 창이 열려 있고 그 글에 ` 지금 정보는 그대로예요.` 가 붙음, 자료는 그대로, 공공 데이터 주소 0번. 지도 `#map-note` `주변 충전소를 받지 못했어요(중계에 파일이 없어요. 공공 데이터 키를 넣으면 직접 받을 수 있어요.). 잠시 뒤 다시 받아요.`. 어느 글에도 `https://`·`github.io` 가 없다.
14. **설정(S7).** `#relay-base` 에 `http://x.example/r/` 를 넣고 내면 `#relay-msg` `주소는 https:// 로 시작해야 해요.`(tone `bad`)이고 저장소에 `ev-charge-planner/relay-base` 가 **없다**. ` https://x.example/r ` 를 넣고 내면 `저장했어요 09:12`, 저장값·칸 값 `https://x.example/r/`, 이어서 '새로 받기' 의 주소가 `https://x.example/r/meta.json`·`routes.json`·`status/rest/KP000101.json`. `#relay-on` 을 끄고 `change` → 저장값 `off`, 이어서 '새로 받기'는 키 안내 글이고 새로 부른 주소 0개. 빈 글로 내면 `relay-base` 열쇠가 지워진다. 저장소에 `relay:"off"`·`relay-base:"https://x.example/r/"` 를 두고 시작하면 체크가 꺼져 있고 칸에 그 주소.
15. **다시 엶(S8).** 켬으로 받아 저장된 자료(`ev-charge-planner/live`)를 들고 NOW0 + 27분에 다시 시작 → KP000101 `charging, charging`(확인 시각 뒤 29분), KP000102 `comm_error`(목록 받은 지 39분). NOW0 + 40분에 다시 시작 → 모두 `comm_error`. 잡히지 않은 오류 없음.
16. **웹에서 엶.** 페이지 주소가 `https://me.example/ev/index.html` 이면 첫 두 주소가 `https://me.example/ev/relay/meta.json`, `…/routes.json`.
17. 모든 흐름에서 스크립트를 불러올 때와 누를 때 **잡히지 않은 오류·거절이 0건**.
18. **글자(파일 검사).** `web/app.js` 에 `<div class="mk`·`<br>`·`<b>`·`mk-pop` 이 없고, `innerHTML`·`outerHTML`·`insertAdjacentHTML`·`document.write` 가 없고, `divIcon(` 의 수(3)와 `html: <이름>.(bubble|line|dot)Html(` 의 수가 같고, `popupHtml(` 을 부르는 곳이 있다. `app.js` 가 쓰는 `EvRelay` 의 이름(`const X = window.EvRelay` 의 `X.이름`, 또는 `EvRelay.이름`)이 **모두** `require("../web/relay.js")` 에 있다. `vicfos99-tech.github.io` 는 `relay.js` 에 1번, `app.js`·`index.html` 에 0번.
19. **`index.html`·`build.js`.** `<script src="relay.js"></script>` 가 한 번이고 `app.js` 보다 앞·`around.js` 보다 뒤. `id="relay-form"`·`id="relay-on"`(`type="checkbox"`)·`id="relay-base"`·`id="relay-msg"` 가 한 번씩. `#relay-form` 이 `#live-form` 보다 앞.
20. **빌드.** `web/` 의 파일을 `tmp_path/web/` 에 베껴(폴더 `dist`·`test` 는 빼고) `node <tmp>/web/build.js` → 종료 코드 0, `dist/index.html`·`dist/artifact.html`·`dist/충전길잡이.html` 이 있고, `dist/index.html` 에 `ANDROID_BASE` 의 주소 글자가 있고 `<script src=` 가 없다. 저장소의 `web/dist/` 는 테스트 전후로 같다.
21. **안 바꾼 파일.** 줄바꿈을 LF 로 맞춘 sha256 이 아래와 같다.

| 파일 | sha256 (CRLF → LF) |
|---|---|
| `web/engine.js` | `1b198a3df993a1dc8c8398654107f721089ac4f759a7fff2d1e99cd394296bdc` |
| `web/live_build.js` | `dae38a994c76ab8466f7720c3b4b54f3d010fe1e85fb011a50e945672d689c96` |
| `web/around.js` | `e517c8e60cf809acdeb34fcd4153e517e93ed5ce08bf145096a87786518c9201` |
| `web/navi.js` | `5418c23bcf3ce3724af5ab7114b02d12d7ca162670b8fb37a866622cf7010cdd` |
| `web/data.js` | `44bd97d740a7b37e47b0faab8f6816e9cd794c7205c636d9e76ea5162fbbd874` |
| `web/regions.js` | `60d68b8a30ae07431ee4da612b29323d2f9aedd360a80a6f84e7ecac1c44c337` |
| `web/style.css` | `fd39eea00046c2c90aae9542173d5265b896348f56fb9d6834dc05fe714307ed` |
| `web/test/compare.js` | `0c43da3e7757b4c869b60bac7fbcf5c90b965a81361bf963737fac079e1f0981` |
| `web/test/compare_live.js` | `10b15e32889e41c8baa968fa814e01329d3741374901c798dcb659334aa09fb6` |
| `web/test/test_locate.js` | `85d273c4e36090891f38547164bdad232119a71812bc96d552cf68f43ce7750d` |
| `web/test/test_around.js` | `ea3bba4371c0022422aeae967b06ad64cbd0ffe1f5c9d3603cae0bc98f3fceae` |
| `web/test/fixtures.json` | `f0ebba97e1dc905ce2f576e34b54f2a4592fab09ce886c0c6600755da1396dcd` |
| `web/test/live_fixture.json` | `4e5028dde336a95d3465ab0eb9267f2307131779cad11beaf1e30b80b1d7d3cc` |

22. **기존 대조.** `node web/test/compare.js`, `compare_live.js`, `test_locate.js`, `test_around.js` 가 종료 코드 0. `compare_navi.js` 는 `web/test/navi_fixture.json` 이 있을 때만 돌린다(그 파일은 `.gitignore` 에 있어 다른 PC 에는 없다). 계획 세션이 돌린 값: `checks: 500, failures: 0` / `items: 2399, checks: 25192, failures: 0` / `확인 1580개, 실패 0개` / `확인 22개, 실패 0개` / `cases: 17, checks: 6560, failures: 0`.
23. 잠긴 파이썬 테스트(`tests/test_p1_…`~`test_p7_…`)가 그대로 통과한다(전체 pytest).

## 6. 통합 흐름 (요구사항 문장 ↔ 통과 기준)

| 요구사항의 흐름 | integration 기준 |
|---|---|
| 중계 끔 → 기존 대조 통과 | 1, 2, 21, 22 |
| 중계 켬(기본 주소) → 새로 받기가 중계 파일만 읽음(공공 데이터 주소 호출 0번) | 4 |
| 지도 주변이 같은 모양 | 6, 7 (+ r5 기준 2) |
| 상태 `at` 을 40분 전으로 → 빈자리 0으로 셈 | **9**(meta·상태 모두 40분 전 = 중계가 멈춤), 8(받아 둔 채 40분), 그리고 **10** 은 반대로 센다(상태 `at` 만 40분 전·meta 는 방금 — N1) |
| 중계 404 + 키 있음 → 직접 받기로 넘어가고 안내 글 | 12 |
| 이름에 태그 → 풍선 html 에 태그 없음 | 6, 12, 18 (+ r6 기준 3) |
| `node build.js` 성공 | 20 |
| (요구사항 2) 키도 없으면 오류 글 | 13 |
| (요구사항 1) 주소는 https 아니면 저장하지 않고 이유 | 14 |
| (요구사항 4) `ok` 가 false 면 이유를 짧게, 키·주소 없이 | 11 |

## 7. 보고서에 꼭 넣을 것

- 바꾼 파일과 함수 목록: `web/relay.js`(내보내는 이름 전부), `web/app.js`(고친 함수: `doRefresh`·`rfApply`·`rfShowProgress`·`arEnsure`·`arRefreshStatus`·`drawAround`·`arPopup`·`bubbleIcon`·`dotIcon`·`popupHtml`·`render`, 새 설정 처리), `web/index.html`, `web/build.js`.
- 묘성이 정할 것: 2.0 의 일곱 줄(특히 ⚠ 15분·30분, N1, N4).
- 실제 폰에서 확인할 것: ① 중계 주소로 실제로 읽히는지(GitHub Pages 캐시 10분·CORS, 안드로이드 앱 안에서 기본 주소) ② '내 차·할인'의 새 칸이 화면에 맞는지 ③ 지도 풍선 모양이 그대로인지 ④ 키 없이 '새로 받기'·주변 충전소가 되는지 ⑤ 중계를 끄면 전과 같은지 ⑥ 비행기 모드에서 안내 글 ⑦ 노선을 바꿨을 때 안내 글.
- 배포는 대화에서: `node web/build.js` 로 `web/dist/` 다시 만들기, `pages.yml`(2.0-6), push.

## 8. 참조 구현 돌리는 법

`.orchestra/logs/ref_relay/` (제품 코드가 아니다. 계획 세션이 값을 뽑으려고 썼다):

| 파일 | 내용 |
|---|---|
| `relay.js` | `web/relay.js` 의 참조 구현(r1~r6 전부) |
| `test_p0_node.py`·`test_p0_fake.js` | p0 틀의 참조 |
| `ref_values.js` → `ref_values_out.txt`·`.json` | r1~r6 표의 값 |
| `ref_patch.js` | `app.js`·`index.html`·`build.js` 고침의 참조(글자 바꾸기 목록) |
| `dom_stub.js`·`scenario.js` → `scenario_out.json` | 가짜 화면과 통합 흐름 S1~S8 |
| `ref_build.js` → `build_out.json` | 임시 폴더 빌드와 파일 검사 |

돌리기: `py -m pytest -q --tb=short -p no:cacheprovider .orchestra/logs/ref_relay` → 계획 세션에서 `3 passed`(값 뽑기·통합 흐름·빌드).

## 판정 보완 (지휘 스크립트가 자동으로 붙임)
- [p0] p0: tests/test_p0_relay.js 와 tests/test_p0_fake.js 도 tests.lock.json 에 잠기는 테스트 파일이다. 기준 3·4·5·7 의 값 단언은 JS 안에만 두고 파이썬 쪽은 확인 이름과 ok 만 본다(C7). 파이썬에서 같은 값을 다시 단언하지 않는다.
- [p0] p0: 같은 이름으로 check 를 세 번 이상 부르면 '<이름> (이름 겹침)' 실패 확인이 그 횟수만큼 더해져도 된다(run_js 의 딕셔너리에서는 하나로 접힌다). 처음 확인은 그대로 남는다.
- [p0] p0: run_js 의 AssertionError 글에는 파일 이름·종료 코드(exit N)·표준 출력 끝 1000자·표준 오류 끝 2000자를 넣는다.
- [r1_settings] r1_settings loadSettings 의 base 는 저장된 글자 그대로가 아니라 checkBase 가 돌려준 정리값(base)이다(참조 구현과 같다. 저장값은 saveBase 가 정리한 것만 넣으므로 보통은 같은 글자이고, 이 차이는 r1 테스트로 고정하지 않았다).
- [r1_settings] r1_settings 테스트는 ANDROID_BASE 를 relay.js 에서 꺼내지 않고 3.1 의 글자 상수와 견준다. 상수 값 자체의 확인은 p0 기준 5 가 맡는다.
- [r1_settings] r1_settings 의 '저장소를 한 번도 부르지 않고'(199행)는 getItem 도 포함한다. p0 의 makeStorage.log() 는 set·remove 만 적으므로 테스트는 쓰기가 없음과 '모든 동작이 던지는 저장소에서도 검사 까닭이 나옴'으로만 본다(읽고 버리는 getItem 은 잡지 못함 — 알고 둔 빈틈).
- [r3_read] r3_read urlOf 의 kind 가 meta·routes 이면 id 는 보지 않는다(나쁜 id '../evil' 을 줘도 meta.json 주소를 준다). base 는 'https://' 뿐이면(뒤에 사이트가 없으면) bad_base 다.
- [r3_read] r3_read getJson 의 상태 코드가 정수가 아니면(글자 '404'·503.5·없음) 404 로 보지 않고 http·'중계가 0 로 답했어요' 다. ok 가 거짓이면 status 가 200 이어도 http('중계가 200 로 답했어요')이고 404 면 missing 이다. fetch 가 Error 가 아닌 것(null·글자)으로 거절해도 network 다.
- [r3_read] r3_read parseStations·parseRest 는 둘째 인자(zscode·id)와 파일의 칸이 둘 다 없어도(undefined === undefined) 거부한다. 인자가 글자가 아니면 거부다.
- [r3_read] r3_read parseRest 의 'id 글자 순'은 글자 코드 순이다('02' < '1' < '10'). localeCompare 와 갈리는 id 는 시험하지 않았다.
- [r3_read] r3_read parseRoutes 는 충전기의 id 칸을 옮기지 않는다(견본 충전기의 칸 type·power_kw·status·last_end 만). parseStations 의 operator 가 글자가 아니면(숫자) '알 수 없음', name 이 글자가 아니면 '' 이다.
- [r3_read] r3_read 테스트가 잡지 못하는 알고 둔 빈틈: parseStations 의 v '1'·true(느슨한 비교), parseRest 의 at null·v null, parseStatus 안쪽 충전소 객체의 프로토타입, base 앞뒤 빈칸. 개발은 계획 308·312행 문장대로(v !== 1, at 을 못 읽으면 거부, v 가 undefined 가 아닌데 1 이 아니면 거부) 구현한다.
- [r4_rest] r4_rest: relay.ids·relay.missing·relay.mixed 의 순서는 routesDoc 에 충전소가 나온 순서다(wanted 순서가 아니다). 잠긴 테스트는 여러 개일 때 정렬해 견주므로 순서를 강제하지 않는다.
- [r4_rest] r4_rest: refreshRest 의 onProgress 는 선택 인자다. 함수가 아니면(안 주면) 부르지 않고 그대로 진행한다. 잠긴 테스트에는 onProgress 없이 성공 갈래를 도는 사례가 없으니 개발 세션이 지킨다.
- [r4_rest] r4_rest: relay.oldest 는 덮어쓴 충전소들의 updated 가운데 최솟값이다(차례와 무관). 잠긴 테스트는 더 이른 값이 뒤 차례에 오는 사례만 있어 '마지막으로 덮어쓴 값'과는 가르지 못하니 개발 세션이 min 으로 구현한다.
- [integration] (11/17 묘성: "통합테스트는 단위테스트 내용을 추합해서 플러스 2000자로") **통합 테스트는 새로 길게 쓰지 않는다.** 앞 부분(p0·r1~r6)의 테스트 파일이 이미 만든 도우미·가짜 fetch·시험 자료를 불러(import·require) 이어 붙여 통합 흐름을 짠다. 통합 부분에서 새로 쓰는 글은 `tests/test_integration_` 파일 전부 합쳐 **3000자 이하** 로 한다(묘성 11/17 고침: 통합 테스트 크기 = 불러 쓰는 단위 테스트에서 잰 길이 + 새 글 3000자). 단위 테스트에 이미 있는 검사를 다시 쓰지 않는다. 다 쓴 뒤 길이를 재어 확인한다. 앞 부분 테스트 파일은 고치지 않는다(잠김).
