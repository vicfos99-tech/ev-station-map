// web2 도구가 함께 쓰는 것: 도구 설정 읽기, work.env 읽기, 한국 시각 글, 도구 기록장.
// 값은 모두 config_tools.json 에서 읽는다(박지 않음).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
const TOOLS_CONFIG = 'config_tools.json';

export function loadToolsConfig() {
  return JSON.parse(fs.readFileSync(path.join(TOOLS_DIR, TOOLS_CONFIG), 'utf8'));
}

export function appDir(tc) {
  return path.resolve(TOOLS_DIR, tc.app_dir);
}

// work.env 를 이 폴더에서 위로 올라가며 찾아 KEY=VALUE 를 돌려준다(환경변수가 먼저).
export function readWorkEnv(tc) {
  let dir = TOOLS_DIR;
  const out = {};
  for (;;) {
    const p = path.join(dir, tc.work_env.file);
    if (fs.existsSync(p)) {
      for (const raw of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const i = line.indexOf('=');
        if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
      }
      out.__file = p;
      break;
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  for (const k of [tc.work_env.kst_key, tc.work_env.root_key]) {
    if (process.env[k]) out[k] = process.env[k];
  }
  return out;
}

// UTC 에 설정 값만 더한 한국 시각 글(지역 시각 함수는 쓰지 않는다 — 설계 5-6)
export function kstText(tc, ms) {
  const env = readWorkEnv(tc);
  const off = Number(env[tc.work_env.kst_key]);
  if (!Number.isFinite(off)) throw new Error('work.env 에 ' + tc.work_env.kst_key + ' 가 없음');
  const d = new Date((ms === undefined ? Date.now() : ms) + off * tc.time.ms_per_hour);
  const parts = {
    YYYY: d.getUTCFullYear(), MM: d.getUTCMonth() + 1, DD: d.getUTCDate(),
    hh: d.getUTCHours(), mm: d.getUTCMinutes(), ss: d.getUTCSeconds(),
  };
  return tc.time.format.replace(/YYYY|MM|DD|hh|mm|ss/g, (tok) => String(parts[tok]).padStart(tok.length, '0'));
}

// 도구 기록장: <web2>/tools/logs/<도구>.log 에 한 줄씩 더한다. 못 쓰면 콘솔에 찍고 계속.
export function toolLog(tc, tool) {
  const dir = path.join(appDir(tc), tc.log.dir);
  const file = path.join(dir, tool + tc.log.suffix);
  return {
    file,
    write(what, obj) {
      const line = [kstText(tc), tool, what, obj === undefined ? '' : JSON.stringify(obj)].join(tc.log.sep);
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.appendFileSync(file, line + '\n', 'utf8');
      } catch (e) {
        console.error('[기록장 못 씀] ' + file + ' — ' + e.message + ' — ' + line);
      }
    },
  };
}

export function listFiles(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(ext))
    .map((e) => path.join(dir, e.name))
    .sort();
}
