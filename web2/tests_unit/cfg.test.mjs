// 단위 시험: Config 의 더하기(adds — 추가3 앞 기본 걸음). 꾸러미 설정이 남의 설정(등급 표·이름 글)에 자기 줄을 더한다.
export default async function (t) {
  const { createConfig } = await t.src('cfg');
  const K = t.tc.build.adds_key;
  const shapes = {
    a: { keys: { 'grades': { t: 'map', of: { t: 'str' } } } },
    b: { keys: { label: { t: 'str', min: 1 } } },
  };
  const base = () => ({ a: { grades: { x: 'app' }, deep: { n: { one: 1 } } } });

  // ① 없는 칸은 더하고, 객체 안으로 들어가 더함
  const c1 = createConfig({ adds_key: K, shapes, files: { ...base(), b: { label: 'B', [K]: { a: { grades: { y: 'yy' }, deep: { n: { two: 2 } } } } } } });
  const a1 = c1.section('a');
  t.check('①', '더하기: 없는 칸은 더하고 객체 안으로 들어감', 'app,yy · 1,2 · 문제 0', [a1.grades.x, a1.grades.y].join(',') + ' · ' + [a1.deep.n.one, a1.deep.n.two].join(',') + ' · 문제 ' + c1.problems().length,
    a1.grades.x === 'app' && a1.grades.y === 'yy' && a1.deep.n.one === 1 && a1.deep.n.two === 2 && c1.problems().length === 0);

  // ② 이미 있는 칸이 다른 값 → 바꾸지 않고 문제(더한 쪽 파일), 같은 값이면 문제 없음
  const c2 = createConfig({ adds_key: K, shapes, files: { ...base(), b: { label: 'B', [K]: { a: { grades: { x: 'other' } } } } } });
  const p2 = c2.problems();
  const c2s = createConfig({ adds_key: K, shapes, files: { ...base(), b: { label: 'B', [K]: { a: { grades: { x: 'app' } } } } } });
  t.check('②', '부딪힘: 다른 값이면 그대로 두고 adds_clash(파일 b) · 같은 값이면 문제 0', 'app · b ' + K + '.a.grades.x adds_clash · 0',
    c2.section('a').grades.x + ' · ' + p2.map((p) => p.file + ' ' + p.key + ' ' + p.why).join('/') + ' · ' + c2s.problems().length,
    c2.section('a').grades.x === 'app' && p2.length === 1 && p2[0].file === 'b' && p2[0].why === 'adds_clash' && p2[0].key === K + '.a.grades.x' && c2s.problems().length === 0);

  // ③ 더하는 쪽이 꼴에서 틀려도(label 빠짐) 더하기는 함 — 그 설정들의 등급을 알아야 '그 기능만 꺼짐'
  const c3 = createConfig({ adds_key: K, shapes, files: { ...base(), b: { [K]: { a: { grades: { y: 'yy' } } } } } });
  t.check('③', '더하는 쪽 꼴이 틀려도 더함 · b 는 못 씀', 'yy · b 문제 missing · b 못 씀', c3.section('a').grades.y + ' · b 문제 ' + c3.problems().map((p) => p.why).join(',') + ' · b ' + (c3.has('b') ? '씀' : '못 씀'),
    c3.section('a').grades.y === 'yy' && c3.problems().length === 1 && c3.problems()[0].why === 'missing' && !c3.has('b'));

  // ④ 받는 쪽이 꼴에서 틀리면 더하지 않음(던지지 않음) · 더하기 칸이 객체가 아니면 문제
  const c4 = createConfig({ adds_key: K, shapes, files: { a: { grades: 5 }, b: { label: 'B', [K]: { a: { grades: { y: 'yy' } } } } } });
  const c4b = createConfig({ adds_key: K, shapes, files: { ...base(), b: { label: 'B', [K]: 'x' } } });
  t.check('④', '받는 쪽 틀림 → 안 더함 · 더하기 칸이 글이면 type 문제', 'a 못 씀 · b ' + K + ' type', (c4.has('a') ? 'a 씀' : 'a 못 씀') + ' · ' + c4b.problems().map((p) => p.file + ' ' + p.key + ' ' + p.why).join('/'),
    !c4.has('a') && c4.has('b') && c4b.problems().length === 1 && c4b.problems()[0].key === K && c4b.problems()[0].why === 'type');

  // ⑥ 목록끼리는 없는 것만 뒤에 덧붙임(중계 파일 이름 허용 무늬 등)
  const c6 = createConfig({ adds_key: K, shapes, files: { a: { grades: {}, res: ['^a$', '^b$'] }, b: { label: 'B', [K]: { a: { res: ['^b$', '^c$'] } } } } });
  t.check('⑥', '목록 더하기: 없는 것만 뒤에 덧붙임', '^a$,^b$,^c$ · 문제 0', c6.section('a').res.join(',') + ' · 문제 ' + c6.problems().length, c6.section('a').res.join(',') === '^a$,^b$,^c$' && c6.problems().length === 0);

  // ⑤ 더하기 칸 이름을 안 주면 아무것도 안 더함(옛 꼴) · 결과는 얼어 있음
  const c5 = createConfig({ shapes, files: { ...base(), b: { label: 'B', [K]: { a: { grades: { y: 'yy' } } } } } });
  t.check('⑤', '더하기 칸 이름 없음 → 안 더함 · 설정은 얼어 있음', '없음 · 얼음', (c5.section('a').grades.y === undefined ? '없음' : '있음') + ' · ' + (Object.isFrozen(c1.section('a').grades) ? '얼음' : '안 얼음'),
    c5.section('a').grades.y === undefined && Object.isFrozen(c1.section('a').grades));
}
