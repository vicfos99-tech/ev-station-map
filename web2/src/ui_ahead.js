// AheadPanel(충전소판 — 알림판, 설계 5-1-나 ui_ahead · 5-1-다 · 5-8 가). 부모 Board 의 두 행위만 채운다:
//   needs() → ahead 조각과 health.ahead(쓸 수 있나), 간격, 자리(오른편) · show(data) → 1·2·3번 줄: 번호·이름·종류·업체·남은 거리(크게).
// '주변'(고속도로 밖 — C8)이면 머리 글이 바뀌고 줄마다 '주변' 꼬리표, 거리 앞에 '직선'(길 따라 잰 거리가 아님).
// 계산·받기·구독은 하지 않는다(판 틀이 구독해 넘겨 준다). 까닭 글은 쓰지 않는다 — 값이 없으면 비움(F7).
// 밖에서 온 글(충전소 이름·업체)은 글로만 넣는다(textContent — HTML 로 넣지 않음, 5-7 (1)). 글·자리·간격·꼴은 config_ui_ahead.
// 줄 전체를 누르면 State 에 요청만 낸다(station.select.ahead — A4 정보 칸이 듣는다. 판 틀이 needs().sends 로 주인을 잡아 send 로 넘김).
export const KIND = 'board';
export const NEEDS = ['cfg', 'doc', 'board', 'send'];

export function create(deps) {
  const c = deps.cfg.section('config_ui_ahead');
  const doc = deps.doc;
  const x = c.texts;
  let line = null;

  // 고른 자리: 묶인 충전소 id 들·이름·방향(선 방향 낱말)·선·그 자리 좌표(방향 충전소 자리)
  function pick(item) {
    deps.send(c.select_piece, {
      key: item.key, ids: Array.isArray(item.ids) ? item.ids.slice() : [item.key], name: item.name,
      dir: item.dir || null, line: item.dir ? line : null, lat: item.lat, lng: item.lng, rest: !!item.rest,
    });
  }

  function el(id) {
    const e = doc.getElementById(id);
    if (!e) throw new Error(id);
    return e;
  }

  function part(cls, text) {
    const e = doc.createElement(c.part_tag);
    e.className = cls;
    e.textContent = text;
    return e;
  }

  function distText(d) {
    const digits = d < c.decimals_below_km ? c.decimals : 0;
    return d.toFixed(digits);
  }

  function opsText(ops) {
    if (!Array.isArray(ops) || !ops.length) return '';
    const shown = ops.slice(0, c.ops_max).join(x.ops_join);
    return ops.length > c.ops_max ? shown + x.ops_more.split(c.n_mark).join(String(ops.length - c.ops_max)) : shown;
  }

  function row(item, around) {
    const r = doc.createElement(c.row_tag);
    r.className = c.classes.row;
    r.setAttribute(c.key_attr, String(item.key));
    const kind = around ? x.around_tag : (item.rest ? x.kinds.rest : x.kinds.other);
    r.appendChild(part(c.classes.no, String(item.no)));
    r.appendChild(part(c.classes.name, String(item.name)));
    r.appendChild(part(c.classes.kind, kind));
    r.appendChild(part(c.classes.ops, opsText(item.ops)));
    r.appendChild(part(c.classes.dist, (around ? x.straight + ' ' : '') + distText(item.dist_km) + ' ' + x.km_unit));
    r.setAttribute(c.role_attr, c.role_button);
    r.addEventListener(c.click_event, () => pick(item));
    return r;
  }

  return deps.board.define({
    needs: () => ({ topics: [c.ahead_piece, c.health_piece], interval_ms: c.interval_ms, slot: c.slot, sends: [c.select_piece] }),
    show(data) {
      const a = data[c.ahead_piece];
      const h = data[c.health_piece];
      const usable = !(h && h.ok === false) && !!a && Array.isArray(a.items);
      const around = usable && a.mode === c.around_mode;
      line = usable ? a.line : null;
      const list = el(c.ids.list);
      const rows = usable ? a.items.map((it) => row(it, around)) : [];
      list.replaceChildren(...rows);
      el(c.ids.head).textContent = usable ? (around ? x.head_around : x.head_ahead) : '';
      el(c.ids.root).setAttribute(c.mode_attr, usable ? String(a.mode) : c.mode_empty);
    },
  });
}
