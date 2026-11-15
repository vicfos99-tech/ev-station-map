/*
 * 지금 위치(GPS) → 고속도로·km (web/live_build.js 의 locate, keepSide) 시험.
 *   node web/test/test_locate.js
 * 실제 휴게소 충전기 좌표(live_fixture.json)를 GPS 위치처럼 넣어, 그 휴게소가 들어간 노선·km 와 맞는지 본다.
 */
"use strict";
const path = require("path");
const fs = require("fs");
const LB = require(path.join(__dirname, "..", "live_build.js"));
const LIVE = require(path.join(__dirname, "..", "live.js"));

const cfg = LIVE.config;
const fails = [];
let checks = 0;
function ok(cond, msg) { checks += 1; if (!cond) fails.push(msg); }

let multi = 0;
// 1. 선의 꼭짓점 위 → 그 고속도로가 후보에 있고, 정방향 km = 따라간 거리, 역방향 km = 전체 - 그 거리
for (const [hk, hw] of Object.entries(cfg.highways)) {
  let along = 0;
  const len = hw.points.slice(1).reduce((s, p, i) => s + haversineKm(hw.points[i], p), 0);
  hw.points.forEach((p, i) => {
    if (i > 0) along += haversineKm(hw.points[i - 1], p);
    const { candidates } = LB.locate(p, cfg);
    if (candidates.length > 1) multi += 1; // 분기점 근처처럼 고속도로가 둘 이상 가까운 점
    ok(candidates.every((x, j) => j === 0 || candidates[j - 1].off <= x.off), `${hk} 꼭짓점 ${i}: 후보가 가까운 순이 아님`);
    ok(candidates[0].hk === hk || candidates[0].off <= 0.01, `${hk} 꼭짓점 ${i}: 첫 후보가 자기 선이 아님`);
    const c = candidates.find((x) => x.hk === hk);
    ok(c && c.off < 0.01, `${hk} 꼭짓점 ${i}: 후보에 없음`);
    if (!c) return;
    const f = c.sides.find((s) => s.key === hw.forward.key), b = c.sides.find((s) => s.key === hw.backward.key);
    // 선이 자기 자신과 가까이 지나면(되돌아가는 모양) 투영이 다른 곳에 걸릴 수 있으니 0.5km 까지 허용
    ok(Math.abs(f.km - along) < 0.5, `${hk} 꼭짓점 ${i}: 정방향 km ${f.km.toFixed(2)} ≠ ${along.toFixed(2)}`);
    ok(Math.abs(f.km + b.km - len) < 1e-6, `${hk} 꼭짓점 ${i}: 두 방향 km 합 ≠ 길이`);
    ok(f.direction === hw.forward.direction && b.direction === hw.backward.direction, `${hk}: 방향 이름`);
  });
}

ok(multi >= 5, `고속도로가 둘 이상 가까운 꼭짓점이 너무 적어 순서 확인이 안 된다: ${multi}`);

// 2. 실제 휴게소 충전기 좌표 → 그 휴게소가 들어간 노선의 km 와 대략 같아야 한다
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, "live_fixture.json"), "utf8"));
const { routes } = LB.buildRoutes(fx.items, fx.fetched_ms, cfg);
const where = new Map(); // statId → [{key, km}]
for (const r of routes) for (const a of r.rest_areas) for (const s of a.stations) {
  const id = s.id.replace(/-\d+$/, "");
  if (!where.has(id)) where.set(id, []);
  where.get(id).push({ key: r.key, km: a.km });
}
let real = 0, onLine = 0, keptOk = 0;
const seen = new Set();
for (const it of fx.items) {
  const places = where.get(it.statId);
  const lat = Number(it.lat), lng = Number(it.lng);
  if (it.statId.startsWith("T")) continue; // 대조용 가짜 충전소(이름·좌표를 일부러 엉키게 만든 것)
  if (!places || !lat || !lng || seen.has(it.statId)) continue;
  seen.add(it.statId);
  real += 1;
  const { candidates } = LB.locate([lat, lng], cfg);
  for (const p of places) {
    const hit = LB.keepSide(candidates, p.key);
    if (!hit) continue; // 주소로 10km 안까지 올린 휴게소는 GPS 2km 후보에 없을 수 있다
    onLine += 1;
    // 같은 휴게소로 합쳐진 충전소끼리 2km(MERGE_KM) 안이므로 그만큼 + 반올림 여유
    ok(Math.abs(hit.side.km - p.km) <= cfg.merge_km + 0.1, `${it.statNm}: 위치 km ${hit.side.km.toFixed(1)} ≠ 휴게소 km ${p.km} (${p.key})`);
    if (Math.abs(hit.side.km - p.km) <= cfg.merge_km + 0.1) keptOk += 1;
  }
}
ok(real > 300, `실제 휴게소 좌표가 너무 적다: ${real}`);
ok(onLine / Math.max(1, [...where.values()].reduce((s, v) => s + v.length, 0)) > 0.8, `2km 후보로 잡힌 비율이 낮다: ${onLine}`);

// 3. 고속도로가 아닌 곳(제주) → 후보 없음, 가장 가까운 고속도로는 알려 줌
{
  const { candidates, nearest } = LB.locate([33.45, 126.92], cfg);
  ok(candidates.length === 0, "제주: 후보가 있으면 안 됨");
  // 고속도로 밖에서도 가까운 순 목록(ranked)은 전부 나온다 → 가까운 고속도로를 골라 방향을 정할 수 있다
  const { ranked } = LB.locate([36.35, 127.38], cfg); // 대전 시내
  ok(ranked.length === Object.keys(cfg.highways).length, "ranked: 모든 고속도로");
  ok(ranked.every((c, i) => i === 0 || ranked[i - 1].off <= c.off), "ranked: 가까운 순");
  ok(ranked[0] === LB.locate([36.35, 127.38], cfg).nearest || ranked[0].hk === LB.locate([36.35, 127.38], cfg).nearest.hk, "ranked[0] = nearest");
  ok(ranked.every((c) => c.sides.length === 2 && c.sides.every((s) => s.km >= -1e-9 && s.km <= c.length + 1e-9)), "ranked: 방향 둘, km 는 0~길이");
  ok(["gb", "hn", "jb", "dy"].includes(ranked[0].hk), `대전 시내에서 가장 가까운 고속도로가 이상함: ${ranked[0].hk}`);
  ok(nearest && nearest.off > 50, "제주: 가장 가까운 고속도로가 멀어야 함");
}

// 4. 방향 유지: 보던 노선이 후보 고속도로에 있으면 그 방향, 없으면 null
{
  const gb = cfg.highways.gb;
  const p = gb.points[3];
  const { candidates } = LB.locate(p, cfg);
  const back = LB.keepSide(candidates, gb.backward.key);
  ok(back && back.side.key === gb.backward.key && back.cand.hk === "gb", "경부 역방향 유지");
  ok(LB.keepSide(candidates, "live-nowhere-f") === null, "모르는 노선이면 null");
  ok(LB.keepSide([], gb.forward.key) === null, "후보 없으면 null");
}

// 5. 후보는 가까운 순, 2km(max_offset_km) 밖은 빠짐
{
  const gb = cfg.highways.gb;
  const [a, b] = [gb.points[5], gb.points[6]];
  // 이 구간은 남북으로 가므로 경도 쪽(동쪽)으로 옮긴다
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 0.012]; // 선에서 1km 남짓
  const far = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 0.05];  // 4km 남짓
  const c1 = LB.locate(mid, cfg).candidates;
  ok(c1.some((c) => c.hk === "gb"), "1km 떨어진 점: 경부 후보");
  ok(c1.every((c, i) => i === 0 || c1[i - 1].off <= c.off), "가까운 순 정렬");
  ok(c1.every((c) => c.off <= cfg.max_offset_km), "2km 밖 후보 없음");
  ok(!LB.locate(far, cfg).candidates.some((c) => c.hk === "gb"), "4km 떨어진 점: 경부 후보 아님");
}

function haversineKm(a, b) {
  const r = Math.PI / 180;
  const h = Math.sin((b[0] - a[0]) * r / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin((b[1] - a[1]) * r / 2) ** 2;
  return 2 * 6371.0 * Math.asin(Math.sqrt(h));
}

console.log(`실제 휴게소 충전소 ${real}곳, 2km 후보로 잡힌 노선 자리 ${onLine}, km 맞음 ${keptOk}`);
console.log(`확인 ${checks}개, 실패 ${fails.length}개`);
for (const f of fails.slice(0, 20)) console.log("  " + f);
process.exit(fails.length ? 1 : 0);
