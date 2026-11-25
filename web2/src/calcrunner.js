// CalcRunner(보통 객체). 입력 알림이 오면 StateCalc 를 불러 결과 조각을 State 에 발행한다(설계 5-1-나).
// 규칙·숫자는 없다 — 받기·부르기·발행·catch 뿐. 사용 가능 판정은 하지 않는다. 자기가 낸 조각을 다시 받지 않는다.
// A1 은 뼈대: 입력·조각 목록(config_calcrunner·config_statecalc)이 비어 있다.
export const NEEDS = ['cfg', 'log', 'state', 'clock', 'statecalc'];

export function createCalcRunner(deps) {
  const cfg = deps.cfg;
  const log = deps.log;
  const state = deps.state;
  const clock = deps.clock;
  const c = cfg.section('config_calcrunner');
  const sc = cfg.section('config_statecalc');
  const parts = {}; // A2 에서 셈 모듈(Locate·Ahead·Speed …)을 NEEDS 로 받아 넣는다
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
      const out = deps.statecalc.calc(inputs, now, prev, sc.table, parts);
      for (const [piece, value] of Object.entries(out)) pub(piece, value);
      prev = { ...prev, ...out };
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
