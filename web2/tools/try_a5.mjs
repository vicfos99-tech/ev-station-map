// A5 스스로 시험(제한 속도 — 순수 셈 + 가상 창 + 진짜 크롬).
//   node web2/tools/try_a5.mjs                 # 전부(다리가 끝날 때까지 + 크롬 세 번)
//   node web2/tools/try_a5.mjs pure|app|chrome  # 그 부분만
// ① 순수: 칸 열쇠 · 파일 검사(0·빈 값·범위 밖 → 없음, 꼴 틀림 → 거절) · 고속도로(선·km·방향) · 일반 도로(거리·방향 문턱) · 후보 갈림 → 없음 · 0 값 → 없음 · 넘음 판단(이어짐·위험·풀림)
// ② S2: 넘으면 경고(주의)가 뜨고 내려가면 풀림 — 제한 100·80 두 곳
// ③ S4: 고속도로 100 → 나들목 길 40 → 일반 도로 60 → 자료 없는 길에서 빈 칸('0'·짐작 값 없음)
// ④ 끊김: 들고 있는 값 그대로 + 상태 자리 한 줄 · 처음부터 못 받으면 빈 칸 · 폰 사본으로 다시 열면 보임 · 돌아오면 줄이 사라짐
// ⑤ 진짜 크롬: 세 모습(정상·넘음·빈 칸) × 네 창 — 덮임 0 · 숫자 잘림 0 · 누르는 높이 48
// 제한 속도 파일은 중계 R5 전이라 시험 다리가 내주지 않는다 — lib_testbed 가 지금 장면의 limits(시험용 값)로 만들어 대신 답한다.
// 표로 찍고 하나라도 실패면 0 아닌 코드. 기록장 tools/logs/try_a5.log, 표 사본 tools/logs/try_a5_last.md.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadToolsConfig, appDir, toolLog, kstText } from './lib_tools.mjs';
import { testbedInfo, makeSecret, writeSecretFile, startBridge, selectScene, seekScene, fetchWithLines, limitShimCtl } from './lib_testbed.mjs';
import { sleep, loadBoards, startApp as runApp, waitFor } from './lib_apprun.mjs';
import { measureInChrome, overlapArea, inside } from './lib_chrome.mjs';

const tc = loadToolsConfig();
const T = tc.try_a5;
const L = tc.layout;
const APP = appDir(tc);
const log = toolLog(tc, 'try_a5');
const cfgOf = (name) => JSON.parse(fs.readFileSync(path.join(APP, tc.build.config_dir, name + tc.build.config_ext), 'utf8'));
const srcOf = async (name) => import(pathToFileURL(path.join(APP, tc.build.src_dir, name + '.js')).href);
const LM = cfgOf('config_limitmatch');
const RP = cfgOf('config_relay_parse');
const SPC = cfgOf('config_speed');
const SP = cfgOf('config_ui_speed');
const RL = cfgOf('config_relay_limit');
const G = cfgOf('config_geo');
const HC = cfgOf('config_health');
const UST = cfgOf('config_ui_status');
const UA = cfgOf('config_ui_ahead');
const J = SPC.judge_words;
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

// ---------- ① 순수 ----------
async function partPure() {
  const lm = await srcOf('limitmatch');
  const rp = await srcOf('relay_parse');
  const sp = await srcOf('speed');
  const geo = await srcOf('geo');
  const P = T.pure;
  const lib = { parts: { geo }, rules: { config_geo: G, config_relay_parse: RP } };
  const Lk = RP.limit;
  // ①-1 칸 — 기대 값은 시험이 따로(설정의 칸 크기로 내림)
  const [la, ln] = P.cell_pt;
  const ey = Math.floor(la / LM.cell.deg);
  const ex = Math.floor(ln / LM.cell.deg);
  const k0 = lm.cellKey(la, ln, LM);
  const ring = lm.cellsAround(la, ln, LM, 1);
  row('①-1', '칸 열쇠(위도·경도 ÷ 칸 크기 ' + LM.cell.deg + '° 내림) · 지금 칸과 이웃 칸 9', ey + LM.cell.sep + ex + ' · 9칸(서로 다름) · 맨 앞 = 지금 칸 · ' + (ey + 1) + LM.cell.sep + (ex + 1) + ' 들어 있음',
    k0 + ' · ' + ring.length + '칸(다름 ' + new Set(ring).size + ') · 맨 앞 ' + ring[0], k0 === ey + LM.cell.sep + ex && ring.length === 9 && new Set(ring).size === 9 && ring[0] === k0 && ring.includes((ey + 1) + LM.cell.sep + (ex + 1)));
  // ①-2 파일 검사
  const V = { [RP.v_key]: RP.v, [RP.meta_at_key]: 'x' };
  const hw = rp.limitHighway({ ...V, [Lk.sections_key]: [
    { line: P.line, from_km: 0, to_km: 10, fwd: 100, back: 0 },
    { line: P.line, from_km: 10, to_km: 20, fwd: null, back: 200 },
    { line: P.line, from_km: 20, to_km: 20, fwd: 100 },
    { from_km: 1 },
  ] }, RP);
  let t1 = false; let t2 = false;
  try { rp.limitHighway({ ...V, [Lk.sections_key]: [] }, RP); } catch (e) { t1 = true; }
  try { rp.limitHighway({ [RP.v_key]: RP.v + 1, [Lk.sections_key]: [{ line: P.line, from_km: 0, to_km: 1, fwd: 100 }] }, RP); } catch (e) { t2 = true; }
  const ix = rp.limitIndex({ ...V, [Lk.cells_key]: [k0, 'bad key', 5] }, RP);
  const A = P.road_a; const B = P.road_b;
  const cl = rp.limitCell({ ...V, [Lk.cell_key]: k0, [Lk.segs_key]: [
    { id: 'a', kmh: 60, both: true, pts: [A, B] }, { id: 'b', kmh: 0, pts: [A, B] }, { id: 'c', kmh: null, pts: [A, B] },
    { id: 'd', kmh: 60, pts: [[99, 999], B] }, { id: 'e', kmh: 60, pts: [A] },
  ] }, RP);
  row('①-2', '제한 속도 파일 검사 — 0·빈 값·범위 밖(200)은 없음(null)로, 꼴 틀린 구간·조각은 빼고, 구간 0 개·판 번호 틀림은 거절 · 목차의 틀린 칸 이름 뺌',
    '표: 좋은 2(100/null · null/null) 나쁨 2 빈 값 3 · 거절 둘 · 목차 [' + k0 + '] 나쁨 2 · 칸: 좋은 1(a, 상자 있음) 빈 값 2 나쁨 2',
    '표: 좋은 ' + hw.good.length + '(' + hw.good.map((s) => s.fwd + '/' + s.back).join(' · ') + ') 나쁨 ' + hw.bad.length + ' 빈 값 ' + hw.blank + ' · 거절 ' + [t1, t2].filter(Boolean).length + ' · 목차 ' + JSON.stringify(ix.cells) + ' 나쁨 ' + ix.bad + ' · 칸: 좋은 ' + cl.good.length + '(' + cl.good.map((s) => s.id + (s.box ? ', 상자' : '')).join() + ') 빈 값 ' + cl.blank + ' 나쁨 ' + cl.bad.length,
    hw.good.length === 2 && hw.good[0].fwd === 100 && hw.good[0].back === null && hw.good[1].fwd === null && hw.good[1].back === null && hw.bad.length === 2 && hw.blank === 3 && t1 && t2
    && ix.cells.length === 1 && ix.cells[0] === k0 && ix.bad === 2 && cl.good.length === 1 && cl.good[0].id === 'a' && !!cl.good[0].box && cl.blank === 2 && cl.bad.length === 2);
  // ①-3 고속도로
  const far = { t: 1, lat: 36.0, lng: 128.0, heading_deg: 180 };
  const hwData = { highway: { sections: [{ line: P.line, from_km: 28, to_km: 64, fwd: 100, back: 90 }, { line: P.line, from_km: 64, to_km: 70, fwd: 80, back: 80 }] }, cells: {} };
  const at = (pos, data) => lm.limitOf({ fix: far, 'limit.data': data }, { pos }, LM, lib, null);
  const pos = (km, dir, line, on) => ({ on_line: on !== false, line: line || P.line, km, dir });
  const h = [
    at(pos(50, 'forward'), hwData), at(pos(50, 'backward'), hwData), at(pos(50, null), hwData), at(pos(64, 'forward'), hwData),
    at(pos(50, 'forward', 'other_line'), hwData), at(pos(50, 'forward', null, false), hwData), at(pos(50, 'forward'), undefined),
  ];
  const hs = h.map((x) => x.kmh + '/' + x.why);
  row('①-3', '고속도로 — 선·km·방향으로 구간 표: 선 방향 100 · 거꾸로 90 · 방향 모름 → 없음 · km 64(경계) → 다음 구간 80 · 다른 선·선 밖 → 없음 · 자료 안 옴 → 없음',
    '100/found · 90/found · null/none · 80/found · null/none · null/none · null/no_data', hs.join(' · '),
    hs.join('|') === ['100/found', '90/found', 'null/none', '80/found', 'null/none', 'null/none', 'null/no_data'].join('|'));
  // ①-4 일반 도로(동쪽으로 가는 조각 위)
  const mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  const north = (m) => mid[0] + m / P.m_per_deg_lat;
  const mk = (segs) => { const c = rp.limitCell({ ...V, [Lk.cell_key]: k0, [Lk.segs_key]: segs }, RP); return { highway: null, cells: { [lm.cellKey(mid[0], mid[1], LM)]: { segs: c.good } } }; };
  const one = mk([{ id: 'r1', kmh: 60, both: false, pts: [A, B] }]);
  const two = mk([{ id: 'r1', kmh: 60, both: true, pts: [A, B] }]);
  const rd = (data, lat, head) => lm.limitOf({ fix: { t: 1, lat, lng: mid[1], heading_deg: head }, 'limit.data': data }, {}, LM, lib, null);
  const r = [rd(one, mid[0], P.east_deg), rd(one, mid[0], P.north_deg), rd(one, mid[0], P.east_deg + 180), rd(two, mid[0], P.east_deg + 180), rd(one, north(P.off_far_m), P.east_deg), rd(one, mid[0], null)];
  const rs = r.map((x) => x.kmh + '/' + x.why);
  row('①-4', '일반 도로 — 조각 위 같은 방향 60 · 직각 방향 → 없음 · 반대 방향(한 방향 조각) → 없음 · 반대 방향(양방향 조각) 60 · ' + P.off_far_m + ' m 떨어짐(문턱 ' + LM.road_dist_m + ' m) → 없음 · 방향 값 없음 → 거리만으로 60',
    '60/found · null/none · null/none · 60/found · null/none · 60/found', rs.join(' · '), rs.join('|') === ['60/found', 'null/none', 'null/none', '60/found', 'null/none', '60/found'].join('|'));
  // ①-5 후보 갈림
  const up = (m) => [[A[0] + m / P.m_per_deg_lat, A[1]], [B[0] + m / P.m_per_deg_lat, B[1]]];
  const split = mk([{ id: 'r1', kmh: 60, pts: [A, B] }, { id: 'r2', kmh: 80, pts: up(P.off_near_m) }]);
  const agree = mk([{ id: 'r1', kmh: 60, pts: [A, B] }, { id: 'r2', kmh: 60, pts: up(P.off_near_m) }]);
  const s1 = rd(split, north(P.off_near_m / 2), P.east_deg);
  const s2 = rd(agree, north(P.off_near_m / 2), P.east_deg);
  const hwRoad = { ...one, highway: { sections: [{ line: P.line, from_km: 28, to_km: 64, fwd: 100, back: 100 }] } };
  const s3 = lm.limitOf({ fix: { t: 1, lat: mid[0], lng: mid[1], heading_deg: P.east_deg }, 'limit.data': hwRoad }, { pos: pos(50, 'forward') }, LM, lib, null);
  row('①-5', '후보 갈림 → 없음 — ' + P.off_near_m + ' m 옆 나란한 두 조각 60·80(고가 아래 길처럼) · 고속도로 100 + 바로 아래 일반 도로 60 · (값이 같으면 그 값)',
    'null/split · 60/found(후보 2) · null/split', s1.kmh + '/' + s1.why + ' · ' + s2.kmh + '/' + s2.why + '(후보 ' + s2.n + ') · ' + s3.kmh + '/' + s3.why,
    s1.kmh === null && s1.why === LM.why_words.split && s2.kmh === 60 && s2.n === 2 && s3.kmh === null && s3.why === LM.why_words.split);
  // ①-6 0·빈 값
  const z1 = at(pos(50, 'forward'), { highway: { sections: [{ line: P.line, from_km: 28, to_km: 64, fwd: 0, back: null }] }, cells: {} });
  const z2 = rd({ highway: null, cells: { [lm.cellKey(mid[0], mid[1], LM)]: { segs: [{ id: 'z', kmh: 0, both: true, pts: [A, B] }] } } }, mid[0], P.east_deg);
  const z3 = rd(mk([{ id: 'z', kmh: 0, both: true, pts: [A, B] }, { id: 'y', kmh: 60, both: true, pts: [[A[0], A[1] + 1], [B[0], B[1] + 1]] }]), mid[0], P.east_deg);
  row('①-6', "0·빈 값 → 없음 — 표의 값 0(검사를 안 거친 자료라도) · 조각 값 0 · 검사(파일)에서 0 조각이 빠진 뒤", 'null/none · null/none · null/none(속도판 빈 칸 — 0 을 보이지 않음)',
    z1.kmh + '/' + z1.why + ' · ' + z2.kmh + '/' + z2.why + ' · ' + z3.kmh + '/' + z3.why, z1.kmh === null && z2.kmh === null && z3.kmh === null && z1.why === LM.why_words.none && z2.why === LM.why_words.none && z3.why === LM.why_words.none);
  // ①-7 넘음 판단
  const lim = (k) => ({ limit: { kmh: k } });
  const seq = [];
  let own = null;
  for (const [t, v, k] of [[0, 115, 100], [1000, 115, 100], [2000, 115, 100], [3000, 125, 100], [4000, 95, 100], [5000, 115, 100], [6000, 115, null]]) {
    own = sp.speedOf({ fix: { t, lat: mid[0], lng: mid[1], speed_kmh: v } }, lim(k), SPC, lib, own);
    seq.push(own.judge);
  }
  const keep = sp.speedOf({ fix: { t: 6000, lat: mid[0], lng: mid[1] } }, lim(100), SPC, lib, own);
  row('①-7', '넘음 판단 — 제한 100 + 여유 ' + SPC.over_margin_kmh + ' 를 ' + SPC.over_hold_ms + 'ms 이어서 넘어야 넘음 · +' + SPC.danger_margin_kmh + ' 넘으면 위험 · 내려가면 곧바로 정상 · 다시 넘으면 처음부터 셈 · 제한 없음 → 판단 없음 · 같은 위치로 다시 셈하면 앞 속도 그대로',
    [J.ok, J.ok, J.over, J.danger, J.ok, J.ok, J.none].join(',') + ' · 다시 셈 115/' + J.ok + '(넘음 셈은 그때부터)', seq.join(',') + ' · 다시 셈 ' + keep.kmh + '/' + keep.judge,
    seq.join(',') === [J.ok, J.ok, J.over, J.danger, J.ok, J.ok, J.none].join(',') && keep.kmh === 115 && keep.judge === J.ok);
}

// ---------- 앱 띄우기 ----------
function start(opts) {
  return runApp({ app: APP, tc, main, boards: BOARDS }, { secretFile: SECRET_FILE, ...opts, fetchFn: fetchWithLines(tc, INFO, SECRET, fetch), stamp: 'try-a5' });
}
async function openAt(scene, tick, opts) {
  await selectScene(INFO, scene, false);
  if (tick) await seekScene(INFO, tick);
  const a = start(opts || {});
  await wait(() => a.stage() && a.stage() !== HC.stages.starting, T.start_wait_ms);
  await wait(() => !!a.get('speed'), T.start_wait_ms);
  return a;
}
const look = (a) => ({
  v: a.el(SP.ids.value).textContent, lim: a.el(SP.ids.limit).textContent, label: a.el(SP.ids.limit_label).textContent,
  judge: a.el(SP.ids.root).getAttribute(SP.judge_attr), row: a.el(SP.ids.limit_row).getAttribute(SP.limit_attr),
});
const lookText = (x) => '속도 ' + JSON.stringify(x.v) + ' · ' + JSON.stringify(x.label + ' ' + x.lim) + ' · ' + x.judge + ' · 칸 ' + x.row;
const overOk = (a) => a.seen.speed.filter((s) => s.judge === J.over || s.judge === J.danger).every((s) => typeof s.over_since === 'number' && s.t - s.over_since >= SPC.over_hold_ms);

// ---------- ② S2 ----------
async function partS2() {
  for (const [i, cs] of T.s2.cases.entries()) {
    const a = await openAt(T.s2.scene, cs.seek);
    const want = String(cs.limit);
    const over = await wait(() => { const x = look(a); return x.lim === want && x.judge === J.over; }, cs.over_wait_ms);
    const x1 = look(a);
    const rel = await wait(() => { const x = look(a); return x.lim === want && x.judge === J.ok; }, cs.release_wait_ms);
    const x2 = look(a);
    const firstOver = a.seen.speed.find((s) => s.judge === J.over);
    row('②-' + (i + 1), 'S2 ' + cs.title + ' — 넘으면 경고(주의)가 뜨고 내려가면 풀림 · 넘음은 ' + SPC.over_hold_ms + 'ms 이어진 뒤',
      '넘음: 제한 ' + want + ' · ' + J.over + ' → 풀림: 제한 ' + want + ' · ' + J.ok + ' · 이어짐 지킴',
      '넘음 ' + lookText(x1) + ' → 풀림 ' + lookText(x2) + ' · 첫 넘음 ' + (firstOver ? (firstOver.t - firstOver.over_since) + 'ms 이어진 뒤' : '-'),
      over && rel && x1.label === SP.texts.limit_label && x2.v !== '' && Number(x2.v) <= cs.limit + SPC.over_margin_kmh && overOk(a));
    a.stop();
  }
}

// ---------- ③ S4 ----------
async function partS4() {
  const S = T.s4;
  const seenVals = new Set();
  let no = 0;
  for (const part of [S.first, S.second]) {
    const a = await openAt(S.scene, part.seek);
    for (const st of part.steps) {
      no += 1;
      const want = st.limit === null ? '' : String(st.limit);
      const ok = await wait(() => { const x = look(a); return x.lim === want && x.v !== '' && (st.limit !== null || (x.row === SP.limit_words.blank && x.judge === J.none && x.label === '')); }, st.wait_ms);
      const x = look(a);
      const lp = a.get('limit');
      row('③-' + no, 'S4 ' + st.title + (st.limit === null ? " — 빈 칸('0'·짐작 값 없음), 지금 속도는 그대로" : ' — 제한 ' + st.limit),
        st.limit === null ? '제한 칸 빈 글 · 칸 ' + SP.limit_words.blank + ' · 판단 ' + J.none + ' · 속도 보임' : '제한 "' + want + '"',
        lookText(x) + ' · limit 조각 ' + (lp ? lp.kmh + '/' + lp.why + '/' + lp.src : '-'), ok);
    }
    for (const l of a.seen.limit) seenVals.add(l.kmh);
    a.stop();
  }
  const odd = [...seenVals].filter((v) => v !== null && !S.allowed.includes(v));
  row('③-' + (no + 1), 'S4 내내 나온 제한 속도 값 — 장면 값(' + S.allowed.join('·') + ')과 없음뿐(짐작·0 없음)', '그 밖 0', '나온 값 ' + JSON.stringify([...seenVals]) + ' · 그 밖 ' + odd.length, odd.length === 0 && !seenVals.has(0));
}

// ---------- ④ 끊김 ----------
async function partDown() {
  const D = T.down;
  const over = { config_relay_limit: { ...RL, refresh_ms: T.refresh_ms, retry_ms: T.refresh_ms } };
  const dataName = UST.texts.src_names[HC.conn_source[RL.conn_piece]];
  const a = await openAt(D.scene, D.seek, { overrides: over });
  const got = await wait(() => look(a).lim === String(D.limit), T.start_wait_ms);
  const asked0 = limitShimCtl.asked;
  limitShimCtl.down = true;
  try {
    const down = await wait(() => a.statusText().includes(dataName), D.down_wait_ms);
    await sleep(D.hold_ms);
    const x = look(a);
    const fails = a.logLines().filter((l) => l.includes(RL.word_fail)).length;
    row('④-1', '끊김 — 받아 둔 제한 속도는 그대로 보임(설계 5-7 (4)) · 상태 자리에 ' + dataName + ' 끊김 · 다시 받기를 계속 시도(기록장 ' + RL.word_fail + ')',
      '끊기 전 제한 ' + D.limit + ' · 끊긴 뒤 ' + D.hold_ms + 'ms 에도 제한 ' + D.limit + ' · 상태 자리 줄 · 실패 기록 ≥ 2',
      (got ? '끊기 전 제한 ' + D.limit : '끊기 전 제한 못 봄') + ' · ' + lookText(x) + ' · 상태 자리 ' + JSON.stringify(a.statusText()) + ' · 물음 ' + (limitShimCtl.asked - asked0) + ' · 실패 기록 ' + fails,
      got && down && x.lim === String(D.limit) && fails >= 2);
    const b = await openAt(D.scene, 0);
    await sleep(D.hold_ms);
    const y = look(b);
    row('④-2', '끊긴 채 새로 켬(폰 사본 없음) — 받은 것이 없으니 제한 칸은 빈 칸, 지금 속도는 보임', '속도 보임 · 제한 빈 글 · 칸 ' + SP.limit_words.blank + ' · 판단 ' + J.none,
      lookText(y), y.v !== '' && y.lim === '' && y.row === SP.limit_words.blank && y.judge === J.none);
    b.stop();
    const c = await openAt(D.scene, 0, { disk: a.disk });
    const fromCopy = await wait(() => look(c).lim === String(D.limit), D.back_wait_ms);
    const held = c.made.relay_limit ? c.made.relay_limit.held() : null;
    row('④-3', '끊긴 채 다시 켬(앞 앱이 쓴 폰 사본 있음) — 사본의 제한 속도로 보임', '제한 ' + D.limit + ' · 표의 출처 ' + RL.from_words.copy,
      lookText(look(c)) + ' · 출처 ' + (held && held.highway ? held.highway.from : '-'), fromCopy && held && held.highway && held.highway.from === RL.from_words.copy);
    c.stop();
  } finally {
    limitShimCtl.down = false;
  }
  const back = await wait(() => !a.statusText().includes(dataName), D.back_wait_ms);
  row('④-4', '돌아옴 — 상태 자리에서 끊김 줄이 사라지고 제한 속도 그대로', '끊김 줄 없음 · 제한 ' + D.limit, JSON.stringify(a.statusText()) + ' · ' + lookText(look(a)), back && look(a).lim === String(D.limit));
  a.stop();
}

// ---------- ⑤ 진짜 크롬 ----------
async function partChrome() {
  const sel0 = { ...L.sel, ...T.chrome_sel };
  // node try_a5.mjs chrome <판단> — 그 모습만(한 번에 다리 한 벌씩이라 셋을 나눠 돌릴 수 있게)
  const pick = process.argv[3];
  for (const lk of T.chrome_looks.filter((x) => !pick || x.judge === pick)) {
    const sel ={ ...sel0, look: { q: T.chrome_sel.look.q.split(T.judge_mark).join(lk.judge) } };
    const ready = { look: { min: 1 }, speed_value: { min: 1, text: true }, ...(lk.limit ? { speed_limit: { min: 1, text: true } } : {}) };
    const res = await measureInChrome(tc, APP, { scene: lk.scene, tick: lk.tick, frames: L.frames, sel, ready, actions: [], log });
    const dir = path.join(APP, tc.log.dir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'try_a5_chrome_' + lk.judge + '.json'), JSON.stringify(res, null, 1), 'utf8');
    if (res.error) { row('⑤ ' + lk.name, '진짜 크롬 재기 — ' + lk.name, '결과 옴', res.error, false); continue; }
    for (const fr of res.frames) {
      const g = fr.got || {};
      const one = (n) => (g[n] || [])[0];
      const root = one('speed_root');
      const val = one('speed_value');
      const limEl = one('speed_limit');
      const rowEl = one('speed_limit_row');
      const unit = one('speed_unit');
      const slot = one('slot_left');
      const tol = tc.chrome.tol_px;
      const covered = [];
      for (const [nm, e] of [['speed_value', val], ['speed_limit', limEl]]) {
        if (!e || !e.shown) continue;
        for (const h of e.hits || []) if (!h.ok) covered.push(nm + ' ← ' + h.by);
      }
      const cut = [];
      if (root && root.sw > root.cw + tol) cut.push('판 넘침 ' + root.sw + '>' + root.cw);
      for (const [nm, e] of [['speed_value', val], ['speed_limit', limEl], ['speed_unit', unit]]) if (e && e.shown && root && !inside(e.rect, root.rect, tol)) cut.push(nm + ' 판 밖');
      if (root && slot && !inside(root.rect, slot.rect, tol)) cut.push('판이 왼편 자리 밖');
      const overlaps = [];
      if (root) for (const nm of L.controls) for (const [i, e] of (g[nm] || []).entries()) if (e.shown && overlapArea(root.rect, e.rect) > 0) overlaps.push(nm + '[' + i + ']');
      const lowTouch = [];
      for (const nm of L.touch) for (const e of g[nm] || []) if (e.shown && e.rect.h < L.touch_min_px) lowTouch.push(nm + ' ' + Math.round(e.rect.h));
      const limText = limEl ? limEl.text : '';
      const judge = root ? root.attrs['data-judge'] : null;
      const rowAttr = rowEl ? rowEl.attrs['data-limit'] : null;
      const lookOk = judge === lk.judge && limText === lk.limit && limText !== '0' && rowAttr === (lk.limit ? SP.limit_words.shown : SP.limit_words.blank);
      row('⑤ ' + lk.name + ' ' + fr.name, '진짜 크롬 — 속도판 ' + lk.name + '(' + lk.scene + ' 틱 ' + lk.tick + ') · 덮임 0 · 숫자 잘림 0 · 단추 높이 ≥ ' + L.touch_min_px,
        '판단 ' + lk.judge + ' · 제한 ' + JSON.stringify(lk.limit) + ' · 가림 0 · 잘림 0 · 겹침 0 · 낮은 단추 0',
        (fr.ready ? '' : '준비 안 됨 · ') + '속도 ' + JSON.stringify(val ? val.text : '') + ' · 판단 ' + judge + ' · 제한 ' + JSON.stringify(limText) + '(칸 ' + rowAttr + ') · 판 ' + (root ? Math.round(root.rect.w) + '×' + Math.round(root.rect.h) : '-') +
        ' · 가림 ' + covered.length + (covered.length ? '(' + covered.slice(0, 3).join(' / ') + ')' : '') + ' · 잘림 ' + cut.length + (cut.length ? '(' + cut.join(' / ') + ')' : '') +
        ' · 겹침 ' + overlaps.length + ' · 낮은 단추 ' + lowTouch.length + (lowTouch.length ? '(' + lowTouch.join(', ') + ')' : ''),
        fr.ready && lookOk && val && val.text !== '' && covered.length === 0 && cut.length === 0 && overlaps.length === 0 && lowTouch.length === 0);
    }
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
      await partS2();
      await partS4();
      await partDown();
    } finally {
      log.write('다리 끝 기다림', {});
      // 기다림 한도 타이머는 다리가 끝나면 지운다(남겨 두면 시험이 끝난 뒤에도 그 시간만큼 프로세스가 안 끝남)
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
  lines.push('', 'A5 스스로 시험: ' + (ok ? tc.pass_word : tc.fail_word) + ' (' + rows.filter((r) => r.ok).length + ' / ' + rows.length + ') — ' + kstText(tc));
  const text = lines.join('\n');
  console.log(text);
  const dir = path.join(APP, tc.log.dir);
  fs.mkdirSync(dir, { recursive: true });
  // 부분만 돌렸으면 그 부분 이름을 붙인 사본(전부는 한 번에 10분이 넘어 나눠 돌릴 수 있게)
  const part = [process.argv[2], process.argv[3]].filter(Boolean).join('_');
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
