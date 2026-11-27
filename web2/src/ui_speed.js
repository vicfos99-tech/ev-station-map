// SpeedPanel(속도판 — 알림판, 설계 5-1-나 ui_speed · 5-1-다). 부모 Board 의 두 행위만 채운다:
//   needs() → speed 조각과 health.speed(쓸 수 있나), 간격, 자리(왼편) · show(data) → 지금 속도를 크게, 제한 속도 칸, 넘음 표시 자리.
// 계산·받기·구독은 하지 않는다(speed 조각을 그대로 보임 — 판 틀이 구독해 넘겨 준다). 까닭 글은 쓰지 않는다 — 값이 없으면 비움(F7).
// (A5) 세 모습: 정상(제한 속도 보임) · 넘음(data-judge over 주의·danger 위험 — 색·테두리는 style_ui_speed.css) · 빈 칸(제한 칸 data-limit blank).
// 제한 속도 값과 판단은 speed 조각에 같은 셈으로 함께 온 것(limit_kmh·judge)을 그대로 보인다 — 판은 견주지 않는다. 글·자리·간격·조각 이름은 config_ui_speed.
// 숫자 크기: 정해 둔 크기 단계(fit.size_steps_px) 가운데, 가장 긴 숫자(fit.max_digits 자리)가 판 안 폭에 다 들어가는 가장 큰 단계를 고른다.
// 판 폭은 그려진 판의 폭(clientWidth)으로 재고, 아직 그려지지 않았으면(0) 설정 폭(fit.panel_width_px)으로 셈한다.
// (2026-11-27) 제한 속도는 도로 표지판 모양(흰 둥근 판 + 빨간 테두리 + 검은 숫자) — 모양 값은 config_ui_speed.sign 을 CSS 변수로 넣고, 값이 없으면 판을 숨긴다(제한 칸 data-limit blank → CSS).
export const KIND = 'board';
export const NEEDS = ['cfg', 'doc', 'board'];

export function create(deps) {
  const c = deps.cfg.section('config_ui_speed');
  const f = c.fit;
  const sg = c.sign;
  const doc = deps.doc;

  function el(id) {
    const e = doc.getElementById(id);
    if (!e) throw new Error(id);
    return e;
  }

  // 판 안 폭(px)에 max_digits 자리 숫자가 들어가는 가장 큰 단계(없으면 가장 작은 단계)
  function sizeFor(width) {
    const inner = width - f.pad_px;
    const fits = f.size_steps_px.filter((s) => f.max_digits * f.digit_em * s <= inner);
    return fits.length ? Math.max(...fits) : Math.min(...f.size_steps_px);
  }

  function fit(root) {
    const measured = typeof root.clientWidth === 'number' && root.clientWidth > 0 ? root.clientWidth : f.panel_width_px;
    const size = sizeFor(measured);
    if (root.style && typeof root.style.setProperty === 'function') root.style.setProperty(f.size_var, size + f.size_unit);
    root.setAttribute(f.size_attr, String(size));
  }

  // 제한 속도 표지판 모양(크기·테두리·색)을 설정에서 CSS 변수로 — 판 뿌리마다 한 번(숫자 칸은 단위를 붙임)
  let signDone = null;
  function signVars(root) {
    if (signDone === root || !root.style || typeof root.style.setProperty !== 'function') return;
    for (const [k, name] of Object.entries(sg.vars)) root.style.setProperty(name, typeof sg[k] === 'number' ? sg[k] + sg.unit : String(sg[k]));
    signDone = root;
  }

  return deps.board.define({
    needs: () => ({ topics: [c.speed_piece, c.health_piece], interval_ms: c.interval_ms, slot: c.slot }),
    show(data) {
      const s = data[c.speed_piece];
      const h = data[c.health_piece];
      const usable = !(h && h.ok === false) && !!s && typeof s.kmh === 'number' && Number.isFinite(s.kmh);
      // 제한 속도가 없으면(자료 없는 길·못 받은 칸·후보 갈림) 칸을 비운다 — '0' 이나 짐작 값을 넣지 않는다
      // 0 도 '없음'(제한 속도 자료 꼴 — 0·빈 값 = 없음): 빈 둥근 판이나 '0' 표지판을 보이지 않는다
      const hasLimit = usable && typeof s.limit_kmh === 'number' && Number.isFinite(s.limit_kmh) && s.limit_kmh > 0;
      const root = el(c.ids.root);
      fit(root);
      signVars(root);
      el(c.ids.value).textContent = usable ? String(Math.round(s.kmh)) : '';
      el(c.ids.unit).textContent = usable ? c.texts.unit : '';
      el(c.ids.limit).textContent = hasLimit ? String(Math.round(s.limit_kmh)) : '';
      el(c.ids.limit_label).textContent = hasLimit ? c.texts.limit_label : '';
      el(c.ids.limit_row).setAttribute(c.limit_attr, hasLimit ? c.limit_words.shown : c.limit_words.blank);
      root.setAttribute(c.judge_attr, usable && s.judge ? s.judge : c.judge_empty);
    },
  });
}
