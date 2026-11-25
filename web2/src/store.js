// Store(싱글톤 — 오케스트레이터가 하나 만들어 넘긴다). **데이터 폴더** 읽고 쓰기(키 이름·파일·판 번호는 config_store).
// 실패는 Logger 로 남기고 부른 쪽에 결과로 돌려준다(던지지 않음). Logger 는 Store 를 모른다(한 방향).
export const NEEDS = ['cfg', 'log', 'disk'];

export function createStore(deps) {
  const c = deps.cfg.section('config_store');
  const log = deps.log;
  const disk = deps.disk;
  const watchers = [];
  let state = { ok: true, why: '' };

  function setState(next) {
    if (next.ok === state.ok && next.why === state.why) return;
    state = next;
    for (const fn of watchers) {
      try { fn({ ...state }); } catch (e) { log.error(e, { where: c.where_watch }); }
    }
  }

  function keyOf(name) {
    const k = c.keys[name];
    if (!k) throw new Error(name);
    return k;
  }

  return {
    async read(name) {
      let k;
      try {
        k = keyOf(name);
        const text = await disk.read(c.dir, k.file);
        if (!text) return { ok: true, value: null };
        const obj = JSON.parse(text);
        if (!obj || obj[c.version_key] !== k.v) {
          log.warn(c.where_read, c.word_bad_version, { name, got: obj && obj[c.version_key] });
          return { ok: false, why: c.code_bad_version };
        }
        return { ok: true, value: obj[c.value_key] };
      } catch (e) {
        log.error(e, { where: c.where_read, params: { name } });
        return { ok: false, why: c.code_read };
      }
    },
    async write(name, value) {
      try {
        const k = keyOf(name);
        await disk.write(c.dir, k.file, JSON.stringify({ [c.version_key]: k.v, [c.value_key]: value }));
        setState({ ok: true, why: '' });
        return { ok: true };
      } catch (e) {
        log.error(e, { where: c.where_write, params: { name } });
        setState({ ok: false, why: c.code_write });
        return { ok: false, why: c.code_write };
      }
    },
    status: () => ({ ...state }),
    watch(fn) { watchers.push(fn); },
  };
}
