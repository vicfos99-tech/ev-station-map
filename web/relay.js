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

  return {
    ANDROID_BASE, NOTE_MIN, DROP_MIN, FUTURE_MIN, POOL, KEY_ON, KEY_BASE, NOTE_FALLBACK, NOTE_SUSPECT, RelayError,
    defaultBase, checkBase, loadSettings, saveOn, saveBase, baseOf,
  };
});
