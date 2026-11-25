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

// meta.json — 모양 판 번호만 본다(신선함은 A4 relay_fresh). 틀리면 던진다
export function meta(obj, r) {
  if (!isObj(obj) || obj[r.v_key] !== r.v) throw new TypeError(r.why.meta);
  return { at: typeof obj[r.meta_at_key] === 'string' ? obj[r.meta_at_key] : null };
}

// stations/<zscode>.json → {zscode, good: [충전소], bad: [{i, why}]}. 파일 꼴이 틀리면 던진다
export function stations(obj, r) {
  if (!isObj(obj) || obj[r.v_key] !== r.v || !Array.isArray(obj[r.stations_key])) throw new TypeError(r.why.file);
  if (obj[r.stations_key].length > r.max_stations) throw new TypeError(r.why.too_many);
  const good = [];
  const bad = [];
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
      chargers: s.chargers.length,
    });
  });
  return { zscode: isStr(obj[r.zscode_key], r.id_max) ? obj[r.zscode_key] : null, good, bad };
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
