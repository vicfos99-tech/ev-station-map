// BarGlyph(아래 띠 단추 그림 글자 — 화면, 11/26 묘성). 아래 단추 줄(내 위치·세 곳만·제목·목록·내 차·기록)이 좁은 세로 창(360)에서 판을 화면 밖으로 밀지 않게
// 단추마다 그림 글자(설정 buttons[].glyph)를 붙여 두고(glyph_attr), 몸(body)에 꼴(mode — narrow: 좁을 때만 / always: 늘 / never: 안 함)을 적는다.
// 실제로 바꿔 보이는 것은 모양(style_ui_bar.css — 좁은 창 문턱은 style_ui_drive 와 같은 값). 단추 글은 그대로 두고 화면 읽기 글(aria-label)을 글로 남긴다:
// 이미 화면 읽기 글이 있는 단추는 그대로, 없는 단추는 지금 글을 넣고 글이 바뀌면 따라 고친다(창의 MutationObserver — 없으면 한 번만).
// 단추를 만들거나 옮기지 않는다(자리는 저마다의 모듈). 조립이 단추 모듈들 다음에 만든다. 글자·꼴·단추 목록은 config_ui_bar.
export const NEEDS = ['cfg', 'log', 'doc', 'win'];

export function createBarGlyph(deps) {
  const c = deps.cfg.section('config_ui_bar');
  const log = deps.log;
  const doc = deps.doc;
  const managed = [];
  const missing = [];

  function syncLabel(el) {
    try {
      el.setAttribute(c.label_attr, el.textContent);
    } catch (e) {
      log.error(e, { where: c.where, params: { act: c.act_label } });
    }
  }

  // 단추 id 는 그 단추를 만드는 모듈의 설정(b.cfg)의 칸(b.key — key_sep 로 나눈 길)에서 읽는다 — id 를 이 설정에 다시 적지 않음
  function idOf(b) {
    let v = deps.cfg.section(b.cfg);
    for (const k of String(b.key).split(c.key_sep)) v = v && typeof v === 'object' ? v[k] : undefined;
    return typeof v === 'string' && v ? v : null;
  }

  try {
    doc.body.setAttribute(c.mode_attr, c.mode);
    if (c.mode !== c.modes.never) {
      for (const b of c.buttons) {
        const id = idOf(b);
        const el = id ? doc.getElementById(id) : null;
        if (!el) { missing.push(id || b.cfg + c.key_sep + b.key); continue; }
        el.setAttribute(c.glyph_attr, b.glyph);
        const had = el.getAttribute(c.label_attr);
        if (had === undefined || had === null || had === '') {
          managed.push(el);
          syncLabel(el);
        }
      }
    }
    const MO = deps.win && deps.win.MutationObserver;
    if (typeof MO === 'function' && managed.length) {
      const mo = new MO((records) => {
        for (const r of records) {
          const el = managed.find((m) => m === r.target || (typeof m.contains === 'function' && m.contains(r.target)));
          if (el) syncLabel(el);
        }
      });
      for (const el of managed) mo.observe(el, c.observe);
    }
    log.info(c.where, c.word_set, { mode: c.mode, set: c.buttons.length - missing.length, labels: managed.length, watch: typeof MO === 'function' });
    if (missing.length) log.warn(c.where, c.word_missing, { ids: missing });
  } catch (e) {
    log.error(e, { where: c.where, params: { act: c.act_init } });
  }

  return { mode: () => c.mode, missing: () => missing.slice(), labelled: () => managed.length };
}
