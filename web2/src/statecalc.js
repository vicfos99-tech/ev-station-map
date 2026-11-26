// 순수: 상태 계산의 들머리 하나(설계 5-1-나 StateCalc). (입력 조각들, 바뀐 입력, 앞 결과, 표, 셈 모듈들, 규칙들) → 새 결과 조각들.
// 어느 입력이 바뀌면 어느 조각을 다시 셈하는지의 표(config_statecalc.table)를 따른다. 셈 자체는 인자로 받은 작은 순수 모듈에 시킨다.
// 표 한 줄 = {inputs:[알림], part:셈 모듈 이름, fn:함수 이름, piece:결과 조각, rule:그 셈의 설정 파일, uses:[더 읽는 설정 파일]}.
// 셈 함수 꼴: fn(입력 조각들, 같은 셈의 앞 결과 done, 규칙, {parts, rules}, 내 앞 결과) — 같은 셈 안에서 앞 줄의 결과(pos 등)를 뒤 줄이 쓴다(E7).
// 한 줄이 던져도 나머지 줄은 셈한다 — 던진 줄은 failed 에 담아 돌려준다(로그는 부른 CalcRunner 가). 로그 없음.
export const NEEDS = [];

// (정비 가 ⑦) 표에서 구독할 입력과 낼 조각을 뽑는다 — 한 곳(표)에만 적는다. 입력은 줄 차례대로 처음 나온 차례, 조각은 줄 차례
export function ioOf(table) {
  if (!Array.isArray(table)) throw new TypeError('table');
  const inputs = [];
  const outputs = [];
  for (const row of table) {
    for (const name of row.inputs) if (!inputs.includes(name)) inputs.push(name);
    if (!outputs.includes(row.piece)) outputs.push(row.piece);
  }
  return { inputs, outputs };
}

// (정비 나 ①) 꽂는 자리: 기본 표의 {[slotKey]: …} 줄 자리에 지금 켠 제목 꾸러미의 줄(topicRows)을 차례대로 끼운다. 제목이 없으면 그 자리는 빈다.
export function expandTable(table, topicRows, slotKey) {
  if (!Array.isArray(table)) throw new TypeError('table');
  if (!Array.isArray(topicRows)) throw new TypeError('topicRows');
  const out = [];
  for (const row of table) {
    if (row && Object.prototype.hasOwnProperty.call(row, slotKey)) out.push(...topicRows);
    else out.push(row);
  }
  return out;
}

export function calc(inputs, changed, prev, table, parts, rules) {
  if (!Array.isArray(table)) throw new TypeError('table');
  const out = {};
  const failed = [];
  const done = { ...prev };
  for (const row of table) {
    if (!row.inputs.some((name) => changed.has(name))) continue;
    try {
      const mod = parts[row.part];
      const fn = mod && mod[row.fn];
      if (typeof fn !== 'function') throw new TypeError(row.part);
      const rule = rules[row.rule];
      if (!rule) throw new TypeError(row.rule);
      out[row.piece] = fn(inputs, done, rule, { parts, rules }, done[row.piece]);
      done[row.piece] = out[row.piece];
    } catch (e) {
      failed.push({ piece: row.piece, error: e });
    }
  }
  return { out, failed };
}
