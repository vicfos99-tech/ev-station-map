// 단위 시험: 시험 서버의 '남은 화면 물음 막기'(strayGuard — 정비 나 0-①)와 한도 기다림(raceLimit — 0-③).
// 갈림길 양쪽: 보통 시험(틀린 비밀 값은 다리로 안 넘김) / 일부러 틀린 값을 다리까지 보내는 시험(pass_wrong — 다 넘김).
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function fakeRes() {
  const r = { status: null, body: null, writeHead(s) { r.status = s; }, end(b) { r.body = b; } };
  return r;
}

export default async function (t) {
  const { strayGuard, raceLimit } = await import(pathToFileURL(path.join(t.tools, 'lib_testbed.mjs')).href);
  const H = 'X-Test-Secret';
  const info = { b: { secret_header: H } };
  const lines = [];
  const log = { write: (what, o) => lines.push([what, o]) };
  const key = H.toLowerCase();

  const g = strayGuard(t.tc, info, 'now', log);
  const r1 = fakeRes();
  const same = g.take({ url: '/v1/health', headers: { [key]: 'now' } }, r1);
  t.check('①', '이번 비밀 값 물음 → 다리로 넘김', '안 막음', same ? '막음' : '안 막음', !same && r1.status === null);
  const r2 = fakeRes();
  const none = g.take({ url: '/v1/stream', headers: {} }, r2);
  t.check('②', '비밀 값 머리 없는 물음(stream·scene) → 그대로 넘김', '안 막음', none ? '막음' : '안 막음', !none);
  const r3 = fakeRes();
  const old = g.take({ url: '/v1/health', headers: { [key]: 'old', 'user-agent': 'Edg/158', referer: 'http://127.0.0.1:5173/' } }, r3);
  t.check('③', '옛 비밀 값(남은 탭) → 다리로 안 넘기고 잠금 답', '막음 · ' + t.tc.testbed.lock_status, (old ? '막음' : '안 막음') + ' · ' + r3.status, old && r3.status === t.tc.testbed.lock_status && r3.body === JSON.stringify(t.tc.testbed.lock_body));
  g.take({ url: '/v1/data/x', headers: { [key]: 'old' } }, fakeRes());
  t.check('④', '기록장엔 처음 하나만(보낸 쪽·Referer 와 함께), 막은 수는 셈', '기록 1 · 수 2 · Referer 있음', '기록 ' + lines.length + ' · 수 ' + g.count() + ' · Referer ' + (lines[0] && lines[0][1].referer ? '있음' : '없음'), lines.length === 1 && g.count() === 2 && lines[0][1].referer);

  const p = strayGuard(t.tc, info, 'now', log, { pass_wrong: true });
  const r5 = fakeRes();
  const passed = p.take({ url: '/v1/health', headers: { [key]: 'wrong' } }, r5);
  t.check('⑤', '갈림길: 일부러 틀린 값을 다리까지 보내는 시험(pass_wrong) → 넘김', '안 막음 · 수 0', (passed ? '막음' : '안 막음') + ' · 수 ' + p.count(), !passed && p.count() === 0);

  const t0 = Date.now();
  const fast = await raceLimit(Promise.resolve('끝'), 60000, 'timeout');
  t.check('⑥', '먼저 끝나면 그 값(한도 타이머는 지움 — 이 시험이 60초 안 기다리고 끝나는 것으로 봄)', '끝 · 1초 안', fast + ' · ' + (Date.now() - t0) + 'ms', fast === '끝' && Date.now() - t0 < 1000);
  const slow = await raceLimit(new Promise(() => {}), 20, 'timeout');
  t.check('⑦', '한도를 넘기면 한도 값', 'timeout', slow, slow === 'timeout');

  // (2026-11-27) 제한 속도 실제 출처 — limit_source.json use_scenes 장면은 뽑은 표, 그 밖은 장면의 손으로 쓴 값 그대로
  const { testbedInfo, limitFiles } = await import(pathToFileURL(path.join(t.tools, 'lib_testbed.mjs')).href);
  const fs = await import('node:fs');
  const tb = testbedInfo(t.tc, t.app);
  const LS = JSON.parse(fs.readFileSync(path.join(tb.dir, t.tc.testbed.limit_shim.real_source), 'utf8'));
  const RL = t.cfg('config_relay_limit');
  const L = t.cfg('config_relay_parse').limit;
  const sceneOf = (n) => JSON.parse(fs.readFileSync(path.join(path.resolve(path.dirname(tb.cfgPath), tb.tb.scenes.dir), n + t.tc.build.config_ext), 'utf8'));
  const realScene = LS.use_scenes[0];
  const realLine = sceneOf(realScene).route.legs.find((g) => g.kind === 'line').line;
  const table = JSON.parse(fs.readFileSync(path.resolve(path.dirname(path.join(tb.dir, t.tc.testbed.limit_shim.real_source)), LS.lines[realLine].table), 'utf8'));
  const K = LS.table;
  const want = table[K.sections_key].filter((s) => s[K.fwd_key] !== null || s[K.back_key] !== null);
  const r = limitFiles(t.tc, tb, realScene);
  const hw = JSON.parse(r.files[RL.highway_file]);
  const got = hw[L.sections_key];
  const vals = [...new Set(got.map((s) => s[L.fwd_key]))].sort();
  const realSame = got.length === want.length && got.every((s, i) => s[L.line_key] === realLine && s[L.from_key] === want[i][K.from_key] && s[L.to_key] === want[i][K.to_key] && s[L.fwd_key] === want[i][K.fwd_key] && s[L.back_key] === want[i][K.back_key]);
  t.check('⑧', '실제 출처 장면(' + realScene + ') — 고속도로 표 = 뽑은 표(' + LS.source + ')의 값 있는 구간 그대로 · 0 없음 · 손으로 쓴 그 선 값은 안 씀',
    '구간 ' + want.length + ' · 같음 · 선 ' + realLine + ' · 0 없음', '구간 ' + got.length + ' · ' + (realSame ? '같음' : '다름') + ' · 값 ' + JSON.stringify(vals) + ' · 출처 ' + r.realSource,
    realSame && !vals.includes(0) && r.realSource === LS.source);

  const oldScene = 'S2_제한속도';
  const o = limitFiles(t.tc, tb, oldScene);
  const oh = JSON.parse(o.files[RL.highway_file])[L.sections_key];
  const ow = sceneOf(oldScene).limits.filter((x) => x.limit_kmh !== null);
  const osame = oh.length === ow.length && oh.every((s, i) => s[L.from_key] === ow[i].from_km && s[L.to_key] === ow[i].to_km && s[L.fwd_key] === ow[i].limit_kmh);
  t.check('⑨', '옛 장면(' + oldScene + ', use_scenes 밖) — 장면의 손으로 쓴 limits 그대로(실제 출처 안 씀)', '구간 ' + ow.length + ' · 같음 · 실제 출처 없음',
    '구간 ' + oh.length + ' · ' + (osame ? '같음' : '다름') + ' · 실제 출처 ' + o.realSource, osame && o.realSource === null && o.realLines.length === 0);
}
