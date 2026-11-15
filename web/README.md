# 충전 길잡이 — 폰 웹 앱

파이썬 엔진(`src/ev_charge_planner/`)을 자바스크립트로 옮기고(`engine.js`), 그 위에 폰 한 화면짜리 앱을 얹었다.
지금은 **예시 데이터**(지어낸 휴게소·충전소)로 돈다. 실제 충전소 정보는 공공 충전소 API 를 붙인 뒤.

## 파일
| 파일 | 하는 일 |
|---|---|
| `engine.js` | 엔진. 파이썬 `models/driving_range/status/pricing/route_list/recommend/planner` 를 한 파일에. 이름은 파이썬과 같은 snake_case, 시각은 밀리초 |
| `data.js` | 예시 노선 3개(경부 부산 방향·서울 방향, 영동 강릉 방향). 충전기 상태 무작위로 바꾸기 |
| `app.js` | 화면: 위 초록 표지판(노선, 배터리 %, 지금 위치), 1순위·예비 추천, 휴게소 띠 지도, 내 차·할인 설정 |
| `index.html`, `style.css` | 뼈대와 모양 |
| `build.js` | 한 파일로 합쳐 `dist/index.html`, `dist/artifact.html` 생성 |
| `test/compare.js` | 파이썬 엔진이 뽑은 기대값 `test/fixtures.json` 과 JS 엔진 대조 |

## 확인하는 법 (저장소 루트에서)
```
py tools/dump_fixtures.py     # 파이썬 엔진으로 기대값 생성 (무작위 노선 400개 + 거리 경계 88개 + 오류 12개)
node web/test/compare.js      # JS 엔진과 대조 (500개)
node web/build.js             # dist/ 다시 만들기
```
파이썬 쪽은 `py -m pytest -q -p no:cacheprovider` (351개).

## 화면이 엔진 결과를 풀어 쓰는 곳 (엔진은 그대로)
- 엔진의 "전체 사용 불가" 경고라도 급속이 충전 중이면 "빈 충전기 없음 · 충전 중 N대"로 보여 준다(고장으로 읽히지 않게, 최종 검수 R1).
- 1순위·예비 카드에 그 충전소의 "정보 오래됨", "고장·점검 N대"를 같이 보여 준다(최종 검수 R2).
- 구독 제외 휴게소는 이름에 "민자"가 든 휴게소로 잡는다(예시 데이터용 규칙).

## 실제 충전소 데이터 (공공 API)
한국환경공단 '전기자동차 충전소 정보'(공공데이터포털, `B552584/EvCharger/getChargerInfo`)를 쓴다.
폰 앱은 바깥 서버를 부를 수 없어서, PC 에서 받아 `web/live.js` 로 만든 뒤 빌드해 다시 배포한다.

1. 공공데이터포털에서 '한국환경공단_전기자동차 충전소 정보' 활용 신청 → 키 받기
2. 키를 사용자 환경변수 `EV_CHARGER_API_KEY` 로 넣고 터미널을 새로 연다(채팅·파일에 적지 않는다)
3. 저장소 루트에서
```
py tools/charger_api.py       # 경부·영동 지나는 시도 충전기를 받아 휴게소만 골라 web/live.js 생성
node web/build.js             # live.js 를 넣어 dist/ 다시 만들기 → 아티팩트 다시 배포
```
- 휴게소 고르기: 이름에 '휴게소'가 있거나 고속도로 휴게소 코드(C001)이고, 고속도로를 따라가는 선(실제 휴게소 좌표로 그림)에서 2km 안. 이름이 달라도(띄어쓰기·괄호·워터·E-pit) 같은 방향 2km 안이면 한 휴게소로 합친다. 삭제된 충전기는 뺀다.
- 방향: 이름 괄호 안 글자나 "OO방향·OO방면"(부산·서울·강릉·인천, 하행·상행). 방향을 모르면 뺀다(몇 곳 빠졌는지 찍어 준다).
- 거리: 충전소 좌표를 그 선에 투영한 **대략 거리**.
- 상태 시각: 받은 시각. 받은 지 30분이 넘으면 화면이 '정보 오래됨'으로 알린다. 다시 받으려면 1~3번을 다시.
- 가격: API 에 없어서 `TARIFFS` 추정값(환경부 급속 요금) 하나를 쓴다.
- 시험(키 없이): `py -m pytest -q -p no:cacheprovider tools/test_charger_api.py` (18개)

## 고속도로 (2026-11-15: 16개, 32개 방향)
경부·영동·서해안·중부·통영대전·중부내륙·호남·남해·서울양양·중앙·당진영덕·평택제천·광주대구·논산천안·순천완주·동해(부산–포항)·동해(삼척–속초).
- 선: 실제 휴게소 좌표를 잇고 나들목·분기점 대략 위치를 더함(`tools/charger_api.py` 의 `HIGHWAYS`). 거리는 대략.
- 휴게소가 어느 노선인지: ① 주소에 적힌 고속도로 이름 다수결(`HINT_NAMES`) ② 이름으로 정한 것(`MANUAL_HINTS`) ③ 둘 다 없으면 가장 가까운 선 2km 안. 노선을 알면 10km 안이면 그 선에 올린다. 다루지 않는 고속도로는 '다른 고속도로'로 뺀다.
- 폰의 새로 받기(`web/live_build.js`)도 같은 규칙(live.js 의 config). 대조: `py tools/dump_live_fixture.py 원본.json` → `node web/test/compare_live.js`.

## 나들목 인근 충전소 (2026-11-15: 오픈스트리트맵 나들목으로 연결)
도로공사 키가 없어서 나들목 위치는 오픈스트리트맵(© OpenStreetMap contributors, ODbL)의 `highway=motorway_junction` 을 쓴다.
```
py tools/fetch_near_highway.py 저장.json   # 전국 충전기(약 50만 건, 20~30분) → 고속도로 6km 안 휴게소 밖 급속만 저장. 지역별로 이어 받기
py tools/charger_api.py                    # 휴게소
py tools/ic_nearby.py --osm 나들목.json --osm-ways 고속도로길.json --chargers 저장.json
node web/build.js
```
- 나들목.json: Overpass 로 `node["highway"="motorway_junction"](33.0,124.5,38.7,131.0)`, 고속도로길.json: `way["highway"="motorway"]["ref"](같은 범위)` (`out body`). 윈도우 curl 은 overpass-api.de 와 TLS 가 안 맞아 파이썬 urllib 로 받는다.
- 어느 고속도로의 나들목인지는 노드가 놓인 길의 노선 번호(ref: 경부 1, 영동 50 …, `HW_REFS`)로 가린다. 분기점·휴게소 진출입·이름 없는 노드는 뺀다.
- 공동주택(kindDetail H…), 이용 제한(limitYn=Y), 이름에 전용·입주민·전기버스·차고지·택배가 든 곳은 뺀다. 그래도 일반 차가 못 쓰는 곳이 남을 수 있다.
- 화면: 나들목 항목은 접어 두고 필요할 때 펼친다. 장소 이름·업체·요금·왕복 거리.

### (예전 설명) 도로공사 영업소 위치로 붙이기
`tools/ic_nearby.py`: 나들목(영업소) 위치 + 전국 충전기(휴게소 밖 급속)에서 나들목 직선 3km 안 충전소를 '○○ 나들목' 항목으로 붙인다. 왕복은 직선×2×1.3(대략).
- 나들목 위치는 한국도로공사 '영업소 위치정보' API: 고속도로 공공데이터 포털(data.ex.co.kr)에서 키 발급 → 환경변수 `EX_API_KEY`. 실제 응답을 아직 못 봐서 처음 받을 때 `--save-ics 파일` 로 저장해 필드 이름을 확인한다.
```
py tools/charger_api.py        # 휴게소
py tools/ic_nearby.py          # 나들목 인근(전국 충전기를 받아 몇 분 걸림) → web/live.js 에 덧붙임
node web/build.js
```
- 폰의 새로 받기는 휴게소만 다시 받고, 나들목 인근은 PC 에서 만든 것을 옮겨 쓴다('N시간 전 정보'로 보임).
- 시험: `py -m pytest -q -p no:cacheprovider tools/test_ic_nearby.py`

## 지금 위치로 (GPS, 2026-11-15)
화면 위 '◎ 지금 위치로': 폰 위치를 고속도로 선(live.js config 의 `highways`)에 대어 노선과 km 를 맞춘다(`live_build.js` 의 `locate`, `keepSide`).
- 선에서 2km(`max_offset_km`) 안의 고속도로가 후보. 보던 노선이 후보에 있으면 그 방향 그대로(티맵 따라 같은 길을 가며 다시 누르는 경우), 아니면 방향 버튼으로 고른다. 분기점 근처처럼 둘 이상이면 다른 고속도로도 고를 수 있게 보여 준다.
- 고속도로 밖이면 가장 가까운 고속도로까지 거리를 알려 주고 손으로 고르게 한다. Claude 링크 화면은 위치가 막힐 수 있어 폰에 저장한 파일로 연다.
- 시험: `node web/test/test_locate.js` (실제 휴게소 좌표로 노선·km 확인)

## 범위 밖(아직)
- JC 갈래별 미리 보기, 방향 자동 판단, 지도, 휴게소 없는 나들목 충전소, 업체별 실제 요금, 경부·영동 밖 노선.
