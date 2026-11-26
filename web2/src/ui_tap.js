// TapLabel(누른 지점 거리 — 화면, 설계 5-1 213줄 · 6절 차례 8). 그리기만 한다:
//   tap 조각(CalcRunner 가 tapdist 로 셈)을 듣고 작은 표시(직선 km · 고속도로 위면 길 따라 km 앞·뒤)를 채운다.
//   보일 때 '이 표시를 누른 자리에 꽂아 달라'를 map.pin 으로 요청만 내고(지도 풍선으로 꽂는 일은 ui_map — 지도 라이브러리를 모른다), 사라지면 null.
//   표시를 누르면 닫기 요청(tap.close — 지금 누름의 seq). 계산·받기·카메라는 하지 않는다. 글·자리·꼴은 config_tap.ui.
export const NEEDS = ['cfg', 'log', 'state', 'doc'];

export function createTapLabel(deps) {
  const c = deps.cfg.section('config_tap').ui;
  const x = c.texts;
  const log = deps.log;
  const doc = deps.doc;
  const pub = deps.state.claim(c.owner, [c.pin_piece, c.close_piece]);
  let cur = null;
  let pinned = null;
  let shows = 0;

  const $ = (id) => {
    const el = doc.getElementById(id);
    if (!el) throw new Error(id);
    return el;
  };

  function km(v) {
    const digits = v < c.decimals_below_km ? c.decimals : 0;
    return v.toFixed(digits) + ' ' + x.km_unit;
  }

  function hide() {
    $(c.ids.root).hidden = true;
    if (pinned !== null) {
      pub(c.pin_piece, null);
      log.info(c.where, c.word_hidden, { seq: pinned });
      pinned = null;
    }
  }

  function show(t) {
    cur = t || null;
    if (!t || !t.shown) { hide(); return; }
    $(c.ids.straight).textContent = t.straight_km === null ? x.no_fix : x.straight + ' ' + km(t.straight_km);
    const along = $(c.ids.along);
    const has = typeof t.along_km === 'number';
    along.hidden = !has;
    along.textContent = has ? x.along + ' ' + km(t.along_km) + (t.side && x.sides[t.side] ? ' ' + x.sides[t.side] : '') : '';
    $(c.ids.root).hidden = false;
    if (pinned !== t.seq) {
      pinned = t.seq;
      shows += 1;
      pub(c.pin_piece, { id: c.ids.root, seq: t.seq, lat: t.lat, lng: t.lng });
      log.info(c.where, c.word_shown, { seq: t.seq, straight_km: t.straight_km, along_km: t.along_km, side: t.side, line: t.line });
    }
  }

  function close() {
    try {
      if (!cur || !cur.shown) return;
      log.info(c.where, c.word_close, { seq: cur.seq });
      pub(c.close_piece, { seq: cur.seq });
    } catch (e) {
      log.error(e, { where: c.where, params: { act: c.act_close } });
    }
  }

  try {
    const root = $(c.ids.root);
    root.hidden = true;
    root.setAttribute(c.label_attr, x.close_label);
    $(c.ids.close).textContent = x.close;
    root.addEventListener(c.click_event, close);
  } catch (e) {
    log.error(e, { where: c.where, params: { act: c.act_init } });
  }

  deps.state.subscribe(c.tap_piece, (t) => {
    try { show(t); } catch (e) { log.error(e, { where: c.where, params: { act: c.act_show, seq: t && t.seq } }); }
  });
  return { shows: () => shows, pinned: () => pinned, close };
}
