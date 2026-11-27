// 단위 시험: 상태 자리(ui_status) 중 11/27 더한 '출처마다 줄 꼴'(texts.src_line_by_src) — 화면 켜 두기는 '○시부터 끊김'이 아니라 '안 됨 — 까닭' 한 줄, 다른 출처는 그대로.
export default async function (t) {
  const { createStatusBar } = await t.src('ui_status');
  const timefmt = await t.src('timefmt');
  const US = t.cfg('config_ui_status');
  const HC = t.cfg('config_health');
  const cfgs = { config_ui_status: US, config_health: HC, config_time: t.cfg('config_time') };
  const el = { textContent: '', attrs: {}, setAttribute(k, v) { el.attrs[k] = v; } };
  const doc = { getElementById: () => el, body: { setAttribute() {} } };
  const subs = {};
  const state = { subscribe: (n, fn) => { (subs[n] = subs[n] || []).push(fn); }, fire: (n, v) => { for (const fn of subs[n] || []) fn(v); } };
  createStatusBar({ cfg: { section: (n) => cfgs[n] }, log: { error() {} }, state, doc, clock: { now: () => 0 }, timefmt });
  state.fire(US.app_piece, { stage: HC.stages.good });
  state.fire(US.src_piece, { wake: { ok: false, why: 'wake_none', since: 0 }, loc: { ok: false, why: 'none', since: 0 } });
  const lines = el.textContent.split('\n');
  const want = US.texts.src_line_by_src.wake.replace('{src}', US.texts.src_names.wake).replace('{why}', US.texts.why_words.wake_none);
  t.check('①', '화면 켜 두기 안 됨 — 출처 줄 꼴로 한 줄 · 위치는 옛 꼴(끊김) 그대로', want + ' / … 끊김(' + US.texts.why_words.none + ')', lines.join(' / '),
    lines.length === 2 && lines.includes(want) && lines.some((l) => l.startsWith(US.texts.src_names.loc) && l.includes(US.texts.why_words.none)));
}
