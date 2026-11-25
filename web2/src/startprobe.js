// StartProbe(바깥 연결 — 다리 확인, 보통 객체). health.app 이 '시작 중'이 되면 시작 필요 데이터(config_health.start_needs)를
// 다리에 한 번씩 물어(NetCore 를 거쳐) 결과를 conn.start 로 낸다. 판정은 하지 않는다(HealthRunner·Health 의 일).
// A1: 다리 상태 확인(/v1/health)과 중계 자료 머리(meta.json). A2 부터 충전소 목록·선은 relay_* 가 맡는다.
export const NEEDS = ['cfg', 'log', 'state', 'netcore'];

export function createStartProbe(deps) {
  const cfg = deps.cfg;
  const log = deps.log;
  const net = deps.netcore;
  const c = cfg.section('config_startprobe');
  const r = cfg.section('config_health');
  const pub = deps.state.claim(c.owner, [c.piece]);
  let ran = false;

  async function probe(need) {
    const how = c.needs[need];
    try {
      if (!how) throw new Error(need);
      const got = await net.ask(c.client, how.route, { sub: how.sub });
      pub(c.piece, { need, ok: got.ok, code: got.code, src: got.src });
    } catch (e) {
      log.error(e, { where: c.where, params: { need } });
      pub(c.piece, { need, ok: false, code: c.code_internal });
    }
  }

  deps.state.subscribe(c.app_piece, (v) => {
    if (ran || !v || v.stage !== r.stages.starting) return;
    ran = true;
    for (const need of r.start_needs) probe(need);
  });

  return {};
}
