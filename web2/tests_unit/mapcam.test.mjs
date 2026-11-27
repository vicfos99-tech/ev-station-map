// 단위 시험: 지도 카메라 규칙(mapcam — 순수) 중 11/27 더한 '손으로 옮긴 가운데로 다시 열기'.
// 손으로 옮김 → 가운데를 기억 · 따라가기 끈 채 저장 → 다시 열 때 그 가운데 · 따라가면 저장 안 함 · 틀린 저장 값은 버림 · '내 위치' 뒤엔 저장 안 함.
export default async function (t) {
  const cam = await t.src('mapcam');
  const r = t.cfg('config_mapcam');
  const s0 = cam.init(null, r);
  t.check('①', '처음 — 가운데 없음(처음 가운데는 지도 설정)', 'null', JSON.stringify(s0.center), s0.center === null);

  const s1 = cam.onUser(s0, { moved: true, rotated: false, zoomed: false, bearing: 0, zoom: r.start_zoom, center: [127.0, 37.0] }, r);
  const sv1 = cam.saved(s1);
  t.check('②', '손으로 옮김 → 따라가기 끔 · 저장 값에 가운데', 'follow false · [127,37]', 'follow ' + sv1.follow + ' · ' + JSON.stringify(sv1.center), sv1.follow === false && sv1.center[0] === 127 && sv1.center[1] === 37);

  const s2 = cam.init(JSON.parse(JSON.stringify(sv1)), r);
  t.check('③', '다시 열기 — 따라가기 끈 채 저장된 가운데로', 'follow false · [127,37]', 'follow ' + s2.follow + ' · ' + JSON.stringify(s2.center), s2.follow === false && s2.center && s2.center[0] === 127 && s2.center[1] === 37);

  const s3 = cam.onButton(s2, { lat: 36.5, lng: 127.4 }, r).state;
  t.check('④', "'내 위치' 뒤 — 따라가기 켬 · 저장 값 가운데 null(위치가 정함)", 'follow true · null', 'follow ' + cam.saved(s3).follow + ' · ' + JSON.stringify(cam.saved(s3).center), cam.saved(s3).follow === true && cam.saved(s3).center === null);

  const s4 = cam.init({ follow: true, center: [127, 37] }, r);
  const s5 = cam.init({ follow: false, center: [500, 37] }, r);
  const s6 = cam.init({ follow: false, center: 'x' }, r);
  t.check('⑤', '따라가는 중 저장된 가운데·범위 밖·꼴 틀림은 버림', 'null · null · null', [s4.center, s5.center, s6.center].map((x) => JSON.stringify(x)).join(' · '), s4.center === null && s5.center === null && s6.center === null);

  const s7 = cam.onUser(s0, { moved: false, rotated: true, zoomed: false, bearing: 30, zoom: r.start_zoom }, r);
  t.check('⑥', '가운데 없는 손 알림(옛 꼴)도 그대로 — 돌림만 굳음', 'bearing 30 · 굳음 · center null', 'bearing ' + s7.bearing + ' · 굳음 ' + s7.bearing_locked + ' · center ' + JSON.stringify(s7.center), s7.bearing === 30 && s7.bearing_locked && s7.center === null);
}
