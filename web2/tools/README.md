# web2 도구

모든 값(경로·무늬·허용 목록·층 표·판)은 `config_tools.json` 에 있다. node 기본 모듈만 쓴다(설치할 묶음 없음). 명령은 저장소 맨 위(`ev-charge-planner`)에서 돌린다.

## 기계 검사 네 가지 — `check4.mjs` (설계 6-4)
```
node web2/tools/check4.mjs
```
| 검사 | 무엇을 | 설정 |
|---|---|---|
| ① 빌드 | 빌드 도구(`tools/build.mjs`)를 임시 폴더에 돌려 0 으로 끝나고 산출물(`index.html`)에 이번 판 글자(`build.json` 의 `stamp`)가 있나 + 모든 설정 JSON·꼴 표가 읽히고 `src/cfg.js` 의 꼴 검사를 통과하나 | `check4.build_*`, `config_dir`, `shape_dir` |
| ② 박힌 값 | `src/*.js` 의 숫자(허용 `allowed_numbers` 밖)·글(한글·`://`·경로·긴 키 무늬·IP)·지역 시각 함수·`window.close`·`alert(` / 화면 조각(`src/*.html`)의 한글 / `http` 가 있으면 안 되는 설정 / 저장소 안 `config_app_secret.json` | `check4.hardcode` |
| ③ 순환 의존 | `import` 와 받는 것 목록(`export const NEEDS = [...]`)을 이은 고리 | `dep_module` |
| ④ 직접 불러 쓰기 | 허용 목록(`imports_allowed`) 밖 import · 층 표(`module_layer`·`layer_may_need`·`extra_needs` — 설계 원칙 '만드는 차례와 기댐')를 어긴 NEEDS · NEEDS 에 없는 `deps.X` · `new Logger/Store/Config/State`·`getInstance`·`window.`·`document.`·`navigator.` · 계산 쪽(`calcrunner`·`statecalc`)의 `health`·`conn.` · 화면 층의 클라이언트 이름 · 순수 층의 `deps`·로그 | `check4.*` |

- 표로 찍고 하나라도 실패면 종료 코드 1. 기록장: `web2/tools/logs/check4.log`(git 밖).
- 새 모듈을 더하면 `module_layer` 에 층을 적는다(안 적으면 ④ 실패). 모듈끼리 import 는 조립(`app`)만 — 예외는 `imports_allowed`(지금 `ui_map → mapview`).

## 커밋 전 걸쇠
설치(한 번):
```
node web2/tools/install_hook.mjs
```
- 저장소 `.git/hooks/pre-commit` 끝에 `sh web2/tools/hooks/pre-commit-web2.sh || exit 1` 한 줄을 더한다(있던 잠긴 테스트 확인 줄은 그대로). 이미 있으면 그대로 둔다.
- 걸쇠는 이번 커밋에 `web2/` 아래 파일이 있을 때만 `check4.mjs` 를 돌리고, 실패면 커밋을 막는다(다른 폴더 커밋에는 끼지 않는다).
- 확인: `git -C <저장소> commit` 때 `[web2 걸쇠] 기계 검사 네 가지를 돌립니다` 가 찍힌다.

## 빌드 — `build.mjs`
```
node web2/tools/build.mjs --out <출력 폴더> [--secret <저장소 밖 config_app_secret.json>]
```
- 뼈대 + 화면 조각 + 모듈(함수로 감싸 한 줄기로) + 설정·꼴 표(`window.EV_CONFIG`) + 지도 라이브러리를 `index.html` 하나로, 판 기록 `build.json`(stamp·at·commit). 출력 자리는 인자 — 프로젝트 안에 만들지 않는다.
- 막는 것: JSON 꼴·같은 키 두 번, 빠진 조각(`ui_X` 의 style·view), 허용하지 않는 import/export 꼴, 모듈 고리.

## 스스로 시험 — `try_a1.mjs`
```
node web2/tools/try_a1.mjs
```
- 다리를 시험 모드(`try_a1.run_seconds`)로 띄워 S1·S8 세 갈래·설정 깨기·비밀 값 가림·빌드한 한 파일을 시험하고 표를 찍는다(약 2분 30초 — 다리가 스스로 끝날 때까지 기다림). 표 사본 `tools/logs/try_a1_last.md`.

## 스스로 시험 — `try_a2ga.mjs` (A2-가)
```
node web2/tools/try_a2ga.mjs
```
- 다리를 시험 모드(`try_a2ga.run_seconds`)로 띄워 S1(속도판·선에 붙이기·나가는 주소)·S2(115)·S6(튐 셋·정차 0)·S7(자료 길 끊김 한 줄·복구)·S11(나쁜 자료 일곱)·S8(세 갈래)·E4(판 빼고 다른 판 더해 짓기)를 시험하고, 다리가 끝난 뒤 크롬 보기 길(⑧)을 띄워 받은 페이지를 가상 창에서 돌린다. 약 7분. 표 사본 `tools/logs/try_a2ga_last.md`.
- 장면은 사건 앞 틱으로 옮기고(`seek`) 경우마다 앱을 새로 띄운다. 끊김·나쁜 자료 경우만 앱의 다시 받기 간격을 줄인다(`refresh_override_ms` — 앱 설정 파일은 그대로).
- 가짜 화면·지도·저장소와 앱 띄우기는 `lib_apprun.mjs`(try_a1 과 함께 씀).
- **선 파일 대신 답하기**: 중계 R0 전이라 시험 다리가 고속도로 선을 내주지 않는다. 시험·보기 도구만 다리 자료 길의 선 파일 이름(`testbed.lines_shim`)을 테스트 베드 선 파일로 대신 답한다(`lib_testbed.fetchWithLines`·`linesShim`, 비밀 값 머리가 틀리면 다리처럼 `lock`). 앱 코드는 그대로 다리에 묻는다.

## 스스로 시험 — `try_a2na.mjs` (A2-나)
```
node web2/tools/try_a2na.mjs
```
- 다리를 시험 모드(`try_a2na.run_seconds`)로 띄워 S1(앞의 세 곳·충전소판 줄·지나치면 다음 곳)·S3(하행·상행 방향 맞춤)·S4(고속도로 밖 '주변' 세 곳 — 시험이 따로 셈한 가까운 셋과 견줌)·S5(상태 바뀜·목록 다시 받기에도 판이 깨지지 않음)·'이상해'(파일·기록장 한 줄·메모 거절 둘·보관 개수·올리지 않음)·위치 권한 안내(시험 흐름 / 가짜 기기 GPS 권한 꺼짐 → 뜸 → 위치 오면 닫힘)·E4(판 둘 다 / 하나씩 빼고 지음)·속도판 세 자리를 시험한다. 약 6분(다리가 끝날 때까지). 표 사본 `tools/logs/try_a2na_last.md`.
- 기대 값은 장면 파일(휴게소 이름·km·방향, 주변 충전소 좌표)에서 시험이 따로 셈한다(앱 셈을 쓰지 않음).

## 속도판 세 자리 — `try_speedfit.mjs`
```
node web2/tools/try_speedfit.mjs
```
- 다리 없이 몇 초. 판 폭(가상 창에 정해 넣는 `clientWidth`, 설정 `speedfit.widths_px`)마다 속도판이 고른 숫자 크기로 '자리 수 × 숫자 한 자 폭 + 여백 ≤ 판 폭'인지 셈하고, 왼편 자리 가장 좁은 폭(`config_ui_boards.slot_min_px.left`)이 판 폭보다 좁지 않은지 본다.
- **한계**: 가상 창에는 글꼴이 없어 실제 폭을 재지 못한다 — 숫자 한 자 폭은 설정 `config_ui_speed.fit.digit_em`(고정폭 숫자의 어림)으로 셈한다. 진짜 크롬에서 눈으로 한 번 봐야 한다.

## 고칠 것 일곱 — `try_fix7.mjs` (진짜 크롬으로 자리 재기)
```
node web2/tools/try_fix7.mjs            # 전부(약 4분)
node web2/tools/try_fix7.mjs chrome     # 크롬 재기만(약 2분) · around · s2 도 따로
node web2/tools/try_fix7.mjs chrome-old <앱 사본 폴더>   # 같은 재기를 다른 앱 사본에(시험이 옛 화면에서 실패하는지)
```
- ⑥ 장면 선의 km 자리에서 직각으로 떨어진 점을 차례로 넣어(순수 셈) 300m 넘게 벗어나면 '주변', 선 위로 돌아오면 '앞의 충전소'.
- ④ 보기 bat 과 같은 S2 창(틱 460·60초)을 가상 창으로 돌려 속도판 글을 1초마다 적는다(다리 창 동안 / 끝난 뒤).
- ①②③⑤⑦ `lib_chrome.mjs`: 앱을 빌드해 작은 서버(`127.0.0.1:5173` — 보기 도구와 함께 돌리지 않는다)에 내고, **크롬을 창 없이** 띄워 정한 크기의 iframe(넓은 가로·좁은 가로·좁은 세로 둘 — `layout.frames`)에 앱을 차례로 연다. 실제로 그린 상자(`getBoundingClientRect`)와 **그 자리에 실제로 보이는 것**(`elementFromPoint` — 가운데와 네 귀퉁이)을 재서: 충전소판 줄·거리·속도 숫자·지도 저작권 글이 가려지지 않음, 단추·메모 칸과 겹치는 넓이 0, 구분선 목록 모양, 세 칸 배치(세로 창도 왼편·가운데·오른편), 숫자 잘림, 누르는 높이 48px. 잰 값 통째는 `tools/logs/try_fix7_chrome.json`.
- 한계: 창 없는 크롬의 글꼴·그림(소프트웨어 WebGL)이라 묘성 폰·PC 크롬과 글꼴 폭이 조금 다를 수 있다.

## 크롬으로 보기 — `view_s1.mjs`
```
node web2/tools/view_s1.mjs [초] [장면] [틱]
```
- 빌드(임시 폴더, 다리 주소만 이 서버로 바꿔 — `build.mjs --override`) + 다리(시험 모드) + `http://127.0.0.1:5173/` 작은 웹 서버를 같은 초만 띄운다. 이 서버는 페이지를 내고, `/v1/…` 는 선 파일만 대신 답하고 나머지는 다리로 넘긴다. 자세히 `web2/README.md`.

## 빌드 인자 (A2 에서 더함)
- `--override <파일>`: `{설정 이름: 통째로 바꿀 객체}` — 보기 도구만 쓴다. `--app <폴더>`: 다른 폴더의 앱 사본을 짓는다(E4 시험).
- 판(KIND 'board' 선언 — `build.board_decl`)은 본문 조각이 아니라 판 목록(`@@BOARDS@@`)으로 들어간다. 기계 검사 ④ 의 층은 층 표에 없으면 KIND 로(`check4.kind_layer`).

## 지도 라이브러리 받기 — `vendor_get.mjs`
```
node web2/tools/vendor_get.mjs
```
- `npm pack maplibre-gl@<판>`(판은 `vendor.version`)으로 묶음을 `tools/tmp/vendor/`(git 밖)에 받고, 정한 세 파일만 `web2/vendor/` 로 꺼낸다(묶음 안 스크립트는 돌리지 않는다). 이미 받은 `.tgz` 가 있으면 경로를 인자로.
