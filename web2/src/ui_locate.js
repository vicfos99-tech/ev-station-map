// LocateGuide(위치 권한 안내 — 화면, 설계 5-1-나 ui_locate). **기기 GPS 를 쓸 때만**(config_loc_watch.source 가 설정의 기기 이름일 때) 뜬다 —
// 시험 흐름(테스트 베드)으로 위치를 받을 때는 뜨지 않는다. health.src 의 위치 출처가 권한 꺼짐·위치 기능 없음(show_codes)이면
// 지도 칸 위에 작은 안내 한 칸(화면을 덮지 않음)을 띄우고, 위치가 다시 오면 닫는다. '닫기'를 누르면 다음에 다시 끊길 때까지 안 뜬다.
// 판정하지 않는다 — HealthRunner 가 올린 health.src 를 보일 뿐(까닭 한 줄은 상태 자리에도 그대로 있다). 글은 config_ui_locate.
export const NEEDS = ['cfg', 'log', 'state', 'doc'];

export function createLocateGuide(deps) {
  const cfg = deps.cfg;
  const c = cfg.section('config_ui_locate');
  const lw = cfg.section('config_loc_watch');
  const log = deps.log;
  const doc = deps.doc;
  const device = lw.source === c.device_source;
  let closedFor = null;
  const $ = (id) => {
    const el = doc.getElementById(id);
    if (!el) throw new Error(id);
    return el;
  };

  try {
    $(c.ids.close).textContent = c.texts.close;
    $(c.ids.close).addEventListener(c.click_event, () => {
      $(c.ids.root).hidden = true;
      closedFor = $(c.ids.root).getAttribute(c.code_attr);
    });
  } catch (e) {
    log.error(e, { where: c.where, params: { act: c.act_init } });
  }

  deps.state.subscribe(c.src_piece, (v) => {
    if (!device) return;
    try {
      const s = v && v[c.loc_source];
      const code = s && !s.ok && c.show_codes.includes(s.why) ? s.why : null;
      const root = $(c.ids.root);
      if (!code) {
        if (!root.hidden) log.info(c.where, c.word_hidden, {});
        root.hidden = true;
        closedFor = null;
        return;
      }
      if (closedFor === code) return;
      $(c.ids.text).textContent = c.texts.guide[code] || c.texts.guide_default;
      root.setAttribute(c.code_attr, code);
      if (root.hidden) log.info(c.where, c.word_shown, { code });
      root.hidden = false;
    } catch (e) {
      log.error(e, { where: c.where, params: { act: c.act_show } });
    }
  });
  return { device: () => device };
}
