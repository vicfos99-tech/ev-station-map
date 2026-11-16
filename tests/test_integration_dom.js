/*
 * 가짜 화면(계획 세션 참조 dom_stub.js 를 그대로 옮김): 브라우저 없이 web/ 의 스크립트를 순서대로 불러 app.js 를 초기화하고 단추·폼을 눌러 본다.
 *   const app = boot({ scripts: [{ name, code }], storage: {키: 값}, href, now, fetch: async (url, init) => 응답 });
 *   app.el("#k-key").value = "KEY"; app.fire("#live-form", "submit"); await app.settle();
 *   app.el("#live-msg").textContent · app.calls() · app.errors() · app.tab("map") · app.leaf.map · app.leaf.groups · app.tick(180000)
 * 화면 요소는 무엇을 물어도 같은 가짜 요소를 준다(선택자마다 하나). 지도 도구(Leaflet)도 가짜: divIcon 은 받은 것을 그대로 돌려준다.
 */
"use strict";
const vm = require("vm");

function makeEl(tag, sel) {
  const handlers = {};
  const base = {
    tagName: String(tag || "div").toUpperCase(), _sel: sel || "", hidden: false, textContent: "", value: "", checked: false, disabled: false,
    placeholder: "", className: "", dataset: {}, style: {}, attrs: {}, children: [], options: [],
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }, removeAttribute(k) { delete this.attrs[k]; },
    addEventListener(t, f) { (handlers[t] = handlers[t] || []).push(f); }, removeEventListener() {},
    append(...c) { this.children.push(...c); }, appendChild(c) { this.children.push(c); return c; }, prepend(...c) { this.children.unshift(...c); },
    replaceChildren(...c) { this.children = c; }, remove() {}, focus() {}, blur() {}, click() { this._fire("click"); }, scrollIntoView() {},
    querySelector() { return makeEl("div"); }, querySelectorAll() { return []; }, closest() { return null; }, contains() { return false; },
    getBoundingClientRect() { return { top: 0, left: 0, right: 100, bottom: 100, width: 100, height: 100 }; },
    _fire(t, ev) { const e = Object.assign({ type: t, target: proxy, currentTarget: proxy, preventDefault() {}, stopPropagation() {} }, ev || {}); for (const f of handlers[t] || []) f(e); return (handlers[t] || []).length; },
  };
  const proxy = new Proxy(base, { get(t, p) { return p in t ? t[p] : undefined; } });
  return proxy;
}

function fakeLeaflet(rec) {
  const mk = (kind, extra) => {
    const o = Object.assign({ kind, addTo() { return o; }, on() { return o; }, bindPopup(html) { o.popup = html; return o; },
      setLatLng(l) { o.loc = l; return o; }, getLatLng() { return Array.isArray(o.loc) ? { lat: o.loc[0], lng: o.loc[1] } : o.loc; }, setRadius() { return o; } }, extra);
    return o;
  };
  const map = { _h: {}, zoom: 7, center: [36.3, 127.8],
    setView(c, z) { this.center = Array.isArray(c) ? c : [c.lat, c.lng]; if (z !== undefined) this.zoom = z; return this; },
    getZoom() { return this.zoom; }, getCenter() { return { lat: this.center[0], lng: this.center[1] }; },
    getBounds() { const c = this.center; const b = { pad() { return b; }, contains(l) { const p = Array.isArray(l) ? l : [l.lat, l.lng]; return Math.abs(p[0] - c[0]) < 0.5 && Math.abs(p[1] - c[1]) < 0.5; } }; return b; },
    on(t, f) { (this._h[t] = this._h[t] || []).push(f); return this; }, once() { return this; }, off() { return this; },
    fire(t) { for (const f of this._h[t] || []) f({}); },
    createPane() { return { style: {} }; }, getPane() { return { style: {} }; }, invalidateSize() {}, fitBounds() { return this; }, removeLayer() {}, addLayer() {} };
  rec.groups = [];
  return { map: () => { rec.map = map; return map; }, tileLayer: () => mk("tile"),
    layerGroup: () => { const g = mk("group", { layers: [], clearLayers() { g.layers = []; }, addLayer(l) { g.layers.push(l); } }); rec.groups.push(g); return g; },
    marker: (loc, o) => mk("marker", { loc, icon: o && o.icon }), divIcon: (o) => o, circle: (l) => mk("circle", { loc: l }), circleMarker: (l) => mk("circleMarker", { loc: l }),
    polyline: () => mk("line"), latLngBounds: (pts) => ({ pts }) };
}

function boot(o) {
  const els = new Map();
  const el = (sel) => { if (!els.has(sel)) els.set(sel, makeEl("div", sel)); return els.get(sel); };
  const tabs = ["route", "map", "my"].map((v) => { const t = makeEl("button"); t.dataset.view = v; return t; });
  const docHandlers = {};
  const store = new Map(Object.entries(o.storage || {}));
  const calls = [], errors = [], timers = [], leaf = {};
  const clock = { t: o.now };
  let pending = 0;
  class FakeDate extends Date {
    constructor(...a) { if (a.length) super(...a); else super(clock.t); }
    static now() { return clock.t; }
  }
  const fetchFn = (url, init) => {
    calls.push(String(url));
    pending += 1;
    return Promise.resolve().then(() => o.fetch(String(url), init)).finally(() => { pending -= 1; });
  };
  const document = {
    hidden: false, head: makeEl("head"), body: makeEl("body"), documentElement: makeEl("html"),
    querySelector: el, getElementById: (id) => el("#" + id),
    querySelectorAll: (sel) => (sel === ".tabbar [data-view]" ? tabs : []),
    createElement: (tag) => makeEl(tag), createTextNode: (t) => ({ text: String(t) }),
    addEventListener(t, f) { (docHandlers[t] = docHandlers[t] || []).push(f); }, removeEventListener() {},
  };
  const win = {
    document, console, Date: FakeDate,
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); } },
    navigator: { userAgent: "node" }, location: { href: o.href || "file:///android_asset/index.html" },
    fetch: fetchFn, URL, URLSearchParams,
    setTimeout: (f, ms) => setTimeout(f, Math.min(ms || 0, 5)), clearTimeout,
    setInterval: (f, ms) => { timers.push([f, ms]); return timers.length; }, clearInterval() {},
    addEventListener() {}, removeEventListener() {}, scrollTo() {}, isSecureContext: true,
    L: fakeLeaflet(leaf),
  };
  win.window = win; win.self = win; win.globalThis = win;
  const ctx = vm.createContext(win);
  const onRej = (e) => { errors.push("잡히지 않은 거절: " + (e && e.stack || e)); };
  process.on("unhandledRejection", onRej);
  for (const s of o.scripts) {
    try { vm.runInContext(s.code, ctx, { filename: s.name }); } catch (e) { errors.push(`${s.name}: ${e && e.stack || e}`); }
  }
  async function settle() {
    let quiet = 0;
    for (let i = 0; i < 2000 && quiet < 8; i++) { await new Promise((r) => setTimeout(r, 2)); quiet = pending === 0 ? quiet + 1 : 0; }
  }
  return { el, win, store, clock, leaf, tabs, calls: () => calls.slice(), errors: () => errors.slice(), settle,
    tab: (v) => tabs.find((t) => t.dataset.view === v)._fire("click"),
    tick: (ms) => { for (const [f, every] of timers) if (every === ms) f(); },
    fire: (sel, type, ev) => el(sel)._fire(type, ev),
    close: () => process.removeListener("unhandledRejection", onRej) };
}

module.exports = { boot };
