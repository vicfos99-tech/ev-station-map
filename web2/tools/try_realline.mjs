// (4-2) 테스트 베드 실자료 시험 — 실제 도로 모양 선(오픈스트리트맵)을 쓰는 실자료 장면에서 앱의 '선 위 / 주변' 판정이 실제 도로와 맞는지.
//   node web2/tools/try_realline.mjs            # 순수(다리 없음) + 다리(시험 모드, 배속)
//   node web2/tools/try_realline.mjs pure       # 순수만
// 순수: ① 실자료 장면이면 앱 선 파일 자리에 새 선(안의 이름은 앱 선 이름), 옛 장면이면 옛 직선 그대로 ② 앱 relay_parse 가 새 선을 받아들임
//       ③ 새 선 위 → '앞의 충전소', 동탄 단지 안(고칠 것 일곱 ⑥ 자리) → '주변', 다시 선 위 → '앞의 충전소'(앱 locate·ahead 그대로)
//       ④ 같은 동탄 자리가 옛 직선에서는 '앞의 충전소'(옛 문제 재현 — 시험이 차이를 가려냄)
// 다리: ⑤ 제한 속도 고속도로 표의 선 이름이 앱 선 이름(장면을 고른 뒤) ⑥ 실자료 장면 흐름 자리가 새 선에서 on_line_m 안(앱이 받는 위치가 실제 도로 위)
// 표(기대·실제)로 찍고 하나라도 실패면 0 아닌 코드. 기록장 tools/logs/try_realline.log, 표 사본 tools/logs/<report_file>.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadToolsConfig, appDir, toolLog, kstText } from './lib_tools.mjs';
import { testbedInfo, makeSecret, startBridge, selectScene, referenceStream, raceLimit } from './lib_testbed.mjs';
import { realLinesShim, loadRealConfig } from './lib_realline.mjs';

const tc = loadToolsConfig();
const R = loadRealConfig();
const A1 = tc.try_a1;
const M_PER_KM = tc.try_a2na.m_per_km;
const APP = appDir(tc);
const log = toolLog(tc, 'try_realline');
const cfgOf = (name) => JSON.parse(fs.readFileSync(path.join(APP, tc.build.config_dir, name + tc.build.config_ext), 'utf8'));
const src = (name) => import(pathToFileURL(path.join(APP, tc.build.src_dir, name + tc.build.module_ext)).href);

const rows = [];
function row(no, title, expect, actual, ok) {
  rows.push({ no, title, expect, actual, ok: !!ok });
  log.write(ok ? '통과' : '실패', { no, title, expect, actual });
}

// ---------- 거리(시험이 따로 셈 — 앱 Geo 를 쓰지 않음) ----------
function distM(a, b) {
  const k = A1.deg_to_rad;
  const c = Math.sin(a[0] * k) * Math.sin(b[0] * k) + Math.cos(a[0] * k) * Math.cos(b[0] * k) * Math.cos((b[1] - a[1]) * k);
  return A1.earth_radius_m * Math.acos(Math.min(1, Math.max(-1, c)));
}
function cumOf(points) {
  const cum = [0];
  for (let i = 0; i + 1 < points.length; i += 1) cum.push(cum[i] + distM(points[i], points[i + 1]));
  return cum;
}
function pointAtM(points, cum, m) {
  for (let i = 0; i + 1 < points.length; i += 1) {
    if (cum[i + 1] >= m) {
      const span = cum[i + 1] - cum[i];
      const t = span ? (m - cum[i]) / span : 0;
      const a = points[i];
      const b = points[i + 1];
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
  }
  throw new Error('m 가 선 밖: ' + m);
}
// 선 위 가장 가까운 자리: {m(선 첫 점에서), off(m)} — 조각마다 평면 근사
function project(points, cum, p) {
  const k = A1.deg_to_rad;
  let best = null;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const cs = Math.cos(a[0] * k);
    const ax = a[1] * cs; const ay = a[0]; const bx = b[1] * cs; const by = b[0];
    const px = p[1] * cs; const py = p[0];
    const dx = bx - ax; const dy = by - ay;
    const span = dx * dx + dy * dy;
    const f = span ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / span)) : 0;
    const q = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    const off = distM(q, p);
    if (!best || off < best.off) best = { m: cum[i] + (cum[i + 1] - cum[i]) * f, off };
  }
  return best;
}
function headingOf(a, b) {
  const k = A1.deg_to_rad;
  const y = Math.sin((b[1] - a[1]) * k) * Math.cos(b[0] * k);
  const x = Math.cos(a[0] * k) * Math.sin(b[0] * k) - Math.sin(a[0] * k) * Math.cos(b[0] * k) * Math.cos((b[1] - a[1]) * k);
  const full = (2 * Math.PI) / k;
  return ((Math.atan2(y, x) / k) + full) % full;
}

function sceneOf(info, name) {
  const dir = path.resolve(path.dirname(info.cfgPath), info.tb.scenes.dir);
  return JSON.parse(fs.readFileSync(path.join(dir, name + tc.build.config_ext), 'utf8'));
}

// 차례로 위치를 넣어 앱 locate·ahead 가 낸 mode 들
async function modesAlong(line, scene, fixes) {
  const locate = await src('locate');
  const ahead = await src('ahead');
  const geo = await src('geo');
  const RC = { config_locate: cfgOf('config_locate'), config_geo: cfgOf('config_geo'), config_ahead: cfgOf('config_ahead') };
  const lib = { parts: { geo }, rules: RC };
  const list = [];
  for (const s of scene.stations) for (const o of s.operators || []) list.push({ id: o.station_id, name: o.name, operator: o.operator, lat: o.loc[0], lng: o.loc[1], rest: o.rest === true });
  const stations = { lines: [{ name: line.name, points: line.points }], list };
  let own = null;
  let t = Date.now();
  const got = [];
  for (const f of fixes) {
    t += R.t_step_ms;
    const fix = { t, lat: f.at[0], lng: f.at[1], speed_kmh: R.speed_kmh, heading_deg: f.heading, accuracy_m: R.accuracy_m };
    const inputs = { fix, stations };
    const pos = locate.locate(inputs, {}, RC.config_locate, lib);
    own = ahead.aheadOf(inputs, { pos }, RC.config_ahead, lib, own);
    const mode = Object.keys(RC.config_ahead.modes).find((k) => RC.config_ahead.modes[k] === (own && own.mode)) || String(own && own.mode);
    got.push({ label: f.label, expect: f.expect, mode, off: pos.off_m, first: own && own.items[0] ? own.items[0].name + ' ' + own.items[0].dist_km : '-' });
  }
  return got;
}

async function partPure(info) {
  const secret = makeSecret(tc);
  const hdr = { [info.b.secret_header]: secret };
  const real = realLinesShim(tc, info, secret, () => R.scene);
  const old = realLinesShim(tc, info, secret, () => R.old_scene);
  const used = real.realOf(R.scene);
  const appFile = used.length ? used[0].app_file : Object.keys(tc.testbed.lines_shim)[0];
  const linesDir = path.resolve(path.dirname(info.cfgPath), info.tb.scenes.lines_dir);
  const tbReal = used.length ? JSON.parse(fs.readFileSync(path.join(linesDir, used[0].line + info.tb.scenes.line_suffix), 'utf8')) : null;
  const oldFile = fs.readFileSync(path.join(linesDir, tc.testbed.lines_shim[appFile] + info.tb.scenes.line_suffix), 'utf8');
  const ra = real.answer(appFile, hdr);
  const oa = old.answer(appFile, hdr);
  const lineReal = ra && ra.status === 200 ? JSON.parse(ra.body) : null;
  const ok1 = !!tbReal && !!lineReal && lineReal.name === used[0].app_name && lineReal.points.length === tbReal.points.length && oa && oa.body === oldFile;
  row('①', '실자료 장면이면 앱 선 자리(' + appFile + ')에 새 선, 옛 장면이면 옛 직선 그대로',
    R.scene + ' → ' + (used.length ? used[0].line : '?') + '(이름 ' + (used.length ? used[0].app_name : '?') + ', 점 ' + (tbReal ? tbReal.points.length : '?') + ') · ' + R.old_scene + ' → 옛 파일 그대로',
    (lineReal ? '이름 ' + lineReal.name + ' · 점 ' + lineReal.points.length : '답 ' + (ra && ra.status)) + ' · 옛 장면 ' + (oa && oa.body === oldFile ? '옛 파일 그대로' : '다름'), ok1);

  const parse = await src('relay_parse');
  let parsed = null;
  let why = '';
  try { parsed = parse.line(lineReal, cfgOf('config_relay_parse')); } catch (e) { why = e.message; }
  row('②', '앱 relay_parse 가 새 선을 받아들임', '던지지 않음 · 점 수 같음', parsed ? '받음 · 점 ' + parsed.points.length : '던짐 ' + why, parsed && lineReal && parsed.points.length === lineReal.points.length);
  if (!parsed) return;

  // ③ 새 선 위 → 동탄 → 선 위
  const pts = parsed.points;
  const cum = cumOf(pts);
  const at = project(pts, cum, R.dongtan);
  const onLine = (km, label) => {
    const m = at.m + km * M_PER_KM;
    const p = pointAtM(pts, cum, m);
    const q = pointAtM(pts, cum, Math.min(cum[cum.length - 1], m + tc.try_fix7.around.heading_step_km * M_PER_KM));
    return { at: p, heading: headingOf(p, q), label, expect: 'ahead' };
  };
  const fixes = R.approach_km.map((km) => onLine(km, '선 ' + km + 'km'));
  const last = fixes[fixes.length - 1];
  fixes.push({ at: R.dongtan, heading: last.heading, label: '동탄', expect: 'around' });
  fixes.push(onLine(R.return_km, '선 +' + R.return_km + 'km'));
  const scene = sceneOf(info, R.scene);
  const got = await modesAlong(parsed, scene, fixes);
  row('③', '새 선(실제 도로) 위 → 앞의 충전소, 동탄 단지 안(새 선에서 ' + Math.round(at.off) + ' m) → 주변, 다시 선 위 → 앞의 충전소',
    got.map((g) => g.label + '→' + g.expect).join(' · '),
    got.map((g) => g.label + '(앱 ' + g.off + 'm)→' + g.mode + ' [' + g.first + ']').join(' · '), got.every((g) => g.mode === g.expect));

  // ④ 옛 직선에서는 같은 동탄 자리가 선 위(옛 문제)
  const oldLine = parse.line(JSON.parse(oa.body), cfgOf('config_relay_parse'));
  const ocum = cumOf(oldLine.points);
  const oat = project(oldLine.points, ocum, R.dongtan);
  const op = pointAtM(oldLine.points, ocum, Math.max(0, oat.m - M_PER_KM));
  const oldGot = await modesAlong(oldLine, sceneOf(info, R.old_scene), [{ at: op, heading: headingOf(op, R.dongtan), label: '옛 선 1km 앞', expect: 'ahead' }, { at: R.dongtan, heading: headingOf(op, R.dongtan), label: '동탄', expect: 'ahead' }]);
  row('④', '옛 직선에서는 같은 동탄 자리가 선 위(옛 문제 재현 — 시험이 차이를 가려냄)', oldGot.map((g) => g.label + '→' + g.expect).join(' · '),
    oldGot.map((g) => g.label + '(앱 ' + g.off + 'm)→' + g.mode).join(' · '), oldGot.every((g) => g.mode === g.expect));
}

async function partBridge(info) {
  const secret = makeSecret(tc);
  const used = realLinesShim(tc, info, secret, () => R.scene).realOf(R.scene);
  const linesDir = path.resolve(path.dirname(info.cfgPath), info.tb.scenes.lines_dir);
  const line = JSON.parse(fs.readFileSync(path.join(linesDir, used[0].line + info.tb.scenes.line_suffix), 'utf8'));
  const cum = cumOf(line.points);
  const bridge = await startBridge(tc, info, R.bridge_seconds, secret, R.bridge_scale);
  let ticks = null;
  try {
    await selectScene(info, R.scene, false);
    // ⑤ 제한 속도 고속도로 표의 선 이름 — 제한 속도 대신 답은 다리에서 고른 장면으로 만든다(그래서 장면을 고른 뒤, 보기 도구와 같은 길)
    const RL = cfgOf('config_relay_limit');
    const L = cfgOf('config_relay_parse').limit;
    const la = realLinesShim(tc, info, secret).answer(RL.highway_file, { [info.b.secret_header]: secret });
    const names = la && la.status === 200 ? [...new Set(JSON.parse(la.body)[L.sections_key].map((s) => s[L.line_key]))] : [];
    row('⑤', '실자료 장면의 제한 속도 고속도로 표 선 이름 = 앱 선 이름(장면을 고른 뒤)', used[0].app_name, (la ? la.status + ' · ' : '없음 · ') + (names.join(',') || '없음'), names.length === 1 && names[0] === used[0].app_name);
    const ref = referenceStream(info);
    const until = Date.now() + R.stream_wait_ms;
    while (ref.ticks.size < R.stream_ticks && Date.now() < until) await new Promise((r) => setTimeout(r, tc.testbed.poll_ms));
    await ref.stop();
    ticks = [...ref.ticks.values()];
  } finally {
    bridge.proc.kill();
    await raceLimit(bridge.waitExit(), tc.testbed.health_wait_ms, null);
  }
  const offs = ticks.map((t) => project(line.points, cum, [t.lat, t.lng]).off);
  const worst = offs.length ? Math.max(...offs) : Infinity;
  row('⑥', '다리(시험 모드)의 ' + R.scene + ' 흐름 자리가 새 선(실제 도로) 위', '틱 ' + R.stream_ticks + ' 개 이상 · 모두 ≤ ' + R.on_line_m + ' m',
    '틱 ' + ticks.length + ' · 가장 먼 ' + (Number.isFinite(worst) ? worst.toFixed(1) : '-') + ' m', ticks.length >= R.stream_ticks && worst <= R.on_line_m);
}

function printTable() {
  const lines = ['| # | 시험 | 기대 | 실제 | 결과 |', '|---|---|---|---|---|'];
  for (const r of rows) lines.push('| ' + [r.no, r.title, r.expect, r.actual, r.ok ? tc.pass_word : tc.fail_word].map((s) => String(s).replace(/\|/g, '/').replace(/\n/g, ' ⏎ ')).join(' | ') + ' |');
  const ok = rows.length > 0 && rows.every((r) => r.ok);
  lines.push('', '실자료 시험: ' + (ok ? tc.pass_word : tc.fail_word) + ' (' + rows.filter((r) => r.ok).length + ' / ' + rows.length + ') — ' + kstText(tc));
  const text = lines.join('\n');
  console.log(text);
  const dir = path.join(APP, tc.log.dir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, R.report_file), text + '\n', 'utf8');
  return ok;
}

try {
  log.write('시작', { only: process.argv[2] || null });
  const info = testbedInfo(tc, APP);
  await partPure(info);
  if (process.argv[2] !== 'pure') await partBridge(info);
} catch (e) {
  log.write('예외', { error: String(e && e.stack || e) });
  console.error(e);
  rows.push({ no: '예외', title: String(e && e.message), expect: '-', actual: '-', ok: false });
}
const ok = printTable();
log.write('끝', { result: ok ? tc.pass_word : tc.fail_word });
process.exitCode = ok ? tc.exit.ok : tc.exit.fail;
