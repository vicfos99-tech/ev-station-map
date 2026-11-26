// 시험 두 층(정비 나 ⑨) — 통합 시험이 한 번 돌 때 실제로 지나간 앱 소스 파일(커버리지)을 모아 '파일 → 통합 시험' 표를 만든다.
// node 내장 커버리지(환경 변수 NODE_V8_COVERAGE)를 쓴다: 시험 프로세스와 그 node 자식이 끝날 때 폴더에 JSON 을 남긴다.
// '지나감' = 그 파일의 함수 가운데 파일 머리(불러올 때 한 번 도는 것) 말고 하나라도 실제로 불림. 크롬 안에서 도는 빌드 묶음은 node 커버리지에 안 잡힌다 —
// 그래서 크롬 시험은 고르개가 표와 낱말을 함께 본다(try_pick). 값(환경 변수 이름·표 파일)은 config_try_all.json 의 cover.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// 커버리지 JSON 폴더 → 지나간 'src/<파일>' 목록(차례대로)
export function touchedFiles(dir, app, srcDir) {
  const base = pathToFileURL(path.join(app, srcDir)).href.toLowerCase().replace(/\/*$/, '/');
  const out = new Set();
  if (!fs.existsSync(dir)) return [];
  for (const f of fs.readdirSync(dir)) {
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { continue; }
    for (const s of j.result || []) {
      const url = String(s.url || '');
      if (!url.toLowerCase().startsWith(base)) continue;
      const ran = (s.functions || []).some((fn) => fn.ranges && fn.ranges[0] && fn.ranges[0].startOffset > 0 && fn.ranges[0].count > 0);
      if (ran) out.add(srcDir + decodeURIComponent(url.slice(base.length)));
    }
  }
  return [...out].sort();
}

export function loadCoverMap(file) {
  if (!file || !fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

// 표에 한 시험 부분(key = 이름:부분)의 지나간 파일을 넣는다. parts_all = 그 시험이 전체 시험에서 도는 부분 키 전부 — 다 모이면 complete
export function putCover(file, test, key, files, partsAll, at, note) {
  const map = loadCoverMap(file) || { note, tests: {} };
  map.note = note;
  const t = map.tests[test] || { parts: {} };
  t.parts[key] = { at, files };
  const union = new Set();
  for (const p of Object.values(t.parts)) for (const f of p.files) union.add(f);
  t.files = [...union].sort();
  t.complete = partsAll.every((k) => t.parts[k]);
  map.tests[test] = t;
  map.at = at;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(map, null, 1), 'utf8');
  return t;
}
