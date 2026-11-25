// MyScreen(내 차·할인 칸 — 화면, 설계 5-1 ui_my · 5-1-나 알림 표 `my` — 옛 앱 app.js 846~936 을 옮김).
// 아래 띠의 '내 차' 단추로 열고 닫는다. 칸은 운전 화면 가운데 칸(지도 아래)에 흐름으로 들어간다(떠 있는 겹이 아님 — 판·지도 저작권·아래 띠를 덮지 않음).
// 담는 것: 내 차(배터리 용량·전비·안전 여유·도착 때 남길 %·오래됨 기준·차 높이), 할인(구독 업체·할인·민자 제외, 카드 이름·할인), 업체(보일 이름·요금 — 받은 목록의 업체).
// '저장'을 누르면 칸마다 FormCheck(범위는 설정)로 보고, 틀리면 그 칸 아래 한 줄·저장 안 함. 맞으면 폰 데이터 폴더(Store 'my')에 쓰고 `my` 로 알린다.
// 켤 때 폰에 저장된 값을 읽어 `my` 로 알린다(없거나 판이 다르면 설정의 처음 값). 카카오·공공데이터 키 칸은 없다(설계 D 결정 3). 글·칸·처음 값은 config_ui_my.
export const NEEDS = ['cfg', 'log', 'state', 'store', 'doc', 'clock', 'timefmt', 'formcheck'];

export function createMyScreen(deps) {
  const cfg = deps.cfg;
  const c = cfg.section('config_ui_my');
  const fr = cfg.section('config_formcheck').fields;
  const t = cfg.section('config_time');
  const h = cfg.section('config_health');
  const log = deps.log;
  const doc = deps.doc;
  const x = c.texts;
  const pub = deps.state.claim(c.owner, [c.my_piece, c.panel_piece]);
  let my = { ...c.defaults, ops: {} };
  let ops = [];
  const inputs = {};
  const errs = {};
  let opRows = [];
  let saves = 0;

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

  // 칸 하나: 이름(+단위) · 입력 · 그 칸 아래 한 줄
  function fieldRow(f) {
    const row = make(c.tags.row, c.classes.row);
    const lab = make(c.tags.label, c.classes.label, f.unit ? fill(x.label_unit, { label: f.label, unit: f.unit }) : f.label);
    let input;
    if (f.kind === c.kinds.check) {
      input = make(c.tags.input, c.classes.check);
      input.type = c.types.check;
    } else if (f.kind === c.kinds.select) {
      input = make(c.tags.select, c.classes.input);
    } else {
      input = make(c.tags.input, c.classes.input);
      input.type = f.kind === c.kinds.num ? c.types.num : c.types.text;
      if (f.kind === c.kinds.num) input.setAttribute(c.attrs.mode, c.decimal_mode);
      if (f.hint) input.setAttribute(c.attrs.placeholder, f.hint);
    }
    input.setAttribute(c.attrs.key, f.key);
    const err = make(c.tags.part, c.classes.err, '');
    row.appendChild(lab);
    row.appendChild(input);
    row.appendChild(err);
    inputs[f.key] = input;
    errs[f.key] = err;
    return row;
  }

  function subOptions() {
    const sel = inputs[c.sub_key];
    const none = make(c.tags.option, '', x.sub_none);
    none.value = '';
    const list = [none];
    const names = [...new Set([...(my.sub_op ? [my.sub_op] : []), ...ops])];
    for (const op of names) {
      const o = make(c.tags.option, '', op);
      o.value = op;
      list.push(o);
    }
    sel.replaceChildren(...list);
    sel.value = my.sub_op || '';
  }

  // 업체 줄: 이름 · 보일 이름 · 요금(구독한 업체 먼저 — 옛 앱 liveOperators 차례)
  function opList() {
    const box = $(c.ids.ops);
    opRows = [];
    if (!ops.length) { box.replaceChildren(make(c.tags.part, c.classes.note, x.ops_none)); return; }
    const sorted = ops.slice().sort((a, b) => (b === my.sub_op) - (a === my.sub_op));
    box.replaceChildren(...sorted.map((op) => {
      const o = my.ops[op] || {};
      const row = make(c.tags.row, c.classes.op_row);
      row.setAttribute(c.attrs.op, op);
      row.appendChild(make(c.tags.part, c.classes.op_name, op));
      const alias = make(c.tags.input, c.classes.input);
      alias.type = c.types.text;
      alias.setAttribute(c.attrs.placeholder, x.alias_hint);
      alias.setAttribute(c.attrs.label, fill(x.alias_label, { op }));
      alias.value = typeof o.alias === 'string' ? o.alias : '';
      const price = make(c.tags.input, c.classes.input);
      price.type = c.types.num;
      price.setAttribute(c.attrs.mode, c.decimal_mode);
      price.setAttribute(c.attrs.placeholder, x.price_hint);
      price.setAttribute(c.attrs.label, fill(x.price_label, { op }));
      price.value = o.price > 0 ? String(o.price) : '';
      const err = make(c.tags.part, c.classes.err, '');
      row.appendChild(alias);
      row.appendChild(price);
      row.appendChild(err);
      opRows.push({ op, alias, price, err });
      return row;
    }));
  }

  function fillForm() {
    for (const f of c.fields) {
      const el = inputs[f.key];
      if (f.kind === c.kinds.check) el.checked = !!my[f.key];
      else if (f.kind !== c.kinds.select) el.value = f.empty_zero && !(my[f.key] > 0) ? '' : String(my[f.key]);
      errs[f.key].textContent = '';
    }
    subOptions();
    opList();
  }

  function whyText(why) {
    return x.why[why] || x.why_default;
  }

  // 칸마다 검사 → 모두 맞으면 새 값, 하나라도 틀리면 null(그 칸 아래 한 줄)
  function readForm() {
    const next = { ...my, ops: { ...my.ops } };
    let bad = 0;
    for (const f of c.fields) {
      const el = inputs[f.key];
      errs[f.key].textContent = '';
      if (f.kind === c.kinds.check) { next[f.key] = !!el.checked; continue; }
      if (f.kind === c.kinds.select) { next[f.key] = el.value || ''; continue; }
      const raw = typeof el.value === 'string' ? el.value : '';
      if (f.empty_zero && !raw.trim().length) { next[f.key] = 0; continue; }
      if (f.need_when && !next[f.need_when] && !String(inputs[f.need_when].value || '').trim()) { next[f.key] = my[f.key]; continue; }
      const res = deps.formcheck.field(raw, fr[f.field]);
      if (!res.ok) { errs[f.key].textContent = whyText(res.why); bad += 1; continue; }
      next[f.key] = res.value;
    }
    for (const r of opRows) {
      r.err.textContent = '';
      const a = deps.formcheck.field(r.alias.value || '', fr[c.op_alias_field]);
      const praw = (r.price.value || '').trim();
      const p = praw ? deps.formcheck.field(praw, fr[c.op_price_field]) : { ok: true, value: 0 };
      if (!a.ok || !p.ok) { r.err.textContent = whyText(!a.ok ? a.why : p.why); bad += 1; continue; }
      const entry = { alias: a.value };
      if (p.value > 0) entry.price = p.value;
      next.ops[r.op] = entry;
    }
    return bad ? null : next;
  }

  async function save() {
    try {
      const next = readForm();
      if (!next) { $(c.ids.note).textContent = x.fix_first; log.info(c.where, c.word_bad, {}); return; }
      const res = await deps.store.write(c.store_key, next);
      if (!res.ok) { $(c.ids.note).textContent = x.save_fail; return; }
      my = next;
      saves += 1;
      pub(c.my_piece, { ...my });
      $(c.ids.note).textContent = fill(x.saved, { time: deps.timefmt.format(deps.clock.now(), c.time_pattern, t) });
      log.info(c.where, c.word_saved, { keys: Object.keys(my).length, ops: Object.keys(my.ops).length });
      fillForm();
    } catch (e) {
      log.error(e, { where: c.where, params: { act: c.act_save } });
    }
  }

  function setOpen(open) {
    $(c.ids.root).hidden = !open;
    $(c.ids.open).setAttribute(c.attrs.pressed, open ? c.yes : c.no);
    if (open) { $(c.ids.note).textContent = ''; fillForm(); }
    pub(c.panel_piece, { open });
  }

  async function load() {
    try {
      const got = await deps.store.read(c.store_key);
      const v = got.ok && got.value && typeof got.value === 'object' ? got.value : null;
      my = v ? { ...c.defaults, ...v, ops: v.ops && typeof v.ops === 'object' ? v.ops : {} } : { ...c.defaults, ops: {} };
      log.info(c.where, c.word_loaded, { saved: !!v, why: got.ok ? null : got.why });
    } catch (e) {
      log.error(e, { where: c.where, params: { act: c.act_load } });
    }
    pub(c.my_piece, { ...my });
  }

  try {
    const root = $(c.ids.root);
    const host = doc.getElementById(c.host_id);
    if (host) host.appendChild(root);
    else log.warn(c.where, c.word_no_host, { host: c.host_id });
    const more = doc.getElementById(c.more_id);
    if (more) more.appendChild($(c.ids.open));
    else log.warn(c.where, c.word_no_host, { host: c.more_id });
    $(c.ids.open).textContent = x.open;
    $(c.ids.title).textContent = x.title;
    $(c.ids.close).textContent = x.close;
    $(c.ids.save).textContent = x.save;
    $(c.ids.car_head).textContent = x.car_head;
    $(c.ids.discount_head).textContent = x.discount_head;
    $(c.ids.ops_head).textContent = x.ops_head;
    $(c.ids.car).replaceChildren(...c.fields.filter((f) => f.part === c.parts.car).map(fieldRow));
    $(c.ids.discount).replaceChildren(...c.fields.filter((f) => f.part === c.parts.discount).map(fieldRow));
    $(c.ids.open).addEventListener(c.click_event, () => setOpen($(c.ids.root).hidden));
    $(c.ids.close).addEventListener(c.click_event, () => setOpen(false));
    $(c.ids.save).addEventListener(c.click_event, save);
  } catch (e) {
    log.error(e, { where: c.where, params: { act: c.act_init } });
  }

  deps.state.subscribe(c.app_piece, (v) => {
    if (!v || v.stage !== h.stages.good) return;
    try { $(c.ids.open).hidden = false; } catch (e) { log.error(e, { where: c.where, params: { act: c.act_init } }); }
  });
  // 업체 목록 = 받은 충전소 목록의 업체(충전기 많은 차례 — 옛 앱과 같이)
  deps.state.subscribe(c.stations_piece, (st) => {
    const list = st && Array.isArray(st[c.stations_list_key]) ? st[c.stations_list_key] : [];
    const n = new Map();
    for (const s of list) if (s && s.operator) n.set(s.operator, (n.get(s.operator) || 0) + (Array.isArray(s.chargers) ? s.chargers.length : 0));
    ops = [...n.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
  });
  // 목록 칸이 열리면 이 칸은 닫는다(가운데 칸에 칸 하나만 — 지도를 남기려고)
  deps.state.subscribe(c.other_panel_piece, (v) => {
    try { if (v && v.open && !$(c.ids.root).hidden) setOpen(false); } catch (e) { log.error(e, { where: c.where, params: { act: c.act_init } }); }
  });
  load();
  return { my: () => ({ ...my }), save, setOpen, saves: () => saves, inputs: () => inputs, opRows: () => opRows };
}
