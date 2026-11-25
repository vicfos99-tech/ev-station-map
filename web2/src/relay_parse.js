// 순수: 다리 자료 길로 받은 중계 파일의 검사(설계 5-1 relay_parse · 5-7 입력 검사). 꼴은 중계 모양 문서(ref/relay_format.md).
// 나쁜 것은 거른다: 파일 전체 꼴이 틀리면 던지고(부르는 쪽이 받기 실패로), 충전소 하나가 틀리면 그 줄만 빼고 bad 에 까닭과 함께 담는다.
// 규칙 r = config_relay_parse(모양 판 번호·좌표 범위·글 길이·칸 이름). 로그 없음.
export const NEEDS = [];

function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isStr(v, max) {
  return typeof v === 'string' && v.length >= 1 && v.length <= max;
}

function latLng(v, r) {
  if (!Array.isArray(v) || v.length !== r.latlng_len) return null;
  const [lat, lng] = v;
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < r.lat_min || lat > r.lat_max || lng < r.lng_min || lng > r.lng_max) return null;
  return { lat, lng };
}

// meta.json — 모양 판 번호를 보고, 신선함 판단(relay_fresh)에 쓰는 칸만 꺼낸다: at(마지막 차례 시각 글) · ok(상태 받기 성공) · fresh(목록을 받은 지역 코드).
// 틀리면 던진다. 칸이 없거나 꼴이 틀리면 '믿지 않음' 쪽 값(null · 거짓 · 빈 목록)
export function meta(obj, r) {
  if (!isObj(obj) || obj[r.v_key] !== r.v) throw new TypeError(r.why.meta);
  const fresh = Array.isArray(obj[r.meta_fresh_key]) ? obj[r.meta_fresh_key].filter((z) => isStr(z, r.id_max)) : [];
  return { at: typeof obj[r.meta_at_key] === 'string' ? obj[r.meta_at_key] : null, ok: obj[r.meta_ok_key] === true, fresh };
}

// 충전기 하나: id 는 꼭, 종류·출력은 꼴이 틀리면 null(모름). id 가 틀리면 그 충전기만 뺀다
function charger(ch, r) {
  if (!isObj(ch) || !isStr(ch[r.charger_id_key], r.id_max)) return null;
  const kw = ch[r.charger_kw_key];
  return {
    id: ch[r.charger_id_key],
    type: isStr(ch[r.charger_type_key], r.name_max) ? ch[r.charger_type_key] : null,
    kw: typeof kw === 'number' && Number.isFinite(kw) && kw >= 0 && kw <= r.kw_max ? kw : null,
  };
}

// stations/<zscode>.json → {zscode, good: [충전소], bad: [{i, why}]}. 파일 꼴이 틀리면 던진다
export function stations(obj, r) {
  if (!isObj(obj) || obj[r.v_key] !== r.v || !Array.isArray(obj[r.stations_key])) throw new TypeError(r.why.file);
  if (obj[r.stations_key].length > r.max_stations) throw new TypeError(r.why.too_many);
  const good = [];
  const bad = [];
  const zscode = isStr(obj[r.zscode_key], r.id_max) ? obj[r.zscode_key] : null;
  const zcodes = Array.isArray(obj[r.zcodes_key]) ? obj[r.zcodes_key].filter((z) => isStr(z, r.id_max)) : [];
  obj[r.stations_key].forEach((s, i) => {
    if (!isObj(s)) { bad.push({ i, why: r.why.item }); return; }
    if (!isStr(s.id, r.id_max)) { bad.push({ i, why: r.why.id }); return; }
    if (!isStr(s.name, r.name_max)) { bad.push({ i, id: s.id, why: r.why.name }); return; }
    const loc = latLng(s.loc, r);
    if (!loc) { bad.push({ i, id: s.id, why: r.why.loc }); return; }
    if (!Array.isArray(s.chargers) || s.chargers.length > r.max_chargers) { bad.push({ i, id: s.id, why: r.why.chargers }); return; }
    good.push({
      id: s.id,
      name: s.name,
      operator: isStr(s.operator, r.name_max) ? s.operator : null,
      maker: isStr(s.maker, r.name_max) ? s.maker : null,
      lat: loc.lat,
      lng: loc.lng,
      rest: s.rest === true,
      indoor: s.indoor === true,
      // 충전기마다 id·종류·출력(정보 칸 — A4). 상태는 여기 없다(status/ 파일 — relay_read)
      chargers: s.chargers.map((ch) => charger(ch, r)).filter((ch) => ch !== null),
      zscode,
      zcodes,
    });
  });
  return { zscode, good, bad };
}

// ---------- 제한 속도 파일(A5 — 규칙 r.limit. 꼴은 중계 R5 전의 임시 꼴: web2/README.md '제한 속도 자료') ----------
// 제한 속도 값: 범위 안의 숫자만, 0·빈 값·범위 밖은 null('없음' — 설계 5-7 RelayClient 줄)
function kmhOf(v, L) {
  return typeof v === 'number' && Number.isFinite(v) && v >= L.kmh_min && v <= L.kmh_max ? v : null;
}

function head(obj, r, listKey) {
  const L = r.limit;
  if (!isObj(obj) || obj[r.v_key] !== r.v || !Array.isArray(obj[listKey])) throw new TypeError(r.why.file);
  return { L, at: typeof obj[r.meta_at_key] === 'string' ? obj[r.meta_at_key] : null };
}

// 고속도로 표 → {at, good: [{line, from_km, to_km, fwd, back}], bad: [{i, why}], blank: 값이 없는 방향 수}. 구간이 0 개면 던진다(건수 0 은 실패 — L063)
export function limitHighway(obj, r) {
  const { L, at } = head(obj, r, r.limit.sections_key);
  const list = obj[L.sections_key];
  if (!list.length) throw new TypeError(r.why.empty);
  if (list.length > L.max_sections) throw new TypeError(r.why.too_many);
  const good = [];
  const bad = [];
  let blank = 0;
  list.forEach((s, i) => {
    if (!isObj(s) || !isStr(s[L.line_key], r.name_max)) { bad.push({ i, why: r.why.item }); return; }
    const a = s[L.from_key];
    const b = s[L.to_key];
    if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b > L.km_max || a >= b) { bad.push({ i, why: r.why.km }); return; }
    const fwd = kmhOf(s[L.fwd_key], L);
    const back = kmhOf(s[L.back_key], L);
    blank += (fwd === null ? 1 : 0) + (back === null ? 1 : 0);
    good.push({ line: s[L.line_key], from_km: a, to_km: b, fwd, back });
  });
  return { at, good, bad, blank };
}

// 일반 도로 칸 목차 → {at, cells: [칸 열쇠]} (꼴이 틀린 열쇠는 뺌 — bad 수)
export function limitIndex(obj, r) {
  const { L, at } = head(obj, r, r.limit.cells_key);
  const list = obj[L.cells_key];
  if (list.length > L.max_cells) throw new TypeError(r.why.too_many);
  const rx = new RegExp(L.cell_re);
  const cells = list.filter((k) => typeof k === 'string' && rx.test(k));
  return { at, cells, bad: list.length - cells.length };
}

// 일반 도로 칸 하나 → {at, cell, good: [{id, kmh, both, pts, box: 둘레 상자 {lat0, lng0, lat1, lng1}}], bad, blank}. 값이 0·빈 조각은 '없음'이라 싣지 않는다(blank 수). 조각 0 개면 던진다
export function limitCell(obj, r) {
  const { L, at } = head(obj, r, r.limit.segs_key);
  const list = obj[L.segs_key];
  if (!list.length) throw new TypeError(r.why.empty);
  if (list.length > L.max_segs) throw new TypeError(r.why.too_many);
  const cell = typeof obj[L.cell_key] === 'string' && new RegExp(L.cell_re).test(obj[L.cell_key]) ? obj[L.cell_key] : null;
  const good = [];
  const bad = [];
  let blank = 0;
  list.forEach((s, i) => {
    if (!isObj(s) || !isStr(s[L.id_key], r.id_max)) { bad.push({ i, why: r.why.id }); return; }
    const raw = s[L.pts_key];
    if (!Array.isArray(raw) || raw.length < r.min_line_points || raw.length > L.max_seg_points) { bad.push({ i, id: s[L.id_key], why: r.why.line_points }); return; }
    const pts = [];
    for (const p of raw) {
      const ll = latLng(p, r);
      if (!ll) { bad.push({ i, id: s[L.id_key], why: r.why.line_point }); return; }
      pts.push([ll.lat, ll.lng]);
    }
    const kmh = kmhOf(s[L.kmh_key], L);
    if (kmh === null) { blank += 1; return; }
    const lats = pts.map((p) => p[0]);
    const lngs = pts.map((p) => p[1]);
    good.push({ id: s[L.id_key], kmh, both: s[L.both_key] === true, pts, box: { lat0: Math.min(...lats), lng0: Math.min(...lngs), lat1: Math.max(...lats), lng1: Math.max(...lngs) } });
  });
  return { at, cell, good, bad, blank };
}

// 고속도로 선 파일 → {name, highway, direction, points}. 꼭짓점 하나라도 틀리면 선 전체를 버린다(던짐)
export function line(obj, r) {
  if (!isObj(obj) || !isStr(obj.name, r.name_max) || !Array.isArray(obj.points)) throw new TypeError(r.why.line);
  if (obj.points.length < r.min_line_points || obj.points.length > r.max_line_points) throw new TypeError(r.why.line_points);
  const points = obj.points.map((p) => {
    const ll = latLng(p, r);
    if (!ll) throw new TypeError(r.why.line_point);
    return [ll.lat, ll.lng];
  });
  return {
    name: obj.name,
    highway: isStr(obj.highway, r.name_max) ? obj.highway : null,
    direction: isStr(obj.direction, r.name_max) ? obj.direction : null,
    points,
  };
}
