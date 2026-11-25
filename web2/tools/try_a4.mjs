// A4 스스로 시험(충전소 상태 · 정보 칸 · 다른 내비로 넘기기 — 순수 셈 + 가상 창 + 진짜 크롬).
//   node web2/tools/try_a4.mjs                 # 전부(약 9분 — 다리가 끝날 때까지 + 크롬)
//   node web2/tools/try_a4.mjs pure|app|chrome  # 그 부분만
// ① 순수: 중계 시각 글 · 신선함(보증·낡음·미래) · 상태 읽기(없는 충전기는 모름) · 이스케이프 · 내비 주소 글(앱별 무늬 — 기대 값은 시험이 따로 만든 인코더로)
// ② S5: 충전판 줄을 눌러 연 정보 칸에 충전기 상태 바뀜(빈자리 → 사용 중 → 고장 → 빈자리)과 받은 때가 반영 · 카메라·'세 곳만' 그대로 ·
//        마지막에 온 선택(지도 번호·점)을 엶 · 닫으면 받기 멈춤 · 복사 단추 글 · 내비 안 열림 안내
// ③ S3: 하행·상행에서 이름의 방향과 넘기는 좌표가 그 방향 충전소 자리
// ④ S7: 자료 길 끊김 — 들고 있는 상태를 받은 때와 함께, 낡음 표시, '다시 받기' 답, 상태 자리에 끊김 → 돌아옴
// ⑤ 이스케이프: 충전소 이름에 꺾쇠·따옴표 — 글로만 들어가고 주소에는 바뀐 글자로
// ⑥ 진짜 크롬: 정보 칸이 지도를 다 가리지 않고 판·저작권·아래 띠를 덮지 않음, 누르는 높이 48
// 표로 찍고 하나라도 실패면 0 아닌 코드. 기록장 tools/logs/try_a4.log, 표 사본 tools/logs/try_a4_last.md.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadToolsConfig, appDir, toolLog, kstText } from './lib_tools.mjs';
import { testbedInfo, makeSecret, writeSecretFile, startBridge, selectScene, seekScene, fetchWithLines } from './lib_testbed.mjs';
import { sleep, loadBoards, startApp as runApp, waitFor } from './lib_apprun.mjs';
import { measureInChrome, overlapArea, inside } from './lib_chrome.mjs';

const tc = loadToolsConfig();
const T = tc.try_a4;
const L = tc.layout;
const APP = appDir(tc);
const log = toolLog(tc, 'try_a4');
const cfgOf = (name) => JSON.parse(fs.readFileSync(path.join(APP, tc.build.config_dir, name + tc.build.config_ext), 'utf8'));
const srcOf = async (name) => import(pathToFileURL(path.join(APP, tc.build.src_dir, name + '.js')).href);
const US = cfgOf('config_ui_station');
const UA = cfgOf('config_ui_ahead');
const MAP = cfgOf('config_ui_map');
const HC = cfgOf('config_health');
const RF = cfgOf('config_relay_fresh');
const RR = cfgOf('config_relay_read');
const RH = cfgOf('config_relay_html');
const NL = cfgOf('config_navlink');
const TM = cfgOf('config_time');
const UST = cfgOf('config_ui_status');
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

// ---------- 시험 쪽 인코더(앱의 encodeURIComponent 와 따로) ----------
const UNRES = new RegExp(T.pure.unreserved_re);
function pct(s) {
  let out = '';
  for (const ch of String(s)) {
    if (UNRES.test(ch)) { out += ch; continue; }
    for (const b of new TextEncoder().encode(ch)) out += '%' + b.toString(16).toUpperCase().padStart(2, '0');
  }
  return out;
}
// 설계 5-8 마 의 무늬(시험이 따로 적음)
function expectLinks(label, lat, lng) {
  const la = lat.toFixed(6);
  const ln = lng.toFixed(6);
  const e = pct(label);
  return {
    geo: 'geo:' + la + ',' + ln + '?q=' + la + ',' + ln + '(' + e + ')',
    tmap: 'tmap://route?goalx=' + ln + '&goaly=' + la + '&goalname=' + e,
    kakaomap: 'kakaomap://route?ep=' + la + ',' + ln + '&by=car',
    nmap: 'nmap://route/car?dlat=' + la + '&dlng=' + ln + '&dname=' + e + '&appname=' + pct(NL.appname),
    google: 'google.navigation:q=' + la + ',' + ln,
    copy: label + '\n' + la + ', ' + ln,
  };
}

// ---------- ① 순수 ----------
async function partPure() {
  const fresh = await srcOf('relay_fresh');
  const read = await srcOf('relay_read');
  const html = await srcOf('relay_html');
  const nav = await srcOf('navlink');
  const tf = await srcOf('timefmt');
  const P = T.pure;
  const bad = P.bad_texts.map((x) => fresh.kstMs(x, RF, TM, tf));
  row('①-1', '중계 시각 글(한국 시각 14자리) 읽기 — 없는 날·모자란 글은 모름', P.now_text + ' = ' + P.now_ms + ' · 틀린 글 ' + P.bad_texts.length + '개 모두 null',
    fresh.kstMs(P.now_text, RF, TM, tf) + ' · ' + JSON.stringify(bad), fresh.kstMs(P.now_text, RF, TM, tf) === P.now_ms && bad.every((x) => x === null));
  const meta = { at: P.now_text, ok: true, fresh: ['41'] };
  const fileAt = '20261125212000';
  const fileMs = P.now_ms - 600000;
  const j1 = fresh.judge({ meta, file_at: fileAt, zcodes: ['41'], now: P.now_ms + 60000, old_ms: P.old_ms }, RF, TM, tf);
  const j2 = fresh.judge({ meta, file_at: fileAt, zcodes: ['43'], now: P.now_ms + 60000, old_ms: P.old_ms }, RF, TM, tf);
  const j3 = fresh.judge({ meta: { ...meta, ok: false }, file_at: fileAt, zcodes: ['41'], now: P.now_ms + 60000, old_ms: P.old_ms }, RF, TM, tf);
  const j4 = fresh.judge({ meta, file_at: fileAt, zcodes: ['41'], now: P.now_ms + P.old_ms + 1000, old_ms: P.old_ms }, RF, TM, tf);
  const j5 = fresh.judge({ meta: null, file_at: '20261125230000', zcodes: ['41'], now: P.now_ms, old_ms: P.old_ms }, RF, TM, tf);
  const j6 = fresh.judge({ meta: null, file_at: null, zcodes: [], now: P.now_ms, old_ms: P.old_ms }, RF, TM, tf);
  const sum = (j) => j.level + '/' + j.by + '/' + j.at + '/' + j.age_ms;
  row('①-2', '신선함 — meta 보증(받은 때 = meta 시각)·지역 코드가 meta 에 없음·meta 실패(낡았을 수 있음 — 파일 시각)·문턱 넘음(낡음)·미래·시각 없음',
    'fresh/meta/' + P.now_ms + '/60000 · unsure/file/' + fileMs + ' · unsure/file · old/meta · unknown · unknown/none',
    [j1, j2, j3, j4, j5, j6].map(sum).join(' · '),
    j1.level === 'fresh' && j1.by === 'meta' && j1.at === P.now_ms && j1.age_ms === 60000 && j2.level === 'unsure' && j2.at === fileMs && j3.level === 'unsure' && j3.by === 'file'
    && j4.level === 'old' && j5.level === 'unknown' && j6.level === 'unknown' && j6.by === 'none');
  const ago = [0, 59000, 60000, 3 * 3600000 + 5, 2 * 86400000].map((ms) => fresh.agoText(ms, RF));
  row('①-3', "'○분 전' 글", '방금 · 방금 · 1분 전 · 3시간 전 · 2일 전', ago.join(' · '), ago.join('|') === ['방금', '방금', '1분 전', '3시간 전', '2일 전'].join('|'));
  // 상태 읽기 — 중계 모양 문서의 예시 글
  const sample = { at: '20260105090500', s: { KP000101: { '01': ['3', '20260105083000', '20260105090300'], '02': ['4', '20260105083000', null] }, KP000102: { '01': ['2', '20260105083000', null] } } };
  const st = read.status(sample, RR);
  const rs = read.rows({ id: 'KP000101', chargers: [{ id: '01', type: 'fast', kw: 100 }, { id: '02', type: 'fast', kw: 100 }, { id: '03', type: 'fast', kw: 50 }] }, st, RR);
  const rs2 = read.rows({ id: 'KP000102', chargers: [{ id: '01', type: 'fast', kw: 200 }] }, st, RR);
  const rs3 = read.rows({ id: 'NOPE', chargers: [{ id: '01', type: 'fast', kw: 200 }] }, st, RR);
  let threw = false;
  try { read.status({ at: 'x', s: [] }, RR); } catch (e) { threw = true; }
  const cnt = read.count(rs, RR);
  row('①-4', '상태 읽기 — stat 3 사용 중·4 고장·2 빈자리, 상태 파일에 없는 충전기·충전소는 모름, 파일 꼴이 틀리면 거절',
    'busy,broken,unknown · free · unknown · 거절 · 빈자리 0/3', rs.map((x) => x.state).join(',') + ' · ' + rs2.map((x) => x.state).join(',') + ' · ' + rs3.map((x) => x.state).join(',') + ' · ' + (threw ? '거절' : '안 거절') + ' · 빈자리 ' + cnt.by.free + '/' + cnt.total,
    rs.map((x) => x.state).join(',') === 'busy,broken,unknown' && rs2[0].state === 'free' && rs3[0].state === 'unknown' && threw && cnt.by.free === 0 && cnt.total === 3);
  // 이스케이프
  const ev = P.evil_name;
  const e1 = html.esc(ev, RH);
  const back = e1.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  const b1 = html.balloon({ title: ev, lines: [ev, ''] }, RH);
  row('①-5', '이스케이프 — 이름의 꺾쇠·따옴표·& 가 글자로(되돌리면 같은 이름) · 풍선 글에 끼워 넣은 꼬리표 없음',
    '날 글자 < > " \' 0 · 되돌림 = 이름 · 풍선에 <b onmouseover 없음', e1 + ' · 되돌림 ' + (back === ev ? '같음' : '다름') + ' · 풍선 ' + b1,
    !/[<>"']/.test(e1) && back === ev && !b1.includes('<b onmouseover') && b1.includes('&lt;b onmouseover=&quot;x&quot;&gt;'));
  // 내비 주소 글
  const pl = P.place;
  const Lk = nav.links(pl, NL);
  const ex = expectLinks(P.place_label, pl.lat, pl.lng);
  const app = (k) => (Lk.apps.find((a) => a.key === k) || {}).url;
  row('①-6', '내비 주소 글 — 이름에 방향(' + P.place_label + ') · geo: · 앱별 무늬 넷 · 복사 글(시험 쪽 인코더로 만든 기대 값)',
    JSON.stringify(ex), JSON.stringify({ label: Lk.label, geo: Lk.geo, tmap: app('tmap'), kakaomap: app('kakaomap'), nmap: app('nmap'), google: app('google'), copy: Lk.copy }),
    Lk.label === P.place_label && Lk.geo === ex.geo && app('tmap') === ex.tmap && app('kakaomap') === ex.kakaomap && app('nmap') === ex.nmap && app('google') === ex.google && Lk.copy === ex.copy);
  const Le = nav.links({ name: ev, lat: pl.lat, lng: pl.lng }, NL);
  const ee = expectLinks(ev, pl.lat, pl.lng);
  const nodir = nav.links({ name: '망향휴게소', dir: 'forward', line: 'no_such_line', lat: pl.lat, lng: pl.lng }, NL);
  let badCoord = false;
  try { nav.links({ name: 'x', lat: 0, lng: 0 }, NL); } catch (e) { badCoord = true; }
  row('①-7', '내비 주소 글 — 꺾쇠·따옴표 이름은 주소 안에서 바뀐 글자(%3C·%22·%27), 복사 글은 이름 그대로 · 방향 이름을 모르는 선이면 이름만 · 한국 밖 좌표는 거절',
    'geo ' + ee.geo + ' · 복사 = 이름 · 방향 없는 이름 · 거절', Le.geo + ' · 복사 ' + JSON.stringify(Le.copy) + ' · ' + nodir.label + ' · ' + (badCoord ? '거절' : '안 거절'),
    Le.geo === ee.geo && !/[<>"']/.test(Le.geo + Le.apps.map((a) => a.url).join('')) && Le.copy === ee.copy && nodir.label === '망향휴게소' && badCoord);
}

// ---------- 앱 띄우기 ----------
let BASEFETCH = null;
function start(opts) {
  return runApp({ app: APP, tc, main, boards: BOARDS }, { secretFile: SECRET_FILE, ...opts, fetchFn: fetchWithLines(tc, INFO, SECRET, opts.baseFetch || BASEFETCH || fetch), stamp: 'try-a4' });
}
function over(extra) {
  const o = {
    config_relay_status: { ...cfgOf('config_relay_status'), refresh_ms: T.refresh_ms },
    config_ui_station: { ...US, nav_hint_ms: T.nav_hint_ms },
  };
  for (const [k, v] of Object.entries(extra || {})) o[k] = { ...(o[k] || cfgOf(k)), ...v };
  return o;
}
async function openAt(scene, tick, opts) {
  await selectScene(INFO, scene, false);
  if (tick) await seekScene(INFO, tick);
  const a = start(opts || {});
  await wait(() => a.stage() && a.stage() !== HC.stages.starting, T.start_wait_ms);
  await wait(() => { const v = a.get('ahead'); return v && v.items && v.items.length > 0; }, T.start_wait_ms);
  await sleep(UA.interval_ms + tc.testbed.poll_ms);
  return a;
}
const sceneOf = (name) => JSON.parse(fs.readFileSync(path.join(path.resolve(path.dirname(INFO.cfgPath), INFO.tb.scenes.dir), name + tc.build.config_ext), 'utf8'));
const card = (a) => a.el(US.ids.root);
const cardOpen = (a) => a.made.ui_station && a.made.ui_station.open();
const ops = (a) => (a.el(US.ids.body) ? a.el(US.ids.body).children : []);
const opOf = (a, id) => ops(a).find((o) => o.getAttribute(US.attrs.key) === id) || null;
const chOf = (a, sid, cid) => { const o = opOf(a, sid); return o ? o.children.find((x) => x.className === US.classes.ch && x.getAttribute(US.attrs.key) === cid) || null : null; };
const stateOf = (a, sid, cid) => { const c = chOf(a, sid, cid); return c ? c.getAttribute(US.attrs.state) : null; };
const atOf = (a, sid) => { const o = opOf(a, sid); const at = o && o.children.find((x) => x.className === US.classes.op_at); return at ? { text: at.textContent, level: at.getAttribute(US.attrs.level) } : { text: null, level: null }; };
const allStates = (a) => ops(a).map((o) => o.getAttribute(US.attrs.key) + ':' + o.children.filter((x) => x.className === US.classes.ch).map((x) => x.getAttribute(US.attrs.state)).join(',')).join(' ');
function clickRow(a, pred) {
  const v = a.get('ahead');
  const it = v.items.find(pred);
  if (!it) return null;
  const r = a.el(UA.ids.list).children.find((x) => x.getAttribute(UA.key_attr) === String(it.key));
  if (r) r.click();
  return it;
}
function hrefCoords(href) {
  const m = String(href).match(/^geo:(-?[0-9.]+),(-?[0-9.]+)\?/);
  return m ? { lat: Number(m[1]), lng: Number(m[2]) } : null;
}

// ---------- ② S5 ----------
async function partS5() {
  const S = T.s5;
  const a = await openAt(S.scene, S.seek, { overrides: over() });
  const m = a.lib.maps[0];
  // 손으로 옮겨 따라가기를 끈 뒤 — 정보 칸이 카메라를 움직이면 명령이 생김
  m.user('moved', { center: tc.try_a3.drag_to });
  const j0 = m.jumps.length;
  const lay = () => (m.layers[MAP.others.layer_id] || {})[MAP.others.visibility_key];
  const lay0 = lay();
  const it = clickRow(a, (x) => Array.isArray(x.ids) && x.ids.includes(S.station));
  // 상태가 오기 전에도 충전기 줄은 '모름'으로 먼저 그려진다 — 받은 때가 믿음(fresh)이 될 때까지
  await wait(() => atOf(a, S.station).level === RF.levels.fresh, T.open_wait_ms);
  const s0 = stateOf(a, S.station, S.charger);
  const at0 = atOf(a, S.station);
  row('②-1', 'S5 충전판 줄(' + (it ? it.name : '-') + ')을 누름 → 정보 칸이 열림: 이름(방향)·업체마다 칸·충전기 상태·받은 때', '보임 · 이름 = ' + (it ? it.name : '?') + '(부산 방향) · 업체 칸 = 묶인 충전소 수 · ' + S.station + '-' + S.charger + ' ' + S.first_state + ' · 받은 때 믿음(fresh)',
    (card(a).hidden ? '숨김' : '보임') + ' · ' + a.el(US.ids.name).textContent + ' · 칸 ' + ops(a).length + '(' + (it ? it.ids.length : '-') + ') · 상태 ' + s0 + ' · ' + at0.text + ' [' + at0.level + '] · ' + allStates(a),
    !!it && !card(a).hidden && a.el(US.ids.name).textContent === it.name + '(부산 방향)' && ops(a).length === it.ids.length && s0 === S.first_state && at0.level === RF.levels.fresh && /받은 때 \d\d:\d\d:\d\d/.test(at0.text));
  let prev = at0;
  for (const [i, step] of S.steps.entries()) {
    if (step.seek) await seekScene(INFO, step.seek);
    const ok = await wait(() => stateOf(a, S.station, S.charger) === step.state, step.wait_ms);
    const now = atOf(a, S.station);
    row('②-' + (i + 2), 'S5 충전기 바뀜' + (step.seek ? '(틱 ' + step.seek + ' 로 옮김)' : '(틱 60)') + ' → 열린 칸에 ' + US.texts.states[step.state] + ' · 받은 때 새로', S.station + '-' + S.charger + ' ' + step.state + ' · 글 ' + US.texts.states[step.state] + ' · 받은 때 글 바뀜 · fresh',
      stateOf(a, S.station, S.charger) + ' · 글 ' + (chOf(a, S.station, S.charger) ? chOf(a, S.station, S.charger).children[2].textContent : '-') + ' · ' + prev.text + ' → ' + now.text + ' [' + now.level + ']',
      ok && chOf(a, S.station, S.charger).children[2].textContent === US.texts.states[step.state] && now.text !== prev.text && now.level === RF.levels.fresh);
    prev = now;
  }
  row('②-5', '정보 칸이 열려 있는 동안 카메라·\'세 곳만\' 그대로(손으로 옮긴 뒤 — 카메라 명령 0)', '명령 0 · 층 ' + lay0 + ' 그대로', '명령 ' + (m.jumps.length - j0) + ' · 층 ' + lay(), m.jumps.length === j0 && lay() === lay0);
  // 마지막에 온 선택: 지도 번호 → 지도 점
  const v = a.get('ahead');
  const it2 = v.items.find((x) => x.no === S.pick_mark_no);
  const mk = a.lib.live().find((x) => x.el.textContent === String(S.pick_mark_no));
  if (mk) mk.el.click();
  await sleep(tc.testbed.poll_ms);
  const o1 = cardOpen(a);
  m.clickLayer(MAP.others.layer_id, { [MAP.others.id_prop]: S.pick_dot });
  await sleep(tc.testbed.poll_ms);
  const o2 = cardOpen(a);
  await wait(() => ops(a).length === 1 && stateOf(a, S.pick_dot, '01') !== null, T.open_wait_ms);
  row('②-6', '마지막에 온 선택을 엶 — 지도 ' + S.pick_mark_no + '번(' + (it2 ? it2.name : '-') + ') → 지도 점(' + S.pick_dot + ')', '번호 → 그 자리 · 점 → 그 충전소 하나 · 받은 상태',
    '번호 ' + (o1 ? o1.key + '/' + o1.from : '-') + ' · 점 ' + (o2 ? o2.ids.join(',') + '/' + o2.from : '-') + ' · 칸 ' + ops(a).length + ' · ' + allStates(a),
    !!it2 && o1 && String(o1.key) === String(it2.key) && o1.from === MAP.select_piece && o2 && o2.ids.join() === S.pick_dot && o2.from === MAP.select_piece && ops(a).length === 1 && stateOf(a, S.pick_dot, '01') !== null);
  // 복사 단추
  a.el(US.ids.copy).click();
  await sleep(tc.testbed.poll_ms);
  const copied = a.win.copied[a.win.copied.length - 1];
  const nm = a.el(US.ids.name).textContent;
  const lt = hrefCoords(a.el(US.ids.nav).getAttribute('href'));
  a.win.navigator.clipboard = null;
  a.el(US.ids.copy).click();
  await sleep(tc.testbed.poll_ms);
  const failAns = a.el(US.ids.answer).textContent;
  row('②-7', "'좌표·이름 복사' 단추 — 이름 + 좌표 글이 복사됨 · 복사 못 하면 그 자리 안내", '복사 = 이름⏎위도, 경도 · 보이는 글과 같음 · 실패 답 ' + US.texts.copy_fail,
    JSON.stringify(copied) + ' · 실패 답 ' + failAns, lt && copied === nm + '\n' + lt.lat.toFixed(6) + ', ' + lt.lng.toFixed(6) && copied === a.el(US.ids.copy_text).textContent && failAns === US.texts.copy_fail);
  // 내비 안 열림 안내
  a.el(US.ids.nav).click();
  await sleep(T.nav_hint_ms * 2);
  const h1 = a.el(US.ids.hint).textContent;
  a.el(US.ids.nav).click();
  a.doc.visibilityState = 'hidden';
  for (const f of a.doc.listeners.visibilitychange || []) f();
  await sleep(T.nav_hint_ms * 2);
  const h2 = a.el(US.ids.hint).textContent;
  a.doc.visibilityState = 'visible';
  for (const f of a.doc.listeners.visibilitychange || []) f();
  row('②-8', "'내비로 보내기' 뒤 앱 화면이 그대로면 안내 한 줄 · 다른 앱으로 넘어가면(화면 숨음) 안 띄움", '안내 ' + US.texts.nav_hint + ' · 넘어감 → 빈칸', JSON.stringify(h1) + ' · ' + JSON.stringify(h2), h1 === US.texts.nav_hint && h2 === '');
  // 닫기 → 받기 멈춤
  a.el(US.ids.close).click();
  const asks0 = a.made.relay_status.asks();
  await sleep(S.close_watch_ms);
  row('②-9', '닫기 → 칸 숨김 · station.open 비움 · 상태 받기 멈춤(' + S.close_watch_ms + 'ms 동안)', '숨김 · null · 받기 0',
    (card(a).hidden ? '숨김' : '보임') + ' · ' + JSON.stringify(a.get(US.open_piece)) + ' · 받기 ' + (a.made.relay_status.asks() - asks0), card(a).hidden && a.get(US.open_piece) === null && a.made.relay_status.asks() === asks0);
  a.stop();
}

// ---------- ③ S3 ----------
async function partS3() {
  const sc = sceneOf(T.s3.scene);
  for (const [i, cs] of T.s3.cases.entries()) {
    const a = await openAt(T.s3.scene, cs.seek, { overrides: over() });
    const it = clickRow(a, (x) => x.no === 1);
    await wait(() => ops(a).length > 0, T.open_wait_ms);
    const href = a.el(US.ids.nav).getAttribute('href');
    const ll = hrefCoords(href);
    const same = sc.stations.find((s) => s.name === (it && it.name) && s.direction === cs.scene_dir);
    const other = sc.stations.find((s) => s.name === (it && it.name) && s.direction !== cs.scene_dir);
    const near = (s) => !!s && !!ll && s.operators.some((o) => Math.abs(o.loc[0] - ll.lat) < 1e-6 && Math.abs(o.loc[1] - ll.lng) < 1e-6);
    const label = it ? it.name + '(' + cs.dir_text + ')' : '?';
    const ex = ll ? expectLinks(label, ll.lat, ll.lng) : {};
    const tmap = (a.el(US.ids.apps).children.find((x) => x.getAttribute(US.attrs.app) === 'tmap') || { getAttribute: () => null }).getAttribute('href');
    row('③-' + (i + 1), 'S3 ' + cs.title + ' — 이름에 방향 · 넘기는 좌표 = 그 방향 충전소 자리(반대 방향 아님) · 주소 글',
      '이름 ' + label + ' · 장면의 ' + cs.scene_dir + ' 충전소 좌표 · ' + ex.geo,
      a.el(US.ids.name).textContent + ' · ' + href + ' · 같은 방향 ' + (near(same) ? '맞음' : '아님') + ' · 반대 방향 ' + (other ? (near(other) ? '맞음(틀림)' : '아님') : '장면에 없음') + ' · 티맵 ' + tmap,
      !!it && a.el(US.ids.name).textContent === label && near(same) && !near(other) && href === ex.geo && tmap === ex.tmap);
    a.stop();
  }
}

// ---------- ④ S7 끊김 ----------
async function partS7() {
  const S = T.s7;
  const a = await openAt(S.scene, S.seek, { overrides: over({ config_relay_stations: { refresh_ms: T.refresh_ms, min_refresh_ms: T.refresh_ms }, config_ui_station: { old_ms: S.old_ms } }) });
  const it = clickRow(a, (x) => x.no === 1);
  await wait(() => ops(a).length > 0 && atOf(a, it.ids[0]).level === RF.levels.fresh, T.open_wait_ms);
  const before = allStates(a);
  const dataName = UST.texts.src_names[HC.conn_source['conn.relay.status']];
  const down = await wait(() => a.statusText().includes(dataName), S.down_wait_ms);
  a.el(US.ids.refresh).click();
  const ans = await wait(() => a.el(US.ids.answer).textContent === US.texts.asked_fail, T.open_wait_ms);
  const old = await wait(() => atOf(a, it.ids[0]).level === RF.levels.old, S.old_ms + T.open_wait_ms);
  const at1 = atOf(a, it.ids[0]);
  const during = allStates(a);
  row('④-1', 'S7 자료 길 끊김(' + S.down_t_s + '초) — 상태 자리에 끊김 · 정보 칸은 들고 있는 상태 그대로 + 받은 때 · 낡음(문턱 ' + S.old_ms + 'ms — 시험만 줄임) · \'다시 받기\' 답',
    '상태 자리 ' + dataName + ' 줄 · 상태 같음 · 받은 때 줄에 ' + US.texts.levels.old + ' · 답 ' + US.texts.asked_fail,
    '상태 자리 ' + JSON.stringify(a.statusText()) + ' · 앞 ' + before + ' / 끊김 중 ' + during + ' · ' + at1.text + ' [' + at1.level + '] · 답 ' + a.el(US.ids.answer).textContent,
    down && ans && old && during === before && at1.text.includes(US.texts.levels.old) && /받은 때 \d\d:\d\d:\d\d/.test(at1.text));
  const back = await wait(() => !a.statusText().includes(dataName) && atOf(a, it.ids[0]).level === RF.levels.fresh, S.up_wait_ms);
  const at2 = atOf(a, it.ids[0]);
  row('④-2', 'S7 자료 길 돌아옴(' + S.up_t_s + '초) — 상태 자리에서 사라지고 받은 때가 새로·믿음', '끊김 줄 없음 · fresh', JSON.stringify(a.statusText()) + ' · ' + at2.text + ' [' + at2.level + ']', back);
  a.stop();
}

// ---------- ⑤ 이스케이프(앱) ----------
async function partEvil() {
  const E = T.evil;
  const ev = T.pure.evil_name;
  const baseFetch = async (url, init) => {
    const r = await fetch(url, init);
    if (!String(url).endsWith(E.file) || r.status !== 200) return r;
    const j = await r.json();
    for (const s of j.stations || []) if (s.id === E.station) s.name = ev;
    return new Response(JSON.stringify(j), { status: 200, headers: { 'Content-Type': tc.testbed.json_type } });
  };
  const a = await openAt(E.scene, 0, { overrides: over(), baseFetch });
  a.lib.maps[0].clickLayer(MAP.others.layer_id, { [MAP.others.id_prop]: E.station });
  await wait(() => ops(a).length === 1, T.open_wait_ms);
  const nameEl = a.el(US.ids.name);
  const href = nameEl ? a.el(US.ids.nav).getAttribute('href') : '';
  const apps = a.el(US.ids.apps).children.map((x) => x.getAttribute('href')).join(' ');
  row('⑤', '충전소 이름에 꺾쇠·따옴표 — 정보 칸에 글로만(꼬리표가 생기지 않음) · 주소에는 바뀐 글자 · 복사 글은 이름 그대로', '이름 글 = ' + ev + ' · 이름 칸 아래 요소 0 · 주소에 < > " \' 0 · %3C 있음',
    JSON.stringify(nameEl.textContent) + ' · 아래 요소 ' + nameEl.children.length + ' · ' + href,
    nameEl.textContent === ev && nameEl.children.length === 0 && !/[<>"']/.test(href + apps) && href.includes('%3C') && a.el(US.ids.copy_text).textContent.startsWith(ev + '\n'));
  a.stop();
}

// ---------- ⑥ 진짜 크롬 ----------
async function partChrome() {
  const frames = L.frames.filter((f) => T.chrome_frames.includes(f.name));
  const sel = { ...L.sel, ...T.chrome_sel };
  const res = await measureInChrome(tc, APP, { scene: L.scene, tick: T.chrome_tick, frames, sel, ready: L.ready, actions: T.chrome_actions, log });
  const dir = path.join(APP, tc.log.dir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'try_a4_chrome.json'), JSON.stringify(res, null, 1), 'utf8');
  if (res.error) { row('⑥-0', '진짜 크롬 재기', '결과 옴', res.error, false); return; }
  for (const fr of res.frames) {
    const before = fr.got || {};
    const st = (fr.steps || [])[0];
    const g = st ? st.got : {};
    const one = (nm) => (g[nm] || [])[0];
    const card0 = (before.station || [])[0];
    const cardE = one('station');
    const center = one('center');
    const map = one('slot_center');
    const covered = [];
    for (const nm of L.contents) (g[nm] || []).forEach((e, i) => { if (!e.shown) covered.push(nm + '[' + i + '] 안 보임'); for (const h of e.hits || []) if (!h.ok) covered.push(nm + '[' + i + '] ← ' + h.by); });
    const overlaps = [];
    if (cardE) for (const nm of ['slot_left', 'slot_right', 'attrib_box', ...L.controls, 'map_me', 'map_only3']) for (const [i, e] of (g[nm] || []).entries()) if (e.shown && overlapArea(cardE.rect, e.rect) > 0) overlaps.push(nm + '[' + i + ']');
    const btns = g.station_btns || [];
    const apps = g.station_apps || [];
    // 단추는 둥근 모서리(8px)라 상자 귀퉁이 점은 부모 칸 — 가운데 점만 본다(A3 의 번호 동그라미와 같음)
    const btnBad = btns.filter((b) => !b.shown || b.rect.h < L.touch_min_px || (b.hits || []).slice(0, 1).some((h) => !h.ok)).length;
    const appBad = apps.filter((b) => b.rect.h < L.touch_min_px).length;
    const ratio = map && center ? map.rect.h / center.rect.h : 0;
    row('⑥ ' + fr.name, '진짜 크롬 — 충전판 첫 줄을 누르면 정보 칸이 지도 칸 아래에서 열림 · 지도를 다 가리지 않음 · 판·저작권·아래 띠를 덮지 않음 · 누르는 높이 ≥ ' + L.touch_min_px,
      '처음 숨김 → 보임 · 가운데 칸 안 · 지도 높이 ≥ 가운데 칸의 ' + T.map_min_ratio + ' · 충전기 줄 ≥ 1 · 가림 0 · 겹침 0 · 단추 넷 보이고 가려지지 않음·높이 ≥ ' + L.touch_min_px + ' · 앱 단추 높이 ≥ ' + L.touch_min_px,
      (st ? '누름 ' + st.clicked : '누름 없음') + ' · 처음 ' + (card0 && card0.shown ? '보임' : '숨김') + ' → ' + (cardE && cardE.shown ? '보임' : '숨김') + ' · 이름 ' + JSON.stringify(one('station_name') ? one('station_name').text : '') +
      ' · 가운데 안 ' + (cardE && center ? inside(cardE.rect, center.rect, tc.chrome.tol_px) : '-') + ' · 지도 ' + (map ? Math.round(map.rect.h) : '-') + '/' + (center ? Math.round(center.rect.h) : '-') + 'px(' + ratio.toFixed(2) + ')' +
      ' · 충전기 줄 ' + (g.station_ch || []).length + ' · 가림 ' + covered.length + (covered.length ? '(' + covered.slice(0, 4).join(' / ') + ')' : '') + ' · 겹침 ' + overlaps.length + (overlaps.length ? '(' + overlaps.join(' / ') + ')' : '') +
      ' · 단추 ' + btns.map((b) => Math.round(b.rect.h)).join(',') + 'px(나쁨 ' + btnBad + ') · 앱 단추 ' + apps.length + '(낮음 ' + appBad + ')',
      fr.ready && st && st.clicked && !(card0 && card0.shown) && cardE && cardE.shown && center && inside(cardE.rect, center.rect, tc.chrome.tol_px) && ratio >= T.map_min_ratio
      && (g.station_ch || []).length >= 1 && covered.length === 0 && overlaps.length === 0 && btns.length === 4 && btnBad === 0 && apps.length === NL.apps.length && appBad === 0);
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
      await partS5();
      await partS3();
      await partS7();
      await partEvil();
    } finally {
      log.write('다리 끝 기다림', {});
      const code = await Promise.race([bridge.waitExit(), sleep(T.run_seconds * tc.view_s1.ms_per_s + T.exit_grace_ms).then(() => 'timeout')]);
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
  lines.push('', 'A4 스스로 시험: ' + (ok ? tc.pass_word : tc.fail_word) + ' (' + rows.filter((r) => r.ok).length + ' / ' + rows.length + ') — ' + kstText(tc));
  const text = lines.join('\n');
  console.log(text);
  const dir = path.join(APP, tc.log.dir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, T.report_file), text + '\n', 'utf8');
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
