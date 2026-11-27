// 단위 시험: 제목 꾸러미 '충전소'(정비 나 ①)·꽂는 자리(StateCalc.expandTable)·제목 고르기(topicpick ③)·격리(꾸러미 설정을 깨면 충전소만 꺼짐).
// 다리 없이 — 앱은 가짜 창으로 띄우고 물음은 모두 실패로 답한다(만든 것 표만 본다).
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export default async function (t) {
  const statecalc = await t.src('statecalc');
  const topicpick = await t.src('topicpick');
  const SC = t.cfg('config_statecalc');
  const TS = t.cfg('config_topic_station');
  const UT = t.cfg('config_ui_topic');
  const { topicRowsOf } = await import(pathToFileURL(path.join(t.tools, 'lib_appfiles.mjs')).href);
  const { loadBoards, startApp } = await import(pathToFileURL(path.join(t.tools, 'lib_apprun.mjs')).href);

  // ① 꽂는 자리: 기본 표 + 충전소 줄 = 정비 나 전 표의 차례(pos·limit·speed·route·ahead·plan·tap)
  const full = statecalc.expandTable(SC.table, TS.calc_rows, SC.slot_key);
  const order = full.map((r) => r.piece).join(',');
  t.check('①', '꽂는 자리에 충전소 줄을 끼운 표 = 옮기기 전 표의 차례', 'pos,limit,speed,route,ahead,plan,tap', order, order === 'pos,limit,speed,route,ahead,plan,tap');
  const none = statecalc.expandTable(SC.table, [], SC.slot_key).map((r) => r.piece).join(',');
  t.check('②', '제목이 없으면 그 자리는 빔(기본 줄만)', 'pos,limit,speed,route,tap', none, none === 'pos,limit,speed,route,tap');
  t.check('③', '시험 쪽 줄 읽기(topicRowsOf)도 같은 줄', '같음', JSON.stringify(topicRowsOf(t.app, t.tc.build)) === JSON.stringify(TS.calc_rows) ? '같음' : '다름', JSON.stringify(topicRowsOf(t.app, t.tc.build)) === JSON.stringify(TS.calc_rows));

  // ④~⑦ 제목 고르기
  const h = topicpick.hashOf('toilet', UT);
  t.check('④', '주소 꼬리 만들기·읽기가 맞물림', 'toilet', topicpick.hashName(h, UT), topicpick.hashName(h, UT) === 'toilet');
  t.check('⑤', '주소 꼬리가 없거나 모르는 제목이면 첫 꾸러미', 'station / station', topicpick.activeOf(['station', 'toilet'], topicpick.hashName('', UT)) + ' / ' + topicpick.activeOf(['station'], 'nope'),
    topicpick.activeOf(['station', 'toilet'], topicpick.hashName('', UT)) === 'station' && topicpick.activeOf(['station'], 'nope') === 'station');
  t.check('⑥', '남긴 제목이 다르고 목록에 있으면 그 제목으로 다시 켬 · 같거나 없으면 안 켬', 'toilet · null · null',
    [topicpick.wantOf(['station', 'toilet'], 'station', 'toilet'), topicpick.wantOf(['station'], 'station', 'station'), topicpick.wantOf(['station'], 'station', 'toilet')].join(' · '),
    topicpick.wantOf(['station', 'toilet'], 'station', 'toilet') === 'toilet' && topicpick.wantOf(['station'], 'station', 'station') === null && topicpick.wantOf(['station'], 'station', 'toilet') === null);
  t.check('⑦', '꼬리의 다른 칸(#a=1&topic=x)도 읽음 · 틀린 꼴은 null', 'x · null', topicpick.hashName('#a=1&topic=x', UT) + ' · ' + topicpick.hashName('#topic=%E0', UT), topicpick.hashName('#a=1&topic=x', UT) === 'x' && topicpick.hashName('#topic=%E0', UT) === null);

  // ⑧~⑩ 앱 조립: 그대로 / 꾸러미 설정을 깸
  const main = (await t.src('app')).main;
  const boards = await loadBoards(t.app, t.tc);
  const fetchFn = async () => { throw new Error('다리 없음(단위 시험)'); };
  const a = startApp({ app: t.app, tc: t.tc, main, boards }, { fetchFn, stamp: 'unit-topic' });
  const ok = !!(a.made.topic_station && a.made.relay_status && a.made.ui_station && a.made.ui_route && a.made.calcrunner);
  const io = a.made.calcrunner ? a.made.calcrunner.io().outputs.join(',') : '-';
  t.check('⑧', '설정 그대로: 충전소 꾸러미가 켜져 상태 받기·정보 칸·목록 칸이 만들어지고 계산기가 ahead·plan 을 냄', '만듦 · pos,limit,speed,route,ahead,plan,tap', (ok ? '만듦' : '빠짐') + ' · ' + io, ok && io === 'pos,limit,speed,route,ahead,plan,tap');
  // (11/27) 단추 글 = 설정 texts.open 의 자리에 제목 글(예: '충전소 ▾')
  const openText = UT.texts.open.split(UT.slot).join(TS.label);
  t.check('⑨', '제목 단추: 켠 제목 = station, 단추 글 = ' + openText, 'station · ' + openText, (a.made.ui_topic ? a.made.ui_topic.active() : '-') + ' · ' + (a.el(UT.ids.open) ? a.el(UT.ids.open).textContent : '-'), a.made.ui_topic && a.made.ui_topic.active() === 'station' && a.el(UT.ids.open) && a.el(UT.ids.open).textContent === openText);
  a.stop();
  const b = startApp({ app: t.app, tc: t.tc, main, boards }, { fetchFn, stamp: 'unit-topic', overrides: { config_topic_station: { label: TS.label } } });
  const off = !b.made.topic_station && !b.made.relay_status && !b.made.ui_station && !b.made.ui_route;
  const basic = !!(b.made.calcrunner && b.made.ui_map && b.made.ui_navi && b.made.relay_stations && b.made.ui_boards);
  const io2 = b.made.calcrunner ? b.made.calcrunner.io().outputs.join(',') : '-';
  t.check('⑩', '격리: 충전소 꾸러미 설정을 깸(calc_rows 빠짐) → 충전소만 꺼지고(상태 받기·정보 칸·목록 칸 없음) 기본 기능(지도·검색·판·계산 기본 줄)은 만들어짐', '꺼짐 · 기본 있음 · pos,limit,speed,route,tap',
    (off ? '꺼짐' : '안 꺼짐') + ' · ' + (basic ? '기본 있음' : '기본 빠짐') + ' · ' + io2, off && basic && io2 === 'pos,limit,speed,route,tap');
  b.stop();
}
