// ToiletBoard(화장실판 — 알림판, 추가3 화장실 꾸러미). 부모 Board 의 두 행위만 채운다. 화장실 제목이 켜졌을 때만 판 틀이 꽂는다(needs().topic).
//   needs() → ahead 조각(앞의 화장실 — 화장실 꾸러미의 계산 줄이 냄)·toilets 조각(칸 자세히 — 개방 시간·24시간·트럭·출처)·health.toilet, 간격, 자리(오른편)
//   show(data) → 1·2·3번 줄: 번호 · 이름 · 종류(휴게소·공공·묘성 / 주변) · 알림(24시간 또는 개방 시간 · 트럭) · 남은 거리(크게).
// 머리 글: 앞의 화장실 / 경로 따라 / 주변. 줄을 누르면 State 에 요청만(toilet.select.board — 화장실 정보 칸이 듣는다).
// 계산·받기·구독은 하지 않는다. 밖에서 온 글(이름·개방 시간)은 글로만 넣는다(textContent). 모르는 값(null)은 적지 않는다(지어내지 않음). 글·자리는 config_ui_toilet_board.
export const KIND = 'board';
export const NEEDS = ['cfg', 'doc', 'board', 'send'];

export function create(deps) {
  const c = deps.cfg.section('config_ui_toilet_board');
  const doc = deps.doc;
  const x = c.texts;
  let byId = new Map();
  let lastList = null;

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
    return d.toFixed(d < c.decimals_below_km ? c.decimals : 0);
  }

  function index(t) {
    const list = t && Array.isArray(t[c.list_key]) ? t[c.list_key] : null;
    if (list === lastList) return;
    lastList = list;
    byId = new Map((list || []).map((r) => [String(r.id), r]));
  }

  // 알림: 24시간이면 '24시간', 아니면 개방 시간 글(있으면) · 트럭 참/거짓(모르면 안 적음)
  function facts(t) {
    if (!t) return '';
    const out = [];
    if (t.all_day === true) out.push(x.all_day);
    else if (t.open) out.push(t.open);
    if (t.truck === true) out.push(x.truck_yes);
    else if (t.truck === false) out.push(x.truck_no);
    return out.join(x.join);
  }

  function row(item, around) {
    const t = byId.get(String(item.key)) || null;
    const r = doc.createElement(c.row_tag);
    r.className = c.classes.row;
    r.setAttribute(c.key_attr, String(item.key));
    const kind = around ? x.around_tag : (item.rest ? x.kinds.rest : (t && x.kinds[t.src]) || '');
    r.appendChild(part(c.classes.no, String(item.no)));
    r.appendChild(part(c.classes.name, String(item.name)));
    r.appendChild(part(c.classes.kind, kind));
    r.appendChild(part(c.classes.facts, facts(t)));
    r.appendChild(part(c.classes.dist, (around ? x.straight + ' ' : '') + distText(item.dist_km) + ' ' + x.km_unit));
    r.setAttribute(c.role_attr, c.role_button);
    r.addEventListener(c.click_event, () => deps.send(c.select_piece, { key: item.key, ids: Array.isArray(item.ids) ? item.ids.slice() : [item.key], name: item.name, lat: item.lat, lng: item.lng, dist_km: item.dist_km, straight: !!item.straight }));
    return r;
  }

  return deps.board.define({
    needs: () => ({ topics: [c.ahead_piece, c.toilets_piece, c.health_piece], interval_ms: c.interval_ms, slot: c.slot, sends: [c.select_piece], topic: c.topic }),
    show(data) {
      const a = data[c.ahead_piece];
      const h = data[c.health_piece];
      index(data[c.toilets_piece]);
      const usable = !(h && h.ok === false) && !!a && Array.isArray(a.items);
      const around = usable && a.mode === c.around_mode;
      el(c.ids.list).replaceChildren(...(usable ? a.items.map((it) => row(it, around)) : []));
      el(c.ids.head).textContent = usable ? (around ? x.head_around : (a.mode === c.route_mode ? x.head_route : x.head_ahead)) : '';
      el(c.ids.root).setAttribute(c.mode_attr, usable ? String(a.mode) : c.mode_empty);
    },
  });
}
