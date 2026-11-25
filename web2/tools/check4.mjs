// web2 기계 검사 네 가지(node 기본 모듈만). 설계 6-4.
//   node web2/tools/check4.mjs
// ① 빌드      : 빌드 도구가 임시 폴더에 0 으로 끝나고 산출물에 이번 판 글자가 있음 + 모든 설정 JSON·꼴 표가 읽히고 꼴에 맞음
// ② 박힌 값   : src/*.js 의 숫자(허용 밖)·글(한글·주소·경로·키 무늬)·지역 시각 함수·창 닫기/알림창, 화면 조각(.html)의 한글,
//               주소가 있어도 되는 설정 파일 밖의 http, 저장소 안 앱 비밀 값 파일
// ③ 순환 의존 : import 와 NEEDS(받는 것 목록)를 이은 고리
// ④ 직접 불러 쓰기 : 허용 목록 밖 import · 층 표(설계 원칙 '만드는 차례와 기댐') 밖의 NEEDS · NEEDS 에 없는 deps.X ·
//               싱글톤 스스로 만들기·전역(window/document/navigator) · 계산 쪽의 판정 글자 · 화면 안 클라이언트 이름
// 표로 찍고 하나라도 실패면 0 아닌 코드. 시작·끝·걸린 곳은 도구 기록장(tools/logs/check4.log)에.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { loadToolsConfig, appDir, toolLog, listFiles } from './lib_tools.mjs';
import { lex, numberValue, readImports, withoutImports } from './lib_js.mjs';
import { loadAppConfig } from './lib_appfiles.mjs';

const tc = loadToolsConfig();
const c4 = tc.check4;
const APP = appDir(tc);
const log = toolLog(tc, 'check4');
const rel = (p) => path.relative(APP, p).split(path.sep).join('/');

function modulesOf() {
  const dir = path.join(APP, c4.src_dir);
  return listFiles(dir, c4.module_ext).map((p) => ({
    path: p, name: path.basename(p, c4.module_ext), src: fs.readFileSync(p, 'utf8'),
  }));
}

function configFiles() {
  return listFiles(path.join(APP, c4.config_dir), c4.config_ext);
}

// ---------- ① 빌드 ----------
async function checkBuild(mods) {
  const bad = [];
  const buildTool = path.join(APP, c4.build_tool);
  const cfgs = configFiles();
  const shapes = listFiles(path.join(APP, c4.shape_dir), c4.config_ext);
  if (!mods.length && !fs.existsSync(buildTool)) {
    return { bad, seen: '앱 아직 없음(모듈 0 · 빌드 도구 없음) — 볼 것 없음' };
  }
  if (!fs.existsSync(buildTool)) bad.push(c4.build_tool + ': 빌드 도구가 없음');
  // 설정 JSON(같은 키 두 번 포함)·꼴 표 읽기 + 꼴 검사(빌드가 넣는 비밀 값·빌드 기록은 시험 값으로)
  const { raw, errors } = loadAppConfig(APP, tc.build, { overrides: c4.build_supplied });
  for (const e of errors) bad.push(rel(e.file) + ': 안 읽힘 — ' + e.why);
  const cfgMod = path.join(APP, c4.src_dir, 'cfg' + c4.module_ext);
  if (fs.existsSync(cfgMod)) {
    try {
      const { createConfig } = await import(pathToFileURL(cfgMod).href);
      const cfg = createConfig(raw);
      for (const p of cfg.problems()) bad.push('설정 꼴: ' + p.file + (p.key ? '.' + p.key : '') + ' — ' + p.why + (p.detail ? ' (' + p.detail + ')' : ''));
    } catch (e) {
      bad.push('설정 꼴 검사를 못 함 — ' + e.message);
    }
  }
  let stampInfo = '';
  if (fs.existsSync(buildTool)) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'web2-check4-'));
    const secretFile = path.join(tmp, c4.hardcode.secret_file);
    fs.writeFileSync(secretFile, JSON.stringify({ app_secret: c4.build_secret_test_value }), 'utf8');
    const outDir = path.join(tmp, 'out');
    const r = spawnSync(process.execPath, [buildTool, '--out', outDir, '--secret', secretFile], { encoding: 'utf8' });
    if (r.status !== tc.exit.ok) {
      bad.push('빌드가 0 이 아닌 코드로 끝남(' + r.status + ') — ' + (r.stderr || r.stdout || '').trim().split('\n').slice(-3).join(' / '));
    } else {
      const outFile = path.join(outDir, c4.build_out_file);
      const stampFile = path.join(outDir, c4.build_stamp_file);
      if (!fs.existsSync(outFile)) bad.push('빌드 산출물이 없음: ' + c4.build_out_file);
      else if (!fs.existsSync(stampFile)) bad.push('빌드 기록이 없음: ' + c4.build_stamp_file);
      else {
        const stamp = JSON.parse(fs.readFileSync(stampFile, 'utf8'))[c4.build_stamp_key];
        const html = fs.readFileSync(outFile, 'utf8');
        if (!stamp || !html.includes(stamp)) bad.push('산출물에 이번 판 글자(' + stamp + ')가 없음');
        stampInfo = ' · 판 ' + stamp + ' · ' + Math.round(fs.statSync(outFile).size / 1024) + 'KB';
      }
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return { bad, seen: '설정 ' + cfgs.length + ' · 꼴 표 ' + shapes.length + ' · 모듈 ' + mods.length + stampInfo };
}

// ---------- ② 박힌 값 ----------
function checkHardcode(mods) {
  const h = c4.hardcode;
  const bad = [];
  const patterns = h.string_patterns.map((p) => new RegExp(p));
  const banned = h.banned_code.map((p) => new RegExp(p));
  const allowedNums = new Set(h.allowed_numbers);
  const allowedStrs = new Set(h.allowed_strings);
  for (const m of mods) {
    const lx = lex(withoutImports(m.src, c4));
    for (const num of lx.numbers) {
      const v = numberValue(num.text);
      if (!allowedNums.has(v)) bad.push(rel(m.path) + ':' + num.line + ': 숫자 ' + num.text);
    }
    for (const s of lx.strings) {
      if (allowedStrs.has(s.text)) continue;
      const hit = patterns.find((rx) => rx.test(s.text));
      if (hit) bad.push(rel(m.path) + ':' + s.line + ': 글 ' + JSON.stringify(s.text) + ' (무늬 ' + hit.source + ')');
    }
    lx.code.split('\n').forEach((text, idx) => {
      for (const rx of banned) if (rx.test(text)) bad.push(rel(m.path) + ':' + (idx + 1) + ': 쓰면 안 되는 것 (' + rx.source + ')');
    });
  }
  // 화면 조각(.html)의 한글 — 화면 글은 설정에서
  const hangul = patterns[0];
  const views = listFiles(path.join(APP, c4.src_dir), '.html');
  for (const v of views) {
    fs.readFileSync(v, 'utf8').split('\n').forEach((t, idx) => {
      const noComment = t.replace(/<!--.*?-->/g, '');
      if (hangul.test(noComment)) bad.push(rel(v) + ':' + (idx + 1) + ': 화면 조각에 한글 글');
    });
  }
  // 주소: 허용한 설정 파일 밖의 http
  const cfgs = configFiles();
  for (const p of cfgs) {
    const name = path.basename(p);
    if (name === h.secret_file) { bad.push(rel(p) + ': 앱 비밀 값 파일이 저장소 안에 있음'); continue; }
    if (h.http_ok_config_files.includes(name)) continue;
    if (fs.readFileSync(p, 'utf8').toLowerCase().includes(h.http_word)) bad.push(rel(p) + ': 주소(' + h.http_word + ')가 있으면 안 되는 설정');
  }
  return { bad, seen: '.js ' + mods.length + ' · 화면 조각 ' + views.length + ' · 설정 ' + cfgs.length };
}

// ---------- 모듈 사이 이음 ----------
function edgesOf(mods) {
  const out = {};
  const needsRx = new RegExp(c4.needs_decl);
  for (const m of mods) {
    const { imports, bad } = readImports(m.src, c4);
    const nm = m.src.match(needsRx);
    const needs = nm ? nm[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : null;
    out[m.name] = { imports, badImports: bad, needs };
  }
  return out;
}

// ---------- ③ 순환 의존 ----------
function checkCycles(mods) {
  const e = edgesOf(mods);
  const names = new Set(mods.map((m) => m.name));
  const graph = {};
  for (const m of mods) {
    const to = new Set();
    for (const im of e[m.name].imports) if (names.has(im.from)) to.add(im.from);
    for (const d of e[m.name].needs || []) {
      const t = c4.dep_module[d];
      if (t && names.has(t) && t !== m.name) to.add(t);
    }
    graph[m.name] = [...to].sort();
  }
  const bad = [];
  const state = {};
  const stack = [];
  const seenCycles = new Set();
  function visit(v) {
    state[v] = 'on';
    stack.push(v);
    for (const t of graph[v]) {
      if (state[t] === 'on') {
        const cyc = stack.slice(stack.indexOf(t)).concat([t]).join(' → ');
        if (!seenCycles.has(cyc)) { seenCycles.add(cyc); bad.push('고리: ' + cyc); }
      } else if (!state[t]) visit(t);
    }
    stack.pop();
    state[v] = 'done';
  }
  for (const v of Object.keys(graph).sort()) if (!state[v]) visit(v);
  const edges = Object.values(graph).reduce((a, b) => a + b.length, 0);
  return { bad, seen: '모듈 ' + mods.length + ' · 이음 ' + edges };
}

// ---------- ④ 직접 불러 쓰기 ----------
function checkDirect(mods) {
  const e = edgesOf(mods);
  const names = new Set(mods.map((m) => m.name));
  const bad = [];
  const usesRx = new RegExp(c4.deps_use, 'g');
  const everywhere = c4.banned_everywhere.map((p) => new RegExp(p));
  const kindRx = new RegExp(c4.kind_decl);
  let looked = 0;
  for (const m of mods) {
    const where = rel(m.path);
    const info = e[m.name];
    // 층: 층 표에 적힌 것, 없으면 파일 머리의 종류 선언(KIND — 예: 판은 화면 층)으로. 판을 더할 때 층 표를 고치지 않게(설계 5-1-다)
    const kind = (m.src.match(kindRx) || [])[1];
    const layer = c4.module_layer[m.name] || (kind && c4.kind_layer[kind]);
    if (!layer) bad.push(where + ': 층 표(module_layer)에 없는 모듈');
    for (const b of info.badImports) bad.push(where + ':' + b.line + ': 허용하지 않는 import 꼴 — ' + b.text);
    const allowed = c4.imports_allowed[m.name];
    for (const im of info.imports) {
      looked++;
      if (!names.has(im.from)) bad.push(where + ':' + im.line + ": 없는 모듈 '" + im.from + "' 을(를) import");
      if (allowed === '*') continue;
      if (!allowed || !allowed.includes(im.from)) bad.push(where + ':' + im.line + ": '" + m.name + "' → '" + im.from + "' import 는 허용 목록 밖");
    }
    if (!info.needs) bad.push(where + ': 받는 것 목록(export const NEEDS = [...])이 없음');
    const needs = info.needs || [];
    const may = layer ? c4.layer_may_need[layer] || [] : [];
    const extra = c4.extra_needs[m.name] || [];
    for (const d of needs) {
      looked++;
      let depLayer;
      let depMod = null;
      if (c4.platform_deps.includes(d)) depLayer = 'platform';
      else if (c4.dep_module[d]) { depMod = c4.dep_module[d]; depLayer = c4.module_layer[depMod]; }
      else { bad.push(where + ": NEEDS 의 '" + d + "' 은(는) 모르는 이름(dep_module·platform_deps 에 없음)"); continue; }
      if (may.includes('*') || may.includes(depLayer) || (depMod && extra.includes(depMod))) continue;
      bad.push(where + ": 층 어김 — '" + m.name + "'(" + layer + ") 이(가) '" + d + "'(" + depLayer + ') 에 기댐');
    }
    const lx = lex(withoutImports(m.src, c4));
    let mm;
    usesRx.lastIndex = 0;
    const used = new Set();
    while ((mm = usesRx.exec(lx.code))) used.add(mm[1]);
    for (const u of used) if (!needs.includes(u)) bad.push(where + ": deps." + u + ' 를 쓰는데 NEEDS 에 없음');
    const lines = lx.code.split('\n');
    const rules = [...everywhere.map((rx) => [rx, '전역·싱글톤 스스로 쓰기'])];
    for (const p of c4.banned_in[m.name] || []) rules.push([new RegExp(p), m.name + ' 안에서 쓰면 안 됨']);
    for (const p of (layer && c4.banned_in_layer[layer]) || []) rules.push([new RegExp(p), layer + ' 층에서 쓰면 안 됨']);
    lines.forEach((t, idx) => {
      for (const [rx, why] of rules) if (rx.test(t)) bad.push(where + ':' + (idx + 1) + ': ' + why + ' (' + rx.source + ')');
    });
  }
  return { bad, seen: 'import·NEEDS ' + looked + ' 곳 봄' };
}

export async function runCheck4() {
  log.write('시작', { app: APP });
  const mods = modulesOf();
  const rows = [];
  rows.push(['① 빌드', await checkBuild(mods)]);
  rows.push(['② 박힌 값', checkHardcode(mods)]);
  rows.push(['③ 순환 의존', checkCycles(mods)]);
  rows.push(['④ 직접 불러 쓰기', checkDirect(mods)]);
  for (const [title, r] of rows) for (const b of r.bad) log.write('걸림', { check: title, detail: b });
  const ok = rows.every(([, r]) => !r.bad.length);
  log.write('끝', { result: ok ? tc.pass_word : tc.fail_word, failed: rows.reduce((a, [, r]) => a + r.bad.length, 0) });
  return { ok, rows };
}

function printTable(ok, rows) {
  console.log('| 검사 | 결과 | 걸린 곳 | 본 것 |');
  console.log('|---|---|---|---|');
  for (const [title, r] of rows) console.log('| ' + title + ' | ' + (r.bad.length ? tc.fail_word : tc.pass_word) + ' | ' + r.bad.length + ' | ' + r.seen + ' |');
  for (const [title, r] of rows) for (const b of r.bad) console.log('  [' + title + '] ' + b);
  console.log('기계 검사 네 가지: ' + (ok ? tc.pass_word : tc.fail_word));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { ok, rows } = await runCheck4();
    printTable(ok, rows);
    process.exitCode = ok ? tc.exit.ok : tc.exit.fail;
  } catch (err) {
    log.write('예외', { error: String(err && err.stack || err) });
    console.error(err);
    process.exitCode = tc.exit.fail;
  }
}
