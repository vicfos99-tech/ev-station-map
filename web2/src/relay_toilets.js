// RelayClient 의 조각 — 화장실 목록 받기(바깥 연결, 보통 객체 — 추가3 화장실 꾸러미). 다리의 자료 길로 중계 화장실 색인(toilets/index.json)을 먼저 받고 보이는 시군구(충전소와 같은 목록)의 시군구 파일(toilets/<5자리>.json)만 받아(relay_base),
// 묘성이 직접 채운 자료(config_toilet_mine — 앱 설정)·휴게소 화장실(충전소 목록 stations 의 휴게소)과 합쳐(toiletmerge — 묘성 것이 이김) toilets 로 낸다.
// '앞의 화장실' 셈이 선을 같이 쓰게 toilets 에 stations 의 선(lines)을 그대로 싣는다. 켜기에 꼭 필요한 자료가 아니다 — 앱이 '좋음'이 된 뒤에 받기 시작하고,
// 못 받아도(없음·끊김·꼴이 틀림) 들고 있는 공공 줄(처음엔 빈 목록)로 묘성·휴게소 화장실은 그대로 낸다. 받기 결과는 conn.relay.toilet(상태 자리 한 줄은 HealthRunner·StatusBar).
// 틀린 줄은 버리고 몇째 줄·까닭을 기록장에(처음 몇 개 — log_bad_max). 값은 config_relay_toilets, 합치기 규칙은 config_toilet_merge.
export const LAYER = 'client';
export const NEEDS = ['cfg', 'log', 'state', 'clock', 'relay_base', 'toiletmerge', 'geomath'];

export function createRelayToilets(deps) {
  const log = deps.log;
  const clock = deps.clock;
  const tm = deps.toiletmerge;
  const c = deps.cfg.section('config_relay_toilets');
  const r = deps.cfg.section('config_toilet_merge');
  const g = deps.cfg.section(c.geo_rule);
  const h = deps.cfg.section(c.health_rule);
  const pub = deps.state.claim(c.owner, [c.piece, c.conn_piece]);
  let mine = [];
  let held = [];
  const bySg = {};
  // 보이는 지역 = 충전소가 받는 시군구 목록과 같은 기준(설정에서 5자리를 뽑음)
  const sgRe = new RegExp(c.regions_from.re);
  const visible = [];
  for (const f of deps.cfg.section(c.regions_from.cfg)[c.regions_from.key] || []) {
    const m = sgRe.exec(f);
    if (m && !visible.includes(m[1])) visible.push(m[1]);
  }
  const regionFile = (sg) => c.region_file.prefix + sg + c.region_file.suffix;
  function indexRegions(d) {
    const S = c.index_shape;
    if (!d || typeof d !== 'object' || Array.isArray(d) || d[S.v_key] !== S.v) return null;
    const rg = d[S.regions_key];
    return rg && typeof rg === 'object' && !Array.isArray(rg) ? rg : null;
  }
  let stations = null;
  let begun = false;
  let stopped = false;
  let busy = false;
  let timer = null;
  let lastConn = null;
  let sent = 0;

  // 묘성 자료: 설정이 깨졌으면(꼴) 묘성 자료만 끔 — 공공·휴게소는 그대로
  if (deps.cfg.has(c.mine_cfg)) {
    try {
      const got = tm.checkRows(deps.cfg.section(c.mine_cfg)[c.mine_rows_key], r, r.src_words.mine);
      mine = got.good;
      if (got.bad.length) log.warn(c.where, c.word_bad_mine, { bad: got.bad.length, kept: got.good.length, first: got.bad.slice(0, c.log_bad_max) });
      log.info(c.where, c.word_mine, { rows: mine.length });
    } catch (e) {
      log.error(e, { where: c.where, params: { act: c.act_mine } });
    }
  } else log.warn(c.where, c.word_mine_off, { cfg: c.mine_cfg });

  function conn(ok, code, src) {
    const key = ok + ':' + code + ':' + src;
    if (key === lastConn) return;
    lastConn = key;
    pub(c.conn_piece, { ok, code: ok ? null : code, src: ok ? null : src });
  }

  function send() {
    if (!stations) return;
    try {
      const m = tm.merge(held, mine, tm.restOf(stations, r), r, deps.geomath, g);
      sent += 1;
      pub(c.piece, { [c.list_key]: m.list, [c.lines_key]: Array.isArray(stations[c.lines_key]) ? stations[c.lines_key] : [], [c.at_key]: clock.now(), [c.counts_key]: m.counts });
      if (sent === 1) log.info(c.where, c.word_sent, m.counts);
    } catch (e) {
      log.error(e, { where: c.where, params: { act: c.act_send } });
    }
  }

  function schedule() {
    if (stopped || timer !== null) return;
    timer = clock.setTimeout(refresh, c.refresh_ms);
  }

  async function refresh() {
    timer = null;
    if (busy || stopped) return;
    busy = true;
    try {
      const got = await deps.relay_base.get(c.index_file);
      if (stopped) return;
      if (!got.ok) {
        log.warn(c.where, c.word_fail, { code: got.code, src: got.src, kept: held.length });
        conn(false, got.code, got.src);
        return;
      }
      const regions = indexRegions(got.data);
      if (!regions) {
        log.warn(c.where, c.word_bad_file, { file: c.index_file, kept: held.length });
        conn(false, c.codes.bad, c.src_data);
        return;
      }
      // 보이는 지역 중 색인에 있는 것만 묻는다 — 색인에 없는 지역은 묻지 않음
      const want = visible.filter((sg) => Object.prototype.hasOwnProperty.call(regions, sg));
      const answers = await Promise.all(want.map((sg) => deps.relay_base.get(regionFile(sg)).then((g) => ({ sg, g }))));
      if (stopped) return;
      let failed = null;
      for (const sg of Object.keys(bySg)) if (!want.includes(sg)) delete bySg[sg];
      for (const { sg, g } of answers) {
        const file = regionFile(sg);
        if (!g.ok) {
          log.warn(c.where, c.word_fail_region, { file, code: g.code, src: g.src, kept: (bySg[sg] || []).length });
          if (!failed) failed = { code: g.code, src: g.src };
          continue;
        }
        let p;
        try {
          p = tm.checkPublic(g.data, r);
          if (!g.data || g.data[c.region_shape.sg_key] !== sg) throw new TypeError(c.region_shape.sg_key);
        } catch (e) {
          log.warn(c.where, c.word_bad_region, { file, why: e && e.message, kept: (bySg[sg] || []).length });
          if (!failed) failed = { code: c.codes.bad, src: c.src_data };
          continue;
        }
        if (p.bad.length) log.warn(c.where, c.word_bad_items, { file, bad: p.bad.length, kept: p.good.length, first: p.bad.slice(0, c.log_bad_max) });
        bySg[sg] = p.good;
      }
      const seen = new Set();
      held = [];
      for (const sg of want) for (const x of bySg[sg] || []) if (!seen.has(x.id)) { seen.add(x.id); held.push(x); }
      if (failed) conn(false, failed.code, failed.src);
      else conn(true, null, null);
      log.info(c.where, c.word_loaded, { regions: want.length, rows: held.length });
      send();
    } catch (e) {
      log.error(e, { where: c.where, params: { act: c.act_refresh, held: held.length } });
    } finally {
      busy = false;
      schedule();
    }
  }

  deps.state.subscribe(c.stations_piece, (v) => {
    stations = v || null;
    send();
  });
  deps.state.subscribe(c.app_piece, (v) => {
    if (!v) return;
    if (v.stage === h.stages.broken) {
      stopped = true;
      if (timer !== null) { clock.clearTimeout(timer); timer = null; }
      return;
    }
    if (v.stage === h.stages.good && !begun) {
      begun = true;
      refresh();
    }
  });

  return {
    held: () => held.slice(),
    mine: () => mine.slice(),
    halt() {
      stopped = true;
      if (timer !== null) { clock.clearTimeout(timer); timer = null; }
    },
  };
}
