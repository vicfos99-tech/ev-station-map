// RelayClient 의 받기 바탕(바깥 연결 — 보통 객체, 설계 5-1 relay_base · E3). 다리의 **자료 길 이름과 파일 이름**만 NetCore 에 넘긴다 —
// 주소를 모른다. 파일 이름은 설정의 허용 무늬(config_relay_base.file_res)에 맞을 때만 묻는다(맞지 않으면 묻지 않고 '나쁜 이름' 결과).
// 결과는 NetCore 의 꼴 그대로 {ok, data | code, src, status}. 시간 한도·다시 받기 값은 config_netcore 의 클라이언트 줄(c.client).
export const NEEDS = ['cfg', 'log', 'netcore'];

export function createRelayBase(deps) {
  const c = deps.cfg.section('config_relay_base');
  const res = c.file_res.map((p) => new RegExp(p));
  return {
    async get(file) {
      if (typeof file !== 'string' || file.length > c.file_max_chars || !res.some((rx) => rx.test(file))) {
        deps.log.warn(c.where, c.word_bad_name, { file: String(file).slice(0, c.file_max_chars) });
        return { ok: false, code: c.code_bad_name };
      }
      return deps.netcore.ask(c.client, c.route, { sub: file });
    },
  };
}
