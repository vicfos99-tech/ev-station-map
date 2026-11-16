/*
 * 주변 충전소(web/around.js) 확인.  node web/test/test_around.js
 * 지어낸 항목으로: 공개·급속만 남는지, 제조사·좌표·요약, 상태 덮어쓰기, 위치→시군구, 여러 쪽 받기, 오류 글에 키가 없는지.
 */
"use strict";
const A = require("../around.js");
let n = 0, bad = 0;
function ok(cond, what) { n += 1; if (!cond) { bad += 1; console.log("실패:", what); } }
const eq = (a, b, what) => ok(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);

const cfg = { endpoint: "https://x.test/EvCharger/getChargerInfo", slow_types: ["02", "08"], default_kw: { fast: 50, slow: 7 },
  status: { 1: "comm_error", 2: "available", 3: "charging", 4: "out_of_service", 5: "maintenance", 9: "comm_error" }, tariffs: { default: 391, "채비": 400 } };
const it = (o) => Object.assign({ statId: "S1", statNm: "시청 주차장", chgerId: "01", chgerType: "06", lat: "37.1", lng: "127.2", stat: "2", output: "100",
  busiNm: "채비 ", maker: "채비", kindDetail: "A001", limitYn: "N", delYn: "N", addr: "어디 1" }, o);

// 공개·급속만
const items = [
  it({}), it({ chgerId: "02", stat: "3", maker: "시그넷" }), it({ chgerId: "03", chgerType: "02", output: "7", maker: "" }),
  it({ statId: "S2", statNm: "행복아파트", kindDetail: "H001" }),          // 공동주택
  it({ statId: "S3", limitYn: "Y" }),                                     // 이용 제한
  it({ statId: "S4", statNm: "임직원 전용 주차장" }),                      // 이름으로 거름
  it({ statId: "S5", chgerType: "02", output: "7" }),                     // 완속뿐
  it({ statId: "S6", delYn: "Y" }),                                       // 지워진 것
  it({ statId: "S7", lat: "", lng: "" }),                                 // 좌표 없음
  it({ statId: "S8", statNm: "마트", busiNm: "", bnm: "", stat: "5", output: "", lat: "37.123456", lng: "127.654321" }),
];
const sts = A.stationsOf(items, cfg, 1000);
eq(sts.map((s) => s.id), ["S1", "S8"], "남는 충전소");
const s1 = sts[0], s8 = sts[1];
eq([s1.operator, s1.maker, s1.price, s1.loc, s1.chargers.length], ["채비", "채비·시그넷", 400, [37.1, 127.2], 3], "S1 내용");
eq(A.summary(s1), { free: 1, busy: 1, total: 2, broken: 0, kw: 100 }, "S1 급속 요약(완속은 안 센다)");
eq([s8.operator, s8.price, s8.loc, s8.chargers[0].power_kw], ["알 수 없음", 391, [37.12346, 127.65432], 50], "S8 기본값");
eq(A.summary(s8), { free: 0, busy: 0, total: 1, broken: 1, kw: 50 }, "S8 점검 중");

// 상태 덮어쓰기
const changed = A.applyStatus(sts, [{ statId: "S1", chgerId: "01", stat: "3" }, { statId: "S1", chgerId: "02", stat: "3" }, { statId: "S8", chgerId: "01", stat: "2" },
  { statId: "S9", chgerId: "01", stat: "2" }, { statId: "S1", chgerId: "99", stat: "2" }], cfg, 2000);
eq(changed, 2, "바뀐 충전기 수");
eq(A.summary(s1), { free: 0, busy: 2, total: 2, broken: 0, kw: 100 }, "S1 덮어쓴 뒤");
eq(A.summary(s8).free, 1, "S8 덮어쓴 뒤");
eq([s1.updated, s8.updated], [2000, 2000], "정보 시각");

// 위치 → 시군구
const reg = { step: 0.05, cells: {} };
reg.cells[A.cellOf(0.05, 37.01, 127.01)] = "41000";
reg.cells[A.cellOf(0.05, 37.06, 127.01)] = "42000";
reg.cells[A.cellOf(0.05, 37.01, 127.06)] = "41000";
reg.cells[A.cellOf(0.05, 37.21, 127.01)] = "43000";
eq(A.zscodeAt(reg, 37.02, 127.02), "41000", "그 칸");
eq(A.zscodesNear(reg, 37.02, 127.02), ["41000", "42000"], "둘레 한 칸(겹침 없이, 가까운 것 먼저)");
eq(A.zscodeAt(reg, 37.13, 127.02), "42000", "빈 칸이면 둘레 두 칸 안에서");
eq(A.zscodeAt(reg, 35.0, 129.0), null, "아는 칸이 없으면 null");
eq(A.zscodesNear(null, 37, 127), [], "표가 없으면 빈 목록");

(async () => {
  // 여러 쪽 받기: 전체 3건을 2건씩
  const calls = [];
  const pages = { 1: [it({}), it({ chgerId: "02" })], 2: [it({ statId: "S8", statNm: "마트" })] };
  const fake = async (url) => {
    calls.push(url);
    const p = Number(new URL(url).searchParams.get("pageNo"));
    return { ok: true, status: 200, text: async () => JSON.stringify({ resultCode: "00", totalCount: 3, items: { item: pages[p] || [] } }) };
  };
  const r = await A.fetchRegion("KEY+/=", cfg, "41000", { fetch: fake, wait: 0 });
  eq([r.zscode, r.count, r.stations.map((s) => s.id), calls.length], ["41000", 3, ["S1", "S8"], 2], "여러 쪽");
  ok(calls[0].includes("zscode=41000") && calls[0].includes("serviceKey=KEY%2B%2F%3D"), "주소(시군구, 키는 주소 글자로 바꿔서)");
  const st = await A.fetchStatus("K", cfg, "41000", 5, { fetch: async (u) => { calls.push(u); return { ok: true, text: async () => JSON.stringify({ resultCode: "00", totalCount: 0, items: { item: [] } }) }; } });
  ok(Array.isArray(st) && calls[calls.length - 1].includes("getChargerStatus") && calls[calls.length - 1].includes("period=5"), "상태만 받기 주소");
  // 오류: 서버 오류는 세 번 해 보고, 글에 키가 없다
  let tries = 0, msg = "";
  try { await A.fetchRegion("SECRETKEY", cfg, "41000", { fetch: async () => { tries += 1; return { ok: false, status: 504 }; }, wait: 0 }); } catch (e) { msg = e.message; ok(e instanceof A.ApiError, "ApiError"); }
  eq(tries, 3, "서버 오류는 세 번");
  ok(msg && !msg.includes("SECRETKEY"), "오류 글에 키 없음");
  tries = 0;
  try { await A.fetchRegion("SECRETKEY", cfg, "41000", { fetch: async () => { tries += 1; return { ok: false, status: 401 }; }, wait: 0 }); } catch (e) { msg = e.message; }
  eq(tries, 1, "키 오류(4xx)는 한 번만");
  try { await A.fetchRegion("SECRETKEY", cfg, "41000", { fetch: async () => ({ ok: true, text: async () => "<OpenAPI_ServiceResponse><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg></OpenAPI_ServiceResponse>" }), wait: 0 }); msg = ""; } catch (e) { msg = e.message; }
  ok(msg.includes("SERVICE_KEY_IS_NOT_REGISTERED_ERROR") && !msg.includes("SECRETKEY"), "XML 오류 답");
  console.log(`확인 ${n}개, 실패 ${bad}개`);
  process.exit(bad ? 1 : 0);
})();
