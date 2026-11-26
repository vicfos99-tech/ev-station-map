# 충전 길잡이 새 앱 (web2)

설계: `ev-charge-planner_설계/설계.md`(5-1·5-1-나·5-2·5-3·5-7·6절). 옛 앱 `web/` 은 그대로 둔다.
지금 걸음: **A7 — 옛 기능 옮기기(목록·추천, 내 차·할인)** (묘성 정함 C6 — 주변 충전소·제조사 거르기·새로 받기는 옮기지 않음, 옛 페이지에 그대로):
- 순수 `engine.js`(옛 `web/engine.js` 를 옮김 — 숫자·알림 글은 `config_engine.json`, 계산 차례는 그대로라 옛 엔진·파이썬 엔진과 같은 결과) · `planinput.js`(옛 `inputs()` — 중계 자료(목록·선·충전기 상태)를 옛 노선 꼴로(`routeFromRelay` — 휴게소 묶음·km·방향은 `ahead.places` 와 같은 셈), 내 차·할인·내 값으로 엔진 입력(`inputs`), StateCalc 표 한 줄 `planOf` → `plan`) · `mine.js`(내가 확인한 값·업체 별명).
- 화면 `ui_route`(목록·추천)·`ui_my`(내 차·할인·업체): 여는 단추는 아래 띠 `ev-more` 자리(흐름), 칸은 가운데 칸 안 지도 아래(정보 칸과 같은 길 — 떠 있는 겹 없음). 둘은 한 번에 하나만 열린다(`route.panel`·`my.panel`).
- 흐름: '목록'을 열면 `plan.request`(열림·지금 배터리 %) → CalcRunner 가 같은 셈의 `pos`·`ahead` 로 `planinput.planOf` → `plan`. 열려 있는 동안 그 노선 충전소 id 를 `route.watch` 로 알려 `relay_status` 가 그 시군구 상태만 받는다(정보 칸의 것과 합침). 휴게소 줄을 누르면 `station.select.list` → 정보 칸.
- 상태를 모르는 충전기는 빈자리로 세지 않는다(엔진에는 통신 오류로 — 아는 척 추천하지 않음), 줄에 '상태 모름 n대'. 요금은 중계 목록에 없어 옛 실제 자료와 같은 추정 391원/kWh(`config_planinput.default_price` — 업체 요금·내 값으로 바꿈). 나들목 인근 충전소는 지금 중계 목록에 없어 목록에 안 나온다(옛 앱과 다른 곳 — 옛 값은 참고, 설계 6-6).
- 내 차·할인은 폰 데이터 폴더 `data/my.json`(Store 키 `my`) — 처음 값은 `config_ui_my.defaults`(옛 앱 처음 값). 칸 검사는 `config_formcheck`(`soc`·`my_*`). 카카오·공공데이터 키 칸은 없다.

앞 걸음 A6 — **주소 검색 · 경로 · 기록 올리기**: 지도 위 검색 칸(`ui_navi`) → 다리의 집 PC 길(`net_route` — 주소·잠금 값 모름, 길 이름만 NetCore 에)로 장소 찾기 → 고르면 길 묻기 → 답을 노선 꼴로(`naviroute`, StateCalc 표 `route`) → 지도에 경로 선, 앞의 충전소가 경로 기준(`navi.aheadOnRoute` — 경로 선 1.5 km 안, 갈림목 너머까지, 경로 끝 뒤는 끝의 고속도로로 채움, 300 m 넘게 벗어나면 원래 셈). '경로 지우기'. 실패는 집 PC 길 끊김(검색·올리기 흐림 + 상태 자리 '집 컴퓨터' 줄)과 카카오 쪽 실패(상태 자리 한 줄만)로 나눔. '기록' 칸의 **'기록 올리기'**(`ui_log` → `odd.upload.request` → RouteClient 가 아직 안 올린 '이상해' 기록을 차례로 한 번씩, 기록마다 `odd.result`, 올린 목록은 `data/odd_sent.json`) — 누를 때만, 저절로 다시 안 감. 값은 `config_net_route`·`config_naviroute`·`config_navi`·`config_ui_navi`·`config_ui_log.upload`.
- 다리 길(테스트 베드 시험 다리와 같음): 장소 `/v1/place`(POST `{q}`) · 길 `/v1/route`(POST 출발·도착) · 기록 올리기 `/v1/odd`(POST 기록 하나) · 집 PC 살핌(다리 상태 길). 답 꼴은 설계 5-5 — `naviroute.checkPlaces/checkRoute` 가 모르는 칸·범위 밖·개수 한도를 거절.

앞 걸음 A5 — **제한 속도**: 속도판에 그 길의 제한 속도(정상), 넘으면 주의(주황)·위험(빨강) 모양(넘음), 자료 없는 길·못 받은 칸·후보 갈림이면 제한 칸을 비움(빈 칸 — '0'·짐작 값 없음). 받기 `relay_limit`(고속도로 표 + 일반 도로 목차·지금 칸과 이웃 칸, `fix` 로 칸이 바뀌면 받음, 폰 사본 `data/limit.json`, 끊기면 들고 있는 것 그대로) → 셈 `limitmatch`(순수 — 고속도로는 같은 셈의 `pos` 선·km·방향, 일반 도로는 거리·방향 문턱, 후보가 갈리면 없음) → `speed`(넘음이 정한 시간 이어져야 경고) → `CalcRunner` 가 `limit`·`speed` 발행 → 속도판은 보여 주기만. 값은 `config_limitmatch`·`config_relay_limit`·`config_speed`·`config_relay_parse.limit`.
앞 걸음 A4 — 충전소 상태 · 정보 칸 · 다른 내비로 넘기기: 충전소판 줄·지도 번호·충전소 점을 누르면 지도 칸 아래에서 정보 칸(`ui_station`)이 올라온다(마지막에 온 선택을 엶, 카메라·'세 곳만'은 그대로). 업체마다 빈자리 수·받은 때('○분 전' — 낡으면 낡았다고)·충전기마다 고장·사용 중·빈자리·모름, '다시 받기', '내비로 보내기'(geo: — 고르기 창) + '좌표·이름 복사'(늘 함께), 앱별 작은 단추(티맵·카카오맵·네이버 지도·구글 — 주소 무늬는 `config_navlink.json`). 상태는 정보 칸이 열린 동안만 그 시군구의 `status/<시군구>.json`·`meta.json` 을 받는다(`relay_status` — 끊기면 들고 있는 것을 그대로, 상태 자리에 '충전소 자료 — 끊김'). 순수 모듈: `relay_fresh`(신선함 — 중계 모양 문서 규칙 1) · `relay_read`(상태 파일 읽기) · `relay_html`(이스케이프 한 곳 — 지금 화면은 모두 글로만 넣어 부르는 곳은 아직 없음) · `navlink`(주소 글). 판의 누름은 `needs().sends` 로 밝히면 판 틀이 `send` 를 넘긴다.
앞 걸음 A3 — 지도(카메라 규칙 `mapcam.js`(순수, 설정 `config_mapcam.json`): 손으로 돌린 방향·확대가 위치가 바뀌어도 그대로 굳음, 손으로 옮기면 따라가기 끔, '내 위치' 단추로 내 위치·진행 방향, 느릴 때(시속 10 아래 — 정차·후진)는 방향을 안 돌림, 코드가 움직일 때 효과 없음. 1·2·3번을 지도에 큰 번호로(충전소판과 같은 `ahead` 조각), 다른 충전소는 작은 회색 점 — '세 곳만'이면 숨김. 카메라 상태는 폰 데이터 폴더 `data/mapcam.json` 에 저장해 다시 열어도 같음. 단추 둘은 화면 아래 띠 왼쪽). 앞 걸음 A2-나 — 충전소판·이상해(앞의 충전소 세 곳 — 휴게소 방향 맞춤·지나치면 다음 곳·고속도로 밖이면 '주변' 세 곳, 위치 권한 안내(기기 GPS 일 때만), '이상해' 단추 — 폰 데이터 폴더에 기록 하나씩). 앞 걸음 A2-가: 자료·속도(충전소 목록·고속도로 선 받기, 위치 검사·선에 붙이기, 알림판 틀과 속도판).
- 앞의 충전소 셈은 `ahead.js`(순수 — `statecalc` 표 한 줄, 설정 `config_ahead.json`). 휴게소 방향은 지금 충전소 **이름의 방향 낱말**(`line_dir_words`)로 가른다 — 중계 R0 목록에 방향 칸이 생기면 그것으로 바꾼다.
- '이상해' 기록은 데이터 폴더 `data/odd_<시각><밀리초 끝 세 자리>_<켠 뒤 차례>.json` + 목록 `data/odd_index.json`(보관 개수 `config_store.records.odd.keep`). 올리기는 A6.

## 크롬으로 장면 보기 (집 PC)
명령은 저장소 맨 위(`C:\Claude_work\10_프로젝트\ev-charge-planner`)에서 하나씩.
1. `node web2/tools/view_s1.mjs [초] [장면] [틱]` — 없으면 600초 · S1 · 틱 0
   - 앱을 임시 폴더에 빌드하고, 테스트 베드 다리를 시험 모드로 띄워 장면을 고르고(틱을 주면 그 틱으로 옮김), 작은 웹 서버를 연다. 정한 초 뒤 셋 다 저절로 닫힌다.
   - 창에 `크롬에서 여세요: http://127.0.0.1:5173/` 가 찍힌다.
   - (A2) 고속도로 선은 중계 R0 전이라 시험 다리가 내주지 않는다 — 이 서버가 다리 앞에 서서 선 파일만 대신 답하고 나머지는 다리로 넘긴다. 그래서 이 보기의 빌드만 다리 주소가 `127.0.0.1:5173` 이다(저장소 설정은 그대로).
2. 크롬 주소 칸에 `http://127.0.0.1:5173/`
   - 정상: 맨 위 띠가 잠깐 '여는 중…' → 얇은 줄. 왼편에 **속도판**(지금 시속을 크게 + `km/h`), 가운데에 지도와 파란 점(1초마다 경부고속도로를 따라 움직임), 오른편에 **충전소판**(앞의 충전소 세 줄 — 구분선 있는 목록: 번호·이름·휴게소·업체·남은 거리), 화면 맨 아래 띠에 **'이상해'** 메모 칸·단추와 오른쪽 '기록' 단추.
   - 배치(고칠 것 일곱, 2026-11-25): 세로(좁은) 창도 가로와 같이 왼편 속도판 · 가운데 지도 · 오른편 충전소판(좁으면 글자 크기 단계를 낮추고 줄을 바꿈). 단추·메모 칸은 화면 위에 떠 있지 않고 맨 아래 띠에 있어 판·지도 저작권 표시를 가리지 않는다(`style_ui_drive.css` 의 격자).
   - 틀리면: 페이지에 '앱 점검 중'과 까닭 한 줄만 있고 운전 화면은 안 뜬다.
- 보기 예: S1 `node web2/tools/view_s1.mjs 600` (속도판 95 · 제한 100) · S2 `node web2/tools/view_s1.mjs 600 S2_제한속도 460` (10초쯤 뒤 115 · 제한 100 · 주황 넘음, 약 4분 뒤 95 로 내려가면 풀림) · S4 `node web2/tools/view_s1.mjs 600 S4_나들목일반도로 195` (제한 100 → 나들목 40 → 일반 도로 60 → 약 5분 40초 뒤 자료 없는 길에서 제한 칸이 빔) · S7 `node web2/tools/view_s1.mjs 600 S7_출처끊김 165` (15초쯤 뒤부터 1분 동안 맨 위에 '충전소 자료 — 시:분부터 끊김(자료 길 답 없음)' 한 줄 — 다시 받기 간격 30초라 늦게는 45초쯤 뒤, 돌아온 뒤 30초 안에 사라짐)
- 주소는 꼭 `127.0.0.1:5173`(테스트 베드가 허용한 출처). 파일을 바로 열면(file://) 다리가 받아 주지 않는다.

## 제한 속도 자료 (A5 — 중계 R5 전의 임시 꼴)
중계 R5(제한 속도 가공)가 아직 없어 꼴은 앱이 먼저 정했다. R5 가 다른 꼴로 정하면 `config_relay_limit`(파일 이름)·`config_relay_parse.limit`(칸 이름)·`relay_parse.limitHighway/limitIndex/limitCell` 을 그에 맞춘다. 판 번호·`at` 은 다른 중계 파일과 같다.
| 파일(다리 자료 길) | 꼴 |
|---|---|
| `limits/highway.json` | `{v, at, sections:[{line, from_km, to_km, fwd, back}]}` — 우리 선(`lines/<선>.json`)의 km 구간(from 이상 to 미만), `fwd` = 선 방향으로 갈 때·`back` = 거꾸로 갈 때 제한 속도(km/h). 0·빈 값 = 없음 |
| `limits/index.json` | `{v, at, cells:["740_2543", …]}` — 자료가 있는 칸 목록. 칸 열쇠 = `내림(위도÷칸 크기)_내림(경도÷칸 크기)`(칸 크기 `config_limitmatch.cell.deg`, 지금 0.05°) |
| `limits/cell/<칸>.json` | `{v, at, cell, segs:[{id, kmh, both, pts:[[위도, 경도]…]}]}` — 도로 조각(`both` = 양방향). 칸에 걸친 조각은 두 칸에 다 넣는다. 값이 0·빈 조각은 싣지 않는다 |
- 시험·보기 도구는 테스트 베드 장면의 `limits`(시험용 값)로 이 꼴을 만들어 대신 답한다(`tools/lib_testbed.limitFiles`) — 실제 제한 속도 자료가 아니다.

## 알림판 (설계 5-1-다)
- 판 = `ui_<판>.js`(머리에 `export const KIND = 'board';` · `create(deps)` 가 `deps.board.define({needs, show})` 를 돌려줌) + `view_ui_<판>.html` + `style_ui_<판>.css` + `config/config_ui_<판>.json`(+ 꼴 표).
- 빌드가 KIND 선언으로 판을 주워 목록을 만들고, 조립은 그 목록을 그대로 판 틀(`ui_boards`)에 넘긴다. **판을 더하거나 빼도 조립·`ui_drive`·`ui_boards`·도구 설정을 고치지 않는다**(기계 검사의 층도 KIND 로 정함).
- `needs()` = `{topics: [State 조각…], interval_ms, slot: 'left'|'right'}` · `show(data)` = 받은 조각을 자기 칸에. 판은 받기·계산·구독을 하지 않는다.

## 시험 고르기 · 전체 시험 (정비 가)
```
node web2/tools/try_pick.mjs [--why] [고친 파일 …]   # 고친 파일(없으면 git 작업 트리+스테이지+새 파일)에 닿는 try_* 시험 이름
node web2/tools/try_all.mjs [--only 이름[,이름:부분]] [--append]   # try_* 전부 차례로 → tools/logs/try_all_last.md
```
- 걸음 세션은 **자기 걸음 시험 + 고르개가 고른 시험만** 돌린다. 전체 시험은 커밋 뒤 `try_all.mjs` 가 따로 돌려 숫자(맨 위 한 줄 합계)만 낸다. 자세히 `tools/README.md`.

## 기능 격리 (정비 가)
- 시작에 꼭 필요한 설정(`config_health.grades` 가 `app`)이 틀리면 지금처럼 '앱 점검 중'. 그 밖의 설정이 틀리면 **그 기능만 꺼지고** 상태 자리에 '○○ 설정이 이상해 꺼 둠' 한 줄(`health.off`), 기본 기능은 돈다. 계산기는 그 설정을 쓰는 계산 줄만 끈다.
- 새 기능의 설정 파일은 `config_health` 의 `grades`(등급)와 `features`(기능 묶음), `config_ui_status.texts.feature_names`(이름)에 적는다 — 빠지면 `try_ga.mjs pure` ⑤ 가 잡는다(등급 표에 없으면 unknown_grade = app 이라 앱 전체가 점검 중).
- 계산기가 구독할 입력·낼 조각은 계산 표(`config_statecalc.table`)에서 뽑는다 — `config_calcrunner` 에 따로 적지 않는다.

## 정비 나 (2026-11-26) — 시험 두 층 · '앞의 ○○' 를 제목과 상관없게
- `ahead.js` 는 충전소를 모른다: 받는 것은 점들(입력 조각 `items_input` 의 `list`·`lines`), 점의 칸 이름은 규칙 `fields`(키·이름·꼬리표·선 위 자리 표시·좌표)에서. 충전소 규칙(`config_ahead`)이 `stations` 조각과 충전소 칸(`id`·`name`·`operator`·`rest`)을 정한다. 다른 제목은 같은 꼴의 규칙 파일만 주면 같은 셈(휴게소 묶기·진행 방향 앞·선 밖이면 주변·경로 따라)을 쓴다. 결과 조각 꼴은 그대로(`ops`·`rest` 칸 이름도 — 화면·목록이 그대로 읽음).
- 시험 두 층: 단위 시험 `tests_unit/<모듈>.test.mjs`(`node web2/tools/unit.mjs`) → 고르개가 고른 통합 시험 → 커밋 뒤 전체. '파일 → 통합 시험' 표는 전체 시험이 커버리지로 만든다(`tools/README.md` '시험 두 층').
- 기계 검사 ⑤ 꽂는 자리: 판·제목 꾸러미 걸음은 새 파일만(설계 5-1). 같은 종류가 이미 있을 때 새로 더해야 '판·제목 걸음'(처음 생기는 종류 = 틀 걸음은 안 막음).

## 정비 나 (2026-11-26) — 제목 틀 · 충전소를 첫 꾸러미로 · 제목 바꾸기
- **제목 꾸러미 꼴**(새 제목 = 이것만 더함): ① `src/topic_<제목>.js` — 머리에 `export const KIND = 'topic'`, `createTopic({cfg})` 가 `{label, rows, parts, clients(d), screens(d)}` 를 돌려줌(받기·화면은 `[[만든 것 이름, 만들기]]` 목록, 계산 모듈은 `parts`) ② `config/config_topic_<제목>.json` — `label`(제목 목록에 보일 글)·`calc_rows`(계산 표 꼴 줄 — `config_statecalc.table` 의 꽂는 자리 `{topic_slot}` 에 들어감) ③ `config/shape/config_topic_<제목>.shape.json`. 그 제목의 받기·계산·화면 모듈과 그 설정은 보통처럼 따로 파일.
  - 아직 꾸러미 파일만으로 안 되는 것(다음 걸음): 새 설정의 등급(`config_health.grades·features`, `config_ui_status.texts.feature_names`)과 새 화면 조각의 차례(`tools/config_tools.json` 의 `build.views_order`) 한 줄씩.
- 빌드가 `KIND 'topic'` 모듈을 주워 `@@TOPICS@@`(이름 = 파일 이름에서 `topic_` 을 뗀 것)로 넘기고, 조립(`app.js`)은 한 번에 하나만 켠다: 주소 꼬리 `#topic=<제목>` → 없으면 첫 꾸러미. 켠 꾸러미의 받기는 충전소 목록 받기 다음, 계산 줄은 꽂는 자리, 화면은 '이상해' 단추 다음에 꽂는다. 꾸러미 만들기가 던지면(설정이 깨짐) 그 제목만 꺼지고 기본 기능은 돈다(`tests_unit/topic_station.test.mjs` ⑩).
- 충전소 꾸러미(`topic_station`) = 상태 받기(`relay_status`) · 정보 칸(`ui_station`) · 목록 칸(`ui_route`) · 계산(`engine`·`planinput`·`mine`, 줄 `ahead`·`plan`). **충전소 목록·고속도로 선 받기(`relay_stations`)는 아직 기본 기능** — 선이 같은 파일로 와서 내 위치·제한 속도·누른 지점 거리가 기댄다(갈림길 1).
- `engine.js` 는 일 단위로 나눔: 검사·만들기 `engine_model` · 거리 `engine_range` · 상태 `engine_status` · 요금 `engine_price` · 목록 `engine_list` · 추천 `engine_pick` · 차례 묶기(`plan`)와 옛 이름 내주기 `engine`.
- 제목 바꾸기 단추(`ui_topic`, 설정 `config_ui_topic`): 아래 띠 더 보기 자리 맨 앞(48px) + 가운데 기둥의 제목 목록 칸. 고르면 Store `topic` 에 '마지막에 쓴 제목'을 남기고 주소 꼬리를 바꿔 다시 켬. 켤 때 남긴 것이 지금 것과 다르면 그 제목으로 다시 켬. **제목이 `min_show`(2) 개보다 적으면 단추를 숨김** — 좁은 세로 창(360)의 아래 띠에 폭이 없음(갈림길 3).

## 폴더
| 자리 | 무엇 |
|---|---|
| `src/*.js` | 모듈(파일 하나 = 일 하나). 모듈끼리 import 는 조립(`app.js`)만 — 예외 `ui_map → mapview` |
| `src/view_*.html` · `src/style_*.css` | 화면 조각(글은 넣지 않음 — 설정에서) |
| `config/config_*.json` · `config/shape/*.shape.json` | 모든 값·글·주소와 그 꼴 표. 다리 주소는 `config_gateway.json` 한 곳 |
| `shell.html` | 뼈대(상태 자리가 처음부터 있음) |
| `vendor/` | 지도 라이브러리 MapLibre 5.24.1(`tools/vendor_get.mjs` 로 받음) |
| `tools/` | 빌드·기계 검사·시험·보기 도구(`tools/README.md`) |

- 앱 비밀 값(`config_app_secret.json`)은 저장소에 넣지 않는다. 빌드 인자 `--secret <저장소 밖 파일>`. 시험·보기 도구는 이번만 쓰는 값을 운영체제 임시 폴더에 만들어 쓰고 지운다.
- 로그는 브라우저 개인 파일 저장소의 `logs/app.log`, 데이터는 `data/`(설정 `config_log`·`config_store`).
