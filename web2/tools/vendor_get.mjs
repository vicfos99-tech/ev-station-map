// 지도 라이브러리(MapLibre)를 npm 에서 한 번 받아 vendor/ 에 둔다. 판·파일 목록은 config_tools.json 의 vendor.
//   node web2/tools/vendor_get.mjs [이미 받은 .tgz 경로]
// 받은 묶음은 임시 폴더(tools/tmp — git 밖)에 두고, 정한 파일만 꺼낸다(묶음 안 스크립트는 돌리지 않는다).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { loadToolsConfig, appDir, toolLog } from './lib_tools.mjs';

const tc = loadToolsConfig();
const v = tc.vendor;
const log = toolLog(tc, 'vendor_get');
const APP = appDir(tc);

function tarEntries(buf) {
  const out = {};
  let off = 0;
  while (off + v.tar_block <= buf.length) {
    const head = buf.subarray(off, off + v.tar_block);
    if (head.every((b) => b === 0)) break;
    const str = (a, n) => head.subarray(a, a + n).toString('utf8').replace(/\0.*$/s, '');
    let name = str(0, v.tar_name_len);
    const prefix = str(v.tar_prefix_at, v.tar_prefix_len);
    if (prefix) name = prefix + '/' + name;
    const size = parseInt(str(v.tar_size_at, v.tar_size_len).trim() || '0', v.tar_octal);
    const type = str(v.tar_type_at, 1);
    off += v.tar_block;
    if (v.tar_file_types.includes(type)) out[name] = buf.subarray(off, off + size);
    off += Math.ceil(size / v.tar_block) * v.tar_block;
  }
  return out;
}

try {
  log.write('시작', { package: v.package, version: v.version });
  let tgz = process.argv[2];
  if (!tgz) {
    const tmp = path.join(APP, tc.tmp_dir, 'vendor');
    fs.mkdirSync(tmp, { recursive: true });
    const r = spawnSync(v.npm, ['pack', v.package + '@' + v.version, '--pack-destination', tmp, '--silent'], { encoding: 'utf8', shell: true });
    if (r.status !== tc.exit.ok) throw new Error('npm pack 실패: ' + (r.stderr || '').trim());
    tgz = path.join(tmp, r.stdout.trim().split(/\r?\n/).pop());
  }
  const entries = tarEntries(zlib.gunzipSync(fs.readFileSync(tgz)));
  const outDir = path.join(APP, v.out_dir);
  fs.mkdirSync(outDir, { recursive: true });
  for (const [inside, outName] of Object.entries(v.files)) {
    if (!entries[inside]) throw new Error('묶음 안에 없음: ' + inside);
    fs.writeFileSync(path.join(outDir, outName), entries[inside]);
    console.log(outName + ' ← ' + inside + ' (' + entries[inside].length + ' 바이트)');
  }
  log.write('끝', { result: 'ok', from: tgz });
} catch (e) {
  log.write('예외', { error: e.message });
  console.error('받기 실패: ' + e.message);
  process.exitCode = tc.exit.fail;
}
