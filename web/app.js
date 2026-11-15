/* 충전 길잡이 — 화면 로직. 계산은 engine.js(EvPlanner)만 쓴다. 데이터는 data.js 의 예시 노선. */
(function () {
  "use strict";
  const EV = window.EvPlanner;
  const DATA = window.EvData;
  const KEY = "ev-charge-planner/v1";
  const $ = (sel) => document.querySelector(sel);

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
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* 무시 */ }
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
    return { route: DATA.toRoute(r, now), vehicle, user, now };
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
    if (st.is_stale) meta.push(chip("정보 오래됨", "warn"));
    if (s.is_nearby) meta.push(chip(`왕복 +${km(s.detour_km)} · 도착 ${pct(s.arrival_soc_pct)}`, s.reachable ? null : "bad"));
    if (s.quote.applied) meta.push(h("span", { text: s.quote.applied === "subscription" ? "구독 할인" : `${s.quote.applied} 할인` }));
    return h("div", { class: "station", "data-role": s.role },
      h("div", { class: "op", text: s.operator }), priceEl(s.quote), h("div", { class: "meta" }, meta));
  }

  // 실제 데이터인지 예시인지 표시
  function showSource(r) {
    const badge = $(".demo-badge"), note = $("#demo-note");
    if (r.live && DATA.LIVE) {
      const t = new Date(DATA.LIVE.fetched_at);
      const hhmm = `${t.getMonth() + 1}/${t.getDate()} ${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
      badge.textContent = `공공 ${hhmm.split(" ")[1]}`;
      badge.title = "받은 시각 기준 상태입니다";
      note.textContent = `${DATA.LIVE.source}에서 ${hhmm}에 받은 상태입니다. 그 뒤로 바뀌었을 수 있으니 도착 전에 다시 확인하세요. 휴게소 거리는 대략값이고, ${DATA.LIVE.price_note}입니다.`;
    } else {
      badge.textContent = "예시 데이터";
      badge.title = "실제 충전소가 아닙니다";
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
      chip(`도착 때 ${pct(p.arrival_soc_pct)}`, p.arrival_soc_pct - state.minArrival < 10 ? "warn" : "good"),
      chip(`빈 급속 ${s.status.usable_fast}대`, "good"),
      h("span", { class: "chip", title: "안전 점수(5점 만점)" }, "안전 ", h("span", { class: "dots", text: dots })),
    ];
    if (p.is_nearby) facts.push(chip(`나들목 왕복 +${km(p.detour_km)}`, "warn"));
    if (s.status.is_stale) facts.push(chip("정보 오래됨 · 도착 전 다시 확인", "warn"));
    if (s.status.unusable) facts.push(chip(`고장·점검 ${s.status.unusable}대`, "warn"));
    return h("div", { class: "pick", "data-role": role },
      h("div", { class: "role", text: role === "primary" ? "1순위 충전소" : "예비 (1순위가 안 되면)" }),
      h("div", { class: "name", text: p.rest_area_name }),
      h("div", { class: "dist num", text: km(p.remaining_km) }),
      h("div", { class: "sub", text: p.operator + (p.is_nearby ? " · 나들목 인근" : "") }),
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
          h("div", { class: "chips" }, areaChips(e)),
          e.stations.map(stationEl),
          e.nearby.length ? h("div", { class: "nearby-label", text: "나들목 인근" }) : null,
          e.nearby.map(stationEl))));
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
  }

  function showView(name) {
    view = name;
    for (const v of ["route", "my"]) {
      $(`#view-${v}`).hidden = v !== name;
      $(`#tab-${v}`).setAttribute("aria-selected", String(v === name));
    }
    if (name === "route") render();
  }

  // ---------- 연결 ----------
  const sel = $("#route-select");
  for (const r of DATA.ROUTES) sel.append(h("option", { value: r.key, text: `${r.highway} ${r.direction}${r.live || !DATA.LIVE ? "" : " (예시)"}` }));
  sel.value = state.routeKey;
  sel.addEventListener("change", () => { state.routeKey = sel.value; state.pos = 0; persist(); render(); });
  $("#soc").addEventListener("input", (e) => { state.soc = Number(e.target.value); persist(); render(); });
  $("#pos").addEventListener("input", (e) => { state.pos = Number(e.target.value); persist(); render(); });
  const subSel = $("#d-sub-op");
  subSel.append(h("option", { value: "", text: "구독 없음" }));
  for (const op of DATA.OPERATORS) subSel.append(h("option", { value: op, text: op }));
  for (const form of [$("#vehicle-form"), $("#discount-form")]) {
    form.addEventListener("input", readForms);
    form.addEventListener("submit", (e) => e.preventDefault());
  }
  for (const tab of document.querySelectorAll(".tabbar [data-view]")) tab.addEventListener("click", () => showView(tab.dataset.view));
  $("#btn-shuffle").addEventListener("click", () => {
    routes = routes.map((r) => DATA.shuffled(r, Math.random));
    showView("route");
  });
  $("#btn-reset").addEventListener("click", () => { routes = DATA.ROUTES.slice(); showView("route"); });
  $("#about").textContent = "계산 엔진은 파이썬 ev-charge-planner 를 자바스크립트로 옮긴 것이고, 같은 입력에 같은 답을 내는지 대조해 확인했습니다.";
  document.addEventListener("visibilitychange", () => { if (!document.hidden && view === "route") render(); });

  fillForms();
  showView("route");
})();
