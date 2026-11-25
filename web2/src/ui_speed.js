// SpeedPanel(속도판 — 알림판, 설계 5-1-나 ui_speed · 5-1-다). 부모 Board 의 두 행위만 채운다:
//   needs() → speed 조각과 health.speed(쓸 수 있나), 간격, 자리(왼편) · show(data) → 지금 속도를 크게, 제한 속도 칸, 넘음 표시 자리.
// 계산·받기·구독은 하지 않는다(speed 조각을 그대로 보임 — 판 틀이 구독해 넘겨 준다). 까닭 글은 쓰지 않는다 — 값이 없으면 비움(F7).
// 제한 속도 값과 넘음 판단은 A5(relay_limit·limitmatch) — 지금은 칸이 빈다. 글·자리·간격·조각 이름은 config_ui_speed.
export const KIND = 'board';
export const NEEDS = ['cfg', 'doc', 'board'];

export function create(deps) {
  const c = deps.cfg.section('config_ui_speed');
  const doc = deps.doc;

  function el(id) {
    const e = doc.getElementById(id);
    if (!e) throw new Error(id);
    return e;
  }

  return deps.board.define({
    needs: () => ({ topics: [c.speed_piece, c.health_piece], interval_ms: c.interval_ms, slot: c.slot }),
    show(data) {
      const s = data[c.speed_piece];
      const h = data[c.health_piece];
      const usable = !(h && h.ok === false) && !!s && typeof s.kmh === 'number' && Number.isFinite(s.kmh);
      const hasLimit = usable && typeof s.limit_kmh === 'number';
      el(c.ids.value).textContent = usable ? String(Math.round(s.kmh)) : '';
      el(c.ids.unit).textContent = usable ? c.texts.unit : '';
      el(c.ids.limit).textContent = hasLimit ? String(s.limit_kmh) : '';
      el(c.ids.limit_label).textContent = hasLimit ? c.texts.limit_label : '';
      el(c.ids.root).setAttribute(c.judge_attr, usable && s.judge ? s.judge : c.judge_empty);
    },
  });
}
