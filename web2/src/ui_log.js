// LogScreen(기록 칸 — 화면). 맨 위에 판(빌드 기록), 로그 보기·복사·한 파일로 내려받기(설계 5-1-나 ui_log).
// Logger 의 읽기 함수만 쓴다. 운전 화면과 같이 health.app 이 '좋음'일 때만 단추가 보인다.
// (A6 — 설계 E9) '이상해' 기록 목록과 올림 여부 + **'기록 올리기'** 단추: 누르면 odd.upload.request 를 한 번 낸다(올리기는 RouteClient 의 일).
//   기록마다 온 odd.result 로 그 줄에 '올라감 / 안 올라감(까닭)'. 안 올라간 것은 다음에 누를 때 다시 간다(저절로는 안 감). 누르기 전엔 아무것도 나가지 않는다.
//   목록·'올린 목록'은 Store 로 읽기만 한다('올린 목록'을 쓰는 모듈은 RouteClient 하나). health.upload 가 나쁘면(집 PC 길 끊김) 단추를 흐리게.
export const NEEDS = ['cfg', 'log', 'state', 'store', 'doc', 'win'];

export function createLogScreen(deps) {
  const cfg = deps.cfg;
  const c = cfg.section('config_ui_log');
  const b = cfg.section('config_build');
  const r = cfg.section('config_health');
  const u = c.upload;
  const ut = u.texts;
  const log = deps.log;
  const doc = deps.doc;
  const win = deps.win;
  const x = c.texts;
  const pub = deps.state.claim(c.owner, [u.request_piece]);
  const results = {};
  let upSeq = 0;
  let curSeq = null;
  let usable = true;
  let presses = 0;
  const $ = (id) => {
    const el = doc.getElementById(id);
    if (!el) throw new Error(id);
    return el;
  };

  function fill(tpl, vals) {
    return tpl.replace(new RegExp(u.slot_re, 'g'), (m, k) => (vals[k] === undefined || vals[k] === null ? '' : String(vals[k])));
  }

  function make(tag, cls, text) {
    const e = doc.createElement(tag);
    e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function show() {
    const lines = log.lines();
    $(c.list_id).textContent = lines.slice(Math.max(0, lines.length - c.show_lines)).join('\n');
  }

  function upNote(text) {
    $(u.ids.note).textContent = text;
  }

  function whyText(code) {
    return ut.why[code] || ut.why_default.split(u.code_mark).join(String(code));
  }

  // 기록 목록(새것부터 show_max 줄): 이름 · 올라감 / 안 올라감(까닭) / 아직 안 올림
  async function showOdd() {
    try {
      const list = await deps.store.listRecords(u.kind);
      const had = await deps.store.read(u.sent_key);
      const names = list.ok ? list.names : [];
      const sent = new Set(had.ok && Array.isArray(had.value) ? had.value : []);
      const count = { sent: 0, left: 0 };
      const rows = [];
      for (const name of names) {
        const res = results[name];
        const ok = sent.has(name) || (res && res.ok);
        if (ok) count.sent += 1; else count.left += 1;
        rows.push({ name, state: ok ? u.state_words.sent : (res ? u.state_words.failed : u.state_words.left), res });
      }
      const shown = rows.slice(-u.show_max).reverse().map((row) => {
        const line = make(u.tags.row, u.classes.row);
        line.setAttribute(u.attrs.name, row.name);
        line.appendChild(make(u.tags.part, u.classes.name, row.name));
        const st = row.state === u.state_words.sent ? ut.row_sent : (row.state === u.state_words.failed ? fill(ut.row_failed, { why: whyText(row.res.code) }) : ut.row_left);
        const s = make(u.tags.part, u.classes.state, st);
        s.setAttribute(u.attrs.state, row.state);
        line.appendChild(s);
        return line;
      });
      $(u.ids.list).replaceChildren(...shown);
      $(u.ids.sum).textContent = list.ok ? fill(ut.sum, { n: names.length, sent: count.sent, left: count.left }) : ut.read_fail;
    } catch (e) {
      log.error(e, { where: c.where, params: { act: u.act_list } });
    }
  }

  function pressUpload() {
    try {
      if (!usable) { upNote(ut.unusable); return; }
      upSeq += 1;
      curSeq = upSeq;
      presses += 1;
      upNote(ut.asking);
      log.info(c.where, u.word_press, { seq: upSeq });
      pub(u.request_piece, { seq: upSeq });
    } catch (e) {
      log.error(e, { where: c.where, params: { act: u.act_upload } });
    }
  }

  function onResult(v) {
    if (!v) return;
    const S = u.stages;
    if (v.stage === S.busy) { upNote(ut.busy); return; }
    if (v.seq !== curSeq) return;
    if (v.stage === S.start) upNote(v.total ? fill(ut.start, { n: v.total }) : ut.nothing);
    else if (v.stage === S.one) {
      results[v.name] = { ok: !!v.ok, code: v.code || null };
      showOdd();
    } else if (v.stage === S.done) {
      if (v.sent || v.failed || v.stopped) upNote(fill(ut.done, { sent: v.sent, failed: v.failed + v.stopped }));
      showOdd();
    } else if (v.stage === S.fail) upNote(fill(ut.fail, { why: whyText(v.code) }));
  }

  async function copy() {
    try {
      await win.navigator.clipboard.writeText(await log.readAll());
      $(c.note_id).textContent = x.copied;
    } catch (e) {
      log.error(e, { where: c.where, params: { act: c.act_copy } });
      $(c.note_id).textContent = x.copy_fail;
    }
  }

  async function save() {
    try {
      const blob = new win.Blob([await log.readAll()], { type: c.mime });
      const a = doc.createElement(c.link_tag);
      a.href = win.URL.createObjectURL(blob);
      a.download = log.downloadName();
      a.click();
      win.URL.revokeObjectURL(a.href);
    } catch (e) {
      log.error(e, { where: c.where, params: { act: c.act_save } });
    }
  }

  try {
    $(c.open_id).textContent = x.open;
    $(c.copy_id).textContent = x.copy;
    $(c.save_id).textContent = x.save;
    $(c.close_id).textContent = x.close;
    $(c.version_id).textContent = x.version.split(c.stamp_mark).join(b.stamp);
    $(u.ids.button).textContent = ut.button;
    $(c.open_id).addEventListener(c.click_event, () => { $(c.panel_id).hidden = false; show(); showOdd(); });
    $(c.close_id).addEventListener(c.click_event, () => { $(c.panel_id).hidden = true; });
    $(c.copy_id).addEventListener(c.click_event, copy);
    $(c.save_id).addEventListener(c.click_event, save);
    $(u.ids.button).addEventListener(c.click_event, pressUpload);
  } catch (e) {
    log.error(e, { where: c.where, params: { act: c.act_init } });
  }

  deps.state.subscribe(c.app_piece, (v) => {
    if (!v || v.stage !== r.stages.good) return;
    try { $(c.open_id).hidden = false; } catch (e) { log.error(e, { where: c.where, params: { act: c.act_init } }); }
  });
  deps.state.subscribe(u.result_piece, (v) => { try { onResult(v); } catch (e) { log.error(e, { where: c.where, params: { act: u.act_result } }); } });
  deps.state.subscribe(u.health_piece, (v) => {
    usable = !(v && v.ok === false);
    try {
      $(u.ids.root).setAttribute(u.ok_attr, usable ? u.yes_word : u.no_word);
      $(u.ids.button).disabled = !usable;
    } catch (e) { log.error(e, { where: c.where, params: { act: u.act_health } }); }
  });
  return { show, showOdd, pressUpload, presses: () => presses, results: () => ({ ...results }) };
}
