// Logger(싱글톤 — 오케스트레이터가 하나 만들어 넘긴다). 로그 한 줄을 **로그 폴더의 자기 파일에 직접** 더한다.
// Store 를 쓰지 않는다(설계 5-3). 한 줄 = 시각(UTC + 설정 값) · 수준 · 모듈.함수 · 무슨 일 · 넘어온 값.
// 쓰기 전에 가린다: 가림 키 이름·가림 무늬·앱 비밀 값(설정 파일의 값 자체). 긴 값은 앞부분만.
// 못 쓰면 콘솔에 찍고 watch 로 알린다(상태 자리에 '기록장 — 쓰지 못함'은 HealthRunner 가 올린다). 앱은 계속 돈다.
export const NEEDS = ['cfg', 'timefmt', 'disk', 'clock', 'console'];

export function createLogger(deps) {
  const c = deps.cfg.section('config_log');
  const t = deps.cfg.section('config_time');
  const timefmt = deps.timefmt;
  const disk = deps.disk;
  const clock = deps.clock;
  const con = deps.console;
  const minLevel = c.levels[c.level];
  const maskKeys = c.mask_keys.map((k) => k.toLowerCase());
  const maskRes = c.mask_patterns.map((p) => new RegExp(p, 'g'));
  const secretValues = [];
  for (const f of c.mask_value_files) {
    if (!deps.cfg.has(f)) continue;
    const walk = (v) => {
      if (typeof v === 'string' && v.length >= c.mask_value_min_chars) secretValues.push(v);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(deps.cfg.section(f));
  }
  const memory = [];
  const watchers = [];
  let chain = Promise.resolve();
  let count = null;
  let state = { ok: true, why: '' };
  // (정비 가 ⑧) 쓰기와 읽기를 따로 든다 — 읽기 실패는 다음 쓰기가 잘 되어도 지워지지 않고, 다음 읽기가 될 때 풀린다
  let writeOk = true;
  let readOk = true;

  function maskText(s) {
    let out = s;
    for (const v of secretValues) out = out.split(v).join(c.mask_text);
    for (const rx of maskRes) out = out.replace(rx, c.mask_text);
    return out;
  }

  function maskValue(v, key) {
    if (key && maskKeys.some((k) => key.toLowerCase().includes(k))) return c.mask_text;
    if (typeof v === 'string') return maskText(v);
    if (v instanceof Error) return { name: v.name, message: maskText(String(v.message)) };
    if (Array.isArray(v)) return v.map((x) => maskValue(x, ''));
    if (v && typeof v === 'object') {
      const o = {};
      for (const [k, x] of Object.entries(v)) o[k] = maskValue(x, k);
      return o;
    }
    return v;
  }

  function valueText(params) {
    if (params === undefined) return '';
    let s;
    try { s = JSON.stringify(maskValue(params, '')); } catch (e) { s = String(e && e.message); }
    s = maskText(String(s));
    return s.length > c.max_value_chars ? s.slice(0, c.max_value_chars) + c.cut_mark : s;
  }

  function setState(part) {
    if (part.write !== undefined) writeOk = part.write;
    if (part.read !== undefined) readOk = part.read;
    let next = { ok: true, why: '' };
    if (!writeOk) next = { ok: false, why: c.fail_code };
    else if (!readOk) next = { ok: false, why: c.read_fail_code };
    if (next.ok === state.ok && next.why === state.why) return;
    state = next;
    for (const fn of watchers) {
      try { fn({ ...state }); } catch (e) { con.error(e); }
    }
  }

  async function writeLine(line) {
    if (count === null) {
      const old = await disk.read(c.dir, c.file);
      count = old ? old.split('\n').filter(Boolean).length : 0;
    }
    if (count + 1 > c.max_lines) {
      const old = (await disk.read(c.dir, c.file)).split('\n').filter(Boolean);
      const keep = old.slice(old.length - c.keep_lines);
      const dropped = old.length - keep.length;
      const note = [timefmt.format(clock.now(), c.time_pattern, t), c.level_words.info, c.self_where, c.words[c.trimmed_word] || c.trimmed_word, String(dropped)].join(c.sep);
      await disk.write(c.dir, c.file, keep.concat([note]).join('\n') + '\n');
      count = keep.length + 1;
    }
    await disk.append(c.dir, c.file, line + '\n');
    count += 1;
  }

  function write(level, where, what, params) {
    if (c.levels[level] < minLevel) return;
    const line = [
      timefmt.format(clock.now(), c.time_pattern, t),
      c.level_words[level],
      where,
      c.words[what] || what,
      valueText(params),
    ].join(c.sep);
    memory.push(line);
    if (memory.length > c.memory_lines) memory.splice(0, memory.length - c.memory_lines);
    chain = chain.then(() => writeLine(line)).then(
      () => setState({ write: true }),
      (e) => {
        con.error(c.console_prefix + line);
        con.error(e);
        setState({ write: false });
      },
    );
  }

  // 기록장 파일 전체. 못 읽으면 조용히 바꾸지 않는다(설계 원칙 '오류를 삼키지 않는다'): 콘솔·경고 로그 한 줄 + watch 로 알림
  // (상태 자리 '기록장 — 읽지 못함'은 HealthRunner 가 올린다) 뒤 메모리에 든 줄을 돌려준다
  function readAll() {
    return chain.then(() => disk.read(c.dir, c.file)).then(
      (text) => { setState({ read: true }); return text; },
      (e) => {
        const mem = memory.join('\n') + '\n';
        con.error(c.console_read_prefix + String(e && e.message));
        write('warn', c.self_where, c.read_fail_word, { error: e instanceof Error ? { name: e.name, message: e.message } : e, memory_lines: memory.length });
        setState({ read: false });
        return mem;
      },
    );
  }

  return {
    debug: (where, what, params) => write('debug', where, what, params),
    info: (where, what, params) => write('info', where, what, params),
    warn: (where, what, params) => write('warn', where, what, params),
    // 잡은 자리에서 그때 넘어온 값과 함께(설계 5-3 catch 규칙)
    error: (err, ctx) => write('error', (ctx && ctx.where) || c.self_where, (ctx && ctx.what) || c.error_word,
      { error: err instanceof Error ? { name: err.name, message: err.message } : err, params: ctx && ctx.params }),
    lines: () => memory.slice(),
    // 기록장 파일 전체(못 읽으면 경고 + 메모리에 든 줄 — 위 readAll)
    readAll,
    flush: () => chain,
    status: () => ({ ...state }),
    watch(fn) { watchers.push(fn); },
    downloadName: () => c.download_name.split(c.download_time_mark).join(timefmt.format(clock.now(), c.download_time_pattern, t)),
  };
}
