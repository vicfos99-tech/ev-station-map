// State(싱글톤 — 오케스트레이터가 하나 만들어 넘긴다). 함께 쓰는 상태 조각과 알림.
// 조각마다 쓰는 모듈은 하나: claim(주인, 이름들) 로 받은 발행 함수로만 쓴다(설계 5-9).
// 알림을 돌리는 중에 또 발행하면 줄 세워 차례로. 구독자 하나가 던져도 나머지는 받는다(던진 것은 Logger 로).
export const NEEDS = ['cfg', 'log'];

export function createState(deps) {
  const c = deps.cfg.section('config_state');
  const log = deps.log;
  const values = new Map();
  const subs = new Map();
  const owners = new Map();
  const queue = [];
  let draining = false;

  function listeners(name) {
    const out = [];
    for (const [key, fns] of subs) {
      const hit = key === name || (key.endsWith(c.wildcard) && name.startsWith(key.slice(0, key.length - c.wildcard.length)));
      if (hit) out.push(...fns);
    }
    return out;
  }

  function drain() {
    if (draining) return;
    draining = true;
    try {
      while (queue.length) {
        const [name, value] = queue.shift();
        for (const fn of listeners(name)) {
          try { fn(value, name); } catch (e) { log.error(e, { where: c.where_deliver, params: { name } }); }
        }
      }
    } finally {
      draining = false;
    }
  }

  return {
    // 이 이름들의 주인이 된다. 돌려받은 함수로만 발행할 수 있다
    claim(owner, names) {
      for (const n of names) {
        const had = owners.get(n);
        if (had !== undefined && had !== owner) throw new Error(n);
        owners.set(n, owner);
      }
      const mine = new Set(names);
      return (name, value) => {
        if (!mine.has(name)) throw new Error(name);
        values.set(name, value);
        if (queue.length >= c.max_queue) {
          log.warn(c.where_deliver, c.word_queue_full, { name, size: queue.length });
          return;
        }
        queue.push([name, value]);
        drain();
      };
    },
    // name 끝이 wildcard 면 그 앞글자로 시작하는 모든 조각. 돌려받은 함수로 끊는다
    subscribe(name, fn) {
      if (!subs.has(name)) subs.set(name, []);
      subs.get(name).push(fn);
      return () => {
        const list = subs.get(name);
        const i = list.indexOf(fn);
        if (i >= 0) list.splice(i, 1);
      };
    },
    get: (name) => values.get(name),
  };
}
