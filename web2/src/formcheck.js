// 순수: 화면 입력 검사(설계 5-1 formcheck · 5-7 (1) '화면 입력 → FormCheck'). 범위·길이·제어 문자는 모두 규칙(설정)으로 받는다.
// field(값, 규칙) → {ok, value, why}: 규칙 꼴 {t: 'text'|'num', ...}. 틀린 입력은 why 코드로 돌려준다(화면이 그 칸 아래 한 줄로 보임).
// 규칙 자체가 틀리면 던진다. 로그 없음.
export const NEEDS = [];

// 글: {t:'text', max: 글자 수 한도, ctrl_re: 막을 글자 무늬, trim: 앞뒤 빈칸 지움, allow_empty, why: {type, long, ctrl, empty}}
function text(v, rule) {
  if (typeof v !== 'string') return { ok: false, value: null, why: rule.why.type };
  const s = rule.trim ? v.trim() : v;
  if (!s.length) return rule.allow_empty ? { ok: true, value: s, why: null } : { ok: false, value: null, why: rule.why.empty };
  if (new RegExp(rule.ctrl_re).test(s)) return { ok: false, value: null, why: rule.why.ctrl };
  if ([...s].length > rule.max) return { ok: false, value: null, why: rule.why.long };
  return { ok: true, value: s, why: null };
}

// 숫자: {t:'num', min, max, int, why: {type, range, int}}
function num(v, rule) {
  const n = typeof v === 'string' && v.trim().length ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return { ok: false, value: null, why: rule.why.type };
  if (rule.int && !Number.isInteger(n)) return { ok: false, value: null, why: rule.why.int };
  if (n < rule.min || n > rule.max) return { ok: false, value: null, why: rule.why.range };
  return { ok: true, value: n, why: null };
}

const kinds = { text, num };

export function field(v, rule) {
  const fn = rule && kinds[rule.t];
  if (!fn || !rule.why) throw new TypeError('rule');
  return fn(v, rule);
}
