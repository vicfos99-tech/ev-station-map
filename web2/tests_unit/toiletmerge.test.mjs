// 단위 시험: 화장실 자료 합치기(toiletmerge — 추가3 화장실 꾸러미)와 '앞의 화장실' 셈(toiletcalc). 다리 없음.
import fs from 'node:fs';
import path from 'node:path';

export default async function (t) {
  const tm = await t.src('toiletmerge');
  const tcalc = await t.src('toiletcalc');
  const ahead = await t.src('ahead');
  const geo = await t.src('geo');
  const navi = await t.src('navi');
  const R = t.cfg('config_toilet_merge');
  const G = t.cfg('config_geo');
  const sample = JSON.parse(fs.readFileSync(path.join(t.app, t.tc.testbed.dir, t.tc.testbed.extra_shim.dir, 'toilets', '41550.json'), 'utf8'));

  // ① 줄 검사: 좋은 줄 / 위치 틀림 / 이름 빔 / id 겹침 → 버리고 까닭
  const rows = [
    { id: 'a', name: ' 가 ', lat: 37, lng: 127, open: '06:00~22:00', all_day: false, truck: true },
    { id: 'b', name: '나', lat: 10, lng: 127 },
    { id: 'c', name: '  ', lat: 37, lng: 127 },
    { id: 'a', name: '다', lat: 37.1, lng: 127.1 },
    { id: 'd', name: '라', lat: 37, lng: 127, truck: 'yes' },
  ];
  const r1 = tm.checkRows(rows, R, R.src_words.mine);
  t.check('①', '줄 검사: 좋은 1 · 버림 4(위치·이름·겹침·트럭 꼴) · 이름 다듬음 · 모르는 칸은 null', 'a · pos,name,dup,truck · 가 · null',
    r1.good.map((x) => x.id).join(',') + ' · ' + r1.bad.map((b) => b.why).join(',') + ' · ' + r1.good[0].name + ' · ' + r1.good[0].memo,
    r1.good.length === 1 && r1.bad.map((b) => b.why).join(',') === [R.why.pos, R.why.name, R.why.dup, R.why.truck].join(',') && r1.good[0].name === '가' && r1.good[0].memo === null && r1.good[0].src === R.src_words.mine);

  // ② 중계 파일 꼴: 시험용 파일(테스트 베드) 좋은 4 · 틀린 1 / 판 번호가 다르면 던짐
  const p2 = tm.checkPublic(sample, R);
  let threw = false;
  try { tm.checkPublic({ ...sample, [R.file.v_key]: R.file.v + 1 }, R); } catch (e) { threw = true; }
  t.check('②', '중계 파일 꼴: 시험용 파일 좋은 4·틀린 1(위치) · 판 번호 다르면 던짐', '4 · 1 pos · 던짐', p2.good.length + ' · ' + p2.bad.length + ' ' + p2.bad.map((b) => b.why).join(',') + ' · ' + (threw ? '던짐' : '안 던짐'),
    p2.good.length === 4 && p2.bad.length === 1 && p2.bad[0].why === R.why.pos && threw);

  // ③ 휴게소 화장실: 충전소 목록의 휴게소 줄만 · 24시간(설정)·트럭 모름
  const st = { list: [{ id: 'S1', name: '안성휴게소(부산방향)', lat: 37.0133, lng: 127.1449, rest: true }, { id: 'S2', name: '시내 충전소', lat: 37, lng: 127.2, rest: false }] };
  const rest = tm.restOf(st, R);
  t.check('③', '휴게소 화장실: 휴게소 줄만 · id 머리 · 24시간 ' + R.rest.all_day + ' · 트럭 ' + R.rest.truck, '1 · ' + R.rest.id_prefix + 'S1 · rest', rest.length + ' · ' + (rest[0] && rest[0].id) + ' · ' + (rest[0] && rest[0].src),
    rest.length === 1 && rest[0].id === R.rest.id_prefix + 'S1' && rest[0].rest === true && rest[0].all_day === R.rest.all_day && rest[0].truck === R.rest.truck);

  // ④ 합치기: 묘성 것이 이긴다 — 같은 id, 또는 same_m 안(휴게소 화장실도)
  const pub = p2.good;
  const near = { id: 'mine-1', name: '묘성 공도', lat: pub[0].lat + 0.0002, lng: pub[0].lng, open: null, all_day: true, truck: true, memo: '큰 차 칸', rest: false, src: R.src_words.mine };
  const same = { id: pub[1].id, name: '묘성 대덕', lat: 36.9, lng: 127.3, open: null, all_day: null, truck: null, memo: null, rest: false, src: R.src_words.mine };
  const atRest = { id: 'mine-2', name: '묘성 안성', lat: rest[0].lat, lng: rest[0].lng + 0.0003, open: null, all_day: true, truck: false, memo: null, rest: false, src: R.src_words.mine };
  const m = tm.merge(pub, [near, same, atRest], rest, R, geo, G);
  const ids = m.list.map((x) => x.id);
  t.check('④', '합치기: 묘성 3 · 공공 4→2(같은 id·' + R.same_m + 'm 안 빠짐) · 휴게소 1→0 · 묘성 것이 앞', 'mine-1,' + pub[1].id + ',mine-2,' + pub[2].id + ',' + pub[3].id + ' · 진 것 3',
    ids.join(',') + ' · 진 것 ' + m.counts.beaten, ids.join(',') === ['mine-1', pub[1].id, 'mine-2', pub[2].id, pub[3].id].join(',') && m.counts.beaten === 3 && m.counts.mine === 3);

  // ⑤ '앞의 화장실' 셈 — 고속도로 밖(주변): 곧은 거리 차례, 휴게소 화장실은 뺌, 목록 8 · 앞 3 은 목록의 앞 3
  const C = t.cfg('config_toilet_calc');
  const rules = { config_toilet_calc: C, config_ahead: t.cfg('config_ahead'), config_geo: G, config_locate: t.cfg('config_locate'), config_navi: t.cfg('config_navi') };
  const lib = { parts: { ahead, geo, navi }, rules };
  const line = JSON.parse(fs.readFileSync(path.join(t.app, t.tc.testbed.dir, 'scenes', 'lines', 'gyeongbu_down.json'), 'utf8'));
  const toilets = { list: tm.merge(pub, [], rest, R, geo, G).list, lines: [{ name: 'gyeongbu_down', points: line.points }] };
  const fix = { lat: 37.0060, lng: 127.2000, t: 1 };
  const done = { pos: { on_line: false, off_m: 5000, line: null, km: null, dir: null } };
  const list = tcalc.listOf({ fix, toilets }, done, C, lib, null);
  done[C.list_piece] = list;
  const a = tcalc.aheadOf({ fix, toilets }, done, C, lib, null);
  const names = list.items.map((x) => x.name);
  t.check('⑤', '주변: 가까운 차례 · 휴게소 뺌 · 앞 ' + C.count + ' = 목록 앞 ' + C.count, 'around · 공도읍 먼저 · 휴게소 0 · ' + Math.min(C.count, list.items.length) + '곳 같음',
    list.mode + ' · ' + names.join('/') + ' · 휴게소 ' + list.items.filter((x) => x.rest).length + ' · ahead ' + a.items.length,
    list.mode === 'around' && names[0].includes('공도읍') && list.items.every((x) => !x.rest) && a.items.length === Math.min(C.count, list.items.length) && a.items.every((x, i) => x.key === list.items[i].key));

  // ⑥ 고속도로 위('앞'): 휴게소 화장실이 선 km 앞에 — 진행 방향 앞, 남은 거리
  const kmRest = geo.snap({ lat: rest[0].lat, lng: rest[0].lng }, line.points, G).km;
  const done2 = { pos: { on_line: true, off_m: 10, line: 'gyeongbu_down', km: kmRest - 5, dir: t.cfg('config_locate').dir_words.forward } };
  const list2 = tcalc.listOf({ fix: { lat: 37.05, lng: 127.12, t: 2 }, toilets }, done2, C, lib, null);
  const first = list2.items[0];
  t.check('⑥', '고속도로 위: 앞의 휴게소 화장실 · 남은 거리 ≈ 5 km', 'ahead · 안성휴게소 · 5.0', list2.mode + ' · ' + (first ? first.name + ' · ' + first.dist_km : '없음'),
    list2.mode === 'ahead' && !!first && first.name.includes('안성휴게소') && Math.abs(first.dist_km - 5) < 0.2);

  // ⑦ 주차 칸(묘성 11/28): 휴게소 = 트럭 true → 주차 있음(규칙은 설정) · 규칙을 끄거나 트럭 모름이면 모름 · 줄의 parking 세 값 · 틀린 값은 버림 · 묘성 줄 parking · 칸이 없으면 모름
  const off = { ...R, parking: { ...R.parking, rest_by_truck: false } };
  const unk = { ...R, rest: { ...R.rest, truck: null } };
  const p3 = tm.checkRows([
    { id: 'p1', name: '있음', lat: 37, lng: 127, parking: true },
    { id: 'p2', name: '없음', lat: 37.1, lng: 127, parking: false },
    { id: 'p3', name: '모름', lat: 37.2, lng: 127, parking: null },
    { id: 'p4', name: '칸없음', lat: 37.3, lng: 127 },
    { id: 'p5', name: '틀림', lat: 37.4, lng: 127, parking: 'yes' },
  ], R, R.src_words.mine);
  const pk = p3.good.map((x) => String(x.parking)).join(',');
  t.check('⑦', '주차: 휴게소 트럭 ' + R.rest.truck + ' → 주차 있음 · 규칙 끔/트럭 모름 → 모름 · 줄 세 값 true,false,null,null · 틀린 값 1 버림(parking)', '휴게소 true true · 끔 null · 모름 null,null · true,false,null,null · parking',
    '휴게소 ' + rest[0].truck + ' ' + rest[0].parking + ' · 끔 ' + tm.restOf(st, off)[0].parking + ' · 모름 ' + tm.restOf(st, unk)[0].truck + ',' + tm.restOf(st, unk)[0].parking + ' · ' + pk + ' · ' + p3.bad.map((b) => b.why).join(','),
    rest[0].truck === true && rest[0].parking === true && tm.restOf(st, off)[0].parking === null && tm.restOf(st, unk)[0].truck === null && tm.restOf(st, unk)[0].parking === null
      && pk === 'true,false,null,null' && p3.bad.length === 1 && p3.bad[0].why === R.why.parking);
  // 가까운 차례로 다 나오고(주차 있음·없음·모름이 섞여도 거르지 않음) 줄마다 parking 이 실림
  const mixed = { list: tm.merge([{ ...pub[0], parking: false }, { ...pub[1], parking: null }, { ...pub[2], parking: true }], [], rest, R, geo, G).list, lines: [] };
  const list3 = tcalc.listOf({ fix, toilets: mixed }, { pos: done.pos }, C, lib, null);
  const byKey = new Map(mixed.list.map((x) => [x.id, x.parking]));
  const ds = list3.items.map((x) => x.dist_km);
  t.check('⑧', '목록: 주차 있음·없음·모름이 섞여도 다 나오고 가까운 차례(거리 오름차순) · 줄마다 parking 이 toilets 에 있음', '3곳 이상 · 오름차순 · parking 값 3종',
    list3.items.length + '곳 · ' + ds.join('<') + ' · ' + [...new Set(list3.items.map((x) => String(byKey.get(x.key))))].sort().join(','),
    list3.items.length >= 3 && ds.every((d, i) => i === 0 || d >= ds[i - 1]) && new Set(list3.items.map((x) => byKey.get(x.key))).size === 3);
}
