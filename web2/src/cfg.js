// Config(싱글톤 — 오케스트레이터가 하나 만들어 넘긴다). 설정 읽기와 꼴 검사.
// 아무것도 모른다(Logger 도). 읽기·검사 실패는 problems() 목록으로 메모리에 들고 있다가
// 오케스트레이터가 Logger 를 만든 뒤 꺼내 쓴다(설계 5-7 (1)). 빠진 값을 기본값으로 메우지 않는다.
export const NEEDS = [];

export class ConfigError extends Error {
  constructor(file) {
    super(file);
    this.file = file;
  }
}

function typeOf(v) {
  if (Array.isArray(v)) return 'arr';
  if (v === null) return 'null';
  if (typeof v === 'number') return 'num';
  if (typeof v === 'string') return 'str';
  if (typeof v === 'boolean') return 'bool';
  return typeof v === 'object' ? 'obj' : typeof v;
}

function pick(obj, dotted) {
  let cur = obj;
  for (const part of dotted.split('.')) {
    if (cur === null || typeof cur !== 'object' || !(part in cur)) return { found: false };
    cur = cur[part];
  }
  return { found: true, value: cur };
}

function checkValue(v, rule, whole) {
  const t = typeOf(v);
  if (rule.t === 'url') {
    if (t !== 'str') return { why: 'type', detail: t };
    if (rule.max !== undefined && v.length > rule.max) return { why: 'length', detail: String(v.length) };
    let u;
    try { u = new URL(v); } catch (e) { return { why: 'url', detail: e.message }; }
    const hosts = pick(whole, rule.hosts_key);
    if (!hosts.found || !Array.isArray(hosts.value) || hosts.value.length === 0) return { why: 'hosts_empty' };
    if (!hosts.value.includes(u.host)) return { why: 'host', detail: u.host };
    if (rule.schemes.includes(u.protocol)) return null;
    const loose = rule.loose_hosts_key ? pick(whole, rule.loose_hosts_key) : { found: false };
    const looseOk = loose.found && Array.isArray(loose.value) && loose.value.includes(u.hostname);
    if (looseOk && (rule.loose_schemes || []).includes(u.protocol)) return null;
    return { why: 'scheme', detail: u.protocol };
  }
  if (rule.t === 'any') return null;
  if (rule.t === 'map') {
    if (t !== 'obj') return { why: 'type', detail: t };
    for (const [k, item] of Object.entries(v)) {
      const bad = rule.of ? checkValue(item, rule.of, whole) : null;
      if (bad) return { why: bad.why, detail: k + (bad.detail ? ':' + bad.detail : '') };
    }
    return null;
  }
  if (t !== rule.t) return { why: 'type', detail: t };
  if (t === 'num') {
    if (!Number.isFinite(v)) return { why: 'type', detail: String(v) };
    if (rule.int && !Number.isInteger(v)) return { why: 'int', detail: String(v) };
    if (rule.min !== undefined && v < rule.min) return { why: 'range', detail: String(v) };
    if (rule.max !== undefined && v > rule.max) return { why: 'range', detail: String(v) };
  }
  if (t === 'str') {
    if (rule.min !== undefined && v.length < rule.min) return { why: 'length', detail: String(v.length) };
    if (rule.max !== undefined && v.length > rule.max) return { why: 'length', detail: String(v.length) };
    if (rule.re !== undefined && !new RegExp(rule.re).test(v)) return { why: 'pattern' };
    if (rule.one_of !== undefined && !rule.one_of.includes(v)) return { why: 'one_of', detail: v };
  }
  if (t === 'arr') {
    if (rule.min !== undefined && v.length < rule.min) return { why: 'length', detail: String(v.length) };
    if (rule.max !== undefined && v.length > rule.max) return { why: 'length', detail: String(v.length) };
    if (rule.of) {
      for (let i = 0; i < v.length; i += 1) {
        const bad = checkValue(v[i], rule.of, whole);
        if (bad) return { why: bad.why, detail: String(i) + (bad.detail ? ':' + bad.detail : '') };
      }
    }
  }
  return null;
}

// 꼴 표: { keys: { "a.b": 규칙 } } — 표의 키는 모두 있어야 한다
export function checkShape(obj, shape) {
  const out = [];
  if (typeOf(obj) !== 'obj') return [{ key: '', why: 'type', detail: typeOf(obj) }];
  for (const [key, rule] of Object.entries(shape.keys || {})) {
    const got = pick(obj, key);
    if (!got.found) { out.push({ key, why: 'missing' }); continue; }
    const bad = checkValue(got.value, rule, obj);
    if (bad) out.push({ key, why: bad.why, detail: bad.detail });
  }
  return out;
}

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

function isObj(v) {
  return typeOf(v) === 'obj';
}

// (추가3 앞 기본 걸음) 더하기: 설정 파일이 칸 raw.adds_key(빌드 설정 build.adds_key)에 {다른 설정 이름: {칸: 값}} 을 적으면 그 설정에 더한다.
// 제목 꾸러미가 자기 설정의 등급(config_health.grades·features)·이름 글(config_ui_status.texts.feature_names)을 자기 파일에서 밝히게 — 남의 파일을 고치지 않고.
// 객체끼리는 안으로 들어가 더하고, 없는 칸만 새로 둔다. 이미 있는 칸이 다른 값이면 바꾸지 않고 문제(adds_clash — 더한 쪽 파일)로 적는다(같은 값이면 그냥 둠).
// 더하는 쪽 파일이 꼴 검사에서 틀려도 그 더하기 칸이 객체면 더한다 — 꾸러미 설정이 깨져도 그 설정들의 등급은 알아야 '그 기능만 꺼짐'이 된다(모르면 앱 전체 점검 중).
// 받는 쪽 설정이 꼴에서 틀렸으면 더하지 않는다(그 설정은 어차피 못 씀).
function addInto(target, add, file, path, problems) {
  for (const [k, v] of Object.entries(add)) {
    const at = path + '.' + k;
    if (!(k in target)) { target[k] = JSON.parse(JSON.stringify(v)); continue; }
    if (isObj(target[k]) && isObj(v)) { addInto(target[k], v, file, at, problems); continue; }
    if (JSON.stringify(target[k]) !== JSON.stringify(v)) problems.push({ file, key: at, why: 'adds_clash' });
  }
}

// raw = { files: {이름: 객체}, shapes: {이름: 꼴 표}, broken: {이름: 못 읽은 까닭}, adds_key?: 더하기 칸 이름 } — 빌드가 window.EV_CONFIG 로 넣는다
export function createConfig(raw) {
  const files = (raw && raw.files) || {};
  const shapes = (raw && raw.shapes) || {};
  const broken = (raw && raw.broken) || {};
  const addsKey = raw && typeof raw.adds_key === 'string' && raw.adds_key ? raw.adds_key : null;
  const problems = [];
  const good = {};
  for (const [file, why] of Object.entries(broken)) problems.push({ file, key: '', why: 'unreadable', detail: String(why) });
  for (const file of Object.keys(shapes)) {
    if (!(file in files) && !(file in broken)) problems.push({ file, key: '', why: 'missing_file' });
  }
  for (const [file, obj] of Object.entries(files)) {
    const shape = shapes[file];
    if (!shape) { problems.push({ file, key: '', why: 'no_shape' }); continue; }
    const found = checkShape(obj, shape);
    if (found.length) { for (const p of found) problems.push({ file, ...p }); continue; }
    good[file] = JSON.parse(JSON.stringify(obj));
  }
  if (addsKey) {
    for (const file of Object.keys(files).sort()) {
      const add = isObj(files[file]) ? files[file][addsKey] : undefined;
      if (add === undefined) continue;
      if (!isObj(add)) { problems.push({ file, key: addsKey, why: 'type', detail: typeOf(add) }); continue; }
      for (const [to, part] of Object.entries(add)) {
        if (!isObj(part)) { problems.push({ file, key: addsKey + '.' + to, why: 'type', detail: typeOf(part) }); continue; }
        if (to in good) addInto(good[to], part, file, addsKey + '.' + to, problems);
      }
    }
  }
  for (const file of Object.keys(good)) deepFreeze(good[file]);
  return {
    problems: () => problems.map((p) => ({ ...p })),
    has: (file) => file in good,
    // 꼴을 통과한 설정 파일 하나. 문제가 있던 파일이면 던진다(기본값으로 메우지 않음)
    section(file) {
      if (!(file in good)) throw new ConfigError(file);
      return good[file];
    },
  };
}
