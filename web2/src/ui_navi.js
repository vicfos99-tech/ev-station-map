// SearchScreen(검색 칸 — 화면, 설계 5-1-나 ui_navi · 5-8 바 · 5-7 (1)·(4)). 운전 화면 가운데 칸의 지도 바로 위(흐름 — 화면을 바꾸지 않고 덮지 않음):
//   글을 넣고 '찾기'(또는 엔터) → FormCheck(규칙 config_formcheck.fields.navi_q — 빈 글·긴 글·제어 문자는 그 칸 아래 한 줄, 요청을 내지 않음, 로그)
//   → place.request {seq, q} → place 답(묻는 중·늦음·끝·실패)을 그 칸 아래 한 줄과 결과 목록(구분선 목록)으로
//   → 하나를 고르면 route.request {seq, from: 지금 위치, to, name} → route.progress 를 한 줄로. 경로는 CalcRunner 가 낸 route 를 보고 '→ 목적지 · km' + '경로 지우기'(route.clear {seq}).
// 답을 노선 꼴로 바꾸지 않는다(StateCalc 의 일). 요청 번호(seq)로 앞 물음의 늦은 답은 무시한다. 화면 상태(판·지도 카메라)는 건드리지 않는다.
// health.navi 가 나쁘면(집 PC 길 끊김·설정 틀림) 칸·'찾기'를 흐리게 하고 '길찾기 사용 불가' 한 줄 — 까닭은 상태 자리의 일(F7). 이미 그린 경로는 지우지 않는다.
// 밖에서 온 글(장소 이름·주소)은 textContent 로만. 글·자리·개수는 config_ui_navi.
export const NEEDS = ['cfg', 'log', 'state', 'doc', 'formcheck'];

export function createSearchScreen(deps) {
  const cfg = deps.cfg;
  const c = cfg.section('config_ui_navi');
  const r = cfg.section('config_health');
  const rule = cfg.section('config_formcheck').fields[c.q_field];
  const log = deps.log;
  const doc = deps.doc;
  const x = c.texts;
  const S = c.stages;
  const pub = deps.state.claim(c.owner, [c.place_request, c.route_request, c.clear_piece]);
  let seq = 0;
  let placeSeq = null;
  let routeSeq = null;
  let fix = null;
  let usable = true;
  let unusableShown = false;
  let route = null;
  let found = [];
  const stats = { asked: 0, refused: 0, picked: 0, cleared: 0 };

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

  function note(text) {
    $(c.ids.note).textContent = text;
    unusableShown = false;
  }

  function failText(code) {
    return x.fail[code] || x.fail_default;
  }

  function hideList() {
    found = [];
    $(c.ids.list).replaceChildren();
    $(c.ids.list).hidden = true;
  }

  function showList(places) {
    found = places.slice(0, c.max_results);
    const rows = found.map((p, i) => {
      const row = make(c.tags.item, c.classes.item);
      row.setAttribute(c.attrs.no, String(i));
      row.setAttribute(c.attrs.role, c.role_button);
      row.appendChild(make(c.tags.part, c.classes.item_name, p.name));
      if (p.addr) row.appendChild(make(c.tags.part, c.classes.item_addr, p.addr));
      row.addEventListener(c.click_event, () => pick(i));
      return row;
    });
    const close = make(c.tags.button, c.classes.close, x.list_close);
    close.addEventListener(c.click_event, () => { hideList(); note(''); });
    $(c.ids.list).replaceChildren(...rows, close);
    $(c.ids.list).hidden = false;
  }

  function search() {
    try {
      const raw = $(c.ids.q).value;
      const m = deps.formcheck.field(raw === undefined || raw === null ? '' : raw, rule);
      if (!m.ok) {
        stats.refused += 1;
        note((x.q_bad[m.why] || x.q_bad_default).split(c.max_mark).join(String(rule.max)));
        log.warn(c.where, c.words.q_bad, { why: m.why, chars: typeof raw === 'string' ? [...raw].length : null });
        return;
      }
      if (!usable) {
        stats.refused += 1;
        note(x.unusable);
        return;
      }
      seq += 1;
      placeSeq = seq;
      stats.asked += 1;
      hideList();
      note(x.asking);
      log.info(c.where, c.words.search, { seq, chars: [...m.value].length });
      pub(c.place_request, { seq, q: m.value });
    } catch (e) {
      log.error(e, { where: c.where, params: { act: c.act_search } });
    }
  }

  function pick(i) {
    try {
      const p = found[i];
      if (!p) return;
      if (!fix || typeof fix.lat !== 'number' || typeof fix.lng !== 'number') {
        note(x.no_fix);
        log.warn(c.where, c.words.no_fix, { name: p.name });
        return;
      }
      if (!usable) { note(x.unusable); return; }
      seq += 1;
      routeSeq = seq;
      stats.picked += 1;
      hideList();
      note(fill(x.route_asking, { name: p.name }));
      log.info(c.where, c.words.pick, { seq, name: p.name, lat: p.lat, lng: p.lng });
      pub(c.route_request, { seq, from: [fix.lat, fix.lng], to: [p.lat, p.lng], name: p.name });
    } catch (e) {
      log.error(e, { where: c.where, params: { act: c.act_pick, i } });
    }
  }

  function clear() {
    try {
      stats.cleared += 1;
      routeSeq = null;
      log.info(c.where, c.words.clear, { seq, had: !!route });
      pub(c.clear_piece, { seq });
      note('');
    } catch (e) {
      log.error(e, { where: c.where, params: { act: c.act_clear } });
    }
  }

  function showRoute(rt) {
    route = rt || null;
    const box = $(c.ids.route);
    if (!route) { box.hidden = true; $(c.ids.route_text).replaceChildren(); return; }
    const km = typeof route.total_km === 'number' ? route.total_km.toFixed(route.total_km < c.decimals_below_km ? c.decimals : 0) : '';
    const name = route.dest && route.dest.name ? route.dest.name : x.route_no_name;
    $(c.ids.route_text).replaceChildren(
      make(c.tags.part, c.classes.route_name, fill(x.route_line, { name })),
      make(c.tags.part, c.classes.route_km, fill(x.route_km, { km })),
    );
    box.hidden = false;
  }

  function onPlace(v) {
    if (!v || v.seq !== placeSeq) return;
    if (v.stage === S.asking) note(x.asking);
    else if (v.stage === S.slow) note(x.slow);
    else if (v.stage === S.done) {
      const list = Array.isArray(v.places) ? v.places : [];
      if (!list.length) { note(x.none_found); hideList(); return; }
      note(fill(x.found, { n: Math.min(list.length, c.max_results) }));
      showList(list);
    } else if (v.stage === S.fail) {
      note(failText(v.code));
      hideList();
    }
  }

  function onProgress(v) {
    if (!v || v.seq !== routeSeq) return;
    if (v.stage === S.asking) return;
    if (v.stage === S.slow) note(x.route_slow);
    else if (v.stage === S.done) note('');
    else if (v.stage === S.fail) note(failText(v.code));
  }

  function onHealth(v) {
    usable = !(v && v.ok === false);
    try {
      $(c.ids.root).setAttribute(c.ok_attr, usable ? c.yes_word : c.no_word);
      $(c.ids.q).disabled = !usable;
      $(c.ids.go).disabled = !usable;
      if (!usable) {
        hideList();
        $(c.ids.note).textContent = x.unusable;
        unusableShown = true;
      } else if (unusableShown) {
        note('');
      }
      log.info(c.where, c.words.health, { ok: usable });
    } catch (e) {
      log.error(e, { where: c.where, params: { act: c.act_health } });
    }
  }

  try {
    const root = $(c.ids.root);
    const host = doc.getElementById(c.host_id);
    if (host) host.appendChild(root);
    else log.warn(c.where, c.words.no_host, { host: c.host_id });
    $(c.ids.q).setAttribute(c.placeholder_attr, x.placeholder);
    $(c.ids.q).setAttribute(c.maxlength_attr, String(rule.max));
    $(c.ids.go).textContent = x.go;
    $(c.ids.clear).textContent = x.clear;
    $(c.ids.go).addEventListener(c.click_event, search);
    $(c.ids.q).addEventListener(c.key_event, (e) => { if (e && e.key === c.enter_key) search(); });
    $(c.ids.clear).addEventListener(c.click_event, clear);
  } catch (e) {
    log.error(e, { where: c.where, params: { act: c.act_init } });
  }

  deps.state.subscribe(c.app_piece, (v) => {
    if (!v || v.stage !== r.stages.good) return;
    try { $(c.ids.root).hidden = false; } catch (e) { log.error(e, { where: c.where, params: { act: c.act_init } }); }
  });
  deps.state.subscribe(c.fix_piece, (f) => { fix = f || fix; });
  deps.state.subscribe(c.place_piece, (v) => { try { onPlace(v); } catch (e) { log.error(e, { where: c.where, params: { act: c.act_place, seq: v && v.seq } }); } });
  deps.state.subscribe(c.progress_piece, (v) => { try { onProgress(v); } catch (e) { log.error(e, { where: c.where, params: { act: c.act_progress, seq: v && v.seq } }); } });
  deps.state.subscribe(c.route_piece, (v) => { try { showRoute(v); } catch (e) { log.error(e, { where: c.where, params: { act: c.act_route } }); } });
  deps.state.subscribe(c.health_piece, onHealth);

  return { search, pick, clear, stats: () => ({ ...stats }), found: () => found.slice(), usable: () => usable };
}
