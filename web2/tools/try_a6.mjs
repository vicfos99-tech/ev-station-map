// A6 스스로 시험(주소 검색 · 경로 · 기록 올리기 — 순수 셈 + 가상 창 + 진짜 크롬).
//   node web2/tools/try_a6.mjs                 # 전부
//   node web2/tools/try_a6.mjs pure|app|chrome  # 그 부분만
// ① 순수: 답 검사(장소·길 — 모르는 칸·범위 밖·판 번호·개수) · 노선 꼴(이음·km·지우기) · 경로 기준 앞의 충전소(갈아타는 곳 너머 · 끝 뒤 채움 · 벗어나면 선 기준) · 검색 글 검사
// ② S9: 정상·느림·실패·돌아옴 — 검색해도 속도판·충전소판·지도 상태 그대로, 경로 선·경로 기준 앞의 충전소, 답마다 다른 글(서버에 못 닿음·느림·시간 넘음·실패·오늘 한도·집 PC 끊김·이상한 답), 입력 검사
// ③ S10: '이상해'를 눌러도 올리기 0건 → '기록 올리기'로 한꺼번에 · 받음·거절 글 · 저절로 다시 안 감 · 도는 중 또 누름 · 꽉 참이면 앞에서 멈춤
// ④ S7: 집 PC 끊김 동안 길찾기·기록 올리기만 '사용 불가', 나머지 화면 그대로 · 돌아오면 풀림
// ⑤ 진짜 크롬 네 창: 검색 칸·결과 목록·경로가 판·저작권·아래 띠·정보 칸을 덮지 않음 · 숫자 잘림 0 · 누르는 높이 48
// 표로 찍고 하나라도 실패면 0 아닌 코드. 기록장 tools/logs/try_a6.log, 표 사본 tools/logs/try_a6_last[_부분].md.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadToolsConfig, appDir, toolLog, kstText } from './lib_tools.mjs';
import { testbedInfo, makeSecret, writeSecretFile, startBridge, selectScene, seekScene, fetchWithLines, call } from './lib_testbed.mjs';
import { sleep, loadBoards, startApp as runApp, waitFor } from './lib_apprun.mjs';
import { measureInChrome, overlapArea, inside } from './lib_chrome.mjs';

const tc = loadToolsConfig();
const T = tc.try_a6;
const L = tc.layout;
const APP = appDir(tc);
const log = toolLog(tc, 'try_a6');
const cfgOf = (name) => JSON.parse(fs.readFileSync(path.join(APP, tc.build.config_dir, name + tc.build.config_ext), 'utf8'));
const srcOf = async (name) => import(pathToFileURL(path.join(APP, tc.build.src_dir, name + '.js')).href);
const NR = cfgOf('config_net_route');
const RR = cfgOf('config_naviroute');
const NV = cfgOf('config_navi');
const AH = cfgOf('config_ahead');
const LC = cfgOf('config_locate');
const G = cfgOf('config_geo');
const FC = cfgOf('config_formcheck');
const UN = cfgOf('config_ui_navi');
const UL = cfgOf('config_ui_log');
const UST = cfgOf('config_ui_status');
const HC = cfgOf('config_health');
const NC = cfgOf('config_netcore');
const ST = cfgOf('config_store');
const UM = cfgOf('config_ui_map');
const UA = cfgOf('config_ui_ahead');
const SP = cfgOf('config_ui_speed');
const { main } = await import(pathToFileURL(path.join(APP, tc.build.src_dir, 'app.js')).href);
const BOARDS = await loadBoards(APP, tc);
let INFO = null;
let SECRET = null;
let SECRET_FILE = null;

const rows = [];
function row(no, title, expect, actual, ok) {
  rows.push({ no, title, expect, actual, ok: !!ok });
  log.write(ok ? '통과' : '실패', { no, title, expect, actual });
}
const wait = (fn, ms) => waitFor(fn, ms, tc.testbed.poll_ms);
const throws = (fn) => { try { fn(); return false; } catch (e) { return true; } };
const unesc = (s) => s.replace(/\\u([0-9a-fA-F]{4})/g, (m, h) => String.fromCharCode(parseInt(h, 16)));

// 두 점 사이 거리(km) — 앱의 geo 와 따로(시험 쪽 셈)
function km(a, b) {
  const k = Math.PI / 180;
  const p1 = a[0] * k; const p2 = b[0] * k; const dl = (b[1] - a[1]) * k;
  const c = Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(dl);
  return G.earth_radius_m * Math.acos(Math.min(1, Math.max(-1, c))) / G.m_per_km;
}
function polyKm(pts) { let s = 0; for (let i = 1; i < pts.length; i += 1) s += km(pts[i - 1], pts[i]); return s; }
function linePts(from, to, step) {
  const n = Math.max(1, Math.round(Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1])) / step));
  const out = [];
  for (let i = 0; i <= n; i += 1) out.push([from[0] + (to[0] - from[0]) * i / n, from[1] + (to[1] - from[1]) * i / n]);
  return out;
}

// ---------- ① 순수 ----------
async function partPure() {
  const nr = await srcOf('naviroute');
  const nv = await srcOf('navi');
  const ah = await srcOf('ahead');
  const lo = await srcOf('locate');
  const geo = await srcOf('geo');
  const fc = await srcOf('formcheck');
  const P = T.pure;
  const s9 = JSON.parse(fs.readFileSync(path.join(APP, tc.testbed.dir, 'scenes', T.s9.scene + tc.build.config_ext), 'utf8'));
  const goodPlaces = s9.responses['/v1/place'][0].body;
  // ①-1 장소 답 검사
  const ok1 = nr.checkPlaces(goodPlaces, RR);
  const variants = [
    ['모르는 칸(맨 위)', { ...goodPlaces, extra: 1 }],
    ['모르는 칸(장소)', { ...goodPlaces, places: [{ ...goodPlaces.places[0], phone: '1' }] }],
    ['좌표 범위 밖', { ...goodPlaces, places: [{ ...goodPlaces.places[0], loc: [10, 127] }] }],
    ['판 번호', { ...goodPlaces, v: RR.v + 1 }],
    ['ok 거짓', { ...goodPlaces, ok: false }],
    ['개수 한도', { ...goodPlaces, places: Array.from({ length: RR.max_places + 1 }, () => goodPlaces.places[0]) }],
    ['이름에 제어 문자', { ...goodPlaces, places: [{ ...goodPlaces.places[0], name: 'a' + String.fromCharCode(7) }] }],
    ['이름 너무 김', { ...goodPlaces, places: [{ ...goodPlaces.places[0], name: 'a'.repeat(RR.text_max_chars + 1) }] }],
    ['모르는 종류', { ...goodPlaces, places: [{ ...goodPlaces.places[0], kind: 'shop' }] }],
  ];
  const rej = variants.map(([n, d]) => [n, throws(() => nr.checkPlaces(d, RR))]);
  row('①-1', '장소 답 검사 — 장면 S9 의 답은 받고, 모르는 칸·좌표 범위 밖·판 번호·ok 거짓·개수 한도·제어 문자·긴 이름·모르는 종류는 거절(던짐)',
    '받음 3곳(첫 곳 ' + goodPlaces.places[0].name + ') · 거절 ' + variants.length + '/' + variants.length,
    '받음 ' + ok1.places.length + '곳(' + ok1.places[0].name + ' ' + ok1.places[0].lat + ',' + ok1.places[0].lng + ') · 거절 ' + rej.filter((x) => x[1]).length + '/' + rej.length + (rej.some((x) => !x[1]) ? ' (안 걸림: ' + rej.filter((x) => !x[1]).map((x) => x[0]).join(', ') + ')' : ''),
    ok1.places.length === 3 && ok1.places[0].lat === goodPlaces.places[0].loc[0] && rej.every((x) => x[1]));
  // ①-2 길 답 검사
  const line = JSON.parse(fs.readFileSync(path.join(APP, tc.testbed.dir, 'scenes', 'lines', s9.route.legs[0].line + tc.build.config_ext), 'utf8'));
  const part1 = line.points.slice(0, 20);
  const part2 = line.points.slice(19, 40);
  const goodRoute = { v: RR.v, ok: true, source: 'own', at: '20261126010000', stored_at: '20261126010000', dist_km: 10, pieces: [{ road: '경부고속도로', line: part1, km: polyKm(part1) }, { road: '경부고속도로', line: part2, km: polyKm(part2) }] };
  const ok2 = nr.checkRoute(goodRoute, RR);
  const rv = [
    ['모르는 칸', { ...goodRoute, extra: 1 }],
    ['조각의 모르는 칸', { ...goodRoute, pieces: [{ ...goodRoute.pieces[0], speed: 1 }] }],
    ['조각 없음', { ...goodRoute, pieces: [] }],
    ['점 범위 밖', { ...goodRoute, pieces: [{ ...goodRoute.pieces[0], line: [[0, 0], [1, 1]] }] }],
    ['km 음수', { ...goodRoute, pieces: [{ ...goodRoute.pieces[0], km: -1 }] }],
    ['source 모름', { ...goodRoute, source: 'web' }],
  ];
  const rrj = rv.map(([n, d]) => [n, throws(() => nr.checkRoute(d, RR))]);
  row('①-2', '길 답 검사 — 우리 모양 답은 받고, 모르는 칸·조각 없음·점 범위 밖·km 음수·모르는 출처는 거절', '받음 조각 2 · 거절 ' + rv.length + '/' + rv.length,
    '받음 조각 ' + ok2.pieces.length + ' · 거절 ' + rrj.filter((x) => x[1]).length + '/' + rrj.length + (rrj.some((x) => !x[1]) ? ' (안 걸림: ' + rrj.filter((x) => !x[1]).map((x) => x[0]).join(', ') + ')' : ''),
    ok2.pieces.length === 2 && rrj.every((x) => x[1]));
  // ①-3 노선 꼴
  const lib = { parts: { geo, navi: nv }, rules: { config_geo: G, config_navi: NV, config_locate: LC } };
  const ans = { seq: 5, dest: { name: 'x', lat: 1, lng: 2 }, ...ok2 };
  const rt = nr.routeOf({ 'route.answer': ans }, {}, RR, lib, null);
  const wantKm = polyKm(part1) + polyKm(part2);
  const cleared = nr.routeOf({ 'route.answer': ans, 'route.clear': { seq: 5 } }, {}, RR, lib, rt);
  const older = nr.routeOf({ 'route.answer': ans, 'route.clear': { seq: 4 } }, {}, RR, lib, null);
  row('①-3', '노선 꼴 — 조각 둘을 이음(이음매의 같은 점 하나로) · 누적 km(시험이 따로 셈) · 지우기(seq 5 ≥ 답 5)면 없음 · 앞 지우기(seq 4)는 경로 그대로',
    '점 ' + (part1.length + part2.length - 1) + ' · km ' + wantKm.toFixed(3) + ' · 지운 뒤 null · 앞 지우기 뒤 경로',
    '점 ' + rt.points.length + ' · km ' + rt.total_km.toFixed(3) + ' · 지운 뒤 ' + JSON.stringify(cleared) + ' · 앞 지우기 뒤 ' + (older ? '경로' : 'null'),
    rt.points.length === part1.length + part2.length - 1 && Math.abs(rt.total_km - wantKm) < 0.01 && cleared === null && !!older);
  // ①-4~6 경로 기준 앞의 충전소(시험 선 둘)
  const A = linePts(P.line_a.from, P.line_a.to, P.line_a.step_deg);
  const B = linePts(P.line_b.from, P.line_b.to, P.line_b.step_deg);
  const lines = [{ name: P.line_a.name, points: A }, { name: P.line_b.name, points: B }];
  const list = P.stations.map((s) => (s.line === 'a'
    ? { id: s.id, name: s.name, lat: P.line_a.from[0] + P.off_deg, lng: s.at, rest: true, operator: '시험' }
    : { id: s.id, name: s.name, lat: s.at, lng: P.line_b.from[1] + P.off_deg, rest: true, operator: '시험' }));
  const st = { list, lines };
  const ra = { ...AH, line_dir_words: P.dir_words };
  const rules = { config_geo: G, config_locate: LC, config_navi: NV };
  const L2 = { parts: { geo, navi: nv }, rules };
  const fix = { t: 1, lat: P.me[0], lng: P.me[1], heading_deg: P.heading };
  const pos = lo.locate({ fix, stations: st }, {}, LC, L2);
  const keys = (a) => (a && a.items ? a.items.map((it) => it.key) : []);
  const noRoute = ah.aheadOf({ fix, stations: st }, { pos }, ra, L2, null);
  // 경로: A 선 처음부터 갈림 지점까지 + B 선 북쪽으로
  const junction = P.line_b.from;
  const routePts = [...linePts(P.line_a.from, junction, P.line_a.step_deg), ...linePts(junction, [P.route_b_to, junction[1]], P.line_b.step_deg).slice(1)];
  const mkRoute = (pts, seq) => nr.routeOf({ 'route.answer': { seq, dest: {}, source: 'own', pieces: [{ road: '', line: pts, km: polyKm(pts) }] } }, {}, RR, lib, null);
  const route = mkRoute(routePts, 1);
  const withRoute = ah.aheadOf({ fix, stations: st }, { pos, route }, ra, L2, null);
  // 시험 쪽 기대 거리: 경로를 따라(갈림 지점까지 A, 그 뒤 B)
  const toJ = km(P.me, [P.me[0], junction[1]]);
  const exp = { AE1: km(P.me, [P.me[0], 127.10]), AE2: km(P.me, [P.me[0], 127.20]), BN1: toJ + km(junction, [36.10, junction[1]]) };
  const distOk = withRoute && withRoute.items.every((it) => Math.abs(it.dist_km - exp[it.key]) <= P.tol_km);
  row('①-4', '경로 기준 — 경로가 A 선을 동쪽으로 가다 갈림에서 B 선 북쪽으로: 경로 위 차례로(갈아타는 곳 너머 B 의 휴게소까지), 갈림 뒤 A 선의 곳·반대 방향 곳은 뺌 · 경로가 없으면 지금 선만',
    '경로 없음 ' + P.expect_line.join(',') + ' · 경로 ' + P.expect_route.join(',') + '(모드 ' + AH.modes.route + ') · 거리 ' + P.expect_route.map((k) => exp[k].toFixed(1)).join('/') + '(±' + P.tol_km + ')',
    '경로 없음 ' + keys(noRoute).join(',') + '(' + (noRoute && noRoute.mode) + ') · 경로 ' + keys(withRoute).join(',') + '(' + (withRoute && withRoute.mode) + ') · 거리 ' + (withRoute ? withRoute.items.map((it) => it.dist_km).join('/') : '-'),
    keys(noRoute).join() === P.expect_line.join() && keys(withRoute).join() === P.expect_route.join() && withRoute.mode === AH.modes.route && distOk);
  const shortPts = linePts(P.line_a.from, [P.line_a.from[0], P.short_end], P.line_a.step_deg);
  const shortRoute = mkRoute(shortPts, 2);
  const withShort = ah.aheadOf({ fix, stations: st }, { pos, route: shortRoute }, ra, L2, null);
  const left = km(P.me, [P.me[0], P.short_end]);
  const expS = { AE1: exp.AE1, AE2: left + km([P.me[0], P.short_end], [P.me[0], 127.20]), AE3: left + km([P.me[0], P.short_end], [P.me[0], 127.35]) };
  row('①-5', '경로 끝 뒤 — 경로가 ' + P.short_end + '° 에서 끝나면 경로 위 곳 다음은 끝의 고속도로(A)를 끝 방향으로 이어서 채움(거리 = 남은 경로 + 끝에서)',
    P.expect_short.join(',') + ' · 경로 위 ' + '참,거짓,거짓' + ' · 거리 ' + P.expect_short.map((k) => expS[k].toFixed(1)).join('/'),
    keys(withShort).join(',') + ' · 경로 위 ' + (withShort ? withShort.items.map((it) => (it.on_route ? '참' : '거짓')).join(',') : '-') + ' · 거리 ' + (withShort ? withShort.items.map((it) => it.dist_km).join('/') : '-'),
    keys(withShort).join() === P.expect_short.join() && withShort.items.map((it) => it.on_route).join() === 'true,false,false' && withShort.items.every((it) => Math.abs(it.dist_km - expS[it.key]) <= P.tol_km));
  const offFix = { t: 2, lat: P.off_me[0], lng: P.off_me[1], heading_deg: P.heading };
  const offPos = lo.locate({ fix: offFix, stations: st }, {}, LC, L2);
  const direct = nv.aheadOnRoute({ fix: offFix, route, places: [], lines }, ra, NV, LC, geo, G);
  const offAhead = ah.aheadOf({ fix: offFix, stations: st }, { pos: offPos, route }, ra, L2, null);
  row('①-6', '경로에서 벗어남(' + Math.round(km(P.me, P.off_me) * 1000) + ' m — 문턱 ' + NV.off_route_m + ' m) → 경로 기준을 쓰지 않고 선·주변 셈으로', 'navi null · 모드 ' + AH.modes.route + ' 아님',
    'navi ' + JSON.stringify(direct) + ' · 모드 ' + (offAhead && offAhead.mode), direct === null && offAhead && offAhead.mode !== AH.modes.route);
  // ①-7 검색 글 검사
  const rule = FC.fields[UN.q_field];
  const qs = [['', 'empty'], ['   ', 'empty'], ['가'.repeat(P.q_long_n), 'long'], [unesc(P.q_ctrl), 'ctrl'], [P.q_ok, null], [5, 'type']];
  const got = qs.map(([q]) => fc.field(q, rule));
  row('①-7', '검색 글 검사 — 빈 글·빈칸만·' + P.q_long_n + '자(한도 ' + rule.max + ')·제어 문자·글 아님은 거절, 보통 글은 받음', qs.map(([, w]) => w || 'ok').join(' · '),
    got.map((g) => (g.ok ? 'ok' : g.why)).join(' · '), got.every((g, i) => (qs[i][1] === null ? g.ok : !g.ok && g.why === rule.why[qs[i][1]])));
}

// ---------- 앱 띄우기 ----------
// 시험이 다리 앞에서 대신 답하는 검색 글(오늘 한도·끊김·이상한 답·먼 곳) — 나머지는 선 파일 대신 답 + 다리
function fakeFetch(base) {
  const placeUrl = INFO.base + INFO.b.paths.place;
  return async (url, init) => {
    if (String(url) === placeUrl && init && init.body) {
      let q = null;
      try { q = JSON.parse(init.body).q; } catch (e) { q = null; }
      for (const f of Object.values(T.fake)) {
        if (f.q !== q) continue;
        if (!f.body) throw new TypeError('시험 끊김');
        return new Response(JSON.stringify(f.body), { status: f.status, headers: { 'Content-Type': tc.testbed.json_type } });
      }
    }
    return base(url, init);
  };
}
function start(opts) {
  const o = opts || {};
  const over = { config_net_route: { ...NR, health_ms: T.health_ms, health_down_ms: T.health_ms }, ...(o.overrides || {}) };
  return runApp({ app: APP, tc, main, boards: BOARDS }, { secretFile: SECRET_FILE, ...o, overrides: over, fetchFn: fakeFetch(fetchWithLines(tc, INFO, SECRET, fetch)), stamp: 'try-a6' });
}
async function openAt(scene, tick, opts) {
  await selectScene(INFO, scene, false);
  if (tick) await seekScene(INFO, tick);
  const a = start(opts);
  await wait(() => a.stage() && a.stage() !== HC.stages.starting, T.start_wait_ms);
  await wait(() => !!a.get('speed') && !!a.get('ahead') && a.el(UA.ids.list).children.length > 0, T.start_wait_ms);
  return a;
}
async function inject(event) {
  const r = await call(INFO, 'POST', 'scene', { body: { action: 'inject', event } });
  if (r.status !== 200) throw new Error('사건 넣기 실패 ' + r.status + ' ' + JSON.stringify(r.json));
}
const I = UN.ids;
const note = (a) => a.el(I.note).textContent;
const calls = (a, name) => a.fetchCalls.filter((f) => f.url.endsWith(INFO.b.paths[name])).length;
const listRows = (a) => a.el(I.list).children.filter((e) => e.className === UN.classes.item);
function type(a, text) { a.el(I.q).value = text; }
async function search(a, text) {
  type(a, text);
  const n = a.seen.place.length;
  a.el(I.go).click();
  return n;
}
// 화면 상태: 속도판 글·충전소판 줄 수·지도 카메라(굳힌 방향·확대 포함)·운전 화면
function screen(a) {
  return { speed: a.el(SP.ids.value).textContent, rows: a.el(UA.ids.list).children.length, cam: JSON.stringify(a.made.ui_map.cam()), drive: !a.driveHidden(), speeds: a.seen.speed.length };
}
function same(before, after) {
  return after.drive && after.speed !== '' && after.rows === before.rows && after.cam === before.cam && after.speeds > before.speeds;
}
const screenText = (b, x) => '속도 ' + JSON.stringify(x.speed) + ' · 판 줄 ' + b.rows + '→' + x.rows + ' · 카메라 ' + (b.cam === x.cam ? '같음' : '다름 ' + x.cam) + ' · 속도 알림 +' + (x.speeds - b.speeds);
const statusHas = (a, src) => a.statusText().includes(UST.texts.src_names[src]);

// ---------- ② S9 ----------
async function partS9() {
  const S = T.s9;
  const X = UN.texts;
  // ②-1 정상: 손으로 돌리고 키운 지도 → 검색·고르기 → 경로 선·경로 기준 → 지우기
  const a = await openAt(S.scene, S.found_tick);
  const map = a.lib.maps[0];
  map.user('rotated', { bearing: S.user_bearing });
  map.user('zoomed', { zoom: S.user_zoom });
  await sleep(tc.testbed.poll_ms * 2);
  const before = screen(a);
  const aheadBefore = a.get('ahead');
  await search(a, S.query);
  const found = await wait(() => listRows(a).length > 0, T.wait_ms);
  const n = listRows(a).length;
  const noteFound = note(a);
  // 검색하는 동안·뒤에도 계속 도는지: 위치가 한두 번 더 올 만큼 기다린 뒤 견줌
  await wait(() => a.seen.speed.length > before.speeds + 1, T.wait_ms);
  const mid = screen(a);
  row('②-1', 'S9 정상 — 검색 → 결과 목록(구분선 목록), 그동안 속도판·충전소판·지도 카메라(손으로 돌린 방향·확대) 그대로', '목록 3곳 · 한 줄 "' + X.found.replace('{n}', 3) + '" · 화면 그대로',
    '목록 ' + n + '곳(' + listRows(a).map((e) => e.children[0].textContent).join(', ') + ') · 한 줄 ' + JSON.stringify(noteFound) + ' · ' + screenText(before, mid),
    found && n === 3 && noteFound === X.found.replace('{n}', 3) && same(before, mid));
  listRows(a)[0].click();
  const routed = await wait(() => !!a.get('route') && a.get('ahead') && a.get('ahead').mode === AH.modes.route, T.wait_ms);
  // 판은 판 틀이 정한 간격(config_ui_ahead.interval_ms)마다 그린다 — 머리 글이 바뀔 때까지
  await wait(() => a.el(UA.ids.head).textContent === UA.texts.head_route, UA.interval_ms * 3);
  const rt = a.get('route');
  const drawn = map.data[UM.route.source_id];
  const coords = drawn && drawn.geometry ? drawn.geometry.coordinates.length : 0;
  const after = screen(a);
  const ah = a.get('ahead');
  const pos = a.get('pos');
  // 기대: 장면의 휴게소 가운데 지금 km 보다 앞(같은 방향)인 곳을 km 차례로 — 거리 = km 차이(경로가 같은 선 위라 같아야 함)
  const scene = JSON.parse(fs.readFileSync(path.join(APP, tc.testbed.dir, 'scenes', S.scene + tc.build.config_ext), 'utf8'));
  const wantNames = scene.stations.filter((s) => s.km > pos.km).sort((p, q) => p.km - q.km).slice(0, AH.count);
  const nameOk = ah && ah.items.length === wantNames.length && ah.items.every((it, i) => wantNames[i].name.startsWith(it.name.replace(/\s.*$/, '')) && Math.abs(it.dist_km - (wantNames[i].km - pos.km)) <= T.dist_tol_km);
  row('②-2', 'S9 고름 → 경로 선이 지도에(카메라는 그대로) · 경로 줄 "→ 목적지 · km" · 앞의 충전소가 경로 기준(모드 ' + AH.modes.route + ') · 판 머리 "' + UA.texts.head_route + '"',
    '선 점 = 경로 점 · 줄에 ' + S.query + ' · 모드 ' + AH.modes.route + ' · ' + wantNames.map((s) => s.name + ' ' + (s.km - pos.km).toFixed(1)).join(' / ') + ' · 화면 그대로',
    '선 점 ' + coords + '/' + (rt ? rt.points.length : '-') + ' · 줄 ' + JSON.stringify(a.el(I.route_text).children.map((e) => e.textContent).join(' ')) + ' · 모드 ' + (ah && ah.mode) + ' · ' + (ah ? ah.items.map((it) => it.name + ' ' + it.dist_km).join(' / ') : '-') + ' · 판 머리 ' + JSON.stringify(a.el(UA.ids.head).textContent) + ' · ' + screenText(before, after),
    routed && rt && coords === rt.points.length && !a.el(I.route).hidden && a.el(I.route_text).children[0].textContent.includes(S.query) && nameOk && a.el(UA.ids.head).textContent === UA.texts.head_route && same(before, after) && map.cam.bearing === S.user_bearing && map.cam.zoom === S.user_zoom);
  a.el(I.clear).click();
  const gone = await wait(() => a.get('route') === null && a.get('ahead') && a.get('ahead').mode === AH.modes.ahead, T.wait_ms);
  const drawn2 = map.data[UM.route.source_id];
  row('②-3', "S9 '경로 지우기' → 선이 지워지고(빈 모음) 앞의 충전소가 선 기준으로 돌아옴 · 경로 줄 숨김", 'route null · 선 빔 · 모드 ' + AH.modes.ahead + ' · 줄 숨김 · 같은 세 곳',
    'route ' + JSON.stringify(a.get('route')) + ' · 선 ' + (drawn2 && drawn2.features ? '빔(' + drawn2.features.length + ')' : '있음') + ' · 모드 ' + (a.get('ahead') && a.get('ahead').mode) + ' · 줄 ' + (a.el(I.route).hidden ? '숨김' : '보임') + ' · ' + keysOf(a.get('ahead')).join(','),
    gone && drawn2 && drawn2.features && drawn2.features.length === 0 && a.el(I.route).hidden && keysOf(a.get('ahead')).join() === keysOf(aheadBefore).join());
  // 찾은 곳 없음 · 입력 검사
  await search(a, S.query_none);
  const none = await wait(() => note(a) === X.none_found, T.wait_ms);
  const placeCalls = calls(a, 'place');
  const bad = [];
  for (const [q, why] of [['', 'empty'], ['가'.repeat(T.pure.q_long_n), 'long'], [unesc(T.pure.q_ctrl), 'ctrl']]) {
    type(a, q);
    a.el(I.go).click();
    await sleep(tc.testbed.poll_ms);
    bad.push([why, note(a)]);
  }
  const wantBad = (w) => X.q_bad[w].split(UN.max_mark).join(String(FC.fields[UN.q_field].max));
  const logLines = a.logLines().filter((l) => l.includes(UN.words.q_bad)).length;
  row('②-4', '찾은 곳 없음 → 그 칸 아래 "' + X.none_found + '" · 입력 검사(빈 글·' + T.pure.q_long_n + '자·제어 문자) → 그 칸 아래 한 줄, 물음을 내지 않음, 기록장 줄',
    X.none_found + ' · ' + ['empty', 'long', 'ctrl'].map(wantBad).join(' / ') + ' · 더 나간 물음 0 · 기록장 3',
    JSON.stringify(note(a) === X.none_found ? X.none_found : '') + (none ? '' : '(없음 글 못 봄)') + ' · ' + bad.map((b) => b[1]).join(' / ') + ' · 더 나간 물음 ' + (calls(a, 'place') - placeCalls) + ' · 기록장 ' + logLines,
    none && bad.every(([w, t]) => t === wantBad(w)) && calls(a, 'place') === placeCalls && logLines >= 3);
  // 시험이 대신 답하는 것: 오늘 한도 · 끊김 · 이상한 답 · 범위 밖 좌표
  const fakes = [];
  for (const [name, want] of [['quota', X.fail.quota], ['offline', X.fail.offline], ['bad', X.fail.bad_answer], ['far', X.fail.bad_answer]]) {
    // 끊김(offline)은 집 PC 길 끊김으로 보여 검색 칸이 잠깐 흐려진다 — 다리 상태 길 확인(시험 간격)으로 풀린 뒤 다음 것
    await wait(() => a.el(I.root).getAttribute(UN.ok_attr) === UN.yes_word, T.health_ms * 3);
    await search(a, T.fake[name].q);
    const ok = await wait(() => note(a) === want, T.wait_ms);
    fakes.push([name, ok, note(a), name === 'quota' ? await wait(() => statusHas(a, 'kakao'), T.wait_ms) : null, a.el(I.root).getAttribute(UN.ok_attr)]);
  }
  const kakaoLine = fakes[0][3] && fakes[0][4] === UN.yes_word;
  const headLog = a.logLines().filter((l) => l.includes(NR.words.bad_answer) && l.includes('extra')).length;
  row('②-5', '답마다 다른 글 — 오늘 한도(429 quota) · 서버에 못 닿음(끊김) · 이상한 답(모르는 칸) · 범위 밖 좌표 → 그 칸 한 줄 · 오늘 한도는 상태 자리에 카카오 줄(단추는 흐리게 하지 않음) · 이상한 답은 기록장에 앞부분',
    [X.fail.quota, X.fail.offline, X.fail.bad_answer, X.fail.bad_answer].join(' / ') + ' · 카카오 줄 · 기록장 앞부분 ≥ 1',
    fakes.map((f) => f[2]).join(' / ') + ' · 카카오 줄 ' + (fakes[0][3] ? '있음' : '없음') + '(그때 단추 ' + fakes[0][4] + ')' + ' · 기록장 앞부분 ' + headLog,
    fakes.every((f) => f[1]) && kakaoLine && headLog >= 1);
  a.stop();
  // ②-6 느림(다리 3초 늦춤): 늦음 글 → 결과 · 그동안 화면 그대로 · 길도 늦음 → 선
  const b = await openAt(S.scene, S.slow_tick);
  const bBefore = screen(b);
  await search(b, S.query);
  const slowSeen = await wait(() => note(b) === X.slow, T.slow_wait_ms);
  const slowNote = note(b);
  const done = await wait(() => listRows(b).length > 0, T.slow_wait_ms);
  const bMid = screen(b);
  listRows(b)[0] && listRows(b)[0].click();
  const rSlow = await wait(() => note(b) === X.route_slow, T.slow_wait_ms);
  const rDone = await wait(() => !!b.get('route'), T.slow_wait_ms);
  row('②-6', 'S9 느림(답 3초 늦음 — 늦음 문턱 ' + NR.slow_ms + 'ms) — 그 칸 "' + X.slow + '" → 결과 · 길도 "' + X.route_slow + '" → 경로 · 기다리는 동안 속도판·충전소판·지도 그대로',
    '늦음 글 → 목록 1곳(kakao) · 길 늦음 글 → 경로 · 화면 그대로',
    '늦음 글 ' + (slowSeen ? '봄' : '못 봄 ' + JSON.stringify(slowNote)) + ' → 목록 ' + listRows(b).length + '곳/답 ' + (b.get('place') && b.get('place').source) + ' · 길 늦음 ' + (rSlow ? '봄' : '못 봄') + ' → 경로 ' + (rDone ? '있음' : '없음') + ' · ' + screenText(bBefore, bMid),
    slowSeen && done && rSlow && rDone && same(bBefore, bMid));
  b.stop();
  // ②-7 시간 한도(시험만 줄인 한도 — 느린 답이 그보다 늦음)
  const tOver = { config_netcore: { ...NC, clients: { ...NC.clients, route: { ...NC.clients.route, timeout_ms: T.timeout_ms } } } };
  const t = await openAt(S.scene, S.slow_tick, { overrides: tOver });
  const tBefore = screen(t);
  await search(t, S.query);
  const tOut = await wait(() => note(t) === X.fail.timeout, T.slow_wait_ms);
  const tAfter = screen(t);
  row('②-7', '시간 한도(시험만 ' + T.timeout_ms + 'ms — 다리 늦춤 3초가 넘음) → 그 칸 "' + X.fail.timeout + '" · 화면 그대로', X.fail.timeout + ' · 화면 그대로',
    JSON.stringify(note(t)) + ' · ' + screenText(tBefore, tAfter), tOut && same(tBefore, tAfter));
  t.stop();
  // ②-8 실패(검색 502 upstream — 카카오 실패, 길 504 home_off — 집 PC 답 없음)
  const f = await openAt(S.scene, S.fail_tick);
  const fBefore = screen(f);
  await search(f, S.query);
  const up = await wait(() => note(f) === X.fail.upstream, T.wait_ms);
  const kakao = await wait(() => statusHas(f, 'kakao'), T.wait_ms);
  const usableAfterUp = f.el(I.root).getAttribute(UN.ok_attr) === UN.yes_word;
  await inject({ type: 'response_mode', path: INFO.b.paths.place, mode: 'found' });
  await search(f, S.query);
  await wait(() => listRows(f).length > 0, T.wait_ms);
  listRows(f)[0] && listRows(f)[0].click();
  const off = await wait(() => note(f) === X.fail.home_off, T.wait_ms);
  const homeLine = await wait(() => statusHas(f, 'home'), T.wait_ms);
  const dim = f.el(I.root).getAttribute(UN.ok_attr) === UN.no_word;
  const fAfter = screen(f);
  const back = await wait(() => f.el(I.root).getAttribute(UN.ok_attr) === UN.yes_word && !statusHas(f, 'home'), T.health_ms * 3);
  row('②-8', 'S9 실패 — 검색 502(카카오 실패): 그 칸 "' + X.fail.upstream + '" + 상태 자리 카카오 줄, 단추는 그대로 · 길 504(집 PC 답 없음): 그 칸 "' + X.fail.home_off + '" + 상태 자리 집 컴퓨터 줄 + 검색 칸 흐림 → 다리 상태 길이 좋음이면 풀림 · 화면 그대로',
    '카카오 글·줄·단추 그대로 · 집 PC 글·줄·흐림 → 풀림 · 화면 그대로',
    (up ? '카카오 글' : '카카오 글 못 봄') + ' · 카카오 줄 ' + kakao + ' · 단추 ' + (usableAfterUp ? '그대로' : '흐림') + ' · ' + (off ? '집 PC 글' : '집 PC 글 못 봄 ' + JSON.stringify(note(f))) + ' · 집 줄 ' + homeLine + ' · 흐림 ' + dim + ' → 풀림 ' + back + ' · ' + screenText(fBefore, fAfter),
    up && kakao && usableAfterUp && off && homeLine && dim && back && same(fBefore, fAfter));
  f.stop();
  // ②-9 돌아옴
  const g = await openAt(S.scene, S.back_tick);
  await search(g, S.query);
  const gFound = await wait(() => listRows(g).length > 0, T.wait_ms);
  listRows(g)[0] && listRows(g)[0].click();
  const gRoute = await wait(() => !!g.get('route'), T.wait_ms);
  row('②-9', 'S9 돌아옴(틱 ' + S.back_tick + ') — 다시 찾아지고 경로가 그려짐', '목록 3곳 · 경로', '목록 ' + (gFound ? 3 : 0) + ' · 경로 ' + (gRoute ? '있음' : '없음'), gFound && gRoute);
  g.stop();
}
const keysOf = (a) => (a && a.items ? a.items.map((it) => it.key) : []);

// ---------- ③ S10 ----------
async function partS10() {
  const S = T.s10;
  const U = UL.upload;
  const X = U.texts;
  const a = await openAt(S.scene, S.accept_tick);
  const odd = async (k) => {
    for (let i = 0; i < k; i += 1) {
      a.el(cfgOf('config_ui_odd').ids.memo).value = S.memo + ' ' + (i + 1);
      await a.made.ui_odd.press();
      await sleep(tc.testbed.poll_ms);
    }
  };
  const sentFile = () => { const t = a.disk.files[ST.dir + '/' + ST.keys.odd_sent.file]; return t ? JSON.parse(t).value : []; };
  const states = () => a.el(U.ids.list).children.map((r) => r.children[1].getAttribute(U.attrs.state));
  const press = async () => { const n = a.seen.odd.length; a.el(U.ids.button).click(); return n; };
  const doneAfter = (n) => wait(() => a.seen.odd.slice(n).some((v) => v.stage === U.stages.done || v.stage === U.stages.fail), T.wait_ms);
  await odd(3);
  await sleep(T.quiet_ms);
  const before = calls(a, 'odd');
  a.el(UL.open_id).click();
  await sleep(tc.testbed.poll_ms * 2);
  const st0 = states();
  row('③-1', "S10 '이상해' 세 번 — 폰에 기록 셋, 누르기 전 올림 0건(" + T.quiet_ms + 'ms 기다림) · 기록 칸 목록에 셋 다 "' + X.row_left + '"', '올림 물음 0 · 목록 left×3',
    '올림 물음 ' + before + ' · 목록 ' + st0.join(','), before === 0 && st0.length === 3 && st0.every((s) => s === U.state_words.left));
  let n = await press();
  const d1 = await doneAfter(n);
  await sleep(tc.testbed.poll_ms);
  const ones = a.seen.odd.slice(n).filter((v) => v.stage === U.stages.one);
  row('③-2', "'기록 올리기' → 셋을 차례로 한 번씩(받음) · 그 줄마다 \"" + X.row_sent + '" · 올린 목록에 셋 · 다리가 지은 이름',
    '물음 3 · ok 3 · 목록 sent×3 · 올린 목록 3 · 끝 글', '물음 ' + calls(a, 'odd') + ' · ok ' + ones.filter((v) => v.ok).length + ' · 목록 ' + states().join(',') + ' · 올린 목록 ' + sentFile().length + ' · 이름 ' + ones.map((v) => v.server).join(',') + ' · 끝 글 ' + JSON.stringify(a.el(U.ids.note).textContent),
    d1 && calls(a, 'odd') === 3 && ones.length === 3 && ones.every((v) => v.ok && typeof v.server === 'string' && v.server.length > 0) && states().every((s) => s === U.state_words.sent) && sentFile().length === 3);
  n = await press();
  await doneAfter(n);
  await sleep(tc.testbed.poll_ms);
  row('③-3', '다시 누름 — 올릴 것 없음(이미 올린 것은 다시 안 감)', '물음 그대로 3 · "' + X.nothing + '"', '물음 ' + calls(a, 'odd') + ' · ' + JSON.stringify(a.el(U.ids.note).textContent), calls(a, 'odd') === 3 && a.el(U.ids.note).textContent === X.nothing);
  await odd(2);
  n = a.seen.odd.length;
  a.el(U.ids.button).click();
  a.el(U.ids.button).click();
  const busy = await wait(() => a.seen.odd.slice(n).some((v) => v.stage === U.stages.busy), T.wait_ms);
  await doneAfter(n);
  await sleep(tc.testbed.poll_ms);
  row('③-4', '도는 중에 또 누름 → 둘째는 버리고 "' + X.busy + '" · 새 기록 둘만 한 번씩', '바쁨 알림 · 물음 5', '바쁨 ' + busy + ' · 물음 ' + calls(a, 'odd'), busy && calls(a, 'odd') === 5);
  await seekScene(INFO, S.reject_tick);
  await odd(2);
  n = await press();
  await doneAfter(n);
  await sleep(tc.testbed.poll_ms);
  const rej = a.seen.odd.slice(n).filter((v) => v.stage === U.stages.one);
  const rejRows = a.el(U.ids.list).children.slice(0, 2).map((r) => r.children[1].textContent);
  const c1 = calls(a, 'odd');
  await sleep(T.quiet_ms);
  const wantRej = X.row_failed.replace('{why}', X.why.bad);
  row('③-5', 'S10 거절(400 bad) — 둘 다 "' + wantRej + '"(올린 목록에 안 들어감) · 그 뒤 ' + T.quiet_ms + 'ms 동안 저절로 다시 안 감', '거절 2 · 줄 글 · 올린 목록 5 · 물음 7 그대로',
    '거절 ' + rej.filter((v) => !v.ok && v.code === 'bad').length + ' · 줄 ' + rejRows.join(' / ') + ' · 올린 목록 ' + sentFile().length + ' · 물음 ' + c1 + '→' + calls(a, 'odd'),
    rej.length === 2 && rej.every((v) => !v.ok && v.code === 'bad') && rejRows.every((t) => t === wantRej) && sentFile().length === 5 && c1 === 7 && calls(a, 'odd') === 7);
  await seekScene(INFO, S.again_tick);
  n = await press();
  await doneAfter(n);
  await sleep(tc.testbed.poll_ms);
  const again = a.seen.odd.slice(n).filter((v) => v.stage === U.stages.one);
  row('③-6', '다시 받는 때(틱 ' + S.again_tick + ') 누름 → 거절됐던 둘만 다시 가서 받음', 'ok 2 · 올린 목록 7 · 물음 9 · 목록 모두 sent',
    'ok ' + again.filter((v) => v.ok).length + ' · 올린 목록 ' + sentFile().length + ' · 물음 ' + calls(a, 'odd') + ' · 목록 ' + [...new Set(states())].join(','),
    again.length === 2 && again.every((v) => v.ok) && sentFile().length === 7 && calls(a, 'odd') === 9 && states().every((s) => s === U.state_words.sent));
  await seekScene(INFO, S.full_tick);
  await odd(2);
  n = await press();
  await doneAfter(n);
  await sleep(tc.testbed.poll_ms);
  const full = a.seen.odd.slice(n).filter((v) => v.stage === U.stages.one);
  const fullRows = a.el(U.ids.list).children.slice(0, 2).map((r) => r.children[1].textContent).reverse();
  row('③-7', 'S10 꽉 참(429 busy) — 첫 기록 "' + X.row_failed.replace('{why}', X.why.busy) + '", 남은 것은 보내지 않고 "' + X.row_failed.replace('{why}', X.why.stopped) + '"', '물음 +1(10) · busy · stopped',
    '물음 ' + calls(a, 'odd') + ' · ' + full.map((v) => v.code).join(',') + ' · 줄 ' + fullRows.join(' / '),
    calls(a, 'odd') === 10 && full.length === 2 && full[0].code === 'busy' && full[1].code === NR.codes.stopped && fullRows[0] === X.row_failed.replace('{why}', X.why.busy) && fullRows[1] === X.row_failed.replace('{why}', X.why.stopped));
  a.stop();
}

// ---------- ④ S7 ----------
async function partS7() {
  const S = T.s7;
  const X = UN.texts;
  const U = UL.upload;
  const a = await openAt(S.scene, S.start_tick);
  const before = screen(a);
  const down = await wait(() => a.el(I.root).getAttribute(UN.ok_attr) === UN.no_word && statusHas(a, 'home'), S.down_wait_ms);
  const status = a.statusText();
  const pc = calls(a, 'place');
  type(a, T.s9.query);
  a.el(I.go).click();
  await sleep(tc.testbed.poll_ms * 2);
  const blocked = note(a);
  const upDisabled = a.el(U.ids.button).disabled === true;
  await sleep(tc.testbed.poll_ms * 5);
  const mid = screen(a);
  const dataLine = statusHas(a, 'data');
  row('④-1', 'S7 집 PC 끊김(틱 60~120) — 길찾기만 "' + X.unusable + '"(검색 칸 흐림·물음 안 냄) · \'기록 올리기\' 흐림 · 상태 자리에 집 컴퓨터 줄 · 충전소 자료 줄 없음 · 속도판·충전소판·지도 그대로',
    '흐림 · 글 ' + X.unusable + ' · 물음 0 · 올리기 흐림 · 집 줄 · 자료 줄 없음 · 화면 그대로',
    (down ? '흐림' : '안 흐림') + ' · 글 ' + JSON.stringify(blocked) + ' · 물음 ' + (calls(a, 'place') - pc) + ' · 올리기 ' + (upDisabled ? '흐림' : '그대로') + ' · 상태 ' + JSON.stringify(status) + ' · 자료 줄 ' + dataLine + ' · ' + screenText(before, mid),
    down && blocked === X.unusable && calls(a, 'place') === pc && upDisabled && !dataLine && same(before, mid));
  const back = await wait(() => a.el(I.root).getAttribute(UN.ok_attr) === UN.yes_word && !statusHas(a, 'home') && a.el(U.ids.button).disabled === false, S.back_wait_ms);
  row('④-2', 'S7 집 PC 돌아옴 → 검색 칸·올리기 단추 풀림 · 상태 자리 줄 사라짐', '풀림', (back ? '풀림' : '안 풀림') + ' · 상태 ' + JSON.stringify(a.statusText()), back);
  a.stop();
}

// ---------- ⑤ 진짜 크롬 ----------
async function partChrome() {
  const C = T.chrome;
  const sel = { ...L.sel, ...C.sel };
  const ready = { ...L.ready, navi_q: { min: 1 } };
  const res = await measureInChrome(tc, APP, { scene: C.scene, tick: C.tick, frames: L.frames, sel, ready, actions: C.actions, log });
  const dir = path.join(APP, tc.log.dir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'try_a6_chrome.json'), JSON.stringify(res, null, 1), 'utf8');
  if (res.error) { row('⑤', '진짜 크롬 재기', '결과 옴', res.error, false); return; }
  const tol = tc.chrome.tol_px;
  for (const fr of res.frames) {
    const checks = [];
    for (const [si, stepName] of [[1, '목록'], [2, '경로'], [3, '경로 + 정보 칸']]) {
      const st = fr.steps[si];
      const g = (st && st.got) || {};
      const one = (n) => (g[n] || [])[0];
      const covered = [];
      for (const nm of [...L.contents, 'navi_items', 'navi_route_text', 'navi_route_km']) for (const e of g[nm] || []) if (e.shown) for (const h of e.hits || []) if (!h.ok) covered.push(nm + '←' + h.by);
      const overlaps = [];
      // 겹침은 검색 칸 자리(보이는 상자 — 넘치는 것은 칸 안에서 넘겨 봄)로 잰다
      const navi = one('navi_slot');
      for (const nm of C.avoid) for (const [i, e] of (g[nm] || []).entries()) if (e.shown && navi && navi.shown && overlapArea(navi.rect, e.rect) > 0) overlaps.push(nm + '[' + i + ']');
      const station = one('station');
      if (station && station.shown && navi && overlapArea(navi.rect, station.rect) > 0) overlaps.push('station');
      const wrap = one('mapwrap');
      const outside = navi && wrap && navi.shown && !inside(navi.rect, wrap.rect, tol) ? ['검색 칸이 지도 묶음 밖'] : [];
      const cut = [];
      for (const nm of ['navi_route_text', 'navi_items', 'navi_note']) for (const e of g[nm] || []) if (e.shown && e.sw > e.cw + tol) cut.push(nm + ' ' + e.sw + '>' + e.cw);
      const km = one('navi_route_km');
      if (km && km.shown && navi && !inside(km.rect, navi.rect, tol)) cut.push('km 글 칸 밖');
      const low = [];
      for (const nm of [...C.touch, ...L.touch]) for (const e of g[nm] || []) if (e.shown && e.rect.h < L.touch_min_px) low.push(nm + ' ' + Math.round(e.rect.h));
      const items = (g.navi_items || []).filter((e) => e.shown).length;
      const routeEl = one('navi_route');
      const routeText = one('navi_route_text');
      const map = one('slot_center');
      let stateOk = true;
      let stateText = '';
      if (si === 1) { stateOk = items >= 1; stateText = '목록 ' + items + '줄'; }
      if (si >= 2) { stateOk = !!routeEl && routeEl.shown && !!routeText && routeText.text.includes(C.route_word); stateText = '경로 줄 ' + JSON.stringify(routeText ? routeText.text : ''); }
      if (si === 3) { stateOk = stateOk && !!station && station.shown; stateText += ' · 정보 칸 ' + (station && station.shown ? '열림' : '닫힘'); }
      const mapOk = map && map.rect.h > 0;
      checks.push({ stepName, ok: stateOk && covered.length === 0 && overlaps.length === 0 && outside.length === 0 && cut.length === 0 && low.length === 0 && mapOk,
        text: stepName + ': ' + stateText + ' · 가림 ' + covered.length + (covered.length ? '(' + covered.slice(0, 3).join(' / ') + ')' : '') + ' · 겹침 ' + overlaps.length + (overlaps.length ? '(' + overlaps.join(', ') + ')' : '') + outside.join('') + ' · 잘림 ' + cut.length + (cut.length ? '(' + cut.join(', ') + ')' : '') + ' · 낮은 것 ' + low.length + (low.length ? '(' + low.join(', ') + ')' : '') + ' · 지도 높이 ' + (map ? Math.round(map.rect.h) : '-') });
    }
    row('⑤ ' + fr.name, '진짜 크롬 — 검색(안성휴게소) → 목록 → 고름(경로) → 정보 칸: 검색 칸·결과·경로 줄이 판·저작권·아래 띠·정보 칸을 덮지 않음 · 숫자·글 잘림 0 · 누르는 높이 ≥ ' + L.touch_min_px,
      '세 걸음 모두 가림 0 · 겹침 0 · 잘림 0 · 낮은 것 0', (fr.ready ? '' : '준비 안 됨 · ') + checks.map((x) => x.text).join(' ┃ '), fr.ready && checks.length === 3 && checks.every((x) => x.ok));
  }
}

async function main2() {
  log.write('시작', {});
  const only = process.argv[2];
  if (!only || only === 'pure') await partPure();
  if (!only || only === 'app') {
    INFO = testbedInfo(tc, APP);
    SECRET = makeSecret(tc);
    const sec = writeSecretFile(tc, SECRET);
    SECRET_FILE = sec.file;
    const bridge = await startBridge(tc, INFO, T.run_seconds, SECRET);
    try {
      await partS9();
      await partS10();
      await partS7();
    } finally {
      log.write('다리 끝 기다림', {});
      let guard = null;
      const code = await Promise.race([bridge.waitExit(), new Promise((res) => { guard = setTimeout(() => res('timeout'), T.run_seconds * tc.view_s1.ms_per_s + T.exit_grace_ms); })]);
      clearTimeout(guard);
      if (code === 'timeout') bridge.proc.kill();
      row('끝', '다리가 시험 모드 시간 뒤 스스로 끝남', '종료 코드 0', String(code), code === 0);
      fs.rmSync(sec.dir, { recursive: true, force: true });
    }
  }
  if (!only || only === 'chrome') await partChrome();
}

function printTable() {
  const lines = ['| # | 시험 | 기대 | 실제 | 결과 |', '|---|---|---|---|---|'];
  for (const r of rows) lines.push('| ' + [r.no, r.title, r.expect, r.actual, r.ok ? tc.pass_word : tc.fail_word].map((s) => String(s).replace(/\|/g, '/').replace(/\n/g, ' ⏎ ')).join(' | ') + ' |');
  const ok = rows.length > 0 && rows.every((r) => r.ok);
  lines.push('', 'A6 스스로 시험: ' + (ok ? tc.pass_word : tc.fail_word) + ' (' + rows.filter((r) => r.ok).length + ' / ' + rows.length + ') — ' + kstText(tc));
  const text = lines.join('\n');
  console.log(text);
  const dir = path.join(APP, tc.log.dir);
  fs.mkdirSync(dir, { recursive: true });
  const part = process.argv[2];
  fs.writeFileSync(path.join(dir, part ? T.report_file.split('.md').join('_' + part + '.md') : T.report_file), text + '\n', 'utf8');
  return ok;
}

try {
  await main2();
} catch (e) {
  log.write('예외', { error: String(e && e.stack || e) });
  console.error(e);
  rows.push({ no: '예외', title: String(e && e.message), expect: '-', actual: '-', ok: false });
}
const ok = printTable();
log.write('끝', { result: ok ? tc.pass_word : tc.fail_word });
process.exitCode = ok ? tc.exit.ok : tc.exit.fail;
