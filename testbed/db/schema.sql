-- 테스트 베드 시험 DB 표 정의 — 나중 집 PC 중계 서버 board.db 와 같은 모양
-- (설계 5-5 (2-나) 마스터-디테일, 묘성 결정 F5). 이 파일 하나가 표 정의의 전부다.
--
-- 판을 하나 더할 때 더하는 것은 둘뿐이다(코드는 안 고친다 — 쌓기·꺼내 보기는 마스터를 읽어 detail_table 마다 돈다):
--   ① 아래 board_master 에 INSERT 한 줄
--   ② 그 판의 디테일 표 CREATE TABLE 하나(공통 칸 + 그 판의 칸)
--   (시험 다리가 그 판을 쏘게 하려면 설정 db.kinds 에 역할 이름 한 줄과 쏘는 자리 코드가 더 든다)
--
-- 디테일 표 공통 칸(설계와 같음): key · at(UTC) · good_until(UTC) · src
-- 시험 베드에만 있는 칸: run(실행 번호 — tb_run) · tick(장면 틱). 같은 장면을 여러 번 돌려도 섞이지 않게 한다.
--   중계 서버로 옮길 때는 run·tick 을 빼고, 같은 key 는 새것으로 덮어쓴다(설계).
--   시험 베드는 바뀐 차례를 보려고 덮어쓰지 않고 줄을 더한다.
-- 시각 글의 꼴은 설정 db.time_format(UTC).

PRAGMA foreign_keys = ON;

-- 마스터: 판 종류 한 줄 = 데이터 한 종류(설계 5-5 (2-나)의 칸 그대로)
CREATE TABLE IF NOT EXISTS board_master (
  kind         TEXT PRIMARY KEY,                       -- 판 종류 이름(열쇠)
  title        TEXT NOT NULL,                          -- 사람이 읽는 이름
  source       TEXT NOT NULL,                          -- 출처 이름(주소·키는 두지 않음)
  fetch_sec    REAL NOT NULL CHECK (fetch_sec > 0),    -- 갱신 간격(초)
  stale_sec    REAL NOT NULL CHECK (stale_sec > 0),    -- 낡음 문턱(초) — good_until = at + 이것
  keep_days    INTEGER NOT NULL CHECK (keep_days > 0), -- 디테일 표 보관 날 수
  detail_table TEXT NOT NULL UNIQUE,                   -- 이 종류의 디테일 표 이름(board_<kind>)
  ver          INTEGER NOT NULL CHECK (ver > 0),       -- 디테일 표 칸 모양의 판 번호
  key_desc     TEXT NOT NULL,                          -- 디테일 표의 key 가 무엇인지
  file         TEXT NOT NULL,                          -- 내보내는 자리(시험 다리의 길·파일 이름 무늬)
  "on"         INTEGER NOT NULL DEFAULT 1 CHECK ("on" IN (0, 1))
);

-- 실행 번호(시험 베드에만): 장면 고르기·처음부터 한 번 = 실행 하나
CREATE TABLE IF NOT EXISTS tb_run (
  run        INTEGER PRIMARY KEY,
  scene      TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at   TEXT,
  secs       REAL,            -- 돈 초(단조 시계)
  last_tick  INTEGER,
  why_start  TEXT NOT NULL,
  why_end    TEXT
);

-- 쓰기 기록(설계의 board_log): 한 번에 쓴 묶음마다 종류별 한 줄. 건수 0 은 남기지 않는다.
CREATE TABLE IF NOT EXISTS board_log (
  id   INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  at   TEXT NOT NULL,
  code TEXT NOT NULL,
  n    INTEGER NOT NULL CHECK (n >= 0),
  ms   INTEGER NOT NULL CHECK (ms >= 0)
);

INSERT OR REPLACE INTO board_master (kind, title, source, fetch_sec, stale_sec, keep_days, detail_table, ver, key_desc, file, "on") VALUES
  ('flow',    '위치·속도 흐름',  '시험 다리 1초 흐름(장면 길)',          1,     5,       7,  'board_flow',    1, '틱 번호',                    '/v1/test/stream',               1),
  ('event',   '흐름의 사건',     '시험 다리 1초 흐름(장면 시간표·넣은 사건·조종)', 1, 3600, 7,  'board_event',   1, '사건 종류:대상',             '/v1/test/stream',               1),
  ('charger', '충전기 상태',     '시험 다리 /v1/data(장면 충전소)',      1,     300,     7,  'board_charger', 1, '충전소 id/충전기 id',        'status/<시군구>.json',          1),
  ('speed',   '제한 속도',       '장면 파일 limits(시험용 값)',          86400, 86400,   7,  'board_speed',   1, '선:시작km-끝km',             '(장면 limits — 다리가 아직 내지 않음)', 1),
  ('odd',     '''이상해'' 기록', '시험 다리 /v1/odd 로 받은 것',         86400, 2592000, 30, 'board_odd',     1, '서버가 지은 이름(거절이면 code@시각)', '/v1/odd',            1);

-- 디테일: 위치·속도 흐름 — 틱마다 한 줄(위치 출처가 끊긴 틱은 자리 칸이 빈 값)
CREATE TABLE IF NOT EXISTS board_flow (
  id          INTEGER PRIMARY KEY,
  run         INTEGER NOT NULL REFERENCES tb_run(run),
  tick        INTEGER NOT NULL CHECK (tick >= 0),
  key         TEXT NOT NULL,
  at          TEXT NOT NULL,
  good_until  TEXT NOT NULL,
  src         TEXT NOT NULL,
  t_ms        INTEGER,
  lat         REAL,
  lng         REAL,
  speed_kmh   REAL CHECK (speed_kmh IS NULL OR speed_kmh >= 0),
  heading_deg REAL,
  accuracy_m  REAL CHECK (accuracy_m IS NULL OR accuracy_m >= 0),
  down        TEXT NOT NULL      -- 그 틱에 끊긴 출처 목록(JSON)
);
CREATE INDEX IF NOT EXISTS board_flow_run_key ON board_flow (run, key);

-- 디테일: 흐름의 사건 — 장면 시간표(scene)·조종 길로 넣은 것(inject)·조종(control)
CREATE TABLE IF NOT EXISTS board_event (
  id         INTEGER PRIMARY KEY,
  run        INTEGER NOT NULL REFERENCES tb_run(run),
  tick       INTEGER NOT NULL CHECK (tick >= 0),
  key        TEXT NOT NULL,
  at         TEXT NOT NULL,
  good_until TEXT NOT NULL,
  src        TEXT NOT NULL,
  origin     TEXT NOT NULL CHECK (origin IN ('scene', 'inject', 'control')),
  type       TEXT NOT NULL,
  subject    TEXT,
  detail     TEXT NOT NULL       -- 사건 전체(JSON)
);
CREATE INDEX IF NOT EXISTS board_event_run_key ON board_event (run, key);

-- 디테일: 충전기 상태 — 실행 시작 때 모든 충전기(start) + 바뀔 때마다(event). /v1/data 가 그 틱부터 내는 값
CREATE TABLE IF NOT EXISTS board_charger (
  id         INTEGER PRIMARY KEY,
  run        INTEGER NOT NULL REFERENCES tb_run(run),
  tick       INTEGER NOT NULL CHECK (tick >= 0),
  key        TEXT NOT NULL,
  at         TEXT NOT NULL,
  good_until TEXT NOT NULL,
  src        TEXT NOT NULL,
  station_id TEXT NOT NULL,
  charger_id TEXT NOT NULL,
  status     TEXT NOT NULL,      -- 장면 상태 낱말(available·charging …)
  stat       TEXT NOT NULL,      -- 중계 stat 코드(설정 status_codes)
  cause      TEXT NOT NULL CHECK (cause IN ('start', 'event'))
);
CREATE INDEX IF NOT EXISTS board_charger_run_key ON board_charger (run, key);

-- 디테일: 제한 속도 — 실행 시작 때 장면 limits 한 구간에 한 줄
CREATE TABLE IF NOT EXISTS board_speed (
  id         INTEGER PRIMARY KEY,
  run        INTEGER NOT NULL REFERENCES tb_run(run),
  tick       INTEGER NOT NULL CHECK (tick >= 0),
  key        TEXT NOT NULL,
  at         TEXT NOT NULL,
  good_until TEXT NOT NULL,
  src        TEXT NOT NULL,
  route_id   TEXT NOT NULL,
  km_from    REAL NOT NULL,
  km_to      REAL NOT NULL,
  limit_kmh  REAL NOT NULL CHECK (limit_kmh > 0)
);
CREATE INDEX IF NOT EXISTS board_speed_run_key ON board_speed (run, key);

-- 디테일: '이상해' 기록 — /v1/odd 로 온 것 하나에 한 줄(받음 ok · 거절 rejected)
CREATE TABLE IF NOT EXISTS board_odd (
  id         INTEGER PRIMARY KEY,
  run        INTEGER NOT NULL REFERENCES tb_run(run),
  tick       INTEGER NOT NULL CHECK (tick >= 0),
  key        TEXT NOT NULL,
  at         TEXT NOT NULL,
  good_until TEXT NOT NULL,
  src        TEXT NOT NULL,
  result     TEXT NOT NULL CHECK (result IN ('ok', 'rejected')),
  http       INTEGER,
  code       TEXT,
  why        TEXT,
  client_at  TEXT,               -- 앱이 적은 시각(받은 글 그대로)
  memo       TEXT,
  state      TEXT                -- 앱이 보낸 상태(JSON)
);
CREATE INDEX IF NOT EXISTS board_odd_run_key ON board_odd (run, key);
