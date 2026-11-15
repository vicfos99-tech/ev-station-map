/*
 * 예시 노선 데이터 (실제 충전소가 아니다). 공공 충전소 API 를 붙이기 전까지 화면과 추천 흐름을 보는 용도.
 * 휴게소·업체 이름은 지어낸 것이고, 고속도로 이름만 익숙한 것을 빌렸다.
 *
 * 충전기 표기: "FA FA FC SO" = 종류(F 급속 / S 완속) + 상태(A 사용 가능, C 충전 중, O 고장, M 점검, E 통신 오류)
 * age: 상태가 갱신된 지 몇 분 됐는지(지금 기준).
 *
 * 브라우저에서는 전역 EvData, Node 에서는 require("./data.js").
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    let live = null;
    try { live = require("./live.js"); } catch (e) { /* 실제 데이터 없음 */ }
    module.exports = factory(live);
  } else {
    root.EvData = factory(root.EvLive || null);
  }
})(typeof self !== "undefined" ? self : this, function (LIVE) {
  "use strict";

  const STATUS = { A: "available", C: "charging", O: "out_of_service", M: "maintenance", E: "comm_error" };
  const OPERATORS = ["별빛차지", "한빛이브이", "초록전력", "달무리충전"];

  // [id, 업체, 가격(원/kWh), 충전기 표기, 급속 출력 kW, 갱신 뒤 지난 분]
  const st = (id, operator, price, spec, kw, age) => ({ id, operator, price, spec, kw, age });
  const near = (station, detour) => ({ station, detour });

  const ROUTES = [
    {
      key: "gb-down", highway: "경부고속도로", direction: "부산 방향", length: 395,
      rest_areas: [
        { id: "gb1", name: "달빛 휴게소", km: 27, stations: [st("gb1a", "별빛차지", 347, "FA FA FC SA", 100, 4)] },
        { id: "gb2", name: "소나무 휴게소", km: 62, stations: [st("gb2a", "한빛이브이", 320, "FA FA FA FC", 200, 2), st("gb2b", "별빛차지", 350, "FA FO", 50, 8)] },
        { id: "gb3", name: "강바람 휴게소", km: 104, stations: [st("gb3a", "초록전력", 300, "FA FA", 100, 75)],
          nearby: [near(st("gb3n", "별빛차지", 310, "FA FA FA FA", 350, 3), 10.8)] },
        { id: "gb4", name: "별마루 휴게소(민자)", km: 151, stations: [st("gb4a", "별빛차지", 400, "FA FA FC", 200, 1)] },
        { id: "gb5", name: "하늘길 휴게소", km: 196, stations: [st("gb5a", "한빛이브이", 330, "FC FC FC", 100, 5)] },
        { id: "gb6", name: "돌담 휴게소", km: 243, stations: [st("gb6a", "달무리충전", 295, "FA FA FA", 200, 6), st("gb6b", "초록전력", 310, "FA SE", 50, 12)],
          nearby: [near(st("gb6n", "한빛이브이", 285, "FA FA", 100, 20), 6.4)] },
        { id: "gb7", name: "노을 휴게소", km: 297, stations: [st("gb7a", "별빛차지", 347, "FO FM", 100, 9)] },
        { id: "gb8", name: "갈매기 휴게소", km: 348, stations: [st("gb8a", "한빛이브이", 320, "FA FA FA FA", 350, 2)] },
      ],
    },
    {
      key: "gb-up", highway: "경부고속도로", direction: "서울 방향", length: 395,
      rest_areas: [
        { id: "gu1", name: "갈매기 휴게소", km: 44, stations: [st("gu1a", "한빛이브이", 320, "FA FA FC", 350, 3)] },
        { id: "gu2", name: "노을 휴게소", km: 96, stations: [st("gu2a", "별빛차지", 347, "FA FA", 100, 4)],
          nearby: [near(st("gu2n", "초록전력", 290, "FA FA FA", 200, 6), 8.2)] },
        { id: "gu3", name: "돌담 휴게소", km: 150, stations: [st("gu3a", "달무리충전", 295, "FA FC FC", 200, 2)] },
        { id: "gu4", name: "하늘길 휴게소", km: 198, stations: [st("gu4a", "한빛이브이", 330, "FA FA FA", 100, 55)] },
        { id: "gu5", name: "별마루 휴게소(민자)", km: 242, stations: [st("gu5a", "별빛차지", 400, "FA FA FA FA", 200, 1)] },
        { id: "gu6", name: "강바람 휴게소", km: 290, stations: [st("gu6a", "초록전력", 300, "FE FE", 100, 140)] },
        { id: "gu7", name: "소나무 휴게소", km: 332, stations: [st("gu7a", "한빛이브이", 320, "FA FA", 200, 3), st("gu7b", "별빛차지", 350, "FA FA FO", 50, 7)] },
      ],
    },
    {
      key: "yd-east", highway: "영동고속도로", direction: "강릉 방향", length: 234,
      rest_areas: [
        { id: "ye1", name: "들꽃 휴게소", km: 31, stations: [st("ye1a", "초록전력", 305, "FA FA SA", 100, 3)] },
        { id: "ye2", name: "물안개 휴게소", km: 72, stations: [st("ye2a", "별빛차지", 347, "FA FC", 200, 5)],
          nearby: [near(st("ye2n", "달무리충전", 280, "FA FA FA", 200, 4), 4.6)] },
        { id: "ye3", name: "산마루 휴게소", km: 118, stations: [st("ye3a", "한빛이브이", 335, "FA FA FA", 350, 2)] },
        { id: "ye4", name: "눈꽃 휴게소", km: 163, stations: [st("ye4a", "별빛차지", 347, "FA FA FA FC", 200, 1), st("ye4b", "초록전력", 300, "SA SA", 7, 30)] },
        { id: "ye5", name: "바다빛 휴게소", km: 207, stations: [st("ye5a", "달무리충전", 290, "FA FM", 100, 11)] },
      ],
    },
  ];

  function chargers(spec, kw) {
    return spec.trim().split(/\s+/).map((c) => ({
      type: c[0] === "F" ? "fast" : "slow",
      power_kw: c[0] === "F" ? kw : 7,
      status: STATUS[c[1]],
    }));
  }
  function station(s, now) {
    if (s.chargers) { // 실제 데이터(live.js): 충전기 목록과 받은 시각이 들어 있다
      return { id: s.id, operator: s.operator, chargers: s.chargers.map((c) => Object.assign({}, c)), price_per_kwh: s.price, status_updated_at: s.updated };
    }
    return { id: s.id, operator: s.operator, chargers: chargers(s.spec, s.kw), price_per_kwh: s.price, status_updated_at: now - s.age * 60000 };
  }
  // 엔진 입력(Route) 모양으로 바꾼다. now 는 밀리초
  function toRoute(r, now) {
    return {
      highway: r.highway,
      direction: r.direction,
      rest_areas: r.rest_areas.map((a) => ({
        id: a.id, name: a.name, distance_km: a.km,
        stations: a.stations.map((s) => station(s, now)),
        nearby: (a.nearby || []).map((n) => ({ station: station(n.station, now), detour_km: n.detour })),
      })),
    };
  }
  // 충전기 상태와 갱신 시각을 무작위로 다시 뽑는다(실시간으로 상태가 바뀌는 걸 흉내). rand 는 0~1 난수 함수
  function shuffled(r, rand) {
    const pickStatus = () => { const x = rand(); return x < 0.55 ? "A" : x < 0.82 ? "C" : x < 0.9 ? "O" : x < 0.95 ? "M" : "E"; };
    const reroll = (s) => s.chargers ? s : Object.assign({}, s, { // 실제 데이터는 그대로 둔다
      spec: s.spec.trim().split(/\s+/).map((c) => c[0] + pickStatus()).join(" "),
      age: rand() < 0.85 ? Math.floor(rand() * 15) : 35 + Math.floor(rand() * 120),
    });
    return Object.assign({}, r, {
      rest_areas: r.rest_areas.map((a) => Object.assign({}, a, {
        stations: a.stations.map(reroll),
        nearby: (a.nearby || []).map((n) => ({ station: reroll(n.station), detour: n.detour })),
      })),
    });
  }

  // 실제 데이터가 있으면 노선 목록 앞에 붙이고, 그 업체들도 구독 목록에 더한다
  const EXAMPLES = ROUTES.slice();
  if (LIVE && Array.isArray(LIVE.routes)) {
    ROUTES.unshift(...LIVE.routes);
    for (const r of LIVE.routes) for (const a of r.rest_areas) for (const s of a.stations) {
      if (!OPERATORS.includes(s.operator)) OPERATORS.push(s.operator);
    }
  }

  return { ROUTES, EXAMPLES, OPERATORS, LIVE, toRoute, shuffled };
});
