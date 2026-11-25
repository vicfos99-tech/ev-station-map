// 순수: 충전기 상태 읽기(설계 5-1 ⑩ relay_read — 지역(시군구) 상태 파일). 꼴은 ref/relay_format.md 의 status/<zscode>.json:
//   {at: 14자리, s: {충전소 id: {충전기 id: [stat, 마지막 충전 끝, 지금 충전 시작]}}}
// 하는 일: 상태 파일 검사(status) · 고른 충전소가 들어 있는 시군구(zonesOf) · 충전소 하나의 충전기 줄(rows — stat 코드 → 상태 이름) · 상태마다 세기(count).
// 목록(stations/)에 있는데 상태 파일에 없는 충전기는 '모름'(빈자리가 아니다 — 모양 문서 규칙 2).
// 규칙 r = config_relay_read(칸 이름·한도·stat → 상태 표). 로그 없음, 파일 꼴이 틀리면 던진다.
export const NEEDS = [];

function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function own(o, k) {
  return Object.prototype.hasOwnProperty.call(o, k);
}

// 상태 파일 하나 → {at, s: {충전소 id: {충전기 id: stat 글 | null}}}. 충전소·충전기 칸 하나가 틀리면 그 칸만 빼고(모름이 됨), 파일 꼴이 틀리면 던진다
export function status(obj, r) {
  if (!isObj(obj) || !isObj(obj[r.s_key])) throw new TypeError(r.why.file);
  const at = typeof obj[r.at_key] === 'string' && obj[r.at_key].length <= r.at_max ? obj[r.at_key] : null;
  const s = {};
  let n = 0;
  for (const [sid, chs] of Object.entries(obj[r.s_key])) {
    if (!isObj(chs) || sid.length > r.id_max) continue;
    const one = {};
    for (const [cid, v] of Object.entries(chs)) {
      if (cid.length > r.id_max) continue;
      n += 1;
      if (n > r.max_chargers) throw new TypeError(r.why.too_many);
      const stat = Array.isArray(v) ? v[r.stat_index] : null;
      one[cid] = typeof stat === 'string' && stat.length <= r.stat_max ? stat : null;
    }
    s[sid] = one;
  }
  return { at, s };
}

// 고른 충전소 id 들 → 그 충전소들이 든 시군구 코드(목록에 있는 것만, 처음 나온 차례, 겹치지 않게)
export function zonesOf(ids, list) {
  if (!Array.isArray(ids) || !Array.isArray(list)) throw new TypeError('ids');
  const out = [];
  for (const id of ids) {
    const st = list.find((x) => x && x.id === id);
    if (st && typeof st.zscode === 'string' && !out.includes(st.zscode)) out.push(st.zscode);
  }
  return out;
}

// 충전소 하나(목록의 줄 — chargers = [{id, type, kw}]) + 그 시군구의 상태(status 결과 | null) → [{id, type, kw, stat, state}]
export function rows(station, zone, r) {
  if (!station || !Array.isArray(station.chargers)) throw new TypeError(r.why.station);
  const m = zone && isObj(zone.s) && isObj(zone.s[station.id]) ? zone.s[station.id] : null;
  return station.chargers.map((ch) => {
    const stat = m && own(m, ch.id) ? m[ch.id] : null;
    const state = stat !== null && own(r.stat_state, stat) ? r.stat_state[stat] : r.unknown_state;
    return { id: ch.id, type: ch.type, kw: ch.kw, stat, state };
  });
}

// 줄들 → {total, by: {상태 이름: 개수}} — 모든 상태 이름(r.states)을 0 부터
export function count(list, r) {
  const by = {};
  for (const s of r.states) by[s] = 0;
  for (const x of list) by[x.state] = (by[x.state] || 0) + 1;
  return { total: list.length, by };
}
