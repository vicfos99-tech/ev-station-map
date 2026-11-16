/*
 * 주변 충전소: 지금 위치의 시군구를 알아내(web/regions.js) 그 시군구의 급속 충전소를 공공 데이터에서 받는다.
 *   EvAround.zscodeAt(regions, lat, lng)            위치 → 시군구 코드(모르면 null)
 *   EvAround.zscodesNear(regions, lat, lng)         그 칸과 둘레 칸의 시군구 코드(가까운 칸 먼저, 겹침 없이)
 *   EvAround.stationsOf(items, cfg, fetchedMs)      API 항목 → 충전소 목록(급속이 있는 공개 충전소만)
 *   EvAround.applyStatus(stations, items, cfg, at)  상태만 받은 항목(getChargerStatus)을 충전소에 덮어쓴다 → 바뀐 수
 *   EvAround.fetchRegion(key, cfg, zscode, opts)    한 시군구를 다 받는다 → { stations, fetched_at, count }
 *   EvAround.fetchStatus(key, cfg, zscode, minutes, opts)  최근 minutes 분 사이 상태가 바뀐 충전기 항목
 * 규칙은 tools/ic_nearby.py 의 open_to_public, tools/charger_api.py 의 charger_of 와 같다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.EvAround = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  const PRIVATE_NAME = /전용|입주민|임직원|관계자|전기버스|버스 ?충전|차고지|택배/;
  class ApiError extends Error {}

  const cellOf = (step, lat, lng) => `${Math.floor(lat / step)}_${Math.floor(lng / step)}`;
  const defaultReach = (regions) => Math.max(1, Math.round(0.04 / ((regions && regions.step) || 0.05))); // 둘레 약 4~5km
  function zscodeAt(regions, lat, lng) {
    return zscodesNear(regions, lat, lng, 2 * defaultReach(regions))[0] || null;
  }
  // 내가 선 칸 먼저, 그다음 둘레 칸을 '내 자리에서 칸 가운데까지 가까운 순'으로 훑는다(칸 가장자리에 서 있으면 옆 칸이 바로 다음).
  // reach: 몇 칸까지 볼지(기본은 약 4~5km)
  function zscodesNear(regions, lat, lng, reach) {
    if (!regions || !regions.cells) return [];
    const step = regions.step, la = Math.floor(lat / step), lo = Math.floor(lng / step), out = [];
    const max = reach === undefined ? defaultReach(regions) : reach;
    const found = [];
    for (let i = -max; i <= max; i++) for (let j = -max; j <= max; j++) {
      const v = regions.cells[`${la + i}_${lo + j}`]; // "코드" 또는 "코드,코드"(경계에 걸친 칸, 많은 순)
      if (!v) continue;
      const dy = (la + i + 0.5) * step - lat, dx = ((lo + j + 0.5) * step - lng) * 0.8; // 경도 1도는 위도보다 짧다
      found.push([i === 0 && j === 0 ? -1 : dy * dy + dx * dx, v]);
    }
    found.sort((a, b) => a[0] - b[0]);
    for (const [, v] of found) for (const z of v.split(",")) if (!out.includes(z)) out.push(z);
    return out;
  }

  function openToPublic(it) {
    if (String(it.kindDetail || "").toUpperCase().startsWith("H")) return false; // 공동주택
    if (String(it.limitYn || "N").toUpperCase() === "Y") return false;           // 이용 제한
    return !PRIVATE_NAME.test(String(it.statNm || ""));
  }
  function chargerOf(it, cfg) {
    const t = String(it.chgerType ?? "").padStart(2, "0");
    const kind = cfg.slow_types.includes(t) ? "slow" : "fast";
    const kw = Number(it.output) || 0;
    return { id: String(it.chgerId ?? ""), type: kind, power_kw: kw > 0 ? kw : cfg.default_kw[kind], status: cfg.status[String(it.stat ?? "")] || "comm_error" };
  }
  function stationsOf(items, cfg, fetchedMs) {
    const by = new Map();
    for (const it of items) {
      if (String(it.delYn || "N").toUpperCase() === "Y" || !openToPublic(it)) continue;
      const lat = Number(it.lat), lng = Number(it.lng), sid = String(it.statId || "");
      if (!sid || !Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) continue;
      const operator = String(it.busiNm || it.bnm || "").trim() || "알 수 없음";
      if (!by.has(sid)) {
        by.set(sid, {
          id: sid, name: String(it.statNm || "").trim(), operator, maker: "", addr: String(it.addr || "").trim(),
          price: Object.prototype.hasOwnProperty.call(cfg.tariffs, operator) ? cfg.tariffs[operator] : cfg.tariffs.default,
          loc: [Number(lat.toFixed(5)), Number(lng.toFixed(5))], updated: fetchedMs, chargers: [],
        });
      }
      const st = by.get(sid);
      st.chargers.push(chargerOf(it, cfg));
      const mk = String(it.maker || "").trim();
      if (mk && !st.maker.split("·").includes(mk)) st.maker = st.maker ? st.maker + "·" + mk : mk;
    }
    return [...by.values()].filter((s) => s.chargers.some((c) => c.type === "fast"));
  }
  function applyStatus(stations, items, cfg, at) {
    const by = new Map(stations.map((s) => [s.id, s]));
    let changed = 0;
    for (const it of items) {
      const st = by.get(String(it.statId || ""));
      if (!st) continue;
      const c = st.chargers.find((x) => x.id === String(it.chgerId ?? ""));
      if (!c) continue;
      const status = cfg.status[String(it.stat ?? "")] || "comm_error";
      if (c.status !== status) { c.status = status; changed += 1; }
      st.updated = at;
    }
    return changed;
  }
  // 충전소 하나의 급속 요약
  function summary(st) {
    let free = 0, busy = 0, total = 0, kw = 0;
    for (const c of st.chargers) {
      if (c.type !== "fast") continue;
      total += 1;
      if (c.status === "available") free += 1; else if (c.status === "charging") busy += 1;
      if (c.power_kw > kw) kw = c.power_kw;
    }
    return { free, busy, total, broken: total - free - busy, kw };
  }

  function parsePage(text) {
    let data;
    try { data = JSON.parse(text); } catch (e) {
      const m = text.match(/<returnAuthMsg>([^<]+)<\/returnAuthMsg>|<resultMsg>([^<]+)<\/resultMsg>/);
      throw new ApiError("공공 데이터가 다른 답을 줬어요: " + (m ? (m[1] || m[2]) : text.trim().slice(0, 80)));
    }
    if (data && data.response) data = data.response.body || data.response;
    const code = String(data.resultCode ?? (data.header && data.header.resultCode) ?? "00");
    if (code !== "00" && code !== "0") throw new ApiError(`공공 데이터 오류 ${code}: ${data.resultMsg || ""}`);
    let items = data.items || {};
    items = Array.isArray(items) ? items : (items.item || []);
    if (!Array.isArray(items)) items = [items];
    return { items, total: Number(data.totalCount) || items.length };
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // 키는 오류 글에 넣지 않는다
  async function getPages(url, key, params, opts) {
    opts = opts || {};
    const doFetch = opts.fetch || fetch, wait = opts.wait ?? 2000;
    const k = key.includes("%") ? key : encodeURIComponent(key);
    const items = [];
    let page = 1;
    for (;;) {
      const q = new URLSearchParams(Object.assign({ pageNo: page, numOfRows: 9999, dataType: "JSON" }, params));
      let text = null, lastErr = "";
      for (let n = 1; n <= 3 && text === null; n++) {
        try {
          const r = await doFetch(`${url}?serviceKey=${k}&${q}`, opts.signal ? { signal: opts.signal } : undefined);
          if (r.ok) text = await r.text();
          else { lastErr = `공공 데이터 서버가 ${r.status} 로 답했어요`; if (r.status < 500) break; }
        } catch (e) {
          if (e && e.name === "AbortError") throw e;
          lastErr = "공공 데이터 서버에 연결하지 못했어요";
        }
        if (text === null && n < 3) await sleep(wait * n);
      }
      if (text === null) throw new ApiError(lastErr);
      const { items: part, total } = parsePage(text);
      items.push(...part);
      if (!part.length || items.length >= total) break;
      page += 1;
    }
    return items;
  }
  async function fetchRegion(key, cfg, zscode, opts) {
    const at = Date.now();
    const items = await getPages(cfg.endpoint, key, { zscode }, opts);
    return { zscode, stations: stationsOf(items, cfg, at), fetched_at: at, count: items.length };
  }
  function fetchStatus(key, cfg, zscode, minutes, opts) {
    return getPages(cfg.endpoint.replace("getChargerInfo", "getChargerStatus"), key, { zscode, period: minutes }, opts);
  }

  return { zscodeAt, zscodesNear, cellOf, stationsOf, applyStatus, summary, openToPublic, parsePage, fetchRegion, fetchStatus, ApiError };
});
