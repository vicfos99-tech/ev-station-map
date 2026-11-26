// Orchestrator(조립). 일 셋만 한다(설계 원칙 표):
//   ① 만드는 차례대로 만들기  Config → Logger → Store → State → 클라이언트(NetCore 먼저) → CalcRunner·HealthRunner → 화면
//   ② 저마다 필요한 것을 넘기기(의존 주입 — 모듈은 스스로 꺼내 쓰지 않는다)
//   ③ 오류를 받아 로그(잡히지 않은 오류, Config 가 들고 있던 읽기 실패)
// 끝에 app.start 를 한 번 낸다. 위치 받기·계산·판정·상태 표시·화면 일은 하지 않는다.
import { createConfig } from './cfg.js';
import * as timefmt from './timefmt.js';
import { createWebDisk } from './disk_web.js';
import { createLogger } from './log.js';
import { createStore } from './store.js';
import { createState } from './state.js';
import { createNetCore } from './netcore.js';
import { createStartProbe } from './startprobe.js';
import { createRelayBase } from './relay_base.js';
import * as relayParse from './relay_parse.js';
import { createRelayStations } from './relay_stations.js';
import * as relayRead from './relay_read.js';
import * as relayFresh from './relay_fresh.js';
import { createRelayLimit } from './relay_limit.js';
import * as limitmatch from './limitmatch.js';
import * as naviroute from './naviroute.js';
import * as navi from './navi.js';
import { createRouteClient } from './net_route.js';
import * as geo from './geo.js';
import * as fixcheck from './fixcheck.js';
import { createLocWatch } from './loc_watch.js';
import * as health from './health.js';
import { createHealthRunner } from './healthrunner.js';
import * as statecalc from './statecalc.js';
import * as locate from './locate.js';
import * as speed from './speed.js';
import * as ahead from './ahead.js';
import * as formcheck from './formcheck.js';
import * as tapdist from './tapdist.js';
import * as mapcam from './mapcam.js';
import { createCalcRunner } from './calcrunner.js';
import * as board from './board.js';
import { createStatusBar } from './ui_status.js';
import { createDriveScreen } from './ui_drive.js';
import { createMapScreen } from './ui_map.js';
import { createBoardHost } from './ui_boards.js';
import { createLogScreen } from './ui_log.js';
import { createLocateGuide } from './ui_locate.js';
import { createOddButton } from './ui_odd.js';
import { createSearchScreen } from './ui_navi.js';
import { createMyScreen } from './ui_my.js';
import { createTapLabel } from './ui_tap.js';
import { createTopicButton } from './ui_topic.js';
import * as topicpick from './topicpick.js';

export const NEEDS = ['platform'];

// platform = { config, doc, win, fetch, storage, geo, maplibre, console, clock, boards, topics, disk? }
// boards = 빌드가 파일 머리의 선언(KIND 'board')으로 주운 판 목록 — 조립은 그대로 판 틀에 넘길 뿐 판 이름을 모른다(설계 5-1-다).
// topics = 빌드가 KIND 'topic' 으로 주운 제목 꾸러미 목록(정비 나 ①) — 한 번에 하나만 켠다(topicpick: 주소의 제목 표시 → 없으면 첫 꾸러미).
//   켠 꾸러미가 밝힌 받기·계산 줄·셈 모듈·화면을 정해 둔 자리(받기 = 충전소 목록 다음, 계산 = 계산 표의 꽂는 자리, 화면 = '이상해' 단추 다음)에 꽂을 뿐 제목 이름을 모른다.
//   꾸러미 만들기가 던지면(설정이 깨짐) 그 제목만 꺼지고 기본 기능은 돈다(격리).
// (시험 때는 disk·fetch·doc·clock·boards 를 가짜로 바꿔 끼운다)
export function main(platform) {
  const p = platform;
  const made = { cfg: createConfig(p.config) };
  const disk = p.disk || createWebDisk({ storage: p.storage });
  try {
    made.log = createLogger({ cfg: made.cfg, timefmt, disk, clock: p.clock, console: p.console });
  } catch (e) {
    // 로그 설정 자체가 깨져 Logger 를 못 만들 때만 로그가 없다 — 콘솔에 찍고, 뼈대의 상태 자리가 시간 한도 뒤 '시작하지 못함'
    p.console.error(e, made.cfg.problems());
    return made;
  }
  const log = made.log;
  const self = made.cfg.section('config_log').self_where;
  for (const prob of made.cfg.problems()) log.error(prob, { where: self, what: 'config_problem' });
  let c;
  try {
    c = made.cfg.section('config_app');
  } catch (e) {
    // 조립 자신의 설정이 깨지면 시작 알림을 낼 수 없다 — 뼈대의 상태 자리가 시간 한도 뒤 '시작하지 못함'
    log.error(e, { where: self, what: 'make_failed', params: { name: 'config_app' } });
    return made;
  }
  const where = c.where;
  log.info(where, c.words.start, { problems: made.cfg.problems().length });

  if (p.win) {
    p.win.addEventListener(c.events.error, (ev) => log.error(ev.error || ev.message, { where, what: c.words.uncaught, params: { at: ev.filename, line: ev.lineno } }));
    p.win.addEventListener(c.events.rejection, (ev) => log.error(ev.reason, { where, what: c.words.unhandled }));
  }

  function make(name, fn) {
    try {
      made[name] = fn();
      return made[name];
    } catch (e) {
      log.error(e, { where, what: c.words.make_failed, params: { name } });
      return null;
    }
  }

  const base = { cfg: made.cfg, log };
  if (!make('store', () => createStore({ ...base, disk }))) return made;
  if (!make('state', () => createState(base))) return made;
  const s = { ...base, store: made.store, state: made.state, clock: p.clock };
  // 꾸러미 밝힘을 모두 읽는다(가벼움 — 받기·화면은 켠 것만 만든다). 이름은 빌드가 준 것(파일 이름), 깨진 꾸러미는 목록에서 빠진다
  const topics = [];
  for (const t of p.topics || []) {
    const d = make(c.topic_prefix + t.name, () => t.module.createTopic(base));
    if (d) topics.push({ ...d, name: t.name });
  }
  let tcfg = null;
  try {
    tcfg = made.cfg.section('config_ui_topic');
  } catch (e) {
    // 제목 단추 설정이 깨져도 첫 꾸러미로 켠다(단추만 꺼짐 — 격리)
    log.error(e, { where, what: c.words.make_failed, params: { name: 'config_ui_topic' } });
  }
  const want = topicpick.activeOf(topics.map((t) => t.name), tcfg ? topicpick.hashName(p.win && p.win.location ? p.win.location.hash : '', tcfg) : null);
  const topic = topics.find((t) => t.name === want) || null;
  make('netcore', () => createNetCore({ ...base, fetch: p.fetch, clock: p.clock }));
  if (made.netcore) {
    make('startprobe', () => createStartProbe({ ...s, netcore: made.netcore }));
    make('relay_base', () => createRelayBase({ ...base, netcore: made.netcore }));
    if (made.relay_base) make('relay_stations', () => createRelayStations({ ...s, relay_base: made.relay_base, relay_parse: relayParse }));
    if (made.relay_base && topic) for (const [name, fn] of topic.clients({ ...s, relay_base: made.relay_base })) make(name, fn);
    if (made.relay_base) make('relay_limit', () => createRelayLimit({ ...s, relay_base: made.relay_base, relay_parse: relayParse, limitmatch }));
    make('loc_watch', () => createLocWatch({ ...s, netcore: made.netcore, geo: p.geo, fixcheck, geomath: geo }));
    make('net_route', () => createRouteClient({ ...s, netcore: made.netcore, naviroute }));
  }
  make('calcrunner', () => createCalcRunner({ ...s, statecalc, parts: { geo, locate, limitmatch, speed, ahead, naviroute, navi, tapdist, relay_read: relayRead, relay_fresh: relayFresh, timefmt, ...(topic ? topic.parts : {}) }, topic_rows: topic ? topic.rows : [] }));
  make('healthrunner', () => createHealthRunner({ ...s, health }));
  const screen = { ...s, doc: p.doc, win: p.win, timefmt };
  make('ui_status', () => createStatusBar(screen));
  make('ui_drive', () => createDriveScreen(screen));
  make('ui_map', () => createMapScreen({ ...screen, maplibre: p.maplibre, mapcam }));
  make('ui_boards', () => createBoardHost({ ...screen, board, boards: p.boards || [] }));
  make('ui_log', () => createLogScreen(screen));
  make('ui_locate', () => createLocateGuide(screen));
  make('ui_odd', () => createOddButton({ ...screen, formcheck }));
  if (topic) for (const [name, fn] of topic.screens(screen)) make(name, fn);
  make('ui_navi', () => createSearchScreen({ ...screen, formcheck }));
  make('ui_my', () => createMyScreen({ ...screen, formcheck }));
  make('ui_tap', () => createTapLabel(screen));
  make('ui_topic', () => createTopicButton({ ...screen, topicpick, topic_list: topics.map((t) => ({ name: t.name, label: t.label, on: t === topic })) }));

  try {
    made.state.claim(c.owner, [c.events.start])(c.events.start, { at: p.clock.now() });
  } catch (e) {
    log.error(e, { where, what: c.words.make_failed, params: { name: c.events.start } });
  }
  return made;
}
