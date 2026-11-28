// ToiletList(화장실 목록 칸 — 화면, 추가3 화장실 꾸러미). 아래 띠 더 보기 자리(c.more_id) 맨 앞에 '화장실 목록' 단추, 누르면 가운데 기둥(c.host_id — 지도 아래)에 칸.
// **그리기만 한다**: 화장실 꾸러미 계산 줄이 낸 목록 조각(toilet.list — 앞의 화장실 셈 그대로, 더 많은 곳)을 줄마다 번호 · 이름 · 종류 · 24시간/개방 시간 · 트럭 · 메모 · 남은 거리로.
// 칸 자세히는 toilets 조각(출처·개방 시간 등)에서 id 로 찾는다. 줄을 누르면 toilet.select.list(화장실 정보 칸이 연다).
// 가운데 기둥에 칸 하나만: 열림·닫힘을 목록 칸 알림(panel_piece — 충전소 목록 칸과 같은 이름이라 제목 바꾸기·내 차 칸이 그대로 알아듣고 닫힘)으로 내고, 내 차 칸이 열리면 닫는다.
// 좁은 창 그림 글자: 자기 단추에 그림 글자·화면 읽기 글을 단다(아래 띠 그림 글자 모양 [data-glyph] 과 같은 꼴 — ui_bar 목록을 고치지 않음). 글·자리는 config_ui_toilet_list.
export const LAYER = 'screen';
export const NEEDS = ['cfg', 'log', 'state', 'doc'];

export function createToiletList(deps) {
  const cfg = deps.cfg;
  const c = cfg.section('config_ui_toilet_list');
  const h = cfg.section(c.health_rule);
  const log = deps.log;
  const doc = deps.doc;
  const x = c.texts;
  // 종류 글(휴게소·공중화장실·내가 적은 곳)은 화장실판 설정 한 곳에서(설정 중복 없이)
  const kinds = cfg.section(c.kinds_cfg).texts.kinds;
  // 주차 상태 낱말(yes·no·unknown)도 화장실판 설정 한 곳에서
  const parkingStates = cfg.section(c.kinds_cfg).parking_states;
  const pub = deps.state.claim(c.owner, [c.select_piece, c.panel_piece]);
  let open = false;
  let list = null;
  let toilets = null;
  let draws = 0;

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
  const dist = (d) => d.toFixed(d < c.decimals_below_km ? c.decimals : 0);

  function detail(key) {
    const rows = toilets && Array.isArray(toilets[c.list_key]) ? toilets[c.list_key] : [];
    return rows.find((r) => String(r.id) === String(key)) || null;
  }

  function rowEl(it, around) {
    const t = detail(it.key);
    const li = make(c.row_tag, c.classes.row);
    li.setAttribute(c.key_attr, String(it.key));
    const head = make(c.block_tag, c.classes.head);
    head.appendChild(make(c.part_tag, c.classes.no, String(it.no)));
    head.appendChild(make(c.part_tag, c.classes.name, String(it.name)));
    head.appendChild(make(c.part_tag, c.classes.dist, (around ? x.straight + ' ' : '') + dist(it.dist_km) + ' ' + x.km_unit));
    li.appendChild(head);
    // 주차(트럭 댈 칸): 거리 다음으로 중요 — 따로 크게. 상태 글·색은 data-state(설정의 낱말)로
    const pk = t ? t.parking : null;
    const ps = pk === true ? parkingStates.yes : pk === false ? parkingStates.no : parkingStates.unknown;
    const pel = make(c.block_tag, c.classes.parking, x['parking_' + ps]);
    pel.setAttribute(c.attrs.state, ps);
    li.appendChild(pel);
    const facts = [];
    facts.push(around ? x.around_tag : (it.rest ? kinds.rest : (t && kinds[t.src]) || ''));
    if (t && t.all_day === true) facts.push(x.all_day);
    else if (t && t.open) facts.push(x.open_prefix + t.open);
    else facts.push(x.open_unknown);
    li.appendChild(make(c.block_tag, c.classes.facts, facts.filter(Boolean).join(x.join)));
    if (t && t.memo) li.appendChild(make(c.block_tag, c.classes.memo, t.memo));
    li.addEventListener(c.click_event, () => {
      try {
        pub(c.select_piece, { key: it.key, ids: Array.isArray(it.ids) ? it.ids.slice() : [it.key], name: it.name, lat: it.lat, lng: it.lng, dist_km: it.dist_km, straight: !!it.straight });
        log.info(c.where, c.word_select, { key: it.key });
      } catch (e) {
        log.error(e, { where: c.where, params: { act: c.act_select } });
      }
    });
    return li;
  }

  function draw() {
    if (!open) return;
    draws += 1;
    const box = $(c.ids.list);
    const ok = list && Array.isArray(list.items);
    const around = ok && list.mode === c.around_mode;
    $(c.ids.head).textContent = !ok ? x.title : (around ? x.head_around : (list.mode === c.route_mode ? x.head_route : x.head_ahead));
    if (!ok || !list.items.length) { box.replaceChildren(make(c.row_tag, c.classes.empty, ok ? x.none : x.wait)); return; }
    box.replaceChildren(...list.items.map((it) => rowEl(it, around)));
  }

  function setOpen(v) {
    open = v;
    $(c.ids.root).hidden = !open;
    $(c.ids.open).setAttribute(c.attrs.pressed, open ? c.yes : c.no);
    pub(c.panel_piece, { open });
    log.info(c.where, open ? c.word_open : c.word_close, { items: list && Array.isArray(list.items) ? list.items.length : null });
    draw();
  }

  try {
    const root = $(c.ids.root);
    const host = doc.getElementById(c.host_id);
    if (host) host.appendChild(root);
    else log.warn(c.where, c.word_no_host, { host: c.host_id });
    const more = doc.getElementById(c.more_id);
    if (more) more.insertBefore($(c.ids.open), more.firstChild || null);
    else log.warn(c.where, c.word_no_host, { host: c.more_id });
    const btn = $(c.ids.open);
    btn.textContent = x.open;
    btn.setAttribute(c.attrs.label, x.open_label);
    btn.setAttribute(c.attrs.glyph, c.glyph);
    $(c.ids.close).textContent = x.close;
    btn.addEventListener(c.click_event, () => setOpen(!open));
    $(c.ids.close).addEventListener(c.click_event, () => setOpen(false));
  } catch (e) {
    log.error(e, { where: c.where, params: { act: c.act_init } });
  }

  deps.state.subscribe(c.app_piece, (v) => {
    if (!v || v.stage !== h.stages.good) return;
    try { $(c.ids.open).hidden = false; } catch (e) { log.error(e, { where: c.where, params: { act: c.act_init } }); }
  });
  deps.state.subscribe(c.list_piece, (v) => {
    list = v || null;
    try { draw(); } catch (e) { log.error(e, { where: c.where, params: { act: c.act_draw } }); }
  });
  deps.state.subscribe(c.toilets_piece, (v) => { toilets = v || null; });
  deps.state.subscribe(c.other_panel_piece, (v) => {
    try { if (v && v.open && open) setOpen(false); } catch (e) { log.error(e, { where: c.where, params: { act: c.act_init } }); }
  });
  return { setOpen, isOpen: () => open, draws: () => draws };
}
