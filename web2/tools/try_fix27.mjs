// 11/27 스스로 시험 — 제목 바꾸기 단추 자리(묘성 11/26) + 아래 띠 그림 글자(ui_bar). 진짜 크롬(창 없이 — lib_chrome)으로 잰다(약 2분 30초 — 다리가 끝날 때까지).
//   node web2/tools/try_fix27.mjs
// 빌드 때 config_ui_topic.min_show 를 1 로 바꿔(제목이 하나여도 단추가 보임 — 아래 띠가 가장 붐빔) 창마다:
//   ① 양옆 판·아래 띠 단추가 화면 안(오른쪽 끝 ≤ 창 폭, 왼쪽 끝 ≥ 0), 페이지 가로 넘침 0 — 정비 나 때 오른편 판이 x 382 로 밀리던 것
//   ② 아래 띠 단추 높이·폭 ≥ 48 · 가려지지 않음 · 화면 읽기 글 있음 · 좁은 창이면 그림 글자(글자 크기 0)
//   ③ 제목 단추를 누르면 제목 목록 칸이 가운데 기둥 안에 열리고 줄이 있음
// 값은 tools/config_try_fix27.json. 표(기대·실제)로 찍고 하나라도 실패면 0 아닌 코드. 기록장 tools/logs/try_fix27.log, 표 사본 tools/logs/try_fix27_last.md.
import fs from 'node:fs';
import path from 'node:path';
import { loadToolsConfig, appDir, toolLog, kstText, TOOLS_DIR } from './lib_tools.mjs';
import { measureInChrome, inside } from './lib_chrome.mjs';

const tc = loadToolsConfig();
const T = JSON.parse(fs.readFileSync(path.join(TOOLS_DIR, 'config_try_fix27.json'), 'utf8'));
const APP = appDir(tc);
const log = toolLog(tc, 'try_fix27');
const cfgOf = (name) => JSON.parse(fs.readFileSync(path.join(APP, tc.build.config_dir, name + tc.build.config_ext), 'utf8'));
const UT = cfgOf('config_ui_topic');
const UB = cfgOf('config_ui_bar');

const rows = [];
function row(no, title, expect, actual, ok) {
  rows.push({ no, title, expect, actual, ok: !!ok });
  log.write(ok ? '통과' : '실패', { no, title, expect, actual });
}
const r0 = (n) => Math.round(n);

async function main() {
  log.write('시작', { min_show: T.override_min_show });
  const frames = tc.layout.frames.filter((f) => T.frames.includes(f.name));
  const res = await measureInChrome(tc, APP, {
    scene: T.scene, tick: T.tick, frames, sel: { ...T.sel, ...T.ready_sel }, ready: T.ready, actions: T.actions, log,
    overrides: { config_ui_topic: { ...UT, min_show: T.override_min_show } },
  });
  const dir = path.join(APP, tc.log.dir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, T.json_file), JSON.stringify(res, null, 1), 'utf8');
  if (res.error) { row('0', '진짜 크롬 재기', '결과 옴', res.error, false); return; }
  for (const fr of res.frames) {
    const g = fr.got || {};
    const all = (nm) => (g[nm] || []).filter((e) => e.shown);
    const W = fr.inner ? fr.inner.w : fr.w;
    const narrow = W <= T.narrow_max_w;
    const tol = T.tol_px;
    const right = (e) => e.rect.x + e.rect.w;
    const sides = [...all('slot_left'), ...all('slot_right')];
    const btns = all('bar_btns');
    const out = [...sides.map((e, i) => ['판' + i, e]), ...btns.map((e) => [e.attrs.id, e])].filter(([, e]) => right(e) > W + tol || e.rect.x < -tol);
    const page = (g.page || [])[0] || {};
    const over = page.sw !== undefined ? page.sw - page.cw : null;
    const rs = all('slot_right')[0];
    row('① ' + fr.name, '양옆 판·아래 띠 단추가 화면 안 · 페이지 가로 넘침 0 (제목 단추 보임 — min_show ' + T.override_min_show + ')', '밖 0 · 넘침 0 · 오른편 판 오른쪽 끝 ≤ ' + W + ' · 제목 단추 보임',
      '밖 ' + out.length + (out.length ? '(' + out.map(([n, e]) => n + ' x' + r0(e.rect.x) + '~' + r0(right(e))).join(' / ') + ')' : '') + ' · 넘침 ' + over + ' · 오른편 판 ' + (rs ? r0(rs.rect.x) + '~' + r0(right(rs)) : '없음') + ' · 제목 단추 ' + (all('topic_open').length ? '보임' : '안 보임') + ' · 아래 띠 단추 ' + btns.length,
      fr.ready && out.length === 0 && over !== null && over <= tol && !!rs && right(rs) <= W + tol && all('topic_open').length === 1);
    const small = btns.filter((e) => e.rect.h < T.touch_min_px || e.rect.w < T.touch_min_px);
    const covered = [];
    // 단추는 둥근 귀퉁이라 상자 귀퉁이 점은 바깥일 수 있다 — 가운데 점만 본다
    for (const e of btns) for (const h of (e.hits || []).slice(0, 1)) if (!h.ok) covered.push(e.attrs.id + ' (' + h.x + ',' + h.y + ') ← ' + h.by);
    const noLabel = btns.filter((e) => !e.attrs['aria-label']);
    const glyphOn = btns.filter((e) => e.attrs['data-glyph'] && e.style && e.style['font-size'] === '0px');
    const glyphWant = btns.filter((e) => e.attrs['data-glyph']).length;
    row('② ' + fr.name, '아래 띠 단추 ' + T.touch_min_px + 'px 이상 · 가림 0 · 화면 읽기 글 · ' + (narrow ? '좁은 창 — 그림 글자(글자 크기 0)' : '넓은 창 — 글 그대로') + ' · 몸 꼴 ' + UB.mode,
      '작은 단추 0 · 가림 0 · 읽기 글 빠짐 0 · 그림 글자 ' + (narrow ? glyphWant : 0) + ' · 몸 ' + UB.mode,
      '작은 단추 ' + small.length + (small.length ? '(' + small.map((e) => e.attrs.id + ' ' + r0(e.rect.w) + '×' + r0(e.rect.h)).join(' / ') + ')' : '') + ' · 가림 ' + covered.length + (covered.length ? '(' + covered.slice(0, 3).join(' / ') + ')' : '') + ' · 읽기 글 빠짐 ' + noLabel.length + ' · 그림 글자 ' + glyphOn.length + ' · 몸 ' + (((g.body || [])[0] || { attrs: {} }).attrs['data-bar-glyph']) + ' · 단추 ' + btns.map((e) => e.attrs.id + ' ' + r0(e.rect.w) + '×' + r0(e.rect.h)).join(', '),
      fr.ready && btns.length > 0 && small.length === 0 && covered.length === 0 && noLabel.length === 0 && glyphOn.length === (narrow ? glyphWant : 0) && ((g.body || [])[0] || { attrs: {} }).attrs['data-bar-glyph'] === UB.mode);
    const st = (fr.steps || [])[0];
    const sg = st ? st.got : {};
    const root = ((sg.topic_root || []).filter((e) => e.shown))[0];
    const center = ((sg.center || []).filter((e) => e.shown))[0];
    const items = (sg.topic_items || []).filter((e) => e.shown);
    row('③ ' + fr.name, '제목 단추 누름 → 제목 목록 칸이 가운데 기둥 안에 열림 · 줄 ≥ 1', '열림 · 기둥 안 · 줄 ≥ 1',
      st ? '누름 ' + st.clicked + ' · ' + (root ? '열림' : '안 열림') + ' · ' + (root && center && inside(root.rect, center.rect, tol) ? '기둥 안' : '기둥 밖') + ' · 줄 ' + items.length : '없음',
      !!st && st.clicked && !!root && !!center && inside(root.rect, center.rect, tol) && items.length >= 1);
    log.write('상태 자리', { frame: fr.name, text: ((g.status || [])[0] || {}).text || '' });
  }
}

function printTable() {
  const lines = ['| # | 시험 | 기대 | 실제 | 결과 |', '|---|---|---|---|---|'];
  for (const r of rows) lines.push('| ' + [r.no, r.title, r.expect, r.actual, r.ok ? tc.pass_word : tc.fail_word].map((s) => String(s).replace(/\|/g, '/').replace(/\n/g, ' ⏎ ')).join(' | ') + ' |');
  const ok = rows.length > 0 && rows.every((r) => r.ok);
  lines.push('', '11/27 스스로 시험(제목 단추 자리·그림 글자): ' + (ok ? tc.pass_word : tc.fail_word) + ' (' + rows.filter((r) => r.ok).length + ' / ' + rows.length + ') — ' + kstText(tc));
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
