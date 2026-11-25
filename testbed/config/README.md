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
| `db.path` | `../data/testbed.db` | 시험 DB 자리(T3 용 — T1 은 만들지 않음, git 제외) | T3 |
| `status_codes` | 낱말 → 중계 stat 코드 | 장면의 충전기 상태 낱말과 중계 자료 코드(`ref/relay_format.md`). 장면 낱말은 여기 있어야 한다 | 검사기 · T2 |
| `sources` | data·home·gate·loc·tiles | 끊김 사건의 출처 이름(설계 `health.src` 의 출처) | 검사기 · T2 |
| `startup_fail_targets` | stations·lines·app_secret·gateway_url | 켤 때 실패 사건의 대상 | 검사기 · T2 |
| `geo.earth_radius_km` | 6371.0088 | 거리 셈의 지구 반지름 | 검사기 · T2 |
| `geo.lat_min`~`lng_max` | 33.0~38.7 · 124.5~132.0 | 좌표가 이 범위 밖이면 틀림(한국 둘레) | 검사기 |
| `geo.speed_max_kmh` | 200 | 장면 시속 상한 | 검사기 |
| `geo.accuracy_max_m` | 5000 | 장면 정확도 상한 | 검사기 |
| `units.seconds_per_hour` | 3600 | 시속 → 초 셈 | 검사기 |
| `units.report_decimals` | 1 | 찍는 수의 소수 자리 | 검사기 · check4 |
| `checks.root` | `..` | 기계 검사가 보는 폴더(= `testbed/`) | check4 |
| `checks.py_glob` · `json_glob` | `**/*.py` · `**/*.json` | 볼 파일 무늬 | check4 |
| `checks.skip_dirs` | __pycache__·logs·data·.git | 안 볼 폴더 | check4 |
| `checks.hardcode.allowed_numbers` | 0 · 1 · -1 | 코드에 있어도 되는 숫자 | check4 ② |
| `checks.hardcode.exclude_files` | (없음) | 박힌 값 검사에서 뺄 파일(테스트 자료 등 — `testbed/` 기준 상대 경로) | check4 ② |
| `checks.hardcode.path_patterns` | 드라이브·상대 경로·`/`로 시작·역슬래시·`주소://`·파일 확장자·`**`·IP·localhost | 코드 글이 이 무늬에 맞으면 '경로·주소 같은 글'로 걸림 | check4 ② |
| `checks.imports_allowed` | 모듈 → 불러 써도 되는 이 폴더 모듈 목록 | 목록 밖 import 와 목록에 없는 모듈의 import 는 걸림. 기본 모듈이 아닌 바깥 묶음도 걸림 | check4 ④ |
