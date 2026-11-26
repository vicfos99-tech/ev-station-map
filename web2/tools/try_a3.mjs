// A3 지도 스스로 시험(가상 창 + 진짜 크롬).
//   node web2/tools/try_a3.mjs            # 전부(약 7분 — 다리가 끝날 때까지)
//   node web2/tools/try_a3.mjs cam|s6|chrome   # 그 부분만(고치는 동안)
// ① S1 카메라 규칙(가짜 지도에 손 조작을 흉내): 따라가기 · 손으로 돌리고 키운 것이 위치가 바뀌어도 그대로 · 손으로 옮기면 따라가기 끔 ·
//    '내 위치' 단추로 내 위치·진행 방향(확대는 그대로, 너무 멀면 최소 확대까지) · 1·2·3번 = 충전소판(지나쳐 바뀌어도) · '세 곳만' 켬·끔 · 다시 열어도 같음
// ② S6 정차·튐·후진에서 카메라가 흔들리지 않음(이어진 가운데 사이 걸음·방향 명령)
// ③ 진짜 크롬: '내 위치'·'세 곳만' 단추가 판·저작권·번호를 가리지 않음, 번호 셋 = 판 줄 셋(같은 차례·같은 key), '세 곳만' 누름
// 표(기대·실제)로 찍고 하나라도 실패면 0 아닌 코드. 기록장 tools/logs/try_a3.log, 표 사본 tools/logs/try_a3_last.md.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadToolsConfig, appDir, toolLog, kstText } from './lib_tools.mjs';
import { testbedInfo, makeSecret, writeSecretFile, startBridge, selectScene, seekScene, fetchWithLines } from './lib_testbed.mjs';
import { sleep, loadBoards, startApp as runApp, waitFor } from './lib_apprun.mjs';
import { measureInChrome, overlapArea } from './lib_chrome.mjs';

const tc = loadToolsConfig();
const T = tc.try_a3;
const L = tc.layout;
const A1 = tc.try_a1;
const APP = appDir(tc);
const log = toolLog(tc, 'try_a3');
const cfgOf = (name) => JSON.parse(fs.readFileSync(path.join(APP, tc.build.config_dir, name + tc.build.config_ext), 'utf8'));
const MAP = cfgOf('config_ui_map');
const CAM = cfgOf('config_mapcam');
const UA = cfgOf('config_ui_ahead');
const HC = cfgOf('config_health');
const ST = cfgOf('config_store');
const { main } = await import(pathToFileURL(path.join(APP, tc.build.src_dir, 'app.js')).href);
const BOARDS = await loadBoards(APP, tc);
let INFO = null;
let FETCH = null;
let SECRET_FILE = null;

const rows = [];
function row(no, title, expect, actual, ok) {
  rows.push({ no, title, expect, actual, ok: !!ok });
  log.write(ok ? '통과' : '실패', { no, title, expect, actual });
}
const wait = (fn, ms) => waitFor(fn, ms, tc.testbed.poll_ms);
function start(opts) {
  return runApp({ app: APP, tc, main, boards: BOARDS }, { secretFile: SECRET_FILE, ...opts, fetchFn: FETCH, stamp: 'try-a3' });
}
async function openAt(scene, tick, opts) {
  await selectScene(INFO, scene, false);
  if (tick) await seekScene(INFO, tick);
  const a = start(opts || {});
  await wait(() => a.stage() && a.stage() !== HC.stages.starting, T.start_wait_ms);
  await wait(() => a.lib.maps[0] && a.lib.maps[0].layers[MAP.dot.layer_id] !== undefined, T.start_wait_ms);
  return a;
}
async function moreFixes(a, n) {
  const k = a.seen.fixes.length;
  await wait(() => a.seen.fixes.length >= k + n, T.fix_wait_ms + n * tc.try_a2ga.tick_ms);
  await sleep(tc.testbed.poll_ms);
}
function distM(a, b) {
  const k = A1.deg_to_rad;
  const c = Math.sin(a[1] * k) * Math.sin(b[1] * k) + Math.cos(a[1] * k) * Math.cos(b[1] * k) * Math.cos((b[0] - a[0]) * k);
  return A1.earth_radius_m * Math.acos(Math.min(1, Math.max(-1, c)));
}
function turn(a, b) {
  const d = Math.abs((((a - b) % CAM.full_turn_deg) + CAM.full_turn_deg) % CAM.full_turn_deg);
  return Math.min(d, CAM.full_turn_deg - d);
}
const lastFix = (a) => a.seen.fixes[a.seen.fixes.length - 1];
const near = (c, f) => c && f && Math.abs(c[0] - f.lng) <= T.center_tol_deg && Math.abs(c[1] - f.lat) <= T.center_tol_deg;
const camText = (m) => '방향 ' + Number(m.cam.bearing).toFixed(1) + ' · 확대 ' + m.cam.zoom + ' · 가운데 ' + (m.cam.center ? m.cam.center.map((x) => x.toFixed(5)).join(',') : '-');
// 번호 표시(살아 있는 Marker) → [{no, key, lng, lat, cls}]
const marks = (a) => a.lib.live().map((mk) => ({ no: mk.el.textContent, key: mk.el.getAttribute(MAP.marks.key_attr), lng: mk.ll[0], lat: mk.ll[1], cls: mk.el.className }));
const panelKeys = (a) => (a.el(UA.ids.list) ? a.el(UA.ids.list).children.map((r) => r.getAttribute(UA.key_attr)) : []);
function marksMatch(a) {
  const v = a.get('ahead');
  const mk = marks(a);
  const items = v && v.items ? v.items : [];
  const ok = items.length === mk.length && items.length > 0 && items.every((it, i) => mk[i].no === String(it.no) && mk[i].key === String(it.key) && mk[i].lng === it.lng && mk[i].lat === it.lat)
    && panelKeys(a).join() === items.map((it) => String(it.key)).join();
  return { ok, text: '번호 ' + mk.map((m) => m.no + ':' + m.key).join(' ') + ' · 판 ' + panelKeys(a).join(' ') + ' · ahead ' + items.map((it) => it.no + '.' + it.name).join(' / ') };
}

// ---------- ① S1 카메라 ----------
async function partCam() {
  const a = await openAt(T.s1.scene, 0);
  await moreFixes(a, T.settle_fixes);
  const count = cfgOf('config_ahead').count;
  await wait(() => { const v = a.get('ahead'); return v && v.items && v.items.length === count && marks(a).length === count; }, T.start_wait_ms);
  const m = a.lib.maps[0];
  let f = lastFix(a);
  let j = m.jumps[m.jumps.length - 1];
  row('①-1', 'S1 따라가기(처음) — 가운데 = 내 위치 · 방향 = 진행 방향 · 확대 ≥ 따라갈 때 최소', '가운데 = 마지막 fix · |방향 − fix 방향| < ' + CAM.bearing_min_change_deg + '° · 확대 ≥ ' + CAM.follow_min_zoom + ' · 효과 없는 이동(jumpTo)',
    camText(m) + ' · fix ' + f.lng.toFixed(5) + ',' + f.lat.toFixed(5) + ' 방향 ' + Number(f.heading_deg).toFixed(1) + ' · 명령 ' + m.jumps.length,
    near(m.cam.center, f) && turn(m.cam.bearing, f.heading_deg) < CAM.bearing_min_change_deg && m.cam.zoom >= CAM.follow_min_zoom && near(j.center, f));
  // 손으로 돌림·키움
  m.user('rotated', { bearing: T.user.bearing });
  m.user('zoomed', { zoom: T.user.zoom });
  const j0 = m.jumps.length;
  await moreFixes(a, T.watch_fixes);
  const after = m.jumps.slice(j0);
  f = lastFix(a);
  const pc = a.get(MAP.cam_piece) || {};
  row('①-2', '손으로 돌리고(' + T.user.bearing + '°) 키운(' + T.user.zoom + ') 뒤 위치가 ' + T.watch_fixes + '번 바뀜 — 방향·확대 굳음, 가운데는 따라감', '방향 명령 0 · 확대 명령 0 · 지도 방향 ' + T.user.bearing + ' · 확대 ' + T.user.zoom + ' · 가운데 = 마지막 fix · map.cam 굳음 둘 참',
    '명령 ' + after.length + '(방향 ' + after.filter((x) => 'bearing' in x).length + ' · 확대 ' + after.filter((x) => 'zoom' in x).length + ') · ' + camText(m) + ' · map.cam ' + JSON.stringify(pc),
    after.length >= T.watch_fixes - 1 && after.every((x) => !('bearing' in x) && !('zoom' in x)) && m.cam.bearing === T.user.bearing && m.cam.zoom === T.user.zoom && near(m.cam.center, f) && pc.bearing_locked === true && pc.zoom_locked === true);
  // 손으로 옮김
  m.user('moved', { center: T.drag_to });
  const j1 = m.jumps.length;
  const mv1 = m.moves.length;
  await moreFixes(a, T.watch_fixes);
  row('①-3', '손으로 옮긴 뒤 — 따라가기 끔(지도는 그 자리, 점만 움직임)', '카메라 명령 0 · 가운데 ' + T.drag_to.join(',') + ' 그대로 · 점 옮김 ≥ ' + T.watch_fixes + ' · map.cam follow 거짓',
    '명령 ' + (m.jumps.length - j1) + ' · ' + camText(m) + ' · 점 옮김 ' + (m.moves.length - mv1) + ' · follow ' + (a.get(MAP.cam_piece) || {}).follow,
    m.jumps.length === j1 && m.cam.center[0] === T.drag_to[0] && m.cam.center[1] === T.drag_to[1] && m.moves.length - mv1 >= T.watch_fixes && (a.get(MAP.cam_piece) || {}).follow === false);
  // '내 위치' 단추
  a.el(MAP.ids.me).click();
  j = m.jumps[m.jumps.length - 1];
  f = lastFix(a);
  const pc2 = a.get(MAP.cam_piece) || {};
  row('①-4', "'내 위치' 단추 — 내 위치·진행 방향으로 되돌림(방향 굳음 풂), 확대는 그대로", '가운데 = 마지막 fix · 방향 = 진행 방향(≠' + T.user.bearing + ') · 확대 ' + T.user.zoom + ' 그대로(명령에 확대 없음) · follow 참 · 방향 굳음 거짓 · 확대 굳음 참',
    '단추 글 ' + JSON.stringify(a.el(MAP.ids.me).textContent) + ' · 명령 ' + JSON.stringify({ c: j && j.center, b: j && j.bearing, z: j && j.zoom }) + ' · ' + camText(m) + ' · map.cam ' + JSON.stringify(pc2),
    a.el(MAP.ids.me).textContent === MAP.texts.me && near(j.center, f) && turn(m.cam.bearing, f.heading_deg) < CAM.bearing_min_change_deg && !('zoom' in j) && m.cam.zoom === T.user.zoom && pc2.follow === true && pc2.bearing_locked === false && pc2.zoom_locked === true);
  const j2 = m.jumps.length;
  await moreFixes(a, T.watch_fixes);
  f = lastFix(a);
  row('①-5', "'내 위치' 뒤 다시 따라감 — 가운데·진행 방향", '명령 ≥ ' + (T.watch_fixes - 1) + ' · 가운데 = 마지막 fix · 방향 = 진행 방향',
    '명령 ' + (m.jumps.length - j2) + ' · ' + camText(m) + ' · fix 방향 ' + Number(f.heading_deg).toFixed(1),
    m.jumps.length - j2 >= T.watch_fixes - 1 && near(m.cam.center, f) && turn(m.cam.bearing, f.heading_deg) < CAM.bearing_min_change_deg);
  // 너무 멀리 줄인 뒤 단추
  m.user('zoomed', { zoom: T.far_zoom });
  a.el(MAP.ids.me).click();
  j = m.jumps[m.jumps.length - 1];
  row('①-6', "너무 멀리 줄인(" + T.far_zoom + ") 뒤 '내 위치' — 설정의 최소 확대까지만 당김", '명령 확대 ' + CAM.follow_min_zoom, '명령 ' + JSON.stringify({ z: j && j.zoom }) + ' · ' + camText(m), j && j.zoom === CAM.follow_min_zoom && m.cam.zoom === CAM.follow_min_zoom);
  // 1·2·3번
  const mm = marksMatch(a);
  const kinds = marks(a).every((x) => x.cls.includes(MAP.marks.kinds[MAP.marks.ahead_kind]));
  row('①-7', '1·2·3번 표시 = 충전소판 앞의 세 곳(같은 차례·같은 곳·좌표)', '번호 3 · 1·2·3 · key·좌표 = ahead · 판 줄 key 같은 차례 · 앞의 충전소 모양',
    mm.text + ' · 모양 ' + (kinds ? MAP.marks.kinds.ahead : '다름'), mm.ok && kinds);
  // '세 곳만'
  const others = () => (m.layers[MAP.others.layer_id] || {})[MAP.others.visibility_key];
  const nOthers = (m.data[MAP.others.source_id] && m.data[MAP.others.source_id].features || []).length;
  const v0 = others();
  a.el(MAP.ids.only3).click();
  const v1 = others();
  const p1 = a.el(MAP.ids.only3).getAttribute(MAP.pressed_attr);
  const mk1 = marks(a).length;
  a.el(MAP.ids.only3).click();
  const v2 = others();
  const p2 = a.el(MAP.ids.only3).getAttribute(MAP.pressed_attr);
  row('①-8', "'세 곳만' 켬·끔 — 다른 충전소 층 숨김(지우지 않음)·번호 셋은 그대로", '다른 충전소 점 > 3 · 처음 ' + MAP.others.shown_word + ' → 켬 ' + MAP.others.hidden_word + '(단추 ' + MAP.yes_word + ', 번호 3) → 끔 ' + MAP.others.shown_word + '(단추 ' + MAP.no_word + ')',
    '점 ' + nOthers + ' · ' + v0 + ' → ' + v1 + '(단추 ' + p1 + ', 번호 ' + mk1 + ') → ' + v2 + '(단추 ' + p2 + ')',
    nOthers > tc.layout.rows && v0 === MAP.others.shown_word && v1 === MAP.others.hidden_word && p1 === MAP.yes_word && mk1 === tc.layout.rows && v2 === MAP.others.shown_word && p2 === MAP.no_word);
  // 다시 열어도 같음: 돌려 굳히고 '세 곳만' 켠 뒤 닫고, 같은 폰 데이터 폴더로 다시 연다
  m.user('rotated', { bearing: T.user.bearing });
  a.el(MAP.ids.only3).click();
  await sleep(tc.testbed.poll_ms);
  const saved = a.disk.files[ST.dir + '/' + ST.keys[MAP.store_key].file];
  a.stop();
  const b = await openAt(T.s1.scene, 0, { disk: a.disk });
  await moreFixes(b, T.settle_fixes);
  const mb = b.lib.maps[0];
  const bj = mb.jumps;
  const pb = b.get(MAP.cam_piece) || {};
  row('①-9', '다시 열어도 같음 — 폰 데이터 폴더의 지도 상태(굳은 방향·확대·세 곳만)', '저장 파일 있음 · 새 지도 처음 방향 ' + T.user.bearing + ' · 위치가 와도 방향 명령 0 · 다른 충전소 층 ' + MAP.others.hidden_word + ' · 단추 ' + MAP.yes_word,
    '파일 ' + (saved ? JSON.parse(saved)[ST.value_key] && JSON.stringify(JSON.parse(saved)[ST.value_key]) : '없음') + ' · 처음 방향 ' + mb.o.bearing + ' · 명령 ' + bj.length + '(방향 ' + bj.filter((x) => 'bearing' in x).length + ') · 층 ' + (mb.layers[MAP.others.layer_id] || {})[MAP.others.visibility_key] + ' · 단추 ' + b.el(MAP.ids.only3).getAttribute(MAP.pressed_attr) + ' · map.cam ' + JSON.stringify(pb),
    !!saved && mb.o.bearing === T.user.bearing && bj.length > 0 && bj.every((x) => !('bearing' in x)) && (mb.layers[MAP.others.layer_id] || {})[MAP.others.visibility_key] === MAP.others.hidden_word && b.el(MAP.ids.only3).getAttribute(MAP.pressed_attr) === MAP.yes_word && pb.bearing_locked === true && pb.only3 === true);
  // '이상해' 기록에 지도 카메라
  const odd = cfgOf('config_ui_odd');
  row('①-10', "'이상해' 기록 조각에 지도 카메라(map.cam)", odd.pieces.join('·') + ' 에 ' + MAP.cam_piece, String(odd.pieces.includes(MAP.cam_piece)), odd.pieces.includes(MAP.cam_piece) && !!b.get(MAP.cam_piece));
  b.stop();
  // 지나쳐 바뀌어도 번호 = 판
  const c = await openAt(T.s1.scene, T.s1.pass_seek);
  await wait(() => c.get('ahead') && c.get('ahead').items && c.get('ahead').items.length, T.start_wait_ms);
  const first = c.get('ahead').items[0].key;
  const changed = await wait(() => { const v = c.get('ahead'); return v && v.items[0] && v.items[0].key !== first; }, T.s1.pass_wait_ms);
  await sleep(UA.interval_ms + tc.testbed.poll_ms);
  const mc = marksMatch(c);
  row('①-11', 'S1 첫 곳을 지나쳐 앞의 세 곳이 바뀐 뒤에도 번호 = 판(같은 조각 하나를 둘이 구독)', '바뀜 · 번호 3 = ahead = 판 줄', (changed ? '바뀜' : '안 바뀜') + ' · ' + mc.text, changed && mc.ok);
  c.stop();
}

// ---------- ② S6 정차·튐·후진 ----------
async function partS6() {
  for (const [i, cs] of T.s6.cases.entries()) {
    const a = await openAt(T.s6.scene, cs.t_s - T.s6.lead_ticks);
    const m = a.lib.maps[0];
    const n = T.s6.lead_ticks + cs.ticks + T.s6.after_ticks;
    await moreFixes(a, n);
    const js = m.jumps.filter((x) => x.center);
    let step = 0;
    for (let k = 1; k < js.length; k += 1) step = Math.max(step, distM(js[k - 1].center, js[k].center));
    const bs = m.jumps.filter((x) => 'bearing' in x).map((x) => x.bearing);
    let tmax = 0;
    for (let k = 1; k < bs.length; k += 1) tmax = Math.max(tmax, turn(bs[k - 1], bs[k]));
    // 방향 명령마다 그것을 낸 위치(같은 때 들어온 fix)의 속도 — 느릴 때(설정 heading_min_kmh 아래: 정차·후진) 방향 명령이 있으면 흔들림
    const fixAt = (t) => a.seen.fixes.reduce((best, f) => (!best || Math.abs(f.at - t) < Math.abs(best.at - t) ? f : best), null);
    const bcmd = m.jumps.filter((x) => 'bearing' in x).map((x) => ({ b: x.bearing, f: fixAt(x.at) }));
    const slowTurns = bcmd.filter((x) => x.f && x.f.speed_kmh < CAM.heading_min_kmh).length;
    const slowFixes = a.seen.fixes.filter((f) => f.speed_kmh < CAM.heading_min_kmh).length;
    const turnOk = slowTurns === 0 && tmax <= T.s6.max_turn_deg && (cs.turn !== 'slow' || slowFixes > 0);
    row('②-' + (i + 1), 'S6 ' + cs.title + '(틱 ' + (cs.t_s - T.s6.lead_ticks) + '부터 ' + n + '틱) — 카메라가 흔들리지 않음',
      '이어진 가운데 사이 가장 큰 걸음 ≤ ' + T.s6.max_step_m + 'm · 느릴 때(시속 ' + CAM.heading_min_kmh + ' 아래) 방향 명령 0 · 이어진 방향 명령 사이 ≤ ' + T.s6.max_turn_deg + '°' + (cs.turn === 'slow' ? ' · 이 창에 느린 위치가 있음' : ''),
      '명령 ' + m.jumps.length + ' · 가장 큰 걸음 ' + step.toFixed(1) + 'm · 방향 명령 ' + bcmd.length + (bcmd.length ? '(' + bcmd.map((x) => x.b.toFixed(1) + '° @시속 ' + (x.f ? x.f.speed_kmh : '-')).join(', ') + ')' : '') + ' · 느릴 때 방향 명령 ' + slowTurns + ' · 가장 큰 돌림 ' + tmax.toFixed(1) + '° · 받은 fix ' + a.seen.fixes.length + '(느린 것 ' + slowFixes + ')',
      js.length >= 2 && step <= T.s6.max_step_m && turnOk);
    a.stop();
  }
}

// ---------- ③ 진짜 크롬 ----------
async function partChrome() {
  const frames = L.frames.filter((f) => T.chrome_frames.includes(f.name));
  const sel = { ...L.sel, ...T.chrome_sel };
  const res = await measureInChrome(tc, APP, { scene: L.scene, tick: T.chrome_tick, frames, sel, ready: { ...L.ready, ...T.chrome_ready }, actions: T.chrome_actions, log });
  const dir = path.join(APP, tc.log.dir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'try_a3_chrome.json'), JSON.stringify(res, null, 1), 'utf8');
  if (res.error) { row('③-0', '진짜 크롬 재기', '결과 옴', res.error, false); return; }
  const contents = [...L.contents, 'marks'];
  const controls = [...L.controls, ...T.chrome_controls];
  for (const fr of res.frames) {
    const g = fr.got || {};
    const all = (nm) => g[nm] || [];
    const covered = [];
    // 번호 표시는 지도 칸 안에 든 것만(밖은 보일 수 없음) — 지도 안 번호가 하나 이상 있어야. 번호는 동그라미라 상자 귀퉁이는 지도 그림 — 가운데 점만 본다
    const mapRect = (all('slot_center')[0] || {}).rect;
    const inMap = (e) => mapRect && e.rect.x >= mapRect.x && e.rect.y >= mapRect.y && e.rect.x + e.rect.w <= mapRect.x + mapRect.w && e.rect.y + e.rect.h <= mapRect.y + mapRect.h;
    const marksIn = all('marks').filter(inMap).length;
    for (const nm of contents) all(nm).forEach((e, i) => { if (nm === 'marks' && !inMap(e)) return; if (!e.shown) covered.push(nm + '[' + i + '] 안 보임'); for (const h of (nm === 'marks' ? (e.hits || []).slice(0, 1) : e.hits || [])) if (!h.ok) covered.push(nm + '[' + i + '] (' + h.x + ',' + h.y + ') ← ' + h.by); });
    const overlaps = [];
    for (const cn of T.chrome_controls) for (const c of all(cn)) for (const nm of [...contents, 'attrib_box', 'speed_root']) for (const [i, e] of all(nm).entries()) { const ar = overlapArea(c.rect, e.rect); if (c.shown && ar > 0) overlaps.push(cn + '×' + nm + '[' + i + ']'); }
    const btnH = T.chrome_controls.map((nm) => (all(nm)[0] ? Math.round(all(nm)[0].rect.h) : 0));
    row('③ ' + fr.name, "진짜 크롬 — '내 위치'·'세 곳만' 단추가 보이고 판·저작권·번호를 가리지 않음(누르는 높이 ≥ " + L.touch_min_px + ')', '지도 안 번호 ≥ 1 · 가림 0 · 겹침 0 · 단추 2 보임 · 높이 ≥ ' + L.touch_min_px,
      '지도 안 번호 ' + marksIn + ' · 가림 ' + covered.length + (covered.length ? '(' + covered.slice(0, 4).join(' / ') + ')' : '') + ' · 겹침 ' + overlaps.length + (overlaps.length ? '(' + overlaps.slice(0, 4).join(' / ') + ')' : '') + ' · 단추 ' + T.chrome_controls.map((nm, i) => (all(nm)[0] && all(nm)[0].shown ? '보임 ' + btnH[i] + 'px' : '안 보임')).join(', '),
      fr.ready && marksIn >= 1 && covered.length === 0 && overlaps.length === 0 && T.chrome_controls.every((nm) => all(nm)[0] && all(nm)[0].shown) && btnH.every((h) => h >= L.touch_min_px));
    const mk = all('marks');
    const rk = all('ahead_rows').map((r) => r.attrs['data-key']);
    row('③ ' + fr.name + ' 번호', '진짜 크롬 — 지도 위 번호 셋 = 충전소판 줄 셋(같은 차례·같은 key)', '번호 1·2·3 · key = 판 줄 key',
      '번호 ' + mk.map((x) => x.text + ':' + x.attrs['data-key']).join(' ') + ' · 판 ' + rk.join(' '),
      mk.length === L.rows && mk.every((x, i) => x.text === String(i + 1) && x.attrs['data-key'] === rk[i]));
    const st = (fr.steps || [])[0];
    const sg = st ? st.got : {};
    const before = ((g.map_only3 || [])[0] || { attrs: {} }).attrs['aria-pressed'];
    const afterP = ((sg.map_only3 || [])[0] || { attrs: {} }).attrs['aria-pressed'];
    row('③ ' + fr.name + ' 세 곳만', "진짜 크롬 — '세 곳만' 누름 → 눌림 표시가 누르기 전과 반대 · 번호 셋 그대로(창 둘이 같은 폰 데이터 폴더라 앞 창에서 켠 것이 이어질 수 있음)", '눌림 바뀜(' + MAP.no_word + '↔' + MAP.yes_word + ') · 번호 3',
      st ? '누름 ' + st.clicked + ' · 눌림 ' + before + ' → ' + afterP + ' · 글 ' + JSON.stringify(((sg.map_only3 || [])[0] || {}).text) + ' · 번호 ' + (sg.marks || []).length : '없음',
      st && st.clicked && [MAP.yes_word, MAP.no_word].includes(before) && afterP !== before && [MAP.yes_word, MAP.no_word].includes(afterP) && (sg.marks || []).length === L.rows);
  }
}

async function main2() {
  log.write('시작', {});
  const only = process.argv[2];
  if (!only || only !== 'chrome') {
    INFO = testbedInfo(tc, APP);
    const secret = makeSecret(tc);
    const sec = writeSecretFile(tc, secret);
    SECRET_FILE = sec.file;
    const bridge = await startBridge(tc, INFO, T.run_seconds, secret);
    FETCH = fetchWithLines(tc, INFO, secret);
    try {
      if (!only || only === 'cam') await partCam();
      if (!only || only === 's6') await partS6();
    } finally {
      log.write('다리 끝 기다림', {});
      // (정비 가) 한도 타이머는 다리가 끝나면 지운다 — 남겨 두면 시험이 끝난 뒤에도 그 시간만큼 프로세스가 안 끝남
      let guard = null;
      const code = await Promise.race([bridge.waitExit(), new Promise((res) => { guard = setTimeout(() => res('timeout'), T.run_seconds * tc.view_s1.ms_per_s + T.exit_grace_ms); })]);
      clearTimeout(guard);
      if (code === 'timeout') bridge.proc.kill();
      row('끝', '다리가 시험 모드 시간 뒤 스스로 끝남', '종료 코드 0', String(code), code === 0);
      fs.rmSync(sec.dir, { recursive: true, force: true });
    }
  }
  if (!only || only === 'chrome') await partChrome();
}

function printTable() {
  const lines = ['| # | 시험 | 기대 | 실제 | 결과 |', '|---|---|---|---|---|'];
  for (const r of rows) lines.push('| ' + [r.no, r.title, r.expect, r.actual, r.ok ? tc.pass_word : tc.fail_word].map((s) => String(s).replace(/\|/g, '/').replace(/\n/g, ' ⏎ ')).join(' | ') + ' |');
  const ok = rows.length > 0 && rows.every((r) => r.ok);
  lines.push('', 'A3 스스로 시험: ' + (ok ? tc.pass_word : tc.fail_word) + ' (' + rows.filter((r) => r.ok).length + ' / ' + rows.length + ') — ' + kstText(tc));
  const text = lines.join('\n');
  console.log(text);
  const dir = path.join(APP, tc.log.dir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, T.report_file), text + '\n', 'utf8');
  return ok;
}

try {
  await main2();
} catch (e) {
  log.write('예외', { error: String(e && e.stack || e) });
  console.error(e);
  rows.push({ no: '예외', title: String(e && e.message), expect: '-', actual: '-', ok: false });
}
const ok = printTable();
log.write('끝', { result: ok ? tc.pass_word : tc.fail_word });
process.exitCode = ok ? tc.exit.ok : tc.exit.fail;
