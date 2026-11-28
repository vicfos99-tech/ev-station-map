// NetCore(보통 객체 — 오케스트레이터가 만들어 넘긴다). 공통 통신 모듈: 다리 주소(config_gateway.gateway_url)를
// 읽는 모듈은 이것 하나다. 클라이언트는 길 이름(과 붙일 것)만 넘긴다. 시간 한도·다시 받기(횟수·간격 늘림)·
// 답 크기 한도·까닭 코드 통일은 여기 한 곳(값은 config_netcore). 모든 물음에 앱 비밀 값 머리를 붙이고, 값은 로그에 넘기지 않는다.
// 다리 주소·앱 비밀 값 설정에 문제가 있으면 아무것도 보내지 않고 던진다(설계 5-1-나).
export const NEEDS = ['cfg', 'log', 'fetch', 'clock'];

export class NetNotReady extends Error {}

export function createNetCore(deps) {
  const cfg = deps.cfg;
  const log = deps.log;
  const clock = deps.clock;
  const fetchFn = deps.fetch;
  const n = cfg.section('config_netcore');
  const codes = n.codes;

  // 고정 파일 판(g.mode 가 n.static_mode): 다리 없이 같은 사이트의 고정 파일 자리(g.static_base)에서 읽는다.
  // 앱 비밀 값 머리를 보내지 않는다(앱에 비밀을 넣지 않음). 고정 파일에 없는 길(g.static_routes 에 없는 길)은 묻지 않고 codes.no_static
  function gateway() {
    if (!cfg.has(n.gateway_file)) throw new NetNotReady(codes.not_ready);
    const g = cfg.section(n.gateway_file);
    if (g.mode === n.static_mode) return { g, secret: null, fixed: true };
    if (!cfg.has(n.secret_file)) throw new NetNotReady(codes.not_ready);
    return { g, secret: cfg.section(n.secret_file)[n.secret_key], fixed: false };
  }

  function limitsOf(client) {
    const l = n.clients[client];
    if (!l) throw new Error(client);
    return l;
  }

  function urlOf(g, route, sub, fixed) {
    if (fixed) {
      const f = g.static_routes[route];
      return f === undefined ? null : g.static_base + f + (sub || '');
    }
    const p = g.paths[route];
    if (p === undefined) throw new Error(route);
    return g.gateway_url + p + (sub || '');
  }

  function headers(g, secret, withBody, fixed) {
    const h = fixed ? {} : { [g.secret_header]: secret };
    if (withBody) h[n.content_type_header] = n.json_type;
    return h;
  }

  const wait = (ms) => new Promise((resolve) => clock.setTimeout(resolve, ms));

  async function once(url, init, l) {
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = clock.setTimeout(() => { timedOut = true; ctrl.abort(); }, l.timeout_ms);
    try {
      const resp = await fetchFn(url, { ...init, signal: ctrl.signal });
      const text = await resp.text();
      if (text.length > l.max_chars) return { ok: false, code: codes.too_big, status: resp.status };
      let data;
      // 해석 실패는 까닭(오류 이름)을 실어 돌려준다 — ask 가 실패 로그에 함께 남긴다(받은 글은 싣지 않음)
      try { data = JSON.parse(text); } catch (e) { return { ok: false, code: codes.parse, status: resp.status, detail: e && e.name }; }
      if (!resp.ok || (data && data.ok === false)) {
        // 실패 답도 본문을 함께 돌려준다(다리 상태 길은 ok 거짓이어도 출처마다의 좋음·나쁨을 싣는다 — A6)
        return { ok: false, code: (data && data[n.code_field]) || codes.status, src: data && data[n.src_field], status: resp.status, data };
      }
      return { ok: true, data, status: resp.status };
    } catch (e) {
      return { ok: false, code: timedOut ? codes.timeout : codes.offline, detail: e && e.name };
    } finally {
      clock.clearTimeout(timer);
    }
  }

  return {
    // 다리 주소·앱 비밀 값 설정이 있나(gateway() 가 던지는 조건과 같음 — 예외를 삼키지 않게 조건을 직접 본다)
    ready() {
      if (!cfg.has(n.gateway_file)) return false;
      return cfg.section(n.gateway_file).mode === n.static_mode || cfg.has(n.secret_file);
    },
    // 길 하나에 묻기. 결과 {ok, data | code, src, status} — 다시 받기를 다 쓰면 마지막 실패를 돌려준다
    async ask(client, route, opt) {
      const { g, secret, fixed } = gateway();
      const l = limitsOf(client);
      const o = opt || {};
      const body = o.body === undefined ? undefined : JSON.stringify(o.body);
      const init = { method: o.method || n.default_method, headers: headers(g, secret, body !== undefined, fixed), body, cache: n.cache_mode };
      const url = urlOf(g, route, o.sub, fixed);
      if (url === null) {
        log.warn(n.where_ask, n.word_no_static, { client, route });
        return { ok: false, code: codes.no_static };
      }
      let last = null;
      for (let attempt = 0; attempt <= l.retries; attempt += 1) {
        if (attempt > 0) await wait(l.backoff_ms * l.backoff_factor ** (attempt - 1));
        last = await once(url, init, l);
        if (last.ok || n.no_retry_codes.includes(last.code)) break;
      }
      if (!last.ok) log.warn(n.where_ask, n.word_fail, { client, route, sub: o.sub, code: last.code, src: last.src, status: last.status, detail: last.detail });
      return last;
    },
    // 서버 보냄 이벤트(시험 흐름 등) 열기. on.event(이름, 글) · on.open() · on.down(까닭 코드). 돌려받은 함수로 닫는다
    stream(client, route, on) {
      const { g, secret, fixed } = gateway();
      const l = limitsOf(client);
      const url = urlOf(g, route, '', fixed);
      if (url === null) {
        log.warn(n.where_stream, n.word_no_static, { client, route });
        Promise.resolve().then(() => on.down(codes.no_static));
        return () => {};
      }
      const ctrl = new AbortController();
      let closed = false;
      let opened = false;
      const openTimer = clock.setTimeout(() => { if (!opened) ctrl.abort(); }, l.timeout_ms);
      (async () => {
        let why = codes.closed;
        let detail;
        try {
          const resp = await fetchFn(url, { method: n.default_method, headers: headers(g, secret, false, fixed), signal: ctrl.signal, cache: n.cache_mode });
          opened = true;
          clock.clearTimeout(openTimer);
          if (!resp.ok || !resp.body) {
            let code = codes.status;
            // 실패 답 본문을 못 읽으면 status 코드로 대신하고, 까닭(오류 이름)은 아래 끊김 로그에 싣는다
            try { const d = JSON.parse(await resp.text()); code = d[n.code_field] || code; } catch (e) { code = codes.status; detail = e && e.name; }
            why = code;
            return;
          }
          on.open();
          const reader = resp.body.getReader();
          const dec = new TextDecoder();
          let buf = '';
          let ev = n.sse.default_event;
          let data = [];
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            if (buf.length > l.max_chars) { why = codes.too_big; ctrl.abort(); break; }
            let i;
            while ((i = buf.indexOf('\n')) >= 0) {
              const line = buf.slice(0, i).replace(/\r$/, '');
              buf = buf.slice(i + 1);
              if (line === '') {
                if (data.length) on.event(ev, data.join('\n'));
                ev = n.sse.default_event;
                data = [];
                continue;
              }
              const k = line.indexOf(':');
              const field = k < 0 ? line : line.slice(0, k);
              const val = k < 0 ? '' : line.slice(k + 1).replace(/^ /, '');
              if (field === n.sse.event_field) ev = val;
              else if (field === n.sse.data_field) data.push(val);
            }
          }
        } catch (e) {
          why = closed ? codes.closed : (opened ? codes.offline : codes.timeout);
          if (!closed && e && e.name !== n.abort_error_name) why = codes.offline;
        } finally {
          clock.clearTimeout(openTimer);
          if (!closed) {
            log.warn(n.where_stream, n.word_down, { client, route, code: why, detail });
            on.down(why);
          }
        }
      })();
      return () => { closed = true; ctrl.abort(); };
    },
  };
}
