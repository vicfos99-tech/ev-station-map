// MapScreen(지도 — 화면, 설계 5-1-나 ui_map · 5-8 다). 운전 화면 가운데 칸에 지도를 열고:
//   · fix → 내 위치 점 + MapCam(순수 — 카메라 규칙)이 낸 명령 하나를 mapview 로(손으로 돌린 방향·확대는 굳어 그대로)
//   · 손으로 만진 것(mapview 가 알림) → MapCam · '내 위치' 단추 → MapCam(따라가기 켬·진행 방향으로 되돌림)
//   · ahead 구독 → 1·2·3번 표시(충전소판과 같은 조각 하나를 둘이 구독 — 번호가 바뀌면 같이 바뀜), stations 구독 → 다른 충전소 층
//   · '세 곳만' 단추 → 다른 충전소 층 숨김·보임
//   · (A6) route 구독 → 경로 선(선만 더 그림 — 카메라는 건드리지 않는다, 설계 5-8 바 2). 없으면(지움) 선을 지움
//   · (A4) 번호·충전소 점을 누르면 station.select.map 으로 요청만(정보 칸이 듣는다 — 카메라는 그대로)
//   · (A8) 빈 곳을 누르면 map.tap 으로 요청만(누른 지점 거리 — CalcRunner·ui_tap). map.pin 을 듣고 그 화면 조각을 그 좌표의 지도 풍선에 꽂음(카메라는 그대로)
//   · 카메라 상태(따라가기·굳음·확대·방향·'세 곳만')는 폰 데이터 폴더에 저장(손·단추로 바뀔 때만)하고 다시 열면 읽는다. map.cam 으로 알린다('이상해' 기록에 담김)
// 바탕 그림(타일) 주소는 config_ui_map 에만 있고 지도 라이브러리가 직접 받는다(설계 원칙 '바깥 주소는 하나'의 예외). 바탕 그림 성공·실패는 conn.tiles 로(바뀔 때만).
import { createMapView } from './mapview.js';

export const NEEDS = ['cfg', 'log', 'state', 'store', 'doc', 'clock', 'maplibre', 'mapcam'];

export function createMapScreen(deps) {
  const c = deps.cfg.section('config_ui_map');
  const r = deps.cfg.section('config_health');
  const m = deps.cfg.section('config_mapcam');
  const cam = deps.mapcam;
  const log = deps.log;
  const doc = deps.doc;
  const clock = deps.clock;
  const pub = deps.state.claim(c.owner, [c.tiles_piece, c.cam_piece, c.select_piece, c.tap.piece]);
  let taps = 0;
  let lastPin = null;
  let view = null;
  let last = null;
  let tilesOk = null;
  let fixes = 0;
  let moves = 0;
  let s = cam.init(null, m);
  let loaded = false;
  let lastAhead = null;
  let lastStations = null;
  let lastRoute = null;

  const $ = (id) => {
    const el = doc.getElementById(id);
    if (!el) throw new Error(id);
    return el;
  };

  function tiles(ok, why) {
    if (tilesOk === ok) return;
    tilesOk = ok;
    pub(c.tiles_piece, { ok, code: ok ? null : c.tiles_code });
    if (!ok) log.warn(c.where, c.word_tiles_bad, { why });
  }

  function announce() {
    pub(c.cam_piece, cam.saved(s));
  }

  async function save() {
    const res = await deps.store.write(c.store_key, cam.saved(s));
    if (!res.ok) log.warn(c.where, c.word_save_failed, { why: res.why });
  }

  function only3Button() {
    try {
      const b = $(c.ids.only3);
      b.setAttribute(c.pressed_attr, s.only3 ? c.yes_word : c.no_word);
      b.textContent = s.only3 ? c.texts.only3_on : c.texts.only3_off;
    } catch (e) {
      log.error(e, { where: c.where, params: { act: c.act_only3 } });
    }
  }

  function move(cmd) {
    if (view && view.camera(cmd)) moves += 1;
  }

  function drawAhead(a) {
    if (!view) return;
    const items = a && Array.isArray(a.items) ? a.items.filter((it) => typeof it.lat === 'number' && typeof it.lng === 'number') : [];
    view.setNumbered(items, a && a.mode === c.around_mode ? c.marks.around_kind : c.marks.ahead_kind);
  }

  // (A6) 경로 선 — CalcRunner 의 route(노선 꼴 [[위도, 경도]…])를 지도 꼴([경도, 위도])로. 없으면 지움. 카메라는 그대로
  function drawRoute(rt) {
    if (!view) return;
    const pts = rt && Array.isArray(rt.points) ? rt.points : null;
    view.setRoute(pts ? pts.map((p) => [p[1], p[0]]) : null);
  }

  function drawStations(st) {
    if (!view) return;
    const list = st && Array.isArray(st[c.stations_list_key]) ? st[c.stations_list_key].filter((x) => x && typeof x.lat === 'number' && typeof x.lng === 'number') : [];
    view.setStations(list.map((x) => ({ id: x.id, lat: x.lat, lng: x.lng })));
  }

  // 누름: 번호 = 앞의 충전소 자리(묶인 id 들·이름·방향·좌표 — 충전소판 줄과 같은 꼴), 점 = 충전소 하나
  function pick(p) {
    try {
      let sel = null;
      if (p.kind === c.pick.mark) {
        const it = lastAhead && Array.isArray(lastAhead.items) ? lastAhead.items.find((x) => String(x.key) === p.key) : null;
        if (it) sel = { key: it.key, ids: Array.isArray(it.ids) ? it.ids.slice() : [it.key], name: it.name, dir: it.dir || null, line: it.dir ? lastAhead.line : null, lat: it.lat, lng: it.lng, rest: !!it.rest };
      } else {
        const list = lastStations && Array.isArray(lastStations[c.stations_list_key]) ? lastStations[c.stations_list_key] : [];
        const st = list.find((x) => x && String(x.id) === p.key);
        if (st) sel = { key: st.id, ids: [st.id], name: st.name, dir: null, line: null, lat: st.lat, lng: st.lng, rest: !!st.rest };
      }
      log.info(c.where, c.word_pick, { kind: p.kind, key: p.key, found: !!sel });
      if (sel) pub(c.select_piece, sel);
    } catch (e) {
      log.error(e, { where: c.where, params: { act: c.act_pick, key: p && p.key } });
    }
  }

  // (A8) 빈 곳 누름 → 요청만(map.tap — 거리는 CalcRunner 가 셈, 표시는 ui_tap). 카메라는 그대로
  function tap(p) {
    try {
      taps += 1;
      pub(c.tap.piece, { seq: taps, lat: p.lat, lng: p.lng, at: clock.now() });
      log.info(c.where, c.tap.word, { seq: taps, lat: p.lat, lng: p.lng });
    } catch (e) {
      log.error(e, { where: c.where, params: { act: c.tap.act } });
    }
  }

  // (A8) map.pin = {id, lat, lng} → 그 화면 조각을 그 좌표의 지도 풍선에 · null → 뺌
  function drawPin(p) {
    if (!view) return;
    const ok = p && typeof p.lat === 'number' && typeof p.lng === 'number' && p.id;
    view.setPin(ok ? doc.getElementById(p.id) : null, ok ? [p.lng, p.lat] : null);
  }

  function open() {
    try {
      const slot = doc.getElementById(c.slot_id);
      if (!slot) throw new Error(c.slot_id);
      view = createMapView({ maplibre: deps.maplibre, doc }, {
        container: slot, style: c.style, center: c.start_center, zoom: s.zoom, bearing: s.bearing, attribution: c.attribution,
        geo: c.geo, dot: c.dot, others: c.others, marks: c.marks, events: c.events, route: c.route,
        tile_source_id: c.tile_source_id, no_lib_code: c.no_lib_code, pick: c.pick, tap: c.tap,
      });
      view.onPick(pick);
      view.onTap(tap);
      view.watchTiles(() => tiles(true, null), (why) => tiles(false, why));
      view.onUser((ev) => {
        try {
          s = cam.onUser(s, ev, m);
          log.info(c.where, c.word_user, { moved: ev.moved, rotated: ev.rotated, zoomed: ev.zoomed, bearing: s.bearing, zoom: s.zoom, follow: s.follow });
          announce();
          save();
        } catch (e) {
          log.error(e, { where: c.where, params: { act: c.act_user } });
        }
      });
      view.setOthersVisible(!s.only3);
      clock.setTimeout(() => { if (tilesOk === null) tiles(false, c.tiles_wait_code); }, c.tiles_wait_ms);
      if (last) { view.setDot(last.lng, last.lat); fix(last); }
      drawAhead(lastAhead);
      drawStations(lastStations);
      drawRoute(lastRoute);
      drawPin(lastPin);
    } catch (e) {
      log.error(e, { where: c.where, params: { slot: c.slot_id } });
      tiles(false, e && e.message);
    }
  }

  function fix(f) {
    const res = cam.onFix(s, f, m);
    s = res.state;
    move(res.cmd);
  }

  function pressMe() {
    try {
      const res = cam.onButton(s, last, m);
      s = res.state;
      move(res.cmd);
      log.info(c.where, c.word_me, { bearing: s.bearing, zoom: s.zoom });
      announce();
      save();
    } catch (e) {
      log.error(e, { where: c.where, params: { act: c.act_me } });
    }
  }

  function pressOnly3() {
    try {
      s = cam.toggleOnly3(s);
      if (view) view.setOthersVisible(!s.only3);
      only3Button();
      log.info(c.where, c.word_only3, { on: s.only3 });
      announce();
      save();
    } catch (e) {
      log.error(e, { where: c.where, params: { act: c.act_only3 } });
    }
  }

  try {
    $(c.ids.me).textContent = c.texts.me;
    $(c.ids.me).addEventListener(c.click_event, pressMe);
    $(c.ids.only3).addEventListener(c.click_event, pressOnly3);
    only3Button();
  } catch (e) {
    log.error(e, { where: c.where, params: { act: c.act_init } });
  }

  // 저장해 둔 카메라 상태를 먼저 읽고(없으면 처음 값) 지도를 연다 — 다시 열어도 같은 방향·확대·'세 곳만'
  deps.store.read(c.store_key).then((res) => {
    if (res.ok && res.value) s = cam.init(res.value, m);
    else if (!res.ok) log.warn(c.where, c.word_load_failed, { why: res.why });
  }).catch((e) => log.error(e, { where: c.where, params: { act: c.act_load } })).finally(() => {
    loaded = true;
    only3Button();
    announce();
    const v = deps.state.get(c.app_piece);
    if (!view && v && v.stage === r.stages.good) open();
  });

  deps.state.subscribe(c.app_piece, (v) => {
    if (!v || v.stage !== r.stages.good) return;
    try { $(c.ids.root).hidden = false; } catch (e) { log.error(e, { where: c.where, params: { act: c.act_init } }); }
    if (view || !loaded) return;
    open();
  });
  deps.state.subscribe(c.fix_piece, (f) => {
    last = f;
    fixes += 1;
    if (!view) return;
    try {
      view.setDot(f.lng, f.lat);
      fix(f);
    } catch (e) {
      log.error(e, { where: c.where, params: { lat: f && f.lat, lng: f && f.lng } });
    }
  });
  deps.state.subscribe(c.ahead_piece, (a) => {
    lastAhead = a;
    try { drawAhead(a); } catch (e) { log.error(e, { where: c.where, params: { act: c.act_marks } }); }
  });
  deps.state.subscribe(c.stations_piece, (st) => {
    lastStations = st;
    try { drawStations(st); } catch (e) { log.error(e, { where: c.where, params: { act: c.act_stations } }); }
  });
  deps.state.subscribe(c.route_piece, (rt) => {
    lastRoute = rt || null;
    try {
      drawRoute(lastRoute);
      log.info(c.where, c.word_route, { seq: lastRoute ? lastRoute.seq : null, points: lastRoute && lastRoute.points ? lastRoute.points.length : 0 });
    } catch (e) { log.error(e, { where: c.where, params: { act: c.act_route } }); }
  });
  deps.state.subscribe(c.tap.pin_piece, (p) => {
    lastPin = p || null;
    try {
      drawPin(lastPin);
      log.info(c.where, c.tap.word_pin, { id: lastPin ? lastPin.id : null, seq: lastPin ? lastPin.seq : null });
    } catch (e) { log.error(e, { where: c.where, params: { act: c.tap.act_pin } }); }
  });
  return { fixes: () => fixes, last: () => last, cam: () => cam.saved(s), moves: () => moves, marked: () => (view ? view.marked() : 0), pressMe, pressOnly3, pick, taps: () => taps, tap };
}
