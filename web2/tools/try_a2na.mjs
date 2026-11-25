// A2-나 스스로 시험(브라우저 없이 node 에서 앱을 조립해 테스트 베드 다리에 붙인다).
//   node web2/tools/try_a2na.mjs
// 다리를 시험 모드(try_a2na.run_seconds 초)로 띄우고, 이번만 쓰는 앱 비밀 값을 저장소 밖 임시 파일로 만든다(선 파일은 try_a2ga 처럼 대신 답).
// ① S1  앞의 세 곳(이름·남은 거리)이 장면과 맞음 · 충전소판 줄 · 지나치면 다음 곳이 올라옴
// ② S3  하행·상행에서 같은 휴게소(죽암)의 맞는 방향 충전소만
// ③ S4  고속도로 밖에서 '주변' 세 곳(곧은 거리 — 시험이 따로 셈한 가까운 셋과 같음)
// ④ S5  충전기 상태가 바뀌고 목록을 다시 받아도 충전소판이 깨지지 않음
// ⑤ '이상해' 누름 — 폰 데이터 폴더에 파일이 쌓이고 기록장에 한 줄 · 메모 거절 · 보관 개수 · 네트워크로 안 나감
// ⑥ 위치 권한 안내 — 시험 흐름이면 안 뜸 · 기기 GPS 권한 꺼짐이면 뜸 · 위치가 오면 닫힘
// ⑦ E4  빌드한 한 파일에 두 판이 뜸 · 판 하나(충전소판/속도판)를 빼고 지어도 조립·ui_drive·ui_boards 를 안 고치고 남은 판이 뜸
// ⑧ 속도판 세 자리(try_speedfit 의 표 + 앱 안의 왼편 자리 폭)
// 표(기대·실제)로 찍고 하나라도 실패면 0 아닌 코드. 기록장 tools/logs/try_a2na.log, 표 사본 tools/logs/try_a2na_last.md.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { loadToolsConfig, appDir, toolLog, kstText, TOOLS_DIR } from './lib_tools.mjs';
import { testbedInfo, makeSecret, writeSecretFile, startBridge, selectScene, seekScene, fetchWithLines } from './lib_testbed.mjs';
import { sleep, fakeDoc, fakeMapLib, fakeOpfs, loadBoards, startApp as runApp, waitFor } from './lib_apprun.mjs';
import { speedFitRows } from './try_speedfit.mjs';

const tc = loadToolsConfig();
const T = tc.try_a2na;
const A1 = tc.try_a1;
const APP = appDir(tc);
const log = toolLog(tc, 'try_a2na');
const { main } = await import(pathToFileURL(path.join(APP, tc.build.src_dir, 'app.js')).href);
const BOARDS = await loadBoards(APP, tc);
const cfgOf = (name, dir) => JSON.parse(fs.readFileSync(path.join(dir || APP, tc.build.config_dir, name + tc.build.config_ext), 'utf8'));
const LOGW = cfgOf('config_log').words;
const word = (k) => LOGW[k] || k;
const US = cfgOf('config_ui_status');
const HC = cfgOf('config_health');
const SP = cfgOf('config_ui_speed');
const AH = cfgOf('config_ahead');
const UA = cfgOf('config_ui_ahead');
const UB = cfgOf('config_ui_boards');
const UO = cfgOf('config_ui_odd');
const UL = cfgOf('config_ui_locate');
const ST = cfgOf('config_store');
const FC = cfgOf('config_formcheck');
const RS = cfgOf('config_relay_stations');
const LOC = cfgOf('config_locate');
const DRIVE = cfgOf('config_ui_drive');
const MAP = cfgOf('config_ui_map');
let INFO = null;
let FETCH = null;
let SECRET_FILE = null;
let LINE = null;

const rows = [];
function row(no, title, expect, actual, ok) {
  rows.push({ no, title, expect, actual, ok: !!ok });
  log.write(ok ? '통과' : '실패', { no, title, expect, actual });
}

function start(opts) {
  return runApp({ app: APP, tc, main, boards: BOARDS }, { secretFile: SECRET_FILE, ...opts, fetchFn: FETCH, stamp: 'try-a2na' });
}
const wait = (fn, ms) => waitFor(fn, ms, tc.testbed.poll_ms);
async function openAt(scene, tick, opts) {
  await selectScene(INFO, scene, false);
  if (tick) await seekScene(INFO, tick);
  const a = start(opts || {});
  await wait(() => a.stage() && a.stage() !== HC.stages.starting, T.start_wait_ms);
  return a;
}
function logCount(a, w) {
  return a.logLines().filter((l) => l.includes(tc.log.sep + word(w) + tc.log.sep)).length;
}
const compact = (s) => String(s).replace(/\s+/g, '');
const sceneOf = (name) => JSON.parse(fs.readFileSync(path.join(path.resolve(path.dirname(INFO.cfgPath), INFO.tb.scenes.dir), name + tc.build.config_ext), 'utf8'));

// 장면의 휴게소(rest) 가운데 이 방향(선 방향 = 선 파일의 direction 과 같은 방향)·내 km 앞에 있는 곳 → 가까운 차례
function expectedAhead(scene, km, dir) {
  const fwd = dir === LOC.dir_words.forward;
  return scene.stations
    .filter((s) => s.kind === 'rest' && s.line === LINE.name && ((s.direction === LINE.direction) === fwd))
    .map((s) => ({ name: s.name, km: s.km, rem: fwd ? s.km - km : km - s.km }))
    .filter((x) => x.rem >= -AH.pass_margin_km)
    .sort((a, b) => a.rem - b.rem)
    .slice(0, AH.count);
}
// 앱의 줄과 장면 기대를 견줌: 이름(빈칸 뺌) 같고 남은 거리 차이 ≤ dist_tol
function matchAhead(items, exp) {
  const diffs = exp.map((e, i) => (items[i] ? Math.abs(items[i].dist_km - Math.max(0, e.rem)) : Infinity));
  const namesOk = items.length === exp.length && exp.every((e, i) => compact(items[i].name) === compact(e.name));
  return { ok: namesOk && diffs.every((d) => d <= T.dist_tol_km), maxDiff: Math.max(0, ...diffs) };
}
const itemsText = (items) => (items || []).map((i) => i.no + '.' + i.name + ' ' + i.dist_km + (i.straight ? '(직선)' : '')).join(' / ');
// 충전소판 줄(가상 창) → [{no, name, kind, ops, dist}]
function panelRows(doc) {
  const list = doc.els[UA.ids.list];
  if (!list) return null;
  return list.children.map((r) => {
    const t = r.children.map((p) => p.textContent);
    return { no: t[0], name: t[1], kind: t[2], ops: t[3], dist: t[4] };
  });
}
// 곧은 거리(km) — 앱의 Geo 를 쓰지 않고 따로(구면 코사인)
function straightKm(a, b) {
  const k = A1.deg_to_rad;
  const c = Math.sin(a.lat * k) * Math.sin(b.lat * k) + Math.cos(a.lat * k) * Math.cos(b.lat * k) * Math.cos((b.lng - a.lng) * k);
  return A1.earth_radius_m * Math.acos(Math.min(1, Math.max(-1, c))) / tc.try_a2na.m_per_km;
}

// 빌드한 index.html 을 가상 창에서(지도 라이브러리만 가짜) ms 동안 돌린다(try_a2ga 와 같은 길)
async function runPage(outDir, ms) {
  const html = fs.readFileSync(path.join(outDir, tc.build.out_file), 'utf8');
  const vendorHead = fs.readFileSync(path.join(APP, tc.build.vendor_js[0]), 'utf8').slice(0, T.vendor_head_chars);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).filter((s) => !s.trimStart().startsWith(vendorHead.trimStart()));
  const doc = fakeDoc([html]);
  const opfs = fakeOpfs();
  const lib = fakeMapLib(MAP.tile_source_id);
  const timers = [];
  let closed = false;
  const ctx = {
    document: doc, navigator: { storage: opfs.storage, geolocation: null }, maplibregl: lib,
    console: { error: () => {}, log: () => {} },
    fetch: (u, init) => (closed ? Promise.reject(new Error('closed')) : FETCH(u, init)), TextDecoder, AbortController, URL, Blob, Response,
    setTimeout: (f, t) => { if (closed) return null; const h = setTimeout(f, t); timers.push(h); return h; }, clearTimeout,
    setInterval: (f, t) => { if (closed) return null; const h = setInterval(f, t); timers.push(h); return h; }, clearInterval,
    innerWidth: 1280, innerHeight: 720, listeners: {},
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
  };
  vm.createContext(ctx);
  ctx.window = ctx;
  for (const s of scripts) vm.runInContext(s, ctx);
  const st = doc.els[US.element_id];
  await wait(() => st.getAttribute(US.stage_attr) === HC.stages.good, T.start_wait_ms);
  await sleep(ms);
  closed = true;
  for (const h of timers) { clearTimeout(h); clearInterval(h); }
  await sleep(tc.testbed.poll_ms);
  return { doc, stage: st.getAttribute(US.stage_attr), driveHidden: doc.els[DRIVE.root_id].hidden, pageLog: Object.values(opfs.files).join('') };
}

function build(outDir, appArg) {
  const argsList = [path.join(TOOLS_DIR, 'build.mjs'), '--out', outDir, '--secret', SECRET_FILE];
  if (appArg) argsList.push('--app', appArg);
  const r = spawnSync(process.execPath, argsList, { encoding: 'utf8' });
  if (r.status !== tc.exit.ok) throw new Error('빌드 실패: ' + (r.stderr || r.stdout));
  return r.stdout.trim();
}

// 판 하나(name)의 파일 다섯(모듈·화면 조각·모양·설정·꼴 표)을 사본에서 지운다
function removeBoard(copy, name) {
  const files = [
    path.join(tc.build.src_dir, name + tc.build.module_ext),
    path.join(tc.build.src_dir, tc.build.view_prefix + name + tc.build.view_ext),
    path.join(tc.build.src_dir, tc.build.style_prefix + name + tc.build.style_ext),
    path.join(tc.build.config_dir, 'config_' + name + tc.build.config_ext),
    path.join(tc.build.shape_dir, 'config_' + name + tc.build.shape_ext),
  ];
  for (const f of files) fs.rmSync(path.join(copy, f));
  return files.length;
}

async function main2() {
  log.write('시작', {});
  INFO = testbedInfo(tc, APP);
  const secret = makeSecret(tc);
  const sec = writeSecretFile(tc, secret);
  SECRET_FILE = sec.file;
  LINE = JSON.parse(fs.readFileSync(path.join(path.resolve(path.dirname(INFO.cfgPath), INFO.tb.scenes.lines_dir), Object.values(tc.testbed.lines_shim)[0] + INFO.tb.scenes.line_suffix), 'utf8'));
  const bridge = await startBridge(tc, INFO, T.run_seconds, secret);
  FETCH = fetchWithLines(tc, INFO, secret);
  try {
    // ---------- ① S1 ----------
    const s1 = sceneOf(T.s1.scene);
    const a = await openAt(T.s1.scene, 0);
    await wait(() => { const v = a.get('ahead'); return v && v.items && v.items.length === AH.count; }, T.start_wait_ms);
    await sleep(T.s1.listen_ms);
    const mounted = a.made.ui_boards ? a.made.ui_boards.mounted() : [];
    const right = a.el(UB.slots.right);
    const left = a.el(UB.slots.left);
    // 왼편 자리 가장 좁은 폭: 고칠 것 ⑦(세로 창도 같은 배치) 뒤로는 min(px, 창 폭 비율) — 설정에서 만든 글과 견줌
    const minLeft = UB.slot_min_css.split(UB.px_mark).join(UB.slot_min_px.left + UB.px_unit).split(UB.vw_mark).join(UB.slot_min_vw.left + UB.vw_unit);
    row('①-1', 'S1 켜기 — 두 판 꽂힘(충전소판 오른편 · 속도판 왼편) · 왼편 자리 가장 좁은 폭', '좋음 · ui_ahead·ui_speed · 오른편 상자 1 · 왼편 상자 1 · 왼편 min-width ' + minLeft,
      a.stage() + ' · ' + JSON.stringify(mounted) + ' · 오른편 ' + (right ? right.children.length : '-') + ' · 왼편 ' + (left ? left.children.length : '-') + ' · min-width ' + (left && left.style.minWidth),
      a.stage() === HC.stages.good && mounted.includes('ui_ahead') && mounted.includes('ui_speed') && right && right.children.length === 1 && left && left.children.length === 1 && left.style.minWidth === minLeft);
    const v1 = a.get('ahead');
    const e1 = expectedAhead(s1, v1.km, v1.dir);
    const m1 = matchAhead(v1.items, e1);
    row('①-2', 'S1 앞의 세 곳 = 장면(부산 방향 휴게소, 내 km ' + v1.km + ' 앞, 가까운 차례)', e1.map((e) => e.name + ' ' + Math.max(0, e.rem).toFixed(1)).join(' / ') + ' · 거리 차이 ≤ ' + T.dist_tol_km,
      v1.mode + ' · ' + v1.dir + ' · ' + itemsText(v1.items) + ' · 가장 큰 차이 ' + m1.maxDiff.toFixed(2), v1.mode === AH.modes.ahead && v1.dir === LOC.dir_words.forward && m1.ok);
    const pr = panelRows(a.doc) || [];
    const prOk = pr.length === v1.items.length && pr.every((p, i) => p.no === String(i + 1) && p.name === v1.items[i].name && p.kind === UA.texts.kinds.rest && p.dist.endsWith(UA.texts.km_unit) && !p.dist.includes(UA.texts.straight) && p.ops.length > 0);
    row('①-3', 'S1 충전소판 줄(가상 창) — 번호·이름·종류·업체·남은 거리', '줄 ' + AH.count + ' · 머리 "' + UA.texts.head_ahead + '" · 종류 "' + UA.texts.kinds.rest + '" · 거리 "… ' + UA.texts.km_unit + '"(직선 아님)',
      JSON.stringify(a.el(UA.ids.head) && a.el(UA.ids.head).textContent) + ' · ' + pr.map((p) => [p.no, p.name, p.kind, p.ops, p.dist].join('|')).join(' / '),
      prOk && a.el(UA.ids.head).textContent === UA.texts.head_ahead && a.el(UA.ids.root).getAttribute(UA.mode_attr) === AH.modes.ahead);
    const first = v1.items[0];
    const bn = a.get(UB.needs_piece);
    row('①-4', 'S1 판 요구(board.needs)에 ahead 간격', 'ahead ' + UA.interval_ms + 'ms', JSON.stringify(bn && bn.topics), bn && bn.topics && bn.topics[UA.ahead_piece] === UA.interval_ms);
    a.stop();
    // 지나침: 첫 곳(기흥) 앞 틱으로 옮겨 지나칠 때까지 본다
    const b = await openAt(T.s1.scene, T.s1.pass_seek);
    const firstName = first ? first.name : null;
    const passed = await wait(() => { const v = b.get('ahead'); return v && v.items && v.items.length && v.items[0].name !== firstName && b.seen.ahead.some((x) => x.v && x.v.items && x.v.items[0] && x.v.items[0].name === firstName); }, T.s1.pass_wait_ms);
    const hist = b.seen.ahead.map((x) => x.v).filter((v) => v && v.items && v.items.length);
    const swi = hist.findIndex((v) => v.items[0].name !== firstName && hist.slice(0, hist.indexOf(v)).some((w) => w.items[0].name === firstName));
    const before = swi > 0 ? hist[swi - 1] : null;
    const after = swi >= 0 ? hist[swi] : null;
    const firstKm = s1.stations.find((s) => compact(s.name) === compact(firstName)).km;
    const vb = b.get('ahead');
    const eb = vb ? expectedAhead(s1, vb.km, vb.dir) : [];
    const mb = vb ? matchAhead(vb.items, eb) : { ok: false, maxDiff: Infinity };
    row('①-5', 'S1 지나치면 빠지고 다음 곳이 올라옴(' + firstName + ' km ' + firstKm + ')', '빠지는 때 내 km ≈ ' + firstKm + ' + 여유 ' + AH.pass_margin_km + '(±' + T.s1.pass_km_tol + ') · 빠지기 전 거리 0 · 뒤의 세 곳 = 장면',
      (passed ? '빠짐' : '안 빠짐') + ' · 빠지기 전 ' + (before ? before.km + ' ' + itemsText(before.items) : '-') + ' · 빠진 뒤 ' + (after ? after.km + ' ' + itemsText(after.items) : '-') + ' · 지금 ' + (vb ? itemsText(vb.items) : '-') + ' (차이 ' + mb.maxDiff.toFixed(2) + ')',
      passed && after && before && Math.abs(after.km - (firstKm + AH.pass_margin_km)) <= T.s1.pass_km_tol && before.items[0].dist_km === 0 && mb.ok && vb.items.length === AH.count);
    b.stop();

    // ---------- ② S3 ----------
    const s3 = sceneOf(T.s3.scene);
    for (const [i, cs] of T.s3.cases.entries()) {
      const c = await openAt(T.s3.scene, cs.seek);
      await wait(() => { const v = c.get('ahead'); return v && v.dir === LOC.dir_words[cs.dir] && v.items && v.items.length; }, T.start_wait_ms);
      await sleep(T.s3.listen_ms);
      const v = c.get('ahead');
      const e = v ? expectedAhead(s3, v.km, v.dir) : [];
      const m = v ? matchAhead(v.items, e) : { ok: false, maxDiff: Infinity };
      const wrong = v ? v.items.filter((it) => it.dir !== v.dir).length : -1;
      row('②-' + (i + 1), 'S3 ' + cs.title + ' (틱 ' + cs.seek + '부터)', '방향 ' + cs.dir + ' · ' + e.map((x) => x.name + ' ' + Math.max(0, x.rem).toFixed(1)).join(' / ') + ' · 다른 방향 충전소 0',
        (v ? v.dir + ' · km ' + v.km + ' · ' + itemsText(v.items) + ' · 다른 방향 ' + wrong + ' · 차이 ' + m.maxDiff.toFixed(2) : '-'),
        v && v.dir === LOC.dir_words[cs.dir] && m.ok && wrong === 0 && e.length === cs.expect_count);
      c.stop();
    }

    // ---------- ③ S4 ----------
    const s4 = sceneOf(T.s4.scene);
    const d = await openAt(T.s4.scene, T.s4.seek);
    await wait(() => { const v = d.get('ahead'); return v && v.mode; }, T.start_wait_ms);
    const v4a = d.get('ahead');
    row('③-1', 'S4 나들목 전(틱 ' + T.s4.seek + ') — 아직 앞의 충전소', 'ahead · ' + expectedAhead(s4, v4a ? v4a.km : 0, LOC.dir_words.forward).map((x) => x.name).join(' / '),
      v4a ? v4a.mode + ' · km ' + v4a.km + ' · ' + itemsText(v4a.items) : '-',
      v4a && v4a.mode === AH.modes.ahead && matchAhead(v4a.items, expectedAhead(s4, v4a.km, v4a.dir)).ok);
    const around = await wait(() => { const v = d.get('ahead'); return v && v.mode === AH.modes.around; }, T.s4.around_wait_ms);
    await sleep(T.s4.listen_ms);
    const v4 = d.get('ahead');
    const fix4 = d.seen.fixes.find((f) => v4 && f.t === v4.t) || d.get('fix');
    const aroundSt = s4.stations.filter((s) => s.kind === T.s4.around_kind);
    const near = aroundSt.map((s) => ({ name: s.name, km: straightKm(fix4, { lat: s.loc[0], lng: s.loc[1] }) })).sort((x, y) => x.km - y.km).slice(0, AH.count);
    const posAt = d.seen.pos.find((p) => p && v4 && p.t === v4.t);
    const swi4 = d.seen.ahead.findIndex((x) => x.v && x.v.mode === AH.modes.around);
    const posSwitch = swi4 >= 0 ? d.seen.pos.filter((p) => p && p.t === d.seen.ahead[swi4].v.t)[0] : null;
    const ok4 = around && v4 && v4.items.length === AH.count && v4.items.every((it, i) => it.straight && compact(it.name) === compact(near[i].name) && Math.abs(it.dist_km - near[i].km) <= T.s4.dist_tol_km);
    row('③-2', "S4 고속도로 밖 — '주변' 세 곳(곧은 거리, 시험이 따로 셈한 가까운 셋)", '주변 · ' + near.map((n) => n.name + ' ' + n.km.toFixed(1)).join(' / ') + ' · 휴게소 없음 · 바뀐 때 선에서 > ' + AH.around_after_m + 'm',
      (around ? '바뀜' : '안 바뀜') + ' · ' + (v4 ? v4.mode + ' · ' + itemsText(v4.items) : '-') + ' · 바뀐 때 선에서 ' + (posSwitch ? posSwitch.off_m : '-') + 'm · 지금 ' + (posAt ? posAt.off_m : '-') + 'm',
      ok4 && posSwitch && posSwitch.off_m > AH.around_after_m);
    const pr4 = panelRows(d.doc) || [];
    row('③-3', "S4 충전소판 — '주변' 꼬리표 · '직선' 거리", '머리 "' + UA.texts.head_around + '" · 줄마다 "' + UA.texts.around_tag + '" · "' + UA.texts.straight + ' … ' + UA.texts.km_unit + '"',
      JSON.stringify(d.el(UA.ids.head) && d.el(UA.ids.head).textContent) + ' · ' + pr4.map((p) => [p.no, p.name, p.kind, p.dist].join('|')).join(' / '),
      pr4.length === AH.count && d.el(UA.ids.head).textContent === UA.texts.head_around && pr4.every((p) => p.kind === UA.texts.around_tag && p.dist.startsWith(UA.texts.straight)) && d.el(UA.ids.root).getAttribute(UA.mode_attr) === AH.modes.around);
    d.stop();

    // ---------- ④ S5 ----------
    const o = cfgOf('config_relay_stations');
    o.refresh_ms = T.refresh_override_ms;
    const e5 = await openAt(T.s5.scene, T.s5.seek, { overrides: { config_relay_stations: o } });
    const pubs0 = e5.seen.stations.length;
    const ah0 = e5.seen.ahead.length;
    await sleep(T.s5.listen_ms);
    const counts = e5.seen.ahead.slice(ah0).map((x) => (x.v && x.v.items ? x.v.items.length : -1));
    const pr5 = panelRows(e5.doc) || [];
    row('④-1', 'S5 충전기 상태 바뀜(틱 ' + T.s5.change_t_s + ') · 목록 다시 받기 동안 충전소판', '목록 새로 냄 ≥ 2 · ahead 늘 ' + AH.count + '곳 · 판 줄 ' + AH.count + ' · 판 보이기 실패 0 · 앱 좋음',
      '목록 새로 냄 ' + (e5.seen.stations.length - pubs0) + ' · ahead ' + counts.length + '번(곳 수 ' + [...new Set(counts)].join(',') + ') · 판 줄 ' + pr5.length + ' · 실패 ' + logCount(e5, 'board_show_failed') + ' · ' + e5.stage(),
      e5.seen.stations.length - pubs0 >= T.s5.min_refresh && counts.length > 0 && counts.every((n) => n === AH.count) && pr5.length === AH.count && logCount(e5, 'board_show_failed') === 0 && e5.stage() === HC.stages.good);
    e5.stop();

    // ---------- ⑤ '이상해' ----------
    const so = cfgOf('config_store');
    so.records[UO.record_kind].keep = T.odd.keep_override;
    const f = await openAt(T.odd.scene, T.odd.seek, { overrides: { config_store: so } });
    await wait(() => f.get('ahead') && f.get('speed'), T.start_wait_ms);
    // 데이터 폴더의 기록 파일만 — 목록 파일과 다른 저장 키 파일(A5 의 제한 속도 사본 limit.json·A3 의 mapcam.json 등 config_store.keys)은 뺀다
    const keyFiles = new Set(Object.values(ST.keys).map((k) => ST.dir + '/' + k.file));
    const oddFiles = () => Object.keys(f.disk.files).filter((k) => k.startsWith(ST.dir + '/') && !k.endsWith('/' + ST.records[UO.record_kind].index_file) && !keyFiles.has(k));
    const indexOf = () => { const t = f.disk.files[ST.dir + '/' + ST.records[UO.record_kind].index_file]; return t ? JSON.parse(t) : []; };
    const callsBefore = f.fetchCalls.length;
    const press = async (memo) => {
      const n = logCount(f, 'odd_saved') + logCount(f, 'odd_memo_bad') + logCount(f, 'odd_save_failed');
      f.el(UO.ids.memo).value = memo;
      f.el(UO.ids.button).click();
      await wait(() => logCount(f, 'odd_saved') + logCount(f, 'odd_memo_bad') + logCount(f, 'odd_save_failed') > n, T.odd.press_wait_ms);
      await sleep(tc.testbed.poll_ms);
    };
    row('⑤-0', "'이상해' 단추 보임(운전 화면이 뜬 뒤)", '보임 · 글 "' + UO.texts.button + '"', (f.el(UO.ids.root).hidden ? '숨음' : '보임') + ' · ' + JSON.stringify(f.el(UO.ids.button).textContent),
      !f.el(UO.ids.root).hidden && f.el(UO.ids.button).textContent === UO.texts.button);
    await press('');
    const files1 = oddFiles();
    const rec = files1.length ? JSON.parse(f.disk.files[files1[0]]) : null;
    const pc = rec && rec[ST.value_key] && rec[ST.value_key].pieces;
    const savedLines = f.logLines().filter((l) => l.includes(word('odd_saved')));
    const fileName = files1.length ? files1[0].split('/').pop() : '';
    row('⑤-1', "'이상해' 누름(메모 없음) — 폰 데이터 폴더에 파일 하나 · 기록장 한 줄", '파일 1(' + UO.file_pattern + ') · 판 ' + ST.records[UO.record_kind].v + ' · 조각 ' + UO.pieces.join('·') + ' 가운데 fix·pos·speed·ahead 값 있음 · 기록장 "' + word('odd_saved') + '" 1줄에 시각·파일 이름 · 쪽지 "기록함 …"',
      '파일 ' + files1.length + ' ' + fileName + ' · 판 ' + (rec && rec[ST.version_key]) + ' · 조각 ' + (pc ? Object.keys(pc).filter((k) => pc[k] !== null).join('·') : '-') + ' · 기록장 ' + savedLines.length + ' ' + JSON.stringify((savedLines[0] || '').split(tc.log.sep).slice(-1)[0]) + ' · 쪽지 ' + JSON.stringify(f.el(UO.ids.note).textContent),
      files1.length === 1 && rec && rec[ST.version_key] === ST.records[UO.record_kind].v && pc && ['fix', 'pos', 'speed', 'ahead'].every((k) => pc[k]) && savedLines.length === 1 && savedLines[0].includes(fileName) && f.el(UO.ids.note).textContent.startsWith(UO.texts.saved.split(UO.time_mark)[0]) && indexOf().length === 1);
    await press(T.odd.memo_ok);
    const files2 = oddFiles();
    const rec2 = files2.filter((k) => !files1.includes(k)).map((k) => JSON.parse(f.disk.files[k]))[0];
    row('⑤-2', "'이상해' 누름(메모 \"" + T.odd.memo_ok + '") — 메모가 기록에', '파일 2 · 새 기록 메모 = 넣은 글', '파일 ' + files2.length + ' · 메모 ' + JSON.stringify(rec2 && rec2[ST.value_key].memo),
      files2.length === 2 && rec2 && rec2[ST.value_key].memo === T.odd.memo_ok);
    const longMemo = T.odd.long_char.repeat(FC.fields[UO.memo_field].max + 1);
    for (const [no, memo, why] of [['⑤-3', longMemo, 'long'], ['⑤-4', T.odd.ctrl_memo, 'ctrl']]) {
      const nBad = logCount(f, 'odd_memo_bad');
      const nFiles = oddFiles().length;
      await press(memo);
      const want = UO.texts.memo_bad[why].split(UO.max_mark).join(String(FC.fields[UO.memo_field].max));
      row(no, "'이상해' 메모 거절 — " + (why === 'long' ? '너무 김(' + [...memo].length + '자)' : '제어 문자'), '새 파일 0 · 쪽지 "' + want + '" · 기록장 "' + word('odd_memo_bad') + '" 1줄(' + why + ')',
        '새 파일 ' + (oddFiles().length - nFiles) + ' · 쪽지 ' + JSON.stringify(f.el(UO.ids.note).textContent) + ' · 기록장 ' + (logCount(f, 'odd_memo_bad') - nBad),
        oddFiles().length === nFiles && f.el(UO.ids.note).textContent === want && logCount(f, 'odd_memo_bad') - nBad === 1 && f.logLines().some((l) => l.includes(word('odd_memo_bad')) && l.includes('"' + why + '"')));
    }
    await press('');
    await press('');
    const idx = indexOf();
    row('⑤-5', "'이상해' 보관 개수(이 시험만 " + T.odd.keep_override + ') — 넘으면 오래된 것부터 지움', '목록 ' + T.odd.keep_override + ' · 파일 ' + T.odd.keep_override + ' · 첫 파일 지워짐',
      '목록 ' + idx.length + ' · 파일 ' + oddFiles().length + ' · 첫 파일 ' + (oddFiles().includes(files1[0]) ? '남음' : '지워짐'),
      idx.length === T.odd.keep_override && oddFiles().length === T.odd.keep_override && !oddFiles().includes(files1[0]));
    const oddCalls = f.fetchCalls.slice(callsBefore).filter((x) => x.url.includes(T.odd.upload_path)).length;
    row('⑤-6', "'이상해' 누르는 동안 네트워크로 올리지 않음(E9)", '올리기 길(' + T.odd.upload_path + ') 물음 0', String(oddCalls), oddCalls === 0);
    row('⑥-1', '위치 권한 안내 — 시험 흐름이면 안 뜸', '숨음', f.el(UL.ids.root).hidden ? '숨음' : '보임', f.el(UL.ids.root).hidden === true);
    f.stop();

    // ---------- ⑥ 위치 권한 안내(기기 GPS) ----------
    const lw = cfgOf('config_loc_watch');
    lw.source = lw.source_names.device;
    let deliver = null;
    const geo = {
      watchPosition(ok, err) { deliver = ok; setTimeout(() => err({ code: lw.denied_error_code, message: 'denied' }), T.locate.deny_after_ms); return 1; },
      clearWatch() {},
    };
    await selectScene(INFO, T.odd.scene, false);
    const g = start({ overrides: { config_loc_watch: lw }, geo });
    await wait(() => g.stage() === HC.stages.good, T.start_wait_ms);
    const shown = await wait(() => !g.el(UL.ids.root).hidden, T.locate.wait_ms);
    row('⑥-2', '위치 권한 안내 — 기기 GPS 권한 꺼짐(가짜 위치 기능이 code 1)', '보임 · 글 "' + UL.texts.guide.denied.slice(0, 20) + '…" · 상태 자리에 위치 끊김 줄',
      (shown ? '보임' : '숨음') + ' · ' + JSON.stringify(g.el(UL.ids.text).textContent.slice(0, 20)) + ' · 상태 ' + JSON.stringify(g.statusText()),
      shown && g.el(UL.ids.text).textContent === UL.texts.guide.denied && g.statusText().includes(US.texts.src_names.loc));
    const p0 = LINE.points[T.locate.point_index];
    if (deliver) deliver({ timestamp: Date.now(), coords: { latitude: p0[0], longitude: p0[1], speed: null, heading: null, accuracy: T.locate.accuracy_m } });
    const hid = await wait(() => g.el(UL.ids.root).hidden, T.locate.wait_ms);
    row('⑥-3', '위치 권한 안내 — 위치가 다시 오면 닫힘', '숨음 · 상태 자리 위치 줄 사라짐', (hid ? '숨음' : '보임') + ' · 상태 ' + JSON.stringify(g.statusText()),
      hid && !g.statusText().includes(US.texts.src_names.loc));
    g.stop();

    // ---------- ⑦ E4 ----------
    await selectScene(INFO, T.s1.scene, false);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'web2-a2na-'));
    try {
      const out1 = path.join(tmp, 'out_repo');
      const said1 = build(out1);
      const p1 = await runPage(out1, T.e4.listen_ms);
      const pv = p1.doc.els[SP.ids.value];
      const pa = panelRows(p1.doc) || [];
      row('⑦-1', '빌드한 한 파일(저장소 그대로) — 두 판·이상해 단추·안내 숨음', '빌드 출력에 판 2(ui_ahead,ui_speed) · 좋음 · 속도판 숫자 · 충전소판 줄 ' + AH.count + ' · 이상해 보임 · 위치 안내 숨음',
        said1.replace(/\s+/g, ' ').slice(0, 170) + ' · ' + p1.stage + ' · 속도판 ' + JSON.stringify(pv && pv.textContent) + ' · 충전소판 ' + pa.map((r) => r.name + ' ' + r.dist).join(' / ') + ' · 이상해 ' + (p1.doc.els[UO.ids.root].hidden ? '숨음' : '보임') + ' · 안내 ' + (p1.doc.els[UL.ids.root].hidden ? '숨음' : '보임'),
        said1.includes('ui_ahead') && said1.includes('ui_speed') && p1.stage === HC.stages.good && pv && /^\d+$/.test(pv.textContent) && pa.length === AH.count && !p1.doc.els[UO.ids.root].hidden && p1.doc.els[UL.ids.root].hidden);
      for (const [i, cs] of T.e4.cases.entries()) {
        const copy = path.join(tmp, 'app_' + i);
        for (const item of T.e4.copy) fs.cpSync(path.join(APP, item), path.join(copy, item), { recursive: true });
        const removed = removeBoard(copy, cs.remove);
        const untouched = T.e4.untouched.filter((x) => fs.readFileSync(path.join(copy, x), 'utf8') === fs.readFileSync(path.join(APP, x), 'utf8')).length;
        const out = path.join(tmp, 'out_' + i);
        const said = build(out, copy);
        const p = await runPage(out, T.e4.listen_ms);
        const failed = p.pageLog.split('\n').filter((l) => l.includes(word('board_mount_failed')) || l.includes(word('board_show_failed'))).length;
        const keptSpeed = p.doc.els[SP.ids.value];
        const keptAhead = panelRows(p.doc);
        const gone = cs.remove === 'ui_ahead' ? !p.doc.els[UA.ids.root] : !p.doc.els[SP.ids.root];
        const keptOk = cs.remove === 'ui_ahead' ? keptSpeed && /^\d+$/.test(keptSpeed.textContent) : keptAhead && keptAhead.length === AH.count;
        const slot = p.doc.els[UB.slots[cs.empty_slot]];
        row('⑦-' + (i + 2), 'E4 — ' + cs.title, '파일 ' + T.e4.board_files + ' 지움 · 조립·ui_drive·ui_boards·운전 화면 조각 그대로(' + T.e4.untouched.length + ') · 빌드 출력에 ' + cs.remove + ' 없음 · 좋음 · 남은 판 뜸 · 뺀 판 없음 · 빈 자리 상자 0 · 꽂기·보이기 실패 0',
          '지움 ' + removed + ' · 그대로 ' + untouched + ' · ' + said.replace(/\s+/g, ' ').slice(0, 140) + ' · ' + p.stage + ' · 남은 판 ' + (cs.remove === 'ui_ahead' ? JSON.stringify(keptSpeed && keptSpeed.textContent) : (keptAhead || []).length + '줄') + ' · 뺀 판 ' + (gone ? '없음' : '있음') + ' · 빈 자리 상자 ' + (slot ? slot.children.length : '-') + ' · 실패 ' + failed,
          removed === T.e4.board_files && untouched === T.e4.untouched.length && !said.includes(cs.remove) && p.stage === HC.stages.good && keptOk && gone && slot && slot.children.length === 0 && failed === 0);
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  } finally {
    log.write('다리 끝 기다림', {});
    const code = await Promise.race([bridge.waitExit(), sleep(T.run_seconds * tc.view_s1.ms_per_s + T.exit_grace_ms).then(() => 'timeout')]);
    if (code === 'timeout') bridge.proc.kill();
    row('끝', '다리가 시험 모드 시간 뒤 스스로 끝남', '종료 코드 0', String(code), code === 0);
    fs.rmSync(sec.dir, { recursive: true, force: true });
  }
  // ---------- ⑧ 속도판 세 자리 ----------
  for (const r of await speedFitRows(tc, APP)) row('⑧ ' + r.no, r.title, r.expect, r.actual, r.ok);
}

function printTable() {
  const lines = ['| # | 시험 | 기대 | 실제 | 결과 |', '|---|---|---|---|---|'];
  for (const r of rows) lines.push('| ' + [r.no, r.title, r.expect, r.actual, r.ok ? tc.pass_word : tc.fail_word].map((s) => String(s).replace(/\|/g, '/').replace(/\n/g, ' ⏎ ')).join(' | ') + ' |');
  const ok = rows.length > 0 && rows.every((r) => r.ok);
  lines.push('', 'A2-나 스스로 시험: ' + (ok ? tc.pass_word : tc.fail_word) + ' (' + rows.filter((r) => r.ok).length + ' / ' + rows.length + ') — ' + kstText(tc));
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
