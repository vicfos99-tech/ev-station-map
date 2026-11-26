// 추가1 스스로 시험 — 지도를 화면 전체에 · 판을 지도 위에 · 기본 확대.
//   node web2/tools/try_add1.mjs          # 전부(약 7분 — 다리 S1 이 끝날 때까지)
//   node web2/tools/try_add1.mjs chrome   # 새 앱 네 창 재기만
//   node web2/tools/try_add1.mjs shots    # 옛·새 그림 + 옛 앱 '1번이 화면 안' 재기만
// 진짜 크롬을 원격 길(DevTools)로 띄워 창 크기마다 앱을 새로 열고(폰 저장 지움) 잰다:
//   ① 지도가 화면 전체(상태 줄 아래 ~ 맨 아래, 폭 전체) ② 열린 칸 조합마다 판·검색 칸·저작권·정보 칸·목록 칸·내 차 칸·아래 띠 단추끼리 겹침 0,
//   판 숫자·저작권 글 가림 0(그 자리에 실제로 보이는 것) ③ 숫자 잘림 0 ④ 누르는 높이 48 ⑤ 내 위치 점이 판·칸에 안 가림(점 자리에 보이는 것 = 지도)
//   ⑥ 누른 지점 거리 풍선이 판·칸과 겹침 0(판 옆·아래 자리를 눌러), 판을 누르면 판이 받음 ⑦ 1번 충전소가 화면 안에 드는 비율(S1 거리 분포 × 앞으로 보이는 거리 — 옛·새)
//   ⑧ 옛·새 화면 그림(S1 · 폰 세로 · 넓은 가로)
// 시험만 지도 라이브러리를 감싸(Proxy) 지도 객체를 잡아 확대·보이는 가운데·점 자리를 읽는다(앱 코드는 그대로). 값은 tools/config_try_add1.json.
// 결과 표 tools/logs/try_add1_last.md, 잰 값 tools/logs/try_add1_chrome.json, 기록장 tools/logs/try_add1.log.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { loadToolsConfig, appDir, toolLog, kstText, TOOLS_DIR } from './lib_tools.mjs';
import { testbedInfo, makeSecret, writeSecretFile, startBridge, selectScene, seekScene, linesShim } from './lib_testbed.mjs';
import { findChrome, overlapArea, inside } from './lib_chrome.mjs';

const tc = loadToolsConfig();
const T = JSON.parse(fs.readFileSync(path.join(TOOLS_DIR, 'config_try_add1.json'), 'utf8'));
const APP = appDir(tc);
const OLD = path.resolve(TOOLS_DIR, T.old_app);
const log = toolLog(tc, 'try_add1');
const V = tc.view_s1;
const C = tc.chrome;
const BRIDGE_S = Number(process.argv[3]) || T.bridge_seconds; // 고치는 동안 빨리 보려고 다리 초를 인자로(보고 표는 설정 값)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cfgOf = (name) => JSON.parse(fs.readFileSync(path.join(APP, tc.build.config_dir, name + tc.build.config_ext), 'utf8'));
const CAM = cfgOf('config_mapcam');
const UM = cfgOf('config_ui_map');

const rows = [];
function row(no, title, expect, actual, ok) {
  rows.push({ no, title, expect, actual, ok: !!ok });
  log.write(ok ? '통과' : '실패', { no, title, expect, actual });
}

// ---------- S1 에서 1번까지 거리 분포(장면 파일로 시험이 따로 셈 — 시간 가중) ----------
function s1Dist() {
  const info = testbedInfo(tc, APP);
  const scene = JSON.parse(fs.readFileSync(path.join(path.resolve(path.dirname(info.cfgPath), info.tb.scenes.dir), T.scene + tc.build.config_ext), 'utf8'));
  const leg = scene.route.legs[0];
  const rests = scene.stations.map((s) => s.km).filter((k) => typeof k === 'number').sort((a, b) => a - b);
  const samples = [];
  const step = 0.01;
  for (let x = leg.from_km; x < leg.to_km; x += step) {
    const sp = scene.speeds.find((s) => x >= s.from_km && x < s.to_km) || scene.speeds[scene.speeds.length - 1];
    const next = rests.find((k) => k > x);
    if (next === undefined) continue;
    samples.push({ d: next - x, w: step / sp.kmh });
  }
  const total = samples.reduce((a, s) => a + s.w, 0);
  const sorted = samples.slice().sort((a, b) => a.d - b.d);
  const pct = (p) => { let acc = 0; for (const s of sorted) { acc += s.w; if (acc >= total * p) return s.d; } return sorted[sorted.length - 1].d; };
  return { rests, from: leg.from_km, to: leg.to_km, ratio: (km) => samples.filter((s) => s.d <= km).reduce((a, s) => a + s.w, 0) / total, p50: pct(0.5), p75: pct(0.75), p80: pct(0.8), p90: pct(0.9) };
}

// ---------- 크롬 원격 길 ----------
function cdpClient(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
    ws.onerror = (e) => reject(new Error('CDP 연결 실패 ' + (e && e.message)));
    ws.onopen = () => resolve({
      send: (method, params) => new Promise((res) => { id += 1; pending.set(id, res); ws.send(JSON.stringify({ id, method, params: params || {} })); }),
      close: () => ws.close(),
    });
  });
}

// 페이지가 열릴 때 먼저 도는 시험 손: 지도 라이브러리를 감싸 지도 객체를 window.__evMaps 에 둠 + 재는 함수 __evMeasure
const PRE = `(() => {
  let lib;
  Object.defineProperty(window, 'maplibregl', { configurable: true, get() { return lib; }, set(v) {
    if (!v || !v.Map) { lib = v; return; }
    const M = v.Map;
    class W extends M { constructor(o) { super(o); (window.__evMaps = window.__evMaps || []).push(this); } }
    lib = new Proxy(v, { get(t, k) { return k === 'Map' ? W : t[k]; } });
  } });
  const R = (r) => ({ x: r.left, y: r.top, w: r.width, h: r.height });
  function shown(el) { if (!el) return false; const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; }
  function hits(el) {
    const r = el.getBoundingClientRect(); const k = 2;
    const pts = [[r.left + r.width / 2, r.top + r.height / 2], [r.left + k, r.top + k], [r.right - k, r.top + k], [r.left + k, r.bottom - k], [r.right - k, r.bottom - k]];
    return pts.map(([x, y]) => { const h = document.elementFromPoint(x, y); return { x: Math.round(x), y: Math.round(y), ok: !!h && (h === el || el.contains(h)), by: h ? (h.id || String(h.className) || h.tagName) : null }; });
  }
  window.__evMeasure = (Q, contents, dotLayer) => {
    const out = { vp: { w: innerWidth, h: innerHeight }, els: {} };
    for (const [k, q] of Object.entries(Q)) {
      out.els[k] = [...document.querySelectorAll(q)].map((el) => {
        const o = { shown: shown(el), rect: R(el.getBoundingClientRect()), text: (el.textContent || '').trim().slice(0, 60), sw: el.scrollWidth, cw: el.clientWidth, id: el.id };
        if (contents.includes(k) && o.shown) o.hits = hits(el);
        return o;
      });
    }
    const m = (window.__evMaps || [])[0];
    if (m) {
      const box = m.getContainer().getBoundingClientRect();
      const f = m.queryRenderedFeatures(undefined, { layers: [dotLayer] })[0];
      const c = m.getCenter();
      const info = { zoom: m.getZoom(), bearing: m.getBearing(), pad: m.getPadding(), center: [c.lng, c.lat], box: R(box) };
      if (f) {
        const ll = f.geometry.coordinates;
        const p = m.project(ll);
        const x = box.left + p.x; const y = box.top + p.y;
        const h = document.elementFromPoint(x, y);
        info.dot = { ll, x, y, by: h ? (h.id || String(h.className) || h.tagName) : null, canvas: !!h && h.tagName === 'CANVAS' };
        const open = document.querySelector(Q.open);
        let o = open ? open.getBoundingClientRect() : null;
        if (!o) { const mr = document.querySelector(Q.map).getBoundingClientRect(); const nv = document.querySelector(Q.navi); const nb = nv && shown(nv) ? nv.getBoundingClientRect().bottom : mr.top; o = { left: mr.left, right: mr.right, top: Math.max(mr.top, nb), bottom: mr.bottom, width: mr.width, height: mr.bottom - Math.max(mr.top, nb) }; }
        info.open = { x: o.left, y: o.top, w: o.width, h: o.height };
        const top = m.unproject([p.x, o.top - box.top]);
        info.ahead_top = [top.lng, top.lat];
      }
      out.map = info;
    }
    return out;
  };
})();`;

async function withChrome(fn) {
  const chrome = findChrome(tc);
  if (!chrome) throw new Error('크롬이 없음');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'web2-add1-'));
  const proc = spawn(chrome, [...C.args, T.port_arg + T.port, C.profile_arg + profile, T.blank], { stdio: 'ignore' });
  try {
    await sleep(T.boot_ms);
    let target = null;
    for (let i = 0; i < T.tries && !target; i += 1) {
      try { const list = await (await fetch(T.json_url.split('{port}').join(String(T.port)))).json(); target = list.find((x) => x.type === 'page'); } catch (e) { await sleep(C.poll_ms); }
    }
    if (!target) throw new Error('크롬 원격 길이 안 열림');
    const cdp = await cdpClient(target.webSocketDebuggerUrl);
    try {
      await cdp.send('Page.enable');
      await cdp.send('Runtime.enable');
      await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: PRE });
      return await fn(cdp);
    } finally { cdp.close(); }
  } finally {
    if (proc.exitCode === null) spawnSync(C.kill_cmd, [...C.kill_args_before_pid, String(proc.pid), ...C.kill_args_after_pid], { encoding: 'utf8' });
    await sleep(C.poll_ms);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { log.write('크롬 임시 폴더 못 지움', { error: e.message }); }
  }
}

async function evalIn(cdp, expr) {
  const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result && r.result.exceptionDetails) throw new Error('페이지 오류: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300));
  return r.result && r.result.result ? r.result.result.value : null;
}
const measure = (cdp) => evalIn(cdp, '__evMeasure(' + JSON.stringify(T.q) + ', ' + JSON.stringify(T.contents) + ', ' + JSON.stringify(T.dot_layer) + ')');

async function openPage(cdp, url, fr) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: fr.w, height: fr.h, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Storage.clearDataForOrigin', { origin: V.scheme + V.host + ':' + V.port, storageTypes: 'all' });
  await cdp.send('Page.navigate', { url });
  const t0 = Date.now();
  let ok = false;
  const cond = Object.entries(T.ready).map(([k, n]) => '[...document.querySelectorAll(' + JSON.stringify(T.q[k]) + ')].filter((e) => (e.textContent || "").trim()).length >= ' + n).join(' && ');
  while (Date.now() - t0 < T.ready_ms) {
    await sleep(C.poll_ms);
    try { if (await evalIn(cdp, '(' + cond + ') && !!(window.__evMaps && window.__evMaps[0] && window.__evMaps[0].loaded())')) { ok = true; break; } } catch (e) { /* 아직 */ }
  }
  await sleep(T.settle_ms);
  return { ok, ms: Date.now() - t0 };
}

async function clickQ(cdp, q) {
  return evalIn(cdp, '(() => { const e = document.querySelector(' + JSON.stringify(q) + '); if (!e) return false; e.click(); return true; })()');
}
// 진짜 누름(마우스 눌렀다 뗌) — 지도·판 어느 것이 받을지는 크롬이 정한다
async function tapAt(cdp, x, y) {
  for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
}

// ---------- 잰 값으로 셈 ----------
const shownOf = (g, k) => (g.els[k] || []).filter((e) => e.shown);
function overlapsIn(g) {
  const list = [];
  for (const k of T.boxes) shownOf(g, k).forEach((e, i) => list.push({ n: k + (i ? '[' + i + ']' : ''), r: e.rect }));
  const bad = [];
  for (let i = 0; i < list.length; i += 1) for (let j = i + 1; j < list.length; j += 1) {
    const a = overlapArea(list[i].r, list[j].r);
    if (a > 0) bad.push(list[i].n + '×' + list[j].n + ' ' + Math.round(a) + 'px²');
  }
  return { n: list.length, bad };
}
function coveredIn(g) {
  const bad = [];
  for (const k of T.contents) {
    const els = g.els[k] || [];
    if (!els.length) bad.push(k + ' 없음');
    els.forEach((e, i) => {
      if (!e.shown) { bad.push(k + '[' + i + '] 안 보임'); return; }
      for (const h of e.hits || []) if (!h.ok) bad.push(k + '[' + i + '] ← ' + h.by);
      if (!inside(e.rect, { x: 0, y: 0, w: g.vp.w, h: g.vp.h }, C.tol_px)) bad.push(k + '[' + i + '] 화면 밖');
    });
  }
  return bad;
}
function clipIn(g) {
  const bad = [];
  const right = shownOf(g, 'right')[0];
  const left = shownOf(g, 'left')[0];
  shownOf(g, 'ahead_dist').forEach((e, i) => { if (e.sw > e.cw + C.tol_px || (right && !inside(e.rect, right.rect, C.tol_px))) bad.push('거리' + (i + 1) + ' ' + e.sw + '>' + e.cw); });
  const sv = shownOf(g, 'speed_value')[0];
  if (!sv || sv.sw > sv.cw + C.tol_px || (left && !inside(sv.rect, left.rect, C.tol_px))) bad.push('속도 ' + (sv ? sv.sw + '>' + sv.cw : '없음'));
  return bad;
}
function lowIn(g) {
  return shownOf(g, 'touch').filter((e) => e.rect.h < tc.layout.touch_min_px - C.tol_px).map((e) => (e.id || '?') + ' ' + Math.round(e.rect.h));
}
function havKm(a, b) {
  const k = T.deg_to_rad;
  const dLat = (b[1] - a[1]) * k;
  const dLng = (b[0] - a[0]) * k;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * k) * Math.cos(b[1] * k) * Math.sin(dLng / 2) ** 2;
  return (2 * T.earth_radius_m * Math.asin(Math.sqrt(h))) / T.m_per_km;
}
// 1번 충전소 번호가 화면(비어 보이는 지도 자리) 안에 보이나 · 앞으로 보이는 거리(점 → 지도 자리 위 끝)
function aheadIn(g) {
  const m = g.map || {};
  const mk = shownOf(g, 'marks').find((e) => e.text === '1');
  const o = m.open;
  const inOpen = !!(mk && o && inside(mk.rect, o, C.tol_px));
  const km = m.dot && m.ahead_top ? havKm(m.dot.ll, m.ahead_top) : null;
  return { inOpen, km, zoom: m.zoom };
}

// ---------- 다리 + 서버(옛·새 앱 둘 다) ----------
function buildApp(dir, out, secFile) {
  fs.mkdirSync(out, { recursive: true });
  const here = V.host + ':' + V.port;
  const gw = JSON.parse(fs.readFileSync(path.join(dir, tc.build.config_dir, V.gateway_config + tc.build.config_ext), 'utf8'));
  gw.gateway_url = V.scheme + here;
  gw.allowed_hosts = [here];
  const overFile = path.join(out, V.override_file);
  fs.writeFileSync(overFile, JSON.stringify({ [V.gateway_config]: gw }), 'utf8');
  const r = spawnSync(process.execPath, [path.join(TOOLS_DIR, 'build.mjs'), '--out', out, '--secret', secFile, '--override', overFile, '--app', dir], { encoding: 'utf8' });
  if (r.status !== tc.exit.ok) throw new Error('빌드 실패(' + dir + '): ' + (r.stderr || '').trim());
  return fs.readFileSync(path.join(out, tc.build.out_file));
}

async function withServer(fn) {
  const secret = makeSecret(tc);
  const sec = writeSecretFile(tc, secret);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'web2-add1-build-'));
  let server = null;
  let bridge = null;
  try {
    const pages = { '/new/': buildApp(APP, path.join(tmp, 'new'), sec.file), '/old/': buildApp(OLD, path.join(tmp, 'old'), sec.file) };
    const info = testbedInfo(tc, APP);
    const shim = linesShim(tc, info, secret);
    bridge = await startBridge(tc, info, BRIDGE_S, secret);
    await selectScene(info, T.scene, false);
    if (T.tick) await seekScene(info, T.tick);
    server = http.createServer((req, res) => {
      if (req.url.startsWith(V.gateway_prefix)) {
        const dataPrefix = info.b.paths.data;
        if (req.method === 'GET' && req.url.startsWith(dataPrefix)) {
          const a = shim.answer(decodeURIComponent(req.url.slice(dataPrefix.length)), req.headers);
          if (a) { res.writeHead(a.status, { 'Content-Type': tc.testbed.json_type, 'Cache-Control': 'no-store' }); res.end(a.body); return; }
        }
        const headers = { ...req.headers };
        delete headers.host;
        const up = http.request(new URL(req.url, info.base), { method: req.method, headers }, (ur) => { res.writeHead(ur.statusCode, ur.headers); ur.pipe(res); });
        up.on('error', () => { if (!res.headersSent) res.writeHead(V.proxy_fail_status); res.end(); });
        res.on('close', () => up.destroy());
        req.pipe(up);
        return;
      }
      const u = req.url.split('?')[0];
      if (pages[u]) { res.writeHead(200, { 'Content-Type': V.content_type, 'Cache-Control': 'no-store' }); res.end(pages[u]); return; }
      res.writeHead(404);
      res.end();
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(V.port, V.host, resolve); });
    return await fn(V.scheme + V.host + ':' + V.port);
  } finally {
    if (server) { server.closeAllConnections(); server.close(); }
    if (bridge) {
      log.write('다리 끝 기다림', { seconds: BRIDGE_S });
      const code = await Promise.race([bridge.waitExit(), sleep(BRIDGE_S * V.ms_per_s + C.exit_grace_ms).then(() => 'timeout')]);
      if (code === 'timeout') bridge.proc.kill();
      row('끝', '다리가 시험 모드 시간 뒤 스스로 끝남', '끝남(코드)', String(code), code !== 'timeout');
    }
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(sec.dir, { recursive: true, force: true });
  }
}

// ---------- ①~⑦ 새 앱 네 창 ----------
const SAVE = { frames: [], old: [] };
async function partChrome(cdp, base, dist) {
  for (const fr of T.frames) {
    const op = await openPage(cdp, base + '/new/', fr);
    const rec = { name: fr.name, ready: op.ok, steps: [], taps: [] };
    SAVE.frames.push(rec);
    if (!op.ok) { row('① ' + fr.name, '앱이 뜸', '준비됨', '준비 안 됨 ' + op.ms + 'ms', false); continue; }
    // 단계(열린 칸 조합)마다 재기
    const stepTexts = [];
    let allOk = true;
    let g0 = null;
    for (const st of T.steps) {
      let clicked = true;
      for (const d of st.do) { clicked = (await clickQ(cdp, d.click)) && clicked; await sleep(T.act_ms); }
      if (st.do.length) await sleep(T.panel_ms - T.act_ms);
      const g = await measure(cdp);
      if (!g0) g0 = g;
      rec.steps.push({ name: st.name, clicked, g });
      const ov = overlapsIn(g);
      const cov = coveredIn(g);
      const clip = clipIn(g);
      const low = lowIn(g);
      const dot = g.map && g.map.dot;
      const dotOk = !!(dot && dot.canvas);
      const ok = clicked && ov.bad.length === 0 && cov.length === 0 && clip.length === 0 && low.length === 0 && dotOk;
      allOk = allOk && ok;
      stepTexts.push(st.name + ': ' + (ok ? '겹침 0 · 가림 0 · 잘림 0 · 낮은 것 0 · 점 보임' : [clicked ? '' : '누를 것 없음', ov.bad.slice(0, 4).join(', '), cov.slice(0, 3).join(', '), clip.join(', '), low.slice(0, 3).join(', '), dotOk ? '' : '점 가림(' + (dot ? dot.by : '없음') + ')'].filter(Boolean).join(' / ')) + ' (상자 ' + ov.n + ')');
    }
    // ① 지도가 화면 전체
    const map = shownOf(g0, 'map')[0];
    const status = shownOf(g0, 'status')[0];
    const top = status ? status.rect.y + status.rect.h : 0;
    const full = !!(map && Math.abs(map.rect.x) <= C.tol_px && Math.abs(map.rect.w - g0.vp.w) <= C.tol_px && Math.abs(map.rect.y - top) <= C.tol_px && Math.abs(map.rect.y + map.rect.h - g0.vp.h) <= C.tol_px);
    row('① ' + fr.name, '지도가 화면 전체(상태 줄 아래 ~ 맨 아래, 폭 전체)', '지도 x 0 · 폭 ' + g0.vp.w + ' · 위 ' + Math.round(top) + ' · 아래 ' + g0.vp.h,
      map ? '지도 x ' + Math.round(map.rect.x) + ' · 폭 ' + Math.round(map.rect.w) + ' · 위 ' + Math.round(map.rect.y) + ' · 아래 ' + Math.round(map.rect.y + map.rect.h) : '지도 없음', full);
    row('②~⑤ ' + fr.name, '열린 칸 조합 ' + T.steps.length + '가지마다: 판·검색 칸·저작권·정보 칸·목록 칸·내 차 칸·아래 띠 단추끼리 겹침 0 · 판 숫자·저작권 가림 0 · 숫자 잘림 0 · 누르는 높이 48 · 내 위치 점 자리에 보이는 것 = 지도',
      '모든 조합 통과', stepTexts.join(' ┃ '), allOk);
    // ⑤ 점 자리: 보이는 지도 자리 안, 세로 비율
    const m0 = g0.map || {};
    const d0 = m0.dot;
    const o0 = m0.open;
    const ry = d0 && o0 ? (d0.y - o0.y) / o0.h : null;
    const rx = d0 && o0 ? (d0.x - o0.x) / o0.w : null;
    const dotIn = !!(d0 && o0 && inside({ x: d0.x, y: d0.y, w: 0, h: 0 }, o0, T.dot_tol_px));
    row('⑤ ' + fr.name, '내 위치 점이 비어 보이는 지도 자리 안(판에 안 가림) · 진행 방향 위일 때 아래쪽', '자리 안 · 가로 ' + UM.over.dot_x_ratio + ' · 세로 ' + UM.over.dot_y_ratio,
      d0 ? '점 (' + Math.round(d0.x) + ',' + Math.round(d0.y) + ') · 자리 ' + [o0.x, o0.y, o0.w, o0.h].map(Math.round).join(',') + ' · 가로 ' + (rx === null ? '-' : rx.toFixed(2)) + ' · 세로 ' + (ry === null ? '-' : ry.toFixed(2)) + ' · 보이는 가운데 옮김 ' + JSON.stringify(m0.pad) + ' · 방향 ' + Math.round(m0.bearing) : '점 없음',
      dotIn && d0.canvas && Math.abs(ry - UM.over.dot_y_ratio) <= T.dot_tol_px / o0.h + 0.02);
    // ⑦ 1번이 화면 안 · 앞으로 보이는 거리
    const ah = aheadIn(g0);
    rec.ahead = ah;
    // ⑥ 누른 지점 거리 풍선
    const tapTexts = [];
    let tapOk = true;
    for (const t of T.taps) {
      const g = await measure(cdp);
      let x;
      let y;
      if (t.at === 'open') { const o = g.map.open; x = o.x + o.w * t.fx; y = o.y + o.h * t.fy; } else {
        const l = shownOf(g, 'left')[0];
        x = l.rect.x + l.rect.w * t.fx; y = l.rect.y + l.rect.h + t.dy;
      }
      await tapAt(cdp, x, y);
      await sleep(T.tap_ms);
      const g2 = await measure(cdp);
      const tap = shownOf(g2, 'tap')[0];
      const ov = overlapsIn(g2).bad.filter((b) => b.includes('tap'));
      const inVp = tap ? inside(tap.rect, { x: 0, y: 0, w: g2.vp.w, h: g2.vp.h }, C.tol_px) : false;
      const hit = tap ? await evalIn(cdp, '(() => { const e = document.querySelector(' + JSON.stringify(T.q.tap) + '); const r = e.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!h && (h === e || e.contains(h)); })()') : false;
      const ok = !!tap && ov.length === 0 && inVp && hit && tap.rect.h >= tc.layout.touch_min_px - C.tol_px;
      tapOk = tapOk && ok;
      rec.taps.push({ name: t.name, x, y, tap: tap || null, ov });
      tapTexts.push(t.name + '(' + Math.round(x) + ',' + Math.round(y) + '): ' + (tap ? '풍선 ' + [tap.rect.x, tap.rect.y, tap.rect.w, tap.rect.h].map(Math.round).join(',') + (ov.length ? ' 겹침 ' + ov.join(', ') : ' 겹침 0') + (hit ? '' : ' 가려짐') + (inVp ? '' : ' 화면 밖') : '풍선 안 뜸'));
      await tapAt(cdp, x, y);
      await sleep(T.act_ms);
    }
    row('⑥ ' + fr.name, '누른 지점 거리 풍선: 지도 자리 가운데·판 옆·저작권 위·판 아래 지도를 눌러 풍선이 판·칸·아래 띠와 겹침 0 · 그 자리에 풍선이 보임 · 화면 안 · 높이 48', '다섯 곳 모두', tapTexts.join(' ┃ '), tapOk);
    // 판을 누르면 판이 받음
    const sp = shownOf(await measure(cdp), 'speed_root')[0];
    let boardOk = false;
    let boardText = '속도판 없음';
    if (sp) {
      await tapAt(cdp, sp.rect.x + sp.rect.w / 2, sp.rect.y + sp.rect.h / 2);
      await sleep(T.tap_ms);
      const tap = shownOf(await measure(cdp), 'tap')[0];
      boardOk = !tap;
      boardText = tap ? '풍선이 뜸(지도가 받음)' : '풍선 안 뜸(판이 받음)';
    }
    row('⑥-판 ' + fr.name, T.board_tap.name, '풍선 안 뜸', boardText, boardOk);
  }
  // ⑦ 1번이 화면 안 — 창마다 앞으로 보이는 거리 → S1 분포에서 그 거리 안인 비율
  const tx = SAVE.frames.map((f) => f.name + ': 확대 ' + (f.ahead && f.ahead.zoom != null ? f.ahead.zoom.toFixed(2) : '-') + ' · 앞으로 보이는 거리 ' + (f.ahead && f.ahead.km != null ? f.ahead.km.toFixed(1) + ' km' : '-') + ' → 비율 ' + (f.ahead && f.ahead.km != null ? Math.round(dist.ratio(f.ahead.km) * 100) + '%' : '-') + ' · 지금(틱 ' + T.tick + '대) 1번 보임 ' + (f.ahead && f.ahead.inOpen ? '예' : '아니오'));
  const ok7 = SAVE.frames.every((f) => f.ahead && f.ahead.km != null && Math.abs(f.ahead.zoom - CAM.start_zoom) < 0.01);
  row('⑦ 새', 'S1 기본 확대(' + CAM.start_zoom + ')에서 1번이 화면 안에 드는 비율 — S1 1번까지 거리(시간 가중) 50%·75%·90% = ' + dist.p50.toFixed(1) + '·' + dist.p75.toFixed(1) + '·' + dist.p90.toFixed(1) + ' km', '창마다 재고 비율을 적음(확대 = 설정 값)', tx.join(' ┃ '), ok7);
}

// ---------- ⑧ 옛·새 그림 + 옛 앱 1번 비율 ----------
async function partShots(cdp, base, dist) {
  const dir = path.resolve(TOOLS_DIR, T.out_dir);
  fs.mkdirSync(dir, { recursive: true });
  const oldText = [];
  for (const fr of T.frames) {
    const op = await openPage(cdp, base + '/old/', fr);
    const g = op.ok ? await measure(cdp) : null;
    const ah = g ? aheadIn(g) : null;
    SAVE.old.push({ name: fr.name, ready: op.ok, ahead: ah, map: g && g.map });
    oldText.push(fr.name + ': 확대 ' + (ah && ah.zoom != null ? ah.zoom.toFixed(2) : '-') + ' · 앞으로 보이는 거리 ' + (ah && ah.km != null ? ah.km.toFixed(1) + ' km' : '-') + ' → 비율 ' + (ah && ah.km != null ? Math.round(dist.ratio(ah.km) * 100) + '%' : '-'));
    const sf = T.shot_frames.find((s) => s.w === fr.w && s.h === fr.h);
    if (sf && op.ok) {
      const pic = await cdp.send('Page.captureScreenshot', { format: 'png' });
      if (pic.result && pic.result.data) fs.writeFileSync(path.join(dir, 'old_' + sf.file + '.png'), Buffer.from(pic.result.data, 'base64'));
    }
  }
  row('⑦ 옛', '고치기 전(1e119e3) 기본 확대에서 1번이 화면 안에 드는 비율(같은 셈)', '창마다 적음', oldText.join(' ┃ '), SAVE.old.every((f) => f.ready && f.ahead && f.ahead.km != null));
  for (const sf of T.shot_frames) {
    const op = await openPage(cdp, base + '/new/', sf);
    if (!op.ok) continue;
    const pic = await cdp.send('Page.captureScreenshot', { format: 'png' });
    if (pic.result && pic.result.data) fs.writeFileSync(path.join(dir, 'new_' + sf.file + '.png'), Buffer.from(pic.result.data, 'base64'));
  }
  // 나란히: 두 그림을 한 페이지에 놓고 그 페이지를 그림으로
  const made = [];
  for (const sf of T.shot_frames) {
    const html = path.join(dir, 'both_' + sf.file + '.html');
    const png = path.join(dir, 'both_' + sf.file + '.png');
    fs.writeFileSync(html, '<!doctype html><meta charset="utf-8"><body style="margin:0;background:#fff;font:14px sans-serif"><div style="display:flex;gap:8px;padding:8px">'
      + '<figure style="margin:0"><figcaption>' + T.old_caption + ' · ' + sf.name + '</figcaption><img src="old_' + sf.file + '.png"></figure>'
      + '<figure style="margin:0"><figcaption>' + T.new_caption + ' · ' + sf.name + '</figcaption><img src="new_' + sf.file + '.png"></figure></div></body>', 'utf8');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: sf.w * 2 + T.both_pad, height: sf.h + T.both_pad * 2, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: pathToFileURL(html).href });
    await sleep(T.boot_ms);
    const pic = await cdp.send('Page.captureScreenshot', { format: 'png' });
    if (pic.result && pic.result.data) fs.writeFileSync(png, Buffer.from(pic.result.data, 'base64'));
    made.push(png);
  }
  const sizes = made.map((f) => (fs.existsSync(f) ? fs.statSync(f).size : 0));
  row('⑧', '옛·새 화면 나란히 그림(S1 · 폰 세로 · 넓은 가로)', '그림 둘 있음', made.map((f, i) => f + ' ' + sizes[i] + 'B').join(' · '), sizes.length === T.shot_frames.length && sizes.every((n) => n > T.min_png_bytes));
}

function printTable() {
  const lines = ['| # | 시험 | 기대 | 실제 | 결과 |', '|---|---|---|---|---|'];
  for (const r of rows) lines.push('| ' + [r.no, r.title, r.expect, r.actual, r.ok ? tc.pass_word : tc.fail_word].map((s) => String(s).replace(/\|/g, '/').replace(/\n/g, ' ⏎ ')).join(' | ') + ' |');
  const ok = rows.length > 0 && rows.every((r) => r.ok);
  lines.push('', '추가1 시험: ' + (ok ? tc.pass_word : tc.fail_word) + ' (' + rows.filter((r) => r.ok).length + ' / ' + rows.length + ') — ' + kstText(tc));
  const text = lines.join('\n');
  console.log(text);
  const dir = path.join(APP, tc.log.dir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, T.report_file), text + '\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'try_add1_chrome.json'), JSON.stringify(SAVE, null, 1), 'utf8');
  return ok;
}

const only = process.argv[2];
try {
  log.write('시작', { only: only || '전부' });
  const dist = s1Dist();
  log.write('S1 1번까지 거리', { p50: dist.p50, p75: dist.p75, p80: dist.p80, p90: dist.p90, rests: dist.rests });
  await withServer(async (base) => withChrome(async (cdp) => {
    if (!only || only === 'chrome') await partChrome(cdp, base, dist);
    if (!only || only === 'shots') await partShots(cdp, base, dist);
  }));
} catch (e) {
  log.write('예외', { error: String(e && e.stack || e) });
  console.error(e);
  rows.push({ no: '예외', title: String(e && e.message), expect: '-', actual: '-', ok: false });
}
const ok = printTable();
log.write('끝', { result: ok ? tc.pass_word : tc.fail_word });
process.exitCode = ok ? tc.exit.ok : tc.exit.fail;
