// SessionMark(꺼진 까닭 남기기 — 묘성 11/27 ②). 켤 때 폰 데이터 폴더(Store 키 c.store_key)의 '지난번 마지막 표시'를 읽어
// 지난번이 어떻게 끝났는지 로그 한 줄(lastEnd — 처음 · 깨끗이 닫힘(페이지 내림 pagehide 를 적음) · 예기치 않게 꺼짐(깨끗한 닫힘 표시 없음 — 숨긴 채/보이는 채))을 남기고,
// 이번 켬을 새로 적는다. 도는 동안 페이지 숨김·보임(visibilitychange)·내림(pagehide)·되살림(pageshow persisted)을 그때그때 적는다(쓰기 실패는 로그).
// 하던 자리로 돌아오기는 저마다의 모듈이 한다(제목 = ui_topic · 지도 카메라 = ui_map · 고른 길 = net_route). 켬·끔 = c.on. 값·이름은 config_resume.
export const NEEDS = ['cfg', 'log', 'store', 'doc', 'win', 'clock'];

// 순수: 지난 표시 하나 → 끝난 꼴 {end, while} (rec 이 없으면 처음)
export function lastEnd(rec, c) {
  if (!rec || typeof rec !== 'object' || typeof rec.mark !== 'string') return { end: c.ends.first, while: null };
  if (rec.mark === c.marks.pagehide) return { end: c.ends.clean, while: null };
  return { end: c.ends.unexpected, while: rec.mark === c.marks.hidden ? c.marks.hidden : c.marks.visible };
}

export function createSessionMark(deps) {
  const c = deps.cfg.section('config_resume');
  const log = deps.log;
  const doc = deps.doc;
  const win = deps.win;
  const clock = deps.clock;
  let cur = null;
  let chain = Promise.resolve();
  const stats = { marks: 0, failed: 0 };

  // 표시 쓰기는 차례로(앞 쓰기가 끝난 뒤) — 겹쳐 쓰다 앞 것이 뒤 것을 덮지 않게
  function mark(m, extra) {
    if (!cur) return;
    cur = { ...cur, mark: m, at: clock.now(), ...(extra || {}) };
    const snap = cur;
    stats.marks += 1;
    chain = chain.then(async () => {
      const res = await deps.store.write(c.store_key, snap);
      if (!res.ok) { stats.failed += 1; log.warn(c.where, c.words.write_fail, { mark: m, why: res.why }); }
    }).catch((e) => log.error(e, { where: c.where, params: { act: c.act_mark, mark: m } }));
    log.info(c.where, c.words.mark, { mark: m, ...(extra || {}) });
  }

  async function start() {
    const got = await deps.store.read(c.store_key);
    const prev = got.ok ? got.value : null;
    const e = lastEnd(prev, c);
    const info = { end: e.end, while: e.while, last_mark: prev ? prev.mark : null, last_at: prev ? prev.at : null, last_started: prev ? prev.started_at : null,
      ran_ms: prev && typeof prev.at === 'number' && typeof prev.started_at === 'number' ? prev.at - prev.started_at : null, boots: prev && typeof prev.boots === 'number' ? prev.boots : 0, why: got.ok ? null : got.why };
    if (e.end === c.ends.unexpected) log.warn(c.where, c.words.last_end, info);
    else log.info(c.where, c.words.last_end, info);
    const now = clock.now();
    cur = { started_at: now, at: now, mark: c.marks.start, boots: info.boots + 1 };
    mark(c.marks.start);
  }

  if (!c.on) {
    log.info(c.where, c.words.off, {});
  } else {
    try {
      doc.addEventListener(c.events.vis, () => mark(doc.visibilityState === c.visible_word ? c.marks.visible : c.marks.hidden));
      if (win && typeof win.addEventListener === 'function') {
        win.addEventListener(c.events.hide, (ev) => mark(c.marks.pagehide, { persisted: !!(ev && ev.persisted) }));
        win.addEventListener(c.events.show, (ev) => { if (ev && ev.persisted) mark(c.marks.visible, { revived: true }); });
      }
    } catch (e) {
      log.error(e, { where: c.where, params: { act: c.act_init } });
    }
    start().catch((e) => log.error(e, { where: c.where, params: { act: c.act_start } }));
  }

  return { stats: () => ({ ...stats }), current: () => (cur ? { ...cur } : null), flush: () => chain };
}
