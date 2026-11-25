// SpeedPanel(속도판 — 알림판, 설계 5-1-나 ui_speed · 5-1-다). 부모 Board 의 두 행위만 채운다:
//   needs() → speed 조각과 health.speed(쓸 수 있나), 간격, 자리(왼편) · show(data) → 지금 속도를 크게, 제한 속도 칸, 넘음 표시 자리.
// 계산·받기·구독은 하지 않는다(speed 조각을 그대로 보임 — 판 틀이 구독해 넘겨 준다). 까닭 글은 쓰지 않는다 — 값이 없으면 비움(F7).
// 제한 속도 값과 넘음 판단은 A5(relay_limit·limitmatch) — 지금은 칸이 빈다. 글·자리·간격·조각 이름은 config_ui_speed.
// 숫자 크기: 정해 둔 크기 단계(fit.size_steps_px) 가운데, 가장 긴 숫자(fit.max_digits 자리)가 판 안 폭에 다 들어가는 가장 큰 단계를 고른다.
// 판 폭은 그려진 판의 폭(clientWidth)으로 재고, 아직 그려지지 않았으면(0) 설정 폭(fit.panel_width_px)으로 셈한다.
export const KIND = 'board';
export const NEEDS = ['cfg', 'doc', 'board'];

export function create(deps) {
  const c = deps.cfg.section('config_ui_speed');
  const f = c.fit;
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

  return deps.board.define({
    needs: () => ({ topics: [c.speed_piece, c.health_piece], interval_ms: c.interval_ms, slot: c.slot }),
    show(data) {
      const s = data[c.speed_piece];
      const h = data[c.health_piece];
      const usable = !(h && h.ok === false) && !!s && typeof s.kmh === 'number' && Number.isFinite(s.kmh);
      const hasLimit = usable && typeof s.limit_kmh === 'number';
      const root = el(c.ids.root);
      fit(root);
      el(c.ids.value).textContent = usable ? String(Math.round(s.kmh)) : '';
      el(c.ids.unit).textContent = usable ? c.texts.unit : '';
      el(c.ids.limit).textContent = hasLimit ? String(s.limit_kmh) : '';
      el(c.ids.limit_label).textContent = hasLimit ? c.texts.limit_label : '';
      root.setAttribute(c.judge_attr, usable && s.judge ? s.judge : c.judge_empty);
    },
  });
}
