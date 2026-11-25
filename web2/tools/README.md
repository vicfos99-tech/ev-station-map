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

## 크롬으로 보기 — `view_s1.mjs`
```
node web2/tools/view_s1.mjs [초]
```
- 빌드(임시 폴더) + 다리(시험 모드, S1) + `http://127.0.0.1:5173/` 작은 웹 서버를 같은 초만 띄운다. 자세히 `web2/README.md`.

## 지도 라이브러리 받기 — `vendor_get.mjs`
```
node web2/tools/vendor_get.mjs
```
- `npm pack maplibre-gl@<판>`(판은 `vendor.version`)으로 묶음을 `tools/tmp/vendor/`(git 밖)에 받고, 정한 세 파일만 `web2/vendor/` 로 꺼낸다(묶음 안 스크립트는 돌리지 않는다). 이미 받은 `.tgz` 가 있으면 경로를 인자로.
