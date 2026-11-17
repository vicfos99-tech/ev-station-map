# ev-app-relay-raw 계획서 — 충전 길잡이가 중계 페이지(relay-data raw 주소)를 바로 읽게 하기

작성: 2026-11-17 계획 세션. 출처 요구사항: `specs/ev-app-relay-raw.md`.
교훈 반영: `.orchestra/memory/lessons.md` 의 '공통'·'계획'.
앞 단계 계획서: 충전소 고르기 엔진 `docs/plan_stage1.md`, 앱 중계(ev-app-relay) `docs/plan_stage2.md`, 비밀값 허용 목록(ev-secret-allow) **`docs/plan_stage3.md`**(이번에 옮겨 둠 — 계획 밖 파일, 까닭은 교훈 "plan.md 를 덮어쓰면 잠긴 테스트의 'plan.md N행' 인용이 죽는다"). 잠긴 `tests/test_p0_…`~`test_r6_…`·`test_integration_relay…` 의 "plan.md N행"은 `plan_stage2.md`, `test_a1_allow_…`·`test_integration_secret.py` 의 것은 `plan_stage3.md` 다.

**한 줄 결론:** `web/relay.js` 한 파일에서 `ANDROID_BASE` 를 raw 주소로 바꾸고 `defaultBase` 에 "우리 사이트에서 열렸으면 raw 주소" 갈래를 넣는다. 다만 **(1) 주소만 바꾸면 지금 통과하는 잠긴 테스트 `test_build` 가 새로 깨진다 — 옛 주소 글자를 상수 하나로 남겨야 한다(3.1). (2) 폰 앱(APK)의 화면 주소는 `https://localhost/` 라서 요구사항 그대로면 앱은 계속 `https://localhost/relay/` 를 읽어 중계를 못 본다 — 그래서 그 주소도 raw 로 보냈다(N1, 묘성이 정할 것 1번). (3) 이 실행은 코드만 고친다. 올리기(push)와 APK 다시 만들기를 하지 않으면 사이트·폰 어디에도 안 보인다(묘성이 정할 것 2번).**

아래에서 **RAW** = `https://raw.githubusercontent.com/vicfos99-tech/ev-station-map/relay-data/` (끝에 `/`), **옛 주소** = `https://vicfos99-tech.github.io/ev-station-map/relay/`.

## 0. 실행 환경 (가장 먼저 확인)

| 항목 | 값 |
|---|---|
| 실행 PC 파이썬 | **Python 3.10.0**. 표준 라이브러리만. 3.11 전용(`tomllib`·`StrEnum`·`datetime.UTC`·`typing.Self`)은 쓰지 않는다. `pyproject.toml` 은 고치지 않는다 |
| 테스트 명령(글자 그대로) | `py -m pytest -q --tb=short -p no:cacheprovider` |
| 바깥 도구 | **node**(잠긴 `tests/test_p0_node.py` 의 `run_js`·`run_node` 로만 부른다. 셸에서 `node …` 를 바로 치면 거부된다). 네트워크 없음 — 가짜 fetch 만 |
| 고치는 소스 | **`web/relay.js` 하나뿐** |
| 고치지 않는 것 | `web/` 의 다른 파일 전부(`app.js`·`index.html`·`dist/` 포함), `app/`, `src/`, `tools/`, `ref/`, `specs/`, `.github/`, 잠긴 `tests/` 전부, `tests.lock.json` |
| 새 테스트 파일 | g1: `tests/test_g1_rawbase_base.js`, `tests/test_g1_rawbase_base.py` / integration: `tests/test_integration_rawbase.js`, `tests/test_integration_rawbase.py`. 이 넷뿐. `tests/data/`·`conftest.py` 는 만들지 않는다 |
| 시험 자료 | 테스트 파일 안의 글자와 `tmp_path`, 이미 있는 `ref/relay_sample/`(읽기만) |
| 파일 인코딩 | 모두 UTF-8 |
| 참조 구현 | `.orchestra/logs/ref_rawbase/` (5절). 제품이 아니다. 이 계획서의 표·주소·글은 전부 그 실행 출력에서 옮겼다 |

- **부분 id** 는 `g1_rawbase`, `integration`. `integration` 은 앞 단계와 이름이 같으므로 **새 테스트 파일 이름을 위 둘로 못박는다.** 이미 있는 `tests/test_integration_relay.py`·`.js`·`test_integration_dom.js`·`test_integration_data_base.json`·`test_integration_secret.py` 는 잠긴 파일이니 고치지 않는다(읽고 `require` 하는 것은 된다).
- **테스트 글자 수**(글자 수 = UTF-8 로 읽은 `len`. 이 셸의 `wc -m` 은 바이트를 낸다): g1 새 파일 둘 합쳐 **20,000자 이하**, integration 새 파일 둘 합쳐 **10,000자 이하**. 둘을 더해도 요구사항의 4만5천 자 아래다. 한도 때문에 사례를 빼지 않는다 — 4절의 사례는 전부 필수이고 표를 그대로 옮기면 한도 안에 든다.
- **수용 기준은 모두 8개**(g1 6개 + integration 2개). 요구사항의 "8개 이하"를 두 부분을 합쳐 지킨다.
- **저장소 안에 산출물을 만들지 않는다.** 빌드는 `tmp_path` 에 복사한 `web/` 에서만 돌린다(`web/dist/` 를 건드리지 않는다).
- 세션은 `bash tools/push.sh` 를 돌리지 않는다(진짜로 올라간다).

## 1. 개요

지금: `ANDROID_BASE` = 옛 주소. `defaultBase(href)` 는 http(s) 페이지면 페이지 기준 `./relay/`, 아니면 `ANDROID_BASE`. 그래서 사이트에서 열면 옛 주소(사이트의 `relay/` 폴더 — 12:51 에 멈춤)를 읽는다.

고친 뒤: 사이트(`vicfos99-tech.github.io`)와 폰 앱 화면(`https://localhost/`)에서 열면 RAW 를 읽는다. 그 밖의 http(s) 페이지는 지금처럼 `./relay/`, http(s) 가 아니면 `ANDROID_BASE`(= RAW). 설정에 넣은 주소가 있으면 지금처럼 그것이 먼저다.

지금 작업 트리에서 계획 세션이 돌린 전체 테스트: **33 failed, 1818 passed**(실패는 모두 잠긴 테스트의 기본 주소 상수가 RAW 로 바뀐 데서 온다).

| id | 이름 | 소스 | 의존 | 하는 일 |
|---|---|---|---|---|
| `g1_rawbase` | 기본 중계 주소 | `web/relay.js` | - | `ANDROID_BASE`·`defaultBase` 를 고친다. 요구사항의 수용 기준 여섯을 이 부분 혼자 다 채운다 |
| `integration` | 화면 흐름과 빌드 | `web/relay.js` | g1_rawbase | 가짜 화면으로 실제 `web/` 을 띄워 '새로 받기'를 눌러 보고, 빌드한 한 파일 앱에 새 주소가 들었는지 본다. **개발 몫은 없는 것이 정상**(g1 이 끝나면 새 통합 테스트가 그대로 통과해야 한다. 실패하면 `web/relay.js` 만 고친다) |

두 부분이 `web/relay.js` 한 파일을 본다. g1 테스트는 끝까지 참인 것만 단언하므로 충돌이 없다(integration 은 그 파일을 더 고치지 않는다).

## 2. 결정 목록

### 2.0 묘성이 정할 것 (맨 위부터 중요한 순)

1. **폰 앱 화면 주소 `https://localhost/` 도 RAW 로 보냈다(N1 — 요구사항에 없는 갈래).** `app/README.md` 3행: 앱은 Capacitor 7 이고 "앱 안에서는 화면이 `https://localhost` 로 열린다". 요구사항 2번 그대로면 그 주소는 "그 밖의 http(s) 페이지"라서 `https://localhost/relay/` 를 읽는데, 앱 안에는 그 폴더가 없다(참조 old 실행: 첫 요청이 `https://localhost/relay/meta.json`). 즉 **이 갈래가 없으면 폰 앱(APK)은 고친 뒤에도 중계를 못 본다.** 잠긴 테스트는 앱 주소를 `file:///android_asset/…`·`capacitor://localhost/` 로만 가정해서 지금까지 드러나지 않았다. 범위는 좁게 잡았다: **스킴 https + 호스트 정확히 `localhost` + 포트 없음**일 때만. 내 PC 시험(`http://localhost:8000/…`, `http://localhost/…`, `https://localhost:8443/…`)은 지금처럼 `./relay/`. **싫으면:** 4절 G3 과 표 B, I1 의 F3·F9 를 빼고 `defaultBase` 의 그 한 줄을 지우면 된다(잠긴 뒤라면 `tests/test_g1_rawbase_…`·`test_integration_rawbase…` 를 풀어야 한다).
2. **이 실행은 코드만 고친다. 사람이(또는 대화에서) 해야 보인다:** (a) `master` 로 올리면(`tools/push.sh`) GitHub 가 `web/build.js` 로 다시 만들어 사이트에 낸다 → 사이트는 여기까지면 된다. (b) **폰 앱(APK)은 `node web/build.js` → `node app/copy-web.js` → APK 다시 만들기·설치**를 해야 바뀐다. 안 하면 폰 앱은 옛 주소 그대로다. (c) 저장소에 들어 있는 `web/dist/` 세 파일은 이 실행 뒤 옛 것이다(잠긴 테스트는 그것이 최신인지 보지 않는다). (d) **설정의 '중계 주소' 칸에 옛 주소를 넣어 둔 폰은 계속 그 주소를 읽는다**(설정이 먼저다). 그 칸을 비워야 한다.
3. **RAW 주소의 실제 응답을 이 세션은 확인하지 못했다**(`curl` 이 승인되지 않음). 코드로 본 것: 앱은 `fetch(url, {cache:"no-cache"})` 뒤 글자로 읽어 `JSON.parse` 하므로 응답 종류(text/plain)는 상관없다. 확인 못 한 것: (가) 다른 사이트에서 읽기 허용(CORS) 머리글이 오는지, (나) 저장소가 공개인지(비공개면 404 → 앱은 "중계에 파일이 없어요"), (다) **GitHub 쪽 캐시**(흔히 5분쯤으로 알려져 있다 — 미확인). (다)가 맞으면 앱이 보는 `meta.json` 이 실제보다 최대 5분쯤 늦다: 10분마다 올리기 + 5분 = 최대 15분쯤 → 15분 문턱(`NOTE_MIN`)에 걸려 "오래됨" 안내가 가끔 뜰 수 있다. **올린 뒤 폰에서 '새로 받기'를 눌러 받은 시각을 한 번 봐 주면 된다.**
4. **부분이 둘이다(N2). 그리고 지휘 스크립트가 `tests/test_integration_` 로 시작하는 파일을 전부 세면 integration 은 글자 수 한도에 걸린다.** 요구사항은 "부분 하나"였는데 계획 지시문이 `integration` 부분을 꼭 넣으라고 한다. 이미 있는 잠긴 `tests/test_integration_*` 다섯 파일만으로 **47,404자**(참조 `out_chars.txt`)라 4만5천 자를 넘는다. 계획 세션은 스크립트를 읽을 수 없어(`20_도구/ai-dev-orchestra` 읽기 거부) 어떻게 세는지 모른다. 그래서 **g1 혼자 요구사항의 수용 기준을 다 채우게** 했다 — integration 이 한도나 "개발할 것이 없음" 때문에 막혀도 고침 자체는 g1 에서 끝나 있다. 막히면 그 부분만 버려도 된다.
5. **옛 주소 글자가 `web/relay.js` 에 상수(`SITE_RELAY`)로 남는다(N3).** 잠긴 테스트 둘이 함께 요구해서다(3.1). 읽는 데는 쓰지 않고 호스트 이름을 꺼내는 데만 쓴다. 깔끔히 지우려면 잠긴 `tests/test_integration_relay.py` 17행의 조건을 풀어야 한다.
6. **사이트의 `relay/` 폴더를 10분마다 만드는 예약 실행(`.github/workflows/pages.yml`)은 이제 앱이 쓰지 않는다.** 이 일 밖이라 그대로 두었다. 남겨 둬도 해는 없다(다른 사이트에 복사해 쓰는 사람은 여전히 `./relay/` 를 읽는다).
7. 화면 안내 글은 고치지 않았다. 설정 칸의 "비워 두면 기본 주소"는 그대로 맞는 말이다.

### 2.1 요구사항과 다름

| # | 요구사항 | 이 계획 | 까닭 / 잃는 것 |
|---|---|---|---|
| N1 | 그 밖의 http(s) 페이지(`localhost` 등)는 지금처럼 `./relay/` | `https://localhost/`(https·호스트 `localhost`·포트 없음)만은 RAW | 2.0 의 1번. 잃는 것: 내 PC 에서 포트 없는 https 로 `localhost` 를 띄워 시험하면 `./relay/` 가 아니라 RAW 를 읽는다 |
| N2 | 부분 하나, 수용 기준 8개 이하, 테스트 4만5천 자 이하 | 부분 둘. 기준은 합쳐 8개, 새 테스트는 합쳐 3만 자 이하 | 2.0 의 4번 |
| N3 | `ANDROID_BASE` 값을 바꾼다 | 바꾸되, 옛 주소 글자를 `SITE_RELAY` 상수로 남긴다 | 2.0 의 5번, 3.1 |

### 2.2 비워 둔 곳을 채움

| # | 정한 것 |
|---|---|
| K1 | "호스트가 같다" = `new URL(href).hostname` 이 `vicfos99-tech.github.io` 와 글자까지 같다. `hostname` 은 소문자로 바뀌어 나오고 포트·사용자 이름을 담지 않는다. 그래서 대문자, `:8443`, `user@` 가 붙어도 우리 사이트다. 스킴이 `http` 여도 우리 사이트다 |
| K2 | 사이트의 어느 경로든(`/other/deep/page.html`, 경로 없음) 우리 사이트다. 호스트만 본다 |
| K3 | 호스트 끝에 점이 붙은 `vicfos99-tech.github.io.` 은 다른 호스트로 본다(`./relay/`) |
| K4 | 호스트 이름이 경로·쿼리·`#` 뒤·사용자 이름 자리에 들어 있는 주소는 우리 사이트가 아니다 |
| K5 | `https://localhost:443/` 은 포트 없음과 같다(URL 이 기본 포트를 지운다) → RAW |
| K6 | 순서: ① 글자가 아니거나 `http://`·`https://` 로 시작하지 않으면(대소문자 무관, 앞 공백 포함) `ANDROID_BASE` ② `new URL(href)` 가 던지면 `ANDROID_BASE` ③ 우리 사이트면 `ANDROID_BASE` ④ 앱 화면이면 `ANDROID_BASE` ⑤ 그 밖은 `new URL("./relay/", href).href`. 어느 갈래도 던지지 않는다 |
| K7 | RAW 주소 자신을 페이지로 연 경우는 "그 밖의 http(s)"다 → `…/relay-data/relay/` |
| K8 | `baseOf`·`checkBase`·`loadSettings`·`saveOn`·`saveBase` 와 나머지 함수는 한 글자도 고치지 않는다 |

### 2.3 막지 못함 / 남는 것

| # | 내용 |
|---|---|
| M1 | GitHub 쪽 캐시만큼 늦게 보인다(2.0 의 3번). 앱은 주소에 시각을 붙여 캐시를 피하지 않는다 |
| M2 | 설정에 옛 주소가 저장된 폰은 계속 옛 폴더를 읽는다(2.0 의 2번 (d)) |
| M3 | 같은 호스트(`vicfos99-tech.github.io`)의 다른 저장소 페이지에서 열어도 RAW 를 읽는다. 같은 계정이라 문제로 보지 않았다 |
| M4 | 사이트를 다른 주소(자기 도메인)로 옮기면 그 주소는 "그 밖의 http(s)"가 되어 다시 `./relay/` 를 읽는다 |

### 2.4 앞 단계 최종 검수에서 남았던 것

| 앞 단계 지적 | 이번 설계에서 |
|---|---|
| "`relay-data` 브랜치를 사이트의 `relay/` 로 내는 장치가 없어 켜도 앱에 안 보임"(ev-data-relay 3단계 Q1, ev-app-relay D4) | **풀림** — 앱이 브랜치를 바로 읽는다. 단 2.0 의 2번(올리기·APK)이 있어야 한다 |
| 앱이 보는 `meta.at` 이 실제보다 늦음(신선도, 1~3단계 Q1·Q2) | **그대로 남음.** 오히려 M1 만큼 더 늦을 수 있다 |
| 그 밖(지도 탭 30분 규칙 등) | 이 일과 무관. 그대로 |

## 3. 공통 규칙

### 3.1 잠긴 테스트가 `web/relay.js` 글자에 거는 조건 둘 (반드시 함께 지킨다)

| 잠긴 테스트 | 조건 |
|---|---|
| `tests/test_p0_relay.py::test_relay_android_host_exactly_once` | `web/relay.js` 글 전체(주석 포함)에 `vicfos99-tech.github.io` 가 **정확히 1번** |
| `tests/test_integration_relay.py::test_build` | 빌드한 `dist/index.html` 에 `vicfos99-tech.github.io/ev-station-map/relay/` 가 들어 있다. `app.js`·`index.html` 에는 그 호스트 이름을 쓸 수 없으니(`test_text`) 이 글자는 `relay.js` 에서 와야 한다 |

둘을 함께 지키는 길: **그 한 번을 옛 주소 꼴 그대로 둔다.** 참조는 이렇게 했다.

```js
const ANDROID_BASE = "https://raw.githubusercontent.com/vicfos99-tech/ev-station-map/relay-data/";
const SITE_RELAY = "https://vicfos99-tech.github.io/ev-station-map/relay/"; // 우리 사이트의 옛 중계 폴더(더는 읽지 않는다)
const SITE_HOST = SITE_RELAY.split("/")[2]; // 이 호스트에서 열렸으면 중계 페이지를 바로 읽는다
```

- 주석에 그 호스트 이름을 또 적으면 2번이 되어 깨진다. `defaultBase` 위 주석에는 "우리 사이트"라고만 적는다.
- `ANDROID_BASE` 만 바꾸고 호스트를 `"vicfos99-tech.github.io"` 로 따로 적으면 p0 는 통과하지만 **`test_build` 가 새로 깨진다**(참조 첫 실행: 1 failed, 1486 passed).

### 3.2 그 밖

- C1. `defaultBase` 는 어떤 입력에도 던지지 않는다.
- C2. `web/relay.js` 의 금지 낱말(잠긴 p0): `require(`·`console.`·`localStorage`·`document.` 를 쓰지 않는다. 내보내는 이름을 늘리지 않는다(`SITE_RELAY`·`SITE_HOST` 는 내보내지 않는다).
- C3. 테스트 세션은 `web/app.js`·`web/index.html` 의 글자를 단언하지 않는다(이 일이 고치지 않는 파일이고 잠긴 테스트가 이미 본다). `web/relay.js` 는 3.1 의 조건까지만 글자로 본다.
- C4. 테스트·검증 세션은 빌드·흐름을 `tmp_path` 나 메모리에서만 돌린다.

## 4. 부분별 통과 기준

### 4.1 g1_rawbase — 기본 중계 주소

- 소스: `web/relay.js`. 테스트: `tests/test_g1_rawbase_base.js`(node 쪽 표) + `tests/test_g1_rawbase_base.py`(잠긴 `test_p0_node.run_js` 로 돌려 확인 하나를 pytest 하나로 보인다. 잠긴 `test_r1_settings_relay.py` 와 같은 꼴). JS 쪽은 잠긴 `tests/test_p0_fake.js`(`check`·`eq`·`makeFetch`·`finish`)를 `require` 해 쓴다.
- 잘못된 입력: 글자가 아닌 것·빈 글·풀 수 없는 주소 모두 `ANDROID_BASE`. 예외 없음(C1).

**통과 기준**

- **G1.** `require("web/relay.js").ANDROID_BASE` 가 RAW 와 글자까지 같고, `web/relay.js` 글 전체에 `vicfos99-tech.github.io` 가 정확히 1번 나오며 그 1번이 `vicfos99-tech.github.io/ev-station-map/relay/` 꼴이다(3.1).
- **G2.** 표 A 의 10줄 모두 `defaultBase(href)` 가 RAW 다(우리 사이트: 대문자·쿼리·`#`·경로 없음·다른 경로·`http`·포트·사용자 이름).
- **G3.** 표 B 의 5줄 모두 `defaultBase(href)` 가 RAW 다(폰 앱 화면 `https://localhost/`: https·호스트 `localhost`·포트 없음).
- **G4.** 표 C 의 21줄 모두 `defaultBase(href)` 가 표에 적힌 `…/relay/` 주소와 글자까지 같다(그 밖의 http(s): 호스트가 정확히 같을 때만 RAW 이고, 포트 있는 `localhost`·`http://localhost/`·비슷한 호스트·호스트 이름이 경로·쿼리·`#`·사용자 이름 자리에 든 주소는 페이지 기준 `./relay/`).
- **G5.** 표 D 의 13줄 모두 `defaultBase(입력)` 이 던지지 않고 RAW 를 준다(http(s) 가 아님·풀 수 없는 주소·앞 공백·글자가 아님).
- **G6.** 표 E 의 9줄 모두 `baseOf(settings, href)` 가 표의 값이고(설정 주소가 기본값보다 먼저), 표 F 의 8줄 모두 `refreshRest({settings, href, fetch: 가짜, now})` 가 부른 주소 목록이 표의 한 주소뿐이다(첫 요청이 `meta.json`).

**표 A — 우리 사이트 → RAW (G2)**

| # | href |
|---|---|
| A1 | `https://vicfos99-tech.github.io/ev-station-map/` |
| A2 | `HTTPS://VICFOS99-TECH.GITHUB.IO/ev-station-map/index.html?x=1` |
| A3 | `https://vicfos99-tech.github.io/ev-station-map/index.html?x=1#h` |
| A4 | `https://Vicfos99-Tech.GitHub.io/` |
| A5 | `https://vicfos99-tech.github.io` |
| A6 | `https://vicfos99-tech.github.io/other/deep/page.html` |
| A7 | `http://vicfos99-tech.github.io/ev-station-map/` |
| A8 | `https://vicfos99-tech.github.io:443/ev-station-map/` |
| A9 | `https://vicfos99-tech.github.io:8443/ev-station-map/` |
| A10 | `https://user@vicfos99-tech.github.io/ev-station-map/` |

**표 B — 폰 앱 화면 → RAW (G3)**

| # | href |
|---|---|
| B1 | `https://localhost/` |
| B2 | `https://localhost/index.html?x=1#h` |
| B3 | `HTTPS://LOCALHOST/` |
| B4 | `https://localhost` |
| B5 | `https://localhost:443/` |

**표 C — 그 밖의 http(s) → 페이지 기준 `./relay/` (G4)**

| # | href | 결과 |
|---|---|---|
| C1 | `https://a.example/x/` | `https://a.example/x/relay/` |
| C2 | `http://localhost:8000/web/index.html` | `http://localhost:8000/web/relay/` |
| C3 | `http://localhost/` | `http://localhost/relay/` |
| C4 | `http://localhost/web/index.html` | `http://localhost/web/relay/` |
| C5 | `https://localhost:8443/web/index.html` | `https://localhost:8443/web/relay/` |
| C6 | `https://localhost.evil.example/` | `https://localhost.evil.example/relay/` |
| C7 | `https://xlocalhost/` | `https://xlocalhost/relay/` |
| C8 | `https://127.0.0.1/` | `https://127.0.0.1/relay/` |
| C9 | `https://vicfos99-tech.github.io.evil.example/` | `https://vicfos99-tech.github.io.evil.example/relay/` |
| C10 | `https://evil-vicfos99-tech.github.io/` | `https://evil-vicfos99-tech.github.io/relay/` |
| C11 | `https://xvicfos99-tech.github.io/` | `https://xvicfos99-tech.github.io/relay/` |
| C12 | `https://a.vicfos99-tech.github.io/` | `https://a.vicfos99-tech.github.io/relay/` |
| C13 | `https://vicfos99-tech.github.io./` | `https://vicfos99-tech.github.io./relay/` |
| C14 | `https://vicfos99-techxgithub.io/` | `https://vicfos99-techxgithub.io/relay/` |
| C15 | `https://vicfos99-tech.githubxio/` | `https://vicfos99-tech.githubxio/relay/` |
| C16 | `https://vicfos99-tech.github.io@evil.example/` | `https://vicfos99-tech.github.io@evil.example/relay/` |
| C17 | `https://evil.example/vicfos99-tech.github.io/` | `https://evil.example/vicfos99-tech.github.io/relay/` |
| C18 | `https://evil.example/?h=vicfos99-tech.github.io` | `https://evil.example/relay/` |
| C19 | `https://evil.example/#vicfos99-tech.github.io` | `https://evil.example/relay/` |
| C20 | `https://github.io/` | `https://github.io/relay/` |
| C21 | `https://raw.githubusercontent.com/vicfos99-tech/ev-station-map/relay-data/` | `https://raw.githubusercontent.com/vicfos99-tech/ev-station-map/relay-data/relay/` |

사례마다 잡는 틀린 구현: C9~C12 는 `endsWith`·`startsWith`·`includes` 로 견준 것, C14·C15 는 점을 아무 글자로 본 정규식, C16~C19 는 주소 글 전체에서 호스트 이름을 찾은 것, C3·C4 는 앱 화면 갈래에서 스킴을 안 본 것, C5 는 포트를 안 본 것, C6·C7 은 `localhost` 를 부분 일치로 본 것. A9 는 `host`(포트 포함)로 견준 것, A2·A4·B3 은 소문자로 안 바꾼 것을 잡는다.

**표 D — http(s) 가 아니거나 풀 수 없음 → RAW, 던지지 않음 (G5)**

| # | 입력 | # | 입력 |
|---|---|---|---|
| D1 | `file:///android_asset/index.html` | D8 | `ftp://vicfos99-tech.github.io/` |
| D2 | `capacitor://localhost/` | D9 | `""`(빈 글) |
| D3 | `https://` | D10 | `null` |
| D4 | `http://` | D11 | `undefined` |
| D5 | `https://vicfos99-tech.github.io:99999/` | D12 | `3` |
| D6 | `https://localhost:99999/` | D13 | `{}` |
| D7 | `" https://vicfos99-tech.github.io/"`(앞에 공백 하나) | | |

D5~D8 은 "어느 갈래로 가도 답이 RAW"라 갈래를 가르지는 못한다(동치 — 던지지 않음만 본다).

**표 E — `baseOf(settings, href)` (G6)**. SITE = `https://vicfos99-tech.github.io/ev-station-map/`, APP = `https://localhost/`, MY = `https://b.example/r/`

| # | settings | href | 결과 |
|---|---|---|---|
| E1 | `{on:true, base:MY}` | SITE | MY |
| E2 | `{on:true, base:MY}` | APP | MY |
| E3 | `{on:true, base:MY}` | `file:///x` | MY |
| E4 | `{on:true, base:MY}` | `https://a.example/x/` | MY |
| E5 | `{on:true, base:""}` | SITE | RAW |
| E6 | `{on:true, base:""}` | APP | RAW |
| E7 | `{on:true, base:""}` | `https://a.example/x/` | `https://a.example/x/relay/` |
| E8 | `null` | SITE | RAW |
| E9 | `{base:5}` | APP | RAW |

**표 F — `refreshRest` 가 부른 주소(전부) (G6)**. 가짜 fetch 는 `T.makeFetch({})`(모든 주소 404), `now` = `1767571920000`. `refreshRest` 는 `RelayError`(code `relay_failed`)로 끝난다 — 잡고 부른 주소만 본다.

| # | settings | href | 부른 주소 목록(한 개) |
|---|---|---|---|
| F1 | `{on:true, base:""}` | SITE | RAW + `meta.json` |
| F2 | `{on:true, base:""}` | `HTTPS://VICFOS99-TECH.GITHUB.IO/ev-station-map/index.html?x=1` | RAW + `meta.json` |
| F3 | `{on:true, base:""}` | APP | RAW + `meta.json` |
| F4 | `{on:true, base:""}` | `http://localhost:8000/web/index.html` | `http://localhost:8000/web/relay/meta.json` |
| F5 | `{on:true, base:""}` | `https://vicfos99-tech.github.io.evil.example/` | `https://vicfos99-tech.github.io.evil.example/relay/meta.json` |
| F6 | `{on:true, base:MY}` | SITE | `https://b.example/r/meta.json` |
| F7 | `{on:true, base:MY}` | APP | `https://b.example/r/meta.json` |
| F8 | 안 줌(`settings` 열쇠 없음) | SITE | RAW + `meta.json` |

요구사항 수용 기준과의 대응: 1번째 줄 → A1·A2, 2번째 → C1·C2, 3번째 → C9, 4번째 → D1·D10·D3, 5번째 → F1(함수 층)·I1 의 S1(화면 층), 6번째 → I2 와 지휘 스크립트의 전체 실행.

### 4.2 integration — 화면 흐름과 빌드

- 소스: `web/relay.js`(더 고칠 것이 없는 것이 정상). 테스트: `tests/test_integration_rawbase.js` + `tests/test_integration_rawbase.py`. **이 두 이름만.**
- 가짜 화면은 잠긴 `tests/test_integration_dom.js` 의 `boot` 를 `require` 해 쓴다. `web/index.html` 의 `<script src>` 순서대로 `web/` 의 파일을 읽어 넣되 `live.js`(861KB)만 작은 것으로 바꾼다: `ref/relay_sample/routes.json` 의 `fetched_at`·`source`·`price_note`·`routes`·`skipped` 에 `config: null` 을 더한 객체를 `root.EvLive` 에 넣는 한 줄(참조 `ref_flow.js` 의 `MINI`).
- 가짜 중계: 부른 주소가 `/meta.json`·`/routes.json`·`/status/rest/KP000101.json`·`/status/rest/KP000102.json` 으로 끝나면 `ref/relay_sample/` 의 그 파일을 200 으로, 아니면 404. 주소 머리는 가리지 않는다(어느 주소를 불렀는지는 `app.calls()` 로 본다). `now` = `1767571920000`(견본 `meta.json` 의 `at` 09:10 의 2분 뒤).
- 누르기: `app.fire("#live-form", "submit")` 뒤 `await app.settle()`.

**통과 기준**

- **I1.** 표 S 의 10줄 모두, 그 `href`·저장값으로 가짜 화면을 띄워 '새로 받기'를 누르면 `app.calls()` 가 표의 "중계 머리" + `meta.json`, + `routes.json`, + `status/rest/KP000101.json` 세 주소이고(차례대로), `#live-msg` 글이 표의 글이며, 띄울 때와 누른 뒤의 `app.errors()` 가 모두 빈 목록이다(S10 은 부른 주소 0개).
- **I2.** `tmp_path` 에 복사한 `web/`(`dist`·`test` 폴더 빼고)에서 `build.js` 를 돌리면 종료 코드 0 이고 만들어진 `dist/index.html` 에 RAW 글자가 들어 있으며 저장소의 `web/dist/` 파일 내용은 그대로이고, 전체 테스트 명령 `py -m pytest -q --tb=short -p no:cacheprovider` 가 실패 0 으로 끝난다(지금 실패하는 33개와 `test_build` 포함).

**표 S — 화면 흐름 (I1)**. KEY = `ev-charge-planner/`

| # | href | 저장값 | 중계 머리 | `#live-msg` 글 |
|---|---|---|---|---|
| S1 | `https://vicfos99-tech.github.io/ev-station-map/` | 없음 | RAW | `중계에서 받았어요 09:12 · 휴게소 충전기 3대` |
| S2 | `HTTPS://VICFOS99-TECH.GITHUB.IO/ev-station-map/index.html?x=1` | 없음 | RAW | 위와 같음 |
| S3 | `https://localhost/` | 없음 | RAW | 위와 같음 |
| S4 | 안 줌(가짜 화면 기본값 `file:///android_asset/index.html`) | 없음 | RAW | 위와 같음 |
| S5 | `http://localhost:8000/web/index.html` | 없음 | `http://localhost:8000/web/relay/` | 위와 같음 |
| S6 | `https://a.example/x/` | 없음 | `https://a.example/x/relay/` | 위와 같음 |
| S7 | `https://vicfos99-tech.github.io.evil.example/` | 없음 | `https://vicfos99-tech.github.io.evil.example/relay/` | 위와 같음 |
| S8 | `https://vicfos99-tech.github.io/ev-station-map/` | `KEY+"relay-base"` = `https://b.example/r/` | `https://b.example/r/` | 위와 같음 |
| S9 | `https://localhost/` | `KEY+"relay-base"` = `https://b.example/r/` | `https://b.example/r/` | 위와 같음 |
| S10 | `https://vicfos99-tech.github.io/ev-station-map/` | `KEY+"relay"` = `off` | (부른 주소 없음) | `인증키를 넣고 '새로 받기'를 누르세요. 공공데이터포털 마이페이지의 일반 인증키입니다.` |

- I2 의 "전체 테스트 명령이 실패 0"은 새 테스트로 다시 싸지 않는다(테스트 안에서 전체를 또 돌리지 않는다). 지휘 스크립트·검증·최종 검수가 그 명령을 돌려 본다. 새 테스트가 보는 것은 빌드 쪽이다.
- 고치기 전 코드로 같은 흐름을 돌리면 S1·S2·S4 는 옛 주소, S3 은 `https://localhost/relay/` 를 부른다(참조 `out_flow_old.json`). S5~S10 은 고치기 전에도 같은 값이다.

## 5. 참조 구현 (`.orchestra/logs/ref_rawbase/`)

| 파일 | 내용 |
|---|---|
| `ref_patch.json` | `web/relay.js` 의 글자 바꾸기 목록 둘(상수 줄, `defaultBase` 함수). 큰 파일을 통째로 쓰지 않는다 |
| `ref_table.js` | 표 A~F 를 뽑는 node 스크립트 |
| `ref_flow.js` | 표 S 를 뽑는 node 스크립트(가짜 화면) |
| `test_ref_rawbase.py` | 프로젝트를 임시 폴더 둘(old: 지금 그대로 / new: 바꾸기 적용)에 베껴 위 둘과 잠긴 중계 테스트 8파일을 돌리는 드라이버 |
| `out_table_old.json`·`out_table_new.json`, `out_flow_old.json`·`out_flow_new.json`, `out_locked_old.txt`·`out_locked_new.txt` | 그 출력 |
| `test_ref_keep_plan.py`, `out_chars.txt` | 앞 단계 계획서 옮기기, 이미 있는 `tests/test_integration_*` 글자 수 |
| `test_ref_make_plan_json.py`, `test_ref_plan_check.py` | 이 계획서의 통과 기준 문장을 글자 그대로 뽑아 `.orchestra/outbox/plan.json` 을 만들고 대조 |

돌린 결과(계획 세션, 2026-11-17):

- 드라이버: `py -m pytest -q --tb=short -p no:cacheprovider .orchestra/logs/ref_rawbase/test_ref_rawbase.py` → 6 passed.
- 잠긴 중계 테스트 8파일(p0·r1~r6·integration_relay): old **33 failed, 1454 passed** → new **1487 passed**. 지금 실패하는 33개가 모두 이 8파일 안에 있으므로, 전체로는 1851 passed 가 될 것이다(전체를 new 에서 돌려 보지는 않았다 — 나머지 파일은 `web/relay.js` 를 읽지 않는다).
- 참조 첫 시도(호스트 이름을 따로 적음)는 `test_build` 1 failed — 3.1 은 여기서 나왔다.
- I2 의 빌드: 바꾸기 목록을 적용한 `web/` 을 임시 폴더에서 빌드하면 종료 코드 0, `dist/index.html` 에 RAW 와 옛 주소 글자가 모두 든다(`test_ref_plan_check.py::test_build_has_raw`, 출력 `out_build.txt`).
- 계획서 자기 검사: `test_ref_make_plan_json.py`·`test_ref_plan_check.py` → 7 passed(plan.json 의 문장이 이 계획서 글자 그대로, 표 A~F·S 가 참조 출력과 같음).
- **돌려 보지 않은 것:** 실제 RAW 주소에 대한 요청(2.0 의 3번), 실제 폰 앱(APK)에서의 화면 주소(`app/README.md` 의 글로만 확인), new 에서의 전체 테스트(중계 8파일만 돌림).

참조 `defaultBase`(바꾸기 목록 둘째):

```js
function defaultBase(href) {
  try {
    if (typeof href === "string" && /^https?:\/\//i.test(href)) {
      const u = new URL(href);
      if (u.hostname === SITE_HOST) return ANDROID_BASE;
      if (u.protocol === "https:" && u.hostname === APP_HOST && u.port === "") return ANDROID_BASE;
      return new URL("./relay/", href).href;
    }
  } catch (e) { /* 풀 수 없는 주소 */ }
  return ANDROID_BASE;
}
```

(`APP_HOST` = `"localhost"`.)

## 6. 세션별 귀띔

- 첫 응답의 도구 호출은 지시문 Read 하나, 둘째는 `.orchestra/memory/lessons.md` Read 하나. `00_위키` 는 열지 않는다.
- bash 는 명령 하나씩. `node …` 를 셸에서 바로 치지 않는다 — 스크래치패드의 `test_*.py` 가 `subprocess` 로 돌린다.
- 개발 세션: `web/relay.js` 는 Edit 로 두 곳만 고친다(상수 줄, `defaultBase`). 파일 머리·함수 위 주석에 사이트 호스트 이름을 적지 않는다(3.1).
- 테스트 세션: g1 의 JS 표는 잠긴 `tests/test_r1_settings_relay.js` 와 같은 꼴(배열 + `run`)로 쓰면 짧다. 파이썬 쪽 확인 이름 목록은 JS 배열 길이와 맞춘다. 건너뛰기(`skip`)를 쓰지 않는다.
- 검증·최종 검수: 탐침은 참조 `ref_table.js`·`ref_flow.js` 에 프로젝트 폴더를 인자로 주면 제품 `web/relay.js` 로 같은 표가 나온다. 새 clone 에서도 전체 테스트를 한 번 돌린다.

## 판정 보완 (지휘 스크립트가 자동으로 붙임)
- [g1_rawbase] g1_rawbase K6 ① 의 '대소문자 무관'은 그 밖의 호스트에서도 같다: `defaultBase("HTTPS://A.EXAMPLE/X/")` 는 RAW 가 아니라 `https://a.example/X/relay/` 다(표 밖 보강 사례, G4 에 속한다).
- [g1_rawbase] g1_rawbase G4 의 '포트 있는 localhost'는 8443 뿐 아니라 기본 포트(443)가 아닌 모든 포트다: `defaultBase("https://localhost:3000/")` 는 `https://localhost:3000/relay/` 다(표 밖 보강 사례, G4 에 속한다).
