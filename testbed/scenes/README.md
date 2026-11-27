# 장면 파일 꼴 (테스트 베드 T1, 2026-11-25)

장면 파일 하나 = 시험 다리(T2)가 1초(설정 `tick_interval_s`)마다 무엇을 쏠지 정한 각본 하나다.
꼴은 `scene.schema.json`(기계가 읽는 꼴)에 있고, 이 글은 칸의 뜻을 적는다. 모든 숫자(시속·km·초·정확도)는 장면 파일과 설정에만 있다 — 코드에 두지 않는다.

- 파일 이름: `S<번호>_<이름>.json`(무늬는 설정 `scenes.glob`). 안의 `name` 은 파일 이름(확장자 뺌)과 같아야 한다.
- 검사: `py tools/check_scenes.py config/testbed.json` — 틀리면 어느 파일 어디가 틀렸는지 찍고 0 아닌 코드로 끝난다.

## 맨 위 칸

| 칸 | 꼭 | 뜻 |
|---|---|---|
| `schema_version` | 꼭 | 꼴 판 번호(지금 1) |
| `name` · `title` · `description` | 꼭 | 이름(=파일 이름), 짧은 제목, 무엇을 시험하는지까지 쓴 설명 |
| `data_source` | 꼭 | `real`(실제 자료인가) · `from`(어디서) · `taken_at`(언제 받은 자료) · `note`(무엇이 실제이고 무엇이 지어낸 값인지). **손으로 만든 길이면 `real: false`** — 검사기가 손으로 만든 길 조각(`handmade: true`)과 `real: true` 가 함께 있으면 틀림으로 본다 |
| `route.legs` | 꼭 | 길 조각 목록(아래). 차례대로 달린다. `compose` 장면만 비울 수 있다 |
| `speeds` | 꼭 | 속도 표 — 조각마다 km 구간과 시속. 조각 하나를 **빈틈·겹침 없이** 다 덮어야 한다(검사함). 시속 0 이상, 설정 `geo.speed_max_kmh` 이하. 시속 0 으로는 쓰지 않고 멈춤은 `stops` 에 |
| `stops` | | 멈춤 — `leg`·`at_km`·`duration_s`(S6 휴게소 정차 등) |
| `emit` | 꼭 | 틱마다 쏠 것: `fields`(`t`·`lat`·`lng`·`speed_kmh`·`heading_deg`·`accuracy_m` 가운데), `accuracy_m`(정확도), `heading`(`from_path` 길 방향으로 셈 / `none`), `speed`(`device` 기기가 준 속도처럼 / `none` 앱이 셈하게) |
| `limits` | 꼭(비워도 됨) | 제한 속도 구간 — `leg`·`from_km`·`to_km`·`limit_kmh`. `limit_kmh: null` = 자료 없음(S4 일반 도로). 겹치면 안 됨, 빈틈은 '자료 없음'과 같다 |
| `stations` | 꼭(비워도 됨) | 앞쪽 충전소 자리 목록(아래) |
| `timeline` | 꼭(비워도 됨) | 시간표 사건(아래). **시각 순서**여야 하고, 주행 시간 안이어야 한다(검사함) |
| `responses` | | 묻는 길(예: `/v1/place`)마다 정해 둔 답 목록 — `mode`(이름)·`status`(HTTP 코드)·`delay_ms`(늦게 줄 때)·`body` 또는 `body_file`(장면 폴더 기준)·`build`(`scene_route` 장면 길을 길 답으로 / `odd_check` '이상해' 검사)·`match`(물음 글 무늬). 처음 것의 mode 가 기본. 없으면 `responses/default.json`. S9·S10 용 |
| `compose` | | 이어 달리기 — `scenes`(장면 이름 목록)·`repeat_until_s`(모두 몇 초까지 되풀이 — 그 초에서 자름). S12 용. 이어 달리기 장면을 또 넣을 수 없다(검사). 이 장면의 `emit` 을 쓰고, 길·충전소·사건은 넣은 장면들 것 |

## 길 조각 (`route.legs[]`) — 둘 가운데 하나

| 종류 | 칸 | 뜻 |
|---|---|---|
| 실제 선의 구간 | `kind: "line"` · `line` · `from_km` · `to_km` | `lines/<line>.json` 선 위 km 구간. `from_km > to_km` 이면 **거꾸로**(상행) 달린다(S3). km 는 그 선의 첫 점에서 잰 거리 |
| 좌표 목록 | `kind: "points"` · `handmade` · `note` · `points` · `road` | 좌표를 이은 길(일반 도로·나들목 등 — S4). `handmade: true` 면 손으로 찍은 것이고, `note` 에 그렇다고 적는다. km 는 이 조각 첫 점에서 0 부터 |

- `speeds`·`limits`·`stops` 의 `leg` 는 조각 차례 번호(0 부터), km 는 그 조각의 km(선 조각이면 선의 km)이다. 거꾸로 달리는 조각도 구간은 작은 km 를 `from_km` 에 쓴다.
- 선 파일 꼴은 `lines/line.schema.json`: `name`·`highway`·`direction`·`real`·`from`·`taken_at`·`note`·`points`[[위도, 경도]…].

## 충전소 자리 (`stations[]`)

| 칸 | 뜻 |
|---|---|
| `id` · `name` · `kind` | 자리 id(장면 안에서 하나), 이름, 종류 `rest` 휴게소 / `ic` 나들목 / `around` 주변(고속도로 밖 — S4) |
| `direction` | 휴게소 방향(예: `부산 방향`) |
| `line` · `km` | 어느 선의 몇 km 에 있나. 고속도로 밖이면 둘 다 `null` |
| `loc` | [위도, 경도] |
| `operators[]` | 그 자리의 충전소들: `station_id`(중계 자료의 충전소 id) · `operator` · `maker` · `loc` · `chargers[]`(`id`·`type` fast/slow·`kw`·`status` 처음 상태). T2 부터 `name`·`zscode`·`zcodes`·`rest`·`indoor`(중계 사본에서 `tools/match_ids.py` 가 채움 — 시험 다리가 `stations/<zscode>.json` 꼴로 내줄 때 씀) |

- 충전기 상태 낱말(`available`·`charging`·`out_of_service`·`maintenance`·`comm_error`·`unknown`)은 설정 `status_codes` 의 이름이다. 설정은 낱말 → 중계 stat 코드(`ref/relay_format.md`: 1 통신 이상 · 2 대기 · 3 충전 중 · 4 운영 중지 · 5 점검 중 · 9 미확인)를 갖는다. 낱말이 설정에 없으면 검사기가 틀림으로 본다.

## 시간표 사건 (`timeline[]`) — `t_s` 는 장면 시작에서 잰 초

| `type` | 더 있는 칸 | 쓰는 장면 |
|---|---|---|
| `charger_status` | `station_id` · `charger_id` · `status` — 둘 다 `stations` 목록에 있어야 함(검사) | S5 |
| `source_down` · `source_up` | `source`(설정 `sources`: `data` 자료 길 · `home` 집 PC · `gate` 다리 · `loc` 위치 · `tiles` 지도 그림) · `reason` | S7 |
| `startup_fail` | `target`(설정 `startup_fail_targets`: `stations` · `lines` · `app_secret` · `gateway_url`). `t_s` 는 0 만 | S8 |
| `gps_jump` | `offset_m` · `bearing_deg` · `ticks`(몇 틱 동안 튄 자리를 쏘나) | S6 |
| `bad_payload` | `target`(설정 `bad_payload.targets`: `stream` 흐름 · `data` · `place` · `route`) · `bad`(`broken_json` · `out_of_range` · `negative_speed` · `oversize` — 대상마다 낼 수 있는 것은 설정에, 검사함) · `ticks`(몇 틱 동안, T4 에서 더함) | S11 |
| `response_mode` | `path` · `mode` — 그 길의 답을 `responses` 의 그 `mode` 로 바꿈(있어야 함 — 검사) | S9·S10 |

## 계획의 장면 12개를 이 꼴로 담는 법

| 장면 | 쓰는 칸 |
|---|---|
| S1 고속도로 평범 주행 | 선 조각 하나 · `speeds` · `stations` |
| S2 제한속도 넘기 | S1 + `limits`(100 · 80 구간) |
| S3 상행·하행 | 선 조각 둘(하행 `from<to`, 상행 `from>to` — 상행 선 파일을 따로 두어도 됨) |
| S4 나들목 나가 일반 도로 | 선 조각 + 좌표 조각 · `limits` 에 `null` · `stations` 에 `around` |
| S5 충전기 상태 바뀜 | `timeline` 의 `charger_status` |
| S6 정차·출발·후진 | `stops` · `gps_jump`(후진은 짧은 거꾸로 선 조각) |
| S7 실행 중 출처 끊김 | `source_down` · `source_up` |
| S8 켤 때 실패 | `startup_fail`(t_s 0) |
| S9 주소 검색과 경로 | `responses` · `response_mode` |
| S10 '이상해'와 기록 올리기 | `responses`(`/v1/odd` 받음·거절) |
| S11 나쁜 자료 | `bad_payload` |
| S12 긴 주행 | `compose` |

## 지금 있는 장면 (T1)

| 장면 | 길 | 실제 자료 |
|---|---|---|
| `S1_고속도로.json` | 경부선 부산 방향 선 km 28→82(54 km), 시속 90~100, 기흥·안성·망향(+ 천안호두·옥산) | 예 — 선·휴게소·충전소·처음 상태. 제한 속도·속도 표는 시험용 |
| `S2_제한속도.json` | S1 길, km 40~48 시속 115(제한 100), km 64~70 제한 80 | 길·충전소는 예, 제한 속도는 시험용 |
| `S5_충전기상태.json` | 경부선 선 km 50→62(12 km), 안성휴게소 ME18B303 1번: 빈자리 → 60초 사용 중 → 180초 고장 → 300초 빈자리 | 길·충전소는 예, 시간표는 시험용 |

- (T2) 충전기 id 는 중계 실제 자료 사본(`90_임시/중계자료_사본_2026-11-25`)에 맞췄다 — `py tools/match_ids.py config/testbed.json <사본 폴더> --write`. 13곳 모두 찾았고, 차례·출력이 같아 id 만 바꾼 곳은 ME18B303(02·03→11·12)·SGMAC044(01·02→03·04)·ME22A354(01·02→31·32).
- 실제 자료가 어디서 왔나: 선은 `lines/gyeongbu_down.json`(옛 앱 `web/live.js` 의 경부선 꼭짓점 — 실제 API 휴게소 좌표를 이은 선, 점 사이는 곧은 선). 휴게소·충전소는 같은 `live.js` 의 `live-gb-down` 목록(2026-11-16 09:40 스냅숏). `live.js` 에 충전기 id 가 없어 T1 은 `01`·`02`… 를 목록 차례로 붙였다(T2 에서 위처럼 실제 id 로 바꿈).
- 뽑은 법(다시 할 때): `web/live.js` 의 `var d = ` 뒤 JSON 을 읽어 `config.highways.gb.points` 와 `routes[key=live-gb-down].rest_areas` 에서 나들목(`kind: ic`)을 빼고 km 28~115 인 휴게소를 옮겼다.

## T4 에서 더한 장면

| 장면 | 길 · 길이 · 틱 | 실제 자료 | 핵심 |
|---|---|---|---|
| `S3_상행하행.json` | 경부선 km 124→138 하행, 같은 선 거꾸로 138→124 상행 · 28 km · 1,011틱 | 예(km 138 에서 바로 되도는 것만 줄임) | 죽암휴게소 부산 방향(선 km 129.3)·서울 방향(128.2), 반대 방향 신탄진휴게소(서울, 136.1), 앞쪽 옥천(부산)·청주(서울) |
| `S4_나들목일반도로.json` | 경부선 km 55→60.6 + 손으로 찍은 일반 도로 9.6 km(안성 나들목 → 공도 → 안성 시내) · 15.2 km · 814틱 | 아니오(일반 도로 좌표가 손으로 찍은 것) | 일반 도로 제한 40·60·**자료 없음(null)**, 고속도로 밖 실제 충전소 6곳(`around`) |
| `S6_정차출발튐.json` | 경부선 km 55→58.8(정차 180초) → 20 m 후진(시속 5) → 58.78→62 · 7 km · 529틱 | 예 | 정차·출발·후진, 위치 튐 400 m·60 m(정차 중)·1.5 km |
| `S7_출처끊김.json` | 경부선 km 40→52 · 12 km · 456틱 | 예 | 집 PC 끊김 60~120초, 자료 길 끊김 180~240초, 둘 다 300~390초 |
| `S8_켤때실패_목록.json` · `_비밀값.json` · `_다리주소.json` | 경부선 km 28→31 · 3 km · 122틱 | 예 | 켤 때 실패 세 갈래(장면 셋): 목록 502 / 비밀 값 401 / 다리 주소 답 없이 닫힘 |
| `S9_주소검색경로.json` | 경부선 km 40→52 · 456틱 | 예(검색 답의 휴게소 이름·자리도 실제) | 검색·경로 답: 정해 둔 답 → 120초 느린 답(3초) → 240초 실패(502·504) → 360초 다시 |
| `S10_이상해기록.json` | 경부선 km 40→52 · 456틱 | 예 | '이상해' 받음(꼴 검사) → 150초 꽉 참(429) → 240초 받음 → 330초 모두 거절 → 400초 받음 |
| `S11_나쁜자료.json` | 경부선 km 40→52 · 456틱 | 예(나쁜 자료는 지어낸 것) | 흐름 범위 밖·음수 속도·깨진 JSON·너무 큰 답, 자료 길·검색·경로의 나쁜 답 |
| `S12_긴주행.json` | 이어 달리기 S5 → S3 → S4 → S2 → S1, 3600초에서 자름 · 3,601틱 | 아니오(S4 를 이어서) | 1시간 이어짐. 한 시간 안에 S2 앞 1,320초까지(S1 은 닿지 않음) |

- 충전소는 모두 중계 실제 자료 사본(`90_임시/중계자료_사본_2026-11-25` 의 `routes.json` · `stations/<시군구>.json` · `status/<시군구>.json`)에서 `tools/pick_stations.py` 로 뽑았다:
  `py tools/pick_stations.py config/testbed.json <사본 폴더> <장면 이름> gyeongbu_down rest:<노선 key>:<휴게소 id>… around:<충전소 id>… --write`
  휴게소는 이름·자리·방향·처음 상태를 `routes.json` 에서, 충전기 id 는 `stations/` 에서(차례·종류·출력이 다 같을 때만), 선 위 km 는 휴게소 자리를 선에 내려 셈(상행 휴게소도 같은 하행 선의 km). 주변 충전소의 처음 상태는 `status/` 의 stat 코드를 낱말로.
- 시험(배속): `py tools/try_t4.py config/testbed.json [장면 이름 …]`.

## 4-2 에서 더한 것 — 실제 도로 모양 선과 실자료 장면 (2026-11-26)

옛 선(`lines/gyeongbu_down.json`)은 휴게소 좌표를 곧게 이은 선이라 실제 도로와 최대 3.3 km 어긋난다(동탄 근처). 옛 선·옛 장면은 **그대로 두고**(A1~A8 시험 기대 값이 안 흔들리게) 새 선과 새 장면을 더했다.

| 파일 | 무엇 | 실제 자료 |
|---|---|---|
| `lines/gyeongbu_down_osm.json` | 경부고속도로 부산 방향 차로의 실제 도로 모양 — 오픈스트리트맵(© OpenStreetMap contributors, ODbL). 점 1,347 · 168.3 km(옛 선 km 0~160 을 덮음). 한쪽 길(oneway)만 이어 상행 차로는 없다 | 예 |
| `S13_고속도로_실선.json` | S1 실자료판 — 같은 휴게소·충전소, 길만 새 선 위(새 km 28.22→84.44, 56.2 km, 2,126틱). 동탄(고칠 것 일곱 ⑥ 자리)을 지난다 | 예 |

- 설정: `config/realline.json`(받을 서버·질의 필터·범위·원본 자리·시험 값). 원본 자리는 work.env 의 작업 폴더 아래 `30_자료/도로선/` — 중계 R0 도 이 원본을 다시 쓴다(같은 자료 한 곳).
- 다시 만들기(차례대로):
  1. `py tools/osm_fetch.py config/realline.json gyeongbu_down_osm` — Overpass 공개 서버에서 받아 원본·질의문·받은 때·저작권을 원본 자리에(가입·키 없음. 서버가 바쁘면 502·504 — 잠시 뒤 다시)
  2. `py tools/osm_line.py config/realline.json gyeongbu_down_osm --write` — 가장 새 원본을 이어 선 파일로 + 옛 직선과 견주기 표(`logs/realline_compare.md`)
  3. `py tools/real_scene.py config/realline.json --write` — 설정 `scenes.make` 의 장면을 새 선 위로 옮겨 만들고 장면 검사기로 봄(틀리면 되돌림)
  4. `py tools/try_realline.py config/realline.json` — 단위 시험 6개
- 새 장면 km: 선 조각·속도·제한 구간 km 는 '옛 직선의 그 km 자리를 새 선에 내린 km', 휴게소 km 는 휴게소 좌표를 새 선에 내린 km(예: 안성 부산 방향 58.7 → 60.72, 옥산 109.6 → 114.27).
- 제한 속도 실제 출처(2026-11-27): `config/limit_source.json`(출처 이름 `source` + 출처별 읽는 법 `sources.<출처>` — 원본 자리·꼬리표 이름·단위 바꾸기). `py tools/limit_table.py config/limit_source.json gyeongbu_down_osm --write` 가 원본(가장 새 것)에서 선의 km 구간별 제한 속도 표 `limits/gyeongbu_down_osm.limits.json` 을 만든다(원본·받은 때·저작권 함께, 값 없는 구간은 null). 시험 `py tools/try_limit_table.py config/limit_source.json`. 시험·보기 도구는 `use_scenes` 장면(지금 S13)만 이 표로 내주고 다른 장면은 손으로 쓴 `limits` 그대로.
- 앱에 보이기: 앱은 R0 전이라 선을 `lines/gyeongbu_down.json` 이름으로만 묻는다. 보기 도구가 S13 을 고르면 새 선을 그 자리로 낸다(안의 name 은 `gyeongbu_down` — `web2/tools/lib_realline.mjs`, 값은 `web2/tools/config_try_realline.json`).
  `node web2/tools/view_s1.mjs 600 S13_고속도로_실선` (동탄 앞 약 1.7 km 부터: 틱 `420` 을 끝에 더함 — 동탄 옆 새 km 41.0 은 약 485틱)

## 옛 장면의 실선판 S14~S18 (2026-11-27)

옛 장면 S2~S11 가운데 **선 모양에 따라 결과(앞쪽·주변 판정, 남은 거리, 제한 속도 맞추기, 경로 기준 앞의 충전소)가 바뀌는 것만** 새 선 판을 더했다. 옛 장면은 그대로(옛 시험 기대 값 그대로). 만든 길은 4-2 와 같다(`py tools/real_scene.py config/realline.json --write` — 설정 `scenes.make`).

| 옛 장면 | 옮김 | 까닭 |
|---|---|---|
| S2 제한속도 | 예 → S14 | 제한 구간·넘는 구간을 선 km 로 맞춤, 앞쪽 휴게소·남은 거리 |
| S3 상행하행 | 예 → S15 | 방향별 앞쪽 휴게소가 선 km 차례로 갈림 |
| S4 나들목일반도로 | 예 → S16 | 고속도로를 벗어났나(선에서 떨어짐)로 앞쪽 → 주변 바뀜 |
| S5 충전기상태 | 아니오 | 보는 것은 충전기 상태 칸(시각으로 바뀜) — 선 모양과 상관없음 |
| S6 정차출발튐 | 예 → S17 | 휴게소 정차·후진 때 앞쪽 휴게소·남은 거리 |
| S7 출처끊김 | 아니오 | 끊김 띠·들고 있는 자료로 계속 — 시각 사건 |
| S8 켤때실패(셋) | 아니오 | 페이지가 안 뜸 — 위치를 안 씀 |
| S9 주소검색경로 | 예 → S18 | 경로 답(`build: scene_route`)이 장면 길 모양 그대로 — 그린 경로·경로 기준 앞의 충전소 |
| S10 이상해기록 | 아니오 | 받음·거절 답 시간표 |
| S11 나쁜자료 | 아니오 | 나쁜 자료 걸러냄 — 범위 밖 좌표도 지어낸 값 |

| 장면 | 길 · 길이 · 틱 | 실제 자료 | 옛 장면과 다른 것 |
|---|---|---|---|
| `S14_제한속도_실선.json` | 새 km 28.22→84.44 · 56.2 km · 2,093틱 | 예 | 넘음 40.52~49.96(옛 40~48), 제한 80 66.23~72.13(옛 64~70), 안성 60.72 |
| `S15_상행하행_실선.json` | 새 km 130.1→144.4 → 거꾸로 130.1 · 28.6 km · 1,030틱 | 예 | 죽암(부산) 135.24 · 죽암(서울) 134.21 · 신탄진(서울) 142.56 · 청주(서울) 106.69 · 옥천 167.27 |
| `S16_나들목일반도로_실선.json` | 새 km 56.76→62.55 + 이음 1.17 km + 손 일반 도로 9.6 km · 16.5 km · 924틱 | 아니오(손 조각) | 일반 도로 조각 km 가 이음만큼 밀림: 제한 40 0~1.97, 60 1.97~6.17, 자료 없음 6.17~끝 |
| `S17_정차출발튐_실선.json` | 새 km 56.76→60.75(정차 180초) → 60.73 후진 → 64.28 · 7.6 km · 549틱 | 예 | 정차·후진 자리를 안성 새 km 60.75 에 붙임(`pin_stations`) |
| `S18_주소검색경로_실선.json` | 새 km 40.52→53.92 · 13.4 km · 508틱 | 예 | 경로 답이 새 선 모양. 검색 답의 휴게소 자리는 그대로 |

- **상행(S15)**: 새 선은 부산 방향 차로만이라, 옛 S3 처럼 **같은 선을 거꾸로** 달린다(실제 서울 방향 차로에서 수십 m 옆). 서울 방향 휴게소 km 는 휴게소 좌표를 이 선에 내린 km.
- **이음 길(S16, 설정 `join_points`)**: 손으로 찍은 일반 도로의 처음 점은 옛 직선 km 60.6 의 점이라 새 선 끝에서 1,170 m 떨어져 있다. 그대로 두면 흐름이 1.17 km 순간 이동하므로 새 선 끝 점 하나를 조각 맨 앞에 더해 곧게 이었다(원래 점은 그대로, 이음도 손으로 만든 것 — real false 그대로).
- **휴게소 정차(S17, 설정 `pin_stations` · `pin_window_km`)**: 옛 직선 km 58.8 자리를 내리면 새 km 60.89 로 안성휴게소(60.75)를 140 m 지나 멈춘다. 휴게소 옛 km 둘레 0.5 km 안의 km 는 '휴게소 새 km + 옛 차이'로 옮겼다.
- 옛 장면과 시각이 달라지는 곳(새 선이 길어서): S16 자료 없는 길은 약 648초부터(S4 는 536초), S17 정차는 약 192~372초(S6 185~365초), S15 되도는 때 약 515초. 앱 시험 설정의 틱(`web2/tools/config_tools.json` 의 S4·S6 값)을 실선판에 쓰려면 이 차이를 맞춰야 한다.
- 앱 보기: `lib_realline.mjs` 는 장면의 선 조각 `line` 으로 새 선을 고르므로(장면 목록 아님) 새 장면도 따로 더할 것 없이 새 선이 나간다.
- 시험: `py tools/try_realline.py config/realline.json` — ⑦~⑪ 이 `scenes.make` 의 모든 실자료 장면을 본다(검사기 · 흐름이 선 위 · 순간 이동 없음 · 휴게소 km·정차 자리 · 옛 장면과 같아야 할 칸).
