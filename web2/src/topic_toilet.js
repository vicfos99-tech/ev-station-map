// 제목 꾸러미 '화장실'(추가3 — 두 번째 꾸러미). 앱 = 내비 기본 기능 + 그 위의 제목 하나. 이 파일이 화장실 제목에 딸린 것을 한데 묶어 밝힌다:
//   · 받기: 화장실 목록 받기(relay_toilets — 중계 공공 자료 + 묘성이 적은 자료 + 휴게소 화장실을 합침, 묘성 것이 이김)
//   · 계산: 이 제목만의 계산 줄(config_topic_toilet.calc_rows — 화장실 목록 toilet.list 와 '앞의 화장실' ahead)과 그 셈 모듈(toiletcalc — '앞의 ○○' ahead 를 그대로 씀)
//   · 화면: 화장실 목록 칸(ui_toilet_list)·화장실 정보 칸(ui_toilet_card). 화장실판(ui_toilet_board — KIND board)은 판 틀이 줍고 화장실 제목일 때만 꽂는다.
//   · 지도: 다른 점 층 = 화장실(toilets), 누름 = toilet.select.map(config_topic_toilet.map)
//   · 등급·이름 글·화면 차례·중계 파일 이름 무늬는 config_topic_toilet 의 adds·views 가 밝힌다 — 남의 파일을 고치지 않는다.
// 만들기(createTopic)가 던지면(꾸러미 설정이 깨짐) 조립이 이 제목만 끄고 충전소 제목·기본 기능은 그대로 돈다.
import { createRelayToilets } from './relay_toilets.js';
import { createToiletList } from './ui_toilet_list.js';
import { createToiletCard } from './ui_toilet_card.js';
import * as toiletmerge from './toiletmerge.js';
import * as toiletcalc from './toiletcalc.js';
import * as geo from './geo.js';

export const KIND = 'topic';
export const NEEDS = ['cfg'];

// 돌려주는 것 = {label, rows, parts, map, clients(d), screens(d)} — 꼴은 충전소 꾸러미(topic_station)와 같다(map 은 추가3 앞 기본 걸음에서 생김)
export function createTopic(deps) {
  const c = deps.cfg.section('config_topic_toilet');
  return {
    label: c.label,
    rows: c.calc_rows,
    parts: { toiletcalc },
    map: c.map,
    clients: (d) => [
      ['relay_toilets', () => createRelayToilets({ ...d, toiletmerge, geomath: geo })],
    ],
    screens: (d) => [
      ['ui_toilet_list', () => createToiletList(d)],
      ['ui_toilet_card', () => createToiletCard(d)],
    ],
  };
}
