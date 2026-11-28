# 충전 길잡이 새 앱 (web2)

설계: `ev-charge-planner_설계/설계.md`(5-1·5-1-나·5-2·5-3·5-7·6절). 옛 앱 `web/` 은 그대로 둔다.
지금 걸음: **A7 — 옛 기능 옮기기(목록·추천, 내 차·할인)** (묘성 정함 C6 — 주변 충전소·제조사 거르기·새로 받기는 옮기지 않음, 옛 페이지에 그대로):
- 순수 `engine.js`(옛 `web/engine.js` 를 옮김 — 숫자·알림 글은 `config_engine.json`, 계산 차례는 그대로라 옛 엔진·파이썬 엔진과 같은 결과) · `planinput.js`(옛 `inputs()` — 중계 자료(목록·선·충전기 상태)를 옛 노선 꼴로(`routeFromRelay` — 휴게소 묶음·km·방향은 `ahead.places` 와 같은 셈), 내 차·할인·내 값으로 엔진 입력(`inputs`), StateCalc 표 한 줄 `planOf` → `plan`) · `mine.js`(내가 확인한 값·업체 별명).
- 화면 `ui_route`(목록·추천)·`ui_my`(내 차·할인·업체): 여는 단추는 아래 띠 `ev-more` 자리(흐름), 칸은 가운데 칸 안 지도 아래(정보 칸과 같은 길 — 떠 있는 겹 없음). 둘은 한 번에 하나만 열린다(`route.panel`·`my.panel`).
- 흐름: '목록'을 열면 `plan.request`(열림·지금 배터리 %) → CalcRunner 가 같은 셈의 `pos`·`ahead` 로 `planinput.planOf` → `plan`. 열려 있는 동안 그 노선 충전소 id 를 `route.watch` 로 알려 `relay_status` 가 그 시군구 상태만 받는다(정보 칸의 것과 합침). 휴게소 줄을 누르면 `station.select.list` → 정보 칸.
- 상태를 모르는 충전기는 빈자리로 세지 않는다(엔진에는 통신 오류로 — 아는 척 추천하지 않음), 줄에 '상태 모름 n대'. 요금은 중계 목록에 없어 옛 실제 자료와 같은 추정 391원/kWh(`config_planinput.default_price` — 업체 요금·내 값으로 바꿈). 나들목 인근 충전소는 '내 차'의 **'나들목 인근 충전소 포함'**(처음 값 꺼짐 — 아래 '나들목 인근 충전소 (추가4)')을 켰을 때만 목록·추천에 들어간다.
- 내 차·할인은 폰 데이터 폴더 `data/my.json`(Store 키 `my`) — 처음 값은 `config_ui_my.defaults`(옛 앱 처음 값). 칸 검사는 `config_formcheck`(`soc`·`my_*`). 카카오·공공데이터 키 칸은 없다.

앞 걸음 A6 — **주소 검색 · 경로 · 기록 올리기**: 지도 위 검색 칸(`ui_navi`) → 다리의 집 PC 길(`net_route` — 주소·잠금 값 모름, 길 이름만 NetCore 에)로 장소 찾기 → 고르면 길 묻기 → 답을 노선 꼴로(`naviroute`, StateCalc 표 `route`) → 지도에 경로 선, 앞의 충전소가 경로 기준(`navi.aheadOnRoute` — 경로 선 1.5 km 안, 갈림목 너머까지, 경로 끝 뒤는 끝의 고속도로로 채움, 300 m 넘게 벗어나면 원래 셈). '경로 지우기'. 실패는 집 PC 길 끊김(검색·올리기 흐림 + 상태 자리 '집 컴퓨터' 줄)과 카카오 쪽 실패(상태 자리 한 줄만)로 나눔. '기록' 칸의 **'기록 올리기'**(`ui_log` → `odd.upload.request` → RouteClient 가 아직 안 올린 '이상해' 기록을 차례로 한 번씩, 기록마다 `odd.result`, 올린 목록은 `data/odd_sent.json`) — 누를 때만, 저절로 다시 안 감. 값은 `config_net_route`·`config_naviroute`·`config_navi`·`config_ui_navi`·`config_ui_log.upload`.
- 다리 길(테스트 베드 시험 다리와 같음): 장소 `/v1/place`(POST `{q}`) · 길 `/v1/route`(POST 출발·도착) · 기록 올리기 `/v1/odd`(POST 기록 하나) · 집 PC 살핌(다리 상태 길). 답 꼴은 설계 5-5 — `naviroute.checkPlaces/checkRoute` 가 모르는 칸·범위 밖·개수 한도를 거절.

앞 걸음 A5 — **제한 속도**: 속도판에 그 길의 제한 속도(정상), 넘으면 주의(주황)·위험(빨강) 모양(넘음), 자료 없는 길·못 받은 칸·후보 갈림이면 제한 칸을 비움(빈 칸 — '0'·짐작 값 없음). 받기 `relay_limit`(고속도로 표 + 일반 도로 목차·지금 칸과 이웃 칸, `fix` 로 칸이 바뀌면 받음, 폰 사본 `data/limit.json`, 끊기면 들고 있는 것 그대로) → 셈 `limitmatch`(순수 — 고속도로는 같은 셈의 `pos` 선·km·방향, 일반 도로는 거리·방향 문턱, 후보가 갈리면 없음) → `speed`(넘음이 정한 시간 이어져야 경고) → `CalcRunner` 가 `limit`·`speed` 발행 → 속도판은 보여 주기만. 값은 `config_limitmatch`·`config_relay_limit`·`config_speed`·`config_relay_parse.limit`.
앞 걸음 A4 — 충전소 상태 · 정보 칸 · 다른 내비로 넘기기: 충전소판 줄·지도 번호·충전소 점을 누르면 지도 칸 아래에서 정보 칸(`ui_station`)이 올라온다(마지막에 온 선택을 엶, 카메라·'세 곳만'은 그대로). 업체마다 빈자리 수·받은 때('○분 전' — 낡으면 낡았다고)·충전기마다 고장·사용 중·빈자리·모름, '다시 받기', '내비로 보내기'(geo: — 고르기 창) + '좌표·이름 복사'(늘 함께), 앱별 작은 단추(티맵·카카오맵·네이버 지도·구글 — 주소 무늬는 `config_navlink.json`). 상태는 정보 칸이 열린 동안만 그 시군구의 `status/<시군구>.json`·`meta.json` 을 받는다(`relay_status` — 끊기면 들고 있는 것을 그대로, 상태 자리에 '충전소 자료 — 끊김'). 순수 모듈: `relay_fresh`(신선함 — 중계 모양 문서 규칙 1) · `relay_read`(상태 파일 읽기) · `relay_html`(이스케이프 한 곳 — 지금 화면은 모두 글로만 넣어 부르는 곳은 아직 없음) · `navlink`(주소 글). 판의 누름은 `needs().sends` 로 밝히면 판 틀이 `send` 를 넘긴다.
앞 걸음 A3 — 지도(카메라 규칙 `mapcam.js`(순수, 설정 `config_mapcam.json`): 손으로 돌린 방향·확대가 위치가 바뀌어도 그대로 굳음, 손으로 옮기면 따라가기 끔, '내 위치' 단추로 내 위치·진행 방향, 느릴 때(시속 10 아래 — 정차·후진)는 방향을 안 돌림, 코드가 움직일 때 효과 없음. 1·2·3번을 지도에 큰 번호로(충전소판과 같은 `ahead` 조각), 다른 충전소는 작은 회색 점 — '세 곳만'이면 숨김. 카메라 상태는 폰 데이터 폴더 `data/mapcam.json` 에 저장해 다시 열어도 같음. 단추 둘은 화면 아래 띠 왼쪽). 앞 걸음 A2-나 — 충전소판·이상해(앞의 충전소 세 곳 — 휴게소 방향 맞춤·지나치면 다음 곳·고속도로 밖이면 '주변' 세 곳, 위치 권한 안내(기기 GPS 일 때만), '이상해' 단추 — 폰 데이터 폴더에 기록 하나씩). 앞 걸음 A2-가: 자료·속도(충전소 목록·고속도로 선 받기, 위치 검사·선에 붙이기, 알림판 틀과 속도판).
- 앞의 충전소 셈은 `ahead.js`(순수 — `statecalc` 표 한 줄, 설정 `config_ahead.json`). 휴게소 방향은 지금 충전소 **이름의 방향 낱말**(`line_dir_words`)로 가른다 — 중계 R0 목록에 방향 칸이 생기면 그것으로 바꾼다.
- '이상해' 기록은 데이터 폴더 `data/odd_<시각><밀리초 끝 세 자리>_<켠 뒤 차례>.json` + 목록 `data/odd_index.json`(보관 개수 `config_store.records.odd.keep`). 올리기는 A6.

## 나들목 인근 충전소 (추가4, 2026-11-29)
- **옵션**: '내 차' 칸 맨 아래쪽 '내 차' 묶음의 체크 **'나들목 인근 충전소 포함'**(`config_ui_my` 의 `ic_near`, 처음 값 꺼짐, 폰 `data/my.json` 에 저장). 켜면 목록·추천에 옛 앱처럼 나들목 인근 충전소가 들어가고(**나들목 왕복 거리를 더함 — 옛 엔진 셈 그대로**), 끄면 지금처럼 휴게소만. 같은 자리에서 옛 앱 1순위 수원신갈 나들목 329원 / 새 앱(끔) 기흥휴게소 391원이던 차이를 옵션으로 푼다.
- **받는 법**(`relay_ramps` — 충전소 꾸러미): 켜졌을 때만, 앱이 '좋음'이 된 뒤 고속도로 선마다 `ramps/<선 이름>.json` 을 받는다(선 이름 = `config_relay_stations.line_files` 에서 뽑음, 허용 무늬 `^ramps/[a-z0-9_]{1,40}\.json$` 는 꾸러미 `adds` 로 `config_relay_base.file_res` 에 더함). 꺼져 있으면 묻지 않는다. 30분마다 다시. 값은 `config_relay_ramps`, 검사·붙이기는 순수 `ramps.js`(`check`·`attach`), 목록 셈 `planinput.routeFromRelay` 가 `attach` 를 부름.
- **자료 꼴 — 중계 R0 가 이대로 낸다**:
```
ramps/<선 이름>.json = {
  "v": 1, "line": "<선 이름>", "at": "<14자리 한국 시각>",
  "ramps": [
    { "id": "...", "name": "수원신갈 나들목", "km": 30.4, "dir": "both",        // km = 선 첫머리에서 잰 거리(휴게소 km 와 같은 잣대), dir = both|forward|backward
      "rest_station": null,                                                      // null = 나들목 항목. 충전소 id 를 적으면 그 휴게소 아래 '나들목 인근'(km 는 null 이어도 됨)
      "nearby": [ { "id": "<충전소 id>", "detour_km": 1.0, "at": "<14자리 한국 시각 | 없음>" } ] }   // 나들목에서 나가 닿는 충전소와 나들목 왕복 거리. at = 그 정보 날짜(있으면 앱이 '○일 전 정보')
  ] }
```
  · nearby 의 충전소 id 는 충전소 목록 `stations/<시군구>.json` 에 있어야 한다(없으면 앱이 그 충전소만 버림 — 이름·좌표·충전기·상태는 목록과 `status/<시군구>.json` 에서). 휴게소 충전소로 이미 든 id 는 뺀다. 한도(줄 수·인근 수·거리 등)는 `config_relay_ramps.limits`. 틀린 줄은 그 줄만 버리고 기록장에 몇째 줄·까닭, 파일 꼴·선 이름이 틀리면 그 파일을 버린다.
  · 옛 앱 자료와의 대응: 옛 `rest_areas` 의 나들목 항목(`kind: ic`, id 끝 `-icN`, `stations: []`) 한 곳 = 나들목 줄 하나(`km`·`name`), 옛 `nearby: [{station, detour}]` = `nearby: [{id, detour_km}]`(충전소는 목록에서).
- **화면**(`ui_route`): 켜져 있으면 ① 1순위·예비 줄이 인근 충전소면 '나들목 왕복 +n km' 칩과 충전소 이름, 자료에 날짜가 있으면 '○일 전 정보 · 도착 전 다시 확인'(`ramp_age_min_days` 일 이상) ② 나들목 항목·인근이 붙은 휴게소 줄에 '나들목 인근 급속 n곳' 칩과 **펼치기/접기**(48px, 처음 접힘 — 줄을 눌러도 나들목 항목은 펼침/접힘) ③ 펼치면 '나들목 인근' 아래 충전소 줄(이름·도착 %·왕복 거리·빈 급속·요금·업체, 누르면 정보 칸) ④ 켰는데 자료가 없으면(받는 중·없음·끊김) 칸 위에 한 줄 '나들목 자료를 받는 중이에요'/'나들목 자료를 아직 못 받았어요' — 짐작해 채우지 않는다. 자료가 와 있는데 앞에 나들목 인근이 없으면 '이 앞에는 나들목 인근 충전소가 없어요'.
- 같은 km 에 나들목 항목과 휴게소가 겹치면 나들목 항목이 앞(옛 실제 자료 차례 — 엔진의 같은 점수 가름이 입력 차례를 따름).
- 시험: 단위 `tests_unit/ramps.test.mjs`(검사·붙이기·켜기/끄기/자료 상태·옛 엔진과 같은 셈 12개) · `node web2/tools/try_add4.mjs pure`(옛 실제 자료 32개 노선의 나들목 548곳·인근 1,540개를 새 자료 꼴로 바꿔 붙인 노선이 옛 노선과 엔진 입력·결과가 같은지 128경우) · `node web2/tools/try_add4.mjs chrome`(진짜 크롬 — S4 장면에 시험용 나들목 자료 `testbed/scenes/relay_extra/ramps/gyeongbu_down.json`([시험], 지어낸 줄): 꺼짐 → 켜고 저장 → 항목·인근·펼치기/접기, 두 창, 자료 없음 한 줄).
- **자료가 들어오면**(중계 R0 '꼭 넣을 것'): 위 꼴 파일이 raw 에 올라오면 앱 고칠 것 없이 켠 사람 목록에 나온다(파일이 없으면 위 한 줄).

## 지도 바탕 — 벡터 지도 ↔ 그림 타일 (추가2, 2026-11-27)
- `config_ui_map.base` 한 줄: `vector`(처음 값 — 글자가 지도를 돌려도 바로 섬, 한국어 이름 먼저) 또는 `raster`(그림 타일 — 돌리면 글자도 같이 돎).
- 벡터 지도 꼴은 우리 밤 운전 스타일 `config/config_mapstyle_night.json`(길은 밝은 회색, 고속도로가 가장 밝고 굵게, 나머지 어두운 회색). 타일 출처 OpenFreeMap(가입·키·돈 없음) — **묘성 확인 전까지 시험·보기용**.
- 못 받으면(첫 조각 전 오류·`vector.wait_ms` 넘김): `vector.fallback` 참 = 그림 타일을 경로 선·점 아래에 깔고 상태 자리 '벡터 지도 — 끊김(못 받음 — 그림 지도로 봄)', 늦게라도 벡터 조각이 오면 걷고 벡터로(한 번만). 거짓 = '지도 그림 — 끊김(벡터 지도 못 받음)' 한 줄만.
- 시험 `node web2/tools/try_add2.mjs [frames|turn|switch] [다리 초]` — 결과 `tools/logs/try_add2_*.md`, 그림 `<작업 폴더>/90_임시/add2_shots/`.

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
- (2026-11-27) **실제 출처**: 테스트 베드 `testbed/config/limit_source.json` 의 `use_scenes` 장면(지금 S13)은 실자료 선 구간의 제한 속도를 출처(`source` — 지금 `osm` 오픈스트리트맵 `maxspeed`)에서 뽑은 표(`testbed/scenes/limits/<선>.limits.json`, 도구 `testbed/tools/limit_table.py`)로 내준다. 값 없는 구간은 싣지 않음(빈 칸). 설정 칸은 `config_tools.testbed.limit_shim.real_source`.
- 속도판의 제한 속도는 도로 표지판 모양(흰 둥근 판 + 빨간 테두리 + 검은 숫자 — `config_ui_speed.sign` 을 CSS 변수로). 값이 없으면 판 자체를 숨기고, 넘음·위험이면 판 둘레에 그 상태 색 빛 테.

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
- 제목 바꾸기 단추(`ui_topic`, 설정 `config_ui_topic`): 아래 띠 더 보기 자리 맨 앞(48px) + 가운데 기둥의 제목 목록 칸. 고르면 Store `topic` 에 '마지막에 쓴 제목'을 남기고 주소 꼬리를 바꿔 다시 켬. 켤 때 남긴 것이 지금 것과 다르면 그 제목으로 다시 켬. **제목이 `min_show`(2) 개보다 적으면 단추를 숨김** — 좁은 세로 창(360)의 아래 띠에 폭이 없음(갈림길 3 — 11/27 아래 띠 그림 글자로 폭 문제는 풂, 아래 '11/27').

## 추가3 앞 기본 걸음 (2026-11-27) — 꾸러미가 자기 것을 밝힘
새 제목이 **남의 파일을 고치지 않고** 붙게(위 '아직 꾸러미 파일만으로 안 되는 것'을 풂):
- **더하기(`adds`)**: 설정 파일의 `adds` 칸 `{다른 설정: {칸: 값}}` 을 Config(`cfg.js`)가 그 설정에 더한다 — 꾸러미 설정이 `config_health.grades·features·conn_source`, `config_ui_status.texts.feature_names·src_names` 에 자기 줄을 밝힘. 없는 칸만 더하고, 이미 있는 칸이 다른 값이면 바꾸지 않고 문제(`adds_clash`). 더하는 쪽 꼴이 틀려도 더함(등급을 알아야 '그 기능만 꺼짐'). 칸 이름은 `tools/config_tools.json` 의 `build.adds_key`.
- **꾸러미 화면 조각**: `config_topic_<제목>.views`(화면 조각 이름 목록)는 `views_order` 에 없어도 되고, 빌드가 `build.topic_views_after`(지금 `ui_route`) 바로 뒤에 넣는다.
- **제목에 딸린 판**: 판의 `needs().topic` 에 제목 이름을 밝히면 그 제목이 켜졌을 때만 판 틀이 꽂는다(충전소판 `config_ui_ahead.topic` = `station`). 조립이 켠 제목 이름(`topic_on`)을 판 틀에 넘김.
- **지도의 다른 점·누름**: 꾸러미가 `createTopic` 결과에 `map: {dots_piece, list_key, select_piece}` 를 밝히면 지도가 그 조각으로 회색 점을 그리고 누름을 그 이름으로 낸다(안 밝히면 `config_ui_map` 의 충전소 것 — 충전소는 그대로).
- 아래 띠 그림 글자: 꾸러미 단추는 자기 모듈이 자기 단추에 `data-glyph`·`aria-label` 을 단다(`ui_bar` 목록을 고치지 않음 — 모양은 `[data-glyph]` 로 같음).
- 시험 도구: `startApp(…, {hash})`(주소 꼬리로 제목 켜기) · `stop()` 이 멈추기가 있는 것을 모두 멈춤 · 크롬 재기 `measureInChrome(…, {hash})` · 시험 서버가 테스트 베드 `scenes/relay_extra/` 의 파일을 자료 길 이름(상대 경로)으로 대신 답함(`testbed.extra_shim`) · `try_ga` ⑤ 등급 표는 더한 것까지 합쳐 봄.
- 단위 시험: `tests_unit/cfg.test.mjs`(더하기 ①~⑥), `topic_station.test.mjs` ⑪⑫(딸린 판), `check4.test.mjs` ⑨⑩(층 선언).
- (기본 걸음 2) 더하기가 목록끼리는 없는 것만 뒤에 덧붙인다(예: `config_relay_base.file_res` 에 꾸러미 파일 무늬).
- (기본 걸음 3) 기계 검사 ④: 층 표(`check4.module_layer`)에 없고 KIND 도 없는 모듈은 머리의 `export const LAYER = 'pure'|'client'|'screen'`(`declarable_layers`)이 층. NEEDS 이름이 모듈 이름과 같으면 그 모듈(층 규칙은 그대로). 받기 층(client)은 `relay_base` 에 기댈 수 있음(`layer_extra_needs`). 꾸러미 모듈이 층 표·받는 것 표를 고치지 않게.

## 추가3 (2026-11-27) — 두 번째 제목 '화장실' (새 파일만)
- 꾸러미 `src/topic_toilet.js` + `config/config_topic_toilet.json`(label·calc_rows·views·map·adds) — 꽂는 자리 밖 기존 파일은 고치지 않았다(기계 검사 ⑤ '판·제목 걸음' 통과).
- 받기 `relay_toilets`(설정 `config_relay_toilets`): 앱이 '좋음'이 된 뒤 다리 자료 길 `toilets/list.json`(중계 공공 자료 — 아직 중계가 안 만듦, 꼴 `{v:1, at, items:[{id, name, lat, lng, open, all_day, truck, memo}]}`)을 받고, **묘성 자료**(`config/config_toilet_mine.json` 의 `rows`)·**휴게소 화장실**(충전소 목록의 휴게소 줄 — 24시간, 트럭 모름)과 합쳐 `toilets` 로 낸다. 합치기는 순수 `toiletmerge`(규칙 `config_toilet_merge`): 틀린 줄은 버리고 기록장에 몇째·까닭, **같은 id 이거나 60 m(`same_m`) 안이면 묘성 줄이 이김**(직접 가 보고 적은 것이 더 새롭고 정확). 공공 자료를 못 받아도(없음·끊김·꼴 틀림) 묘성·휴게소 화장실은 그대로 보이고 상태 자리에 '화장실 자료 — 끊김' 한 줄.
- 계산 `toiletcalc`(설정 `config_toilet_calc`): '앞의 ○○'(`ahead.aheadOf`)을 그대로 — 규칙은 충전소의 `config_ahead` 에 화장실 칸(받는 조각·점 칸 이름)만 덮음(값 한 벌). 목록 `toilet.list`(8곳)를 셈하고 `ahead`(지도 번호·판)는 그 앞 3곳. 고속도로 위 = 휴게소 화장실(진행 방향 앞), 밖 = 곧은 거리 주변(휴게소 뺌), 경로가 있으면 경로 따라.
- 화면: 화장실판 `ui_toilet_board`(KIND board, `topic: toilet` — 화장실일 때만), 목록 칸 `ui_toilet_list`(아래 띠 '화장실 목록' — 좁은 창 그림 글자 🚻, 목록 칸 알림은 충전소 목록 칸과 같은 `route.panel` 이라 제목·내 차 칸이 그대로 닫힘), 정보 칸 `ui_toilet_card`(판·목록·지도 번호/점을 누르면).
- **묘성 자료 쓰는 법**: `config/config_toilet_mine.json` 의 `rows` 에 한 곳 한 줄 — 꼴은 같은 파일 `example`. 고친 뒤 앱을 다시 빌드해 올린다. 이 파일 꼴이 깨지면 묘성 자료만 꺼짐(상태 자리 '화장실 — 묘성 자료 설정이 이상해 꺼 둠').
- 시험: 단위 `tests_unit/toiletmerge.test.mjs`(합치기·셈 ①~⑥)·`topic_toilet.test.mjs`(두 제목·격리·받기 ①~⑪) · 진짜 크롬 `node web2/tools/try_add3.mjs`(화장실로 켜서 네 창 — 판·겹침 0·목록·정보 칸) · `node web2/tools/try_add3.mjs around`(고속도로 밖 주변). 공공 시험 자료는 `testbed/scenes/relay_extra/toilets/list.json`(지어낸 점, 이름 앞 [시험]).
- **주차 칸(11/28 손질)**: 줄마다 `parking`(true 있음·false 없음·null 모름 — 중계 목록·묘성 자료의 칸, 안 적으면 모름). 휴게소 화장실은 트럭 가능(`config_toilet_merge.rest.truck` true)이고 `parking.rest_by_truck` 가 참이면 주차 있음. 화장실판·목록·정보 칸 모두 줄마다 거리(크게) 아래 '주차 있음/없음/모름'(초록·빨강·회색) — 켜고 끄는 옵션 없이 가까운 차례 그대로. 고정 파일 판은 raw 사본(`variants/static.patch.json` 의 static_base)에서 받음(허용 무늬는 꾸러미 adds, 시험 `netcore_static ⑧`).
- **시군구별 받기(11/29)**: 화장실 받기가 `toilets/index.json`(`{v, at, regions:{시군구5자리:{n, at}}}`)을 먼저 받고, **충전소가 받는 시군구 목록(`config_relay_stations.station_files` 에서 5자리를 뽑음 — `config_relay_toilets.regions_from`)** 중 색인에 있는 것의 `toilets/<5자리>.json`(`{v, sg, at, items}`)만 받는다. 색인에 없는 지역은 묻지 않음. 시군구 파일이 꼴 틀림(v·sg·items)이면 그 파일만 버리고 끊김(bad), 못 받으면 그 시군구는 들고 있던 줄 유지 + 끊김. 허용 무늬 = `^toilets/index\.json$`·`^toilets/[0-9]{5}\.json$`(옛 `list.json` 무늬는 뺌). 시험 자료 = `testbed/scenes/relay_extra/toilets/index.json`·`41550.json`(지어낸, [시험]; 옛 `list.json` 은 안 쓰이고 남아 있음). 시험: `topic_toilet ⑨~⑭`·`netcore_static ⑧`. raw 에 화장실 파일이 아직 없어 지금은 '화장실 자료 — 끊김/없음' 한 줄이 맞는 동작(중계 올리기 프로그램 다시 시작은 묘성이 정함). 시험: `toiletmerge ⑦⑧`·`try_add3 ①-주차`.
- 보기: `node web2/tools/view_s1.mjs 600` → 크롬 `http://127.0.0.1:5173/#topic=toilet`(또는 아래 띠 '충전소 ▾' → 화장실).

## 11/27 — 제목 단추 자리 · 아래 띠 그림 글자 · 꺼지지 않게
- 제목 단추(`ui_topic`): 글 '지금 제목 ▾'(`config_ui_topic.texts.open`), 자리 = `button_slot`(아래 단추 줄 묶음 `ev-more`/`ev-map-bar` 의 몇째 — 처음 값 `ev-more` 맨 앞). 보일 조건 `min_show`(처음 값 2 — 제목이 하나면 숨김, 1 이면 늘 보임).
- 아래 띠 그림 글자(`ui_bar`, `config_ui_bar`): `mode` narrow(560px 이하에서만 — 처음 값)·always·never. 그림 글자일 때 단추 48×48, 화면 읽기 글(aria-label)은 글. 좁은 세로(360) 아래 띠 한 줄 344px — 판이 밀리지 않음.
- 화면 꺼짐 막기(`wake`, `config_wake.on`): 좋음이 되면 Screen Wake Lock, 다시 보이면 다시 잡음. 지원 안 됨·거절이면 상태 자리 '화면 켜 두기 안 됨 — 까닭'(`conn.wake`).
- 하던 자리로 돌아오기: 제목 = Store `topic`(그대로) · 지도 카메라 = `data/mapcam.json`(손으로 옮겨 따라가기를 끈 채면 그 가운데도 — `mapcam` center) · 고른 길 = `data/route.json`(`config_net_route.resume` — 새 답마다 남기고 '경로 지우기'면 비움, 켤 때 다시 묻지 않고 같은 검사로 다시 그림, 12시간 넘으면 버림).
- 꺼진 까닭(`resume`, `config_resume.on`): 켤 때 로그 `last_end` 한 줄 — first · clean(pagehide 를 적음) · unexpected(깨끗한 닫힘 표시 없음, `while` 숨긴 채/보이는 채). 표시는 `data/session.json`.
- 시험: 단위 `ui_topic`·`ui_bar`·`wake`·`resume`·`mapcam`·`net_route`·`ui_status` · 크롬 `node web2/tools/try_fix27.mjs`(min_show 1 빌드, 세 창).

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
