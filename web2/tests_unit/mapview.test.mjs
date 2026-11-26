// 단위 시험: mapview(지도 라이브러리 감싼 파일)의 바탕 — (추가2) 벡터 지도 ↔ 그림 타일, 못 받을 때 그림 타일로 돌아가기.
// 가짜 지도 라이브러리로 본다(창·다리 없음). 값은 저장소 설정(config_ui_map·config_mapstyle_night)을 그대로 읽는다.
export default async function (t) {
  const { createMapView } = await t.src('mapview');
  const c = t.cfg('config_ui_map');
  const vs = t.cfg(c.vector.style_config);

  function fakeLib() {
    const made = [];
    class Map {
      constructor(o) { this.o = o; this.h = {}; this.order = []; this.sources = {}; made.push(this); }
      on(ev, a, b) { const fn = typeof a === 'function' ? a : null; if (fn) (this.h[ev] = this.h[ev] || []).push(fn); }
      fire(ev, e) { for (const f of this.h[ev] || []) f(e); }
      addSource(id, s) { this.sources[id] = { ...s, setData: () => {} }; }
      addLayer(l, before) {
        const i = before ? this.order.indexOf(before) : -1;
        if (i >= 0) this.order.splice(i, 0, l.id); else this.order.push(l.id);
        this.last = { l, before };
      }
      getSource(id) { return this.sources[id]; }
      getLayer(id) { return this.order.includes(id) ? { id } : undefined; }
      removeLayer(id) { this.order = this.order.filter((x) => x !== id); }
      removeSource(id) { delete this.sources[id]; }
      setLayoutProperty() {}
      jumpTo() {}
    }
    return { Map, made };
  }
  const base = (lib, style, fallback, extra) => createMapView({ maplibre: lib, doc: {} }, {
    container: {}, style, center: c.start_center, zoom: 10, bearing: 0, attribution: c.attribution,
    geo: c.geo, dot: c.dot, others: c.others, marks: c.marks, events: c.events, route: c.route,
    tile_source_id: c.tile_source_id, no_lib_code: c.no_lib_code, pick: c.pick, tap: c.tap, map_options: c.map_options, fallback, ...(extra || {}),
  });
  const fb = { source_id: c.vector.fallback_source_id, source: c.style.sources[c.tile_source_id], layers: c.style.layers };

  // ① 벡터 지도: 넘긴 스타일·글꼴 값이 지도 라이브러리로 감
  const L1 = fakeLib();
  const v1 = base(L1, vs.style, fb);
  const m1 = L1.made[0];
  t.check('①', '벡터 지도 스타일과 한글 글꼴 값(map_options)이 지도 라이브러리로 감', '출처 꼴 vector · 글꼴 값 있음',
    m1.o.style.sources[c.tile_source_id].type + ' · ' + (m1.o.localIdeographFontFamily ? '있음' : '없음'), m1.o.style.sources[c.tile_source_id].type === 'vector' && m1.o.localIdeographFontFamily === c.map_options.localIdeographFontFamily);

  // ② 조각 알림: 벡터 출처·돌아갈 그림 타일 출처 둘 다 ok, 다른 출처는 안 셈
  const got = [];
  v1.watchTiles((id) => got.push('ok:' + id), (why, id) => got.push('bad:' + id));
  m1.fire(c.events.load, {});
  m1.fire(c.events.data, { tile: {}, sourceId: c.tile_source_id });
  m1.fire(c.events.data, { tile: {}, sourceId: 'route' });
  m1.fire(c.events.data, { tile: {}, sourceId: c.vector.fallback_source_id });
  m1.fire(c.events.error, { sourceId: c.tile_source_id, error: { message: 'x' } });
  m1.fire(c.events.error, { error: { message: 'glyph' } });
  const want2 = ['ok:' + c.tile_source_id, 'ok:' + c.vector.fallback_source_id, 'bad:' + c.tile_source_id].join(',');
  t.check('②', '조각 알림: 벡터·돌아갈 그림 출처만 ok, 출처 없는 오류(글꼴 등)는 안 셈', want2, got.join(','), got.join(',') === want2);

  // ③ 돌아가기: 그림 타일 출처·층을 우리 층(경로 선) 아래에, 한 번만
  const before = m1.order.slice();
  const first = v1.fallback();
  const second = v1.fallback();
  const ri = m1.order.indexOf(c.route.layer_id);
  const fi = m1.order.indexOf(c.style.layers[0].id);
  t.check('③', '못 받으면 그림 타일 출처·층을 경로 선·충전소 점·내 위치 점 아래에 깖(한 번만)', '깔림 · 두 번째 안 깜 · 층 차례 그림 < 경로 선',
    (first ? '깔림' : '안 깔림') + ' · ' + (second ? '또 깔림' : '두 번째 안 깜') + ' · ' + m1.order.join('>') + ' (전 ' + before.join('>') + ')',
    first && !second && !!m1.sources[c.vector.fallback_source_id] && m1.sources[c.vector.fallback_source_id].type === 'raster' && fi >= 0 && fi < ri && v1.fellBack());

  // ③-2 늦게라도 벡터 조각이 오면 걷음: 그림 타일 층·출처가 빠지고, 다시 돌아가지 않음(오락가락 없음)
  const back = v1.restore();
  const again = v1.fallback();
  t.check('③-2', '돌아간 뒤 벡터 지도가 오면 그림 타일 층·출처를 걷고(한 번만) 다시 돌아가지 않음', '걷음 · 그림 층·출처 없음 · 다시 안 깜',
    (back ? '걷음' : '안 걷음') + ' · ' + m1.order.join('>') + ' · 출처 ' + Object.keys(m1.sources).join(',') + ' · ' + (again ? '또 깜' : '다시 안 깜'),
    back && !again && !v1.fellBack() && m1.order.indexOf(c.style.layers[0].id) < 0 && !m1.sources[c.vector.fallback_source_id] && !v1.restore());

  // ④ 불러오기 전에 돌아가면 불러온 뒤 깖(우리 층 뒤)
  const L4 = fakeLib();
  const v4 = base(L4, vs.style, fb);
  const m4 = L4.made[0];
  const early = v4.fallback();
  const none = !m4.sources[c.vector.fallback_source_id];
  m4.fire(c.events.load, {});
  const ok4 = early && none && !!m4.sources[c.vector.fallback_source_id] && m4.order.indexOf(c.style.layers[0].id) < m4.order.indexOf(c.route.layer_id);
  t.check('④', '지도가 다 열리기 전에 돌아가기 → 열린 뒤 경로 선 아래에 깖', '열기 전 없음 · 연 뒤 깔림', (none ? '열기 전 없음' : '열기 전 있음') + ' · ' + m4.order.join('>'), ok4);

  // ⑤ 그림 타일 바탕(base raster) 또는 돌아가기 끔: fallback 이 아무것도 안 함
  const L5 = fakeLib();
  const v5 = base(L5, c.style, null);
  L5.made[0].fire(c.events.load, {});
  const r5 = v5.fallback();
  t.check('⑤', '그림 타일 바탕·돌아가기 끔이면 돌아가기 없음(그림 타일 스타일 그대로)', '안 깜 · 출처 꼴 raster', (r5 ? '깔림' : '안 깜') + ' · ' + L5.made[0].o.style.sources[c.tile_source_id].type, !r5 && L5.made[0].o.style.sources[c.tile_source_id].type === 'raster' && !v5.fellBack());

  // ⑥ 우리 스타일: 글자 층마다 지도를 돌려도 바로 서는 값 · 이름은 한국어 먼저
  const sym = vs.style.layers.filter((l) => l.type === 'symbol');
  const bad6 = sym.filter((l) => {
    const y = l.layout || {};
    const line = y['symbol-placement'] === 'line';
    const upright = y['text-rotation-alignment'] === 'viewport' || (line && y['text-rotation-alignment'] === 'map' && y['text-keep-upright'] === true);
    return !upright;
  }).map((l) => l.id);
  const named = sym.filter((l) => JSON.stringify(l.layout['text-field']).includes('name'));
  const ko = named.filter((l) => { const f = l.layout['text-field']; return Array.isArray(f) && f[0] === 'coalesce' && JSON.stringify(f[1]) === JSON.stringify(['get', 'name:ko']); });
  t.check('⑥', '글자 층 ' + sym.length + '개: 화면 기준(viewport)이거나 길 따라 + 거꾸로 안 섬(keep-upright) · 이름 층은 name:ko 먼저', '어긋난 층 0 · 이름 층 모두 한국어 먼저',
    '어긋난 층 ' + bad6.length + (bad6.length ? '(' + bad6.join(',') + ')' : '') + ' · 이름 층 ' + named.length + ' 중 한국어 먼저 ' + ko.length, sym.length > 0 && bad6.length === 0 && named.length > 0 && ko.length === named.length);

  // ⑦ 우리 스타일 색: 회색만(채도 낮음) — 앱 메인·보조·상태색과 안 겹침
  const colors = [];
  const walk = (v) => { if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) colors.push(v); else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x); };
  for (const l of vs.style.layers) walk(l.paint);
  const sat = (h) => { const n = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); return Math.max(...n) - Math.min(...n); };
  const loud = colors.filter((h) => sat(h) > 16);
  t.check('⑦', '스타일 색 ' + colors.length + '개가 회색(세 값 차이 16 이하)', '튀는 색 0', '튀는 색 ' + loud.length + (loud.length ? ' ' + loud.join(',') : ''), colors.length > 0 && loud.length === 0);
}
