/* 충전 길잡이 — 화면 로직. 계산은 engine.js(EvPlanner)만 쓴다. 데이터는 data.js 의 예시 노선. */
(function () {
  "use strict";
  const EV = window.EvPlanner;
  const DATA = window.EvData;
  const RL = window.EvRelay; // 공공 데이터 중계(web/relay.js)
  const LS = (() => { try { return localStorage; } catch (e) { return null; } })();
  const relaySet = () => RL.loadSettings(LS);
  const KEY = "ev-charge-planner/v1";
  const $ = (sel) => document.querySelector(sel);
  const MINE_KEY = "ev-charge-planner/mine";     // 내가 확인한 값(업체 이름·요금, 충전소 요금·상태)
  const LIVE_KEY = "ev-charge-planner/live";     // 폰에서 새로 받은 공공 데이터
  const APIKEY_KEY = "ev-charge-planner/apikey"; // 공공데이터포털 키(이 폰에만)
  const KAKAO_KEY = "ev-charge-planner/kakaokey"; // 카카오 REST 키(이 폰에만. 파일·저장소에는 들어가지 않는다)
  const NAVI_KEY = "ev-charge-planner/navi";      // 마지막으로 받은 길(도로 조각)

  const storageOk = (() => {
    try { localStorage.setItem("ev-charge-planner/test", "1"); return localStorage.getItem("ev-charge-planner/test") === "1"; } catch (e) { return false; }
  })();
  // 폰에서 새로 받은 데이터가 파일에 든 것보다 새로우면 그걸 쓴다
  try {
    const saved = JSON.parse(localStorage.getItem(LIVE_KEY) || "null");
    if (saved && saved.routes && (!DATA.LIVE || saved.fetched_at > DATA.LIVE.fetched_at)) {
      if (DATA.LIVE) { // 예전에 받아 둔 데이터에는 휴게소 위치(loc)가 없다 → 파일의 것으로 채운다(길찾기에 쓴다)
        const locs = new Map();
        for (const r of DATA.LIVE.routes) for (const a of r.rest_areas) if (a.loc) locs.set(`${r.key}|${a.name}`, a.loc);
        for (const r of saved.routes) for (const a of r.rest_areas) if (!a.loc && locs.has(`${r.key}|${a.name}`)) a.loc = locs.get(`${r.key}|${a.name}`);
      }
      DATA.replaceLive(saved);
    }
  } catch (e) { /* 못 읽으면 파일 데이터 */ }
  RL.expireLive(DATA.LIVE, Date.now()); // 중계에서 받아 둔 상태가 오래됐으면 빈자리로 세지 않는다

  // ---------- 내가 확인한 값 ----------
  const DEFAULT_ALIAS = { "브라이트에너지파트너스": "워터", "기후에너지환경부": "환경부" };
  let mine = { ops: {}, stations: {} };
  try {
    const m = JSON.parse(localStorage.getItem(MINE_KEY) || "null");
    if (m) mine = { ops: m.ops || {}, stations: m.stations || {} };
  } catch (e) { /* 없으면 빈 값 */ }
  function saveMine() {
    try { localStorage.setItem(MINE_KEY, JSON.stringify(mine)); return true; } catch (e) { return false; }
  }
  const aliasOf = (op) => { const o = mine.ops[op]; return o && typeof o.alias === "string" ? o.alias : (DEFAULT_ALIAS[op] || ""); };
  const opLabel = (op) => { const a = aliasOf(op); return a && a !== op ? `${a} (${op})` : op; };
  // 충전소에 내 값이 지금 적용되는지: 요금은 늘, 상태는 그 뒤로 새 공공 데이터가 오기 전까지만
  function mineState(id, liveAt) {
    const m = mine.stations[id];
    if (!m) return { price: false, status: false, at: 0 };
    return { price: m.price > 0, status: !!(m.statuses && m.statuses.some(Boolean) && m.at > liveAt), at: m.at };
  }

  // ---------- 상태 ----------
  const DEFAULTS = {
    routeKey: DATA.ROUTES[0].key, soc: 60, pos: 0,
    battery: 60, eff: 5, margin: 10, minArrival: 15, stale: 30,
    height: 0, // 차 높이(m). 탑차·윙바디만 넣는다. 0 이면 높이로 거르지 않는다
    // 묘성의 채비 구독: 고속도로 329원/kWh = 391원 대비 15.86% 할인 (2026-11-15). 카드는 없음
    subOp: "채비", subRate: 15.86, subPrivate: true, cardName: "", cardRate: 10,
  };
  let state = Object.assign({}, DEFAULTS);
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) state = Object.assign({}, DEFAULTS, JSON.parse(raw));
  } catch (e) { /* 저장 못 읽으면 기본값 */ }
  // 예전 판의 예시 할인(별빛차지 구독 20%, 그린카드 10%)이 그대로 저장돼 있으면 지운다. 직접 바꾼 값은 둔다
  if (state.subOp === "별빛차지" && state.subRate === 20) state.subOp = "";
  if (state.cardName === "그린카드" && state.cardRate === 10) state.cardName = "";
  // 채비 구독을 한 번 넣는다(구독이 비어 있던 폰에만). 그 뒤에 바꾼 값은 그대로 둔다
  if (!state.chaeviSet) {
    if (!state.subOp) { state.subOp = "채비"; state.subRate = 15.86; }
    state.chaeviSet = true;
    persist();
  }
  if (state.routeKey !== "navi" && !DATA.ROUTES.some((r) => r.key === state.routeKey)) state.routeKey = DEFAULTS.routeKey;
  let navi = null; // 길찾기로 만든 노선: { dest, fetched_at, pieces, result, route }
  const allRoutes = () => (navi ? [navi.route] : []).concat(DATA.ROUTES);
  let routes = DATA.ROUTES.slice(); // 상태를 바꿔 보면 여기만 바뀐다(저장 안 함)
  let view = "route";
  let editing = null;
  const icOne = new Map(); // 나들목 항목을 하나씩 펼치고 접은 것(화면을 닫으면 잊음). 없으면 state.icOpen 을 따른다   // 고치는 중인 충전소 id
  let lastRoute = null; // 마지막으로 엔진에 넣은 노선(내 값 반영 뒤)
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* 무시 */ }
  }
  const hhmm = (ms) => { const t = new Date(ms); return `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`; };
  const liveAtOf = (r) => (r.live && DATA.LIVE ? DATA.LIVE.fetched_at : 0);
  // 받은 지 얼마나 됐는지: 방금 / 12분 전 / 3시간 전 / 2일 전 (머리 배지에 들어가게 짧게)
  function ago(ms) {
    const min = Math.max(0, Math.floor((Date.now() - ms) / 60000));
    if (min < 1) return "방금";
    if (min < 60) return `${min}분 전`;
    if (min < 24 * 60) return `${Math.floor(min / 60)}시간 전`;
    return `${Math.floor(min / 1440)}일 전`;
  }
  // 충전소 상태가 몇 분 전 정보인지 (내가 확인한 상태면 그 시각 기준)
  function infoAge(stationId) {
    const st = findStation(lastRoute, stationId);
    if (!st) return "정보 시각 모름";
    const a = ago(st.status_updated_at);
    return a === "방금" ? "방금 받은 정보" : `${a} 정보`;
  }

  // ---------- 작은 도구 ----------
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return el;
  }
  const chip = (text, tone) => h("span", { class: "chip", "data-tone": tone || null, text });
  const km = (x) => `${Math.round(x * 10) / 10}km`;
  const pct = (x) => `${Math.round(x)}%`;
  const won = (x) => `${Math.round(x)}원`;
  const curRoute = () => routes.find((r) => r.key === state.routeKey) || routes[0];

  // ---------- 엔진 입력 만들기 ----------
  function inputs() {
    const r = curRoute();
    const now = Date.now();
    const vehicle = {
      soc_pct: state.soc, battery_kwh: state.battery, efficiency_km_per_kwh: state.eff,
      safety_margin_ratio: state.margin / 100, min_arrival_soc_pct: state.minArrival,
    };
    const user = {
      subscription: state.subOp ? {
        operator: state.subOp, rate: state.subRate / 100,
        excluded_rest_area_ids: state.subPrivate ? r.rest_areas.filter((a) => a.name.includes("민자")).map((a) => a.id) : [],
      } : null,
      cards: state.cardName.trim() ? [{ name: state.cardName.trim(), rate: state.cardRate / 100, operators: null }] : [],
    };
    const route = DATA.toRoute(r, now);
    const liveAt = liveAtOf(r);
    const tall = state.height > 0;
    const indoor = indoorIds = new Set();
    for (const a of r.rest_areas) for (const n of a.nearby || []) if (n.station.indoor) indoor.add(n.station.id);
    blocked = new Set();
    hiddenIndoor = 0;
    for (const a of route.rest_areas) {
      if (tall) { // 탑차·윙바디: 건물 안·지하 충전소는 보이지 않게
        const before = a.nearby.length;
        a.nearby = a.nearby.filter((n) => !indoor.has(n.station.id));
        hiddenIndoor += before - a.nearby.length;
      }
      a.nearby = a.nearby.slice(0, NEARBY_SHOW); // 가까운 순으로 들어 있다
      for (const st of [...a.stations, ...a.nearby.map((n) => n.station)]) {
        applyMine(st, liveAt);
        const limit = heightLimit(st.id);
        if (tall && limit > 0 && limit < state.height) { // 내 차가 못 들어가는 곳: 추천에서 빠지게 못 쓰는 것으로 둔다
          blocked.add(st.id);
          for (const c of st.chargers) c.status = "out_of_service";
        }
      }
    }
    // 인근 충전소가 하나도 안 남은 나들목은 뺀다
    const icIds = new Set(r.rest_areas.filter((a) => a.kind === "ic").map((a) => a.id));
    route.rest_areas = route.rest_areas.filter((a) => !(icIds.has(a.id) && a.nearby.length === 0));
    lastRoute = route;
    return { route, vehicle, user, now };
  }
  // 내가 확인한 값 덮어쓰기: 업체 요금 → 충전소 요금 → 충전기 상태(받은 뒤에 확인한 것만)
  const NEARBY_SHOW = 3; // 나들목마다 보여 줄 인근 충전소 수(데이터에는 야외 후보까지 더 들어 있다)
  let blocked = new Set(); // 높이 제한 때문에 내 차가 못 들어가는 충전소
  let indoorIds = new Set(); // 이 노선에서 건물 안·지하인 충전소
  let hiddenIndoor = 0;    // 높은 차라서 숨긴 건물 안·지하 충전소 수
  const heightLimit = (id) => { const m = mine.stations[id]; return m && m.height > 0 ? m.height : 0; };
  function applyMine(st, liveAt) {
    const op = mine.ops[st.operator];
    if (op && op.price > 0) st.price_per_kwh = op.price;
    const m = mine.stations[st.id];
    if (!m) return;
    if (m.price > 0) st.price_per_kwh = m.price;
    if (mineState(st.id, liveAt).status && m.statuses.length === st.chargers.length) {
      m.statuses.forEach((s, i) => { if (s) st.chargers[i].status = s; });
      st.status_updated_at = m.at;
    }
  }
  // 마지막으로 누가 충전을 끝낸 시각(공공 데이터의 충전기별 기록). 최근에 충전됐으면 살아 있다는 가장 확실한 증거다
  const LAST_OLD_DAYS = 7; // 이보다 오래 기록이 없으면 고장을 의심하라고 알린다
  function rawChargers(id) {
    for (const a of curRoute().rest_areas) {
      for (const st of [...(a.stations || []), ...(a.nearby || []).map((n) => n.station)]) if (st.id === id) return st.chargers || [];
    }
    return [];
  }
  // 급속 충전기 가운데 가장 최근 기록. 기록이 하나도 없으면 null(옛 데이터이거나 한 번도 안 쓴 곳)
  function lastCharged(id) {
    const ends = rawChargers(id).filter((c) => c.type === "fast" && c.last_end > 0).map((c) => c.last_end);
    return ends.length ? Math.max(...ends) : null;
  }
  function lastChargedChip(id) {
    const at = lastCharged(id);
    if (at === null) return null;
    const days = (Date.now() - at) / 86400000;
    if (days >= LAST_OLD_DAYS) return chip(`${Math.floor(days)}일째 충전 기록 없음`, "warn");
    const a = ago(at);
    return chip(a === "방금" ? "방금 충전됨" : `${a} 충전됨`, "good");
  }
  function findStation(route, id) {
    if (!route) return null;
    for (const a of route.rest_areas) for (const st of [...(a.stations || []), ...(a.nearby || []).map((n) => n.station)]) if (st.id === id) return st;
    return null;
  }

  // ---------- 표시용 문구 ----------
  // 엔진의 경고 코드를 운전자가 읽을 말로. "전체 사용 불가"는 충전 중인 급속이 있으면 '빈 자리 없음'으로 풀어 쓴다
  function areaChips(e) {
    const out = [];
    const codes = e.alerts.map((a) => a.code);
    if (codes.includes("unreachable")) out.push(chip("지금 잔량으로 못 감", "bad"));
    if (codes.includes("all_unavailable")) {
      out.push(e.waiting_fast > 0 ? chip(`빈 충전기 없음 · 충전 중 ${e.waiting_fast}대`, "warn") : chip("쓸 수 있는 충전기 없음", "bad"));
    } else if (codes.includes("no_usable_fast")) {
      out.push(chip(e.waiting_fast > 0 ? `빈 급속 없음 · 충전 중 ${e.waiting_fast}대` : "빈 급속 없음(완속만)", "warn"));
    } else {
      out.push(chip(`빈 급속 ${e.usable_fast}대`, "good"));
      if (e.waiting_fast > 0) out.push(chip(`충전 중 ${e.waiting_fast}대`));
    }
    const broken = e.status_counts.out_of_service + e.status_counts.maintenance + e.status_counts.comm_error;
    if (broken > 0) out.push(chip(`고장·점검 ${broken}대`, "warn"));
    if (e.lowest_price !== null) out.push(chip(`최저 ${won(e.lowest_price)}/kWh`));
    return out;
  }
  function priceEl(q) {
    const el = h("div", { class: "price num" });
    if (q.applied !== null && q.final_price !== q.base_price) el.append(h("s", { text: won(q.base_price) }));
    el.append(`${won(q.final_price)}/kWh`);
    return el;
  }
  // 나들목 인근 충전소의 장소 이름(찾아가려면 업체 이름만으로는 모자란다). 휴게소 안 충전소는 휴게소 이름으로 충분해 빈 글
  function placeName(id) {
    for (const a of curRoute().rest_areas) for (const n of a.nearby || []) if (n.station.id === id) return n.station.name || "";
    return "";
  }
  function stationEl(s) {
    const st = s.status;
    const place = s.is_nearby ? placeName(s.station_id) : "";
    const meta = [];
    if (s.role === "primary") meta.push(chip("1순위", "sign"));
    if (s.role === "backup") meta.push(chip("예비", "backup"));
    meta.push(chip(`빈 급속 ${st.usable_fast}`, st.usable_fast > 0 ? "good" : null));
    if (st.waiting_fast) meta.push(chip(`충전 중 ${st.waiting_fast}`));
    if (st.usable_slow) meta.push(chip(`빈 완속 ${st.usable_slow}`));
    const isBlocked = blocked.has(s.station_id);
    if (indoorIds.has(s.station_id)) meta.push(chip("건물 안·지하", "warn"));
    const limit = heightLimit(s.station_id);
    if (isBlocked) meta.push(chip(`높이 제한 ${limit}m · 내 차 ${state.height}m 못 들어감`, "bad"));
    else if (limit > 0) meta.push(chip(`높이 제한 ${limit}m (내가 확인)`, "info"));
    if (st.unusable && !isBlocked) meta.push(chip(`고장·점검 ${st.unusable}`, "warn"));
    const rawSt = findStation(curRoute(), s.station_id);
    if (rawSt && rawSt.maker) meta.push(chip(`충전기 ${rawSt.maker}`)); // 충전기를 만든 곳(공공 데이터의 제조사)
    const lastChip = lastChargedChip(s.station_id);
    if (lastChip) meta.push(lastChip);
    meta.push(chip(infoAge(s.station_id), st.is_stale ? "warn" : null));
    if (s.is_nearby) meta.push(chip(`왕복 +${km(s.detour_km)} · 도착 예상 ${pct(s.arrival_soc_pct)}`, s.reachable ? null : "bad"));
    if (s.quote.applied) meta.push(h("span", { text: s.quote.applied === "subscription" ? "구독 할인" : `${s.quote.applied} 할인` }));
    const ms = mineState(s.station_id, liveAtOf(curRoute()));
    const opPrice = mine.ops[s.operator] && mine.ops[s.operator].price > 0;
    if (ms.status) meta.push(chip(`상태 내가 확인 ${hhmm(ms.at)}`, "info"));
    if (ms.price || opPrice) meta.push(chip("요금 내가 확인", "info"));
    const editBtn = h("button", { type: "button", class: "edit-btn", "aria-expanded": String(editing === s.station_id), text: editing === s.station_id ? "닫기" : "고치기" });
    editBtn.addEventListener("click", () => { editing = editing === s.station_id ? null : s.station_id; render(); });
    meta.push(editBtn);
    return h("div", { class: "station", "data-role": s.role },
      h("div", { class: "op" }, place ? [place, h("small", { class: "op-sub", text: opLabel(s.operator) })] : opLabel(s.operator)),
      priceEl(s.quote), h("div", { class: "meta" }, meta),
      editing === s.station_id ? editorEl(s.station_id) : null);
  }

  // 충전소 하나를 내가 확인한 값으로 고치는 칸
  const STATUS_TEXT = { available: "비어 있음", charging: "충전 중", out_of_service: "고장", maintenance: "점검 중", comm_error: "통신 오류" };
  function editorEl(id) {
    const st = findStation(lastRoute, id);
    if (!st) return null;
    const m = mine.stations[id] || {};
    const active = mineState(id, liveAtOf(curRoute()));
    const safe = id.replace(/[^A-Za-z0-9_-]/g, "_");
    const priceIn = h("input", { id: `e-price-${safe}`, type: "number", step: "0.1", min: "0", inputmode: "decimal", placeholder: "비우면 공공 데이터 값", value: m.price > 0 ? m.price : null });
    const heightIn = h("input", { id: `e-height-${safe}`, type: "number", step: "0.1", min: "0", inputmode: "decimal", placeholder: "없거나 모르면 비움", value: m.height > 0 ? m.height : null });
    const raw = rawChargers(id);
    const rows = st.chargers.map((c, i) => {
      const last = raw.length === st.chargers.length && raw[i].last_end > 0 ? ` · ${ago(raw[i].last_end)} 충전` : "";
      const sel = h("select", { id: `e-st-${safe}-${i}` }, h("option", { value: "", text: "공공 데이터대로" }),
        Object.entries(STATUS_TEXT).map(([v, t]) => h("option", { value: v, text: t })));
      sel.value = active.status && m.statuses[i] ? m.statuses[i] : "";
      return h("div", { class: "field" }, h("label", { for: sel.id, text: `${i + 1}번 ${c.type === "fast" ? "급속" : "완속"} ${Math.round(c.power_kw)}kW${last}` }), sel);
    });
    const msg = h("span", { class: "saved-msg small", "aria-live": "polite" });
    const save = h("button", { type: "button", class: "btn btn-primary", text: "저장" });
    const clear = h("button", { type: "button", class: "btn btn-ghost", text: "내 값 지우기" });
    save.addEventListener("click", () => {
      const price = parseFloat(priceIn.value);
      const statuses = rows.map((r) => r.querySelector("select").value || null);
      const height = parseFloat(heightIn.value);
      if (priceIn.value.trim() && !(price > 0)) { msg.textContent = "요금은 0보다 큰 숫자로 적어 주세요."; return; }
      if (heightIn.value.trim() && !(height > 0 && height < 10)) { msg.textContent = "높이 제한은 미터로 적어 주세요. 예: 2.3"; return; }
      if (!(price > 0) && !statuses.some(Boolean) && !(height > 0)) delete mine.stations[id];
      else mine.stations[id] = { price: price > 0 ? price : undefined, height: height > 0 ? height : undefined, statuses, at: Date.now() };
      editing = null;
      if (!saveMine()) alertMsg("이 화면에서는 저장되지 않습니다. 크롬이나 삼성 인터넷으로 열어 주세요.");
      render();
    });
    clear.addEventListener("click", () => { delete mine.stations[id]; saveMine(); editing = null; render(); });
    return h("div", { class: "editor" },
      h("div", { class: "small muted", text: "실제로 확인한 값만 넣으세요. 상태는 이보다 새 공공 데이터를 받으면 그 값으로 돌아가고, 요금과 높이 제한은 지울 때까지 남습니다. 높이 제한은 캐노피·입구 높이처럼 차가 지나갈 수 있는 높이입니다." }),
      h("div", { class: "grid2" },
        h("div", { class: "field" }, h("label", { for: priceIn.id, text: "요금 (원/kWh, 할인 전)" }), priceIn),
        h("div", { class: "field" }, h("label", { for: heightIn.id, text: "높이 제한 (m)" }), heightIn)),
      h("div", { class: "grid2" }, rows),
      h("div", { class: "row" }, save, clear, msg));
  }
  function alertMsg(text) {
    const el = $("#live-msg-route");
    el.textContent = text; el.hidden = false; el.dataset.tone = "bad";
  }

  // 실제 데이터인지 예시인지 표시
  function showSource(r) {
    const badge = $(".demo-badge"), note = $("#demo-note");
    if (r.live && DATA.LIVE) {
      const t = new Date(DATA.LIVE.fetched_at);
      const when = `${t.getMonth() + 1}/${t.getDate()} ${hhmm(DATA.LIVE.fetched_at)}`;
      const age = ago(DATA.LIVE.fetched_at);
      if (!busy) badge.textContent = `공공 ${age} ↻`; // 받는 중에는 진행률 표시를 지우지 않는다
      badge.title = `${when}에 받음. 눌러서 새로 받기`;
      badge.dataset.old = String(Date.now() - DATA.LIVE.fetched_at > state.stale * 60000);
      badge.setAttribute("aria-label", `공공 데이터 ${when}에 받음, ${age}. 눌러서 새로 받기`);
      note.textContent = `${DATA.LIVE.source}에서 ${when}(${age})에 받은 상태입니다. 그 뒤로 바뀌었을 수 있으니 도착 전에 다시 확인하세요. 휴게소 거리는 대략값이고, ${DATA.LIVE.price_note}입니다. 위의 '공공 … ↻'을 누르면 새로 받습니다.`
        + (DATA.LIVE.ic_note ? ` ${DATA.LIVE.ic_note}. 나들목 인근 충전소는 '새로 받기'로 갱신되지 않고, 일반 차가 못 쓰는 곳이 섞여 있을 수 있으니 가기 전에 확인하세요.` : "");
    } else {
      badge.textContent = "예시 데이터";
      badge.title = "실제 충전소가 아닙니다";
      badge.dataset.old = "false";
      note.textContent = "이 노선의 휴게소·충전소·가격·상태는 모두 지어낸 예시입니다.";
    }
  }

  // ---------- 그리기 ----------
  function render() {
    if (RL.expireLive(DATA.LIVE, Date.now()) && navi) { navi = buildNavi(navi) || navi; routes = allRoutes(); }
    const r = curRoute();
    $("#soc").value = state.soc;
    $("#soc-out").textContent = `${state.soc}%`;
    $("#pos").max = r.length;
    if (state.pos > r.length) state.pos = 0;
    $("#pos").value = state.pos;
    $("#pos-out").textContent = `${state.pos}km`;
    showSource(r);

    let result;
    const inp = inputs();
    try {
      result = EV.plan(inp.route, inp.vehicle, inp.user, inp.now, state.pos, state.stale);
    } catch (err) {
      $("#range-line").textContent = "";
      $("#reco").replaceChildren(h("div", { class: "none" }, h("b", { text: "설정을 확인해 주세요" }), h("span", { text: err.message })));
      $("#strip").replaceChildren();
      return;
    }
    const v = EV.makeVehicle(inp.vehicle);
    const safeKm = EV.conservative_range_km(v) - v.min_arrival_soc_pct * EV.km_per_pct(v); // 반올림 전 안전 거리(0 으로 자르지 않음, 한 번만 계산)
    $("#range-line").textContent = `안전하게 갈 수 있는 거리 약 ${Math.max(0, Math.round(safeKm))}km `
      + `(여유 ${state.margin}%, 도착 때 ${state.minArrival}% 남김)`
      + (state.height > 0 ? ` · 차 높이 ${state.height}m: 건물 안·지하 충전소 ${hiddenIndoor}곳 숨김` + (blocked.size ? `, 높이 제한으로 못 가는 곳 ${blocked.size}곳` : "") : "");
    renderReco(result, safeKm, r);
    renderStrip(result);
    lastResult = result;
    if (view === "map") drawMap();
  }

  function findEntry(result, stationId) {
    for (const ra of result.route_list.entries) for (const s of [...ra.stations, ...ra.nearby]) if (s.station_id === stationId) return s;
    return null;
  }
  function pickEl(p, role, result) {
    const s = findEntry(result, p.station_id);
    const dots = "●".repeat(p.score) + "○".repeat(5 - p.score);
    const facts = [
      chip(`도착 때 예상 ${pct(p.arrival_soc_pct)}`, p.arrival_soc_pct - state.minArrival < 10 ? "warn" : "good"),
      chip(`빈 급속 ${s.status.usable_fast}대`, "good"),
      h("span", { class: "chip", title: "안전 점수(5점 만점)" }, "안전 ", h("span", { class: "dots", text: dots })),
    ];
    if (p.is_nearby) facts.push(chip(`나들목 왕복 +${km(p.detour_km)}`, "warn"));
    facts.push(s.status.is_stale ? chip(`${infoAge(p.station_id)} · 도착 전 다시 확인`, "warn") : chip(infoAge(p.station_id)));
    if (s.status.unusable) facts.push(chip(`고장·점검 ${s.status.unusable}대`, "warn"));
    return h("div", { class: "pick", "data-role": role },
      h("div", { class: "role", text: role === "primary" ? "1순위 충전소" : "예비 (1순위가 안 되면)" }),
      h("div", { class: "name", text: p.rest_area_name }),
      h("div", { class: "dist num", text: km(p.remaining_km) }),
      h("div", { class: "sub", text: p.is_nearby ? `${placeName(p.station_id) || "나들목 인근"} · ${opLabel(p.operator)}` : opLabel(p.operator) }),
      priceEl(s.quote),
      h("div", { class: "facts" }, facts));
  }
  // 길찾기 노선에서 안전 거리(반올림 전)가 남은 거리 이상이면 충전 없이 도착할 수 있다
  function enoughEl(withTail, route, safeKm) {
    const left = Math.round(route.length - state.pos);
    return h("div", { class: "none", "data-tone": "good", style: "background: var(--good-soft); color: var(--good)" },
      h("b", { text: "목적지까지 충전 없이 갈 수 있어요" }),
      h("span", { text: `남은 거리 약 ${left} km · 안전하게 갈 수 있는 거리 약 ${Math.max(0, Math.round(safeKm))} km.` + (withTail ? " 1순위는 들르고 싶을 때 참고하세요." : "") }));
  }
  function renderReco(result, safeKm, route) {
    const rec = result.recommendation;
    const box = h("div", { class: "reco" });
    const enough = !!(route && route.navi === true && safeKm >= route.length - state.pos);
    if (rec.status !== "ok") {
      if (enough) box.append(enoughEl(false, route, safeKm));
      else box.append(h("div", { class: "none" },
        h("b", { text: "안전하게 갈 수 있는 충전소가 없습니다" }),
        h("span", { text: "지금 잔량으로 닿는 곳에 빈 급속 충전기가 없습니다. 가까운 나들목으로 나가 충전소를 찾거나, 속도를 줄여 전비를 높이세요." })));
    } else {
      box.append(pickEl(rec.primary, "primary", result));
      if (rec.backup) box.append(pickEl(rec.backup, "backup", result));
      else if (enough) box.append(enoughEl(true, route, safeKm));
      else box.append(h("div", { class: "none" },
        h("b", { text: "예비 충전소가 없습니다" }),
        h("span", { text: "1순위에서 충전하지 못하면 갈 수 있는 다음 충전소가 없습니다. 1순위에서 꼭 충전하세요." })));
    }
    $("#reco").replaceChildren(box);
  }
  // 나들목 항목(휴게소 충전기 없이 나들목 인근 충전소만): tools/ic_nearby.py 가 id 끝에 -icN 을 붙인다
  const isIc = (e) => /-ic\d+$/.test(e.rest_area_id) && e.stations.length === 0;
  // 내가 구독한 업체의 충전소를 먼저(나머지는 원래 순서 그대로)
  const subFirst = (list) => list.slice().sort((a, b) => (b.operator === state.subOp) - (a.operator === state.subOp));
  function renderStrip(result) {
    const list = $("#strip");
    list.replaceChildren();
    const entries = result.route_list.entries;
    if (!entries.length) {
      list.append(h("li", { class: "small muted", text: "이 방향으로 남은 휴게소가 없습니다. 위치를 앞으로 당겨 보세요." }));
      return;
    }
    // 나들목 인근 충전소는 접어 두고 필요할 때만 펼친다(모두 펼치기/접기 + 항목마다)
    const ics = entries.filter(isIc);
    const allBtn = $("#btn-ic-all");
    allBtn.hidden = !ics.length;
    if (ics.length) {
      allBtn.textContent = state.icOpen ? `나들목 ${ics.length}곳 접기` : `나들목 ${ics.length}곳 펼치기`;
      allBtn.setAttribute("aria-expanded", String(!!state.icOpen));
    }
    for (const e of entries) {
      const ic = isIc(e);
      const open = !ic || (icOne.has(e.rest_area_id) ? icOne.get(e.rest_area_id) : !!state.icOpen);
      let toggle = null;
      if (ic) {
        toggle = h("button", { type: "button", class: "edit-btn", "aria-expanded": String(open), text: open ? "접기" : "펼치기" });
      }
      // 나들목은 단추만이 아니라 이름·줄 어디를 눌러도 펼치고 접는다(작은 단추는 운전 중에 누르기 어렵다)
      const flip = ic ? () => { icOne.set(e.rest_area_id, !open); render(); } : null;
      const tap = (el) => { if (flip) { el.classList.add("ic-tap"); el.addEventListener("click", flip); } return el; };
      const all = [...e.stations, ...e.nearby];
      const role = all.some((s) => s.role === "primary") ? "primary" : all.some((s) => s.role === "backup") ? "backup" : null;
      const low = e.arrival_soc_pct < state.minArrival;
      list.append(h("li", { class: "stop", "data-reach": String(e.reachable), "data-role": role, "data-ic": ic ? "true" : null },
        h("div", { class: "km num" }, km(e.remaining_km), h("small", { text: `${Math.round(e.distance_km)}km 지점` })),
        h("div", { class: "rail", "aria-hidden": "true" }),
        h("div", { class: "body" },
          tap(h("div", { class: "head" },
            h("div", { class: "name", text: e.name }),
            h("div", { class: "soc num", "data-low": String(low), text: `도착 ${pct(e.arrival_soc_pct)}` }))),
          tap(h("div", { class: "chips" }, ic
            ? [chip(`나들목 인근 급속 ${e.nearby.length}곳`, "info"), open ? chip("왕복 거리는 대략") : null, toggle]
            : areaChips(e))),
          open ? subFirst(e.stations).map(stationEl) : null,
          open && e.nearby.length ? h("div", { class: "nearby-label", text: "나들목 인근" }) : null,
          open ? subFirst(e.nearby).map(stationEl) : null)));
    }
  }

  // ---------- 지도: 내 위치와 길 위 충전소 ----------
  // 지금 고른 노선(또는 길찾기로 받은 길)의 앞에 있는 충전소를 지도에 풍선으로 찍는다. 풍선: 업체 · 빈 급속/전체 · 충전기 제조사.
  // 지도는 열쇠가 필요 없는 오픈스트리트맵. 지도 그리는 도구(Leaflet)는 지도 탭을 처음 열 때만 받는다.
  const LEAFLET = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/";
  const MAP_DETAIL_ZOOM = 12; // 이보다 가까이 보면 충전소마다 풍선 하나, 멀리 보면 휴게소·나들목마다 하나
  const MAP_FOLLOW_ZOOM = 14;
  const MAP_STEP_KM = 0.3;    // 길 위에서 이만큼 움직이면 앞에 남은 곳을 다시 계산한다
  let map = null, mapLayer = null, mapLine = null, mapLineKey = "", mapMe = null, mapAcc = null, mapWatch = null;
  let mapFollow = true, mapLoading = null, mapDetail = false, mapLevel = -1, mapFitKey = "", mapWake = null, mapLastKm = null, lastResult = null;
  function mapMsg(text) { const el = $("#map-msg"); el.textContent = text; el.hidden = !text; }
  function loadLeaflet() {
    if (window.L) return Promise.resolve();
    if (!mapLoading) mapLoading = new Promise((ok, no) => {
      const css = document.createElement("link");
      css.rel = "stylesheet"; css.href = LEAFLET + "leaflet.min.css";
      const js = document.createElement("script");
      js.src = LEAFLET + "leaflet.min.js";
      js.onload = () => ok();
      js.onerror = () => { mapLoading = null; no(new Error("지도 도구를 받지 못함")); };
      document.head.append(css, js);
    });
    return mapLoading;
  }
  // 지도 칸을 위 머리와 아래 탭 사이에 꽉 채운다
  function placeMap() {
    const v = $("#view-map");
    v.style.top = `${Math.round($("header.sign").getBoundingClientRect().bottom)}px`;
    v.style.bottom = `${Math.round($(".tabbar").getBoundingClientRect().height)}px`;
    if (map) map.invalidateSize();
  }
  function followBtn() { $("#map-follow").dataset.on = String(mapFollow); }
  // 길을 새로 받으면 길 전체를 잠깐 보여 주고, 그동안 지도를 건드리지 않았으면 다시 내 위치를 따라간다(운전 중에 손댈 일 없게)
  let mapShowTimer = null;
  function mapShowRoute() {
    if (!map || !navi) return;
    mapFollow = false;
    followBtn();
    map.fitBounds(window.L.latLngBounds(navi.result.route.points), { padding: [30, 30], animate: false });
    clearTimeout(mapShowTimer);
    const stamp = navi.fetched_at;
    let touched = false;
    const mark = () => { touched = true; };
    map.once("dragstart", mark);
    map.once("zoomstart", mark);
    mapShowTimer = setTimeout(() => {
      map.off("dragstart", mark); map.off("zoomstart", mark);
      if ($("#map-msg").textContent.includes("까지 ")) mapMsg(""); // 길 요약은 잠깐만
      if (touched || view !== "map" || !navi || navi.fetched_at !== stamp) return;
      mapFollow = true;
      followBtn();
      if (mapMe) map.setView(mapMe.getLatLng(), MAP_FOLLOW_ZOOM, { animate: false });
    }, 7000);
  }
  async function openMap() {
    window.scrollTo(0, 0);
    placeMap();
    mapMsg("지도 불러오는 중…");
    try { await loadLeaflet(); } catch (e) {
      mapMsg("지도를 불러오지 못했어요. 인터넷 연결을 확인해 주세요. Claude 링크로 연 화면에서는 지도가 막혀 있어요.");
      return;
    }
    if (view !== "map") return;
    mapMsg("");
    if (!map) {
      map = window.L.map("map", { zoomControl: false }).setView([36.3, 127.8], 7);
      window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "© OpenStreetMap" }).addTo(map);
      arLayer = window.L.layerGroup().addTo(map); // 주변 충전소(아래)
      mapLayer = window.L.layerGroup().addTo(map); // 길 위 충전소(위)
      map.on("moveend", arMoved);
      map.createPane("me").style.zIndex = 650; // 내 위치는 풍선 위에
      map.getPane("me").style.pointerEvents = "none";
      map.on("dragstart", () => { mapFollow = false; followBtn(); }); // 손으로 옮기면 따라가기를 멈춘다
      map.on("zoomend", () => { if (levelOf(map.getZoom()) !== mapLevel) drawMap(); });
    }
    placeMap();
    followBtn();
    drawMap();
    startWatch();
    arStart();
    makerBtn();
  }
  function bubbleIcon(top, free, total, sub, tone, role, far, dx, around) {
    return window.L.divIcon({ className: "mk-wrap", html: RL.bubbleHtml({ top, free, total, sub, tone, role, far, dx, around }), iconSize: [0, 0] });
  }
  // 0: 아주 멀리(점에 빈 급속 수만) · 1: 휴게소·나들목마다 이름 풍선 · 2: 충전소마다 풍선
  const levelOf = (z) => (z >= MAP_DETAIL_ZOOM ? 2 : z >= MAP_DETAIL_ZOOM - 2 ? 1 : 0);
  const dotIcon = (free, tone, far) => window.L.divIcon({ className: "mk-wrap", html: RL.dotHtml({ free, tone, far }), iconSize: [0, 0] });
  const toneOf = (free, waiting) => (free > 0 ? "good" : waiting > 0 ? "busy" : "bad");
  const roleOf = (list) => (list.some((s) => s.role === "primary") ? "primary" : list.some((s) => s.role === "backup") ? "backup" : "");
  function popupHtml(e, x) {
    const s = x.s, st = s.status, lines = [];
    const place = s.is_nearby ? (x.raw && x.raw.name) || e.name : e.name;
    lines.push({ b: place });
    lines.push(`${opLabel(s.operator)}${x.maker ? ` · 충전기 ${x.maker}` : ""}`);
    lines.push(`빈 급속 ${st.usable_fast} / 전체 ${x.fast}${st.waiting_fast ? ` · 충전 중 ${st.waiting_fast}` : ""}${st.unusable ? ` · 고장·점검 ${st.unusable}` : ""}`);
    lines.push(`${won(s.quote.final_price)}/kWh · ${infoAge(s.station_id)}`);
    lines.push(`${km(e.remaining_km)} 앞 · 도착 예상 ${pct(s.is_nearby ? s.arrival_soc_pct : e.arrival_soc_pct)}${s.is_nearby ? ` · 왕복 +${km(s.detour_km)}` : ""}`);
    if (s.role === "primary") lines.push({ b: "1순위" }); else if (s.role === "backup") lines.push({ b: "예비" });
    return RL.popupHtml(lines); // 글자는 relay.js 가 모두 이스케이프한다
  }
  function drawMap() {
    if (!map || !lastResult) return;
    const L = window.L, r = curRoute();
    mapLayer.clearLayers();
    mapLevel = levelOf(map.getZoom());
    mapDetail = mapLevel === 2;
    const spots = [];
    for (const e of lastResult.route_list.entries) {
      const area = r.rest_areas.find((a) => a.id === e.rest_area_id);
      if (!area) continue;
      const rawOf = new Map();
      for (const st of [...(area.stations || []), ...(area.nearby || []).map((n) => n.station)]) rawOf.set(st.id, st);
      const list = [...e.stations, ...e.nearby].map((s) => {
        const raw = rawOf.get(s.station_id) || null;
        return { s, raw, fast: raw && raw.chargers ? raw.chargers.filter((c) => c.type === "fast").length : s.status.usable_fast + s.status.waiting_fast + s.status.unusable,
          loc: (raw && raw.loc) || area.loc || null, maker: (raw && raw.maker) || "" };
      }).filter((x) => makerShown(x.maker));
      if (!list.length) continue;
      const areaLoc = area.loc || (list.find((x) => x.loc) || {}).loc || null;
      if (areaLoc) spots.push(areaLoc);
      if (mapDetail) {
        const same = !e.nearby.length ? list.filter((x) => x.loc) : []; // 한 휴게소 안의 충전소들은 자리가 거의 같다 → 옆으로 나란히 놓는다
        for (const x of list) {
          if (!x.loc) continue;
          const dx = same.length > 1 ? Math.round((same.indexOf(x) - (same.length - 1) / 2) * 86) : 0;
          const st = x.s.status;
          const m = L.marker(x.loc, { icon: bubbleIcon(aliasOf(x.s.operator) || x.s.operator, st.usable_fast, x.fast, x.maker, toneOf(st.usable_fast, st.waiting_fast), x.s.role || "", !x.s.reachable, dx), zIndexOffset: x.s.role === "primary" ? 500 : 0 });
          m.bindPopup(popupHtml(e, x), { maxWidth: 260 });
          mapLayer.addLayer(m);
        }
      } else if (areaLoc) { // 멀리서는 한 곳에 풍선 하나: 이름과 빈 급속 합계. 누르면 가까이 들어간다
        const free = list.reduce((n, x) => n + x.s.status.usable_fast, 0), total = list.reduce((n, x) => n + x.fast, 0);
        const waiting = list.reduce((n, x) => n + x.s.status.waiting_fast, 0);
        const name = e.name.replace(/휴게소$/, "").replace(/ 나들목$/, " IC");
        const role = roleOf(list.map((x) => x.s));
        const icon = mapLevel === 0 && role !== "primary" ? dotIcon(free, toneOf(free, waiting), !e.reachable) : bubbleIcon(name, free, total, "", toneOf(free, waiting), role, !e.reachable);
        const m = L.marker(areaLoc, { icon, zIndexOffset: role === "primary" ? 500 : 0 });
        m.on("click", () => { mapFollow = false; followBtn(); map.setView(areaLoc, MAP_DETAIL_ZOOM + 2, { animate: false }); });
        mapLayer.addLayer(m);
      }
    }
    // 길찾기로 받은 길은 선으로 그린다(노선을 바꾸거나 길을 새로 받으면 다시)
    const lineKey = r.navi && navi ? `navi|${navi.fetched_at}` : "";
    if (lineKey !== mapLineKey) {
      if (mapLine) { map.removeLayer(mapLine); mapLine = null; }
      if (lineKey) mapLine = L.polyline(navi.result.route.points, { color: "#2563d9", weight: 5, opacity: 0.55, interactive: false }).addTo(map);
      mapLineKey = lineKey;
    }
    drawAround();
    if (!spots.length && !arOn) mapMsg(r.live ? "앞에 남은 충전소가 없어요." : "예시 노선은 지도에 찍을 자리가 없어요. 실제 노선을 골라 주세요.");
    else if ($("#map-msg").textContent.startsWith("앞에 남은") || $("#map-msg").textContent.startsWith("예시 노선")) mapMsg("");
    // 노선을 바꾼 뒤 처음: 내 위치를 알면 거기로, 모르면 앞에 남은 곳이 다 보이게
    if (mapFitKey !== r.key && spots.length) {
      mapFitKey = r.key;
      if (mapMe && mapFollow) map.setView(mapMe.getLatLng(), MAP_FOLLOW_ZOOM, { animate: false });
      else map.fitBounds(L.latLngBounds(spots), { padding: [30, 30], maxZoom: MAP_FOLLOW_ZOOM, animate: false });
    }
  }
  function onMapFix(p) {
    if (!map) return;
    const L = window.L, ll = [p.coords.latitude, p.coords.longitude], acc = p.coords.accuracy || 0;
    if (/위치/.test($("#map-msg").textContent)) mapMsg("");
    if (!mapMe) {
      mapAcc = L.circle(ll, { radius: acc, stroke: false, fillColor: "#2563d9", fillOpacity: 0.12, interactive: false }).addTo(map);
      mapMe = L.circleMarker(ll, { radius: 9, color: "#fff", weight: 3, fillColor: "#2563d9", fillOpacity: 1, interactive: false, pane: "me" }).addTo(map);
    } else { mapMe.setLatLng(ll); mapAcc.setLatLng(ll); mapAcc.setRadius(acc); }
    if (mapFollow) { const z = Math.max(map.getZoom(), MAP_FOLLOW_ZOOM); map.setView(ll, z, { animate: z === map.getZoom() }); } // 확대가 바뀔 때는 바로 옮긴다(움직이는 그림이 끊기면 중간에 멈춘다)
    // 길찾기로 받은 길이면 길 위 km 를 따라 옮긴다 → 지나온 곳이 지도에서 빠지고 남은 거리가 바뀐다
    if (state.routeKey !== "navi" || !navi) return;
    const last = typeof state.naviKm === "number" && Math.abs(state.naviKm - state.pos) < 0.06 ? state.naviKm : null;
    let pos;
    try { pos = NV.locate(navi.result.route, ll, last); } catch (e) { return; }
    if (pos.off_route && last !== null) pos = NV.locate(navi.result.route, ll, null);
    if (pos.off_route) { mapMsg(`받아 둔 길에서 ${pos.offset_km.toFixed(1)}km 벗어났어요. '경로'에서 길 찾기를 다시 누르세요.`); return; }
    if ($("#map-msg").textContent.startsWith("받아 둔 길")) mapMsg("");
    if (mapLastKm !== null && Math.abs(pos.route_km - mapLastKm) < MAP_STEP_KM) return;
    mapLastKm = pos.route_km;
    state.naviKm = pos.route_km;
    state.pos = Math.round(pos.route_km * 10) / 10;
    persist();
    render();
  }
  function startWatch() {
    if (mapWatch !== null) return;
    if (!navigator.geolocation || window.isSecureContext === false) { mapMsg("이 화면에서는 지금 위치를 알 수 없어요. 충전소만 보여 줍니다."); return; }
    mapWatch = navigator.geolocation.watchPosition(onMapFix,
      (e) => mapMsg(e && e.code === 1 ? "위치 권한이 꺼져 있어 내 위치를 찍지 못해요. 충전소만 보여 줍니다." : "지금 위치를 받지 못하고 있어요. 폰의 위치(GPS)를 켜 주세요."),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
    // 지도를 보는 동안 화면이 꺼지지 않게(되는 폰에서만)
    if (navigator.wakeLock && navigator.wakeLock.request) navigator.wakeLock.request("screen").then((w) => { if (view === "map") mapWake = w; else w.release(); }).catch(() => { /* 무시 */ });
  }
  function stopWatch() {
    if (mapWatch !== null) { navigator.geolocation.clearWatch(mapWatch); mapWatch = null; }
    if (mapWake) { try { mapWake.release(); } catch (e) { /* 무시 */ } mapWake = null; }
    arStop();
  }

  // ---------- 지도: 주변 충전소(길 위가 아닌 곳까지) ----------
  // 지금 위치(따라가기를 끄면 지도 가운데)의 시군구를 알아내 그 시군구의 급속 충전소를 공공 데이터에서 받는다.
  // 시군구 하나가 수 MB 라서: 한 번 받은 시군구는 다시 받지 않고, 그 뒤로는 상태가 바뀐 충전기만 몇 분마다 가볍게 받는다.
  const AR = window.EvAround;
  const AROUND_KEY = "ev-charge-planner/around"; // 주변 충전소 켜기/끄기(이 폰에만)
  const AR_STATUS_MIN = 3;      // 상태를 다시 받는 간격(분)
  const AR_KEEP = 4;            // 받아 둔 시군구를 이만큼만 들고 있는다(오래된 것부터 버림)
  const AR_FULL_ZOOM = 15;      // 이보다 가까이 보면 주변 충전소도 세 줄 풍선
  const AR_MAX_BUBBLES = 40;    // 한 화면에 그리는 주변 풍선 수(가까운 것부터)
  const arRegions = new Map();  // zscode → { stations, fetched_at, status_at, used }
  let arOn = true, arBusy = "", arTimer = null, arLayer = null, arFail = new Map(), arWant = null;
  try { arOn = localStorage.getItem(AROUND_KEY) !== "off"; } catch (e) { /* 기본 켬 */ }
  const arCfg = () => (DATA.LIVE && DATA.LIVE.config) || null;
  function arBtn() {
    const b = $("#map-around");
    b.dataset.on = String(arOn);
    b.textContent = arOn ? (arBusy ? "주변 받는 중…" : "주변 충전소 켬") : "주변 충전소 끔";
  }
  // 지금 봐야 할 자리: 따라가는 중이면 내 위치, 아니면 지도 가운데
  function arCenter() {
    if (!map) return null;
    const c = mapFollow && mapMe ? mapMe.getLatLng() : map.getCenter();
    return [c.lat, c.lng];
  }
  async function arEnsure() {
    if (!arOn || !map || view !== "map" || !AR || !window.EvRegions) return;
    const cfg = arCfg(), key = storedKey(), at = arCenter(), rs = relaySet();
    if (!rs.on) { // 중계를 껐으면 지금까지와 같다
      if (!cfg) return;
      if (!key) { mapNote("주변 충전소를 보려면 '내 차·할인'에서 공공 데이터 키를 한 번 넣어 주세요. 지금은 길 위 충전소만 보여요."); return; }
    }
    if (map.getZoom() < MAP_DETAIL_ZOOM - 1) return; // 멀리 볼 때는 받지 않는다(여러 시군구가 한꺼번에 걸린다)
    const want = AR.zscodesNear(window.EvRegions, at[0], at[1]).slice(0, 3);
    if (!want.length) return;
    arWant = want;
    for (const z of want) { const r = arRegions.get(z); if (r) r.used = Date.now(); }
    const z = want.find((x) => !arRegions.has(x) && !(arFail.get(x) > Date.now()));
    if (!z || arBusy) return;
    arBusy = z;
    arBtn();
    try {
      const r = await RL.loadRegion({ settings: rs, href: location.href, key, zscode: z, tariffs: cfg ? cfg.tariffs : null,
        direct: key && cfg ? () => AR.fetchRegion(key, cfg, z) : null });
      arRegions.set(z, { stations: r.stations, fetched_at: r.fetched_at, status_at: r.status_at, used: Date.now(), source: r.source, zcodes: r.zcodes });
      while (arRegions.size > AR_KEEP) { // 가장 오래 안 쓴 시군구를 버린다
        let old = null;
        for (const [k, v] of arRegions) if (!old || v.used < arRegions.get(old).used) old = k;
        arRegions.delete(old);
      }
      if (r.note) mapNote(`주변 충전소: ${r.note}`);
      else if ($("#map-note").textContent.startsWith("주변 충전소를 받지") || $("#map-note").textContent.startsWith("주변 충전소: ")) mapNote("");
    } catch (e) {
      arFail.set(z, Date.now() + 60000); // 1분 뒤에 다시
      mapNote(`주변 충전소를 받지 못했어요(${e instanceof AR.ApiError || e instanceof RL.RelayError ? e.message : "연결 실패"}). 잠시 뒤 다시 받아요.`);
    } finally {
      arBusy = "";
      arBtn();
    }
    drawAround();
    arEnsure(); // 둘레 시군구가 남았으면 이어서
  }
  // 상태만 다시 받기: 받아 둔 시군구 가운데 지금 보는 곳만. 중계에서 받은 시군구는 중계의 상태 파일만 다시 읽는다
  async function arRefreshStatus() {
    if (!arOn || view !== "map" || document.hidden || arBusy) return;
    const cfg = arCfg(), key = storedKey(), rs = relaySet();
    for (const z of arWant || []) {
      const r = arRegions.get(z);
      if (!r) continue;
      if (r.source === "relay") {
        try {
          const out = await RL.refreshRegion({ settings: rs, href: location.href, key, zscode: z, region: r, direct: key && cfg ? () => AR.fetchRegion(key, cfg, z) : null });
          if (out.replaced) arRegions.set(z, { stations: out.replaced.stations, fetched_at: out.replaced.fetched_at, status_at: out.replaced.status_at, used: Date.now(), source: "direct", zcodes: [] });
          else r.status_at = out.status_at;
          if (out.note) mapNote(`주변 충전소: ${out.note}`); else if ($("#map-note").textContent.startsWith("주변 충전소: ")) mapNote("");
        } catch (e) { /* 다음 차례에 다시 */ }
        continue;
      }
      if (!cfg || !key) continue;
      const mins = Math.min(60, Math.ceil((Date.now() - r.status_at) / 60000) + 2); // 지난번 뒤로 바뀐 것을 넉넉히
      try {
        const at = Date.now();
        AR.applyStatus(r.stations, await AR.fetchStatus(key, cfg, z, mins), cfg, at);
        r.status_at = at;
      } catch (e) { /* 다음 차례에 다시 */ }
    }
    drawAround();
  }
  function mapNote(text) { const el = $("#map-note"); el.textContent = text; el.hidden = !text; }
  function arPopup(st, s) {
    return RL.popupHtml([{ b: st.name }, `${opLabel(st.operator)}${st.maker ? ` · 충전기 ${st.maker}` : ""}`,
      `빈 급속 ${s.free} / 전체 ${s.total}${s.busy ? ` · 충전 중 ${s.busy}` : ""}${s.broken ? ` · 고장·점검 ${s.broken}` : ""}`,
      `최대 ${Math.round(s.kw)}kW · ${st.price === null ? "" : `${won(st.price)}/kWh(추정) · `}${ago(st.updated)} 정보`, st.addr]);
  }
  function drawAround() {
    if (!map || !arLayer) return;
    arLayer.clearLayers();
    for (const r of arRegions.values()) if (r.source === "relay") RL.expire(r.stations, Date.now()); // 오래된 상태는 빈자리로 세지 않는다
    if (!arOn || map.getZoom() < MAP_DETAIL_ZOOM) { arCount(0, 0); return; }
    const L = window.L, b = map.getBounds().pad(0.15), c = map.getCenter();
    const onRoute = new Set(); // 길 위 충전소로 이미 그린 것은 다시 그리지 않는다
    if (lastResult) for (const e of lastResult.route_list.entries) for (const s of [...e.stations, ...e.nearby]) onRoute.add(s.station_id);
    const inView = [], full = map.getZoom() >= AR_FULL_ZOOM;
    for (const r of arRegions.values()) for (const st of r.stations) {
      if (onRoute.has(st.id) || !b.contains(st.loc) || !makerShown(st.maker)) continue;
      inView.push([(st.loc[0] - c.lat) ** 2 + ((st.loc[1] - c.lng) * 0.8) ** 2, st]);
    }
    inView.sort((x, y) => x[0] - y[0]);
    for (const [, st] of inView.slice(0, AR_MAX_BUBBLES)) {
      const s = AR.summary(st);
      // 가까이(AR_FULL_ZOOM 부터)는 업체·빈자리·제조사 세 줄, 그보다 멀면 한 줄(제조사 빈/전체)로 줄여 겹침을 던다
      const icon = full ? bubbleIcon(aliasOf(st.operator) || st.operator, s.free, s.total, st.maker, toneOf(s.free, s.busy), "", false, 0, true)
        : L.divIcon({ className: "mk-wrap", iconSize: [0, 0], html: RL.lineHtml({ top: (st.maker || aliasOf(st.operator) || st.operator).split("·")[0], free: s.free, total: s.total, tone: toneOf(s.free, s.busy) }) });
      const m = L.marker(st.loc, { icon });
      m.bindPopup(arPopup(st, s), { maxWidth: 260 });
      arLayer.addLayer(m);
    }
    arCount(Math.min(inView.length, AR_MAX_BUBBLES), inView.length);
  }
  function arCount(shown, all) {
    if (all > shown) mapNote(`이 화면에 주변 충전소 ${all}곳 중 가까운 ${shown}곳만 보여요. 더 가까이 확대해 보세요.`);
    else if ($("#map-note").textContent.startsWith("이 화면에 주변")) mapNote("");
  }
  let arMoveTimer = null;
  function arMoved() { // 지도가 멈춘 뒤 잠깐 기다렸다가(끌고 있는 동안 받지 않게)
    drawAround();
    clearTimeout(arMoveTimer);
    arMoveTimer = setTimeout(arEnsure, 600);
  }
  function arStart() {
    arBtn();
    if (arTimer === null) arTimer = setInterval(arRefreshStatus, AR_STATUS_MIN * 60000);
    drawAround(); // 받아 둔 것이 있으면 바로 그린다
    arEnsure();
  }
  function arStop() { if (arTimer !== null) { clearInterval(arTimer); arTimer = null; } }

  // ---------- 지도: 충전기 제조사 고르기 ----------
  // 체크한 제조사의 충전기가 있는 충전소만 지도에 보인다. 끈 것만 기억한다(새로 나온 제조사는 처음부터 보인다).
  const MAKER_KEY = "ev-charge-planner/makers-off";
  const NO_MAKER = "제조사 모름";
  let makerOff = new Set();
  try { makerOff = new Set(JSON.parse(localStorage.getItem(MAKER_KEY) || "[]")); } catch (e) { makerOff = new Set(); }
  const makersOf = (mk) => (mk ? mk.split("·") : [NO_MAKER]);
  const makerShown = (mk) => makerOff.size === 0 || makersOf(mk).some((m) => !makerOff.has(m));
  // 지금 가진 데이터(노선 전체 + 받아 둔 주변 시군구)에 나오는 제조사와 충전소 수, 많은 순
  function makerCounts() {
    const seen = new Set(), n = new Map();
    const add = (st) => { if (!st || seen.has(st.id)) return; seen.add(st.id); for (const m of makersOf(st.maker)) n.set(m, (n.get(m) || 0) + 1); };
    for (const r of DATA.ROUTES) if (r.live) for (const a of r.rest_areas) { for (const st of a.stations || []) add(st); for (const x of a.nearby || []) add(x.station); }
    for (const r of arRegions.values()) for (const st of r.stations) add(st);
    for (const m of makerOff) if (!n.has(m)) n.set(m, 0); // 꺼 둔 것은 지금 데이터에 없어도 목록에 남긴다(다시 켤 수 있게)
    return [...n.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  }
  function makerSave() { try { localStorage.setItem(MAKER_KEY, JSON.stringify([...makerOff])); } catch (e) { /* 무시 */ } }
  function makerBtn() {
    const all = makerCounts().length, on = makerCounts().filter(([m]) => !makerOff.has(m)).length;
    const b = $("#map-maker");
    b.textContent = makerOff.size ? `제조사 ${on}/${all} 고름` : "충전기 제조사";
    b.dataset.on = String(makerOff.size > 0);
  }
  function makerApply() { makerSave(); makerBtn(); drawMap(); }
  function makerPanel() {
    const list = $("#maker-list");
    list.replaceChildren();
    for (const [m, cnt] of makerCounts()) {
      const box = h("input", { type: "checkbox" });
      box.checked = !makerOff.has(m);
      box.addEventListener("change", () => { if (box.checked) makerOff.delete(m); else makerOff.add(m); makerApply(); });
      list.append(h("label", { class: "maker-item" }, box, h("span", { text: m }), h("small", { class: "num", text: `${cnt}곳` })));
    }
  }

  // ---------- 내 차·할인 ----------
  function fillForms() {
    $("#v-battery").value = state.battery;
    $("#v-eff").value = state.eff;
    $("#v-margin").value = state.margin;
    $("#v-min").value = state.minArrival;
    $("#v-stale").value = state.stale;
    $("#v-height").value = state.height > 0 ? state.height : "";
    $("#d-sub-op").value = state.subOp;
    $("#d-sub-rate").value = state.subRate;
    $("#d-sub-private").checked = !!state.subPrivate;
    $("#d-card-name").value = state.cardName;
    $("#d-card-rate").value = state.cardRate;
  }
  function readForms() {
    const num = (sel) => parseFloat($(sel).value);
    const next = Object.assign({}, state, {
      battery: num("#v-battery"), eff: num("#v-eff"), margin: num("#v-margin"), minArrival: num("#v-min"), stale: num("#v-stale"),
      height: $("#v-height").value.trim() ? num("#v-height") : 0,
      subOp: $("#d-sub-op").value, subRate: num("#d-sub-rate"), subPrivate: $("#d-sub-private").checked,
      cardName: $("#d-card-name").value, cardRate: num("#d-card-rate"),
    });
    const vErr = $("#vehicle-error"), dErr = $("#discount-error");
    vErr.hidden = true; dErr.hidden = true;
    const bad = (el, msg) => { el.textContent = msg; el.hidden = false; };
    if (!(next.battery > 0)) return bad(vErr, "배터리 용량은 0보다 커야 합니다.");
    if (!(next.eff > 0)) return bad(vErr, "전비는 0보다 커야 합니다.");
    if (!(next.margin >= 0 && next.margin < 100)) return bad(vErr, "안전 여유는 0~99 사이로 적어 주세요.");
    if (!(next.minArrival >= 0 && next.minArrival <= 100)) return bad(vErr, "최소 도착 잔량은 0~100 사이로 적어 주세요.");
    if (!(next.stale >= 0)) return bad(vErr, "오래됨 기준은 0 이상으로 적어 주세요.");
    if (!(next.height >= 0 && next.height < 10)) return bad(vErr, "차 높이는 미터로 적어 주세요. 예: 3.4 (일반 차·카고는 비워 둡니다)");
    if (next.subOp && !(next.subRate > 0 && next.subRate < 100)) return bad(dErr, "구독 할인은 1~99 사이로 적어 주세요.");
    if (next.cardName.trim() && !(next.cardRate > 0 && next.cardRate < 100)) return bad(dErr, "카드 할인은 1~99 사이로 적어 주세요.");
    state = next;
    persist();
    return true;
  }

  // 업체 이름·요금 목록(실제 데이터에 나오는 업체)
  function liveOperators() {
    const seen = new Map();
    for (const r of DATA.ROUTES) if (r.live) for (const a of r.rest_areas) for (const s of a.stations) {
      seen.set(s.operator, (seen.get(s.operator) || 0) + s.chargers.length);
    }
    // 구독한 업체 먼저, 그다음 충전기 많은 순
    return [...seen.entries()].sort((a, b) => (b[0] === state.subOp) - (a[0] === state.subOp) || b[1] - a[1]);
  }
  function fillOps() {
    const list = $("#ops-list");
    list.replaceChildren();
    const ops = liveOperators();
    if (!ops.length) { list.append(h("p", { class: "small muted", text: "실제 데이터가 없어서 고칠 업체가 없습니다." })); return; }
    ops.forEach(([op, n], i) => {
      const o = mine.ops[op] || {};
      list.append(h("div", { class: "op-row", "data-op": op },
        h("div", { class: "op-name" }, h("b", { text: op }), h("span", { class: "small muted", text: ` 충전기 ${n}대` })),
        h("div", { class: "grid2" },
          h("div", { class: "field" }, h("label", { for: `o-alias-${i}`, text: "보일 이름" }),
            h("input", { id: `o-alias-${i}`, class: "o-alias", placeholder: op, value: aliasOf(op) || null })),
          h("div", { class: "field" }, h("label", { for: `o-price-${i}`, text: "요금 (원/kWh)" }),
            h("input", { id: `o-price-${i}`, class: "o-price", type: "number", step: "0.1", min: "0", inputmode: "decimal", placeholder: "공공 데이터 값", value: o.price > 0 ? o.price : null })))));
    });
  }
  function readOps() {
    for (const row of document.querySelectorAll("#ops-list .op-row")) {
      const op = row.dataset.op;
      const alias = row.querySelector(".o-alias").value.trim();
      const price = parseFloat(row.querySelector(".o-price").value);
      const entry = { alias };
      if (price > 0) entry.price = price;
      mine.ops[op] = entry;
    }
    return saveMine();
  }
  function fillSubOptions() {
    const subSel = $("#d-sub-op");
    subSel.replaceChildren(h("option", { value: "", text: "구독 없음" }));
    for (const op of DATA.OPERATORS) subSel.append(h("option", { value: op, text: opLabel(op) }));
    subSel.value = state.subOp;
  }
  function fillRouteOptions() {
    const sel = $("#route-select");
    sel.replaceChildren();
    for (const r of allRoutes()) sel.append(h("option", { value: r.key, text: r.navi ? `▶ ${r.highway}` : `${r.highway} ${r.direction}${r.live || !DATA.LIVE ? "" : " (예시)"}` }));
    if (!allRoutes().some((r) => r.key === state.routeKey)) state.routeKey = DATA.ROUTES[0].key;
    sel.value = state.routeKey;
  }
  function savedMsg(el, ok) {
    el.textContent = ok ? `저장했어요 ${hhmm(Date.now())}` : "이 화면에서는 저장되지 않습니다. 크롬이나 삼성 인터넷으로 열어 주세요.";
    el.dataset.tone = ok ? "good" : "bad";
  }

  // ---------- 공공 데이터 새로 받기 ----------
  let busy = false;
  function liveMsg(text, tone) {
    for (const el of [$("#live-msg"), $("#live-msg-route")]) { el.textContent = text; el.dataset.tone = tone || ""; el.hidden = !text; }
  }
  function storedKey() { try { return localStorage.getItem(APIKEY_KEY) || ""; } catch (e) { return ""; } }
  let rfRelay = false; // 지금 받는 것이 중계인지(진행 창 글)
  async function doRefresh() {
    if (busy) { $("#rf-modal").hidden = false; return; } // 받는 중이면 진행 창을 다시 보여 준다
    const typed = $("#k-key").value.trim();
    if (typed) { try { localStorage.setItem(APIKEY_KEY, typed); } catch (e) { /* 저장 못 해도 이번엔 씀 */ } }
    const key = typed || storedKey(), rs = relaySet();
    if (!rs.on && !key) { // 중계를 껐으면 지금까지와 같이 키가 있어야 한다
      showView("my");
      liveMsg("인증키를 넣고 '새로 받기'를 누르세요. 공공데이터포털 마이페이지의 일반 인증키입니다.", "warn");
      $("#k-key").focus();
      return;
    }
    if (key) { $("#k-key").value = ""; $("#k-key").placeholder = "저장된 키 있음"; }
    const cfg = DATA.LIVE && DATA.LIVE.config;
    if (!rs.on && (!cfg || !window.EvLiveBuild)) { liveMsg("이 파일에는 새로 받기 설정이 없습니다. 새 파일을 받아 주세요.", "bad"); return; }
    busy = true;
    rfRelay = rs.on;
    const token = ++rfToken;
    const started = Date.now();
    setBusyUi(true, 0);
    rfShowProgress(null, null, started);
    rfTimer = setInterval(() => rfTick(started), 1000);
    liveMsg("");
    try {
      const onProgress = (d, n) => { if (token === rfToken) rfShowProgress(d, n, started); };
      const cur = curRoute();
      const out = await RL.refreshRest({ settings: rs, href: location.href, key, routeKey: cur.key, config: cfg || null, onProgress,
        extraIds: cur.live || cur.navi ? cur.rest_areas.flatMap((a) => (a.stations || []).map((s) => s.id)) : [],
        direct: key && cfg && window.EvLiveBuild ? () => window.EvLiveBuild.refresh(key, cfg, { onProgress }) : null });
      const live = out.live;
      if (token !== rfToken) return; // 취소한 뒤에 도착한 결과는 버린다
      // 새로 받기는 휴게소만 받는다. 나들목 인근 충전소는 PC 에서 만든 것을 그대로 옮긴다(상태 시각도 그때 것)
      const prev = DATA.LIVE;
      if (prev) {
        for (const r of live.routes) {
          const old = prev.routes.find((x) => x.key === r.key);
          const ics = old ? old.rest_areas.filter((a) => a.kind === "ic") : [];
          if (!ics.length) continue;
          r.rest_areas.push(...ics);
          r.rest_areas.sort((a, b) => a.km - b.km || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        }
        if (prev.ic_note) live.ic_note = prev.ic_note;
      }
      rfApply(live, out); // 다 받으면 바로 적용한다(진행 중 표시만, 바꿀지 묻지 않음)
    } catch (e) {
      if (token !== rfToken) return;
      const api = window.EvLiveBuild && e instanceof window.EvLiveBuild.ApiError;
      rfShowError(api ? `받지 못했어요: ${e.message}` : e instanceof RL.RelayError ? e.message
        : "공공 데이터 서버에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 받아 주세요. Claude 링크로 연 화면에서는 새로 받기가 막혀 있어요.");
    } finally {
      if (token === rfToken) finishBusy();
    }
  }

  // ---------- 새로 받기 진행 창: 진행 중 표시 → 끝나면 닫고 적용 / 오류면 다시 받기 ----------
  let rfToken = 0, rfTimer = null;
  const countChargers = (live) => live.routes.reduce((s, r) => s + r.rest_areas.reduce((t, a) => t + a.stations.reduce((u, st) => u + st.chargers.length, 0), 0), 0);
  function setBusyUi(on, pctDone) {
    const badge = $("#btn-refresh");
    badge.setAttribute("aria-busy", String(on));
    $("#btn-live").disabled = on;
    $("#btn-live").textContent = on ? `받는 중 ${pctDone}%` : "새로 받기";
    if (on) badge.textContent = `받는 중 ${pctDone}%`;
    else showSource(curRoute());
  }
  function finishBusy() {
    busy = false;
    clearInterval(rfTimer); rfTimer = null;
    setBusyUi(false);
  }
  function rfTick(started) { $("#rf-step").textContent = rfStepText(started); }
  let rfLast = { d: null, n: null };
  function rfStepText(started) {
    const sec = Math.round((Date.now() - started) / 1000);
    return `${rfLast.n ? `지역 ${rfLast.d}/${rfLast.n} · ` : ""}${sec}초`;
  }
  function rfShowProgress(d, n, started) {
    rfLast = { d, n };
    const pctDone = n ? Math.round((d / n) * 100) : 0;
    $("#rf-title").textContent = "충전소 정보 받는 중";
    $("#rf-progress").hidden = false;
    $("#rf-bar").classList.toggle("indeterminate", !n);
    $("#rf-bar").setAttribute("aria-valuenow", String(pctDone));
    $("#rf-fill").style.width = n ? `${pctDone}%` : "";
    $("#rf-pct").textContent = n ? `${pctDone}%` : "연결 중…";
    $("#rf-step").textContent = rfStepText(started);
    $("#rf-text").textContent = rfRelay ? "중계에서 휴게소 충전기 상태를 받고 있어요." : "공공데이터포털에서 전국 휴게소 충전기 상태를 받고 있어요. 보통 10~30초 걸려요.";
    $("#rf-retry").hidden = true;
    $("#rf-close").textContent = "취소";
    if (n) setBusyUi(true, pctDone);
    $("#rf-modal").hidden = false;
  }
  function rfShowError(text) {
    $("#rf-title").textContent = "받지 못했어요";
    $("#rf-progress").hidden = true;
    $("#rf-text").textContent = text + " 지금 정보는 그대로예요.";
    liveMsg(text, "bad"); // 창을 닫아도 남도록
    $("#rf-retry").hidden = false;
    $("#rf-close").textContent = "닫기";
    $("#rf-modal").hidden = false;
    $("#rf-retry").focus();
  }
  function rfApply(live, out) {
    $("#rf-modal").hidden = true;
    DATA.replaceLive(live);
    try { localStorage.setItem(LIVE_KEY, JSON.stringify(live)); } catch (e) { /* 저장 못 해도 이번 화면엔 씀 */ }
    if (navi) navi = buildNavi(navi) || navi; // 새로 받은 충전소 상태로 길 위 노선을 다시 만든다
    routes = allRoutes();
    fillRouteOptions(); fillSubOptions(); fillOps();
    let text = `${out && out.source === "relay" ? "중계에서 받았어요" : "새로 받았어요"} ${hhmm(live.fetched_at)} · 휴게소 충전기 ${countChargers(live)}대`;
    if (out && out.note) text = out.source === "direct" ? `${out.note}. ${text}` : `${text}. ${out.note}`;
    liveMsg(text, out && out.tone === "warn" ? "warn" : "good");
    render();
  }
  function rfClose() {
    if (busy) { // 받는 중에 취소: 결과가 와도 버린다
      rfToken += 1;
      finishBusy();
      liveMsg("새로 받기를 취소했어요. 지금 정보는 그대로예요.", "");
    }
    $("#rf-modal").hidden = true;
    $("#btn-refresh").focus();
  }

  function showView(name) {
    view = name;
    for (const v of ["route", "map", "my"]) {
      $(`#view-${v}`).hidden = v !== name;
      $(`#tab-${v}`).setAttribute("aria-selected", String(v === name));
    }
    document.body.classList.toggle("map-on", name === "map"); // 지도에서는 위 머리를 노선 고르기만 남기고 접는다
    if (name === "route" || name === "map") render();
    if (name === "map") openMap(); else stopWatch();
  }

  // ---------- 길찾기(카카오) → 길 위 충전소: 내비 방식 ----------
  // 카카오 길찾기 응답의 도로 조각을 같은 고속도로끼리 구간으로 합치고(web/navi.js), 길 위 휴게소·나들목만 한 노선으로 보여 준다.
  const NV = window.EvNavi;
  const PLACES = [ // 장소 찾기가 안 될 때 고르는 곳. [이름, 위도, 경도] — 역·시청 근처의 대략 위치
    ["서울시청", 37.5665, 126.9780], ["부산역", 35.1151, 129.0403], ["동대구역", 35.8797, 128.6286], ["대전역", 36.3323, 127.4346],
    ["광주송정역", 35.1378, 126.7916], ["울산시청", 35.5384, 129.3114], ["강릉역", 37.7644, 128.8996], ["목포역", 34.7913, 126.3866],
    ["여수엑스포역", 34.7528, 127.7494], ["포항시청", 36.0190, 129.3435], ["창원시청", 35.2281, 128.6811], ["전주시청", 35.8242, 127.1480],
    ["청주시청", 36.6424, 127.4890], ["춘천역", 37.8847, 127.7170], ["속초시청", 38.2070, 128.5918],
  ];
  const kakaoKey = () => { try { return localStorage.getItem(KAKAO_KEY) || ""; } catch (e) { return ""; } };
  function naviMsg(text, tone) { const el = $("#navi-msg"); el.textContent = text; el.dataset.tone = tone || ""; el.hidden = !text; }
  function naviKeyMsg(text, tone) { const el = $("#navi-key-msg"); el.textContent = text; el.dataset.tone = tone || ""; }
  // 실제 데이터의 고속도로 선과 휴게소·나들목을 엔진 입력 모양으로
  function naviSource() {
    const cfg = DATA.LIVE && DATA.LIVE.config;
    if (!cfg || !cfg.highways || !NV) return null;
    const highways = [], sideOf = new Map();
    for (const [hk, hw] of Object.entries(cfg.highways)) {
      highways.push({ id: hk, name: hw.name, points: hw.points, forward_name: hw.forward.direction, backward_name: hw.backward.direction });
      sideOf.set(hw.forward.key, [hk, "forward"]);
      sideOf.set(hw.backward.key, [hk, "backward"]);
    }
    const sites = [], seenIc = new Set();
    let withLoc = 0;
    for (const side of ["forward", "backward"]) for (const r of DATA.LIVE.routes) {
      const hs = sideOf.get(r.key);
      if (!hs || hs[1] !== side) continue;
      for (const a of r.rest_areas) {
        const ic = a.kind === "ic";
        if (ic) { // 나들목은 양쪽 방향 노선에 다 들어 있다 → 한 번만
          const k = `${hs[0]}|${a.name}`;
          if (seenIc.has(k)) continue;
          seenIc.add(k);
        }
        if (a.loc) withLoc += 1;
        sites.push({ id: a.id, name: a.name, kind: ic ? "ic" : "rest", highway_id: hs[0], direction: ic ? null : side, loc: a.loc || null, data: a });
      }
    }
    return { highways, sites, withLoc };
  }
  // 받아 둔 길(조각)과 지금 충전소 데이터로 '길 위 충전소' 노선을 만든다. 충전소 데이터를 새로 받으면 다시 만든다
  function buildNavi(saved) {
    const src = naviSource();
    if (!src || !saved || !Array.isArray(saved.pieces)) return null;
    const res = NV.matchRoute(saved.dest, saved.pieces, src.highways, src.sites);
    const used = new Set(), rest = [];
    for (const s of res.stops) { // 경로 위 km 순. 같은 충전소가 두 번 들어가지 않게 한다(엔진이 거부한다)
      const a = s.data;
      const stations = a.stations.filter((st) => !used.has(st.id));
      for (const st of stations) used.add(st.id);
      const nearby = (a.nearby || []).filter((n) => !used.has(n.station.id));
      for (const n of nearby) used.add(n.station.id);
      if (!stations.length && !nearby.length) continue;
      rest.push(Object.assign({}, a, { id: `navi-${a.id}`, km: Math.round(s.route_km * 10) / 10, stations, nearby }));
    }
    const route = { key: "navi", highway: `${saved.dest} 가는 길`, direction: "길찾기", length: Math.ceil(res.total_km), live: true, navi: true, rest_areas: rest };
    return { dest: saved.dest, fetched_at: saved.fetched_at, pieces: saved.pieces, result: res, route, noLoc: src.withLoc === 0 };
  }
  function naviSummary(n) {
    const res = n.result;
    if (n.noLoc) return ["휴게소 위치 정보가 없어요. '내 차·할인'에서 공공 데이터를 한 번 새로 받아 주세요.", "bad"];
    const roads = res.sections.map((s) => `${s.highway_name.replace("고속도로", "")} ${s.direction_name}`).join(" → ");
    const nRest = n.route.rest_areas.filter((a) => a.kind !== "ic").length, nIc = n.route.rest_areas.length - nRest;
    let text = `${n.dest}까지 ${Math.round(res.total_km)}km (${hhmm(n.fetched_at)}에 받음). `
      + (res.sections.length ? `${roads}. 길 위 휴게소 ${nRest}곳, 나들목 ${nIc}곳.` : "아는 고속도로를 지나지 않아요.");
    if (res.unmatched_highway_names.length) text += ` ${res.unmatched_highway_names.join(", ")}는 아직 자료가 없어 그 구간 충전소는 안 나와요.`;
    return [text, res.sections.length ? (res.unmatched_highway_names.length ? "warn" : "good") : "warn"];
  }
  const getPosition = () => new Promise((ok, no) => navigator.geolocation.getCurrentPosition(ok, no, { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 }));
  async function kakaoGet(url, key) {
    const res = await fetch(url, { headers: { Authorization: `KakaoAK ${key}` } });
    let body = null;
    try { body = await res.json(); } catch (e) { /* 본문 없음 */ }
    return { status: res.status, body };
  }
  // 목적지 글자 → [이름, 위도, 경도]. 목록에 있으면 그것, 없으면 카카오 장소 찾기
  async function findPlace(q, key) {
    const norm = (s) => s.replace(/\s+/g, "");
    const hit = PLACES.find((p) => norm(p[0]) === norm(q));
    if (hit) return hit;
    const r = await kakaoGet(`https://dapi.kakao.com/v2/local/search/keyword.json?size=1&query=${encodeURIComponent(q)}`, key);
    if (r.status === 401) throw new Error("카카오 키가 맞지 않아요. '내 차·할인'에서 다시 넣어 주세요.");
    const d = r.body && r.body.documents && r.body.documents[0];
    if (d) return [d.place_name || q, Number(d.y), Number(d.x)];
    // 카카오 장소 찾기가 꺼져 있거나(403) 못 찾으면: 열쇠가 필요 없는 오픈스트리트맵 검색(목적지 글자만 보낸다)
    let o = null;
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=kr&accept-language=ko&limit=1&q=${encodeURIComponent(q)}`);
      if (res.ok) o = (await res.json())[0] || null;
    } catch (e) { o = null; }
    if (!o) throw new Error(`'${q}'를 찾지 못했어요. 역·시청·동네 이름처럼 다른 이름으로 넣어 보세요.`);
    return [q, Number(o.lat), Number(o.lon)];
  }
  let naviBusy = false;
  async function doNavi(fromMap) {
    if (naviBusy) return;
    const say = fromMap ? (text) => mapMsg(text) : naviMsg; // 지도에서 찾으면 안내를 지도 위에
    const destEl = fromMap ? $("#map-dest") : $("#navi-dest");
    const key = kakaoKey();
    if (!key) {
      showView("my");
      naviKeyMsg("카카오 REST API 키를 넣고 저장한 뒤 다시 길 찾기를 누르세요.", "warn");
      $("#kk-key").focus();
      return;
    }
    const q = destEl.value.trim();
    if (!q) { say("목적지를 넣으세요. 예: 부산역", "warn"); destEl.focus(); return; }
    if (!naviSource()) { say("실제 고속도로 데이터가 든 파일에서만 됩니다.", "bad"); return; }
    if (!navigator.geolocation || window.isSecureContext === false) { say("이 화면에서는 지금 위치를 알 수 없어 길을 찾지 못해요.", "bad"); return; }
    naviBusy = true;
    $("#btn-navi").disabled = true;
    $("#btn-map-go").disabled = true;
    destEl.blur(); // 폰 글자판을 내린다
    try {
      say("지금 위치 찾는 중…", "");
      let p;
      try { p = await getPosition(); } catch (e) { throw new Error(e && e.code === 1 ? DENIED_SHORT : "지금 위치를 받지 못했어요. 폰의 위치(GPS)를 켜고 다시 눌러 주세요."); }
      try { localStorage.setItem(GEO_OK_KEY, "1"); } catch (e) { /* 무시 */ }
      say("길 찾는 중…", "");
      const place = await findPlace(q, key);
      const lat = p.coords.latitude, lng = p.coords.longitude;
      const r = await kakaoGet(`https://apis-navi.kakaomobility.com/v1/directions?origin=${lng},${lat}&destination=${place[2]},${place[1]}&priority=RECOMMEND`, key);
      if (r.status === 401 || r.status === 403) throw new Error("카카오 키가 맞지 않거나 길찾기를 쓸 수 없는 키예요. '내 차·할인'에서 확인해 주세요.");
      if (r.status === 429) throw new Error("카카오 길찾기 하루 한도를 다 썼어요.");
      if (r.status !== 200 || !r.body) throw new Error(`카카오 길찾기가 답하지 않았어요(${r.status}).`);
      const kr = NV.piecesFromKakao(r.body);
      const saved = { dest: place[0], fetched_at: Date.now(), pieces: kr.pieces };
      const built = buildNavi(saved);
      if (!built) throw new Error("길을 만들지 못했어요.");
      navi = built;
      try { localStorage.setItem(NAVI_KEY, JSON.stringify(saved)); } catch (e) { /* 저장 못 해도 이번 화면엔 씀 */ }
      routes = allRoutes();
      state.routeKey = "navi";
      const pos = NV.locate(navi.result.route, [lat, lng], null);
      state.naviKm = pos.route_km;
      state.pos = Math.round(pos.route_km * 10) / 10;
      editing = null;
      persist();
      fillRouteOptions();
      naviMsg(...naviSummary(navi));
      $("#navi-dest").value = navi.dest;
      $("#map-dest").value = navi.dest;
      locateMsg("");
      mapLastKm = null;
      render();
      if (fromMap) { mapMsg(naviSummary(navi)[0]); mapShowRoute(); }
    } catch (e) {
      const net = e instanceof TypeError; // fetch 가 연결 자체를 못 함
      say(net ? "카카오에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요." : e.message, "bad");
    } finally {
      naviBusy = false;
      $("#btn-navi").disabled = false;
      $("#btn-map-go").disabled = false;
    }
  }
  // 받아 둔 길 위에서 지금 위치 맞추기: 경로 위 km 로 바꾸고, 그보다 앞에 있는 것만 남는다
  function applyNaviFix(lat, lng, note) {
    const last = typeof state.naviKm === "number" && Math.abs(state.naviKm - state.pos) < 0.06 ? state.naviKm : null; // 손으로 옮겼으면 지난 위치를 버린다
    let pos;
    try { pos = NV.locate(navi.result.route, [lat, lng], last); } catch (e) { pos = NV.locate(navi.result.route, [lat, lng], null); }
    if (pos.off_route && last !== null) pos = NV.locate(navi.result.route, [lat, lng], null); // 지난 위치가 낡았을 수 있다 → 처음부터 다시 찾는다
    hidePick();
    if (pos.off_route) {
      locateMsg(`받아 둔 길에서 ${pos.offset_km.toFixed(1)}km 벗어났어요. '길 찾기'를 다시 누르세요${note}`, "bad");
      return;
    }
    state.naviKm = pos.route_km;
    state.pos = Math.round(pos.route_km * 10) / 10;
    persist();
    locateMsg(`${navi.dest} 가는 길 ${state.pos}km 지점으로 맞췄어요${note}`, "good");
    render();
  }

  // ---------- 지금 위치(GPS) → 노선·km ----------
  // 같은 고속도로를 달리는 중이면 보던 방향을 그대로 쓰고, 새 고속도로면 방향을 고르게 한다.
  let locating = false;
  function locateMsg(text, tone) {
    const el = $("#locate-msg");
    el.textContent = text; el.dataset.tone = tone || "";
  }
  function hidePick() { $("#pick-modal").hidden = true; $("#locate-pick").replaceChildren(); }
  // 가까운 고속도로 목록: 고속도로마다 이름·떨어진 거리와 방향 버튼 두 개. 지금 보는 노선은 눌린 모양으로.
  const PICK_COUNT = 4;
  function showPick(noteText, cands, note) {
    const list = $("#locate-pick");
    list.replaceChildren();
    for (const cand of cands) {
      const on = cand.sides.some((s) => s.key === state.routeKey);
      const dist = cand.off < 1 ? `${Math.round(cand.off * 1000 / 10) * 10}m` : `${cand.off < 10 ? cand.off.toFixed(1) : Math.round(cand.off)}km`;
      const row = h("div", { class: "pick-hw", "data-on": String(on) },
        h("div", { class: "pick-name" }, h("span", { text: cand.highway }), h("span", { class: "pick-dist", text: cand.off <= 0.05 ? "이 길 위" : `여기서 ${dist}` })));
      for (const side of cand.sides) {
        const b = h("button", { type: "button", text: side.direction, "aria-pressed": String(side.key === state.routeKey) });
        b.addEventListener("click", () => goTo(cand, side, note));
        row.append(b);
      }
      list.append(row);
    }
    $("#pick-note").textContent = noteText;
    $("#pick-modal").hidden = false;
    const first = list.querySelector('button[aria-pressed="true"]') || list.querySelector("button");
    if (first) first.focus();
  }
  // keepOpen: 목록을 이어서 보여 줄 때(자동으로 맞춘 뒤 다른 길로 바꿀 수 있게)
  function goTo(cand, side, note, keepOpen) {
    const r = routes.find((x) => x.key === side.key);
    if (!r) { hidePick(); locateMsg(`${cand.highway} ${side.direction} 노선에 휴게소 데이터가 없어요.`, "bad"); return; }
    state.routeKey = side.key;
    state.pos = Math.max(0, Math.min(r.length, Math.round(side.km)));
    editing = null;
    persist();
    $("#route-select").value = side.key;
    if (!keepOpen) { hidePick(); $("#btn-locate").focus(); }
    locateMsg(`${cand.highway} ${side.direction} ${state.pos}km 지점으로 맞췄어요${note}`, "good");
    render();
  }
  function applyFix(lat, lng, accuracy) {
    const L = window.EvLiveBuild;
    const { candidates, ranked } = L.locate([lat, lng], DATA.LIVE.config);
    const acc = accuracy ? ` · 오차 약 ${accuracy < 1000 ? `${Math.round(accuracy)}m` : `${(accuracy / 1000).toFixed(1)}km`}` : "";
    const note = ` (${hhmm(Date.now())}${acc})`;
    if (state.routeKey === "navi" && navi) { applyNaviFix(lat, lng, note); return; }
    const list = ranked.slice(0, PICK_COUNT);
    // 보던 고속도로 위(2km 안)를 계속 달리는 중이면 km 는 바로 맞추고, 목록은 다른 길로 바꿀 수 있게 그대로 보여 준다
    const kept = L.keepSide(candidates, state.routeKey);
    if (kept) {
      goTo(kept.cand, kept.side, note, true);
      showPick(`${kept.cand.highway} ${kept.side.direction} ${state.pos}km 지점으로 맞췄어요. 다른 길이면 고르세요.`, list, note);
      return;
    }
    if (candidates.length) {
      locateMsg(`${candidates.map((c) => c.highway).join(" · ")} 위예요. 가는 방향을 고르세요${note}`, "");
      showPick("가는 방향을 고르세요.", list, note);
    } else {
      locateMsg(`고속도로 위가 아니에요. 가까운 고속도로에서 가는 방향을 고르세요${note}`, "");
      showPick("지금은 고속도로 위가 아니에요. 탈 고속도로와 가는 방향을 고르면, 가장 가까운 지점으로 맞춰요.", list, note);
    }
  }
  // force: 막혀 있어도 한 번 더 요청한다('권한 허용' 버튼). 브라우저가 다시 물어 주면 그 자리에서 허용된다.
  async function doLocate(force) {
    if (locating) return;
    force = force === true;
    if (!DATA.LIVE || !DATA.LIVE.config || !DATA.LIVE.config.highways || !window.EvLiveBuild || !window.EvLiveBuild.locate) {
      locateMsg("실제 고속도로 데이터가 든 파일에서만 됩니다. 새 파일을 받아 주세요.", "bad");
      return;
    }
    if (!navigator.geolocation) { locateMsg("이 브라우저는 위치를 알려 주지 않아요. 노선과 위치를 직접 고르세요.", "bad"); return; }
    // 브라우저는 https 같은 '안전한 주소'에서만 위치를 준다. 폰의 파일 앱으로 연 html(content://)은 권한을 허용해도 막힌다
    if (window.isSecureContext === false) {
      locateMsg("이렇게 연 화면에서는 브라우저가 위치를 막아요. 노선과 위치를 직접 고르세요.", "bad");
      geoModal(INSECURE_TEXT + `\n\n(지금 주소 형식: ${location.protocol.replace(":", "")})`, "확인");
      return;
    }
    locating = true;
    $("#btn-locate").disabled = true;
    $("#btn-locate").setAttribute("aria-busy", "true");
    const done = () => { locating = false; $("#btn-locate").disabled = false; $("#btn-locate").setAttribute("aria-busy", "false"); };
    const st = await geoPermission();
    if (st === "denied" && !force) {
      done();
      locateMsg(DENIED_SHORT, "bad");
      showDenied(DENIED_TEXT);
      return;
    }
    // 브라우저가 권한을 물어볼 수 있는 때(처음 등)에는 그 순간에 안내 창을 같이 띄운다
    const asking = force || st === "prompt" || (st === "unknown" && !geoGrantedBefore());
    if (asking) geoModal(force
      ? "다시 요청했어요. 브라우저가 물어보면 '허용'을 눌러 주세요."
      : (IS_APP ? "폰이 이 앱에 위치를 알려 줄지 물어봐요.\n'앱 사용 중에만 허용'을 눌러 주세요.\n\n" : "브라우저가 이 페이지에 위치를 알려 줄지 물어봐요.\n'허용'을 눌러 주세요.\n\n") + "위치는 지금 달리는 고속도로와 km 를 맞추는 데만 쓰고, 폰 밖으로 보내지 않아요.", "닫기");
    locateMsg("위치 찾는 중…", "");
    navigator.geolocation.getCurrentPosition((p) => {
      done();
      waitingGrant = false;
      closeGeoModal();
      try { localStorage.setItem(GEO_OK_KEY, "1"); } catch (e) { /* 무시 */ }
      applyFix(p.coords.latitude, p.coords.longitude, p.coords.accuracy);
    }, (err) => {
      done();
      hidePick();
      const code = err && err.code;
      const msg = {
        1: DENIED_SHORT,
        2: "위치를 찾지 못했어요. 폰의 위치(GPS)를 켜고 다시 눌러 주세요.",
        3: "위치를 찾는 데 너무 오래 걸려요. 다시 눌러 주세요.",
      }[code] || "위치를 받지 못했어요. 노선과 위치를 직접 고르세요.";
      locateMsg(msg, "bad");
      // 다시 요청했는데도 바로 막히면 브라우저가 '차단'을 기억하고 다시 묻지 않는 상태다 → 설정에서 바꾸는 법
      // 브라우저가 준 이유도 붙인다(원인 찾기용)
      const why = err && err.message ? `\n\n(브라우저 메시지: ${err.message})` : "";
      if (code === 1) showDenied((force ? STILL_BLOCKED_TEXT : DENIED_TEXT) + why);
      else closeGeoModal();
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 });
  }
  // ---------- 위치 권한 안내 창 ----------
  const GEO_OK_KEY = "ev-charge-planner/geo-ok"; // 한 번이라도 위치를 받았는지(권한 상태를 못 읽는 브라우저용)
  const DENIED_SHORT = "위치 권한이 꺼져 있어요. 노선과 위치를 직접 고르거나, 권한을 허용한 뒤 다시 눌러 주세요.";
  // 안드로이드 앱(Capacitor)으로 열었는지. 앱에서는 위치 권한을 안드로이드가 묻고, 설정도 앱 설정에서 바꾼다
  const IS_APP = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const HOW_TO_APP = "폰 설정 → 애플리케이션 → 충전 길잡이 → 권한 → 위치에서 '앱 사용 중에만 허용'으로 바꿔 주세요.\n"
    + "폰 위치(GPS)가 켜져 있는지도 봐 주세요.\n\n"
    + "바꾸고 앱으로 돌아오면 바로 위치를 맞춰요.";
  const HOW_TO = IS_APP ? HOW_TO_APP : "크롬: 주소창 왼쪽 아이콘(또는 ⋮ → 설정 → 사이트 설정 → 위치)에서 이 페이지를 '허용'으로 바꿔 주세요.\n"
    + "삼성 인터넷: ≡ → 설정 → 사이트 및 다운로드 → 사이트 권한 → 위치에서 바꿔 주세요.\n"
    + "폰 설정에서 위치(GPS)가 켜져 있는지도 봐 주세요.\n\n"
    + "바꾸고 이 화면으로 돌아오면 바로 위치를 맞춰요.\n"
    + "Claude 링크로 연 화면에서는 위치를 받을 수 없어요. 폰에 저장한 '충전길잡이.html'로 여세요.";
  const INSECURE_TEXT = "폰의 파일 앱에서 연 html 은 브라우저가 '안전한 주소'로 보지 않아서, 위치 권한을 허용해도 위치를 주지 않아요.\n\n"
    + "위치를 쓰려면 https 주소로 열어야 해요. 그때까지는 노선과 '지금 위치' 막대를 직접 맞춰 주세요.";
  const DENIED_TEXT = "위치 권한이 꺼져 있어요.\n'권한 허용'을 누르면 다시 요청해요.\n\n"
    + (IS_APP ? "다시 묻지 않고 그대로 막히면" : "브라우저가 묻지 않고 그대로 막히면") + " 아래처럼 바꿔 주세요.\n" + HOW_TO;
  const STILL_BLOCKED_TEXT = (IS_APP
    ? "안드로이드가 이 앱의 위치를 막아 두어서 다시 묻지 않아요. 아래처럼 직접 바꿔야 해요.\n\n"
    : "브라우저가 이 페이지의 위치를 막아 두어서 다시 묻지 않아요. 페이지가 대신 풀 수는 없어서, 아래처럼 직접 바꿔야 해요.\n\n") + HOW_TO;
  // 막혀 있다고 안내한 뒤 권한이 '허용'으로 바뀌면(설정에서 바꾸고 돌아오면) 버튼을 다시 누르지 않아도 맞춘다
  let waitingGrant = false;
  function showDenied(text) {
    waitingGrant = true;
    geoModal(text, "닫기", "권한 허용");
  }
  async function retryIfGranted() {
    if (!waitingGrant || locating) return;
    // 앱 안 브라우저는 권한 상태를 믿을 수 없어서, 앱으로 돌아오면 한 번 다시 요청해 본다
    if (IS_APP) { waitingGrant = false; closeGeoModal(); doLocate(true); return; }
    if (await geoPermission() === "granted") { waitingGrant = false; closeGeoModal(); doLocate(); }
  }
  (async () => {
    try {
      if (!navigator.permissions || !navigator.permissions.query) return;
      const status = await navigator.permissions.query({ name: "geolocation" });
      status.addEventListener("change", retryIfGranted);
    } catch (e) { /* 못 읽는 브라우저는 돌아왔을 때(visibilitychange) 확인 */ }
  })();
  function geoGrantedBefore() { try { return localStorage.getItem(GEO_OK_KEY) === "1"; } catch (e) { return false; } }
  async function geoPermission() {
    if (IS_APP) return "unknown"; // 앱에서는 미리 읽지 않고 바로 요청한다(안드로이드가 묻는다)
    try {
      if (navigator.permissions && navigator.permissions.query) return (await navigator.permissions.query({ name: "geolocation" })).state;
    } catch (e) { /* 못 읽는 브라우저 */ }
    return "unknown";
  }
  // allowLabel 이 있으면 '권한 허용'(다시 요청) 버튼을 앞에 두고, 닫기 버튼은 옅게
  function geoModal(text, closeLabel, allowLabel) {
    $("#geo-text").textContent = text;
    $("#geo-ok").textContent = closeLabel;
    $("#geo-allow").hidden = !allowLabel;
    if (allowLabel) $("#geo-allow").textContent = allowLabel;
    $("#geo-ok").className = allowLabel ? "btn btn-ghost" : "btn btn-primary";
    $("#geo-modal").hidden = false;
    (allowLabel ? $("#geo-allow") : $("#geo-ok")).focus();
  }
  function closeGeoModal() {
    if ($("#geo-modal").hidden) return;
    const hadFocus = $("#geo-modal").contains(document.activeElement);
    $("#geo-modal").hidden = true;
    // 창 안에 있던 초점은 '지금 위치로' 버튼으로(위치를 찾는 중이라 잠겨 있으면 창 밖으로만 뺀다)
    if (hadFocus) { document.activeElement.blur(); $("#btn-locate").focus(); }
  }

  // ---------- 화면 꺼짐 방지 ----------
  // 이 화면이 떠 있는 동안에는 폰 화면이 꺼지지 않게 한다(웹: Screen Wake Lock, 앱: 안드로이드 쪽에서도 켬).
  // 다른 앱으로 갔다 오면 브라우저가 풀어 버리므로 돌아올 때 다시 건다. 못 쓰는 브라우저에서는 조용히 넘어간다.
  let wakeLock = null;
  async function keepAwake() {
    if (wakeLock || document.hidden || !navigator.wakeLock || !navigator.wakeLock.request) return;
    try {
      const lock = await navigator.wakeLock.request("screen");
      wakeLock = lock;
      lock.addEventListener("release", () => { if (wakeLock === lock) wakeLock = null; });
    } catch (e) { /* 절전 모드 등으로 거절되면 그대로 둔다 */ }
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) keepAwake(); });
  document.addEventListener("pointerdown", keepAwake); // 처음 열자마자는 막는 브라우저가 있어, 화면을 누를 때도 건다
  keepAwake();

  // ---------- 연결 ----------
  $("#btn-locate").addEventListener("click", () => doLocate());
  $("#geo-allow").addEventListener("click", () => doLocate(true));
  $("#geo-ok").addEventListener("click", closeGeoModal);
  $("#btn-ic-all").addEventListener("click", () => { state.icOpen = !state.icOpen; icOne.clear(); persist(); render(); });
  $("#pick-close").addEventListener("click", () => { hidePick(); $("#btn-locate").focus(); });
  $("#pick-modal").addEventListener("click", (ev) => { if (ev.target === ev.currentTarget) hidePick(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) retryIfGranted(); });
  $("#geo-modal").addEventListener("click", (e) => { if (e.target === e.currentTarget) closeGeoModal(); });
  document.addEventListener("keydown", (e) => { if (e.key !== "Escape") return; if (!$("#geo-modal").hidden) closeGeoModal(); else if (!$("#pick-modal").hidden) hidePick(); else if (!$("#rf-modal").hidden) rfClose(); });
  $("#rf-retry").addEventListener("click", () => doRefresh());
  $("#rf-close").addEventListener("click", rfClose);
  const sel = $("#route-select");
  try { // 받아 둔 길이 있으면 다시 만든다(충전소 상태는 지금 데이터로)
    const savedNavi = JSON.parse(localStorage.getItem(NAVI_KEY) || "null");
    if (savedNavi) navi = buildNavi(savedNavi);
  } catch (e) { navi = null; }
  if (navi) { routes = allRoutes(); $("#navi-dest").value = navi.dest; $("#map-dest").value = navi.dest; if (state.routeKey === "navi") naviMsg(...naviSummary(navi)); }
  else if (state.routeKey === "navi") state.routeKey = DEFAULTS.routeKey;
  fillRouteOptions();
  sel.addEventListener("change", () => {
    state.routeKey = sel.value; state.pos = 0; editing = null; hidePick(); locateMsg(""); persist(); render();
    // 중계에서는 고른 노선의 상태만 받는다 → 아직 안 받은 노선이면 알려 준다
    const hint = RL.routeHint(DATA.LIVE, curRoute().rest_areas.flatMap((a) => (a.stations || []).map((s) => s.id)));
    if (hint) liveMsg(hint, "warn"); else if ($("#live-msg").textContent.startsWith("이 노선의 상태는")) liveMsg("");
  });
  $("#soc").addEventListener("input", (e) => { state.soc = Number(e.target.value); persist(); render(); });
  $("#pos").addEventListener("input", (e) => { state.pos = Number(e.target.value); hidePick(); locateMsg(""); persist(); render(); });
  fillSubOptions();
  fillOps();
  // 입력하는 대로도 저장하고, '저장'을 누르면 저장됐다고 알려 준다
  for (const [form, msgId] of [[$("#vehicle-form"), "#vehicle-saved"], [$("#discount-form"), "#discount-saved"]]) {
    form.addEventListener("input", () => { readForms(); $(msgId).textContent = ""; });
    form.addEventListener("submit", (e) => { e.preventDefault(); if (readForms()) { savedMsg($(msgId), storageOk); fillOps(); } });
  }
  $("#ops-form").addEventListener("submit", (e) => { e.preventDefault(); savedMsg($("#ops-saved"), readOps() && storageOk); fillSubOptions(); });
  $("#live-form").addEventListener("submit", (e) => { e.preventDefault(); doRefresh(); });
  $("#btn-refresh").addEventListener("click", () => { if (curRoute().live) doRefresh(); else showView("my"); });
  $("#btn-key-clear").addEventListener("click", () => {
    try { localStorage.removeItem(APIKEY_KEY); } catch (e) { /* 무시 */ }
    $("#k-key").value = ""; $("#k-key").placeholder = "처음 한 번만 넣으면 됩니다";
    liveMsg("키를 지웠어요.", "");
  });
  if (storedKey()) $("#k-key").placeholder = "저장된 키 있음";
  // 공공 데이터 중계: 켜기/끄기와 주소(이 폰에만)
  function relayMsg(text, tone) { const el = $("#relay-msg"); el.textContent = text; el.dataset.tone = tone || ""; }
  function relayReset() { arRegions.clear(); arFail.clear(); if (view === "map") { drawAround(); arEnsure(); } } // 받아 둔 주변 충전소는 버리고 새 설정으로 다시
  { const rs = relaySet(); $("#relay-on").checked = rs.on; $("#relay-base").value = rs.base; }
  $("#relay-on").addEventListener("change", () => {
    const on = $("#relay-on").checked, ok = RL.saveOn(LS, on);
    relayMsg(ok ? (on ? "공공 데이터를 중계에서 받아요." : "중계를 껐어요. 폰이 공공 데이터를 직접 받아요.") : "이 화면에서는 저장되지 않습니다. 크롬이나 삼성 인터넷으로 열어 주세요.", ok ? "good" : "bad");
    relayReset();
  });
  $("#relay-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const out = RL.saveBase(LS, $("#relay-base").value);
    if (!out.ok) { relayMsg(out.reason, "bad"); return; } // 저장하지 않고 까닭을 보여 준다
    RL.saveOn(LS, $("#relay-on").checked);
    $("#relay-base").value = out.base;
    relayMsg(`저장했어요 ${hhmm(Date.now())}`, "good");
    relayReset();
  });
  // 길찾기: 카카오 키(이 폰에만)와 목적지
  if (kakaoKey()) $("#kk-key").placeholder = "저장된 키 있음";
  $("#navi-key-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const typed = $("#kk-key").value.trim();
    if (!typed) { naviKeyMsg(kakaoKey() ? "저장된 키가 있어요." : "키를 넣으세요.", kakaoKey() ? "" : "warn"); return; }
    let ok = true;
    try { localStorage.setItem(KAKAO_KEY, typed); } catch (err) { ok = false; }
    $("#kk-key").value = "";
    if (ok) $("#kk-key").placeholder = "저장된 키 있음";
    naviKeyMsg(ok ? `저장했어요 ${hhmm(Date.now())}. '충전소' 화면에서 목적지를 넣고 길 찾기를 누르세요.` : "이 화면에서는 저장되지 않습니다. 크롬이나 삼성 인터넷으로 열어 주세요.", ok ? "good" : "bad");
  });
  $("#btn-kk-clear").addEventListener("click", () => {
    try { localStorage.removeItem(KAKAO_KEY); } catch (e) { /* 무시 */ }
    $("#kk-key").value = ""; $("#kk-key").placeholder = "처음 한 번만 넣으면 됩니다";
    naviKeyMsg("키를 지웠어요.", "");
  });
  for (const p of PLACES) $("#navi-places").append(h("option", { value: p[0] }));
  $("#navi-form").addEventListener("submit", (e) => { e.preventDefault(); doNavi(); });
  $("#map-search").addEventListener("submit", (e) => { e.preventDefault(); doNavi(true); });
  $("#storage-warn").hidden = storageOk;
  for (const tab of document.querySelectorAll(".tabbar [data-view]")) tab.addEventListener("click", () => showView(tab.dataset.view));
  $("#btn-shuffle").addEventListener("click", () => {
    routes = routes.map((r) => DATA.shuffled(r, Math.random));
    showView("route");
  });
  $("#btn-reset").addEventListener("click", () => { routes = allRoutes(); showView("route"); });  $("#about").textContent = "계산 엔진은 파이썬 ev-charge-planner 를 자바스크립트로 옮긴 것이고, 같은 입력에 같은 답을 내는지 대조해 확인했습니다.";
  document.addEventListener("visibilitychange", () => { if (!document.hidden && view === "route") render(); });
  $("#map-follow").addEventListener("click", () => { mapFollow = true; followBtn(); if (map && mapMe) map.setView(mapMe.getLatLng(), Math.max(map.getZoom(), MAP_FOLLOW_ZOOM)); else if (!mapMe) startWatch(); });
  window.addEventListener("resize", () => { if (view === "map") placeMap(); });
  $("#map-maker").addEventListener("click", () => { const p = $("#maker-panel"); p.hidden = !p.hidden; if (!p.hidden) makerPanel(); });
  $("#maker-close").addEventListener("click", () => { $("#maker-panel").hidden = true; });
  $("#maker-all").addEventListener("click", () => { makerOff.clear(); makerApply(); makerPanel(); });
  $("#maker-none").addEventListener("click", () => { makerOff = new Set(makerCounts().map(([m]) => m)); makerApply(); makerPanel(); });
  $("#map-around").addEventListener("click", () => {
    arOn = !arOn;
    try { localStorage.setItem(AROUND_KEY, arOn ? "on" : "off"); } catch (e) { /* 무시 */ }
    arBtn();
    if (arOn) arStart(); else { arStop(); mapNote(""); drawAround(); }
  });
  document.addEventListener("visibilitychange", () => { if (view !== "map") return; if (document.hidden) stopWatch(); else { startWatch(); arStart(); arRefreshStatus(); } });
  // '몇 분 전'이 시간이 지나며 바뀌도록 1분마다 다시 그린다(고치는 중엔 건드리지 않음)
  setInterval(() => { if (!document.hidden && view === "route" && editing === null && !busy) render(); }, 60000);

  fillForms();
  showView("route");
})();
