// 단위 시험: 아래 띠 단추 그림 글자(ui_bar — 11/26 묘성). 가짜 문서·창으로 — 몸에 꼴(narrow) · 단추마다 그림 글자 · 화면 읽기 글은 글로
// (이미 있는 단추는 그대로, 없는 단추는 지금 글, 글이 바뀌면 따라 고침) · 없는 단추는 경고 로그 · never 면 그림 글자 안 붙임.
function fakeDoc(ids) {
  const els = {};
  const mk = (id) => {
    const e = { id, attrs: {}, textContent: '', setAttribute(k, v) { e.attrs[k] = String(v); }, getAttribute(k) { return k in e.attrs ? e.attrs[k] : null; }, contains: (x) => x === e };
    return e;
  };
  for (const id of ids) els[id] = mk(id);
  return { els, body: mk('body'), getElementById: (id) => els[id] || null };
}
function fakeMO() {
  const all = [];
  class MO { constructor(fn) { this.fn = fn; this.targets = []; all.push(this); } observe(el, opts) { this.targets.push([el, opts]); } }
  MO.fire = (el) => { for (const m of all) if (m.targets.some((x) => x[0] === el)) m.fn([{ target: el }]); };
  return MO;
}

export default async function (t) {
  const { createBarGlyph } = await t.src('ui_bar');
  const B = t.cfg('config_ui_bar');
  // 단추 id 는 그 단추를 만드는 모듈의 설정에서(cfg·key) — 시험도 같은 설정을 읽음
  const secOf = (b0) => (n) => (n === 'config_ui_bar' ? b0 : t.cfg(n));
  const idOf = (b) => b.key.split(B.key_sep).reduce((v, k) => (v ? v[k] : undefined), t.cfg(b.cfg));
  const ids = B.buttons.map(idOf);
  t.check('⓪', '단추 id 를 모듈 설정에서 다 찾음(빠짐 0)', B.buttons.length + '개', ids.filter((x) => typeof x === 'string' && x).length + '개', ids.every((x) => typeof x === 'string' && x));
  const logs = [];
  const log = { info: (w, what, o) => logs.push(['info', what, o]), warn: (w, what, o) => logs.push(['warn', what, o]), error: (e) => logs.push(['error', String(e && e.message)]) };

  const doc = fakeDoc(ids);
  doc.els[ids[0]].textContent = '내 위치';
  doc.els[ids[2]].attrs[B.label_attr] = '제목 바꾸기 — 지금 충전소';
  doc.els[ids[2]].textContent = '충전소 ▾';
  const MO = fakeMO();
  createBarGlyph({ cfg: { section: secOf(B) }, log, doc, win: { MutationObserver: MO } });
  const glyphs = ids.map((id) => doc.els[id].attrs[B.glyph_attr]);
  t.check('①', '몸에 꼴 · 단추마다 설정의 그림 글자', B.mode_attr + '=' + B.mode + ' · ' + B.buttons.map((b) => b.glyph).join(''), B.mode_attr + '=' + doc.body.attrs[B.mode_attr] + ' · ' + glyphs.join(''),
    doc.body.attrs[B.mode_attr] === B.mode && glyphs.every((g, i) => g === B.buttons[i].glyph));
  t.check('②', '화면 읽기 글 — 없던 단추는 지금 글, 있던 단추(제목)는 그대로', '내 위치 · 제목 바꾸기 — 지금 충전소', doc.els[ids[0]].attrs[B.label_attr] + ' · ' + doc.els[ids[2]].attrs[B.label_attr],
    doc.els[ids[0]].attrs[B.label_attr] === '내 위치' && doc.els[ids[2]].attrs[B.label_attr] === '제목 바꾸기 — 지금 충전소');
  doc.els[ids[1]].textContent = '세 곳만 ✓';
  MO.fire(doc.els[ids[1]]);
  t.check('③', '단추 글이 바뀌면(세 곳만 ✓) 화면 읽기 글도 따라 바뀜', '세 곳만 ✓', doc.els[ids[1]].attrs[B.label_attr], doc.els[ids[1]].attrs[B.label_attr] === '세 곳만 ✓');

  const logs2 = [];
  const doc2 = fakeDoc(ids.slice(1));
  createBarGlyph({ cfg: { section: secOf(B) }, log: { info() {}, warn: (w, what, o) => logs2.push([what, o]), error() {} }, doc: doc2, win: {} });
  const miss = logs2.find((l) => l[0] === B.word_missing);
  t.check('④', '없는 단추(id) — 나머지는 붙이고 경고 로그에 그 id', '경고 ' + ids[0], miss ? '경고 ' + miss[1].ids.join(',') : '경고 없음', !!miss && miss[1].ids.length === 1 && miss[1].ids[0] === ids[0] && doc2.els[ids[1]].attrs[B.glyph_attr] === B.buttons[1].glyph);

  const doc3 = fakeDoc(ids);
  createBarGlyph({ cfg: { section: secOf({ ...B, mode: B.modes.never }) }, log, doc: doc3, win: {} });
  t.check('⑤', '꼴 never — 그림 글자를 붙이지 않음(늘 글)', '몸 never · 붙인 것 0', '몸 ' + doc3.body.attrs[B.mode_attr] + ' · 붙인 것 ' + ids.filter((id) => doc3.els[id].attrs[B.glyph_attr]).length,
    doc3.body.attrs[B.mode_attr] === B.modes.never && ids.every((id) => !doc3.els[id].attrs[B.glyph_attr]));

  // 모양 파일: 좁은 창 문턱이 운전 화면(style_ui_drive)의 좁은 창 문턱과 같고, 그림 글자 단추는 48px · 숨긴 단추는 안 건드림
  const fs = await import('node:fs');
  const path = await import('node:path');
  const css = fs.readFileSync(path.join(t.app, 'src', 'style_ui_bar.css'), 'utf8');
  const drive = fs.readFileSync(path.join(t.app, 'src', 'style_ui_drive.css'), 'utf8');
  const mq = (s) => (s.match(/@media \(max-width: (\d+)px\)/) || [])[1];
  t.check('⑥', '모양 — 좁은 창 문턱 = 운전 화면 문턱 · 48px · [hidden] 제외 · 꼴 이름 = 설정', '문턱 ' + mq(drive) + ' · 48px · :not([hidden]) · narrow/always',
    '문턱 ' + mq(css) + ' · ' + (css.includes('width: 48px') ? '48px' : '없음') + ' · ' + (css.includes(':not([hidden])') ? ':not([hidden])' : '없음') + ' · ' + [B.modes.narrow, B.modes.always].filter((m) => css.includes('"' + m + '"')).join('/'),
    mq(css) && mq(css) === mq(drive) && css.includes('width: 48px') && css.includes(':not([hidden])') && css.includes('[' + B.mode_attr + '="' + B.modes.narrow + '"]') && css.includes('[' + B.mode_attr + '="' + B.modes.always + '"]') && css.includes('attr(' + B.glyph_attr + ')'));
}
