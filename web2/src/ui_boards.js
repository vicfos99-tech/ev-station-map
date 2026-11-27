// BoardHost(알림판 틀 — 화면, 설계 5-1-다 · E4). 빌드가 주운 판 목록(boards — [{name, module, view}])을 넘겨받아 판마다:
//   만들기(module[factory]) → 부모 Board 꼴 검사 → needs() 읽기 → 그 자리(slot)에 판 조각(view)을 꽂기 → needs 의 조각을 State 에서 구독 →
//   needs 의 간격(아래 한도 있음)마다, 바뀐 것이 있을 때만 show(data) 를 부른다.
// 판들의 요구(조각 → 가장 짧은 간격)는 board.needs 로 한 번 알린다(클라이언트가 받기 간격을 맞춤).
// **어떤 판이 있는지 코드에 적지 않는다** — 판을 더하거나 빼도 이 파일·조립·ui_drive 는 그대로다. 판이 던지면 잡아 로그(같은 오류는 한 번만).
export const NEEDS = ['cfg', 'log', 'state', 'doc', 'clock', 'timefmt', 'board', 'boards', 'topic_on'];

export function createBoardHost(deps) {
  const c = deps.cfg.section('config_ui_boards');
  const log = deps.log;
  const state = deps.state;
  const doc = deps.doc;
  const pub = state.claim(c.owner, [c.needs_piece]);
  const want = {};
  const mounted = [];

  function mount(entry) {
    // 판의 누름 → State 요청(needs().sends 에 밝힌 이름만 — 주인은 그 판). 밝히기 전이나 밝히지 않은 이름이면 던진다(판이 잡아 로그)
    let sendPub = null;
    const send = (name, value) => {
      if (!sendPub) throw new Error(name);
      sendPub(name, value);
    };
    const made = entry.module[c.factory]({ cfg: deps.cfg, log, doc, timefmt: deps.timefmt, board: deps.board, send });
    if (!made || typeof made.needs !== 'function' || typeof made.show !== 'function') throw new TypeError(entry.name);
    const n = deps.board.checkNeeds(made.needs(), c.rule);
    // (추가3 앞) 제목에 딸린 판(needs().topic)은 그 제목이 켜졌을 때만 — 켠 제목 이름은 조립이 넘긴다(topic_on, 없으면 null)
    if (n.topic !== undefined && n.topic !== (deps.topic_on || null)) {
      log.info(c.where, c.word_skipped, { name: entry.name, topic: n.topic, on: deps.topic_on || null });
      return;
    }
    if (n.sends && n.sends.length) sendPub = state.claim(c.board_owner_prefix + entry.name, n.sends);
    const slot = doc.getElementById(c.slots[n.slot]);
    if (!slot) throw new Error(c.slots[n.slot]);
    // 자리의 가장 좁은 폭(설정) — 판 글이 자리 밖으로 밀려 잘리지 않게(속도판 세 자리 잘림 고침).
    // 세로(좁은) 창에서도 배치를 바꾸지 않으므로 창 폭의 비율(slot_min_vw)을 넘지 않게 둘 가운데 작은 값(고칠 것 ⑦)
    const minPx = c.slot_min_px[n.slot];
    const minVw = c.slot_min_vw[n.slot];
    if (typeof minPx === 'number' && slot.style) {
      slot.style.minWidth = typeof minVw === 'number'
        ? c.slot_min_css.split(c.px_mark).join(minPx + c.px_unit).split(c.vw_mark).join(minVw + c.vw_unit)
        : minPx + c.px_unit;
    }
    const box = doc.createElement(c.box_tag);
    box.className = c.box_class;
    box.setAttribute(c.name_attr, entry.name);
    // 원칙점검:허용 view 는 빌드가 저장소의 판 조각 파일(view_*.html)을 그대로 넣은 우리 화면 틀이다 — 밖에서 온 글이 아니고, 이스케이프하면 틀이 글로 보여 화면이 깨진다. 판이 그리는 글은 판 안에서 textContent
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
    log.info(c.where, c.word_mounted, { name: entry.name, slot: n.slot, topics: n.topics, interval_ms: n.interval_ms, sends: n.sends || [] });
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
