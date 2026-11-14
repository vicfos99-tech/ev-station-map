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

## 범위 밖(아직)
- 실제 충전소 데이터(공공 API 키 필요), 실제 위치(GPS), 지도, 휴게소 없는 나들목 충전소, 충전기 출력(kW) 반영.
