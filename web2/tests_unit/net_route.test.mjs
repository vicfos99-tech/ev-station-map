// 단위 시험: RouteClient(net_route) 중 11/27 더한 '다시 켜면 고른 길로 돌아오기'(c.resume). 가짜 State·Store·시계·NetCore 로 —
// 새 길 답을 데이터 폴더에 남김 · 다시 켜고 좋음이 되면 다시 묻지 않고 남긴 답을 route.answer(seq 0)로 냄 · '경로 지우기'면 비움 ·
// 오래된 답·깨진 답은 버림 · 끔이면 남기지도 내지도 않음. 노선 꼴 셈(routeOf)이 되살린 답을 그리고, 화면의 지우기(seq 0)가 이김.
const ANSWER = { v: 1, ok: true, source: 'store', at: '20261127070000', stored_at: null, dist_km: 3.2, pieces: [{ road: '경부고속도로', line: [[37.0, 127.0], [37.01, 127.01], [37.02, 127.02]], km: 3.2 }] };

function rig(t, disk, opts) {
  const NR = t.cfg('config_net_route');
  if (opts && opts.over) NR.resume = { ...NR.resume, ...opts.over };
  const HC = t.cfg('config_health');
  const cfgs = { config_net_route: NR, config_health: HC, config_naviroute: t.cfg('config_naviroute'), config_formcheck: t.cfg('config_formcheck') };
  const subs = {};
  const pubs = [];
  const state = {
    claim: (owner, names) => (n, v) => { if (!names.includes(n)) throw new Error(n); pubs.push([n, v]); },
    subscribe: (n, fn) => { (subs[n] = subs[n] || []).push(fn); },
    fire: (n, v) => { for (const fn of subs[n] || []) fn(v); },
  };
  let now = (opts && opts.now) || 1000000;
  const clock = { now: () => now, setTimeout: () => 0, clearTimeout() {}, step(ms) { now += ms; } };
  const asks = [];
  const netcore = { ask: async (client, route) => { asks.push(route); if (route === NR.routes.route) return { ok: true, data: JSON.parse(JSON.stringify(ANSWER)) }; return { ok: true, data: { src: { home: NR.good_word } } }; } };
  const store = { read: async (k) => ({ ok: true, value: disk[k] === undefined ? null : JSON.parse(JSON.stringify(disk[k])) }), write: async (k, v) => { disk[k] = v; return { ok: true }; }, listRecords: async () => ({ ok: true, names: [] }) };
  const logs = [];
  const log = { info: (w, what, o) => logs.push(['info', what, o]), warn: (w, what, o) => logs.push(['warn', what, o]), error: (e) => logs.push(['error', String(e && e.message)]) };
  return { NR, HC, cfg: { section: (n) => cfgs[n] }, state, clock, netcore, store, log, logs, pubs, asks };
}
const tick = () => new Promise((r) => setTimeout(r, 10));

export default async function (t) {
  const { createRouteClient } = await t.src('net_route');
  const naviroute = await t.src('naviroute');
  const disk = {};

  const a = rig(t, disk);
  createRouteClient({ ...a, naviroute });
  a.state.fire(a.NR.app_piece, { stage: a.HC.stages.good });
  await tick();
  a.state.fire(a.NR.pieces.route_request, { seq: 3, from: [37.0, 127.0], to: [37.02, 127.02], name: '안성휴게소' });
  await tick();
  const saved = disk[a.NR.resume.store_key];
  t.check('①', '새 길 답 → 데이터 폴더에 남김(답 그대로 + 목적지 + 남긴 때)', '남김 · 목적지 안성휴게소 · 조각 1', saved ? '남김 · 목적지 ' + saved.dest.name + ' · 조각 ' + saved.answer.pieces.length : '안 남김',
    !!saved && saved.dest.name === '안성휴게소' && saved.answer.pieces.length === 1 && typeof saved.saved_at === 'number');

  const b = rig(t, disk, { now: 1000000 + 60000 });
  createRouteClient({ ...b, naviroute });
  b.state.fire(b.NR.app_piece, { stage: b.HC.stages.good });
  await tick();
  const ans = b.pubs.filter((p) => p[0] === b.NR.pieces.answer).map((p) => p[1]);
  t.check('②', '다시 켬 → 좋음이 되면 다시 묻지 않고 남긴 답을 route.answer 로(seq ' + b.NR.resume.seq + ') · 되살림 로그', '답 1 · seq 0 · 안성휴게소 · 길 물음 0 · 로그 1',
    '답 ' + ans.length + ' · seq ' + (ans[0] || {}).seq + ' · ' + ((ans[0] || {}).dest || {}).name + ' · 길 물음 ' + b.asks.filter((x) => x === b.NR.routes.route).length + ' · 로그 ' + b.logs.filter((l) => l[1] === b.NR.resume.words.restored).length,
    ans.length === 1 && ans[0].seq === b.NR.resume.seq && ans[0].dest.name === '안성휴게소' && b.asks.filter((x) => x === b.NR.routes.route).length === 0 && b.logs.filter((l) => l[1] === b.NR.resume.words.restored).length === 1);

  // 노선 꼴 셈이 되살린 답을 그대로 그리고, 화면의 첫 지우기(seq 0)가 이긴다
  const rr = t.cfg('config_naviroute');
  const geo = await t.src('geo');
  const lib = { parts: { [rr.geo_part]: geo }, rules: { [rr.geo_rule]: t.cfg('config_geo') } };
  const drawn = naviroute.routeOf({ [rr.answer_input]: ans[0] }, null, rr, lib, null);
  const cleared = naviroute.routeOf({ [rr.answer_input]: ans[0], [rr.clear_input]: { seq: 0 } }, null, rr, lib, null);
  t.check('③', '노선 꼴 — 되살린 답을 그림(점 3) · 화면의 지우기(seq 0)면 없음', '점 3 · 지움 null', '점 ' + (drawn ? drawn.points.length : 0) + ' · 지움 ' + JSON.stringify(cleared), !!drawn && drawn.points.length === 3 && cleared === null);

  b.state.fire(b.NR.resume.clear_piece, { seq: 0 });
  await tick();
  t.check('④', "'경로 지우기' → 남긴 답을 비움", 'null', JSON.stringify(disk[b.NR.resume.store_key]), disk[b.NR.resume.store_key] === null);

  // 오래된 답(max_age_ms 넘음)은 버림
  const disk2 = { [b.NR.resume.store_key]: { saved_at: 1000, dest: { name: '옛곳', lat: 37, lng: 127 }, answer: ANSWER } };
  const c = rig(t, disk2, { now: 1000 + b.NR.resume.max_age_ms + 1 });
  createRouteClient({ ...c, naviroute });
  c.state.fire(c.NR.app_piece, { stage: c.HC.stages.good });
  await tick();
  t.check('⑤', '남긴 지 ' + c.NR.resume.max_age_ms + 'ms 넘은 답은 내지 않고 비움', '답 0 · 비움 · 로그 ' + c.NR.resume.words.old, '답 ' + c.pubs.filter((p) => p[0] === c.NR.pieces.answer).length + ' · ' + JSON.stringify(disk2[c.NR.resume.store_key]) + ' · 로그 ' + c.logs.filter((l) => l[1] === c.NR.resume.words.old).length,
    c.pubs.filter((p) => p[0] === c.NR.pieces.answer).length === 0 && disk2[c.NR.resume.store_key] === null && c.logs.filter((l) => l[1] === c.NR.resume.words.old).length === 1);

  // 깨진 답(모르는 칸)은 같은 검사에서 걸려 버림
  const disk3 = { [b.NR.resume.store_key]: { saved_at: 1000, dest: { name: 'x' }, answer: { ...ANSWER, extra: 1 } } };
  const d = rig(t, disk3, { now: 2000 });
  createRouteClient({ ...d, naviroute });
  d.state.fire(d.NR.app_piece, { stage: d.HC.stages.good });
  await tick();
  t.check('⑥', '깨진 답(모르는 칸) — 같은 검사에 걸려 내지 않고 비움 · 경고 로그', '답 0 · 비움 · 경고 1', '답 ' + d.pubs.filter((p) => p[0] === d.NR.pieces.answer).length + ' · ' + JSON.stringify(disk3[d.NR.resume.store_key]) + ' · 경고 ' + d.logs.filter((l) => l[0] === 'warn' && l[1] === d.NR.resume.words.bad).length,
    d.pubs.filter((p) => p[0] === d.NR.pieces.answer).length === 0 && disk3[d.NR.resume.store_key] === null && d.logs.filter((l) => l[0] === 'warn' && l[1] === d.NR.resume.words.bad).length === 1);

  // 끔
  const disk4 = { [b.NR.resume.store_key]: { saved_at: 1000, dest: { name: 'x' }, answer: ANSWER } };
  const e = rig(t, disk4, { now: 2000, over: { on: false } });
  createRouteClient({ ...e, naviroute });
  e.state.fire(e.NR.app_piece, { stage: e.HC.stages.good });
  await tick();
  e.state.fire(e.NR.pieces.route_request, { seq: 1, from: [37.0, 127.0], to: [37.02, 127.02], name: '새곳' });
  await tick();
  t.check('⑦', '끔(resume.on 거짓) — 되살리지 않고 새 답도 남기지 않음', '답 1(새 답만, seq 1) · 남긴 것 그대로 x', '답 ' + e.pubs.filter((p) => p[0] === e.NR.pieces.answer).map((p) => p[1].seq).join(',') + ' · 남긴 것 ' + disk4[e.NR.resume.store_key].dest.name,
    e.pubs.filter((p) => p[0] === e.NR.pieces.answer).length === 1 && e.pubs.find((p) => p[0] === e.NR.pieces.answer)[1].seq === 1 && disk4[e.NR.resume.store_key].dest.name === 'x');
}
