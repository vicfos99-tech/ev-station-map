// RouteClient(바깥 연결 — 보통 객체, 설계 5-1-나 net_route · 5-5 · 5-7 · 5-9 · E3·E9·E10). 다리의 **집 PC 길**에 묻는다:
//   · place.request {seq, q} → 장소·주소 찾기 → place {seq, stage: 묻는 중·늦음·끝·실패, places | code}
//   · route.request {seq, from, to, name} → 길 → route.progress {seq, stage, code} + 검사 통과한 답은 route.answer {seq, dest, …}(노선 꼴은 CalcRunner·StateCalc 의 일)
//     겹친 물음은 새것만 남긴다(요청 번호 — 앞 물음의 늦은 답은 버림). 늦음: slow_ms 안에 답이 없으면 stage '늦음'(시간 한도·다시 묻기는 NetCore 설정).
//   · odd.upload.request → 폰에 쌓인 '이상해' 기록 가운데 아직 안 올린 것을 **차례로 하나씩, 한 번만** 올리기 길로(E9) → 기록마다 odd.result.
//     올린 이름은 데이터 폴더의 '올린 목록'(Store 키 — 쓰는 모듈은 이것 하나). 저절로 다시 올리지 않는다. 도는 중에 또 누르면 둘째는 버리고 stage '올리는 중'.
//     연결이 끊긴 실패(stop_codes)면 남은 것은 보내지 않고 '앞에서 멈춤'으로 알린다(끊긴 길에 하나씩 시간 한도를 다 쓰지 않게).
//   · 집 PC 가 살아 있나: '좋음'이 된 뒤 정한 간격마다 다리의 상태 길(/v1/health 의 src.home)을 물어 conn.route 로(끊겼을 땐 짧은 간격).
//     집 PC 길이 끊긴 실패(down_codes)도 conn.route 로, 카카오 쪽 실패(오늘 한도·카카오 실패 — 쌓인 주소는 계속 찾아짐)는 conn.route.kakao 로 따로.
// **주소·잠금 값을 모른다** — 길 이름과 보낼 것만 NetCore 에 넘긴다. 답은 들어오는 자리에서 naviroute.checkPlaces·checkRoute 로 검사(틀리면 버리고 '답이 이상함' + 로그에 앞부분만).
// health.app 이 '좋음'일 때만 움직인다('점검 중'이면 멈춤). 값·글·길 이름은 config_net_route.
export const NEEDS = ['cfg', 'log', 'store', 'state', 'clock', 'netcore', 'naviroute'];

export function createRouteClient(deps) {
  const cfg = deps.cfg;
  const log = deps.log;
  const clock = deps.clock;
  const net = deps.netcore;
  const nr = deps.naviroute;
  const c = cfg.section('config_net_route');
  const rr = cfg.section('config_naviroute');
  const r = cfg.section('config_health');
  const P = c.pieces;
  const S = c.stages;
  const O = c.odd;
  const pub = deps.state.claim(c.owner, [P.place, P.progress, P.answer, P.odd_result, P.conn, P.conn_kakao]);
  let good = false;
  let stopped = false;
  let placeSeq = null;
  let routeSeq = null;
  let uploading = false;
  let healthTimer = null;
  let homeOk = null;
  const lastConn = {};
  const counts = { place: 0, route: 0, odd: 0, health: 0 };

  function conn(piece, ok, code, src) {
    const key = ok + ':' + code;
    if (lastConn[piece] === key) return;
    lastConn[piece] = key;
    pub(piece, { ok, code: ok ? null : code, src: ok ? null : src });
  }

  // 묻기 결과 → 연결 알림. 집 PC 길 끊김 · 카카오 쪽 실패 · 그 밖(물음·답 단위 — 길은 닿음)
  function noteConn(got) {
    if (got.ok) {
      conn(P.conn, true);
      conn(P.conn_kakao, true);
      homeOk = true;
      return;
    }
    if (c.kakao_codes.includes(got.code)) {
      conn(P.conn, true);
      conn(P.conn_kakao, false, got.code, c.src_kakao);
      return;
    }
    if (c.down_codes.includes(got.code)) {
      conn(P.conn, false, got.code, got.src || c.src_home);
      homeOk = false;
      scheduleHealth();
      return;
    }
    conn(P.conn, true);
  }

  function head(data) {
    try { return JSON.stringify(data).slice(0, c.log_head_chars); } catch (e) { return String(data).slice(0, c.log_head_chars); }
  }

  // 길 하나에 POST — 늦으면(slow_ms) onSlow 를 한 번 부른다
  async function ask(route, body, onSlow) {
    let answered = false;
    const t = clock.setTimeout(() => { if (!answered) onSlow(); }, c.slow_ms);
    try {
      return await net.ask(c.client, route, { method: c.post_method, body });
    } finally {
      answered = true;
      clock.clearTimeout(t);
    }
  }

  function badText(q) {
    return typeof q !== 'string' || !q.trim().length || [...q].length > c.q_max_chars;
  }

  async function findPlaces(v) {
    const seq = v && v.seq;
    if (!good || stopped) { pub(P.place, { seq, stage: S.fail, code: c.codes.not_ready }); return; }
    if (typeof seq !== 'number' || badText(v.q)) {
      log.warn(c.where, c.words.bad_input, { act: c.act_place, seq });
      pub(P.place, { seq, stage: S.fail, code: c.codes.bad_input });
      return;
    }
    placeSeq = seq;
    counts.place += 1;
    const t0 = clock.now();
    pub(P.place, { seq, stage: S.asking });
    try {
      const got = await ask(c.routes.place, { [c.q_key]: v.q }, () => { if (placeSeq === seq) pub(P.place, { seq, stage: S.slow }); });
      if (stopped) return;
      noteConn(got);
      if (placeSeq !== seq) { log.info(c.where, c.words.dropped, { act: c.act_place, seq, latest: placeSeq }); return; }
      if (!got.ok) {
        log.warn(c.where, c.words.fail, { act: c.act_place, seq, code: got.code, src: got.src, ms: clock.now() - t0 });
        pub(P.place, { seq, stage: S.fail, code: got.code, src: got.src || null });
        return;
      }
      let res;
      try { res = nr.checkPlaces(got.data, rr); } catch (e) {
        log.warn(c.where, c.words.bad_answer, { act: c.act_place, seq, why: e.message, head: head(got.data) });
        pub(P.place, { seq, stage: S.fail, code: c.codes.bad_answer });
        return;
      }
      log.info(c.where, c.words.got, { act: c.act_place, seq, n: res.places.length, source: res.source, ms: clock.now() - t0 });
      pub(P.place, { seq, stage: S.done, source: res.source, places: res.places });
    } catch (e) {
      log.error(e, { where: c.where, params: { act: c.act_place, seq } });
      if (placeSeq === seq) pub(P.place, { seq, stage: S.fail, code: c.codes.internal });
    }
  }

  function okPoint(p) {
    return Array.isArray(p) && p.length === rr.latlng_len && p.every((x) => typeof x === 'number' && Number.isFinite(x))
      && p[0] >= rr.lat_min && p[0] <= rr.lat_max && p[1] >= rr.lng_min && p[1] <= rr.lng_max;
  }

  async function findRoute(v) {
    const seq = v && v.seq;
    if (!good || stopped) { pub(P.progress, { seq, stage: S.fail, code: c.codes.not_ready }); return; }
    if (typeof seq !== 'number' || !okPoint(v.from) || !okPoint(v.to)) {
      log.warn(c.where, c.words.bad_input, { act: c.act_route, seq });
      pub(P.progress, { seq, stage: S.fail, code: c.codes.bad_input });
      return;
    }
    routeSeq = seq;
    counts.route += 1;
    const t0 = clock.now();
    pub(P.progress, { seq, stage: S.asking });
    try {
      const got = await ask(c.routes.route, { [c.from_key]: v.from, [c.to_key]: v.to }, () => { if (routeSeq === seq) pub(P.progress, { seq, stage: S.slow }); });
      if (stopped) return;
      noteConn(got);
      if (routeSeq !== seq) { log.info(c.where, c.words.dropped, { act: c.act_route, seq, latest: routeSeq }); return; }
      if (!got.ok) {
        log.warn(c.where, c.words.fail, { act: c.act_route, seq, code: got.code, src: got.src, ms: clock.now() - t0 });
        pub(P.progress, { seq, stage: S.fail, code: got.code, src: got.src || null });
        return;
      }
      let res;
      try { res = nr.checkRoute(got.data, rr); } catch (e) {
        log.warn(c.where, c.words.bad_answer, { act: c.act_route, seq, why: e.message, head: head(got.data) });
        pub(P.progress, { seq, stage: S.fail, code: c.codes.bad_answer });
        return;
      }
      log.info(c.where, c.words.got, { act: c.act_route, seq, pieces: res.pieces.length, dist_km: res.dist_km, source: res.source, ms: clock.now() - t0 });
      pub(P.answer, { seq, dest: { name: typeof v.name === 'string' ? v.name : '', lat: v.to[0], lng: v.to[1] }, ...res });
      pub(P.progress, { seq, stage: S.done, source: res.source });
    } catch (e) {
      log.error(e, { where: c.where, params: { act: c.act_route, seq } });
      if (routeSeq === seq) pub(P.progress, { seq, stage: S.fail, code: c.codes.internal });
    }
  }

  // ---------- '기록 올리기' ----------
  function bodyOf(rec) {
    return {
      [O.v_key]: O.v,
      [O.at_key]: rec.at,
      [O.memo_key]: typeof rec.memo === 'string' ? rec.memo : '',
      [O.state_key]: { kind: rec.kind, at_ms: rec.at_ms, build: rec.build, pieces: rec.pieces },
    };
  }

  async function upload(v) {
    const seq = v && v.seq;
    if (uploading) {
      log.info(c.where, c.words.upload_busy, { seq });
      pub(P.odd_result, { seq, stage: S.busy });
      return;
    }
    if (!good || stopped) { pub(P.odd_result, { seq, stage: S.fail, code: c.codes.not_ready }); return; }
    uploading = true;
    const tally = { sent: 0, failed: 0, stopped: 0 };
    try {
      const list = await deps.store.listRecords(O.kind);
      const had = await deps.store.read(O.sent_key);
      if (!list.ok || !had.ok) {
        log.warn(c.where, c.words.upload_fail, { seq, list: list.why || null, sent: had.why || null });
        pub(P.odd_result, { seq, stage: S.fail, code: c.codes.read });
        return;
      }
      const names = list.names;
      const sent = (Array.isArray(had.value) ? had.value : []).filter((n) => names.includes(n));
      const todo = names.filter((n) => !sent.includes(n)).slice(0, O.max_per_press);
      log.info(c.where, c.words.upload_start, { seq, records: names.length, sent: sent.length, todo: todo.length });
      pub(P.odd_result, { seq, stage: S.start, total: todo.length });
      let stopCode = null;
      for (const name of todo) {
        if (stopped) break;
        if (stopCode) {
          tally.stopped += 1;
          pub(P.odd_result, { seq, stage: S.one, name, ok: false, code: c.codes.stopped, after: stopCode });
          continue;
        }
        const rec = await deps.store.readRecord(O.kind, name);
        if (!rec.ok) {
          tally.failed += 1;
          pub(P.odd_result, { seq, stage: S.one, name, ok: false, code: c.codes.read });
          continue;
        }
        const body = bodyOf(rec.value || {});
        const size = JSON.stringify(body).length;
        if (size > O.max_chars) {
          tally.failed += 1;
          log.warn(c.where, c.words.upload_one, { seq, name, ok: false, code: c.codes.too_big, chars: size });
          pub(P.odd_result, { seq, stage: S.one, name, ok: false, code: c.codes.too_big });
          continue;
        }
        counts.odd += 1;
        const got = await net.ask(c.client, c.routes.odd, { method: c.post_method, body });
        noteConn(got);
        if (got.ok) {
          sent.push(name);
          const w = await deps.store.write(O.sent_key, sent);
          if (!w.ok) log.warn(c.where, c.words.sent_write_fail, { seq, name, why: w.why });
          tally.sent += 1;
          const server = got.data && typeof got.data[O.name_key] === 'string' ? got.data[O.name_key].slice(0, c.log_head_chars) : null;
          log.info(c.where, c.words.upload_one, { seq, name, ok: true, server });
          pub(P.odd_result, { seq, stage: S.one, name, ok: true, server });
        } else {
          tally.failed += 1;
          log.warn(c.where, c.words.upload_one, { seq, name, ok: false, code: got.code, src: got.src });
          pub(P.odd_result, { seq, stage: S.one, name, ok: false, code: got.code, src: got.src || null });
          if (O.stop_codes.includes(got.code)) stopCode = got.code;
        }
      }
      log.info(c.where, c.words.upload_end, { seq, ...tally });
      pub(P.odd_result, { seq, stage: S.done, ...tally });
    } catch (e) {
      log.error(e, { where: c.where, params: { act: c.act_upload, seq } });
      pub(P.odd_result, { seq, stage: S.fail, code: c.codes.internal, ...tally });
    } finally {
      uploading = false;
    }
  }

  // ---------- 집 PC 가 살아 있나 ----------
  function scheduleHealth() {
    if (healthTimer !== null) clock.clearTimeout(healthTimer);
    healthTimer = null;
    if (stopped || !good) return;
    healthTimer = clock.setTimeout(checkHome, homeOk === false ? c.health_down_ms : c.health_ms);
  }

  async function checkHome() {
    healthTimer = null;
    if (stopped || !good) return;
    try {
      counts.health += 1;
      const got = await net.ask(c.health_client, c.routes.health);
      if (stopped) return;
      // 다리 상태 길은 출처 하나라도 나쁘면 ok 거짓으로 답한다 — ok 와 상관없이 src[home] 만 본다(자료 길만 끊겨도 집 PC 는 좋음)
      const src = got.data && typeof got.data === 'object' ? got.data[c.src_key] : null;
      if (!src || typeof src !== 'object') {
        noteConn(got.ok ? { ok: false, code: c.codes.bad_answer } : got);
      } else {
        const home = src[c.home_src_key];
        if (home === c.good_word) {
          conn(P.conn, true);
          homeOk = true;
        } else {
          conn(P.conn, false, c.codes.home_off, c.src_home);
          homeOk = false;
        }
      }
    } catch (e) {
      log.error(e, { where: c.where, params: { act: c.act_health } });
    } finally {
      scheduleHealth();
    }
  }

  deps.state.subscribe(c.app_piece, (v) => {
    if (!v) return;
    if (v.stage === r.stages.broken) { stopped = true; scheduleHealth(); return; }
    if (v.stage === r.stages.good && !good) {
      good = true;
      checkHome();
    }
  });
  deps.state.subscribe(P.place_request, (v) => { findPlaces(v); });
  deps.state.subscribe(P.route_request, (v) => { findRoute(v); });
  deps.state.subscribe(P.upload_request, (v) => { upload(v); });

  return {
    counts: () => ({ ...counts }),
    uploading: () => uploading,
    halt() {
      stopped = true;
      if (healthTimer !== null) { clock.clearTimeout(healthTimer); healthTimer = null; }
    },
  };
}
