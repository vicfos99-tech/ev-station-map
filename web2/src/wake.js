// WakeKeeper(화면 꺼짐 막기 — 묘성 11/27 ①). 앱이 '좋음'이 되면 브라우저의 화면 깨움 유지(Screen Wake Lock — 창의 navigator.wakeLock.request(c.kind))를 잡는다.
// 페이지가 숨으면 브라우저가 스스로 풀고, 다시 보이면(visibilitychange → visible) 다시 잡는다.
// 지원 안 되는 폰(브라우저)이거나 거절되면(절전 모드 등) conn.wake 를 나쁨으로(까닭 코드) — 상태 자리 한 줄(HealthRunner·StatusBar 의 길). 다시 잡히면 좋음으로(줄이 사라짐).
// 켬·끔 = c.on. 시작·잡음·풀림·실패(거절 이름·문구 그대로)는 로그. 값·이름은 config_wake.
export const NEEDS = ['cfg', 'log', 'state', 'doc', 'win'];

export function createWakeKeeper(deps) {
  const c = deps.cfg.section('config_wake');
  const r = deps.cfg.section('config_health');
  const log = deps.log;
  const doc = deps.doc;
  const win = deps.win;
  const stats = { asked: 0, got: 0, released: 0, failed: 0 };
  let lock = null;
  let busy = false;
  let good = false;
  let lastConn = null;
  const pub = deps.state.claim(c.owner, [c.conn_piece]);

  function conn(ok, code, why) {
    const key = ok + ':' + code;
    if (lastConn === key) return;
    lastConn = key;
    pub(c.conn_piece, { ok, code: ok ? null : code });
    if (!ok) log.warn(c.where, c.words.fail, { code, ...why });
  }

  function api() {
    const nav = win && win.navigator;
    const wl = nav && nav.wakeLock;
    return wl && typeof wl.request === 'function' ? wl : null;
  }

  function onRelease() {
    stats.released += 1;
    lock = null;
    log.info(c.where, c.words.released, { visible: doc.visibilityState, released: stats.released });
  }

  async function request(why) {
    if (!c.on || !good || busy) return;
    if (lock && !lock.released) return;
    if (doc.visibilityState !== c.visible_word) {
      log.info(c.where, c.words.skip_hidden, { why, visible: doc.visibilityState });
      return;
    }
    const wl = api();
    if (!wl) { conn(false, c.codes.unsupported, { why }); return; }
    busy = true;
    stats.asked += 1;
    log.info(c.where, c.words.start, { why, asked: stats.asked });
    try {
      const s = await wl.request(c.kind);
      lock = s;
      stats.got += 1;
      if (s && typeof s.addEventListener === 'function') s.addEventListener(c.release_event, onRelease);
      log.info(c.where, c.words.got, { why, got: stats.got });
      conn(true, null);
    } catch (e) {
      stats.failed += 1;
      // 거절 이름·문구 그대로(NotAllowedError — 절전 모드·권한 정책 등)
      conn(false, c.codes.denied, { why, name: e && e.name, message: e && e.message });
    } finally {
      busy = false;
    }
  }

  if (!c.on) {
    log.info(c.where, c.words.off, {});
  } else {
    try {
      doc.addEventListener(c.vis_event, () => {
        if (doc.visibilityState === c.visible_word) request(c.why_visible).catch((e) => log.error(e, { where: c.where, params: { act: c.act_request } }));
      });
    } catch (e) {
      log.error(e, { where: c.where, params: { act: c.act_init } });
    }
    deps.state.subscribe(c.app_piece, (v) => {
      if (!v || v.stage !== r.stages.good || good) return;
      good = true;
      request(c.why_start).catch((e) => log.error(e, { where: c.where, params: { act: c.act_request } }));
    });
  }

  return { stats: () => ({ ...stats }), held: () => !!(lock && !lock.released), request };
}
