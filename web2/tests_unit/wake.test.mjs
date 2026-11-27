// 단위 시험: 화면 꺼짐 막기(wake — 묘성 11/27 ①). 가짜 State·문서·창으로 — 좋음이 되면 잡음 · 숨었다 보이면 다시 잡음 ·
// 지원 안 됨 / 거절이면 conn.wake 나쁨(상태 자리 한 줄의 길) + 거절 문구 그대로 로그 · 끔(on 거짓)이면 아무것도 안 함.
function rig(t, opts) {
  const W = { ...t.cfg('config_wake'), ...(opts.over || {}) };
  const HC = t.cfg('config_health');
  const subs = {};
  const pubs = [];
  const state = {
    claim: (owner, names) => (n, v) => { if (!names.includes(n)) throw new Error(n); pubs.push([n, v]); },
    subscribe: (n, fn) => { (subs[n] = subs[n] || []).push(fn); },
    fire: (n, v) => { for (const fn of subs[n] || []) fn(v); },
  };
  const doc = { visibilityState: 'visible', on: {}, addEventListener(e, f) { (doc.on[e] = doc.on[e] || []).push(f); }, fire(e) { for (const f of doc.on[e] || []) f({}); } };
  const sentinels = [];
  let wakeLock = { request: async (kind) => { const s = { kind, released: false, on: {}, addEventListener(e, f) { s.on[e] = f; } }; sentinels.push(s); return s; } };
  if (opts.none) wakeLock = null;
  if (opts.deny) wakeLock = { request: async () => { const e = new Error('Wake Lock permission request denied'); e.name = 'NotAllowedError'; throw e; } };
  const win = { navigator: { wakeLock } };
  const logs = [];
  const log = { info: (w, what, o) => logs.push(['info', what, o]), warn: (w, what, o) => logs.push(['warn', what, o]), error: (e) => logs.push(['error', String(e && e.message)]) };
  return { W, HC, state, doc, win, log, logs, pubs, sentinels, cfg: { section: (n) => (n === 'config_wake' ? W : HC) } };
}
const tick = () => new Promise((r) => setTimeout(r, 5));

export default async function (t) {
  const { createWakeKeeper } = await t.src('wake');

  const a = rig(t, {});
  const ka = createWakeKeeper(a);
  const before = a.sentinels.length;
  a.state.fire(a.W.app_piece, { stage: a.HC.stages.good });
  await tick();
  const okPub = a.pubs.filter((p) => p[0] === a.W.conn_piece);
  t.check('①', '앱이 좋음이 되면 화면 깨움을 잡음(종류 screen) · conn.wake 좋음 · 잡음 로그', '좋음 전 0 · 잡음 1 · 종류 ' + a.W.kind + ' · conn 좋음 · 로그 ' + a.W.words.got,
    '좋음 전 ' + before + ' · 잡음 ' + a.sentinels.length + ' · 종류 ' + (a.sentinels[0] || {}).kind + ' · conn ' + JSON.stringify(okPub.map((p) => p[1])) + ' · 로그 ' + a.logs.filter((l) => l[1] === a.W.words.got).length,
    before === 0 && a.sentinels.length === 1 && a.sentinels[0].kind === a.W.kind && okPub.length === 1 && okPub[0][1].ok === true && ka.held());

  // 숨으면 브라우저가 풂 → 다시 보이면 다시 잡음
  a.sentinels[0].released = true;
  a.sentinels[0].on[a.W.release_event]();
  a.doc.visibilityState = 'hidden';
  a.doc.fire(a.W.vis_event);
  await tick();
  const whileHidden = a.sentinels.length;
  a.doc.visibilityState = 'visible';
  a.doc.fire(a.W.vis_event);
  await tick();
  t.check('②', '풀림(숨김) → 숨은 동안 안 잡음 → 다시 보이면 다시 잡음 · 풀림 로그', '숨은 동안 1 · 보인 뒤 2 · 풀림 로그 1',
    '숨은 동안 ' + whileHidden + ' · 보인 뒤 ' + a.sentinels.length + ' · 풀림 로그 ' + a.logs.filter((l) => l[1] === a.W.words.released).length,
    whileHidden === 1 && a.sentinels.length === 2 && a.logs.filter((l) => l[1] === a.W.words.released).length === 1);

  const b = rig(t, { none: true });
  createWakeKeeper(b);
  b.state.fire(b.W.app_piece, { stage: b.HC.stages.good });
  await tick();
  const bp = b.pubs.filter((p) => p[0] === b.W.conn_piece);
  t.check('③', '지원 안 되는 폰 — conn.wake 나쁨(까닭 ' + b.W.codes.unsupported + ') 한 번 · 경고 로그', '나쁨 ' + b.W.codes.unsupported + ' · 1번 · 경고 1',
    JSON.stringify(bp.map((p) => p[1])) + ' · 경고 ' + b.logs.filter((l) => l[0] === 'warn' && l[1] === b.W.words.fail).length,
    bp.length === 1 && bp[0][1].ok === false && bp[0][1].code === b.W.codes.unsupported && b.logs.filter((l) => l[0] === 'warn' && l[1] === b.W.words.fail).length === 1);

  const c = rig(t, { deny: true });
  createWakeKeeper(c);
  c.state.fire(c.W.app_piece, { stage: c.HC.stages.good });
  await tick();
  const cp = c.pubs.filter((p) => p[0] === c.W.conn_piece);
  const cl = c.logs.find((l) => l[1] === c.W.words.fail) || [];
  t.check('④', '거절(NotAllowedError) — conn.wake 나쁨(까닭 ' + c.W.codes.denied + ') · 로그에 거절 이름·문구 그대로', '나쁨 ' + c.W.codes.denied + ' · NotAllowedError · 문구',
    JSON.stringify(cp.map((p) => p[1])) + ' · ' + JSON.stringify(cl[2]),
    cp.length === 1 && cp[0][1].code === c.W.codes.denied && cl[2] && cl[2].name === 'NotAllowedError' && cl[2].message === 'Wake Lock permission request denied');

  const d = rig(t, { over: { on: false } });
  createWakeKeeper(d);
  d.state.fire(d.W.app_piece, { stage: d.HC.stages.good });
  await tick();
  t.check('⑤', '끔(on 거짓) — 잡지 않음 · conn 안 냄 · 끔 로그', '잡음 0 · conn 0 · 끔 로그 1', '잡음 ' + d.sentinels.length + ' · conn ' + d.pubs.length + ' · 끔 로그 ' + d.logs.filter((l) => l[1] === d.W.words.off).length,
    d.sentinels.length === 0 && d.pubs.length === 0 && d.logs.filter((l) => l[1] === d.W.words.off).length === 1);
}
