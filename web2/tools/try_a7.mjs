// A7 스스로 시험(옛 기능 옮기기 — 목록·추천, 내 차·할인).
//   node web2/tools/try_a7.mjs pure      # ① 옛·새·파이썬 계산 대조 + 순수 모듈(다리 없음)
//   node web2/tools/try_a7.mjs app       # ② S1 가상 창: 목록·추천 · 내 차·할인 저장·다시 열기 · 빈 값·이상한 값
//   node web2/tools/try_a7.mjs s12       # ③ S12 1시간(다리 배속) — 메모리·한 틱 처리 시간 처음·끝
//   node web2/tools/try_a7.mjs chrome    # ④ 진짜 크롬 네 창: 목록·내 차 칸을 열어 덮임·잘림·누르는 높이
//   node web2/tools/try_a7.mjs shots     # ⑤ 옛·새 화면 나란히 그림(옛 web/ 그대로 · 새 앱 S1)
// 표로 찍고 하나라도 실패면 0 아닌 코드. 기록장 tools/logs/try_a7.log, 표 사본 tools/logs/try_a7_last_<부분>.md.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { loadToolsConfig, appDir, toolLog, kstText, TOOLS_DIR } from './lib_tools.mjs';
import { testbedInfo, makeSecret, writeSecretFile, startBridge, selectScene, seekScene, fetchWithLines, linesShim } from './lib_testbed.mjs';
import { sleep, loadBoards, startApp as runApp, waitFor } from './lib_apprun.mjs';
import { measureInChrome, overlapArea, inside, findChrome } from './lib_chrome.mjs';

const tc = loadToolsConfig();
const T = tc.try_a7;
const L = tc.layout;
const APP = appDir(tc);
const log = toolLog(tc, 'try_a7');
const require = createRequire(import.meta.url);
const cfgOf = (name) => JSON.parse(fs.readFileSync(path.join(APP, tc.build.config_dir, name + tc.build.config_ext), 'utf8'));
const srcOf = async (name) => import(pathToFileURL(path.join(APP, tc.build.src_dir, name + '.js')).href);
const OLD = path.resolve(APP, T.old_dir);
const EC = cfgOf('config_engine');
const PI = cfgOf('config_planinput');
const MC = cfgOf('config_mine');
const AH = cfgOf('config_ahead');
const LC = cfgOf('config_locate');
const G = cfgOf('config_geo');
const RR = cfgOf('config_relay_read');
const RF = cfgOf('config_relay_fresh');
const TM = cfgOf('config_time');
const FC = cfgOf('config_formcheck');
const UR = cfgOf('config_ui_route');
const UM = cfgOf('config_ui_my');

const rows = [];
function row(no, title, expect, actual, ok) {
  rows.push({ no, title, expect, actual, ok: !!ok });
  log.write(ok ? '통과' : '실패', { no, title, expect, actual });
}
const wait = (fn, ms) => waitFor(fn, ms, tc.testbed.poll_ms);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 옛 앱(web/app.js)의 inputs()·applyMine 을 글 그대로 떼어 와 돌린다(옛 계산 그대로 — 고치지 않음). 줄 범위는 설정(T.old_inputs)
function oldInputsFn() {
  const lines = fs.readFileSync(path.join(OLD, T.old_app), 'utf8').split('\n');
  const take = (a, b) => lines.slice(a - 1, b).join('\n');
  const src = T.old_inputs.ranges.map(([a, b]) => take(a, b)).join('\n');
  // eslint-disable-next-line no-new-func
  return new Function('DATA', 'state', 'MINE', 'CUR', 'localStorage', T.old_inputs.prefix + '\n' + src + '\n' + T.old_inputs.suffix);
}

function myToOldState(my, soc) {
  return { soc, battery: my.battery, eff: my.eff, margin: my.margin, minArrival: my.min_arrival, stale: my.stale, height: my.height,
    subOp: my.sub_op, subRate: my.sub_rate, subPrivate: my.sub_private, cardName: my.card_name, cardRate: my.card_rate };
}

function runPython(cases) {
  const r = spawnSync(tc.testbed.python, [...tc.testbed.python_args, path.join(TOOLS_DIR, T.py_helper)], {
    input: JSON.stringify({ src: path.resolve(APP, T.py_src), cases }), encoding: 'utf8', maxBuffer: T.py_max_buffer,
  });
  if (r.status !== 0) throw new Error('파이썬 실패: ' + (r.stderr || '').slice(-600));
  return JSON.parse(r.stdout).results;
}

// 파이썬 결과와 견줄 꼴(파이썬 dataclass 이름에 맞춤 — 같은 뜻의 칸만)
function keyView(res) {
  const ent = res.route_list.entries.map((e) => ({
    id: e.rest_area_id, rem: e.remaining_km, arr: e.arrival_soc_pct, reach: e.reachable, uf: e.usable_fast, wf: e.waiting_fast, low: e.lowest_price,
    alerts: e.alerts.map((a) => a.code + ':' + a.message),
    st: [...e.stations, ...e.nearby].map((s) => [s.station_id, s.quote.final_price, s.quote.applied, s.is_candidate, s.role, s.status.is_stale, s.alerts.map((a) => a.code).join('|')]),
  }));
  const rec = res.recommendation;
  const p = (x) => (x ? [x.rest_area_id, x.station_id, x.score, x.final_price, x.remaining_km, x.arrival_soc_pct] : null);
  return { ent, rec: [rec.status, p(rec.primary), p(rec.backup), rec.alerts.map((a) => a.code)] };
}

// ---------- ① 순수 ----------
async function partPure() {
  const E = await srcOf('engine');
  const PIm = await srcOf('planinput');
  const M = await srcOf('mine');
  const geo = await srcOf('geo');
  const ahead = await srcOf('ahead');
  const locate = await srcOf('locate');
  const relayRead = await srcOf('relay_read');
  const relayFresh = await srcOf('relay_fresh');
  const timefmt = await srcOf('timefmt');
  const fc = await srcOf('formcheck');
  const OE = require(path.join(OLD, T.old_engine));
  const LIVE = require(path.join(OLD, T.old_live));
  const now = LIVE.fetched_at + T.now_after_ms;
  const my0 = UM.defaults;
  // ①-1 엔진: 옛 web/engine.js 와 새 engine.js — 옛 실제 자료 노선 전부 × 배터리·자리·할인 경우
  const cases = [];
  for (const route of LIVE.routes) {
    for (const k of T.engine_cases) {
      const r = { highway: route.highway, direction: route.direction, rest_areas: route.rest_areas.map((a) => ({ id: a.id, name: a.name, distance_km: a.km,
        stations: a.stations.map((s) => ({ id: s.id, operator: s.operator, chargers: s.chargers.map((c) => ({ type: c.type, power_kw: c.power_kw, status: c.status })), price_per_kwh: s.price, status_updated_at: s.updated })),
        nearby: (a.nearby || []).slice(0, PI.nearby_show).map((n) => ({ station: { id: n.station.id, operator: n.station.operator, chargers: n.station.chargers.map((c) => ({ type: c.type, power_kw: c.power_kw, status: c.status })), price_per_kwh: n.station.price, status_updated_at: n.station.updated }, detour_km: n.detour })) })) };
      const vehicle = { soc_pct: k.soc, battery_kwh: k.battery, efficiency_km_per_kwh: k.eff, safety_margin_ratio: k.margin, min_arrival_soc_pct: k.min_arrival };
      const user = { subscription: k.sub ? { operator: k.sub, rate: k.sub_rate, excluded_rest_area_ids: [] } : null, cards: k.card ? [{ name: k.card, rate: k.card_rate, operators: null }] : [] };
      cases.push({ route: r, vehicle, user, now, position_km: k.pos, stale_minutes: k.stale, key: route.key + '/' + k.name });
    }
  }
  let eq = 0;
  const diff = [];
  const newRes = [];
  for (const c of cases) {
    const a = OE.plan(c.route, c.vehicle, c.user, c.now, c.position_km, c.stale_minutes);
    const b = E.plan(c.route, c.vehicle, c.user, c.now, c.position_km, c.stale_minutes, EC);
    newRes.push(b);
    if (same(a, b)) eq += 1; else if (diff.length < 3) diff.push(c.key);
  }
  const prim = new Set(newRes.map((x) => (x.recommendation.primary ? 'p' : 'none')));
  row('①-1', '엔진 — 옛 앱 web/engine.js 와 새 engine.js 가 같은 입력에 같은 결과(목록·점수·추천·알림 글까지 JSON 통째로). 옛 실제 자료 ' + LIVE.routes.length + '개 노선 × ' + T.engine_cases.length + '경우(배터리·자리·구독·카드·오래됨)',
    cases.length + '/' + cases.length + ' 같음', eq + '/' + cases.length + ' 같음' + (diff.length ? ' (다름: ' + diff.join(', ') + ')' : '') + ' · 추천 있음/없음 둘 다 나옴: ' + (prim.size === 2 ? '예' : '아니오'),
    eq === cases.length && prim.size === 2);
  // ①-2 파이썬 엔진과 같은가(같은 입력 — 노선마다 첫 경우)
  const pyCases = cases.filter((c, i) => i % T.py_every === 0);
  let pyEq = 0;
  const pyDiff = [];
  try {
    const py = runPython(pyCases.map(({ key, ...c }) => c));
    pyCases.forEach((c, i) => {
      const b = E.plan(c.route, c.vehicle, c.user, c.now, c.position_km, c.stale_minutes, EC);
      if (same(keyView(b), keyView(py[i]))) pyEq += 1; else if (pyDiff.length < 2) pyDiff.push(c.key + ' ' + JSON.stringify(keyView(b).rec) + ' / ' + JSON.stringify(keyView(py[i]).rec));
    });
  } catch (e) { pyDiff.push(e.message); }
  row('①-2', '엔진 — 파이썬 엔진(src/ev_charge_planner, 잠긴 테스트 p1~p7 의 정답)과 같은 결과(휴게소마다 남은 거리·도착 %·빈 급속·최저 요금·알림 글, 충전소마다 할인 값·후보·역할, 추천 1순위·예비·점수)',
    pyCases.length + '/' + pyCases.length + ' 같음', pyEq + '/' + pyCases.length + ' 같음' + (pyDiff.length ? ' (다름: ' + pyDiff.join(' | ') + ')' : ''), pyEq === pyCases.length);
  // ①-3 엔진 입력 만들기: 옛 inputs() 그대로 vs 새 planinput.inputs — 내 차·할인·내 값(업체 요금·충전소 요금·상태·높이) 경우마다
  const lib = { parts: { engine: E, mine: M, geo, ahead, relay_read: relayRead, relay_fresh: relayFresh, timefmt, locate }, rules: { config_engine: EC, config_mine: MC, config_ahead: AH, config_locate: LC, config_geo: G, config_relay_read: RR, config_relay_fresh: RF, config_time: TM, config_planinput: PI } };
  const oldFn = oldInputsFn();
  let inEq = 0;
  let inN = 0;
  const inDiff = [];
  for (const route of LIVE.routes) {
    for (const k of T.input_cases) {
      inN += 1;
      const my = { ...my0, ...k.my };
      const mine = k.mine === 'sample' ? sampleMine(route, now) : { ops: {}, stations: {} };
      const DATA = { LIVE, toRoute: OLDDATA().toRoute };
      const old = oldFn(DATA, myToOldState(my, k.soc), mine, route, { getItem: () => JSON.stringify(mine) });
      const o = old.inputs();
      o.now = now;
      const raw = { ...route, live_at: route.live && LIVE ? LIVE.fetched_at : 0 };
      const n = PIm.inputs(raw, my, k.soc, M.normalize(mine), now, PI, EC, lib);
      const plain = (x) => JSON.parse(JSON.stringify({ route: x.route, vehicle: x.vehicle, user: x.user }));
      // 옛 toRoute 는 충전기 칸(마지막 충전 시각 등)을 그대로 두므로 엔진이 쓰는 칸만 견줌
      const strip = (x) => { for (const a of x.route.rest_areas) for (const s of [...a.stations, ...a.nearby.map((nn) => nn.station)]) s.chargers = s.chargers.map((c) => ({ type: c.type, power_kw: c.power_kw, status: c.status })); return x; };
      const A = strip(plain(o));
      const B = strip(plain(n));
      const pa = OE.plan(A.route, A.vehicle, A.user, now, k.pos, my.stale);
      const pb = E.plan(B.route, B.vehicle, B.user, now, k.pos, my.stale, EC);
      const ok = same(A, B) && same(pa, pb) && same([...old.blocked()].sort(), [...n.blocked].sort()) && old.hidden() === n.hidden_indoor;
      if (ok) inEq += 1; else if (inDiff.length < 3) inDiff.push(route.key + '/' + k.name);
    }
  }
  row('①-3', '엔진 입력 만들기 — 옛 앱 app.js 의 inputs()·applyMine 을 글 그대로 떼어 돌린 것과 새 planinput.inputs 가 같은 엔진 입력·같은 추천(나들목 인근 3곳·내 업체 요금·충전소 요금·내가 확인한 상태·높이 제한·건물 안 숨김·민자 구독 제외). ' + LIVE.routes.length + '개 노선 × ' + T.input_cases.length + '경우',
    inN + '/' + inN + ' 같음', inEq + '/' + inN + ' 같음' + (inDiff.length ? ' (다름: ' + inDiff.join(', ') + ')' : ''), inEq === inN);
  // ①-4 중계 자료 → 노선 꼴(S1 장면): 휴게소 차례·km·충전기 상태
  const scene = JSON.parse(fs.readFileSync(path.join(APP, tc.testbed.dir, 'scenes', T.s1.scene + tc.build.config_ext), 'utf8'));
  const lineFile = JSON.parse(fs.readFileSync(path.join(APP, tc.testbed.dir, 'scenes', 'lines', scene.route.legs[0].line + tc.build.config_ext), 'utf8'));
  const list = [];
  for (const sx of scene.stations) for (const op of sx.operators) list.push({ id: op.station_id, name: op.name, operator: op.operator, lat: op.loc[0], lng: op.loc[1], rest: op.rest === true, indoor: false, chargers: op.chargers.map((c) => ({ id: c.id, type: c.type, kw: c.kw })), zscode: op.zscode, zcodes: op.zcodes });
  const stations = { list, lines: [{ name: lineFile.name, highway: lineFile.highway || null, direction: lineFile.direction || null, points: lineFile.points }] };
  const statMap = {};
  for (const sx of scene.stations) for (const op of sx.operators) {
    const z = (statMap[op.zscode] = statMap[op.zscode] || { at: T.status_at, s: {} });
    z.s[op.station_id] = {};
    for (const c of op.chargers) z.s[op.station_id][c.id] = Object.keys(RR.stat_state).find((k) => RR.stat_state[k] === T.scene_state[c.status]) || null;
  }
  const relay = { zones: statMap };
  const got = PIm.routeFromRelay({ stations, relay, line: lineFile.name, dir: LC.dir_words.forward }, PI, lib);
  const sceneRest = scene.stations.filter((s) => s.kind === 'rest' && T.s1.forward_words.some((w) => s.direction.includes(w))).sort((a, b) => a.km - b.km);
  const kmOk = got.route.rest_areas.length === sceneRest.length && got.route.rest_areas.every((a, i) => Math.abs(a.km - sceneRest[i].km) <= T.s1.km_tol);
  const sceneAvail = sceneRest.map((s) => s.operators.reduce((n, op) => n + op.chargers.filter((c) => c.type === 'fast' && c.status === 'available').length, 0));
  const appAvail = got.route.rest_areas.map((a) => a.stations.reduce((n, s) => n + s.chargers.filter((c) => c.type === EC.charger_type.fast && c.status === EC.status.available).length, 0));
  row('①-4', 'S1 중계 자료(목록·선·충전기 상태) → 노선 꼴: 부산 방향 휴게소만, 장면 km 차례로(±' + T.s1.km_tol + ' km), 휴게소마다 빈 급속 수가 장면과 같음',
    sceneRest.map((s) => s.name + ' ' + s.km).join(' · ') + ' / 빈 급속 ' + sceneAvail.join(','),
    got.route.rest_areas.map((a) => a.name + ' ' + a.km.toFixed(1)).join(' · ') + ' / 빈 급속 ' + appAvail.join(','), kmOk && same(sceneAvail, appAvail));
  // ①-5 상태 모름: 상태 파일이 없으면 모든 충전기 '모름' → 빈자리로 세지 않음 → 추천 없음 + 모름 수
  const gotNone = PIm.routeFromRelay({ stations, relay: null, line: lineFile.name, dir: LC.dir_words.forward }, PI, lib);
  const allUnknown = Object.values(gotNone.unknown).reduce((a, b) => a + b, 0);
  const totalCh = list.filter((s) => gotNone.route.rest_areas.some((a) => a.stations.some((x) => x.id === s.id))).reduce((n, s) => n + s.chargers.length, 0);
  const inpNone = PIm.inputs(gotNone.route, my0, T.s1.soc, M.normalize({}), now, PI, EC, lib);
  const plNone = E.plan(inpNone.route, inpNone.vehicle, inpNone.user, now, 0, my0.stale, EC);
  row('①-5', '상태를 모름(상태 파일 없음) — 모든 충전기를 모름으로 세고 빈자리로 치지 않음 → 추천 없음(아는 척 추천하지 않음)', '모름 ' + totalCh + '대 · 알고 있음 0 · 추천 ' + EC.reco.none,
    '모름 ' + allUnknown + '대 · 알고 있음 ' + gotNone.known + ' · 추천 ' + plNone.recommendation.status, allUnknown === totalCh && gotNone.known === 0 && plNone.recommendation.status === EC.reco.none);
  // ①-6 거꾸로 방향(서울 방향): 휴게소 이름의 방향 낱말로 서울 방향 곳만, 노선 첫머리부터 거리 = 선 길이 − km
  const s3 = sceneData(T.s3_scene);
  const gotBack = PIm.routeFromRelay({ stations: s3.stations, relay: s3.relay, line: s3.line.name, dir: LC.dir_words.backward }, PI, lib);
  const backRest = s3.scene.stations.filter((s) => s.kind === 'rest' && T.s1.backward_words.some((w) => s.direction.includes(w)));
  row('①-6', '반대 방향(S3 장면) — 서울 방향 휴게소만(장면 ' + backRest.length + '곳), 거리 = 선 길이 − km(가까운 차례), 방향 글 "' + AH.line_dir_words[lineFile.name].backward[0] + PI.dir_suffix + '"',
    backRest.length + '곳 · 거리 늘어남 · ' + AH.line_dir_words[lineFile.name].backward[0] + PI.dir_suffix,
    gotBack.route.rest_areas.length + '곳 · 거리 ' + gotBack.route.rest_areas.map((a) => a.km.toFixed(1)).join('/') + ' · ' + gotBack.route.direction,
    backRest.length > 0 && gotBack.route.rest_areas.length === backRest.length && gotBack.route.rest_areas.every((a, i, arr) => i === 0 || a.km >= arr[i - 1].km) && gotBack.route.direction === AH.line_dir_words[lineFile.name].backward[0] + PI.dir_suffix);
  // ①-7 planOf: 열리지 않음 → null · 내 차 없음 → need_my · 배터리 범위 밖 → bad_soc · 선 밖 → off_line · 정상 → ok(1순위)
  const fix = { t: now, lat: 0, lng: 0 };
  const posOn = { on_line: true, line: lineFile.name, km: T.s1.pos_km, dir: LC.dir_words.forward };
  const base = { 'plan.request': { open: true, soc: T.s1.soc, seq: 1, at: now }, my: my0, stations, relay, fix };
  const st = (inp, done) => { const x = PIm.planOf(inp, done, PI, lib, null); return x ? x.state : 'null'; };
  const got7 = [
    st({ ...base, 'plan.request': { open: false } }, { pos: posOn }),
    st({ ...base, my: undefined }, { pos: posOn }),
    st({ ...base, 'plan.request': { open: true, soc: T.bad_soc, seq: 1, at: now } }, { pos: posOn }),
    st(base, { pos: { on_line: false, line: null, km: null } }),
    st(base, { pos: { ...posOn, dir: null } }),
    st(base, { pos: posOn }),
  ];
  const okPlan = PIm.planOf(base, { pos: posOn }, PI, lib, null);
  const want7 = ['null', PI.states.need_my, PI.states.bad_soc, PI.states.off_line, PI.states.no_dir, PI.states.ok];
  row('①-7', '목록 셈(planOf) — 닫힘 null · 내 차 값 없음 · 배터리 ' + T.bad_soc + '% · 고속도로 밖 · 방향 모름 · 정상', want7.join(' · ') + ' · 1순위 있음',
    got7.join(' · ') + ' · 1순위 ' + (okPlan && okPlan.result.recommendation.primary ? okPlan.result.recommendation.primary.rest_area_name + ' ' + okPlan.result.recommendation.primary.remaining_km.toFixed(1) + 'km' : '없음'),
    same(got7, want7) && !!(okPlan && okPlan.result.recommendation.primary));
  // ①-8 내 차·할인 칸 검사(FormCheck — 범위는 설정)
  const fr = FC.fields;
  const tries = T.form_cases.map((x) => ({ ...x, got: fc.field(x.v, fr[x.f]) }));
  row('①-8', '내 차·할인 칸 검사 — 빈 값·글자·음수·범위 밖·소수 거절, 정상 값 받음(' + tries.length + '경우)', tries.map((x) => x.f + '=' + JSON.stringify(x.v) + '→' + (x.ok ? 'ok' : 'x')).join(' '),
    tries.map((x) => x.f + '=' + JSON.stringify(x.v) + '→' + (x.got.ok ? 'ok' : x.got.why)).join(' '), tries.every((x) => x.got.ok === x.ok));
  // ①-9 업체 별명
  const mn = M.normalize({ ops: { 'SK일렉링크': { alias: 'SK' } } });
  const labels = [M.opLabel('기후에너지환경부', mn, MC), M.opLabel('SK일렉링크', mn, MC), M.opLabel('채비', mn, MC)];
  row('①-9', '업체 별명 — 기본 별명(환경부) · 내가 넣은 별명 · 별명 없음', '환경부 (기후에너지환경부) · SK (SK일렉링크) · 채비', labels.join(' · '),
    same(labels, ['환경부 (기후에너지환경부)', 'SK (SK일렉링크)', '채비']));
}

// 장면 파일 → 중계 꼴(충전소 목록·선·처음 상태)
function sceneData(name) {
  const scene = JSON.parse(fs.readFileSync(path.join(APP, tc.testbed.dir, 'scenes', name + tc.build.config_ext), 'utf8'));
  const lf = JSON.parse(fs.readFileSync(path.join(APP, tc.testbed.dir, 'scenes', 'lines', scene.route.legs[0].line + tc.build.config_ext), 'utf8'));
  const list = [];
  const zones = {};
  for (const sx of scene.stations) for (const op of sx.operators) {
    list.push({ id: op.station_id, name: op.name, operator: op.operator, lat: op.loc[0], lng: op.loc[1], rest: op.rest === true, indoor: false, chargers: op.chargers.map((c) => ({ id: c.id, type: c.type, kw: c.kw })), zscode: op.zscode, zcodes: op.zcodes });
    const z = (zones[op.zscode] = zones[op.zscode] || { at: T.status_at, s: {} });
    z.s[op.station_id] = {};
    for (const c of op.chargers) z.s[op.station_id][c.id] = Object.keys(RR.stat_state).find((k) => RR.stat_state[k] === T.scene_state[c.status]) || null;
  }
  const line = { name: lf.name, highway: lf.highway || null, direction: lf.direction || null, points: lf.points };
  return { scene, line, stations: { list, lines: [line] }, relay: { zones } };
}

let OLD_DATA = null;
function OLDDATA() {
  if (!OLD_DATA) OLD_DATA = require(path.join(OLD, T.old_data));
  return OLD_DATA;
}

// 내 값 예: 첫 휴게소 첫 충전소 요금·상태(받은 뒤 확인)·높이, 둘째 업체 요금
function sampleMine(route, now) {
  const mine = { ops: {}, stations: {} };
  const rest = route.rest_areas.filter((a) => a.stations.length);
  if (rest[0]) {
    const s = rest[0].stations[0];
    mine.stations[s.id] = { price: T.mine.price, height: T.mine.height, statuses: s.chargers.map((c, i) => (i === 0 ? T.mine.status : null)), at: now };
    mine.ops[s.operator] = { alias: T.mine.alias, price: T.mine.op_price };
  }
  const ic = route.rest_areas.find((a) => (a.nearby || []).length);
  if (ic) mine.stations[ic.nearby[0].station.id] = { height: T.mine.low_height, statuses: [], at: now };
  return mine;
}


// ---------- 다리·앱 띄우기 ----------
let INFO = null;
let SECRET = null;
let SECRET_FILE = null;
async function withBridge(seconds, scale, fn) {
  INFO = testbedInfo(tc, APP);
  SECRET = makeSecret(tc);
  const sec = writeSecretFile(tc, SECRET);
  SECRET_FILE = sec.file;
  const bridge = await startBridge(tc, INFO, seconds, SECRET, scale);
  try {
    await fn();
  } finally {
    log.write('다리 끝 기다림', {});
    let guard = null;
    const code = await Promise.race([bridge.waitExit(), new Promise((res) => { guard = setTimeout(() => res('timeout'), seconds * tc.view_s1.ms_per_s + T.exit_grace_ms); })]);
    clearTimeout(guard);
    if (code === 'timeout') bridge.proc.kill();
    row('끝', '다리가 시험 모드 시간 뒤 스스로 끝남', '종료 코드 0', String(code), code === 0);
    fs.rmSync(sec.dir, { recursive: true, force: true });
  }
}
let MAIN = null;
let BOARDS = null;
async function start(opts) {
  if (!MAIN) {
    MAIN = (await srcOf('app')).main;
    BOARDS = await loadBoards(APP, tc);
  }
  return runApp({ app: APP, tc, main: MAIN, boards: BOARDS }, { secretFile: SECRET_FILE, ...(opts || {}), fetchFn: fetchWithLines(tc, INFO, SECRET, fetch), stamp: 'try-a7' });
}
const HC = cfgOf('config_health');
const UA = cfgOf('config_ui_ahead');
const SPD = cfgOf('config_ui_speed');
async function openAt(scene, tick, opts) {
  await selectScene(INFO, scene, false);
  if (tick) await seekScene(INFO, tick);
  const a = await start(opts);
  await wait(() => a.stage() === HC.stages.good, T.start_wait_ms);
  await wait(() => !!a.get('ahead') && a.el(UA.ids.list).children.length > 0 && !!a.get('my'), T.start_wait_ms);
  return a;
}
const RI = UR.ids;
const MI = UM.ids;
const texts = (el) => (el ? [el.textContent || '', ...el.children.map(texts)].join(' ') : '');
const drive = (a) => ({ speed: a.el(SPD.ids.value).textContent, rows: a.el(UA.ids.list).children.length, drive: !a.driveHidden() });

// ---------- ② S1 가상 창 ----------
async function partApp() {
  await withBridge(T.app.run_seconds, null, async () => {
    const S = T.app;
    const a = await openAt(T.s1.scene, S.tick);
    a.made.state.subscribe('plan', (v) => {
      if (!v || v.state !== PI.states.ok || !v.known || CAP.has(a)) return;
      CAP.set(a, { plan: v, inp: { 'plan.request': a.get('plan.request'), my: a.get('my'), stations: a.get('stations'), relay: a.get('relay'), fix: a.get('fix') }, done: { pos: a.get('pos'), ahead: a.get('ahead') } });
    });
    const before = drive(a);
    const req0 = a.get('plan.request');
    // ②-1 열기 → 목록·추천
    a.el(RI.open).click();
    const got = await wait(() => { const p = a.get('plan'); return p && p.state === PI.states.ok && p.known > 0; }, T.wait_ms);
    const p = a.get('plan');
    const statusAsked = a.fetchCalls.filter((f) => f.url.includes(S.status_word)).length;
    const pickName = texts(a.el(RI.reco).children[0]).replace(/\s+/g, ' ').trim();
    const stopRows = a.el(RI.list).children;
    row('②-1', 'S1 — 아래 띠 "' + UR.texts.open + '" 누르기 전엔 목록 셈 없음 → 누르면 칸이 열리고(가운데 칸 안), 상태를 그 노선 시군구만 받아 목록·추천이 나옴',
      '누르기 전 요청 없음 · 칸 열림 · 상태 받기 ≥1 · plan ok · 1순위 줄 · 휴게소 줄 = 엔진 줄 수',
      '누르기 전 ' + JSON.stringify(req0 || null) + ' · 칸 ' + (a.el(RI.root).hidden ? '닫힘' : '열림') + ' · 상태 받기 ' + statusAsked + ' · plan ' + (p && p.state) + ' · 1순위 "' + pickName + '" · 줄 ' + stopRows.length + '/' + (p && p.result ? p.result.route_list.entries.length : '-'),
      !req0 && got && !a.el(RI.root).hidden && statusAsked >= 1 && p.result.recommendation.primary && pickName.includes(p.result.recommendation.primary.rest_area_name) && stopRows.length === p.result.route_list.entries.length);
    // ②-2 앱 안 셈 = 같은 입력의 순수 셈(엔진·입력 만들기 — ①에서 옛 계산과 같음을 봄)
    const PIm = await srcOf('planinput');
    const lib = await pureLib();
    const cap = CAP.get(a);
    const again = cap ? PIm.planOf(cap.inp, cap.done, PI, lib, null) : null;
    const rec = (x) => (x && x.result ? JSON.stringify([x.result.recommendation.primary && x.result.recommendation.primary.station_id, x.result.recommendation.backup && x.result.recommendation.backup.station_id, x.result.route_list.entries.map((e) => e.rest_area_id + ':' + e.usable_fast)]) : '-');
    row('②-2', '앱이 낸 추천 = 같은 입력(그때의 목록·상태·내 차·자리)을 순수 모듈로 따로 셈한 것', rec(again), cap ? rec(cap.plan) : '잡지 못함', !!cap && rec(again) === rec(cap.plan) && again.safe_km === cap.plan.safe_km);
    // ②-3 운전 화면 그대로
    await sleep(S.watch_ms);
    const mid = drive(a);
    row('②-3', '목록 칸이 열려 있는 동안 운전 화면(속도판·충전소판 세 줄)은 그대로 돈다', '속도판 글 있음 · 판 줄 ' + before.rows + ' · 운전 화면 보임',
      '속도 ' + JSON.stringify(mid.speed) + ' · 판 줄 ' + mid.rows + ' · 운전 화면 ' + (mid.drive ? '보임' : '숨음'), mid.speed !== '' && mid.rows === before.rows && mid.drive);
    // ②-4 배터리 % 바꾸기 · 이상한 값
    const seq0 = a.get('plan.request').seq;
    a.el(RI.soc).value = String(S.soc_low);
    a.el(RI.soc).fire(UR.change_event);
    await wait(() => { const q = a.get('plan'); return q && q.soc === S.soc_low; }, T.wait_ms);
    const low = a.get('plan');
    const bad = [];
    for (const v of S.bad_socs) {
      const s0 = a.get('plan.request').seq;
      a.el(RI.soc).value = v;
      a.el(RI.soc).fire(UR.change_event);
      bad.push(JSON.stringify(v) + '→' + (a.el(RI.soc_err).textContent || '(없음)') + (a.get('plan.request').seq === s0 ? ' 안 냄' : ' 냄'));
    }
    const badOk = bad.every((b) => b.endsWith(' 안 냄') && !b.includes('(없음)'));
    a.el(RI.plus).click();
    await wait(() => { const q = a.get('plan'); return q && q.soc === S.soc_low + UR.soc_step; }, T.wait_ms);
    row('②-4', '배터리 % 바꾸기 — ' + S.soc_low + '% 넣으면 다시 셈(도착 % 낮아짐) · 이상한 값(' + S.bad_socs.map((v) => JSON.stringify(v)).join(', ') + ')은 그 칸 아래 한 줄·요청 안 냄 · "+' + UR.soc_step + '" 단추',
      'soc ' + S.soc_low + ' · 1순위 도착 % < 앞 값 · 거절 ' + S.bad_socs.length + '/' + S.bad_socs.length + ' · ' + (S.soc_low + UR.soc_step),
      'soc ' + (low && low.soc) + ' · 1순위 도착 ' + (low && low.result && low.result.recommendation.primary ? low.result.recommendation.primary.arrival_soc_pct.toFixed(1) : '없음') + ' (앞 ' + p.result.recommendation.primary.arrival_soc_pct.toFixed(1) + ') · ' + bad.join(' · ') + ' · ' + (a.get('plan') && a.get('plan').soc),
      low && low.soc === S.soc_low && a.get('plan.request').seq > seq0 && (!low.result.recommendation.primary || low.result.recommendation.primary.arrival_soc_pct < p.result.recommendation.primary.arrival_soc_pct) && badOk && a.get('plan').soc === S.soc_low + UR.soc_step);
    // ②-5 줄 누름 → 정보 칸
    const first = a.el(RI.list).children[0];
    first.click();
    await wait(() => !!a.made.ui_station.open(), T.wait_ms);
    const opened = a.made.ui_station.open();
    row('②-5', '휴게소 줄을 누르면 충전소 정보 칸이 그 휴게소로 열림(station.select.list)', '정보 칸 key = ' + first.getAttribute(UR.attrs.key),
      '정보 칸 ' + (opened ? 'key ' + opened.key + ' · 충전소 ' + opened.ids.length + '곳 · from ' + opened.from : '안 열림'), opened && opened.key === first.getAttribute(UR.attrs.key) && opened.from === UR.select_piece);
    // ②-6 내 차 칸: 열면 목록 칸 닫힘 · 값 바꿔 저장 → my · 목록 셈에 쓰임
    a.el(MI.open).click();
    const exclusive = !a.el(MI.root).hidden && a.el(RI.root).hidden;
    const ins = a.made.ui_my.inputs();
    ins.battery.value = S.my.battery;
    ins.eff.value = S.my.eff;
    ins.sub_op.value = S.my.sub_op;
    ins.card_name.value = S.my.card_name;
    ins.card_rate.value = S.my.card_rate;
    const opRow = a.made.ui_my.opRows()[0];
    if (opRow) { opRow.alias.value = S.my.alias; opRow.price.value = S.my.op_price; }
    a.el(MI.save).click();
    await wait(() => a.made.ui_my.saves() > 0, T.wait_ms);
    const myNow = a.get('my');
    const file = Object.entries(a.disk.files).find(([k]) => k.endsWith(cfgOf('config_store').keys.my.file));
    row('②-6', '"' + UM.texts.open + '" 칸 — 열면 목록 칸은 닫힘(가운데 칸에 하나만) · 배터리 ' + S.my.battery + ' · 전비 ' + S.my.eff + ' · 구독 없음 · 카드 ' + S.my.card_name + ' ' + S.my.card_rate + '% · 업체 별명·요금 저장 → 폰 데이터 폴더·my 알림',
      '하나만 열림 · 저장했어요 · my.battery ' + S.my.battery + ' · 파일 있음',
      (exclusive ? '하나만 열림' : '둘 다/다름') + ' · ' + a.el(MI.note).textContent + ' · my ' + JSON.stringify({ battery: myNow.battery, eff: myNow.eff, sub_op: myNow.sub_op, card: myNow.card_name + ' ' + myNow.card_rate, ops: myNow.ops }) + ' · 파일 ' + (file ? '있음' : '없음'),
      exclusive && myNow.battery === Number(S.my.battery) && myNow.eff === Number(S.my.eff) && myNow.sub_op === '' && myNow.card_name === S.my.card_name && !!file && a.el(MI.note).textContent.startsWith(UM.texts.saved.split('{')[0]) && (!opRow || (myNow.ops[opRow.op] && myNow.ops[opRow.op].alias === S.my.alias)));
    // 목록 셈에 새 값이 쓰임(안전 거리 = soc/100·용량·전비·(1−여유) − 도착최소·km/%)
    a.el(RI.open).click();
    await wait(() => { const q = a.get('plan'); return q && q.state === PI.states.ok && q.seq === a.get('plan.request').seq; }, T.wait_ms);
    const q = a.get('plan');
    const soc = q.soc;
    const kpp = myNow.battery * myNow.eff * (1 - myNow.margin / 100) / 100;
    const wantSafe = soc / 100 * myNow.battery * myNow.eff * (1 - myNow.margin / 100) - myNow.min_arrival * kpp;
    const cardUsed = q.result.route_list.entries.some((e) => e.stations.some((s) => s.quote.applied === S.my.card_name));
    row('②-7', '저장한 내 차·할인이 목록 셈에 바로 쓰임 — 안전 거리(시험이 따로 셈) · 카드 할인 적용 · 구독 없음', '안전 거리 ' + wantSafe.toFixed(2) + ' km · 카드 적용 · 구독 적용 0',
      '안전 거리 ' + q.safe_km.toFixed(2) + ' km · 카드 ' + (cardUsed ? '적용' : '안 됨') + ' · 구독 적용 ' + q.result.route_list.entries.filter((e) => e.subscription_applicable).length + ' · 머리 "' + a.el(RI.range).textContent + '"',
      Math.abs(q.safe_km - wantSafe) < 1e-6 && cardUsed && q.result.route_list.entries.every((e) => !e.subscription_applicable));
    // ②-8 이상한 값 — 저장 안 함
    a.el(MI.open).click();
    const fileBefore = file ? a.disk.files[file[0]] : null;
    const badRes = [];
    for (const b of S.bad_my) {
      const ins2 = a.made.ui_my.inputs();
      if (b.key === 'op_price') { const r2 = a.made.ui_my.opRows()[0]; if (r2) r2.price.value = b.v; } else ins2[b.key].value = b.v;
      const n0 = a.made.ui_my.saves();
      a.made.ui_my.save();
      await sleep(S.save_wait_ms);
      const errText = b.key === 'op_price' ? (a.made.ui_my.opRows()[0] || { err: { textContent: '' } }).err.textContent : '';
      const fieldErr = b.key === 'op_price' ? errText : (texts(a.el(MI.car)) + texts(a.el(MI.discount)));
      badRes.push(b.key + '=' + JSON.stringify(b.v) + '→' + (a.made.ui_my.saves() === n0 ? '저장 안 함' : '저장됨') + (fieldErr.includes(UM.texts.why[b.why]) ? '·' + UM.texts.why[b.why] : '·줄 없음'));
      // 다음 경우를 위해 되돌림
      if (b.key === 'op_price') { const r2 = a.made.ui_my.opRows()[0]; if (r2) r2.price.value = ''; } else ins2[b.key].value = String(myNow[b.key]);
    }
    const fileAfter = file ? a.disk.files[file[0]] : null;
    row('②-8', '내 차 칸 이상한 값(' + S.bad_my.length + '경우: 빈 값·글자·범위 밖·음수) — 그 칸 아래 한 줄 · 저장 안 함 · 폰 파일 그대로', S.bad_my.map((b) => b.key + '→저장 안 함·' + UM.texts.why[b.why]).join(' · ') + ' · 파일 그대로',
      badRes.join(' · ') + ' · 파일 ' + (fileBefore === fileAfter ? '그대로' : '바뀜'), badRes.every((x) => x.includes('저장 안 함') && !x.includes('줄 없음')) && fileBefore === fileAfter);
    // ②-9 다시 열기(같은 폰 데이터 폴더로 새 앱) → 저장한 값 그대로
    const disk = a.disk;
    a.stop();
    const b2 = await openAt(T.s1.scene, S.tick, { disk });
    const my2 = b2.get('my');
    b2.el(MI.open).click();
    const shown = b2.made.ui_my.inputs().battery.value;
    row('②-9', '앱을 닫고 다시 열면(같은 폰 데이터 폴더) 저장한 내 차·할인 그대로 — my 알림 · 칸에 보이는 값', 'battery ' + S.my.battery + ' · 칸 "' + S.my.battery + '" · 카드 ' + S.my.card_name,
      'battery ' + my2.battery + ' · 칸 ' + JSON.stringify(shown) + ' · 카드 ' + my2.card_name, my2.battery === Number(S.my.battery) && shown === String(Number(S.my.battery)) && my2.card_name === S.my.card_name);
    // ②-10 로그
    const logText = await b2.logText();
    const words = [UR.word_open, UM.word_saved, UM.word_loaded, UR.word_select];
    const allLog = (await a.logText()) + logText;
    row('②-10', '로그 — 목록 열기·줄 고름·내 차 저장·읽기 한 줄씩', words.join(' · ') + ' 모두 있음', words.map((w) => w + ' ' + (allLog.includes(w) ? '있음' : '없음')).join(' · '), words.every((w) => allLog.includes(w)));
    b2.stop();
  });
}

async function pureLib() {
  const names = ['engine', 'planinput', 'mine', 'geo', 'ahead', 'locate', 'relay_read', 'relay_fresh', 'timefmt'];
  const parts = {};
  for (const n of names) parts[n] = await srcOf(n);
  return { parts, rules: { config_engine: EC, config_mine: MC, config_ahead: AH, config_locate: LC, config_geo: G, config_relay_read: RR, config_relay_fresh: RF, config_time: TM, config_planinput: PI } };
}

// ---------- ③ S12 1시간(배속) ----------
async function partS12() {
  const S = T.s12;
  const v8 = await import('node:v8');
  const vm = await import('node:vm');
  const { monitorEventLoopDelay } = await import('node:perf_hooks');
  v8.setFlagsFromString('--expose_gc');
  const gc = vm.runInNewContext('gc');
  await withBridge(S.run_seconds, S.scale, async () => {
    await selectScene(INFO, S.scene, false);
    const a = await start({});
    await wait(() => a.stage() === HC.stages.good, T.start_wait_ms);
    a.el(RI.open).click();
    const statecalc = await srcOf('statecalc');
    const lib = await pureLib();
    const SC = cfgOf('config_statecalc');
    const rules = {};
    for (const r of SC.table) for (const n of [r.rule, ...(r.uses || [])]) rules[n] = cfgOf(n);
    const parts = { ...lib.parts, limitmatch: await srcOf('limitmatch'), speed: await srcOf('speed'), naviroute: await srcOf('naviroute'), navi: await srcOf('navi') };
    // (정비 가 ⑦) 계산기 입력은 계산 표에서 뽑는다(config_calcrunner 에 더는 적지 않음)
    const CR = statecalc.ioOf(SC.table);
    // 한 틱 처리 시간: 그때의 입력 조각 전부로 표 전체(위치·제한·속도·경로·앞의 충전소·목록)를 셈한 시간(S.reps 번의 가운데 값)
    function tickMs() {
      const inputs = {};
      for (const n of CR.inputs) inputs[n] = a.get(n);
      const changed = new Set(CR.inputs);
      const times = [];
      for (let i = 0; i < S.reps; i += 1) {
        const t0 = process.hrtime.bigint();
        statecalc.calc(inputs, changed, {}, SC.table, parts, rules);
        times.push(Number(process.hrtime.bigint() - t0) / 1e6);
      }
      times.sort((x, y) => x - y);
      return times[Math.floor(times.length / 2)];
    }
    async function sample(name) {
      const h = monitorEventLoopDelay({ resolution: S.loop_resolution_ms });
      h.enable();
      await sleep(S.loop_window_ms);
      h.disable();
      // 시험 도구가 모으는 알림 기록(seen)은 비워 앱의 메모리만 보이게
      FIXN += a.seen.fixes.length;
      for (const k of Object.keys(a.seen)) a.seen[k].length = 0;
      gc();
      const mem = process.memoryUsage();
      const logBytes = Object.values(a.disk.files).reduce((n, t) => n + t.length, 0);
      const plan = a.get('plan');
      return { name, at: kstText(tc), fixes: FIXN, heap_mb: mem.heapUsed / 1048576, rss_mb: mem.rss / 1048576, tick_ms: tickMs(), loop_p99_ms: h.percentile(99) / 1e6, loop_max_ms: h.max / 1e6, log_kb: logBytes / 1024, log_lines: a.logLines().length, plan: plan ? plan.state : null, plan_t: plan ? plan.t : null };
    }
    let FIXN = 0;
    await wait(() => a.seen.fixes.length >= S.warm_fixes, T.start_wait_ms);
    const s0 = await sample('처음');
    log.write('S12 처음', s0);
    const until = Date.now() + S.watch_ms;
    const mids = [];
    while (Date.now() < until) {
      await sleep(S.every_ms);
      const m = await sample('중간');
      mids.push(m);
      log.write('S12 중간', m);
      if (m.fixes >= S.end_fixes) break;
    }
    const s1 = await sample('끝');
    log.write('S12 끝', s1);
    a.stop();
    S12_RESULT = { s0, s1, mids };
    const heapGrow = s1.heap_mb - s0.heap_mb;
    const tickGrow = s1.tick_ms / Math.max(s0.tick_ms, S.tick_floor_ms);
    const fmt = (x) => '위치 ' + x.fixes + ' · 힙 ' + x.heap_mb.toFixed(1) + 'MB · 한 틱 셈 ' + x.tick_ms.toFixed(3) + 'ms · 이벤트 늦음 p99 ' + x.loop_p99_ms.toFixed(1) + 'ms · 기록장 ' + x.log_kb.toFixed(0) + 'KB(' + x.log_lines + '줄 보임) · 목록 ' + x.plan;
    row('③-1', 'S12 긴 주행(' + S.scale + '배속 — 장면 3600틱 = 1시간) 목록 칸을 연 채로: 위치를 끝까지 받음', '위치 ≥ ' + S.end_fixes, '처음 ' + s0.fixes + ' → 끝 ' + s1.fixes, s1.fixes >= S.end_fixes);
    row('③-2', '느려지지 않나 — 한 틱 셈 시간(표 전체)·이벤트 늦음 처음·끝', '한 틱 끝/처음 ≤ ' + S.tick_ratio_max + '배 · 늦음 p99 ≤ ' + S.loop_p99_max_ms + 'ms', '처음: ' + fmt(s0) + ' ┃ 끝: ' + fmt(s1) + ' · 배 ' + tickGrow.toFixed(2),
      tickGrow <= S.tick_ratio_max && s1.loop_p99_ms <= S.loop_p99_max_ms);
    row('③-3', '메모리가 늘어나지 않나 — gc 뒤 힙 처음·끝(시험 도구가 모은 알림 기록은 표본마다 비움)', '늘어남 ≤ ' + S.heap_grow_max_mb + 'MB', heapGrow.toFixed(1) + 'MB (' + s0.heap_mb.toFixed(1) + ' → ' + s1.heap_mb.toFixed(1) + ') · 중간 ' + mids.map((m) => m.heap_mb.toFixed(1)).join('/'), heapGrow <= S.heap_grow_max_mb);
  });
}
let S12_RESULT = null;
const CAP = new Map();

// ---------- ④ 진짜 크롬 네 창 ----------
async function partChrome() {
  const C = T.chrome;
  const sel = { ...L.sel, ...C.sel };
  const res = await measureInChrome(tc, APP, { scene: T.s1.scene, tick: C.tick, frames: L.frames, sel, ready: L.ready, actions: C.actions, log });
  if (res.error) { row('④', '크롬 재기', '결과', res.error, false); return; }
  fs.writeFileSync(path.join(APP, tc.log.dir, C.json_file), JSON.stringify(res, null, 1), 'utf8');
  for (const fr of res.frames) {
    const checks = fr.steps.map((st) => {
      const g = st.got;
      const one = (k) => (g[k] || []).filter((x) => x.shown);
      const panel = one(st.name === C.actions[0].name ? 'route_root' : 'my_root')[0];
      const center = one('center')[0];
      const bad = [];
      if (!panel) bad.push('칸 안 보임');
      else {
        if (center && !inside(panel.rect, center.rect, tc.chrome.tol_px)) bad.push('가운데 칸 밖');
        for (const k of C.avoid) for (const x of one(k)) if (overlapArea(panel.rect, x.rect) > 0) bad.push(k + ' 겹침');
      }
      for (const k of L.contents) for (const x of one(k)) for (const hpt of x.hits || []) if (!hpt.ok) bad.push(k + ' 가림(' + hpt.by + ')');
      for (const k of C.cut) for (const x of one(k)) if (x.sw > x.cw + tc.chrome.tol_px && panel && inside(x.rect, panel.rect, tc.chrome.tol_px)) bad.push(k + ' 잘림');
      for (const k of C.touch) for (const x of one(k)) if (panel && inside(x.rect, panel.rect, tc.chrome.tol_px) && x.rect.h < L.touch_min_px - tc.chrome.tol_px) bad.push(k + ' 높이 ' + x.rect.h);
      for (const k of C.band_touch) for (const x of one(k)) if (x.rect.h < L.touch_min_px - tc.chrome.tol_px) bad.push(k + ' 높이 ' + x.rect.h);
      const vis = C.must_show[st.name] || [];
      for (const k of vis) if (!one(k).length) bad.push(k + ' 없음');
      return { ok: bad.length === 0, text: st.name + ': ' + (bad.length ? bad.slice(0, 6).join(', ') : '가림 0 · 겹침 0 · 잘림 0 · 낮은 것 0') + (panel ? ' (칸 ' + Math.round(panel.rect.w) + '×' + Math.round(panel.rect.h) + ')' : '') };
    });
    row('④ ' + fr.name, '진짜 크롬 — 목록 칸·내 차 칸을 열어: 칸이 가운데 칸 안(지도 아래) · 양옆 판·아래 띠·지도 단추·저작권과 겹침 0 · 판 숫자·저작권 가림 0 · 숫자 잘림 0 · 누르는 높이 48 이상',
      '두 걸음 모두 가림 0 · 겹침 0 · 잘림 0 · 낮은 것 0', (fr.ready ? '' : '준비 안 됨 · ') + checks.map((x) => x.text).join(' ┃ '), fr.ready && checks.length === C.actions.length && checks.every((x) => x.ok));
  }
}

// ---------- ⑤ 옛·새 화면 나란히 그림(크롬 DevTools 길 — 창 없는 크롬을 원격으로 열어 그림을 받음) ----------
function cdpClient(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
    ws.onerror = (e) => reject(new Error('CDP 연결 실패 ' + (e && e.message)));
    ws.onopen = () => resolve({
      send: (method, params) => new Promise((res) => { id += 1; pending.set(id, res); ws.send(JSON.stringify({ id, method, params: params || {} })); }),
      close: () => ws.close(),
    });
  });
}
async function withChromePage(fn) {
  const C = T.shots;
  const chrome = findChrome(tc);
  if (!chrome) throw new Error('크롬이 없음');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'web2-a7-shot-'));
  const proc = spawn(chrome, [...C.chrome_args, C.port_arg + C.port, tc.chrome.profile_arg + profile, C.blank], { stdio: 'ignore' });
  try {
    let target = null;
    await wait(() => false, C.boot_ms);
    for (let i = 0; i < C.tries && !target; i += 1) {
      try { const list = await (await fetch(C.json_url.split('{port}').join(String(C.port)))).json(); target = list.find((x) => x.type === 'page'); } catch (e) { await sleep(tc.chrome.poll_ms); }
    }
    if (!target) throw new Error('크롬 원격 길이 안 열림');
    const cdp = await cdpClient(target.webSocketDebuggerUrl);
    try { return await fn(cdp); } finally { cdp.close(); }
  } finally {
    if (proc.exitCode === null) spawnSync(tc.chrome.kill_cmd, [...tc.chrome.kill_args_before_pid, String(proc.pid), ...tc.chrome.kill_args_after_pid], { encoding: 'utf8' });
    await sleep(tc.chrome.poll_ms);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { log.write('크롬 임시 폴더 못 지움', { error: e.message }); }
  }
}
async function shot(cdp, url, w, h, setup, file) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.enable');
  await cdp.send('Page.navigate', { url });
  await sleep(T.shots.load_ms);
  let out = null;
  if (setup) {
    const r = await cdp.send('Runtime.evaluate', { expression: setup, awaitPromise: true, returnByValue: true });
    out = r.result && r.result.result ? r.result.result.value : null;
  }
  const pic = await cdp.send('Page.captureScreenshot', { format: 'png' });
  if (!pic.result || !pic.result.data) throw new Error('그림 못 받음: ' + JSON.stringify(pic.error || pic).slice(0, 300));
  fs.writeFileSync(file, Buffer.from(pic.result.data, 'base64'));
  return out;
}
async function partShots() {
  const C = T.shots;
  const dir = path.resolve(APP, C.out_dir);
  fs.mkdirSync(dir, { recursive: true });
  const oldFile = path.join(dir, C.old_png);
  const newFile = path.join(dir, C.new_png);
  const both = path.join(dir, C.both_png);
  // 옛 앱: web/index.html 을 그대로(파일로) — 노선·자리·배터리·내 차를 폰 저장(localStorage)에 넣고 다시 읽음
  const oldUrl = pathToFileURL(path.join(OLD, C.old_index)).href;
  const oldState = JSON.stringify(C.old_state);
  const oldPre = 'localStorage.setItem(' + JSON.stringify(C.old_key) + ', ' + JSON.stringify(oldState) + '); true';
  const oldSetup = '(() => { const t = (q) => { const e = document.querySelector(q); return e ? e.innerText : null; }; return { reco: t(' + JSON.stringify(C.old_reco_q) + '), range: t(' + JSON.stringify(C.old_range_q) + ') }; })()';
  let oldText = null;
  let newText = null;
  await withChromePage(async (cdp) => {
    // 먼저 한 번 열어 폰 저장에 넣고, 다시 열어(옛 앱이 켤 때 읽음) 그림
    await cdp.send('Page.enable');
    await cdp.send('Page.navigate', { url: oldUrl });
    await sleep(C.load_ms);
    const w = await cdp.send('Runtime.evaluate', { expression: oldPre, returnByValue: true });
    log.write('옛 앱 저장 넣음', { ok: !!(w.result && w.result.result && w.result.result.value) });
    oldText = await shot(cdp, oldUrl, C.w, C.h, oldSetup, oldFile);
  });
  // 새 앱: 빌드 + 다리(S1) + 작은 서버 — 목록 칸을 열고(배터리 = 옛 것과 같음) 그림
  const V = tc.view_s1;
  const secret = makeSecret(tc);
  const sec = writeSecretFile(tc, secret);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'web2-a7-build-'));
  let server = null;
  let bridge = null;
  try {
    const here = V.host + ':' + V.port;
    const gw = cfgOf(V.gateway_config);
    gw.gateway_url = V.scheme + here;
    gw.allowed_hosts = [here];
    const overFile = path.join(out, V.override_file);
    fs.writeFileSync(overFile, JSON.stringify({ [V.gateway_config]: gw, config_ui_route: { ...UR, soc_default: C.old_state.soc } }), 'utf8');
    const r = spawnSync(process.execPath, [path.join(TOOLS_DIR, 'build.mjs'), '--out', out, '--secret', sec.file, '--override', overFile], { encoding: 'utf8' });
    if (r.status !== tc.exit.ok) throw new Error('빌드 실패 ' + r.stderr);
    const page = fs.readFileSync(path.join(out, tc.build.out_file));
    const info = testbedInfo(tc, APP);
    const shim = linesShim(tc, info, secret);
    bridge = await startBridge(tc, info, C.bridge_seconds, secret);
    await selectScene(info, T.s1.scene, false);
    if (C.tick) await seekScene(info, C.tick);
    server = http.createServer((req, res) => {
      if (req.url.startsWith(V.gateway_prefix)) {
        const dataPrefix = info.b.paths.data;
        if (req.method === 'GET' && req.url.startsWith(dataPrefix)) {
          const a2 = shim.answer(decodeURIComponent(req.url.slice(dataPrefix.length)), req.headers);
          if (a2) { res.writeHead(a2.status, { 'Content-Type': tc.testbed.json_type }); res.end(a2.body); return; }
        }
        const headers = { ...req.headers };
        delete headers.host;
        const up = http.request(new URL(req.url, info.base), { method: req.method, headers }, (ur) => { res.writeHead(ur.statusCode, ur.headers); ur.pipe(res); });
        up.on('error', () => { if (!res.headersSent) res.writeHead(V.proxy_fail_status); res.end(); });
        req.pipe(up);
        return;
      }
      res.writeHead(200, { 'Content-Type': V.content_type, 'Cache-Control': 'no-store' });
      res.end(page);
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(V.port, V.host, resolve); });
    const newSetup = '(async () => { const s = (ms) => new Promise((r) => setTimeout(r, ms)); for (let i = 0; i < 100 && document.getElementById(' + JSON.stringify(UR.ids.open) + ').hidden; i += 1) await s(200); '
      + 'document.getElementById(' + JSON.stringify(UR.ids.open) + ').click(); await s(' + C.panel_ms + '); const t = (id) => { const e = document.getElementById(id); return e ? e.innerText : null; }; '
      + 'return { reco: t(' + JSON.stringify(UR.ids.reco) + '), range: t(' + JSON.stringify(UR.ids.range) + '), head: t(' + JSON.stringify(UR.ids.head) + ') }; })()';
    await withChromePage(async (cdp) => {
      newText = await shot(cdp, V.scheme + here + '/', C.w, C.h, newSetup, newFile);
      // 내 차 칸도 한 장(같은 창 — 다시 열지 않고 단추만 누름)
      await cdp.send('Runtime.evaluate', { expression: 'document.getElementById(' + JSON.stringify(UM.ids.open) + ').click(); true' });
      await sleep(C.panel_ms / 2);
      const pic = await cdp.send('Page.captureScreenshot', { format: 'png' });
      if (pic.result && pic.result.data) fs.writeFileSync(path.join(dir, C.my_png), Buffer.from(pic.result.data, 'base64'));
    });
  } finally {
    if (server) { server.closeAllConnections(); server.close(); }
    if (bridge) {
      const code = await Promise.race([bridge.waitExit(), sleep(C.bridge_seconds * V.ms_per_s + T.exit_grace_ms).then(() => 'timeout')]);
      if (code === 'timeout') bridge.proc.kill();
    }
    fs.rmSync(out, { recursive: true, force: true });
    fs.rmSync(sec.dir, { recursive: true, force: true });
  }
  // 나란히: 두 그림을 한 페이지에 놓고 그 페이지를 그림으로
  const html = path.join(dir, C.both_html);
  const cap = (t) => String(t).replace(/</g, '&lt;');
  fs.writeFileSync(html, '<!doctype html><meta charset="utf-8"><body style="margin:0;background:#fff;font:14px sans-serif"><div style="display:flex;gap:8px;padding:8px">'
    + '<figure style="margin:0"><figcaption>' + cap(C.old_caption) + '</figcaption><img src="' + C.old_png + '"></figure>'
    + '<figure style="margin:0"><figcaption>' + cap(C.new_caption) + '</figcaption><img src="' + C.new_png + '"></figure></div></body>', 'utf8');
  await withChromePage(async (cdp) => { await shot(cdp, pathToFileURL(html).href, C.w * 2 + C.both_pad, C.h + C.both_pad * 2, null, both); });
  SHOT_TEXT = { oldText, newText };
  fs.writeFileSync(path.join(dir, C.text_json), JSON.stringify(SHOT_TEXT, null, 1), 'utf8');
  const sizes = [oldFile, newFile, both].map((f) => (fs.existsSync(f) ? fs.statSync(f).size : 0));
  const oldFirst = oldText && oldText.reco ? oldText.reco.split('\n').slice(0, C.text_lines).join(' / ') : '-';
  const newFirst = newText && newText.reco ? newText.reco.split('\n').slice(0, C.text_lines).join(' / ') : '-';
  row('⑤-1', '옛·새 화면 나란히 그림 — 옛 앱 web/ 그대로(경부 부산 방향 · ' + C.old_state.pos + 'km · 배터리 ' + C.old_state.soc + '%) · 새 앱 S1(같은 자리·같은 배터리) 목록 칸', '그림 셋(옛·새·나란히) 있음',
    '옛 ' + sizes[0] + 'B · 새 ' + sizes[1] + 'B · 나란히 ' + sizes[2] + 'B — ' + both, sizes.every((n) => n > C.min_png_bytes));
  row('⑤-2', '같은 자리·같은 배터리의 추천(화면 글) — 옛 앱 1순위·예비 / 새 앱 1순위·예비(참고 — 노선 자료가 옛 실제 자료와 중계 장면으로 다름)', '옛: ' + oldFirst, '새: ' + newFirst, !!(oldText && newText && oldText.reco && newText.reco));
}
let SHOT_TEXT = null;

// ---------- 부분 고르기 ----------
const PARTS = { pure: partPure, app: partApp, s12: partS12, chrome: partChrome, shots: partShots };
async function mainRun() {
  const which = process.argv[2] || 'pure';
  const fn = PARTS[which];
  if (!fn) throw new Error('부분 이름: ' + Object.keys(PARTS).join('|'));
  log.write('시작', { part: which });
  await fn();
  const table = ['| # | 시험 | 기대 | 실제 | 결과 |', '|---|---|---|---|---|', ...rows.map((r) => '| ' + [r.no, r.title, r.expect, r.actual, r.ok ? tc.pass_word : tc.fail_word].map((x) => String(x).replace(/\|/g, '/').replace(/\n/g, ' ')).join(' | ') + ' |')];
  const text = '# A7 스스로 시험 — ' + which + ' (' + kstText(tc) + ')\n\n' + table.join('\n') + '\n\n' + rows.filter((r) => r.ok).length + '/' + rows.length + ' 통과\n';
  fs.writeFileSync(path.join(APP, tc.log.dir, T.report_prefix + which + '.md'), text, 'utf8');
  process.stdout.write(text);
  log.write('끝', { part: which, pass: rows.filter((r) => r.ok).length, all: rows.length });
  process.exitCode = rows.every((r) => r.ok) ? tc.exit.ok : tc.exit.fail;
}
await mainRun();
