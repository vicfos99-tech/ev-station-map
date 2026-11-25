// MapScreen(지도 — 화면). A1 최소: 운전 화면 가운데 칸에 지도를 열고 fix 를 받아 내 위치 점 하나를 옮긴다.
// 바탕 그림(타일) 주소는 config_ui_map 에만 있고 지도 라이브러리가 직접 받는다(설계 원칙 '바깥 주소는 하나'의 예외).
// 바탕 그림 성공·실패는 conn.tiles 로(바뀔 때만). 카메라 규칙·'내 위치' 단추·1·2·3번 표시는 A3.
import { createMapView } from './mapview.js';

export const NEEDS = ['cfg', 'log', 'state', 'doc', 'clock', 'maplibre'];

export function createMapScreen(deps) {
  const c = deps.cfg.section('config_ui_map');
  const r = deps.cfg.section('config_health');
  const log = deps.log;
  const clock = deps.clock;
  const pub = deps.state.claim(c.owner, [c.tiles_piece]);
  let view = null;
  let last = null;
  let tilesOk = null;
  let fixes = 0;

  function tiles(ok, why) {
    if (tilesOk === ok) return;
    tilesOk = ok;
    pub(c.tiles_piece, { ok, code: ok ? null : c.tiles_code });
    if (!ok) log.warn(c.where, c.word_tiles_bad, { why });
  }

  function open() {
    try {
      const slot = deps.doc.getElementById(c.slot_id);
      if (!slot) throw new Error(c.slot_id);
      view = createMapView({ maplibre: deps.maplibre }, {
        container: slot, style: c.style, center: c.start_center, zoom: c.start_zoom, attribution: c.attribution,
        geo: c.geo, dot: c.dot, events: c.events, ease_ms: c.ease_ms, follow_min_zoom: c.follow_min_zoom,
        tile_source_id: c.tile_source_id, no_lib_code: c.no_lib_code,
      });
      view.watchTiles(() => tiles(true, null), (why) => tiles(false, why));
      clock.setTimeout(() => { if (tilesOk === null) tiles(false, c.tiles_wait_code); }, c.tiles_wait_ms);
      if (last) view.setDot(last.lng, last.lat);
    } catch (e) {
      log.error(e, { where: c.where, params: { slot: c.slot_id } });
      tiles(false, e && e.message);
    }
  }

  deps.state.subscribe(c.app_piece, (v) => {
    if (view || !v || v.stage !== r.stages.good) return;
    open();
  });
  deps.state.subscribe(c.fix_piece, (f) => {
    last = f;
    fixes += 1;
    if (!view) return;
    try { view.setDot(f.lng, f.lat); } catch (e) { log.error(e, { where: c.where, params: { lat: f.lat, lng: f.lng } }); }
  });
  return { fixes: () => fixes, last: () => last };
}
