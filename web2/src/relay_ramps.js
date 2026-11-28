// RelayClient 의 조각 — 나들목 인근 충전소 자료 받기(바깥 연결, 보통 객체 — 추가4 충전소 꾸러미). '내 차'의 나들목 인근 충전소 포함 칸(on_key)이 켜졌을 때만
// 다리의 자료 길로 고속도로 선마다 나들목 파일(ramps/<선 이름>.json)을 받아(relay_base) 검사하고(ramps.check) ramps 로 낸다. 꺼져 있으면 묻지 않는다.
// 받는 중이면 낸 것이 없고(목록 셈이 '받는 중'), 파일이 없으면(none) state none, 끊김·꼴 틀림이면 들고 있는 것을 그대로 두거나 없으면 state down — 짐작해 채우지 않는다.
// 켜기에 꼭 필요한 자료가 아니라 앱이 '좋음'이 된 뒤에 받기 시작한다. 틀린 줄은 버리고 몇째 줄·까닭을 기록장에(처음 몇 개 — log_bad_max). 값은 config_relay_ramps.
export const LAYER = 'client';
export const NEEDS = ['cfg', 'log', 'state', 'clock', 'relay_base', 'ramps'];

export function createRelayRamps(deps) {
  const log = deps.log;
  const clock = deps.clock;
  const c = deps.cfg.section('config_relay_ramps');
  const h = deps.cfg.section('config_health');
  const pub = deps.state.claim(c.owner, [c.piece]);
  const lineRe = new RegExp(c.lines_from.re);
  const names = [];
  for (const f of deps.cfg.section(c.lines_from.cfg)[c.lines_from.key] || []) {
    const m = lineRe.exec(f);
    if (m && !names.includes(m[1])) names.push(m[1]);
  }
  let good = false;
  let on = false;
  let stopped = false;
  let busy = false;
  let timer = null;
  let held = {};
  let lastKey = null;

  function out(state) {
    const key = state + ':' + JSON.stringify(held);
    if (key === lastKey) return;
    lastKey = key;
    pub(c.piece, { [c.state_key]: state, [c.lines_key]: held, [c.at_key]: clock.now() });
  }

  function stop() {
    if (timer !== null) { clock.clearTimeout(timer); timer = null; }
  }

  function schedule() {
    if (stopped || !on || timer !== null) return;
    timer = clock.setTimeout(refresh, c.refresh_ms);
  }

  async function refresh() {
    timer = null;
    if (busy || stopped || !on || !good) return;
    busy = true;
    try {
      const next = {};
      let noneN = 0;
      let failed = null;
      for (const line of names) {
        const file = c.file.prefix + line + c.file.suffix;
        const got = await deps.relay_base.get(file);
        if (stopped || !on) return;
        if (!got.ok) {
          if (c.none_codes.includes(got.code)) { noneN += 1; continue; }
          log.warn(c.where, c.word_fail, { file, code: got.code, src: got.src, kept: (held[line] || []).length });
          if (!failed) failed = got.code;
          if (held[line]) next[line] = held[line];
          continue;
        }
        let p;
        try {
          p = deps.ramps.check(got.data, line, c);
        } catch (e) {
          log.warn(c.where, c.word_bad_file, { file, why: e && e.message, kept: (held[line] || []).length });
          if (!failed) failed = e && e.message;
          if (held[line]) next[line] = held[line];
          continue;
        }
        if (p.bad.length) log.warn(c.where, c.word_bad_items, { file, bad: p.bad.length, kept: p.good.length, first: p.bad.slice(0, c.log_bad_max) });
        next[line] = p.good;
      }
      held = next;
      const have = Object.keys(held).length;
      log.info(c.where, c.word_loaded, { lines: have, none: noneN, failed: failed !== null });
      if (have) out(c.states.ok);
      else out(failed !== null ? c.states.down : c.states.none);
    } catch (e) {
      log.error(e, { where: c.where, params: { act: c.act_refresh } });
    } finally {
      busy = false;
      schedule();
    }
  }

  function want() {
    if (stopped) return;
    if (on && good) { if (timer === null && !busy) refresh(); } else stop();
  }

  deps.state.subscribe(c.my_piece, (v) => {
    on = !!v && v[c.on_key] === true;
    want();
  });
  deps.state.subscribe(c.app_piece, (v) => {
    if (!v) return;
    if (v.stage === h.stages.broken) { stopped = true; stop(); return; }
    if (v.stage === h.stages.good) { good = true; want(); }
  });

  return {
    held: () => ({ ...held }),
    halt() { stopped = true; stop(); },
  };
}
