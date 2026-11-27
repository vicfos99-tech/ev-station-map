// 단위 시험: 제목 바꾸기 단추(ui_topic — 정비 나 ③). 가짜 문서·State·Store·창으로 — 갈림길 3 양쪽(제목 하나: 단추 숨김 / 둘: 보임)과
// 고르기(남기고 주소 꼬리를 바꿔 다시 켬)·켤 때 남긴 제목으로 다시 켜기·남긴 것 없으면 지금 것을 남기기.
function fakeDoc(ids) {
  const els = {};
  const mk = (tag) => {
    const e = { tag, hidden: false, textContent: '', className: '', attrs: {}, kids: [], on: {},
      setAttribute(k, v) { e.attrs[k] = String(v); }, getAttribute(k) { return e.attrs[k]; },
      addEventListener(ev, fn) { (e.on[ev] = e.on[ev] || []).push(fn); }, click() { for (const fn of e.on.click || []) fn(); },
      appendChild(k) { e.kids.push(k); return k; }, insertBefore(k, ref) { const i = e.kids.indexOf(ref); if (i < 0) e.kids.push(k); else e.kids.splice(i, 0, k); return k; },
      replaceChildren(...k) { e.kids = k; }, get firstChild() { return e.kids[0] || null; }, get children() { return e.kids; } };
    return e;
  };
  for (const id of ids) els[id] = mk('div');
  return { els, getElementById: (id) => els[id] || null, createElement: mk };
}

// slotOver = 설정 button_slot 을 바꿔 봄 · preKids = 그 묶음에 먼저 꽂혀 있던 단추 수(목록·내 차처럼)
async function make(t, list, stored, slotOver, preKids) {
  const { createTopicButton } = await t.src('ui_topic');
  const topicpick = await t.src('topicpick');
  const UT = t.cfg('config_ui_topic');
  if (slotOver) UT.button_slot = { ...UT.button_slot, ...slotOver };
  const HC = t.cfg('config_health');
  const doc = fakeDoc([...Object.values(UT.ids), UT.host_id, UT.button_slot.host_id]);
  for (let i = 0; i < (preKids || 0); i += 1) doc.els[UT.button_slot.host_id].appendChild(doc.createElement('button'));
  doc.els[UT.ids.root].hidden = true;
  const subs = {};
  const state = { subscribe: (n, fn) => { (subs[n] = subs[n] || []).push(fn); }, fire: (n, v) => { for (const fn of subs[n] || []) fn(v); } };
  const disk = { topic: stored, writes: [] };
  const store = { read: async () => ({ ok: true, value: disk.topic === undefined ? null : disk.topic }), write: async (k, v) => { disk.writes.push([k, v]); disk.topic = v; return { ok: true }; } };
  const win = { location: { hash: '', reloads: 0, reload() { win.location.reloads += 1; } } };
  const logs = [];
  const log = { info: (w, what, o) => logs.push([what, o]), warn: (w, what, o) => logs.push([what, o]), error: (e) => logs.push(['error', String(e && e.message)]) };
  const cfg = { section: (n) => (n === 'config_ui_topic' ? UT : HC) };
  const btn = createTopicButton({ cfg, log, state, store, doc, win, topicpick, topic_list: list });
  await new Promise((r) => setTimeout(r, 10));
  return { btn, doc, state, disk, win, logs, UT, HC };
}

export default async function (t) {
  const one = [{ name: 'station', label: '충전소', on: true }];
  const two = [{ name: 'station', label: '충전소', on: true }, { name: 'toilet', label: '화장실', on: false }];

  const a = await make(t, one, undefined);
  a.state.fire(a.UT.app_piece, { stage: a.HC.stages.good });
  t.check('①', '갈림길 3 — 제목 하나: 앱이 좋음이어도 단추 숨김(좁은 창 폭) · 남긴 것 없으면 지금 제목을 남김', '숨김 · 남김 station', (a.doc.els[a.UT.ids.open].hidden ? '숨김' : '보임') + ' · 남김 ' + a.disk.writes.map((w) => w[1]).join(','), a.doc.els[a.UT.ids.open].hidden && a.disk.writes.length === 1 && a.disk.writes[0][1] === 'station');

  const b = await make(t, two, 'station', null, 2);
  b.state.fire(b.UT.app_piece, { stage: b.HC.stages.good });
  const items = b.doc.els[b.UT.ids.list].kids;
  const bar = b.doc.els[b.UT.button_slot.host_id];
  const openBtn = b.doc.els[b.UT.ids.open];
  const wantText = b.UT.texts.open.split(b.UT.slot).join('충전소');
  t.check('②', '갈림길 3 — 제목 둘: 단추 보임 · 설정 자리(처음 값: 더 보기 묶음 맨 앞 — 목록·내 차보다 앞) · 단추 글 지금 제목 ▾ · 화면 읽기 글 · 목록 두 줄(지금 것 표시) · 남긴 것이 같으면 다시 안 켬',
    '보임 · ' + b.UT.button_slot.index + '째 · ' + wantText + ' · 읽기 글에 충전소 · 충전소 (지금)/화장실 · 다시 켬 0',
    (openBtn.hidden ? '숨김' : '보임') + ' · ' + bar.kids.indexOf(openBtn) + '째 · ' + openBtn.textContent + ' · 읽기 글 ' + openBtn.attrs[b.UT.label_attr] + ' · ' + items.map((x) => x.textContent).join('/') + ' · 다시 켬 ' + b.win.location.reloads,
    !openBtn.hidden && bar.kids.indexOf(openBtn) === b.UT.button_slot.index && openBtn.textContent === wantText && String(openBtn.attrs[b.UT.label_attr]).includes('충전소') && items.length === 2 && items[0].attrs[b.UT.pressed_attr] === b.UT.yes && b.win.location.reloads === 0);
  b.doc.els[b.UT.ids.open].click();
  const opened = !b.doc.els[b.UT.ids.root].hidden;
  items[1].click();
  await new Promise((r) => setTimeout(r, 10));
  t.check('③', '단추 누름 → 목록 칸 열림 · 화장실 고름 → Store 에 남김 + 주소 꼬리 #topic=toilet + 다시 켬 1', '열림 · toilet · #topic=toilet · 1', (opened ? '열림' : '안 열림') + ' · ' + b.disk.topic + ' · ' + b.win.location.hash + ' · ' + b.win.location.reloads,
    opened && b.disk.topic === 'toilet' && b.win.location.hash === '#topic=toilet' && b.win.location.reloads === 1);

  const c = await make(t, two, 'toilet');
  t.check('④', '켤 때 남긴 제목(toilet)이 지금(station)과 다르면 그 제목으로 다시 켬', '#topic=toilet · 1', c.win.location.hash + ' · ' + c.win.location.reloads, c.win.location.hash === '#topic=toilet' && c.win.location.reloads === 1);
  const d = await make(t, two, 'bus');
  t.check('⑤', '남긴 제목이 목록에 없으면(지워진 꾸러미) 다시 켜지 않고 지금 것을 남김', '다시 켬 0 · 남김 station', '다시 켬 ' + d.win.location.reloads + ' · 남김 ' + d.disk.topic, d.win.location.reloads === 0 && d.disk.topic === 'station');
  b.state.fire('my.panel', { open: true });
  t.check('⑥', '다른 칸(내 차)이 열리면 목록 칸은 닫힘', '닫힘', b.doc.els[b.UT.ids.root].hidden ? '닫힘' : '열림', b.doc.els[b.UT.ids.root].hidden || !opened);

  // (11/26 묘성) 자리는 설정 한 줄로 옮김 — 다른 묶음·몇째·맨 뒤
  const e = await make(t, two, 'station', { host_id: 'ev-map-bar', index: 1 }, 2);
  const eb = e.doc.els['ev-map-bar'];
  t.check('⑦', '자리 설정 — 묶음 ev-map-bar(내 위치·세 곳만)의 1째 = 둘 사이', '1째 · 묶음 3개', eb.kids.indexOf(e.doc.els[e.UT.ids.open]) + '째 · 묶음 ' + eb.kids.length + '개', eb.kids.indexOf(e.doc.els[e.UT.ids.open]) === 1 && eb.kids.length === 3);
  const f = await make(t, two, 'station', { index: -1 }, 2);
  const fb = f.doc.els[f.UT.button_slot.host_id];
  const g = await make(t, two, 'station', { index: 9 }, 2);
  const gb = g.doc.els[g.UT.button_slot.host_id];
  t.check('⑧', '자리 설정 — 음수·묶음 길이 넘음은 맨 뒤', '맨 뒤 · 맨 뒤', (fb.kids[fb.kids.length - 1] === f.doc.els[f.UT.ids.open] ? '맨 뒤' : '다른 자리') + ' · ' + (gb.kids[gb.kids.length - 1] === g.doc.els[g.UT.ids.open] ? '맨 뒤' : '다른 자리'),
    fb.kids[fb.kids.length - 1] === f.doc.els[f.UT.ids.open] && gb.kids[gb.kids.length - 1] === g.doc.els[g.UT.ids.open]);
  const h = await make(t, one, 'station', { }, 0);
  const UT1 = h.UT;
  // min_show 를 1 로 바꾼 설정 — 제목 하나여도 단추가 보임(시험용 빌드와 같은 값)
  const { createTopicButton } = await t.src('ui_topic');
  const topicpick = await t.src('topicpick');
  const U2 = { ...UT1, min_show: 1 };
  const doc2 = fakeDoc([...Object.values(U2.ids), U2.host_id, U2.button_slot.host_id]);
  const subs2 = {};
  const st2 = { subscribe: (n, fn) => { (subs2[n] = subs2[n] || []).push(fn); } };
  const store2 = { read: async () => ({ ok: true, value: 'station' }), write: async () => ({ ok: true }) };
  const log2 = { info() {}, warn() {}, error() {} };
  createTopicButton({ cfg: { section: (n) => (n === 'config_ui_topic' ? U2 : h.HC) }, log: log2, state: st2, store: store2, doc: doc2, win: h.win, topicpick, topic_list: one });
  for (const fn of subs2[U2.app_piece] || []) fn({ stage: h.HC.stages.good });
  t.check('⑨', 'min_show 1 — 제목 하나여도 단추 보임', '보임', doc2.els[U2.ids.open].hidden ? '숨김' : '보임', !doc2.els[U2.ids.open].hidden);
}
