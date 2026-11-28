// 추가4 스스로 시험 — 나들목 인근 충전소 옵션('내 차'의 포함 칸).
//   node web2/tools/try_add4.mjs pure     # ① 셈 견주기: 옛 앱 실제 자료(나들목 항목)를 새 앱 자료 꼴로 바꿔 붙인 노선이 옛 노선과 같은 엔진 입력·같은 결과인가(옛 web/engine.js 와 새 engine.js)
//   node web2/tools/try_add4.mjs chrome   # ② 진짜 크롬: 처음 값(꺼짐)·켜고 저장·펼치기/접기, 창마다 · ③ 자료가 없을 때 한 줄
//   node web2/tools/try_add4.mjs          # 둘 다(약 4~5분 — 크롬 세 번)
// 값은 tools/config_try_add4.json(무엇을 재는지는 그 note). 표로 찍고 하나라도 실패면 0 아닌 코드. 기록장 tools/logs/try_add4.log, 표 사본 tools/logs/try_add4_last.md.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { loadToolsConfig, appDir, toolLog, kstText, TOOLS_DIR } from './lib_tools.mjs';
import { measureInChrome, overlapArea, inside } from './lib_chrome.mjs';

const tc = loadToolsConfig();
const T = JSON.parse(fs.readFileSync(path.join(TOOLS_DIR, 'config_try_add4.json'), 'utf8'));
const A7 = tc.try_a7;
const APP = appDir(tc);
const log = toolLog(tc, 'try_add4');
const require = createRequire(import.meta.url);
const cfgOf = (name) => JSON.parse(fs.readFileSync(path.join(APP, tc.build.config_dir, name + tc.build.config_ext), 'utf8'));
const srcOf = async (name) => import(pathToFileURL(path.join(APP, tc.build.src_dir, name + '.js')).href);
const part = process.argv[2] || 'all';

const rows = [];
function row(no, title, expect, actual, ok) {
  rows.push({ no, title, expect, actual, ok: !!ok });
  log.write(ok ? '통과' : '실패', { no, title, expect, actual });
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const plain = (x) => JSON.parse(JSON.stringify(x));

// ---------- ① 셈 견주기 ----------
async function partPure() {
  const E = await srcOf('engine');
  const PIm = await srcOf('planinput');
  const M = await srcOf('mine');
  const ramps = await srcOf('ramps');
  const OLD = path.resolve(APP, T.old_dir);
  const OE = require(path.join(OLD, T.old_engine));
  const LIVE = require(path.join(OLD, T.old_live));
  const EC = cfgOf('config_engine');
  const PI = cfgOf('config_planinput');
  const R = cfgOf('config_relay_ramps');
  const UM = cfgOf('config_ui_my');
  const lib = { parts: { mine: M }, rules: {} };
  const now = LIVE.fetched_at + T.now_after_ms;
  const cases = [
    ...A7.input_cases.filter((k) => T.case_names.includes(k.name) && k.mine === 'none'),
    ...T.extra_cases.map((k) => ({ ...k, mine: 'none' })),
  ];
  let total = 0;
  let eqIn = 0;
  let eqPlan = 0;
  let nearPrimary = 0;
  let nearBackup = 0;
  let icN = 0;
  let nearN = 0;
  let shownN = 0;
  const diff = [];
  const first = [];
  for (const route of LIVE.routes) {
    // 옛 노선: 나들목 항목(kind ic, 휴게소 충전기 없음)·휴게소 줄. 새 앱 자료: 나들목 항목마다 나들목 줄 하나(왕복 거리·충전소) + 충전소 id → 충전소 표
    const stationOf = new Map();
    const list = [];
    for (const a of route.rest_areas) {
      if (a.kind !== T.ic_kind) continue;
      icN += 1;
      list.push({ id: a.id, name: a.name, km: a.km, dir: R.dirs.both, rest: null, nearby: a.nearby.map((n) => { stationOf.set(n.station.id, n.station); nearbyCount(); return { id: n.station.id, detour: n.detour, at: null }; }) });
    }
    function nearbyCount() { nearN += 1; }
    const base = route.rest_areas.filter((a) => a.kind !== T.ic_kind).map((a) => ({ ...a, nearby: (a.nearby || []).slice() }));
    const got = ramps.attach(base, list, { dir: LC_FORWARD(), ic_kind: T.ic_kind, along: (km) => km, station: (id) => (stationOf.has(id) ? JSON.parse(JSON.stringify(stationOf.get(id))) : null) }, R);
    shownN += got.shown;
    const liveAt = route.live ? LIVE.fetched_at : 0;
    const rawOld = { ...route, live_at: liveAt };
    const rawNew = { ...route, rest_areas: got.areas, live_at: liveAt };
    for (const k of cases) {
      total += 1;
      const my = { ...UM.defaults, ...k.my };
      const a = plain(PIm.inputs(plain(rawOld), my, k.soc, M.normalize({ ops: {}, stations: {} }), now, PI, EC, lib));
      const b = plain(PIm.inputs(plain(rawNew), my, k.soc, M.normalize({ ops: {}, stations: {} }), now, PI, EC, lib));
      const strip = (x) => { for (const ar of x.route.rest_areas) for (const s of [...ar.stations, ...ar.nearby.map((n) => n.station)]) s.chargers = s.chargers.map((c) => ({ type: c.type, power_kw: c.power_kw, status: c.status })); return x; };
      const A = strip(a);
      const B = strip(b);
      const pa = OE.plan(A.route, A.vehicle, A.user, now, k.pos, my.stale);
      const pb = E.plan(B.route, B.vehicle, B.user, now, k.pos, my.stale, EC);
      const okIn = same(A.route, B.route) && same(A.vehicle, B.vehicle) && same(A.user, B.user);
      const okPlan = same(pa, pb);
      if (okIn) eqIn += 1;
      if (okPlan) eqPlan += 1;
      if ((!okIn || !okPlan) && diff.length < 3) diff.push(route.key + '/' + k.name + (okIn ? '' : ' 입력') + (okPlan ? '' : ' 결과'));
      const rec = pb.recommendation;
      if (rec.primary && rec.primary.is_nearby) nearPrimary += 1;
      if (rec.backup && rec.backup.is_nearby) nearBackup += 1;
      if (first.length < 1 && rec.primary && rec.primary.is_nearby) first.push(route.key + '/' + k.name + ' 1순위 ' + rec.primary.rest_area_name + ' 왕복 +' + rec.primary.detour_km + 'km ' + rec.primary.final_price + '원');
    }
  }
  row('①-1', '셈 견주기 — 옛 앱 실제 자료 ' + LIVE.routes.length + '개 노선의 나들목 항목 ' + icN + '곳·인근 충전소 ' + nearN + '개를 새 앱 자료 꼴(나들목 줄)로 바꿔 ramps.attach 로 붙인 노선이, 옛 노선과 (가) 엔진 입력(휴게소·나들목 차례·km·인근 충전소·왕복 거리·내 차·할인) 같음 (나) 옛 web/engine.js 와 새 engine.js 로 셈한 목록·점수·추천·알림 글이 통째로 같음(노선 × ' + cases.length + '경우)',
    '입력 ' + total + '/' + total + ' 같음 · 결과 ' + total + '/' + total + ' 같음 · 붙은 ' + nearN,
    '입력 ' + eqIn + '/' + total + ' 같음 · 결과 ' + eqPlan + '/' + total + ' 같음 · 붙은 ' + shownN + (diff.length ? ' (다름: ' + diff.join(', ') + ')' : ''),
    total > 0 && eqIn === total && eqPlan === total && shownN === nearN);
  row('①-2', '셈 견주기 — 나들목 인근이 실제로 추천을 바꾸는지(옛 앱도 같음): 1순위가 나들목 인근 충전소인 경우 ≥ 1 (옛 앱 같은 자리 사례: 나들목 왕복 거리를 더한 값)', '1순위가 인근인 경우 ≥ 1', '1순위 인근 ' + nearPrimary + ' · 예비 인근 ' + nearBackup + ' / ' + total + (first.length ? ' · 예 ' + first[0] : ''), nearPrimary >= 1);
}
function LC_FORWARD() { return cfgOf('config_locate').dir_words.forward; }

// ---------- ② ③ 진짜 크롬 ----------
const shown = (g, k) => ((g || {})[k] || []).filter((e) => e.shown);
const texts = (g, k) => shown(g, k).map((e) => e.text);

async function runChrome(frameIdx, overrides, tag) {
  const frames = [tc.layout.frames[frameIdx]];
  const res = await measureInChrome(tc, APP, { scene: T.scene, tick: T.tick, frames, sel: T.sel, ready: T.ready, actions: T.actions, log, overrides });
  const dir = path.join(APP, tc.log.dir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, tag + '_' + T.json_file), JSON.stringify(res, null, 1), 'utf8');
  return res;
}

function placeBad(step, W) {
  // 칸이 가운데 칸 안 · 양옆 판·저작권과 겹침 0 · 단추 높이 48 이상 · 가로 넘침 0
  const g = step.got;
  const panel = shown(g, 'route_root')[0];
  const center = shown(g, 'center')[0];
  const bad = [];
  if (!panel) return ['칸 안 보임'];
  if (center && !inside(panel.rect, center.rect, T.tol_px)) bad.push('가운데 칸 밖');
  for (const k of ['slot_left', 'slot_right', 'attrib']) for (const e of shown(g, k)) if (overlapArea(panel.rect, e.rect) > T.tol_px) bad.push(k + ' 겹침');
  for (const e of shown(g, 'toggles')) if (e.rect.h < T.touch_min_px - T.tol_px || e.rect.w < T.touch_min_px - T.tol_px) bad.push('펼치기 단추 ' + Math.round(e.rect.w) + '×' + Math.round(e.rect.h));
  for (const e of shown(g, 'near_rows')) if (e.rect.h < T.touch_min_px - T.tol_px) bad.push('인근 줄 높이 ' + Math.round(e.rect.h));
  for (const e of shown(g, 'route_rows')) if (e.sw > e.cw + T.tol_px) bad.push('줄 가로 넘침');
  const page = (g.page || [])[0];
  if (page && page.sw > page.cw + T.tol_px) bad.push('페이지 가로 넘침 ' + (page.sw - page.cw));
  return bad;
}

async function partChrome() {
  const W = T.words;
  for (const idx of T.frames_run) {
    const res = await runChrome(idx, undefined, 'data' + idx);
    if (res.error) { row('②-' + idx, '진짜 크롬 재기', '결과 옴', res.error, false); continue; }
    const fr = res.frames[0];
    const [s1, s2, s3, s4, s5, s6, s7] = fr.steps || [];
    const name = fr.name;
    if (!fr.ready || !s7) { row('② ' + name, '준비되고 걸음 일곱이 다 옴', '준비 · 7', (fr.ready ? '준비' : '준비 안 됨(' + (fr.status_text || '') + ')') + ' · ' + (fr.steps || []).length, false); continue; }
    // ②-가 처음 값(꺼짐): 목록 칸이 열리고 휴게소 줄만 — 나들목 항목 0 · 인근 0 · 자료 한 줄 없음
    const offRows = shown(s1.got, 'route_rows');
    const offOk = !!shown(s1.got, 'route_root')[0] && offRows.length >= 1 && shown(s1.got, 'route_ic_rows').length === 0 && shown(s1.got, 'near_rows').length === 0 && texts(s1.got, 'stop_chips').every((x) => !x.includes(W.near_count)) && shown(s1.got, 'route_note').length === 0;
    row('②-가 ' + name, '처음 값(꺼짐): 목록 칸이 열리고 휴게소 줄만 — 나들목 항목 0 · 인근 0 · 나들목 글 0 · 나들목 자료 한 줄 없음', '줄 ≥ 1 · 항목 0 · 인근 0 · 한 줄 0',
      '줄 ' + offRows.length + ' · 항목 ' + shown(s1.got, 'route_ic_rows').length + ' · 인근 ' + shown(s1.got, 'near_rows').length + ' · 한 줄 ' + shown(s1.got, 'route_note').length, offOk);
    // ②-나 켜고 저장
    row('②-나 ' + name, "'내 차' 칸에 포함 칸이 있고(보임) 켜서 저장하면 '" + W.saved + "' 글", '칸 보임 · ' + W.saved, '칸 ' + shown(s3.got, 'my_check').length + ' · ' + (texts(s4.got, 'my_note')[0] || '(없음)'),
      shown(s2.got, 'my_check').length === 1 && (texts(s4.got, 'my_note')[0] || '').includes(W.saved));
    // ②-다 켜짐: 나들목 항목·휴게소 아래 인근, 자료 한 줄 없음
    const onIc = shown(s5.got, 'route_ic_rows');
    const icNames = onIc.map((e) => e.text);
    const countChips = texts(s5.got, 'stop_chips').filter((x) => x.includes(W.near_count));
    const bad5 = placeBad(s5, name);
    row('②-다 ' + name, '켜짐: 나들목 항목(' + W.ic_name + ')이 목록에 끼고 · 항목·휴게소 줄에 "' + W.near_count + ' n곳" · 펼치기 단추(48px) · 펼치기 전엔 인근 줄 0 · 나들목 자료 한 줄 없음 · 칸 안·겹침 0·가로 넘침 0',
      '항목 ≥ 1 · 글 ≥ 2 · 단추 ≥ 2 · 인근 0 · 한 줄 0 · 나쁨 0',
      '항목 ' + onIc.length + '(' + icNames.map((s) => s.slice(0, 16)).join('/') + ') · 글 ' + countChips.length + ' · 단추 ' + shown(s5.got, 'toggles').length + ' · 인근 ' + shown(s5.got, 'near_rows').length + ' · 한 줄 ' + shown(s5.got, 'route_note').length + ' · 나쁨 ' + bad5.length + (bad5.length ? '(' + bad5.slice(0, 3).join(' / ') + ')' : ''),
      onIc.length >= 1 && icNames.some((s) => s.includes(W.ic_name)) && countChips.length >= 2 && shown(s5.got, 'toggles').length >= 2 && shown(s5.got, 'near_rows').length === 0 && shown(s5.got, 'route_note').length === 0 && bad5.length === 0);
    // ②-라 펼침: 인근 줄(왕복 거리 칩·날짜 있는 줄은 '○일 전 정보')
    const nearChips = texts(s6.got, 'near_chips');
    const bad6 = placeBad(s6, name);
    row('②-라 ' + name, '나들목 항목 펼치기: 인근 충전소 줄 2(왕복 거리 칩 "' + W.detour + '"·날짜가 있는 줄에 "' + W.age + ' · ' + W.age_tail + '"), 단추 글 ' + W.close + ' · 겹침 0',
      '줄 2 · 왕복 칩 ≥ 2 · 날짜 칩 1 · ' + W.close + ' · 나쁨 0',
      '줄 ' + shown(s6.got, 'near_rows').length + ' · 왕복 ' + nearChips.filter((x) => x.includes(W.detour)).length + ' · 날짜 ' + nearChips.filter((x) => x.includes(W.age)).length + ' · ' + (texts(s6.got, 'ic_toggles')[0] || '-') + ' · 나쁨 ' + bad6.length + (bad6.length ? '(' + bad6.slice(0, 3).join(' / ') + ')' : ''),
      shown(s6.got, 'near_rows').length === 2 && nearChips.filter((x) => x.includes(W.detour)).length >= 2 && nearChips.filter((x) => x.includes(W.age) && x.includes(W.age_tail)).length === 1 && (texts(s6.got, 'ic_toggles')[0] || '') === W.close && bad6.length === 0);
    row('②-마 ' + name, '다시 누르면 접힘: 인근 줄 0 · 단추 글 ' + W.open, '인근 0 · ' + W.open, '인근 ' + shown(s7.got, 'near_rows').length + ' · ' + (texts(s7.got, 'ic_toggles')[0] || '-'), shown(s7.got, 'near_rows').length === 0 && (texts(s7.got, 'ic_toggles')[0] || '') === W.open);
    log.write('줄', { frame: name, rows: texts(s5.got, 'route_rows').map((s) => s.slice(0, 40)), pick: texts(s5.got, 'route_pick').map((s) => s.slice(0, 80)) });
  }
  // ③ 자료가 없을 때(묻는 파일이 중계에 없음): 켜면 한 줄, 나들목 항목·인근 0
  const res = await runChrome(T.none_frame, T.none_override_full, 'none');
  if (res.error) { row('③', '진짜 크롬 재기(자료 없음)', '결과 옴', res.error, false); return; }
  const fr = res.frames[0];
  const s5 = (fr.steps || [])[4];
  if (!fr.ready || !s5) { row('③', '준비되고 걸음이 다 옴', '준비', fr.ready ? '걸음 ' + (fr.steps || []).length : '준비 안 됨', false); return; }
  const note = texts(s5.got, 'route_note')[0] || '';
  row('③ ' + fr.name, '켰는데 나들목 자료가 없으면(중계에 파일 없음): 목록 칸 위에 "' + W.no_data + '" 한 줄 · 나들목 항목 0 · 인근 0 · 휴게소 줄은 그대로(짐작해 채우지 않음)', '한 줄 · 항목 0 · 인근 0 · 줄 ≥ 1',
    '한 줄 "' + note + '" · 항목 ' + shown(s5.got, 'route_ic_rows').length + ' · 인근 ' + shown(s5.got, 'near_rows').length + ' · 줄 ' + shown(s5.got, 'route_rows').length,
    note === W.no_data && shown(s5.got, 'route_ic_rows').length === 0 && shown(s5.got, 'near_rows').length === 0 && shown(s5.got, 'route_rows').length >= 1);
}

function printTable() {
  const lines = ['| # | 시험 | 기대 | 실제 | 결과 |', '|---|---|---|---|---|'];
  for (const r of rows) lines.push('| ' + [r.no, r.title, r.expect, r.actual, r.ok ? tc.pass_word : tc.fail_word].map((s) => String(s).replace(/\|/g, '/').replace(/\n/g, ' ⏎ ')).join(' | ') + ' |');
  const ok = rows.length > 0 && rows.every((r) => r.ok);
  lines.push('', '추가4 스스로 시험(나들목 인근 충전소 옵션): ' + (ok ? tc.pass_word : tc.fail_word) + ' (' + rows.filter((r) => r.ok).length + ' / ' + rows.length + ') — ' + kstText(tc));
  const text = lines.join('\n');
  console.log(text);
  const dir = path.join(APP, tc.log.dir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, T.report_file), text + '\n', 'utf8');
  return ok;
}

// 자료 없는 경우의 설정 덮기: 설정 파일 통째(선 이름 뽑는 무늬만 바꿈)
{
  const base = cfgOf('config_relay_ramps');
  T.none_override_full = { config_relay_ramps: { ...base, lines_from: { ...base.lines_from, ...T.none_override.config_relay_ramps.lines_from } } };
}

try {
  log.write('시작', { part });
  if (part === 'pure' || part === 'all') await partPure();
  if (part === 'chrome' || part === 'all') await partChrome();
} catch (e) {
  log.write('예외', { error: String(e && e.stack || e) });
  console.error(e);
  rows.push({ no: '예외', title: String(e && e.message), expect: '-', actual: '-', ok: false });
}
const ok = printTable();
log.write('끝', { result: ok ? tc.pass_word : tc.fail_word });
process.exitCode = ok ? tc.exit.ok : tc.exit.fail;
