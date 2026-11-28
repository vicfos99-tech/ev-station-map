// 단위 시험: 나들목 인근 충전소(추가4) — 자료 검사(ramps.check)·붙이기(ramps.attach)·목록 셈(planinput.planOf 의 켜기·끄기·자료 상태)·옛 엔진과 같은 셈.
// 다리·창 없이 순수 모듈만. 자료는 S1 장면의 휴게소 충전소 + 지어낸 나들목 인근 충전소 둘(이름 앞 [시험]).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

export default async function (t) {
  const require = createRequire(import.meta.url);
  const R = t.cfg('config_relay_ramps');
  const PI = t.cfg('config_planinput');
  const EC = t.cfg('config_engine');
  const LC = t.cfg('config_locate');
  const RR = t.cfg('config_relay_read');
  const UM = t.cfg('config_ui_my');
  const ramps = await t.src('ramps');
  const E = await t.src('engine');
  const PIm = await t.src('planinput');
  const M = await t.src('mine');
  const geo = await t.src('geo');
  const ahead = await t.src('ahead');
  const locate = await t.src('locate');
  const relayRead = await t.src('relay_read');
  const relayFresh = await t.src('relay_fresh');
  const timefmt = await t.src('timefmt');
  const OE = require(path.join(t.app, '..', 'web', 'engine.js'));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // ---------- ① 자료 검사 ----------
  const rowOk = { id: 'r1', name: '[시험] 나들목 하나', km: 30.4, dir: 'both', rest_station: null, nearby: [{ id: 'nb-1', detour_km: 3.2, at: '20261101000000' }, { id: 'nb-2', detour_km: 5 }] };
  const file = (ramps_) => ({ v: 1, line: 'gyeongbu_down', at: '20261129010000', ramps: ramps_ });
  const bads = [
    ['빈 id', { ...rowOk, id: '' }],
    ['이름 없음', { ...rowOk, name: undefined }],
    ['방향 낱말 틀림', { ...rowOk, dir: 'up' }],
    ['km 음수', { ...rowOk, km: -1 }],
    ['km 한도 넘음', { ...rowOk, km: 99999 }],
    ['km 글자', { ...rowOk, km: '30' }],
    ['왕복 0', { ...rowOk, nearby: [{ id: 'nb-1', detour_km: 0 }] }],
    ['왕복 한도 넘음', { ...rowOk, nearby: [{ id: 'nb-1', detour_km: 999 }] }],
    ['인근 비어 있음', { ...rowOk, nearby: [] }],
    ['인근 충전소 id 없음', { ...rowOk, nearby: [{ detour_km: 3 }] }],
    ['휴게소 id 가 숫자', { ...rowOk, km: null, rest_station: 5 }],
    ['줄이 객체 아님', 'x'],
  ];
  const got = ramps.check(file([rowOk, ...bads.map((b) => b[1]), { ...rowOk, id: 'r2', km: null, rest_station: 'HD1' }]), 'gyeongbu_down', R);
  t.check('①-1', '검사 — 맞는 줄 둘(나들목 항목·휴게소에 붙는 줄)만 남고 틀린 줄 ' + bads.length + '개(빈 id·이름 없음·방향·km 음수/한도/글자·왕복 0/한도·인근 없음·충전소 id 없음·휴게소 id 타입·줄 타입)는 까닭과 함께 버림',
    '좋음 2 · 나쁨 ' + bads.length, '좋음 ' + got.good.length + ' · 나쁨 ' + got.bad.length + ' (' + got.bad.slice(0, 3).map((b) => b.i + ':' + b.why).join(',') + ')',
    got.good.length === 2 && got.bad.length === bads.length && got.bad.every((b) => typeof b.why === 'string' && b.why.length > 0)
      && got.good[0].nearby[0].at === '20261101000000' && got.good[0].nearby[1].at === null && got.good[1].rest === 'HD1' && got.good[1].km === null);
  const throws = (fn) => { try { fn(); return false; } catch (e) { return e instanceof TypeError; } };
  const fileBad = [
    throws(() => ramps.check(null, 'gyeongbu_down', R)),
    throws(() => ramps.check({ ...file([]), v: 2 }, 'gyeongbu_down', R)),
    throws(() => ramps.check({ ...file([]), line: 'other' }, 'gyeongbu_down', R)),
    throws(() => ramps.check({ v: 1, line: 'gyeongbu_down', ramps: 'x' }, 'gyeongbu_down', R)),
    throws(() => ramps.check(file(new Array(R.limits.max_ramps + 1).fill(rowOk)), 'gyeongbu_down', R)),
  ];
  t.check('①-2', '검사 — 파일 꼴이 틀리면 던짐: 객체 아님·판 번호 틀림·선 이름 다름·줄 목록 아님·줄 수 한도 넘음', '다섯 모두 던짐', fileBad.map((x) => (x ? '던짐' : '안 던짐')).join(' · '), fileBad.every(Boolean));

  // ---------- ② 붙이기 ----------
  const mk = (id, ids) => ({ id, name: id, km: 0, stations: ids.map((i) => ({ id: i })), nearby: [] });
  const areas = [{ ...mk('A', ['a1']), km: 10 }, { ...mk('B', ['b1', 'b2']), km: 20 }];
  const stOf = (id, at) => (id === 'missing' ? null : { id, at });
  const X = { dir: 'forward', ic_kind: 'ic', along: (km) => km, station: stOf };
  const list = [
    { id: 'i1', name: 'IC 15', km: 15, dir: 'both', rest: null, nearby: [{ id: 'n1', detour: 1 }, { id: 'n1', detour: 2 }, { id: 'missing', detour: 3 }, { id: 'b1', detour: 4 }] },
    { id: 'i2', name: 'IC 25 반대만', km: 25, dir: 'backward', rest: null, nearby: [{ id: 'n2', detour: 1 }] },
    { id: 'i3', name: 'IC 지남', km: -2, dir: 'both', rest: null, nearby: [{ id: 'n3', detour: 1 }] },
    { id: 'i4', name: 'IC 5 앞', km: 5, dir: 'forward', rest: null, nearby: [{ id: 'n4', detour: 1.5 }] },
    { id: 'r1', name: '휴게소 아래', km: null, dir: 'both', rest: 'b2', nearby: [{ id: 'n5', detour: 7 }, { id: 'a1', detour: 2 }] },
    { id: 'r2', name: '없는 휴게소 아래', km: null, dir: 'both', rest: 'zzz', nearby: [{ id: 'n6', detour: 1 }] },
    { id: 'i5', name: '전부 없는 충전소', km: 30, dir: 'both', rest: null, nearby: [{ id: 'missing', detour: 1 }] },
  ];
  const at = ramps.attach(areas, list, X, R);
  const brief = at.areas.map((a) => a.id + '@' + a.km + '[' + a.stations.length + '|' + a.nearby.map((n) => n.station.id + ':' + n.detour).join(',') + ']').join(' ');
  const wantBrief = 'i4@5[0|n4:1.5] A@10[1|] i1@15[0|n1:1] B@20[2|n5:7]';
  t.check('②-1', '붙이기 — km 차례에 나들목 항목(i4·i1)이 끼고, 휴게소 아래(B)에 인근(n5)이 붙음. 뺀 것: 반대 방향만(i2)·이미 지난(i3)·휴게소 충전소로 이미 든 것(b1·a1)·같은 충전소 겹침(n1 둘째)·목록에 없는 충전소(missing)·없는 휴게소 줄(r2)·붙일 게 없는 항목(i5)',
    wantBrief + ' · 붙은 3', brief + ' · 붙은 ' + at.shown, brief === wantBrief && at.shown === 3);
  const back = ramps.attach(areas, list, { ...X, dir: 'backward', along: (km) => 40 - km }, R);
  const briefB = back.areas.map((a) => a.id).join(',');
  t.check('②-2', '붙이기 — 거꾸로 가면(선 길이 40 − km) 반대 방향 줄(i2)이 들고, 앞 방향 줄은 빠짐', 'km 차례 · i2 있음 · i4 없음', briefB,
    back.areas.some((a) => a.id === 'i2') && !back.areas.some((a) => a.id === 'i4') && back.areas.every((a, i, arr) => i === 0 || a.km >= arr[i - 1].km));
  t.check('②-3', '붙이기 — 받은 휴게소 목록은 바꾸지 않음(사본에 붙임)', '원래 nearby 0 · 0', areas[0].nearby.length + ' · ' + areas[1].nearby.length, areas[0].nearby.length === 0 && areas[1].nearby.length === 0);

  // ---------- ③ 목록 셈(planOf) — S1 장면 + 지어낸 나들목 인근 ----------
  const dir = path.join(t.app, t.tc.testbed.dir, 'scenes');
  const scene = JSON.parse(fs.readFileSync(path.join(dir, 'S1_고속도로.json'), 'utf8'));
  const lineFile = JSON.parse(fs.readFileSync(path.join(dir, 'lines', scene.route.legs[0].line + '.json'), 'utf8'));
  const TA = t.tc.try_a7;
  const stations0 = [];
  for (const sx of scene.stations) for (const op of sx.operators) stations0.push({ id: op.station_id, name: op.name, operator: op.operator, lat: op.loc[0], lng: op.loc[1], rest: op.rest === true, indoor: false, chargers: op.chargers.map((c) => ({ id: c.id, type: c.type, kw: c.kw })), zscode: op.zscode, zcodes: op.zcodes });
  const nbs = [
    { id: 'nb-1', name: '[시험] 인근 하나', operator: '채비', lat: 37.3, lng: 127.0, rest: false, indoor: false, chargers: [{ id: '01', type: 'fast', kw: 100 }, { id: '02', type: 'fast', kw: 100 }], zscode: '41460', zcodes: ['41'] },
    { id: 'nb-2', name: '[시험] 인근 둘', operator: '기후에너지환경부', lat: 37.2, lng: 127.1, rest: false, indoor: false, chargers: [{ id: '01', type: 'fast', kw: 50 }], zscode: '41460', zcodes: ['41'] },
  ];
  const stations = { list: [...stations0, ...nbs], lines: [{ name: lineFile.name, highway: lineFile.highway || null, direction: lineFile.direction || null, points: lineFile.points }] };
  const zones = {};
  for (const sx of scene.stations) for (const op of sx.operators) {
    const z = (zones[op.zscode] = zones[op.zscode] || { at: TA.status_at, s: {} });
    z.s[op.station_id] = {};
    for (const c of op.chargers) z.s[op.station_id][c.id] = Object.keys(RR.stat_state).find((k) => RR.stat_state[k] === TA.scene_state[c.status]) || null;
  }
  const zn = (zones['41460'] = zones['41460'] || { at: TA.status_at, s: {} });
  zn.s['nb-1'] = { '01': 'free', '02': 'free' };
  zn.s['nb-2'] = { '01': 'busy' };
  const relay = { zones };
  const lib = {
    parts: { engine: E, mine: M, geo, ahead, relay_read: relayRead, relay_fresh: relayFresh, timefmt, locate, ramps },
    rules: { config_engine: EC, config_mine: t.cfg('config_mine'), config_ahead: t.cfg('config_ahead'), config_locate: LC, config_geo: t.cfg('config_geo'), config_relay_read: RR, config_relay_fresh: t.cfg('config_relay_fresh'), config_time: t.cfg('config_time'), config_planinput: PI, config_relay_ramps: R },
  };
  const now = relayFresh.kstMs(TA.status_at, t.cfg('config_relay_fresh'), t.cfg('config_time'), timefmt) + 600000;
  const ramp = ramps.check({ v: 1, line: lineFile.name, at: '20261129010000', ramps: [
    { id: 'ic-s', name: '[시험] 수원신갈 나들목', km: 30.4, dir: 'both', rest_station: null, nearby: [{ id: 'nb-1', detour_km: 3.2, at: '20261101000000' }] },
    { id: 'r-g', name: '[시험] 기흥 아래', km: null, dir: 'both', rest_station: 'ME178003', nearby: [{ id: 'nb-2', detour_km: 5 }] },
  ] }, lineFile.name, R).good;
  const fix = { t: now, lat: 0, lng: 0 };
  const posOn = { on_line: true, line: lineFile.name, km: 28, dir: LC.dir_words.forward };
  const mine0 = UM.defaults;
  const plan = (my, rampsIn) => PIm.planOf({ 'plan.request': { open: true, soc: 60, seq: 1, at: now }, my, stations, relay, fix, ramps: rampsIn }, { pos: posOn }, PI, lib, null);
  const okState = { state: R.states.ok, lines: { [lineFile.name]: ramp }, at: now };
  const off = plan({ ...mine0, ic_near: false }, okState);
  const on = plan({ ...mine0, ic_near: true }, okState);
  const entries = (p) => p.result.route_list.entries;
  const near = (p) => entries(p).reduce((n, e) => n + e.nearby.length, 0);
  t.check('③-1', '꺼짐(처음 값 ic_near=' + UM.defaults.ic_near + ') — 자료가 와 있어도 휴게소만(나들목 항목 0·인근 0), ic.on 거짓', '항목 휴게소만 · 인근 0 · on 거짓', entries(off).map((e) => e.name).join(',') + ' · 인근 ' + near(off) + ' · on ' + off.ic.on,
    UM.defaults.ic_near === false && near(off) === 0 && entries(off).every((e) => e.stations.length > 0) && off.ic.on === false);
  const icE = entries(on).filter((e) => e.stations.length === 0);
  const gi = entries(on).find((e) => e.nearby.length && e.stations.length);
  t.check('③-2', '켜짐 + 자료 좋음 — 나들목 항목 1(수원신갈 나들목, 인근 nb-1) · 기흥휴게소 아래 인근 nb-2 · 붙은 수 2 · 상태 ok · 항목이 km 차례', '나들목 1 · nb-1 · 기흥 아래 nb-2 · 2 · ok · 차례',
    '나들목 ' + icE.length + ' · ' + (icE[0] ? icE[0].nearby.map((n) => n.station_id).join() : '-') + ' · ' + (gi ? gi.name + ' 아래 ' + gi.nearby.map((n) => n.station_id).join() : '-') + ' · ' + on.ic.shown + ' · ' + on.ic.state + ' · ' + entries(on).map((e) => Math.round(e.distance_km)).join('<'),
    icE.length === 1 && icE[0].nearby[0].station_id === 'nb-1' && !!gi && gi.nearby[0].station_id === 'nb-2' && on.ic.shown === 2 && on.ic.state === R.states.ok
      && entries(on).every((e, i, a) => i === 0 || e.distance_km >= a[i - 1].distance_km));
  t.check('③-3', '켜짐 — 인근 충전소의 이름·상태·날짜가 따라옴: names·unknown·at·ramp_at(날짜 있는 nb-1 만)·labels', 'names nb-1 · ramp_at nb-1 만 · 업체 라벨', JSON.stringify({ n: on.names['nb-1'], ra: Object.keys(on.ramp_at), l: Object.keys(on.labels).includes('채비') }),
    on.names['nb-1'] === '[시험] 인근 하나' && same(Object.keys(on.ramp_at), ['nb-1']) && Object.keys(on.labels).includes('채비'));
  const pr = on.result.recommendation;
  t.check('③-4', '켜짐 — 추천 후보에 인근이 들어감(엔진이 왕복 거리를 더함): 인근 충전소 후보가 있고 is_nearby·detour_km 가 자료 값', '인근 후보 ≥ 1 · nb-1 왕복 3.2', '후보 ' + entries(on).flatMap((e) => e.nearby).length + ' · nb-1 왕복 ' + (entries(on).flatMap((e) => e.nearby).find((n) => n.station_id === 'nb-1') || {}).detour_km + ' · 추천 ' + pr.status,
    entries(on).flatMap((e) => e.nearby).some((n) => n.station_id === 'nb-1' && n.is_nearby === true && n.detour_km === 3.2) && pr.status === EC.reco.ok);
  const stOf2 = (my, r) => { const p = plan(my, r); return p.ic.state + '/' + p.ic.shown + '/' + near(p); };
  const states = [
    stOf2({ ...mine0, ic_near: true }, undefined),
    stOf2({ ...mine0, ic_near: true }, { state: R.states.none, lines: {}, at: now }),
    stOf2({ ...mine0, ic_near: true }, { state: R.states.down, lines: {}, at: now }),
    stOf2({ ...mine0, ic_near: true }, { state: R.states.ok, lines: { other: ramp }, at: now }),
    stOf2({ ...mine0, ic_near: true }, { state: R.states.ok, lines: { [lineFile.name]: [] }, at: now }),
  ];
  const wantStates = [R.states.wait + '/0/0', R.states.none + '/0/0', R.states.down + '/0/0', R.states.none + '/0/0', R.states.ok + '/0/0'];
  t.check('③-5', '켜짐인데 자료가 없을 때 — 아직 안 옴(wait)·없음(none)·끊김(down)·이 선 줄 없음(none)은 상태만 알리고 인근 0(짐작해 채우지 않음), 이 선 줄이 비면 ok·붙은 0', wantStates.join(' · '), states.join(' · '), same(states, wantStates));
  const pOff = plan({ ...mine0, ic_near: false }, undefined);
  t.check('③-6', '꺼짐이고 자료 조각이 아예 없어도 목록이 셈됨(ok) — 처음 켤 때·다른 제목', 'ok · on 거짓', pOff.state + ' · ' + pOff.ic.on, pOff.state === PI.states.ok && pOff.ic.on === false);

  // ---------- ④ 옛 엔진과 같은 셈 ----------
  // 같은 입력(나들목 인근이 붙은 노선)을 옛 web/engine.js 와 새 engine.js 에 넣어 결과가 통째로 같은지
  const made = PIm.inputs(PIm.routeFromRelay({ stations, relay, line: lineFile.name, dir: LC.dir_words.forward, ramps: ramp }, PI, lib).route, { ...mine0, ic_near: true }, 60, M.normalize({}), now, PI, EC, lib);
  const plain = (x) => JSON.parse(JSON.stringify(x));
  const A = plain(made);
  const a = OE.plan(A.route, A.vehicle, A.user, now, 0, mine0.stale);
  const b = E.plan(A.route, A.vehicle, A.user, now, 0, mine0.stale, EC);
  t.check('④', '옛 앱 web/engine.js 와 새 engine.js — 나들목 인근이 붙은 같은 입력에 목록·점수·추천·알림 글까지 통째로 같음(인근 후보 ' + b.route_list.entries.flatMap((e) => e.nearby).length + ')', '같음', same(a, b) ? '같음' : '다름', same(a, b) && b.route_list.entries.flatMap((e) => e.nearby).length >= 2);
}
