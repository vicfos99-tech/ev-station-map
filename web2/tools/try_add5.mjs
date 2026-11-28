// 추가5 스스로 시험 — 음성 검색 단추(ui_voice). 진짜 크롬(창 없이 — lib_chrome)에 가짜 음성 인식을 끼워 단추 → 칸에 글자 → 찾기 호출까지 본다(약 2분).
//   node web2/tools/try_add5.mjs
// 값은 tools/config_try_add5.json. 표로 찍고 하나라도 실패면 0 아닌 코드. 기록장 tools/logs/try_add5.log, 표 사본 tools/logs/try_add5_last.md.
import fs from 'node:fs';
import path from 'node:path';
import { loadToolsConfig, appDir, toolLog, kstText, TOOLS_DIR } from './lib_tools.mjs';
import { measureInChrome } from './lib_chrome.mjs';

const tc = loadToolsConfig();
const T = JSON.parse(fs.readFileSync(path.join(TOOLS_DIR, 'config_try_add5.json'), 'utf8'));
const APP = appDir(tc);
const log = toolLog(tc, 'try_add5');
const cfgOf = (name) => JSON.parse(fs.readFileSync(path.join(APP, tc.build.config_dir, name + tc.build.config_ext), 'utf8'));
const UV = cfgOf('config_ui_voice');
const UN = cfgOf('config_ui_navi');

const rows = [];
function row(no, title, expect, actual, ok) {
  rows.push({ no, title, expect, actual, ok: !!ok });
  log.write(ok ? '통과' : '실패', { no, title, expect, actual });
}
const r0 = (n) => Math.round(n);

// 앱 글보다 먼저 도는 가짜: 음성 인식 한 종류, start() 뒤 정한 시간에 말한 글을 주고 끝냄. 찾기 단추를 누를 때의 칸 글을 기록해 html 에 적는다
const fake = `
(function () {
  var st = { starts: 0, lang: null, clickedWith: null };
  function put() { document.documentElement.setAttribute(${JSON.stringify(T.attr_name)}, JSON.stringify(st)); }
  put();
  window.${UV.api_names[0]} = function () {};
  window.${UV.api_names[0]}.prototype.start = function () {
    var me = this; st.starts += 1; st.lang = me.lang; put();
    setTimeout(function () {
      if (me.onresult) me.onresult({ results: [[{ transcript: ${JSON.stringify(T.spoken)} }]] });
      if (me.onend) me.onend();
    }, ${T.fake_delay_ms});
  };
  window.${UV.api_names[0]}.prototype.stop = function () { if (this.onend) this.onend(); };
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (t && t.id === ${JSON.stringify(UN.ids.go)}) { st.clickedWith = document.getElementById(${JSON.stringify(UN.ids.q)}).value; put(); }
  }, true);
})();`;

async function main() {
  log.write('시작', { spoken: T.spoken });
  const frames = tc.layout.frames.filter((f) => T.frames.includes(f.name));
  const res = await measureInChrome(tc, APP, { scene: T.scene, tick: T.tick, frames, sel: T.sel, ready: T.ready, actions: T.actions, log, head_script: fake });
  const dir = path.join(APP, tc.log.dir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, T.json_file), JSON.stringify(res, null, 1), 'utf8');
  if (res.error) { row('0', '진짜 크롬 재기', '결과 옴', res.error, false); return; }
  const attr = (g) => { try { return JSON.parse(((g.page || [])[0] || { attrs: {} }).attrs[T.attr_name] || 'null'); } catch (e) { return null; } };
  for (const fr of res.frames) {
    const g = fr.got || {};
    const mic = (g.mic || []).filter((e) => e.shown);
    const bar = (g.bar || []).filter((e) => e.shown)[0];
    const go = (g.go || []).filter((e) => e.shown)[0];
    const m = mic[0];
    const inBar = !!(m && bar && m.rect.x >= bar.rect.x - T.tol_px && m.rect.x + m.rect.w <= bar.rect.x + bar.rect.w + T.tol_px);
    const before = m && go ? m.rect.x + m.rect.w <= go.rect.x + T.tol_px : false;
    row('① ' + fr.name, '마이크 단추가 검색 칸 줄 안 찾기 단추 앞에 보임 · ' + T.touch_min_px + 'px 이상 · 가려지지 않음 · 화면 읽기 글 · idle', '1개 · 줄 안 · 찾기 앞 · ≥' + T.touch_min_px + ' · 가림 0 · 읽기 글 ' + UV.texts.label,
      'n ' + mic.length + (m ? ' · ' + r0(m.rect.w) + '×' + r0(m.rect.h) + ' · 줄 안 ' + inBar + ' · 찾기 앞 ' + before + ' · 가림 ' + (m.hits || []).filter((h) => !h.ok).length + ' · ' + m.attrs['aria-label'] + ' · ' + m.attrs['data-state'] : ''),
      fr.ready && mic.length === 1 && inBar && before && m.rect.w >= T.touch_min_px && m.rect.h >= T.touch_min_px && (m.hits || []).slice(0, 1).every((h) => h.ok) && m.attrs['aria-label'] === UV.texts.label && m.attrs['data-state'] === UV.states.idle);
    const st = (fr.steps || [])[0];
    const sg = st ? st.got : {};
    const a = attr(sg);
    const note = ((sg.note || [])[0] || {}).text || '';
    row('② ' + fr.name, '마이크 누름 → 가짜 인식 시작(언어 ' + UV.lang + ') → 말한 글 \'' + T.spoken + '\' 이 칸에 들어가 찾기 단추가 눌림 → 듣는 중 문구는 사라짐', '누름 · 시작 1 · 언어 · 찾기 누를 때 칸 글 일치 · 듣는 중 아님',
      st ? '누름 ' + st.clicked + ' · ' + JSON.stringify(a) + ' · 알림 \'' + note + '\'' : '없음',
      !!st && st.clicked && !!a && a.starts === 1 && a.lang === UV.lang && a.clickedWith === T.spoken && note !== UV.texts.listening);
    log.write('상태 자리', { frame: fr.name, text: ((g.status || [])[0] || {}).text || '' });
  }
}

function printTable() {
  const lines = ['| # | 시험 | 기대 | 실제 | 결과 |', '|---|---|---|---|---|'];
  for (const r of rows) lines.push('| ' + [r.no, r.title, r.expect, r.actual, r.ok ? tc.pass_word : tc.fail_word].map((s) => String(s).replace(/\|/g, '/').replace(/\n/g, ' ⏎ ')).join(' | ') + ' |');
  const ok = rows.length > 0 && rows.every((r) => r.ok);
  lines.push('', '추가5 스스로 시험(음성 검색): ' + (ok ? tc.pass_word : tc.fail_word) + ' (' + rows.filter((r) => r.ok).length + ' / ' + rows.length + ') — ' + kstText(tc));
  const text = lines.join('\n');
  console.log(text);
  const dir = path.join(APP, tc.log.dir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, T.report_file), text + '\n', 'utf8');
  return ok;
}

try {
  await main();
} catch (e) {
  log.write('예외', { error: String(e && e.stack || e) });
  console.error(e);
  rows.push({ no: '예외', title: String(e && e.message), expect: '-', actual: '-', ok: false });
}
const ok = printTable();
log.write('끝', { result: ok ? tc.pass_word : tc.fail_word });
process.exitCode = ok ? tc.exit.ok : tc.exit.fail;
