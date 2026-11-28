// ToiletCard(화장실 정보 칸 — 화면, 추가3 화장실 꾸러미). 화장실판 줄·목록 줄·지도 번호/점을 누르면(select_pieces — 마지막에 온 것) 가운데 기둥(지도 아래)에 칸을 연다:
//   이름 · 종류(휴게소·공중화장실·내가 적은 곳) · 남은 거리 · 개방 시간(24시간이면 '24시간', 모르면 '모름') · 트럭(가능·안 됨·모름) · 메모 · 출처 글 · 좌표.
// 칸 자세히는 toilets 조각에서 id 로 찾는다(묶인 자리면 첫 id — 휴게소). **그리기만 한다** — 받기·계산 없음. 밖에서 온 글은 글로만(textContent). 글·자리는 config_ui_toilet_card.
export const LAYER = 'screen';
export const NEEDS = ['cfg', 'log', 'state', 'doc'];

export function createToiletCard(deps) {
  const cfg = deps.cfg;
  const c = cfg.section('config_ui_toilet_card');
  const kinds = cfg.section(c.kinds_cfg).texts.kinds;
  const log = deps.log;
  const doc = deps.doc;
  const x = c.texts;
  let toilets = null;
  let shown = null;

  const $ = (id) => {
    const el = doc.getElementById(id);
    if (!el) throw new Error(id);
    return el;
  };
  function line(label, value) {
    const e = doc.createElement(c.line_tag);
    e.className = c.classes.line;
    const a = doc.createElement(c.part_tag);
    a.className = c.classes.label;
    a.textContent = label;
    const b = doc.createElement(c.part_tag);
    b.className = c.classes.value;
    b.textContent = value;
    e.appendChild(a);
    e.appendChild(b);
    return e;
  }
  const tri = (v, yes, no) => (v === true ? yes : v === false ? no : x.unknown);

  function detail(sel) {
    const rows = toilets && Array.isArray(toilets[c.list_key]) ? toilets[c.list_key] : [];
    const ids = Array.isArray(sel.ids) && sel.ids.length ? sel.ids : [sel.key];
    for (const id of ids) {
      const t = rows.find((r) => String(r.id) === String(id));
      if (t) return t;
    }
    return null;
  }

  function draw() {
    if (!shown) return;
    const t = detail(shown);
    $(c.ids.name).textContent = String(shown.name || (t && t.name) || '');
    const lines = [];
    lines.push(line(x.kind, t ? (t.rest ? kinds.rest : kinds[t.src] || '') : x.unknown));
    if (typeof shown.dist_km === 'number') lines.push(line(x.dist, (shown.straight ? x.straight + ' ' : '') + shown.dist_km.toFixed(c.decimals) + ' ' + x.km_unit));
    lines.push(line(x.open, t && t.all_day === true ? x.all_day : (t && t.open) || x.unknown));
    lines.push(line(x.parking, tri(t && t.parking, x.parking_yes, x.parking_no)));
    lines.push(line(x.truck, tri(t && t.truck, x.yes, x.no)));
    if (t && t.memo) lines.push(line(x.memo, t.memo));
    lines.push(line(x.source, t ? x.sources[t.src] || '' : x.unknown));
    if (typeof shown.lat === 'number' && typeof shown.lng === 'number') lines.push(line(x.pos, shown.lat.toFixed(c.pos_decimals) + x.pos_sep + shown.lng.toFixed(c.pos_decimals)));
    $(c.ids.body).replaceChildren(...lines);
  }

  function setOpen(sel) {
    shown = sel || null;
    $(c.ids.root).hidden = !shown;
    log.info(c.where, shown ? c.word_open : c.word_close, { key: shown ? shown.key : null, found: shown ? !!detail(shown) : null });
    draw();
  }

  try {
    const host = doc.getElementById(c.host_id);
    if (host) host.appendChild($(c.ids.root));
    else log.warn(c.where, c.word_no_host, { host: c.host_id });
    $(c.ids.close).textContent = x.close;
    $(c.ids.close).addEventListener(c.click_event, () => setOpen(null));
  } catch (e) {
    log.error(e, { where: c.where, params: { act: c.act_init } });
  }

  for (const piece of c.select_pieces) {
    deps.state.subscribe(piece, (v) => {
      try { if (v) setOpen(v); } catch (e) { log.error(e, { where: c.where, params: { act: c.act_draw, piece } }); }
    });
  }
  deps.state.subscribe(c.toilets_piece, (v) => {
    toilets = v || null;
    try { draw(); } catch (e) { log.error(e, { where: c.where, params: { act: c.act_draw } }); }
  });
  return { setOpen, isOpen: () => !!shown, shown: () => shown };
}
