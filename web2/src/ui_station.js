// StationCard(충전소 정보 칸 — 화면, 설계 5-1-나 ui_station · 5-8 라·마 · 5-7 (4)).
// 여는 길: 오른편 충전소판 줄(station.select.ahead)·지도의 번호·충전소 점(station.select.map) — 알림마다 쓰는 모듈이 하나이고, **마지막에 온 것**을 연다.
// 지도 칸 아래에서 올라온다(운전 화면 가운데 칸 안 — 지도를 다 가리지 않고, 판·저작권 표시·아래 띠와 같은 자리를 쓰지 않음). 카메라는 건드리지 않는다.
// 담는 것: 이름(휴게소는 방향)·종류, 충전소(업체)마다 빈자리 수(크게)·받은 때('○분 전' — 낡으면 낡았다고)·충전기마다 고장·사용 중·빈자리·모름(출력과 함께),
// '다시 받기'(relay.refresh), '내비로 보내기'(방법 1 geo: 주소) + **'좌표·이름 복사'(늘 함께)**, 앱마다의 작은 단추(방법 2), 닫기.
// 열려 있는 동안 고른 충전소 id 들을 station.open 으로 알린다(상태 받기 relay_status 가 그 시군구만 받음). 계산은 순수 모듈(relay_read·relay_fresh·navlink)에 시킨다.
// 받기가 끊겨도 들고 있는 상태를 받은 때와 함께 그대로 보인다 — 끊김 글은 상태 자리의 일(F7). 손으로 한 일의 그 자리 답(다시 받기·복사·내비 안 열림)만 이 칸에.
// 밖에서 온 글(충전소 이름·업체)은 textContent 로만 넣는다(5-7 (1)). 글·자리·시간은 config_ui_station.
export const NEEDS = ['cfg', 'log', 'state', 'doc', 'win', 'clock', 'timefmt', 'relay_read', 'relay_fresh', 'navlink'];

export function createStationCard(deps) {
  const cfg = deps.cfg;
  const c = cfg.section('config_ui_station');
  const t = cfg.section('config_time');
  const rr = cfg.section('config_relay_read');
  const rf = cfg.section('config_relay_fresh');
  const nl = cfg.section('config_navlink');
  const log = deps.log;
  const doc = deps.doc;
  const win = deps.win;
  const clock = deps.clock;
  const x = c.texts;
  const pub = deps.state.claim(c.owner, [c.open_piece, c.refresh_piece]);
  let list = [];
  let relay = null;
  let cur = null;
  let ticker = null;
  let asked = null;
  let navAt = null;
  let left = false;
  let opens = 0;

  const $ = (id) => {
    const el = doc.getElementById(id);
    if (!el) throw new Error(id);
    return el;
  };

  function fill(tpl, vals) {
    return tpl.replace(new RegExp(c.slot_re, 'g'), (m, k) => (vals[k] === undefined || vals[k] === null ? '' : String(vals[k])));
  }

  function make(tag, cls, text) {
    const e = doc.createElement(tag);
    e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function answer(text) {
    $(c.ids.answer).textContent = text;
  }

  function stationsOf(ids) {
    return ids.map((id) => list.find((s) => s && s.id === id)).filter(Boolean);
  }

  // 충전소(업체) 하나의 칸: 업체 · 빈자리 수 · 받은 때 · 충전기 줄
  function opBlock(st, now) {
    const zone = relay && relay.zones ? relay.zones[st.zscode] || null : null;
    const rows = deps.relay_read.rows(st, zone, rr);
    const n = deps.relay_read.count(rows, rr);
    const box = make(c.tags.op, c.classes.op);
    box.setAttribute(c.attrs.key, String(st.id));
    const head = make(c.tags.line, c.classes.op_head);
    head.appendChild(make(c.tags.part, c.classes.op_name, String(st.operator || st.name)));
    head.appendChild(make(c.tags.part, c.classes.op_free, fill(x.free_count, { free: n.by[c.free_state], total: n.total })));
    box.appendChild(head);
    const at = make(c.tags.line, c.classes.op_at);
    if (zone) {
      const f = deps.relay_fresh.judge({ meta: relay.meta, file_at: zone.at, zcodes: st.zcodes, now, old_ms: c.old_ms }, rf, t, deps.timefmt);
      const lv = x.levels[f.level] || '';
      const line = f.at === null ? x.at_unknown : fill(x.at_line, { time: deps.timefmt.format(f.at, c.time_pattern, t), ago: deps.relay_fresh.agoText(f.age_ms, rf) });
      at.textContent = lv ? line + x.level_join + lv : line;
      at.setAttribute(c.attrs.level, f.level);
    } else {
      at.textContent = x.at_none;
      at.setAttribute(c.attrs.level, rf.levels.unknown);
    }
    box.appendChild(at);
    for (const ch of rows) {
      const r = make(c.tags.line, c.classes.ch);
      r.setAttribute(c.attrs.state, ch.state);
      r.setAttribute(c.attrs.key, String(ch.id));
      r.appendChild(make(c.tags.part, c.classes.ch_id, fill(x.charger, { id: ch.id })));
      const kw = ch.kw === null ? '' : fill(x.kw, { kw: ch.kw.toFixed(c.kw_digits) });
      const kind = ch.type && x.types[ch.type] ? x.types[ch.type] : '';
      r.appendChild(make(c.tags.part, c.classes.ch_kw, [kw, kind].filter(Boolean).join(x.part_join)));
      r.appendChild(make(c.tags.part, c.classes.ch_state, x.states[ch.state] || x.states[rr.unknown_state]));
      box.appendChild(r);
    }
    return box;
  }

  function render() {
    if (!cur) return;
    try {
      const now = clock.now();
      const sts = stationsOf(cur.ids);
      $(c.ids.body).replaceChildren(...sts.map((st) => opBlock(st, now)));
    } catch (e) {
      log.error(e, { where: c.where, params: { act: c.act_render, key: cur && cur.key } });
    }
  }

  // 이름·주소 칸(열 때 한 번 — 고른 자리가 바뀌지 않는 동안 같음)
  function fillLinks(place) {
    const L = deps.navlink.links(place, nl);
    $(c.ids.name).textContent = L.label;
    $(c.ids.nav).setAttribute(c.attrs.href, L.geo);
    $(c.ids.copy_text).textContent = L.copy;
    const apps = L.apps.map((a) => {
      const e = make(c.tags.link, c.classes.app, a.text);
      e.setAttribute(c.attrs.href, a.url);
      e.setAttribute(c.attrs.app, a.key);
      e.addEventListener(c.click_event, () => log.info(c.where, c.word_app, { app: a.key, key: cur && cur.key }));
      return e;
    });
    $(c.ids.apps).replaceChildren(...apps);
    return L;
  }

  function open(v, from) {
    try {
      if (!v || !Array.isArray(v.ids) || !v.ids.length) throw new TypeError(c.why_select);
      const sts = stationsOf(v.ids);
      if (!sts.length) {
        log.warn(c.where, c.word_not_found, { from, key: v.key, ids: v.ids.length });
        return;
      }
      const first = sts[0];
      const place = {
        name: typeof v.name === 'string' && v.name ? v.name : first.name,
        dir: v.dir || null,
        line: v.line || null,
        lat: typeof v.lat === 'number' ? v.lat : first.lat,
        lng: typeof v.lng === 'number' ? v.lng : first.lng,
      };
      cur = { key: v.key, ids: sts.map((s) => s.id), place, from };
      opens += 1;
      const L = fillLinks(place);
      $(c.ids.kind).textContent = sts.some((s) => s.rest) ? x.kinds.rest : x.kinds.other;
      $(c.ids.root).setAttribute(c.attrs.key, String(v.key));
      answer('');
      $(c.ids.hint).textContent = '';
      asked = null;
      navAt = null;
      render();
      $(c.ids.root).hidden = false;
      if (ticker === null) ticker = clock.setInterval(render, c.tick_ms);
      log.info(c.where, c.word_open, { from, key: v.key, ids: cur.ids, lat: L.lat, lng: L.lng });
      pub(c.open_piece, { key: v.key, ids: cur.ids.slice() });
    } catch (e) {
      log.error(e, { where: c.where, params: { act: c.act_open, from, key: v && v.key } });
    }
  }

  function close() {
    try {
      if (!cur) return;
      log.info(c.where, c.word_close, { key: cur.key });
      cur = null;
      $(c.ids.root).hidden = true;
      if (ticker !== null) { clock.clearInterval(ticker); ticker = null; }
      pub(c.open_piece, null);
    } catch (e) {
      log.error(e, { where: c.where, params: { act: c.act_close } });
    }
  }

  function pressRefresh() {
    if (!cur) return;
    asked = clock.now();
    answer(x.asking);
    log.info(c.where, c.word_refresh, { key: cur.key });
    pub(c.refresh_piece, { key: cur.key, ids: cur.ids.slice(), at: asked });
  }

  async function pressCopy() {
    if (!cur) return;
    const text = $(c.ids.copy_text).textContent;
    try {
      if (!win || !win.navigator || !win.navigator.clipboard) throw new Error(c.why_no_clipboard);
      await win.navigator.clipboard.writeText(text);
      answer(x.copied);
      log.info(c.where, c.word_copy, { key: cur && cur.key, chars: text.length });
    } catch (e) {
      answer(x.copy_fail);
      log.warn(c.where, c.word_copy_fail, { key: cur && cur.key, why: e && e.message });
    }
  }

  // 내비 주소는 고리(a)가 누름 안에서 연다. 정한 시간 뒤에도 앱 화면이 그대로면(다른 앱으로 넘어가면 화면이 숨는다) 그 자리에 한 줄 + 로그
  function pressNav() {
    if (!cur) return;
    navAt = clock.now();
    left = false;
    $(c.ids.hint).textContent = '';
    const key = cur.key;
    log.info(c.where, c.word_nav, { key, href: $(c.ids.nav).getAttribute(c.attrs.href) });
    clock.setTimeout(() => {
      try {
        if (left || !cur || cur.key !== key) return;
        $(c.ids.hint).textContent = x.nav_hint;
        log.warn(c.where, c.word_nav_stay, { key, wait_ms: c.nav_hint_ms });
      } catch (e) {
        log.error(e, { where: c.where, params: { act: c.act_nav } });
      }
    }, c.nav_hint_ms);
  }

  try {
    const root = $(c.ids.root);
    const host = doc.getElementById(c.host_id);
    if (host) host.appendChild(root);
    else log.warn(c.where, c.word_no_host, { host: c.host_id });
    $(c.ids.close).textContent = x.close;
    $(c.ids.refresh).textContent = x.refresh;
    $(c.ids.nav).textContent = x.nav;
    $(c.ids.copy).textContent = x.copy;
    $(c.ids.always).textContent = x.always;
    $(c.ids.close).addEventListener(c.click_event, close);
    $(c.ids.refresh).addEventListener(c.click_event, pressRefresh);
    $(c.ids.copy).addEventListener(c.click_event, pressCopy);
    $(c.ids.nav).addEventListener(c.click_event, pressNav);
  } catch (e) {
    log.error(e, { where: c.where, params: { act: c.act_init } });
  }

  for (const name of c.select_pieces) deps.state.subscribe(name, (v) => open(v, name));
  deps.state.subscribe(c.stations_piece, (st) => {
    list = st && Array.isArray(st[c.stations_list_key]) ? st[c.stations_list_key] : [];
    render();
  });
  deps.state.subscribe(c.relay_piece, (v) => {
    relay = v || null;
    render();
    const last = v && v.last;
    if (asked !== null && last && last.at_ms >= asked) {
      answer(last.ok ? fill(x.asked_ok, { time: deps.timefmt.format(last.at_ms, c.time_pattern, t) }) : x.asked_fail);
      asked = null;
    }
  });
  deps.state.subscribe(c.visible_piece, (vis) => {
    if (vis === false && navAt !== null) left = true;
  });

  return { open: () => (cur ? { ...cur } : null), opens: () => opens, close, pressRefresh, pressCopy, pressNav };
}
