// 단위 시험: ahead('앞의 ○○' — 정비 나 ②). 제목을 모르는지 = 같은 점을 다른 칸 이름(다른 제목의 꼴)으로 줘도 같은 답인지.
// 충전소와 같은 결과인지는 통합 시험(A2-나·A3·A4·A6)이 본다. 여기 좌표·이름은 시험용(실자료 아님).
export default async function (t) {
  const ahead = await t.src('ahead');
  const geo = await t.src('geo');
  const R = t.cfg('config_ahead');
  const lib = { parts: { geo }, rules: { config_geo: t.cfg('config_geo'), config_locate: t.cfg('config_locate'), config_navi: t.cfg('config_navi') } };
  const LINE = 'unit_line';
  const lines = [{ name: LINE, points: [[36.0, 127.0], [36.05, 127.0], [36.1, 127.0], [36.2, 127.0]] }];
  const base = { ...R, line_dir_words: { [LINE]: { forward: ['북쪽'], backward: ['남쪽'] } } };
  // 충전소 꼴 점(지금 칸 이름)
  const asStation = [
    { id: 'a1', name: '가 쉼터(북쪽방향)', operator: '갑', rest: true, lat: 36.03, lng: 127.0005 },
    { id: 'a2', name: '가 쉼터(북쪽방향)', operator: '을', rest: true, lat: 36.0302, lng: 127.0006 },
    { id: 'b1', name: '나 쉼터(남쪽방향)', operator: '갑', rest: true, lat: 36.06, lng: 127.0004 },
    { id: 'c1', name: '다 쉼터(북쪽방향)', operator: '병', rest: true, lat: 36.12, lng: 127.0003 },
    { id: 'd1', name: '라 마을', operator: '정', rest: false, lat: 36.02, lng: 127.02 },
  ];
  // 다른 제목 꼴(칸 이름이 모두 다름) — 같은 점
  const F2 = { key: 'tid', name: 'title', tag: 'kind', on_line: 'hw', lat: 'y', lng: 'x' };
  const asOther = asStation.map((s) => ({ tid: s.id, title: s.name, kind: s.operator, hw: s.rest, y: s.lat, x: s.lng }));
  const r1 = { ...base };
  const r2 = { ...base, fields: F2, items_input: 'toilets' };
  const fix = { t: 1, lat: 36.01, lng: 127.0 };
  const pos = { on_line: true, line: LINE, km: 1.1, dir: t.cfg('config_locate').dir_words.forward, off_m: 0 };

  const a1 = ahead.aheadOf({ fix, stations: { list: asStation, lines } }, { pos }, r1, lib, null);
  const a2 = ahead.aheadOf({ fix, toilets: { list: asOther, lines } }, { pos }, r2, lib, null);
  t.check('①', '선 위: 다른 칸 이름·다른 입력 이름으로 같은 점 → 같은 답', '같음 · 북쪽 둘(가·다)', JSON.stringify(a2.items.map((x) => x.name)), JSON.stringify(a1) === JSON.stringify(a2) && a1.items.length === 2 && a1.items[0].ids.length === 2);
  t.check('②', '선 위: 두 점이 한 자리로 묶이고 꼬리표가 모임(가 쉼터 = 갑·을)', '갑,을', a1.items[0].ops.join(','), a1.items[0].ops.join(',') === '갑,을' && a1.mode === R.modes.ahead);

  const offPos = { on_line: false, line: null, km: null, dir: null, off_m: R.around_after_m + 1 };
  const offFix = { t: 2, lat: 36.02, lng: 127.019 };
  const b1 = ahead.aheadOf({ fix: offFix, stations: { list: asStation, lines } }, { pos: offPos }, r1, lib, null);
  const b2 = ahead.aheadOf({ fix: offFix, toilets: { list: asOther, lines } }, { pos: offPos }, r2, lib, null);
  t.check('③', '선 밖(주변): 같은 답 · 선 위 자리는 뺌(around_skip_on_line)', '같음 · 라 마을 하나', JSON.stringify(b2.items.map((x) => x.name)), JSON.stringify(b1) === JSON.stringify(b2) && b1.mode === R.modes.around && b1.items.length === 1);

  const p1 = ahead.places({ list: asStation, lines }, r1, lib);
  const p2 = ahead.places({ list: asOther, lines }, r2, lib);
  t.check('④', '자리 목록(places — 목록·추천이 씀)도 같음', '같음', p1.length + '자리', JSON.stringify(p1) === JSON.stringify(p2));

  let threw = false;
  try { ahead.aheadOf({ fix, toilets: { list: [{ tid: 'x', title: 3, y: 1, x: 2 }], lines } }, { pos }, r2, lib, null); } catch (e) { threw = e instanceof TypeError; }
  t.check('⑤', '틀린 점(이름이 글이 아님) → 던짐', 'TypeError', String(threw), threw);
  const none = ahead.aheadOf({ fix }, { pos }, r2, lib, 'own');
  t.check('⑥', '점 조각이 아직 없으면 앞 결과 그대로', 'own', String(none), none === 'own');
}
