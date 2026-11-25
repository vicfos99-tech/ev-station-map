// 순수: 앞의 충전소(설계 5-1-나 Ahead · 5-8 가 · C8). StateCalc 가 부른다: (입력 조각들, 같은 셈의 앞 결과 done, 규칙 r = config_ahead, lib, 내 앞 결과 own) → ahead 조각.
// 지금 위치(done 의 pos — 같은 셈에서 Locate 가 먼저 셈한 선·km·방향)와 충전소 목록(stations)으로:
//   · 고속도로 위('ahead'): 같은 선·같은 진행 방향의 휴게소 충전소를 자리(휴게소)마다 묶어, 내 km 보다 앞에 있는 곳을 가까운 차례로 r.count 곳.
//     지나친 곳(남은 거리가 -r.pass_margin_km 보다 뒤)은 빠지고 다음 곳이 올라온다. 휴게소 방향은 충전소 이름의 방향 낱말(선마다 설정)로 가른다.
//   · 고속도로 밖('around'): 곧은 거리로 가까운 충전소 r.count 곳('주변' — 거리는 곧은 거리 표시). 선에서 r.around_after_m 넘게 떨어져야 바뀌고(깜빡임 여유),
//     선 위(Locate 의 on_line)로 돌아오면 다시 'ahead'. 그 사이(여유 띠)에서는 앞 결과를 그대로 둔다.
// 진행 방향: pos.dir(Locate — 진행 방향 각도) → 없으면 앞 결과와의 km 변화(r.dir_min_move_km 이상) → 없으면 앞 방향 → 없으면 모름(빈 목록 — 지어내지 않는다).
// ahead = {t, mode, dir, line, km, items: [{no, key, name, ops, rest, dir, km, dist_km, straight, lat, lng}]} — lat·lng = 그 자리(묶인 첫 충전소) 좌표(지도의 1·2·3번 표시, A3). 로그 없음, 틀린 입력은 던진다.
export const NEEDS = [];

const placeCache = new WeakMap();

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

// 이름 다듬기: 방향·괄호 낱말을 지우고 빈칸을 하나로(보이는 이름). 견줄 때는 빈칸을 모두 뺀 꼴(compact)
function cleanName(name, r) {
  let s = name;
  for (const p of r.name_strip_re) s = s.replace(new RegExp(p, 'g'), '');
  s = s.replace(new RegExp(r.name_space_re, 'g'), r.name_space).trim();
  return s || name;
}

function compact(s, r) {
  return s.replace(new RegExp(r.name_space_re, 'g'), '');
}

// 이름의 방향 낱말로 그 선의 방향(선 방향 / 거꾸로 / 모름)
function dirOfName(name, lineName, r, dirWords) {
  const w = r.line_dir_words[lineName];
  if (!w) return null;
  const fwd = w.forward.some((x) => name.includes(x));
  const back = w.backward.some((x) => name.includes(x));
  if (fwd === back) return null;
  return fwd ? dirWords.forward : dirWords.backward;
}

// 가장 많이 나온 이름(빈칸 뺀 꼴로 셈, 같으면 짧은 것) — 보이는 것은 그 꼴의 이름 가운데 가장 짧은 것(빈칸이 적은 것)
function pickName(names, r) {
  const count = new Map();
  const first = new Map();
  for (const n of names) {
    const k = compact(n, r);
    count.set(k, (count.get(k) || 0) + 1);
    if (!first.has(k) || n.length < first.get(k).length) first.set(k, n);
  }
  const best = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0];
  return first.get(best);
}

// 충전소 목록 → 자리(휴게소·주변 충전소) 목록. 같은 목록이면 한 번만 셈한다(결과는 같고 셈만 아낀다)
function placesOf(st, r, lib, rl) {
  const hit = placeCache.get(st);
  if (hit && hit.r === r) return hit.places;
  const geo = lib.parts[r.geo_part];
  const g = lib.rules[r.geo_rule];
  const lines = Array.isArray(st[r.lines_key]) ? st[r.lines_key] : [];
  const list = Array.isArray(st[r.list_key]) ? st[r.list_key] : [];
  const groups = [];
  for (const s of list) {
    if (!s || !isNum(s.lat) || !isNum(s.lng) || typeof s.name !== 'string') throw new TypeError(r.list_key);
    const clean = cleanName(s.name, r);
    let line = null;
    let km = null;
    let dir = null;
    if (s.rest === true) {
      let best = null;
      for (const ln of lines) {
        const sn = geo.snap({ lat: s.lat, lng: s.lng }, ln.points, g);
        if (!best || sn.off_m < best.off_m) best = { ...sn, line: ln.name };
      }
      if (best && best.off_m <= r.station_line_m) {
        line = best.line;
        km = best.km;
        dir = dirOfName(s.name, line, r, rl.dir_words);
      }
    }
    const onLine = line !== null;
    const grp = groups.find((x) => (onLine
      ? x.line === line && x.dir === dir && Math.abs(x.km0 - km) <= r.group_km
      : x.line === null && x.rest === (s.rest === true) && geo.distM(x, s, g) <= r.around_group_m));
    if (grp) {
      grp.members.push({ id: s.id, name: clean, op: s.operator, km });
    } else {
      groups.push({ line, dir, km0: km, rest: s.rest === true, lat: s.lat, lng: s.lng, members: [{ id: s.id, name: clean, op: s.operator, km }] });
    }
  }
  const places = groups.map((x) => {
    const kms = x.members.map((m) => m.km).filter(isNum);
    const ops = [];
    for (const m of x.members) if (m.op && !ops.includes(m.op)) ops.push(m.op);
    return {
      key: x.members[0].id,
      name: pickName(x.members.map((m) => m.name), r),
      ops,
      rest: x.rest,
      line: x.line,
      dir: x.dir,
      km: kms.length ? kms.reduce((a, b) => a + b, 0) / kms.length : null,
      lat: x.lat,
      lng: x.lng,
    };
  });
  placeCache.set(st, { r, places });
  return places;
}

function round(v, k) {
  return Math.round(v * k) / k;
}

function numbered(list) {
  return list.map((x, i) => ({ no: i + 1, ...x }));
}

export function aheadOf(inputs, done, r, lib, own) {
  const fix = inputs[r.fix_input];
  const st = inputs[r.stations_input];
  const pos = done[r.pos_piece];
  if (!fix || !st || !pos) return own || null;
  if (!isNum(fix.lat) || !isNum(fix.lng)) throw new TypeError(r.fix_input);
  const rl = lib.rules[r.locate_rule];
  const geo = lib.parts[r.geo_part];
  const g = lib.rules[r.geo_rule];
  if (!rl || !geo || !g) throw new TypeError(r.locate_rule);
  const places = placesOf(st, r, lib, rl);
  const prevMode = own ? own.mode : null;
  let mode;
  if (pos.on_line) mode = r.modes.ahead;
  else if (prevMode === r.modes.ahead && isNum(pos.off_m) && pos.off_m <= r.around_after_m) {
    return { ...own, t: fix.t }; // 여유 띠 — 앞 결과 그대로(선 가장자리에서 깜빡이지 않게)
  } else mode = r.modes.around;

  if (mode === r.modes.around) {
    const near = places
      .filter((p) => !(r.around_skip_rest && p.rest))
      .map((p) => ({ p, d: geo.distM(fix, p, g) / g.m_per_km }))
      .filter((x) => x.d <= r.around_max_km)
      .sort((a, b) => a.d - b.d)
      .slice(0, r.count)
      .map((x) => ({ key: x.p.key, name: x.p.name, ops: x.p.ops, rest: x.p.rest, dir: null, km: null, dist_km: round(x.d, r.km_round), straight: true, lat: x.p.lat, lng: x.p.lng }));
    return { t: fix.t, mode, dir: null, line: null, km: null, items: numbered(near) };
  }

  let dir = pos.dir || null;
  const sameLine = own && own.mode === r.modes.ahead && own.line === pos.line && isNum(own.km);
  if (!dir && sameLine && Math.abs(pos.km - own.km) >= r.dir_min_move_km) dir = pos.km > own.km ? rl.dir_words.forward : rl.dir_words.backward;
  if (!dir && sameLine) dir = own.dir;
  if (!dir) return { t: fix.t, mode, dir: null, line: pos.line, km: pos.km, items: [] };
  const sign = dir === rl.dir_words.forward ? 1 : -1;
  const front = places
    .filter((p) => p.rest && p.line === pos.line && isNum(p.km) && (p.dir === dir || (p.dir === null && r.dir_unknown_keep)))
    .map((p) => ({ p, rem: sign * (p.km - pos.km) }))
    .filter((x) => x.rem >= -r.pass_margin_km)
    .sort((a, b) => a.rem - b.rem)
    .slice(0, r.count)
    .map((x) => ({ key: x.p.key, name: x.p.name, ops: x.p.ops, rest: x.p.rest, dir: x.p.dir, km: round(x.p.km, r.km_round), dist_km: round(Math.max(0, x.rem), r.km_round), straight: false, lat: x.p.lat, lng: x.p.lng }));
  return { t: fix.t, mode, dir, line: pos.line, km: pos.km, items: numbered(front) };
}
