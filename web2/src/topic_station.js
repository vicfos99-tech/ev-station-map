// 제목 꾸러미 '충전소'(정비 나 ① — 첫 꾸러미). 앱 = 내비 기본 기능 + 그 위의 제목 하나. 이 파일이 충전소 제목에 딸린 것을 한데 묶어 밝힌다:
//   · 받기: 충전기 상태 받기(relay_status — 정보 칸·목록이 열려 있는 동안 그 시군구만)
//   · 계산: 이 제목만의 계산 줄(config_topic_station.calc_rows — '앞의 충전소' ahead·목록·추천 plan)과 그 셈 모듈(engine·planinput·mine).
//           '앞의 ○○' 셈(ahead)은 제목을 모르는 기본 모듈이고, 충전소 규칙(config_ahead)만 이 꾸러미의 것이다.
//   · 화면: 정보 칸(ui_station)·목록 칸(ui_route). 판(ui_ahead 등 KIND board)은 판 틀이 따로 줍는다.
// 빌드가 파일 머리의 KIND 'topic' 을 보고 줍는다(제목 목록 — 판처럼). 조립은 목록을 읽을 뿐 '충전소'를 모른다 — 새 제목은 이런 꾸러미 파일과 그 설정만 더한다.
// 만들기(createTopic)가 던지면(꾸러미 설정이 깨짐) 조립이 그 제목만 끄고 기본 기능은 그대로 돈다(정비 가 ⑤ 격리).
import { createRelayStatus } from './relay_status.js';
import { createStationCard } from './ui_station.js';
import { createRouteScreen } from './ui_route.js';
import * as relayParse from './relay_parse.js';
import * as relayRead from './relay_read.js';
import * as relayFresh from './relay_fresh.js';
import * as navlink from './navlink.js';
import * as formcheck from './formcheck.js';
import * as engine from './engine.js';
import * as planinput from './planinput.js';
import * as mine from './mine.js';

export const KIND = 'topic';
export const NEEDS = ['cfg'];

// 돌려주는 것 = {label, rows, parts, clients(d) → [[이름, 만들기]], screens(d) → [[이름, 만들기]]}
//   d = 조립이 넘기는 기본 것(cfg·log·state·store·clock, 받기는 relay_base, 화면은 doc·win·timefmt). 이름은 조립이 만든 것 표(made)의 이름.
export function createTopic(deps) {
  const c = deps.cfg.section('config_topic_station');
  return {
    label: c.label,
    rows: c.calc_rows,
    parts: { engine, planinput, mine },
    clients: (d) => [
      ['relay_status', () => createRelayStatus({ ...d, relay_parse: relayParse, relay_read: relayRead })],
    ],
    screens: (d) => [
      ['ui_station', () => createStationCard({ ...d, relay_read: relayRead, relay_fresh: relayFresh, navlink })],
      ['ui_route', () => createRouteScreen({ ...d, formcheck, relay_fresh: relayFresh })],
    ],
  };
}
