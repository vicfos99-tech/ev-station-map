// StartProbe(바깥 연결 — 다리 확인, 보통 객체). health.app 이 '시작 중'이 되면 시작 필요 데이터(config_health.start_needs)를
// 다리에 한 번씩 물어(NetCore 를 거쳐) 결과를 conn.start 로 낸다. 판정은 하지 않는다(HealthRunner·Health 의 일).
// A2: 이 모듈은 다리 상태 확인(/v1/health)만 묻는다 — 충전소 목록·선은 relay_stations 가 받고 시작 결과를 스스로 낸다.
// start_needs 가운데 자기 표(config_startprobe.needs)에 있는 것만 묻는다(없는 것은 그 주인의 일).
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
    for (const need of r.start_needs) if (c.needs[need]) probe(need);
  });

  return {};
}
