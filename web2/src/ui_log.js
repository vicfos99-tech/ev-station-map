// LogScreen(기록 칸 — 화면). 맨 위에 판(빌드 기록), 로그 보기·복사·한 파일로 내려받기(설계 5-1-나 ui_log).
// Logger 의 읽기 함수만 쓴다. 운전 화면과 같이 health.app 이 '좋음'일 때만 단추가 보인다.
// '이상해' 기록 목록·'기록 올리기' 단추는 A2·차례 6.
export const NEEDS = ['cfg', 'log', 'state', 'doc', 'win'];

export function createLogScreen(deps) {
  const cfg = deps.cfg;
  const c = cfg.section('config_ui_log');
  const b = cfg.section('config_build');
  const r = cfg.section('config_health');
  const log = deps.log;
  const doc = deps.doc;
  const win = deps.win;
  const x = c.texts;
  const $ = (id) => {
    const el = doc.getElementById(id);
    if (!el) throw new Error(id);
    return el;
  };

  function show() {
    const lines = log.lines();
    $(c.list_id).textContent = lines.slice(Math.max(0, lines.length - c.show_lines)).join('\n');
  }

  async function copy() {
    try {
      await win.navigator.clipboard.writeText(await log.readAll());
      $(c.note_id).textContent = x.copied;
    } catch (e) {
      log.error(e, { where: c.where, params: { act: c.act_copy } });
      $(c.note_id).textContent = x.copy_fail;
    }
  }

  async function save() {
    try {
      const blob = new win.Blob([await log.readAll()], { type: c.mime });
      const a = doc.createElement(c.link_tag);
      a.href = win.URL.createObjectURL(blob);
      a.download = log.downloadName();
      a.click();
      win.URL.revokeObjectURL(a.href);
    } catch (e) {
      log.error(e, { where: c.where, params: { act: c.act_save } });
    }
  }

  try {
    $(c.open_id).textContent = x.open;
    $(c.copy_id).textContent = x.copy;
    $(c.save_id).textContent = x.save;
    $(c.close_id).textContent = x.close;
    $(c.version_id).textContent = x.version.split(c.stamp_mark).join(b.stamp);
    $(c.open_id).addEventListener(c.click_event, () => { $(c.panel_id).hidden = false; show(); });
    $(c.close_id).addEventListener(c.click_event, () => { $(c.panel_id).hidden = true; });
    $(c.copy_id).addEventListener(c.click_event, copy);
    $(c.save_id).addEventListener(c.click_event, save);
  } catch (e) {
    log.error(e, { where: c.where, params: { act: c.act_init } });
  }

  deps.state.subscribe(c.app_piece, (v) => {
    if (!v || v.stage !== r.stages.good) return;
    try { $(c.open_id).hidden = false; } catch (e) { log.error(e, { where: c.where, params: { act: c.act_init } }); }
  });
  return { show };
}
