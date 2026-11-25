// 순수: 내가 확인한 값(설계 5-1 mine — 옛 앱 app.js 34~51·174~185 를 옮김). 폰에 저장한 '내 값'(mine = {ops: {업체: {alias, price}}, stations: {id: {price, height, statuses, at}}})을
// 엔진 입력 충전소에 덮어쓰고(업체 요금 → 충전소 요금 → 충전기 상태: 받은 뒤에 확인한 것만), 업체 이름을 별명으로 보인다.
// 규칙 r = config_mine(기본 별명·이름 꼴). 로그 없음, 틀린 입력은 던진다.
export const NEEDS = [];

function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// 저장된 값 → 늘 같은 꼴(없거나 틀리면 빈 값 — 옛 앱과 같이)
export function normalize(m) {
  const o = isObj(m) ? m : {};
  return { ops: isObj(o.ops) ? o.ops : {}, stations: isObj(o.stations) ? o.stations : {} };
}

export function aliasOf(op, mine, r) {
  const o = mine.ops[op];
  return o && typeof o.alias === 'string' ? o.alias : (r.default_alias[op] || '');
}

export function opLabel(op, mine, r) {
  const a = aliasOf(op, mine, r);
  return a && a !== op ? r.label_tpl.split(r.alias_mark).join(a).split(r.op_mark).join(op) : op;
}

// 충전소에 내 값이 지금 적용되는지: 요금은 늘, 상태는 그 뒤로 새 자료가 오기 전까지만(liveAt = 받은 자료의 시각)
export function mineState(id, liveAt, mine) {
  const m = mine.stations[id];
  if (!m) return { price: false, status: false, at: 0 };
  return { price: m.price > 0, status: !!(Array.isArray(m.statuses) && m.statuses.some(Boolean) && m.at > liveAt), at: m.at };
}

export function heightLimit(id, mine) {
  const m = mine.stations[id];
  return m && m.height > 0 ? m.height : 0;
}

// 엔진 입력 충전소 하나(st — 바꿔도 되는 사본)에 내 값을 덮어쓴다
export function applyMine(st, liveAt, mine) {
  if (!isObj(st) || !Array.isArray(st.chargers)) throw new TypeError('station');
  const op = mine.ops[st.operator];
  if (op && op.price > 0) st.price_per_kwh = op.price;
  const m = mine.stations[st.id];
  if (!m) return st;
  if (m.price > 0) st.price_per_kwh = m.price;
  if (mineState(st.id, liveAt, mine).status && m.statuses.length === st.chargers.length) {
    m.statuses.forEach((s, i) => { if (s) st.chargers[i].status = s; });
    st.status_updated_at = m.at;
  }
  return st;
}
