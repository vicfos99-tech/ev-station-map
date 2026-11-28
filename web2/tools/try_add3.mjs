// 추가3 스스로 시험 — 두 번째 제목 '화장실'. 진짜 크롬(창 없이 — lib_chrome)으로 화장실 제목(주소 꼬리)으로 켜서 네 창마다 잰다(약 2분 30초 — 다리가 끝날 때까지).
//   node web2/tools/try_add3.mjs [around]
// 값은 tools/config_try_add3.json(무엇을 재는지는 그 note). 표(기대·실제)로 찍고 하나라도 실패면 0 아닌 코드. 기록장 tools/logs/try_add3.log, 표 사본 tools/logs/try_add3_last.md.
import fs from 'node:fs';
import path from 'node:path';
import { loadToolsConfig, appDir, toolLog, kstText, TOOLS_DIR } from './lib_tools.mjs';
import { measureInChrome, overlapArea, inside } from './lib_chrome.mjs';

const tc = loadToolsConfig();
const T0 = JSON.parse(fs.readFileSync(path.join(TOOLS_DIR, 'config_try_add3.json'), 'utf8'));
// 'around' = 고속도로 밖(주변) 한 판 — 장면·틱·머리 글·표 파일만 바꾸고, 누름 걸음은 하지 않는다
const AROUND = process.argv[2] === 'around';
const T = AROUND ? { ...T0, ...T0.around, actions: [] } : T0;
const APP = appDir(tc);
const log = toolLog(tc, 'try_add3');

const rows = [];
function row(no, title, expect, actual, ok) {
  rows.push({ no, title, expect, actual, ok: !!ok });
  log.write(ok ? '통과' : '실패', { no, title, expect, actual });
}
const r0 = (n) => Math.round(n);
const shown = (g, k) => ((g || {})[k] || []).filter((e) => e.shown);

function overlaps(g) {
  const list = [];
  for (const k of T.boxes) shown(g, k).forEach((e, i) => list.push({ n: k + (i ? '[' + i + ']' : ''), r: e.rect }));
  const bad = [];
  for (let i = 0; i < list.length; i += 1) for (let j = i + 1; j < list.length; j += 1) {
    const a = overlapArea(list[i].r, list[j].r);
    if (a > T.tol_px) bad.push(list[i].n + '×' + list[j].n + ' ' + r0(a) + 'px²');
  }
  return { n: list.length, bad };
}

async function main() {
  log.write('시작', { hash: T.hash, scene: T.scene });
  const res = await measureInChrome(tc, APP, { scene: T.scene, tick: T.tick, frames: tc.layout.frames, sel: T.sel, ready: T.ready, actions: T.actions, log, hash: T.hash });
  const dir = path.join(APP, tc.log.dir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, T.json_file), JSON.stringify(res, null, 1), 'utf8');
  if (res.error) { row('0', '진짜 크롬 재기', '결과 옴', res.error, false); return; }
  for (const fr of res.frames) {
    const g = fr.got || {};
    const W = fr.inner ? fr.inner.w : fr.w;
    const narrow = W <= T.narrow_max_w;
    const br = shown(g, 'board_rows');
    const head = (shown(g, 'board_head')[0] || {}).text || '';
    const topic = (shown(g, 'topic_open')[0] || {}).text || '';
    row('① ' + fr.name, '화장실 제목으로 켜짐: 화장실판 줄 ≥ 1 · 머리 ' + T.board_head + ' · 충전소판 없음 · 제목 단추 글에 ' + T.topic_label + ' · 지도 번호 ≥ 1',
      '준비 · 줄 ≥ 1 · ' + T.board_head + ' · 충전소판 0 · 단추 ' + T.topic_label + ' · 번호 ≥ 1',
      (fr.ready ? '준비' : '준비 안 됨(' + (fr.status_text || '') + ')') + ' · 줄 ' + br.length + '(' + br.map((e) => e.text.slice(0, 16)).join(' / ') + ') · ' + head + ' · 충전소판 ' + shown(g, 'station_board').length + ' · 단추 ' + topic + ' · 번호 ' + shown(g, 'marks').length,
      fr.ready && br.length >= 1 && head.startsWith(T.board_head) && shown(g, 'station_board').length === 0 && topic.includes(T.topic_label) && shown(g, 'marks').length >= 1);
    // 줄마다 주차 글(있음·없음·모름 중 하나)이 거리와 함께 있음 — 판·목록 둘 다
    const hasPark = (e) => T.parking_words.some((w) => e.text.includes(w));
    const tlRows = (fr.steps && fr.steps[0]) ? shown(fr.steps[0].got, 'tlist_rows') : [];
    row('①-주차 ' + fr.name, '화장실판·목록 줄마다 주차 글(' + T.parking_words.join('·') + ' 중 하나)', '판 줄 모두 · 목록 줄 모두',
      '판 ' + br.filter(hasPark).length + '/' + br.length + ' · 목록 ' + tlRows.filter(hasPark).length + '/' + tlRows.length,
      (AROUND || (br.length >= 1 && br.every(hasPark))) && (tlRows.length === 0 || tlRows.every(hasPark)));
    if (AROUND) {
      const names = br.map((e) => e.text);
      row('⑥ ' + fr.name, '고속도로 밖: 화장실판 머리 ' + T.board_head + ' · 줄이 시험용 공공 화장실(' + T.name_mark + ')만 · 휴게소 없음 · 겹침 0', T.board_head + ' · 줄 ≥ 1 · 모두 ' + T.name_mark + ' · 겹침 0',
        head + ' · 줄 ' + br.length + '(' + names.map((s) => s.slice(0, 18)).join(' / ') + ') · 겹침 ' + overlaps(g).bad.length,
        fr.ready && head.startsWith(T.board_head) && br.length >= 1 && names.every((s) => s.includes(T.name_mark)) && overlaps(g).bad.length === 0);
      continue;
    }
    const ov = overlaps(g);
    const page = (g.page || [])[0] || {};
    const over = page.sw !== undefined ? page.sw - page.cw : null;
    const btns = shown(g, 'more_btns');
    const small = btns.filter((e) => e.rect.h < T.touch_min_px - T.tol_px || e.rect.w < T.touch_min_px - T.tol_px);
    const tl = btns.find((e) => e.attrs.id === 'ev-tlist-open');
    const glyphOk = !!tl && (narrow ? tl.style['font-size'] === '0px' : tl.style['font-size'] !== '0px');
    row('② ' + fr.name, '겹침 0(상자 ' + T.boxes.length + ' 종류) · 가로 넘침 0 · 더 보기 단추 ' + T.touch_min_px + 'px · 화장실 목록 단추 ' + (narrow ? '그림 글자' : '글'),
      '겹침 0 · 넘침 0 · 작은 단추 0 · 목록 단추 맞음',
      '겹침 ' + ov.bad.length + (ov.bad.length ? '(' + ov.bad.slice(0, 4).join(' / ') + ')' : '') + ' · 상자 ' + ov.n + ' · 넘침 ' + over + ' · 작은 단추 ' + small.length + ' · 목록 단추 ' + (tl ? r0(tl.rect.w) + '×' + r0(tl.rect.h) + ' 글자 ' + tl.style['font-size'] : '없음'),
      fr.ready && ov.bad.length === 0 && over !== null && over <= T.tol_px && small.length === 0 && glyphOk);
    const [s1, s2, s3] = fr.steps || [];
    const c1 = s1 ? (shown(s1.got, 'center')[0] || null) : null;
    const l1 = s1 ? (shown(s1.got, 'tlist')[0] || null) : null;
    const ov1 = s1 ? overlaps(s1.got) : { bad: ['없음'] };
    row('③ ' + fr.name, '목록 단추 → 목록 칸이 가운데 기둥 안 · 줄 ≥ 1 · 겹침 0', '열림 · 기둥 안 · 줄 ≥ 1 · 겹침 0',
      s1 ? (l1 ? '열림' : '안 열림') + ' · ' + (l1 && c1 && inside(l1.rect, c1.rect, T.tol_px) ? '기둥 안' : '기둥 밖') + ' · 줄 ' + shown(s1.got, 'tlist_rows').length + ' · 겹침 ' + ov1.bad.length + (ov1.bad.length ? '(' + ov1.bad.slice(0, 3).join(' / ') + ')' : '') : '없음',
      !!l1 && !!c1 && inside(l1.rect, c1.rect, T.tol_px) && shown(s1.got, 'tlist_rows').length >= 1 && ov1.bad.length === 0);
    const k2 = s2 ? (shown(s2.got, 'tcard')[0] || null) : null;
    const ov2 = s2 ? overlaps(s2.got) : { bad: ['없음'] };
    row('④ ' + fr.name, '화장실판 첫 줄 누름 → 정보 칸 열림(줄 ≥ 3) · 목록 칸과 함께여도 겹침 0', '열림 · 줄 ≥ 3 · 겹침 0',
      s2 ? (s2.clicked ? '누름' : '못 누름') + ' · ' + (k2 ? '열림 ' + k2.text.slice(0, 20) : '안 열림') + ' · 줄 ' + shown(s2.got, 'tcard_lines').length + ' · 겹침 ' + ov2.bad.length + (ov2.bad.length ? '(' + ov2.bad.slice(0, 3).join(' / ') + ')' : '') : '없음',
      !!s2 && s2.clicked && !!k2 && shown(s2.got, 'tcard_lines').length >= 3 && ov2.bad.length === 0);
    const ov3 = s3 ? overlaps(s3.got) : { bad: ['없음'] };
    row('⑤ ' + fr.name, '목록 닫기 → 목록 칸 닫힘·정보 칸 남음 · 겹침 0', '목록 0 · 정보 칸 1 · 겹침 0',
      s3 ? '목록 ' + shown(s3.got, 'tlist').length + ' · 정보 칸 ' + shown(s3.got, 'tcard').length + ' · 겹침 ' + ov3.bad.length : '없음',
      !!s3 && shown(s3.got, 'tlist').length === 0 && shown(s3.got, 'tcard').length === 1 && ov3.bad.length === 0);
    log.write('상태 자리', { frame: fr.name, text: ((g.status || [])[0] || {}).text || '' });
  }
}

function printTable() {
  const lines = ['| # | 시험 | 기대 | 실제 | 결과 |', '|---|---|---|---|---|'];
  for (const r of rows) lines.push('| ' + [r.no, r.title, r.expect, r.actual, r.ok ? tc.pass_word : tc.fail_word].map((s) => String(s).replace(/\|/g, '/').replace(/\n/g, ' ⏎ ')).join(' | ') + ' |');
  const ok = rows.length > 0 && rows.every((r) => r.ok);
  lines.push('', '추가3 스스로 시험(화장실 제목 · 진짜 크롬 네 창): ' + (ok ? tc.pass_word : tc.fail_word) + ' (' + rows.filter((r) => r.ok).length + ' / ' + rows.length + ') — ' + kstText(tc));
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
