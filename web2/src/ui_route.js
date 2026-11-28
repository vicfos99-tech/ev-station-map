// RouteScreen(목록·추천 칸 — 화면, 설계 5-1 ui_route · 5-1-나 알림 표 plan.request · plan · station.select.list — 옛 앱 app.js 213~475 를 옮김).
// 아래 띠의 '목록' 단추로 열고 닫는다. 칸은 운전 화면 가운데 칸(지도 아래)에 흐름으로 들어간다(떠 있는 겹이 아님 — 판·지도 저작권·아래 띠를 덮지 않음).
// **그리기만 한다**: 지금 배터리 %(FormCheck)를 plan.request 로 내고, CalcRunner 가 낸 plan(엔진 결과)을 그린다 — 머리(고속도로·방향·안전 거리), 추천(1순위·예비),
// 휴게소 줄(남은 거리·도착 %·빈 급속·충전 중·고장·최저 요금·상태 모름·받은 때). 줄을 누르면 station.select.list(정보 칸이 연다).
// (추가4) '내 차'의 나들목 인근 충전소 포함이 켜져 있으면: 1순위·예비 줄에 '나들목 왕복 +n km'(+자료에 날짜가 있으면 '○일 전 정보·도착 전 다시 확인'), 나들목 항목·나들목 인근이 붙은 휴게소 줄에
// '나들목 인근 급속 n곳'과 펼치기/접기(펼치면 충전소 줄 — 누르면 정보 칸), 자료가 없거나 받는 중이면 한 줄(짐작하지 않음).
// 열려 있는 동안 그 노선 충전소 id 들을 route.watch 로 알린다(상태 받기가 그 시군구만 받음). 계산·판단은 하지 않는다. 글·자리는 config_ui_route.
export const NEEDS = ['cfg', 'log', 'state', 'doc', 'clock', 'formcheck', 'relay_fresh'];

export function createRouteScreen(deps) {
  const cfg = deps.cfg;
  const c = cfg.section('config_ui_route');
  const fr = cfg.section('config_formcheck').fields;
  const rf = cfg.section('config_relay_fresh');
  const er = cfg.section('config_engine');
  const rs = cfg.section('config_relay_ramps').states;
  const h = cfg.section('config_health');
  const log = deps.log;
  const doc = deps.doc;
  const x = c.texts;
  const pub = deps.state.claim(c.owner, [c.request_piece, c.select_piece, c.watch_piece, c.panel_piece]);
  let open = false;
  let soc = c.soc_default;
  let seq = 0;
  let plan = null;
  let watched = '';
  let draws = 0;
  const openKeys = new Set();

  const $ = (id) => {
    const el = doc.getElementById(id);
    if (!el) throw new Error(id);
    return el;
  };
  function make(tag, cls, text) {
    const e = doc.createElement(tag);
    e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function fill(tpl, vals) {
    return tpl.replace(new RegExp(c.slot_re, 'g'), (m, k) => (vals[k] === undefined || vals[k] === null ? '' : String(vals[k])));
  }
  const km = (v) => fill(x.km, { n: Math.round(v * c.km_round) / c.km_round });
  const pct = (v) => fill(x.pct, { n: Math.round(v) });
  const won = (v) => fill(x.won, { n: Math.round(v) });
  function chip(text, tone) {
    const e = make(c.tags.part, c.classes.chip, text);
    if (tone) e.setAttribute(c.attrs.tone, tone);
    return e;
  }

  function ask() {
    seq += 1;
    pub(c.request_piece, { open, soc, seq, at: deps.clock.now() });
  }

  function setSoc(raw) {
    const res = deps.formcheck.field(raw, fr[c.soc_field]);
    $(c.ids.soc_err).textContent = res.ok ? '' : (x.why[res.why] || x.why_default);
    if (!res.ok) { log.info(c.where, c.word_bad_soc, { why: res.why }); return; }
    soc = res.value;
    $(c.ids.soc).value = String(soc);
    ask();
  }

  function setOpen(v) {
    open = v;
    $(c.ids.root).hidden = !open;
    $(c.ids.open).setAttribute(c.attrs.pressed, open ? c.yes : c.no);
    pub(c.panel_piece, { open });
    if (!open) { watched = ''; pub(c.watch_piece, null); }
    $(c.ids.soc).value = String(soc);
    ask();
    log.info(c.where, open ? c.word_open : c.word_close, { soc });
  }

  // 상태 받은 때 글: 모름 / ○분 전 정보(오래됐으면 주의 모양)
  function ageChip(id, stale) {
    const at = plan.at ? plan.at[id] : null;
    if (at === null || at === undefined) return chip(x.age_unknown, c.tones.warn);
    const a = deps.relay_fresh.agoText(Math.max(0, plan.t - at), rf);
    return chip(fill(x.age, { ago: a }), stale ? c.tones.warn : null);
  }

  // 엔진의 경고 코드를 읽을 말로(옛 areaChips 와 같은 차례) + 상태 모름 수
  function areaChips(e) {
    const out = [];
    const codes = e.alerts.map((a) => a.code);
    const A = er.alert;
    const unknown = e.stations.reduce((n, s) => n + (plan.unknown[s.station_id] || 0), 0);
    if (codes.includes(A.unreachable)) out.push(chip(x.cant_reach, c.tones.bad));
    if (codes.includes(A.all_unavailable)) {
      out.push(e.waiting_fast > 0 ? chip(fill(x.no_free_wait, { n: e.waiting_fast }), c.tones.warn) : chip(unknown ? x.no_known_free : x.none_usable, unknown ? c.tones.warn : c.tones.bad));
    } else if (codes.includes(A.no_usable_fast)) {
      out.push(chip(e.waiting_fast > 0 ? fill(x.no_fast_wait, { n: e.waiting_fast }) : x.no_fast_slow, c.tones.warn));
    } else {
      out.push(chip(fill(x.free_fast, { n: e.usable_fast }), c.tones.good));
      if (e.waiting_fast > 0) out.push(chip(fill(x.busy_fast, { n: e.waiting_fast })));
    }
    const S = e.status_counts;
    const broken = er.unusable_statuses.reduce((n, k) => n + (S[k] || 0), 0) - unknown;
    if (broken > 0) out.push(chip(fill(x.broken, { n: broken }), c.tones.warn));
    if (unknown > 0) out.push(chip(fill(x.unknown, { n: unknown }), c.tones.warn));
    if (e.lowest_price !== null) out.push(chip(fill(x.lowest, { price: won(e.lowest_price) })));
    return out;
  }

  function findEntry(id) {
    for (const ra of plan.result.route_list.entries) for (const s of [...ra.stations, ...ra.nearby]) if (s.station_id === id) return s;
    return null;
  }

  // 나들목 자료에 날짜가 있으면 '○일 전 정보 · 도착 전 다시 확인'(정한 일 수 아래면 안 보임). 날짜가 없으면 null
  function rampChip(id) {
    const at = plan.ramp_at ? plan.ramp_at[id] : null;
    if (at === null || at === undefined) return null;
    const days = Math.floor(Math.max(0, plan.t - at) / c.ramp_day_ms);
    return days >= c.ramp_age_min_days ? chip(fill(x.ramp_age, { n: days }), c.tones.warn) : null;
  }

  function pickEl(p, role) {
    const s = findEntry(p.station_id);
    const box = make(c.tags.block, c.classes.pick);
    box.setAttribute(c.attrs.role, role);
    box.appendChild(make(c.tags.part, c.classes.pick_role, role === er.roles.primary ? x.primary : x.backup));
    const head = make(c.tags.block, c.classes.pick_head);
    head.appendChild(make(c.tags.part, c.classes.pick_name, p.rest_area_name));
    head.appendChild(make(c.tags.part, c.classes.pick_dist, km(p.remaining_km)));
    box.appendChild(head);
    const q = s.quote;
    const price = q.applied !== null && q.final_price !== q.base_price ? fill(x.price_off, { base: won(q.base_price), final: won(q.final_price) }) : fill(x.price, { final: won(q.final_price) });
    const opText = plan.labels[p.operator] || p.operator;
    box.appendChild(make(c.tags.part, c.classes.pick_sub, p.is_nearby
      ? fill(x.pick_sub_near, { name: (plan.names && plan.names[p.station_id]) || p.station_id, op: opText, price })
      : fill(x.pick_sub, { op: opText, price })));
    const facts = make(c.tags.block, c.classes.chips);
    if (p.is_nearby) facts.appendChild(chip(fill(x.detour, { km: km(p.detour_km) }), c.tones.warn));
    const rc = rampChip(p.station_id);
    if (rc && p.is_nearby) facts.appendChild(rc);
    facts.appendChild(chip(fill(x.arrive, { pct: pct(p.arrival_soc_pct) }), p.arrival_soc_pct - plan.min_arrival < c.arrive_warn_pct ? c.tones.warn : c.tones.good));
    facts.appendChild(chip(fill(x.free_fast, { n: s.status.usable_fast }), c.tones.good));
    facts.appendChild(chip(fill(x.score, { dots: c.dot_on.repeat(p.score) + c.dot_off.repeat(Math.max(0, c.score_max - p.score)) })));
    if (q.applied) facts.appendChild(chip(q.applied === er.subscription_word ? x.sub_applied : fill(x.card_applied, { name: q.applied })));
    facts.appendChild(ageChip(p.station_id, s.status.is_stale));
    if (s.status.unusable && !plan.unknown[p.station_id]) facts.appendChild(chip(fill(x.broken, { n: s.status.unusable }), c.tones.warn));
    box.appendChild(facts);
    return box;
  }

  function noneEl(head, body, tone) {
    const box = make(c.tags.block, c.classes.none);
    if (tone) box.setAttribute(c.attrs.tone, tone);
    box.appendChild(make(c.tags.part, c.classes.none_head, head));
    box.appendChild(make(c.tags.part, c.classes.none_body, body));
    return box;
  }

  // 나들목 인근 충전소 한 줄: 이름 · 왕복 거리 · 빈 급속 · 요금 · (자료 날짜) — 누르면 정보 칸
  function nearEl(s, e, dir) {
    const row = make(c.tags.row, c.classes.near_row);
    row.setAttribute(c.attrs.key, s.station_id);
    const head = make(c.tags.block, c.classes.stop_head);
    head.appendChild(make(c.tags.part, c.classes.stop_name, (plan.names && plan.names[s.station_id]) || s.station_id));
    head.appendChild(make(c.tags.part, c.classes.stop_soc, fill(x.arrive_short, { pct: pct(s.arrival_soc_pct) })));
    row.appendChild(head);
    const chips = make(c.tags.block, c.classes.chips);
    chips.appendChild(chip(fill(x.detour, { km: km(s.detour_km) }), c.tones.warn));
    const unknown = plan.unknown[s.station_id] || 0;
    if (s.status.usable_fast > 0) chips.appendChild(chip(fill(x.free_fast, { n: s.status.usable_fast }), c.tones.good));
    else chips.appendChild(chip(unknown ? x.no_known_free : x.no_fast_short, unknown ? c.tones.warn : c.tones.bad));
    if (unknown > 0) chips.appendChild(chip(fill(x.unknown, { n: unknown }), c.tones.warn));
    chips.appendChild(chip(fill(x.lowest, { price: won(s.quote.final_price) })));
    chips.appendChild(chip(plan.labels[s.operator] || s.operator));
    const rc = rampChip(s.station_id);
    if (rc) chips.appendChild(rc);
    row.appendChild(chips);
    row.addEventListener(c.click_event, (ev) => {
      ev.stopPropagation();
      try {
        pub(c.select_piece, { key: e.rest_area_id, ids: [s.station_id], name: (plan.names && plan.names[s.station_id]) || e.name, dir });
        log.info(c.where, c.word_select, { key: e.rest_area_id, near: s.station_id });
      } catch (err) {
        log.error(err, { where: c.where, params: { act: c.act_select } });
      }
    });
    return row;
  }

  function stopEl(e, dir) {
    const li = make(c.tags.row, c.classes.stop);
    const all = [...e.stations, ...e.nearby];
    const isIc = e.stations.length === 0;
    const role = all.some((s) => s.role === er.roles.primary) ? er.roles.primary : all.some((s) => s.role === er.roles.backup) ? er.roles.backup : null;
    if (role) li.setAttribute(c.attrs.role, role);
    li.setAttribute(c.attrs.reach, String(e.reachable));
    li.setAttribute(c.attrs.key, e.rest_area_id);
    if (isIc) li.setAttribute(c.attrs.ic, c.yes);
    const head = make(c.tags.block, c.classes.stop_head);
    head.appendChild(make(c.tags.part, c.classes.stop_km, km(e.remaining_km)));
    head.appendChild(make(c.tags.part, c.classes.stop_name, e.name));
    const socEl = make(c.tags.part, c.classes.stop_soc, fill(x.arrive_short, { pct: pct(e.arrival_soc_pct) }));
    socEl.setAttribute(c.attrs.low, String(e.arrival_soc_pct < plan.min_arrival));
    head.appendChild(socEl);
    li.appendChild(head);
    const chips = make(c.tags.block, c.classes.chips);
    const open = openKeys.has(e.rest_area_id);
    if (!isIc) for (const ch of areaChips(e)) chips.appendChild(ch);
    if (e.nearby.length) chips.appendChild(chip(fill(x.near_count, { n: e.nearby.length }), isIc ? null : c.tones.warn));
    if (isIc && open) chips.appendChild(chip(x.near_rough));
    li.appendChild(chips);
    if (!isIc) li.appendChild(make(c.tags.block, c.classes.stop_ops, e.operators.map((op) => plan.labels[op] || op).join(x.ops_sep)));
    const flip = () => {
      if (openKeys.has(e.rest_area_id)) openKeys.delete(e.rest_area_id); else openKeys.add(e.rest_area_id);
      log.info(c.where, c.word_flip, { key: e.rest_area_id, open: openKeys.has(e.rest_area_id) });
      try { draw(); } catch (err) { log.error(err, { where: c.where, params: { act: c.act_draw } }); }
    };
    if (e.nearby.length) {
      const tg = make(c.tags.button, c.classes.toggle, open ? x.near_close : x.near_open);
      tg.setAttribute(c.attrs.expanded, open ? c.yes : c.no);
      tg.addEventListener(c.click_event, (ev) => { ev.stopPropagation(); flip(); });
      li.appendChild(tg);
      if (open) {
        li.appendChild(make(c.tags.block, c.classes.near_label, x.near_label));
        for (const s of e.nearby) li.appendChild(nearEl(s, e, dir));
      }
    }
    li.addEventListener(c.click_event, () => {
      try {
        if (isIc) { flip(); return; }
        pub(c.select_piece, { key: e.rest_area_id, ids: e.stations.map((s) => s.station_id), name: e.name, dir });
        log.info(c.where, c.word_select, { key: e.rest_area_id });
      } catch (err) {
        log.error(err, { where: c.where, params: { act: c.act_select } });
      }
    });
    return li;
  }

  // '나들목 인근 충전소 포함'이 켜져 있을 때 자료 상태 한 줄(꺼져 있으면 빈 글 — 칸이 숨음)
  function icNote() {
    const ic = plan.ic;
    if (!ic || !ic.on) return '';
    if (ic.state === rs.ok) return ic.shown > 0 ? '' : x.ic_zero;
    return x.ic[ic.state] || x.ic.down;
  }

  function draw() {
    if (!open) return;
    draws += 1;
    const reco = $(c.ids.reco);
    const list = $(c.ids.list);
    const S = c.states;
    if (!plan || plan.state !== S.ok) {
      $(c.ids.head).textContent = x.title;
      $(c.ids.range).textContent = '';
      $(c.ids.ic).textContent = '';
      const st = plan ? plan.state : S.wait;
      reco.replaceChildren(noneEl(x.state_head[st] || x.state_head.wait, x.state_body[st] || x.state_body.wait, c.tones.warn));
      list.replaceChildren();
      return;
    }
    const res = plan.result;
    $(c.ids.head).textContent = fill(x.head, { highway: plan.highway, direction: plan.direction });
    $(c.ids.range).textContent = fill(x.range, { km: Math.max(0, Math.round(plan.safe_km)), margin: plan.margin, min: plan.min_arrival })
      + (plan.height > 0 ? fill(x.range_height, { h: plan.height, n: plan.blocked.length }) : '');
    $(c.ids.ic).textContent = icNote();
    const rec = res.recommendation;
    const box = [];
    const known = plan.known > 0;
    if (rec.status !== er.reco.ok) {
      box.push(known ? noneEl(x.no_safe_head, x.no_safe_body, c.tones.bad) : noneEl(x.no_status_head, x.no_status_body, c.tones.warn));
    } else {
      box.push(pickEl(rec.primary, er.roles.primary));
      if (rec.backup) box.push(pickEl(rec.backup, er.roles.backup));
      else box.push(noneEl(x.no_backup_head, x.no_backup_body, c.tones.warn));
    }
    reco.replaceChildren(...box);
    const entries = res.route_list.entries;
    if (!entries.length) { list.replaceChildren(make(c.tags.row, c.classes.empty, x.no_rest)); return; }
    const sorted = entries.slice(0, c.max_rows);
    list.replaceChildren(...sorted.map((e) => stopEl(e, plan.dir)));
    // 상태 받기: 이 노선 충전소 id 들(바뀔 때만)
    const ids = [];
    for (const e of sorted) for (const s of [...e.stations, ...e.nearby]) ids.push(s.station_id);
    const key = ids.join();
    if (key !== watched) { watched = key; pub(c.watch_piece, { ids }); }
  }

  try {
    const root = $(c.ids.root);
    const host = doc.getElementById(c.host_id);
    if (host) host.appendChild(root);
    else log.warn(c.where, c.word_no_host, { host: c.host_id });
    const more = doc.getElementById(c.more_id);
    if (more) more.insertBefore($(c.ids.open), more.firstChild || null);
    else log.warn(c.where, c.word_no_host, { host: c.more_id });
    $(c.ids.open).textContent = x.open;
    $(c.ids.close).textContent = x.close;
    $(c.ids.soc_label).textContent = x.soc_label;
    $(c.ids.minus).textContent = fill(x.minus, { n: c.soc_step });
    $(c.ids.plus).textContent = fill(x.plus, { n: c.soc_step });
    $(c.ids.soc).value = String(soc);
    $(c.ids.open).addEventListener(c.click_event, () => setOpen(!open));
    $(c.ids.close).addEventListener(c.click_event, () => setOpen(false));
    $(c.ids.soc).addEventListener(c.change_event, () => setSoc($(c.ids.soc).value));
    $(c.ids.minus).addEventListener(c.click_event, () => setSoc(String(Math.max(c.soc_min, soc - c.soc_step))));
    $(c.ids.plus).addEventListener(c.click_event, () => setSoc(String(Math.min(c.soc_max, soc + c.soc_step))));
  } catch (e) {
    log.error(e, { where: c.where, params: { act: c.act_init } });
  }

  deps.state.subscribe(c.app_piece, (v) => {
    if (!v || v.stage !== h.stages.good) return;
    try { $(c.ids.open).hidden = false; } catch (e) { log.error(e, { where: c.where, params: { act: c.act_init } }); }
  });
  deps.state.subscribe(c.plan_piece, (v) => {
    if (!open) return;
    plan = v || null;
    try { draw(); } catch (e) { log.error(e, { where: c.where, params: { act: c.act_draw, state: plan && plan.state } }); }
  });
  // 내 차 칸이 열리면 이 칸은 닫는다(가운데 칸에 칸 하나만)
  deps.state.subscribe(c.other_panel_piece, (v) => {
    try { if (v && v.open && open) setOpen(false); } catch (e) { log.error(e, { where: c.where, params: { act: c.act_init } }); }
  });
  return { setOpen, setSoc, isOpen: () => open, plan: () => plan, draws: () => draws };
}
