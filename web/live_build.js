/*
 * 공공 충전소 API 를 폰에서 바로 불러 노선을 다시 만든다. tools/charger_api.py 의 build_routes 를 그대로 옮긴 것.
 * 규칙(고속도로 선, 요금, 상태 코드 등)은 live.js 의 config 에서 받는다. 원본 규칙은 파이썬 파일 하나.
 * 파이썬과 같은 답을 내는지 web/test/compare_live.js 로 대조한다.
 *
 * 브라우저에서는 전역 EvLiveBuild, Node 에서는 require("./live_build.js").
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.EvLiveBuild = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const SIDES = ["forward", "backward"];

  // ---------- 파이썬과 같게 맞춘 작은 도구 ----------
  // 파이썬 round(x, nd) (nd 는 0 또는 1): 이진수 값 그대로 반올림하고, 정확히 반일 때만 짝수 쪽으로.
  // toFixed 는 정확한 값으로 반올림하되 딱 반이면 위로 올린다. 딱 반은 nd=0 이면 x*2, nd=1 이면 x*4 가 홀수 정수일 때뿐
  // (0.35 는 실제로 0.3499… 라 반이 아니다 → 0.3)
  function pyRound(x, nd) {
    const q = nd === 0 ? x * 2 : x * 4;
    if (Number.isInteger(q) && Math.abs(q % 2) === 1) {
      const m = Math.pow(10, nd);
      const lo = Math.floor(x * m);
      return (lo % 2 === 0 ? lo : lo + 1) / m;
    }
    return Number(x.toFixed(nd));
  }
  // 파이썬 float(s) 처럼: 빈 글자·숫자 아님은 실패(null)
  function pyFloat(v) {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    if (s === "") return null;
    const n = Number(s);
    return Number.isNaN(n) ? null : n;
  }
  const pyStr = (v) => (v === null || v === undefined ? "None" : String(v)); // 파이썬 str(None) == "None"
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

  // ---------- 거리 ----------
  function haversine(a, b) {
    const r = Math.PI / 180;
    const la1 = a[0] * r, lo1 = a[1] * r, la2 = b[0] * r, lo2 = b[1] * r;
    const h = Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2;
    return 2 * 6371.0 * Math.asin(Math.sqrt(h));
  }
  function lineLength(points) {
    let s = 0;
    for (let i = 0; i < points.length - 1; i++) s += haversine(points[i], points[i + 1]);
    return s;
  }
  // 점을 선에 투영: [기점에서 따라간 km, 선에서 떨어진 km]
  function project(point, points) {
    let bestOff = Infinity, bestAlong = 0, along = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      const seg = haversine(a, b);
      const k = Math.cos(((a[0] + b[0]) / 2) * Math.PI / 180);
      const ax = a[1] * k, ay = a[0], bx = b[1] * k, by = b[0];
      const px = point[1] * k, py = point[0];
      const dx = bx - ax, dy = by - ay;
      const t = dx === 0 && dy === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
      const foot = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      const off = haversine(point, foot);
      if (off < bestOff) { bestOff = off; bestAlong = along + seg * t; }
      along += seg;
    }
    return [bestAlong, bestOff];
  }

  // ---------- 항목 읽기 ----------
  function chargerOf(item, cfg) {
    const t = pyStr(item.chgerType ?? "").padStart(2, "0");
    const kind = cfg.slow_types.includes(t) ? "slow" : "fast";
    const kw = pyFloat(item.output || 0) || 0;
    const out = {
      type: kind,
      power_kw: kw > 0 ? kw : cfg.default_kw[kind],
      status: cfg.status[pyStr(item.stat ?? "")] || "comm_error",
    };
    const last = lastEndMs(item.lastTedt);
    if (last !== null) out.last_end = last; // 기록이 있을 때만 넣는다(파이썬 charger_of 와 같게)
    return out;
  }
  // API 의 lastTedt(마지막 충전 종료, 한국 시각 'YYYYMMDDHHMMSS') → 1970 년부터의 밀리초. 못 읽으면 null (파이썬 last_end_ms)
  function lastEndMs(value) {
    const s = pyStr(value || "").trim();
    if (s.length !== 14 || !/^[0-9]{14}$/.test(s)) return null;
    const n = (a, b) => Number(s.slice(a, b));
    const y = n(0, 4), mo = n(4, 6), d = n(6, 8), hh = n(8, 10), mi = n(10, 12), ss = n(12, 14);
    if (y < 2000 || mo < 1 || mo > 12 || d < 1 || hh > 23 || mi > 59 || ss > 59) return null;
    const ms = Date.UTC(y, mo - 1, d, hh - 9, mi, ss);
    const back = new Date(ms + 9 * 3600000); // 2월 30일처럼 없는 날은 넘어가 버리므로 되돌려 확인한다
    if (back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
    return ms;
  }
  const isRestArea = (item) => pyStr(item.kindDetail ?? "") === "C001" || pyStr(item.statNm ?? "").includes("휴게소");

  function directionOf(name, hw) {
    const spaced = name.split("휴게소").join(" ");
    const parts = [...name.matchAll(/\(([^)]*)\)/g)].map((m) => m[1])
      .concat([...spaced.matchAll(/(\S+?)\s*방[향면]/g)].map((m) => m[1]))
      .concat([...name.matchAll(/(상행|하행)/g)].map((m) => m[1]));
    const inside = parts.join(" ");
    const hits = SIDES.filter((side) => hw[side].tokens.some((t) => inside.includes(t)));
    return hits.length === 1 ? hits[0] : null;
  }

  function baseName(name) {
    let s = name.replace(/\([^)]*\)/g, "").split("휴게소").join(" ");
    s = s.replace(/\S+?\s*방[향면]/g, "");
    s = s.replace(/^\s*워터\s*|\s*E-?pit(?![A-Za-z0-9_])/gi, " ");
    return s.replace(/\s+/g, "") || name.trim();
  }

  // 휴게소 이름(base) → 노선 키: 주소에 적힌 고속도로 이름의 다수결 + 손으로 정한 것(파이썬 hints_of)
  const HW_RE = /([가-힣]{2,8}?)\s?고속(?:도로|국도)/g;
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  function hintsOf(items, cfg) {
    const counts = new Map();
    for (const it of items) {
      if (!isRestArea(it) || pyStr(it.delYn ?? "N").toUpperCase() === "Y") continue;
      const b = baseName(pyStr(it.statNm ?? "").trim());
      const text = ["addr", "addrDetail", "location", "statNm"].map((k) => String(it[k] || "")).join(" ");
      for (const m of text.matchAll(HW_RE)) {
        if (!own(cfg.hint_names || {}, m[1])) continue;
        const hk = cfg.hint_names[m[1]];
        if (!counts.has(b)) counts.set(b, {});
        const c = counts.get(b);
        c[hk] = (c[hk] || 0) + 1;
      }
    }
    const out = {};
    for (const [b, c] of counts) {
      let best = null;
      for (const k of Object.keys(c).sort(cmp)) if (best === null || c[k] > c[best]) best = k;
      out[b] = best;
    }
    return Object.assign(out, cfg.manual_hints || {});
  }

  // ---------- 노선 만들기 (파이썬 build_routes 와 같은 순서) ----------
  function buildRoutes(items, fetchedMs, cfg, tariffs) {
    tariffs = tariffs || cfg.tariffs;
    const skipped = { "방향 모름": new Set(), "고속도로에서 멂": new Set(), "다른 고속도로": new Set() };
    const buckets = new Map(); // "hk|side" → Map(base → {km:[], stations: Map})
    const hkeys = Object.keys(cfg.highways);
    const hints = hintsOf(items, cfg);
    for (const it of items) {
      if (!isRestArea(it) || pyStr(it.delYn ?? "N").toUpperCase() === "Y") continue;
      const name = pyStr(it.statNm ?? "").trim();
      const lat = pyFloat(it.lat), lng = pyFloat(it.lng);
      if (lat === null || lng === null) continue;
      const pt = [lat, lng];
      const hint = own(hints, baseName(name)) ? hints[baseName(name)] : null;
      if (hint === "-") { skipped["다른 고속도로"].add(name); continue; }
      let near = null;
      if (hint && own(cfg.highways, hint)) { // 노선을 알면 그 선에 올린다
        const [along, off] = project(pt, cfg.highways[hint].points);
        if (off <= cfg.hint_max_km) near = [hint, along, off];
      } else {
        for (const hk of hkeys) {
          const [along, off] = project(pt, cfg.highways[hk].points);
          if (off <= cfg.max_offset_km && (near === null || off < near[2])) near = [hk, along, off];
        }
      }
      if (near === null) { skipped["고속도로에서 멂"].add(name); continue; }
      const [hk, along] = near;
      const hw = cfg.highways[hk];
      const side = directionOf(name, hw);
      if (side === null) { skipped["방향 모름"].add(name); continue; }
      const km = side === "forward" ? along : lineLength(hw.points) - along;
      const bk = hk + "|" + side;
      if (!buckets.has(bk)) buckets.set(bk, new Map());
      const areas = buckets.get(bk);
      const base = baseName(name);
      if (!areas.has(base)) areas.set(base, { km: [], stations: new Map() });
      const area = areas.get(base);
      area.km.push(km);
      const sid = pyStr(it.statId ?? "") || name;
      const operator = String(it.busiNm || it.bnm || "").trim() || "알 수 없음";
      if (!area.stations.has(sid)) {
        area.stations.set(sid, {
          id: sid, operator,
          price: Object.prototype.hasOwnProperty.call(tariffs, operator) ? tariffs[operator] : tariffs.default,
          updated: fetchedMs, chargers: [],
        });
      }
      area.stations.get(sid).chargers.push(chargerOf(it, cfg));
    }

    const routes = [];
    for (const hk of hkeys) {
      const hw = cfg.highways[hk];
      const length = pyRound(lineLength(hw.points), 0);
      for (const side of SIDES) {
        const areas = buckets.get(hk + "|" + side);
        if (!areas || areas.size === 0) continue;
        const groups = [...areas.entries()].map(([base, a]) => [a.km.reduce((s, x) => s + x, 0) / a.km.length, base, a]);
        groups.sort((x, y) => cmp(x[0], y[0]) || cmp(x[1], y[1]));
        const merged = [];
        for (const [km, base, a] of groups) {
          let m;
          if (merged.length && km - merged[merged.length - 1].last <= cfg.merge_km) m = merged[merged.length - 1];
          else { m = { kms: [], bases: [], stations: new Map(), last: km }; merged.push(m); }
          m.kms.push(...a.km);
          m.bases.push(base);
          m.last = km;
          for (const [sid, st] of a.stations) {
            if (!m.stations.has(sid)) m.stations.set(sid, Object.assign({}, st, { chargers: [] }));
            m.stations.get(sid).chargers.push(...st.chargers);
          }
        }
        const rest = merged.map((m) => {
          // 가장 긴(정식) 이름. 길이가 같으면 글자 순으로 큰 것(파이썬 max(key=(len, b)))
          let best = m.bases[0];
          for (const b of m.bases) if (b.length > best.length || (b.length === best.length && b > best)) best = b;
          return {
            name: best + "휴게소",
            km: pyRound(m.kms.reduce((s, x) => s + x, 0) / m.kms.length, 1),
            stations: [...m.stations.values()].sort((x, y) => cmp(x.id, y.id)),
          };
        });
        rest.sort((x, y) => cmp(x.km, y.km) || cmp(x.name, y.name));
        rest.forEach((r, i) => { r.id = `${hw[side].key}-${i + 1}`; });
        const seen = new Set();
        for (const r of rest) for (const st of r.stations) {
          const baseId = st.id;
          let n = 1;
          while (seen.has(st.id)) { n += 1; st.id = `${baseId}-${n}`; }
          seen.add(st.id);
        }
        routes.push({ key: hw[side].key, highway: hw.name, direction: hw[side].direction, length, live: true, rest_areas: rest });
      }
    }
    const sk = {};
    for (const k of Object.keys(skipped)) sk[k] = [...skipped[k]].sort(cmp);
    return { routes, skipped: sk };
  }

  // ---------- API 부르기 ----------
  class ApiError extends Error {}

  function parsePage(text) {
    let data;
    try { data = JSON.parse(text); } catch (e) {
      const m = text.match(/<returnAuthMsg>([^<]+)<\/returnAuthMsg>|<resultMsg>([^<]+)<\/resultMsg>/);
      throw new ApiError("API 가 JSON 이 아닌 답을 줬다: " + (m ? (m[1] || m[2]) : text.trim().slice(0, 120)));
    }
    if (data && data.response) data = data.response.body || data.response;
    const code = String(data.resultCode ?? (data.header && data.header.resultCode) ?? "00");
    if (code !== "00" && code !== "0") throw new ApiError(`API 오류 ${code}: ${data.resultMsg || ""}`);
    let items = data.items || {};
    items = Array.isArray(items) ? items : (items.item || []);
    if (!Array.isArray(items)) items = [items];
    return { items, total: Number(data.totalCount) || items.length };
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 키로 모든 지역의 휴게소 충전기를 받는다. onProgress(받은 지역 수, 전체 지역 수). 키는 오류 글에 넣지 않는다
  async function fetchAll(key, cfg, opts) {
    opts = opts || {};
    const doFetch = opts.fetch || fetch;
    const wait = opts.wait ?? 3000;
    const zcodes = cfg.zcodes || [...new Set(Object.values(cfg.highways).flatMap((h) => h.zcodes))].sort();
    const k = key.includes("%") ? key : encodeURIComponent(key);
    const items = [];
    let done = 0;
    for (const z of zcodes) {
      let page = 1, got = 0;
      for (;;) {
        const q = new URLSearchParams({ pageNo: page, numOfRows: 9999, zcode: z, kindDetail: "C001", dataType: "JSON" });
        let text = null, lastErr = "";
        for (let n = 1; n <= 3 && text === null; n++) {
          try {
            const r = await doFetch(`${cfg.endpoint}?serviceKey=${k}&${q}`);
            if (r.ok) text = await r.text();
            else { lastErr = `HTTP ${r.status} (지역 ${z})`; if (r.status < 500) break; }
          } catch (e) { lastErr = `연결 실패 (지역 ${z})`; }
          if (text === null && n < 3) await sleep(wait * n);
        }
        if (text === null) throw new ApiError(lastErr);
        const { items: part, total } = parsePage(text);
        items.push(...part);
        got += part.length;
        if (!part.length || got >= total) break;
        page += 1;
      }
      done += 1;
      if (opts.onProgress) opts.onProgress(done, zcodes.length);
    }
    return items;
  }

  // 받아서 live.js 와 같은 모양으로
  async function refresh(key, cfg, opts) {
    const items = await fetchAll(key, cfg, opts);
    const now = (opts && opts.now) || Date.now();
    const { routes, skipped } = buildRoutes(items, now, cfg);
    return {
      fetched_at: now, source: "한국환경공단 전기자동차 충전소 정보(공공데이터포털)",
      price_note: cfg.price_note, routes, skipped, config: cfg, item_count: items.length,
    };
  }

  // ---------- 지금 위치(GPS) → 고속도로·km ----------
  // 선에서 cfg.max_offset_km(기본 2km) 안의 고속도로를 가까운 순으로. 방향마다 그 방향 노선의 km 를 준다.
  // nearest 는 범위 밖이어도 가장 가까운 고속도로(“고속도로 위가 아니에요” 안내용).
  function locate(point, cfg) {
    const limit = cfg.max_offset_km || 2;
    const all = Object.keys(cfg.highways).map((hk) => {
      const hw = cfg.highways[hk];
      const [along, off] = project(point, hw.points);
      const length = lineLength(hw.points);
      return {
        hk, highway: hw.name, off, along, length,
        sides: [
          { key: hw.forward.key, direction: hw.forward.direction, km: along },
          { key: hw.backward.key, direction: hw.backward.direction, km: length - along },
        ],
      };
    }).sort((a, b) => a.off - b.off || cmp(a.hk, b.hk));
    // ranked: 모든 고속도로를 가까운 순으로(고속도로 밖에서도 가까운 것부터 골라 방향을 정할 수 있게)
    return { candidates: all.filter((c) => c.off <= limit), nearest: all[0] || null, ranked: all };
  }
  // 방향 고르기: 지금 보고 있는 노선이 후보 고속도로에 있으면 그 방향을 그대로 쓴다. 없으면 null(사람이 고른다).
  function keepSide(candidates, currentKey) {
    for (const c of candidates) for (const s of c.sides) if (s.key === currentKey) return { cand: c, side: s };
    return null;
  }

  return { buildRoutes, fetchAll, refresh, parsePage, baseName, directionOf, project, pyRound, ApiError, locate, keepSide };
});
