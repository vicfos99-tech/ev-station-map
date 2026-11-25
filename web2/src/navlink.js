// 순수: 충전소 → 다른 내비로 넘길 주소 글(설계 5-1-나 NavLink · 5-8 마).
//   방법 1 — 위치 주소(geo:) 하나: 안드로이드가 받을 수 있는 앱들을 고르기 창으로 보여 준다.
//   방법 2 — 앱마다의 주소(티맵·카카오맵·네이버 지도·구글): 방법 1 에서 안 뜨는 앱만 정보 칸의 작은 단추로.
//   복사 글 — 이름(방향 붙임)과 좌표(늘 함께 보이는 '좌표·이름 복사' 단추).
// 휴게소는 방향을 이름에 붙이고(이름 꼴 r.name_with_dir), 좌표는 그 방향 충전소 자리(고른 자리의 좌표 — 휴게소 한가운데가 아님).
// 주소 무늬·앱 목록·이름 꼴·방향 이름·좌표 자릿수는 모두 r = config_navlink. 로그 없음, 틀린 입력은 던진다.
export const NEEDS = [];

function fill(tpl, vals, r) {
  return tpl.replace(new RegExp(r.slot_re, 'g'), (m, k) => (vals[k] === undefined || vals[k] === null ? '' : String(vals[k])));
}

// 주소 안에 넣는 글: encodeURIComponent 가 남기는 괄호·따옴표 같은 글자까지 바꾼다(r.extra_escape — geo: 의 '(이름)' 칸이 깨지지 않게)
function enc(s, r) {
  let out = encodeURIComponent(s);
  for (const [ch, to] of Object.entries(r.extra_escape)) out = out.split(ch).join(to);
  return out;
}

// 보이는 이름: 방향을 아는 휴게소면 '이름(부산 방향)', 아니면 이름 그대로
export function label(place, r) {
  if (!place || typeof place.name !== 'string' || !place.name) throw new TypeError(r.why.name);
  const names = place.line && r.dir_names[place.line];
  const dir = names && place.dir ? names[place.dir] : null;
  const name = place.name.slice(0, r.name_max);
  return dir ? fill(r.name_with_dir, { name, dir }, r) : name;
}

// place = {name, dir, line, lat, lng} → {label, lat, lng, geo, apps: [{key, text, url}], copy}
export function links(place, r) {
  if (!place || typeof place.lat !== 'number' || typeof place.lng !== 'number' || !Number.isFinite(place.lat) || !Number.isFinite(place.lng)) throw new TypeError(r.why.coord);
  if (place.lat < r.lat_min || place.lat > r.lat_max || place.lng < r.lng_min || place.lng > r.lng_max) throw new TypeError(r.why.coord);
  const name = label(place, r);
  const vals = { lat: place.lat.toFixed(r.coord_digits), lng: place.lng.toFixed(r.coord_digits), label: enc(name, r), appname: enc(r.appname, r) };
  return {
    label: name,
    lat: vals.lat,
    lng: vals.lng,
    geo: fill(r.geo, vals, r),
    apps: r.apps.map((a) => ({ key: a.key, text: a.text, url: fill(a.url, vals, r) })),
    copy: fill(r.copy, { ...vals, label: name }, r),
  };
}
