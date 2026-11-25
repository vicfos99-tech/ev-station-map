// OddButton('이상해' 단추 — 화면, 설계 5-1-나 ui_odd · 5-3 ③ · E9). 누른 순간의 State 조각(목록은 설정)을 **기록 하나(파일 하나)**로
// 폰의 데이터 폴더에 쌓고(Store.addRecord), 기록장에는 '몇 시에 누름, 파일 이름' 한 줄만 남긴다. 여기서 끝 — 올리기는 '기록' 칸의 단추(A6).
// 한 줄 메모는 안 써도 된다. 쓰면 FormCheck(규칙 config_formcheck.fields.odd_memo)로 길이·제어 문자를 보고, 틀리면 그 칸 아래 한 줄 + 기록장, 기록은 만들지 않는다.
// health.app '좋음'일 때만 보이고, health.odd 가 나쁘면(설정 틀림·저장 못 함) 단추를 흐리게. 네트워크로 아무것도 보내지 않는다.
export const NEEDS = ['cfg', 'log', 'state', 'store', 'doc', 'clock', 'timefmt', 'formcheck'];

export function createOddButton(deps) {
  const cfg = deps.cfg;
  const c = cfg.section('config_ui_odd');
  const t = cfg.section('config_time');
  const r = cfg.section('config_health');
  const b = cfg.section('config_build');
  const rule = cfg.section('config_formcheck').fields[c.memo_field];
  const log = deps.log;
  const doc = deps.doc;
  const clock = deps.clock;
  const x = c.texts;
  let busy = false;
  let seq = 0;
  const $ = (id) => {
    const el = doc.getElementById(id);
    if (!el) throw new Error(id);
    return el;
  };

  function note(text) {
    $(c.ids.note).textContent = text;
  }

  function snapshot() {
    const pieces = {};
    for (const name of c.pieces) pieces[name] = deps.state.get(name) === undefined ? null : deps.state.get(name);
    return pieces;
  }

  async function press() {
    if (busy) return;
    const now = clock.now();
    const memoIn = $(c.ids.memo).value;
    const m = deps.formcheck.field(memoIn === undefined || memoIn === null ? '' : memoIn, rule);
    if (!m.ok) {
      note((x.memo_bad[m.why] || x.memo_bad_default).split(c.max_mark).join(String(rule.max)));
      log.warn(c.where, c.word_memo_bad, { why: m.why, chars: typeof memoIn === 'string' ? [...memoIn].length : null });
      return;
    }
    busy = true;
    $(c.ids.button).disabled = true;
    try {
      seq += 1;
      const at = deps.timefmt.format(now, c.time_pattern, t);
      // 같은 초에 두 번 눌러도, 다시 켠 뒤 같은 초여도 이름이 겹치지 않게 밀리초 끝자리(ms_digits)와 켠 뒤 차례(seq)를 붙인다
      const name = c.file_pattern.split(c.time_mark).join(deps.timefmt.format(now, c.file_time_pattern, t))
        .split(c.ms_mark).join(String(now).slice(-c.ms_digits)).split(c.seq_mark).join(String(seq));
      const record = { kind: c.record_kind, at_ms: now, at, build: b.stamp, memo: m.value, pieces: snapshot() };
      const res = await deps.store.addRecord(c.record_kind, name, record);
      if (res.ok) {
        log.info(c.where, c.word_saved, { at, file: name });
        note(x.saved.split(c.time_mark).join(deps.timefmt.format(now, c.note_time_pattern, t)));
        $(c.ids.memo).value = '';
      } else {
        log.warn(c.where, c.word_save_failed, { at, file: name, why: res.why });
        note(x.save_failed);
      }
    } catch (e) {
      log.error(e, { where: c.where, params: { act: c.act_press } });
      note(x.save_failed);
    } finally {
      busy = false;
      $(c.ids.button).disabled = false;
    }
  }

  try {
    $(c.ids.button).textContent = x.button;
    $(c.ids.memo).setAttribute(c.placeholder_attr, x.memo_placeholder);
    $(c.ids.button).addEventListener(c.click_event, press);
  } catch (e) {
    log.error(e, { where: c.where, params: { act: c.act_init } });
  }

  deps.state.subscribe(c.app_piece, (v) => {
    if (!v || v.stage !== r.stages.good) return;
    try { $(c.ids.root).hidden = false; } catch (e) { log.error(e, { where: c.where, params: { act: c.act_init } }); }
  });
  deps.state.subscribe(c.health_piece, (v) => {
    try { $(c.ids.root).setAttribute(c.ok_attr, v && v.ok === false ? c.no_word : c.yes_word); } catch (e) { log.error(e, { where: c.where, params: { act: c.act_health } }); }
  });
  return { press };
}
