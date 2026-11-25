// 묘성이 크롬으로 S1 을 보는 길(명령 한 줄): 앱을 임시 폴더에 빌드하고, 테스트 베드 다리를 시험 모드로 띄워 S1 을 고르고,
// 작은 웹 서버로 http://127.0.0.1:5173/ 에 앱을 낸다. 정한 초가 지나면 셋 다 스스로 닫힌다.
//   node web2/tools/view_s1.mjs [초 — 없으면 view_s1.default_seconds]
// 앱 비밀 값은 이번만 쓰는 값을 새로 만들어 저장소 밖 임시 파일과 다리 환경변수로만 넘긴다(화면·기록에 안 나옴).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { loadToolsConfig, appDir, toolLog, TOOLS_DIR } from './lib_tools.mjs';
import { testbedInfo, makeSecret, writeSecretFile, startBridge, selectScene } from './lib_testbed.mjs';

const tc = loadToolsConfig();
const V = tc.view_s1;
const APP = appDir(tc);
const log = toolLog(tc, 'view_s1');

async function run() {
  const want = Number(process.argv[2] || V.default_seconds);
  if (!Number.isFinite(want) || want <= 0 || want > V.max_seconds) throw new Error('초는 1~' + V.max_seconds);
  log.write('시작', { seconds: want });
  const secret = makeSecret(tc);
  const sec = writeSecretFile(tc, secret);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'web2-view-'));
  try {
    const r = spawnSync(process.execPath, [path.join(TOOLS_DIR, 'build.mjs'), '--out', out, '--secret', sec.file], { encoding: 'utf8' });
    process.stdout.write(r.stdout || '');
    if (r.status !== tc.exit.ok) throw new Error('빌드 실패: ' + (r.stderr || '').trim());
    const page = fs.readFileSync(path.join(out, tc.build.out_file));
    const info = testbedInfo(tc, APP);
    const bridge = await startBridge(tc, info, want, secret);
    await selectScene(info, tc.try_a1.s1_scene, false);
    const server = http.createServer((req, res) => {
      const ok = req.method === 'GET' && (req.url === '/' || req.url === '/' + tc.build.out_file);
      log.write('물음', { method: req.method, url: req.url, status: ok ? 200 : 404 });
      if (!ok) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': V.content_type, 'Cache-Control': 'no-store' });
      res.end(page);
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(V.port, V.host, resolve); });
    const url = 'http://' + V.host + ':' + V.port + '/';
    console.log('');
    console.log('크롬에서 여세요: ' + url);
    console.log('장면: ' + tc.try_a1.s1_scene + ' · ' + want + '초 뒤 저절로 닫힘(창을 닫아도 됨). 일찍 끝내려면 Ctrl+C');
    log.write('열림', { url });
    await new Promise((resolve) => setTimeout(resolve, want * V.ms_per_s));
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
