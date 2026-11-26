// 추가2 스스로 시험 — 벡터 지도(글자가 지도를 돌려도 바로 서게).
//   node web2/tools/try_add2.mjs           # 전부(약 8분)
//   node web2/tools/try_add2.mjs frames    # 벡터 지도 네 창 재기만
//   node web2/tools/try_add2.mjs turn      # 0·90·180° 돌려 보기 + 전·후 그림만
//   node web2/tools/try_add2.mjs switch    # 설정 한 줄로 그림 타일 · 못 받을 때 한 줄만
// 진짜 크롬을 원격 길(DevTools)로 띄워 앱을 새로 열고(폰 저장 지움) 잰다:
//   ① 바탕이 벡터 지도(출처 꼴·조각 받음·글자 층 그려짐·한글 이름) ② 네 창에서 판·칸끼리 겹침 0·숫자 가림 0·잘림 0·누르는 높이 48·점 보임
//   ③ 1·2·3번 번호 · 누른 지점 거리 풍선 · 경로 선이 벡터 지도 위에 보임 ④ 0·90·180° 돌려 글자 층이 바로 섬(라이브러리 값 + 그림) — 같은 자리에서 그림 타일과 나란히
//   ⑤ 설정 한 줄(base raster)로 그림 타일 ⑥ 벡터 지도 주소를 막으면 상태 자리 한 줄 + 그림 타일로(돌아가기 켬) / 한 줄만(돌아가기 끔)
// 시험만 지도 라이브러리를 감싸(Proxy) 지도 객체를 잡는다(앱 코드는 그대로). 값은 tools/config_try_add2.json.
// 결과 표 tools/logs/try_add2_last.md, 잰 값 tools/logs/try_add2_chrome.json, 기록장 tools/logs/try_add2.log.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { loadToolsConfig, appDir, toolLog, kstText, TOOLS_DIR } from './lib_tools.mjs';
import { testbedInfo, makeSecret, writeSecretFile, startBridge, selectScene, seekScene, linesShim, strayGuard, raceLimit } from './lib_testbed.mjs';
import { findChrome, overlapArea, inside } from './lib_chrome.mjs';

const tc = loadToolsConfig();
const T = JSON.parse(fs.readFileSync(path.join(TOOLS_DIR, 'config_try_add2.json'), 'utf8'));
const APP = appDir(tc);
const log = toolLog(tc, 'try_add2');
const V = tc.view_s1;
const C = tc.chrome;
const BRIDGE_S = Number(process.argv[3]) || T.bridge_seconds;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cfgOf = (name) => JSON.parse(fs.readFileSync(path.join(APP, tc.build.config_dir, name + tc.build.config_ext), 'utf8'));
const UM = cfgOf('config_ui_map');
const STYLE = cfgOf(UM.vector.style_config).style;
const SYM = STYLE.layers.filter((l) => l.type === 'symbol').map((l) => l.id);
const BASE_IDS = STYLE.layers.map((l) => l.id);

const rows = [];
function row(no, title, expect, actual, ok) {
  rows.push({ no, title, expect, actual, ok: !!ok });
  log.write(ok ? '통과' : '실패', { no, title, expect, actual });
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

// 페이지가 열릴 때 먼저 도는 시험 손: 지도 라이브러리를 감싸 지도 객체를 window.__evMaps 에 둠 + 재는 함수 __evMeasure (try_add1 과 같은 셈)
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
        const o = { shown: shown(el), rect: R(el.getBoundingClientRect()), text: (el.textContent || '').trim().slice(0, 120), sw: el.scrollWidth, cw: el.clientWidth, id: el.id };
        if ((contents.includes(k) || k === 'marks') && o.shown) o.hits = hits(el);
        return o;
      });
    }
    const m = (window.__evMaps || [])[0];
    if (m) {
      const box = m.getContainer().getBoundingClientRect();
      const f = m.queryRenderedFeatures(undefined, { layers: [dotLayer] })[0];
      const info = { zoom: m.getZoom(), bearing: m.getBearing(), box: R(box) };
      if (f) {
        const p = m.project(f.geometry.coordinates);
        const h = document.elementFromPoint(box.left + p.x, box.top + p.y);
        info.dot = { x: box.left + p.x, y: box.top + p.y, by: h ? (h.id || String(h.className) || h.tagName) : null, canvas: !!h && h.tagName === 'CANVAS' };
      }
      const open = document.querySelector(Q.open);
      if (open) info.open = R(open.getBoundingClientRect());
      out.map = info;
    }
    return out;
  };
  // 바탕 상태: 출처 꼴·조각 받음·층 차례·그린 글자 층(라이브러리 값)
  window.__evBase = (srcId, fbId, symIds, hangul) => {
    const m = (window.__evMaps || [])[0];
    if (!m) return null;
    const st = m.getStyle();
    const types = Object.fromEntries(Object.entries(st.sources).map(([k, s]) => [k, s.type]));
    const live = symIds.filter((id) => m.getLayer(id));
    const feats = live.length ? m.queryRenderedFeatures(undefined, { layers: live }) : [];
    const per = {};
    const rx = new RegExp(hangul);
    let ko = 0; const sample = [];
    for (const f of feats) {
      const id = f.layer.id;
      per[id] = (per[id] || 0) + 1;
      const t = f.properties['name:ko'] || f.properties.name || f.properties.ref || '';
      if (rx.test(String(t))) { ko += 1; if (sample.length < 6) sample.push(String(t)); }
    }
    const align = {};
    for (const id of Object.keys(per)) align[id] = { rot: m.getLayoutProperty(id, 'text-rotation-alignment'), up: m.getLayoutProperty(id, 'text-keep-upright'), place: m.getLayoutProperty(id, 'symbol-placement') || 'point' };
    return { types, order: st.layers.map((l) => l.id), loaded: { base: !!st.sources[srcId] && m.isSourceLoaded(srcId), fb: !!st.sources[fbId] && m.isSourceLoaded(fbId) }, per, ko, sample, align, bearing: m.getBearing(), zoom: m.getZoom(), pitch: m.getPitch() };
  };
  // 손으로 돌린·옮긴 것처럼: 시작 알림(originalEvent 있음) → 옮김 → moveend (앱이 방향을 굳히고 따라가기를 끔)
  window.__evTurn = (center, zoom, bearing) => {
    const m = (window.__evMaps || [])[0];
    const ev = { originalEvent: new MouseEvent('mousedown') };
    m.fire('dragstart', ev); m.fire('rotatestart', ev); m.fire('zoomstart', ev);
    m.jumpTo({ center, zoom, bearing });
    return m.getBearing();
  };
  // 앱 기록장(폰 데이터 폴더 — 브라우저 개인 파일 저장소)에서 낱말이 든 줄
  window.__evLog = async (dir, file, words) => {
    try {
      const root = await navigator.storage.getDirectory();
      const d = await root.getDirectoryHandle(dir);
      const t = await (await (await d.getFileHandle(file)).getFile()).text();
      return t.split('\\n').filter((l) => words.some((w) => l.includes(w))).slice(-12);
    } catch (e) { return ['기록장 못 읽음 ' + e.message]; }
  };
  window.__evIdle =(ms) => new Promise((res) => { const m = (window.__evMaps || [])[0]; let done = false; const fin = (v) => { if (!done) { done = true; res(v); } }; m.once('idle', () => fin(true)); m.triggerRepaint(); setTimeout(() => fin(m.loaded()), ms); });
})();`;

async function withChrome(fn) {
  const chrome = findChrome(tc);
  if (!chrome) throw new Error('크롬이 없음');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'web2-add2-'));
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
      await cdp.send('Network.enable');
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
const baseInfo = (cdp) => evalIn(cdp, '__evBase(' + JSON.stringify(UM.tile_source_id) + ', ' + JSON.stringify(UM.vector.fallback_source_id) + ', ' + JSON.stringify(SYM) + ', ' + JSON.stringify(T.hangul_re) + ')');
const statusText = (cdp) => evalIn(cdp, '(() => { const e = document.querySelector(' + JSON.stringify(T.q.status) + '); return e ? (e.textContent || "").trim() : ""; })()');
const idle = (cdp) => evalIn(cdp, '__evIdle(' + T.idle_ms + ')');

async function openPage(cdp, url, fr, ready) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: fr.w, height: fr.h, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Storage.clearDataForOrigin', { origin: V.scheme + V.host + ':' + V.port, storageTypes: 'all' });
  await cdp.send('Page.navigate', { url });
  const t0 = Date.now();
  let ok = false;
  const cond = Object.entries(ready || T.ready).map(([k, n]) => '[...document.querySelectorAll(' + JSON.stringify(T.q[k]) + ')].filter((e) => (e.textContent || "").trim()).length >= ' + n).join(' && ');
  while (Date.now() - t0 < T.ready_ms) {
    await sleep(C.poll_ms);
    try { if (await evalIn(cdp, '(' + cond + ') && !!(window.__evMaps && window.__evMaps[0] && window.__evMaps[0].loaded())')) { ok = true; break; } } catch (e) { /* 아직 */ }
  }
  await sleep(T.settle_ms);
  let st = null;
  if (!ok) { try { st = await statusText(cdp); } catch (e) { st = null; } }
  return { ok, ms: Date.now() - t0, statusText: st };
}

async function clickQ(cdp, q) {
  return evalIn(cdp, '(() => { const e = document.querySelector(' + JSON.stringify(q) + '); if (!e) return false; e.click(); return true; })()');
}
async function tapAt(cdp, x, y) {
  for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
}
async function shot(cdp, file) {
  const pic = await cdp.send('Page.captureScreenshot', { format: 'png' });
  if (pic.result && pic.result.data) fs.writeFileSync(file, Buffer.from(pic.result.data, 'base64'));
  return fs.existsSync(file) ? fs.statSync(file).size : 0;
}

// ---------- 잰 값으로 셈(try_add1 과 같은 셈) ----------
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
// 1·2·3번: 지도 자리 안에 든 번호는 그 자리에 번호 자신이 보여야(지도·바탕에 안 가림)
function marksIn(g) {
  const o = g.map && g.map.open;
  const ms = shownOf(g, 'marks');
  const inOpen = o ? ms.filter((e) => inside({ x: e.rect.x + e.rect.w / 2, y: e.rect.y + e.rect.h / 2, w: 0, h: 0 }, o, 0)) : [];
  const hidden = inOpen.filter((e) => !(e.hits && e.hits[0] && e.hits[0].ok)).map((e) => e.text + '←' + (e.hits && e.hits[0] ? e.hits[0].by : '?'));
  return { all: ms.map((e) => e.text).join(','), inOpen: inOpen.map((e) => e.text).join(','), hidden };
}

// ---------- 다리 + 서버(세 빌드) ----------
function buildApp(out, secFile, mapCfg) {
  fs.mkdirSync(out, { recursive: true });
  const here = V.host + ':' + V.port;
  const gw = cfgOf(V.gateway_config);
  gw.gateway_url = V.scheme + here;
  gw.allowed_hosts = [here];
  const overFile = path.join(out, V.override_file);
  const over = { [V.gateway_config]: gw };
  if (mapCfg) over.config_ui_map = mapCfg;
  fs.writeFileSync(overFile, JSON.stringify(over), 'utf8');
  const r = spawnSync(process.execPath, [path.join(TOOLS_DIR, 'build.mjs'), '--out', out, '--secret', secFile, '--override', overFile, '--app', APP], { encoding: 'utf8' });
  if (r.status !== tc.exit.ok) throw new Error('빌드 실패(' + out + '): ' + (r.stderr || '').trim());
  return fs.readFileSync(path.join(out, tc.build.out_file));
}

async function withServer(fn) {
  const secret = makeSecret(tc);
  const sec = writeSecretFile(tc, secret);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'web2-add2-build-'));
  let server = null;
  let bridge = null;
  let guard = null;
  try {
    const ras = JSON.parse(JSON.stringify(UM));
    ras.base = 'raster';
    const nofb = JSON.parse(JSON.stringify(UM));
    nofb.vector.fallback = false;
    const pages = {
      [T.builds.vec]: buildApp(path.join(tmp, 'vec'), sec.file, null),
      [T.builds.ras]: buildApp(path.join(tmp, 'ras'), sec.file, ras),
      [T.builds.nofb]: buildApp(path.join(tmp, 'nofb'), sec.file, nofb),
    };
    const info = testbedInfo(tc, APP);
    const shim = linesShim(tc, info, secret);
    guard = strayGuard(tc, info, secret, log);
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
        if (guard.take(req, res)) return;
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
    if (guard && guard.count()) log.write('남은 창의 옛 비밀 값 물음 막은 수', { n: guard.count() });
    if (bridge) {
      log.write('다리 끝 기다림', { seconds: BRIDGE_S });
      const code = await raceLimit(bridge.waitExit(), BRIDGE_S * V.ms_per_s + C.exit_grace_ms, 'timeout');
      if (code === 'timeout') bridge.proc.kill();
      row('끝', '다리가 시험 모드 시간 뒤 스스로 끝남', '끝남(코드)', String(code), code !== 'timeout');
    }
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(sec.dir, { recursive: true, force: true });
  }
}

const SAVE = { frames: [], turn: [], sw: [] };
const outDir = () => { const d = path.resolve(TOOLS_DIR, T.out_dir); fs.mkdirSync(d, { recursive: true }); return d; };
const symAllUpright = (align) => Object.entries(align).filter(([, a]) => !(a.rot === 'viewport' || (a.place === 'line' && a.rot === 'map' && a.up === true))).map(([id]) => id);

// ---------- ①~③ 벡터 지도 네 창 ----------
async function partFrames(cdp, base) {
  for (const fr of T.frames) {
    const op = await openPage(cdp, base + T.builds.vec, fr);
    const rec = { name: fr.name, ready: op.ok, steps: [] };
    SAVE.frames.push(rec);
    if (!op.ok) { row('① ' + fr.name, '앱이 뜸', '준비됨', '준비 안 됨 ' + op.ms + 'ms · 상태 자리 「' + (op.statusText === null ? '없음' : op.statusText) + '」', false); continue; }
    await idle(cdp);
    const b = await baseInfo(cdp);
    const st = await statusText(cdp);
    rec.base = b;
    const nLabels = Object.values(b.per).reduce((a, n) => a + n, 0);
    const badUp = symAllUpright(b.align);
    const ok1 = b.types[UM.tile_source_id] === 'vector' && b.loaded.base && !b.types[UM.vector.fallback_source_id] && nLabels > 0 && b.ko > 0 && badUp.length === 0 && !T.status_words.fallback.every((w) => st.includes(w));
    row('① ' + fr.name, '바탕 = 벡터 지도: 출처 꼴 vector · 조각 받음 · 그림 타일로 안 돌아감 · 글자 층 그려짐 · 한글 이름 · 그려진 글자 층 모두 바로 서는 값',
      'vector · 받음 · 돌아감 없음 · 글자 > 0 · 한글 > 0 · 어긋난 층 0',
      b.types[UM.tile_source_id] + ' · ' + (b.loaded.base ? '받음' : '안 받음') + ' · ' + (b.types[UM.vector.fallback_source_id] ? '돌아감' : '돌아감 없음') + ' · 글자 ' + nLabels + ' ' + JSON.stringify(b.per) + ' · 한글 ' + b.ko + ' 예: ' + b.sample.slice(0, 4).join('/') + ' · 어긋난 층 ' + badUp.length + ' · 상태 「' + st.slice(0, 60) + '」', ok1);
    // ② 열린 칸 조합마다 겹침·가림·잘림·높이·점
    const texts = [];
    let all = true;
    let g0 = null;
    for (const s of T.steps) {
      let clicked = true;
      for (const d of s.do) { clicked = (await clickQ(cdp, d.click)) && clicked; await sleep(T.act_ms); }
      if (s.do.length) await sleep(T.panel_ms - T.act_ms);
      const g = await measure(cdp);
      if (!g0) g0 = g;
      rec.steps.push({ name: s.name, clicked, g });
      const ov = overlapsIn(g);
      const cov = coveredIn(g);
      const clip = clipIn(g);
      const low = lowIn(g);
      const dotOk = !!(g.map && g.map.dot && g.map.dot.canvas);
      const ok = clicked && !ov.bad.length && !cov.length && !clip.length && !low.length && dotOk;
      all = all && ok;
      texts.push(s.name + ': ' + (ok ? '겹침 0 · 가림 0 · 잘림 0 · 낮은 것 0 · 점 보임' : [clicked ? '' : '누를 것 없음', ov.bad.slice(0, 4).join(', '), cov.slice(0, 3).join(', '), clip.join(', '), low.slice(0, 3).join(', '), dotOk ? '' : '점 가림(' + (g.map && g.map.dot ? g.map.dot.by : '없음') + ')'].filter(Boolean).join(' / ')) + ' (상자 ' + ov.n + ')');
    }
    row('② ' + fr.name, '벡터 지도 위 열린 칸 조합 ' + T.steps.length + '가지마다: 판·칸·단추끼리 겹침 0 · 판 숫자·저작권 가림 0 · 숫자 잘림 0 · 누르는 높이 48 · 내 위치 점 보임', '모든 조합 통과', texts.join(' ┃ '), all);
    // ③-번호
    const mk = marksIn(g0);
    row('③-번호 ' + fr.name, '1·2·3번 번호가 벡터 지도 위에 보임(지도 자리 안에 든 번호는 그 자리에 번호 자신이 보임)', '지도 자리 안 번호 1개 이상 · 가린 것 0',
      '번호 ' + (mk.all || '없음') + ' · 지도 자리 안 ' + (mk.inOpen || '없음') + ' · 가림 ' + (mk.hidden.join(',') || '0'), mk.inOpen.length > 0 && mk.hidden.length === 0);
    // ③-풍선
    const o = g0.map.open;
    const x = o.x + o.w * T.tap_at.fx;
    const y = o.y + o.h * T.tap_at.fy;
    await tapAt(cdp, x, y);
    await sleep(T.tap_ms);
    const g2 = await measure(cdp);
    const tap = shownOf(g2, 'tap')[0];
    const tov = overlapsIn(g2).bad.filter((s) => s.includes('tap'));
    const hit = tap ? await evalIn(cdp, '(() => { const e = document.querySelector(' + JSON.stringify(T.q.tap) + '); const r = e.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!h && (h === e || e.contains(h)); })()') : false;
    row('③-풍선 ' + fr.name, '누른 지점 거리 풍선이 벡터 지도 위에 보임(' + T.tap_at.name + ')', '풍선 보임 · 겹침 0',
      tap ? '풍선 ' + [tap.rect.x, tap.rect.y, tap.rect.w, tap.rect.h].map(Math.round).join(',') + ' 「' + tap.text.slice(0, 30) + '」' + (hit ? ' 보임' : ' 가려짐') + ' · 겹침 ' + (tov.join(',') || '0') : '풍선 안 뜸', !!tap && hit && !tov.length);
    await tapAt(cdp, x, y);
    await sleep(T.act_ms);
    // ③-경로 선: 지도 자리 가운데를 지나는 선을 경로 층에 넣고 그 자리에 그려졌나 + 층 차례(바탕 층 모두 위)
    const r = await evalIn(cdp, `(() => {
      const m = window.__evMaps[0]; const box = m.getContainer().getBoundingClientRect();
      const px = ${x} - box.left; const py = ${y} - box.top; const c = m.unproject([px, py]);
      const src = m.getSource(${JSON.stringify(UM.route.source_id)});
      src.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[c.lng, c.lat - ${T.route_half_deg}], [c.lng, c.lat + ${T.route_half_deg}]] } });
      return new Promise((res) => setTimeout(() => {
        const n = m.queryRenderedFeatures([px, py], { layers: [${JSON.stringify(UM.route.layer_id)}] }).length;
        const order = m.getStyle().layers.map((l) => l.id);
        src.setData({ type: 'FeatureCollection', features: [] });
        res({ n, order });
      }, ${T.act_ms}));
    })()`);
    const ri = r.order.indexOf(UM.route.layer_id);
    const above = BASE_IDS.filter((id) => r.order.indexOf(id) > ri);
    row('③-경로 ' + fr.name, '경로 선이 벡터 지도 위에 그려짐(시험이 경로 층에 선을 넣음 — 앱 길찾기 대신) · 경로 층이 바탕 층 모두보다 위', '그 자리에 경로 선 · 경로 위 바탕 층 0',
      '그 자리 경로 선 ' + r.n + ' · 경로 층 차례 ' + ri + '/' + r.order.length + ' · 경로 위 바탕 층 ' + (above.join(',') || '0'), r.n > 0 && above.length === 0);
  }
}

// ---------- ④ 돌려 보기 + 전·후 그림 ----------
async function partTurn(cdp, base) {
  const dir = outDir();
  const made = [];
  for (const fr of T.turn_frames) {
    for (const kind of ['ras', 'vec']) {
      const op = await openPage(cdp, base + T.builds[kind], fr);
      if (!op.ok) { row('④ ' + kind + ' ' + fr.name, '앱이 뜸', '준비됨', '준비 안 됨 · 「' + op.statusText + '」', false); continue; }
      const texts = [];
      let all = true;
      for (const bg of T.bearings) {
        // 돌린 뒤 방향이 어긋나 있으면(첫 번째에 한 번 본 일 — 까닭은 보고에) 다시 돌린다 — 다시 돈 횟수와 돌린 직후 값을 결과에 적는다
        let b = null;
        const tries = [];
        for (let k = 0; k < T.turn_tries; k += 1) {
          const now = await evalIn(cdp, '__evTurn(' + JSON.stringify(T.spot.center) + ', ' + T.spot.zoom + ', ' + bg + ')');
          await idle(cdp);
          await sleep(T.act_ms);
          b = await baseInfo(cdp);
          tries.push('돌린 직후 ' + Number(now).toFixed(1) + ' → 기다린 뒤 ' + b.bearing.toFixed(1));
          if (Math.abs(((b.bearing - bg + 540) % 360) - 180) <= T.bearing_tol) break;
          log.write('돌린 방향 어긋남', { kind, frame: fr.name, want: bg, now, after: b.bearing });
        }
        const file = path.join(dir, kind + '_' + fr.file + '_' + bg + '.png');
        const size = await shot(cdp, file);
        SAVE.turn.push({ kind, frame: fr.name, bearing: bg, base: b, file, size });
        const n = Object.values(b.per).reduce((a, x) => a + x, 0);
        const bad = symAllUpright(b.align);
        const turned = Math.abs(((b.bearing - bg + 540) % 360) - 180) <= T.bearing_tol;
        const ok = kind === 'vec' ? turned && !b.types[UM.vector.fallback_source_id] && n > 0 && b.ko > 0 && bad.length === 0 && size > T.min_png_bytes : turned && b.types[UM.tile_source_id] === 'raster' && size > T.min_png_bytes;
        all = all && ok;
        texts.push(bg + '°: 방향 ' + b.bearing.toFixed(1) + (tries.length > 1 ? ' (다시 돌림 ' + (tries.length - 1) + ' — ' + tries.join(' / ') + ')' : '') + (kind === 'vec' ? (b.types[UM.vector.fallback_source_id] ? ' · 그림 타일로 돌아가 있음' : ' · 벡터 그대로') + ' · 글자 ' + n + ' · 한글 ' + b.ko + ' · 어긋난 층 ' + bad.length + ' · 값 ' + Object.entries(b.align).map(([id, a]) => id.replace('v-', '') + '=' + a.place + '/' + a.rot + (a.place === 'line' ? '/upright ' + a.up : '')).join(' ') : ' · 바탕 ' + b.types[UM.tile_source_id]) + ' · 그림 ' + size + 'B');
      }
      if (kind === 'vec') { const lines = await evalIn(cdp, '__evLog(' + JSON.stringify(T.log.dir) + ', ' + JSON.stringify(T.log.file) + ', ' + JSON.stringify(T.log.words) + ')'); texts.push('기록장 지도 줄: ' + lines.join(' ⏎ ')); SAVE.turn.push({ kind, frame: fr.name, log: lines }); }
      row('④ ' + (kind === 'vec' ? '벡터' : '그림 타일') + ' ' + fr.name, (kind === 'vec' ? '벡터 지도를 ' : '그림 타일(비교용)을 ') + T.bearings.join('·') + '° 로 돌려(' + T.spot.name + ' · 확대 ' + T.spot.zoom + ') ' + (kind === 'vec' ? '그려진 글자 층이 모두 바로 서는 값(점 글자 viewport · 길 이름 map + keep-upright) · 한글 이름 · 그림' : '그림'),
        '세 방향 모두', texts.join(' ┃ '), all);
    }
    // 나란히(전 = 그림 타일 · 후 = 벡터 지도 — 같은 자리·같은 확대·같은 방향)
    for (const bg of T.bearings) {
      const a = 'ras_' + fr.file + '_' + bg + '.png';
      const b = 'vec_' + fr.file + '_' + bg + '.png';
      if (!fs.existsSync(path.join(dir, a)) || !fs.existsSync(path.join(dir, b))) continue;
      const html = path.join(dir, 'both_' + fr.file + '_' + bg + '.html');
      const png = path.join(dir, 'both_' + fr.file + '_' + bg + '.png');
      fs.writeFileSync(html, '<!doctype html><meta charset="utf-8"><body style="margin:0;background:#fff;font:14px sans-serif"><div style="display:flex;gap:8px;padding:8px">'
        + '<figure style="margin:0"><figcaption>' + T.ras_caption + ' · ' + bg + '° · ' + fr.name + '</figcaption><img src="' + a + '"></figure>'
        + '<figure style="margin:0"><figcaption>' + T.vec_caption + ' · ' + bg + '° · ' + fr.name + '</figcaption><img src="' + b + '"></figure></div></body>', 'utf8');
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: fr.w * 2 + T.both_pad, height: fr.h + T.both_pad * 2, deviceScaleFactor: 1, mobile: false });
      await cdp.send('Page.navigate', { url: pathToFileURL(html).href });
      await sleep(T.boot_ms);
      made.push({ png, size: await shot(cdp, png) });
    }
  }
  row('④-그림', '전·후 나란히 그림(같은 자리·같은 확대·같은 방향 — 그림 타일 vs 벡터 지도)', T.turn_frames.length * T.bearings.length + '장',
    made.map((m) => m.png + ' ' + m.size + 'B').join(' · '), made.length === T.turn_frames.length * T.bearings.length && made.every((m) => m.size > T.min_png_bytes));
}

// ---------- ⑤ 설정 한 줄로 그림 타일 · ⑥ 못 받을 때 ----------
async function partSwitch(cdp, base) {
  const fr = T.frames[0];
  const dir = outDir();
  // ⑤ base raster
  const op = await openPage(cdp, base + T.builds.ras, fr);
  if (op.ok) {
    await idle(cdp);
    const b = await baseInfo(cdp);
    const st = await statusText(cdp);
    const attrib = await evalIn(cdp, '(() => { const e = document.querySelector(' + JSON.stringify(T.q.attrib_text) + '); return e ? e.textContent.trim() : ""; })()');
    SAVE.sw.push({ case: 'ras', base: b, status: st, attrib });
    row('⑤', '설정 한 줄(config_ui_map.base = raster)로 그림 타일: 출처 꼴 raster · 조각 받음 · 벡터 출처 없음 · 상태 자리 끊김 줄 없음 · 저작권 보임', 'raster · 받음 · 끊김 줄 없음',
      JSON.stringify(b.types) + ' · ' + (b.loaded.base ? '받음' : '안 받음') + ' · 상태 「' + st.slice(0, 60) + '」 · 저작권 「' + attrib + '」', b.types[UM.tile_source_id] === 'raster' && b.loaded.base && Object.values(b.types).every((t) => t !== 'vector') && !st.includes('끊김') && attrib.length > 0);
  } else row('⑤', '앱이 뜸(그림 타일)', '준비됨', '준비 안 됨 「' + op.statusText + '」', false);
  // 벡터 지도 저작권(돌아가지 않은 벡터 지도)
  const op2 = await openPage(cdp, base + T.builds.vec, fr);
  if (op2.ok) {
    const attrib = await evalIn(cdp, '(() => { const e = document.querySelector(' + JSON.stringify(T.q.attrib_text) + '); return e ? e.textContent.trim() : ""; })()');
    const vis = await evalIn(cdp, '(() => { const e = document.querySelector(' + JSON.stringify(T.q.attrib_text) + '); if (!e) return false; const r = e.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!h && (h === e || e.contains(h)); })()');
    SAVE.sw.push({ case: 'vec_attrib', attrib, vis });
    row('⑤-저작권', '벡터 지도 저작권 표시가 출처에 맞게 늘 보임(추가1 자리 그대로)', 'OpenFreeMap · OpenMapTiles · OpenStreetMap 이 보임', '「' + attrib + '」 · ' + (vis ? '보임' : '가려짐'), vis && /OpenFreeMap/.test(attrib) && /OpenMapTiles/.test(attrib) && /OpenStreetMap/.test(attrib));
  }
  // ⑥ 벡터 지도 주소 막음
  await cdp.send('Network.setBlockedURLs', { urls: T.block_urls });
  try {
    for (const [kind, words, wantFb] of [['vec', T.status_words.fallback, true], ['nofb', T.status_words.down, false]]) {
      const o = await openPage(cdp, base + T.builds[kind], fr, T.ready_blocked);
      const t0 = Date.now();
      let st = '';
      while (Date.now() - t0 < T.block_wait_ms) {
        st = await statusText(cdp);
        if (words.every((w) => st.includes(w))) break;
        await sleep(C.poll_ms);
      }
      await sleep(T.act_ms * 2);
      if (wantFb) await idle(cdp);
      const b = await baseInfo(cdp);
      // 상태 자리는 한 칸에 줄바꿈으로 줄을 잇는다(ui_status)
      const lines = await evalIn(cdp, '(() => { const e = document.querySelector(' + JSON.stringify(T.q.status) + '); return e ? (e.textContent || "").split(String.fromCharCode(10)).map((l) => l.trim()).filter(Boolean) : []; })()');
      const hit = lines.filter((l) => words.every((w) => l.includes(w)));
      const size = await shot(cdp, path.join(dir, 'blocked_' + kind + '.png'));
      SAVE.sw.push({ case: 'blocked_' + kind, ready: o.ok, status: st, lines, base: b });
      const fbOk = wantFb ? b.types[UM.vector.fallback_source_id] === 'raster' && b.loaded.fb && b.order.indexOf(UM.style.layers[0].id) < b.order.indexOf(UM.route.layer_id) : !b.types[UM.vector.fallback_source_id];
      row('⑥ ' + (wantFb ? '돌아가기 켬' : '돌아가기 끔'), '벡터 지도 주소를 막음(크롬 — 오프라인·막힘 흉내) → 상태 자리에 그 한 줄(' + words.join(' + ') + ')' + (wantFb ? ' + 그림 타일을 깔고 받음(경로 선 아래)' : ' · 그림 타일로 안 돌아감'),
        '한 줄 · ' + (wantFb ? '그림 타일 받음' : '돌아감 없음'), '앱 ' + (o.ok ? '뜸' : '안 뜸') + ' · 맞는 줄 ' + hit.length + ' 「' + (hit[0] || st).slice(0, 80) + '」 · 출처 ' + JSON.stringify(b.types) + ' · 그림 받음 ' + b.loaded.fb + ' · 그림 ' + size + 'B',
        o.ok && hit.length === 1 && fbOk);
    }
  } finally { await cdp.send('Network.setBlockedURLs', { urls: [] }); }
}

function printTable() {
  const lines = ['| # | 시험 | 기대 | 실제 | 결과 |', '|---|---|---|---|---|'];
  for (const r of rows) lines.push('| ' + [r.no, r.title, r.expect, r.actual, r.ok ? tc.pass_word : tc.fail_word].map((s) => String(s).replace(/\|/g, '/').replace(/\n/g, ' ⏎ ')).join(' | ') + ' |');
  const ok = rows.length > 0 && rows.every((r) => r.ok);
  lines.push('', '추가2 시험: ' + (ok ? tc.pass_word : tc.fail_word) + ' (' + rows.filter((r) => r.ok).length + ' / ' + rows.length + ') — ' + kstText(tc));
  const text = lines.join('\n');
  console.log(text);
  const dir = path.join(APP, tc.log.dir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, T.report_file), text + '\n', 'utf8');
  fs.writeFileSync(path.join(dir, T.save_file), JSON.stringify(SAVE, null, 1), 'utf8');
  return ok;
}

const only = process.argv[2];
try {
  log.write('시작', { only: only || '전부' });
  await withServer(async (base) => withChrome(async (cdp) => {
    if (!only || only === 'frames') await partFrames(cdp, base);
    if (!only || only === 'turn') await partTurn(cdp, base);
    if (!only || only === 'switch') await partSwitch(cdp, base);
  }));
} catch (e) {
  log.write('예외', { error: String(e && e.stack || e) });
  console.error(e);
  rows.push({ no: '예외', title: String(e && e.message), expect: '-', actual: '-', ok: false });
}
const ok = printTable();
log.write('끝', { result: ok ? tc.pass_word : tc.fail_word });
process.exitCode = ok ? tc.exit.ok : tc.exit.fail;
