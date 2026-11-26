// 순수: 제목 고르기(정비 나 ③ — 앱은 마지막에 쓴 제목으로 켜진다, 제목은 한 번에 하나). 규칙 r = config_ui_topic(주소 꼬리 글자).
// 켤 때 조립이 주소 꼬리(#topic=…)로 켤 제목을 고르고(activeOf), 제목 단추(ui_topic)가 폰에 남긴 '마지막에 쓴 제목'과 다르면 그 제목으로 다시 켠다(wantOf → hashOf).
// 주소 꼬리를 쓰는 까닭: 폰 데이터 폴더(Store) 읽기는 기다려야 해서 조립이 켤 때 바로 못 읽는다 — 켜는 차례·시간을 그대로 두려고(정비 나 갈림길 2). 로그 없음.
export const NEEDS = [];

// 주소 꼬리 글 → 제목 키(없거나 꼴이 틀리면 null)
export function hashName(hash, r) {
  if (typeof hash !== 'string' || !hash) return null;
  const body = hash.startsWith(r.hash_mark) ? hash.slice(r.hash_mark.length) : hash;
  for (const part of body.split(r.hash_sep)) {
    const at = part.indexOf(r.hash_eq);
    if (at < 0) continue;
    if (part.slice(0, at) !== r.hash_key) continue;
    const v = part.slice(at + r.hash_eq.length);
    try { return v ? decodeURIComponent(v) : null; } catch (e) { return null; }
  }
  return null;
}

// 켤 제목: 물은 것이 목록에 있으면 그것, 아니면 첫 꾸러미(목록이 비면 null — 기본 기능만)
export function activeOf(names, asked) {
  if (!Array.isArray(names)) throw new TypeError('names');
  if (typeof asked === 'string' && names.includes(asked)) return asked;
  return names.length ? names[0] : null;
}

// 남긴 제목이 지금 켠 것과 다르고 목록에 있으면 그것(다시 켤 제목), 아니면 null
export function wantOf(names, active, stored) {
  if (!Array.isArray(names)) throw new TypeError('names');
  return typeof stored === 'string' && stored !== active && names.includes(stored) ? stored : null;
}

export function hashOf(name, r) {
  return r.hash_mark + r.hash_key + r.hash_eq + encodeURIComponent(name);
}
