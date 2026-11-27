// 순수: 지도 카메라 규칙(설계 5-1-나 MapCam · 5-8 다). 지도 라이브러리를 모른다 — ui_map 이 직접 부르고, 낸 명령 하나만 mapview 가 지도에 옮긴다.
//   손으로 옮김 → 따라가기 끔 · 손으로 돌림 → 방향이 손댄 대로 굳음 · 손으로 확대·축소 → 확대가 손댄 대로 굳음
//   위치가 새로 옴(따라가기 켬) → 가운데 = 내 위치, 방향은 굳었으면 그대로·아니면 진행 방향, 확대는 그대로(굳지 않았고 r.follow_min_zoom 보다 멀면 그만큼만)
//   '내 위치' 단추 → 가운데 = 내 위치, 따라가기 켬, 방향 굳음 풂 → 진행 방향, 확대는 그대로(r.follow_min_zoom 보다 멀면 그만큼만)
//   '세 곳만' → 켬·끔(다른 충전소 층 숨김 — ui_map 이 mapview 에 시킴)
// 진행 방향: 기기가 준 방향을 쓰고, 느릴 때(r.heading_min_kmh 아래)·방향이 없을 때는 마지막 방향(서 있을 때 지도가 돌지 않게).
// 방향이 r.bearing_min_change_deg 보다 적게 바뀌면 돌리지 않는다(흔들림 막기). 상태는 저장할 수 있는 평범한 값(따라가기·굳음·확대·방향·'세 곳만').
// 명령 cmd = {center?: [경도, 위도], bearing?: 도, zoom?: 단계} 또는 null(움직이지 않음). 로그 없음, 틀린 입력은 던진다.
export const NEEDS = [];

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function angleDiff(a, b, r) {
  const t = r.full_turn_deg;
  const d = Math.abs((((a - b) % t) + t) % t);
  return Math.min(d, t - d);
}

// (11/27) 지도 가운데 [경도, 위도] 가 꼴·범위(r.center_lng·r.center_lat = [작은, 큰])에 맞나
function okCenter(v, r) {
  return Array.isArray(v) && v.length === r.center_len && isNum(v[0]) && isNum(v[1])
    && v[0] >= r.center_lng[0] && v[0] <= r.center_lng[1] && v[1] >= r.center_lat[0] && v[1] <= r.center_lat[1];
}

// 저장해 둔 값(saved)이 꼴에 맞으면 그것으로, 아니면 처음 값
export function init(saved, r) {
  const s = { follow: true, bearing_locked: false, zoom_locked: false, bearing: r.start_bearing, zoom: r.start_zoom, heading: null, only3: r.only3_default, center: null };
  if (!saved || typeof saved !== 'object') return s;
  for (const k of r.saved_bools) if (typeof saved[k] === 'boolean') s[k] = saved[k];
  if (isNum(saved.bearing)) s.bearing = saved.bearing;
  // (추가1) 확대는 손으로 굳힌 것만 다시 읽는다 — 안 굳은 확대는 따라가기가 정한 값일 뿐이라 처음 값(r.start_zoom — 기본 확대를 바꾸면 바로 따름)
  if (s.zoom_locked && isNum(saved.zoom) && saved.zoom >= r.min_zoom && saved.zoom <= r.max_zoom) s.zoom = saved.zoom;
  // (11/27 묘성 ②) 손으로 옮겨 따라가기를 끈 채 꺼졌으면 그 가운데로 다시 연다(따라가는 중이면 가운데는 다음 위치가 정함)
  if (!s.follow && okCenter(saved.center, r)) s.center = [saved.center[0], saved.center[1]];
  return s;
}

// 저장할 것만(진행 방향은 그때그때 오므로 뺌). 가운데는 따라가기를 끈 때만(따라가면 위치가 정함)
export function saved(s) {
  return { follow: s.follow, bearing_locked: s.bearing_locked, zoom_locked: s.zoom_locked, bearing: s.bearing, zoom: s.zoom, only3: s.only3, center: !s.follow && s.center ? s.center : null };
}

// 손으로 한 일 ev = {moved, rotated, zoomed, bearing, zoom, center?} (손을 뗀 뒤 지도의 지금 값 — center = [경도, 위도])
export function onUser(s, ev, r) {
  if (!ev || typeof ev !== 'object') throw new TypeError(r.user_event);
  const n = { ...s };
  if (ev.moved) n.follow = false;
  if (ev.rotated) {
    if (!isNum(ev.bearing)) throw new TypeError(r.user_event);
    n.bearing_locked = true;
    n.bearing = ev.bearing;
  }
  if (ev.zoomed) {
    if (!isNum(ev.zoom)) throw new TypeError(r.user_event);
    n.zoom_locked = true;
    n.zoom = ev.zoom;
  }
  // (11/27) 손을 뗀 뒤 지도 가운데(있으면) — 따라가기를 끈 채 꺼지면 다시 열 때 이 자리
  if (okCenter(ev.center, r)) n.center = [ev.center[0], ev.center[1]];
  return n;
}

function headingOf(s, fix, r) {
  if (isNum(fix.heading_deg) && isNum(fix.speed_kmh) && fix.speed_kmh >= r.heading_min_kmh) return fix.heading_deg;
  return s.heading;
}

// 위치가 새로 옴 → {state, cmd}
export function onFix(s, fix, r) {
  if (!fix || !isNum(fix.lat) || !isNum(fix.lng)) throw new TypeError(r.fix_word);
  const n = { ...s, heading: headingOf(s, fix, r) };
  if (!n.follow) return { state: n, cmd: null };
  const cmd = { center: [fix.lng, fix.lat] };
  if (!n.bearing_locked && isNum(n.heading) && angleDiff(n.heading, n.bearing, r) >= r.bearing_min_change_deg) {
    n.bearing = n.heading;
    cmd.bearing = n.bearing;
  }
  if (!n.zoom_locked && n.zoom < r.follow_min_zoom) {
    n.zoom = r.follow_min_zoom;
    cmd.zoom = n.zoom;
  }
  return { state: n, cmd };
}

// '내 위치' 단추 → {state, cmd}. last = 마지막 위치(없으면 가운데는 그대로)
export function onButton(s, last, r) {
  const n = { ...s, follow: true, bearing_locked: false };
  const cmd = {};
  if (last && isNum(last.lat) && isNum(last.lng)) cmd.center = [last.lng, last.lat];
  if (isNum(n.heading)) {
    n.bearing = n.heading;
    cmd.bearing = n.bearing;
  }
  if (n.zoom < r.follow_min_zoom) {
    n.zoom = r.follow_min_zoom;
    cmd.zoom = n.zoom;
  }
  return { state: n, cmd };
}

export function toggleOnly3(s) {
  return { ...s, only3: !s.only3 };
}
