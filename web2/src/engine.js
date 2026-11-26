// 순수: 충전소 고르기 엔진(설계 5-1 engine — 옛 앱 web/engine.js 를 옮김. 파이썬 src/ev_charge_planner 와 계산 차례까지 같게: 부동소수 결과가 같아야 한다).
// 다른 점: ES 모듈 · 숫자(여유·도착 잔량·오래됨·점수 문턱·백분율·분↔밀리초·허용 오차)와 알림 글은 규칙 r = config_engine 에서 받는다.
// 자료 꼴은 옛 엔진과 같다(snake_case, 시각은 밀리초). 틀린 입력은 ValueError 로 던진다. 로그 없음.
// (정비 나 ③) 한 파일에 일 열 가지가 넘어 일 단위로 나눴다: 검사·만들기 engine_model · 거리 engine_range · 상태 engine_status · 요금 engine_price · 목록 engine_list · 추천 engine_pick.
// 이 파일은 일 하나(p7 planner — 검사 → 목록 → 추천을 차례로)와, 쓰는 쪽(planinput·시험)이 보던 이름을 그대로 내주는 일만 한다.
import * as model from './engine_model.js';
import * as range from './engine_range.js';
import * as status from './engine_status.js';
import * as price from './engine_price.js';
import * as list from './engine_list.js';
import * as pick from './engine_pick.js';

export const NEEDS = [];

export const ValueError = model.ValueError;
export const makeRoute = model.makeRoute;
export const makeVehicle = model.makeVehicle;
export const makeUser = model.makeUser;
export const conservative_range_km = range.conservative_range_km;
export const km_per_pct = range.km_per_pct;
export const arrival_soc_pct = range.arrival_soc_pct;
export const can_reach = range.can_reach;
export const summarize_station = status.summarize_station;
export const rest_area_alerts = status.rest_area_alerts;
export const quote = price.quote;
export const build_route_list = list.build_route_list;
export const score_candidate = pick.score_candidate;
export const recommend = pick.recommend;

// ---------- p7 planner ----------
// 입력은 보통 객체(JSON). 여기서 검사하고 계산한다.
export function plan(route, vehicle, user, now, position_km, stale_minutes, r) {
  const rt = model.makeRoute(route, r);
  const v = model.makeVehicle(vehicle, r);
  const u = model.makeUser(user, r);
  const route_list = list.build_route_list(rt, v, u, now, position_km, stale_minutes, r);
  const recommendation = pick.recommend(route_list, v, r);
  return { route_list, recommendation };
}
