# 테스트 베드 설정 (`testbed.json`)

- 설정 파일 경로는 명령 줄로 넘긴다: `py tools/check4.py config/testbed.json`. 코드에는 경로가 없다.
- 설정 안의 경로는 모두 **이 설정 파일이 있는 폴더(`config/`) 기준 상대 경로**다.
- 읽을 때 `testbed.schema.json`(설정 꼴)로 검사한다. 칸이 빠지거나 꼴이 틀리면 프로그램이 시작하지 않고 까닭을 찍는다(이때는 기록장 자리를 모르므로 화면에만).

| 칸 | 지금 값 | 뜻 | 누가 쓰나 |
|---|---|---|---|
| `version` | 1 | 설정 꼴 판 | 모두 |
| `config_schema` | `testbed.schema.json` | 설정 꼴 파일 | tbconfig |
| `kst_offset_hours` | 9 | 한국 시각 = UTC + 이 값(PC 지역 시각을 쓰지 않음) | 기록장 |
| `tick_interval_s` | 1.0 | 틱 간격(초) — 시험 다리가 쏘는 간격, 장면 검사기의 틱 수 셈 | T2 · 검사기 |
| `time_scale` | 1 | **시간 배속**(T4). 틱 하나가 실제로는 `tick_interval_s ÷ 이 값` 초. 평소 1 — 시험 때만 다리 셋째 인자(또는 `try_t4.scale`)로 키운다 | 다리 |
| `server.host` · `server.port` | 127.0.0.1 · 8787 | 시험 다리가 들을 주소·포트 | T2 |
| `active_scene` | `S1_고속도로` | 켤 때 쓸 장면(장면 파일이 있어야 함 — 검사) | T2 · 검사기 |
| `scenes.dir` | `../scenes` | 장면 폴더 | 검사기 · T2 |
| `scenes.glob` | `S[0-9]*.json` | 장면 파일 무늬(윈도우는 대소문자를 안 가려 `S*.json` 이면 `scene.schema.json` 도 걸린다) | 검사기 |
| `scenes.schema_file` | `../scenes/scene.schema.json` | 장면 꼴 | 검사기 |
| `scenes.lines_dir` · `line_suffix` · `line_schema_file` | `../scenes/lines` · `.json` · `../scenes/lines/line.schema.json` | 선 파일 자리·확장자·꼴 | 검사기 · T2 |
| `log.dir` · `log.file` | `../logs` · `testbed.log` | 기록장 한 파일(시각 순서로 덧붙임, git 제외) | 모두 |
| `log.time_format` | `%Y-%m-%d %H:%M:%S` | 기록장 시각 꼴 | 기록장 |
| `log.max_value_chars` | 200 | 값이 이보다 길면 앞부분만 | 기록장 |
| `log.secret_words` | secret·key·token·password·lock | 이름에 이 낱말이 든 값은 '(가림)'으로 | 기록장 |
| `db.path` | `../data/testbed.db` | 시험 DB 자리(git 제외 — `data/`) | T3 |
| `db.schema_file` | `../db/schema.sql` | 표 정의 한 파일(마스터 `board_master` + 판마다 디테일 표 + `tb_run`·`board_log`). 판을 더할 때 마스터 한 줄 + 디테일 표 하나 | T3 |
| `db.master_table` · `run_table` · `log_table` | board_master · tb_run · board_log | 표 이름(코드는 이 값과 마스터 `detail_table` 만 씀) | T3 |
| `db.common_columns` | run·tick·key·at·good_until·src | 디테일 표마다 꼭 있어야 하는 칸(check4 ① 이 봄) | T3 |
| `db.kinds` | flow·event·charger·speed·odd | 다리가 쏘는 자리(역할) → 마스터 판 종류 이름 | T3 |
| `db.src_of_kind` | flow=loc · event=gate · charger·speed=data · odd=home | 디테일 줄의 `src`(어디서 받았나 — 다리의 출처 이름) | T3 |
| `db.time_format` | `%Y-%m-%dT%H:%M:%S.%fZ` | DB 시각 꼴(UTC). 보여 줄 때만 `kst_offset_hours` 더함 | T3 |
| `db.journal_mode` · `busy_timeout_s` | WAL · 5 | 쓰는 중에 꺼내 보기가 읽을 수 있게 · 잠김 기다림 | T3 |
| `db.queue_max` | 20000 | 쓰기 줄 세우기 크기 한도 — 차면 그 줄은 버리고 기록장에 | T3 |
| `db.batch_max` · `flush_s` | 500 · 0.5 | 한 트랜잭션에 쓰는 줄 수 · 쓰는 간격(초) | T3 |
| `db.close_wait_s` | 10 | 다리가 끝날 때 남은 줄을 다 쓰기까지 기다리는 초 | T3 |
| `db.text_max_chars` | 2000 | JSON·메모 칸 글 길이 한도 | T3 |
| `db.try.*` | S5 · 340초 · 마지막 바뀜 + 5틱 · 둘째 실행 6초 · ±1 틱 · '이상해' 받을 것/거절될 것 · 틀린 원인 값 · 임시 DB 이름 | 시험 DB 스스로 시험(`tools/try_db.py`) | T3 |
| `status_codes` | 낱말 → 중계 stat 코드 | 장면의 충전기 상태 낱말과 중계 자료 코드(`ref/relay_format.md`). 장면 낱말은 여기 있어야 한다 | 검사기 · T2 |
| `sources` | data·home·gate·loc·tiles | 끊김 사건의 출처 이름(설계 `health.src` 의 출처) | 검사기 · T2 |
| `startup_fail_targets` | stations·lines·app_secret·gateway_url | 켤 때 실패 사건의 대상 | 검사기 · T2 |
| `bad_payload.targets` | stream·data·place·route → 낼 수 있는 나쁜 자료 종류 | S11 나쁜 자료 사건의 대상(다리 길 이름)과 종류(음수 속도는 흐름만). 장면 검사기가 봄 | 검사기 · 다리 (T4) |
| `bad_payload.coord_keys` · `out_of_range_latlng` | loc·line · [99.0, 999.0] | 범위 밖 좌표로 바꿀 칸 이름(흐름은 `pos.lat·lng`) · 넣을 좌표 | 다리 (T4) |
| `bad_payload.negative_speed_kmh` · `broken_keep_ratio` | -30 · 0.5 | 음수 속도 값 · 깨진 JSON 은 답 바이트의 이 몫만 보냄 | 다리 (T4) |
| `bad_payload.oversize_bytes` · `filler_key` · `filler_char` | 2097152(2 MB) · pad · x | 너무 큰 답: 이 칸에 이 글자를 이 수만큼 채움 | 다리 (T4) |
| `geo.earth_radius_km` | 6371.0088 | 거리 셈의 지구 반지름 | 검사기 · T2 |
| `geo.lat_min`~`lng_max` | 33.0~38.7 · 124.5~132.0 | 좌표가 이 범위 밖이면 틀림(한국 둘레) | 검사기 |
| `geo.speed_max_kmh` | 200 | 장면 시속 상한 | 검사기 |
| `geo.accuracy_max_m` | 5000 | 장면 정확도 상한 | 검사기 |
| `units.seconds_per_hour` | 3600 | 시속 → 초 셈 | 검사기 |
| `units.report_decimals` | 1 | 찍는 수의 소수 자리 | 검사기 · check4 |
| `units.ms_per_second` · `m_per_km` | 1000 · 1000 | 밀리초·미터 셈 | T2 |
| `units.json_indent` · `coord_decimals` | 2 · 6 | 장면 파일 다시 쓸 때 들여쓰기(match_ids) · 다리가 내는 좌표 소수 자리 | T2 |
| `bridge.script` · `run_seconds` | `../server/bridge.py` · 75 | 시험 다리 파일 · **시험 모드 — 이 초 뒤 스스로 끝남**(앱과 오래 붙여 볼 때는 늘림) | 다리 · try_server |
| `bridge.secret_header` · `secret_env` · `secret_min_chars` | X-EV-App-Secret · EV_TESTBED_APP_SECRET · 16 | 앱 비밀 값 머리 이름 · **값을 읽을 환경변수 이름**(값은 설정에 없다) · 값 최소 길이(짧으면 다리가 시작하지 않음) | 다리 |
| `bridge.lock_max_wrong` · `lock_block_s` | 5 · 30 | 같은 주소가 비밀 값을 이만큼 틀리면 이 초 동안 `busy` | 다리 |
| `bridge.allowed_origins` · `cors_max_age_s` | 127.0.0.1:5173 · localhost:5173 · 600 | 브라우저 받기를 허락할 출처(앱 개발 서버) · 사전 물음 담아 둘 초 | 다리 |
| `bridge.max_body_bytes` · `data_file_max_chars` · `place_q_max_chars` | 16384 · 64 · 100 | 물음 크기 · 자료 파일 이름 길이 · 찾을 글 길이 한도 | 다리 |
| `bridge.paths` · `methods` | 설계 5-5 (가)의 다섯 길 + `/v1/test/stream` · `/v1/test/scene` | 길 이름과 방식(조종 길은 GET 도 받음 = 지금 상태) | 다리 · try_server |
| `bridge.no_secret_paths` | stream · scene | 비밀 값 없이 받는 시험 길(브라우저 EventSource 는 머리를 못 붙임) | 다리 |
| `bridge.source_of_path` · `gate_source` · `loc_source` | data→data · place·route·odd→home · gate · loc | 길마다 기대는 출처(끊김 사건이 그 길을 실패시킴) · 다리 자체 · 위치 | 다리 |
| `bridge.data_files` | meta · stations/<5자리> · status/<5자리> · status/rest/<id> | `/v1/data/` 뒤 파일 이름 허용 목록(정규식 전체 맞음) | 다리 |
| `bridge.startup_fail_files` · `startup_fail_lock` | stations → 네 파일 · lines → 없음 · app_secret | 켤 때 실패 사건이 막는 파일 · 모든 길을 `lock` 으로 만드는 대상 | 다리 |
| `bridge.startup_fail_close` | gateway_url | 이 켤 때 실패 대상이면 앱 길에 답 없이 연결을 닫음(다리 주소 설정 틀림 = 엉뚱한 곳에 묻는 것과 같게, S8) | 다리 (T4) |
| `bridge.stream_target` · `time_scale_max` | stream · 1000 | 흐름의 나쁜 자료 대상 이름 · 배속 상한(넘으면 다리가 시작하지 않음) | 다리 (T4) |
| `bridge.fail_http` · `codes` · `down_code` | lock 401 · busy 429 · bad 400 · none 404 · upstream 502 · home_off 504 · gate 500 | 실패 코드 → HTTP 코드, 실패 낱말, 출처가 끊겼을 때의 코드(data→upstream, home→home_off) | 다리 |
| `bridge.health_words` · `relay_time_format` | good·bad · %Y%m%d%H%M%S | health 의 출처 값 · 중계 꼴 시각(UTC+kst_offset_hours) | 다리 |
| `bridge.default_responses_file` | `../scenes/responses/default.json` | 장면에 `responses` 가 없을 때 쓰는 정해 둔 답 | 다리 |
| `bridge.odd` | 칸 v·at·memo·state(꼭: v·at) · 메모 200자 · 한 번 켤 때 50개 · 이름 꼴 | '이상해' 받기 검사 | 다리 |
| `bridge.route_source` · `stream_events` · `content_types` | own · hello/tick/end · JSON·SSE | 길 답의 source · 흐름 이벤트 이름 · 답 꼴 | 다리 |
| `try.*` | 기다림 15초 · 흐름 3틱 · 앞당김 2틱 · 기다릴 틱 6 · 틱 수 허용 차 2 · 끝 여유 15초 · 장면 S1·S5 · 파일 이름 꼴 | 스스로 시험(try_server)의 값 | try_server |
| `try_t4.scale` · `per_scene_s` · `margin_s` | 60 · 8 · 40 | T4 스스로 시험의 배속 · 장면마다 여유 초 · 다리 돈 초 여유(돈 초 = 모든 장면 틱 ÷ 배속 + 장면 수 × 여유 + 이것) | try_t4 |
| `try_t4.http_timeout_s` · `db_wait_s` · `poll_s` | 10 · 10 · 0.2 | 물음 시간 한도(느린 답 3초보다 길게) · DB 쓰기 기다림 · 다시 볼 간격 | try_t4 |
| `try_t4.tick_tolerance` | 2 | 흐름 줄 수와 장면 검사기 틱의 허용 차(+ 속도 구간·멈춤 수) | try_t4 |
| `try_t4.near_km` · `off_line_km` · `line_sample_km` | 1.5 · 2.0 · 0.1 | 휴게소·주변 충전소를 '지남'으로 볼 거리 · 일반 도로로 나갔다고 볼 고속도로 선에서의 거리 · 선 거리 잴 때 찍는 간격 | try_t4 |
| `try_t4.heading_flip_min_deg` · `edge_ticks` · `jump_ratio` · `probe_after_ticks` | 150 · 10 · 0.8 · 5 | 방향이 뒤집혔다고 볼 차 · 처음·끝에서 뺄 틱 · 튄 거리 허용 몫 · 사건 뒤 몇 틱에서 길을 불러 볼지 | try_t4 |
| `try_t4.place_q_hit` · `place_q_miss` · `odd_*` | 안성휴게소 · 서울역 · '이상해' 받을 것·모르는 칸·메모 글자 | S9·S10 시험 물음 | try_t4 |
| `try_t4.order` · `checks` | 장면 14개 차례 · 장면 → 시험 종류 | 돌릴 장면과 장면마다 할 시험(plain·speeding·updown·exit·charger·stop·down·startup·ask·odd·bad·long) | try_t4 |
| `checks.root` | `..` | 기계 검사가 보는 폴더(= `testbed/`) | check4 |
| `checks.py_glob` · `json_glob` | `**/*.py` · `**/*.json` | 볼 파일 무늬 | check4 |
| `checks.skip_dirs` | __pycache__·logs·data·.git | 안 볼 폴더 | check4 |
| `checks.hardcode.allowed_numbers` | 0 · 1 · -1 | 코드에 있어도 되는 숫자 | check4 ② |
| `checks.hardcode.exclude_files` | (없음) | 박힌 값 검사에서 뺄 파일(테스트 자료 등 — `testbed/` 기준 상대 경로) | check4 ② |
| `checks.hardcode.path_patterns` | 드라이브·상대 경로·`/`로 시작·역슬래시·`주소://`·파일 확장자·`**`·IP·localhost | 코드 글이 이 무늬에 맞으면 '경로·주소 같은 글'로 걸림 | check4 ② |
| `checks.imports_allowed` | 모듈 → 불러 써도 되는 이 폴더 모듈 목록 | 목록 밖 import 와 목록에 없는 모듈의 import 는 걸림. 기본 모듈이 아닌 바깥 묶음도 걸림 | check4 ④ |
