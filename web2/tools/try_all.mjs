// 전체 시험(정비 가 ②): try_* 를 모두 차례로 돌려 표 하나로(시험 · 통과/전체 · 걸린 초 · 실패 줄) + 맨 위 한 줄 합계.
//   node web2/tools/try_all.mjs                       # 전부(설정 config_try_all.json 의 runs 차례 + 거기 없는 새 try_*)
//   node web2/tools/try_all.mjs --only try_a1,try_a5:chrome:ok   # 일부만(시험 이름 = 그 시험의 부분 전부, 이름:부분 = 그 부분만)
//   node web2/tools/try_all.mjs --only … --append     # 앞 결과(try_all_last.json)에 이어 붙임 — 한 번에 다 못 돌릴 때 나눠 돌리기
//   node web2/tools/try_all.mjs --list                # 돌릴 차례만 보기
// 결과: web2/tools/logs/try_all_last.md(+ .json), 시험마다 찍은 글 logs/try_all_out/. 실패(한도 넘음·표 없음 포함)가 있으면 종료 코드 1.
// 한 시험이 한도(limit_s)를 넘기면 그 시험과 딸린 프로세스(다리·크롬)를 끊고 다음으로 간다.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { loadToolsConfig, appDir, toolLog, kstText, TOOLS_DIR } from './lib_tools.mjs';

const ALL_CONFIG = 'config_try_all.json';
const tc = loadToolsConfig();
const APP = appDir(tc);
const C = JSON.parse(fs.readFileSync(path.join(TOOLS_DIR, ALL_CONFIG), 'utf8'));
const log = toolLog(tc, C.log_name);
const LOG_DIR = path.join(APP, tc.log.dir);
const OUT_DIR = path.join(LOG_DIR, C.out_dir);
const REPORT = path.join(LOG_DIR, C.report_file);
const REPORT_JSON = REPORT.replace(/\.md$/, tc.build.config_ext);

const keyOf = (r) => [path.basename(r.file, C.tests.ext), ...r.args].join(':');

function runList() {
  const runs = C.runs.map((r) => ({ ...r }));
  const known = new Set(runs.map((r) => r.file));
  const files = fs.readdirSync(TOOLS_DIR).filter((n) => n.startsWith(C.tests.prefix) && n.endsWith(C.tests.ext) && !C.not_tests.includes(n)).sort();
  for (const f of files) if (!known.has(f)) runs.push({ file: f, args: [], limit_s: C.default_limit_s, auto: true });
  return runs.filter((r) => fs.existsSync(path.join(TOOLS_DIR, r.file)));
}

function killTree(pid) {
  spawnSync(tc.chrome.kill_cmd, [...tc.chrome.kill_args_before_pid, String(pid), ...tc.chrome.kill_args_after_pid], { encoding: 'utf8' });
}

function runOne(r) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const proc = spawn(C.node, [path.join(TOOLS_DIR, r.file), ...r.args], { cwd: path.resolve(APP, C.cwd), windowsHide: true });
    let out = '';
    let timedOut = false;
    proc.stdout.on('data', (d) => { if (out.length < C.max_buffer) out += d.toString('utf8'); });
    proc.stderr.on('data', (d) => { if (out.length < C.max_buffer) out += d.toString('utf8'); });
    const guard = setTimeout(() => { timedOut = true; killTree(proc.pid); }, r.limit_s * C.ms_per_s);
    proc.on('close', (code) => {
      clearTimeout(guard);
      resolve({ code, out, timedOut, sec: Math.round((Date.now() - t0) / C.ms_per_s) });
    });
    proc.on('error', (e) => { clearTimeout(guard); resolve({ code: null, out: out + '\n' + e.message, timedOut, sec: Math.round((Date.now() - t0) / C.ms_per_s) }); });
  });
}

function score(out) {
  const rx = new RegExp(C.row_re);
  const rows = out.split(/\r?\n/).map((l) => l.match(rx)).filter(Boolean);
  const fails = rows.filter((m) => m[3] === tc.fail_word).map((m) => (m[1] + ' ' + m[2]).slice(0, C.fail_text_max));
  return { pass: rows.length - fails.length, all: rows.length, fails };
}

function cell(s) { return String(s).replace(/\|/g, '/').replace(/\r?\n/g, ' '); }

function writeReport(results, startedAt) {
  const done = results.filter((x) => x.state === 'ran');
  const pass = done.reduce((n, x) => n + x.pass, 0);
  const all = done.reduce((n, x) => n + x.all, 0);
  const badRuns = results.filter((x) => !x.ok && x.state !== 'off');
  const failRuns = results.filter((x) => !x.ok && x.state === 'ran').length;
  const notRun = results.filter((x) => x.state === 'not_run').length;
  const sec = results.reduce((n, x) => n + (x.sec || 0), 0);
  const top = '합계: 시험 ' + results.length + '묶음(돌림 ' + done.length + ') · 줄 ' + pass + '/' + all + ' 통과 · 실패 묶음 ' + failRuns + ' · ' + C.words.not_run + ' ' + notRun + ' · ' + sec + '초 — ' + (badRuns.length ? tc.fail_word : tc.pass_word) + ' (' + startedAt + ' 시작 · ' + kstText(tc) + ' 끝)';
  const lines = [top, '', '# 전체 시험 (try_all)', '', '| 시험 | 통과/전체 | 걸린 초 | 종료 | 실패 줄 |', '|---|---|---|---|---|'];
  for (const x of results) {
    const end = x.state === 'off' ? C.words.off : x.state === 'not_run' ? C.words.not_run : x.timedOut ? C.words.timeout : String(x.code);
    const failText = x.fails && x.fails.length ? x.fails.slice(0, C.fail_rows_max).join(' ┃ ') + (x.fails.length > C.fail_rows_max ? ' ┃ …(' + x.fails.length + ')' : '') : (x.state === 'ran' && !x.ok && !x.all ? C.words.crash : '');
    lines.push('| ' + [x.key, x.state === 'ran' ? x.pass + '/' + x.all : '-', x.sec === undefined ? '-' : x.sec, end, failText].map(cell).join(' | ') + ' |');
  }
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.writeFileSync(REPORT, lines.join('\n') + '\n', 'utf8');
  fs.writeFileSync(REPORT_JSON, JSON.stringify({ startedAt, results }, null, 1), 'utf8');
  return { top, bad: badRuns.length };
}

async function main() {
  const argv = process.argv.slice(2);
  const onlyAt = argv.indexOf('--only');
  const only = onlyAt >= 0 ? (argv[onlyAt + 1] || '').split(',').filter(Boolean) : null;
  const append = argv.includes('--append');
  const runs = runList();
  if (argv.includes('--list')) { for (const r of runs) console.log(keyOf(r) + '\t' + r.limit_s + '초' + (r.s12 && !C.s12 ? ' (끔)' : '') + (r.auto ? ' (새 시험)' : '')); return; }
  const want = (r) => !only || only.some((k) => keyOf(r) === k || path.basename(r.file, C.tests.ext) === k);
  let prev = { startedAt: kstText(tc), results: [] };
  if (append && fs.existsSync(REPORT_JSON)) prev = JSON.parse(fs.readFileSync(REPORT_JSON, 'utf8'));
  const byKey = new Map(prev.results.map((x) => [x.key, x]));
  const startedAt = append ? prev.startedAt : kstText(tc);
  log.write('시작', { only, append, runs: runs.filter(want).map(keyOf) });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const r of runs) {
    const key = keyOf(r);
    if (!want(r)) { if (!byKey.has(key)) byKey.set(key, { key, state: 'not_run', ok: false }); continue; }
    if (r.s12 && !C.s12) { byKey.set(key, { key, state: 'off', ok: true }); continue; }
    log.write('시험 시작', { key, limit_s: r.limit_s });
    process.stdout.write(kstText(tc) + ' ▶ ' + key + ' (한도 ' + r.limit_s + '초)\n');
    const res = await runOne(r);
    fs.writeFileSync(path.join(OUT_DIR, key.replace(/:/g, '_') + C.out_ext), res.out, 'utf8');
    const s = score(res.out);
    const ok = !res.timedOut && res.code === tc.exit.ok && s.all > 0 && s.fails.length === 0;
    byKey.set(key, { key, state: 'ran', ok, code: res.code, timedOut: res.timedOut, sec: res.sec, pass: s.pass, all: s.all, fails: s.fails });
    log.write('시험 끝', { key, ok, code: res.code, timedOut: res.timedOut, sec: res.sec, pass: s.pass, all: s.all, fails: s.fails.slice(0, C.fail_rows_max) });
    process.stdout.write(kstText(tc) + ' ■ ' + key + ' ' + s.pass + '/' + s.all + ' · ' + res.sec + '초 · ' + (res.timedOut ? C.words.timeout : '종료 ' + res.code) + (ok ? '' : ' — ' + tc.fail_word) + '\n');
    writeReport(runs.map((x) => byKey.get(keyOf(x))).filter(Boolean), startedAt);
  }
  const ordered = runs.map((x) => byKey.get(keyOf(x)) || { key: keyOf(x), state: 'not_run', ok: false });
  const rep = writeReport(ordered, startedAt);
  console.log(rep.top);
  console.log('표: ' + REPORT);
  log.write('끝', { top: rep.top });
  // 이번에 고른 묶음 가운데 실패가 있으면 1 (나눠 돌릴 때 앞 묶음의 '못 돌림'은 이번 종료 코드에 넣지 않음)
  const mine = ordered.filter((x) => runs.some((r) => keyOf(r) === x.key && want(r)));
  process.exitCode = mine.every((x) => x.ok) ? tc.exit.ok : tc.exit.fail;
}

try {
  await main();
} catch (e) {
  log.write('실패', { error: String(e && e.stack || e) });
  console.error('전체 시험 실패: ' + e.message);
  process.exitCode = tc.exit.fail;
}
