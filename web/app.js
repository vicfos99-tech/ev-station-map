/* 충전 길잡이 — 화면 로직. 계산은 engine.js(EvPlanner)만 쓴다. 데이터는 data.js 의 예시 노선. */
(function () {
  "use strict";
  const EV = window.EvPlanner;
  const DATA = window.EvData;
  const KEY = "ev-charge-planner/v1";
  const $ = (sel) => document.querySelector(sel);
  const MINE_KEY = "ev-charge-planner/mine";     // 내가 확인한 값(업체 이름·요금, 충전소 요금·상태)
  const LIVE_KEY = "ev-charge-planner/live";     // 폰에서 새로 받은 공공 데이터
  const APIKEY_KEY = "ev-charge-planner/apikey"; // 공공데이터포털 키(이 폰에만)

  const storageOk = (() => {
    try { localStorage.setItem("ev-charge-planner/test", "1"); return localStorage.getItem("ev-charge-planner/test") === "1"; } catch (e) { return false; }
  })();
  // 폰에서 새로 받은 데이터가 파일에 든 것보다 새로우면 그걸 쓴다
  try {
    const saved = JSON.parse(localStorage.getItem(LIVE_KEY) || "null");
    if (saved && saved.routes && (!DATA.LIVE || saved.fetched_at > DATA.LIVE.fetched_at)) DATA.replaceLive(saved);
  } catch (e) { /* 못 읽으면 파일 데이터 */ }

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
  if (!DATA.ROUTES.some((r) => r.key === state.routeKey)) state.routeKey = DEFAULTS.routeKey;
  let routes = DATA.ROUTES.slice(); // 상태를 바꿔 보면 여기만 바뀐다(저장 안 함)
  let view = "route";
  let editing = null;   // 고치는 중인 충전소 id
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
    for (const a of route.rest_areas) for (const st of [...a.stations, ...a.nearby.map((n) => n.station)]) applyMine(st, liveAt);
    lastRoute = route;
    return { route, vehicle, user, now };
  }
  // 내가 확인한 값 덮어쓰기: 업체 요금 → 충전소 요금 → 충전기 상태(받은 뒤에 확인한 것만)
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
  function findStation(route, id) {
    if (!route) return null;
    for (const a of route.rest_areas) for (const st of [...a.stations, ...a.nearby.map((n) => n.station)]) if (st.id === id) return st;
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
  function stationEl(s) {
    const st = s.status;
    const meta = [];
    if (s.role === "primary") meta.push(chip("1순위", "sign"));
    if (s.role === "backup") meta.push(chip("예비", "backup"));
    meta.push(chip(`빈 급속 ${st.usable_fast}`, st.usable_fast > 0 ? "good" : null));
    if (st.waiting_fast) meta.push(chip(`충전 중 ${st.waiting_fast}`));
    if (st.usable_slow) meta.push(chip(`빈 완속 ${st.usable_slow}`));
    if (st.unusable) meta.push(chip(`고장·점검 ${st.unusable}`, "warn"));
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
      h("div", { class: "op", text: opLabel(s.operator) }), priceEl(s.quote), h("div", { class: "meta" }, meta),
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
    const rows = st.chargers.map((c, i) => {
      const sel = h("select", { id: `e-st-${safe}-${i}` }, h("option", { value: "", text: "공공 데이터대로" }),
        Object.entries(STATUS_TEXT).map(([v, t]) => h("option", { value: v, text: t })));
      sel.value = active.status && m.statuses[i] ? m.statuses[i] : "";
      return h("div", { class: "field" }, h("label", { for: sel.id, text: `${i + 1}번 ${c.type === "fast" ? "급속" : "완속"} ${Math.round(c.power_kw)}kW` }), sel);
    });
    const msg = h("span", { class: "saved-msg small", "aria-live": "polite" });
    const save = h("button", { type: "button", class: "btn btn-primary", text: "저장" });
    const clear = h("button", { type: "button", class: "btn btn-ghost", text: "내 값 지우기" });
    save.addEventListener("click", () => {
      const price = parseFloat(priceIn.value);
      const statuses = rows.map((r) => r.querySelector("select").value || null);
      if (priceIn.value.trim() && !(price > 0)) { msg.textContent = "요금은 0보다 큰 숫자로 적어 주세요."; return; }
      if (!(price > 0) && !statuses.some(Boolean)) delete mine.stations[id];
      else mine.stations[id] = { price: price > 0 ? price : undefined, statuses, at: Date.now() };
      editing = null;
      if (!saveMine()) alertMsg("이 화면에서는 저장되지 않습니다. 크롬이나 삼성 인터넷으로 열어 주세요.");
      render();
    });
    clear.addEventListener("click", () => { delete mine.stations[id]; saveMine(); editing = null; render(); });
    return h("div", { class: "editor" },
      h("div", { class: "small muted", text: "실제로 확인한 값만 넣으세요. 상태는 이보다 새 공공 데이터를 받으면 그 값으로 돌아가고, 요금은 지울 때까지 남습니다." }),
      h("div", { class: "field" }, h("label", { for: priceIn.id, text: "요금 (원/kWh, 할인 전)" }), priceIn),
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
      note.textContent = `${DATA.LIVE.source}에서 ${when}(${age})에 받은 상태입니다. 그 뒤로 바뀌었을 수 있으니 도착 전에 다시 확인하세요. 휴게소 거리는 대략값이고, ${DATA.LIVE.price_note}입니다. 위의 '공공 … ↻'을 누르면 새로 받습니다.`;
    } else {
      badge.textContent = "예시 데이터";
      badge.title = "실제 충전소가 아닙니다";
      badge.dataset.old = "false";
      note.textContent = "이 노선의 휴게소·충전소·가격·상태는 모두 지어낸 예시입니다.";
    }
  }

  // ---------- 그리기 ----------
  function render() {
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
    $("#range-line").textContent = `안전하게 갈 수 있는 거리 약 ${Math.max(0, Math.round(EV.conservative_range_km(v) - v.min_arrival_soc_pct * EV.km_per_pct(v)))}km `
      + `(여유 ${state.margin}%, 도착 때 ${state.minArrival}% 남김)`;
    renderReco(result);
    renderStrip(result);
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
      h("div", { class: "sub", text: opLabel(p.operator) + (p.is_nearby ? " · 나들목 인근" : "") }),
      priceEl(s.quote),
      h("div", { class: "facts" }, facts));
  }
  function renderReco(result) {
    const rec = result.recommendation;
    const box = h("div", { class: "reco" });
    if (rec.status !== "ok") {
      box.append(h("div", { class: "none" },
        h("b", { text: "안전하게 갈 수 있는 충전소가 없습니다" }),
        h("span", { text: "지금 잔량으로 닿는 곳에 빈 급속 충전기가 없습니다. 가까운 나들목으로 나가 충전소를 찾거나, 속도를 줄여 전비를 높이세요." })));
    } else {
      box.append(pickEl(rec.primary, "primary", result));
      if (rec.backup) box.append(pickEl(rec.backup, "backup", result));
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
    for (const e of entries) {
      const all = [...e.stations, ...e.nearby];
      const role = all.some((s) => s.role === "primary") ? "primary" : all.some((s) => s.role === "backup") ? "backup" : null;
      const low = e.arrival_soc_pct < state.minArrival;
      list.append(h("li", { class: "stop", "data-reach": String(e.reachable), "data-role": role },
        h("div", { class: "km num" }, km(e.remaining_km), h("small", { text: `${Math.round(e.distance_km)}km 지점` })),
        h("div", { class: "rail", "aria-hidden": "true" }),
        h("div", { class: "body" },
          h("div", { class: "head" },
            h("div", { class: "name", text: e.name }),
            h("div", { class: "soc num", "data-low": String(low), text: `도착 ${pct(e.arrival_soc_pct)}` })),
          h("div", { class: "chips" }, isIc(e)
            ? [chip(`나들목 인근 급속 ${e.nearby.length}곳`, "info"), chip("왕복 거리는 대략")]
            : areaChips(e)),
          subFirst(e.stations).map(stationEl),
          e.nearby.length ? h("div", { class: "nearby-label", text: "나들목 인근" }) : null,
          subFirst(e.nearby).map(stationEl))));
    }
  }

  // ---------- 내 차·할인 ----------
  function fillForms() {
    $("#v-battery").value = state.battery;
    $("#v-eff").value = state.eff;
    $("#v-margin").value = state.margin;
    $("#v-min").value = state.minArrival;
    $("#v-stale").value = state.stale;
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
    for (const r of DATA.ROUTES) sel.append(h("option", { value: r.key, text: `${r.highway} ${r.direction}${r.live || !DATA.LIVE ? "" : " (예시)"}` }));
    if (!DATA.ROUTES.some((r) => r.key === state.routeKey)) state.routeKey = DATA.ROUTES[0].key;
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
  async function doRefresh() {
    if (busy) { $("#rf-modal").hidden = false; return; } // 받는 중이면 진행 창을 다시 보여 준다
    const typed = $("#k-key").value.trim();
    if (typed) { try { localStorage.setItem(APIKEY_KEY, typed); } catch (e) { /* 저장 못 해도 이번엔 씀 */ } }
    const key = typed || storedKey();
    if (!key) {
      showView("my");
      liveMsg("인증키를 넣고 '새로 받기'를 누르세요. 공공데이터포털 마이페이지의 일반 인증키입니다.", "warn");
      $("#k-key").focus();
      return;
    }
    $("#k-key").value = "";
    $("#k-key").placeholder = "저장된 키 있음";
    const cfg = DATA.LIVE && DATA.LIVE.config;
    if (!cfg || !window.EvLiveBuild) { liveMsg("이 파일에는 새로 받기 설정이 없습니다. 새 파일을 받아 주세요.", "bad"); return; }
    busy = true;
    const token = ++rfToken;
    const started = Date.now();
    setBusyUi(true, 0);
    rfShowProgress(null, null, started);
    rfTimer = setInterval(() => rfTick(started), 1000);
    liveMsg("");
    try {
      const live = await window.EvLiveBuild.refresh(key, cfg, { onProgress: (d, n) => { if (token === rfToken) rfShowProgress(d, n, started); } });
      if (token !== rfToken) return; // 취소한 뒤에 도착한 결과는 버린다
      // 폰의 새로 받기는 휴게소만 받는다. 나들목 인근 충전소는 PC 에서 만든 것을 그대로 옮긴다(상태 시각도 그때 것)
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
      rfApply(live); // 다 받으면 바로 적용한다(진행 중 표시만, 바꿀지 묻지 않음)
    } catch (e) {
      if (token !== rfToken) return;
      const api = window.EvLiveBuild && e instanceof window.EvLiveBuild.ApiError;
      rfShowError(api ? `받지 못했어요: ${e.message}` : "공공 데이터 서버에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 받아 주세요. Claude 링크로 연 화면에서는 새로 받기가 막혀 있어요.");
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
    $("#rf-text").textContent = "공공데이터포털에서 전국 휴게소 충전기 상태를 받고 있어요. 보통 10~30초 걸려요.";
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
  function rfApply(live) {
    $("#rf-modal").hidden = true;
    DATA.replaceLive(live);
    try { localStorage.setItem(LIVE_KEY, JSON.stringify(live)); } catch (e) { /* 저장 못 해도 이번 화면엔 씀 */ }
    routes = DATA.ROUTES.slice();
    fillRouteOptions(); fillSubOptions(); fillOps();
    liveMsg(`새로 받았어요 ${hhmm(live.fetched_at)} · 휴게소 충전기 ${countChargers(live)}대`, "good");
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
    for (const v of ["route", "my"]) {
      $(`#view-${v}`).hidden = v !== name;
      $(`#tab-${v}`).setAttribute("aria-selected", String(v === name));
    }
    if (name === "route") render();
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

  // ---------- 연결 ----------
  $("#btn-locate").addEventListener("click", () => doLocate());
  $("#geo-allow").addEventListener("click", () => doLocate(true));
  $("#geo-ok").addEventListener("click", closeGeoModal);
  $("#pick-close").addEventListener("click", () => { hidePick(); $("#btn-locate").focus(); });
  $("#pick-modal").addEventListener("click", (ev) => { if (ev.target === ev.currentTarget) hidePick(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) retryIfGranted(); });
  $("#geo-modal").addEventListener("click", (e) => { if (e.target === e.currentTarget) closeGeoModal(); });
  document.addEventListener("keydown", (e) => { if (e.key !== "Escape") return; if (!$("#geo-modal").hidden) closeGeoModal(); else if (!$("#pick-modal").hidden) hidePick(); else if (!$("#rf-modal").hidden) rfClose(); });
  $("#rf-retry").addEventListener("click", () => doRefresh());
  $("#rf-close").addEventListener("click", rfClose);
  const sel = $("#route-select");
  fillRouteOptions();
  sel.addEventListener("change", () => { state.routeKey = sel.value; state.pos = 0; editing = null; hidePick(); locateMsg(""); persist(); render(); });
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
  $("#storage-warn").hidden = storageOk;
  for (const tab of document.querySelectorAll(".tabbar [data-view]")) tab.addEventListener("click", () => showView(tab.dataset.view));
  $("#btn-shuffle").addEventListener("click", () => {
    routes = routes.map((r) => DATA.shuffled(r, Math.random));
    showView("route");
  });
  $("#btn-reset").addEventListener("click", () => { routes = DATA.ROUTES.slice(); showView("route"); });  $("#about").textContent = "계산 엔진은 파이썬 ev-charge-planner 를 자바스크립트로 옮긴 것이고, 같은 입력에 같은 답을 내는지 대조해 확인했습니다.";
  document.addEventListener("visibilitychange", () => { if (!document.hidden && view === "route") render(); });
  // '몇 분 전'이 시간이 지나며 바뀌도록 1분마다 다시 그린다(고치는 중엔 건드리지 않음)
  setInterval(() => { if (!document.hidden && view === "route" && editing === null && !busy) render(); }, 60000);

  fillForms();
  showView("route");
})();
