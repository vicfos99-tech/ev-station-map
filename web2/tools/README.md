# web2 도구

모든 값(경로·무늬·허용 목록·층 표·판)은 `config_tools.json` 에 있다. node 기본 모듈만 쓴다(설치할 묶음 없음). 명령은 저장소 맨 위(`ev-charge-planner`)에서 돌린다.

## 기계 검사 다섯 가지 — `check4.mjs` (설계 6-4 · ⑤ 는 정비 나)
```
node web2/tools/check4.mjs
```
| 검사 | 무엇을 | 설정 |
|---|---|---|
| ① 빌드 | 빌드 도구(`tools/build.mjs`)를 임시 폴더에 돌려 0 으로 끝나고 산출물(`index.html`)에 이번 판 글자(`build.json` 의 `stamp`)가 있나 + 모든 설정 JSON·꼴 표가 읽히고 `src/cfg.js` 의 꼴 검사를 통과하나 | `check4.build_*`, `config_dir`, `shape_dir` |
| ② 박힌 값 | `src/*.js` 의 숫자(허용 `allowed_numbers` 밖)·글(한글·`://`·경로·긴 키 무늬·IP)·지역 시각 함수·`window.close`·`alert(` / 화면 조각(`src/*.html`)의 한글 / `http` 가 있으면 안 되는 설정 / 저장소 안 `config_app_secret.json` | `check4.hardcode` |
| ③ 순환 의존 | `import` 와 받는 것 목록(`export const NEEDS = [...]`)을 이은 고리 | `dep_module` |
| ⑤ 꽂는 자리 | (정비 나 ⑥ — 설계 5-1) 작업 트리(git status)에 **새로 더한** 판·제목 꾸러미 파일(머리 KIND `board`·`topic`, 또는 `config/config_topic_*.json`)이 있고 **같은 종류가 이미 있으면** '판·제목 걸음' — 그때 고친 기존 파일이 허용 목록(설명서·기록장) 밖이면 실패. 새 판·꾸러미 파일이 없거나(기본 기능 걸음) 그 종류가 처음 생기면(틀 걸음 — 정비 나의 첫 꾸러미) 막지 않음 | `check4.plug` |
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
- 확인: `git -C <저장소> commit` 때 `[web2 걸쇠] 기계 검사 다섯 가지를 돌립니다` 가 찍힌다.
- (4-3) 같은 설치가 커밋 뒤 걸쇠 `.git/hooks/post-commit` 끝에 `sh web2/tools/hooks/post-commit-web2.sh` 도 더한다(`config_tools.json` 의 `hook.extra`).

## 원칙 점검 — `principles_run.mjs` · `config_principles.json` (4-3)
점검 도구는 작업 폴더의 `20_도구/원칙점검`(다른 앱도 같이 씀 — 설명은 그 폴더 README). 이 앱은 **설정 한 장** `config_principles.json` 만 둔다.
```
node web2/tools/principles_run.mjs check --all            # 저장소 전체 + 기계 검사(check4) 결과 함께
node web2/tools/principles_run.mjs check --files src/x.js # 고른 파일만
node web2/tools/principles_run.mjs judge --files src/x.js --force   # 판단 점검 손으로 한 번(돈 듦)
```
- 커밋 전 걸쇠가 check4 다음에 `check --staged`(바뀐 파일만)를 돌린다. 막을지는 `block_on_fail`(지금 **참 — 스크립트 점검 위반이면 커밋을 막음**, 묘성 11/27). 일부러 넘길 줄은 그 줄·윗줄에 `원칙점검:허용 <까닭>`.
- 같은 곳(점검 + 파일 + 줄 내용)이 커밋 시도에서 **세 번**(`stuck.threshold`) 연달아 막히면 텔레그램으로 한 번 묻고 알림에 한 줄 — 그 곳이 든 커밋만 계속 막히고, 통과하면 수를 지운다(상태 `tools/logs/원칙점검_막힘_상태.json`). 텔레그램 토큰이 없으면 알림 한 줄로 대신.
- 커밋 뒤 걸쇠가 `judge --commit <커밋>` 을 뒤에서 띄운다 — **절대 막지 않음**. `judge.auto` **참**(지금, 묘성 11/27 — 커밋마다). 하루(한국 날짜) 돈 한도 `judge.daily_budget_usd`(지금 2달러)를 넘길 것 같으면 그날은 부르지 않고 알림 한 줄(그날 한 번). 상위 모델(오퍼스) 다시 보기는 처음 3번(`judge.upper.max_runs`), 소넷과 갈리면 결과 파일(`tools/logs/원칙점검_판단_결과.jsonl` 의 `split`)·알림에 한 줄.
- 문제가 있을 때만 `<작업 폴더>/90_임시/실행요청/원칙점검_알림.md` 에 한 줄. 기록장은 `tools/logs/원칙점검_*.log`.

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

## 11/27 — `try_fix27.mjs` (제목 단추 자리 · 아래 띠 그림 글자, 진짜 크롬)
```
node web2/tools/try_fix27.mjs   # 약 2분 30초(다리가 끝날 때까지)
```
- `config_ui_topic.min_show` 를 1 로 바꾼 빌드(아래 띠가 가장 붐빔)를 넓은 가로·좁은 세로 400·폰 세로 360 에서: ① 양옆 판·아래 띠 단추 화면 안 · 페이지 가로 넘침 0 ② 단추 48px 이상 · 가림 0 · 화면 읽기 글 · 좁은 창이면 그림 글자 ③ 제목 단추 누름 → 목록 칸이 가운데 기둥 안. 값 `config_try_fix27.json`, 표 `tools/logs/try_fix27_last.md`, 잰 값 `try_fix27_chrome.json`, 상태 자리 글은 기록장에.

## 스스로 시험 — `try_a3.mjs` (A3 지도)
```
node web2/tools/try_a3.mjs              # 전부(약 8분 — 다리가 끝날 때까지 + 크롬)
node web2/tools/try_a3.mjs cam|s6|chrome
```
- ① S1 카메라 규칙: 가짜 지도(`lib_apprun.fakeMapLib`)의 `user(종류, 값)` 로 손 조작을 흉내(값을 바꾸고 originalEvent 가 있는 시작 알림 → moveend). 따라가기 · 돌리고 키운 것이 위치가 바뀌어도 그대로 · 옮기면 따라가기 끔 · '내 위치'(진행 방향·확대 그대로·너무 멀면 최소 확대) · 1·2·3번 = 충전소판(지나쳐 바뀐 뒤도) · '세 곳만' · 다시 열어도 같음(같은 폰 데이터 폴더로 새 앱 — `startApp` 의 `opts.disk`) · '이상해' 조각에 `map.cam`.
- ② S6 정차·튐·후진 창마다 이어진 카메라 가운데 사이 가장 큰 걸음, 느릴 때(설정 `config_mapcam.heading_min_kmh` 아래) 낸 방향 명령 0, 이어진 방향 사이 가장 큰 각.
- ③ 진짜 크롬(`lib_chrome`, 넓은 가로·폰 세로): 지도 단추 둘이 판·저작권·번호를 가리지 않음, 번호 셋 = 판 줄 셋, '세 곳만' 누름. 표 사본 `tools/logs/try_a3_last.md`, 잰 값 `try_a3_chrome.json`.

## 스스로 시험 — `try_a4.mjs` (A4 정보 칸·내비로 넘기기)
```
node web2/tools/try_a4.mjs              # 전부(약 9분 — 다리가 끝날 때까지 + 크롬)
node web2/tools/try_a4.mjs pure|app|chrome
```
- ① 순수(다리 없음): 중계 시각 글 · 신선함(보증·낡았을 수 있음·낡음·미래) · 상태 읽기(없는 충전기는 모름) · 이스케이프 · 내비 주소 글 — 주소 기대 값은 시험 쪽 인코더(`try_a4.pure.unreserved_re`)와 설계 5-8 마 의 무늬로 따로 만든다.
- ② S5: 충전판 줄을 눌러 연 칸에 충전기 바뀜(사용 중·고장·빈자리 — seek 로 앞당김)과 받은 때 · 카메라 명령 0 · 마지막 선택(지도 번호·점 — 가짜 지도 `clickLayer`) · 복사 단추(가짜 창 `copied`) · 내비 안 열림 안내 · 닫으면 받기 멈춤. ③ S3 하행·상행: 이름의 방향과 좌표가 장면의 그 방향 충전소. ④ S7: 끊김 동안 들고 있는 상태·낡음(문턱은 시험만 줄임)·'다시 받기' 답·상태 자리. ⑤ 이름에 꺾쇠·따옴표(받은 자료를 시험이 바꿔 넣음).
- ⑥ 진짜 크롬(넓은 가로·폰 세로): 첫 줄을 눌러 칸을 연 뒤 — 가운데 칸 안, 지도 높이 비율, 판·저작권 가림 0, 단추·아래 띠·양옆 판과 겹침 0, 단추 48px. 표 사본 `tools/logs/try_a4_last.md`, 잰 값 `try_a4_chrome.json`.

## 스스로 시험 — `try_a5.mjs` (A5 제한 속도)
```
node web2/tools/try_a5.mjs                       # 전부(10분 넘음 — 나눠 돌리면 아래처럼)
node web2/tools/try_a5.mjs pure|app              # 순수 · 가상 창(다리 420초)
node web2/tools/try_a5.mjs chrome ok|over|none   # 진짜 크롬 한 모습씩(다리 130초씩)
```
- ① 순수: 칸 열쇠(기대 값은 시험이 설정의 칸 크기로 따로 셈) · 파일 검사(0·빈 값·범위 밖 → 없음, 꼴 틀림 → 거절) · 고속도로(선·km·방향) · 일반 도로(거리·방향 문턱, 양방향) · 후보 갈림 → 없음 · 0 값 → 없음 · 넘음 판단(이어짐·위험·풀림).
- ② S2 넘음 → 풀림(제한 100·80) ③ S4 100 → 40 → 60 → 빈 칸, 나온 값이 장면 값뿐 ④ 끊김(대신 답에 끊김을 켬 — `lib_testbed.limitShimCtl.down`): 들고 있는 값 그대로 · 사본 없이 새로 켜면 빈 칸 · 사본으로 다시 켜면 보임 · 돌아옴.
- ⑤ 진짜 크롬 세 모습(정상 S1 · 넘음 S2 · 빈 칸 S4) × 네 창: 판단·제한 글 · 가림 0 · 잘림(판 밖·왼편 자리 밖) 0 · 단추와 겹침 0 · 단추 48px. 표 사본 `tools/logs/try_a5_last[_부분].md`, 잰 값 `try_a5_chrome_<판단>.json`.
- **제한 속도 파일은 중계 R5 전이라 시험 다리가 내주지 않는다** — `lib_testbed.limitFiles` 가 지금 장면(`selectScene` 이 적음)의 `limits`(시험용 값)로 중계 꼴 파일을 만들어 선 파일과 같은 자리(`linesShim.answer`)에서 대신 답한다. 그래서 모든 시험·보기·크롬 재기에 같은 대신 답이 들어간다(값은 `testbed.limit_shim`).

## 스스로 시험 — `try_a6.mjs` (A6 주소 검색·경로·기록 올리기)
```
node web2/tools/try_a6.mjs              # 전부(약 12분)
node web2/tools/try_a6.mjs pure|app|chrome
```
- ① 순수: 장소·길 답 검사(모르는 칸·범위 밖·판 번호·개수·제어 문자) · 노선 꼴(조각 이음·누적 km·지우기) · 경로 기준 앞의 충전소(시험 선 둘 — 갈아타는 곳 너머 · 끝 뒤 채움 · 벗어나면 선 기준) · 검색 글 검사.
- ② S9 정상·느림·실패·돌아옴(검색 중에도 속도판·충전소판·지도 카메라 그대로, 답마다 다른 글 — 오늘 한도·끊김·이상한 답은 시험이 다리 앞에서 대신 답함) ③ S10 '기록 올리기'(누르기 전 0건 · 받음 · 거절 · 다시 누름 · 꽉 참이면 앞에서 멈춤) ④ S7 집 PC 끊김(길찾기·올리기만 사용 불가).
- ⑤ 진짜 크롬 네 창: 검색 목록 → 경로 → 경로 + 정보 칸 세 걸음의 가림·겹침·잘림·누르는 높이. 표 사본 `tools/logs/try_a6_last_<부분>.md`, 잰 값 `try_a6_chrome.json`.

## 스스로 시험 — `try_a7.mjs` (A7 목록·추천, 내 차·할인)
```
node web2/tools/try_a7.mjs pure      # 옛·새·파이썬 계산 대조 + 순수(다리 없음, 몇 초)
node web2/tools/try_a7.mjs app       # S1 가상 창(다리 200초)
node web2/tools/try_a7.mjs s12       # S12 1시간을 12배속으로(약 6분)
node web2/tools/try_a7.mjs chrome    # 진짜 크롬 네 창(약 2분)
node web2/tools/try_a7.mjs shots     # 옛·새 화면 나란히 그림(약 2분)
```
- ① 순수: 옛 `web/engine.js` ↔ 새 `engine.js`(옛 실제 자료 `web/live.js` 32개 노선 × 4경우, JSON 통째로) · 파이썬 엔진(`src/ev_charge_planner` — `a7_py_plan.py` 가 같은 입력을 셈) · 옛 `app.js` 의 `inputs()`·`applyMine` 을 **글 그대로 떼어 돌린 것**(줄 범위 `try_a7.old_inputs`, 옛 파일은 고치지 않음) ↔ 새 `planinput.inputs` · S1/S3 장면을 중계 꼴로 바꿔 휴게소 차례·km·빈 급속 · 상태 모름 · `planOf` 상태들 · 내 차 칸 검사 · 업체 별명.
- ② S1: '목록' 누르기 전 셈 없음 → 열면 상태 받기·목록·추천 · 앱 결과 = 같은 입력의 순수 셈 · 운전 화면 그대로 · 배터리 % 바꾸기·이상한 값 · 줄 누름 → 정보 칸 · '내 차' 저장(칸 하나만 열림) · 목록 셈에 바로 쓰임 · 이상한 값 저장 안 함 · 다시 열어도 같음 · 로그.
- ③ S12: 다리 배속(`try_a7.s12.scale`)으로 장면 1시간을 돌리며 목록 칸을 연 채로 처음·중간·끝에 gc 뒤 힙, 그때 입력으로 표 전체를 셈한 한 틱 시간, 이벤트 늦음, 기록장 크기.
- ④ 진짜 크롬 네 창: 목록 칸·내 차 칸을 열어 가운데 칸 안 · 양옆 판·아래 띠·지도 단추·저작권과 겹침 0 · 가림 0 · 잘림 0 · 48px. ⑤ 크롬 원격 길(DevTools)로 옛 앱(`web/index.html` 파일 그대로, 폰 저장에 노선·자리·배터리)과 새 앱(S1 목록 칸)을 그림으로 받아 나란히 한 장(`try_a7.shots.out_dir`).
- 표 사본 `tools/logs/try_a7_last_<부분>.md`, 잰 값 `try_a7_chrome.json`.

## 시험 고르개 — `try_pick.mjs` (정비 가 ①)
```
node web2/tools/try_pick.mjs                      # 고친 파일 = git 작업 트리 + 스테이지 + 아직 git 이 모르는 새 파일
node web2/tools/try_pick.mjs src/ahead.js …       # 고친 파일을 인자로(web2 기준 또는 저장소 기준 경로)
node web2/tools/try_pick.mjs --why                # 시험마다 고른 까닭(닿은 모듈 · 맞은 낱말)도
```
- 고친 파일 → 그 파일과 **그 파일에 기대는 모듈**(import · NEEDS 의 받는 것 · 계산 표 줄의 셈 모듈을 거꾸로 따라감 — 조립 `app` 은 빼고 '앱을 띄우는 시험'으로)을 **쓰는** try_* 시험 이름을 한 줄씩.
- '쓴다' = 시험 파일(주석 뺀 코드·글) + 그 시험이 읽는 `config_tools.json` 묶음 + 그 시험만의 `config_<시험>.json` 에 모듈 낱말(모듈 이름 · 그 모듈 설정 이름 · 화면 조각 id · 모양 조각의 `ev-` 이름)이 나옴. 손으로 적은 지도 없음 — 코드에서 못 뽑는 것(조립·뼈대·빌드·옛 앱·테스트 베드)만 `config_try_pick.json` 에 까닭과 함께.
- 화면 조각(html)·설정(json)이 바뀌면 그것을 쓰는 모듈의 시험을, 모양 조각(css)만 바뀌면 그 화면 낱말이 나오는 **크롬 시험만**(가상 창에는 모양이 없음). `config_tools.json` 은 커밋 전과 달라진 묶음을 읽는 시험만. 설명서 등은 고르지 않음.
- 넉넉하게 고른다(덜 고르는 것보다 더 고르는 쪽) — 'ahead' 같은 낱말이 표시·설정에 나오는 시험은 모두 고름.

## 전체 시험 — `try_all.mjs` (정비 가 ②)
```
node web2/tools/try_all.mjs                                # 전부(약 85분 — 다리를 쓰는 시험이 차례로)
node web2/tools/try_all.mjs --only try_a1,try_a5:chrome:ok # 일부(시험 이름 = 그 부분 전부, 이름:부분 = 그 부분만)
node web2/tools/try_all.mjs --only try_a6 --append         # 앞 결과에 이어 붙임(나눠 돌리기 — 세션 한 명령 10분 한도)
node web2/tools/try_all.mjs --list                         # 돌릴 차례와 한도
```
- 차례·부분 인자·시험마다 시간 한도는 `config_try_all.json` 의 `runs`(거기 없는 새 `try_*.mjs` 는 인자 없이 `default_limit_s` 로 끝에). S12 긴 주행은 `s12` 로 켜고 끔.
- 한 시험이 한도를 넘기면 그 시험과 딸린 다리·크롬을 끊고(`taskkill /T`) 다음으로. 결과 `tools/logs/try_all_last.md` — 맨 위 한 줄 합계 + 표(시험 · 통과/전체 · 걸린 초 · 종료 · 실패 줄), 시험마다 찍은 글 `tools/logs/try_all_out/`. 실패가 있으면 종료 코드 1.
- 통과/전체는 시험이 찍은 표의 `| 통과 |`·`| 실패 |` 줄을 센다(시험이 표를 안 찍고 죽으면 '표 없음' 실패).

## 시험 두 층 (정비 나 ⑨)
```
node web2/tools/unit.mjs [모듈 …]     # 첫 층: 단위 시험(몇 초) — web2/tests_unit/<모듈>.test.mjs, 인자 없으면 전부 → tools/logs/unit_last.md
node web2/tools/try_pick.mjs --why    # 둘째 층 고르기: '단위 시험 먼저: …' 한 줄 + 고친 파일이 닿는 통합 시험(try_*)
```
- 차례: 고친 모듈의 단위 시험 먼저 → 통과하면 고르개가 고른 통합 시험(가상 창·크롬)만 → 커밋 뒤 전체 시험(`try_all.mjs`, 단위 시험도 맨 앞에 돎).
- 단위 시험 파일 꼴: `export default async function (t) { t.check(번호, 무엇, 기대, 실제, 맞나); }` — `t.src('ahead')` 앱 모듈, `t.cfg('config_ahead')` 앱 설정, `t.tools`·`t.app` 폴더. 다리·창 없이. 옛 try_* 안의 단위 시험은 아직 그대로(새로 만지는 모듈만 여기로).
- **'파일 → 통합 시험' 표**(`tools/logs/cover_map.json`)는 손으로 적지 않는다: 전체 시험이 시험마다 node 내장 커버리지(`NODE_V8_COVERAGE`)를 켜고, 실제로 함수가 불린 `src/` 파일을 시험·부분마다 적는다(`config_try_all.json` 의 `cover`). 시험이 바뀌면 다음 전체 시험이 다시 만든다. 부분이 다 모인 시험(`complete`)만 고르개가 쓴다 — 그 시험이 고친 파일을 지나갔으면 고르고, 안 지나갔으면 안 고름. 크롬 안에서 도는 빌드 묶음은 node 커버리지에 안 잡혀 **크롬 시험은 표 + 낱말**을 함께 본다. 표가 없거나 덜 모인 시험은 정비 가 그대로(낱말 + import 거꾸로).
- 뼈대(`app.js`·빌드·뼈대 html)를 고치면 앱을 띄우는 시험이 다 골라지는 것이 맞다(조립은 표가 아니라 '앱을 띄우는 시험'으로 잇는다).
- 지금 단위 시험 파일: `ahead`('앞의 ○○' 를 제목과 상관없게) · `check4`(⑤ 판정, 갈림길 양쪽) · `lib_testbed`(남은 화면 물음 막기·한도 타이머) · `topic_station`(꽂는 자리·제목 고르기·격리) · `ui_topic`(제목 단추, 제목 하나/둘 양쪽) · `try_pick`(커버리지 표 고르기).

## 남은 화면 물음 막기 (정비 나 0 — 추가1 크롬 실패의 까닭)
- 크롬 시험 서버(`lib_chrome`·`try_add1`·`try_a7 shots`)와 보기(`view_s1`)는 `/v1/…` 를 다리로 넘기기 전에 `lib_testbed.strayGuard` 로 비밀 값 머리를 본다: 머리가 있는데 이번 실행 값과 다르면(앞 보기의 브라우저 탭이 남아 옛 값으로 묻는 것) 다리로 넘기지 않고 잠금 답(`testbed.lock_status`) — 다리의 '틀린 비밀 값 5번 → 30초 막음'이 안 쌓인다. 처음 하나만 기록장에 보낸 쪽·Referer 와 함께, 끝에 막은 수. 머리 없는 물음(stream·scene)은 그대로. 일부러 틀린 값을 다리까지 보내는 시험은 `strayGuard(…, {pass_wrong: true})`.
- 크롬 창이 '준비 안 됨'이면 그때 상태 자리 글(`#ev-status` — `chrome.status_q`)을 실패 줄(추가1)·기록장(`lib_chrome`)에 같이 적는다. 크롬 시험이 '준비 안 됨'으로 실패하면 화면을 의심하기 전에 `testbed/logs/testbed.log` 에서 `앱 비밀 값 틀림`·`막힌 주소` 부터 본다.
- 다리 끝 기다림·결과 기다림의 한도 타이머는 `raceLimit` 으로 — 먼저 끝나면 타이머를 지워 시험이 곧바로 끝난다(추가1 이 표를 다 찍고도 안 끝나 전체 시험 600초 한도에 끊기던 것).

## 정비 가 스스로 시험 — `try_ga.mjs`
```
node web2/tools/try_ga.mjs pure   # 고르개 예시 · 계산기 입출력 = 커밋 전 · 기록장 못 읽음 · 격리 판정 · 등급 표 빠짐(몇 초)
node web2/tools/try_ga.mjs app    # 설정 하나씩 깨기(그 기능만 꺼짐 · 기본 기능 돎) · 옛·새 계산기에 같은 입력 → 같은 조각 · 상태 자리(다리 240초)
```

## 크롬으로 보기 — `view_s1.mjs`
```
node web2/tools/view_s1.mjs [초] [장면] [틱]
```
- 빌드(임시 폴더, 다리 주소만 이 서버로 바꿔 — `build.mjs --override`) + 다리(시험 모드) + `http://127.0.0.1:5173/` 작은 웹 서버를 같은 초만 띄운다. 이 서버는 페이지를 내고, `/v1/…` 는 선 파일·제한 속도 파일(A5 — 고른 장면의 limits 로 만든 것)만 대신 답하고 나머지는 다리로 넘긴다. 자세히 `web2/README.md`.

## 빌드 인자 (A2 에서 더함)
- `--override <파일>`: `{설정 이름: 통째로 바꿀 객체}` — 보기 도구만 쓴다. `--app <폴더>`: 다른 폴더의 앱 사본을 짓는다(E4 시험).
- 판(KIND 'board' 선언 — `build.board_decl`)은 본문 조각이 아니라 판 목록(`@@BOARDS@@`)으로 들어간다. 기계 검사 ④ 의 층은 층 표에 없으면 KIND 로(`check4.kind_layer`).

## 지도 라이브러리 받기 — `vendor_get.mjs`
```
node web2/tools/vendor_get.mjs
```
- `npm pack maplibre-gl@<판>`(판은 `vendor.version`)으로 묶음을 `tools/tmp/vendor/`(git 밖)에 받고, 정한 세 파일만 `web2/vendor/` 로 꺼낸다(묶음 안 스크립트는 돌리지 않는다). 이미 받은 `.tgz` 가 있으면 경로를 인자로.
