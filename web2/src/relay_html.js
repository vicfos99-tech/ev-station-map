// 순수: 밖에서 온 글을 HTML 에 넣을 때의 이스케이프 한 곳과 풍선 글(설계 5-1 ⑩ relay_html · 5-7 (1) '화면에 그릴 때' — OWASP 끼워 넣기).
// 화면은 글을 textContent 로만 넣는 것이 먼저다. 꼭 HTML 글이 필요할 때(지도 풍선 같은 라이브러리 칸)만 여기를 거친다.
// 규칙 r = config_relay_html(바꿀 글자 표·풍선 틀). 로그 없음.
export const NEEDS = [];

// 글 → 꺾쇠·따옴표·앰퍼샌드를 바꾼 글. null·undefined 는 빈 글
export function esc(s, r) {
  if (s === null || s === undefined) return '';
  return String(s).replace(new RegExp(r.esc_re, 'g'), (ch) => r.esc_map[ch]);
}

// 풍선 글: {title, lines: [글…]} → HTML. 틀(r.balloon)의 자리 표시에 넣는 글은 모두 esc 를 거친다 — 틀 자체만 HTML
export function balloon(o, r) {
  if (!o || typeof o !== 'object') throw new TypeError(r.why.input);
  const lines = Array.isArray(o.lines) ? o.lines.filter((x) => x !== null && x !== undefined && x !== '') : [];
  const body = lines.map((x) => r.balloon.line.split(r.marks.text).join(esc(x, r))).join('');
  return r.balloon.box.split(r.marks.title).join(esc(o.title, r)).split(r.marks.lines).join(body);
}
