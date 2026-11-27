// StatusBar(상태 자리 — 화면). 앱의 모든 상태를 보이는 한 자리(설계 5-1-나 · F6·F7).
// health.app '시작 중' → 여는 중 / '점검 중' → '앱 점검 중' + 까닭 한 줄 / '좋음' → 설정이 틀려 꺼 둔 기능(health.off)과 health.src 의 끊긴 출처만 한 줄씩.
// 판정하지 않는다 — 표시만. 누름·종료·알림창·화면을 덮는 겹은 없다. 글은 config_ui_status.
// 자리(요소)는 빌드가 뼈대에 처음부터 넣어 두고, 뼈대의 작은 글이 시작 시간 한도 뒤 '시작하지 못함'을 스스로 띄운다.
export const NEEDS = ['cfg', 'log', 'state', 'doc', 'clock', 'timefmt'];

export function createStatusBar(deps) {
  const cfg = deps.cfg;
  const c = cfg.section('config_ui_status');
  const t = cfg.section('config_time');
  const r = cfg.section('config_health');
  const doc = deps.doc;
  const el = doc.getElementById(c.element_id);
  const x = c.texts;
  let app = null;
  let src = {};
  let offs = [];

  function fill(tpl, vals) {
    return tpl.replace(new RegExp(c.slot_re, 'g'), (m, k) => (vals[k] === undefined || vals[k] === null ? '' : String(vals[k])));
  }

  function reasonLine(why) {
    if (!why) return '';
    const need = why.need ? (x.need_names[why.need] || why.need) : '';
    if (why.code === r.reason_need && x.need_fail[why.fail]) return fill(x.need_fail[why.fail], { need });
    const tpl = x.reasons[why.code] || x.reasons[r.reason_default];
    return fill(tpl, { need, file: why.file, key: why.key });
  }

  function lines() {
    if (!app || app.stage === r.stages.starting) return [x.starting];
    if (app.stage === r.stages.broken) return [x.broken, reasonLine(app.why)].filter(Boolean);
    // (정비 가 ⑤) 설정이 틀려 꺼 둔 기능 — 한 줄씩
    const out = offs.map((f) => fill(x.off_line, { feat: x.feature_names[f] || f }));
    for (const [s, v] of Object.entries(src)) {
      if (v.ok) continue;
      // (11/27) 출처마다 줄 꼴이 따로 있으면 그것(화면 켜 두기처럼 '끊김'이 아닌 것 — src_line_by_src)
      out.push(fill(x.src_line_by_src[s] || x.src_line, {
        src: x.src_names[s] || s,
        time: v.since === null ? '' : deps.timefmt.format(v.since, x.time_pattern, t),
        // 같은 까닭 코드라도 출처마다 뜻이 다르면(집 PC 의 잠금 틀림·카카오 실패 — A6) 출처의 글이 먼저
        why: (x.why_by_src[s] && x.why_by_src[s][v.why]) || x.why_words[v.why] || v.why,
      }));
    }
    return out;
  }

  function render() {
    try {
      if (!el) throw new Error(c.element_id);
      const ls = lines();
      el.textContent = ls.join('\n');
      el.setAttribute(c.stage_attr, app ? app.stage : r.stages.starting);
      el.setAttribute(c.empty_attr, ls.length ? c.no_word : c.yes_word);
    } catch (e) {
      deps.log.error(e, { where: c.where, params: { stage: app && app.stage } });
    }
  }

  deps.state.subscribe(c.app_piece, (v) => {
    app = v;
    doc.body.setAttribute(c.seen_attr, c.yes_word);
    render();
  });
  deps.state.subscribe(c.src_piece, (v) => { src = v || {}; render(); });
  deps.state.subscribe(c.off_piece, (v) => { offs = Array.isArray(v) ? v : []; render(); });
  return { text: () => (el ? el.textContent : '') };
}
