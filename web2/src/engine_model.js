// 순수: 충전소 고르기 엔진의 한 조각(정비 나 ③ — engine.js 를 일 단위로 나눔. 본문은 옛 engine.js 그대로, 계산 차례·부동소수 결과 같음). 로그 없음.
// 일: 입력 검사·만들기(p1 — 충전기·충전소·휴게소·노선·차·카드·구독·사용자) + 조각들이 함께 쓰는 작은 도구(틀림 던지기·알림 꼴·글 채우기).
export const NEEDS = [];

export class ValueError extends Error {
  constructor(message) {
    super(message);
    this.name = r_name;
  }
}
const r_name = 'ValueError';

export function need(cond, message) {
  if (!cond) throw new ValueError(message);
}
function needText(value, label, r) {
  need(typeof value === 'string' && value !== '', label + r.why.text);
}
export const isNum = (x) => typeof x === 'number' && !Number.isNaN(x);
export const say = (tpl, r, v) => tpl.split(r.n_mark).join(String(v));
// 파이썬 f"{x:g}" 와 같은 모양(정수면 소수점 없이)
export const fmtG = (x, r) => String(Number(Number(x).toPrecision(r.g_digits)));
export const alertOf = (code, message) => ({ code, message });

export function chargerTypes(r) { return Object.values(r.charger_type); }
export function statusOrder(r) { return r.status_order; }

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
