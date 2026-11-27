// 단위 시험: 속도판(ui_speed) 제한 속도 표지판(2026-11-27). 가짜 문서로 — 표지판 모양 값이 설정에서 CSS 변수로 들어가는지(판마다 한 번),
// 값이 있으면 숫자 + 칸 shown, 없으면 글 비움 + 칸 blank(표지판 숨김은 CSS 가 이 칸으로) · '0'·짐작 값 없음, 넘음·위험은 판단 칸 그대로.
function fakeDoc(ids) {
  const els = {};
  for (const id of ids) {
    const e = { textContent: '', attrs: {}, clientWidth: 0, props: {}, sets: 0,
      setAttribute(k, v) { e.attrs[k] = String(v); }, getAttribute(k) { return e.attrs[k]; } };
    e.style = { setProperty(k, v) { e.props[k] = v; e.sets += 1; } };
    els[id] = e;
  }
  return { els, getElementById: (id) => els[id] || null };
}

export default async function (t) {
  const { create } = await t.src('ui_speed');
  const C = t.cfg('config_ui_speed');
  const J = t.cfg('config_speed').judge_words;
  const doc = fakeDoc(Object.values(C.ids));
  const board = create({ cfg: { section: () => C }, doc, board: { define: (x) => x } });
  const root = doc.els[C.ids.root];
  const show = (s) => board.show({ [C.speed_piece]: s, [C.health_piece]: { ok: true } });
  const look = () => ({ lim: doc.els[C.ids.limit].textContent, row: doc.els[C.ids.limit_row].getAttribute(C.limit_attr), judge: root.getAttribute(C.judge_attr), label: doc.els[C.ids.limit_label].textContent });

  show({ kmh: 95, limit_kmh: 100, judge: J.ok });
  const S = C.sign;
  const want = Object.entries(S.vars).map(([k, n]) => [n, typeof S[k] === 'number' ? S[k] + S.unit : S[k]]);
  const bad = want.filter(([n, v]) => root.props[n] !== v).map(([n]) => n);
  t.check('①', '표지판 모양 값(크기·테두리·색 ' + want.length + '개)이 설정에서 CSS 변수로 판 뿌리에 들어감', '빠진·틀린 변수 0 · 예 ' + S.vars.ring_color + '=' + S.ring_color,
    '빠진·틀린 ' + bad.length + (bad.length ? '(' + bad.join(',') + ')' : '') + ' · ' + S.vars.ring_color + '=' + root.props[S.vars.ring_color], bad.length === 0);

  const x1 = look();
  t.check('②', '값 있음 — 표지판에 숫자, 제한 칸 shown, 제한 글', '"100" · ' + C.limit_words.shown + ' · ' + C.texts.limit_label, JSON.stringify(x1.lim) + ' · ' + x1.row + ' · ' + x1.label,
    x1.lim === '100' && x1.row === C.limit_words.shown && x1.label === C.texts.limit_label);

  const sets1 = root.sets;
  show({ kmh: 118, limit_kmh: 100, judge: J.over });
  const x2 = look();
  show({ kmh: 135, limit_kmh: 100, judge: J.danger });
  const x3 = look();
  const varSets = root.sets - sets1;
  t.check('③', '넘음·위험 — 판단 칸이 over·danger(표지판 빛 테는 CSS 가 이 칸으로) · 표지판 숫자 그대로 · 모양 변수는 다시 안 넣음(속도 크기 변수만)', J.over + ' · ' + J.danger + ' · "100" · 다시 넣은 수 2(크기 변수 두 번)',
    x2.judge + ' · ' + x3.judge + ' · ' + JSON.stringify(x3.lim) + ' · 다시 넣은 수 ' + varSets, x2.judge === J.over && x3.judge === J.danger && x3.lim === '100' && varSets === 2);

  show({ kmh: 60, limit_kmh: null, judge: J.none });
  const x4 = look();
  show({ kmh: 60, limit_kmh: 0, judge: J.none });
  const x5 = look();
  t.check('④', '값 없음(null)·0 이 와도 — 표지판 글 비움 + 칸 blank(빈 둥근 판도 숨김) · "0" 안 보임', '"" · ' + C.limit_words.blank + ' · 둘 다',
    JSON.stringify(x4.lim) + ' · ' + x4.row + ' / 0 일 때 ' + JSON.stringify(x5.lim) + ' · ' + x5.row,
    x4.lim === '' && x4.row === C.limit_words.blank && x4.label === '' && x5.lim === '' && x5.row === C.limit_words.blank && x5.label === '');

  const fitOk = S.size_px - 2 * S.ring_px >= C.fit.max_digits * C.fit.digit_em * S.font_px && S.small_size_px - 2 * S.small_ring_px >= C.fit.max_digits * C.fit.digit_em * S.small_font_px;
  t.check('⑤', '설정 값 맞춤 — 세 자리 숫자(' + C.fit.max_digits + '자리 × ' + C.fit.digit_em + 'em)가 판 안(지름 − 테두리 두 겹)에 듦(큰 판·좁은 판)', '둘 다 듦',
    '큰 판 ' + (S.size_px - 2 * S.ring_px) + ' ≥ ' + (C.fit.max_digits * C.fit.digit_em * S.font_px).toFixed(1) + ' · 좁은 판 ' + (S.small_size_px - 2 * S.small_ring_px) + ' ≥ ' + (C.fit.max_digits * C.fit.digit_em * S.small_font_px).toFixed(1), fitOk);
}
