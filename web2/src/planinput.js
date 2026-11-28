// 순수: 엔진 입력 만들기와 목록·추천 셈(설계 5-1 planinput — 옛 앱 app.js 125~211 inputs() 를 옮김 · 5-1-나 '추천 계산은 StateCalc 가 Engine 에 시켜 plan 으로').
// 셋으로 나눈다:
//   routeFromRelay — 중계 자료(충전소 목록·선·충전기 상태)를 옛 앱의 노선 꼴(휴게소 · 충전소 · 충전기)로. 휴게소 묶음·km·방향은 Ahead.places 와 같은 셈
//   inputs         — 노선 꼴 + 내 차·할인(my) + 내가 확인한 값(mine) → 엔진 입력(옛 inputs() 와 같은 차례: 나들목 인근 거르기·내 값 덮기·높이 거르기·빈 나들목 빼기)
//   planOf         — StateCalc 표 한 줄: (입력 조각들, 같은 셈의 앞 결과 done(pos·ahead), 규칙 r = config_planinput, lib, 내 앞 결과) → plan 조각
// (추가4) '내 차'의 나들목 인근 충전소 포함 칸이 켜져 있으면 routeFromRelay 가 나들목 자료(ramps — 순수 모듈 ramps.attach)를 휴게소 아래 nearby·나들목 항목으로 붙인다(옛 앱 노선 꼴 그대로 — 엔진은 옛 셈 그대로 왕복 거리를 더함).
// 충전기 상태를 모르는 것('모름')은 빈자리로 세지 않는다(엔진에는 er.status[r.state_status.unknown] 으로 — 상태 이름은 config_engine.status 한 곳 — 아는 척 추천하지 않음), 몇 대인지 따로 돌려준다. 로그 없음, 틀린 입력은 던진다.
export const NEEDS = [];

const lenCache = new WeakMap();

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function lineLen(line, geo, g) {
  const hit = lenCache.get(line);
  if (hit !== undefined) return hit;
  let m = 0;
  for (let i = 1; i < line.points.length; i += 1) {
    const a = line.points[i - 1];
    const b = line.points[i];
    m += geo.distM({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] }, g);
  }
  const km = m / g.m_per_km;
  lenCache.set(line, km);
  return km;
}

// 선 방향이면 km 그대로, 거꾸로면 (선 길이 − km) — 엔진의 '노선 첫머리부터 거리'
function along(km, dir, len, rl) {
  return dir === rl.dir_words.forward ? km : len - km;
}

// input = {stations, relay, line(선 이름), dir(진행 방향 낱말), ramps?(이 선의 나들목 줄 — 있으면 나들목 인근 충전소를 붙임)} → {route: 옛 노선 꼴, unknown: {충전소 id: 모르는 충전기 수}, at: {id: 상태 시각 ms | null}, known: 상태를 아는 충전기 수, len, names: {id: 이름}, ramp_at: {id: 나들목 정보 날짜 ms}, ic_shown: 붙은 나들목 인근 충전소 수}
export function routeFromRelay(input, r, lib) {
  const ra = lib.rules[r.ahead_rule];
  const rl = lib.rules[ra.locate_rule];
  const rr = lib.rules[r.read_rule];
  const rf = lib.rules[r.fresh_rule];
  const t = lib.rules[r.time_rule];
  const g = lib.rules[r.geo_rule];
  const er = lib.rules[r.engine_rule];
  const P = lib.parts;
  const geo = P[r.geo_part];
  if (!ra || !rl || !rr || !rf || !t || !g || !er || !geo) throw new TypeError(r.ahead_rule);
  const st = input.stations;
  const lines = Array.isArray(st && st[ra.lines_key]) ? st[ra.lines_key] : [];
  const line = lines.find((x) => x.name === input.line);
  if (!line) throw new TypeError(r.why.line);
  const len = lineLen(line, geo, g);
  const byId = new Map((st[ra.list_key] || []).map((s) => [s.id, s]));
  const zones = input.relay && input.relay.zones ? input.relay.zones : {};
  const unknown = {};
  const at = {};
  let known = 0;
  let liveAt = 0;
  const picked = P[r.ahead_part].places(st, ra, lib)
    .filter((p) => p.rest && p.line === input.line && isNum(p.km) && (p.dir === input.dir || (p.dir === null && ra.dir_unknown_keep)))
    .map((p) => ({ p, d: along(p.km, input.dir, len, rl) }))
    .filter((x) => x.d >= 0)
    .sort((a, b) => a.d - b.d);
  const names = {};
  const mapStation = (s) => {
    const zone = zones[s.zscode] || null;
    const rows = P[r.read_part].rows(s, zone, rr);
    const ms = zone ? P[r.fresh_part].kstMs(zone.at, rf, t, P[r.time_part]) : null;
    at[s.id] = ms;
    if (ms !== null && ms > liveAt) liveAt = ms;
    let n = 0;
    const chargers = rows.map((row) => {
      if (row.state === rr.unknown_state) n += 1; else known += 1;
      return {
        type: Object.prototype.hasOwnProperty.call(r.type_map, row.type) ? r.type_map[row.type] : r.type_unknown,
        power_kw: isNum(row.kw) && row.kw > 0 ? row.kw : r.unknown_kw,
        status: er.status[r.state_status[row.state] || r.state_status[rr.unknown_state]],
      };
    });
    unknown[s.id] = n;
    names[s.id] = s.name;
    return { id: s.id, operator: s.operator || r.unknown_operator, name: s.name, indoor: s.indoor === true, price: r.default_price, updated: ms === null ? 0 : ms, chargers };
  };
  const base_areas = picked.map(({ p, d }) => ({
    id: p.key,
    name: p.name,
    km: d,
    stations: p.ids.map((id) => byId.get(id)).filter(Boolean).map(mapStation),
    nearby: [],
  })).filter((a) => a.stations.length);
  // (추가4) 나들목 인근 충전소 — 켜져 있고 자료가 온 때만(input.ramps = 이 선의 검사된 나들목 줄)
  let rest_areas = base_areas;
  let icShown = 0;
  const rampAt = {};
  if (Array.isArray(input.ramps)) {
    const RP = P[r.ramps_part];
    const rrule = lib.rules[r.ramps_rule];
    if (!RP || !rrule) throw new TypeError(r.ramps_rule);
    const got = RP.attach(base_areas, input.ramps, {
      dir: input.dir,
      ic_kind: r.ic_kind,
      along: (km) => along(km, input.dir, len, rl),
      station: (id, when) => {
        const s = byId.get(id);
        if (!s) return null;
        const made = mapStation(s);
        const ms = typeof when === 'string' ? P[r.fresh_part].kstMs(when, rf, t, P[r.time_part]) : null;
        if (ms !== null) rampAt[id] = ms;
        return made;
      },
    }, rrule);
    rest_areas = got.areas;
    icShown = got.shown;
  }
  const fwd = input.dir === rl.dir_words.forward;
  const words = ra.line_dir_words[line.name];
  const word = words ? (fwd ? words.forward : words.backward)[0] : null;
  const dirText = word ? word + r.dir_suffix : (fwd ? (line.direction || r.dir_text.forward) : r.dir_text.backward);
  return { route: { key: line.name, highway: line.highway || line.name, direction: dirText, live_at: liveAt, rest_areas }, unknown, at, known, len, names, ramp_at: rampAt, ic_shown: icShown };
}

// 옛 노선 꼴 + my + mine → 엔진 입력(옛 inputs() 와 같은 차례). my = 내 차·할인(config_ui_my 의 칸 이름), soc = 지금 배터리 %
export function inputs(raw, my, soc, mine, now, r, er, lib) {
  const M = lib.parts[r.mine_part];
  const vehicle = {
    soc_pct: soc, battery_kwh: my.battery, efficiency_km_per_kwh: my.eff,
    safety_margin_ratio: my.margin / er.pct, min_arrival_soc_pct: my.min_arrival,
  };
  const user = {
    subscription: my.sub_op ? {
      operator: my.sub_op, rate: my.sub_rate / er.pct,
      excluded_rest_area_ids: my.sub_private ? raw.rest_areas.filter((a) => r.private_words.some((w) => a.name.includes(w))).map((a) => a.id) : [],
    } : null,
    cards: my.card_name.trim() ? [{ name: my.card_name.trim(), rate: my.card_rate / er.pct, operators: null }] : [],
  };
  const copy = (s) => ({ id: s.id, operator: s.operator, chargers: s.chargers.map((c) => ({ ...c })), price_per_kwh: s.price, status_updated_at: s.updated });
  const route = {
    highway: raw.highway,
    direction: raw.direction,
    rest_areas: raw.rest_areas.map((a) => ({
      id: a.id, name: a.name, distance_km: a.km,
      stations: a.stations.map(copy),
      nearby: (a.nearby || []).map((n) => ({ station: copy(n.station), detour_km: n.detour })),
    })),
  };
  const liveAt = isNum(raw.live_at) ? raw.live_at : 0;
  const tall = my.height > 0;
  const indoor = new Set();
  for (const a of raw.rest_areas) for (const n of a.nearby || []) if (n.station.indoor) indoor.add(n.station.id);
  const blocked = new Set();
  let hidden = 0;
  for (const a of route.rest_areas) {
    if (tall) { // 탑차·윙바디: 건물 안·지하 충전소는 보이지 않게
      const before = a.nearby.length;
      a.nearby = a.nearby.filter((n) => !indoor.has(n.station.id));
      hidden += before - a.nearby.length;
    }
    a.nearby = a.nearby.slice(0, r.nearby_show);
    for (const st of [...a.stations, ...a.nearby.map((n) => n.station)]) {
      M.applyMine(st, liveAt, mine);
      const limit = M.heightLimit(st.id, mine);
      if (tall && limit > 0 && limit < my.height) { // 내 차가 못 들어가는 곳: 추천에서 빠지게 못 쓰는 것으로
        blocked.add(st.id);
        for (const c of st.chargers) c.status = er.status[r.blocked_status];
      }
    }
  }
  const icIds = new Set(raw.rest_areas.filter((a) => a.kind === r.ic_kind).map((a) => a.id));
  route.rest_areas = route.rest_areas.filter((a) => !(icIds.has(a.id) && a.nearby.length === 0));
  return { route, vehicle, user, now, blocked: [...blocked], indoor: [...indoor], hidden_indoor: hidden };
}

// StateCalc 표 한 줄 → plan = {t, state, seq, ...} (state 가 r.states.ok 일 때만 result 가 있다)
export function planOf(inp, done, r, lib, own) {
  const req = inp[r.request_input];
  if (!req || req.open !== true) return null;
  const base = { t: req.at, seq: req.seq, soc: req.soc };
  const my = inp[r.my_input];
  if (!my) return { ...base, state: r.states.need_my };
  if (!isNum(req.soc) || req.soc < r.soc_min || req.soc > r.soc_max) return { ...base, state: r.states.bad_soc };
  const st = inp[r.stations_input];
  const pos = done[r.pos_piece];
  if (!st || !pos || !pos.on_line || !pos.line) return { ...base, state: r.states.off_line };
  const ah = done[r.ahead_piece];
  const dir = pos.dir || (ah && ah.line === pos.line ? ah.dir : null);
  if (!dir) return { ...base, state: r.states.no_dir, line: pos.line };
  const er = lib.rules[r.engine_rule];
  const mr = lib.rules[r.mine_rule];
  const E = lib.parts[r.engine_part];
  const M = lib.parts[r.mine_part];
  const rl = lib.rules[lib.rules[r.ahead_rule].locate_rule];
  // (추가4) 나들목 인근 충전소: 켜져 있으면 자료 상태를 보고(아직 받는 중·없음·끊김이면 짐작하지 않고 그 상태만 알림), 자료가 있으면 붙임
  const icOn = my[r.ic_on_key] === true;
  const RS = lib.rules[r.ramps_rule] ? lib.rules[r.ramps_rule].states : null;
  const rp = inp[r.ramps_input];
  let icState = null;
  let rampList;
  if (icOn) {
    if (!RS) throw new TypeError(r.ramps_rule);
    if (!rp) icState = RS.wait;
    else if (rp.state !== RS.ok) icState = rp.state;
    else {
      const byLine = rp[lib.rules[r.ramps_rule].lines_key];
      if (byLine && Array.isArray(byLine[pos.line])) { rampList = byLine[pos.line]; icState = RS.ok; } else icState = RS.none;
    }
  }
  const got = routeFromRelay({ stations: st, relay: inp[r.relay_input], line: pos.line, dir, ramps: rampList }, r, lib);
  const mine = M.normalize({ ops: my.ops, stations: my.stations });
  const fix = inp[r.fix_input];
  const now = fix && isNum(fix.t) ? fix.t : req.at;
  const made = inputs(got.route, my, req.soc, mine, now, r, er, lib);
  const position = Math.max(0, along(pos.km, dir, got.len, rl));
  const result = E.plan(made.route, made.vehicle, made.user, now, position, my.stale, er);
  const v = E.makeVehicle(made.vehicle, er);
  const labels = {};
  const heights = {};
  for (const a of got.route.rest_areas) {
    for (const s of [...a.stations, ...a.nearby.map((n) => n.station)]) {
      labels[s.operator] = M.opLabel(s.operator, mine, mr);
      heights[s.id] = M.heightLimit(s.id, mine);
    }
  }
  return {
    ...base,
    t: now,
    state: r.states.ok,
    line: pos.line,
    dir,
    highway: got.route.highway,
    direction: got.route.direction,
    pos_km: position,
    safe_km: E.conservative_range_km(v, er) - v.min_arrival_soc_pct * E.km_per_pct(v, er),
    min_arrival: my.min_arrival,
    margin: my.margin,
    height: my.height,
    sub_op: my.sub_op,
    result,
    unknown: got.unknown,
    known: got.known,
    at: got.at,
    names: got.names,
    ramp_at: got.ramp_at,
    ic: { on: icOn, state: icState, shown: got.ic_shown },
    labels,
    heights,
    blocked: made.blocked,
    hidden_indoor: made.hidden_indoor,
  };
}
