// 순수: 지금 속도(설계 5-1-나 Speed · 5-8 나). StateCalc 가 부른다: (입력 조각들, 같은 셈의 앞 결과 done, 규칙 r = config_speed, lib, 내 앞 결과 own) → speed 조각.
// 기기가 준 속도를 먼저 쓰고, 없으면 앞 위치(own 에 함께 담아 둔 자리)와의 거리 ÷ 시간. 셈한 속도가 r.max_kmh 를 넘으면(튐) 앞 값을 그대로 둔다.
// 같은 위치로 다시 셈하면(제한 속도 자료만 새로 옴) 앞 속도를 그대로 쓴다.
// 제한 속도는 같은 셈의 앞 결과 limit(LimitMatch — E7)에서. 없으면 판단 '자료 없음'(경고도 없음).
// 판단: 지금 속도 > 제한 + r.over_margin_kmh 가 r.over_hold_ms 이어지면 '넘음'(주의), 그때 제한 + r.danger_margin_kmh 도 넘으면 '위험'. 내려가면 곧바로 '정상'.
// speed = {t, lat, lng, kmh, src, limit_kmh, judge, over_since}. 로그 없음, 틀린 입력은 던진다.
export const NEEDS = [];

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

export function speedOf(inputs, done, r, lib, own) {
  const fix = inputs[r.fix_input];
  if (!fix) return own || null;
  if (!isNum(fix.lat) || !isNum(fix.lng)) throw new TypeError(r.fix_input);
  let kmh = null;
  let src = null;
  if (own && isNum(own.t) && fix.t === own.t) {
    kmh = own.kmh;
    src = own.src;
  } else if (isNum(fix.speed_kmh)) {
    kmh = fix.speed_kmh;
    src = r.src_words.device;
  } else if (own && isNum(own.t) && isNum(fix.t) && fix.t > own.t) {
    const geo = lib.parts[r.geo_part];
    const g = lib.rules[r.geo_rule];
    const m = geo.distM(own, fix, g);
    const v = m / ((fix.t - own.t) / r.ms_per_s) / r.kmh_to_mps;
    if (v <= r.max_kmh) {
      kmh = v;
      src = r.src_words.calc;
    } else {
      kmh = own.kmh;
      src = own.src;
    }
  }
  const limit = done[r.limit_piece];
  const limitKmh = limit && isNum(limit[r.limit_key]) ? limit[r.limit_key] : null;
  let judge = r.judge_words.none;
  let overSince = null;
  if (limitKmh !== null && kmh !== null) {
    judge = r.judge_words.ok;
    if (kmh > limitKmh + r.over_margin_kmh) {
      overSince = own && isNum(own.over_since) ? own.over_since : fix.t;
      if (isNum(fix.t) && fix.t - overSince >= r.over_hold_ms) judge = kmh > limitKmh + r.danger_margin_kmh ? r.judge_words.danger : r.judge_words.over;
    }
  }
  return { t: fix.t, lat: fix.lat, lng: fix.lng, kmh, src, limit_kmh: limitKmh, judge, over_since: overSince };
}
