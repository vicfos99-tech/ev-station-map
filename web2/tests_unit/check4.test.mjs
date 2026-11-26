// 단위 시험: 기계 검사 ⑤ 꽂는 자리(정비 나 ⑥)의 판정 — 갈림길 양쪽(판·제목 걸음 / 기본 기능 걸음, 그리고 '그 종류가 처음 생기는 틀 걸음')을 다 본다. 파일 이름은 시험용.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export default async function (t) {
  const { judgePlug } = await import(pathToFileURL(path.join(t.tools, 'check4.mjs')).href);
  const P = t.tc.check4.plug;
  const kinds = { 'src/topic_toilet.js': 'topic', 'src/topic_station.js': 'topic', 'src/ui_newboard.js': 'board', 'src/ui_ahead.js': 'board', 'src/tapdist.js': null };
  const kindOf = (p) => kinds[p] || null;
  const N = P.states.added;
  const M = P.states.modified;
  // 이미 있던 것: 충전소 꾸러미(모듈·설정)와 판 하나 — 화장실 걸음 때의 모습
  const had = [{ path: 'src/topic_station.js', kind: 'topic' }, { path: 'config/config_topic_station.json', kind: null }, { path: 'src/ui_ahead.js', kind: 'board' }, { path: 'src/app.js', kind: null }];

  const a = judgePlug([{ path: 'src/topic_toilet.js', state: N }, { path: 'config/config_topic_toilet.json', state: N }, { path: 'README.md', state: M }], kindOf, P, had);
  t.check('①', '제목 걸음: 새 꾸러미 파일 + 설명서만 고침 → 통과', '제목 걸음 · 걸림 0', (a.step ? '제목 걸음' : '기본') + ' · 걸림 ' + a.bad.length, a.step && a.bad.length === 0);
  const b = judgePlug([{ path: 'src/topic_toilet.js', state: N }, { path: 'src/app.js', state: M }, { path: 'config/config_statecalc.json', state: M }], kindOf, P, had);
  t.check('②', '제목 걸음인데 꽂는 자리(조립·계산 표)를 고침 → 실패', '걸림 app.js·config_statecalc.json', b.bad.join(','), b.step && b.bad.length === 2);
  const c = judgePlug([{ path: 'config/config_topic_toilet.json', state: N }, { path: 'src/ui_map.js', state: M }], kindOf, P, had);
  t.check('③', '꾸러미 설정 파일 이름만으로도 제목 걸음 → 기존 화면 고침은 실패', '걸림 ui_map.js', c.bad.join(','), c.step && c.bad.length === 1);
  const d = judgePlug([{ path: 'src/ui_newboard.js', state: N }, { path: 'tools/logs/x.log', state: M }], kindOf, P, had);
  t.check('④', '판 걸음(새 KIND board) + 도구 기록장만 → 통과', '판 걸음 · 걸림 0', (d.step ? '판 걸음' : '기본') + ' · 걸림 ' + d.bad.length, d.step && d.bad.length === 0);
  const e = judgePlug([{ path: 'src/tapdist.js', state: N }, { path: 'src/app.js', state: M }, { path: 'config/config_statecalc.json', state: M }], kindOf, P, had);
  t.check('⑤', '기본 기능 걸음(새 파일이 판·꾸러미 아님 — A8 꼴) → 꽂는 자리를 고쳐도 막지 않음', '기본 기능 · 걸림 0', (e.step ? '판·제목' : '기본 기능') + ' · 걸림 ' + e.bad.length, !e.step && e.bad.length === 0);
  const f = judgePlug([{ path: 'src/topic_toilet.js', state: M }, { path: 'src/app.js', state: M }], kindOf, P, had);
  t.check('⑥', '꾸러미 파일을 고치기만(새로 더하지 않음) → 기본 기능 걸음으로 봄', '기본 기능', f.step ? '판·제목' : '기본 기능', !f.step);
  // 갈림길: 그 종류가 처음 생기는 걸음(정비 나 — 첫 꾸러미 충전소를 만들며 틀을 고침)
  const hadNoTopic = [{ path: 'src/ui_ahead.js', kind: 'board' }, { path: 'src/app.js', kind: null }];
  const g = judgePlug([{ path: 'src/topic_station.js', state: N }, { path: 'config/config_topic_station.json', state: N }, { path: 'src/app.js', state: M }, { path: 'config/config_statecalc.json', state: M }], kindOf, P, hadNoTopic);
  t.check('⑦', '갈림길 — 첫 꾸러미(꾸러미가 하나도 없던 때): 틀을 만드는 걸음 → 꽂는 자리를 고쳐도 막지 않음', '기본 기능 · 걸림 0', (g.step ? '판·제목' : '기본 기능') + ' · 걸림 ' + g.bad.length, !g.step && g.bad.length === 0);
  const h = judgePlug([{ path: 'src/topic_toilet.js', state: N }, { path: 'src/app.js', state: M }], kindOf, P, had);
  t.check('⑧', '갈림길 — 둘째 꾸러미(충전소가 이미 있음): 같은 꼴인데 이번엔 제목 걸음 → 실패', '제목 걸음 · 걸림 app.js', (h.step ? '제목 걸음' : '기본') + ' · ' + h.bad.join(','), h.step && h.bad.length === 1);
}
