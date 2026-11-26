// 순수: '앞의 ○○'(설계 5-1-나 Ahead · 5-8 가 · C8) — 제목(충전소·화장실 …)을 모른다(정비 나 ②). StateCalc 가 부른다: (입력 조각들, 같은 셈의 앞 결과 done, 규칙 r, lib, 내 앞 결과 own) → ahead 조각.
// 받는 것 = 점들: 입력 조각 inputs[r.items_input] 의 목록(r.list_key)과 선(r.lines_key). 점의 칸 이름은 규칙 r.fields 에서(키·이름·꼬리표·선 위 자리 표시·좌표) —
//   어느 제목의 점인지·칸이 무엇을 뜻하는지는 그 제목 꾸러미의 규칙 파일(충전소 = config_ahead)이 정한다.
// 지금 위치(done 의 pos — 같은 셈에서 Locate 가 먼저 셈한 선·km·방향)와 점들로:
//   · 선 위('ahead'): '선 위 자리' 점(fields.on_line)을 선에 붙여(r.snap_m 안) 같은 선·같은 진행 방향의 것을 자리마다 묶어(r.group_km), 내 km 보다 앞에 있는 곳을 가까운 차례로 r.count 곳.
//     지나친 곳(남은 거리가 -r.pass_margin_km 보다 뒤)은 빠지고 다음 곳이 올라온다. 자리의 방향은 점 이름의 방향 낱말(선마다 r.line_dir_words)로 가른다.
//   · 선 밖('around'): 곧은 거리로 가까운 자리 r.count 곳('주변' — 거리는 곧은 거리 표시). 선에서 r.around_after_m 넘게 떨어져야 바뀌고(깜빡임 여유),
//     선 위(Locate 의 on_line)로 돌아오면 다시 'ahead'. 그 사이(여유 띠)에서는 앞 결과를 그대로 둔다. r.around_skip_on_line 이면 '선 위 자리' 점은 뺀다.
// 진행 방향: pos.dir(Locate — 진행 방향 각도) → 없으면 앞 결과와의 km 변화(r.dir_min_move_km 이상) → 없으면 앞 방향 → 없으면 모름(빈 목록 — 지어내지 않는다).
// (A6) 같은 셈의 앞 결과에 경로(done.route — naviroute)가 있고 내가 그 위면 'route': 경로 위 차례로(Navi — 갈아타는 곳 너머까지, 경로 끝 뒤는 끝의 선으로 채움).
// ahead = {t, mode, dir, line, km, items: [{no, key, ids, name, ops, rest, dir, km, dist_km, straight, lat, lng}]} — key = 자리의 첫 점 키, ids = 묶인 점 키들,
//   ops = 묶인 점의 꼬리표들(충전소면 업체), rest = '선 위 자리'인가, lat·lng = 자리(묶인 첫 점) 좌표. 칸 이름은 앞 걸음들과 같게 둔다(화면·목록이 그대로 읽음). 로그 없음, 틀린 입력은 던진다.
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

// 점 목록 → 자리 목록(선 위 자리는 선·방향·km 로, 그 밖은 곧은 거리로 묶음). 같은 목록이면 한 번만 셈한다(결과는 같고 셈만 아낀다)
function placesOf(st, r, lib, rl) {
  const hit = placeCache.get(st);
  if (hit && hit.r === r) return hit.places;
  const geo = lib.parts[r.geo_part];
  const g = lib.rules[r.geo_rule];
  const lines = Array.isArray(st[r.lines_key]) ? st[r.lines_key] : [];
  const list = Array.isArray(st[r.list_key]) ? st[r.list_key] : [];
  const F = r.fields;
  const groups = [];
  for (const raw of list) {
    if (!raw) throw new TypeError(r.list_key);
    const s = { id: raw[F.key], name: raw[F.name], tag: raw[F.tag], onLine: raw[F.on_line] === true, lat: raw[F.lat], lng: raw[F.lng] };
    if (!isNum(s.lat) || !isNum(s.lng) || typeof s.name !== 'string') throw new TypeError(r.list_key);
    const clean = cleanName(s.name, r);
    let line = null;
    let km = null;
    let dir = null;
    if (s.onLine) {
      let best = null;
      for (const ln of lines) {
        const sn = geo.snap({ lat: s.lat, lng: s.lng }, ln.points, g);
        if (!best || sn.off_m < best.off_m) best = { ...sn, line: ln.name };
      }
      if (best && best.off_m <= r.snap_m) {
        line = best.line;
        km = best.km;
        dir = dirOfName(s.name, line, r, rl.dir_words);
      }
    }
    const snapped = line !== null;
    const grp = groups.find((x) => (snapped
      ? x.line === line && x.dir === dir && Math.abs(x.km0 - km) <= r.group_km
      : x.line === null && x.rest === s.onLine && geo.distM(x, s, g) <= r.around_group_m));
    if (grp) {
      grp.members.push({ id: s.id, name: clean, op: s.tag, km });
    } else {
      groups.push({ line, dir, km0: km, rest: s.onLine, lat: s.lat, lng: s.lng, members: [{ id: s.id, name: clean, op: s.tag, km }] });
    }
  }
  const places = groups.map((x) => {
    const kms = x.members.map((m) => m.km).filter(isNum);
    const ops = [];
    for (const m of x.members) if (m.op && !ops.includes(m.op)) ops.push(m.op);
    return {
      key: x.members[0].id,
      ids: x.members.map((m) => m.id),
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

// (A7) 자리 목록을 밖에서도 같은 셈으로 — 목록·추천(planinput)이 휴게소를 같은 묶음·같은 km·같은 방향으로 쓴다(중복 최소화)
export function places(st, r, lib) {
  const rl = lib.rules[r.locate_rule];
  if (!rl || !lib.parts[r.geo_part] || !lib.rules[r.geo_rule]) throw new TypeError(r.locate_rule);
  return placesOf(st, r, lib, rl);
}

function round(v, k) {
  return Math.round(v * k) / k;
}

function numbered(list) {
  return list.map((x, i) => ({ no: i + 1, ...x }));
}

export function aheadOf(inputs, done, r, lib, own) {
  const fix = inputs[r.fix_input];
  const st = inputs[r.items_input];
  const pos = done[r.pos_piece];
  if (!fix || !st || !pos) return own || null;
  if (!isNum(fix.lat) || !isNum(fix.lng)) throw new TypeError(r.fix_input);
  const rl = lib.rules[r.locate_rule];
  const geo = lib.parts[r.geo_part];
  const g = lib.rules[r.geo_rule];
  if (!rl || !geo || !g) throw new TypeError(r.locate_rule);
  const places = placesOf(st, r, lib, rl);
  // (A6) 경로가 있고 그 위에 있으면 경로 기준(설계 5-8 가-6) — 셈은 Navi(lib.parts[r.navi_part]). 경로에서 벗어나면 아래 선·주변 셈
  const route = done[r.route_piece];
  if (route && Array.isArray(route.points)) {
    const navi = lib.parts[r.navi_part];
    const rn = lib.rules[r.navi_rule];
    if (!navi || !rn) throw new TypeError(r.navi_part);
    const on = navi.aheadOnRoute({ fix, route, places, lines: st[r.lines_key] }, r, rn, rl, geo, g);
    if (on) return { t: fix.t, mode: r.modes.route, dir: null, line: null, km: null, route_seq: route.seq, route_km: round(on.my_km, r.km_round), items: numbered(on.items) };
  }
  const prevMode = own ? own.mode : null;
  let mode;
  if (pos.on_line) mode = r.modes.ahead;
  else if (prevMode === r.modes.ahead && isNum(pos.off_m) && pos.off_m <= r.around_after_m) {
    return { ...own, t: fix.t }; // 여유 띠 — 앞 결과 그대로(선 가장자리에서 깜빡이지 않게)
  } else mode = r.modes.around;

  if (mode === r.modes.around) {
    const near = places
      .filter((p) => !(r.around_skip_on_line && p.rest))
      .map((p) => ({ p, d: geo.distM(fix, p, g) / g.m_per_km }))
      .filter((x) => x.d <= r.around_max_km)
      .sort((a, b) => a.d - b.d)
      .slice(0, r.count)
      .map((x) => ({ key: x.p.key, ids: x.p.ids, name: x.p.name, ops: x.p.ops, rest: x.p.rest, dir: null, km: null, dist_km: round(x.d, r.km_round), straight: true, lat: x.p.lat, lng: x.p.lng }));
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
    .map((x) => ({ key: x.p.key, ids: x.p.ids, name: x.p.name, ops: x.p.ops, rest: x.p.rest, dir: x.p.dir, km: round(x.p.km, r.km_round), dist_km: round(Math.max(0, x.rem), r.km_round), straight: false, lat: x.p.lat, lng: x.p.lng }));
  return { t: fix.t, mode, dir, line: pos.line, km: pos.km, items: numbered(front) };
}
