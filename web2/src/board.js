// 순수: 알림판의 부모(인터페이스 — 설계 5-1-다 · E4). 행위 둘만 있다: needs() 무엇이 필요한지 밝힘 · show(data) 받은 것을 보여 줌.
// 데이터·규칙·받기·계산이 없다. 판은 define 으로 자기를 만들고, 판 틀(BoardHost)은 checkNeeds 로 밝힌 것을 검사한다.
// 로그 없음, 꼴이 틀리면 던진다. 규칙 r = config_ui_boards.rule(간격 아래 한도·자리 이름).
export const NEEDS = [];

export function define(impl) {
  if (!impl || typeof impl.needs !== 'function' || typeof impl.show !== 'function') throw new TypeError('board');
  return Object.freeze({ needs: impl.needs, show: impl.show });
}

// needs() 의 꼴: {topics: [State 조각 이름…], interval_ms: 갱신 간격, slot: 들어갈 자리 이름}
export function checkNeeds(n, r) {
  if (!n || !Array.isArray(n.topics) || n.topics.length < 1 || n.topics.length > r.max_topics) throw new TypeError('topics');
  for (const t of n.topics) if (typeof t !== 'string' || !t) throw new TypeError('topic');
  if (typeof n.interval_ms !== 'number' || !Number.isFinite(n.interval_ms) || n.interval_ms < r.min_interval_ms) throw new TypeError('interval_ms');
  if (!r.slot_names.includes(n.slot)) throw new TypeError('slot');
  return n;
}
