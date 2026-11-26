// 원칙 점검(4-3)을 부르는 얇은 다리: 작업 폴더의 점검 도구(20_도구/원칙점검)를 이 앱의 설정 한 장으로 부른다.
//   node web2/tools/principles_run.mjs check (--staged | --all | --files ...)   ← 커밋 전 걸쇠·손으로
//   node web2/tools/principles_run.mjs judge (--commit HEAD | --files ...) [--force]  ← 커밋 뒤 걸쇠(설정 judge.auto 가 꺼져 있으면 부르지 않음)
// 도구 자리·설정 이름은 config_tools.json 의 principles 에서(작업 폴더는 work.env). 시작·끝은 도구 기록장(tools/logs/principles_run.log).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadToolsConfig, appDir, toolLog, readWorkEnv } from './lib_tools.mjs';

const tc = loadToolsConfig();
const P = tc.principles;
const log = toolLog(tc, 'principles_run');
const APP = appDir(tc);

function expand(s, env) {
  return s.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (m, k) => {
    if (env[k] === undefined) throw new Error('work.env 에 ' + k + ' 가 없음');
    return env[k];
  });
}

try {
  const [what, ...rest] = process.argv.slice(2);
  const script = P.scripts[what];
  if (!script) throw new Error('모르는 일: ' + what + ' (' + Object.keys(P.scripts).join(' | ') + ')');
  const toolDir = expand(P.tool_dir, readWorkEnv(tc));
  const file = path.join(toolDir, script);
  log.write('시작', { what, args: rest, tool: file });
  if (!fs.existsSync(file)) {
    log.write('도구 없음', { file, blocks: P.missing_tool_blocks });
    console.error('[원칙 점검] 도구가 없음: ' + file + (P.missing_tool_blocks ? ' — 막습니다' : ' — 건너뜀'));
    process.exitCode = P.missing_tool_blocks ? tc.exit.fail : tc.exit.ok;
  } else {
    const r = spawnSync(P.node, [file, '--config', path.join(APP, P.sheet), ...rest], { cwd: APP, stdio: 'inherit' });
    log.write('끝', { what, status: r.status, error: r.error && r.error.message });
    process.exitCode = r.status === null ? tc.exit.fail : r.status;
  }
} catch (e) {
  log.write('예외', { error: e.message });
  console.error('[원칙 점검] ' + e.message);
  process.exitCode = tc.exit.fail;
}
