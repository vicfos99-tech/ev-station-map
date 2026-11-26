// 단위 시험 돌리개(정비 나 ⑨ 시험 두 층의 첫 층). 모듈별 단위 시험 파일(web2/tests_unit/<모듈>.test.mjs)을 돌려 표 하나로.
//   node web2/tools/unit.mjs              # 전부
//   node web2/tools/unit.mjs ahead engine # 그 모듈의 단위 시험만(고르개 try_pick --why 가 '단위 시험 먼저'로 알려 줌)
// 시험 파일 꼴: export default async function (t) { t.check(번호, 무엇, 기대, 실제, 맞나); } — t.app = web2 폴더, t.src(이름) = 앱 모듈, t.cfg(이름) = 앱 설정.
// 값은 tools/config_unit.json. 결과 tools/logs/unit_last.md, 기록장 tools/logs/unit.log. 하나라도 실패면 종료 코드 1.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadToolsConfig, appDir, toolLog, kstText, TOOLS_DIR } from './lib_tools.mjs';

const tc = loadToolsConfig();
const U = JSON.parse(fs.readFileSync(path.join(TOOLS_DIR, 'config_unit.json'), 'utf8'));
const APP = appDir(tc);
const DIR = path.join(APP, U.dir);
const log = toolLog(tc, U.log_name);

const rows = [];
const cfgCache = {};
const t = {
  app: APP,
  tools: TOOLS_DIR,
  tc,
  src: async (name) => import(pathToFileURL(path.join(APP, tc.build.src_dir, name + tc.build.module_ext)).href),
  cfg: (name) => {
    if (!cfgCache[name]) cfgCache[name] = JSON.parse(fs.readFileSync(path.join(APP, tc.build.config_dir, name + tc.build.config_ext), 'utf8'));
    return JSON.parse(JSON.stringify(cfgCache[name]));
  },
  check(no, title, expect, actual, ok) {
    rows.push({ no: t.mod + ' ' + no, title, expect, actual, ok: !!ok });
    log.write(ok ? '통과' : '실패', { mod: t.mod, no, title, expect, actual });
  },
  mod: '',
};

async function main() {
  const want = process.argv.slice(2);
  const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((n) => n.endsWith(U.suffix)).sort() : [];
  const run = files.filter((f) => !want.length || want.includes(f.slice(0, -U.suffix.length)));
  for (const w of want) if (!files.includes(w + U.suffix)) rows.push({ no: w, title: '단위 시험 파일', expect: U.dir + '/' + w + U.suffix, actual: '없음', ok: false });
  log.write('시작', { files: run });
  for (const f of run) {
    t.mod = f.slice(0, -U.suffix.length);
    try {
      const m = await import(pathToFileURL(path.join(DIR, f)).href);
      await m.default(t);
    } catch (e) {
      log.write('예외', { file: f, error: String(e && e.stack || e) });
      rows.push({ no: t.mod + ' 예외', title: String(e && e.message), expect: '-', actual: '-', ok: false });
    }
  }
}

await main();
const lines = ['| # | 시험 | 기대 | 실제 | 결과 |', '|---|---|---|---|---|'];
for (const r of rows) lines.push('| ' + [r.no, r.title, r.expect, r.actual, r.ok ? tc.pass_word : tc.fail_word].map((s) => String(s).replace(/\|/g, '/').replace(/\r?\n/g, ' ⏎ ')).join(' | ') + ' |');
const ok = rows.length > 0 && rows.every((r) => r.ok);
lines.push('', '단위 시험: ' + (ok ? tc.pass_word : tc.fail_word) + ' (' + rows.filter((r) => r.ok).length + ' / ' + rows.length + ') — ' + kstText(tc));
const text = lines.join('\n');
console.log(text);
const logDir = path.join(APP, tc.log.dir);
fs.mkdirSync(logDir, { recursive: true });
fs.writeFileSync(path.join(logDir, U.report_file), text + '\n', 'utf8');
log.write('끝', { result: ok ? tc.pass_word : tc.fail_word, pass: rows.filter((r) => r.ok).length, all: rows.length });
process.exitCode = ok ? tc.exit.ok : tc.exit.fail;
