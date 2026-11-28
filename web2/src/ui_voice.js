// VoiceButton(음성 검색 단추 — 화면, 묘성 11/26 추가5). 글을 넣는 칸 옆에 마이크 단추를 꽂는다 — 누르면 브라우저 음성 인식(Web Speech API)이 듣고,
// 글자를 그 칸에 넣은 뒤 그 칸의 찾기 단추를 눌러 바로 찾는다(운전 중 손을 안 쓰려고). 다시 누르면 듣기를 멈춘다.
// 어느 칸에 꽂을지는 설정 targets(다른 화면의 설정에서 id 를 읽음 — 한 곳에 둠: 나중에 화장실 찾기 등도 한 줄만 더하면 같은 단추).
// 지원 안 되는 브라우저면 단추를 만들지 않고 기록장 한 줄. 듣는 중·못 알아들음·권한 없음은 그 칸의 알림 줄에 한 줄. 듣는 시간 한도는 listen_ms.
// 소리 처리는 브라우저가 한다(크롬은 소리를 구글 서버로 보내 글자로 받음 — 앱은 글자만 받음). 이 모듈은 검색 칸의 일을 대신 하지 않는다(찾기 단추만 누름).
export const NEEDS = ['cfg', 'log', 'doc', 'win', 'clock'];

export function createVoiceButton(deps) {
  const c = deps.cfg.section('config_ui_voice');
  const log = deps.log;
  const doc = deps.doc;
  const win = deps.win;
  const clock = deps.clock;
  const x = c.texts;
  const stats = { started: 0, results: 0, empty: 0, errors: 0, timeouts: 0 };
  const buttons = [];

  function Api() {
    if (!win) return null;
    for (const n of c.api_names) if (typeof win[n] === 'function') return win[n];
    return null;
  }

  function idOf(cfgName, key) {
    let v = deps.cfg.section(cfgName);
    for (const k of String(key).split(c.key_sep)) v = v && typeof v === 'object' ? v[k] : undefined;
    return typeof v === 'string' && v ? v : null;
  }

  function attach(t, Rec) {
    const input = doc.getElementById(idOf(t.cfg, t.input_key));
    const go = doc.getElementById(idOf(t.cfg, t.go_key));
    const noteId = t.note_key ? idOf(t.cfg, t.note_key) : null;
    const note = noteId ? doc.getElementById(noteId) : null;
    if (!input || !go || !go.parentNode) { log.warn(c.where, c.words.missing, { target: t.cfg }); return; }
    const btn = doc.createElement(c.tags.button);
    btn.className = c.classes.button;
    btn.setAttribute(c.attrs.type, c.button_type);
    btn.textContent = x.glyph;
    btn.setAttribute(c.attrs.label, x.label);
    btn.setAttribute(c.attrs.state, c.states.idle);
    btn.setAttribute(c.attrs.pressed, 'false');
    let rec = null;
    let timer = null;
    let got = false;
    let failed = false;

    const say = (text) => { if (note) note.textContent = text; };
    const ui = (listening) => {
      btn.setAttribute(c.attrs.state, listening ? c.states.listening : c.states.idle);
      btn.setAttribute(c.attrs.pressed, listening ? 'true' : 'false');
      btn.setAttribute(c.attrs.label, listening ? x.label_stop : x.label);
    };
    const clearTimer = () => { if (timer !== null) { clock.clearTimeout(timer); timer = null; } };

    function finish() {
      clearTimer();
      rec = null;
      ui(false);
      if (!got && !failed) say(x.nomatch);
    }

    function start() {
      try {
        got = false;
        failed = false;
        const r = new Rec();
        r.lang = c.lang;
        r.continuous = false;
        r.interimResults = false;
        r.maxAlternatives = c.max_alternatives;
        r[c.events.result] = (ev) => {
          try {
            const first = ev && ev.results && ev.results[0] && ev.results[0][0];
            const text = first && typeof first.transcript === 'string' ? first.transcript.trim() : '';
            if (!text) { stats.empty += 1; log.info(c.where, c.words.empty, {}); return; }
            got = true;
            stats.results += 1;
            log.info(c.where, c.words.result, { chars: [...text].length });
            input.value = text;
            say('');
            go.click();
          } catch (e) { log.error(e, { where: c.where, params: { act: c.act_result } }); }
        };
        r[c.events.error] = (ev) => {
          failed = true;
          stats.errors += 1;
          const code = ev && ev.error;
          log.warn(c.where, c.words.error, { code, message: ev && ev.message });
          say(c.denied_codes.includes(code) ? x.denied : (x.error[code] || x.error_default));
        };
        r[c.events.end] = () => { log.info(c.where, c.words.end, { got }); finish(); };
        rec = r;
        r.start();
        stats.started += 1;
        ui(true);
        say(x.listening);
        log.info(c.where, c.words.start, { lang: c.lang });
        timer = clock.setTimeout(() => {
          timer = null;
          stats.timeouts += 1;
          log.info(c.where, c.words.timeout, { ms: c.listen_ms });
          if (rec && typeof rec.stop === 'function') rec.stop();
        }, c.listen_ms);
      } catch (e) {
        rec = null;
        clearTimer();
        ui(false);
        say(x.start_fail);
        log.error(e, { where: c.where, params: { act: c.act_start } });
      }
    }

    btn.addEventListener(c.click_event, () => {
      if (rec) { if (typeof rec.stop === 'function') rec.stop(); return; }
      start();
    });
    go.parentNode.insertBefore(btn, go);
    buttons.push({ btn, stop: () => { if (rec && typeof rec.stop === 'function') rec.stop(); } });
  }

  try {
    if (!c.on) {
      log.info(c.where, c.words.off, {});
    } else {
      const Rec = Api();
      if (!Rec) {
        log.info(c.where, c.words.unsupported, {});
      } else {
        for (const t of c.targets) attach(t, Rec);
        log.info(c.where, c.words.ready, { lang: c.lang, n: buttons.length });
      }
    }
  } catch (e) {
    log.error(e, { where: c.where, params: { act: c.act_init } });
  }

  return { stats: () => ({ ...stats }), count: () => buttons.length, buttons: () => buttons.map((b) => b.btn) };
}
