// A1 스스로 시험(브라우저 없이 node 에서 앱을 조립해 테스트 베드 다리에 붙인다).
//   node web2/tools/try_a1.mjs
// 다리를 시험 모드(try_a1.run_seconds 초)로 띄우고, 이번만 쓰는 앱 비밀 값을 저장소 밖 임시 파일로 만든다.
// ① S1: 위치가 State(fix)로 1초마다 바뀜 — 틱 번호가 이어지고, 좌표가 따로 연 참 흐름과 같고, 경부선 위이며, 한 걸음이 속도와 맞음
// ② S8 세 갈래: health.app 이 '점검 중'이 되고 상태 자리 글에 까닭이 들어감 (+ 다리 주소 허용 밖·비밀 값 파일 없음 → 아무것도 안 나감)
// ③ 설정 하나를 깨면 기록에 남고 '앱 점검 중' (+ 기능 설정만 깨면 앱은 뜨고 그 기능만 나쁨)
// ④ 기록장(앱 로그 파일·콘솔)에 비밀 값이 없음 — 일부러 비밀 값을 로그에 넘겨 가려지는지도 봄
// 표(기대·실제)로 찍고 하나라도 실패면 0 아닌 코드. 기록장 tools/logs/try_a1.log, 표 사본 tools/logs/try_a1_last.md.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { loadToolsConfig, appDir, toolLog, kstText, TOOLS_DIR } from './lib_tools.mjs';
import { testbedInfo, makeSecret, writeSecretFile, startBridge, selectScene, referenceStream, fetchWithLines } from './lib_testbed.mjs';
import { sleep, fakeDoc, fakeMapLib, fakeOpfs, loadBoards, setPath, startApp as runApp, waitFor as waitUntil } from './lib_apprun.mjs';

// (A2) 가짜 화면·지도·저장소와 앱 띄우기는 try_a2ga 와 함께 쓰는 lib_apprun.mjs 로 옮겼다.
// 고속도로 선은 R0 전이라 시험 다리가 내주지 않아, 선 파일만 lib_testbed.fetchWithLines 가 대신 답한다(앱 코드는 그대로).
const tc = loadToolsConfig();
const T = tc.try_a1;
const APP = appDir(tc);
const log = toolLog(tc, 'try_a1');
const { main } = await import(pathToFileURL(path.join(APP, tc.build.src_dir, 'app.js')).href);
const BOARDS = await loadBoards(APP, tc);
let FETCH = null; // 다리를 띄운 뒤 선 파일 대신 답하기를 붙인 fetch

function startApp(opts) {
  return runApp({ app: APP, tc, main, boards: BOARDS }, { ...opts, fetchFn: FETCH, stamp: 'try-a1' });
}

async function waitFor(fn, ms) {
  return waitUntil(fn, ms, tc.testbed.poll_ms);
}

function textAt(obj, dotted) {
  return dotted.split('.').reduce((o, k) => (o ? o[k] : undefined), obj);
}

// 점과 선(꼭짓점 목록 [위도, 경도]) 사이 가장 짧은 거리(m) — 좁은 범위라 평면 근사
function distToLine(lat, lng, pts) {
  const R = T.earth_radius_m;
  const k = T.deg_to_rad;
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
function stepM(a, b) {
  const R = T.earth_radius_m;
  const k = T.deg_to_rad;
  const cos = Math.cos(a.lat * k);
  return Math.hypot((b.lng - a.lng) * k * R * cos, (b.lat - a.lat) * k * R);
}

const rows = [];
function row(no, title, expect, actual, ok) {
  rows.push({ no, title, expect, actual, ok: !!ok });
  log.write(ok ? '통과' : '실패', { no, title, expect, actual });
}

async function main2() {
  log.write('시작', {});
  const info = testbedInfo(tc, APP);
  const secret = makeSecret(tc);
  const sec = writeSecretFile(tc, secret);
  const uiStatus = JSON.parse(fs.readFileSync(path.join(APP, 'config', 'config_ui_status.json'), 'utf8'));
  const hc = JSON.parse(fs.readFileSync(path.join(APP, 'config', 'config_health.json'), 'utf8'));
  const sceneFile = (name) => JSON.parse(fs.readFileSync(path.join(path.resolve(path.dirname(info.cfgPath), info.tb.scenes.dir), name + '.json'), 'utf8'));
  const bridge = await startBridge(tc, info, T.run_seconds, secret);
  FETCH = fetchWithLines(tc, info, secret);
  const allLogs = [];
  const allConsole = [];
  try {
    // ---------- ① S1 ----------
    await selectScene(info, T.s1_scene, false);
    const ref = referenceStream(info);
    const a = startApp({ secretFile: sec.file });
    const good = await waitFor(() => a.stage() === hc.stages.good, T.start_wait_ms);
    row('①-1', 'S1 켜기 → health.app', '좋음(good) · 운전 화면 보임', String(a.stage()) + ' · 운전 화면 ' + (a.driveHidden() ? '숨음' : '보임'), good && !a.driveHidden());
    const before = a.seen.fixes.length;
    await sleep(T.s1_listen_ms);
    await ref.stop();
    a.stop();
    const fixes = a.seen.fixes.slice(before);
    const seqs = fixes.map((f) => f.seq);
    const consecutive = seqs.every((s, i) => i === 0 || s === seqs[i - 1] + 1);
    row('①-2', 'S1 fix 가 1초마다 — 받은 수와 틱 번호', '≥ ' + T.s1_min_fixes + '개, 틱이 1씩 이어짐', fixes.length + '개, 틱 ' + (seqs.length ? seqs[0] + '→' + seqs[seqs.length - 1] : '-') + (consecutive ? ' 이어짐' : ' 끊김'), fixes.length >= T.s1_min_fixes && consecutive);
    const gaps = fixes.slice(1).map((f, i) => f.at - fixes[i].at).sort((x, y) => x - y);
    const median = gaps.length ? gaps[Math.floor(gaps.length / 2)] : NaN;
    row('①-3', 'S1 fix 사이 간격(가운데 값)', T.tick_ms + 'ms ± ' + T.tick_tolerance_ms, Math.round(median) + 'ms', Math.abs(median - T.tick_ms) <= T.tick_tolerance_ms);
    let same = 0;
    let compared = 0;
    for (const f of fixes) {
      const r = ref.ticks.get(f.seq);
      if (!r) continue;
      compared += 1;
      if (r.lat === f.lat && r.lng === f.lng) same += 1;
    }
    row('①-4', 'S1 좌표가 참 흐름(따로 연 흐름)의 같은 틱과 같음', '견준 틱 모두 같음(≥ ' + T.s1_min_fixes + ')', same + ' / ' + compared, compared >= T.s1_min_fixes && same === compared);
    const scene = sceneFile(T.s1_scene);
    const line = JSON.parse(fs.readFileSync(path.join(path.resolve(path.dirname(info.cfgPath), info.tb.scenes.lines_dir), scene.route.legs[0].line + info.tb.scenes.line_suffix), 'utf8'));
    const far = fixes.map((f) => distToLine(f.lat, f.lng, line.points));
    const maxFar = far.length ? Math.max(...far) : Infinity;
    row('①-5', 'S1 좌표가 장면의 선(' + scene.route.legs[0].line + ') 위', '선에서 ≤ ' + T.line_tolerance_m + 'm', '가장 먼 ' + maxFar.toFixed(1) + 'm', maxFar <= T.line_tolerance_m);
    const ratios = fixes.slice(1).map((f, i) => stepM(fixes[i], f) / (fixes[i].speed_kmh * T.kmh_to_mps));
    const badStep = ratios.filter((x) => Math.abs(x - 1) > T.step_tolerance_ratio).length;
    row('①-6', 'S1 한 걸음 거리 ÷ (속도 × 1초)', '1 ± ' + T.step_tolerance_ratio + ' (모두)', ratios.length ? '어긋남 ' + badStep + ' / ' + ratios.length + ' (예 ' + ratios[0].toFixed(3) + ')' : '없음', ratios.length && badStep === 0);
    const map = a.lib.maps[0];
    row('①-7', '지도 점(가짜 지도)이 fix 마다 옮겨짐', '옮긴 수 ≥ fix 수', map ? map.moves.length + ' (fix ' + a.seen.fixes.length + ')' : '지도 안 열림', map && map.moves.length >= a.seen.fixes.length);
    row('①-8', 'S1 상태 자리 글', '비어 있음(끊긴 출처 없음)', JSON.stringify(a.statusText()), a.statusText() === '');
    allLogs.push(await a.logText());
    allConsole.push(...a.consoleLines);

    // ---------- ② S8 세 갈래 ----------
    for (const [i, cs] of T.startup_cases.entries()) {
      await selectScene(info, cs.scene, false);
      const b = startApp({ secretFile: sec.file });
      await waitFor(() => b.stage() && b.stage() !== hc.stages.starting, T.start_wait_ms);
      const last = b.app();
      const want = cs.expect.text.map((k) => textAt(uiStatus, k));
      const text = b.statusText();
      const whyOk = last.why && last.why.code === cs.expect.code && (!cs.expect.need || last.why.need === cs.expect.need) && (!cs.expect.fail || last.why.fail === cs.expect.fail);
      const textOk = want.every((w) => w && text.includes(w.replace(/\{need\}.*$/, '').trim()));
      row('②-' + (i + 1), cs.title + ' (' + cs.scene + ')',
        '점검 중 · 까닭 ' + cs.expect.code + (cs.expect.need ? '/' + cs.expect.need : '') + (cs.expect.fail ? '/' + cs.expect.fail : '') + ' · 운전 화면 숨음 · 글에 ' + want.join(' + '),
        String(last.stage) + ' · ' + JSON.stringify(last.why) + ' · 운전 화면 ' + (b.driveHidden() ? '숨음' : '보임') + ' · 글 ' + JSON.stringify(text),
        last.stage === hc.stages.broken && whyOk && b.driveHidden() && textOk);
      b.stop();
      allLogs.push(await b.logText());
      allConsole.push(...b.consoleLines);
    }
    // 다리 주소가 허용 밖 · 비밀 값 파일 없음 → 설정 단계에서 점검 중, 네트워크로 아무것도 안 나감
    await selectScene(info, T.s1_scene, false);
    const gwOver = JSON.parse(fs.readFileSync(path.join(APP, 'config', 'config_gateway.json'), 'utf8'));
    gwOver.gateway_url = T.bad_gateway_url;
    const c1 = startApp({ secretFile: sec.file, overrides: { config_gateway: gwOver } });
    await waitFor(() => c1.stage() && c1.stage() !== hc.stages.starting, T.start_wait_ms);
    await sleep(tc.testbed.poll_ms * 5);
    const l1 = c1.app();
    row('②-4', '다리 주소를 허용 밖(' + T.bad_gateway_url + ')으로', '점검 중 · 까닭 gateway · 나간 물음 0 · 글 "' + uiStatus.texts.reasons.gateway + '"',
      String(l1.stage) + ' · ' + JSON.stringify(l1.why) + ' · 나간 물음 ' + c1.fetchCalls.length + ' · 글 ' + JSON.stringify(c1.statusText()),
      l1.stage === hc.stages.broken && l1.why && l1.why.code === 'gateway' && c1.fetchCalls.length === 0 && c1.statusText().includes(uiStatus.texts.reasons.gateway));
    c1.stop();
    allLogs.push(await c1.logText());
    const c2 = startApp({ secretFile: null });
    await waitFor(() => c2.stage() && c2.stage() !== hc.stages.starting, T.start_wait_ms);
    await sleep(tc.testbed.poll_ms * 5);
    const l2 = c2.app();
    row('②-5', '앱 비밀 값 파일 없이 켜기', '점검 중 · 까닭 secret · 나간 물음 0 · 글 "' + uiStatus.texts.reasons.secret + '"',
      String(l2.stage) + ' · ' + JSON.stringify(l2.why) + ' · 나간 물음 ' + c2.fetchCalls.length + ' · 글 ' + JSON.stringify(c2.statusText()),
      l2.stage === hc.stages.broken && l2.why && l2.why.code === 'secret' && c2.fetchCalls.length === 0 && c2.statusText().includes(uiStatus.texts.reasons.secret));
    c2.stop();
    allLogs.push(await c2.logText());

    // ---------- ③ 설정 하나 깨기 ----------
    const brk = T.break_app_config;
    const over = JSON.parse(fs.readFileSync(path.join(APP, 'config', brk.file + '.json'), 'utf8'));
    setPath(over, brk.path, brk.value);
    const d = startApp({ secretFile: sec.file, overrides: { [brk.file]: over } });
    await waitFor(() => d.stage() && d.stage() !== hc.stages.starting, T.start_wait_ms);
    const ld = d.app();
    const dlog = await d.logText();
    const logged = dlog.includes(brk.file) && dlog.includes(JSON.parse(fs.readFileSync(path.join(APP, 'config', 'config_log.json'), 'utf8')).words.config_problem);
    row('③-1', '설정 ' + brk.file + '.' + brk.path + ' = ' + brk.value + ' (앱 등급)', '기록장에 "설정 문제"+파일 이름 · 점검 중 · 글에 "' + uiStatus.texts.broken + '"과 파일 이름 · 운전 화면 숨음',
      '기록 ' + (logged ? '있음' : '없음') + ' · ' + String(ld.stage) + ' · ' + JSON.stringify(ld.why) + ' · 글 ' + JSON.stringify(d.statusText()),
      logged && ld.stage === hc.stages.broken && d.statusText().includes(uiStatus.texts.broken) && d.statusText().includes(brk.file) && d.driveHidden());
    d.stop();
    allLogs.push(dlog);
    const fb = T.break_feature_config;
    const over2 = JSON.parse(fs.readFileSync(path.join(APP, 'config', fb.file + '.json'), 'utf8'));
    setPath(over2, fb.path, fb.value);
    const e = startApp({ secretFile: sec.file, overrides: { [fb.file]: over2 } });
    await waitFor(() => e.stage() && e.stage() !== hc.stages.starting, T.start_wait_ms);
    await sleep(T.tick_ms * 2);
    const feat = e.made.state.get(fb.feature);
    row('③-2', '기능 설정만 깨기 ' + fb.file + '.' + fb.path + ' = ' + fb.value, '앱은 좋음 · ' + fb.feature + ' 나쁨 · 위치 0개',
      String(e.stage()) + ' · ' + fb.feature + ' ' + JSON.stringify(feat) + ' · 위치 ' + e.seen.fixes.length + '개',
      e.stage() === hc.stages.good && feat && feat.ok === false && e.seen.fixes.length === 0);
    e.stop();
    allLogs.push(await e.logText());

    // ---------- ④ 비밀 값이 기록장에 없음 ----------
    const f = startApp({ secretFile: sec.file });
    f.made.log.info(T.mask_probe_where, T.mask_probe_what, { [info.b.secret_header]: secret, note: 'x' + secret + 'y', nested: { value: secret } });
    await waitFor(() => f.stage() && f.stage() !== hc.stages.starting, T.start_wait_ms);
    f.stop();
    const flog = await f.logText();
    allLogs.push(flog);
    allConsole.push(...f.consoleLines);
    const probeLine = flog.split('\n').find((l) => l.includes(T.mask_probe_what)) || '';
    const joined = allLogs.join('\n') + '\n' + allConsole.join('\n');
    const leaks = joined.split(secret).length - 1;
    row('④-1', '일부러 비밀 값을 로그에 넘김 → 가려짐', '그 줄에 비밀 값 없음 · 가림 글(***) 있음', probeLine ? (probeLine.includes(secret) ? '비밀 값 보임' : '가려짐') + ' · ' + probeLine.slice(0, 160) : '줄 없음', probeLine && !probeLine.includes(secret) && probeLine.includes('***'));
    row('④-2', '이번 시험의 앱 기록장 전부 + 콘솔에서 비밀 값 찾기', '0곳', leaks + '곳 (기록 ' + joined.split('\n').length + '줄)', leaks === 0);

    // ---------- ⑤ 빌드한 한 파일(index.html)을 가상 창에서 그대로 ----------
    await selectScene(info, T.s1_scene, false);
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'web2-try-'));
    try {
      const br = spawnSync(process.execPath, [path.join(TOOLS_DIR, 'build.mjs'), '--out', out, '--secret', sec.file], { encoding: 'utf8' });
      if (br.status !== tc.exit.ok) throw new Error('빌드 실패: ' + br.stderr);
      const html = fs.readFileSync(path.join(out, tc.build.out_file), 'utf8');
      const vendorHead = fs.readFileSync(path.join(APP, tc.build.vendor_js[0]), 'utf8').slice(0, T.vendor_head_chars);
      const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).filter((s) => !s.trimStart().startsWith(vendorHead.trimStart()));
      const doc = fakeDoc([html]);
      const opfs = fakeOpfs();
      const pageConsole = [];
      const lib = fakeMapLib(JSON.parse(fs.readFileSync(path.join(APP, 'config', 'config_ui_map.json'), 'utf8')).tile_source_id);
      const timers = [];
      let closed = false; // 시험이 끝나면 가상 창은 새 타이머·새 물음을 만들지 못한다(다시 걸기가 node 를 붙잡지 않게)
      const ctx = {
        document: doc, navigator: { storage: opfs.storage, geolocation: null }, maplibregl: lib,
        console: { error: (...x) => pageConsole.push(x.map(String).join(' ')), log: (...x) => pageConsole.push(x.map(String).join(' ')) },
        fetch: (u, init) => (closed ? Promise.reject(new Error('closed')) : FETCH(u, init)), TextDecoder, Response, AbortController, URL, Blob,
        setTimeout: (f, ms) => { if (closed) return null; const h = setTimeout(f, ms); timers.push(h); return h; }, clearTimeout,
        setInterval: (f, ms) => { if (closed) return null; const h = setInterval(f, ms); timers.push(h); return h; }, clearInterval,
        innerWidth: 1280, innerHeight: 720, listeners: {},
        addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
      };
      vm.createContext(ctx);
      ctx.window = ctx;
      for (const s of scripts) vm.runInContext(s, ctx);
      const st = doc.els[uiStatus.element_id];
      const drive = doc.els[JSON.parse(fs.readFileSync(path.join(APP, 'config', 'config_ui_drive.json'), 'utf8')).root_id];
      await waitFor(() => st.getAttribute(uiStatus.stage_attr) === hc.stages.good, T.start_wait_ms);
      const m0 = lib.maps[0] ? lib.maps[0].moves.length : 0;
      await sleep(T.page_listen_ms);
      const moved = lib.maps[0] ? lib.maps[0].moves.length - m0 : 0;
      closed = true;
      for (const h of timers) { clearTimeout(h); clearInterval(h); }
      row('⑤-1', '빌드한 index.html 을 가상 창에서(스크립트 ' + scripts.length + '개, 지도 라이브러리만 가짜)', '상태 자리 good · 운전 화면 보임',
        String(st.getAttribute(uiStatus.stage_attr)) + ' · 운전 화면 ' + (drive.hidden ? '숨음' : '보임') + ' · 상태 글 ' + JSON.stringify(st.textContent),
        st.getAttribute(uiStatus.stage_attr) === hc.stages.good && !drive.hidden);
      const expectMoves = Math.floor(T.page_listen_ms / T.tick_ms) - 1;
      row('⑤-2', '그 창의 지도 점이 S1 을 따라 옮겨짐', T.page_listen_ms + 'ms 동안 ≥ ' + expectMoves + '번', moved + '번', moved >= expectMoves);
      const pageLog = Object.values(opfs.files).join('');
      const startWord = JSON.parse(fs.readFileSync(path.join(APP, 'config', 'config_log.json'), 'utf8')).words.start;
      row('⑤-3', '그 창의 기록장(브라우저 파일 저장소 가짜)에 시작 줄 · 비밀 값 없음', '"' + startWord + '" 줄 있음 · 비밀 값 0곳',
        (pageLog.includes(startWord) ? '있음' : '없음') + ' · 비밀 값 ' + (pageLog.split(secret).length - 1 + pageConsole.join('\n').split(secret).length - 1) + '곳 · 파일 ' + Object.keys(opfs.files).join(','),
        pageLog.includes(startWord) && !pageLog.includes(secret) && !pageConsole.join('\n').includes(secret));
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
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
}

function printTable() {
  const lines = ['| # | 시험 | 기대 | 실제 | 결과 |', '|---|---|---|---|---|'];
  for (const r of rows) lines.push('| ' + [r.no, r.title, r.expect, r.actual, r.ok ? tc.pass_word : tc.fail_word].map((s) => String(s).replace(/\|/g, '/')).join(' | ') + ' |');
  const ok = rows.length > 0 && rows.every((r) => r.ok);
  lines.push('', 'A1 스스로 시험: ' + (ok ? tc.pass_word : tc.fail_word) + ' (' + rows.filter((r) => r.ok).length + ' / ' + rows.length + ') — ' + kstText(tc));
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
