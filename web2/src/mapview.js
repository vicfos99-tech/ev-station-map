// 지도 라이브러리(MapLibre)를 감싼 한 파일 — 라이브러리를 바꿔도 여기만 바뀐다(설계 5-1-나 mapview).
// 값(바탕 그림 꼴·처음 자리·점 모양·층·이벤트 이름·번호 표시 모양)은 모두 부르는 쪽(ui_map)이 설정에서 넘긴다. 로그는 쓰지 않고 알림 함수로 돌려준다.
// 하는 일: 내 위치 점 · 카메라 명령 옮기기(효과 없이 — L068) · 손으로 한 일 알리기 · 1·2·3번 표시 · 다른 충전소 층과 그 켬·끔 ·
// (A4) 번호·충전소 점을 누름 알리기(onPick — 카메라는 건드리지 않는다).
// 카메라 규칙은 여기 없다(MapCam). 손으로 만지는 동안에는 카메라 명령을 옮기지 않는다(손이 먼저 — 설계 5-8 다).
export const NEEDS = ['maplibre', 'doc'];

export function createMapView(deps, o) {
  const lib = deps.maplibre;
  const doc = deps.doc;
  if (!lib || typeof lib.Map !== 'function') throw new Error(o.no_lib_code);
  const map = new lib.Map({ container: o.container, style: o.style, center: o.center, zoom: o.zoom, bearing: o.bearing, attributionControl: o.attribution });
  let ready = false;
  let pendingDot = null;
  let pendingCam = null;
  let pendingStations = null;
  let othersShown = true;
  let touching = null;
  let onUser = null;
  let onPick = null;
  let markers = [];
  let markSig = '';

  function point(lnglat, props) {
    return { type: o.geo.feature, geometry: { type: o.geo.point, coordinates: lnglat }, properties: props || {} };
  }

  // 다른 충전소 점: 속성에 충전소 id(누르면 그 id 를 알림)
  function collection(list) {
    return { type: o.geo.collection, features: list.map((p) => point([p.lng, p.lat], { [o.others.id_prop]: p.id })) };
  }

  function jump(cmd) {
    const to = {};
    if (cmd.center) to.center = cmd.center;
    if (typeof cmd.bearing === 'number') to.bearing = cmd.bearing;
    if (typeof cmd.zoom === 'number') to.zoom = cmd.zoom;
    map.jumpTo(to);
  }

  map.on(o.events.load, () => {
    map.addSource(o.others.source_id, { type: o.others.source_type, data: collection(pendingStations || []) });
    map.addLayer({ id: o.others.layer_id, type: o.others.layer_type, source: o.others.source_id, paint: o.others.paint, layout: { [o.others.visibility_key]: othersShown ? o.others.shown_word : o.others.hidden_word } });
    map.addSource(o.dot.source_id, { type: o.dot.source_type, data: point(o.center) });
    map.addLayer({ id: o.dot.layer_id, type: o.dot.layer_type, source: o.dot.source_id, paint: o.dot.paint });
    // 충전소 점 누름 → 그 점의 충전소 id(A4 정보 칸)
    map.on(o.events.click, o.others.layer_id, (e) => {
      const f = e && e.features && e.features[0];
      const id = f && f.properties ? f.properties[o.others.id_prop] : null;
      if (onPick && id !== null && id !== undefined) onPick({ kind: o.pick.dot, key: String(id) });
    });
    ready = true;
    pendingStations = null;
    if (pendingDot) { map.getSource(o.dot.source_id).setData(point(pendingDot)); pendingDot = null; }
    if (pendingCam) { jump(pendingCam); pendingCam = null; }
  });

  // 손으로 만짐: 시작 알림(originalEvent 가 있는 것 — 코드가 움직인 것은 없음)에 종류를 적어 두고, 움직임이 끝나면 지금 값과 함께 한 번 알린다
  for (const [ev, kind] of Object.entries(o.events.user_starts)) {
    map.on(ev, (e) => {
      if (!e || !e.originalEvent) return;
      touching = touching || {};
      touching[kind] = true;
    });
  }
  map.on(o.events.move_end, () => {
    if (!touching) return;
    const t = touching;
    touching = null;
    if (onUser) onUser({ moved: !!t.moved, rotated: !!t.rotated, zoomed: !!t.zoomed, bearing: map.getBearing(), zoom: map.getZoom() });
  });

  return {
    setDot(lng, lat) {
      if (!ready) { pendingDot = [lng, lat]; return; }
      map.getSource(o.dot.source_id).setData(point([lng, lat]));
    },
    // 카메라 명령(MapCam 이 낸 것) — 효과 없이 바로. 손으로 만지는 중이면 옮기지 않는다
    camera(cmd) {
      if (!cmd) return false;
      if (touching) return false;
      if (!ready) { pendingCam = { ...(pendingCam || {}), ...cmd }; return true; }
      jump(cmd);
      return true;
    },
    onUser(fn) { onUser = fn; },
    onPick(fn) { onPick = fn; },
    // 1·2·3번: items = [{no, key, lat, lng}], kind = 모양 이름(o.marks.kinds 의 키 — 앞의 충전소·주변). 같으면 다시 그리지 않는다
    setNumbered(items, kind) {
      const sig = kind + o.marks.sig_join + items.map((it) => [it.no, it.key, it.lng, it.lat].join(o.marks.sig_join)).join(o.marks.sig_join);
      if (sig === markSig) return;
      markSig = sig;
      for (const m of markers) m.remove();
      markers = items.map((it) => {
        const el = doc.createElement(o.marks.tag);
        el.className = o.marks.class + ' ' + o.marks.kinds[kind];
        el.textContent = String(it.no);
        el.setAttribute(o.marks.key_attr, String(it.key));
        el.setAttribute(o.marks.role_attr, o.marks.role_button);
        el.addEventListener(o.events.click, () => { if (onPick) onPick({ kind: o.pick.mark, key: String(it.key) }); });
        return new lib.Marker({ element: el, anchor: o.marks.anchor }).setLngLat([it.lng, it.lat]).addTo(map);
      });
    },
    marked: () => markers.length,
    // 다른 충전소 점(목록 통째) — 번호 표시보다 작고 흐린 층
    setStations(list) {
      if (!ready) { pendingStations = list; return; }
      map.getSource(o.others.source_id).setData(collection(list));
    },
    // '세 곳만' — 다른 충전소 층을 숨김(지우지 않음 — 끄면 바로 돌아옴)
    setOthersVisible(on) {
      othersShown = !!on;
      if (ready) map.setLayoutProperty(o.others.layer_id, o.others.visibility_key, othersShown ? o.others.shown_word : o.others.hidden_word);
    },
    // 바탕 그림: 첫 조각이 오면 ok(), 못 받으면 bad(까닭)
    watchTiles(ok, bad) {
      map.on(o.events.data, (e) => { if (e && e.tile && e.sourceId === o.tile_source_id) ok(); });
      map.on(o.events.error, (e) => { if (e && (e.tile || e.sourceId === o.tile_source_id)) bad(e.error && e.error.message); });
    },
    remove: () => map.remove(),
  };
}
