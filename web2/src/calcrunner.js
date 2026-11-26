// CalcRunner(보통 객체). 입력 알림이 오면 StateCalc 를 불러 결과 조각을 State 에 발행한다(설계 5-1-나).
// 규칙·숫자는 없다 — 받기·부르기·발행·catch 뿐. 사용 가능 판정은 하지 않는다. 자기가 낸 조각을 다시 받지 않는다.
// 셈 모듈 묶음(parts)은 오케스트레이터가 넘긴다. 표의 줄이 쓰는 설정 파일(rule·uses)은 만들 때 한 번 읽는다.
// (정비 가 ⑤ 격리) 줄 하나의 설정이 틀리면 그 줄만 꺼 두고(로그 한 줄) 나머지 줄은 셈한다 — 한 기능 설정 때문에 계산 전체가 멈추지 않게.
// (정비 가 ⑦) 구독할 입력·낼 조각은 계산 표에서 뽑는다(StateCalc.ioOf) — 같은 내용을 두 곳에 적지 않는다.
// (정비 나 ①) 지금 켠 제목 꾸러미의 계산 줄(topic_rows)은 조립이 넘기고, 표의 꽂는 자리(slot_key 줄)에 끼운다(StateCalc.expandTable) — 제목 이름은 모른다.
export const NEEDS = ['cfg', 'log', 'state', 'clock', 'statecalc', 'parts', 'topic_rows'];

export function createCalcRunner(deps) {
  const cfg = deps.cfg;
  const log = deps.log;
  const state = deps.state;
  const clock = deps.clock;
  const c = cfg.section('config_calcrunner');
  const sc = cfg.section('config_statecalc');
  const parts = deps.parts || {};
  const full = deps.statecalc.expandTable(sc.table, deps.topic_rows || [], sc.slot_key);
  const rules = {};
  const table = [];
  const off = [];
  for (const row of full) {
    const names = [row.rule, ...(row.uses || [])];
    const bad = names.filter((name) => !cfg.has(name));
    if (bad.length) {
      off.push(row.piece);
      log.error(new Error(bad.join(',')), { where: c.where, what: c.word_row_off, params: { piece: row.piece, files: bad } });
      continue;
    }
    for (const name of names) rules[name] = cfg.section(name);
    table.push(row);
  }
  const io = deps.statecalc.ioOf(full);
  const pub = state.claim(c.owner, io.outputs);
  const inputs = {};
  const changed = new Set();
  let prev = {};
  let timer = null;

  function run() {
    timer = null;
    const now = new Set(changed);
    changed.clear();
    try {
      const res = deps.statecalc.calc(inputs, now, prev, table, parts, rules);
      for (const f of res.failed) log.error(f.error, { where: c.where, params: { piece: f.piece, changed: [...now] } });
      for (const [piece, value] of Object.entries(res.out)) pub(piece, value);
      prev = { ...prev, ...res.out };
    } catch (e) {
      log.error(e, { where: c.where, params: { changed: [...now] } });
    }
  }

  for (const name of io.inputs) {
    state.subscribe(name, (v) => {
      inputs[name] = v;
      changed.add(name);
      if (timer === null) timer = clock.setTimeout(run, c.batch_ms);
    });
  }
  return { off: () => off.slice(), io: () => ({ inputs: io.inputs.slice(), outputs: io.outputs.slice() }) };
}
