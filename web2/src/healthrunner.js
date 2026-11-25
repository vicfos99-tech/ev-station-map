// HealthRunner(보통 객체). 판정을 불러 State 에 올리는 얇은 손(설계 5-1-나 · E1 · F6).
// app.start → Config.problems() 로 health.app 을 가장 먼저 올리고, 그 뒤 conn.* 가 올 때와 정한 간격마다(시작 시간 한도)
// Health 를 불러 health.app · health.src · health.<기능> 을 **바뀔 때만** 올린다. 규칙·숫자는 없다 — 받기·부르기·발행·catch 뿐.
export const NEEDS = ['cfg', 'log', 'store', 'state', 'clock', 'health'];

export function createHealthRunner(deps) {
  const cfg = deps.cfg;
  const log = deps.log;
  const state = deps.state;
  const clock = deps.clock;
  const health = deps.health;
  const r = cfg.section('config_health');
  const c = cfg.section('config_healthrunner');
  const featNames = Object.keys(r.features).map((f) => c.feature_prefix + f);
  const pub = state.claim(c.owner, [c.app_piece, c.src_piece, ...featNames]);
  const start = {};
  const conn = {};
  let startedAt = null;
  let app = null;
  let srcs = {};
  let feats = {};
  let timer = null;

  function evaluate() {
    if (startedAt === null) return;
    try {
      const now = clock.now();
      const nextApp = health.judgeApp({ problems: cfg.problems(), start, startedAt, now, prev: app }, r);
      if (!health.same(nextApp, app)) {
        app = nextApp;
        log.info(c.where, c.word_app, app);
        pub(c.app_piece, app);
      }
      if (app.stage !== r.stages.starting && timer !== null) {
        clock.clearInterval(timer);
        timer = null;
      }
      const nextSrc = health.judgeSources({ conn, prev: srcs, now }, r);
      if (!health.same(nextSrc, srcs)) {
        for (const [s, v] of Object.entries(nextSrc)) {
          const before = srcs[s];
          if (!before || before.ok !== v.ok) log.info(c.where, v.ok ? c.word_src_back : c.word_src_down, { src: s, why: v.why });
        }
        srcs = nextSrc;
        pub(c.src_piece, srcs);
      }
      const nextFeat = health.judgeFeatures({ problems: cfg.problems(), sources: srcs }, r);
      for (const [f, v] of Object.entries(nextFeat)) {
        if (!health.same(v, feats[f])) {
          log.info(c.where, c.word_feature, { feature: f, ok: v.ok });
          pub(c.feature_prefix + f, v);
        }
      }
      feats = nextFeat;
    } catch (e) {
      log.error(e, { where: c.where, params: { startedAt, conn, start } });
    }
  }

  state.subscribe(c.start_event, () => {
    startedAt = clock.now();
    evaluate();
    if (app && app.stage === r.stages.starting) timer = clock.setInterval(evaluate, c.recheck_ms);
  });

  state.subscribe(c.conn_prefix + c.wildcard, (v, name) => {
    if (name === c.start_conn) {
      if (v && v.need) start[v.need] = { ok: !!v.ok, code: v.code, src: v.src };
    } else {
      const src = r.conn_source[name];
      if (src && v) conn[src] = { ok: !!v.ok, code: v.code };
    }
    evaluate();
  });

  // 기록장·저장 쓰기 실패(둘은 State 보다 먼저 만들어져 State 를 모른다 — 설계 5-1-나 알림 표)
  deps.log.watch((s) => { conn[r.trouble_source.log] = { ok: s.ok, code: s.why }; evaluate(); });
  deps.store.watch((s) => { conn[r.trouble_source.store] = { ok: s.ok, code: s.why }; evaluate(); });

  return { now: () => ({ app, srcs, feats }) };
}
