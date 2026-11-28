// 단위 시험 + 작은 통합 시험: 고정 파일 판(config_gateway.mode = static, 6-2). 다리 없이 같은 사이트의 고정 파일 자리에서 읽는다.
// ①~④ NetCore 단위(가짜 설정·가짜 fetch): 주소 꼴 · 비밀 머리 없음 · 없는 길은 묻지 않고 no_static · 다리 판은 그대로.
// ⑤~⑦ 통합: 시험 서버가 relay-data 꼴 파일(meta·stations, 지어낸 자료)을 정적으로 내어 줌 → NetCore → RelayBase → RelayStations 가 실제 fetch 로
//   충전소를 받아 냄 · 서버가 받은 머리에 비밀 머리가 없음 · 선 파일 없이도 뜸(lines_optional) · 서버가 죽으면 시작 실패(앱이 던지지 않음).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const clone = (o) => JSON.parse(JSON.stringify(o));

function rigCore(t, gw, withSecret) {
  const N = t.cfg('config_netcore');
  const files = { config_netcore: N, config_gateway: gw };
  if (withSecret) files.config_app_secret = { app_secret: 'unit-test-secret-value' };
  const cfg = { has: (n) => n in files, section: (n) => { if (!(n in files)) throw new Error(n); return files[n]; } };
  const calls = [];
  const logs = [];
  const fetch = async (url, init) => { calls.push({ url, headers: init.headers }); return { ok: true, status: 200, text: async () => '{"ok":true}' }; };
  const clock = { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h) => clearTimeout(h) };
  const log = { warn: (w, what, o) => logs.push([what, o]), info() {}, error() {} };
  return { N, cfg, calls, logs, fetch, clock, log };
}

function station(id, lat, lng) {
  return { id, name: '시험 충전소 ' + id, operator: '시험', maker: '시험', loc: [lat, lng], rest: false, indoor: false, chargers: [{ id: '01', type: 'fast', kw: 100 }] };
}

export default async function (t) {
  const { createNetCore, NetNotReady } = await t.src('netcore');
  const gwBase = t.cfg('config_gateway');
  const patch = JSON.parse(fs.readFileSync(path.join(t.app, 'variants', 'static.patch.json'), 'utf8'));
  const gwStatic = { ...clone(gwBase), ...patch.config_gateway };

  const a = rigCore(t, gwStatic, false);
  const core = createNetCore({ cfg: a.cfg, log: a.log, fetch: a.fetch, clock: a.clock });
  const r1 = await core.ask('relay', 'data', { sub: 'stations/43110.json' });
  const r1h = await core.ask('start', 'health', { sub: '' });
  t.check('①', '고정 파일 판 — 비밀 값 파일 없이도 준비됨 · 자료 길은 고정 자리 + 파일 이름, 상태 길은 meta.json', '준비됨 · ' + gwStatic.static_base + 'stations/43110.json · ' + gwStatic.static_base + 'meta.json', // 고정 자리는 판 패치 설정에서 읽음(박지 않음)
    (core.ready() ? '준비됨' : '안 됨') + ' · ' + a.calls.map((c) => c.url).join(' · '),
    core.ready() && r1.ok && r1h.ok && a.calls.length === 2 && a.calls[0].url === gwStatic.static_base + 'stations/43110.json' && a.calls[1].url === gwStatic.static_base + 'meta.json');
  t.check('②', '고정 파일 판 — 비밀 머리를 보내지 않음(머리 0)', '머리 0 · 0', a.calls.map((c) => Object.keys(c.headers).length).join(' · '), a.calls.every((c) => Object.keys(c.headers).length === 0));

  const before = a.calls.length;
  const rp = await core.ask('route', 'place', { sub: '?q=x' });
  const rr = await core.ask('route', 'route', { body: { a: 1 }, method: 'POST' });
  let down = null;
  core.stream('start', 'stream', { open() {}, event() {}, down: (c) => { down = c; } });
  await new Promise((r) => setTimeout(r, 5));
  t.check('③', '고정 파일 판 — 장소·길찾기·흐름 길은 묻지 않고 no_static(바깥 물음 0 · 앱이 던지지 않음)', 'no_static · no_static · no_static · 물음 0',
    [rp.code, rr.code, down, '물음 ' + (a.calls.length - before)].join(' · '), rp.ok === false && rp.code === a.N.codes.no_static && rr.code === a.N.codes.no_static && down === a.N.codes.no_static && a.calls.length === before);

  const g = rigCore(t, clone(gwBase), true);
  const gcore = createNetCore({ cfg: g.cfg, log: g.log, fetch: g.fetch, clock: g.clock });
  await gcore.ask('relay', 'data', { sub: 'meta.json' });
  const hdr = g.calls[0].headers[gwBase.secret_header];
  const g2 = rigCore(t, clone(gwBase), false);
  const gcore2 = createNetCore({ cfg: g2.cfg, log: g2.log, fetch: g2.fetch, clock: g2.clock });
  let thrown = null;
  try { await gcore2.ask('relay', 'data', { sub: 'meta.json' }); } catch (e) { thrown = e; }
  t.check('④', '다리 판은 그대로 — 주소 앞에 다리 주소 · 비밀 머리 보냄 · 비밀 값 없으면 아무것도 안 보내고 던짐', '다리 주소 · 머리 있음 · NetNotReady · 물음 0',
    (g.calls[0].url.startsWith(gwBase.gateway_url + gwBase.paths.data) ? '다리 주소' : g.calls[0].url) + ' · ' + (hdr ? '머리 있음' : '머리 없음') + ' · ' + (thrown instanceof NetNotReady ? 'NetNotReady' : String(thrown)) + ' · 물음 ' + g2.calls.length,
    g.calls[0].url.startsWith(gwBase.gateway_url + gwBase.paths.data) && hdr === 'unit-test-secret-value' && thrown instanceof NetNotReady && g2.calls.length === 0);

  // ---------- 통합: 시험 서버(relay-data 꼴, 지어낸 자료) ----------
  const RS0 = t.cfg('config_relay_stations');
  const zones = RS0.station_files.map((f) => f.replace(/^stations\//, '').replace(/\.json$/, ''));
  const served = {};
  served['/relay/meta.json'] = { v: 1, at: '20261128195811', ok: true, fresh: ['41', '43'], suspect: [], unknown: 0 };
  zones.forEach((z, i) => { served['/relay/stations/' + z + '.json'] = { v: 1, zscode: z, zcodes: [z.slice(0, 2)], stations: [station('TST' + z + 'A', 36.3 + i * 0.01, 127.4), station('TST' + z + 'B', 36.4 + i * 0.01, 127.5)] }; });
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, headers: req.headers });
    const body = served[req.url];
    res.writeHead(body ? 200 : 404, { 'content-type': body ? 'application/json' : 'text/html' });
    res.end(body ? JSON.stringify(body) : '<html>not found</html>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    const base = 'http://127.0.0.1:' + port + '/relay/';
    const rig = (b) => {
      const RS = { ...clone(RS0), ...patch.config_relay_stations };
      const files = { config_netcore: t.cfg('config_netcore'), config_gateway: { ...gwStatic, static_base: b }, config_relay_base: t.cfg('config_relay_base'), config_relay_parse: t.cfg('config_relay_parse'), config_relay_stations: RS, config_health: t.cfg('config_health') };
      const cfg = { has: (n) => n in files, section: (n) => files[n] };
      const subs = {};
      const pubs = [];
      const state = { claim: () => (n, v) => { pubs.push([n, v]); }, subscribe: (n, fn) => { (subs[n] = subs[n] || []).push(fn); }, fire: (n, v) => { for (const fn of subs[n] || []) fn(v); } };
      const logs = [];
      const log = { warn: (w, what, o) => logs.push([what, o]), info: (w, what, o) => logs.push([what, o]), error: (e) => logs.push(['error', String(e && e.message)]) };
      const clock = { now: () => Date.now(), setTimeout: (f, ms) => setTimeout(f, ms).unref(), clearTimeout: (h) => clearTimeout(h) };
      return { RS, HC: files.config_health, cfg, state, pubs, logs, log, clock, fetch: globalThis.fetch };
    };
    const tick = async (n) => { for (let i = 0; i < (n || 40); i += 1) await new Promise((r) => setTimeout(r, 25)); };
    const x = rig(base);
    const netcore = createNetCore(x);
    const { createRelayBase } = await t.src('relay_base');
    const parse = await t.src('relay_parse');
    const { createRelayStations } = await t.src('relay_stations');
    const rs = createRelayStations({ ...x, relay_base: createRelayBase({ ...x, netcore }), relay_parse: parse });
    x.state.fire(x.RS.app_piece, { stage: x.HC.stages.starting });
    await tick();
    const held = rs.held();
    const want = zones.length * 2;
    t.check('⑤', '통합 — 고정 파일 자리에서 meta·충전소 파일을 받아 충전소 목록이 뜸(지어낸 자료)', '충전소 ' + want + ' · 선 0 · 시작 결과 좋음 ' + Object.keys(x.RS.needs).length,
      held ? '충전소 ' + held.list.length + ' · 선 ' + held.lines.length + ' · 시작 결과 좋음 ' + x.pubs.filter((p) => p[0] === x.RS.start_piece && p[1].ok).length : '못 받음 ' + JSON.stringify(x.pubs.filter((p) => p[0] === x.RS.start_piece)),
      !!held && held.list.length === want && held.lines.length === 0 && x.pubs.filter((p) => p[0] === x.RS.start_piece && p[1].ok).length === Object.keys(x.RS.needs).length);
    const leaked = seen.filter((s) => s.headers[gwBase.secret_header.toLowerCase()] !== undefined).length;
    t.check('⑥', '통합 — 시험 서버가 받은 물음 ' + (1 + zones.length) + '개, 비밀 머리 0, 자료 주소는 고정 자리 아래만', '물음 ' + (1 + zones.length) + ' · 비밀 머리 0 · 고정 자리 밖 0',
      '물음 ' + seen.length + ' · 비밀 머리 ' + leaked + ' · 고정 자리 밖 ' + seen.filter((s) => !s.url.startsWith('/relay/')).length,
      seen.length === 1 + zones.length && leaked === 0 && seen.every((s) => s.url.startsWith('/relay/')));

    // 서버가 안 내어 주는 자리(404): 앱이 던지지 않고 시작 실패로 돌려준다
    const y = rig('http://127.0.0.1:' + port + '/nothing/');
    const netcore2 = createNetCore(y);
    const rs2 = createRelayStations({ ...y, relay_base: createRelayBase({ ...y, netcore: netcore2 }), relay_parse: parse });
    y.state.fire(y.RS.app_piece, { stage: y.HC.stages.starting });
    await tick(160); // 다시 받기(500ms+1000ms)를 다 쓸 때까지
    const fails = y.pubs.filter((p) => p[0] === y.RS.start_piece && p[1].ok === false);
    t.check('⑦', '통합 — 고정 자리에 자료가 없으면 던지지 않고 시작 실패(까닭 코드)로 알림 · 목록 없음', '시작 실패 1 · 목록 없음',
      '시작 실패 ' + fails.length + ' · ' + (rs2.held() ? '목록 있음' : '목록 없음') + ' · 까닭 ' + (fails[0] ? fails[0][1].code : '-'), fails.length === 1 && rs2.held() === null);
  } finally {
    server.close();
  }
}
