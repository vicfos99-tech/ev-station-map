// 단위 시험: 꺼진 까닭 남기기(resume — 묘성 11/27 ②). 가짜 Store·문서·창·시계로 — 처음 / 깨끗이 닫힘(pagehide) / 숨긴 채 꺼짐 / 보이는 채 꺼짐을
// 다음 켬의 로그 한 줄로 가름(예기치 않으면 warn) · 도는 동안 숨김·보임·내림을 데이터 폴더에 적음 · 끔이면 아무것도 안 함.
function rig(t, disk, over) {
  const R = { ...t.cfg('config_resume'), ...(over || {}) };
  const doc = { visibilityState: 'visible', on: {}, addEventListener(e, f) { (doc.on[e] = doc.on[e] || []).push(f); }, fire(e, ev) { for (const f of doc.on[e] || []) f(ev || {}); } };
  const win = { on: {}, addEventListener(e, f) { (win.on[e] = win.on[e] || []).push(f); }, fire(e, ev) { for (const f of win.on[e] || []) f(ev || {}); } };
  let now = 1000;
  const clock = { now: () => now, step: (ms) => { now += ms; } };
  const store = { read: async (k) => ({ ok: true, value: disk[k] === undefined ? null : disk[k] }), write: async (k, v) => { disk[k] = v; return { ok: true }; } };
  const logs = [];
  const log = { info: (w, what, o) => logs.push(['info', what, o]), warn: (w, what, o) => logs.push(['warn', what, o]), error: (e) => logs.push(['error', String(e && e.message)]) };
  return { R, doc, win, clock, store, log, logs, cfg: { section: () => R } };
}
const tick = () => new Promise((r) => setTimeout(r, 5));
const endLog = (x) => x.logs.find((l) => l[1] === x.R.words.last_end) || [];

export default async function (t) {
  const { createSessionMark, lastEnd } = await t.src('resume');
  const disk = {};

  const a = rig(t, disk);
  const ma = createSessionMark(a);
  await tick();
  const ea = endLog(a);
  t.check('①', '처음 켬 — 지난번 끝 first(info) · 이번 켬 표시 start 를 적음', 'info · first · 표시 start · 켠 횟수 1', [ea[0], ea[2] && ea[2].end, (disk[a.R.store_key] || {}).mark, (disk[a.R.store_key] || {}).boots].join(' · '),
    ea[0] === 'info' && ea[2].end === a.R.ends.first && disk[a.R.store_key].mark === a.R.marks.start && disk[a.R.store_key].boots === 1);

  a.clock.step(5000);
  a.doc.visibilityState = 'hidden';
  a.doc.fire(a.R.events.vis);
  await ma.flush();
  const hid = disk[a.R.store_key].mark;
  a.win.fire(a.R.events.hide, { persisted: false });
  await ma.flush();
  t.check('②', '도는 동안 — 숨김을 적고, 페이지 내림(pagehide)을 적음', 'hidden → pagehide', hid + ' → ' + disk[a.R.store_key].mark, hid === a.R.marks.hidden && disk[a.R.store_key].mark === a.R.marks.pagehide);

  const b = rig(t, disk);
  const mb = createSessionMark(b);
  await tick();
  const eb = endLog(b);
  t.check('③', '깨끗이 닫힌 뒤 켬 — 지난번 끝 clean(info) · 돈 시간 · 켠 횟수 2', 'info · clean · 돈 5000ms · 2', [eb[0], eb[2] && eb[2].end, eb[2] && eb[2].ran_ms + 'ms', (disk[b.R.store_key] || {}).boots].join(' · '),
    eb[0] === 'info' && eb[2].end === b.R.ends.clean && eb[2].ran_ms === 5000 && disk[b.R.store_key].boots === 2);

  // 숨긴 채 꺼짐(폰이 뒤에서 탭을 정리 — pagehide 없음)
  b.doc.visibilityState = 'hidden';
  b.doc.fire(b.R.events.vis);
  await mb.flush();
  const c = rig(t, disk);
  createSessionMark(c);
  await tick();
  const ec = endLog(c);
  t.check('④', '숨긴 채 꺼짐(깨끗한 닫힘 표시 없음) — 예기치 않게 꺼짐(warn) · 숨긴 채', 'warn · unexpected · hidden', [ec[0], ec[2] && ec[2].end, ec[2] && ec[2].while].join(' · '),
    ec[0] === 'warn' && ec[2].end === c.R.ends.unexpected && ec[2].while === c.R.marks.hidden);

  // 보이는 채 꺼짐(켠 표시 그대로 — 앱·브라우저가 죽음)
  const d = rig(t, disk);
  createSessionMark(d);
  await tick();
  const ed = endLog(d);
  t.check('⑤', '보이는 채 꺼짐(켬 표시만 남음) — 예기치 않게 꺼짐(warn) · 보이는 채', 'warn · unexpected · visible', [ed[0], ed[2] && ed[2].end, ed[2] && ed[2].while].join(' · '),
    ed[0] === 'warn' && ed[2].end === d.R.ends.unexpected && ed[2].while === d.R.marks.visible);

  const R0 = t.cfg('config_resume');
  t.check('⑥', '순수 lastEnd — 틀린 값(글·빈 객체)은 처음으로', 'first · first', lastEnd('x', R0).end + ' · ' + lastEnd({}, R0).end, lastEnd('x', R0).end === R0.ends.first && lastEnd({}, R0).end === R0.ends.first);

  const disk2 = {};
  const e = rig(t, disk2, { on: false });
  createSessionMark(e);
  await tick();
  t.check('⑦', '끔(on 거짓) — 읽기·쓰기·듣기 없음 · 끔 로그', '쓰기 0 · 듣기 0 · 끔 로그 1', '쓰기 ' + Object.keys(disk2).length + ' · 듣기 ' + (Object.keys(e.doc.on).length + Object.keys(e.win.on).length) + ' · 끔 로그 ' + e.logs.filter((l) => l[1] === e.R.words.off).length,
    Object.keys(disk2).length === 0 && Object.keys(e.doc.on).length + Object.keys(e.win.on).length === 0 && e.logs.filter((l) => l[1] === e.R.words.off).length === 1);
}
