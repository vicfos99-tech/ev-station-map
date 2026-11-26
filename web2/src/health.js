// 순수: 사용 가능 판정(설계 5-1-나 Health · E1 · F6). 로그를 쓰지 않고, 틀린 입력은 던진다.
// 규칙 표 r = config_health. 단계 이름·등급·까닭 코드·시작 필요 데이터·시작 시간 한도는 모두 r 에.
export const NEEDS = [];

function gradeOf(file, r) {
  return r.grades[file] || r.unknown_grade;
}

// ① 앱 전체(시작 판정): {stage, why} — why = {code, file?, key?, need?, fail?, src?}
// input = {problems, start: {need: {ok, code, src}}, startedAt, now, prev}
export function judgeApp(input, r) {
  const s = r.stages;
  if (!Array.isArray(input.problems)) throw new TypeError('problems');
  if (input.prev && input.prev.stage !== s.starting) return input.prev; // 한 번 바뀌면 켜 있는 동안 그대로
  const appProblem = input.problems.find((p) => gradeOf(p.file, r) === r.app_grade);
  if (appProblem) {
    return {
      stage: s.broken,
      why: { code: r.reason_of_file[appProblem.file] || r.reason_default, file: appProblem.file, key: appProblem.key, detail: appProblem.why },
    };
  }
  const start = input.start || {};
  for (const need of r.start_needs) {
    const got = start[need];
    if (got && !got.ok) return { stage: s.broken, why: { code: r.reason_need, need, fail: got.code, src: got.src } };
  }
  if (r.start_needs.every((need) => start[need] && start[need].ok)) return { stage: s.good, why: null };
  if (input.now - input.startedAt > r.start_timeout_ms) {
    const missing = r.start_needs.find((need) => !start[need]);
    return { stage: s.broken, why: { code: r.reason_timeout, need: missing } };
  }
  return { stage: s.starting, why: null };
}

// 연결 알림마다의 마지막 결과 → 출처마다 하나: 한 출처에 알림이 여럿이면(충전소 목록·충전기 상태 — 둘 다 다리 자료 길) 하나라도 실패면 실패(먼저 적힌 것의 까닭)
// byName = {알림 이름: {src, ok, code}} → {출처: {ok, code}}
export function bySource(byName) {
  const out = {};
  for (const v of Object.values(byName || {})) {
    if (!v || !v.src) continue;
    const had = out[v.src];
    if (!had) out[v.src] = { ok: !!v.ok, code: v.ok ? null : v.code };
    else if (had.ok && !v.ok) out[v.src] = { ok: false, code: v.code };
  }
  return out;
}

// ② 출처마다: {출처: {ok, why, since}} — conn = {출처: {ok, code}}, prev = 앞 판정
export function judgeSources(input, r) {
  const out = {};
  const prev = input.prev || {};
  for (const [src, got] of Object.entries(input.conn || {})) {
    if (got.ok) { out[src] = { ok: true, why: null, since: null }; continue; }
    const before = prev[src];
    const since = before && !before.ok ? before.since : input.now;
    out[src] = { ok: false, why: got.code, since };
  }
  return out;
}

// ③ 기능마다: {기능: {ok}} — 그 기능의 설정이 틀리거나 기대는 출처가 끊기면 나쁨(까닭 글은 싣지 않는다 — F7)
export function judgeFeatures(input, r) {
  const out = {};
  const badFiles = new Set(input.problems.map((p) => p.file));
  for (const [feat, rule] of Object.entries(r.features)) {
    const cfgBad = rule.configs.some((f) => badFiles.has(f));
    const srcBad = rule.sources.some((s) => input.sources[s] && !input.sources[s].ok);
    out[feat] = { ok: !cfgBad && !srcBad };
  }
  return out;
}

// ④ (정비 가 ⑤ 격리) 설정이 틀려 꺼 둔 기능 이름들(차례 = 규칙 표 차례). 시작에 꼭 필요한 설정(등급 app)은 ① 이 '앱 점검 중'으로 다룬다
export function judgeConfigOff(input, r) {
  if (!Array.isArray(input.problems)) throw new TypeError('problems');
  const badFiles = new Set(input.problems.map((p) => p.file));
  return Object.entries(r.features).filter(([, rule]) => rule.configs.some((f) => badFiles.has(f))).map(([feat]) => feat);
}

export function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
