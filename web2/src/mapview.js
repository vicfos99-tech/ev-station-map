// 지도 라이브러리(MapLibre)를 감싼 한 파일 — 라이브러리를 바꿔도 여기만 바뀐다(설계 5-1-나 mapview).
// 값(바탕 그림 꼴·처음 자리·점 모양·층·이벤트 이름·번호 표시 모양)은 모두 부르는 쪽(ui_map)이 설정에서 넘긴다. 로그는 쓰지 않고 알림 함수로 돌려준다.
// 하는 일: 내 위치 점 · 카메라 명령 옮기기(효과 없이 — L068) · 손으로 한 일 알리기 · 1·2·3번 표시 · 다른 충전소 층과 그 켬·끔 ·
// (A4) 번호·충전소 점을 누름 알리기(onPick — 카메라는 건드리지 않는다) · (A6) 경로 선(setRoute — 카메라는 건드리지 않는다) ·
// (A8) 빈 곳 누름 좌표 알리기(onTap) · 화면 조각 하나를 그 좌표의 지도 풍선에 꽂기(setPin — 카메라는 건드리지 않는다).
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
  let pendingRoute = null;
  let othersShown = true;
  let touching = null;
  let onUser = null;
  let onPick = null;
  let markers = [];
  let markSig = '';
  let onTap = null;
  let pin = null;

  // (추가1) 지도가 화면 전체를 까므로 지도 라이브러리의 저작권 조각(오른쪽 아래)은 지도 아래 끝(아래 띠 밑)에 깔린다 —
  // 그 조각을 부르는 쪽이 정해 둔 자리(o.attrib.host)로 옮겨 꽂는다(조각은 라이브러리가 계속 고친다). 자리가 없으면 그대로
  if (o.attrib && o.attrib.host && typeof map.getContainer === 'function') {
    const box = map.getContainer();
    const part = box && typeof box.querySelector === 'function' ? box.querySelector(o.attrib.part_selector) : null;
    if (part) o.attrib.host.appendChild(part);
  }

  // (A8) 빈 곳 누름 → 누른 좌표(번호·풍선 같은 지도 위 표시나 보이는 충전소 점을 누른 것은 빼고 — 그것은 onPick·제 단추가 받는다)
  map.on(o.events.click, (e) => {
    if (!onTap || !e || !e.lngLat) return;
    const t = e.originalEvent && e.originalEvent.target;
    if (t && typeof t.closest === 'function' && t.closest(o.tap.skip_selector)) return;
    if (ready && othersShown && map.queryRenderedFeatures(e.point, { layers: [o.others.layer_id] }).length) return;
    onTap({ lng: e.lngLat.lng, lat: e.lngLat.lat });
  });

  // (추가1) 지도 위 겹의 칸(판·검색 칸·저작권·정보 칸·아래 띠 — o.tap.avoid)과 풍선이 겹치는 넓이. 그림이 없는 곳(가상 창)에서는 0
  function rectOf(el) {
    if (!el || typeof el.getBoundingClientRect !== 'function') return null;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? r : null;
  }
  function covered(pop) {
    const me = rectOf(pop.getElement && pop.getElement());
    if (!me || !o.tap.avoid || typeof doc.querySelectorAll !== 'function') return 0;
    let area = 0;
    for (const el of doc.querySelectorAll(o.tap.avoid)) {
      const r = rectOf(el);
      if (!r) continue;
      const w = Math.min(me.right, r.right) - Math.max(me.left, r.left);
      const h = Math.min(me.bottom, r.bottom) - Math.max(me.top, r.top);
      if (w > 0 && h > 0) area += w * h;
    }
    const box = rectOf(map.getContainer && map.getContainer());
    if (box) {
      const w = Math.min(me.right, box.right) - Math.max(me.left, box.left);
      const h = Math.min(me.bottom, box.bottom) - Math.max(me.top, box.top);
      area += me.width * me.height - Math.max(0, w) * Math.max(0, h);
    }
    return area;
  }
  // (추가1) 풍선이 판 밑으로 들어가지 않게: 겹치면 방향(o.tap.anchors)을 차례로 바꿔 보고 겹침 0 인 첫 방향(없으면 가장 적게 겹친 방향)
  function placePin(el, lnglat, home) {
    let best = null;
    for (const a of [null, ...(o.tap.anchors || [])]) {
      const opt = a ? { ...o.tap.popup, anchor: a } : { ...o.tap.popup };
      const pop = new lib.Popup(opt).setDOMContent(el).setLngLat(lnglat).addTo(map);
      const area = covered(pop);
      if (!best || area < best.area) {
        if (best) best.pop.remove();
        best = { pop, area, anchor: a };
      } else pop.remove();
      if (area === 0) break;
    }
    const box = best.pop.getElement && best.pop.getElement();
    if (box && typeof box.contains === 'function' && !box.contains(el)) best.pop.setDOMContent(el);
    // 어느 방향도 판·칸과 겹치면(누른 땅이 판 밑으로 들어감) 풍선을 숨긴다 — 다시 비면 보임
    if (box && box.style) box.style.visibility = best.area > 0 ? o.tap.hide_value : '';
    pin = { el, pop: best.pop, home, anchor: best.anchor, area: best.area };
  }
  // (추가1) 지도가 움직이면(정보 칸이 열려 보이는 가운데가 옮겨짐 등) 풍선이 판 밑으로 들어갔는지 다시 봄
  function recheck() {
    if (!pin) return;
    const box = pin.pop.getElement && pin.pop.getElement();
    if (box && box.style) box.style.visibility = '';
    if (covered(pin.pop) > 0) { const p = pin; p.pop.remove(); placePin(p.el, p.pop.getLngLat(), p.home); }
  }
  map.on(o.events.move_end, recheck);

  // (A8) 화면 조각 하나(el)를 그 좌표의 지도 풍선에 꽂음 · null 이면 뺌(조각은 제자리로 돌려 둔다). 카메라는 건드리지 않는다
  function setPin(el, lnglat) {
    if (pin && (!el || pin.el !== el)) {
      pin.pop.remove();
      if (pin.home) pin.home.appendChild(pin.el);
      pin = null;
    }
    if (!el || !lnglat) return;
    if (pin) {
      pin.pop.setLngLat(lnglat);
      // (추가1) 그사이 칸이 열려(정보 칸 등) 풍선이 칸 밑으로 들어갔으면 방향을 다시 고름
      recheck();
      return;
    }
    placePin(el, lnglat, el.parentNode || null);
  }

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

  // (A6) 경로 선: [[경도, 위도]…] 또는 빈 줄(지움) — 지도 층 하나(다른 충전소 점·내 위치 점 아래)
  function routeData(coords) {
    if (!coords || !coords.length) return { type: o.geo.collection, features: [] };
    return { type: o.geo.feature, geometry: { type: o.route.line_type, coordinates: coords }, properties: {} };
  }

  map.on(o.events.load, () => {
    map.addSource(o.route.source_id, { type: o.route.source_type, data: routeData(pendingRoute) });
    map.addLayer({ id: o.route.layer_id, type: o.route.layer_type, source: o.route.source_id, paint: o.route.paint, layout: o.route.layout });
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
    pendingRoute = null;
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
    // (추가1) 지도의 보이는 가운데를 옮김(px — {top, bottom, left, right}). 판이 지도 위에 있어 내 위치 점이 판에 가리지 않게. 손으로 만지는 중이면 옮기지 않는다
    setPadding(p) {
      if (!p || typeof map.setPadding !== 'function' || touching) return false;
      map.setPadding(p);
      return true;
    },
    pinInfo: () => (pin ? { anchor: pin.anchor, area: pin.area } : null),
    onUser(fn) { onUser = fn; },
    onPick(fn) { onPick = fn; },
    onTap(fn) { onTap = fn; },
    setPin,
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
    // (A6) 경로 선 그리기·지우기 — 카메라는 건드리지 않는다(설계 5-8 바 2)
    setRoute(coords) {
      if (!ready) { pendingRoute = coords; return; }
      map.getSource(o.route.source_id).setData(routeData(coords));
    },
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
