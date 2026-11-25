// RelayClient 의 조각 — 충전기 상태 받기(바깥 연결, 보통 객체 — 설계 5-1-나 알림 표 relay · relay.refresh · 5-7 (4) (나)).
// 정보 칸이 열려 있는 동안(station.open — 고른 충전소 id 들)만 그 충전소들이 든 시군구의 상태 파일과 meta 를 다리 자료 길로 받는다:
//   열릴 때 한 번 → 정한 간격마다(refresh_ms) → '다시 받기'(relay.refresh)를 누르면 곧바로. 닫히면 멈춘다(다리와 GitHub 를 두드리지 않게).
// 받은 것은 검사(relay_parse.meta · relay_read.status)한 뒤 들고 있는 것에 더해 relay 로 낸다(받은 때 함께). 실패하면 **들고 있는 것을 그대로 두고**
// conn.relay.status 로 끊김만 알린다(상태 자리 한 줄은 HealthRunner·StatusBar 의 일). 그 시군구 파일이 없으면(none) 그 곳 충전기는 '모름'.
// relay = {meta: {at, ok, fresh, got_ms} | null, zones: {zscode: {at, s, got_ms}}, last: {at_ms, ok, code, ask}}
export const NEEDS = ['cfg', 'log', 'state', 'clock', 'relay_base', 'relay_parse', 'relay_read'];

export function createRelayStatus(deps) {
  const log = deps.log;
  const clock = deps.clock;
  const base = deps.relay_base;
  const c = deps.cfg.section('config_relay_status');
  const pr = deps.cfg.section('config_relay_parse');
  const rr = deps.cfg.section('config_relay_read');
  const r = deps.cfg.section('config_health');
  const pub = deps.state.claim(c.owner, [c.piece, c.conn_piece]);
  let list = [];
  let watching = null;
  let timer = null;
  let busy = false;
  let again = null;
  let stopped = false;
  let good = false;
  let asks = 0;
  let lastConn = null;
  const held = { meta: null, zones: {}, last: null };

  function conn(ok, code, src) {
    const key = ok + ':' + code + ':' + src;
    if (key === lastConn) return;
    lastConn = key;
    pub(c.conn_piece, { ok, code: ok ? null : code, src: ok ? null : src });
  }

  function publish() {
    pub(c.piece, { meta: held.meta, zones: { ...held.zones }, last: held.last });
  }

  function stopTimer() {
    if (timer !== null) { clock.clearTimeout(timer); timer = null; }
  }

  function schedule() {
    stopTimer();
    if (stopped || !watching) return;
    timer = clock.setTimeout(() => { timer = null; fetchNow(c.ask.timer); }, c.refresh_ms);
  }

  async function readAll(zones) {
    const m = await base.get(c.meta_file);
    if (!m.ok) return { ok: false, code: m.code, src: m.src, file: c.meta_file };
    let meta;
    try { meta = deps.relay_parse.meta(m.data, pr); } catch (e) { return { ok: false, code: c.codes.bad, file: c.meta_file, why: e.message }; }
    const got = {};
    for (const z of zones) {
      const file = c.status_file.split(c.zone_mark).join(z);
      const g = await base.get(file);
      if (!g.ok) {
        if (c.skip_codes.includes(g.code)) { got[z] = { at: null, s: {} }; continue; } // 그 시군구 상태 파일이 없음 = 모두 모름
        return { ok: false, code: g.code, src: g.src, file };
      }
      try { got[z] = deps.relay_read.status(g.data, rr); } catch (e) { return { ok: false, code: c.codes.bad, file, why: e.message }; }
    }
    return { ok: true, meta, got };
  }

  // ask = 무엇이 불렀나(열림·간격·다시 받기) — 기록장과 relay.last 에 남는다
  async function fetchNow(ask) {
    if (stopped || !watching || !good) return;
    if (busy) { again = ask; return; }
    busy = true;
    asks += 1;
    const zones = watching.zones.slice();
    const t0 = clock.now();
    try {
      const res = await readAll(zones);
      if (stopped) return;
      const now = clock.now();
      if (res.ok) {
        held.meta = { ...res.meta, got_ms: now };
        for (const [z, v] of Object.entries(res.got)) held.zones[z] = { ...v, got_ms: now };
        held.last = { at_ms: now, ok: true, code: null, ask };
        log.info(c.where, c.word_got, { ask, zones, ms: now - t0, meta_at: res.meta.at });
        conn(true, null, null);
      } else {
        held.last = { at_ms: now, ok: false, code: res.code, ask };
        log.warn(c.where, c.word_fail, { ask, zones, file: res.file, code: res.code, src: res.src, why: res.why, kept: Object.keys(held.zones).length });
        conn(false, res.code, res.src);
      }
      publish();
    } catch (e) {
      log.error(e, { where: c.where, params: { ask, zones } });
      held.last = { at_ms: clock.now(), ok: false, code: c.codes.internal, ask };
      conn(false, c.codes.internal, null);
      publish();
    } finally {
      busy = false;
      if (again !== null) {
        const next = again;
        again = null;
        fetchNow(next);
      } else schedule();
    }
  }

  deps.state.subscribe(c.app_piece, (v) => {
    if (!v) return;
    if (v.stage === r.stages.broken) { stopped = true; stopTimer(); return; }
    if (v.stage === r.stages.good && !good) {
      good = true;
      if (watching) fetchNow(c.ask.open);
    }
  });

  deps.state.subscribe(c.stations_piece, (st) => {
    list = st && Array.isArray(st[c.list_key]) ? st[c.list_key] : [];
  });

  // 보는 충전소 = 정보 칸(open_piece)의 것 + (A7) 목록 칸이 열린 동안 그 노선의 것(list_piece — RouteScreen). 둘 다 닫히면 멈춘다.
  // 정보 칸이 열리면 늘 곧바로 받고, 목록 칸은 보는 시군구가 바뀔 때만 곧바로 받는다(목록이 다시 그려질 때마다 두드리지 않게)
  let cardIds = [];
  let listIds = [];
  function rewatch(ask) {
    const ids = [...new Set([...cardIds, ...listIds])];
    if (!ids.length) {
      watching = null;
      stopTimer();
      return;
    }
    const zones = deps.relay_read.zonesOf(ids, list);
    const moved = !watching || watching.zones.join() !== zones.join();
    watching = { ids, zones };
    if (ask === c.ask.open || moved) log.info(c.where, c.word_watch, { ask, ids: ids.length, zones });
    if (!zones.length) return;
    if (ask === c.ask.open || moved) fetchNow(ask);
  }

  // 정보 칸이 열림(고른 충전소 id 들) / 닫힘(null)
  deps.state.subscribe(c.open_piece, (v) => {
    try {
      cardIds = v && Array.isArray(v.ids) ? v.ids.slice() : [];
      rewatch(cardIds.length ? c.ask.open : c.ask.list);
    } catch (e) {
      log.error(e, { where: c.where, params: { act: c.ask.open } });
    }
  });
  deps.state.subscribe(c.list_piece, (v) => {
    try {
      listIds = v && Array.isArray(v.ids) ? v.ids.slice() : [];
      rewatch(c.ask.list);
    } catch (e) {
      log.error(e, { where: c.where, params: { act: c.ask.list } });
    }
  });

  deps.state.subscribe(c.refresh_piece, () => {
    if (!watching || !watching.zones.length) return;
    fetchNow(c.ask.button);
  });

  return {
    held: () => held,
    asks: () => asks,
    halt() {
      stopped = true;
      stopTimer();
    },
  };
}
