// 순수: 나들목 인근 충전소 자료 검사와 붙이기(추가4 — 충전소 꾸러미의 것). 로그 없음, 틀린 입력 꼴은 던진다. 규칙 r = config_relay_ramps.
//   · check(data, line, r) → {good, bad}: 중계 나들목 파일({v, line, at, ramps:[…]})의 꼴 검사 + 줄 검사. 파일 꼴·선 이름이 틀리면 던진다(받은 쪽이 '이상함'으로 기록).
//     줄 = {id, name, km, dir, rest, nearby:[{id, detour, at}]} (km 는 휴게소에 붙는 줄이면 null). 틀린 줄은 버리고 bad 에 {i, why}.
//   · attach(areas, list, X, r) → {areas, shown}: 휴게소 목록(옛 노선 꼴 rest_areas — {id, name, km, stations, nearby})에 나들목 인근 충전소를 붙인다(옛 앱 노선 꼴 그대로).
//     X = {dir(진행 방향 낱말), along(선 km → 노선 첫머리부터 거리), station(id, at) → 충전소 꼴 | null(목록에 없음), ic_kind(나들목 항목 표시 낱말)}.
//     rest 가 있는 줄은 그 충전소가 든 휴게소 아래 nearby 에, 없는 줄은 나들목 항목(stations 없음, kind ic)으로 km 차례에 끼운다.
//     방향이 다른 줄·이미 지난 나들목·목록에 없는 충전소·휴게소 충전소로 이미 든 것·한 항목 안 겹침은 뺀다.
export const LAYER = 'pure';
export const NEEDS = [];

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function isStr(v, max) {
  return typeof v === 'string' && v.length > 0 && v.length <= max;
}

function isObj(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export function check(data, line, r) {
  const S = r.shape;
  const L = r.limits;
  const F = r.fields;
  if (!isObj(data) || data[S.v_key] !== S.v || !Array.isArray(data[S.list_key])) throw new TypeError(r.why.file);
  if (data[S.line_key] !== line) throw new TypeError(r.why.line);
  if (data[S.list_key].length > L.max_ramps) throw new TypeError(r.why.too_many);
  const dirs = Object.values(r.dirs);
  const good = [];
  const bad = [];
  data[S.list_key].forEach((x, i) => {
    if (!isObj(x)) { bad.push({ i, why: r.why.item }); return; }
    if (!isStr(x[F.id], L.id_max)) { bad.push({ i, why: r.why.id }); return; }
    if (!isStr(x[F.name], L.name_max)) { bad.push({ i, id: x[F.id], why: r.why.name }); return; }
    if (!dirs.includes(x[F.dir])) { bad.push({ i, id: x[F.id], why: r.why.dir }); return; }
    const hasRest = x[F.rest] !== undefined && x[F.rest] !== null;
    if (hasRest && !isStr(x[F.rest], L.id_max)) { bad.push({ i, id: x[F.id], why: r.why.rest }); return; }
    if (!hasRest && !(isNum(x[F.km]) && x[F.km] >= 0 && x[F.km] <= L.km_max)) { bad.push({ i, id: x[F.id], why: r.why.km }); return; }
    const raw = x[F.nearby];
    if (!Array.isArray(raw) || !raw.length || raw.length > L.max_nearby) { bad.push({ i, id: x[F.id], why: r.why.nearby }); return; }
    const nearby = [];
    for (const n of raw) {
      if (!isObj(n) || !isStr(n[F.n_id], L.id_max) || !isNum(n[F.n_detour]) || !(n[F.n_detour] > 0) || n[F.n_detour] > L.detour_max) { nearby.length = 0; break; }
      const at = isStr(n[F.n_at], L.at_max) ? n[F.n_at] : null;
      nearby.push({ id: n[F.n_id], detour: n[F.n_detour], at });
    }
    if (!nearby.length) { bad.push({ i, id: x[F.id], why: r.why.nearby }); return; }
    good.push({ id: x[F.id], name: x[F.name], km: hasRest ? null : x[F.km], dir: x[F.dir], rest: hasRest ? x[F.rest] : null, nearby });
  });
  return { good, bad };
}

export function attach(areas, list, X, r) {
  const out = areas.map((a) => ({ ...a, nearby: (a.nearby || []).slice() }));
  const inRest = new Set();
  for (const a of out) for (const s of a.stations) inRest.add(s.id);
  const ics = [];
  let shown = 0;
  const fill = (target, ramp) => {
    const seen = new Set(target.nearby.map((n) => n.station.id));
    for (const n of ramp.nearby) {
      if (inRest.has(n.id) || seen.has(n.id)) continue;
      const st = X.station(n.id, n.at);
      if (!st) continue;
      seen.add(n.id);
      target.nearby.push({ station: st, detour: n.detour });
      shown += 1;
    }
  };
  for (const ramp of list) {
    if (ramp.rest !== null) {
      const a = out.find((x) => x.stations.some((s) => s.id === ramp.rest));
      if (a) fill(a, ramp);
      continue;
    }
    if (ramp.dir !== r.dirs.both && ramp.dir !== X.dir) continue;
    const d = X.along(ramp.km);
    if (!(d >= 0)) continue;
    const ic = { id: ramp.id, name: ramp.name, km: d, kind: X.ic_kind, stations: [], nearby: [] };
    fill(ic, ramp);
    if (ic.nearby.length) ics.push(ic);
  }
  // km 차례. 같은 km 면 나들목 항목이 휴게소보다 앞(옛 실제 자료의 차례 — 엔진의 같은 점수 가름이 입력 차례를 따름). 그 밖은 안정 정렬
  const isIc = (a) => (a.kind === X.ic_kind ? 1 : 0);
  const all = [...out, ...ics].sort((a, b) => (a.km - b.km) || (isIc(b) - isIc(a)));
  return { areas: all, shown };
}
