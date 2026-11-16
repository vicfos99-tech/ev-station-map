# 올리는 파일의 모양 (relay_format)

2단계 중계(`tools/run_relay2.py`)가 정적 저장소에 올리는 파일 여덟 가지의 모양이다. 앱 쪽은 이 문서와 `samples/upload/`(아래 예시와 같은 글) 만 보면 된다. 모든 파일은 UTF-8 JSON 이고 끝에 줄바꿈이 없다. 시각은 모두 **한국 시각** 14자리 `YYYYMMDDhhmmss` 다(예외: `routes.json` 의 `fetched_at`·`updated`·`last_end` 는 밀리초 숫자). 예시는 지어낸 자료이며 키는 어디에도 없다.

## 앱이 지킬 규칙

1. **신선함은 `meta.json` 으로 본다.** `status/…` 파일의 `at` 은 그 파일을 마지막으로 다시 쓴 시각일 뿐이다(바뀐 게 없으면 안 움직인다). 상태가 지금 것인지는 `meta.json` 으로 본다: `ok` 가 참이고, `at` 이 지금에서 가깝고(권고: 15분 안), 그 시군구 `stations/<zscode>.json` 의 `zcodes` 가 모두 `meta.json` 의 `fresh` 에 있을 때만 믿는다. 아니면 "낡았을 수 있음"으로 보여 준다.
2. **없는 충전기는 모름이다.** `stations/` 에 있는데 `status/` 의 `s` 에 없는 충전기는 "모름"이다(빈자리가 아니다).
3. **`routes.json` 안의 상태·`updated` 는 목록을 받은 때의 것**이다. 지금 상태는 `status/` 의 같은 충전소 파일(`status/rest/<휴게소 id>.json` 또는 `status/<zscode>.json`)로 덮어써서 보여 준다.
4. `routes.json` 에는 **나들목 항목이 없다**(휴게소만 있다). 나들목 근처 충전소는 `stations/` 에서 좌표로 찾는다.
5. `suspect` 에 든 지역 코드는 목록이 0건이라 지역 코드가 바뀐 것이 아닌지 의심되는 곳이다. 그 지역의 빈자리가 없다고 단정하지 않는다.
6. 모르는 칸은 무시하고, `v` 가 1 이 아니면 읽지 않는다.

stat 코드 뜻: `1` 통신 이상 · `2` 충전 대기 · `3` 충전 중 · `4` 운영 중지 · `5` 점검 중 · `9` 상태 미확인.

## meta.json

- 경로: `meta.json`
- 모양: `{"v":1, "at":14자리|null, "stations_at":14자리|null, "calls_today":정수, "ok":참거짓, "error":글, "suspect":[지역 코드…], "fresh":[지역 코드…], "unknown":정수}`
  - `v` 모양 번호(1). `at` 마지막 차례의 시각. `stations_at` 목록을 마지막으로 받은 시각. `calls_today` 오늘 부른 횟수. `ok` 상태 받기가 마지막 차례에 성공했는가. `error` 실패 까닭(없으면 빈 글, 키·주소는 없다). `suspect` 목록이 0건이라 지역 코드 바뀜이 의심되는 두 자리 코드. `fresh` 이번 실행에서 목록을 받은 두 자리 지역 코드(`stations/` 의 `zcodes` 와 견준다). `unknown` 이번 차례 상태에 있으나 목록에 없어 넣지 않은 충전소 수.
- 다시 쓰는 때: **매 차례**(내용이 바뀌는 `at` 때문에 늘 새로 쓴다).

```
{"v":1,"at":"20260105091000","stations_at":"20260105090000","calls_today":5,"ok":true,"error":"","suspect":["29"],"fresh":["41"],"unknown":1}
```

## routes.json

- 경로: `routes.json`
- 모양: `{"v":1, "fetched_at":밀리초, "source":글, "price_note":글, "routes":[노선…], "skipped":{"방향 모름":[…],"고속도로에서 멂":[…],"다른 고속도로":[…]}}`. 노선은 `key`·`highway`·`direction`·`length`·`live`·`rest_areas`(휴게소: `name`·`km`·`loc`[위도,경도]·`id`·`stations`)를 가진다. 충전소는 `id`·`operator`·`price`·`updated`·`chargers`(`type` fast/slow·`power_kw`·`status` available/charging 등·`last_end`)·`loc`·`maker`.
- 다시 쓰는 때: 휴게소 목록이 바뀌었을 때(하루 한 번쯤). 상태만 바뀐 차례에는 다시 쓰지 않는다. 그 안의 상태는 목록 받은 때의 것이라 규칙 3 대로 `status/` 로 덮어쓴다.

예시는 `samples/upload/routes.json` 에 있다(휴게소 둘, 충전소 둘).

## stations/<zscode>.json

- 경로: `stations/<zscode>.json` — `<zscode>` 는 시군구 코드 5자리(예: `stations/41463.json`).
- 모양: `{"v":1, "zscode":5자리, "zcodes":[두 자리 지역 코드…], "stations":[충전소…]}`. `zcodes` 는 이 시군구 목록이 어느 지역(광역) 목록에서 왔는지 알려 준다. 충전소: `id`·`name`·`operator`·`maker`·`loc`[위도,경도]·`chargers`[{`id`·`type` fast/slow·`kw`}], 건물 안(지하 등)이면 `"indoor":true`, 휴게소이면 `"rest":true`(`status/rest/` 의 휴게소 id 와 같다). 공개된 급속 충전소만 들어 있다.
- 다시 쓰는 때: 그 시군구 목록의 내용이 바뀌었을 때만(하루 한 번 목록을 받아 바뀐 시군구만).

```
{"v":1,"zscode":"41463","zcodes":["41"],"stations":[{"id":"KP000101","name":"기흥휴게소(부산방향)","operator":"한국전력","maker":"가나전기·다라전기","loc":[37.2361,127.1052],"rest":true,"chargers":[{"id":"01","type":"fast","kw":100.0},{"id":"02","type":"fast","kw":100.0}]},{"id":"KP000102","name":"기흥휴게소(서울방향)","operator":"한국전력","maker":"가나전기","loc":[37.2365,127.1047],"rest":true,"chargers":[{"id":"01","type":"fast","kw":200.0}]}]}
```

건물 안 충전소 예: `samples/upload/stations/41135.json` 의 `ME000202`(`"indoor":true`).

## status/<zscode>.json

- 경로: `status/<zscode>.json`
- 모양: `{"at":14자리, "s":{충전소 id:{충전기 id:[stat, lastTedt, nowTsdt]}}}`. `stat` 은 위 코드(글자 한 자리), `lastTedt` 마지막 충전 끝 시각, `nowTsdt` 지금 충전 시작 시각(없으면 `null`). 앞 `stations/` 에 있는 충전기만 든다.
- 다시 쓰는 때: 그 시군구 충전기의 상태·시각이 하나라도 바뀌었을 때만(`at` 만 바뀐 것은 새로 쓰지 않는다 — 규칙 1).

```
{"at":"20260105090500","s":{"KP000101":{"01":["3","20260105083000","20260105090300"],"02":["3","20260105083000","20260105084000"]},"KP000102":{"01":["2","20260105083000",null]}}}
```

## status/rest/<휴게소 id>.json

- 경로: `status/rest/` 아래 `<휴게소 id>.json`(예: `status/rest/KP000101.json`)
- 모양: `{"rest":휴게소 id, "at":14자리, "chargers":[{"statId","chgerId","stat","lastTedt","nowTsdt"}…]}` — `routes.json` 의 휴게소 충전소 하나의 충전기 상태를 한 파일로 모은 것. 필드 뜻은 위와 같다.
- 다시 쓰는 때: 그 휴게소 충전기의 상태가 바뀌었을 때만.

```
{"rest":"KP000101","at":"20260105090500","chargers":[{"statId":"KP000101","chgerId":"01","stat":"3","lastTedt":"20260105083000","nowTsdt":"20260105090300"},{"statId":"KP000101","chgerId":"02","stat":"3","lastTedt":"20260105083000","nowTsdt":"20260105084000"}]}
```

## 칸 이름 요약

| 칸 | 뜻 |
|---|---|
| `type` | `fast` 급속, `slow` 완속 |
| `kw` / `power_kw` | 충전 출력(kW) |
| `indoor` | 건물 안(지하·실내)이면 `true`(없으면 건물 밖) |
| `rest` | 고속도로 휴게소 충전소이면 `true` |
| `zcodes` | 이 시군구 파일이 의존하는 지역 코드(신선함 확인용) |

## 파일이 다시 쓰이는 때 (요약)

- `meta.json`: 매 차례. `status/…`: 바뀐 시군구·휴게소만. `stations/…`·`routes.json`: 목록이 바뀐 때만.
- 같은 상태가 계속되면 `meta.json` 외에는 올리지 않는다.
