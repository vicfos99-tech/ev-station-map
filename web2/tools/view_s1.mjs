// 묘성이 크롬으로 장면을 보는 길(명령 한 줄): 앱을 임시 폴더에 빌드하고, 테스트 베드 다리를 시험 모드로 띄워 장면을 고르고(틱을 주면 그 틱으로 옮김),
// 작은 웹 서버로 http://127.0.0.1:5173/ 에 앱을 낸다. 정한 초가 지나면 셋 다 스스로 닫힌다.
//   node web2/tools/view_s1.mjs [초 — 없으면 view_s1.default_seconds] [장면 — 없으면 S1] [틱 — 없으면 0]
//   예: node web2/tools/view_s1.mjs 600 S2_제한속도 460 · node web2/tools/view_s1.mjs 600 S7_출처끊김 165
// (A2) R0 전이라 시험 다리가 고속도로 선 파일을 내주지 않는다 — 이 서버가 다리 앞에 서서 선 파일만 대신 답하고 나머지 다리 길(/v1/…)은
// 그대로 다리로 넘긴다. 그래서 이 보기의 빌드만 다리 주소를 이 서버(같은 주소)로 바꿔 짓는다(--override — 저장소의 설정은 그대로).
// 앱 비밀 값은 이번만 쓰는 값을 새로 만들어 저장소 밖 임시 파일과 다리 환경변수로만 넘긴다(화면·기록에 안 나옴).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { loadToolsConfig, appDir, toolLog, TOOLS_DIR } from './lib_tools.mjs';
import { testbedInfo, makeSecret, writeSecretFile, startBridge, selectScene, seekScene, linesShim } from './lib_testbed.mjs';

const tc = loadToolsConfig();
const V = tc.view_s1;
const APP = appDir(tc);
const log = toolLog(tc, 'view_s1');

async function run() {
  const want = Number(process.argv[2] || V.default_seconds);
  if (!Number.isFinite(want) || want <= 0 || want > V.max_seconds) throw new Error('초는 1~' + V.max_seconds);
  const scene = process.argv[3] || tc.try_a1.s1_scene;
  const tick = Number(process.argv[4] || 0);
  if (!Number.isInteger(tick) || tick < 0) throw new Error('틱은 0 이상 정수');
  log.write('시작', { seconds: want, scene, tick });
  const secret = makeSecret(tc);
  const sec = writeSecretFile(tc, secret);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'web2-view-'));
  try {
    const here = V.host + ':' + V.port;
    const gw = JSON.parse(fs.readFileSync(path.join(APP, tc.build.config_dir, V.gateway_config + tc.build.config_ext), 'utf8'));
    gw.gateway_url = V.scheme + here;
    gw.allowed_hosts = [here];
    const overFile = path.join(out, V.override_file);
    fs.writeFileSync(overFile, JSON.stringify({ [V.gateway_config]: gw }), 'utf8');
    const r = spawnSync(process.execPath, [path.join(TOOLS_DIR, 'build.mjs'), '--out', out, '--secret', sec.file, '--override', overFile], { encoding: 'utf8' });
    process.stdout.write(r.stdout || '');
    if (r.status !== tc.exit.ok) throw new Error('빌드 실패: ' + (r.stderr || '').trim());
    const page = fs.readFileSync(path.join(out, tc.build.out_file));
    const info = testbedInfo(tc, APP);
    const shim = linesShim(tc, info, secret);
    const bridge = await startBridge(tc, info, want, secret);
    await selectScene(info, scene, false);
    if (tick) await seekScene(info, tick);
    const server = http.createServer((req, res) => {
      if (req.url.startsWith(V.gateway_prefix)) {
        const dataPrefix = info.b.paths.data;
        if (req.method === 'GET' && req.url.startsWith(dataPrefix)) {
          const a = shim.answer(decodeURIComponent(req.url.slice(dataPrefix.length)), req.headers);
          if (a) {
            log.write('선 대신 답', { url: req.url, status: a.status });
            res.writeHead(a.status, { 'Content-Type': tc.testbed.json_type, 'Cache-Control': 'no-store' });
            res.end(a.body);
            return;
          }
        }
        const headers = { ...req.headers };
        delete headers.host;
        const up = http.request(new URL(req.url, info.base), { method: req.method, headers }, (ur) => {
          res.writeHead(ur.statusCode, ur.headers);
          ur.pipe(res);
        });
        up.on('error', (e) => {
          log.write('다리로 넘기기 실패', { url: req.url, error: e.message });
          if (!res.headersSent) res.writeHead(V.proxy_fail_status);
          res.end();
        });
        res.on('close', () => up.destroy());
        req.pipe(up);
        return;
      }
      const ok = req.method === 'GET' && (req.url === '/' || req.url === '/' + tc.build.out_file);
      log.write('물음', { method: req.method, url: req.url, status: ok ? 200 : 404 });
      if (!ok) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': V.content_type, 'Cache-Control': 'no-store' });
      res.end(page);
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(V.port, V.host, resolve); });
    const url = V.scheme + here + '/';
    console.log('');
    console.log('크롬에서 여세요: ' + url);
    console.log('장면: ' + scene + (tick ? ' (틱 ' + tick + '부터)' : '') + ' · ' + want + '초 뒤 저절로 닫힘(창을 닫아도 됨). 일찍 끝내려면 Ctrl+C');
    log.write('열림', { url, scene, tick });
    await new Promise((resolve) => setTimeout(resolve, want * V.ms_per_s));
    server.closeAllConnections();
    server.close();
    const code = await bridge.waitExit();
    console.log('끝: 다리 종료 코드 ' + code);
    log.write('끝', { bridge_exit: code });
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
    fs.rmSync(sec.dir, { recursive: true, force: true });
  }
}

try {
  await run();
} catch (e) {
  log.write('예외', { error: e.message });
  console.error('보기 실패: ' + e.message);
  process.exitCode = tc.exit.fail;
}
