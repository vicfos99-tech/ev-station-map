# 시험 다리 (테스트 베드 T2 · 시험 DB T3, 2026-11-25)

앱(web2)이 Workers 다리에 묻는 길을 그대로 흉내 내는 집 PC 의 작은 서버다. 앱은 다리 주소 설정(`config_gateway.json`)만 이 서버로 바꿔 붙인다. 파이썬 기본 모듈만 쓴다. 숫자·길 이름·머리 이름·포트는 모두 `config/testbed.json` 의 `bridge`·`server` 칸(칸 뜻은 `config/README.md`).

## 띄우기 (시험 모드만 — `bridge.run_seconds` 초 뒤 스스로 끝남)
```
set EV_TESTBED_APP_SECRET=<앱 비밀 값, 16자 이상>
py server/bridge.py config/testbed.json
```
- 비밀 값은 환경변수로만 받는다(이름은 `bridge.secret_env`). 없거나 짧으면 시작하지 않는다. 앱의 `config_app_secret.json` 에 같은 값을 넣는다.
- 스스로 시험: `py tools/try_server.py config/testbed.json` — 이번만 쓰는 비밀 값을 만들어 다리를 띄우고, 길마다 불러 표를 찍고, 다리가 스스로 끝나는 것까지 기다린다.

## 길 (설계 5-5 (가) · (다))
| 길 | 하는 일 |
|---|---|
| `GET /v1/data/<파일>` | 중계 꼴 그대로(`ref/relay_format.md`): `meta.json` · `stations/<시군구>.json` · `status/<시군구>.json` · `status/rest/<휴게소 id>.json`. 지금 장면의 충전소와 **지금 틱의** 충전기 상태. 허용 목록 밖 이름은 `bad`, 장면에 없는 시군구는 `none` |
| `POST /v1/place` | 장면 `responses["/v1/place"]`(없으면 `scenes/responses/default.json`)의 지금 mode 답. `{q}` 만 받음 |
| `POST /v1/route` | 같음. 기본 답은 장면의 길을 우리 모양 길 답(`{v, ok, source, at, stored_at, dist_km, pieces}`)으로. `{from, to}` 좌표 범위 검사 |
| `POST /v1/odd` | '이상해' 기록: 아는 칸만·판 번호·메모 길이·제어 문자 검사 → 받음 `{v, ok, name}`(이름은 서버가 시각으로) / 거절 `bad` |
| `GET /v1/health` | `{v, ok, at, src:{data, home}}` — 끊김 사건이 있으면 그 출처 `bad` |
| `GET /v1/test/stream` | 서버 보냄 이벤트. `hello`(장면 상태) → 틱마다 `tick` `{scene, gen, tick, t_s, pos:{t, lat, lng, speed_kmh, heading_deg, accuracy_m}, events, down, startup_fail}` → 장면 끝 `end`. 위치(`loc`) 끊김 사건이면 `pos` 가 `null` |
| `GET /v1/test/scene` | 지금 상태 |
| `POST /v1/test/scene` | `{action}`: `select`(+`name`) · `restart` · `pause` · `resume` · `seek`(+`tick`) · `inject`(+`event` — 장면 시간표 사건 꼴, 지금 틱에 붙음) |

- 실패 답은 설계 꼴 `{v, ok:false, code, src}`. 들어올 때 검사 차례: 허용 출처 → (다리 끊김이면 답 없이 닫음) → 막힌 주소 `busy` → 앱 비밀 값(없음·틀림 `lock`, src `gate` — 상수 시간 비교) → 아는 길 → 방식 → 물음 크기 → 출처 끊김.
- 사건이 길에 주는 영향: `source_down data` → `/v1/data` 가 `upstream`(src data) · `home` → place·route·odd 가 `home_off`(src home) · `gate` → 시험 길 말고 모두 답 없이 연결 닫음 · `loc` → 흐름의 `pos` 가 `null`. `startup_fail stations` → 자료 파일 넷이 `upstream` · `app_secret` → 모든 길 `lock`. `restart` 로 지워진다.
- 기록장(`logs/testbed.log`): 물음마다 시작·끝(길·HTTP 코드·실패 코드·까닭·ms·바이트). 비밀 값·물음 본문(위치·목적지)은 싣지 않는다.

## 시험 DB 에 쌓기 (T3 — `server/recorder.py`, 표 정의 `db/schema.sql`)
- 표 모양은 설계 5-5 (2-나) 마스터-디테일(묘성 결정 F5): 마스터 `board_master`(판 종류·출처·갱신 간격 …) + 판마다 디테일 표 `board_<종류>`(공통 칸 `key·at·good_until·src` + 그 판의 칸). 시험 베드에만 `run`(실행 번호)·`tick` 칸이 더 있다.
- 지금 판 다섯: `flow`(틱마다 위치·속도) · `event`(장면 사건·넣은 사건·조종) · `charger`(실행 시작 때 모든 충전기 + 상태가 바뀔 때마다 — `/v1/data` 가 그 틱부터 내는 값) · `speed`(장면 limits) · `odd`(`/v1/odd` 로 온 것, 받음·거절 둘 다).
- 실행 번호: 다리 시작·`select`·`restart` 한 번마다 새 번호(`tb_run`). 같은 장면을 다시 돌려도 앞 실행 줄은 그대로다.
- 쓰기는 따로 도는 줄기 하나가 `db.flush_s` 마다 `db.batch_max` 줄씩 한 트랜잭션으로. 실패하면 한 줄씩 다시 써서 틀린 줄만 잃고 기록장에 까닭을 남긴다. 다리는 계속 돈다. DB 를 못 열면 쌓지 않고 돈다(시작 줄에 '못 엶').
- 틱 박자는 '시작 + n × 간격'에 맞춘다 — 늦음이 쌓이지 않게(흐름 틱 수 = 돈 초).
- 꺼내 보기: `py tools/db_peek.py config/testbed.json master | counts | runs | timeline <장면 이름 또는 실행 번호>`
- 스스로 시험: `py tools/try_db.py config/testbed.json` (약 6분 — S5 를 실제 시간으로 돌림)
- 다리 둘째 인자로 돈 초를 줄 수 있다: `py server/bridge.py config/testbed.json 340`(없으면 `bridge.run_seconds`).

## 아직 안 하는 것 (T4 와 그 뒤)
- `routes.json`·고속도로 선 파일(R0 꼴이 아직 없음) — 켤 때 실패 `lines` 는 지금 막을 파일이 없다.
- 이어 달리기(`compose`, S12) 재생, `bad_payload`(S11) 사건의 나쁜 자료 만들기 — T4.
- 시험 DB 의 보관 날 수(`keep_days`)로 지우기 — 아직 지우지 않는다.
