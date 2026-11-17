# 요구사항: 충전 길잡이가 중계 페이지(relay-data raw 주소)를 바로 읽게 하기

출처: 2026-11-17 묘성 "고쳐도 돼". 중계 PC 가 10분마다 `relay-data` 브랜치에 올리지만, 사이트의 `relay/` 폴더는 GitHub 예약 실행이 돌지 않아 12:51 자료에 멈춰 있다. 앱이 중계 페이지를 바로 읽으면 예약 실행이 필요 없다.
묘성의 원칙: 앱은 키 없이 중계 페이지에서만 받는다.

## 범위 (작은 단위 — 부분 하나)
- 프로젝트 `10_프로젝트/ev-charge-planner/`. 고칠 곳은 `web/relay.js` 뿐(필요하면 화면 안내 글 한 줄). 앞의 잠긴 테스트는 고치지 않는다.
- 잠긴 테스트의 기본 주소 상수는 이미 새 주소로 바뀌어 커밋돼 있다(커밋 35ae7b6, 묘성 허락). 지금 그 테스트 33개가 실패한다. 이번 일은 그것들을 통과시키는 것이다.
- **작은 단위(묘성 11/17):** 수용 기준 8개 이하, 이번 부분 테스트 파일(`tests/test_<부분>_` 전부)은 합쳐 4만5천 자 이하.
- **시험 자료 두는 곳:** 테스트 세션은 `tests/test_<부분>_` 로 시작하는 파일만 만들 수 있다. 시험 자료는 테스트 파일 안 글자로.

## 바꿀 것
1. `ANDROID_BASE` 값을 `https://raw.githubusercontent.com/vicfos99-tech/ev-station-map/relay-data/` 로 바꾼다(이름은 그대로 — 잠긴 테스트가 이 이름으로 읽는다).
2. `defaultBase(href)`:
   - 페이지 주소의 호스트가 `vicfos99-tech.github.io`(대소문자 무관)면 `ANDROID_BASE`.
   - 그 밖의 http(s) 페이지(내 PC 시험용 `localhost` 등)는 지금처럼 페이지 기준 `./relay/`.
   - http(s) 가 아니거나 풀 수 없는 주소는 지금처럼 `ANDROID_BASE`. 던지지 않는다.
3. 사용자가 설정에 넣은 중계 주소(`baseOf`)는 지금처럼 기본값보다 먼저.

## 수용 기준
- `defaultBase("https://vicfos99-tech.github.io/ev-station-map/")` → raw 주소. `HTTPS://VICFOS99-TECH.GITHUB.IO/ev-station-map/index.html?x=1` → raw 주소.
- `defaultBase("https://a.example/x/")` → `https://a.example/x/relay/`, `http://localhost:8000/web/index.html` → `http://localhost:8000/web/relay/`.
- `defaultBase("https://vicfos99-tech.github.io.evil.example/")` → `https://vicfos99-tech.github.io.evil.example/relay/`(호스트가 정확히 같을 때만 raw).
- `file:///android_asset/index.html`, `null`, `"https://"` → raw 주소.
- github.io 페이지에서 '새로 받기' 첫 요청이 `https://raw.githubusercontent.com/vicfos99-tech/ev-station-map/relay-data/meta.json` 이다(가짜 fetch).
- 앞의 잠긴 테스트가 모두 통과한다(지금 실패하는 33개 포함).
