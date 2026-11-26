// TopicButton(제목 바꾸기 단추 — 화면, 정비 나 ③). 아래 띠의 더 보기 자리(격자 자리 more — 추가1 의 자리를 정해 둔 칸)에 단추 하나(48px)를 꽂고,
// 누르면 가운데 기둥(ev-center — 지도 아래)에 제목 목록 칸을 연다. 지금 켠 제목에 표시. 다른 제목을 고르면 폰 데이터 폴더(Store)에 '마지막에 쓴 제목'으로 남기고
// 주소 꼬리를 그 제목으로 바꿔 다시 켠다(topicpick.hashOf — 제목은 한 번에 하나, 받기·계산·화면을 통째로 바꿈). 켤 때 남긴 제목을 읽어 지금 것과 다르면 그 제목으로 다시 켠다.
// 남긴 것이 없으면 지금 제목을 남긴다. 제목 목록(이름·보일 글·켰나)은 조립이 넘긴다(topic_list). 글·자리는 config_ui_topic.
export const NEEDS = ['cfg', 'log', 'state', 'store', 'doc', 'win', 'topicpick', 'topic_list'];

export function createTopicButton(deps) {
  const cfg = deps.cfg;
  const c = cfg.section('config_ui_topic');
  const h = cfg.section('config_health');
  const log = deps.log;
  const doc = deps.doc;
  const pick = deps.topicpick;
  const list = (deps.topic_list || []).slice();
  const names = list.map((t) => t.name);
  const active = list.find((t) => t.on) || null;
  const x = c.texts;
  const $ = (id) => {
    const e = doc.getElementById(id);
    if (!e) throw new Error(id);
    return e;
  };
  const stats = { saved: 0, restarts: 0 };

  function setOpen(v) {
    const root = $(c.ids.root);
    root.hidden = !v;
    $(c.ids.open).setAttribute(c.pressed_attr, v ? c.yes : c.no);
  }

  function restart(name) {
    const win = deps.win;
    if (!win || !win.location) {
      log.warn(c.where, c.word_no_location, { name });
      return false;
    }
    stats.restarts += 1;
    log.info(c.where, c.word_restart, { from: active ? active.name : null, to: name });
    win.location.hash = pick.hashOf(name, c);
    win.location.reload();
    return true;
  }

  async function choose(name) {
    if (!names.includes(name)) return false;
    if (active && name === active.name) { setOpen(false); return true; }
    const res = await deps.store.write(c.store_key, name);
    if (res.ok) stats.saved += 1;
    else log.warn(c.where, c.word_save_failed, { name, why: res.why });
    return restart(name);
  }

  function draw() {
    const box = $(c.ids.list);
    box.replaceChildren(...list.map((t) => {
      const b = doc.createElement(c.tags.item);
      b.className = c.classes.item;
      b.setAttribute(c.type_attr, c.type_button);
      b.setAttribute(c.key_attr, t.name);
      b.setAttribute(c.pressed_attr, t.on ? c.yes : c.no);
      b.textContent = t.on ? x.item_on.split(c.slot).join(t.label) : t.label;
      b.addEventListener(c.click_event, () => { choose(t.name).catch((e) => log.error(e, { where: c.where, params: { act: c.act_pick } })); });
      return b;
    }));
  }

  // 켤 때: 남긴 제목 읽기 → 다르면 그 제목으로 다시 켬, 없으면 지금 것을 남김
  async function load() {
    try {
      const got = await deps.store.read(c.store_key);
      const stored = got.ok ? got.value : null;
      const want = pick.wantOf(names, active ? active.name : null, stored);
      log.info(c.where, c.word_loaded, { active: active ? active.name : null, stored, want, why: got.ok ? null : got.why });
      if (want) { restart(want); return; }
      if (active && stored !== active.name) {
        const res = await deps.store.write(c.store_key, active.name);
        if (res.ok) stats.saved += 1;
        else log.warn(c.where, c.word_save_failed, { name: active.name, why: res.why });
      }
    } catch (e) {
      log.error(e, { where: c.where, params: { act: c.act_load } });
    }
  }

  try {
    const host = doc.getElementById(c.host_id);
    if (host) host.appendChild($(c.ids.root));
    else log.warn(c.where, c.word_no_host, { host: c.host_id });
    const more = doc.getElementById(c.more_id);
    if (more) more.insertBefore($(c.ids.open), more.firstChild || null);
    else log.warn(c.where, c.word_no_host, { host: c.more_id });
    $(c.ids.open).textContent = active ? active.label : x.none;
    $(c.ids.open).setAttribute(c.label_attr, x.open_label);
    $(c.ids.title).textContent = x.title;
    $(c.ids.close).textContent = x.close;
    draw();
    $(c.ids.open).addEventListener(c.click_event, () => setOpen($(c.ids.root).hidden));
    $(c.ids.close).addEventListener(c.click_event, () => setOpen(false));
  } catch (e) {
    log.error(e, { where: c.where, params: { act: c.act_init } });
  }

  deps.state.subscribe(c.app_piece, (v) => {
    if (!v || v.stage !== h.stages.good) return;
    // (정비 나 갈림길 3) 제목이 min_show 개보다 적으면 단추를 숨긴다 — 좁은 세로 창(360)의 아래 띠에 남는 폭이 없어 단추 하나가 판을 화면 밖으로 민다
    try { $(c.ids.open).hidden = list.length < c.min_show; } catch (e) { log.error(e, { where: c.where, params: { act: c.act_init } }); }
  });
  // 다른 칸(목록·내 차)이 열리면 이 칸은 닫는다(가운데 칸에 칸 하나만)
  for (const piece of c.other_panel_pieces) {
    deps.state.subscribe(piece, (v) => {
      try { if (v && v.open && !$(c.ids.root).hidden) setOpen(false); } catch (e) { log.error(e, { where: c.where, params: { act: c.act_init } }); }
    });
  }
  load();

  return { choose, setOpen, isOpen: () => { try { return !$(c.ids.root).hidden; } catch (e) { return false; } }, active: () => (active ? active.name : null), stats: () => ({ ...stats }) };
}
