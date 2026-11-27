// 진짜 크롬(창 없이 — headless)으로 빌드한 앱의 **실제 자리**를 재는 도구(try_fix7·try_a3 가 함께 쓴다).
// 가상 창(lib_apprun)에는 그림이 없어 '덮임'을 잴 수 없다 — 여기서는 크롬이 실제로 그린 상자(getBoundingClientRect)와
// 그 자리에 실제로 무엇이 보이는지(elementFromPoint)를 잰다.
//   ① 앱을 임시 폴더에 빌드(다리 주소만 이 서버로 — view_s1 과 같은 길) ② 테스트 베드 다리(시험 모드)·장면 ③ 작은 웹 서버:
//      '/' = 앱, measure_path = 재는 쪽(정한 크기의 iframe 에 앱을 차례로 띄우고 잼), result_path = 잰 결과를 받음, '/v1/…' = 선 파일 대신 답 + 다리로 넘김
//   ④ 크롬을 창 없이 띄워 measure_path 를 열고, 결과가 오면(또는 시간 한도) 크롬·서버를 닫고 다리가 스스로 끝나기를 기다린다.
// 값(크롬 경로·인자·창 크기·고를 것·기다림)은 config_tools.json 의 chrome 에. 테스트 베드 파일은 읽기만.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { TOOLS_DIR } from './lib_tools.mjs';
import { testbedInfo, makeSecret, writeSecretFile, startBridge, selectScene, seekScene, linesShim, strayGuard, raceLimit } from './lib_testbed.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function findChrome(tc) {
  for (const p of tc.chrome.paths) if (fs.existsSync(p)) return p;
  return null;
}

// 크롬 안에서 도는 재는 쪽(글로 만들어 낸다). P = {frames, sel, ready, wait_ms, poll_ms, settle_ms, hit_inset_px, result_path, actions}
function measurePage(P) {
  const js = `
const P = ${JSON.stringify(P)};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function rectOf(el) { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }
function shown(el, win) { if (!el) return false; const cs = win.getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; }
function hits(doc, el) {
  const r = el.getBoundingClientRect(); const k = P.hit_inset_px;
  const pts = [[r.left + r.width / 2, r.top + r.height / 2], [r.left + k, r.top + k], [r.right - k, r.top + k], [r.left + k, r.bottom - k], [r.right - k, r.bottom - k]];
  return pts.map(([x, y]) => { const h = doc.elementFromPoint(x, y); return { x: Math.round(x), y: Math.round(y), ok: !!h && (h === el || el.contains(h)), by: h ? (h.id || h.className || h.tagName) : null }; });
}
function grab(doc, win) {
  const out = {};
  for (const [name, s] of Object.entries(P.sel)) {
    const els = [...doc.querySelectorAll(s.q)];
    out[name] = els.map((el) => {
      const cs = win.getComputedStyle(el);
      const o = { shown: shown(el, win), rect: rectOf(el), text: (el.textContent || '').trim().slice(0, 80), sw: el.scrollWidth, cw: el.clientWidth, attrs: {} };
      for (const a of s.attrs || []) o.attrs[a] = el.getAttribute(a);
      if (s.styles) { o.style = {}; for (const p of s.styles) o.style[p] = cs.getPropertyValue(p); }
      if (s.hit && o.shown) o.hits = hits(doc, el);
      return o;
    });
  }
  return out;
}
function ready(doc) {
  for (const [name, need] of Object.entries(P.ready)) {
    const els = [...doc.querySelectorAll(P.sel[name].q)];
    if (els.length < need.min) return false;
    if (need.text && !els.every((e) => (e.textContent || '').trim().length > 0)) return false;
  }
  return true;
}
async function one(fr) {
  const f = document.createElement('iframe');
  f.style.cssText = 'display:block;border:0;width:' + fr.w + 'px;height:' + fr.h + 'px';
  f.src = '/?frame=' + encodeURIComponent(fr.name) + (P.hash || '');
  document.body.appendChild(f);
  const t0 = Date.now();
  let ok = false;
  while (Date.now() - t0 < P.wait_ms) {
    await sleep(P.poll_ms);
    try { if (f.contentDocument && ready(f.contentDocument)) { ok = true; break; } } catch (e) {}
  }
  await sleep(P.settle_ms);
  const res = { name: fr.name, w: fr.w, h: fr.h, ready: ok, wait_ms: Date.now() - t0, inner: null, steps: [] };
  // (정비 나 0-②) 준비 안 됨이면 그때 상태 자리 글을 같이 남긴다(까닭이 화면에 적혀 있는 일이 많다)
  if (!ok) { try { const st = f.contentDocument && f.contentDocument.querySelector(P.status_q); res.status_text = st ? (st.textContent || '').trim().slice(0, 120) : null; } catch (e) { res.status_text = null; } }
  try {
    const d = f.contentDocument; const w = f.contentWindow;
    res.inner = { w: w.innerWidth, h: w.innerHeight, portrait: w.matchMedia('(orientation: portrait)').matches };
    res.got = grab(d, w);
    for (const act of P.actions || []) {
      const el = d.querySelector(act.q);
      // (A6) value 가 있으면 글을 넣고 input 알림(검색 칸), 없으면 누름
      if (el && act.value !== undefined) { el.value = act.value; el.dispatchEvent(new Event('input', { bubbles: true })); } else if (el) el.click();
      await sleep(act.wait_ms);
      res.steps.push({ name: act.name, clicked: !!el, got: grab(d, w) });
    }
  } catch (e) { res.error = String(e && e.message); }
  f.remove();
  return res;
}
(async () => {
  const all = [];
  for (const fr of P.frames) all.push(await one(fr));
  await fetch(P.result_path, { method: 'POST', body: JSON.stringify({ frames: all, ua: navigator.userAgent }) });
})().catch((e) => fetch(P.result_path, { method: 'POST', body: JSON.stringify({ error: String(e && e.stack || e) }) }));
`;
  return '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">\n<script>' + js + '</script></body></html>';
}

// opts = {scene, tick, frames, sel, ready, actions, log, hash?, overrides?, build_app?} → {frames:[…], ua} | {error}
export async function measureInChrome(tc, app, opts) {
  const C = tc.chrome;
  const V = tc.view_s1;
  const log = opts.log;
  const chrome = findChrome(tc);
  if (!chrome) throw new Error('크롬이 없음: ' + C.paths.join(' · '));
  const secret = makeSecret(tc);
  const sec = writeSecretFile(tc, secret);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'web2-chrome-'));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'web2-chrome-profile-'));
  let proc = null;
  let server = null;
  let bridge = null;
  try {
    const here = V.host + ':' + V.port;
    const gw = JSON.parse(fs.readFileSync(path.join(app, tc.build.config_dir, V.gateway_config + tc.build.config_ext), 'utf8'));
    gw.gateway_url = V.scheme + here;
    gw.allowed_hosts = [here];
    const overFile = path.join(out, V.override_file);
    fs.writeFileSync(overFile, JSON.stringify({ [V.gateway_config]: gw, ...(opts.overrides || {}) }), 'utf8');
    // opts.build_app = 다른 폴더의 앱 사본을 지어 잰다(시험이 옛 화면에서 실패하는지 볼 때)
    const r = spawnSync(process.execPath, [path.join(TOOLS_DIR, 'build.mjs'), '--out', out, '--secret', sec.file, '--override', overFile, ...(opts.build_app ? ['--app', opts.build_app] : [])], { encoding: 'utf8' });
    if (r.status !== tc.exit.ok) throw new Error('빌드 실패: ' + (r.stderr || '').trim());
    const page = fs.readFileSync(path.join(out, tc.build.out_file));
    const info = testbedInfo(tc, app);
    const shim = linesShim(tc, info, secret);
    const guard = strayGuard(tc, info, secret, log);
    bridge = await startBridge(tc, info, C.bridge_seconds, secret);
    await selectScene(info, opts.scene, false);
    if (opts.tick) await seekScene(info, opts.tick);
    // (추가3 앞) opts.hash = 앱 주소 꼬리(예: 제목 '#topic=toilet' — 그 제목으로 켜서 잼)
    const P = { hash: opts.hash || '', frames: opts.frames, sel: opts.sel, ready: opts.ready, actions: opts.actions || [], wait_ms: C.ready_wait_ms, poll_ms: C.poll_ms, settle_ms: C.settle_ms, hit_inset_px: C.hit_inset_px, result_path: C.result_path, status_q: C.status_q };
    const measureHtml = measurePage(P);
    let resolveResult;
    const result = new Promise((res) => { resolveResult = res; });
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
      if (req.method === 'POST' && req.url === C.result_path) {
        let body = '';
        req.on('data', (d) => { body += d; });
        req.on('end', () => { res.writeHead(200); res.end(); try { resolveResult(JSON.parse(body)); } catch (e) { resolveResult({ error: 'parse ' + e.message }); } });
        return;
      }
      const u = req.url.split('?')[0];
      if (req.method === 'GET' && u === C.measure_path) { res.writeHead(200, { 'Content-Type': V.content_type, 'Cache-Control': 'no-store' }); res.end(measureHtml); return; }
      if (req.method === 'GET' && (u === '/' || u === '/' + tc.build.out_file)) { res.writeHead(200, { 'Content-Type': V.content_type, 'Cache-Control': 'no-store' }); res.end(page); return; }
      res.writeHead(404);
      res.end();
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(V.port, V.host, resolve); });
    const url = V.scheme + here + C.measure_path;
    proc = spawn(chrome, [...C.args, C.profile_arg + profile, url], { stdio: 'ignore' });
    if (log) log.write('크롬 띄움', { url, frames: opts.frames.map((f) => f.name) });
    const got = await raceLimit(result, C.total_wait_ms, { error: '시간 한도 ' + C.total_wait_ms + 'ms 안에 결과가 안 옴' });
    if (log) log.write('크롬 결과', { error: got.error || null, frames: (got.frames || []).map((f) => ({ name: f.name, ready: f.ready, wait_ms: f.wait_ms, status_text: f.status_text })) });
    return got;
  } finally {
    if (proc && proc.exitCode === null) spawnSync(C.kill_cmd, [...C.kill_args_before_pid, String(proc.pid), ...C.kill_args_after_pid], { encoding: 'utf8' });
    if (server) { server.closeAllConnections(); server.close(); }
    if (bridge) {
      const code = await raceLimit(bridge.waitExit(), C.bridge_seconds * V.ms_per_s + C.exit_grace_ms, 'timeout');
      if (code === 'timeout') bridge.proc.kill();
      if (log) log.write('다리 끝', { code });
    }
    await sleep(C.poll_ms);
    fs.rmSync(out, { recursive: true, force: true });
    fs.rmSync(sec.dir, { recursive: true, force: true });
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { if (log) log.write('크롬 임시 폴더 못 지움', { error: e.message }); }
  }
}

// ---------- 잰 결과로 셈하기 ----------
export function overlapArea(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}
export function inside(inner, outer, tol) {
  return inner.x >= outer.x - tol && inner.y >= outer.y - tol && inner.x + inner.w <= outer.x + outer.w + tol && inner.y + inner.h <= outer.y + outer.h + tol;
}
