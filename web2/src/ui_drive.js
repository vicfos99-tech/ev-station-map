// DriveScreen(운전 화면의 배치 틀 — 화면). 왼편 · 가운데(지도) · 오른편 세 칸. health.app 이 '좋음'일 때만 띄우고,
// 한 번 띄우면 끊김이 와도 닫지 않는다(F6). 화면 보임·크기 바뀜을 한 번 듣고 view.visible · view.size 로 알린다.
// A1: 왼편·오른편은 빈 칸(알림판 자리 — A2).
export const NEEDS = ['cfg', 'log', 'state', 'doc', 'win'];

export function createDriveScreen(deps) {
  const c = deps.cfg.section('config_ui_drive');
  const r = deps.cfg.section('config_health');
  const doc = deps.doc;
  const win = deps.win;
  const root = doc.getElementById(c.root_id);
  const pub = deps.state.claim(c.owner, [c.visible_piece, c.size_piece]);
  let shown = false;

  function size() {
    pub(c.size_piece, { w: win.innerWidth, h: win.innerHeight });
  }

  doc.addEventListener(c.visibility_event, () => pub(c.visible_piece, doc.visibilityState === c.visible_state));
  win.addEventListener(c.resize_event, size);

  deps.state.subscribe(c.app_piece, (v) => {
    try {
      if (shown || !v || v.stage !== r.stages.good) return;
      if (!root) throw new Error(c.root_id);
      root.hidden = false;
      shown = true;
      deps.log.info(c.where, c.word_shown, {});
      size();
    } catch (e) {
      deps.log.error(e, { where: c.where, params: { stage: v && v.stage } });
    }
  });
  return { shown: () => shown };
}
