// A8 스스로 시험 — 누른 지점 거리(tapdist + ui_tap). 부분을 하나씩 돌린다:
//   node web2/tools/try_a8.mjs pure|app|chrome
// pure   : 다리 없이 순수 셈 — 알려진 두 점의 직선 거리(기대 값은 시험이 반지름 공식으로 따로 셈), 시험 선 위 길 따라 km·앞뒤, 보임·지움·닫기 규칙, 틀린 입력
// app    : S1 가상 창 — 가짜 지도에 빈 곳 누름·번호·점 누름을 흉내: 표시·풍선 자리·거리(따로 셈과 견줌)·다시 누르면 지움·표시 눌러 닫기·충전소 누르기와 갈림·카메라 그대로·로그
// chrome : 진짜 크롬 네 창 — 지도 캔버스의 정한 자리를 눌러 표시가 지도 칸 안·덮임 0·잘림 0·누르는 높이 48, 닫기·다시 누르기, 번호 누르기와 갈림
// 값은 tools/config_try_a8.json(새 파일). 결과 표는 tools/logs/try_a8_last_<부분>.md, 기록장 tools/logs/try_a8.log.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadToolsConfig, appDir, toolLog, kstText, TOOLS_DIR } from './lib_tools.mjs';
import { testbedInfo, makeSecret, writeSecretFile, startBridge, selectScene, seekScene, fetchWithLines } from './lib_testbed.mjs';
import { loadBoards, startApp as runApp, waitFor } from './lib_apprun.mjs';
import { overlapArea, inside } from './lib_chrome.mjs';

const tc = loadToolsConfig();
const T = JSON.parse(fs.readFileSync(path.join(TOOLS_DIR, 'config_try_a8.json'), 'utf8'));
const L = tc.layout;
const APP = appDir(tc);
const log = toolLog(tc, 'try_a8');
const cfgOf = (name) => JSON.parse(fs.readFileSync(path.join(APP, tc.build.config_dir, name + tc.build.config_ext), 'utf8'));
const srcOf = async (name) => import(pathToFileURL(path.join(APP, tc.build.src_dir, name + '.js')).href);
const TP = cfgOf('config_tap');
const G = cfgOf('config_geo');
const LC = cfgOf('config_locate');
const SC = cfgOf('config_statecalc');
const UM = cfgOf('config_ui_map');
const HC = cfgOf('config_health');
const UA = cfgOf('config_ui_ahead');
const SPD = cfgOf('config_ui_speed');
const US = cfgOf('config_ui_station');

const rows = [];
function row(no, title, expect, actual, ok) {
  rows.push({ no, title, expect, actual, ok: !!ok });
  log.write(ok ? '통과' : '실패', { no, title, expect, actual });
}
const wait = (fn, ms) => waitFor(fn, ms, tc.testbed.poll_ms);
const near = (a, b, tol) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tol;

// 시험이 따로 세는 직선 거리(반지름 공식 — 앱의 Geo 와 다른 식)
function havKm(a, b) {
  const k = T.deg_to_rad;
  const dLat = (b[0] - a[0]) * k;
  const dLng = (b[1] - a[1]) * k;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * k) * Math.cos(b[0] * k) * Math.sin(dLng / 2) ** 2;
  return (2 * T.earth_radius_m * Math.asin(Math.sqrt(h))) / T.m_per_km;
}
// 같은 위도 위 동서 거리(시험 선이 위도 고정이라 길 따라 km 의 기대 값)
const parallelKm = (lat, dLng) => (T.earth_radius_m * Math.cos(lat * T.deg_to_rad) * dLng * T.deg_to_rad) / T.m_per_km;

// ---------- ① 순수 ----------
async function partPure() {
  const P = T.pure;
  const tapdist = await srcOf('tapdist');
  const geo = await srcOf('geo');
  const locate = await srcOf('locate');
  const statecalc = await srcOf('statecalc');
  const table = SC.table.filter((r) => r.piece === 'pos' || r.piece === TP.ui.tap_piece);
  const rules = { config_tap: TP, config_geo: G, config_locate: LC };
  const parts = { geo, locate, tapdist };
  const pts = [];
  for (let x = P.line.from[1]; x <= P.line.to[1] + 1e-9; x += P.line.step_deg) pts.push([P.line.from[0], Math.round(x * 1e6) / 1e6]);
  const stations = { list: [], lines: [{ name: P.line.name, points: pts }] };
  const fixAt = (p, heading) => ({ lat: p[0], lng: p[1], t: Date.now(), heading_deg: heading, speed_kmh: P.speed_kmh });
  // StateCalc 를 그대로 돌림(pos → tap 같은 셈)
  function run(inputs, changed, prev) {
    const r = statecalc.calc(inputs, new Set(changed), prev || {}, table, parts, rules);
    if (r.failed.length) throw r.failed[0].error;
    return { ...(prev || {}), ...r.out };
  }

  // ①-1·2 알려진 두 점
  for (const [i, k] of P.known.entries()) {
    const out = run({ 'map.tap': { seq: 1, lat: k.b[0], lng: k.b[1] }, fix: fixAt(k.a, null), stations }, ['map.tap', 'fix']);
    const want = havKm(k.a, k.b);
    row('①-' + (i + 1), '직선 거리 — ' + k.name, '시험이 따로 셈 ' + want.toFixed(3) + ' km(±' + P.km_tol + ') · 상식 범위 ' + k.sane_km.join('~'),
      String(out.tap && out.tap.straight_km), out.tap && near(out.tap.straight_km, want, P.km_tol) && out.tap.straight_km >= k.sane_km[0] && out.tap.straight_km <= k.sane_km[1]);
  }
  // ①-3 길 따라 앞(동쪽으로 달림)
  let o = run({ 'map.tap': { seq: 1, lat: P.ahead_tap[0], lng: P.ahead_tap[1] }, fix: fixAt(P.me, P.heading_east), stations }, ['map.tap', 'fix', 'stations']);
  let want = parallelKm(P.me[0], P.ahead_tap[1] - P.me[1]);
  row('①-3', '고속도로 위(동쪽으로) — 선 가까이 누른 곳의 길 따라 km 와 앞', want.toFixed(2) + ' km 앞 · 선 ' + P.line.name,
    [o.tap.along_km, o.tap.side, o.tap.line, '직선 ' + o.tap.straight_km].join(' · '), near(o.tap.along_km, want, P.along_tol_km) && o.tap.side === TP.sides.ahead && o.tap.line === P.line.name);
  // ①-4 뒤
  o = run({ 'map.tap': { seq: 1, lat: P.behind_tap[0], lng: P.behind_tap[1] }, fix: fixAt(P.me, P.heading_east), stations }, ['map.tap', 'fix', 'stations']);
  want = parallelKm(P.me[0], P.me[1] - P.behind_tap[1]);
  row('①-4', '지나온 쪽을 누름 — 뒤', want.toFixed(2) + ' km 뒤', [o.tap.along_km, o.tap.side].join(' · '), near(o.tap.along_km, want, P.along_tol_km) && o.tap.side === TP.sides.behind);
  // ①-5 거꾸로 달리면 동쪽이 뒤
  o = run({ 'map.tap': { seq: 1, lat: P.ahead_tap[0], lng: P.ahead_tap[1] }, fix: fixAt(P.me, P.heading_west), stations }, ['map.tap', 'fix', 'stations']);
  row('①-5', '서쪽으로 달릴 때 동쪽을 누름 — 뒤', TP.sides.behind, [o.pos && o.pos.dir, o.tap.side].join(' · '), o.tap.side === TP.sides.behind && o.pos.dir === LC.dir_words.backward);
  // ①-6 선에서 먼 곳
  o = run({ 'map.tap': { seq: 1, lat: P.far_tap[0], lng: P.far_tap[1] }, fix: fixAt(P.me, P.heading_east), stations }, ['map.tap', 'fix', 'stations']);
  want = havKm(P.me, P.far_tap);
  row('①-6', '선에서 ' + TP.on_line_m + ' m 넘게 먼 곳 — 길 따라 비움, 직선만', '길 따라 null · 직선 ' + want.toFixed(2), [o.tap.along_km, o.tap.straight_km].join(' · '), o.tap.along_km === null && near(o.tap.straight_km, want, P.km_tol));
  // ①-7 내가 고속도로 밖
  o = run({ 'map.tap': { seq: 1, lat: P.ahead_tap[0], lng: P.ahead_tap[1] }, fix: fixAt(P.off_me, P.heading_east), stations }, ['map.tap', 'fix', 'stations']);
  row('①-7', '내가 고속도로 밖(선에서 2.2 km) — 길 따라 비움', '길 따라 null · pos.on_line 거짓', [o.tap.along_km, o.pos.on_line].join(' · '), o.tap.along_km === null && o.pos.on_line === false && typeof o.tap.straight_km === 'number');
  // ①-8 위치 모름
  o = run({ 'map.tap': { seq: 1, lat: P.ahead_tap[0], lng: P.ahead_tap[1] }, stations }, ['map.tap', 'stations']);
  row('①-8', '위치를 아직 모름 — 직선·길 따라 모두 비움(보이기는 함)', 'shown · null · null', [o.tap.shown, o.tap.straight_km, o.tap.along_km].join(' · '), o.tap.shown && o.tap.straight_km === null && o.tap.along_km === null);
  // ①-9 보임 규칙
  const seqs = [];
  let st = {};
  const inp = { stations, fix: fixAt(P.me, P.heading_east) };
  const step = (name, changed) => { st = run(inp, changed, st); seqs.push(name + '=' + (st.tap ? (st.tap.shown ? '보임' : '숨김') : 'null')); return st.tap ? st.tap.shown : null; };
  const r9 = [];
  r9.push(step('누름 없음', ['fix']) === null);
  inp['map.tap'] = { seq: 1, lat: P.ahead_tap[0], lng: P.ahead_tap[1] };
  r9.push(step('누름1', ['map.tap']) === true);
  inp.fix = fixAt([P.me[0], P.me[1] + 0.001], P.heading_east);
  r9.push(step('위치만 바뀜', ['fix']) === true);
  inp['map.tap'] = { seq: 2, lat: P.behind_tap[0], lng: P.behind_tap[1] };
  r9.push(step('누름2(다시 누름)', ['map.tap']) === false);
  r9.push(step('위치만 바뀜', ['fix']) === false);
  inp['map.tap'] = { seq: 3, lat: P.behind_tap[0], lng: P.behind_tap[1] };
  r9.push(step('누름3', ['map.tap']) === true);
  inp['tap.close'] = { seq: 2 };
  r9.push(step('옛 누름 닫기 요청', ['tap.close']) === true);
  inp['tap.close'] = { seq: 3 };
  r9.push(step('닫기', ['tap.close']) === false);
  r9.push(step('위치만 바뀜', ['fix']) === false);
  inp['map.tap'] = { seq: 4, lat: P.ahead_tap[0], lng: P.ahead_tap[1] };
  r9.push(step('누름4', ['map.tap']) === true);
  row('①-9', '보임 규칙 — 누르면 보임 · 위치만 바뀌면 그대로 · 다시 누르면 지움 · 표시 닫기(지금 누름만) · 그 뒤 누르면 다시 보임', '열 걸음 모두 기대대로', seqs.join(' → '), r9.every(Boolean));
  // ①-11 바로 내 자리 — 앞·뒤를 붙이지 않음
  o = run({ 'map.tap': { seq: 1, lat: P.me[0], lng: P.me[1] }, fix: fixAt(P.me, P.heading_east), stations }, ['map.tap', 'fix', 'stations']);
  row('①-11', '내 자리를 누름(' + TP.side_min_km + ' km 안) — 길 따라 0 · 앞·뒤 없음', '0 · null', [o.tap.along_km, o.tap.side].join(' · '), o.tap.along_km === 0 && o.tap.side === null);
  // ①-10 틀린 입력
  const thrown = P.bad_taps.map((b) => { try { tapdist.tapOf({ 'map.tap': b }, {}, TP, { parts, rules }, null); return '안 던짐'; } catch (e) { return '던짐(' + e.message + ')'; } });
  row('①-10', '틀린 누름 값(위도 95 · 경도 200 · seq 0 · seq 1.5 · 위도 없음) — 던짐(CalcRunner 가 잡아 로그)', '다섯 모두 던짐', thrown.join(' · '), thrown.every((x) => x.startsWith('던짐')));
}

// ---------- 다리·앱 띄우기 ----------
let INFO = null;
let SECRET = null;
let SECRET_FILE = null;
async function withBridge(seconds, fn) {
  INFO = testbedInfo(tc, APP);
  SECRET = makeSecret(tc);
  const sec = writeSecretFile(tc, SECRET);
  SECRET_FILE = sec.file;
  const bridge = await startBridge(tc, INFO, seconds, SECRET);
  try {
    await fn();
  } finally {
    let guard = null;
    const code = await Promise.race([bridge.waitExit(), new Promise((res) => { guard = setTimeout(() => res('timeout'), seconds * tc.view_s1.ms_per_s + T.exit_grace_ms); })]);
    clearTimeout(guard);
    if (code === 'timeout') bridge.proc.kill();
    row('끝', '다리가 시험 모드 시간 뒤 스스로 끝남', '종료 코드 0', String(code), code === 0);
    fs.rmSync(sec.dir, { recursive: true, force: true });
  }
}

// 가짜 지도 라이브러리에 풍선(Popup)을 더함 — 앱은 지도 라이브러리의 풍선을 쓴다(가짜 지도에 없던 것)
function addFakePopup(lib) {
  const pops = [];
  lib.Popup = class {
    constructor(o) { this.o = o; this.removed = false; pops.push(this); }
    setDOMContent(el) { this.el = el; return this; }
    setLngLat(ll) { this.ll = ll; return this; }
    addTo(m) { this.map = m; return this; }
    remove() { this.removed = true; return this; }
  };
  return { pops, live: () => pops.filter((p) => !p.removed) };
}

async function partApp() {
  const A = T.app;
  const main = (await srcOf('app')).main;
  const boards = await loadBoards(APP, tc);
  const geo = await srcOf('geo');
  await withBridge(A.run_seconds, async () => {
    await selectScene(INFO, A.scene, false);
    if (A.tick) await seekScene(INFO, A.tick);
    const a = runApp({ app: APP, tc, main, boards }, { secretFile: SECRET_FILE, fetchFn: fetchWithLines(tc, INFO, SECRET, fetch), stamp: 'try-a8' });
    const pop = addFakePopup(a.lib);
    try {
      await wait(() => a.stage() === HC.stages.good, T.start_wait_ms);
      await wait(() => a.lib.maps.length > 0 && !!a.get('pos') && a.get('pos').on_line && !!a.get('ahead') && a.el(UA.ids.list).children.length > 0, T.start_wait_ms);
      const map = a.lib.maps[0];
      let qrf = [];
      map.queryRenderedFeatures = () => qrf;
      const root = a.el(TP.ui.ids.root);
      const counts = { tap: 0, cam: 0, select: 0 };
      const taps = [];
      a.made.state.subscribe(TP.ui.tap_piece, (v) => { counts.tap += 1; taps.push(v); });
      a.made.state.subscribe(UM.cam_piece, () => { counts.cam += 1; });
      a.made.state.subscribe(UM.select_piece, () => { counts.select += 1; });
      const noTarget = { target: { closest: () => null } };
      const fire = (lat, lng, target) => map.fire(UM.events.click, { lngLat: { lat, lng }, point: { x: 0, y: 0 }, originalEvent: target || noTarget });
      const tapNow = () => a.get(TP.ui.tap_piece);
      row('②-1', '처음 — 표시 숨김 · tap 조각 없음', '숨김 · 없음', [root.hidden, JSON.stringify(tapNow())].join(' · '), root.hidden === true && !tapNow());

      // 누를 곳: 지금 선 위 km + ahead_km 자리(장면 선에서 셈)
      const pos = a.get('pos');
      const line = a.get('stations').lines.find((l) => l.name === pos.line);
      let acc = 0;
      let target = line.points[line.points.length - 1];
      let kmNow = 0;
      for (let i = 0; i + 1 < line.points.length; i += 1) {
        const segKm = havKm(line.points[i], line.points[i + 1]);
        if (kmNow + segKm >= pos.km + A.ahead_km) { const t = (pos.km + A.ahead_km - kmNow) / segKm; target = [line.points[i][0] + (line.points[i + 1][0] - line.points[i][0]) * t, line.points[i][1] + (line.points[i + 1][1] - line.points[i][1]) * t]; break; }
        kmNow += segKm;
        acc += 1;
      }
      // ②-2 카메라를 손으로 굳힌 뒤 누름
      map.user('rotated', { bearing: A.user_bearing });
      map.user('zoomed', { zoom: A.user_zoom });
      await wait(() => a.made.ui_map.cam().bearing_locked && a.made.ui_map.cam().zoom_locked, A.wait_ms);
      const camBefore = JSON.stringify(a.made.ui_map.cam());
      const camCount = counts.cam;
      const jumpsBefore = map.jumps.length;
      fire(target[0], target[1]);
      const jumpsRightAfter = map.jumps.length;
      await wait(() => tapNow() && tapNow().shown && !root.hidden, A.wait_ms);
      const t1 = tapNow();
      const f1 = a.get('fix');
      const p1 = a.get('pos');
      const live1 = pop.live();
      row('②-2', 'S1 고속도로에서 선 위 ' + A.ahead_km + ' km 앞을 누름 → 표시가 보이고 누른 자리의 지도 풍선에 꽂힘',
        '보임 · 풍선 1개 · 풍선 자리 = 누른 좌표 · 풍선 안 = 표시 상자', [t1 && t1.shown, !root.hidden, live1.length, live1[0] && live1[0].ll.map((v) => v.toFixed(5)).join(','), live1[0] && live1[0].el && live1[0].el.id].join(' · '),
        t1 && t1.shown && !root.hidden && live1.length === 1 && near(live1[0].ll[0], target[1], 1e-9) && near(live1[0].ll[1], target[0], 1e-9) && live1[0].el === root);
      const wantStraight = havKm([f1.lat, f1.lng], target);
      const wantAlong = Math.abs(A.ahead_km - (p1.km - pos.km));
      row('②-3', '거리 — 직선은 시험이 따로 셈(지금 위치 ↔ 누른 곳), 길 따라는 누른 km − 지금 km, 진행 방향으로 앞',
        '직선 ≈ ' + wantStraight.toFixed(2) + ' · 길 따라 ≈ ' + wantAlong.toFixed(2) + ' 앞', ['직선 ' + t1.straight_km, '길 따라 ' + t1.along_km, t1.side, t1.line].join(' · '),
        near(t1.straight_km, wantStraight, A.straight_tol_km) && near(t1.along_km, wantAlong, A.along_tol_km) && t1.side === TP.sides.ahead && t1.line === pos.line);
      const txt = [a.el(TP.ui.ids.straight).textContent, a.el(TP.ui.ids.along).textContent].join(' / ');
      row('②-4', '표시 글 — 직선 km · 길 따라 km 앞(설정 글)', TP.ui.texts.straight + ' … ' + TP.ui.texts.km_unit + ' / ' + TP.ui.texts.along + ' … ' + TP.ui.texts.sides.ahead, txt,
        txt.startsWith(TP.ui.texts.straight + ' ') && txt.includes(TP.ui.texts.along + ' ') && txt.endsWith(TP.ui.texts.sides.ahead) && !a.el(TP.ui.ids.along).hidden);
      // 위치가 바뀌면 거리만 다시
      const s0 = t1.straight_km;
      await wait(() => tapNow() && tapNow().straight_km !== s0, A.move_wait_ms);
      const t2 = tapNow();
      row('②-5', '달리는 동안 — 같은 누름(seq 그대로) · 보임 그대로 · 거리가 줄어듦(다가감)', 'seq ' + t1.seq + ' · 보임 · 직선 < ' + s0, [t2.seq, t2.shown, t2.straight_km, t2.along_km].join(' · '), t2.seq === t1.seq && t2.shown && t2.straight_km < s0 && pop.live().length === 1);
      // 카메라 그대로
      await wait(() => false, A.wait_ms / 4);
      const camAfter = JSON.stringify(a.made.ui_map.cam());
      row('②-6', '카메라 — 누름이 카메라를 움직이지 않음 · 손으로 굳힌 방향 ' + A.user_bearing + '·확대 ' + A.user_zoom + ' 그대로 · map.cam 새로 안 냄', '누른 순간 지도 명령 0 · 카메라 상태 같음 · map.cam 0번',
        ['명령 ' + (jumpsRightAfter - jumpsBefore), camAfter === camBefore ? '같음' : camBefore + '→' + camAfter, 'map.cam ' + (counts.cam - camCount)].join(' · '),
        jumpsRightAfter === jumpsBefore && camAfter === camBefore && counts.cam === camCount && map.cam.bearing === A.user_bearing && map.cam.zoom === A.user_zoom);
      // ②-7 충전소 점 누름 — 갈림(점 층 누름 + 같은 누름의 지도 click 은 점이 있어 빈 곳 아님)
      const tapsBefore = a.made.ui_map.taps();
      const sel0 = counts.select;
      const dotId = a.get('stations').list.find((s) => typeof s.lat === 'number').id;
      qrf = [{ properties: { [UM.others.id_prop]: dotId } }];
      map.clickLayer(UM.others.layer_id, { [UM.others.id_prop]: dotId });
      fire(target[0], target[1]);
      qrf = [];
      await wait(() => counts.select > sel0, A.wait_ms);
      const stOpen = await wait(() => !a.el(US.ids.root).hidden, A.wait_ms);
      row('②-7', '충전소 점 누름 — 정보 칸이 열리고(station.select.map) 거리 누름은 안 생김 · 거리 표시 그대로', '선택 1 · 누름 수 그대로 · 표시 그대로 보임 · 정보 칸 열림',
        ['선택 ' + (counts.select - sel0), '누름 ' + tapsBefore + '→' + a.made.ui_map.taps(), '표시 ' + (!root.hidden), '정보 칸 ' + stOpen].join(' · '),
        counts.select - sel0 === 1 && a.made.ui_map.taps() === tapsBefore && !root.hidden && tapNow().shown && stOpen);
      // ②-8 번호(지도 위 표시) 누름 — 번호의 click 은 번호가, 지도 click 은 '표시 안'이라 빼냄
      const sel1 = counts.select;
      const mk = a.lib.live()[0];
      mk.el.click();
      fire(target[0], target[1], { target: { closest: (q) => (q === UM.tap.skip_selector ? mk.el : null) } });
      await wait(() => counts.select > sel1, A.wait_ms);
      row('②-8', '번호 누름 — 정보 칸 요청만, 거리 누름 안 생김(지도 위 표시 안을 누른 것)', '선택 1 · 누름 수 그대로 · 표시 그대로', ['선택 ' + (counts.select - sel1), '누름 ' + tapsBefore + '→' + a.made.ui_map.taps(), '표시 ' + (!root.hidden)].join(' · '),
        counts.select - sel1 === 1 && a.made.ui_map.taps() === tapsBefore && !root.hidden);
      // ②-9 다시 누르면 지움(정보 칸이 열린 채)
      fire(target[0] + 0.01, target[1]);
      await wait(() => root.hidden && tapNow() && !tapNow().shown, A.wait_ms);
      row('②-9', '지도를 다시 누름 — 표시 사라짐 · 풍선 뺌 · map.pin null · 정보 칸은 그대로 열림', '숨김 · 풍선 0 · pin null · 정보 칸 열림',
        [root.hidden, pop.live().length, JSON.stringify(a.get(TP.ui.pin_piece)), !a.el(US.ids.root).hidden].join(' · '), root.hidden && pop.live().length === 0 && a.get(TP.ui.pin_piece) === null && !a.el(US.ids.root).hidden);
      // ②-10 다시 누르면 다시 보임 → 표시를 눌러 닫기
      fire(target[0], target[1]);
      await wait(() => !root.hidden, A.wait_ms);
      const shownAgain = !root.hidden && pop.live().length === 1;
      root.click();
      await wait(() => root.hidden, A.wait_ms);
      await wait(() => false, A.wait_ms / 4);
      row('②-10', '또 누르면 보임 → 표시(닫기 단추)를 누름 → 사라짐 · 다음 위치에도 그대로 숨김', '보임 → 숨김 · 풍선 0 · tap.close = 그 seq',
        [shownAgain, root.hidden, pop.live().length, JSON.stringify(a.get(TP.ui.close_piece)), tapNow().shown].join(' · '), shownAgain && root.hidden && pop.live().length === 0 && a.get(TP.ui.close_piece).seq === tapNow().seq && tapNow().shown === false);
      // ②-11 '세 곳만'이면 점이 숨어 그 자리 누름이 빈 곳 누름
      a.made.ui_map.pressOnly3();
      qrf = [{ properties: { [UM.others.id_prop]: dotId } }];
      const n0 = a.made.ui_map.taps();
      fire(target[0], target[1]);
      qrf = [];
      await wait(() => !root.hidden, A.wait_ms);
      row('②-11', "'세 곳만'(점 숨김)일 때 — 숨은 점 자리를 눌러도 빈 곳 누름(표시 보임)", '누름 +1 · 보임', ['누름 ' + n0 + '→' + a.made.ui_map.taps(), !root.hidden].join(' · '), a.made.ui_map.taps() === n0 + 1 && !root.hidden);
      a.made.ui_map.pressOnly3();
      // ②-12 운전 화면 그대로
      row('②-12', '운전 화면 그대로 — 속도판 숫자·충전소판 줄', '속도 글 있음 · 줄 3', [a.el(SPD.ids.value).textContent, a.el(UA.ids.list).children.length].join(' · '), !!a.el(SPD.ids.value).textContent && a.el(UA.ids.list).children.length === L.rows);
      // ②-13 로그
      const lt = await a.logText();
      const words = [UM.tap.word, UM.tap.word_pin, TP.ui.word_shown, TP.ui.word_hidden, TP.ui.word_close];
      const miss = words.filter((w) => !lt.includes(w));
      const errs = a.logLines().filter((l) => /tapdist|ui_tap|map_pin/.test(JSON.stringify(l)) && /error|ERROR|실패/.test(JSON.stringify(l)));
      row('②-13', '로그 — 누름·풍선·보임·숨김·닫기가 남고 오류 0', words.join(' · ') + ' · 오류 0', (miss.length ? '빠짐 ' + miss.join(',') : '모두 있음') + ' · 오류 ' + errs.length + ' · 누름 ' + a.made.ui_map.taps() + ' · tap 알림 ' + counts.tap,
        !miss.length && !errs.length);
    } finally {
      a.stop();
    }
  });
}

// ---------- ③ 진짜 크롬 네 창 ----------
async function partChrome() {
  const C = T.chrome;
  // lib_chrome 의 재는 쪽에 '자리 누름'(act.at)만 더한 임시 사본(lib_chrome 자체는 그대로)
  const src = fs.readFileSync(path.join(TOOLS_DIR, 'lib_chrome.mjs'), 'utf8');
  if (!src.includes(C.patch_from)) { row('③', '크롬 도구 사본', '바꿀 줄 있음', '없음', false); return; }
  const tmpDir = path.join(APP, tc.tmp_dir);
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmpLib = path.join(tmpDir, C.tmp_lib);
  fs.writeFileSync(tmpLib, src.split(C.patch_from).join(C.patch_to).split(C.import_from).join(C.import_to), 'utf8');
  const { measureInChrome } = await import(pathToFileURL(tmpLib).href);
  const sel = { ...L.sel, ...C.sel };
  const res = await measureInChrome(tc, APP, { scene: 'S1_고속도로', tick: C.tick, frames: L.frames, sel, ready: L.ready, actions: C.actions, log });
  if (res.error) { row('③', '크롬 재기', '결과', res.error, false); return; }
  fs.writeFileSync(path.join(APP, tc.log.dir, C.json_file), JSON.stringify(res, null, 1), 'utf8');
  const tol = tc.chrome.tol_px;
  for (const fr of res.frames) {
    const checks = fr.steps.map((st, i) => {
      const act = C.actions[i];
      const g = st.got;
      const one = (k) => (g[k] || []).filter((x) => x.shown);
      const tap = one('tap')[0];
      const center = one('center')[0];
      const bad = [];
      if (!st.clicked) bad.push('누를 것 없음');
      // 표시의 둥근 모서리 점은 자기 풍선 껍데기(own_wrap)가 잡힌다 — 그것은 표시 자신으로 본다
      const mine = (h) => h.ok || h.by === C.own_wrap;
      const seen = tap ? (tap.hits || []).filter(mine).length : 0;
      if (act.expect === 'hidden') { if (tap) bad.push('안 사라짐'); }
      else if (!tap) bad.push('표시 안 보임');
      else if (act.expect === 'shown_station' && center && !inside(tap.rect, center.rect, tol) && seen === 0) {
        // 정보 칸이 열려 지도가 줄면 누른 자리가 지도 밖 — 표시는 지도 칸이 잘라 통째로 안 보여야(반쯤 보이면 실패)
        if (!one('station').length) bad.push('정보 칸 안 열림');
        st.hiddenOut = true;
      } else {
        if (center && !inside(tap.rect, center.rect, tol)) bad.push('지도 칸 밖(' + [tap.rect.x, tap.rect.y, tap.rect.w, tap.rect.h].map(Math.round).join(',') + ')');
        for (const k of C.avoid) for (const x of one(k)) if (overlapArea(tap.rect, x.rect) > 0) bad.push(k + ' 겹침');
        for (const h of tap.hits || []) if (!mine(h)) bad.push('표시 가림(' + h.by + ')');
        if (tap.sw > tap.cw + tol) bad.push('표시 잘림 ' + tap.sw + '>' + tap.cw);
        if (tap.rect.h < L.touch_min_px - tol) bad.push('누르는 높이 ' + tap.rect.h);
        if (act.expect === 'shown_station' && !one('station').length) bad.push('정보 칸 안 열림');
      }
      for (const k of C.contents) for (const x of one(k)) for (const h of x.hits || []) if (!h.ok) bad.push(k + ' 가림(' + h.by + ')');
      return { ok: bad.length === 0, text: act.name + ': ' + (bad.length ? bad.slice(0, 5).join(', ') : (act.expect === 'hidden' ? '사라짐' : st.hiddenOut ? '정보 칸 열림 · 지도가 줄어 누른 자리가 지도 밖 → 표시는 지도 칸이 잘라 통째로 숨음(보이는 점 0)' : '보임 · 덮임 0 · 잘림 0 · 높이 ' + Math.round(tap.rect.h) + ' · 「' + tap.text.replace(/\s+/g, ' ') + '」')) };
    });
    row('③ ' + fr.name, '진짜 크롬 — 지도 누름 → 누른 자리 표시: 지도 칸 안 · 양옆 판·아래 띠·지도 단추와 겹침 0 · 표시·판 숫자·저작권 가림 0 · 잘림 0 · 누르는 높이 48 이상 / 표시 눌러 닫기 · 다시 누르면 지움 · 번호 누름은 정보 칸(표시 그대로)',
      '여섯 걸음 모두 기대대로', (fr.ready ? '' : '준비 안 됨 · ') + checks.map((x) => x.text).join(' ┃ '), fr.ready && checks.length === C.actions.length && checks.every((x) => x.ok));
  }
}

const PARTS = { pure: partPure, app: partApp, chrome: partChrome };
async function mainRun() {
  const which = process.argv[2] || 'pure';
  const fn = PARTS[which];
  if (!fn) throw new Error('부분 이름: ' + Object.keys(PARTS).join('|'));
  log.write('시작', { part: which });
  try {
    await fn();
  } catch (e) {
    row('예외', which + ' 부분이 던짐', '없음', String(e && e.stack || e).slice(0, 400), false);
  }
  const table = ['| # | 시험 | 기대 | 실제 | 결과 |', '|---|---|---|---|---|', ...rows.map((r) => '| ' + [r.no, r.title, r.expect, r.actual, r.ok ? tc.pass_word : tc.fail_word].map((x) => String(x).replace(/\|/g, '/').replace(/\n/g, ' ')).join(' | ') + ' |')];
  const text = '# A8 스스로 시험 — ' + which + ' (' + kstText(tc) + ')\n\n' + table.join('\n') + '\n\n' + rows.filter((r) => r.ok).length + '/' + rows.length + ' 통과\n';
  fs.writeFileSync(path.join(APP, tc.log.dir, T.report_prefix + which + '.md'), text, 'utf8');
  process.stdout.write(text);
  log.write('끝', { part: which, pass: rows.filter((r) => r.ok).length, all: rows.length });
  process.exitCode = rows.every((r) => r.ok) ? tc.exit.ok : tc.exit.fail;
}
await mainRun();
