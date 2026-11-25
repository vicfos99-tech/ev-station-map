// RelayClient 의 조각 — 충전소 목록·고속도로 선(바깥 연결, 보통 객체 — 설계 5-1-나 relay_stations · F6).
// health.app 이 '시작 중'이 되면 다리 자료 길로 meta → 충전소 목록 파일들 → 선 파일들을 받아(relay_base) 검사하고(relay_parse),
// 나쁜 줄은 거르고 기록한다. 결과를 stations 로 낸 뒤 시작 결과를 conn.start.relay 로 낸다(시작 필요 데이터 '충전소 목록'·'고속도로 선' — 판정은 HealthRunner).
// **켤 때 사본으로 대신하지 않는다** — 못 받으면 시작 실패. 한 번 뜬 뒤에는 정한 간격(config 와 board.needs 중 짧은 것, 아래 한도 있음)으로 다시 받고,
// 실패하면 들고 있는 목록을 그대로 두고 conn.relay 로 끊김만 알린다(상태 자리에 '충전소 자료 — 끊김' 한 줄은 HealthRunner·StatusBar 의 일).
export const NEEDS = ['cfg', 'log', 'state', 'clock', 'relay_base', 'relay_parse'];

export function createRelayStations(deps) {
  const log = deps.log;
  const clock = deps.clock;
  const base = deps.relay_base;
  const parse = deps.relay_parse;
  const c = deps.cfg.section('config_relay_stations');
  const pr = deps.cfg.section('config_relay_parse');
  const r = deps.cfg.section('config_health');
  const pub = deps.state.claim(c.owner, [c.piece, c.conn_piece, c.start_piece]);
  let begun = false;
  let running = false;
  let stopped = false;
  let busy = false;
  let timer = null;
  let refreshMs = c.refresh_ms;
  let held = null;
  let lastConn = null;

  function fail(need, got, code) {
    return { ok: false, need, code: code || (got && got.code) || c.codes.internal, src: got ? got.src : undefined };
  }

  function badFile(file, e, need) {
    log.warn(c.where, c.word_bad_file, { file, why: e && e.message });
    return fail(need, null, c.codes.bad);
  }

  async function readStations() {
    const need = c.needs.stations;
    const m = await base.get(c.meta_file);
    if (!m.ok) return fail(need, m);
    try { parse.meta(m.data, pr); } catch (e) { return badFile(c.meta_file, e, need); }
    const got = await Promise.all(c.station_files.map((f) => base.get(f).then((g) => ({ f, g }))));
    const list = [];
    const seen = new Set();
    for (const { f, g } of got) {
      if (!g.ok) {
        if (c.skip_codes.includes(g.code)) continue; // 그 시군구 파일이 없음 = 거기 충전소 없음
        return fail(need, g);
      }
      let p;
      try { p = parse.stations(g.data, pr); } catch (e) { return badFile(f, e, need); }
      if (p.bad.length) log.warn(c.where, c.word_bad_items, { file: f, bad: p.bad.length, kept: p.good.length, first: p.bad.slice(0, c.log_bad_max) });
      if (!p.good.length && p.bad.length) return fail(need, null, c.codes.bad);
      for (const s of p.good) {
        if (seen.has(s.id)) continue;
        seen.add(s.id);
        list.push(s);
      }
    }
    if (!list.length) return fail(need, null, c.codes.empty);
    return { ok: true, list };
  }

  async function readLines() {
    const need = c.needs.lines;
    const lines = [];
    for (const f of c.line_files) {
      const g = await base.get(f);
      if (!g.ok) return fail(need, g);
      try { lines.push(parse.line(g.data, pr)); } catch (e) { return badFile(f, e, need); }
    }
    if (!lines.length) return fail(need, null, c.codes.empty);
    return { ok: true, lines };
  }

  async function readAll() {
    try {
      const s = await readStations();
      if (!s.ok) return s;
      const l = await readLines();
      if (!l.ok) return l;
      return { ok: true, value: { [c.list_key]: s.list, [c.lines_key]: l.lines, [c.at_key]: clock.now() } };
    } catch (e) {
      log.error(e, { where: c.where, params: { held: !!held } });
      return fail(c.needs.stations, null, c.codes.internal);
    }
  }

  function conn(ok, code, src) {
    const key = ok + ':' + code + ':' + src;
    if (key === lastConn) return;
    lastConn = key;
    pub(c.conn_piece, { ok, code: ok ? null : code, src: ok ? null : src });
  }

  function schedule() {
    if (!running || stopped || timer !== null) return;
    timer = clock.setTimeout(refresh, refreshMs);
  }

  async function refresh() {
    timer = null;
    if (busy || !running || stopped) return;
    busy = true;
    try {
      const res = await readAll();
      if (!running || stopped) return;
      if (res.ok) {
        held = res.value;
        pub(c.piece, held);
        conn(true, null, null);
      } else {
        log.warn(c.where, c.word_refresh_fail, { need: res.need, code: res.code, src: res.src, kept: held ? held[c.list_key].length : 0 });
        conn(false, res.code, res.src);
      }
    } finally {
      busy = false;
      schedule();
    }
  }

  async function first() {
    const res = await readAll();
    if (stopped) return;
    if (!res.ok) {
      log.warn(c.where, c.word_start_fail, { need: res.need, code: res.code, src: res.src });
      pub(c.start_piece, { need: res.need, ok: false, code: res.code, src: res.src });
      return;
    }
    held = res.value;
    running = true;
    log.info(c.where, c.word_loaded, { stations: held[c.list_key].length, lines: held[c.lines_key].length });
    pub(c.piece, held);
    conn(true, null, null);
    for (const need of Object.values(c.needs)) pub(c.start_piece, { need, ok: true });
    schedule();
  }

  deps.state.subscribe(c.app_piece, (v) => {
    if (!v) return;
    if (v.stage === r.stages.broken) {
      stopped = true;
      if (timer !== null) { clock.clearTimeout(timer); timer = null; }
      return;
    }
    if (v.stage === r.stages.starting && !begun) {
      begun = true;
      first();
    }
  });

  // 판들이 밝힌 갱신 간격(board.needs)에 맞춘다 — 설정 간격보다 길게는 안 늘고, 아래 한도 밑으로는 안 내려간다
  deps.state.subscribe(c.board_needs_piece, (v) => {
    const want = v && v.topics ? v.topics[c.piece] : undefined;
    refreshMs = typeof want === 'number' ? Math.max(c.min_refresh_ms, Math.min(c.refresh_ms, want)) : c.refresh_ms;
  });

  return {
    held: () => held,
    halt() {
      stopped = true;
      if (timer !== null) { clock.clearTimeout(timer); timer = null; }
    },
  };
}
