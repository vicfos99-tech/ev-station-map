// 순수: 화장실 자료 합치기(추가3 — 화장실 꾸러미의 것). 로그 없음, 틀린 입력 꼴(규칙이 없음 등)은 던진다. 규칙 r = config_toilet_merge.
//   · checkRows(rows, r) → {good, bad}: 줄마다 칸 검사(r.fields 의 칸 이름 — id·이름·위도·경도·개방 시간·24시간·트럭·메모). 틀린 줄은 버리고 bad 에 {at, why}.
//   · checkPublic(data, r) → {good, bad}: 중계 화장실 목록 파일 꼴({v, at, items:[…]} — 칸 이름은 r.file) 검사 + 줄 검사. 파일 꼴이 틀리면 던진다(받은 쪽이 '이상함'으로 기록).
//   · restOf(stations, r) → 휴게소 화장실 줄: 충전소 목록의 휴게소 표시(r.rest.on_key)가 참인 곳을 화장실로(24시간·트럭은 r.rest 의 값 — 모르면 null).
//   · merge(pub, mine, rest, r, geo, g) → {list, counts}: 묘성 줄이 이긴다 — 같은 id 이거나 r.same_m 안의 공공·휴게소 줄은 뺀다(묘성이 직접 가 보고 적은 것이 더 새롭고 정확).
//     줄 꼴(앱 안): {id, name, lat, lng, open, all_day, truck, memo, rest, src} — src = r.src_words 의 public·mine·rest.
export const LAYER = 'pure';
export const NEEDS = [];

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function triBool(v) {
  return v === true || v === false || v === null || v === undefined;
}

// 줄 하나 → 앱 줄 또는 틀린 까닭(r.why 의 낱말)
function checkOne(raw, r, src) {
  const F = r.fields;
  const W = r.why;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { why: W.type };
  const id = raw[F.id];
  const name = raw[F.name];
  if (typeof id !== 'string' || id.length < r.id_min || id.length > r.id_max) return { why: W.id };
  if (typeof name !== 'string' || !name.trim() || name.length > r.name_max) return { why: W.name };
  const lat = raw[F.lat];
  const lng = raw[F.lng];
  if (!isNum(lat) || !isNum(lng) || lat < r.bounds.lat_min || lat > r.bounds.lat_max || lng < r.bounds.lng_min || lng > r.bounds.lng_max) return { why: W.pos };
  const open = raw[F.open];
  if (!(open === null || open === undefined || (typeof open === 'string' && open.length <= r.open_max))) return { why: W.open };
  if (!triBool(raw[F.all_day])) return { why: W.all_day };
  if (!triBool(raw[F.truck])) return { why: W.truck };
  const memo = raw[F.memo];
  if (!(memo === null || memo === undefined || (typeof memo === 'string' && memo.length <= r.memo_max))) return { why: W.memo };
  return {
    row: {
      id, name: name.trim(), lat, lng,
      open: typeof open === 'string' && open.trim() ? open.trim() : null,
      all_day: raw[F.all_day] === undefined ? null : raw[F.all_day],
      truck: raw[F.truck] === undefined ? null : raw[F.truck],
      memo: typeof memo === 'string' && memo.trim() ? memo.trim() : null,
      rest: false, src,
    },
  };
}

export function checkRows(rows, r, src) {
  if (!r || !r.fields) throw new TypeError('rule');
  if (!Array.isArray(rows)) throw new TypeError('rows');
  const good = [];
  const bad = [];
  const seen = new Set();
  rows.slice(0, r.max_rows).forEach((raw, at) => {
    const got = checkOne(raw, r, src);
    if (got.why) { bad.push({ at, why: got.why }); return; }
    if (seen.has(got.row.id)) { bad.push({ at, why: r.why.dup }); return; }
    seen.add(got.row.id);
    good.push(got.row);
  });
  if (rows.length > r.max_rows) bad.push({ at: r.max_rows, why: r.why.too_many });
  return { good, bad };
}

export function checkPublic(data, r) {
  const P = r.file;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new TypeError(P.items_key);
  if (data[P.v_key] !== P.v) throw new TypeError(P.v_key);
  if (!Array.isArray(data[P.items_key])) throw new TypeError(P.items_key);
  return checkRows(data[P.items_key], r, r.src_words.public);
}

export function restOf(stations, r) {
  const R = r.rest;
  const list = stations && Array.isArray(stations[R.list_key]) ? stations[R.list_key] : [];
  const out = [];
  for (const s of list) {
    if (!s || s[R.on_key] !== true || !isNum(s[R.lat_key]) || !isNum(s[R.lng_key]) || typeof s[R.name_key] !== 'string') continue;
    out.push({ id: R.id_prefix + s[R.id_key], name: s[R.name_key], lat: s[R.lat_key], lng: s[R.lng_key], open: null, all_day: R.all_day, truck: R.truck, memo: null, rest: true, src: r.src_words.rest });
  }
  return out;
}

export function merge(pub, mine, rest, r, geo, g) {
  if (!geo || typeof geo.distM !== 'function' || !g) throw new TypeError('geo');
  const near = (a, b) => geo.distM(a, b, g) <= r.same_m;
  const beaten = (x) => mine.some((m) => m.id === x.id || near(m, x));
  const keepPub = pub.filter((x) => !beaten(x));
  const keepRest = rest.filter((x) => !beaten(x));
  const list = [...mine, ...keepPub, ...keepRest];
  return { list, counts: { mine: mine.length, public: keepPub.length, rest: keepRest.length, beaten: pub.length + rest.length - keepPub.length - keepRest.length } };
}
