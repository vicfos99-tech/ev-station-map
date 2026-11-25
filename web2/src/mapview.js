// 지도 라이브러리(MapLibre)를 감싼 한 파일 — 라이브러리를 바꿔도 여기만 바뀐다(설계 5-1-나 mapview).
// 값(바탕 그림 꼴·처음 자리·점 모양·이벤트 이름)은 모두 부르는 쪽(ui_map)이 설정에서 넘긴다. 로그는 쓰지 않고 알림 함수로 돌려준다.
// A1 최소: 내 위치 점 하나와 따라가기. 돌림·단추는 A3.
export const NEEDS = ['maplibre'];

export function createMapView(deps, o) {
  const lib = deps.maplibre;
  if (!lib || typeof lib.Map !== 'function') throw new Error(o.no_lib_code);
  const map = new lib.Map({ container: o.container, style: o.style, center: o.center, zoom: o.zoom, attributionControl: o.attribution });
  let ready = false;
  let pending = null;

  function point(lnglat) {
    return { type: o.geo.feature, geometry: { type: o.geo.point, coordinates: lnglat }, properties: {} };
  }

  function apply(lng, lat) {
    const src = map.getSource(o.dot.source_id);
    if (src) src.setData(point([lng, lat]));
    map.easeTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), o.follow_min_zoom), duration: o.ease_ms });
  }

  map.on(o.events.load, () => {
    map.addSource(o.dot.source_id, { type: o.dot.source_type, data: point(o.center) });
    map.addLayer({ id: o.dot.layer_id, type: o.dot.layer_type, source: o.dot.source_id, paint: o.dot.paint });
    ready = true;
    if (pending) { apply(pending[0], pending[1]); pending = null; }
  });

  return {
    setDot(lng, lat) {
      if (!ready) { pending = [lng, lat]; return; }
      apply(lng, lat);
    },
    // 바탕 그림: 첫 조각이 오면 ok(), 못 받으면 bad(까닭)
    watchTiles(ok, bad) {
      map.on(o.events.data, (e) => { if (e && e.tile && e.sourceId === o.tile_source_id) ok(); });
      map.on(o.events.error, (e) => { if (e && (e.tile || e.sourceId === o.tile_source_id)) bad(e.error && e.error.message); });
    },
    remove: () => map.remove(),
  };
}
