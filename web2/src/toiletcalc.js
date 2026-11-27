// 순수: '앞의 화장실'과 화장실 목록(추가3 — 화장실 꾸러미의 계산 줄 두 개). 셈은 '앞의 ○○'(ahead.aheadOf — 제목을 모름)을 그대로 쓴다:
//   규칙 = 바탕 규칙(r.base_rule — 충전소의 config_ahead: 휴게소 묶기·방향·지나침·주변·경로 따라 값)에 화장실 것(r.over — 받는 조각 toilets·칸 이름)을 덮은 것.
//   바탕 규칙을 한 벌 더 적지 않는다(설정 중복). 덮은 규칙은 바탕 규칙마다 한 번만 만들어 둔다(ahead 의 자리 셈 사본이 규칙이 같을 때만 쓰이므로).
//   · listOf → 화장실 목록 조각(r.list_count 곳 — 목록 칸이 그림)
//   · aheadOf → ahead 조각(지도 번호·화장실판) = 같은 셈의 목록 조각(done[r.list_piece])의 앞 r.count 곳. 한 번만 셈한다(목록과 판이 어긋나지 않음)
// StateCalc 꼴: fn(입력 조각들, 같은 셈의 앞 결과 done, 규칙 r, {parts, rules}, 내 앞 결과). 로그 없음, 틀린 입력은 던진다.
export const LAYER = 'pure';
export const NEEDS = [];

const merged = new WeakMap();

function ruleOf(r, lib) {
  const base = lib.rules[r.base_rule];
  if (!base) throw new TypeError(r.base_rule);
  let byOver = merged.get(base);
  if (!byOver) { byOver = new WeakMap(); merged.set(base, byOver); }
  let m = byOver.get(r);
  if (!m) { m = Object.freeze({ ...base, ...r.over, count: r.list_count }); byOver.set(r, m); }
  return m;
}

export function listOf(inputs, done, r, lib, own) {
  const ahead = lib.parts[r.ahead_part];
  if (!ahead || typeof ahead.aheadOf !== 'function') throw new TypeError(r.ahead_part);
  return ahead.aheadOf(inputs, done, ruleOf(r, lib), lib, own);
}

export function aheadOf(inputs, done, r, lib, own) {
  const list = done[r.list_piece];
  if (!list) return own || null;
  if (!Array.isArray(list.items)) throw new TypeError(r.list_piece);
  return { ...list, items: list.items.slice(0, r.count) };
}
