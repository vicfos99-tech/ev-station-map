// 빌드: shell.html + view_*.html + style_*.css + src 모듈 + config/*.json(+꼴 표) + 지도 라이브러리를 한 파일(index.html)로.
// build.json(판·시각·커밋)도 함께. 출력 자리는 인자(설계 5-1 ⑧) — 프로젝트 안에 만들지 않는다.
//   node web2/tools/build.mjs --out <출력 폴더> [--secret <저장소 밖 config_app_secret.json>]
// 앱 비밀 값 파일을 안 주면 넣지 않는다 → 앱은 '앱 점검 중 — 앱 비밀 값 설정'(설계 F2).
// 틀리면(JSON 꼴·같은 키 두 번·빠진 조각·허용하지 않는 import 꼴·모듈 고리) 0 아닌 코드로 끝난다.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadToolsConfig, appDir, toolLog, listFiles, kstText } from './lib_tools.mjs';
import { readImports, withoutImports } from './lib_js.mjs';
import { loadAppConfig } from './lib_appfiles.mjs';

const tc = loadToolsConfig();
const b = tc.build;
const APP = appDir(tc);
const log = toolLog(tc, 'build');

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') out.out = argv[++i];
    else if (argv[i] === '--secret') out.secret = argv[++i];
    else throw new Error('모르는 인자: ' + argv[i]);
  }
  if (!out.out) throw new Error('쓰는 법: node build.mjs --out <출력 폴더> [--secret <파일>]');
  return out;
}

function git(argsList) {
  const r = spawnSync(tc.git.cmd, argsList, { cwd: APP, encoding: 'utf8' });
  return r.status === tc.exit.ok ? r.stdout.trim() : '';
}

// 모듈 하나를 함수 안에 감싼다: import 줄 → 앞 모듈의 내보낸 것, export 낱말을 지우고 이름을 모은다
function wrapModule(name, src) {
  const { imports, bad } = readImports(src, tc.check4);
  if (bad.length) throw new Error(name + ': 허용하지 않는 import 꼴 — ' + bad.map((x) => x.line + '줄').join(', '));
  const exported = [];
  const body = withoutImports(src, tc.check4).split('\n').map((line) => {
    const m = line.match(new RegExp(b.export_re));
    if (!m) {
      if (new RegExp(b.export_bad_re).test(line)) throw new Error(name + ': 허용하지 않는 export 꼴 — ' + line.trim());
      return line;
    }
    exported.push(m[3]);
    return line.replace(new RegExp(b.export_word_re), '');
  }).join('\n');
  const head = imports.map((im) => {
    const from = b.module_var_prefix + im.from;
    if (im.kind === 'star') return 'const ' + im.as + ' = ' + from + ';';
    return 'const { ' + im.names.map((n) => (n.name === n.as ? n.name : n.name + ': ' + n.as)).join(', ') + ' } = ' + from + ';';
  }).join('\n');
  const code = 'const ' + b.module_var_prefix + name + ' = (function () {\n' + head + '\n' + body + '\nreturn { ' + exported.join(', ') + ' };\n})();\n';
  return { code, deps: imports.map((im) => im.from) };
}

function order(mods) {
  const out = [];
  const state = {};
  function visit(n, chain) {
    if (state[n] === 'done') return;
    if (state[n] === 'on') throw new Error('모듈 고리: ' + chain.concat([n]).join(' → '));
    if (!mods[n]) throw new Error('없는 모듈: ' + n + ' (' + chain.join(' → ') + ')');
    state[n] = 'on';
    for (const d of mods[n].deps) visit(d, chain.concat([n]));
    state[n] = 'done';
    out.push(n);
  }
  for (const n of Object.keys(mods).sort()) visit(n, []);
  return out;
}

const scriptSafe = (s) => s.replace(/<\/script/gi, '<\\/script');

function main() {
  const a = args(process.argv.slice(2));
  log.write('시작', { out: a.out, secret: a.secret ? '(줌)' : '(안 줌)' });
  const srcDir = path.join(APP, b.src_dir);
  // 판 기록
  const commit = git(['rev-parse', '--short', 'HEAD']) || b.no_commit_word;
  const dirty = git(['status', '--porcelain', '--', '.']) ? b.dirty_mark : '';
  const now = Date.now();
  const buildInfo = { stamp: commit + dirty + '-' + kstText(tc, now).replace(/[^0-9]/g, ''), at: kstText(tc, now), commit: commit + dirty };
  // 설정
  const { raw, errors } = loadAppConfig(APP, b, { secretPath: a.secret, buildInfo });
  if (errors.length) throw new Error('설정 읽기 실패 — ' + errors.map((e) => path.basename(e.file) + ': ' + e.why).join(' / '));
  const st = raw.files[b.status_config];
  const hc = raw.files[b.health_config];
  if (!st || !hc) throw new Error('상태 자리 설정이 없음: ' + b.status_config + ' · ' + b.health_config);
  raw.status_boot = {
    element_id: st.element_id, starting: st.texts.starting, dead: st.texts.dead, timeout_ms: st.start_timeout_ms,
    seen_attr: st.seen_attr, stage_attr: st.stage_attr, broken_stage: hc.stages.broken,
  };
  // 모듈
  const mods = {};
  for (const p of listFiles(srcDir, b.module_ext)) {
    const name = path.basename(p, b.module_ext);
    mods[name] = wrapModule(name, fs.readFileSync(p, 'utf8'));
  }
  if (!mods[b.entry_module]) throw new Error('조립 모듈이 없음: ' + b.entry_module);
  const modulesCode = '"use strict";\n' + order(mods).map((n) => mods[n].code).join('\n');
  // 화면 조각: ui_X 마다 style 은 꼭, view 는 views_optional 이 아니면 꼭
  const screens = Object.keys(mods).filter((n) => n.startsWith(b.screen_prefix));
  const styles = [];
  const views = {};
  for (const s of screens) {
    const css = path.join(srcDir, b.style_prefix + s + b.style_ext);
    const html = path.join(srcDir, b.view_prefix + s + b.view_ext);
    if (!fs.existsSync(css)) throw new Error('빠진 조각: ' + path.basename(css));
    styles.push(fs.readFileSync(css, 'utf8'));
    if (fs.existsSync(html)) views[s] = fs.readFileSync(html, 'utf8');
    else if (!b.views_optional.includes(s)) throw new Error('빠진 조각: ' + path.basename(html));
  }
  for (const s of Object.keys(views)) if (!b.views_order.includes(s)) throw new Error('화면 차례(views_order)에 없는 조각: ' + s);
  const viewsHtml = b.views_order.filter((s) => views[s]).map((s) => views[s]).join('\n');
  // 바깥 라이브러리
  const vendorJs = b.vendor_js.map((f) => fs.readFileSync(path.join(APP, f), 'utf8')).join('\n');
  const vendorCss = b.vendor_css.map((f) => fs.readFileSync(path.join(APP, f), 'utf8')).join('\n');
  // 조립
  let html = fs.readFileSync(path.join(APP, b.shell), 'utf8');
  const fills = {
    [b.marks.title]: b.title,
    [b.marks.vendor_css]: vendorCss,
    [b.marks.styles]: styles.join('\n'),
    [b.marks.views]: viewsHtml,
    [b.marks.config]: scriptSafe(JSON.stringify(raw)),
    [b.marks.vendor_js]: scriptSafe(vendorJs),
    [b.marks.modules]: scriptSafe(modulesCode),
    [b.marks.entry]: b.module_var_prefix + b.entry_module + '.' + b.entry_export,
  };
  for (const [mark, value] of Object.entries(fills)) {
    if (!html.includes(mark)) throw new Error('뼈대에 자리 표시가 없음: ' + mark);
    html = html.split(mark).join(value);
  }
  html = html.replace(b.stamp_comment_at, b.stamp_comment_at + '\n<!-- ' + b.stamp_label + ' ' + buildInfo.stamp + ' -->');
  fs.mkdirSync(a.out, { recursive: true });
  fs.writeFileSync(path.join(a.out, b.out_file), html, 'utf8');
  fs.writeFileSync(path.join(a.out, b.stamp_file), JSON.stringify(buildInfo, null, b.json_indent), 'utf8');
  const kb = Math.round(Buffer.byteLength(html) / b.kb);
  console.log(b.out_file + ' ' + kb + 'KB · 판 ' + buildInfo.stamp + ' · 모듈 ' + Object.keys(mods).length + ' · 설정 ' + Object.keys(raw.files).length + ' · 비밀 값 ' + (raw.files[b.secret_name] ? '넣음' : '안 넣음'));
  log.write('끝', { result: 'ok', stamp: buildInfo.stamp, kb, modules: Object.keys(mods).length });
}

try {
  main();
} catch (e) {
  log.write('실패', { error: e.message });
  console.error('빌드 실패: ' + e.message);
  process.exitCode = tc.exit.fail;
}
