// 커밋 전 걸쇠 설치: 저장소의 pre-commit 걸쇠 끝에 web2 걸쇠를 부르는 한 줄을 더한다(이미 있으면 그대로).
// 있던 걸쇠(잠긴 테스트 확인)는 지우지 않는다.
//   node web2/tools/install_hook.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadToolsConfig, appDir, toolLog } from './lib_tools.mjs';

const tc = loadToolsConfig();
const log = toolLog(tc, 'install_hook');
const APP = appDir(tc);

function git(args) {
  const r = spawnSync(tc.git.cmd, args, { cwd: APP, encoding: 'utf8' });
  if (r.status !== tc.exit.ok) throw new Error('git ' + args.join(' ') + ' 실패: ' + (r.stderr || '').trim());
  return r.stdout.trim();
}

try {
  log.write('시작', {});
  // --git-path 는 git 을 부른 자리(APP) 기준 경로를 돌려준다
  const hooksDir = path.resolve(APP, git(['rev-parse', '--git-path', 'hooks']));
  const hookFile = path.join(hooksDir, tc.hook.hook_name);
  const scriptFile = path.join(APP, tc.hook.script);
  if (!fs.existsSync(scriptFile)) throw new Error('걸쇠 글이 없음: ' + scriptFile);
  let text = fs.existsSync(hookFile) ? fs.readFileSync(hookFile, 'utf8') : tc.hook.shebang + '\n';
  if (text.split(/\r?\n/).some((l) => l.trim() === tc.hook.line)) {
    console.log('이미 설치됨: ' + hookFile);
    log.write('끝', { result: 'already', hook: hookFile });
  } else {
    if (!text.endsWith('\n')) text += '\n';
    text += tc.hook.line + '\n';
    fs.writeFileSync(hookFile, text, 'utf8');
    console.log('설치함: ' + hookFile + ' 끝에 → ' + tc.hook.line);
    log.write('끝', { result: 'installed', hook: hookFile });
  }
} catch (e) {
  log.write('예외', { error: e.message });
  console.error('걸쇠 설치 실패: ' + e.message);
  process.exitCode = tc.exit.fail;
}
