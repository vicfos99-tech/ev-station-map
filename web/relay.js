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
  const ANDROID_BASE = "https://vicfos99-tech.github.io/ev-station-map/relay/";
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

  // 페이지가 http(s) 면 페이지 기준 ./relay/, 아니면 ANDROID_BASE. 던지지 않는다.
  function defaultBase(href) {
    try {
      if (typeof href === "string" && /^https?:\/\//i.test(href)) return new URL("./relay/", href).href;
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

  return {
    ANDROID_BASE, NOTE_MIN, DROP_MIN, FUTURE_MIN, POOL, KEY_ON, KEY_BASE, NOTE_FALLBACK, NOTE_SUSPECT, RelayError,
    defaultBase, checkBase, loadSettings, saveOn, saveBase, baseOf,
    kstMs, trustAt, ageMs, level, staleNote, cleanText, metaNote,
    urlOf, getJson, parseMeta, parseRoutes, parseStations, parseStatus, parseRest,
  };
});
