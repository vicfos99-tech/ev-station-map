// RelayClient 의 조각 — 제한 속도 자료 받기(바깥 연결, 보통 객체 — 설계 5-1-나 relay_limit · 5-8 나 · 알림 표 limit.data).
// health.app 이 '좋음'이 되면: 폰 사본(Store — 보관 날 수 안의 것)을 먼저 들고 → 다리 자료 길로 고속도로 표 한 파일 + 일반 도로 칸 목차를 받는다.
// fix 를 구독해 지금 칸과 이웃 칸(LimitMatch.cellsAround — 칸 셈은 그 한 곳)이 바뀌면 목차에 있는 칸 파일만 받는다(목차에 없는 칸 = 자료 없는 길).
// 받은 것은 검사(relay_parse.limitHighway·limitIndex·limitCell)한 뒤 들고 있는 것에 더해 limit.data 로 내고 폰에 사본을 쓴다.
// 실패하면 **들고 있는 것을 그대로 두고**(사본 포함) conn.relay.limit 로 끊김만 알린다(설계 5-7 (4) — 상태 자리 한 줄은 HealthRunner·StatusBar 의 일).
// 끝내 못 받은 칸은 missing 에 적는다(그 칸의 길은 LimitMatch 가 '없음' → 속도판 빈 칸 — 짐작 값을 만들지 않음).
// limit.data = {highway: {sections, at, got_ms, from} | null, index: {cells, at, got_ms, from} | null, cells: {열쇠: {segs, at, got_ms, from}}, want: [열쇠], missing: [열쇠]}
export const NEEDS = ['cfg', 'log', 'store', 'state', 'clock', 'relay_base', 'relay_parse', 'limitmatch'];

export function createRelayLimit(deps) {
  const log = deps.log;
  const clock = deps.clock;
  const base = deps.relay_base;
  const parse = deps.relay_parse;
  const lm = deps.limitmatch;
  const c = deps.cfg.section('config_relay_limit');
  const pr = deps.cfg.section('config_relay_parse');
  const lr = deps.cfg.section('config_limitmatch');
  const r = deps.cfg.section('config_health');
  const pub = deps.state.claim(c.owner, [c.piece, c.conn_piece]);
  const held = { highway: null, index: null, cells: {} };
  let want = [];
  let wantKey = '';
  let missing = [];
  let good = false;
  let stopped = false;
  let busy = false;
  let again = false;
  let timer = null;
  let lastConn = null;
  let baseFailed = false;
  let asks = 0;

  function conn(ok, code, src) {
    const key = ok + ':' + code + ':' + src;
    if (key === lastConn) return;
    lastConn = key;
    pub(c.conn_piece, { ok, code: ok ? null : code, src: ok ? null : src });
  }

  function publish() {
    pub(c.piece, { highway: held.highway, index: held.index, cells: { ...held.cells }, want: want.slice(), missing: missing.slice() });
  }

  function stopTimer() {
    if (timer !== null) { clock.clearTimeout(timer); timer = null; }
  }

  function schedule(ms) {
    stopTimer();
    if (stopped || !good) return;
    timer = clock.setTimeout(() => { timer = null; run(c.ask.timer); }, ms);
  }

  // 들고 있는 칸이 한도를 넘으면 지금 바라는 칸이 아닌 것부터, 오래 받은 것부터 버린다
  function trim() {
    const keys = Object.keys(held.cells);
    if (keys.length <= c.keep_cells) return;
    const drop = keys.filter((k) => !want.includes(k)).sort((a, b) => held.cells[a].got_ms - held.cells[b].got_ms);
    for (const k of drop.slice(0, keys.length - c.keep_cells)) delete held.cells[k];
  }

  // 파일 하나 받기 + 검사. {ok, v} | {ok:false, none} (그 파일이 없음 — 실패 아님) | {ok:false, code, src, why}
  async function getFile(file, fn) {
    const g = await base.get(file);
    if (!g.ok) {
      if (c.skip_codes.includes(g.code)) return { ok: false, none: true };
      return { ok: false, code: g.code, src: g.src, file };
    }
    let p;
    try { p = fn(g.data, pr); } catch (e) { return { ok: false, code: c.codes.bad, file, why: e.message }; }
    if (p.bad && (Array.isArray(p.bad) ? p.bad.length : p.bad)) log.warn(c.where, c.word_bad_items, { file, bad: Array.isArray(p.bad) ? p.bad.length : p.bad, first: Array.isArray(p.bad) ? p.bad.slice(0, c.log_bad_max) : [] });
    return { ok: true, v: p };
  }

  async function readBase(now) {
    const fails = [];
    const h = await getFile(c.highway_file, parse.limitHighway);
    if (h.ok && !h.v.good.length) fails.push({ code: c.codes.bad, file: c.highway_file, why: pr.why.empty });
    else if (h.ok) held.highway = { [lr.sections_key]: h.v.good, at: h.v.at, got_ms: now, from: c.from_words.live, blank: h.v.blank };
    else if (!h.none) fails.push(h);
    const ix = await getFile(c.index_file, parse.limitIndex);
    if (ix.ok) held.index = { cells: ix.v.cells, at: ix.v.at, got_ms: now, from: c.from_words.live };
    else if (!ix.none) fails.push(ix);
    return fails;
  }

  // 바라는 칸 가운데 받아야 할 것: 목차에 있고, 아직 없거나 사본에서 온 것이거나 다시 받을 때가 된 것
  function cellsToGet(now) {
    const listed = held.index ? new Set(held.index.cells) : null;
    return want.filter((k) => {
      if (listed && !listed.has(k)) return false; // 목차에 없음 = 자료 없는 칸(받지 않음)
      const h = held.cells[k];
      return !h || h.from !== c.from_words.live || now - h.got_ms >= c.refresh_ms;
    });
  }

  async function readCells(keys, now) {
    const fails = [];
    for (const k of keys) {
      const file = c.cell_file.split(c.cell_mark).join(k);
      const g = await getFile(file, parse.limitCell);
      if (g.ok) held.cells[k] = { [lr.segs_key]: g.v.good, at: g.v.at, got_ms: now, from: c.from_words.live, blank: g.v.blank };
      else if (!g.none) fails.push({ ...g, cell: k });
    }
    return fails;
  }

  async function saveCopy() {
    const res = await deps.store.write(c.copy_name, { highway: held.highway, index: held.index, cells: held.cells });
    if (!res.ok) log.warn(c.where, c.word_copy_fail, { why: res.why }); // 저장 실패의 상태 자리 한 줄은 Store.watch → HealthRunner
  }

  async function loadCopy() {
    const res = await deps.store.read(c.copy_name);
    if (!res.ok || !res.value) return;
    const now = clock.now();
    const fresh = (x) => x && typeof x.got_ms === 'number' && now - x.got_ms <= c.copy_keep_days * c.ms_per_day;
    const v = res.value;
    let n = 0;
    if (!held.highway && fresh(v.highway)) { held.highway = { ...v.highway, from: c.from_words.copy }; n += 1; }
    if (!held.index && fresh(v.index)) { held.index = { ...v.index, from: c.from_words.copy }; n += 1; }
    for (const [k, cell] of Object.entries(v.cells || {})) {
      if (!held.cells[k] && fresh(cell)) { held.cells[k] = { ...cell, from: c.from_words.copy }; n += 1; }
    }
    log.info(c.where, c.word_copy_loaded, { files: n, cells: Object.keys(held.cells).length });
  }

  // ask = 무엇이 불렀나(시작·간격·칸 바뀜) — 기록장에 남는다
  async function run(ask) {
    if (stopped || !good) return;
    if (busy) { again = true; return; }
    busy = true;
    asks += 1;
    const t0 = clock.now();
    let failed = false;
    try {
      const fails = [];
      // 표·목차는 없거나 사본에서 왔거나 다시 받을 때가 됐거나 지난번에 못 받았으면 받는다
      const baseDue = baseFailed || !held.highway || held.highway.from !== c.from_words.live || !held.index || held.index.from !== c.from_words.live
        || t0 - held.highway.got_ms >= c.refresh_ms;
      if (baseDue) {
        const bf = await readBase(t0);
        baseFailed = bf.length > 0;
        fails.push(...bf);
      }
      const keys = cellsToGet(t0);
      fails.push(...await readCells(keys, t0));
      if (stopped) return;
      trim();
      const listed = held.index ? new Set(held.index.cells) : null;
      missing = want.filter((k) => !held.cells[k] && (!listed || listed.has(k)));
      failed = fails.length > 0;
      if (failed) {
        const f = fails[0];
        log.warn(c.where, c.word_fail, { ask, fails: fails.length, file: f.file, code: f.code, src: f.src, why: f.why, kept_highway: !!held.highway, kept_cells: Object.keys(held.cells).length, missing });
        conn(false, f.code, f.src);
      } else {
        log.info(c.where, c.word_got, { ask, base: baseDue, cells: keys, ms: clock.now() - t0, sections: held.highway ? held.highway[lr.sections_key].length : 0, held_cells: Object.keys(held.cells).length, missing });
        conn(true, null, null);
      }
      publish();
      if (baseDue || keys.length) await saveCopy();
    } catch (e) {
      failed = true;
      log.error(e, { where: c.where, params: { ask } });
      conn(false, c.codes.internal, null);
    } finally {
      busy = false;
      if (again) { again = false; run(c.ask.again); } else schedule(failed ? c.retry_ms : c.refresh_ms);
    }
  }

  deps.state.subscribe(c.app_piece, (v) => {
    if (!v) return;
    if (v.stage === r.stages.broken) { stopped = true; stopTimer(); return; }
    if (v.stage === r.stages.good && !good) {
      good = true;
      loadCopy().catch((e) => log.error(e, { where: c.where, params: { act: c.ask.start } })).then(() => { publish(); run(c.ask.start); });
    }
  });

  // 위치 → 지금 칸과 이웃 칸. 바뀌었을 때만 받으러 간다
  deps.state.subscribe(c.fix_piece, (f) => {
    try {
      if (!f || typeof f.lat !== 'number' || typeof f.lng !== 'number') return;
      const next = lm.cellsAround(f.lat, f.lng, lr, c.fetch_ring);
      const key = next.slice().sort().join();
      if (key === wantKey) return;
      wantKey = key;
      want = next;
      log.info(c.where, c.word_cells, { here: next[0], want: next.length });
      if (good) run(c.ask.cells);
    } catch (e) {
      log.error(e, { where: c.where, params: { act: c.ask.cells } });
    }
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
