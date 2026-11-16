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

  return { ANDROID_BASE, NOTE_MIN, DROP_MIN, FUTURE_MIN, POOL, KEY_ON, KEY_BASE, NOTE_FALLBACK, NOTE_SUSPECT, RelayError };
});
