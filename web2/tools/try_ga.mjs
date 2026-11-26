// 정비 가 스스로 시험(시험 고르개 · 격리 · 중복 빼기 · 기록장 경고). 값은 config_try_ga.json.
//   node web2/tools/try_ga.mjs pure   # 다리 없음(몇 초): 고르개 예시 · ⑦ 입출력 = 커밋 전 · ⑧ 기록장 · 격리 판정 · 등급 표
//   node web2/tools/try_ga.mjs app    # S1 가상 창(다리 run_seconds): 설정 하나씩 깨기 · ⑦ 옛·새 계산기 같은 입력 → 같은 조각 · ⑧ 상태 자리
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { loadToolsConfig, appDir, toolLog, kstText, TOOLS_DIR } from './lib_tools.mjs';
import { testbedInfo, makeSecret, writeSecretFile, startBridge, selectScene, seekScene, fetchWithLines } from './lib_testbed.mjs';
import { loadBoards, startApp as runApp, waitFor, memDisk, sleep } from './lib_apprun.mjs';
import { loadAppConfig } from './lib_appfiles.mjs';
import { pick, testMap } from './try_pick.mjs';

const tc = loadToolsConfig();
const T = JSON.parse(fs.readFileSync(path.join(TOOLS_DIR, 'config_try_ga.json'), 'utf8'));
const APP = appDir(tc);
const log = toolLog(tc, 'try_ga');
const cfgOf = (name) => JSON.parse(fs.readFileSync(path.join(APP, tc.build.config_dir, name + tc.build.config_ext), 'utf8'));
const srcOf = async (name) => import(pathToFileURL(path.join(APP, tc.build.src_dir, name + tc.build.module_ext)).href);
const HC = cfgOf('config_health');
const US = cfgOf('config_ui_status');
const LG = cfgOf('config_log');
const SC = cfgOf('config_statecalc');

const rows = [];
function row(no, title, expect, actual, ok) {
  rows.push({ no, title, expect, actual, ok: !!ok });
  log.write(ok ? '통과' : '실패', { no, title, expect, actual });
}
const wait = (fn, ms) => waitFor(fn, ms, tc.testbed.poll_ms);
const fill = (tpl, vals) => tpl.replace(new RegExp(US.slot_re, 'g'), (m, k) => (vals[k] === undefined ? '' : String(vals[k])));
const offLine = (feat) => fill(US.texts.off_line, { feat: US.texts.feature_names[feat] || feat });

function gitShow(rel) {
  const r = spawnSync(tc.git.cmd, ['show', 'HEAD:' + T.pure.pick_prefix + rel], { cwd: APP, encoding: 'utf8' });
  if (r.status !== tc.exit.ok) throw new Error('git show ' + rel + ': ' + r.stderr);
  return r.stdout;
}

// ---------- 순수 ----------
async function partPure() {
  const P = T.pure;
  // ① 고르개 예시
  const tests = testMap();
  P.picks.forEach((c, i) => {
    const res = pick(c.files, { prefix: P.pick_prefix });
    const missing = c.must.filter((t) => !res.tests.includes(t));
    const extra = c.must_not.filter((t) => res.tests.includes(t));
    const notChrome = c.only_chrome ? res.tests.filter((t) => !tests[t].chrome) : [];
    const noneOk = !c.none || res.tests.length === 0;
    row('①-' + (i + 1), '고르개: ' + c.files.join(', ') + ' 고침', '꼭: ' + (c.must.join('·') || '없음') + ' / 안 됨: ' + c.must_not.join('·') + (c.only_chrome ? ' / 크롬 시험만' : '') + (c.none ? ' / 아무것도' : ''),
      '고름 ' + (res.tests.join('·') || '없음') + (missing.length ? ' · 빠짐 ' + missing.join('·') : '') + (extra.length ? ' · 더 고름 ' + extra.join('·') : '') + (notChrome.length ? ' · 크롬 아님 ' + notChrome.join('·') : ''),
      !missing.length && !extra.length && !notChrome.length && noneOk);
  });
  // ①-git: 인자 없이(작업 트리) 돌아감
  const r = spawnSync(process.execPath, [path.join(TOOLS_DIR, 'try_pick.mjs')], { encoding: 'utf8' });
  row('①-git', '고르개를 인자 없이(작업 트리 + 스테이지 + 새 파일) 돌림', '종료 0 · 시험 이름 한 줄 이상', '종료 ' + r.status + ' · ' + r.stdout.trim().split(/\r?\n/).filter(Boolean).length + '줄', r.status === tc.exit.ok && r.stdout.trim().length > 0);

  // ② ⑦ 입출력 = 커밋 전 config_calcrunner
  const statecalc = await srcOf('statecalc');
  const head = JSON.parse(gitShow(P.head_calcrunner));
  const io = statecalc.ioOf(SC.table);
  const now = cfgOf('config_calcrunner');
  row('②-1', '⑦ 계산 표에서 뽑은 입력 = 커밋 전 config_calcrunner.inputs (차례까지)', JSON.stringify(head.inputs), JSON.stringify(io.inputs), JSON.stringify(head.inputs) === JSON.stringify(io.inputs));
  row('②-2', '⑦ 계산 표에서 뽑은 조각 = 커밋 전 config_calcrunner.outputs (차례까지)', JSON.stringify(head.outputs), JSON.stringify(io.outputs), JSON.stringify(head.outputs) === JSON.stringify(io.outputs));
  row('②-3', '⑦ 지금 config_calcrunner 에 inputs·outputs 가 없음(한 곳에만 적음)', '둘 다 없음', 'inputs ' + ('inputs' in now ? '있음' : '없음') + ' · outputs ' + ('outputs' in now ? '있음' : '없음'), !('inputs' in now) && !('outputs' in now));
  let threw = false;
  try { statecalc.ioOf(null); } catch (e) { threw = true; }
  row('②-4', '⑦ 표가 배열이 아니면 던짐', '던짐', threw ? '던짐' : '안 던짐', threw);

  // ③ ⑧ 기록장 읽기 실패
  const { createConfig } = await srcOf('cfg');
  const { createLogger } = await srcOf('log');
  const timefmt = await srcOf('timefmt');
  const { raw } = loadAppConfig(APP, tc.build, { buildInfo: { stamp: 'ga', at: kstText(tc), commit: 'ga' } });
  const cfg = createConfig(raw);
  const base = memDisk();
  let failRead = false;
  const disk = { ...base, read: async (d, f) => { if (failRead) throw new Error('read-broken'); return base.read(d, f); } };
  const con = [];
  const lg = createLogger({ cfg, timefmt, disk, clock: { now: () => Date.now() }, console: { error: (...a) => con.push(a.map(String).join(' ')) } });
  const seenState = [];
  lg.watch((s) => seenState.push(s));
  lg.info('try_ga', 'start', { n: 1 });
  lg.info('try_ga', 'start', { n: 2 });
  await lg.flush();
  failRead = true;
  const text = await lg.readAll();
  await lg.flush();
  const mem = lg.lines();
  const warnLine = mem.find((l) => l.includes(LG.level_words.warn) && l.includes(LG.words[LG.read_fail_word]));
  row('③-1', '⑧ 기록장 파일을 못 읽음 → 메모리에 든 줄을 돌려줌(앱은 계속)', '앞에 쓴 두 줄 들어 있음', (text.split('\n').filter(Boolean).length) + '줄', text.split('\n').filter((l) => l.includes('try_ga')).length >= 2);
  row('③-2', '⑧ 조용히 바꾸지 않음 — 경고 로그 한 줄 · 콘솔 한 줄', '주의 「' + LG.words[LG.read_fail_word] + '」 · 콘솔 「' + LG.console_read_prefix.trim() + '」', (warnLine ? '경고 있음' : '경고 없음') + ' · 콘솔 ' + con.filter((l) => l.startsWith(LG.console_read_prefix)).length, !!warnLine && con.some((l) => l.startsWith(LG.console_read_prefix)));
  const st1 = lg.status();
  row('③-3', '⑧ 기록장 상태 = 읽기 실패(watch 로 알림 → 상태 자리 줄은 HealthRunner 가)', JSON.stringify({ ok: false, why: LG.read_fail_code }), JSON.stringify(st1) + ' · 알림 ' + seenState.length, st1.ok === false && st1.why === LG.read_fail_code && seenState.some((s) => s.why === LG.read_fail_code));
  lg.info('try_ga', 'after', {});
  await lg.flush();
  const st2 = lg.status();
  row('③-4', '⑧ 다음 쓰기가 잘 되어도 읽기 실패는 남음(다음 읽기가 될 때 풀림)', LG.read_fail_code, JSON.stringify(st2), st2.why === LG.read_fail_code);
  failRead = false;
  const text2 = await lg.readAll();
  const st3 = lg.status();
  row('③-5', '⑧ 다시 읽히면 풀림 · 파일 글을 돌려줌', JSON.stringify({ ok: true, why: '' }), JSON.stringify(st3) + ' · ' + text2.split('\n').filter(Boolean).length + '줄', st3.ok === true && text2.includes('after'));

  // ④ 격리 판정(순수)
  const health = await srcOf('health');
  const off1 = health.judgeConfigOff({ problems: [{ file: 'config_engine', key: '', why: 'missing' }] }, HC);
  const off0 = health.judgeConfigOff({ problems: [] }, HC);
  const offTap = health.judgeConfigOff({ problems: [{ file: 'config_tap', key: '', why: 'missing' }] }, HC);
  row('④-1', '격리 판정: config_engine 틀림 → 목록·추천(plan)만 꺼짐 / 문제 없음 → 없음 / config_tap → tap', 'plan / [] / tap', JSON.stringify(off1) + ' / ' + JSON.stringify(off0) + ' / ' + JSON.stringify(offTap),
    JSON.stringify(off1) === JSON.stringify(['plan']) && off0.length === 0 && JSON.stringify(offTap) === JSON.stringify(['tap']));
  const app1 = health.judgeApp({ problems: [{ file: 'config_tap', key: '', why: 'missing' }], start: {}, startedAt: 0, now: 0, prev: null }, HC);
  row('④-2', 'config_tap 이 틀려도 앱은 점검 중이 아님(A8 때는 등급 표에 없어 앱 전체가 점검 중)', HC.stages.starting, app1.stage, app1.stage === HC.stages.starting);

  // ⑤ 등급 표·이름 빠짐
  const files = fs.readdirSync(path.join(APP, tc.build.config_dir)).filter((n) => n.endsWith(tc.build.config_ext)).map((n) => path.basename(n, tc.build.config_ext));
  const extra = [tc.build.secret_name, tc.build.build_name];
  const ungraded = [...files, ...extra].filter((f) => !(f in HC.grades));
  row('⑤-1', '모든 설정 파일이 등급 표(config_health.grades)에 있음 — 없으면 unknown_grade(app)라 그 설정이 깨지면 앱 전체가 점검 중', '빠진 것 0', ungraded.join(', ') || '0', ungraded.length === 0);
  const noName = Object.keys(HC.features).filter((f) => !US.texts.feature_names[f]);
  row('⑤-2', '모든 기능에 상태 자리 이름(config_ui_status.texts.feature_names)이 있음', '빠진 것 0', noName.join(', ') || '0', noName.length === 0);
  const noFeature = Object.entries(HC.grades).filter(([f, g]) => g !== HC.app_grade && !Object.values(HC.features).some((x) => x.configs.includes(f))).map(([f]) => f);
  row('⑤-3', '꺼도 되는 설정(등급 app 아님)은 모두 어느 기능에 들어 있음(꺼질 때 상태 자리 줄이 나옴)', '빠진 것 0', noFeature.join(', ') || '0', noFeature.length === 0);
}

// ---------- 다리·앱 ----------
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

// 옛·새 계산기에 같은 입력 기록을 넣는다(가짜 State·시계 — 알림 하나마다 모아 둔 셈을 곧바로 돌림)
function replay(create, cfg, statecalc, parts, events) {
  const handlers = {};
  const pubs = [];
  const errors = [];
  let claimed = null;
  let pending = null;
  const state = {
    claim: (owner, names) => { claimed = names.slice(); return (p, v) => pubs.push([p, JSON.stringify(v)]); },
    subscribe: (n, fn) => { handlers[n] = fn; },
  };
  const clock = { setTimeout: (fn) => { pending = fn; return 1; }, now: () => 0 };
  const lg = { error: (e, ctx) => errors.push(String(e && e.message) + ' ' + JSON.stringify(ctx && ctx.params && ctx.params.piece)) };
  create({ cfg, log: lg, state, clock, statecalc, parts });
  for (const ev of events) {
    if (handlers[ev.name]) handlers[ev.name](ev.v, ev.name);
    if (pending) { const f = pending; pending = null; f(); }
  }
  return { pubs, errors, claimed, subs: Object.keys(handlers) };
}

async function partApp() {
  const A = T.app;
  const main = (await srcOf('app')).main;
  const boards = await loadBoards(APP, tc);
  const statecalc = await srcOf('statecalc');
  const { createConfig } = await srcOf('cfg');
  const io = statecalc.ioOf(SC.table);
  const open = (overrides, disk) => runApp({ app: APP, tc, main, boards }, { secretFile: SECRET_FILE, fetchFn: fetchWithLines(tc, INFO, SECRET, fetch), stamp: 'try-ga', overrides, disk });
  await withBridge(A.run_seconds, async () => {
    await selectScene(INFO, A.scene, false);
    if (A.tick) await seekScene(INFO, A.tick);

    // ⑦ 기록 → 옛·새 계산기
    const events = [];
    const a = open();
    for (const n of io.inputs) a.made.state.subscribe(n, (v) => events.push({ name: n, v }));
    await wait(() => a.stage() === HC.stages.good, A.start_wait_ms);
    await sleep(A.record_ms);
    const lastFix = [...events].reverse().find((e) => e.name === 'fix');
    if (lastFix) {
      events.push({ name: 'plan.request', v: { open: true, seq: 1, at: lastFix.v.t, soc: 60 } });
      events.push({ name: 'map.tap', v: { seq: 1, lat: lastFix.v.lat + 0.01, lng: lastFix.v.lng } });
      events.push(lastFix);
    }
    const goodStatus = a.statusText();
    const goodOff = a.get('health.off');
    a.stop();
    row('⑥-0', '설정 그대로 — 앱 좋음 · 상태 자리 비어 있음 · 꺼 둔 기능 없음 · 꺼 둔 계산 줄 없음', '좋음 · "" · [] · []', a.stage() + ' · ' + JSON.stringify(goodStatus) + ' · ' + JSON.stringify(goodOff) + ' · ' + JSON.stringify(a.made.calcrunner && a.made.calcrunner.off()),
      a.stage() === HC.stages.good && goodStatus === '' && Array.isArray(goodOff) && goodOff.length === 0 && a.made.calcrunner && a.made.calcrunner.off().length === 0);

    const parts = {};
    for (const row0 of SC.table) parts[row0.part] = await srcOf(row0.part);
    for (const n of A.parts_extra) parts[n] = await srcOf(n);
    const tmp = path.join(APP, tc.tmp_dir, A.tmp_dir);
    fs.mkdirSync(tmp, { recursive: true });
    const headFile = path.join(tmp, A.head_module);
    fs.writeFileSync(headFile, gitShow(tc.build.src_dir + '/calcrunner' + tc.build.module_ext), 'utf8');
    const oldMod = await import(pathToFileURL(headFile).href);
    const newMod = await srcOf('calcrunner');
    const raw = a.raw;
    const headCfg = JSON.parse(gitShow(T.pure.head_calcrunner));
    const headShape = JSON.parse(gitShow(tc.build.shape_dir + '/config_calcrunner' + tc.build.shape_ext));
    const cfgOld = createConfig({ ...raw, files: { ...raw.files, config_calcrunner: headCfg }, shapes: { ...raw.shapes, config_calcrunner: headShape } });
    const cfgNew = createConfig(raw);
    const o = replay(oldMod.createCalcRunner, cfgOld, statecalc, parts, events);
    const nw = replay(newMod.createCalcRunner, cfgNew, statecalc, parts, events);
    const same = JSON.stringify(o.pubs) === JSON.stringify(nw.pubs);
    const pieces = [...new Set(nw.pubs.map((p) => p[0]))];
    row('⑦-1', '⑦ 같은 입력 기록(S1 ' + A.record_ms / tc.view_s1.ms_per_s + '초 · 목록 열기·지도 누름 더함)을 커밋 전 계산기와 새 계산기에 넣음 → 낸 조각이 차례·값까지 같음',
      '같음', '알림 ' + events.length + ' · 옛 ' + o.pubs.length + ' / 새 ' + nw.pubs.length + '개 · 조각 ' + pieces.join(',') + ' · ' + (same ? '같음' : '다름'), same && nw.pubs.length > 0);
    row('⑦-2', '⑦ 구독 입력·맡은 조각·오류도 같음', '같음', '구독 ' + (JSON.stringify(o.subs) === JSON.stringify(nw.subs) ? '같음' : '다름') + ' · 조각 ' + (JSON.stringify(o.claimed) === JSON.stringify(nw.claimed) ? '같음' : '다름') + ' · 오류 ' + o.errors.length + '/' + nw.errors.length,
      JSON.stringify(o.subs) === JSON.stringify(nw.subs) && JSON.stringify(o.claimed) === JSON.stringify(nw.claimed) && JSON.stringify(o.errors) === JSON.stringify(nw.errors));

    // ⑥ 격리: 설정 하나씩 깨기
    let i = 0;
    for (const cs of A.cases) {
      i += 1;
      const b = open({ [cs.file]: A.broken_value });
      await wait(() => b.stage() && b.stage() !== HC.stages.starting, A.start_wait_ms);
      await wait(() => b.seen.fixes.length > 0, A.fix_wait_ms);
      await sleep(A.settle_ms);
      const stage = b.stage();
      const text = b.statusText();
      const pieces2 = A.basic_pieces.map((p) => p + (b.get(p) ? ' 있음' : ' 없음'));
      const madeBad = A.basic_made.filter((m) => !cs.made_off.includes(m) && !b.made[m]);
      const madeOff = cs.made_off.filter((m) => b.made[m]);
      const rowsOff = b.made.calcrunner ? b.made.calcrunner.off() : null;
      const rowsOk = rowsOff && JSON.stringify([...rowsOff].sort()) === JSON.stringify([...cs.rows_off].sort());
      const mapOk = b.lib.maps.length >= 1;
      const off = b.get('health.off') || [];
      const ok = stage === HC.stages.good && text.includes(offLine(cs.feature)) && off.includes(cs.feature)
        && A.basic_pieces.every((p) => b.get(p)) && !madeBad.length && !madeOff.length && rowsOk && mapOk && b.seen.fixes.length > 0;
      row('⑥-' + i, cs.file + ' 를 깸 → ' + cs.feature + ' 만 꺼짐 · 기본 기능(지도·내 위치·속도판·제한 속도·경로·검색·누른 지점 거리) 돎',
        '좋음 · 상태 「' + offLine(cs.feature) + '」 · 계산 줄 꺼짐 ' + JSON.stringify(cs.rows_off) + ' · 안 만든 화면 ' + JSON.stringify(cs.made_off),
        stage + ' · 상태 ' + JSON.stringify(text) + ' · 꺼짐 ' + JSON.stringify(off) + ' · 계산 줄 꺼짐 ' + JSON.stringify(rowsOff) + ' · ' + pieces2.join('/') + ' · 위치 ' + b.seen.fixes.length + ' · 지도 ' + b.lib.maps.length + (madeBad.length ? ' · 못 만든 기본 ' + madeBad.join(',') : '') + (madeOff.length ? ' · 만들어짐 ' + madeOff.join(',') : ''),
        ok);
      b.stop();
    }
    for (const cs of A.must_cases) {
      i += 1;
      const b = open({ [cs.file]: A.broken_value });
      await wait(() => b.stage() && b.stage() !== HC.stages.starting, A.start_wait_ms);
      const ap = b.app();
      const text = b.statusText();
      row('⑥-' + i, cs.file + '(시작에 꼭 필요) 를 깸 → 지금처럼 앱 점검 중', '점검 중 · 까닭 ' + cs.why_code + ' · 「' + US.texts.broken + '」',
        String(b.stage()) + ' · ' + JSON.stringify(ap.why) + ' · ' + JSON.stringify(text), b.stage() === HC.stages.broken && ap.why && ap.why.code === cs.why_code && text.includes(US.texts.broken));
      b.stop();
    }

    // ⑧ 앱에서 기록장 읽기 실패
    const baseDisk = memDisk();
    let failRead = false;
    const disk = { ...baseDisk, files: baseDisk.files, read: async (d, f) => { if (failRead) throw new Error('read-broken'); return baseDisk.read(d, f); } };
    const c = open(undefined, disk);
    await wait(() => c.stage() === HC.stages.good, A.start_wait_ms);
    failRead = true;
    await c.made.log.readAll();
    const logName = US.texts.src_names[HC.trouble_source.log];
    const readWord = US.texts.why_words[LG.read_fail_code];
    const shown = await wait(() => c.statusText().includes(logName) && c.statusText().includes(readWord), A.read_wait_ms);
    const shownText = c.statusText();
    failRead = false;
    await c.made.log.readAll();
    const gone = await wait(() => !c.statusText().includes(logName), A.read_wait_ms);
    const warned = c.logLines().some((l) => l.includes(LG.words[LG.read_fail_word]));
    row('⑧-1', '⑧ 앱에서 기록장 파일을 못 읽음 → 상태 자리 한 줄 · 경고 로그 → 다시 읽히면 줄 사라짐 · 앱 좋음', '「' + logName + ' — … (' + readWord + ')」 → 사라짐',
      JSON.stringify(shownText) + ' · 경고 ' + (warned ? '있음' : '없음') + ' · ' + (gone ? '사라짐' : '남음') + ' · ' + c.stage(), shown && warned && gone && c.stage() === HC.stages.good);
    c.stop();
  });
}

const PARTS = { pure: partPure, app: partApp };
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
  const text = '# 정비 가 스스로 시험 — ' + which + ' (' + kstText(tc) + ')\n\n' + table.join('\n') + '\n\n' + rows.filter((r) => r.ok).length + '/' + rows.length + ' 통과\n';
  fs.mkdirSync(path.join(APP, tc.log.dir), { recursive: true });
  fs.writeFileSync(path.join(APP, tc.log.dir, T.report_prefix + which + '.md'), text, 'utf8');
  process.stdout.write(text);
  log.write('끝', { part: which, pass: rows.filter((r) => r.ok).length, all: rows.length });
  process.exitCode = rows.every((r) => r.ok) ? tc.exit.ok : tc.exit.fail;
}
await mainRun();
