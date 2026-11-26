// A2-가 스스로 시험(브라우저 없이 node 에서 앱을 조립해 테스트 베드 다리에 붙인다).
//   node web2/tools/try_a2ga.mjs
// 다리를 시험 모드(try_a2ga.run_seconds 초)로 띄우고, 이번만 쓰는 앱 비밀 값을 저장소 밖 임시 파일로 만든다.
// 고속도로 선은 R0 전이라 시험 다리가 내주지 않아 선 파일만 lib_testbed.fetchWithLines 가 대신 답한다(앱은 그대로 다리 자료 길에 묻는다).
// ① S1  속도판 시속 = 흐름의 시속 · 위치가 선에 붙고 km 가 늘어남 · 나가는 주소가 다리 하나이고 모든 물음에 비밀 값 머리
// ② S2  시속 115 가 속도판에(A5 뒤: 제한 100 · 넘음 표시 — 자세한 것은 try_a5)
// ③ S6  튀는 위치 셋이 걸러지고 기록 · 정차 중 시속 0
// ④ S7  자료 길이 끊긴 동안 화면 그대로 + 상태 자리 한 줄, 돌아오면 사라짐
// ⑤ S11 나쁜 자료(흐름 넷 · 자료 길 셋)가 걸러지고 기록, 앱은 그대로
// ⑥ S8  켤 때 실패 세 갈래 → 앱 점검 중
// ⑦ E4  빌드한 한 파일에 속도판이 뜸 · 판 파일을 빼고(다른 판 하나를 더해) 지어도 조립·ui_drive·ui_boards 를 안 고치고 남은 판이 뜸
// 표(기대·실제)로 찍고 하나라도 실패면 0 아닌 코드. 기록장 tools/logs/try_a2ga.log, 표 사본 tools/logs/try_a2ga_last.md.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { loadToolsConfig, appDir, toolLog, kstText, TOOLS_DIR } from './lib_tools.mjs';
import { testbedInfo, makeSecret, writeSecretFile, startBridge, selectScene, seekScene, referenceStream, fetchWithLines } from './lib_testbed.mjs';
import { sleep, fakeDoc, fakeMapLib, fakeOpfs, loadBoards, startApp as runApp, waitFor } from './lib_apprun.mjs';

const tc = loadToolsConfig();
const T = tc.try_a2ga;
const A1 = tc.try_a1;
const APP = appDir(tc);
const log = toolLog(tc, 'try_a2ga');
const { main } = await import(pathToFileURL(path.join(APP, tc.build.src_dir, 'app.js')).href);
const BOARDS = await loadBoards(APP, tc);
const cfgOf = (name, dir) => JSON.parse(fs.readFileSync(path.join(dir || APP, tc.build.config_dir, name + tc.build.config_ext), 'utf8'));
const LOGW = cfgOf('config_log').words;
const word = (k) => LOGW[k] || k;
const US = cfgOf('config_ui_status');
const HC = cfgOf('config_health');
const SP = cfgOf('config_ui_speed');
const RS = cfgOf('config_relay_stations');
const LW = cfgOf('config_loc_watch');
const DRIVE = cfgOf('config_ui_drive');
const MAP = cfgOf('config_ui_map');
let INFO = null;
let FETCH = null;
let SECRET_FILE = null;

const rows = [];
function row(no, title, expect, actual, ok) {
  rows.push({ no, title, expect, actual, ok: !!ok });
  log.write(ok ? '통과' : '실패', { no, title, expect, actual });
}

function start(opts) {
  return runApp({ app: APP, tc, main, boards: BOARDS }, { secretFile: SECRET_FILE, ...opts, fetchFn: FETCH, stamp: 'try-a2ga' });
}
const wait = (fn, ms) => waitFor(fn, ms, tc.testbed.poll_ms);
function refreshOverride() {
  const o = cfgOf('config_relay_stations');
  o.refresh_ms = T.refresh_override_ms;
  return { config_relay_stations: o };
}
async function openAt(scene, tick, opts) {
  await selectScene(INFO, scene, false);
  if (tick) await seekScene(INFO, tick);
  const a = start(opts || {});
  await wait(() => a.stage() && a.stage() !== HC.stages.starting, T.start_wait_ms);
  return a;
}
const boardText = (a) => { const v = a.el(SP.ids.value); return v ? v.textContent : null; };
// 기록장(메모리 줄) 가운데 '무슨 일' 낱말(과 넘어온 값 글)이 든 줄 수
function logCount(a, w, inParams, where) {
  return a.logLines().filter((l) => l.includes(tc.log.sep + word(w) + tc.log.sep)
    && (!inParams || l.includes('"' + inParams + '"'))
    && (!where || l.includes(tc.log.sep + where + tc.log.sep))).length;
}
const lastSeq = (a) => (a.seen.fixes.length ? a.seen.fixes[a.seen.fixes.length - 1].seq : -1);

// 점과 선(꼭짓점 [위도, 경도]) 사이 가장 짧은 거리(m) — 앱의 Geo 를 쓰지 않고 따로 셈(try_a1 과 같은 평면 근사)
function distToLine(lat, lng, pts) {
  const R = A1.earth_radius_m;
  const k = A1.deg_to_rad;
  const cos = Math.cos(lat * k);
  const xy = (p) => [p[1] * k * R * cos, p[0] * k * R];
  const [px, py] = xy([lat, lng]);
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i += 1) {
    const [ax, ay] = xy(pts[i]);
    const [bx, by] = xy(pts[i + 1]);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
  }
  return best;
}

// 빌드한 index.html 을 가상 창에서(지도 라이브러리만 가짜) ms 동안 돌린다
async function runPage(outDir, ms) {
  const html = fs.readFileSync(path.join(outDir, tc.build.out_file), 'utf8');
  const vendorHead = fs.readFileSync(path.join(APP, tc.build.vendor_js[0]), 'utf8').slice(0, T.vendor_head_chars);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).filter((s) => !s.trimStart().startsWith(vendorHead.trimStart()));
  const doc = fakeDoc([html]);
  const opfs = fakeOpfs();
  const pageConsole = [];
  const lib = fakeMapLib(MAP.tile_source_id);
  const timers = [];
  let closed = false;
  const ctx = {
    document: doc, navigator: { storage: opfs.storage, geolocation: null }, maplibregl: lib,
    console: { error: (...x) => pageConsole.push(x.map(String).join(' ')), log: (...x) => pageConsole.push(x.map(String).join(' ')) },
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
  return { doc, stage: st.getAttribute(US.stage_attr), driveHidden: doc.els[DRIVE.root_id].hidden, pageLog: Object.values(opfs.files).join(''), pageConsole, scripts: scripts.length };
}

function build(outDir, appArg) {
  const argsList = [path.join(TOOLS_DIR, 'build.mjs'), '--out', outDir, '--secret', SECRET_FILE];
  if (appArg) argsList.push('--app', appArg);
  const r = spawnSync(process.execPath, argsList, { encoding: 'utf8' });
  if (r.status !== tc.exit.ok) throw new Error('빌드 실패: ' + (r.stderr || r.stdout));
  return r.stdout.trim();
}

async function main2() {
  log.write('시작', {});
  INFO = testbedInfo(tc, APP);
  const secret = makeSecret(tc);
  const sec = writeSecretFile(tc, secret);
  SECRET_FILE = sec.file;
  const line = JSON.parse(fs.readFileSync(path.join(path.resolve(path.dirname(INFO.cfgPath), INFO.tb.scenes.lines_dir), Object.values(tc.testbed.lines_shim)[0] + INFO.tb.scenes.line_suffix), 'utf8'));
  const bridge = await startBridge(tc, INFO, T.run_seconds, secret);
  FETCH = fetchWithLines(tc, INFO, secret);
  try {
    // ---------- ① S1 ----------
    await selectScene(INFO, T.s1.scene, false);
    const ref = referenceStream(INFO);
    const a = start({});
    const good = await wait(() => a.stage() === HC.stages.good, T.start_wait_ms);
    const mounted = a.made.ui_boards ? a.made.ui_boards.mounted() : [];
    const leftSlot = a.el(cfgOf('config_ui_boards').slots[SP.slot]);
    row('①-1', 'S1 켜기 — 판정·운전 화면·속도판 꽂힘', '좋음 · 운전 화면 보임 · 판 ui_speed 가 왼편 자리에',
      String(a.stage()) + ' · 운전 화면 ' + (a.driveHidden() ? '숨음' : '보임') + ' · 꽂힌 판 ' + JSON.stringify(mounted) + ' · 왼편 상자 ' + (leftSlot ? leftSlot.children.length : '-'),
      good && !a.driveHidden() && mounted.includes('ui_speed') && leftSlot && leftSlot.children.length === 1 && a.el(SP.ids.value));
    const f0 = a.seen.fixes.length;
    const p0 = a.seen.pos.length;
    await sleep(T.s1.listen_ms);
    await ref.stop();
    const fixes = a.seen.fixes.slice(f0);
    const speedOfT = new Map(a.seen.speed.map((s) => [s.t, s]));
    let same = 0;
    let compared = 0;
    for (const f of fixes) {
      const r = ref.ticks.get(f.seq);
      const s = speedOfT.get(f.t);
      if (!r || !s) continue;
      compared += 1;
      if (r.speed_kmh === f.speed_kmh && s.kmh === f.speed_kmh) same += 1;
    }
    row('①-2', 'S1 속도 조각 = fix 속도 = 참 흐름(따로 연 흐름)의 같은 틱 속도', '견준 틱 모두 같음(≥ ' + T.s1.min_fixes + ')', same + ' / ' + compared, compared >= T.s1.min_fixes && same === compared);
    const sp = a.get('speed');
    const shown = boardText(a);
    row('①-3', 'S1 속도판 글 = 속도 조각(반올림) = 장면 시속', '"' + T.s1.kmh + '" · 단위 "' + SP.texts.unit + '"',
      JSON.stringify(shown) + ' · 조각 ' + (sp ? sp.kmh + ' (' + sp.src + ')' : '-') + ' · 단위 ' + JSON.stringify(a.el(SP.ids.unit) && a.el(SP.ids.unit).textContent),
      sp && shown === String(Math.round(sp.kmh)) && shown === String(T.s1.kmh) && a.el(SP.ids.unit).textContent === SP.texts.unit);
    const pos = a.seen.pos.slice(p0).filter(Boolean);
    const seqOfT = new Map(fixes.map((f) => [f.t, f.seq]));
    const onLine = pos.filter((p) => p.on_line && p.line === line.name).length;
    const rising = pos.every((p, i) => i === 0 || p.km > pos[i - 1].km);
    const kmGaps = pos.filter((p) => seqOfT.has(p.t)).map((p) => Math.abs(p.km - (T.s1.km_start + T.s1.kmh * seqOfT.get(p.t) / tc.time.ms_per_hour * T.tick_ms)));
    const maxGap = kmGaps.length ? Math.max(...kmGaps) : Infinity;
    row('①-4', 'S1 위치가 선에 붙고 km 가 늘어남(pos)', '모두 선(' + line.name + ') 위 · km 가 늘기만 · 장면 km 와 차이 ≤ ' + T.s1.km_tolerance,
      '선 위 ' + onLine + ' / ' + pos.length + ' · ' + (rising ? '늘기만' : '줄어든 곳 있음') + ' · km ' + (pos.length ? pos[0].km + '→' + pos[pos.length - 1].km : '-') + ' · 장면 km 와 가장 큰 차이 ' + maxGap.toFixed(3),
      pos.length >= T.s1.min_fixes && onLine === pos.length && rising && maxGap <= T.s1.km_tolerance);
    const st = a.get('stations');
    row('①-5', 'S1 상태 자리 · 충전소 자료 · 거른 위치', '상태 글 빔 · 충전소 ≥ 1 · 선 1 · 거른 위치 0',
      JSON.stringify(a.statusText()) + ' · 충전소 ' + (st ? st[RS.list_key].length : '-') + ' · 선 ' + (st ? st[RS.lines_key].length : '-') + ' · 거른 위치 ' + a.made.loc_watch.rejected(),
      a.statusText() === '' && st && st[RS.list_key].length >= 1 && st[RS.lines_key].length === 1 && a.made.loc_watch.rejected() === 0);
    const calls = a.fetchCalls;
    const offBase = calls.filter((c) => !c.url.startsWith(INFO.base + '/')).length;
    const noSecret = calls.filter((c) => c.headers[INFO.b.secret_header] !== secret).length;
    row('①-6', 'S1 나간 물음 — 주소는 다리 하나 · 모두 앱 비밀 값 머리(F2)', '다리 밖 0 · 머리 없음 0 (물음 ≥ 1)', '물음 ' + calls.length + ' · 다리 밖 ' + offBase + ' · 머리 없음 ' + noSecret,
      calls.length >= 1 && offBase === 0 && noSecret === 0);
    const bn = a.get(cfgOf('config_ui_boards').needs_piece);
    row('①-7', 'S1 판 틀이 판들의 요구를 한 번 알림(board.needs)', SP.speed_piece + ' ' + SP.interval_ms + 'ms 포함', JSON.stringify(bn),
      bn && bn.topics && bn.topics[SP.speed_piece] === SP.interval_ms);
    a.stop();

    // ---------- ② S2 ----------
    const b = await openAt(T.s2.scene, T.s2.seek);
    await sleep(T.s2.listen_ms);
    const bs = b.get('speed');
    row('②-1', 'S2 (틱 ' + T.s2.seek + '부터 — km 40~48 시속 ' + T.s2.kmh + ') 속도판', '"' + T.s2.kmh + '"', JSON.stringify(boardText(b)) + ' · 조각 ' + (bs ? bs.kmh : '-'),
      boardText(b) === String(T.s2.kmh) && bs && bs.kmh === T.s2.kmh);
    const judge = b.el(SP.ids.root) ? b.el(SP.ids.root).getAttribute(SP.judge_attr) : null;
    // (A5 뒤) 제한 속도가 들어옴 — km 40~48 은 제한 100 에 시속 115: 넘음(주의). 자세한 제한 속도 시험은 try_a5
    row('②-2', 'S2 제한 속도 칸(A5 뒤 — 장면 limits 로 만든 제한 속도 파일)', '제한 칸 "100" · 판단 over(넘음 표시)', '제한 ' + JSON.stringify(b.el(SP.ids.limit).textContent) + ' · 판단 ' + judge,
      b.el(SP.ids.limit).textContent === '100' && judge === cfgOf('config_speed').judge_words.over);
    b.stop();

    // ---------- ③ S6 ----------
    for (const [i, cs] of T.s6.cases.entries()) {
      const c = await openAt(T.s6.scene, cs.t_s - T.s6.lead_ticks);
      const endTick = cs.t_s + cs.ticks + T.s6.after_ticks;
      await wait(() => lastSeq(c) >= endTick, (T.s6.lead_ticks + cs.ticks + T.s6.after_ticks) * T.tick_ms + T.start_wait_ms);
      const jumps = logCount(c, 'fix_bad', T.s6.jump_code);
      const inJump = c.seen.fixes.filter((f) => f.seq >= cs.t_s && f.seq < cs.t_s + cs.ticks).length;
      const far = Math.max(...c.seen.fixes.map((f) => distToLine(f.lat, f.lng, line.points)));
      row('③-' + (i + 1), 'S6 ' + cs.title + ' (틱 ' + cs.t_s + ', ' + cs.ticks + '틱)', '거름 기록 ' + cs.ticks + '줄(튐) · 그 틱의 위치는 fix 에 없음 · 받은 위치는 모두 선에서 ≤ ' + T.line_tolerance_m + 'm · 앱 좋음',
        '거름 ' + jumps + ' · 그 틱 fix ' + inJump + ' · 받은 위치 ' + c.seen.fixes.length + '개 가장 먼 ' + far.toFixed(1) + 'm · ' + c.stage() + ' · 마지막 틱 ' + lastSeq(c),
        jumps === cs.ticks && inJump === 0 && far <= T.line_tolerance_m && c.stage() === HC.stages.good && lastSeq(c) >= endTick);
      if (cs.stopped) {
        const cv = c.get('speed');
        row('③-' + (i + 1) + '+', 'S6 정차 중 속도판', '"0"', JSON.stringify(boardText(c)) + ' · 조각 ' + (cv ? cv.kmh : '-'), boardText(c) === '0' && cv && cv.kmh === 0);
      }
      c.stop();
    }

    // ---------- ④ S7 ----------
    const d = await openAt(T.s7.scene, T.s7.seek, { overrides: refreshOverride() });
    const dataName = US.texts.src_names[HC.conn_source[RS.conn_piece]];
    const t0 = Date.now();
    const downSeen = await wait(() => d.statusText().includes(dataName), T.s7.down_wait_ms);
    const downText = d.statusText();
    const fixesAtDown = d.seen.fixes.length;
    // 끊김이 보인 때 들고 있던 목록 — 끊긴 동안 새로 내지 않고 그대로여야 한다
    const held0 = d.get('stations');
    const pubsAtDown = d.seen.stations.length;
    await sleep(T.refresh_override_ms * (1 + 1));
    row('④-1', 'S7 자료 길 끊김(틱 ' + T.s7.down_t_s + ') — 상태 자리', '"' + dataName + ' — …부터 끊김(…)" 한 줄 · 운전 화면 그대로 · 앱 좋음(점검 중 아님)',
      (downSeen ? Math.round((Date.now() - t0) / T.tick_ms) + '초 안에 ' : '안 나옴 · ') + JSON.stringify(downText) + ' · 운전 화면 ' + (d.driveHidden() ? '숨음' : '보임') + ' · ' + d.stage(),
      downSeen && downText.split('\n').filter((l) => l.includes(dataName)).length === 1 && !d.driveHidden() && d.stage() === HC.stages.good);
    row('④-2', 'S7 끊긴 동안 들고 있는 자료로 계속', '충전소 자료 그대로(바뀌지 않음) · 위치·속도판 계속 · 알림창·종료 없음',
      '충전소 ' + (d.get('stations') === held0 ? '그대로' : '바뀜') + '(' + (held0 ? held0[RS.list_key].length : '-') + '곳, 끊긴 뒤 새로 냄 ' + (d.seen.stations.length - pubsAtDown) + ') · 끊긴 뒤 위치 +' + (d.seen.fixes.length - fixesAtDown) + ' · 속도판 ' + JSON.stringify(boardText(d)),
      held0 && d.get('stations') === held0 && d.seen.stations.length === pubsAtDown && d.seen.fixes.length > fixesAtDown && /^\d+$/.test(boardText(d) || ''));
    const upSeen = await wait(() => !d.statusText().includes(dataName), T.s7.up_wait_ms);
    row('④-3', 'S7 자료 길 돌아옴(틱 ' + T.s7.up_t_s + ') 뒤', '상태 자리 줄 사라짐 · 충전소 자료 새로 받음 · 앱 좋음',
      (upSeen ? '사라짐' : '남음') + ' · 글 ' + JSON.stringify(d.statusText()) + ' · 충전소 ' + (d.get('stations') !== held0 ? '새로 받음' : '그대로') + ' · ' + d.stage(),
      upSeen && d.statusText() === '' && d.get('stations') !== held0 && d.stage() === HC.stages.good);
    const fails = logCount(d, 'stations_refresh_fail', 'upstream');
    const srcName = HC.conn_source[RS.conn_piece];
    const ll = d.logLines();
    const isSrc = (l, w) => l.includes(tc.log.sep + word(w) + tc.log.sep) && l.includes('"' + srcName + '"');
    const downAt = ll.findIndex((l) => isSrc(l, 'src_down'));
    const backAfter = ll.filter((l, i) => i > downAt && isSrc(l, 'src_back')).length;
    row('④-4', 'S7 기록장', '다시 받기 실패(upstream) ≥ 1 · 출처 끊김(' + srcName + ') 1줄 · 그 뒤 출처 돌아옴 1줄', '실패 ' + fails + ' · 끊김 ' + ll.filter((l) => isSrc(l, 'src_down')).length + ' · 그 뒤 돌아옴 ' + backAfter,
      fails >= 1 && downAt >= 0 && ll.filter((l) => isSrc(l, 'src_down')).length === 1 && backAfter === 1);
    d.stop();

    // ---------- ⑤ S11 흐름 ----------
    const fc = cfgOf('config_fixcheck');
    for (const [i, cs] of T.s11.stream_cases.entries()) {
      const e = await openAt(T.s11.scene, cs.t_s - T.s11.lead_ticks);
      await sleep((T.s11.lead_ticks + cs.ticks + T.s11.after_ticks) * T.tick_ms);
      let resumed = true;
      if (cs.word === 'stream_down') {
        const n = e.seen.fixes.length;
        resumed = await wait(() => e.seen.fixes.length > n, LW.retry_ms + T.start_wait_ms);
      }
      const where = cs.word === 'parse' ? LW.where : null;
      const hits = logCount(e, cs.word, cs.why, where);
      const badIn = e.seen.fixes.filter((f) => f.lat < fc.lat_min || f.lat > fc.lat_max || f.lng < fc.lng_min || f.lng > fc.lng_max || (f.speed_kmh !== null && f.speed_kmh < fc.speed_min_kmh)).length;
      row('⑤-' + (i + 1), 'S11 ' + cs.title + ' (틱 ' + cs.t_s + ', ' + cs.ticks + '틱)', '기록 "' + word(cs.word) + '"' + (cs.why ? '(' + cs.why + ')' : '') + ' ≥ ' + cs.min + ' · 나쁜 값이 fix 에 0 · 앱 좋음 · 운전 화면 그대로' + (cs.word === 'stream_down' ? ' · 다시 걸어 위치 이어짐' : ''),
        '기록 ' + hits + ' · 나쁜 fix ' + badIn + ' · ' + e.stage() + ' · 운전 화면 ' + (e.driveHidden() ? '숨음' : '보임') + (cs.word === 'stream_down' ? ' · ' + (resumed ? '이어짐' : '안 이어짐') : ''),
        hits >= cs.min && badIn === 0 && e.stage() === HC.stages.good && !e.driveHidden() && resumed);
      e.stop();
    }
    // ---------- ⑤ S11 자료 길 ----------
    for (const [i, cs] of T.s11.data_cases.entries()) {
      const e = await openAt(T.s11.scene, cs.t_s - T.s11.lead_ticks, { overrides: refreshOverride() });
      await wait(() => e.statusText().includes(dataName), T.s11.data_listen_ms);
      // 나쁜 자료가 보인 때 들고 있던 목록 — 그 뒤로 새로 내지 않고 그대로여야 한다
      const held = e.get('stations');
      const pubs = e.seen.stations.length;
      await sleep(T.refresh_override_ms * (1 + 1));
      const hits = logCount(e, cs.word, cs.word === 'bad_items' ? null : cs.code);
      const failCode = logCount(e, 'stations_refresh_fail', cs.code);
      const whyWord = US.texts.why_words[cs.code];
      row('⑤-' + (T.s11.stream_cases.length + i + 1), 'S11 ' + cs.title + ' (틱 ' + cs.t_s + ')', '기록 "' + word(cs.word) + '" ≥ 1 · 다시 받기 실패(' + cs.code + ') ≥ 1 · 상태 자리 "' + dataName + ' … (' + whyWord + ')" · 충전소 자료 그대로 · 앱 좋음',
        '기록 ' + hits + ' · 실패(' + cs.code + ') ' + failCode + ' · 글 ' + JSON.stringify(e.statusText()) + ' · 충전소 ' + (e.get('stations') === held ? '그대로' : '바뀜') + '(' + (held ? held[RS.list_key].length : '-') + '곳, 그 뒤 새로 냄 ' + (e.seen.stations.length - pubs) + ') · ' + e.stage(),
        hits >= 1 && failCode >= 1 && e.statusText().includes(dataName) && e.statusText().includes(whyWord) && held && e.get('stations') === held && e.seen.stations.length === pubs && e.stage() === HC.stages.good);
      e.stop();
    }

    // ---------- ⑥ S8 세 갈래 ----------
    for (const [i, cs] of A1.startup_cases.entries()) {
      await selectScene(INFO, cs.scene, false);
      const g = start({});
      await wait(() => g.stage() && g.stage() !== HC.stages.starting, T.start_wait_ms);
      const last = g.app();
      const want = cs.expect.text.map((k) => k.split('.').reduce((o, x) => (o ? o[x] : undefined), US));
      const text = g.statusText();
      const whyOk = last.why && last.why.code === cs.expect.code && (!cs.expect.need || last.why.need === cs.expect.need) && (!cs.expect.fail || last.why.fail === cs.expect.fail);
      const textOk = want.every((w) => w && text.includes(w.replace(/\{need\}.*$/, '').trim()));
      row('⑥-' + (i + 1), cs.title + ' (' + cs.scene + ')', '앱 점검 중 · 까닭 ' + cs.expect.code + (cs.expect.need ? '/' + cs.expect.need : '') + (cs.expect.fail ? '/' + cs.expect.fail : '') + ' · 운전 화면 숨음 · 속도판 없음',
        String(last.stage) + ' · ' + JSON.stringify(last.why) + ' · 운전 화면 ' + (g.driveHidden() ? '숨음' : '보임') + ' · 글 ' + JSON.stringify(text),
        last.stage === HC.stages.broken && whyOk && g.driveHidden() && textOk);
      g.stop();
    }

    // ---------- ⑦ E4 판 빼고·더해 짓기 ----------
    await selectScene(INFO, T.s1.scene, false);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'web2-a2ga-'));
    try {
      const out1 = path.join(tmp, 'out_repo');
      const said1 = build(out1);
      const p1 = await runPage(out1, T.e4.listen_ms);
      const v1 = p1.doc.els[SP.ids.value];
      row('⑦-1', '빌드한 한 파일(저장소 그대로) — 속도판', '빌드 출력에 판 1(ui_speed) · 좋음 · 운전 화면 보임 · 속도판에 숫자',
        said1.replace(/\s+/g, ' ').slice(0, 160) + ' · ' + p1.stage + ' · 운전 화면 ' + (p1.driveHidden ? '숨음' : '보임') + ' · 속도판 ' + JSON.stringify(v1 && v1.textContent),
        said1.includes('ui_speed') && p1.stage === HC.stages.good && !p1.driveHidden && v1 && /^\d+$/.test(v1.textContent));
      // 사본: 속도판을 빼고, 같은 꼴의 시험 판(ui_trial — 오른편)을 새 파일로만 더한다
      const copy = path.join(tmp, 'app');
      for (const item of T.e4.copy) fs.cpSync(path.join(APP, item), path.join(copy, item), { recursive: true });
      const rm = T.e4.remove_board;
      const tr = T.e4.trial_board;
      const swap = (text) => Object.entries(T.e4.renames).reduce((s, [x, y]) => s.split(x).join(y), text);
      const pairs = [
        [path.join(tc.build.src_dir, rm + tc.build.module_ext), path.join(tc.build.src_dir, tr + tc.build.module_ext)],
        [path.join(tc.build.src_dir, tc.build.view_prefix + rm + tc.build.view_ext), path.join(tc.build.src_dir, tc.build.view_prefix + tr + tc.build.view_ext)],
        [path.join(tc.build.src_dir, tc.build.style_prefix + rm + tc.build.style_ext), path.join(tc.build.src_dir, tc.build.style_prefix + tr + tc.build.style_ext)],
        [path.join(tc.build.config_dir, 'config_' + rm + tc.build.config_ext), path.join(tc.build.config_dir, 'config_' + tr + tc.build.config_ext)],
        [path.join(tc.build.shape_dir, 'config_' + rm + tc.build.shape_ext), path.join(tc.build.shape_dir, 'config_' + tr + tc.build.shape_ext)],
      ];
      for (const [from, to] of pairs) {
        let text = swap(fs.readFileSync(path.join(copy, from), 'utf8'));
        if (to.endsWith(tc.build.config_ext) && !to.endsWith(tc.build.shape_ext)) text = text.split(T.e4.trial_slot_from).join(T.e4.trial_slot_to);
        fs.writeFileSync(path.join(copy, to), text, 'utf8');
        fs.rmSync(path.join(copy, from));
      }
      const untouched = T.e4.untouched.filter((f) => fs.readFileSync(path.join(copy, f), 'utf8') === fs.readFileSync(path.join(APP, f), 'utf8')).length;
      const out2 = path.join(tmp, 'out_copy');
      const said2 = build(out2, copy);
      const p2 = await runPage(out2, T.e4.listen_ms);
      const trialIds = JSON.parse(fs.readFileSync(path.join(copy, tc.build.config_dir, 'config_' + tr + tc.build.config_ext), 'utf8')).ids;
      const v2 = p2.doc.els[trialIds.value];
      const gone = !p2.doc.els[SP.ids.value];
      const failed = p2.pageLog.split('\n').filter((l) => l.includes(word('board_mount_failed'))).length;
      // (A2-나) 오른편에는 충전소판도 있으므로 시험 판(ui_trial) 상자만 센다
      const ubc = cfgOf('config_ui_boards', copy);
      const rightAll = p2.doc.els[ubc.slots.right];
      const right = rightAll ? { children: rightAll.children.filter((x) => x.getAttribute(ubc.name_attr) === tr) } : null;
      row('⑦-2', '판 하나(속도판)를 빼고 다른 판 하나(ui_trial, 오른편)를 새 파일로만 더해 지음(E4)', '조립·ui_drive·ui_boards·운전 화면 조각 그대로(' + T.e4.untouched.length + ') · 빌드 출력에 판 1(ui_trial) · 좋음 · 남은 판에 숫자 · 속도판 없음 · 꽂기 실패 0',
        '그대로 ' + untouched + ' · ' + said2.replace(/\s+/g, ' ').slice(0, 160) + ' · ' + p2.stage + ' · 남은 판 ' + JSON.stringify(v2 && v2.textContent) + ' · 속도판 ' + (gone ? '없음' : '있음') + ' · 오른편 상자 ' + (right ? right.children.length : '-') + ' · 꽂기 실패 ' + failed,
        untouched === T.e4.untouched.length && said2.includes(tr) && !said2.includes(rm) && p2.stage === HC.stages.good && !p2.driveHidden && v2 && /^\d+$/.test(v2.textContent) && gone && failed === 0 && right && right.children.length === 1);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
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
  await viewCheck();
}

// ⑧ 묘성이 크롬으로 보는 길(view_s1.mjs)을 그대로 띄워, 받은 페이지를 가상 창에서 돌려 본다(페이지 → 이 서버 → 선 대신 답 / 다리로 넘김)
async function viewCheck() {
  const V = tc.view_s1;
  const W = T.view;
  const proc = spawn(process.execPath, [path.join(TOOLS_DIR, 'view_s1.mjs'), String(W.seconds), W.scene, String(W.tick)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let said = '';
  proc.stdout.on('data', (x) => { said += x; });
  proc.stderr.on('data', (x) => { said += x; });
  const exited = new Promise((resolve) => proc.on('exit', (c) => resolve(c)));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'web2-a2ga-view-'));
  try {
    const ready = await wait(() => said.includes(W.ready_word), T.start_wait_ms + T.start_wait_ms);
    const base = V.scheme + V.host + ':' + V.port + '/';
    const resp = ready ? await fetch(base) : null;
    const html = resp ? await resp.text() : '';
    fs.writeFileSync(path.join(tmp, tc.build.out_file), html, 'utf8');
    FETCH = fetch;
    const p = html ? await runPage(tmp, W.listen_ms) : null;
    const v = p && p.doc.els[SP.ids.value];
    row('⑧', '크롬 보기 길(view_s1 ' + W.scene + ' 틱 ' + W.tick + ') — 받은 페이지를 가상 창에서', '페이지 받음 · 좋음 · 운전 화면 보임 · 속도판 "' + W.kmh + '" · 상태 글 빔',
      (resp ? resp.status + ' · ' + Math.round(html.length / tc.build.kb) + 'KB' : '안 열림 — ' + said.trim().slice(-200)) + (p ? ' · ' + p.stage + ' · 운전 화면 ' + (p.driveHidden ? '숨음' : '보임') + ' · 속도판 ' + JSON.stringify(v && v.textContent) + ' · 상태 글 ' + JSON.stringify(p.doc.els[US.element_id].textContent) : ''),
      p && p.stage === HC.stages.good && !p.driveHidden && v && v.textContent === String(W.kmh) && p.doc.els[US.element_id].textContent === '');
  } finally {
    const code = await Promise.race([exited, sleep(W.seconds * V.ms_per_s + T.exit_grace_ms).then(() => 'timeout')]);
    if (code === 'timeout') proc.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
    log.write('보기 길 끝', { code });
  }
}

function printTable() {
  const lines = ['| # | 시험 | 기대 | 실제 | 결과 |', '|---|---|---|---|---|'];
  for (const r of rows) lines.push('| ' + [r.no, r.title, r.expect, r.actual, r.ok ? tc.pass_word : tc.fail_word].map((s) => String(s).replace(/\|/g, '/').replace(/\n/g, ' ⏎ ')).join(' | ') + ' |');
  const ok = rows.length > 0 && rows.every((r) => r.ok);
  lines.push('', 'A2-가 스스로 시험: ' + (ok ? tc.pass_word : tc.fail_word) + ' (' + rows.filter((r) => r.ok).length + ' / ' + rows.length + ') — ' + kstText(tc));
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
