// 단위 시험: 제목 꾸러미 '화장실'(추가3) — 새 파일만으로 붙나 · 두 제목 오가기(판·목록·지도 조각이 바뀌고 기본 기능은 그대로) · 격리 · 화장실 받기(없음·깨짐·좋음).
// 다리 없이 — 앱은 가짜 창으로 띄우고 물음은 모두 실패로 답한다(만든 것 표·계산 표·판을 본다). 받기는 가짜 State·가짜 중계로.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export default async function (t) {
  const { loadBoards, startApp } = await import(pathToFileURL(path.join(t.tools, 'lib_apprun.mjs')).href);
  const { loadAppConfig } = await import(pathToFileURL(path.join(t.tools, 'lib_appfiles.mjs')).href);
  const { createConfig } = await t.src('cfg');
  const health = await t.src('health');
  const topicpick = await t.src('topicpick');
  const UT = t.cfg('config_ui_topic');
  const TT = t.cfg('config_topic_toilet');
  const TS = t.cfg('config_topic_station');
  const RT = t.cfg('config_relay_toilets');
  const hash = topicpick.hashOf('toilet', UT);
  const main = (await t.src('app')).main;
  const boards = await loadBoards(t.app, t.tc);
  const fetchFn = async () => { throw new Error('다리 없음(단위 시험)'); };
  const basicOk = (m) => !!(m.calcrunner && m.ui_map && m.ui_navi && m.ui_tap && m.relay_stations && m.relay_limit && m.net_route && m.ui_my && m.ui_topic);

  // ① 충전소(주소 꼬리 없음 — 첫 꾸러미): 화장실 것은 하나도 안 만듦, 제목 목록은 둘
  const a = startApp({ app: t.app, tc: t.tc, main, boards }, { fetchFn, stamp: 'unit-toilet' });
  const mA = a.made.ui_boards ? a.made.ui_boards.mounted() : [];
  const ioA = a.made.calcrunner ? a.made.calcrunner.io().outputs.join(',') : '-';
  t.check('①', '충전소 켬: 충전소판 꽂힘·화장실판 없음 · 화장실 받기·칸 없음 · 계산 표 = 충전소 줄', 'station · ui_ahead · 화장실 0 · pos,limit,speed,route,ahead,plan,tap',
    (a.made.ui_topic && a.made.ui_topic.active()) + ' · ' + mA.join(',') + ' · 화장실 ' + ['relay_toilets', 'ui_toilet_list', 'ui_toilet_card'].filter((n) => a.made[n]).length + ' · ' + ioA,
    a.made.ui_topic && a.made.ui_topic.active() === 'station' && mA.includes('ui_ahead') && !mA.includes('ui_toilet_board') && !a.made.relay_toilets && !a.made.ui_toilet_list && ioA === 'pos,limit,speed,route,ahead,plan,tap' && basicOk(a.made));
  a.stop();

  // ② 화장실(#topic=toilet): 화장실 받기·목록·정보 칸 · 화장실판 · 계산 표 = 화장실 줄 · 기본 기능 그대로 · 충전소 것 없음
  const b = startApp({ app: t.app, tc: t.tc, main, boards }, { fetchFn, stamp: 'unit-toilet', hash });
  const mB = b.made.ui_boards ? b.made.ui_boards.mounted() : [];
  const ioB = b.made.calcrunner ? b.made.calcrunner.io().outputs.join(',') : '-';
  const want = 'pos,limit,speed,route,toilet.list,ahead,tap';
  t.check('②', '화장실 켬: 화장실 받기·목록 칸·정보 칸·화장실판 · 계산 표에 화장실 줄 · 충전소 상태 받기·정보 칸·목록 칸·충전소판 없음 · 기본 기능 다 만듦', 'toilet · ui_speed,ui_toilet_board · ' + want + ' · 충전소 0 · 기본 있음',
    (b.made.ui_topic && b.made.ui_topic.active()) + ' · ' + mB.join(',') + ' · ' + ioB + ' · 충전소 ' + ['relay_status', 'ui_station', 'ui_route'].filter((n) => b.made[n]).length + ' · ' + (basicOk(b.made) ? '기본 있음' : '기본 빠짐'),
    b.made.ui_topic && b.made.ui_topic.active() === 'toilet' && b.made.relay_toilets && b.made.ui_toilet_list && b.made.ui_toilet_card && mB.includes('ui_toilet_board') && !mB.includes('ui_ahead') && mB.includes('ui_speed')
      && ioB === want && !b.made.relay_status && !b.made.ui_station && !b.made.ui_route && basicOk(b.made));
  const btn = b.el(UT.ids.open);
  const openText = UT.texts.open.split(UT.slot).join(TT.label);
  const LC = t.cfg('config_ui_toilet_list');
  const lb = b.el(LC.ids.open);
  t.check('③', '제목 단추 글 = ' + openText + ' · 화장실 목록 단추가 더 보기 묶음에 · 그림 글자·화면 읽기 글을 스스로 닮', openText + ' · ' + LC.glyph + ' · ' + LC.texts.open_label,
    (btn ? btn.textContent : '-') + ' · ' + (lb ? lb.getAttribute('data-glyph') : '-') + ' · ' + (lb ? lb.getAttribute('aria-label') : '-'),
    !!btn && btn.textContent === openText && !!lb && lb.getAttribute('data-glyph') === LC.glyph && lb.getAttribute('aria-label') === LC.texts.open_label);
  // 지도 누름 이름: 화장실 꾸러미의 map.select_piece 를 지도가 가짐(State 주인)
  let mapOwns = null;
  try { b.made.state.claim('시험', [TT.map.select_piece]); mapOwns = false; } catch (e) { mapOwns = true; }
  t.check('④', '지도의 누름 요청 이름 = 화장실 것(' + TT.map.select_piece + ' — 지도가 주인이라 다른 쪽은 못 잡음)', '지도가 주인', mapOwns ? '지도가 주인' : '주인 없음', mapOwns === true);
  b.stop();

  // ⑤ 더하기: 등급·기능·이름 글·중계 파일 무늬가 꾸러미 설정에서 더해짐 · 부딪힘 0
  const raw = loadAppConfig(t.app, t.tc.build, {}).raw;
  const C = createConfig(raw);
  const H = C.section('config_health');
  const US = C.section('config_ui_status');
  const RB = C.section('config_relay_base');
  const okAdds = H.grades.config_toilet_calc === 'toilet' && H.grades.config_toilet_mine === 'toilet_mine' && !!H.features.toilet && H.conn_source[RT.conn_piece] === 'toilet'
    && US.texts.feature_names.toilet === TT.adds.config_ui_status.texts.feature_names.toilet && RB.file_res.some((p) => new RegExp(p).test(RT.file));
  // (시험은 앱 비밀 값·빌드 기록 없이 읽어 그 둘의 문제는 늘 있음 — 더하기 부딪힘·화장실 설정 문제만 셈)
  const addProbs = C.problems().filter((p) => p.why === 'adds_clash' || /toilet/.test(p.file));
  t.check('⑤', '꾸러미 adds 가 등급 표·기능·연결 출처·이름 글·중계 파일 무늬에 더해짐 · 부딪힘·화장실 설정 문제 0', '더해짐 · 문제 0', (okAdds ? '더해짐' : '빠짐') + ' · 문제 ' + addProbs.length + (addProbs.length ? ' ' + JSON.stringify(addProbs) : ''), okAdds && addProbs.length === 0);

  // ⑥ 빌드: 꾸러미 화면 조각이 views_order 에 없어도 정한 자리(topic_views_after) 뒤에 들어감
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'web2-unit-toilet-'));
  const r = spawnSync(process.execPath, [path.join(t.tools, 'build.mjs'), '--out', out], { encoding: 'utf8' });
  const html = r.status === 0 ? fs.readFileSync(path.join(out, t.tc.build.out_file), 'utf8') : '';
  fs.rmSync(out, { recursive: true, force: true });
  const iRoute = html.indexOf('id="ev-route"');
  const iList = html.indexOf('id="' + LC.ids.root + '"');
  const iCard = html.indexOf('id="' + t.cfg('config_ui_toilet_card').ids.root + '"');
  const iMy = html.indexOf('id="ev-my"');
  t.check('⑥', '빌드: 화장실 화면 조각이 ' + t.tc.build.topic_views_after + ' 뒤·그다음 조각 앞에 (목록 → 정보 칸)', '빌드 됨 · 목록 칸 < 정보 칸 사이',
    (r.status === 0 ? '빌드 됨' : '빌드 실패 ' + (r.stderr || '').trim()) + ' · ' + [iRoute, iList, iCard, iMy].join('<'), r.status === 0 && iRoute > 0 && iRoute < iList && iList < iCard && iCard < iMy);

  // ⑦ 격리: 화장실 꾸러미 설정을 깸(calc_rows 빠짐) + 주소 꼬리는 화장실 → 화장실만 빠지고 충전소로 켜짐
  const c = startApp({ app: t.app, tc: t.tc, main, boards }, { fetchFn, stamp: 'unit-toilet', hash, overrides: { config_topic_toilet: { label: TT.label } } });
  const ioC = c.made.calcrunner ? c.made.calcrunner.io().outputs.join(',') : '-';
  t.check('⑦', '격리: 화장실 꾸러미 설정 깨짐 → 화장실 제목만 빠지고(받기·칸 없음) 충전소 제목으로 켜짐 · 기본 기능 그대로', 'station · 화장실 0 · 충전소 칸 있음 · pos,limit,speed,route,ahead,plan,tap',
    (c.made.ui_topic && c.made.ui_topic.active()) + ' · 화장실 ' + ['topic_toilet', 'relay_toilets', 'ui_toilet_list'].filter((n) => c.made[n]).length + ' · ' + (c.made.ui_station && c.made.ui_route ? '충전소 칸 있음' : '충전소 칸 없음') + ' · ' + ioC,
    c.made.ui_topic && c.made.ui_topic.active() === 'station' && !c.made.topic_toilet && !c.made.relay_toilets && c.made.ui_station && c.made.ui_route && ioC === 'pos,limit,speed,route,ahead,plan,tap' && basicOk(c.made));
  c.stop();

  // ⑧ 격리: 묘성 자료 설정만 깸(rows 가 목록 아님) → 묘성 자료만 꺼짐(기능 toilet_mine), 화장실 받기는 만들어짐
  const d = startApp({ app: t.app, tc: t.tc, main, boards }, { fetchFn, stamp: 'unit-toilet', hash, overrides: { config_toilet_mine: { rows: 'x', example: {} } } });
  // 가짜 창은 앱 비밀 값이 없어 그 문제(등급 app)는 늘 있음 — 묘성 자료 설정의 문제만으로 판정
  const probs = d.made.cfg.problems().filter((p) => p.file === 'config_toilet_mine');
  const offs = health.judgeConfigOff({ problems: probs }, d.made.cfg.section('config_health'));
  const app1 = health.judgeApp({ problems: probs, start: {}, startedAt: 0, now: 0, prev: null }, d.made.cfg.section('config_health'));
  t.check('⑧', '묘성 자료 깨짐 → 꺼지는 기능 = toilet_mine 만 · 앱은 점검 중 아님 · 화장실 받기 있음(묘성 0줄)', 'toilet_mine · starting · 받기 있음 · 0',
    offs.join(',') + ' · ' + app1.stage + ' · ' + (d.made.relay_toilets ? '받기 있음 · ' + d.made.relay_toilets.mine().length : '받기 없음'),
    probs.length > 0 && offs.join(',') === 'toilet_mine' && app1.stage === 'starting' && !!d.made.relay_toilets && d.made.relay_toilets.mine().length === 0);
  d.stop();

  // ⑨~⑪ 화장실 받기: 가짜 State·가짜 중계 — 없음(none) / 깨짐(판 번호 다름) / 좋음, 그리고 묘성 자료가 이김
  const { createRelayToilets } = await t.src('relay_toilets');
  const tm = await t.src('toiletmerge');
  const geo = await t.src('geo');
  const sample = JSON.parse(fs.readFileSync(path.join(t.app, t.tc.testbed.dir, t.tc.testbed.extra_shim.dir, 'toilets', 'list.json'), 'utf8'));
  const mineRow = { id: 'mine-x', name: '묘성 공도', lat: sample.items[0].lat + 0.0001, lng: sample.items[0].lng, open: null, all_day: true, truck: true, memo: null };
  const cfg2 = createConfig({ ...raw, files: { ...raw.files, config_toilet_mine: { ...raw.files.config_toilet_mine, rows: [mineRow, { id: 'bad', name: 'x', lat: 0, lng: 0 }] } } });
  async function run(answer) {
    const pubs = {};
    const subs = {};
    const warns = [];
    const state = { claim: () => (name, v) => { (pubs[name] = pubs[name] || []).push(v); }, subscribe: (name, fn) => { subs[name] = fn; } };
    const logs = { info() {}, warn: (w, word, p) => warns.push(word), error: (e) => warns.push(String(e)) };
    const clock = { now: () => 1, setTimeout: () => 1, clearTimeout() {} };
    const relay = createRelayToilets({ cfg: cfg2, log: logs, state, clock, relay_base: { get: async () => answer }, toiletmerge: tm, geomath: geo });
    subs[RT.stations_piece]({ list: [{ id: 'R1', name: '안성휴게소', lat: 37.0133, lng: 127.1449, rest: true }], lines: [{ name: 'L', points: [] }] });
    subs[RT.app_piece]({ stage: cfg2.section('config_health').stages.good });
    await new Promise((res) => setTimeout(res, 20));
    relay.halt();
    const last = (pubs[RT.piece] || []).slice(-1)[0] || null;
    return { conn: (pubs[RT.conn_piece] || []).slice(-1)[0] || null, last, warns, mine: relay.mine().length };
  }
  const none = await run({ ok: false, code: 'none', src: 'data' });
  t.check('⑨', '공공 자료 없음(none): 끊김 알림 · 그래도 휴게소 1 + 묘성 1 줄을 냄(틀린 묘성 줄 1 은 버리고 기록)', 'conn 거짓 none · 줄 2(mine,rest) · 선 실음 · 기록 ' + RT.word_bad_mine,
    'conn ' + (none.conn && none.conn.ok) + ' ' + (none.conn && none.conn.code) + ' · 줄 ' + (none.last ? none.last.list.length + '(' + none.last.list.map((x) => x.src).join(',') + ')' : '없음') + ' · 선 ' + (none.last && none.last.lines.length) + ' · 기록 ' + none.warns.join(','),
    none.conn && none.conn.ok === false && none.conn.code === 'none' && none.last && none.last.list.length === 2 && none.last.lines.length === 1 && none.warns.includes(RT.word_bad_mine));
  const broken = await run({ ok: true, data: { ...sample, v: 99 } });
  t.check('⑩', '공공 자료 깨짐(판 번호 다름): 끊김(bad) 알림 · 기록 bad_file · 휴게소·묘성 줄은 그대로', 'conn 거짓 ' + RT.codes.bad + ' · 기록 ' + RT.word_bad_file + ' · 줄 2',
    'conn ' + (broken.conn && broken.conn.ok) + ' ' + (broken.conn && broken.conn.code) + ' · 기록 ' + broken.warns.join(',') + ' · 줄 ' + (broken.last ? broken.last.list.length : '없음'),
    broken.conn && broken.conn.ok === false && broken.conn.code === RT.codes.bad && broken.warns.includes(RT.word_bad_file) && broken.last && broken.last.list.length === 2);
  const good = await run({ ok: true, data: sample });
  const ids = good.last ? good.last.list.map((x) => x.id) : [];
  t.check('⑪', '공공 자료 좋음: conn 참 · 틀린 공공 줄 1 버리고 기록 · 묘성 줄이 같은 자리(공도읍) 공공 줄을 이김 · 합 = 묘성 1 + 공공 3 + 휴게소 1', 'conn 참 · 기록 bad_items · mine-x 있음·pub-t-001 없음 · 5',
    'conn ' + (good.conn && good.conn.ok) + ' · 기록 ' + good.warns.join(',') + ' · ' + ids.join(','),
    good.conn && good.conn.ok === true && good.warns.includes(RT.word_bad_items) && ids.includes('mine-x') && !ids.includes('pub-t-001') && ids.length === 5);
}
