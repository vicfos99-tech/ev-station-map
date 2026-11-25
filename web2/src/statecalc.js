// 순수: 상태 계산의 들머리 하나(설계 5-1-나 StateCalc). (입력 조각들, 바뀐 입력, 앞 결과, 표, 셈 모듈들) → 새 결과 조각들.
// 어느 입력이 바뀌면 어느 조각을 다시 셈하는지의 표(config_statecalc.table)를 따른다. 셈 자체는 인자로 받은 작은 순수 모듈에 시킨다.
// A1 은 뼈대 — 표가 비어 있어 아무 조각도 셈하지 않는다(A2 에서 pos·ahead·speed 가 들어온다). 로그 없음, 틀리면 던진다.
export const NEEDS = [];

export function calc(inputs, changed, prev, table, parts) {
  if (!Array.isArray(table)) throw new TypeError('table');
  const out = {};
  const done = { ...prev };
  for (const row of table) {
    if (!row.inputs.some((name) => changed.has(name))) continue;
    const fn = parts[row.part];
    if (typeof fn !== 'function') throw new TypeError(row.part);
    out[row.piece] = fn(inputs, done);
    done[row.piece] = out[row.piece];
  }
  return out;
}
