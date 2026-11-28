// 단위 시험: 음성 검색 단추(ui_voice — 추가5). 가짜 문서·가짜 음성 인식 객체로 —
// ① 지원하면 찾기 단추 앞에 단추(48px 글자·화면 읽기 글) ② 지원 안 하면 단추 없음 + 기록장 한 줄 ③ 누르면 듣기(언어·상태 표시) → 결과 글을 칸에 넣고 찾기 단추를 누름
// ④ 마이크 권한 거절 → 안내 한 줄·찾기 안 누름 ⑤ 못 알아들음(빈 결과·말소리 없음) 한 줄 ⑥ 듣는 시간 한도 넘으면 멈춤 ⑦ 듣는 중 다시 누르면 멈춤 ⑧ 끔(on 거짓) ⑨ 시작이 던지면 안내.
function rig(t, opts) {
  const V = { ...t.cfg('config_ui_voice'), ...(opts.over || {}) };
  const N = t.cfg('config_ui_navi');
  const els = {};
  const mk = (id) => {
    const e = { id, value: '', textContent: '', attrs: {}, on: {}, clicks: 0, parentNode: null, className: '',
      setAttribute(k, v) { e.attrs[k] = v; }, getAttribute(k) { return e.attrs[k]; },
      addEventListener(ev, f) { e.on[ev] = f; }, click() { e.clicks += 1; } };
    els[id] = e;
    return e;
  };
  const input = mk(N.ids.q);
  const go = mk(N.ids.go);
  const note = mk(N.ids.note);
  const bar = { kids: [go], insertBefore(n, ref) { bar.kids.splice(bar.kids.indexOf(ref), 0, n); n.parentNode = bar; } };
  go.parentNode = bar;
  const doc = { getElementById: (id) => els[id] || null, createElement: () => mk('voice_' + Object.keys(els).length) };
  const recs = [];
  class Rec {
    constructor() { recs.push(this); this.started = 0; this.stopped = 0; if (opts.startThrows) this.start = () => { throw new Error('boom'); }; }
    start() { this.started += 1; }
    stop() { this.stopped += 1; if (this.onend) this.onend(); }
  }
  const win = opts.none ? {} : { [opts.api || V.api_names[0]]: Rec };
  const timers = [];
  const clock = { setTimeout: (f, ms) => { timers.push({ f, ms, live: true }); return timers.length - 1; }, clearTimeout: (i) => { if (timers[i]) timers[i].live = false; } };
  const logs = [];
  const log = { info: (w, what, o) => logs.push(['info', what, o]), warn: (w, what, o) => logs.push(['warn', what, o]), error: (e) => logs.push(['error', String(e && e.message)]) };
  const cfg = { section: (n) => (n === 'config_ui_voice' ? V : n === 'config_ui_navi' ? N : null) };
  return { V, N, input, go, note, bar, doc, win, clock, timers, log, logs, recs, cfg };
}
const has = (r, what) => r.logs.filter((l) => l[1] === what).length;

export default async function (t) {
  const { createVoiceButton } = await t.src('ui_voice');

  const a = rig(t, {});
  const va = createVoiceButton(a);
  const btn = a.bar.kids[0];
  t.check('①', '지원하면 찾기 단추 바로 앞에 마이크 단추 — 화면 읽기 글(' + a.V.texts.label + ')·처음 상태 idle · 준비 로그', '단추 1 · 찾기 단추 앞 · 읽기 글 · idle',
    'n ' + va.count() + ' · 순서 ' + (a.bar.kids[1] === a.go) + ' · ' + btn.attrs[a.V.attrs.label] + ' · ' + btn.attrs[a.V.attrs.state] + ' · 준비 ' + has(a, a.V.words.ready),
    va.count() === 1 && a.bar.kids[0] !== a.go && a.bar.kids[1] === a.go && btn.attrs[a.V.attrs.label] === a.V.texts.label && btn.attrs[a.V.attrs.state] === a.V.states.idle && has(a, a.V.words.ready) === 1);

  btn.on[a.V.click_event]();
  const r0 = a.recs[0];
  t.check('②', '누르면 듣기 시작 — 언어 ' + a.V.lang + ' · 한 번만 듣기 · listening 표시 · 알림 줄 \'듣는 중\' · 한도 타이머 ' + a.V.listen_ms + 'ms',
    '언어 · continuous 거짓 · listening · 듣는 중 문구 · 타이머',
    r0.lang + ' · ' + r0.continuous + ' · ' + btn.attrs[a.V.attrs.state] + ' · ' + a.note.textContent + ' · ' + (a.timers[0] || {}).ms,
    r0.lang === a.V.lang && r0.continuous === false && r0.started === 1 && btn.attrs[a.V.attrs.state] === a.V.states.listening && a.note.textContent === a.V.texts.listening && a.timers[0].ms === a.V.listen_ms);

  r0.onresult({ results: [[{ transcript: '  수원 신갈  ' }]] });
  r0.onend();
  t.check('③', '결과 글 → 칸에 넣고(앞뒤 공백 뺌) 찾기 단추를 한 번 누름 · 끝나면 idle · 알림 줄 비움 · 타이머 해제',
    '칸 \'수원 신갈\' · 찾기 1회 · idle · 알림 비움 · 타이머 해제',
    '\'' + a.input.value + '\' · ' + a.go.clicks + ' · ' + btn.attrs[a.V.attrs.state] + ' · \'' + a.note.textContent + '\' · ' + a.timers[0].live,
    a.input.value === '수원 신갈' && a.go.clicks === 1 && btn.attrs[a.V.attrs.state] === a.V.states.idle && a.note.textContent === '' && a.timers[0].live === false);

  // 권한 거절
  btn.on[a.V.click_event]();
  const r1 = a.recs[1];
  r1.onerror({ error: 'not-allowed', message: 'Permission denied' });
  r1.onend();
  const dl = a.logs.find((l) => l[1] === a.V.words.error) || [];
  t.check('④', '마이크 권한 거절(not-allowed) — 안내 한 줄 · 찾기 안 누름 · 로그에 코드·문구 그대로', '안내 문구 · 찾기 1회 그대로 · 코드 not-allowed',
    a.note.textContent + ' · ' + a.go.clicks + ' · ' + JSON.stringify(dl[2]),
    a.note.textContent === a.V.texts.denied && a.go.clicks === 1 && dl[2] && dl[2].code === 'not-allowed' && dl[2].message === 'Permission denied' && btn.attrs[a.V.attrs.state] === a.V.states.idle);

  // 못 알아들음: 빈 결과 → 끝
  btn.on[a.V.click_event]();
  const r2 = a.recs[2];
  r2.onresult({ results: [[{ transcript: '   ' }]] });
  r2.onend();
  const nomatchOk = a.note.textContent === a.V.texts.nomatch && a.go.clicks === 1;
  btn.on[a.V.click_event]();
  const r3 = a.recs[3];
  r3.onerror({ error: 'no-speech' });
  r3.onend();
  t.check('⑤', '못 알아들음 — 빈 결과면 \'못 알아들었어요\' · 말소리 없음(no-speech)이면 그 코드의 문구 · 찾기 안 누름', '문구 둘 · 찾기 1회 그대로',
    a.note.textContent + ' · ' + a.go.clicks, nomatchOk && a.note.textContent === a.V.texts.error['no-speech'] && a.go.clicks === 1);

  // 시간 한도
  btn.on[a.V.click_event]();
  const r4 = a.recs[4];
  const tm = a.timers[a.timers.length - 1];
  tm.f();
  t.check('⑥', '듣는 시간 한도가 지나면 멈춤(stop) — 못 알아들었어요 · idle · 한도 로그', '멈춤 1 · nomatch · idle · 로그 1',
    r4.stopped + ' · ' + a.note.textContent + ' · ' + btn.attrs[a.V.attrs.state] + ' · ' + has(a, a.V.words.timeout),
    r4.stopped === 1 && a.note.textContent === a.V.texts.nomatch && btn.attrs[a.V.attrs.state] === a.V.states.idle && has(a, a.V.words.timeout) === 1);

  // 듣는 중 다시 누르면 멈춤
  btn.on[a.V.click_event]();
  const r5 = a.recs[5];
  btn.on[a.V.click_event]();
  t.check('⑦', '듣는 중 다시 누르면 듣기를 멈춤(새로 시작 안 함)', '멈춤 1 · 인식 객체 6개', r5.stopped + ' · ' + a.recs.length, r5.stopped === 1 && a.recs.length === 6);

  // 미지원
  const b = rig(t, { none: true });
  const vb = createVoiceButton(b);
  t.check('⑧', '지원 안 하는 브라우저 — 단추를 만들지 않음(찾기 단추만) · 기록장 한 줄', '단추 0 · 줄 1 · 로그 ' + b.V.words.unsupported,
    vb.count() + ' · ' + b.bar.kids.length + ' · ' + has(b, b.V.words.unsupported), vb.count() === 0 && b.bar.kids.length === 1 && has(b, b.V.words.unsupported) === 1);

  // 접두어 이름(webkit)도 지원
  const w = rig(t, { api: 'webkitSpeechRecognition' });
  t.check('⑨', 'webkitSpeechRecognition 이름만 있어도 지원(설정 api_names 목록)', '단추 1', String(createVoiceButton(w).count()), w.bar.kids.length === 2);

  // 끔
  const d = rig(t, { over: { on: false } });
  const vd = createVoiceButton(d);
  t.check('⑩', '끔(on 거짓) — 단추 없음 · 끔 로그', '단추 0 · 로그 1', vd.count() + ' · ' + has(d, d.V.words.off), vd.count() === 0 && has(d, d.V.words.off) === 1);

  // 시작이 던짐
  const e = rig(t, { startThrows: true });
  createVoiceButton(e);
  e.bar.kids[0].on[e.V.click_event]();
  t.check('⑪', '시작이 던지면(이미 듣는 중 등) — 안내 한 줄 · idle · 오류 로그 · 던지지 않음', '안내 · idle · 오류 1',
    e.note.textContent + ' · ' + e.bar.kids[0].attrs[e.V.attrs.state] + ' · ' + e.logs.filter((l) => l[0] === 'error').length,
    e.note.textContent === e.V.texts.start_fail && e.bar.kids[0].attrs[e.V.attrs.state] === e.V.states.idle && e.logs.filter((l) => l[0] === 'error').length === 1);

  // 칸이 없으면 단추 없이 경고(앱은 계속)
  const f = rig(t, {});
  delete f.doc.getElementById;
  f.doc.getElementById = () => null;
  const vf = createVoiceButton(f);
  t.check('⑫', '검색 칸이 문서에 없으면 — 단추 없이 경고 한 줄(앱은 계속)', '단추 0 · 경고 1', vf.count() + ' · ' + has(f, f.V.words.missing), vf.count() === 0 && has(f, f.V.words.missing) === 1);
}
