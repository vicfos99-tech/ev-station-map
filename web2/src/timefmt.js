// 순수: 시각 글. 한국 시각 = UTC 밀리초 + 설정 값(config_time.kst_offset_hours) — 폰 지역 시각을 쓰지 않는다(설계 5-6).
// 값은 인자로 받는다(t = config_time). 로그를 쓰지 않고, 틀린 입력은 던진다.
export const NEEDS = [];

export function kstFields(ms, t) {
  if (!Number.isFinite(ms)) throw new TypeError('ms');
  const d = new Date(ms + t.kst_offset_hours * t.ms_per_hour);
  return {
    YYYY: d.getUTCFullYear(),
    MM: d.getUTCMonth() + 1,
    DD: d.getUTCDate(),
    hh: d.getUTCHours(),
    mm: d.getUTCMinutes(),
    ss: d.getUTCSeconds(),
  };
}

// pattern 의 낱말(YYYY·MM·DD·hh·mm·ss)을 그 길이만큼 0 을 채워 바꾼다
export function format(ms, pattern, t) {
  const f = kstFields(ms, t);
  return pattern.replace(new RegExp(t.tokens_re, 'g'), (tok) => String(f[tok]).padStart(tok.length, t.pad_char));
}
