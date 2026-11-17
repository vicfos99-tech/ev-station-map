# ev-app-relay-raw 최종 검수 — 계획·요구사항과 결과 비교

작성: 2026-11-17 최종 검수 세션. 비교 대상: 원 요구사항 `specs/ev-app-relay-raw.md`, 계획 `docs/plan.md`(끝의 "판정 보완" 3줄 포함), 결과 요약 `.orchestra/outbox/results.json`, 소스 `web/`, 테스트 `tests/`.
코드와 테스트는 고치지 않았다. 교훈은 `.orchestra/memory/lessons.md` 의 '공통'·'검증'을 따랐다.
이 파일의 앞 단계(ev-secret-allow) 검수는 이 글로 덮어썼다. 옛 글은 `git show ae28a42:docs/final_review.md` 로 본다.

## 한눈에

| 항목 | 결과 |
|---|---|
| 부분 (g1_rawbase, integration) | 둘 다 `done`, 개발은 한 번에 통과(results.json 의 attempts 1) |
| 전체 테스트 | **1949 passed** (25초) — 이 세션이 `py -m pytest -q --tb=short -p no:cacheprovider` 로 지금 작업 트리에서 직접 돌림. results.json 의 1949 와 같다 |
| 테스트 잠금 | `check_lock` 을 탐침에서 불러 어긋난 파일 0 |
| 고친 소스 | `web/relay.js` 하나, 두 곳(상수 줄, `defaultBase`). `git diff --stat 35ae7b6 ae28a42 -- web app src tools ref .github pyproject.toml` 에 이 파일뿐 |
| 원래 목적 | **코드로는 풀렸다. 아직 올리지 않아 사이트에는 안 보인다.** 제품 `relay.js` 를 실제 RAW 주소에 붙여 돌리니 우리 사이트 주소·앱 화면 주소 모두 `meta.json` → `routes.json` → 상태 파일을 200 으로 받았다. 그때 RAW 의 `meta.at` 은 21:56, 사이트 `relay/` 의 `meta.at` 은 12:51(멈춘 그대로) |
| 가장 큰 발견 | **D1: 지금 `master` 가 원격보다 6 커밋 앞서 있다(`git status -sb`). 올리기 전에는 아무것도 바뀌지 않는다.** 그리고 저장소의 `web/dist/`·`app/www/index.html`·APK(11월 15일 빌드)에는 RAW 도 옛 주소도 0번 — 중계 기능이 들기 전 빌드다(T2) |
| 요구사항과 다른 곳 | Q1(`https://localhost/` 도 RAW — 요구사항에 없는 갈래), Q2(부분 둘·글자 수), Q3(옛 주소 글자가 남음). 셋 다 계획서가 스스로 밝힌 것이고 이 세션이 더 찾은 어긋남은 없다 |

## 이 세션이 직접 돌린 것

1. 전체 pytest: 1949 passed.
2. 탐침 여섯 묶음(P1~P6). 제품 파일은 읽기만 했고, 바꿔 본 것은 모두 임시 폴더의 복사본이다.
   - 드라이버 `C:\Users\ADMINI~1\AppData\Local\Temp\claude\f87820ce78287966\a41a7ded-a56e-4dae-9101-7085d52bee0c\scratchpad\test_probe_final.py` + `C:\Users\ADMINI~1\AppData\Local\Temp\claude\f87820ce78287966\a41a7ded-a56e-4dae-9101-7085d52bee0c\scratchpad\probe.js` → 결과 `C:\Users\ADMINI~1\AppData\Local\Temp\claude\f87820ce78287966\a41a7ded-a56e-4dae-9101-7085d52bee0c\scratchpad\report_final.txt` (P1~P5. 파일이 두 경로로 두 번 모여 묶음마다 두 번 적혀 있다 — 값은 같다. P5 는 첫 두 번이 복사본에 `web/test/` 를 빼서 기준 실행부터 1 failed 로 멈췄고, 넣어 다시 돌린 것이 끝의 것이다)
   - 드라이버 `C:\Users\ADMINI~1\AppData\Local\Temp\claude\f87820ce78287966\a41a7ded-a56e-4dae-9101-7085d52bee0c\scratchpad\test_probe_clone.py` → 결과 `C:\Users\ADMINI~1\AppData\Local\Temp\claude\f87820ce78287966\a41a7ded-a56e-4dae-9101-7085d52bee0c\scratchpad\report_clone.txt` (P6)

| 탐침 | 한 것 | 결과 |
|---|---|---|
| P1 | 제품 `defaultBase` 에 표 밖 입력 31개(글 28 + 글이 아닌 것 3), 지도 탭 함수(`loadRegion`·`refreshRegion`)와 `refreshRest` 를 여섯 화면 주소·설정으로(가짜 fetch 404) | 던진 것 0. 우리 사이트·앱 화면·`file:` 은 세 함수 모두 첫 요청이 RAW + `meta.json`, 내 PC(`http://localhost:8000/web/…`)는 `…/web/relay/meta.json`. 표 밖 입력은 아래 T5 |
| P2 | **실제 RAW 주소**에 요청(22:08, 읽기만). 머리글, 그리고 제품 `refreshRest`·`loadRegion` 을 진짜 `fetch` 로 | 아래 A6·T1·T3. 계획서가 "확인 못 함"으로 둔 2.0 의 3번 (가)·(나)·(다)가 모두 가려졌다 |
| P3 | 잠금, 새 테스트 글자 수·줄 끝, `web/relay.js` 글자 조건, 저장소의 `web/dist/`·`app/www/`·`app/dist/` | 어긋남 0. 새 테스트 넷에 CR 0개·`.orchestra` 참조 0·건너뛰기 0. 나머지는 A·Q2·T2 |
| P4 | 임시 폴더에 베낀 `web/` 에서 `build.js` | 종료 코드 0. 만들어진 세 파일(`index.html`·`artifact.html`·`충전길잡이.html`) 모두 RAW 1번, 옛 주소 1번, 사이트 호스트 이름 1번 |
| P5 | 임시 복사본의 `relay.js` 에 변이 19종. 새 테스트 두 파일(98개)과 잠긴 `test_p0_relay`·`test_r1_settings_relay`·`test_integration_relay`(274개)를 따로 | 새 테스트: **잡힘 17, 생존 2**(T5). 잠긴 테스트만으로는 잡힘 9, 생존 10 — 새 테스트가 있어야 잡히는 갈래다 |
| P6 | 이 PC 의 git 설정 그대로 `git clone` 한 복사본에서 전체 테스트·새 테스트·잠금 | 전체 **1 failed, 1948 passed**(T4 — 앞 단계에서 남은 것). 새 테스트 두 파일은 98 passed, 잠금 통과 |

3. 돌리지 못한 것: `bash tools/push.sh`(진짜로 올라가서 계획이 금지). 실제 폰 앱(APK) 화면에서의 주소·요청. 실제 브라우저에서 사이트를 연 것(P2 는 node 의 `fetch` 다 — 머리글로 읽기 허용을 확인했을 뿐 브라우저가 막는지 직접 본 것은 아니다). GitHub Actions 에서의 실행. "코드 읽기"라고 적은 줄은 돌려 보지 않고 소스·설정만 읽은 것이다.

## 1. 계획대로 된 것

| # | 계획 | 확인 |
|---|---|---|
| A1 | `ANDROID_BASE` = RAW, 옛 주소는 `SITE_RELAY` 상수로 한 번만(3.1) | `web/relay.js` 11~13행. 글 전체에 사이트 호스트 이름 1번·RAW 1번·옛 주소 꼴 1번(P3). 금지 낱말 넷 0번, 내보내는 이름에 `SITE_`·`HOST` 없음(P1) |
| A2 | `defaultBase` 의 순서 K6 ①~⑤ | 제품 코드가 계획서 5절 참조와 같다(다른 점 하나는 G1). 표 A~F 와 판정 보완 두 사례는 새 테스트 83개가 본다 — 전체 실행에서 통과 |
| A3 | `baseOf` 와 나머지 함수는 한 글자도 안 고침(K8) | `git diff 35ae7b6 ae28a42 -- web/relay.js` 가 상수 3줄과 `defaultBase` 뿐 |
| A4 | 3.1 의 두 잠긴 조건을 함께 지킴 | 전체 실행에서 `test_relay_android_host_exactly_once`·`test_build` 통과. 변이 `host_literal`(호스트 이름을 따로 적음)은 새 테스트 1개와 잠긴 `test_build` 가 각각 잡는다(P5) — 계획서 114행 그대로 |
| A5 | integration 은 개발 몫 없음 | 커밋 `ae28a42` 는 `docs/plan.md` 1줄(판정 보완)뿐이고 소스는 안 바뀜 |
| A6 | 사이트·앱 화면에서 열면 RAW 를 읽는다 | P2: 우리 사이트 주소와 `https://localhost/` 둘 다 요청 44개(200 과 404 만), 첫 셋이 RAW + `meta.json`·`routes.json`·`status/rest/….json`, `source` 는 `relay`. 지도 탭 `loadRegion`(11680)도 RAW 의 세 파일을 200 으로 받아 충전소 123곳 |
| A7 | 고치지 않는 것(다른 `web/` 파일·`app/`·`src/`·`tools/`·`ref/`·잠긴 테스트·`web/dist/`) | `git diff --stat` 에 없음. 잠금 어긋남 0. 테스트는 빌드를 `tmp_path` 에서만 돌린다 |
| A8 | 새 테스트 파일 넷, 글자 수 한도 | 넷뿐. g1 둘 10,939자(한도 20,000), integration 둘 7,850자(한도 10,000) — P3 이 UTF-8 `len` 으로 셈 |
| A9 | 지금 실패하는 33개 통과 | 전체 실패 0. 계획서의 예상 "1851 passed"에 새 테스트 98개가 더해져 1949 |
| A10 | 앞 단계 계획서를 `docs/plan_stage3.md` 로 옮김 | 있음. 계획 밖 파일이지만 까닭이 계획서 5행에 적혀 있다 |

## 2. 계획과 다른 것

| # | 계획 | 결과 | 무게 |
|---|---|---|---|
| G1 | 참조는 `APP_HOST` 상수(`"localhost"`)를 둔다(302행) | 제품은 상수 없이 `u.hostname === "localhost"` 로 바로 적었다 | 동작 같음. 고칠 것 없음 |
| G2 | 표 A~F 의 66줄 | 테스트에 표 밖 사례 4줄이 더 있다: 판정 보완 둘(`K6c`·`C5b`)과 테스트 세션이 넣은 `K6a`·`K6b`(앞 공백·`xhttps://` 를 그 밖 호스트로) | 계획서 75행·204행에서 나온 것이라 좁히는 쪽. 문제 아님 |
| G3 | 모든 세션이 `.orchestra/logs/<세션>.md` 를 쓴다(교훈) | `dev_g1_rawbase.md` 가 없다(계획·테스트·검증·판정·`dev_integration` 은 있음) | 기록만 빠짐 |
| G4 | 2.0 의 2번 (b) "안 하면 폰 앱은 옛 주소 그대로" | 지금 APK·`app/www/index.html` 에는 옛 주소 글자도 0번이다(P3) — 중계 기능이 들기 전 빌드로 보인다 | 계획서 문장이 실제보다 낙관적. T2 |

results.json 의 숫자는 이 세션의 실행과 맞는다: g1 뒤 1934(= 1851 + 83), integration 뒤 1949(= 1934 + 15).

## 3. 요구사항과 다른 것

계획과는 맞지만 원 요구사항과 어긋나는 곳이다. 셋 다 계획서 2.1 이 밝혀 둔 것이고, 수용 기준 여섯 줄 자체는 모두 글자 그대로 채워졌다(표 A1·A2, C1·C2, C9, D1·D10·D3, F1·S1, 전체 실행).

| # | 요구사항 | 결과 | 따져 본 것 |
|---|---|---|---|
| Q1 | "그 밖의 http(s) 페이지(내 PC 시험용 `localhost` 등)는 지금처럼 `./relay/`" | `https://localhost/`(https·호스트 `localhost`·포트 없음 또는 443)는 RAW. `https://user:pw@localhost/`·`https://localhost/sub/dir/index.html` 도 RAW(P1) | 요구사항의 예시 `http://localhost:8000/web/index.html` 은 그대로 `./relay/` 다. 까닭(앱 화면 주소)은 `app/README.md` 3행과 `app/capacitor.config.json`(주소 설정 없음 → 기본값)으로만 확인했다 — 코드 읽기. **이 갈래가 없으면 다시 만든 APK 가 `https://localhost/relay/` 를 읽어 중계를 못 본다**는 계획의 판단은 맞다고 본다. 묘성이 정할 것 D2 |
| Q2 | "부분 하나", "이번 부분 테스트 파일(`tests/test_<부분>_` 전부)은 합쳐 4만5천 자 이하" | 부분 둘. `tests/test_integration_` 로 시작하는 파일은 일곱 개 55,254자(앞 단계의 잠긴 다섯 47,404자 + 새 둘 7,850자) | 글자 그대로 세면 integration 은 한도를 넘는다. 이번에 새로 쓴 것만 세면 넷 합쳐 18,789자다. 수용 기준 수는 6 + 2 = 8 로 지켰고, 판정 보완 3줄이 그 위에 붙었다 |
| Q3 | "`ANDROID_BASE` 값을 … 로 바꾼다" | 바꿨다. 다만 옛 주소 글자가 `SITE_RELAY` 로 남는다 | 잠긴 `test_build` 가 빌드 결과에서 옛 주소 글자를 찾기 때문(A4). 읽는 데는 쓰지 않는다 — P1·P2 에서 기본 설정으로 옛 주소를 부른 일 0 |

이 세션이 더 따져 본 것 — 어긋남 아님:
- "풀 수 없는 주소는 … 던지지 않는다": 표 밖 입력 31개에서도 던진 것 0(P1).
- "설정에 넣은 주소가 먼저": 우리 사이트·앱 화면에서 설정에 옛 주소를 넣으면 세 함수 모두 옛 주소를 부른다(P1). 요구사항 3번 그대로이고, 계획서 M2 가 말한 남는 것이기도 하다.
- 요구사항 머리의 "앱은 키 없이 중계 페이지에서만 받는다": 앱에는 키를 넣으면 공공 API 를 직접 부르는 길이 그대로 있다(`refreshRest` 의 `direct`). 이번 범위("고칠 곳은 `web/relay.js` 뿐", 기본 주소) 밖이라 그대로 둔 것이 맞다. D5 에 적는다.

## 4. 테스트가 못 잡는 위험

| # | 위험 | 근거 |
|---|---|---|
| T1 | **GitHub 쪽 캐시 5분.** RAW 응답 머리글이 `cache-control: max-age=300` 이다. 앱이 `cache: "no-cache"` 로 불러도 GitHub 의 캐시 서버가 5분까지 옛 것을 준다. 탐침 때 `meta.at` 은 11.9분 전이었다 — 10분마다 올리기 + 캐시로 15분 문턱(`NOTE_MIN`)을 넘어 "오래됨" 안내가 뜨는 때가 있을 것이다. 30분(`DROP_MIN`)에는 닿지 않는다 | P2. 테스트는 전부 가짜 fetch. 계획서 M1 의 "미확인"이 사실로 확인됨 |
| T2 | **저장소에 든 빌드 결과가 전부 옛 것이다.** `web/dist/` 세 파일·`app/www/index.html` 에 RAW 0번·옛 주소 0번, APK 는 11월 15일 것. 잠긴 테스트도 새 테스트도 이것이 최신인지 보지 않는다. 사이트는 올리면 GitHub 가 새로 빌드하니 괜찮고, **폰 앱은 `node web/build.js` → `node app/copy-web.js` → APK 다시 만들기·설치**를 해야 중계가 처음 들어간다 | P3·P4 |
| T3 | **진짜 자료에서는 안내가 붙는다.** 실제 RAW 로 받으면 `tone` 이 `warn` 이고 글이 "충전소 8곳은 상태 파일이 없어 미확인이에요. 충전소 6곳은 충전기 목록이 달라 미확인이에요."였다(노선 `live-gb-down`). 지도 탭은 `stations/41135.json` 이 404 라 "중계에 파일이 없어요". 이번 고침 탓이 아니라 중계가 올리는 자료의 범위다(중계 프로그램 쪽 일). 새 테스트의 견본은 깨끗해서 `중계에서 받았어요 …` 만 본다 | P2 |
| T4 | 이 PC 의 git 설정(`core.autocrlf=true`)으로 새로 clone 하면 `tests/test_integration_secret.py::test_real_allow` 가 실패한다(1 failed, 1948 passed). 앞 단계 검수의 T1 이 그대로 남아 있다(`.gitattributes` 없음). 이번 새 테스트는 CRLF 로 꺼내져도 통과한다. GitHub Actions 는 리눅스라 걸리지 않는다 | P6 |
| T5 | 표 밖 주소 가운데 사례가 없는 것. 변이 생존 2종: `https://localhost./`(끝 점)와 `https://[::1]/` 를 앱 화면으로 봐도 새 테스트가 통과한다. 지금 제품은 둘 다 `./relay/` 로 보낸다. 그 밖에 P1 에서 본 지금 동작: `https://vicfos99-tech.github%2eio/`·`https://vicfos99-tech.github.io\@evil.example/` 는 RAW(URL 규칙으로는 둘 다 실제로 우리 호스트라 맞다), `new URL(…)` 객체·`new String(…)` 을 넘기면 글자가 아니라서 RAW(앱은 `location.href` 글자만 넘긴다) | P1·P5. 해는 없다고 본다 — 어느 쪽이든 읽는 곳은 우리 중계 아니면 그 페이지 자신의 `./relay/` |
| T6 | 화면 흐름(표 S)은 '새로 받기'(휴게소)만 누른다. 새 주소에서 지도 탭을 여는 흐름은 화면으로 돌린 사례가 없고, P1·P2 가 함수 층으로만 봤다(같은 `baseOf` 를 쓴다) | `tests/test_integration_rawbase.py` |
| T7 | 앱 화면 주소는 글로만 확인했다. 나중에 `capacitor.config.json` 에 `server.hostname`·`androidScheme: "http"`·개발용 `server.url` 을 넣으면 화면 주소가 `https://localhost/` 가 아니게 되어 다시 `./relay/` 를 읽는다. 그리고 `web/dist/artifact.html` 을 Claude 아티팩트로 열면 주소가 "그 밖의 https"라 `…/relay/` 를 읽는다(고치기 전에도 같았다) | 코드 읽기·P1 |
| T8 | 한 번 받을 때 RAW 에 요청 44개(노선 하나). GitHub 가 요청 수를 줄이는지는 확인하지 못했다 | P2. 미확인 |

## 5. 묘성이 정해야 할 것

| # | 정할 것 | 권고 |
|---|---|---|
| D1 | **올리기.** `master` 가 원격보다 6 커밋 앞서 있다. `bash tools/push.sh` 로 올리면 GitHub 가 다시 빌드해 사이트가 RAW 를 읽는다. 올린 뒤 폰에서 사이트를 열어 '새로 받기' → 받은 시각이 10~15분 안쪽인지 한 번 본다 | 올린다. 올리기는 지휘 스크립트 밖의 일이다 |
| D2 | **Q1 — `https://localhost/` 를 RAW 로 보내는 갈래를 둘지.** 요구사항에 없던 것이다. 빼면 폰 앱이 중계를 못 본다 | 둔다. 내 PC 시험은 포트를 붙여 띄우면 지금처럼 `./relay/` 다 |
| D3 | **폰 앱(APK)을 다시 만들지(T2).** 지금 APK 에는 중계 기능 자체가 없다 | 사이트에서 먼저 확인한 뒤 다시 만든다 |
| D4 | **사이트의 `relay/` 를 10분마다 만드는 예약 실행(`.github/workflows/pages.yml` 의 `schedule`)을 지울지.** 앱은 이제 쓰지 않고, 예약이 돌지 않아 12:51 에 멈춰 있다. 옛 주소 글자(`SITE_RELAY`)도 잠긴 `test_integration_relay.py` 17행을 풀어야 지울 수 있다 | 사이트가 RAW 로 잘 받는 것을 본 뒤 예약 실행만 지운다. 옛 주소 글자는 그대로 둔다(잠금을 풀 만한 값이 아니다) |
| D5 | **캐시 5분(T1)을 받아들일지.** 줄이려면 앱이 주소 뒤에 시각을 붙이는 방법 등이 있으나 RAW 에서 통하는지는 확인하지 않았다 | 우선 받아들이고, "오래됨" 안내가 자주 뜨면 따로 요구사항을 쓴다. 키를 넣으면 직접 받는 길을 없앨지(3절 끝)도 그때 함께 정한다 |
| D6 | T4(`.gitattributes` 로 줄 끝 고정) — 앞 단계 D2 가 아직 열려 있다 | 다음 일에 한 줄 넣는다 |
| D7 | T3(상태 파일 없는 충전소 8곳·목록이 다른 6곳, 41135 같은 시군구 파일 없음) | 중계 프로그램(`ev-data-relay`) 쪽에서 볼 일. 앱 고침은 필요 없다 |
