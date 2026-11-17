/*
 * 공공 데이터 중계(집 PC 가 올린 정적 파일)를 읽는 순수 함수 모음. 브라우저 전역 EvRelay, Node 에서는 모듈로 불러온다.
 * 설정·주소(r1), 시각·신선함(r2), 읽기와 모양 검사(r3)가 있다. 나머지는 뒤 부분이 채운다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.EvRelay = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  const ANDROID_BASE = "https://raw.githubusercontent.com/vicfos99-tech/ev-station-map/relay-data/";
  const SITE_RELAY = "https://vicfos99-tech.github.io/ev-station-map/relay/"; // 우리 사이트의 옛 중계 폴더(더는 읽지 않는다)
  const SITE_HOST = SITE_RELAY.split("/")[2]; // 이 호스트에서 열렸으면 중계 페이지를 바로 읽는다
  const NOTE_MIN = 15;
  const DROP_MIN = 30;
  const FUTURE_MIN = 5;
  const POOL = 6;
  const KEY_ON = "ev-charge-planner/relay";
  const KEY_BASE = "ev-charge-planner/relay-base";
  const NOTE_FALLBACK = "중계에 연결하지 못해 직접 받았어요";
  const NOTE_SUSPECT = "이 지역은 충전소 목록을 확인하는 중이라 빠진 곳이 있을 수 있어요.";

  class RelayError extends Error {
    constructor(code, message) {
      super(message || code);
      this.name = "RelayError";
      this.code = code;
    }
  }

  const REASON_HTTPS = "주소는 https:// 로 시작해야 해요.";
  const REASON_SHAPE = "주소 모양이 맞지 않아요. https://사이트/폴더/ 처럼 적어 주세요.";
  const REASON_STORE = "이 화면에서는 저장되지 않습니다. 크롬이나 삼성 인터넷으로 열어 주세요.";

  // 우리 사이트나 폰 앱 화면(https://localhost/)이면 ANDROID_BASE, 그 밖의 http(s) 페이지는 페이지 기준 ./relay/. 던지지 않는다.
  function defaultBase(href) {
    try {
      if (typeof href === "string" && /^https?:\/\//i.test(href)) {
        const u = new URL(href);
        if (u.hostname === SITE_HOST) return ANDROID_BASE;
        if (u.protocol === "https:" && u.hostname === "localhost" && u.port === "") return ANDROID_BASE;
        return new URL("./relay/", href).href;
      }
    } catch (e) { /* 풀 수 없는 주소 */ }
    return ANDROID_BASE;
  }

  // {ok:true, base} | {ok:false, reason}. 까닭 글에 입력을 넣지 않는다.
  function checkBase(text) {
    if (text === null || text === undefined) return { ok: true, base: "" };
    if (typeof text !== "string") return { ok: false, reason: REASON_SHAPE };
    const t = text.trim();
    if (t === "") return { ok: true, base: "" };
    if (!/^https:\/\//i.test(t)) return { ok: false, reason: REASON_HTTPS };
    if (/[\s\u0000-\u001f\u007f<>"'`\\?#@]/.test(t)) return { ok: false, reason: REASON_SHAPE };
    let href;
    try { href = new URL(t).href; } catch (e) { return { ok: false, reason: REASON_SHAPE }; }
    if (!href.endsWith("/")) href += "/";
    return { ok: true, base: href };
  }

  function loadSettings(storage) {
    try {
      const on = storage.getItem(KEY_ON) !== "off";
      const c = checkBase(storage.getItem(KEY_BASE));
      return { on, base: c.ok ? c.base : "" };
    } catch (e) {
      return { on: true, base: "" };
    }
  }

  function saveOn(storage, on) {
    try {
      storage.setItem(KEY_ON, on ? "on" : "off");
      return true;
    } catch (e) {
      return false;
    }
  }

  function saveBase(storage, text) {
    const c = checkBase(text);
    if (!c.ok) return { ok: false, reason: c.reason, base: null };
    try {
      if (c.base === "") storage.removeItem(KEY_BASE);
      else storage.setItem(KEY_BASE, c.base);
    } catch (e) {
      return { ok: false, reason: REASON_STORE, base: null };
    }
    return { ok: true, reason: "", base: c.base };
  }

  function baseOf(settings, href) {
    if (settings && typeof settings.base === "string" && settings.base !== "") return settings.base;
    return defaultBase(href);
  }

  const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

  // 한국 시각 14자리 글자 → 밀리초. 못 읽으면 null
  function kstMs(v) {
    if (typeof v !== "string" || !/^[0-9]{14}$/.test(v)) return null;
    const n = (a, b) => Number(v.slice(a, b));
    const y = n(0, 4), mo = n(4, 6), d = n(6, 8), hh = n(8, 10), mi = n(10, 12), ss = n(12, 14);
    if (y < 2000 || mo < 1 || mo > 12 || d < 1 || hh > 23 || mi > 59 || ss > 59) return null;
    const ms = Date.UTC(y, mo - 1, d, hh - 9, mi, ss);
    const back = new Date(ms + 9 * 3600000);
    if (back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
    return ms;
  }

  // 확인 시각: meta 가 보증하면 meta.at 과 파일 at 중 늦은 쪽, 아니면 파일 at
  function trustAt(meta, fileAt, zcodes) {
    const f = typeof fileAt === "number" ? (Number.isFinite(fileAt) ? fileAt : null) : kstMs(fileAt);
    if (f === null) return { at: null, by: "none" };
    const m = isObj(meta) && meta.ok === true ? kstMs(meta.at) : null;
    let vouch = m !== null;
    if (vouch && zcodes !== undefined && zcodes !== null) {
      const fresh = Array.isArray(meta.fresh) ? meta.fresh : [];
      vouch = Array.isArray(zcodes) && zcodes.length > 0 && zcodes.every((z) => fresh.includes(z));
    }
    return vouch ? { at: Math.max(m, f), by: "meta" } : { at: f, by: "file" };
  }

  // 지금에서 얼마나 지났나(밀리초). 모르거나 FUTURE_MIN 넘게 앞서 있으면 null, 조금 앞서 있으면 0
  function ageMs(now, t) {
    if (typeof t !== "number" || !Number.isFinite(t) || typeof now !== "number" || !Number.isFinite(now)) return null;
    const d = now - t;
    if (d < -FUTURE_MIN * 60000) return null;
    return d < 0 ? 0 : d;
  }

  function level(now, t) {
    const a = ageMs(now, t);
    if (a === null || a > DROP_MIN * 60000) return "drop";
    return a > NOTE_MIN * 60000 ? "old" : "fresh";
  }

  function agoText(a) {
    const min = Math.floor(a / 60000);
    if (min < 60) return `${min}분 전`;
    if (min < 1440) return `${Math.floor(min / 60)}시간 전`;
    return `${Math.floor(min / 1440)}일 전`;
  }

  function staleNote(now, t) {
    const a = ageMs(now, t), lv = level(now, t);
    if (lv === "fresh") return "";
    if (a === null) return "상태 시각을 알 수 없어 빈자리를 세지 않았어요.";
    return lv === "old" ? `${agoText(a)} 상태예요.` : `${agoText(a)} 상태라 빈자리를 세지 않았어요.`;
  }

  // 오류 까닭에서 주소·키를 가리고 길이를 자른다
  function cleanText(s, max) {
    if (typeof s !== "string") return "";
    const lim = typeof max === "number" && max > 0 ? Math.floor(max) : 60;
    let t = s.replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, "(주소)")
      .replace(/(service_?key|api_?key|key|token|authorization)\s*[=:]\s*\S+/gi, "$1=(가림)")
      .replace(/[A-Za-z0-9%+\/=_-]{20,}/g, "(가림)")
      .replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
    if (t.length > lim) t = t.slice(0, lim) + "…";
    return t;
  }

  function metaNote(meta) {
    if (!isObj(meta) || meta.ok === true) return "";
    const why = cleanText(meta.error);
    return why ? `중계가 마지막 받기에 실패했어요(${why}).` : "중계가 마지막 받기에 실패했어요.";
  }

  // ---------- 읽기와 모양 검사 ----------
  const STAT_UNKNOWN = "comm_error";
  const KNOWN_STATUS = ["available", "charging", "out_of_service", "maintenance", "comm_error"];
  const MSG = { network: "중계에 연결하지 못했어요", missing: "중계에 파일이 없어요", shape: "중계 파일을 읽지 못했어요" };
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const shape = () => new RelayError("shape", MSG.shape);
  const RE_Z = /^[0-9]{5}$/, RE_ID = /^[A-Za-z0-9_-]{1,40}$/;

  function urlOf(base, kind, id) {
    if (typeof base !== "string" || !/^https?:\/\/\S+\/$/i.test(base)) throw new RelayError("bad_base", "중계 주소가 맞지 않아요");
    if (kind === "meta") return base + "meta.json";
    if (kind === "routes") return base + "routes.json";
    if (kind !== "stations" && kind !== "status" && kind !== "rest") throw new RelayError("bad_kind", "모르는 중계 파일이에요");
    if (typeof id !== "string" || !(kind === "rest" ? RE_ID : RE_Z).test(id)) throw new RelayError("bad_id", "중계 파일 이름이 맞지 않아요");
    return base + (kind === "stations" ? `stations/${id}.json` : kind === "status" ? `status/${id}.json` : `status/rest/${id}.json`);
  }

  // 받은 글이 든 예외를 잇지 않으려고 catch 블록 밖에서 새 예외를 던진다.
  async function getJson(url, opts) {
    const doFetch = (opts && opts.fetch) || fetch;
    let r, text;
    try { r = await doFetch(url, { cache: "no-cache" }); } catch (e) {
      if (e && e.name === "AbortError") throw e;
      throw new RelayError("network", MSG.network);
    }
    if (!r || !r.ok) {
      const status = r && Number.isInteger(r.status) ? r.status : 0;
      if (status === 404) throw new RelayError("missing", MSG.missing);
      throw new RelayError("http", `중계가 ${status} 로 답했어요`);
    }
    try { text = await r.text(); } catch (e) { throw new RelayError("network", MSG.network); }
    try { return JSON.parse(text); } catch (e) { /* 아래에서 던진다 */ }
    throw shape();
  }

  const str = (v) => typeof v === "string";
  const fin = (v) => typeof v === "number" && Number.isFinite(v);
  const strs = (v) => (Array.isArray(v) ? v.filter(str) : []);
  function locOf(v) {
    if (!Array.isArray(v) || v.length < 2 || !fin(v[0]) || !fin(v[1])) return null;
    if (Math.abs(v[0]) > 90 || Math.abs(v[1]) > 180 || (v[0] === 0 && v[1] === 0)) return null;
    return [v[0], v[1]];
  }

  function parseMeta(o) {
    if (!isObj(o) || o.v !== 1) throw shape();
    if (o.at !== null && kstMs(o.at) === null) throw shape();
    if (o.ok !== true && o.ok !== false) throw shape();
    return { v: 1, at: o.at, ok: o.ok, error: str(o.error) ? o.error : "", suspect: strs(o.suspect), fresh: strs(o.fresh) };
  }

  function parseRoutes(o) {
    if (!isObj(o) || o.v !== 1 || !fin(o.fetched_at) || !Array.isArray(o.routes) || o.routes.length === 0) throw shape();
    const routes = o.routes.map((r) => {
      if (!isObj(r) || !str(r.key) || !r.key || !str(r.highway) || !str(r.direction) || !fin(r.length) || r.length < 0 || !Array.isArray(r.rest_areas)) throw shape();
      const rest_areas = r.rest_areas.map((a) => {
        if (!isObj(a) || !str(a.id) || !a.id || !str(a.name) || !fin(a.km) || !Array.isArray(a.stations)) throw shape();
        const area = { name: a.name, km: a.km };
        const loc = locOf(a.loc);
        if (loc) area.loc = loc;
        area.stations = a.stations.map((s) => {
          if (!isObj(s) || !str(s.id) || !s.id || !str(s.operator) || !fin(s.price) || s.price < 0 || !fin(s.updated) || !Array.isArray(s.chargers)) throw shape();
          const st = { id: s.id, operator: s.operator.trim() || "알 수 없음", price: s.price, updated: s.updated };
          st.chargers = s.chargers.map((c) => {
            if (!isObj(c) || !fin(c.power_kw) || c.power_kw <= 0) throw shape();
            const ch = { type: c.type === "fast" ? "fast" : "slow", power_kw: c.power_kw, status: KNOWN_STATUS.includes(c.status) ? c.status : STAT_UNKNOWN };
            if (fin(c.last_end) && c.last_end > 0) ch.last_end = c.last_end;
            return ch;
          });
          const sl = locOf(s.loc);
          if (sl) st.loc = sl;
          st.maker = str(s.maker) ? s.maker : "";
          return st;
        });
        area.id = a.id;
        return area;
      });
      return { key: r.key, highway: r.highway, direction: r.direction, length: r.length, live: true, rest_areas };
    });
    return { v: 1, fetched_at: o.fetched_at, source: str(o.source) ? o.source : "", price_note: str(o.price_note) ? o.price_note : "", routes, skipped: isObj(o.skipped) ? o.skipped : {} };
  }

  function parseStations(o, zscode) {
    if (!isObj(o) || o.v !== 1 || !str(zscode) || o.zscode !== zscode || !Array.isArray(o.stations)) throw shape();
    const stations = o.stations.map((s) => {
      const loc = isObj(s) ? locOf(s.loc) : null;
      if (!loc || !str(s.id) || !s.id || !Array.isArray(s.chargers)) throw shape();
      const st = { id: s.id, name: str(s.name) ? s.name.trim() : "", operator: (str(s.operator) && s.operator.trim()) || "알 수 없음", maker: str(s.maker) ? s.maker : "", loc };
      st.chargers = s.chargers.map((c) => {
        if (!isObj(c) || !str(c.id) || !fin(c.kw) || c.kw <= 0) throw shape();
        return { id: c.id, type: c.type === "fast" ? "fast" : "slow", kw: c.kw };
      });
      if (s.indoor === true) st.indoor = true;
      if (s.rest === true) st.rest = true;
      return st;
    });
    return { v: 1, zscode, zcodes: strs(o.zcodes), stations };
  }

  function parseStatus(o) {
    if (!isObj(o) || (own(o, "v") && o.v !== 1) || kstMs(o.at) === null || !isObj(o.s)) throw shape();
    const s = Object.create(null);
    for (const sid of Object.keys(o.s)) {
      if (!isObj(o.s[sid])) continue; // 모양이 다른 충전소는 모름으로 둔다
      const m = Object.create(null);
      for (const cid of Object.keys(o.s[sid])) {
        const e = o.s[sid][cid];
        m[cid] = Array.isArray(e) && str(e[0]) ? e[0] : "9";
      }
      s[sid] = m;
    }
    return { at: o.at, s };
  }

  function parseRest(o, id) {
    if (!isObj(o) || (own(o, "v") && o.v !== 1) || !str(id) || o.rest !== id || kstMs(o.at) === null || !Array.isArray(o.chargers)) throw shape();
    const chargers = o.chargers.map((c) => {
      if (!isObj(c)) throw shape();
      return { id: str(c.chgerId) ? c.chgerId : "", stat: str(c.stat) ? c.stat : "9", last_end: kstMs(c.lastTedt) };
    });
    chargers.sort((a, b) => cmp(a.id, b.id));
    return { rest: id, at: o.at, chargers };
  }

  // ---------- 휴게소 새로 받기 ----------
  const STAT = { 1: "comm_error", 2: "available", 3: "charging", 4: "out_of_service", 5: "maintenance", 9: "comm_error" };
  const UNKNOWN = STAT_UNKNOWN;
  const statusOf = (stat) => (own(STAT, stat) ? STAT[stat] : UNKNOWN);
  const stationsIn = (route) => (isObj(route) && Array.isArray(route.rest_areas) ? route.rest_areas : []).flatMap((a) => (isObj(a) && Array.isArray(a.stations) ? a.stations : []));

  function wantedIds(routes, routeKey, extraIds) {
    const all = new Set(routes.flatMap(stationsIn).map((s) => s.id));
    const out = [];
    const add = (id) => { if (all.has(id) && !out.includes(id)) out.push(id); };
    const cur = routes.find((r) => r.key === routeKey);
    if (cur) stationsIn(cur).forEach((s) => add(s.id));
    if (Array.isArray(extraIds)) extraIds.forEach((id) => { if (str(id)) add(id); });
    if (!out.length && routes.length) stationsIn(routes[0]).forEach((s) => add(s.id));
    return out;
  }

  // 확인 시각이 DROP_MIN 넘게 지난 충전소의 충전기를 상태 미확인으로 바꾼다 → 바꾼 충전소 수
  function expire(stations, now) {
    let n = 0;
    for (const st of Array.isArray(stations) ? stations : []) {
      if (!isObj(st) || !Array.isArray(st.chargers) || level(now, st.updated) !== "drop") continue;
      let hit = false;
      for (const c of st.chargers) if (isObj(c) && c.status !== UNKNOWN) { c.status = UNKNOWN; hit = true; }
      if (hit) n += 1;
    }
    return n;
  }

  function expireLive(live, now) {
    if (!isObj(live) || !isObj(live.relay) || !Array.isArray(live.routes)) return 0;
    let n = 0;
    for (const r of live.routes) n += expire(stationsIn(r), now);
    return n;
  }

  function buildLive(routesDoc, restById, meta, o) {
    const now = o.now, want = new Set(o.wanted || []);
    const metaOk = isObj(meta) && meta.ok === true;
    const info = { at: metaOk ? kstMs(meta.at) : null, ok: metaOk, ids: [], missing: [], mixed: [], oldest: null };
    let count = 0;
    const routes = routesDoc.routes.map((r) => Object.assign({}, r, {
      rest_areas: r.rest_areas.map((a) => Object.assign({}, a, a.loc ? { loc: a.loc.slice() } : {}, {
        stations: a.stations.map((s) => {
          const st = Object.assign({}, s, { chargers: s.chargers.map((c) => Object.assign({}, c)) }, s.loc ? { loc: s.loc.slice() } : {});
          count += st.chargers.length;
          const doc = want.has(st.id) && restById && own(restById, st.id) ? restById[st.id] : null;
          if (doc) {
            const types = new Set(st.chargers.map((c) => c.type)), n = st.chargers.length, m = doc.chargers.length;
            if (n > 0 && types.size === 1 && m <= n) {
              st.chargers.forEach((c, i) => {
                if (i < m) {
                  c.status = statusOf(doc.chargers[i].stat);
                  if (doc.chargers[i].last_end !== null) c.last_end = doc.chargers[i].last_end;
                } else c.status = UNKNOWN;
              });
            } else {
              st.chargers.forEach((c) => { c.status = UNKNOWN; });
              info.mixed.push(st.id);
            }
            st.updated = trustAt(meta, doc.at).at;
            info.ids.push(st.id);
            if (info.oldest === null || st.updated < info.oldest) info.oldest = st.updated;
          } else if (want.has(st.id)) info.missing.push(st.id);
          return st;
        }),
      })),
    }));
    const live = { fetched_at: now, source: routesDoc.source, price_note: routesDoc.price_note, routes, skipped: routesDoc.skipped, config: o.config || null, item_count: count, relay: info };
    expireLive(live, now);
    return live;
  }

  function routeHint(live, ids) {
    if (!isObj(live) || !isObj(live.relay) || !Array.isArray(live.relay.ids) || !Array.isArray(ids) || !ids.length) return "";
    return ids.some((id) => live.relay.ids.includes(id)) ? "" : "이 노선의 상태는 아직 받지 않았어요. '새로 받기'를 눌러 주세요.";
  }

  async function pool(items, size, fn) {
    let next = 0;
    async function worker() { while (next < items.length) { const i = next++; await fn(items[i], i); } }
    await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  }

  const nowOf = (o) => (fin(o.now) ? o.now : Date.now());

  async function readRest(o) {
    const base = baseOf(o.settings, o.href), f = { fetch: o.fetch };
    const meta = parseMeta(await getJson(urlOf(base, "meta"), f));
    const routesDoc = parseRoutes(await getJson(urlOf(base, "routes"), f));
    const ids = wantedIds(routesDoc.routes, o.routeKey, o.extraIds);
    const restById = {};
    let done = 0;
    await pool(ids, POOL, async (id) => {
      if (RE_ID.test(id)) {
        let doc = null;
        try { doc = await getJson(urlOf(base, "rest", id), f); } catch (e) {
          if (!(e instanceof RelayError) || e.code !== "missing") throw e;
        }
        if (doc !== null) restById[id] = parseRest(doc, id);
      }
      done += 1;
      if (typeof o.onProgress === "function") o.onProgress(done, ids.length);
    });
    if (ids.length && !Object.keys(restById).length) throw new RelayError("missing", MSG.missing);
    const now = nowOf(o);
    const live = buildLive(routesDoc, restById, meta, { now, wanted: ids, config: o.config });
    const notes = [metaNote(meta), live.relay.oldest === null ? "" : staleNote(now, live.relay.oldest)];
    if (live.relay.missing.length) notes.push(`충전소 ${live.relay.missing.length}곳은 상태 파일이 없어 미확인이에요.`);
    if (live.relay.mixed.length) notes.push(`충전소 ${live.relay.mixed.length}곳은 충전기 목록이 달라 미확인이에요.`);
    const note = notes.filter(Boolean).join(" ");
    return { live, source: "relay", note, tone: note ? "warn" : "good" };
  }

  const failed = (e) => new RelayError("relay_failed", `${e.message}. 공공 데이터 키를 넣으면 직접 받을 수 있어요.`);

  async function refreshRest(o) {
    const s = o.settings || { on: true, base: "" }, canDirect = !!o.key && typeof o.direct === "function";
    if (!s.on) {
      if (!o.key) throw new RelayError("no_key", "인증키가 필요해요");
      if (typeof o.direct !== "function") throw new RelayError("no_direct", "직접 받기 설정이 없어요");
      return { live: await o.direct(), source: "direct", note: "", tone: "good" };
    }
    let err = null;
    try { return await readRest(o); } catch (e) {
      if (!(e instanceof RelayError)) throw e;
      err = e;
    }
    if (!canDirect) throw failed(err);
    return { live: await o.direct(), source: "direct", note: NOTE_FALLBACK, tone: "warn" };
  }

  // ---------- 지도 주변 충전소 ----------
  const toStat = (v) => (str(v) ? statusOf(v) : UNKNOWN);

  // 충전기 상태를 상태 파일대로 고친다(확인 시각이 오래되었으면 미확인). 바뀐 충전기 수
  function overlayRegion(stations, statusDoc, t, now) {
    const drop = level(now, t) === "drop";
    const sm = isObj(statusDoc) && statusDoc.s && typeof statusDoc.s === "object" ? statusDoc.s : null;
    let n = 0;
    for (const st of Array.isArray(stations) ? stations : []) {
      if (!isObj(st)) continue;
      const m = sm && own(sm, st.id) && sm[st.id] && typeof sm[st.id] === "object" ? sm[st.id] : null;
      for (const c of Array.isArray(st.chargers) ? st.chargers : []) {
        if (!isObj(c)) continue;
        const next = drop || !m || !own(m, c.id) ? UNKNOWN : toStat(m[c.id]);
        if (c.status !== next) { c.status = next; n += 1; }
      }
      st.updated = t;
    }
    return n;
  }

  function priceOf(tariffs, operator) {
    if (!isObj(tariffs)) return null;
    if (own(tariffs, operator) && fin(tariffs[operator])) return tariffs[operator];
    return own(tariffs, "default") && fin(tariffs.default) ? tariffs.default : null;
  }

  function regionStations(stDoc, statusDoc, meta, o) {
    const now = nowOf(o || {}), tariffs = o ? o.tariffs : null;
    const t = trustAt(meta, statusDoc && statusDoc.at, stDoc && stDoc.zcodes).at;
    const list = [];
    for (const s of stDoc.stations) {
      if (!s.chargers.some((c) => c.type === "fast")) continue;
      const st = {
        id: s.id, name: s.name, operator: s.operator, maker: s.maker, addr: "", price: priceOf(tariffs, s.operator),
        loc: [Number(s.loc[0].toFixed(5)), Number(s.loc[1].toFixed(5))], updated: t,
        chargers: s.chargers.map((c) => ({ id: c.id, type: c.type, power_kw: c.kw, status: UNKNOWN })),
      };
      if (s.indoor === true) st.indoor = true;
      list.push(st);
    }
    overlayRegion(list, statusDoc, t, now);
    return list;
  }

  const directRegion = (o, r, note) => ({ zscode: o.zscode, stations: r.stations, fetched_at: r.fetched_at, status_at: r.fetched_at, zcodes: [], source: "direct", note, suspect: false });

  function offCheck(o) {
    if (!o.key) throw new RelayError("no_key", "인증키가 필요해요");
    if (typeof o.direct !== "function") throw new RelayError("no_direct", "직접 받기 설정이 없어요");
  }

  async function readRegion(o) {
    const base = baseOf(o.settings, o.href), f = { fetch: o.fetch };
    const urlMeta = urlOf(base, "meta"), urlSt = urlOf(base, "stations", o.zscode), urlSa = urlOf(base, "status", o.zscode);
    const meta = parseMeta(await getJson(urlMeta, f));
    const stDoc = parseStations(await getJson(urlSt, f), o.zscode);
    const statusDoc = parseStatus(await getJson(urlSa, f));
    const now = nowOf(o), t = trustAt(meta, statusDoc.at, stDoc.zcodes).at;
    const stations = regionStations(stDoc, statusDoc, meta, { now, tariffs: o.tariffs });
    const sus = meta.suspect;
    const suspect = sus.includes(String(o.zscode).slice(0, 2)) || stDoc.zcodes.some((z) => sus.includes(z));
    const note = [metaNote(meta), staleNote(now, t), suspect ? NOTE_SUSPECT : ""].filter(Boolean).join(" ");
    return { zscode: o.zscode, stations, fetched_at: now, status_at: t, zcodes: stDoc.zcodes, source: "relay", note, suspect };
  }

  async function loadRegion(o) {
    const s = o.settings || { on: true, base: "" }, canDirect = !!o.key && typeof o.direct === "function";
    if (!s.on) {
      offCheck(o);
      return directRegion(o, await o.direct(), "");
    }
    let err = null;
    try { return await readRegion(o); } catch (e) {
      if (!(e instanceof RelayError)) throw e;
      err = e;
    }
    if (!canDirect) throw failed(err);
    return directRegion(o, await o.direct(), NOTE_FALLBACK);
  }

  async function readStatusOnly(o, region) {
    const base = baseOf(o.settings, o.href), f = { fetch: o.fetch };
    const urlMeta = urlOf(base, "meta"), urlSa = urlOf(base, "status", o.zscode);
    const meta = parseMeta(await getJson(urlMeta, f));
    const statusDoc = parseStatus(await getJson(urlSa, f));
    const now = nowOf(o), t = trustAt(meta, statusDoc.at, region.zcodes).at;
    const changed = overlayRegion(region.stations, statusDoc, t, now);
    const note = [metaNote(meta), staleNote(now, t)].filter(Boolean).join(" ");
    return { changed, status_at: t, source: "relay", failed: false, replaced: null, note };
  }

  async function refreshRegion(o) {
    const s = o.settings || { on: true, base: "" }, canDirect = !!o.key && typeof o.direct === "function";
    const region = isObj(o.region) ? o.region : {};
    if (!s.on) {
      offCheck(o);
      return { changed: 0, status_at: null, source: "direct", failed: false, replaced: directRegion(o, await o.direct(), ""), note: "" };
    }
    let err = null;
    try { return await readStatusOnly(o, region); } catch (e) {
      if (!(e instanceof RelayError)) throw e;
      err = e;
    }
    if (canDirect) {
      return { changed: 0, status_at: null, source: "direct", failed: true, replaced: directRegion(o, await o.direct(), NOTE_FALLBACK), note: NOTE_FALLBACK };
    }
    const now = nowOf(o);
    const changed = expire(region.stations, now);
    const stale = staleNote(now, region.status_at);
    const note = `${err.message}.` + (stale ? ` ${stale}` : "");
    return { changed, status_at: region.status_at, source: "relay", failed: true, replaced: null, note };
  }

  // ---------- r6 글자 안전 ----------
  const esc = (s) => (s === null || s === undefined ? "" : String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]));
  const numTxt = (x) => (fin(x) ? String(x) : "?");
  const toneOk = (t) => (t === "good" || t === "busy" ? t : "bad");
  function bubbleHtml(o) {
    o = o || {};
    const role = o.role === "primary" || o.role === "backup" ? o.role : "", dx = fin(o.dx) ? Math.round(o.dx) : 0;
    return `<div class="mk" data-tone="${toneOk(o.tone)}"${role ? ` data-role="${role}"` : ""}${o.far ? ' data-far="true"' : ""}${o.around ? ' data-around="true"' : ""}${dx ? ` style="margin-left:${dx}px"` : ""}>`
      + `<span class="mk-top">${esc(o.top)}</span><b class="num">${numTxt(o.free)}<i>/${numTxt(o.total)}</i></b>`
      + (o.sub ? `<span class="mk-sub">${esc(o.sub)}</span>` : "") + "</div>";
  }
  const lineHtml = (o) => { o = o || {}; return `<div class="mk mk-line" data-around="true" data-tone="${toneOk(o.tone)}"><span class="mk-top">${esc(o.top)}</span><b class="num">${numTxt(o.free)}<i>/${numTxt(o.total)}</i></b></div>`; };
  const dotHtml = (o) => { o = o || {}; return `<div class="mk-dot num" data-tone="${toneOk(o.tone)}"${o.far ? ' data-far="true"' : ""}>${numTxt(o.free)}</div>`; };
  function popupHtml(lines) {
    const out = [];
    for (const l of Array.isArray(lines) ? lines : []) {
      if (l === null || l === undefined || l === "" || l === false) continue;
      out.push(isObj(l) ? `<b>${esc(l.b)}</b>` : esc(l));
    }
    return `<div class="mk-pop">${out.join("<br>")}</div>`;
  }

  return {
    ANDROID_BASE, NOTE_MIN, DROP_MIN, FUTURE_MIN, POOL, KEY_ON, KEY_BASE, NOTE_FALLBACK, NOTE_SUSPECT, RelayError,
    defaultBase, checkBase, loadSettings, saveOn, saveBase, baseOf,
    kstMs, trustAt, ageMs, level, staleNote, cleanText, metaNote,
    urlOf, getJson, parseMeta, parseRoutes, parseStations, parseStatus, parseRest,
    wantedIds, buildLive, expire, expireLive, routeHint, refreshRest,
    overlayRegion, regionStations, loadRegion, refreshRegion,
    esc, bubbleHtml, lineHtml, dotHtml, popupHtml,
  };
});
