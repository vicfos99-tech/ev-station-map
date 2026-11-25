// BoardHost(알림판 틀 — 화면, 설계 5-1-다 · E4). 빌드가 주운 판 목록(boards — [{name, module, view}])을 넘겨받아 판마다:
//   만들기(module[factory]) → 부모 Board 꼴 검사 → needs() 읽기 → 그 자리(slot)에 판 조각(view)을 꽂기 → needs 의 조각을 State 에서 구독 →
//   needs 의 간격(아래 한도 있음)마다, 바뀐 것이 있을 때만 show(data) 를 부른다.
// 판들의 요구(조각 → 가장 짧은 간격)는 board.needs 로 한 번 알린다(클라이언트가 받기 간격을 맞춤).
// **어떤 판이 있는지 코드에 적지 않는다** — 판을 더하거나 빼도 이 파일·조립·ui_drive 는 그대로다. 판이 던지면 잡아 로그(같은 오류는 한 번만).
export const NEEDS = ['cfg', 'log', 'state', 'doc', 'clock', 'timefmt', 'board', 'boards'];

export function createBoardHost(deps) {
  const c = deps.cfg.section('config_ui_boards');
  const log = deps.log;
  const state = deps.state;
  const doc = deps.doc;
  const pub = state.claim(c.owner, [c.needs_piece]);
  const want = {};
  const mounted = [];

  function mount(entry) {
    const made = entry.module[c.factory]({ cfg: deps.cfg, log, doc, timefmt: deps.timefmt, board: deps.board });
    if (!made || typeof made.needs !== 'function' || typeof made.show !== 'function') throw new TypeError(entry.name);
    const n = deps.board.checkNeeds(made.needs(), c.rule);
    const slot = doc.getElementById(c.slots[n.slot]);
    if (!slot) throw new Error(c.slots[n.slot]);
    // 자리의 가장 좁은 폭(설정) — 판 글이 자리 밖으로 밀려 잘리지 않게(속도판 세 자리 잘림 고침)
    const minPx = c.slot_min_px[n.slot];
    if (typeof minPx === 'number' && slot.style) slot.style.minWidth = minPx + c.px_unit;
    const box = doc.createElement(c.box_tag);
    box.className = c.box_class;
    box.setAttribute(c.name_attr, entry.name);
    box.innerHTML = entry.view || '';
    slot.appendChild(box);
    const latest = {};
    let dirty = true;
    let lastErr = null;
    for (const t of n.topics) {
      latest[t] = state.get(t);
      state.subscribe(t, (v) => { latest[t] = v; dirty = true; });
      want[t] = want[t] === undefined ? n.interval_ms : Math.min(want[t], n.interval_ms);
    }
    const tick = () => {
      if (!dirty) return;
      dirty = false;
      try {
        made.show({ ...latest });
        lastErr = null;
      } catch (e) {
        const msg = String(e && e.message);
        if (msg !== lastErr) log.error(e, { where: c.where, what: c.word_show_failed, params: { name: entry.name } });
        lastErr = msg;
      }
    };
    deps.clock.setInterval(tick, Math.max(c.rule.min_interval_ms, n.interval_ms));
    tick();
    mounted.push(entry.name);
    log.info(c.where, c.word_mounted, { name: entry.name, slot: n.slot, topics: n.topics, interval_ms: n.interval_ms });
  }

  for (const entry of deps.boards || []) {
    try {
      mount(entry);
    } catch (e) {
      log.error(e, { where: c.where, what: c.word_mount_failed, params: { name: entry && entry.name } });
    }
  }
  pub(c.needs_piece, { topics: { ...want }, boards: mounted.slice() });
  return { mounted: () => mounted.slice() };
}
