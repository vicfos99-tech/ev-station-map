// (4-2) 테스트 베드 실자료 — 실제 도로 모양 선을 쓰는 장면을 앱에 보이는 길. 테스트 베드 파일은 읽기만.
// 앱은 R0 전이라 고속도로 선을 앱 설정의 파일 이름(lines/gyeongbu_down.json)으로만 묻는다. lib_testbed.linesShim 은 그 자리에 늘 옛 직선을 낸다.
// realLinesShim 은 linesShim 을 감싸, 지금 장면이 config_try_realline.json real_lines 의 선을 쓰면 그 선을 앱 파일 자리로 내주고(안의 name 은 앱 선 이름으로),
// 제한 속도 고속도로 표의 선 이름도 같이 바꾼다. 비밀 값 검사·제한 속도 만들기·끊김은 linesShim 그대로. 장면이 옛 선만 쓰면 linesShim 과 똑같다.
import fs from 'node:fs';
import path from 'node:path';
import { TOOLS_DIR } from './lib_tools.mjs';
import { linesShim, currentScene } from './lib_testbed.mjs';

const REAL_CONFIG = 'config_try_realline.json';
const LINE_KIND = 'line';

export function loadRealConfig() {
  return JSON.parse(fs.readFileSync(path.join(TOOLS_DIR, REAL_CONFIG), 'utf8'));
}

// 장면이 쓰는 실자료 선 [{line, app_file, app_name}]
export function realLinesOf(tc, info, sceneName, R) {
  const dir = path.resolve(path.dirname(info.cfgPath), info.tb.scenes.dir);
  const scene = JSON.parse(fs.readFileSync(path.join(dir, sceneName + tc.build.config_ext), 'utf8'));
  const used = new Set((scene.route.legs || []).filter((l) => l.kind === LINE_KIND).map((l) => l.line));
  return Object.entries(R.real_lines).filter(([line]) => used.has(line)).map(([line, v]) => ({ line, ...v }));
}

// sceneOf: 지금 장면 이름을 돌려주는 함수(없으면 selectScene 이 적은 것) — 시험은 정한 장면을 넘긴다
export function realLinesShim(tc, info, secret, sceneOf) {
  const R = loadRealConfig();
  const base = linesShim(tc, info, secret);
  const get = sceneOf || currentScene;
  const linesDir = path.resolve(path.dirname(info.cfgPath), info.tb.scenes.lines_dir);
  const cfg = (n) => JSON.parse(fs.readFileSync(path.join(info.app, tc.build.config_dir, n + tc.build.config_ext), 'utf8'));
  const RL = cfg('config_relay_limit');
  const L = cfg('config_relay_parse').limit;
  const bodies = new Map();
  const usedCache = new Map();
  const lineBody = (u) => {
    if (!bodies.has(u.line)) {
      const obj = JSON.parse(fs.readFileSync(path.join(linesDir, u.line + info.tb.scenes.line_suffix), 'utf8'));
      bodies.set(u.line, JSON.stringify({ ...obj, name: u.app_name }));
    }
    return bodies.get(u.line);
  };
  return {
    files: base.files,
    realOf: (name) => realLinesOf(tc, info, name, R),
    answer(sub, headers) {
      const a = base.answer(sub, headers);
      const name = get();
      if (!a || a.status !== 200 || !name) return a;
      if (!usedCache.has(name)) usedCache.set(name, realLinesOf(tc, info, name, R));
      const used = usedCache.get(name);
      if (!used.length) return a;
      const hit = used.find((u) => u.app_file === sub);
      if (hit) return { status: a.status, body: lineBody(hit), real: hit.line };
      if (sub === RL.highway_file) {
        const o = JSON.parse(a.body);
        for (const s of o[L.sections_key] || []) {
          const u = used.find((x) => x.line === s[L.line_key]);
          if (u) s[L.line_key] = u.app_name;
        }
        return { status: a.status, body: JSON.stringify(o) };
      }
      return a;
    },
  };
}
