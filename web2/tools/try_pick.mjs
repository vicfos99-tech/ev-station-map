// 시험 고르개(정비 가 ①): 고친 파일 → 그 파일과 그 파일에 기대는 모듈을 쓰는 try_* 시험만 골라 이름을 낸다.
//   node web2/tools/try_pick.mjs                 # 고친 파일 = git 작업 트리 + 스테이지 + 새 파일
//   node web2/tools/try_pick.mjs src/ahead.js …  # 고친 파일을 인자로(web2 기준 또는 저장소 기준 경로)
//   node web2/tools/try_pick.mjs --why …         # 시험마다 고른 까닭(맞은 낱말)도
// (정비 나 ⑨) 시험 두 층: 고친 모듈의 단위 시험(tests_unit/<모듈>.test.mjs)을 먼저 알려 주고, 통합 시험은 '파일 → 통합 시험' 표(전체 시험이 커버리지로 만듦,
//   tools/logs/cover_map.json)에 그 시험이 다 모여(complete) 있으면 표로 — 그 시험이 실제로 지나간 파일이면 고른다(크롬 시험은 크롬 안이 표에 안 잡혀 낱말도 함께).
//   표에 없는 시험은 아래 낱말 + import 거꾸로(정비 가 그대로). pick(files, {cover: false}) 는 표를 안 쓴다, {coverMap} 은 그 표를 쓴다(시험용).
// 모듈 ↔ 시험 지도는 손으로 적지 않는다: 시험 파일(주석 뺀 코드·글) + 그 시험이 읽는 config_tools 묶음 + 그 시험만의 설정 파일에
// 모듈 낱말(이름 · 그 모듈 설정 이름 · 화면 조각 id · 모양 조각 ev- 이름)이 나오면 그 모듈을 쓰는 시험. 못 뽑는 것과 까닭은 config_try_pick.json.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadToolsConfig, appDir, toolLog, listFiles, TOOLS_DIR } from './lib_tools.mjs';
import { lex, readImports } from './lib_js.mjs';
import { loadCoverMap } from './lib_cover.mjs';

const PICK_CONFIG = 'config_try_pick.json';
const tc = loadToolsConfig();
const APP = appDir(tc);
const P = JSON.parse(fs.readFileSync(path.join(TOOLS_DIR, PICK_CONFIG), 'utf8'));
const log = toolLog(tc, P.log_name);

const read = (p) => fs.readFileSync(p, 'utf8');
const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function wordRx(w) {
  return new RegExp('(?<!' + P.word_edge + ')' + escapeRx(w) + '(?!' + P.word_edge + ')');
}

function git(args) {
  const r = spawnSync(tc.git.cmd, args, { cwd: APP, encoding: 'utf8' });
  if (r.status !== tc.exit.ok) throw new Error('git ' + args.join(' ') + ' 실패: ' + (r.stderr || '').trim());
  return r.stdout;
}

// ---------- 앱 모듈 지도(코드에서 뽑음) ----------
export function moduleMap() {
  const srcDir = path.join(APP, P.paths.src);
  const mods = {};
  for (const p of listFiles(srcDir, P.exts.module)) {
    const name = path.basename(p, P.exts.module);
    const src = read(p);
    const lx = lex(src);
    const deps = new Set();
    for (const im of readImports(src, tc.check4).imports) if (!P.hub_modules.includes(name)) deps.add(im.from);
    const m = src.match(new RegExp(tc.check4.needs_decl));
    const needs = m ? m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : [];
    const configs = new Set(lx.strings.map((s) => s.text).filter((t) => new RegExp(P.config_name_re).test(t)));
    mods[name] = { name, deps, needs, configs, words: new Set([name]) };
  }
  // 계산 표: 계산기는 줄의 셈 모듈(part)에 기대고, 그 줄의 설정(rule·uses)은 셈 모듈이 읽는 설정
  const scPath = path.join(APP, P.paths.config, P.statecalc_config + P.exts.json);
  const table = fs.existsSync(scPath) ? (JSON.parse(read(scPath)).table || []) : [];
  // (정비 나 ①) 제목 꾸러미 설정(config_topic_*)의 계산 줄도 같은 표로 본다(꽂는 자리 줄은 part 가 없어 저절로 빠짐)
  for (const p of listFiles(path.join(APP, P.paths.config), P.exts.json)) {
    if (path.basename(p).startsWith(tc.build.topic_config_prefix)) table.push(...(JSON.parse(read(p)).calc_rows || []));
  }
  for (const mod of Object.values(mods)) {
    for (const n of mod.needs) {
      if (n === P.parts_dep) { for (const row of table) if (mods[row.part]) mod.deps.add(row.part); continue; }
      const target = tc.check4.dep_module[n];
      if (target && mods[target] && target !== mod.name) mod.deps.add(target);
    }
  }
  for (const row of table) {
    if (!mods[row.part]) continue;
    for (const f of [row.rule, ...(row.uses || [])]) mods[row.part].configs.add(f);
  }
  // 낱말: 모듈 이름 · 그 모듈 이름의 설정 파일 · 화면 조각 id · 모양 조각 ev- 이름
  for (const mod of Object.values(mods)) {
    const own = P.config_prefix + mod.name;
    if (fs.existsSync(path.join(APP, P.paths.config, own + P.exts.json))) mod.words.add(own);
    const view = path.join(srcDir, P.view_prefix + mod.name + P.exts.view);
    if (fs.existsSync(view)) for (const x of read(view).matchAll(new RegExp(P.id_re, 'g'))) mod.words.add(x[1]);
    const style = path.join(srcDir, P.style_prefix + mod.name + P.exts.style);
    mod.styleWords = new Set(mod.words);
    if (fs.existsSync(style)) for (const x of read(style).matchAll(new RegExp(P.css_name_re, 'g'))) mod.styleWords.add(x[1]);
  }
  const dependents = {};
  for (const mod of Object.values(mods)) for (const d of mod.deps) (dependents[d] = dependents[d] || new Set()).add(mod.name);
  return { mods, dependents };
}

// ---------- 시험 지도(시험 파일에서 뽑음) ----------
function toolClosure(file, seen) {
  const out = seen || new Set();
  const p = path.join(TOOLS_DIR, file);
  if (!fs.existsSync(p)) return out;
  for (const m of read(p).matchAll(new RegExp(P.tool_import_re, 'g'))) {
    if (out.has(m[1])) continue;
    out.add(m[1]);
    toolClosure(m[1], out);
  }
  return out;
}

function sectionsOf(text) {
  return new Set([...text.matchAll(new RegExp(P.section_re, 'g'))].map((m) => m[1]));
}

export function testMap() {
  const tests = {};
  const files = fs.readdirSync(TOOLS_DIR).filter((n) => n.startsWith(P.tests.prefix) && n.endsWith(P.tests.ext) && !P.not_tests.includes(n)).sort();
  for (const file of files) {
    const name = path.basename(file, P.tests.ext);
    const src = read(path.join(TOOLS_DIR, file));
    const lx = lex(src);
    const libs = toolClosure(file);
    const own = sectionsOf(src);
    const allSections = new Set(own);
    for (const lib of libs) for (const s of sectionsOf(read(path.join(TOOLS_DIR, lib)))) allSections.add(s);
    let text = lx.code + '\n' + lx.strings.map((s) => s.text).join('\n');
    for (const s of own) if (!P.ignore_sections.includes(s) && tc[s] !== undefined) text += '\n' + JSON.stringify(tc[s]);
    const ownCfg = path.join(TOOLS_DIR, P.own_config_prefix + name + P.exts.json);
    if (fs.existsSync(ownCfg)) text += '\n' + read(ownCfg);
    tests[name] = {
      name, file, libs, sections: allSections, text,
      chrome: P.chrome_libs.some((l) => libs.has(l)),
      bridge: P.bridge_libs.some((l) => libs.has(l)),
      boot: P.boot_words.some((w) => text.includes(w)) || lx.strings.some((s) => P.boot_strings.includes(s.text)) || P.boot_libs.some((l) => libs.has(l)),
      ownCfg: fs.existsSync(ownCfg) ? path.basename(ownCfg) : null,
    };
  }
  return tests;
}

// ---------- 고친 파일 ----------
export function changedFiles() {
  const out = new Set();
  for (const args of P.git.changed) for (const l of git(args).split(/\r?\n/)) if (l.trim()) out.add(l.trim());
  return [...out];
}

function webPrefix() {
  return git(P.git.prefix).trim();
}

// 저장소 기준 또는 web2 기준 경로 → {inApp: web2 기준 경로} 또는 {outside: 저장소 기준 경로}
function place(p, prefix) {
  const n = p.replace(/\\/g, '/');
  if (prefix && n.startsWith(prefix)) return { inApp: n.slice(prefix.length) };
  if (fs.existsSync(path.join(APP, n))) return { inApp: n };
  return { outside: n };
}

function headJson(rel, prefix) {
  try { return JSON.parse(git([...P.git.head_file, P.git.head_ref + prefix + rel])); } catch (e) { return null; }
}

// ---------- 고르기 ----------
export function pick(files, opts) {
  const o = opts || {};
  const prefix = o.prefix !== undefined ? o.prefix : webPrefix();
  const { mods, dependents } = moduleMap();
  const tests = testMap();
  const chosen = {};
  const why = (t, w) => { (chosen[t] = chosen[t] || new Set()).add(w); };
  const seeds = new Map(); // 모듈 → 'code' | 'style'
  const bootAll = [];
  const notes = [];
  const addSeed = (m, kind) => { if (seeds.get(m) !== 'code') seeds.set(m, kind); };
  const cover = o.cover === false ? null : (o.coverMap || loadCoverMap(path.join(APP, P.cover_map)));
  const covered = (t) => (cover && cover.tests[t] && cover.tests[t].complete ? new Set(cover.tests[t].files) : null);
  const units = new Set();

  for (const f of files) {
    const at = place(f, prefix);
    if (at.outside) {
      const hit = Object.entries(P.outside).find(([k]) => at.outside.startsWith(k));
      if (!hit) { notes.push(at.outside + ' — web2 밖(고를 시험 없음)'); continue; }
      const list = hit[1].tests === 'bridge' ? Object.values(tests).filter((t) => t.bridge).map((t) => t.name) : hit[1].tests;
      for (const t of list) why(t, at.outside + ' (' + hit[1].why + ')');
      continue;
    }
    const r = at.inApp;
    const base = path.posix.basename(r);
    if (P.boot_files.includes(r)) { bootAll.push(r); continue; }
    if (r.startsWith(P.paths.vendor)) { bootAll.push(r); continue; }
    if (r.startsWith(P.unit.dir)) { notes.push(r + ' — 단위 시험 자신(' + P.unit.cmd + ')'); continue; }
    if (r.startsWith(P.paths.src)) {
      if (base.endsWith(P.exts.module)) { addSeed(path.posix.basename(base, P.exts.module), 'code'); continue; }
      if (base.startsWith(P.view_prefix) && base.endsWith(P.exts.view)) { addSeed(base.slice(P.view_prefix.length, -P.exts.view.length), 'code'); continue; }
      if (base.startsWith(P.style_prefix) && base.endsWith(P.exts.style)) { addSeed(base.slice(P.style_prefix.length, -P.exts.style.length), 'style'); continue; }
    }
    if (r.startsWith(P.paths.config)) {
      const name = base.endsWith(P.exts.shape) ? base.slice(0, -P.exts.shape.length) : path.posix.basename(base, P.exts.json);
      let readers = 0;
      for (const m of Object.values(mods)) if (m.configs.has(name)) { addSeed(m.name, 'code'); readers += 1; }
      for (const t of Object.values(tests)) if (wordRx(name).test(t.text)) why(t.name, name + ' (시험이 이 설정 이름을 씀)');
      if (!readers) notes.push(name + ' — 이 설정을 읽는 모듈을 못 찾음');
      continue;
    }
    if (r.startsWith(P.paths.tools)) {
      if (base === P.tools_config) {
        const head = headJson(r, prefix);
        const keys = Object.keys(tc).filter((k) => !head || JSON.stringify(head[k]) !== JSON.stringify(tc[k]));
        for (const t of Object.values(tests)) for (const k of keys) if (t.sections.has(k)) why(t.name, base + ' 의 ' + k + ' 묶음');
        notes.push(base + ' 바뀐 묶음: ' + (keys.join(', ') || '(없음)'));
        continue;
      }
      const t = Object.values(tests).find((x) => x.file === base || x.ownCfg === base);
      if (t) { why(t.name, base + ' (시험 자신)'); continue; }
      let users = 0;
      for (const x of Object.values(tests)) if (x.libs.has(base)) { why(x.name, base + ' (시험이 불러 씀)'); users += 1; }
      if (!users) notes.push(base + ' — 이 도구를 쓰는 시험 없음');
      continue;
    }
    notes.push(r + ' — 고를 시험 없음(설명서·설정 밖 파일)');
  }

  // 거꾸로 이음: 고친 모듈 → 그것에 기대는 모듈(조립 app 은 빼고 '앱을 띄우는 시험'으로)
  const affected = new Map();
  for (const [m, kind] of seeds) {
    if (!mods[m]) { notes.push(m + ' — src 에 없는 모듈'); continue; }
    if (P.hub_modules.includes(m) && kind === 'code') { bootAll.push(m); continue; }
    affected.set(m, { kind, from: m });
    if (kind !== 'code') continue;
    const queue = [m];
    while (queue.length) {
      const cur = queue.shift();
      for (const d of dependents[cur] || []) {
        if (P.hub_modules.includes(d) || affected.has(d)) continue;
        affected.set(d, { kind: 'code', from: m });
        queue.push(d);
      }
    }
  }
  for (const [m, info] of affected) {
    if (info.kind === 'code' && fs.existsSync(path.join(APP, P.unit.dir, m + P.unit.suffix))) units.add(m);
    const words = info.kind === 'style' ? mods[m].styleWords : mods[m].words;
    for (const t of Object.values(tests)) {
      if (info.kind === 'style' && !t.chrome) continue;
      const cv = info.kind === 'code' ? covered(t.name) : null;
      if (cv && cv.has(P.paths.src + m + P.exts.module)) { why(t.name, m + (m === info.from ? '' : ' (← ' + info.from + ')') + ' — 지나감(표)'); continue; }
      if (cv && !t.chrome) continue;
      const w = [...words].find((x) => wordRx(x).test(t.text));
      if (w) why(t.name, m + (m === info.from ? '' : ' (← ' + info.from + ')') + (info.kind === 'style' ? ' 모양' : '') + ' — 낱말 「' + w + '」' + (cv ? '(크롬)' : ''));
    }
  }
  if (units.size) notes.unshift('단위 시험 먼저: ' + P.unit.cmd + ' ' + [...units].sort().join(' '));
  if (bootAll.length) for (const t of Object.values(tests)) if (t.boot) why(t.name, bootAll.join(', ') + ' (앱을 띄우는 시험 모두)');
  const names = Object.keys(chosen).sort();
  return { tests: names, why: Object.fromEntries(names.map((n) => [n, [...chosen[n]]])), affected: [...affected.keys()], notes, units: [...units].sort(), cover: cover ? Object.keys(cover.tests).filter((t) => cover.tests[t].complete) : [] };
}

function main() {
  const args = process.argv.slice(2);
  const showWhy = args.includes('--why');
  const files = args.filter((a) => a !== '--why');
  const list = files.length ? files : changedFiles();
  log.write('시작', { files: list, from: files.length ? '인자' : 'git' });
  const res = pick(list);
  for (const n of res.tests) console.log(showWhy ? n + '\t' + res.why[n].join(' / ') : n);
  if (showWhy) {
    console.log('-- 고친 파일 ' + list.length + ' · 닿은 모듈 ' + res.affected.join(',') + ' · 고른 시험 ' + res.tests.length);
    for (const n of res.notes) console.log('-- ' + n);
  }
  log.write('끝', { tests: res.tests, affected: res.affected, notes: res.notes });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    log.write('실패', { error: String(e && e.stack || e) });
    console.error('시험 고르개 실패: ' + e.message);
    process.exitCode = tc.exit.fail;
  }
}
