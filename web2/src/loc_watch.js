// LocationClient(바깥 연결 — 위치 받기 하나, 보통 객체). 출처는 설정(config_loc_watch.source) 하나로 고른다:
//   기기 GPS(브라우저 위치 받기) ↔ '시험 흐름'(테스트 베드 다리의 1초 흐름 — NetCore 의 stream 으로, 주소는 NetCore 만 안다).
// 받은 위치는 fix 로, 받기 성공·실패는 conn.loc(까닭 코드)로 낸다(바뀔 때만). health.app 이 '점검 중'이면 걸지 않고,
// 화면이 숨으면(view.visible) 멈추고 보이면 다시. 끊기면 설정 간격으로 다시 건다.
// (A2) 받은 값은 FixCheck(순수 — 범위 밖·음수 속도·튐 …)로 검사해 통과한 것만 fix 로 낸다. 거른 것은 까닭과 함께 기록장에 한 줄
// (위치 출처 자체는 살아 있으므로 conn.loc 는 바꾸지 않는다). 숫자 꼴이 아닌 것은 전처럼 conn.loc '위치 값이 이상함'.
export const NEEDS = ['cfg', 'log', 'state', 'netcore', 'geo', 'clock', 'fixcheck', 'geomath'];

export function createLocWatch(deps) {
  const cfg = deps.cfg;
  const log = deps.log;
  const state = deps.state;
  const clock = deps.clock;
  const c = cfg.section('config_loc_watch');
  const r = cfg.section('config_health');
  const fr = cfg.section('config_fixcheck');
  const gr = cfg.section('config_geo');
  const pub = state.claim(c.owner, [c.fix_piece, c.conn_piece]);
  let allowed = false;
  let visible = true;
  let stop = null;
  let retry = null;
  let lastConn = null;
  let lastFix = null;
  let rejects = 0;
  let rejected = 0;

  function conn(ok, code) {
    const key = ok + ':' + code;
    if (key === lastConn) return;
    lastConn = key;
    pub(c.conn_piece, { ok, code: ok ? null : code });
  }

  function isNum(v) { return typeof v === 'number' && Number.isFinite(v); }

  function emit(p, seq) {
    if (!p || !isNum(p.lat) || !isNum(p.lng)) { conn(false, c.codes.bad); return; }
    const fix = {
      t: isNum(p.t) ? p.t : clock.now(),
      lat: p.lat,
      lng: p.lng,
      speed_kmh: isNum(p.speed_kmh) ? p.speed_kmh : null,
      heading_deg: isNum(p.heading_deg) ? p.heading_deg : null,
      accuracy_m: isNum(p.accuracy_m) ? p.accuracy_m : null,
      seq: isNum(seq) ? seq : null,
    };
    let res;
    try {
      res = deps.fixcheck.check(fix, { last: lastFix, rejects }, fr, { geo: deps.geomath, g: gr });
    } catch (e) {
      log.error(e, { where: c.where, params: { seq: fix.seq, lat: fix.lat, lng: fix.lng } });
      res = { ok: false, why: c.codes.internal };
    }
    conn(true, null);
    if (!res.ok) {
      rejects += 1;
      rejected += 1;
      log.warn(c.where, c.word_fix_bad, { why: res.why, detail: res.detail, seq: fix.seq, lat: fix.lat, lng: fix.lng, speed_kmh: fix.speed_kmh, in_row: rejects });
      return;
    }
    if (rejects >= fr.reset_after) log.info(c.where, c.word_fix_reset, { after: rejects, seq: fix.seq });
    rejects = 0;
    lastFix = fix;
    pub(c.fix_piece, fix);
  }

  function scheduleRetry() {
    if (retry !== null || !allowed || !visible) return;
    retry = clock.setTimeout(() => { retry = null; start(); }, c.retry_ms);
  }

  function startStream() {
    stop = deps.netcore.stream(c.client, c.route, {
      open: () => log.info(c.where, c.word_open, { source: c.source }),
      event: (name, text) => {
        if (name !== c.tick_event) return;
        let d;
        try { d = JSON.parse(text); } catch (e) {
          log.warn(c.where, c.word_parse, { size: text.length });
          conn(false, c.codes.parse);
          return;
        }
        const p = d && d[c.pos_field];
        if (p === null || p === undefined) { conn(false, c.codes.none); return; }
        emit(p, d[c.tick_field]);
      },
      down: (code) => {
        stop = null;
        conn(false, code);
        scheduleRetry();
      },
    });
  }

  function startDevice() {
    const geo = deps.geo;
    if (!geo || typeof geo.watchPosition !== 'function') { conn(false, c.codes.no_geo); return; }
    const id = geo.watchPosition(
      (pos) => {
        const k = pos.coords;
        emit({
          t: pos.timestamp, lat: k.latitude, lng: k.longitude,
          speed_kmh: isNum(k.speed) ? k.speed * c.mps_to_kmh : null,
          heading_deg: k.heading, accuracy_m: k.accuracy,
        }, null);
      },
      (err) => {
        log.warn(c.where, c.word_geo_fail, { code: err && err.code, message: err && err.message });
        conn(false, err && err.code === c.denied_error_code ? c.codes.denied : c.codes.geo);
      },
      c.geo_options,
    );
    stop = () => geo.clearWatch(id);
  }

  function start() {
    if (stop || !allowed || !visible) return;
    try {
      if (c.source === c.source_names.test_stream) startStream();
      else if (c.source === c.source_names.device) startDevice();
      else throw new Error(c.source);
    } catch (e) {
      log.error(e, { where: c.where, params: { source: c.source } });
      stop = null;
      conn(false, c.codes.internal);
      scheduleRetry();
    }
  }

  function halt() {
    if (retry !== null) { clock.clearTimeout(retry); retry = null; }
    if (stop) { const s = stop; stop = null; s(); }
  }

  state.subscribe(c.app_piece, (v) => {
    allowed = !!v && v.stage !== r.stages.broken;
    if (allowed) start(); else halt();
  });
  state.subscribe(c.visible_piece, (v) => {
    visible = v !== false;
    if (visible) start(); else halt();
  });
  return { halt, rejected: () => rejected };
}
