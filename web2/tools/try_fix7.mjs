// 고칠 것 일곱 시험(묘성이 원격 크롬에서 본 것 — 2026-11-25).
//   node web2/tools/try_fix7.mjs
// ⑥ 고속도로에서 300m 넘게 벗어나면 '주변'(순수 셈 — 장면 선에서 직각으로 떨어진 점을 차례로 넣음, 다리 없음)
// ④ S2 115 '보였다 사라짐' 까닭: 보기 bat 과 같은 S2 창(틱·초)을 가상 창으로 돌려 속도판 글을 1초마다 적는다(다리 창 동안 / 다리가 끝난 뒤)
// ①②③⑤⑦ 진짜 크롬(창 없이)에서 넓은 가로·좁은 가로·좁은 세로 둘 — 덮임 없음(그 자리에 실제로 보이는 것)·구분선 목록·판 자리(세로도 왼편·오른편)·글 잘림·누르는 높이
// 표(기대·실제)로 찍고 하나라도 실패면 0 아닌 코드. 기록장 tools/logs/try_fix7.log, 표 사본 tools/logs/try_fix7_last.md.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadToolsConfig, appDir, toolLog, kstText } from './lib_tools.mjs';
import { testbedInfo, makeSecret, writeSecretFile, startBridge, selectScene, seekScene, fetchWithLines } from './lib_testbed.mjs';
import { sleep, loadBoards, startApp as runApp, waitFor } from './lib_apprun.mjs';
import { measureInChrome, overlapArea, inside } from './lib_chrome.mjs';

const tc = loadToolsConfig();
const T = tc.try_fix7;
const L = tc.layout;
const C = tc.chrome;
const A1 = tc.try_a1;
const APP = appDir(tc);
const log = toolLog(tc, 'try_fix7');
const cfgOf = (name) => JSON.parse(fs.readFileSync(path.join(APP, tc.build.config_dir, name + tc.build.config_ext), 'utf8'));
const src = (name) => import(pathToFileURL(path.join(APP, tc.build.src_dir, name + tc.build.module_ext)).href);

const rows = [];
function row(no, title, expect, actual, ok) {
  rows.push({ no, title, expect, actual, ok: !!ok });
  log.write(ok ? '통과' : '실패', { no, title, expect, actual });
}

// ---------- 장면 선 위 km 자리와 직각 방향(시험이 따로 셈 — 앱 Geo 를 쓰지 않음) ----------
function distM(a, b) {
  const k = A1.deg_to_rad;
  const c = Math.sin(a[0] * k) * Math.sin(b[0] * k) + Math.cos(a[0] * k) * Math.cos(b[0] * k) * Math.cos((b[1] - a[1]) * k);
  return A1.earth_radius_m * Math.acos(Math.min(1, Math.max(-1, c)));
}
function pointAtKm(points, km) {
  let along = 0;
  const m = km * tc.try_a2na.m_per_km;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const d = distM(points[i], points[i + 1]);
    if (along + d >= m) {
      const t = (m - along) / d;
      const a = points[i];
      const b = points[i + 1];
      return { lat: a[0] + (b[0] - a[0]) * t, lng: a[1] + (b[1] - a[1]) * t, dlat: b[0] - a[0], dlng: b[1] - a[1] };
    }
    along += d;
  }
  throw new Error('km 가 선 밖: ' + km);
}
// 진행 방향(북 0, 시계 방향 도)과 직각(오른쪽)으로 off_m 떨어진 점
function offsetPoint(p, offM) {
  const k = A1.deg_to_rad;
  const cos = Math.cos(p.lat * k);
  const ex = p.dlng * cos;
  const ey = p.dlat;
  const n = Math.hypot(ex, ey);
  const rx = ey / n; // 오른쪽 직각(동쪽 성분)
  const ry = -ex / n; // (북쪽 성분)
  const dLat = (offM * ry) / A1.earth_radius_m / k;
  const dLng = (offM * rx) / (A1.earth_radius_m * cos) / k;
  const heading = ((Math.atan2(ex, ey) / k) + 360) % 360;
  return { lat: p.lat + dLat, lng: p.lng + dLng, heading };
}

// ---------- ⑥ 고속도로 밖 '주변'(순수) ----------
async function partAround(line, scene) {
  const locate = await src('locate');
  const ahead = await src('ahead');
  const geo = await src('geo');
  const R = { config_locate: cfgOf('config_locate'), config_geo: cfgOf('config_geo'), config_ahead: cfgOf('config_ahead') };
  const lib = { parts: { geo }, rules: R };
  // 장면 충전소 → 앱의 stations 꼴(relay_parse 가 내는 것과 같은 칸만): 업체마다 한 곳
  const list = [];
  for (const s of scene.stations) for (const o of s.operators || []) list.push({ id: o.station_id, name: o.name, operator: o.operator, lat: o.loc[0], lng: o.loc[1], rest: o.rest === true });
  const stations = { lines: [{ name: line.name, points: line.points }], list };
  const base = pointAtKm(line.points, T.around.km);
  let own = null;
  let t = Date.now();
  const got = [];
  for (const step of T.around.steps) {
    const p = offsetPoint(base, step.off_m);
    t += T.around.t_step_ms;
    const fix = { t, lat: p.lat, lng: p.lng, speed_kmh: T.around.speed_kmh, heading_deg: p.heading, accuracy_m: T.around.accuracy_m };
    const inputs = { fix, stations };
    const pos = locate.locate(inputs, {}, R.config_locate, lib);
    own = ahead.aheadOf(inputs, { pos }, R.config_ahead, lib, own);
    got.push({ off: step.off_m, expect: step.expect, mode: own && own.mode, posOff: pos.off_m, first: own && own.items[0] ? own.items[0].name + ' ' + own.items[0].dist_km + (own.items[0].straight ? '(직선)' : '') : '-' });
  }
  const ok = got.every((g) => g.mode === R.config_ahead.modes[g.expect]);
  row('⑥-1', "고속도로(장면 선) km " + T.around.km + " 에서 직각으로 떨어진 점을 차례로 — 300m 넘게 벗어나면 '주변', 선 위(150m)로 돌아오면 '앞의 충전소'",
    got.map((g) => g.off + 'm→' + g.expect).join(' · '),
    got.map((g) => g.off + 'm(앱 ' + g.posOff + 'm)→' + g.mode + ' [' + g.first + ']').join(' · '), ok);
  return got;
}

// ---------- ④ S2 115 '보였다 사라짐' ----------
async function partS2() {
  const info = testbedInfo(tc, APP);
  const secret = makeSecret(tc);
  const sec = writeSecretFile(tc, secret);
  const { main } = await import(pathToFileURL(path.join(APP, tc.build.src_dir, 'app.js')).href);
  const boards = await loadBoards(APP, tc);
  const SP = cfgOf('config_ui_speed');
  const bridge = await startBridge(tc, info, T.s2.window_s, secret);
  const t0 = Date.now();
  let ended = null;
  bridge.waitExit().then(() => { ended = Date.now(); });
  const samples = [];
  let a = null;
  try {
    await selectScene(info, T.s2.scene, false);
    await seekScene(info, T.s2.tick);
    a = runApp({ app: APP, tc, main, boards }, { secretFile: sec.file, fetchFn: fetchWithLines(tc, info, secret), stamp: 'try-fix7' });
    const until = t0 + (T.s2.window_s + T.s2.tail_s) * tc.view_s1.ms_per_s;
    while (Date.now() < until) {
      await sleep(T.s2.sample_ms);
      const el = a.el(SP.ids.value);
      const loc = a.get('health.src');
      samples.push({ s: Math.round((Date.now() - t0) / tc.view_s1.ms_per_s), text: el ? el.textContent : null, bridge: ended === null, loc: loc && loc.loc ? (loc.loc.ok ? 'ok' : loc.loc.why) : '-' });
    }
  } finally {
    if (a) a.stop();
    fs.rmSync(sec.dir, { recursive: true, force: true });
  }
  const want = String(T.s2.kmh);
  const during = samples.filter((x) => x.bridge);
  const firstIdx = during.findIndex((x) => x.text === want);
  const afterFirst = firstIdx >= 0 ? during.slice(firstIdx) : [];
  const gapsDuring = afterFirst.filter((x) => x.text !== want);
  const after = samples.filter((x) => !x.bridge);
  const blankAt = after.find((x) => x.text === '');
  const endS = ended ? Math.round((ended - t0) / tc.view_s1.ms_per_s) : null;
  row('④-1', 'S2(틱 ' + T.s2.tick + ', 다리 ' + T.s2.window_s + '초 — 보기 bat 과 같은 창) 다리가 도는 동안 속도판',
    '처음 ' + want + ' 이 뜬 뒤 다리가 끝날 때까지 ' + want + ' 그대로(빈 때 0)',
    '처음 ' + want + ' ' + (firstIdx >= 0 ? during[firstIdx].s + '초' : '없음') + ' · 그 뒤 다른 글 ' + gapsDuring.length + '번' + (gapsDuring.length ? '(' + gapsDuring.map((x) => x.s + '초 "' + x.text + '"').join(', ') + ')' : '') + ' · 다리 끝 ' + endS + '초',
    firstIdx >= 0 && gapsDuring.length === 0);
  row('④-2', '다리(보기 창)가 끝난 뒤 속도판', '위치가 끊김 → 속도판이 빈다(설계 F7: 지금 속도를 셀 수 없으면 빈칸) — 앱 결함이 아니라 보기 창 끝',
    '빈 때 ' + (blankAt ? blankAt.s + '초(다리 끝 뒤 ' + (blankAt.s - endS) + '초, 위치 ' + blankAt.loc + ')' : '안 빔') + ' · 마지막 ' + JSON.stringify(samples.length ? samples[samples.length - 1].text : null),
    !!blankAt && endS !== null);
  log.write('S2 표본', { samples });
  return { samples, endS };
}

// ---------- ①②③⑤⑦ 진짜 크롬 ----------
function frameChecks(fr) {
  const g = fr.got || {};
  const one = (n) => (g[n] || [])[0];
  const all = (n) => g[n] || [];
  const tol = C.tol_px;
  const vp = { x: 0, y: 0, w: fr.inner ? fr.inner.w : fr.w, h: fr.inner ? fr.inner.h : fr.h };
  const out = {};
  // 덮임: 가려지면 안 되는 것의 자리에 실제로 그것이 보임 + 단추·메모 칸과 겹치는 넓이 0 + 화면 안
  const covered = [];
  for (const n of L.contents) {
    const list = all(n);
    if (!list.length) covered.push(n + ' 없음');
    list.forEach((e, i) => {
      if (!e.shown) { covered.push(n + '[' + i + '] 안 보임'); return; }
      for (const h of e.hits || []) if (!h.ok) covered.push(n + '[' + i + '] (' + h.x + ',' + h.y + ') ← ' + h.by);
      if (!inside(e.rect, vp, tol)) covered.push(n + '[' + i + '] 화면 밖');
    });
  }
  const overlaps = [];
  for (const cn of L.controls) {
    for (const c of all(cn)) {
      if (!c.shown) continue;
      for (const n of [...L.contents, 'attrib_box', 'speed_root']) for (const [i, e] of all(n).entries()) {
        const a = overlapArea(c.rect, e.rect);
        if (a > 0) overlaps.push(cn + '×' + n + '[' + i + '] ' + Math.round(a) + 'px²');
      }
    }
  }
  const ctrlShown = L.controls.filter((n) => one(n) && one(n).shown);
  out.cover = { ok: covered.length === 0 && overlaps.length === 0 && ctrlShown.length === L.controls.length, text: '가림 ' + covered.length + (covered.length ? '(' + covered.slice(0, 4).join(' / ') + ')' : '') + ' · 겹침 ' + overlaps.length + (overlaps.length ? '(' + overlaps.slice(0, 4).join(' / ') + ')' : '') + ' · 단추·칸 보임 ' + ctrlShown.length + '/' + L.controls.length };
  // 구분선 목록
  const rws = all('ahead_rows');
  const bad = [];
  rws.forEach((r, i) => {
    const s = r.style || {};
    if (s['background-color'] !== L.list_bg) bad.push(i + ' 배경 ' + s['background-color']);
    if (s['border-radius'] !== L.list_radius) bad.push(i + ' 모서리 ' + s['border-radius']);
    if (s['box-shadow'] && s['box-shadow'] !== 'none') bad.push(i + ' 그림자');
    if (i > 0 && !(parseFloat(s['border-top-width']) >= 1 && s['border-top-style'] === L.list_line_style)) bad.push(i + ' 윗선 ' + s['border-top-width'] + ' ' + s['border-top-style']);
  });
  out.list = { ok: rws.length === L.rows && bad.length === 0, text: '줄 ' + rws.length + ' · 줄 배경 ' + (rws[0] && rws[0].style ? rws[0].style['background-color'] : '-') + ' · 모서리 ' + (rws[0] && rws[0].style ? rws[0].style['border-radius'] : '-') + ' · 2·3번 윗선 ' + rws.slice(1).map((r) => r.style['border-top-width'] + ' ' + r.style['border-top-style']).join(', ') + (bad.length ? ' · 틀림 ' + bad.join(' / ') : '') };
  // 배치: 세 칸이 왼편·가운데·오른편으로 한 줄(위 끝 같음), 충전소판은 오른편 자리 안, 속도판은 왼편 자리 안
  const sl = one('slot_left');
  const sc = one('slot_center');
  const sr = one('slot_right');
  const ar = one('ahead_root');
  const sp = one('speed_root');
  const okLay = sl && sc && sr && ar && sp && sl.rect.x + sl.rect.w <= sc.rect.x + tol && sc.rect.x + sc.rect.w <= sr.rect.x + tol
    && Math.abs(sl.rect.y - sc.rect.y) <= tol && Math.abs(sr.rect.y - sc.rect.y) <= tol && inside(ar.rect, sr.rect, tol) && inside(sp.rect, sl.rect, tol);
  const wd = (e) => (e ? Math.round(e.rect.w) : '-');
  out.layout = { ok: !!okLay, text: '왼편 ' + wd(sl) + ' · 지도 ' + wd(sc) + ' · 오른편 ' + wd(sr) + 'px · 위 끝 ' + [sl, sc, sr].map((e) => (e ? Math.round(e.rect.y) : '-')).join('/') + ' · 충전소판 오른편 안 ' + (ar && sr && inside(ar.rect, sr.rect, tol) ? '예' : '아니오') + ' · 속도판 왼편 안 ' + (sp && sl && inside(sp.rect, sl.rect, tol) ? '예' : '아니오') + (fr.inner ? ' · 세로 ' + (fr.inner.portrait ? '예' : '아니오') : '') };
  // 글 잘림: 거리·속도 숫자가 상자 안에 다 들어감(넘치지 않음)
  const clip = [];
  all('ahead_dist').forEach((e, i) => { if (e.sw > e.cw + tol || !inside(e.rect, sr ? sr.rect : vp, tol)) clip.push('거리' + (i + 1) + ' ' + e.sw + '>' + e.cw); });
  const sv = one('speed_value');
  if (!sv || sv.sw > sv.cw + tol || !inside(sv.rect, sl ? sl.rect : vp, tol)) clip.push('속도 ' + (sv ? sv.sw + '>' + sv.cw : '없음'));
  out.clip = { ok: clip.length === 0, text: '거리 ' + all('ahead_dist').map((e) => e.text).join(' / ') + ' · 속도 ' + (sv ? sv.text : '-') + (clip.length ? ' · 잘림 ' + clip.join(' / ') : ' · 잘림 0') };
  // 누르는 높이
  const low = L.touch.map((n) => ({ n, h: one(n) ? Math.round(one(n).rect.h) : 0 })).filter((x) => x.h < L.touch_min_px);
  out.touch = { ok: low.length === 0, text: L.touch.map((n) => n + ' ' + (one(n) ? Math.round(one(n).rect.h) : '-') + 'px').join(' · ') };
  return out;
}

async function partChrome(buildApp) {
  const res = await measureInChrome(tc, APP, { scene: L.scene, tick: L.tick, frames: L.frames, sel: L.sel, ready: L.ready, log, build_app: buildApp });
  if (res.error) {
    row('⑧-0', '진짜 크롬 재기', '결과 옴', res.error, false);
    return res;
  }
  for (const fr of res.frames) {
    const k = frameChecks(fr);
    const head = fr.name + (fr.ready ? '' : ' (준비 안 됨 ' + fr.wait_ms + 'ms)') + (fr.error ? ' 오류 ' + fr.error : '');
    row('①③⑤ ' + fr.name, head + " — 덮임 없음: 충전소판 줄·거리·속도 숫자·지도 저작권 글의 자리에 실제로 그것이 보임, '이상해'·메모 칸·'기록' 단추와 겹침 0", '가림 0 · 겹침 0 · 단추·칸 보임 ' + L.controls.length, k.cover.text, fr.ready && k.cover.ok);
    row('② ' + fr.name, '충전소판 = 구분선 있는 목록(줄 배경·둥근 모서리·그림자 없음, 2·3번 줄 위 가는 선)', '줄 ' + L.rows + ' · 배경 ' + L.list_bg + ' · 모서리 ' + L.list_radius + ' · 윗선 ≥1px ' + L.list_line_style, k.list.text, fr.ready && k.list.ok);
    row('⑦ ' + fr.name, '판 자리: 왼편 속도판 · 가운데 지도 · 오른편 충전소판 한 줄(세로 창도 같음)', '왼편 < 지도 < 오른편 · 위 끝 같음 · 판이 제 자리 안', k.layout.text, fr.ready && k.layout.ok);
    row('글 ' + fr.name, '거리·속도 숫자가 잘리지 않음(상자 안에 다 들어감)', '잘림 0', k.clip.text, fr.ready && k.clip.ok);
    row('누름 ' + fr.name, '메모 칸·이상해·기록 단추 높이', '≥ ' + L.touch_min_px + 'px', k.touch.text, fr.ready && k.touch.ok);
  }
  return res;
}

async function main2() {
  log.write('시작', {});
  const info = testbedInfo(tc, APP);
  const line = JSON.parse(fs.readFileSync(path.join(path.resolve(path.dirname(info.cfgPath), info.tb.scenes.lines_dir), Object.values(tc.testbed.lines_shim)[0] + info.tb.scenes.line_suffix), 'utf8'));
  const scene = JSON.parse(fs.readFileSync(path.join(path.resolve(path.dirname(info.cfgPath), info.tb.scenes.dir), L.scene + tc.build.config_ext), 'utf8'));
  // 인자 하나를 주면 그 부분만(around · s2 · chrome) — 고치는 동안 빨리 보려고. 보고에 쓰는 표는 인자 없이 돌린 것
  const only = process.argv[2];
  if (!only || only === 'around') await partAround(line, scene);
  if (!only || only === 's2') await partS2();
  // chrome-old <앱 사본 폴더>: 같은 재기를 옛 앱 사본에 — 시험이 옛 화면의 덮임을 실제로 잡는지(실패해야 맞음)
  if (only === 'chrome-old') { await partChrome(path.resolve(process.argv[3])); return; }
  if (only && only !== 'chrome') return;
  const res = await partChrome();
  const dir = path.join(APP, tc.log.dir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'try_fix7_chrome.json'), JSON.stringify(res, null, 1), 'utf8');
}

function printTable() {
  const lines = ['| # | 시험 | 기대 | 실제 | 결과 |', '|---|---|---|---|---|'];
  for (const r of rows) lines.push('| ' + [r.no, r.title, r.expect, r.actual, r.ok ? tc.pass_word : tc.fail_word].map((s) => String(s).replace(/\|/g, '/').replace(/\n/g, ' ⏎ ')).join(' | ') + ' |');
  const ok = rows.length > 0 && rows.every((r) => r.ok);
  lines.push('', '고칠 것 일곱 시험: ' + (ok ? tc.pass_word : tc.fail_word) + ' (' + rows.filter((r) => r.ok).length + ' / ' + rows.length + ') — ' + kstText(tc));
  const text = lines.join('\n');
  console.log(text);
  const dir = path.join(APP, tc.log.dir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, T.report_file), text + '\n', 'utf8');
  return ok;
}

try {
  await main2();
} catch (e) {
  log.write('예외', { error: String(e && e.stack || e) });
  console.error(e);
  rows.push({ no: '예외', title: String(e && e.message), expect: '-', actual: '-', ok: false });
}
const ok = printTable();
log.write('끝', { result: ok ? tc.pass_word : tc.fail_word });
process.exitCode = ok ? tc.exit.ok : tc.exit.fail;
