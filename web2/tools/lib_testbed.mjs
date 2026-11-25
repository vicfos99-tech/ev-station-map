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
  return { t, dir, cfgPath, tb, b: tb.bridge, base: gw.gateway_url, bridgeScript: path.resolve(path.dirname(cfgPath), tb.bridge.script), app };
}

// 지금 고른 장면(selectScene 이 적음) — 제한 속도 파일 대신 답(limitShim)이 장면마다 다르게 만든다
let CURRENT_SCENE = null;
export const currentScene = () => CURRENT_SCENE;
// 시험이 켜는 끊김: true 면 제한 속도 파일 물음에 다리처럼 '자료 길 실패'(upstream) 로 답한다(S7 의 다리 끊김은 다리 쪽 파일에만 걸리므로)
export const limitShimCtl = { down: false, asked: 0 };

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
  CURRENT_SCENE = name;
  return r.json.status;
}

// 장면을 틱으로 옮긴다(장면 시간표의 사건은 틱으로 셈하므로 옮긴 틱부터 그대로 일어난다)
export async function seekScene(info, tick) {
  const r = await call(info, 'POST', 'scene', { body: { action: 'seek', tick } });
  if (r.status !== 200 || !r.json || !r.json.ok) throw new Error('장면 옮기기 실패: ' + tick + ' ' + r.status + ' ' + JSON.stringify(r.json));
  return r.json.status;
}

// R0 전 — 시험 다리가 고속도로 선 파일을 내주지 않는다. 다리 자료 길의 선 파일 이름(testbed.lines_shim)만 테스트 베드 선 파일로 대신 답한다.
// 돌려주는 것: {files: {파일 이름: 글}, answer(sub, headers) → {status, body} | null(대신 답하지 않음)}
export function linesShim(tc, info, secret) {
  const dir = path.resolve(path.dirname(info.cfgPath), info.tb.scenes.lines_dir);
  const files = {};
  for (const [name, line] of Object.entries(tc.testbed.lines_shim)) {
    files[name] = fs.readFileSync(path.join(dir, line + info.tb.scenes.line_suffix), 'utf8');
  }
  const S = tc.testbed.limit_shim;
  return {
    files,
    answer(sub, headers) {
      // (A5) 제한 속도 파일 — 지금 장면으로 만든 것. 없는 칸·표는 다리처럼 none, 시험이 끊김을 켜면 upstream
      const lim = CURRENT_SCENE ? limitFiles(tc, info, CURRENT_SCENE) : null;
      const isLimit = lim && lim.isLimitName(sub);
      if (!(sub in files) && !isLimit) return null;
      const got = headers ? headers[info.b.secret_header] || headers[info.b.secret_header.toLowerCase()] : undefined;
      if (got !== secret) return { status: tc.testbed.lock_status, body: JSON.stringify(tc.testbed.lock_body) };
      if (isLimit) {
        limitShimCtl.asked += 1;
        if (limitShimCtl.down) return { status: S.down_status, body: JSON.stringify(S.down_body) };
        if (!(sub in lim.files)) return { status: S.none_status, body: JSON.stringify(S.none_body) };
        return { status: 200, body: lim.files[sub] };
      }
      return { status: 200, body: files[sub] };
    },
  };
}

// ---------- 제한 속도 파일 대신 답(A5 — 중계 R5 전이라 다리가 제한 속도 파일을 내주지 않는다) ----------
// 지금 장면의 limits(시험용 값)로 중계가 낼 꼴(web2/README.md '제한 속도 자료')을 만든다:
//   선 조각의 구간 → 고속도로 표 sections(조각이 선 방향이면 fwd, 거꾸로면 back) · 좌표 조각의 구간 → 짧은 도로 조각(piece_m)으로 잘라
//   양 끝 점의 칸 파일에 넣음(칸 셈은 앱 설정 config_limitmatch.cell 의 크기·이음표를 시험이 따로 셈) · 값이 null(자료 없음)인 구간은 싣지 않음.
// 파일 이름·판 번호는 앱 설정(config_relay_limit·config_relay_parse)의 것 — 앱 코드는 쓰지 않는다.
// 두 점 사이 거리(m) — 앱의 geo 와 따로 셈(값은 도구 설정 S)
function distM(a, b, S) {
  const k = S.deg_to_rad;
  const p1 = a[0] * k; const p2 = b[0] * k; const dl = (b[1] - a[1]) * k;
  const c = Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(dl);
  return S.earth_radius_m * Math.acos(Math.min(1, Math.max(-1, c)));
}
// 좌표 줄의 from~to km 부분(사이 점은 곧게 나눔)
function cutKm(points, fromKm, toKm, S) {
  const M = S.m_per_km;
  const out = [];
  let along = 0;
  const at = (a, b, segM, km) => { const t = segM ? (km * M - along) / segM : 0; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; };
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i]; const b = points[i + 1]; const segM = distM(a, b, S);
    const s0 = along / M; const s1 = (along + segM) / M;
    if (s1 >= fromKm && s0 <= toKm) {
      if (!out.length) out.push(s0 >= fromKm ? a : at(a, b, segM, fromKm));
      if (s1 <= toKm) out.push(b); else { out.push(at(a, b, segM, toKm)); break; }
    }
    along += segM;
  }
  return out;
}
const LIMIT_CACHE = new Map();
export function limitFiles(tc, info, sceneName) {
  if (LIMIT_CACHE.has(sceneName)) return LIMIT_CACHE.get(sceneName);
  const S = tc.testbed.limit_shim;
  const cfg = (n) => JSON.parse(fs.readFileSync(path.join(info.app, tc.build.config_dir, n + tc.build.config_ext), 'utf8'));
  const RL = cfg('config_relay_limit');
  const LM = cfg('config_limitmatch');
  const RP = cfg('config_relay_parse');
  const L = RP.limit;
  const sceneDir = path.resolve(path.dirname(info.cfgPath), info.tb.scenes.dir);
  const scene = JSON.parse(fs.readFileSync(path.join(sceneDir, sceneName + tc.build.config_ext), 'utf8'));
  const head = { [RP.v_key]: RP.v, [RP.meta_at_key]: S.at_text };
  const sections = [];
  const cells = {};
  const key = (p) => Math.floor(p[0] / LM.cell.deg) + LM.cell.sep + Math.floor(p[1] / LM.cell.deg);
  for (const lim of scene.limits || []) {
    const leg = scene.route.legs[lim.leg];
    if (lim.limit_kmh === null || lim.limit_kmh === undefined) continue; // 자료 없는 길 — 싣지 않음
    if (leg.kind === 'line') {
      const fwd = leg.to_km >= leg.from_km;
      sections.push({ [L.line_key]: leg.line, [L.from_key]: lim.from_km, [L.to_key]: lim.to_km, [L.fwd_key]: fwd ? lim.limit_kmh : null, [L.back_key]: fwd ? null : lim.limit_kmh });
    } else {
      const part = cutKm(leg.points, lim.from_km, lim.to_km, S);
      // piece_m 마다 잘라 조각 하나씩(양방향)
      const pts = [part[0]];
      for (let i = 1; i < part.length; i += 1) {
        const a = part[i - 1]; const b = part[i]; const n = Math.max(1, Math.ceil(distM(a, b, S) / S.piece_m));
        for (let k = 1; k <= n; k += 1) pts.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
      }
      for (let i = 0; i + 1 < pts.length; i += 1) {
        const seg = { [L.id_key]: sceneName + S.id_sep + lim.leg + S.id_sep + lim.from_km + S.id_sep + i, [L.kmh_key]: lim.limit_kmh, [L.both_key]: true, [L.pts_key]: [pts[i], pts[i + 1]] };
        for (const k of new Set([key(pts[i]), key(pts[i + 1])])) (cells[k] = cells[k] || []).push(seg);
      }
    }
  }
  const files = {};
  if (sections.length) files[RL.highway_file] = JSON.stringify({ ...head, [L.sections_key]: sections });
  files[RL.index_file] = JSON.stringify({ ...head, [L.cells_key]: Object.keys(cells).sort() });
  for (const [k, segs] of Object.entries(cells)) files[RL.cell_file.split(RL.cell_mark).join(k)] = JSON.stringify({ ...head, [L.cell_key]: k, [L.segs_key]: segs });
  const out = { files, sections, cells, isLimitName: (n) => n === RL.highway_file || n === RL.index_file || n.startsWith(RL.cell_file.split(RL.cell_mark)[0]) };
  LIMIT_CACHE.set(sceneName, out);
  return out;
}

// 앱에 넘길 fetch: 다리 자료 길의 선 파일만 linesShim 이 답하고 나머지는 그대로 다리로
export function fetchWithLines(tc, info, secret, baseFetch) {
  const shim = linesShim(tc, info, secret);
  const prefix = info.base + info.b.paths.data;
  return (url, init) => {
    const u = String(url);
    if (u.startsWith(prefix)) {
      const a = shim.answer(u.slice(prefix.length), init && init.headers);
      if (a) return Promise.resolve(new Response(a.body, { status: a.status, headers: { 'Content-Type': tc.testbed.json_type } }));
    }
    return (baseFetch || fetch)(url, init);
  };
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
