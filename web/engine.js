/*
 * 충전소 고르기 엔진 — 자바스크립트 판.
 * 파이썬 원본 src/ev_charge_planner/*.py 를 그대로 옮겼다(계산 순서까지 같게: 부동소수 결과가 같아야 한다).
 *
 * 다른 점
 *  - 시각: datetime → 밀리초 정수. stale_minutes 는 분 그대로.
 *  - 자료: dataclass → 보통 객체. 이름은 파이썬과 같은 snake_case (대조하기 쉽게).
 *  - 집합(frozenset) → 배열로 받아 안에서 Set 으로 쓴다. None → null.
 *  - ValueError → 같은 이름의 Error.
 *
 * 브라우저에서는 전역 EvPlanner, Node 에서는 require("./engine.js").
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.EvPlanner = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  class ValueError extends Error {
    constructor(message) {
      super(message);
      this.name = "ValueError";
    }
  }
  function need(cond, message) {
    if (!cond) throw new ValueError(message);
  }
  function needText(value, label) {
    need(typeof value === "string" && value !== "", `${label} 은(는) 비어 있지 않은 문자열이어야 한다`);
  }
  const isNum = (x) => typeof x === "number" && !Number.isNaN(x);

  // ---------- p1 models ----------
  const ChargerType = Object.freeze({ FAST: "fast", SLOW: "slow" });
  const ChargerStatus = Object.freeze({
    AVAILABLE: "available",
    CHARGING: "charging",
    OUT_OF_SERVICE: "out_of_service",
    MAINTENANCE: "maintenance",
    COMM_ERROR: "comm_error",
  });
  const STATUS_ORDER = Object.freeze(Object.values(ChargerStatus));
  const UNUSABLE_STATUSES = new Set([ChargerStatus.OUT_OF_SERVICE, ChargerStatus.MAINTENANCE, ChargerStatus.COMM_ERROR]);
  const AlertCode = Object.freeze({
    UNREACHABLE: "unreachable",
    ALL_UNAVAILABLE: "all_unavailable",
    NO_USABLE_FAST: "no_usable_fast",
    UNUSABLE_CHARGERS: "unusable_chargers",
    STALE_INFO: "stale_info",
    NO_BACKUP: "no_backup",
    NO_SAFE_STATION: "no_safe_station",
  });
  const alert = (code, message) => ({ code, message });

  function makeCharger(c) {
    need(Object.values(ChargerType).includes(c.type), `충전기 종류를 알 수 없다: ${c.type}`);
    need(STATUS_ORDER.includes(c.status), `충전기 상태를 알 수 없다: ${c.status}`);
    need(isNum(c.power_kw) && c.power_kw > 0, `power_kw 는 0 보다 커야 한다: ${c.power_kw}`);
    return { type: c.type, power_kw: c.power_kw, status: c.status };
  }
  function makeStation(s) {
    needText(s.id, "충전소 id");
    needText(s.operator, "충전소 업체");
    const chargers = (s.chargers || []).map(makeCharger);
    need(isNum(s.price_per_kwh) && s.price_per_kwh >= 0, `price_per_kwh 는 0 이상이어야 한다: ${s.price_per_kwh}`);
    need(isNum(s.status_updated_at), `status_updated_at 은 시각(밀리초)이어야 한다: ${s.status_updated_at}`);
    return { id: s.id, operator: s.operator, chargers, price_per_kwh: s.price_per_kwh, status_updated_at: s.status_updated_at };
  }
  function makeNearby(n) {
    const station = makeStation(n.station);
    need(isNum(n.detour_km) && n.detour_km >= 0, `detour_km 는 0 이상이어야 한다: ${n.detour_km}`);
    return { station, detour_km: n.detour_km };
  }
  function makeRestArea(r) {
    const stations = (r.stations || []).map(makeStation);
    const nearby = (r.nearby || []).map(makeNearby);
    needText(r.id, "휴게소 id");
    needText(r.name, "휴게소 이름");
    need(isNum(r.distance_km) && r.distance_km >= 0, `distance_km 는 0 이상이어야 한다: ${r.distance_km}`);
    return { id: r.id, name: r.name, distance_km: r.distance_km, stations, nearby };
  }
  function makeRoute(r) {
    const rest_areas = (r.rest_areas || []).map(makeRestArea);
    needText(r.highway, "고속도로 이름");
    needText(r.direction, "방향");
    const restIds = new Set();
    const stationIds = new Set();
    let prev = null;
    for (const ra of rest_areas) {
      need(prev === null || ra.distance_km >= prev, `휴게소 거리가 줄어든다: ${ra.id}`);
      prev = ra.distance_km;
      need(!restIds.has(ra.id), `휴게소 id 중복: ${ra.id}`);
      restIds.add(ra.id);
      for (const st of [...ra.stations, ...ra.nearby.map((n) => n.station)]) {
        need(!stationIds.has(st.id), `충전소 id 중복: ${st.id}`);
        stationIds.add(st.id);
      }
    }
    return { highway: r.highway, direction: r.direction, rest_areas };
  }
  function makeVehicle(v) {
    const out = {
      soc_pct: v.soc_pct,
      battery_kwh: v.battery_kwh,
      efficiency_km_per_kwh: v.efficiency_km_per_kwh,
      safety_margin_ratio: v.safety_margin_ratio === undefined ? 0.10 : v.safety_margin_ratio,
      min_arrival_soc_pct: v.min_arrival_soc_pct === undefined ? 15.0 : v.min_arrival_soc_pct,
    };
    need(isNum(out.soc_pct) && out.soc_pct >= 0 && out.soc_pct <= 100, `soc_pct 는 0~100: ${out.soc_pct}`);
    need(isNum(out.battery_kwh) && out.battery_kwh > 0, `battery_kwh 는 0 보다 커야 한다: ${out.battery_kwh}`);
    need(isNum(out.efficiency_km_per_kwh) && out.efficiency_km_per_kwh > 0, `efficiency_km_per_kwh 는 0 보다 커야 한다: ${out.efficiency_km_per_kwh}`);
    need(isNum(out.safety_margin_ratio) && out.safety_margin_ratio >= 0 && out.safety_margin_ratio < 1, `safety_margin_ratio 는 0 이상 1 미만: ${out.safety_margin_ratio}`);
    need(isNum(out.min_arrival_soc_pct) && out.min_arrival_soc_pct >= 0 && out.min_arrival_soc_pct <= 100, `min_arrival_soc_pct 는 0~100: ${out.min_arrival_soc_pct}`);
    return out;
  }
  function makeCard(c) {
    needText(c.name, "카드 이름");
    need(isNum(c.rate) && c.rate > 0 && c.rate < 1, `rate 는 0 초과 1 미만: ${c.rate}`);
    const operators = c.operators === undefined || c.operators === null ? null : Array.from(c.operators);
    return { name: c.name, rate: c.rate, operators };
  }
  function makeSubscription(s) {
    needText(s.operator, "구독 업체");
    need(isNum(s.rate) && s.rate > 0 && s.rate < 1, `rate 는 0 초과 1 미만: ${s.rate}`);
    return { operator: s.operator, rate: s.rate, excluded_rest_area_ids: Array.from(s.excluded_rest_area_ids || []) };
  }
  function makeUser(u) {
    const o = u || {};
    return {
      subscription: o.subscription === undefined || o.subscription === null ? null : makeSubscription(o.subscription),
      cards: (o.cards || []).map(makeCard),
    };
  }

  // ---------- p2 driving_range ----------
  const TOLERANCE = 1e-9;
  function conservative_range_km(v) {
    return v.soc_pct / 100 * v.battery_kwh * v.efficiency_km_per_kwh * (1 - v.safety_margin_ratio);
  }
  function km_per_pct(v) {
    return v.battery_kwh * v.efficiency_km_per_kwh * (1 - v.safety_margin_ratio) / 100;
  }
  function arrival_soc_pct(v, distance_km) {
    if (distance_km < 0) throw new ValueError(`distance_km must be >= 0, got ${distance_km}`);
    return v.soc_pct - distance_km / km_per_pct(v);
  }
  function can_reach(v, distance_km) {
    return arrival_soc_pct(v, distance_km) >= v.min_arrival_soc_pct - TOLERANCE;
  }

  // ---------- p3 status ----------
  // 파이썬 f"{x:g}" 와 같은 모양(정수면 소수점 없이)
  const fmtG = (x) => String(Number(Number(x).toPrecision(6)));
  function summarize_station(station, now, stale_minutes = 30) {
    if (stale_minutes < 0) throw new ValueError(`stale_minutes 는 0 이상이어야 한다: ${stale_minutes}`);
    const counts = {};
    for (const s of STATUS_ORDER) counts[s] = 0;
    let usable_fast = 0, waiting_fast = 0, usable_slow = 0, unusable = 0;
    for (const c of station.chargers) {
      counts[c.status] += 1;
      if (UNUSABLE_STATUSES.has(c.status)) {
        unusable += 1;
      } else if (c.type === ChargerType.FAST) {
        if (c.status === ChargerStatus.AVAILABLE) usable_fast += 1;
        else if (c.status === ChargerStatus.CHARGING) waiting_fast += 1;
      } else if (c.status === ChargerStatus.AVAILABLE) {
        usable_slow += 1;
      }
    }
    const is_stale = now - station.status_updated_at > stale_minutes * 60000;
    const alerts = [];
    if (is_stale) alerts.push(alert(AlertCode.STALE_INFO, `충전 상태 갱신이 ${fmtG(stale_minutes)}분을 넘어 오래되었다`));
    if (unusable >= 1) alerts.push(alert(AlertCode.UNUSABLE_CHARGERS, `사용할 수 없는 충전기가 ${unusable}대 있다`));
    return { counts, usable_fast, waiting_fast, usable_slow, unusable, is_stale, alerts };
  }
  function rest_area_alerts(statuses) {
    let usable = 0, fast = 0;
    for (const s of statuses) { usable += s.usable_fast + s.usable_slow; fast += s.usable_fast; }
    if (usable === 0) return [alert(AlertCode.ALL_UNAVAILABLE, "사용 가능한 충전기가 하나도 없다")];
    if (fast === 0) return [alert(AlertCode.NO_USABLE_FAST, "사용 가능한 급속 충전기가 없다")];
    return [];
  }

  // ---------- p4 pricing ----------
  function quote(station, rest_area_id, user, charger_type = ChargerType.FAST) {
    if (!Object.values(ChargerType).includes(charger_type)) throw new ValueError(`charger_type 은 ChargerType 이어야 한다: ${charger_type}`);
    const base = station.price_per_kwh;
    const sub = user.subscription;
    const sub_ok = sub !== null
      && station.operator === sub.operator
      && charger_type === ChargerType.FAST
      && !sub.excluded_rest_area_ids.includes(rest_area_id);
    const cards = user.cards.filter((c) => c.operators === null || c.operators.includes(station.operator));
    // 후보: 구독 먼저, 그다음 카드 순서. 할인율이 엄격히 더 클 때만 교체하므로 동률은 앞선 것이 남는다.
    let best_name = null;
    let best_rate = 0.0;
    if (sub_ok) { best_name = "subscription"; best_rate = sub.rate; }
    for (const c of cards) {
      if (best_name === null || c.rate > best_rate) { best_name = c.name; best_rate = c.rate; }
    }
    const final = best_name === null ? base : base * (1 - best_rate);
    return {
      base_price: base,
      final_price: final,
      subscription_applicable: sub_ok,
      applicable_cards: cards.map((c) => c.name),
      applied: best_name,
    };
  }

  // ---------- p5 route_list ----------
  function station_entry(station, rest_area_id, detour_km, is_nearby, rest_remaining_km, vehicle, user, now, stale_minutes) {
    const status = summarize_station(station, now, stale_minutes);
    const remaining = rest_remaining_km + detour_km;
    const reachable = can_reach(vehicle, remaining);
    const alerts = status.alerts.slice();
    if (is_nearby && !reachable) alerts.push(alert(AlertCode.UNREACHABLE, "남은 잔량으로 갈 수 없다"));
    return {
      station_id: station.id,
      operator: station.operator,
      is_nearby,
      detour_km,
      remaining_km: remaining,
      arrival_soc_pct: arrival_soc_pct(vehicle, remaining),
      reachable,
      status,
      quote: quote(station, rest_area_id, user, ChargerType.FAST),
      is_candidate: reachable && status.usable_fast >= 1,
      alerts,
      role: null,
    };
  }

  function build_route_list(route, vehicle, user, now, position_km = 0.0, stale_minutes = 30) {
    if (position_km < 0) throw new ValueError(`position_km 는 0 이상이어야 한다: ${position_km}`);
    const entries = [];
    for (const ra of route.rest_areas) {
      const remaining = ra.distance_km - position_km;
      if (remaining < 0) continue;
      const reachable = can_reach(vehicle, remaining);
      const inner = ra.stations.map((s) => station_entry(s, ra.id, 0.0, false, remaining, vehicle, user, now, stale_minutes));
      const near = ra.nearby.map((n) => station_entry(n.station, ra.id, n.detour_km, true, remaining, vehicle, user, now, stale_minutes));

      const operators = [];
      for (const e of inner) if (!operators.includes(e.operator)) operators.push(e.operator);
      const applied_cards = new Set();
      for (const e of inner) for (const name of e.quote.applicable_cards) applied_cards.add(name);
      const counts = {};
      for (const s of STATUS_ORDER) counts[s] = 0;
      for (const e of inner) for (const s of STATUS_ORDER) counts[s] += e.status.counts[s];
      const prices = inner.filter((e) => e.status.usable_fast >= 1).map((e) => e.quote.final_price);

      const alerts = [];
      if (!reachable) alerts.push(alert(AlertCode.UNREACHABLE, "남은 잔량으로 갈 수 없다"));
      alerts.push(...rest_area_alerts(inner.map((e) => e.status)));

      let usable_fast = 0, waiting_fast = 0;
      for (const e of inner) { usable_fast += e.status.usable_fast; waiting_fast += e.status.waiting_fast; }
      entries.push({
        rest_area_id: ra.id,
        name: ra.name,
        distance_km: ra.distance_km,
        remaining_km: remaining,
        arrival_soc_pct: arrival_soc_pct(vehicle, remaining),
        reachable,
        stations: inner,
        nearby: near,
        operators,
        subscription_applicable: inner.some((e) => e.quote.subscription_applicable),
        applicable_cards: user.cards.filter((c) => applied_cards.has(c.name)).map((c) => c.name),
        status_counts: counts,
        usable_fast,
        waiting_fast,
        lowest_price: prices.length ? Math.min(...prices) : null,
        alerts,
      });
    }
    return { highway: route.highway, direction: route.direction, entries };
  }

  // ---------- p6 recommend ----------
  function score_candidate(entry, vehicle) {
    const usable = entry.status.usable_fast;
    const c = usable <= 1 ? 0 : usable === 2 ? 1 : 2;
    const margin = entry.arrival_soc_pct - vehicle.min_arrival_soc_pct;
    const m = margin < 10 ? 0 : margin < 20 ? 1 : 2;
    const f = entry.status.is_stale ? 0 : 1;
    return c + m + f;
  }
  function pick(ra, entry, score) {
    return {
      rest_area_id: ra.rest_area_id,
      rest_area_name: ra.name,
      station_id: entry.station_id,
      operator: entry.operator,
      is_nearby: entry.is_nearby,
      detour_km: entry.detour_km,
      remaining_km: entry.remaining_km,
      arrival_soc_pct: entry.arrival_soc_pct,
      score,
      final_price: entry.quote.final_price,
    };
  }
  function recommend(route_list, vehicle) {
    // 안 충전소 → 나들목 인근, 휴게소 순서대로 (입력 순서가 동률의 기준)
    const all = [];
    for (const ra of route_list.entries) for (const e of [...ra.stations, ...ra.nearby]) all.push([ra, e]);
    for (const [, e] of all) e.role = null;

    const ranked = all.filter(([, e]) => e.is_candidate).map(([ra, e]) => [ra, e, score_candidate(e, vehicle)]);
    // Array.prototype.sort 는 안정 정렬 (파이썬 sort 와 같다)
    ranked.sort((a, b) =>
      (b[2] - a[2])
      || (a[1].quote.final_price - b[1].quote.final_price)
      || (a[1].remaining_km - b[1].remaining_km)
      || ((a[1].is_nearby ? 1 : 0) - (b[1].is_nearby ? 1 : 0)));

    if (ranked.length === 0) {
      return { status: "no_safe_station", primary: null, backup: null, alerts: [alert(AlertCode.NO_SAFE_STATION, "안전하게 갈 수 있는 충전소가 없다")] };
    }
    const [p_ra, p_entry, p_score] = ranked[0];
    p_entry.role = "primary";
    const primary = pick(p_ra, p_entry, p_score);

    const round_trip_pct = p_entry.detour_km / km_per_pct(vehicle);
    let backup = null;
    for (const [ra, e, score] of ranked.slice(1)) {
      if (ra.rest_area_id === p_ra.rest_area_id) continue;
      if (!(ra.remaining_km > p_ra.remaining_km)) continue;
      if (e.arrival_soc_pct - round_trip_pct + TOLERANCE < vehicle.min_arrival_soc_pct) continue;
      e.role = "backup";
      backup = pick(ra, e, score);
      break;
    }
    const alerts = backup ? [] : [alert(AlertCode.NO_BACKUP, "예비 충전소가 없다")];
    return { status: "ok", primary, backup, alerts };
  }

  // ---------- p7 planner ----------
  // 입력은 보통 객체(JSON). 여기서 검사하고 계산한다.
  function plan(route, vehicle, user, now, position_km = 0.0, stale_minutes = 30) {
    const r = makeRoute(route);
    const v = makeVehicle(vehicle);
    const u = makeUser(user);
    const route_list = build_route_list(r, v, u, now, position_km, stale_minutes);
    const recommendation = recommend(route_list, v);
    return { route_list, recommendation };
  }

  return {
    ValueError, ChargerType, ChargerStatus, AlertCode, STATUS_ORDER, TOLERANCE,
    makeRoute, makeVehicle, makeUser,
    conservative_range_km, km_per_pct, arrival_soc_pct, can_reach,
    summarize_station, rest_area_alerts, quote,
    build_route_list, score_candidate, recommend, plan,
  };
});
