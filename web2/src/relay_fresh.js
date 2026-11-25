// 순수: 충전기 상태의 신선함(설계 5-1 ⑩ relay_fresh · 중계 모양 문서 ref/relay_format.md 규칙 1).
// 상태가 지금 것인지는 meta 로 본다: meta.ok 가 참이고 그 시군구의 지역 코드(zcodes)가 모두 meta.fresh 에 있을 때만 meta.at 을 믿는다(보증).
// 보증되면 받은 때 = meta.at 과 상태 파일 at 가운데 늦은 것, 아니면 상태 파일 at. 낡음 문턱(old_ms)은 부르는 쪽(정보 칸 설정)이 넘긴다.
// 규칙 r = config_relay_fresh(시각 글 무늬·미래 허용·단계 이름·'○분 전' 글), t = config_time, tf = timefmt(순수 — 인자로 받음). 로그 없음, 틀린 입력은 던진다.
export const NEEDS = [];

// 한국 시각 14자리 글 → UTC 밀리초. 못 읽거나 없는 날이면 null
export function kstMs(text, r, t, tf) {
  if (typeof text !== 'string') return null;
  const m = text.match(new RegExp(r.kst14_re));
  if (!m) return null;
  const g = m.groups;
  const ms = Date.UTC(Number(g[r.kst14_groups.year]), Number(g[r.kst14_groups.month]) - 1, Number(g[r.kst14_groups.day]),
    Number(g[r.kst14_groups.hour]), Number(g[r.kst14_groups.minute]), Number(g[r.kst14_groups.second])) - t.kst_offset_hours * t.ms_per_hour;
  // 13월·2월 30일 같은 글은 Date 가 넘겨 셈하므로, 되돌려 쓴 글이 같아야 맞는 시각
  return Number.isFinite(ms) && tf.format(ms, r.kst14_pattern, t) === text ? ms : null;
}

// input = {meta: {at, ok, fresh} | null, file_at: 14자리 글 | null, zcodes: [지역 코드], now: 밀리초, old_ms}
// → {at: 밀리초 | null, by: 보증 쪽(r.by.meta·file·none), age_ms, level: r.levels(fresh·unsure·old·unknown)}
export function judge(input, r, t, tf) {
  if (!input || !Number.isFinite(input.now) || !Number.isFinite(input.old_ms)) throw new TypeError(r.why.input);
  const zcodes = Array.isArray(input.zcodes) ? input.zcodes : [];
  const meta = input.meta || null;
  const f = kstMs(input.file_at, r, t, tf);
  const m = meta && meta.ok === true ? kstMs(meta.at, r, t, tf) : null;
  const fresh = meta && Array.isArray(meta.fresh) ? meta.fresh : [];
  const vouch = m !== null && zcodes.length > 0 && zcodes.every((z) => fresh.includes(z));
  const at = vouch ? (f === null ? m : Math.max(m, f)) : f;
  if (at === null) return { at: null, by: r.by.none, age_ms: null, level: r.levels.unknown };
  const d = input.now - at;
  if (d < -r.future_ms) return { at, by: vouch ? r.by.meta : r.by.file, age_ms: null, level: r.levels.unknown };
  const age = Math.max(0, d);
  let level = vouch ? r.levels.fresh : r.levels.unsure;
  if (age > input.old_ms) level = r.levels.old;
  return { at, by: vouch ? r.by.meta : r.by.file, age_ms: age, level };
}

// 지난 시간 → '방금' · '○분 전' · '○시간 전' · '○일 전'(r.ago — 큰 단위부터). 모르면 r.ago_unknown
export function agoText(ageMs, r) {
  if (ageMs === null || ageMs === undefined) return r.ago_unknown;
  if (!Number.isFinite(ageMs) || ageMs < 0) throw new TypeError(r.why.age);
  for (const u of r.ago) {
    if (ageMs >= u.ms) return u.text.split(r.n_mark).join(String(Math.floor(ageMs / u.ms)));
  }
  return r.ago_now;
}
