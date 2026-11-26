// 브라우저 없이 node 에서 앱을 조립해 돌리는 도구(try_a1·try_a2ga 가 함께 쓴다).
// 가짜 화면(아주 작은 DOM — innerHTML 로 꽂은 조각의 id 도 찾음)·가짜 창·가짜 지도 라이브러리·가짜 브라우저 파일 저장소·메모리 기록장,
// 판 목록 줍기(빌드와 같은 선언 무늬), 앱 하나 띄우기(startApp), 기다리기(waitFor).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { kstText } from './lib_tools.mjs';
import { loadAppConfig } from './lib_appfiles.mjs';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TAG_RX = /<(\w+)([^>]*)>/g;
const ID_RX = /\bid="([^"]+)"/;
const ATTR_RX = /\b(data-[a-z-]+)="([^"]*)"/g;

export class El {
  constructor(doc, tag, id) {
    this.doc = doc; this.tag = tag; this.id = id; this.textContent = ''; this.hidden = false;
    this.attrs = {}; this.listeners = {}; this.children = []; this.className = ''; this.html = '';
    // 가상 창에는 그림이 없다 — 폭은 0(시험이 정해 넣을 수 있음), 모양 값은 적어 두기만
    this.clientWidth = 0;
    const props = {};
    this.style = { props, setProperty(k, v) { props[k] = String(v); }, getPropertyValue(k) { return props[k] || ''; } };
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k]; }
  hasAttribute(k) { return k in this.attrs; }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  appendChild(c) { this.children.push(c); }
  insertBefore(c, ref) { const i = this.children.indexOf(ref); if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); }
  replaceChildren(...cs) { this.children = cs; }
  click() { for (const f of this.listeners.click || []) f(); }
  // (A6) 이벤트 하나를 그대로(엔터 키 등)
  fire(t, e) { for (const f of this.listeners[t] || []) f(e || {}); }
  set innerHTML(h) { this.html = String(h); if (this.doc) this.doc.register(this.html); }
  get innerHTML() { return this.html; }
}

export function fakeDoc(htmls) {
  const doc = {
    els: {}, visibilityState: 'visible', listeners: {},
    register(html) {
      for (const m of html.matchAll(TAG_RX)) {
        const id = (m[2].match(ID_RX) || [])[1];
        if (!id) continue;
        const el = new El(doc, m[1], id);
        el.hidden = /\shidden(\s|$|>)/.test(m[2] + ' ');
        for (const a of m[2].matchAll(ATTR_RX)) el.attrs[a[1]] = a[2];
        doc.els[id] = el;
      }
    },
    getElementById: (id) => doc.els[id] || null,
    createElement: (tag) => new El(doc, tag, ''),
    addEventListener(t, f) { (doc.listeners[t] = doc.listeners[t] || []).push(f); },
  };
  doc.body = new El(doc, 'body', 'body');
  for (const html of htmls) doc.register(html);
  return doc;
}

// 본문 화면 조각(판 조각은 빼고 — 판 조각은 판 틀이 꽂는다)
export function srcViews(app, tc) {
  const dir = path.join(app, tc.build.src_dir);
  const boardViews = new Set(boardNames(app, tc).map((n) => tc.build.view_prefix + n + tc.build.view_ext));
  return fs.readdirSync(dir).filter((n) => n.startsWith(tc.build.view_prefix) && !boardViews.has(n))
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'));
}

export function fakeWin() {
  // copied = 복사 단추가 넘긴 글(A4). navigator.clipboard 를 null 로 바꾸면 복사 실패 길
  const copied = [];
  return { innerWidth: 1280, innerHeight: 720, listeners: {}, copied, addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }, navigator: { clipboard: { writeText: async (t) => { copied.push(t); } } }, Blob, URL };
}

// 가짜 지도 라이브러리: 'load' 와 첫 그림 조각을 곧바로 알리고, 점 옮김(moves)·카메라 명령(jumps)·층 켬끔·번호 표시(Marker)를 적는다.
// user(종류, 값) = 손으로 만진 것처럼: 값을 바꾸고 시작 알림(originalEvent 있음) → moveend (A3 카메라 시험)
export function fakeMapLib(tileSourceId) {
  const maps = [];
  const markers = [];
  class Map {
    constructor(o) {
      this.o = o; this.h = {}; this.sources = {}; this.moves = []; this.jumps = []; this.layers = {}; this.data = {};
      this.cam = { center: o.center, bearing: typeof o.bearing === 'number' ? o.bearing : 0, zoom: o.zoom };
      maps.push(this);
      setTimeout(() => { this.fire('load', {}); this.fire('data', { tile: {}, sourceId: tileSourceId }); }, 0);
    }
    // on(ev, fn) 또는 on(ev, 층 id, fn) — 층에 건 것은 clickLayer 로만 부른다(A4 충전소 점 누름)
    on(ev, a, b) {
      if (typeof a === 'function') (this.h[ev] = this.h[ev] || []).push(a);
      else (this.lh = this.lh || []).push({ ev, layer: a, fn: b });
    }
    fire(ev, e) { for (const f of this.h[ev] || []) f(e); }
    clickLayer(layer, props) { for (const x of this.lh || []) if (x.ev === 'click' && x.layer === layer) x.fn({ features: [{ properties: props }] }); }
    addSource(id, o) {
      this.data[id] = o && o.data;
      this.sources[id] = { setData: (d) => { this.data[id] = d; if (d && d.geometry) this.moves.push(d.geometry.coordinates); } };
    }
    addLayer(l) { this.layers[l.id] = { ...(l.layout || {}) }; }
    setLayoutProperty(id, k, v) { (this.layers[id] = this.layers[id] || {})[k] = v; }
    getSource(id) { return this.sources[id]; }
    jumpTo(to) { this.jumps.push({ ...to, at: Date.now() }); Object.assign(this.cam, to); this.fire('moveend', {}); }
    easeTo(to) { this.jumpTo(to); }
    getZoom() { return this.cam.zoom; }
    getBearing() { return this.cam.bearing; }
    getCenter() { return { lng: this.cam.center[0], lat: this.cam.center[1] }; }
    user(kind, to) {
      const start = { moved: 'dragstart', rotated: 'rotatestart', zoomed: 'zoomstart' }[kind];
      Object.assign(this.cam, to || {});
      this.fire(start, { originalEvent: {} });
      this.fire('moveend', { originalEvent: {} });
    }
    remove() {}
  }
  class Marker {
    constructor(o) { this.el = o.element; this.removed = false; markers.push(this); }
    setLngLat(ll) { this.ll = ll; return this; }
    addTo(m) { this.map = m; return this; }
    remove() { this.removed = true; }
    getElement() { return this.el; }
  }
  return { Map, Marker, maps, markers, live: () => markers.filter((x) => !x.removed) };
}

// 브라우저 개인 파일 저장소(OPFS) 가짜 — 빌드한 페이지의 disk_web.js 가 그대로 쓴다
export function fakeOpfs() {
  const files = {};
  const fileHandle = (key) => ({
    async getFile() { const t = files[key] || ''; return { size: t.length, text: async () => t }; },
    async createWritable(o) {
      let buf = o && o.keepExistingData ? files[key] || '' : '';
      let pos = buf.length;
      return { async seek(p) { pos = p; }, async write(t) { buf = buf.slice(0, pos) + t; pos = buf.length; }, async close() { files[key] = buf; } };
    },
  });
  const dir = (prefix) => ({
    async getDirectoryHandle(n) { return dir(prefix + n + '/'); },
    async getFileHandle(n) { return fileHandle(prefix + n); },
    async removeEntry(n) { if (!(prefix + n in files)) { const e = new Error(n); e.name = 'NotFoundError'; throw e; } delete files[prefix + n]; },
  });
  return { files, storage: { getDirectory: async () => dir('') } };
}

// 기록장 폴더 가짜(메모리)
export function memDisk() {
  const files = {};
  const key = (d, f) => d + '/' + f;
  return {
    files,
    async append(d, f, t) { files[key(d, f)] = (files[key(d, f)] || '') + t; },
    async read(d, f) { return files[key(d, f)] || ''; },
    async write(d, f, t) { files[key(d, f)] = t; },
    async remove(d, f) { delete files[key(d, f)]; },
  };
}

// 판 목록 줍기 — 빌드와 같은 선언 무늬(config_tools.build.board_decl)
export function boardNames(app, tc) {
  const dir = path.join(app, tc.build.src_dir);
  const rx = new RegExp(tc.build.board_decl, 'm');
  return fs.readdirSync(dir).filter((n) => n.endsWith(tc.build.module_ext))
    .filter((n) => rx.test(fs.readFileSync(path.join(dir, n), 'utf8')))
    .map((n) => path.basename(n, tc.build.module_ext)).sort();
}

export async function loadBoards(app, tc) {
  const out = [];
  for (const name of boardNames(app, tc)) {
    const module = await import(pathToFileURL(path.join(app, tc.build.src_dir, name + tc.build.module_ext)).href);
    const view = fs.readFileSync(path.join(app, tc.build.src_dir, tc.build.view_prefix + name + tc.build.view_ext), 'utf8');
    out.push({ name, module, view });
  }
  // (정비 나 ①) 제목 꾸러미도 빌드와 같은 무늬(build.topic_decl)로 줍는다 — 시험마다 고치지 않게 판 목록에 붙여 넘기고 startApp 이 꺼내 쓴다
  out.topics = await loadTopics(app, tc);
  return out;
}

export async function loadTopics(app, tc) {
  const dir = path.join(app, tc.build.src_dir);
  const rx = new RegExp(tc.build.topic_decl, 'm');
  const out = [];
  for (const n of fs.readdirSync(dir).filter((f) => f.endsWith(tc.build.module_ext)).sort()) {
    if (!rx.test(fs.readFileSync(path.join(dir, n), 'utf8'))) continue;
    const name = path.basename(n, tc.build.module_ext);
    const module = await import(pathToFileURL(path.join(dir, n)).href);
    out.push({ name: name.slice(tc.build.topic_prefix.length), module });
  }
  return out;
}

export function setPath(obj, dotted, value) {
  const parts = dotted.split('.');
  let cur = obj;
  for (const p of parts.slice(0, -1)) cur = cur[p];
  cur[parts[parts.length - 1]] = value;
}

export async function waitFor(fn, ms, pollMs) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (fn()) return true;
    await sleep(pollMs);
  }
  return fn();
}

// 앱 하나를 띄운다. ctx = {app, tc, main, boards}, opts = {secretFile, overrides, fetchFn, stamp}
// fetchFn 을 주면 그것으로 묻는다(선 파일 대신 답 등). 나간 물음은 주소·머리와 함께 센다
export function startApp(ctx, opts) {
  const { app, tc, main } = ctx;
  const { raw, errors } = loadAppConfig(app, tc.build, { secretPath: opts.secretFile, buildInfo: { stamp: opts.stamp || 'try', at: kstText(tc), commit: 'try' }, overrides: opts.overrides });
  if (errors.length) throw new Error('설정 읽기 실패: ' + JSON.stringify(errors));
  const doc = fakeDoc(srcViews(app, tc));
  // opts.disk = 앞 앱의 폰 데이터 폴더를 이어 씀(다시 열어도 같은가 — A3 카메라 상태)
  const disk = opts.disk || memDisk();
  const consoleLines = [];
  const con = { error: (...a) => consoleLines.push(a.map(String).join(' ')), log: (...a) => consoleLines.push(a.map(String).join(' ')) };
  const lib = fakeMapLib(raw.files.config_ui_map.tile_source_id);
  const fetchCalls = [];
  const timers = new Set();
  const intervals = new Set();
  const clock = {
    now: () => Date.now(),
    setTimeout: (f, ms) => { const h = setTimeout(() => { timers.delete(h); f(); }, ms); timers.add(h); return h; },
    clearTimeout: (h) => { clearTimeout(h); timers.delete(h); },
    setInterval: (f, ms) => { const h = setInterval(f, ms); intervals.add(h); return h; },
    clearInterval: (h) => { clearInterval(h); intervals.delete(h); },
  };
  const realFetch = opts.fetchFn || fetch;
  const platform = {
    config: raw, doc, win: fakeWin(), disk, console: con, clock, geo: opts.geo || null, maplibre: lib, boards: ctx.boards || [], topics: ctx.topics || (ctx.boards && ctx.boards.topics) || [],
    fetch: (url, init) => { fetchCalls.push({ url: String(url), headers: { ...((init && init.headers) || {}) } }); return realFetch(url, init); },
  };
  const made = main(platform);
  const win = platform.win;
  const seen = { app: [], fixes: [], speed: [], pos: [], stations: [], ahead: [], limit: [], route: [], place: [], progress: [], odd: [], conn: [] };
  if (made.state) {
    made.state.subscribe('ahead', (v) => seen.ahead.push({ v, at: Date.now() }));
    made.state.subscribe('health.app', (v) => seen.app.push({ ...v, at: Date.now() }));
    made.state.subscribe('fix', (v) => seen.fixes.push({ ...v, at: Date.now() }));
    made.state.subscribe('speed', (v) => seen.speed.push({ ...v, at: Date.now() }));
    made.state.subscribe('pos', (v) => seen.pos.push({ ...v, at: Date.now() }));
    made.state.subscribe('stations', (v) => seen.stations.push({ v, at: Date.now() }));
    made.state.subscribe('limit', (v) => seen.limit.push({ ...v, at: Date.now() }));
    // (A6) 경로·검색 답·올리기 결과·집 PC 연결
    made.state.subscribe('route', (v) => seen.route.push({ v, at: Date.now() }));
    made.state.subscribe('place', (v) => seen.place.push({ ...v, at: Date.now() }));
    made.state.subscribe('route.progress', (v) => seen.progress.push({ ...v, at: Date.now() }));
    made.state.subscribe('odd.result', (v) => seen.odd.push({ ...v, at: Date.now() }));
    made.state.subscribe('conn.route*', (v, name) => seen.conn.push({ name, ...v, at: Date.now() }));
  }
  let stopped = false;
  return {
    made, doc, disk, consoleLines, lib, fetchCalls, seen, raw, win,
    stop() {
      if (stopped) return;
      stopped = true;
      if (made.loc_watch) made.loc_watch.halt();
      if (made.relay_stations) made.relay_stations.halt();
      if (made.relay_status) made.relay_status.halt();
      if (made.relay_limit) made.relay_limit.halt();
      if (made.net_route) made.net_route.halt();
      for (const h of timers) clearTimeout(h);
      for (const h of intervals) clearInterval(h);
    },
    el: (id) => doc.els[id] || null,
    statusText: () => doc.els[raw.files.config_ui_status.element_id].textContent,
    driveHidden: () => doc.els[raw.files.config_ui_drive.root_id].hidden,
    // health.app 은 main() 안에서 곧바로 올라올 수 있어(설정 문제) 구독 대신 State 의 지금 값을 본다
    app: () => (made.state && made.state.get('health.app')) || {},
    stage: () => ((made.state && made.state.get('health.app')) || {}).stage || null,
    get: (name) => (made.state ? made.state.get(name) : undefined),
    logLines: () => (made.log ? made.log.lines() : []),
    async logText() { if (made.log) await made.log.flush(); return Object.values(disk.files).join(''); },
  };
}
