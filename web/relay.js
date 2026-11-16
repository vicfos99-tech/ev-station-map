/*
 * 공공 데이터 중계(집 PC 가 올린 정적 파일)를 읽는 순수 함수 모음. 브라우저 전역 EvRelay, Node 에서는 모듈로 불러온다.
 * 지금은 빈 틀(상수와 RelayError)만 있다. 나머지는 뒤 부분이 채운다.
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

  return {
    ANDROID_BASE, NOTE_MIN, DROP_MIN, FUTURE_MIN, POOL, KEY_ON, KEY_BASE, NOTE_FALLBACK, NOTE_SUSPECT, RelayError,
    defaultBase, checkBase, loadSettings, saveOn, saveBase, baseOf,
    kstMs, trustAt, ageMs, level, staleNote, cleanText, metaNote,
  };
});
