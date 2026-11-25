// CalcRunner(보통 객체). 입력 알림이 오면 StateCalc 를 불러 결과 조각을 State 에 발행한다(설계 5-1-나).
// 규칙·숫자는 없다 — 받기·부르기·발행·catch 뿐. 사용 가능 판정은 하지 않는다. 자기가 낸 조각을 다시 받지 않는다.
// 셈 모듈 묶음(parts)은 오케스트레이터가 넘긴다. 표의 줄이 쓰는 설정 파일(rule·uses)은 만들 때 한 번 읽는다(틀리면 만들기 실패 → 계산 기능만 나쁨).
export const NEEDS = ['cfg', 'log', 'state', 'clock', 'statecalc', 'parts'];

export function createCalcRunner(deps) {
  const cfg = deps.cfg;
  const log = deps.log;
  const state = deps.state;
  const clock = deps.clock;
  const c = cfg.section('config_calcrunner');
  const sc = cfg.section('config_statecalc');
  const parts = deps.parts || {};
  const rules = {};
  for (const row of sc.table) for (const name of [row.rule, ...(row.uses || [])]) rules[name] = cfg.section(name);
  const pub = state.claim(c.owner, c.outputs);
  const inputs = {};
  const changed = new Set();
  let prev = {};
  let timer = null;

  function run() {
    timer = null;
    const now = new Set(changed);
    changed.clear();
    try {
      const res = deps.statecalc.calc(inputs, now, prev, sc.table, parts, rules);
      for (const f of res.failed) log.error(f.error, { where: c.where, params: { piece: f.piece, changed: [...now] } });
      for (const [piece, value] of Object.entries(res.out)) pub(piece, value);
      prev = { ...prev, ...res.out };
    } catch (e) {
      log.error(e, { where: c.where, params: { changed: [...now] } });
    }
  }

  for (const name of c.inputs) {
    state.subscribe(name, (v) => {
      inputs[name] = v;
      changed.add(name);
      if (timer === null) timer = clock.setTimeout(run, c.batch_ms);
    });
  }
  return {};
}
