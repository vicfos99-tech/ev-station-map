// 테스트 베드 다리를 시험 모드로 띄우고 부르는 도구(try_a1·view_s1 이 함께 쓴다). 테스트 베드 파일은 읽기만.
// 다리 주소는 앱 설정(config_gateway.json) 한 곳에서, 길·머리 이름·비밀 값 환경변수 이름은 테스트 베드 설정에서 읽는다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

export function testbedInfo(tc, app) {
  const t = tc.testbed;
  const dir = path.resolve(app, t.dir);
  const cfgPath = path.join(dir, t.config);
  const tb = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const gw = JSON.parse(fs.readFileSync(path.join(app, tc.build.config_dir, 'config_gateway' + tc.build.config_ext), 'utf8'));
  return { t, dir, cfgPath, tb, b: tb.bridge, base: gw.gateway_url, bridgeScript: path.resolve(path.dirname(cfgPath), tb.bridge.script) };
}

export function makeSecret(tc) {
  return crypto.randomBytes(tc.testbed.secret_bytes).toString('base64url');
}

// 저장소 밖(운영체제 임시 폴더)에 이번만 쓰는 앱 비밀 값 파일
export function writeSecretFile(tc, secret) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'web2-secret-'));
  const p = path.join(dir, tc.testbed.secret_file_name);
  fs.writeFileSync(p, JSON.stringify({ app_secret: secret }), 'utf8');
  return { dir, file: p };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function call(info, method, route, opt) {
  const o = opt || {};
  const headers = {};
  if (o.secret) headers[info.b.secret_header] = o.secret;
  if (o.body !== undefined) headers['Content-Type'] = 'application/json';
  const resp = await fetch(info.base + info.b.paths[route] + (o.sub || ''), { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  const text = await resp.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { json = null; }
  return { status: resp.status, json };
}

export async function alive(info, secret) {
  try { return (await call(info, 'GET', 'health', { secret })).status > 0; } catch (e) { return false; }
}

// 다리를 seconds 초만 띄운다. 돌려받은 waitExit() 로 스스로 끝나기를 기다린다
export async function startBridge(tc, info, seconds, secret, scale) {
  if (await alive(info, secret)) throw new Error('이미 다른 다리가 ' + info.base + ' 에서 돌고 있음 — 그것이 끝난 뒤 다시');
  const env = { ...process.env, [info.b.secret_env]: secret };
  const argsList = [...tc.testbed.python_args, info.bridgeScript, info.cfgPath, String(seconds)];
  if (scale) argsList.push(String(scale));
  const proc = spawn(tc.testbed.python, argsList, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  proc.stdout.on('data', (d) => { out += d; });
  proc.stderr.on('data', (d) => { out += d; });
  const exited = new Promise((resolve) => proc.on('exit', (code) => resolve(code)));
  const until = Date.now() + tc.testbed.health_wait_ms;
  while (Date.now() < until) {
    if (proc.exitCode !== null) throw new Error('다리가 바로 끝남: ' + out.trim().slice(-400));
    if (await alive(info, secret)) return { proc, output: () => out, waitExit: () => exited };
    await sleep(tc.testbed.poll_ms);
  }
  proc.kill();
  throw new Error('다리가 ' + tc.testbed.health_wait_ms + 'ms 안에 답하지 않음: ' + out.trim().slice(-400));
}

export async function selectScene(info, name, paused) {
  const r = await call(info, 'POST', 'scene', { body: { action: 'select', name, paused: !!paused } });
  if (r.status !== 200 || !r.json || !r.json.ok) throw new Error('장면 고르기 실패: ' + name + ' ' + r.status + ' ' + JSON.stringify(r.json));
  return r.json.status;
}

// 시험 흐름을 따로 열어 (틱 → 자리)를 모은다 — 앱과 견줄 참값
export function referenceStream(info) {
  const ctrl = new AbortController();
  const ticks = new Map();
  const done = (async () => {
    try {
      const resp = await fetch(info.base + info.b.paths.stream, { signal: ctrl.signal });
      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let ev = '';
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).replace(/\r$/, '');
          buf = buf.slice(i + 1);
          if (line.startsWith('event:')) ev = line.slice(6).trim();
          else if (line.startsWith('data:') && ev === info.b.stream_events.tick) {
            const d = JSON.parse(line.slice(5));
            if (d.pos) ticks.set(d.tick, { lat: d.pos.lat, lng: d.pos.lng, speed_kmh: d.pos.speed_kmh, at: Date.now() });
          }
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') throw e;
    }
  })();
  return { ticks, stop: () => { ctrl.abort(); return done.catch(() => {}); } };
}
