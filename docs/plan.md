# ev-secret-allow 계획서 — 배포 전 비밀값 검사가 시험용 가짜 키를 알아보게 하기

작성: 2026-11-17 계획 세션. 출처 요구사항: `specs/ev-secret-allow.md`.
교훈 반영: `.orchestra/memory/lessons.md` 의 '공통'·'계획'.
앞 단계 계획서: 충전소 고르기 엔진은 `docs/plan_stage1.md`, 앱 중계(ev-app-relay)는 **`docs/plan_stage2.md`** 로 옮겨 두었다(잠긴 테스트 `tests/test_p0_…`~`test_r6_…`·`test_integration_relay…` 가 "plan.md N행"으로 가리키는 것은 `plan_stage2.md` 다).

**한 줄 결론:** `tools/check_secrets.py` 에 허용 목록 읽기·세기 함수 셋을 더하고(a1_allow), `main()` 에 잇고 `tools/secret_allow.txt` 를 만든다(integration). 다만 **요구사항 문서 17행이 스스로 "걸려야 한다"고 적은 긴 가짜 글이 커밋되면 저장소 검사에 걸리므로, 허용 목록 처음 내용을 한 줄이 아니라 두 줄로 했다**(2.0 의 1번 — 묘성이 정할 것).

## 0. 실행 환경 (가장 먼저 확인)

| 항목 | 값 |
|---|---|
| 실행 PC 파이썬 | **Python 3.10.0**. 표준 라이브러리만. 3.11 전용(`tomllib`·`StrEnum`·`datetime.UTC`·`typing.Self`)은 쓰지 않는다 |
| 테스트 명령(글자 그대로) | `py -m pytest -q --tb=short -p no:cacheprovider` |
| 바깥 도구 | **git** (지금 도구가 이미 `git ls-files -z` 를 부른다). 통합 테스트는 `tmp_path` 에 `git init` 한 임시 저장소를 쓴다. 네트워크 없음 |
| 고치는 소스 | `tools/check_secrets.py`, 새 파일 `tools/secret_allow.txt` 둘뿐 |
| 고치지 않는 것 | `tools/push.sh`, `web/`, `src/`, `ref/`, `specs/`, 잠긴 `tests/` 전부 |
| 테스트 위치 | `tests/test_a1_allow_….py`, `tests/test_integration_secret.py` 만. `tests/data/`·`conftest.py` 는 만들지 않는다 |
| 파일 인코딩 | 모두 UTF-8. `tools/secret_allow.txt` 는 줄 끝 `\n` |
| 참조 구현 | `.orchestra/logs/ref_secret/` (5절). 제품이 아니다. 숫자·출력 글은 전부 그 실행 결과에서 옮겼다 |

- **부분 id** 는 앞 단계(`p0`·`p1_…`~`p7_…`·`r1_…`~`r6_…`)와 겹치지 않게 `a1_allow`, `integration` 이다. `integration` 은 앞 단계와 이름이 같으므로 **새 테스트 파일 이름을 `tests/test_integration_secret.py` 하나로 못박는다.** 이미 있는 `tests/test_integration_relay.py`·`.js`·`test_integration_dom.js`·`test_integration_data_base.json` 은 잠긴 파일이니 열어 고치지 않는다.
- **테스트 글자 수:** 부분마다 새 테스트 파일을 다 합쳐 **3000자 이하**(글자 수 = UTF-8 로 읽은 `len`. 이 셸의 `wc -m` 은 바이트를 낸다). 그래서 4절 통과 기준에 **[필수]** 와 **[선택]** 을 붙였다. [필수]는 테스트에 반드시 있어야 하고, [선택]은 한도 안에 들어가는 만큼만 넣는다. [선택] 사례가 없어서 살아남는 변이는 고칠 거리가 아니라 참고다.
- **저장소 안에 산출물을 만들지 않는다.** 시험 자료는 테스트 파일 안의 글자와 `tmp_path` 뿐.
- **세션은 `bash tools/push.sh` 를 돌리지 않는다**(진짜로 올라간다). 확인은 `tools/check_secrets.py` 까지만.

## 1. 개요

지금 `tools/check_secrets.py` 는 git 이 추적하는 파일에 `PATTERN` 에 걸리는 글이 하나라도 있으면 실패한다. 잠긴 테스트 `tests/test_r2_fresh_relay.js` 242행의 시험용 가짜 글 `serviceKey=AbCdEfGhIjKlMnOpQrSt` 때문에 올리기가 막힌다(계획 세션이 지금 추적 파일 149개에 돌려 확인: 걸리는 곳은 그 한 곳뿐).

고친 뒤: 허용 목록 `tools/secret_allow.txt` 에 **글자까지 같은 줄**이 있는 글은 넘어가고, 그 밖의 걸린 글이 하나라도 있으면 지금처럼 실패한다. 환경변수 값 검사는 허용 목록과 상관없이 그대로다.

| id | 이름 | 소스 | 의존 | 하는 일 |
|---|---|---|---|---|
| `a1_allow` | 허용 목록 함수 | `tools/check_secrets.py` | - | `load_allow`·`count_keys`·`check_files` 세 함수를 더한다. `main()` 은 건드리지 않는다 |
| `integration` | main 연결과 저장소 전체 | `tools/check_secrets.py`, `tools/secret_allow.txt` | a1_allow | `ALLOW_FILE` 상수, `main()` 이 세 함수를 쓰게 잇기, 허용 목록 파일 만들기, 실제 git 저장소에서 흐름 전체 확인 |

`tools/check_secrets.py` 한 파일을 두 부분이 차례로 고친다. a1 테스트는 **끝까지 참인 것만**(세 함수의 동작, `PATTERN`·`SECRET_ENVS` 가 그대로) 단언하고 `main()`·출력·`ALLOW_FILE` 은 보지 않는다.

## 2. 결정 목록

### 2.0 묘성이 정할 것 (맨 위부터 중요한 순)

1. **허용 목록 처음 내용이 두 줄이다(N1).** 요구사항은 `serviceKey=AbCdEfGhIjKlMnOpQrSt` 한 줄이라고 했다. 그런데 `specs/ev-secret-allow.md` 17행에 "걸려야 하는 것"의 예시 `serviceKey=AbCdEfGhIjKlMnOpQrStXYZ123` 이 글자 그대로 적혀 있고, `specs/` 는 추적되는 폴더다(`specs/ev-app-relay.md` 가 이미 커밋돼 있다). 그 문서가 커밋되는 순간 한 줄짜리 허용 목록으로는 "저장소 전체에 돌리면 통과"를 어떤 구현도 지킬 수 없다(참조로 확인). 그래서 그 긴 글도 허용 목록에 넣었다 — 둘 다 진짜 키가 아니라 문서·테스트에 적힌 가짜 글이다. "허용 글로 시작하지만 더 긴 것은 걸린다"는 규칙 자체는 임시 허용 목록(한 줄)으로 테스트한다. **싫으면:** 요구사항 17행의 글을 띄어 쓰거나 바꿔 적고 `secret_allow.txt` 둘째 줄을 지우면 된다(그러면 이 계획서의 같은 글도 고쳐야 한다. 이 계획서에는 그 글이 여러 번 나온다).
2. **부분이 둘이고 테스트 글자 한도가 부분마다 3000자다(N2).** 요구사항은 "부분 하나·새 테스트 글 3000자 이하"였다. 지휘 스크립트 지시문이 `integration` 부분을 꼭 넣으라고 해서 둘로 나눴고, 합치면 6000자까지 된다.
3. **지휘 스크립트가 `integration` 을 앞 실행(ev-app-relay)의 끝난 부분으로 보고 건너뛰지 않는지.** 계획 세션은 스크립트 상태 파일을 볼 수 없었다(`.orchestra/` 에는 `state_app_relay.json` 으로 이름이 바뀐 옛 상태만 있다). 건너뛰면 `main()` 이 허용 목록을 쓰지 않는 채로 끝난다.
4. **이제 잠긴 테스트가 저장소 전체를 본다(M4).** `tests/test_integration_secret.py` 가 실제 저장소에 검사를 돌려 통과를 단언한다. 나중에 누가 허용 목록에 없는 가짜 키 글을 문서·테스트에 적어 커밋하면 push 뿐 아니라 이 테스트도 빨개진다. 그때는 그 글을 띄어 적거나 허용 목록에 한 줄 더한다.
5. **출력에 한 줄이 늘었다(N3).** 허용 목록으로 넘어간 글이 하나라도 있으면 `허용 목록으로 넘어간 시험용 가짜 글: N개` 가 찍힌다. 허용 목록이 실제로 쓰이고 있다는 것을 사람이 보게 하려는 것이다. 빼고 싶으면 말해 주면 된다.

### 2.1 요구사항과 다름

| # | 요구사항 | 이 계획 | 까닭 / 잃는 것 |
|---|---|---|---|
| N1 | 허용 목록 처음 내용은 가짜 글 한 줄과 설명 주석 | 가짜 글 **두 줄**(`serviceKey=AbCdEfGhIjKlMnOpQrSt`, `serviceKey=AbCdEfGhIjKlMnOpQrStXYZ123`)과 설명 주석 | 2.0 의 1번. 잃는 것: 실제 저장소에서는 그 긴 글이 통과한다(가짜 글이다) |
| N2 | 부분 하나, 새 테스트 글 3000자 이하 | 부분 둘(`a1_allow`·`integration`), 부분마다 3000자 이하 | 2.0 의 2번 |
| N3 | 출력은 지금과 같음(파일 이름만) | 넘어간 글이 1개 이상일 때만 `허용 목록으로 넘어간 시험용 가짜 글: N개` 한 줄을 더 찍는다. 값은 찍지 않는다. 허용 목록 파일이 없으면 이 줄은 절대 안 나온다 | 2.0 의 5번 |

### 2.2 비워 둔 곳을 채움

| # | 정한 것 |
|---|---|
| D1 | **"글자까지 같다"** = `PATTERN.finditer(data)` 가 찾은 글 `m.group(0)`(바이트)이 허용 글(바이트)과 `==`. 대소문자도 본다. 정규식은 욕심껏 찾으므로 허용 글 바로 뒤에 `[A-Za-z0-9%+/=]` 글자가 이어지면 그것까지가 걸린 글이고, 허용 글과 달라 걸린다 |
| D2 | **허용 목록 읽기**는 바이트로 한다. 맨 앞 BOM(`EF BB BF`)은 버린다. `\n` 으로 줄을 나누고 줄마다 양 끝 공백(`bytes.strip()` — 공백·탭·`\r` 포함)을 뗀다. 뗀 뒤 빈 줄, `#` 로 시작하는 줄은 무시한다. 가운데 공백은 그대로 둔다(`KakaoAK …` 꼴 때문). 마지막 줄에 줄바꿈이 없어도 읽는다. 같은 줄이 여러 번 있어도 된다. UTF-8 이 아닌 바이트가 있어도 예외 없다 |
| D3 | **허용 목록을 못 읽으면**(없음·폴더임·권한 없음 = `OSError`) 빈 허용 목록, 경고 없음, 출력 없음 → 지금과 똑같이 동작한다 |
| D4 | **허용 목록 자리**는 현재 폴더가 아니라 `check_secrets.py` 와 같은 폴더의 `secret_allow.txt` 다(`ALLOW_FILE`). 저장소 루트에 같은 이름 파일을 둬도 쓰이지 않는다 |
| D5 | 허용은 `PATTERN` 의 네 모양 모두에 듣는다. 개인 키 블록은 걸린 글이 `PRIVATE KEY` 까지(뒤의 `-----` 는 빠짐)이므로 허용 줄도 거기까지만 적어야 한다 |
| D6 | **허용 줄에 진짜 키 값이 들었다** = 확인하는 환경변수 값(8자 이상인 것만, `main()` 이 지금 거르는 그대로) 중 하나가 그 줄 안에 **들어 있다**(부분 일치). 그 줄은 허용 목록에서 빼고 줄마다 경고 한 줄: `경고: 허용 목록 N번째 줄에 환경변수 이름 의 값이 들어 있어 그 줄은 무시한다`. N 은 주석·빈 줄도 센 1부터의 줄 번호, 이름은 값이 둘 이상 걸리면 `secrets` 순서(= `SECRET_ENVS` 순서)의 첫 이름. 주석 줄은 경고하지 않는다. 경고만으로는 종료 코드가 바뀌지 않는다(다만 허용 목록 파일도 추적 파일이라 환경변수 값 검사에 걸려 실패한다 — S7) |
| D7 | 실패 줄은 지금처럼 **파일마다 한 줄**(`파일: 키처럼 생긴 글자가 있다`)이다. 허용 안 된 글이 여러 개여도 한 줄. 한 파일 안의 순서는 지금처럼 환경변수 줄들(secrets 순서) 다음에 키 줄 |
| D8 | 허용 목록 파일 자신도 추적 파일이므로 다른 파일과 똑같이 검사한다(그 안의 허용 글은 넘어간 수에 든다) |
| D9 | `PATTERN` 에 통째로 걸리지 않는 허용 줄(짧은 글 등)은 어떤 것과도 같아질 수 없어 아무 일도 하지 않는다. 경고도 없다 |
| D10 | 출력 순서: 경고 줄들 → (넘어간 수가 1 이상이면) 넘어간 수 한 줄 → 지금의 실패 글 또는 통과 글. 통과·실패 글은 지금과 글자까지 같다 |
| D11 | 세 함수는 인자의 자료형을 검사하지 않는다(안에서만 쓰는 도구). 자료형이 틀린 입력, `secrets` 에 빈 값이 든 경우는 **정하지 않는다** — 테스트·변이 대상이 아니다 |

### 2.3 막지 못함

- **M1** 그 PC 의 환경변수에 없는 진짜 키(다른 PC 의 키, `SECRET_ENVS` 에 없는 키)를 누가 허용 목록에 적으면 통과한다. 허용 목록은 사람이 diff 로 보는 파일이다.
- **M2** `PATTERN` 에 안 걸리는 모양의 키(20자 미만 등)는 지금처럼 못 잡는다. 이 일은 `PATTERN` 을 바꾸지 않는다.
- **M3** 환경변수가 하나도 없는 PC(예: CI)에서는 D6 의 경고가 나올 수 없다.
- **M4** 2.0 의 4번.

## 3. 공통 규칙

- **C1 값을 찍지 않는다.** 출력(경고·실패·통과·넘어간 수)과 함수가 돌려주는 글 어디에도 걸린 글·환경변수 값이 없다. 파일 이름, 환경변수 이름, 줄 번호, 개수만 나온다.
- **C2 테스트 파일 글 자체가 검사에 걸리면 안 된다.** 테스트 파일도 커밋되면 추적 파일이다. `serviceKey=AbCdEfGhIjKlMnOpQrSt` 와 `serviceKey=AbCdEfGhIjKlMnOpQrStXYZ123` 두 글만 글자 그대로 적어도 되고, **그 밖의 가짜 키는 반드시 이어 붙여 만든다**(4.0 의 OTHER·BOT·KAKAO·PEM 처럼). 허용 글 바로 뒤에 영문·숫자·`%+/=` 를 붙여 적지 않는다. 부분마다 통과 기준 맨 끝의 "자기 검사"가 이것을 본다.
- **C3 도구를 불러오는 법.** `tools/` 는 패키지가 아니다. 테스트는
  `spec = importlib.util.spec_from_file_location("check_secrets", Path(__file__).resolve().parent.parent / "tools" / "check_secrets.py")` → `module_from_spec` → `spec.loader.exec_module` 로 불러온다.
- **C4 바이트로 다룬다.** 파일 내용·허용 글·환경변수 값은 모두 `bytes`. 실패 줄·경고는 `str`.
- **C5** `PATTERN`·`SECRET_ENVS`·`env_value` 는 한 글자도 바꾸지 않는다.
- **C6** 테스트·검증 세션은 저장소 안에 파일을 만들지 않고(`tmp_path` 만), 실제 `tools/secret_allow.txt` 를 고치지 않는다.

## 4. 부분별 통과 기준

### 4.0 시험에 쓰는 글 (테스트는 이 표를 옮겨 쓴다 — 모두 bytes)

| 이름 | 만드는 법 | 뜻 |
|---|---|---|
| SK | `"service" + "Key="` | 머리 |
| A | `serviceKey=AbCdEfGhIjKlMnOpQrSt` | 허용할 가짜 글 |
| LONG | `serviceKey=AbCdEfGhIjKlMnOpQrStXYZ123` (= A 뒤에 `XYZ123`) | 허용 글로 시작하지만 더 긴 것 |
| OTHER | `SK + "Zz" * 10` | 허용 안 된 다른 키 |
| BOT | `"bot" + "123456:" + "abcdefghijklmnopqrst_-"` | 텔레그램 토큰 모양. 걸린 글 = BOT 전체 |
| KAKAO | `"Kakao" + "AK " + "0123456789abcdefghij"` | 카카오 모양. 걸린 글 = KAKAO 전체 |
| PEM | `"-----BEGIN RSA " + "PRIVATE KEY"` | 개인 키 블록 머리. 파일에는 PEM 뒤에 `-----` 를 붙여 쓴다. 걸린 글 = PEM(뒤 `-----` 없음) |
| V | `Zx9Yw8Vu7Ts6Rq5Po4Nm3Lk2` (24자) | 가짜 환경변수 값. `SK + V` 는 `PATTERN` 에 걸린다 |
| T0 | `T0-zzzz-1111-qqqq` | 가짜 환경변수 값(둘째) |

### 4.1 a1_allow — 허용 목록 함수

소스: `tools/check_secrets.py`. 의존: 없음. `main()` 과 `if __name__` 블록은 **이 부분에서 고치지 않는다**(지금 동작 그대로 둔다). 테스트 파일: `tests/test_a1_allow_….py` (합쳐 3000자 이하).

더할 함수 셋:

- `load_allow(path, secrets)` → `(frozenset[bytes], list[str])` = (허용 글, 경고 글). `secrets` 는 `{환경변수 이름: 값 bytes}`. 읽는 법은 D2, 못 읽으면 D3, 경고는 D6.
- `count_keys(data, allow)` → `(허용 안 된 수, 허용돼 넘어간 수)`. `data` 에서 `PATTERN.finditer` 가 찾은 **모든** 글을 D1 로 본다.
- `check_files(files, secrets, allow)` → `(실패 줄 list[str], 넘어간 수 합계)`. `files` 를 준 순서대로, 못 여는 파일(`OSError`)은 말없이 건너뛴다. 파일마다 `secrets` 순서로 값이 든 것마다 `"{파일}: 환경변수 {이름} 의 값이 들어 있다"`, 그 다음 허용 안 된 수가 1 이상이면 `"{파일}: 키처럼 생긴 글자가 있다"` 한 줄(D7). `{파일}` 은 받은 글 그대로. 환경변수 값 검사는 `allow` 를 보지 않는다.

통과 기준 (값은 참조 실행 `a1_out.txt` 에서 옮김):

1. **[필수]** `load_allow(없는 경로, {})` 와 `load_allow(폴더 경로, {})` 는 둘 다 `(frozenset(), [])` 이고 예외가 없다.
2. **[필수]** 파일 바이트가 `BOM + "# 설명\r\n" + "\r\n" + 공백 둘 + A + 공백·탭 + "\r\n" + "#" + OTHER + "\n" + KAKAO`(끝에 줄바꿈 없음)이면 `load_allow(경로, {})` 는 `(frozenset({A, KAKAO}), [])` 이다.
3. **[필수]** `secrets = {"EV_CHARGER_API_KEY": T0, "EX_API_KEY": V}` 이고 파일 줄이 차례로 `"# c " + V` / A / 빈 줄 / `"xx" + V + "yy"` / `T0 + " " + V` / LONG 이면 허용 글은 `frozenset({A, LONG})`, 경고는 글자 그대로 `["경고: 허용 목록 4번째 줄에 환경변수 EX_API_KEY 의 값이 들어 있어 그 줄은 무시한다", "경고: 허용 목록 5번째 줄에 환경변수 EV_CHARGER_API_KEY 의 값이 들어 있어 그 줄은 무시한다"]` 이다(주석 줄은 경고 없음, 줄 번호는 주석·빈 줄도 셈, 둘이 걸리면 secrets 순서의 첫 이름, 경고에 V·T0 없음).
4. **[필수]** `count_keys(b"x?" + A + b"&y", {A}) == (0, 1)`, 같은 data 에 `frozenset()` 이면 `(1, 0)`.
5. **[필수]** OTHER 하나와 A 둘을 공백으로 이은 data 는 OTHER 가 앞·가운데·뒤 어디에 있어도 `count_keys(data, {A}) == (1, 2)`.
6. **[필수]** `count_keys(LONG, {A}) == (1, 0)` 이고 `count_keys(A, {LONG}) == (1, 0)`.
7. **[선택]** `count_keys(A, 허용)` 은 허용 글이 A 와 대소문자만 다를 때(`A.swapcase()`), A 의 마지막 글자를 뺀 것일 때 `(1, 0)`. data 가 A 뒤에 `=` 하나를 붙인 것, A 둘을 띄지 않고 붙인 것이면 `count_keys(data, {A}) == (1, 0)`.
8. **[필수]** BOT, KAKAO, `PEM + b"-----"` 각각 `count_keys(x, {A}) == (1, 0)` 이고, 허용이 걸린 글 그대로(BOT, KAKAO, PEM)이면 `(0, 1)`.
9. **[필수]** `count_keys(b"hello " + SK + b"short", {A}) == (0, 0)`, `count_keys(b"", {A}) == (0, 0)`.
10. **[필수]** `tmp_path` 에 f1 = `A\n`, f2 = `OTHER\nA\nLONG\n`, f3 = `"k=" + V + "\n"`, f4 = `T0 + " " + SK + V + " " + A + "\n"` 을 쓰고, secrets 는 기준 3 과 같고, `files = [f1, 없는 파일, f2, f3, f4]`, `allow = frozenset({A, V, SK + V})` 이면 `check_files` 는 `([f"{f2}: 키처럼 생긴 글자가 있다", f"{f3}: 환경변수 EX_API_KEY 의 값이 들어 있다", f"{f4}: 환경변수 EV_CHARGER_API_KEY 의 값이 들어 있다", f"{f4}: 환경변수 EX_API_KEY 의 값이 들어 있다"], 4)` 를 준다(없는 파일은 건너뜀, f2 는 허용 안 된 글이 둘이어도 한 줄, 허용 목록에 값 V 가 있어도 환경변수 줄은 나옴, f4 는 `SK + V` 가 허용돼 키 줄이 없음, 넘어간 수 = f1 1 + f2 1 + f4 2).
11. **[필수]** `check_files([], secrets, frozenset()) == ([], 0)`, `check_files([f1], {}, frozenset()) == ([f"{f1}: 키처럼 생긴 글자가 있다"], 0)`.
12. **[필수]** `hashlib.sha256(PATTERN.pattern).hexdigest() == "78cced60b4d2612c0e83f43bb80ed07e294f6ff8ba584424e78100087a12ecbf"` 이고 `SECRET_ENVS == ("EV_CHARGER_API_KEY", "EX_API_KEY", "TELEGRAM_BOT_TOKEN", "KAKAO_REST_API_KEY", "KAKAO_REST_KEY", "OPENAI_API_KEY")`.
13. **[필수] 자기 검사.** 테스트 파일 자신의 바이트로 `count_keys(글, {A, LONG})[0] == 0` (C2).

검사 불가·동치(검증이 다시 묻지 않게): "값이 출력에 없다"(C1)는 기준 3·10 의 글자 그대로 비교와 동치다. D11 의 자료형·빈 값은 정하지 않았다. "한 파일에 허용 안 된 글이 둘이면 두 줄" 변이는 기준 10 의 f2 로 잡힌다.

### 4.2 integration — main 연결과 저장소 전체

소스: `tools/check_secrets.py`(`ALLOW_FILE` 상수와 `main()`), 새 파일 `tools/secret_allow.txt`. 의존: a1_allow. 테스트 파일: **`tests/test_integration_secret.py` 하나**(3000자 이하).

고칠 것:

- `ALLOW_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "secret_allow.txt")` (D4).
- `main()`: 지금처럼 `git ls-files -z` 로 파일을 얻고 환경변수 값을 모아 8자 이상만 남긴 뒤, `load_allow(ALLOW_FILE, secrets)` → 경고를 한 줄씩 찍고 → `check_files(files, secrets, allow)` → 넘어간 수가 1 이상이면 `허용 목록으로 넘어간 시험용 가짜 글: N개` → 실패 줄이 있으면 지금의 실패 글과 종료 코드 1, 없으면 지금의 통과 글과 0 (D10). `main()` 은 인자를 받지 않는다. 모듈 맨 위 설명글에 허용 목록 한 줄을 더한다(테스트하지 않음).
- `tools/secret_allow.txt`: `#` 설명 주석(무엇을 적는 파일인지, 한 줄에 하나·글자까지 같아야 함·진짜 키를 적지 말 것)과 아래 두 줄. UTF-8, 줄 끝 `\n`.
  ```
  serviceKey=AbCdEfGhIjKlMnOpQrSt
  serviceKey=AbCdEfGhIjKlMnOpQrStXYZ123
  ```

**흐름 시험의 틀(S1~S8 공통):** `tmp_path` 아래 폴더를 하나 만들고 제품 `tools/check_secrets.py` 를 `그 폴더/tools/check_secrets.py` 로 베낀다. 표의 파일을 쓴다. 그 폴더에서 `git init -q`, `git add -A` 를 한다(커밋은 필요 없다). `subprocess.run([sys.executable, "tools/check_secrets.py"], cwd=그 폴더, env=…, capture_output=True)` 로 돌리고 stdout 을 UTF-8 로 읽어 `\r\n` 을 `\n` 으로 바꿔 견준다. `env` 는 `os.environ` 에 아래 여섯 값을 덮어쓴 것(그래야 윈도우 레지스트리의 진짜 값을 읽지 않고 "확인한 환경변수 6개"가 된다): `EV_CHARGER_API_KEY=T0-zzzz-1111-qqqq`, `EX_API_KEY=`V, `TELEGRAM_BOT_TOKEN=T2-zzzz-2222-qqqq`, `KAKAO_REST_API_KEY=T3-zzzz-3333-qqqq`, `KAKAO_REST_KEY=T4-zzzz-4444-qqqq`, `OPENAI_API_KEY=T5-zzzz-5555-qqqq`.

- 허용 = `"# 시험용 가짜 글\n" + A + "\n"` (한 줄짜리 허용 목록)
- T_JS = `'fetch("https://x/api?' + A + '&a=1"); // ' + A + "\n"` (A 가 두 번)

| 사례 | 쓰는 파일 (경로: 내용) | 종료 코드 | stdout (글자 그대로, 줄 순서대로) |
|---|---|---|---|
| S1 | `tools/secret_allow.txt`: 허용 · `t.js`: T_JS | 0 | `허용 목록으로 넘어간 시험용 가짜 글: 3개` / `비밀값 검사 통과: 파일 3개, 확인한 환경변수 6개` |
| S2 | S1 + `u.js`: `"x=" + LONG + "\n"` | 1 | `허용 목록으로 넘어간 시험용 가짜 글: 3개` / `비밀값 검사 실패 — 올리지 않는다:` / `  u.js: 키처럼 생긴 글자가 있다` |
| S3 | S1 + `v.js`: `A + "&\n" + OTHER + "\n" + A + "\n"` | 1 | `허용 목록으로 넘어간 시험용 가짜 글: 5개` / `비밀값 검사 실패 — 올리지 않는다:` / `  v.js: 키처럼 생긴 글자가 있다` |
| S4 | `tools/secret_allow.txt`: 허용 · `b.txt`: BOT · `k.txt`: KAKAO · `p.txt`: PEM + `-----` (각각 끝에 `\n`) | 1 | `허용 목록으로 넘어간 시험용 가짜 글: 1개` / `비밀값 검사 실패 — 올리지 않는다:` / `  b.txt: 키처럼 생긴 글자가 있다` / `  k.txt: 키처럼 생긴 글자가 있다` / `  p.txt: 키처럼 생긴 글자가 있다` |
| S5 | (`tools/secret_allow.txt` **없음**) 저장소 루트의 `secret_allow.txt`: 허용 · `t.js`: T_JS | 1 | `비밀값 검사 실패 — 올리지 않는다:` / `  secret_allow.txt: 키처럼 생긴 글자가 있다` / `  t.js: 키처럼 생긴 글자가 있다` |
| S6 | (허용 목록 없음) `c.txt`: `"아무것도 없음 " + SK + "short\n"` | 0 | `비밀값 검사 통과: 파일 2개, 확인한 환경변수 6개` |
| S7 | `tools/secret_allow.txt`: 허용 + `SK + V + "\n"` · `t.js`: T_JS · `x.js`: `SK + V + "\n"` | 1 | `경고: 허용 목록 3번째 줄에 환경변수 EX_API_KEY 의 값이 들어 있어 그 줄은 무시한다` / `허용 목록으로 넘어간 시험용 가짜 글: 3개` / `비밀값 검사 실패 — 올리지 않는다:` / `  tools/secret_allow.txt: 환경변수 EX_API_KEY 의 값이 들어 있다` / `  tools/secret_allow.txt: 키처럼 생긴 글자가 있다` / `  x.js: 환경변수 EX_API_KEY 의 값이 들어 있다` / `  x.js: 키처럼 생긴 글자가 있다` |
| S8 | `tools/secret_allow.txt`: 허용 · `e.txt`: `"k=T2-zzzz-2222-qqqq\n" + A + "\n"` | 1 | `허용 목록으로 넘어간 시험용 가짜 글: 2개` / `비밀값 검사 실패 — 올리지 않는다:` / `  e.txt: 환경변수 TELEGRAM_BOT_TOKEN 의 값이 들어 있다` |

S5·S6 의 출력은 **고치기 전 도구**(sha256 `10e1a4a166bdc0ff319b1d6342a1e1168847623ede3799f383781cb60eca95e3` 인 `tools/check_secrets.py`, 커밋 4b43a17)를 같은 틀에서 돌린 출력과 글자까지 같음을 참조 실행에서 확인했다("허용 목록 없음 → 지금과 같음"의 기준은 이 두 출력이다).

통과 기준:

1. **[필수]** S1: 종료 코드 0, stdout 이 표의 두 줄 그대로(가짜 글만 든 파일 → 통과. 허용 목록 파일 자신도 세어 3개).
2. **[필수]** S2: 종료 코드 1, stdout 이 표의 세 줄 그대로(허용 글로 시작하지만 더 긴 것 → 실패. `t.js` 는 실패 줄에 없다).
3. **[필수]** S3: 종료 코드 1, stdout 이 표의 세 줄 그대로(같은 파일에 허용 안 된 키가 하나 더 → 실패, 넘어간 수 5).
4. **[선택]** S4: 종료 코드 1, stdout 이 표의 다섯 줄 그대로(bot 토큰·`KakaoAK`·개인 키 블록은 허용 목록에 없으면 지금처럼 실패).
5. **[필수]** S5: 종료 코드 1, stdout 이 표의 세 줄 그대로(허용 목록 없음 → 지금과 같음. 넘어간 수 줄이 없다. 저장소 루트의 `secret_allow.txt` 는 허용 목록으로 쓰이지 않는다 — D4).
6. **[필수]** S6: 종료 코드 0, stdout 이 표의 한 줄 그대로(허용 목록 없음·걸린 글 없음 → 지금의 통과 글만).
7. **[필수]** S7: 종료 코드 1, stdout 이 표의 일곱 줄 그대로(허용 목록에 환경변수 값이 든 줄은 무시하고 경고 한 줄, 환경변수 값 검사는 허용 목록과 상관없이 그대로, `t.js` 의 A 는 여전히 넘어감).
8. **[선택]** S8: 종료 코드 1, stdout 이 표의 세 줄 그대로(환경변수 값만 걸린 파일: 키 줄 없이 환경변수 줄만).
9. **[필수]** 돌린 사례 모두에서 stdout 에 `AbCdEfGhIjKlMnOpQrSt`, V, `T2-zzzz-2222-qqqq` 가 없다(C1).
10. **[필수]** 실제 허용 목록: 불러온 모듈의 `ALLOW_FILE` 이 `tools/secret_allow.txt` 의 절대 경로이고, `load_allow(ALLOW_FILE, {}) == (frozenset({A, LONG}), [])` 이며, 그 파일에 `#` 로 시작하는 줄이 하나 이상 있고 `\r` 이 없다.
11. **[필수]** 실제 저장소: 프로젝트 폴더를 `cwd` 로 `subprocess.run([sys.executable, "tools/check_secrets.py"], …)` 를 돌리면(이때 `env` 는 `os.environ` 그대로) 종료 코드 0 이고, stdout 의 마지막 줄이 `비밀값 검사 통과: 파일 ` 로 시작하며, `허용 목록으로 넘어간 시험용 가짜 글: N개` 줄이 있고 N ≥ 1 이고, stdout 에 `AbCdEfGhIjKlMnOpQrSt` 가 없다. (N 과 파일 수는 커밋할 때마다 달라지니 숫자로 못박지 않는다.)
12. **[필수] 자기 검사.** 테스트 파일 자신의 바이트로 `count_keys(글, {A, LONG})[0] == 0` (C2).

검사 불가·정하지 않음: 경고만 있고 실패가 없는 흐름(허용 목록에 진짜 값이 들었는데 종료 코드 0)은 실제 배치에서는 만들 수 없다 — 허용 목록 파일이 추적 파일이라 환경변수 값 검사에 걸린다(S7). `git add` 하지 않은 허용 목록은 이 계획이 다루지 않는다.

**마지막 확인(테스트 파일이 아니라 지휘 스크립트·최종 검수가 한다):** `py -m pytest -q --tb=short -p no:cacheprovider` 전체가 통과한다(앞 단계의 잠긴 테스트 포함). `tools/push.sh`·`web/`·잠긴 테스트에 바뀐 것이 없다.

## 5. 참조 구현과 사용 예시

`.orchestra/logs/ref_secret/` (git 이 추적하지 않는 폴더):

| 파일 | 내용 |
|---|---|
| `check_secrets.py` | 참조 구현(두 부분을 다 채운 모습) |
| `test_ref_probe.py` → `probe_out.txt` | 지금 저장소에서 `PATTERN` 에 걸리는 글 전부: 추적 파일 149개 중 `tests/test_r2_fresh_relay.js` 242행 한 곳(A). 추적 안 된 `specs/ev-secret-allow.md` 는 3·10행 A, 17행 LONG |
| `test_ref_flow.py` → `flow_out.txt`, `a1_out.txt` | S1~S8 을 참조와 고치기 전 도구로 실제 git 임시 저장소에서 돌린 출력, 4.1 의 값 |
| `test_ref_keep_plan.py` | 앞 단계 계획서를 `docs/plan_stage2.md` 로 베낌 |
| `test_ref_make_plan_json.py` | 이 계획서 4.1·4.2 의 통과 기준 문장을 글자 그대로 뽑아 `.orchestra/outbox/plan.json` 을 만듦 |
| `test_ref_plan_check.py` | 이 계획서 자기 검사: 계획서 글이 두 줄 허용 목록으로 걸리지 않는지, 4.2 표의 출력 글이 `flow_out.txt` 와 같은지 |

돌리는 법: `py -m pytest -q --tb=short -p no:cacheprovider .orchestra/logs/ref_secret/` (9 passed. `probe_out.txt` 는 돌릴 때마다 다시 쓰이므로 이 계획서를 쓴 뒤에는 `docs/plan.md` 의 A·LONG 도 함께 나온다).

돌려 보지 않음: 실제 `tools/secret_allow.txt` 를 놓은 저장소 전체 실행(기준 11)은 제품 파일을 만들어야 해서 돌리지 않았다. 대신 탐침으로 "지금 추적 파일 + 요구사항 문서 + 이 계획서"에 걸리는 글이 A·LONG 둘뿐임을 확인했다.

**사용 예시(최종 검수가 글자 그대로 불러 볼 것):**

```
py tools/check_secrets.py
```
저장소 루트에서. 기대: 종료 코드 0, `허용 목록으로 넘어간 시험용 가짜 글: N개`(N ≥ 1) 다음에 `비밀값 검사 통과: 파일 …개, 확인한 환경변수 …개`.

최종 검수가 더 볼 것: `tools/secret_allow.txt` 를 잠깐 다른 이름으로 바꾼 **복사본 배치**(저장소가 아니라 임시 폴더)에서 지금처럼 `tests/test_r2_fresh_relay.js` 가 걸리는지, 허용 목록에 진짜 환경변수 값을 넣은 복사본 배치에서 경고가 나오고 값이 안 찍히는지.

## 6. 계획 밖 파일

- `docs/plan_stage2.md`: 앞 단계(ev-app-relay) 계획서를 그대로 베낀 것. 이 파일을 새로 쓰면서 잠긴 테스트의 "plan.md N행" 인용이 죽지 않게 남겼다(`git mv` 는 승인이 안 나서 복사).
- `.orchestra/logs/ref_secret/*`, `.orchestra/logs/plan_secret_allow.md`(이 세션 기록): 추적되지 않는다.
