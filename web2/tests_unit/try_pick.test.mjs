// 단위 시험: 시험 고르개의 '파일 → 통합 시험' 표 쓰기(정비 나 ⑨)와 커버리지 읽기(lib_cover). 표는 시험이 만든 가짜 — 실제 표(tools/logs/cover_map.json)는 안 건드림.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export default async function (t) {
  const { pick, testMap } = await import(pathToFileURL(path.join(t.tools, 'try_pick.mjs')).href);
  const { touchedFiles, putCover } = await import(pathToFileURL(path.join(t.tools, 'lib_cover.mjs')).href);
  const prefix = 'web2/';
  const tests = testMap();
  const nodeOnly = Object.values(tests).find((x) => !x.chrome && x.name === 'try_a1');
  const chrome = Object.values(tests).find((x) => x.chrome && x.name === 'try_a3');
  const map = { tests: {
    try_a1: { complete: true, files: ['src/tapdist.js'] },
    try_a3: { complete: true, files: ['src/geo.js'] },
    try_a8: { complete: false, files: [] },
  } };
  const word = pick(['src/tapdist.js'], { prefix, cover: false });
  const withMap = pick(['src/tapdist.js'], { prefix, coverMap: map });
  t.check('①', '표에 다 모인 node 시험(A1)이 그 파일을 지나갔으면 고름 — 낱말로는 안 고르던 것', '낱말: A1 없음 · 표: A1 있음', 'A1 낱말 ' + word.tests.includes('try_a1') + ' · 표 ' + withMap.tests.includes('try_a1'),
    !!nodeOnly && !word.tests.includes('try_a1') && withMap.tests.includes('try_a1') && withMap.why.try_a1.some((w) => w.includes('지나감')));
  t.check('②', '표가 덜 모인 시험(A8 complete=false)은 낱말 그대로', 'A8 있음(낱말)', String(withMap.tests.includes('try_a8')), withMap.tests.includes('try_a8') === word.tests.includes('try_a8'));
  const noTouch = pick(['src/geo.js'], { prefix, coverMap: { tests: { try_a1: { complete: true, files: ['src/ahead.js'] } } } });
  t.check('③', '표에 다 모인 node 시험이 그 파일을 안 지나갔으면 안 고름(낱말이 나와도)', 'A1 없음', noTouch.tests.join('·') || '없음', !noTouch.tests.includes('try_a1'));
  const chromeWord0 = pick(['src/ui_station.js'], { prefix, cover: false });
  const ct = chromeWord0.tests.find((n) => tests[n].chrome);
  const chromeWord = pick(['src/ui_station.js'], { prefix, coverMap: { tests: { [ct]: { complete: true, files: [] } } } });
  t.check('④', '크롬 시험은 표에 그 파일이 없어도 낱말이면 고름(크롬 안은 node 커버리지에 안 잡힘)', ct + ' 고름', ct + ' ' + chromeWord.tests.includes(ct), !!chrome && !!ct && chromeWord.tests.includes(ct));
  const u = pick(['src/ahead.js'], { prefix, cover: false });
  t.check('⑤', '고친 모듈의 단위 시험을 먼저 알려 줌', 'units = ahead', u.units.join(','), u.units.includes('ahead') && u.notes[0].includes('ahead'));

  // lib_cover: 가짜 커버리지 JSON → 지나간 파일(파일 머리만 돈 것은 뺌)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'web2-unit-cover-'));
  const srcUrl = (n) => pathToFileURL(path.join(t.app, 'src', n)).href;
  fs.writeFileSync(path.join(dir, 'c.json'), JSON.stringify({ result: [
    { url: srcUrl('ahead.js'), functions: [{ functionName: '', ranges: [{ startOffset: 0, endOffset: 900, count: 1 }] }, { functionName: 'aheadOf', ranges: [{ startOffset: 100, endOffset: 300, count: 4 }] }] },
    { url: srcUrl('engine.js'), functions: [{ functionName: '', ranges: [{ startOffset: 0, endOffset: 900, count: 1 }] }, { functionName: 'plan', ranges: [{ startOffset: 100, endOffset: 300, count: 0 }] }] },
    { url: 'node:fs', functions: [{ functionName: 'x', ranges: [{ startOffset: 5, endOffset: 9, count: 3 }] }] },
  ] }), 'utf8');
  const got = touchedFiles(dir, t.app, 'src/');
  t.check('⑥', '커버리지 읽기: 함수가 실제로 불린 파일만(불러오기만 한 engine 은 뺌)', 'src/ahead.js', got.join(','), got.length === 1 && got[0] === 'src/ahead.js');
  const mapFile = path.join(dir, 'map.json');
  putCover(mapFile, 'try_x', 'try_x:pure', ['src/a.js'], ['try_x:pure', 'try_x:app'], 'T1', 'n');
  const half = JSON.parse(fs.readFileSync(mapFile, 'utf8')).tests.try_x.complete;
  const full = putCover(mapFile, 'try_x', 'try_x:app', ['src/b.js'], ['try_x:pure', 'try_x:app'], 'T2', 'n');
  t.check('⑦', '표 쓰기: 부분이 다 모여야 complete · 파일은 합침', '반: false → 다: true · a,b', half + ' → ' + full.complete + ' · ' + full.files.join(','), half === false && full.complete === true && full.files.join(',') === 'src/a.js,src/b.js');
  fs.rmSync(dir, { recursive: true, force: true });
}
