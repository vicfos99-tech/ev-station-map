// 순수: 충전소 고르기 엔진(설계 5-1 engine — 옛 앱 web/engine.js 를 옮김. 파이썬 src/ev_charge_planner 와 계산 차례까지 같게: 부동소수 결과가 같아야 한다).
// 다른 점: ES 모듈 · 숫자(여유·도착 잔량·오래됨·점수 문턱·백분율·분↔밀리초·허용 오차)와 알림 글은 규칙 r = config_engine 에서 받는다.
// 자료 꼴은 옛 엔진과 같다(snake_case, 시각은 밀리초). 틀린 입력은 ValueError 로 던진다. 로그 없음.
export const NEEDS = [];

export class ValueError extends Error {
  constructor(message) {
    super(message);
    this.name = r_name;
  }
}
const r_name = 'ValueError';

function need(cond, message) {
  if (!cond) throw new ValueError(message);
}
function needText(value, label, r) {
  need(typeof value === 'string' && value !== '', label + r.why.text);
}
const isNum = (x) => typeof x === 'number' && !Number.isNaN(x);
const say = (tpl, r, v) => tpl.split(r.n_mark).join(String(v));

function chargerTypes(r) { return Object.values(r.charger_type); }
function statusOrder(r) { return r.status_order; }

function makeCharger(c, r) {
  need(chargerTypes(r).includes(c.type), r.why.charger_type + c.type);
  need(statusOrder(r).includes(c.status), r.why.charger_status + c.status);
  need(isNum(c.power_kw) && c.power_kw > 0, r.why.power + c.power_kw);
  return { type: c.type, power_kw: c.power_kw, status: c.status };
}
function makeStation(s, r) {
  needText(s.id, r.why.station_id, r);
  needText(s.operator, r.why.operator, r);
  const chargers = (s.chargers || []).map((c) => makeCharger(c, r));
  need(isNum(s.price_per_kwh) && s.price_per_kwh >= 0, r.why.price + s.price_per_kwh);
  need(isNum(s.status_updated_at), r.why.updated + s.status_updated_at);
  return { id: s.id, operator: s.operator, chargers, price_per_kwh: s.price_per_kwh, status_updated_at: s.status_updated_at };
}
function makeNearby(n, r) {
  const station = makeStation(n.station, r);
  need(isNum(n.detour_km) && n.detour_km >= 0, r.why.detour + n.detour_km);
  return { station, detour_km: n.detour_km };
}
function makeRestArea(a, r) {
  const stations = (a.stations || []).map((s) => makeStation(s, r));
  const nearby = (a.nearby || []).map((n) => makeNearby(n, r));
  needText(a.id, r.why.rest_id, r);
  needText(a.name, r.why.rest_name, r);
  need(isNum(a.distance_km) && a.distance_km >= 0, r.why.distance + a.distance_km);
  return { id: a.id, name: a.name, distance_km: a.distance_km, stations, nearby };
}
export function makeRoute(route, r) {
  const rest_areas = (route.rest_areas || []).map((a) => makeRestArea(a, r));
  needText(route.highway, r.why.highway, r);
  needText(route.direction, r.why.direction, r);
  const restIds = new Set();
  const stationIds = new Set();
  let prev = null;
  for (const ra of rest_areas) {
    need(prev === null || ra.distance_km >= prev, r.why.order + ra.id);
    prev = ra.distance_km;
    need(!restIds.has(ra.id), r.why.dup_rest + ra.id);
    restIds.add(ra.id);
    for (const st of [...ra.stations, ...ra.nearby.map((n) => n.station)]) {
      need(!stationIds.has(st.id), r.why.dup_station + st.id);
      stationIds.add(st.id);
    }
  }
  return { highway: route.highway, direction: route.direction, rest_areas };
}
export function makeVehicle(v, r) {
  const out = {
    soc_pct: v.soc_pct,
    battery_kwh: v.battery_kwh,
    efficiency_km_per_kwh: v.efficiency_km_per_kwh,
    safety_margin_ratio: v.safety_margin_ratio === undefined ? r.default_margin_ratio : v.safety_margin_ratio,
    min_arrival_soc_pct: v.min_arrival_soc_pct === undefined ? r.default_min_arrival_pct : v.min_arrival_soc_pct,
  };
  need(isNum(out.soc_pct) && out.soc_pct >= 0 && out.soc_pct <= r.pct, r.why.soc + out.soc_pct);
  need(isNum(out.battery_kwh) && out.battery_kwh > 0, r.why.battery + out.battery_kwh);
  need(isNum(out.efficiency_km_per_kwh) && out.efficiency_km_per_kwh > 0, r.why.eff + out.efficiency_km_per_kwh);
  need(isNum(out.safety_margin_ratio) && out.safety_margin_ratio >= 0 && out.safety_margin_ratio < 1, r.why.margin + out.safety_margin_ratio);
  need(isNum(out.min_arrival_soc_pct) && out.min_arrival_soc_pct >= 0 && out.min_arrival_soc_pct <= r.pct, r.why.min_arrival + out.min_arrival_soc_pct);
  return out;
}
function makeCard(c, r) {
  needText(c.name, r.why.card_name, r);
  need(isNum(c.rate) && c.rate > 0 && c.rate < 1, r.why.rate + c.rate);
  const operators = c.operators === undefined || c.operators === null ? null : Array.from(c.operators);
  return { name: c.name, rate: c.rate, operators };
}
function makeSubscription(s, r) {
  needText(s.operator, r.why.sub_operator, r);
  need(isNum(s.rate) && s.rate > 0 && s.rate < 1, r.why.rate + s.rate);
  return { operator: s.operator, rate: s.rate, excluded_rest_area_ids: Array.from(s.excluded_rest_area_ids || []) };
}
export function makeUser(u, r) {
  const o = u || {};
  return {
    subscription: o.subscription === undefined || o.subscription === null ? null : makeSubscription(o.subscription, r),
    cards: (o.cards || []).map((c) => makeCard(c, r)),
  };
}

// ---------- p2 driving_range ----------
export function conservative_range_km(v, r) {
  return v.soc_pct / r.pct * v.battery_kwh * v.efficiency_km_per_kwh * (1 - v.safety_margin_ratio);
}
export function km_per_pct(v, r) {
  return v.battery_kwh * v.efficiency_km_per_kwh * (1 - v.safety_margin_ratio) / r.pct;
}
export function arrival_soc_pct(v, distance_km, r) {
  if (distance_km < 0) throw new ValueError(r.why.distance + distance_km);
  return v.soc_pct - distance_km / km_per_pct(v, r);
}
export function can_reach(v, distance_km, r) {
  return arrival_soc_pct(v, distance_km, r) >= v.min_arrival_soc_pct - r.tolerance;
}

// ---------- p3 status ----------
// 파이썬 f"{x:g}" 와 같은 모양(정수면 소수점 없이)
const fmtG = (x, r) => String(Number(Number(x).toPrecision(r.g_digits)));
const alertOf = (code, message) => ({ code, message });
export function summarize_station(station, now, stale_minutes, r) {
  if (stale_minutes < 0) throw new ValueError(r.why.stale + stale_minutes);
  const S = r.status;
  const counts = {};
  for (const s of statusOrder(r)) counts[s] = 0;
  let usable_fast = 0;
  let waiting_fast = 0;
  let usable_slow = 0;
  let unusable = 0;
  for (const c of station.chargers) {
    counts[c.status] += 1;
    if (r.unusable_statuses.includes(c.status)) {
      unusable += 1;
    } else if (c.type === r.charger_type.fast) {
      if (c.status === S.available) usable_fast += 1;
      else if (c.status === S.charging) waiting_fast += 1;
    } else if (c.status === S.available) {
      usable_slow += 1;
    }
  }
  const is_stale = now - station.status_updated_at > stale_minutes * r.ms_per_minute;
  const alerts = [];
  if (is_stale) alerts.push(alertOf(r.alert.stale_info, say(r.texts.stale_info, r, fmtG(stale_minutes, r))));
  if (unusable >= 1) alerts.push(alertOf(r.alert.unusable_chargers, say(r.texts.unusable_chargers, r, unusable)));
  return { counts, usable_fast, waiting_fast, usable_slow, unusable, is_stale, alerts };
}
export function rest_area_alerts(statuses, r) {
  let usable = 0;
  let fast = 0;
  for (const s of statuses) { usable += s.usable_fast + s.usable_slow; fast += s.usable_fast; }
  if (usable === 0) return [alertOf(r.alert.all_unavailable, r.texts.all_unavailable)];
  if (fast === 0) return [alertOf(r.alert.no_usable_fast, r.texts.no_usable_fast)];
  return [];
}

// ---------- p4 pricing ----------
export function quote(station, rest_area_id, user, charger_type, r) {
  if (!chargerTypes(r).includes(charger_type)) throw new ValueError(r.why.charger_type + charger_type);
  const base = station.price_per_kwh;
  const sub = user.subscription;
  const sub_ok = sub !== null
    && station.operator === sub.operator
    && charger_type === r.charger_type.fast
    && !sub.excluded_rest_area_ids.includes(rest_area_id);
  const cards = user.cards.filter((c) => c.operators === null || c.operators.includes(station.operator));
  // 후보: 구독 먼저, 그다음 카드 순서. 할인율이 엄격히 더 클 때만 교체하므로 동률은 앞선 것이 남는다.
  let best_name = null;
  let best_rate = 0;
  if (sub_ok) { best_name = r.subscription_word; best_rate = sub.rate; }
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
function station_entry(station, rest_area_id, detour_km, is_nearby, rest_remaining_km, vehicle, user, now, stale_minutes, r) {
  const status = summarize_station(station, now, stale_minutes, r);
  const remaining = rest_remaining_km + detour_km;
  const reachable = can_reach(vehicle, remaining, r);
  const alerts = status.alerts.slice();
  if (is_nearby && !reachable) alerts.push(alertOf(r.alert.unreachable, r.texts.unreachable));
  return {
    station_id: station.id,
    operator: station.operator,
    is_nearby,
    detour_km,
    remaining_km: remaining,
    arrival_soc_pct: arrival_soc_pct(vehicle, remaining, r),
    reachable,
    status,
    quote: quote(station, rest_area_id, user, r.charger_type.fast, r),
    is_candidate: reachable && status.usable_fast >= 1,
    alerts,
    role: null,
  };
}

export function build_route_list(route, vehicle, user, now, position_km, stale_minutes, r) {
  if (position_km < 0) throw new ValueError(r.why.position + position_km);
  const order = statusOrder(r);
  const entries = [];
  for (const ra of route.rest_areas) {
    const remaining = ra.distance_km - position_km;
    if (remaining < 0) continue;
    const reachable = can_reach(vehicle, remaining, r);
    const inner = ra.stations.map((s) => station_entry(s, ra.id, 0, false, remaining, vehicle, user, now, stale_minutes, r));
    const near = ra.nearby.map((n) => station_entry(n.station, ra.id, n.detour_km, true, remaining, vehicle, user, now, stale_minutes, r));

    const operators = [];
    for (const e of inner) if (!operators.includes(e.operator)) operators.push(e.operator);
    const applied_cards = new Set();
    for (const e of inner) for (const name of e.quote.applicable_cards) applied_cards.add(name);
    const counts = {};
    for (const s of order) counts[s] = 0;
    for (const e of inner) for (const s of order) counts[s] += e.status.counts[s];
    const prices = inner.filter((e) => e.status.usable_fast >= 1).map((e) => e.quote.final_price);

    const alerts = [];
    if (!reachable) alerts.push(alertOf(r.alert.unreachable, r.texts.unreachable));
    alerts.push(...rest_area_alerts(inner.map((e) => e.status), r));

    let usable_fast = 0;
    let waiting_fast = 0;
    for (const e of inner) { usable_fast += e.status.usable_fast; waiting_fast += e.status.waiting_fast; }
    entries.push({
      rest_area_id: ra.id,
      name: ra.name,
      distance_km: ra.distance_km,
      remaining_km: remaining,
      arrival_soc_pct: arrival_soc_pct(vehicle, remaining, r),
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
// 점수 = 빈 급속 수 단계 + 도착 여유 단계 + 신선함(규칙 r.score)
export function score_candidate(entry, vehicle, r) {
  const sc = r.score;
  const usable = entry.status.usable_fast;
  const c = usable <= sc.usable_low ? 0 : usable === sc.usable_mid ? 1 : sc.usable_top_points;
  const margin = entry.arrival_soc_pct - vehicle.min_arrival_soc_pct;
  const m = margin < sc.margin_low ? 0 : margin < sc.margin_mid ? 1 : sc.margin_top_points;
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
export function recommend(route_list, vehicle, r) {
  // 안 충전소 → 나들목 인근, 휴게소 순서대로 (입력 순서가 동률의 기준)
  const all = [];
  for (const ra of route_list.entries) for (const e of [...ra.stations, ...ra.nearby]) all.push([ra, e]);
  for (const [, e] of all) e.role = null;

  const ranked = all.filter(([, e]) => e.is_candidate).map(([ra, e]) => ({ ra, e, score: score_candidate(e, vehicle, r) }));
  // Array.prototype.sort 는 안정 정렬 (파이썬 sort 와 같다)
  ranked.sort((a, b) => (b.score - a.score)
    || (a.e.quote.final_price - b.e.quote.final_price)
    || (a.e.remaining_km - b.e.remaining_km)
    || ((a.e.is_nearby ? 1 : 0) - (b.e.is_nearby ? 1 : 0)));

  if (ranked.length === 0) {
    return { status: r.reco.none, primary: null, backup: null, alerts: [alertOf(r.alert.no_safe_station, r.texts.no_safe_station)] };
  }
  const { ra: p_ra, e: p_entry, score: p_score } = ranked[0];
  p_entry.role = r.roles.primary;
  const primary = pick(p_ra, p_entry, p_score);

  const round_trip_pct = p_entry.detour_km / km_per_pct(vehicle, r);
  let backup = null;
  for (const { ra, e, score } of ranked.slice(1)) {
    if (ra.rest_area_id === p_ra.rest_area_id) continue;
    if (!(ra.remaining_km > p_ra.remaining_km)) continue;
    if (e.arrival_soc_pct - round_trip_pct + r.tolerance < vehicle.min_arrival_soc_pct) continue;
    e.role = r.roles.backup;
    backup = pick(ra, e, score);
    break;
  }
  const alerts = backup ? [] : [alertOf(r.alert.no_backup, r.texts.no_backup)];
  return { status: r.reco.ok, primary, backup, alerts };
}

// ---------- p7 planner ----------
// 입력은 보통 객체(JSON). 여기서 검사하고 계산한다.
export function plan(route, vehicle, user, now, position_km, stale_minutes, r) {
  const rt = makeRoute(route, r);
  const v = makeVehicle(vehicle, r);
  const u = makeUser(user, r);
  const route_list = build_route_list(rt, v, u, now, position_km, stale_minutes, r);
  const recommendation = recommend(route_list, v, r);
  return { route_list, recommendation };
}
