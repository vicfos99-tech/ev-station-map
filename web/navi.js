/*
 * 길찾기 내비 방식 — 파이썬 ev_route_navi(10_프로젝트/ev-route-navi)를 옮긴 것.
 * 카카오 길찾기 응답의 도로 조각을 같은 고속도로 이름끼리 구간으로 합치고, 휴게소는 방향까지 맞추고,
 * 곳과 내 위치를 '경로 위 km'로 바꿔 앞에 있는 것만 남긴다. 거리로 어림하지 않는다.
 * 같은 입력에 파이썬과 같은 답을 내는지 web/test/compare_navi.js 로 대조한다. 값은 반올림하지 않는다.
 */
(function (root) {
  "use strict";
  const R = 6371.0088;
  const RAD = Math.PI / 180;
  const JUNCTION_GAP_KM = 1.0; // 구간 끝에서 이 거리 안에 다른 고속도로가 이어지면 분기점으로 본다

  // 앱이 쓰는 값. 분기점 너머 나들목은 길 위로 내지 않는다(interchange_end_at_junction: false)
  const DEFAULTS = {
    bridge_km: 1.0, min_progress_km: 1.0, turn_back_km: 1.0, rest_area_offset_km: 1.0,
    interchange_offset_km: 3.0, interchange_end_km: 0.5, off_route_km: 1.0, back_km: 0.3,
    jump_window_km: 5.0, ahead_min_km: 0.3, gap_warn_km: 0.1, interchange_end_at_junction: false,
  };
  const options = (o) => Object.assign({}, DEFAULTS, o || {});
  // 파이썬 "".join(s.split()) — 모든 공백을 없앤다
  const normalizeName = (s) => String(s).split(/\s+/).join("");

  function haversine(a, b) {
    const la1 = a[0] * RAD, lo1 = a[1] * RAD, la2 = b[0] * RAD, lo2 = b[1] * RAD;
    let h = Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2;
    h = Math.min(1.0, Math.max(0.0, h));
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function cumulative(points) {
    const cum = [];
    let total = 0.0;
    for (let i = 0; i < points.length; i++) {
      if (i > 0) total += haversine(points[i - 1], points[i]);
      cum.push(total);
    }
    return cum;
  }
  // 점을 꺾은선에 붙인 '선 위 km'. 같은 거리면 먼저 나온 선분
  function lineKm(p, points, cum) {
    const latP = p[0] * RAD, lonP = p[1] * RAD, cosP = Math.cos(latP);
    let bestD = null, bestPos = null;
    for (let i = 0; i < points.length - 1; i++) {
      const ax = R * cosP * (points[i][1] * RAD - lonP), ay = R * (points[i][0] * RAD - latP);
      const bx = R * cosP * (points[i + 1][1] * RAD - lonP), by = R * (points[i + 1][0] * RAD - latP);
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      let d, frac;
      if (len2 === 0.0) { d = Math.hypot(ax, ay); frac = 0.0; } else {
        frac = Math.min(1.0, Math.max(0.0, -(ax * dx + ay * dy) / len2));
        d = Math.hypot(ax + frac * dx, ay + frac * dy);
      }
      if (bestD === null || d < bestD) { bestD = d; bestPos = cum[i] + frac * (cum[i + 1] - cum[i]); }
    }
    return bestPos;
  }

  // ---------- 카카오 응답 → 조각 ----------
  const isNum = (v) => typeof v === "number" && Number.isFinite(v);
  function piecesFromKakao(response) {
    const fail = (m) => { throw new Error(m); };
    if (!response || typeof response !== "object" || Array.isArray(response)) fail("응답이 올바르지 않다");
    const routes = response.routes;
    if (!Array.isArray(routes) || !routes.length) fail("routes 가 비어 있다");
    const r0 = routes[0];
    if (!r0 || typeof r0 !== "object") fail("routes[0] 이 올바르지 않다");
    if (!Number.isInteger(r0.result_code) || r0.result_code !== 0) {
      const e = new Error(`카카오 길찾기 실패: ${r0.result_msg || r0.result_code}`);
      e.kakaoCode = r0.result_code;
      throw e;
    }
    if (!Array.isArray(r0.sections) || !r0.sections.length) fail("sections 가 없다");
    const pieces = [], warnings = [];
    r0.sections.forEach((sec, i) => {
      if (!sec || !Array.isArray(sec.roads)) fail(`sections[${i}] 의 roads 가 없다`);
      sec.roads.forEach((rd, j) => {
        const where = `sections[${i}].roads[${j}]`;
        if (!rd || typeof rd !== "object") fail(`${where} 가 올바르지 않다`);
        let name = rd.name;
        if (name === null || name === undefined) name = "";
        else if (typeof name !== "string") fail(`${where} 의 name 이 글자가 아니다`);
        const dist = rd.distance === undefined ? null : rd.distance;
        if (dist !== null && (!isNum(dist) || dist < 0)) fail(`${where} 의 distance 가 올바르지 않다`);
        const v = rd.vertexes;
        if (!Array.isArray(v) || v.length % 2 === 1 || !v.every(isNum)) fail(`${where} 의 vertexes 가 올바르지 않다`);
        const pts = [];
        for (let k = 0; k < v.length; k += 2) {
          const x = v[k], y = v[k + 1];
          if (y >= 124 && y <= 132) fail(`${where} 의 좌표가 뒤집힌 것 같다`);
          if (!(y >= -90 && y <= 90) || !(x >= -180 && x <= 180)) fail(`${where} 의 좌표가 범위 밖이다`);
          pts.push([y, x]);
        }
        if (pts.length < 2) { warnings.push(`${where} 는 점이 ${pts.length}개라 건너뜀`); return; }
        pieces.push({ name, points: pts, length_m: dist });
      });
    });
    if (!pieces.length) fail("쓸 수 있는 길 조각이 하나도 없다");
    let summaryKm = null;
    const d = r0.summary && typeof r0.summary === "object" ? r0.summary.distance : null;
    if (isNum(d) && d >= 0) summaryKm = d / 1000;
    if (summaryKm !== null && pieces.every((p) => p.length_m !== null)) {
      const total = pieces.reduce((s, p) => s + p.length_m, 0) / 1000;
      if (Math.abs(total - summaryKm) > Math.max(0.1, 0.01 * summaryKm)) warnings.push(`거리 합 불일치: 조각 합 ${total} km, summary ${summaryKm} km`);
    }
    return { pieces, summary_km: summaryKm, warnings };
  }

  // ---------- 조각을 이어 길 만들기 ----------
  function buildRoute(pieces, gapWarnKm) {
    const rt = { pieces, points: [], km: [], piece_of: [], piece_first: [], piece_last: [], piece_start_km: [], piece_end_km: [], warnings: [] };
    let start = 0.0;
    pieces.forEach((p, i) => {
      const cum = cumulative(p.points);
      const coordLen = cum[cum.length - 1];
      const length = p.length_m !== null && p.length_m !== undefined ? p.length_m / 1000 : coordLen;
      if (i > 0) {
        const prev = pieces[i - 1].points;
        const gap = haversine(prev[prev.length - 1], p.points[0]);
        if (gap > gapWarnKm) rt.warnings.push({ piece_index: i, gap_km: gap, at_km: start });
      }
      const scale = coordLen > 0 ? length / coordLen : 0.0;
      const n = p.points.length;
      rt.piece_first.push(rt.points.length);
      p.points.forEach((pt, j) => {
        rt.points.push(pt);
        rt.piece_of.push(i);
        rt.km.push(j === n - 1 ? start + length : start + cum[j] * scale);
      });
      rt.piece_last.push(rt.points.length - 1);
      rt.piece_start_km.push(start);
      start = start + length;
      rt.piece_end_km.push(start);
    });
    rt.total_km = start;
    return rt;
  }
  // 점을 길에 붙인다: [옆 거리, 경로 위 km]. lo~hi 꼭짓점, minKm~maxKm 범위만 본다
  function project(rt, pt, lo, hi, minKm, maxKm) {
    const latP = pt[0] * RAD, lonP = pt[1] * RAD, cosP = Math.cos(latP);
    let best = null;
    for (let j = lo; j < hi; j++) {
      if (rt.piece_of[j] !== rt.piece_of[j + 1]) continue;
      const ka = rt.km[j], kb = rt.km[j + 1];
      let f0 = 0.0, f1 = 1.0;
      if (minKm !== null) {
        if (kb < minKm) continue;
        if (ka < minKm) f0 = (minKm - ka) / (kb - ka);
      }
      if (maxKm !== null) {
        if (ka > maxKm) continue;
        if (kb > maxKm) f1 = (maxKm - ka) / (kb - ka);
      }
      const a = rt.points[j], b = rt.points[j + 1];
      const ax = R * cosP * (a[1] * RAD - lonP), ay = R * (a[0] * RAD - latP);
      const bx = R * cosP * (b[1] * RAD - lonP), by = R * (b[0] * RAD - latP);
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      let frac = len2 === 0.0 ? 0.0 : -(ax * dx + ay * dy) / len2;
      frac = Math.min(f1, Math.max(f0, frac));
      const d = Math.hypot(ax + frac * dx, ay + frac * dy);
      if (best === null || d < best[0]) best = [d, ka + frac * (kb - ka)];
    }
    if (best === null) throw new Error("볼 선분이 없다");
    return best;
  }

  // ---------- 고속도로 책: 도로 이름 → 고속도로 ----------
  // highways: [{id, name, points, forward_name, backward_name, road_names?}]
  function buildBook(highways) {
    const book = { lines: new Map(), cum: new Map(), names: new Map() };
    for (const h of highways) {
      if (book.lines.has(h.id)) throw new Error(`고속도로 id 가 겹친다: ${h.id}`);
      book.lines.set(h.id, h);
      book.cum.set(h.id, cumulative(h.points));
      for (const n of (h.road_names || [h.name])) {
        const key = normalizeName(n);
        const other = book.names.get(key);
        if (other !== undefined && other !== h.id) throw new Error(`고속도로 ${other} 와 ${h.id} 가 같은 이름 ${key} 을 가진다`);
        book.names.set(key, h.id);
      }
    }
    return book;
  }
  function lookup(book, name) {
    const key = normalizeName(name);
    if (key === "") return null;
    const v = book.names.get(key);
    return v === undefined ? null : v;
  }

  // ---------- 조각을 구간으로 합치기 ----------
  function splitPoints(t, first, last, turnBack) {
    const cuts = [first];
    let state = 0, lo = t[0], hi = t[0], peakI = 0, peakV = t[0];
    for (let j = 1; j <= last - first; j++) {
      const v = t[j];
      if (state === 0) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
        if (v - lo >= turnBack) { state = 1; peakI = j; peakV = v; } else if (hi - v >= turnBack) { state = -1; peakI = j; peakV = v; }
      } else if (state === 1) {
        if (v > peakV) { peakI = j; peakV = v; } else if (peakV - v >= turnBack) { cuts.push(first + peakI); state = -1; peakI = j; peakV = v; }
      } else if (v < peakV) { peakI = j; peakV = v; } else if (v - peakV >= turnBack) { cuts.push(first + peakI); state = 1; peakI = j; peakV = v; }
    }
    cuts.push(last);
    const out = [];
    for (let i = 0; i < cuts.length - 1; i++) out.push([cuts[i], cuts[i + 1]]);
    return out;
  }
  function findSections(rt, book, opt) {
    const pieces = rt.pieces, n = pieces.length;
    const labels = pieces.map((p) => lookup(book, p.name));
    const empty = pieces.map((p) => normalizeName(p.name) === "");
    let bridged = 0.0;
    let i = 0;
    while (i < n) {
      if (!empty[i]) { i += 1; continue; }
      let j = i;
      while (j + 1 < n && empty[j + 1]) j += 1;
      if (i > 0 && j + 1 < n) {
        const h = labels[i - 1];
        if (h !== null && h === labels[j + 1]) {
          const length = rt.piece_end_km[j] - rt.piece_start_km[i];
          if (length <= opt.bridge_km) {
            for (let k = i; k <= j; k++) labels[k] = h;
            bridged += length;
          }
        }
      }
      i = j + 1;
    }
    const groups = [];
    for (let k = 0; k < n; k++) {
      if (groups.length && groups[groups.length - 1][0] === labels[k]) groups[groups.length - 1][2] = k;
      else groups.push([labels[k], k, k]);
    }
    const sections = [], unknown = [], unmatched = [];
    for (const [hid, a, b] of groups) {
      const startKm = rt.piece_start_km[a], endKm = rt.piece_end_km[b];
      if (hid === null) {
        const names = [];
        for (let k = a; k <= b; k++) {
          const nm = pieces[k].name;
          if (!names.includes(nm)) names.push(nm);
          const norm = normalizeName(nm);
          if ((norm.includes("고속도로") || norm.includes("고속국도")) && !unmatched.includes(nm)) unmatched.push(nm);
        }
        unknown.push({ start_km: startKm, end_km: endKm, names });
        continue;
      }
      const line = book.lines.get(hid), cum = book.cum.get(hid);
      const first = rt.piece_first[a], last = rt.piece_last[b];
      const t = [];
      for (let v = first; v <= last; v++) t.push(lineKm(rt.points[v], line.points, cum));
      for (const [s, e] of splitPoints(t, first, last, opt.turn_back_km)) {
        const ls = t[s - first], le = t[e - first];
        const prog = le - ls;
        let direction, dname;
        if (Math.abs(prog) < opt.min_progress_km) { direction = null; dname = "방향 모름"; } else if (prog > 0) { direction = "forward"; dname = line.forward_name; } else { direction = "backward"; dname = line.backward_name; }
        sections.push({
          highway_id: hid, highway_name: line.name, direction, direction_name: dname,
          start_km: s === first ? startKm : rt.km[s], end_km: e === last ? endKm : rt.km[e],
          first_vertex: s, last_vertex: e, line_start_km: ls, line_end_km: le,
        });
      }
    }
    return { sections, unknown_intervals: unknown, bridged_km: bridged, unmatched_highway_names: unmatched };
  }

  // ---------- 길 위의 휴게소·나들목 ----------
  const REASON_ORDER = ["unknown_direction", "opposite_direction", "too_far", "beyond_end"];
  const REASON_LABEL = {
    no_location: "좌표 없음", unknown_highway: "모르는 고속도로", not_traveled: "타지 않는 고속도로",
    opposite_direction: "반대 방향", beyond_end: "구간 끝 너머", too_far: "너무 멂", unknown_direction: "방향 모르는 구간의 휴게소",
  };
  // sites: [{id, name, kind: "rest"|"ic", highway_id, direction("forward"|"backward", 휴게소만), loc:[위도,경도]|null, data}]
  function findStops(rt, sections, book, sites, opt) {
    const byHighway = new Map();
    sections.forEach((sec, idx) => {
      if (!byHighway.has(sec.highway_id)) byHighway.set(sec.highway_id, []);
      byHighway.get(sec.highway_id).push(idx);
    });
    function touchesHighway(idx, which) {
      const sec = sections[idx];
      const edge = which === "start" ? sec.start_km : sec.end_km;
      const eps = 1e-9;
      for (let j = 0; j < sections.length; j++) {
        if (j === idx) continue;
        const gap = which === "start" ? edge - sections[j].end_km : sections[j].start_km - edge;
        if (gap >= -eps && gap <= JUNCTION_GAP_KM) return true;
      }
      const n = rt.pieces.length;
      for (let s = 0; s < n; s++) {
        const i = which === "start" ? n - 1 - s : s;
        const gap = which === "start" ? edge - rt.piece_end_km[i] : rt.piece_start_km[i] - edge;
        if (gap < -eps) continue;
        if (gap > JUNCTION_GAP_KM) break;
        const name = normalizeName(rt.pieces[i].name);
        if (name !== "") return name.endsWith("고속도로");
      }
      return false;
    }
    function trySection(idx, site, isRest) {
      const sec = sections[idx];
      const latP = site.loc[0] * RAD, lonP = site.loc[1] * RAD, cosP = Math.cos(latP);
      const plane = (q) => [R * cosP * (q[1] * RAD - lonP), R * (q[0] * RAD - latP)];
      const [off, km] = project(rt, site.loc, sec.first_vertex, sec.last_vertex, null, null);
      const pts = rt.points;
      for (const which of ["start", "end"]) {
        const ev = which === "start" ? sec.first_vertex : sec.last_vertex;
        const E = pts[ev];
        const [ex, ey] = plane(E);
        const dE = Math.hypot(ex, ey);
        if (!(dE <= off + 1e-9)) continue;
        let q = null;
        if (which === "start") {
          for (let v = sec.first_vertex + 1; v <= sec.last_vertex; v++) if (pts[v][0] !== E[0] || pts[v][1] !== E[1]) { q = pts[v]; break; }
        } else {
          for (let v = sec.last_vertex - 1; v >= sec.first_vertex; v--) if (pts[v][0] !== E[0] || pts[v][1] !== E[1]) { q = pts[v]; break; }
        }
        if (q === null) continue;
        const [qx, qy] = plane(q);
        let ux = ex - qx, uy = ey - qy;
        const norm = Math.hypot(ux, uy);
        if (norm === 0.0) continue;
        ux /= norm; uy /= norm;
        const over = (-ex) * ux + (-ey) * uy;
        if (over > 0) {
          if (isRest) return ["cand", "beyond_end"];
          if (dE <= opt.interchange_end_km && (opt.interchange_end_at_junction || !touchesHighway(idx, which))) {
            return ["in", which === "start" ? sec.start_km : sec.end_km, dE, which];
          }
          return ["cand", "beyond_end"];
        }
      }
      const limit = isRest ? opt.rest_area_offset_km : opt.interchange_offset_km;
      if (off > limit) return ["cand", "too_far"];
      if (isRest) {
        if (sec.direction === null) return ["cand", "unknown_direction"];
        if (sec.direction !== site.direction) return ["cand", "opposite_direction"];
      }
      return ["in", km, off, null];
    }
    const stops = [], excluded = [];
    function handle(site) {
      const isRest = site.kind !== "ic";
      const drop = (reason) => { excluded.push({ id: site.id, name: site.name, kind: site.kind, highway_id: site.highway_id, reason }); };
      if (!site.loc) return drop("no_location");
      if (!book.lines.has(site.highway_id)) return drop("unknown_highway");
      const idxs = byHighway.get(site.highway_id);
      if (!idxs || !idxs.length) return drop("not_traveled");
      const cands = new Set();
      let got = false;
      for (const idx of idxs) {
        const r = trySection(idx, site, isRest);
        if (r[0] === "in") {
          got = true;
          stops.push({
            id: site.id, name: site.name, kind: site.kind, highway_id: site.highway_id, direction: isRest ? site.direction : null,
            route_km: r[1], offset_km: r[2], section_index: idx, at_end: r[3], data: site.data,
          });
        } else cands.add(r[1]);
      }
      if (!got) for (const reason of REASON_ORDER) if (cands.has(reason)) return drop(reason);
      return undefined;
    }
    for (const s of sites) if (s.kind !== "ic") handle(s);
    for (const s of sites) if (s.kind === "ic") handle(s);
    const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
    stops.sort((a, b) => cmp(a.route_km, b.route_km) || cmp(a.name, b.name) || cmp(a.id, b.id) || cmp(a.section_index, b.section_index));
    return { stops, excluded };
  }

  // ---------- 묶기 ----------
  function matchRoute(name, pieces, highways, sites, o) {
    const opt = options(o);
    const book = buildBook(highways);
    const rt = buildRoute(pieces, opt.gap_warn_km);
    const secs = findSections(rt, book, opt);
    const st = findStops(rt, secs.sections, book, sites, opt);
    const counts = {};
    for (const k of Object.keys(REASON_LABEL)) counts[k] = 0;
    for (const e of st.excluded) counts[e.reason] += 1;
    return {
      name, total_km: rt.total_km, route: rt, sections: secs.sections, unknown_intervals: secs.unknown_intervals,
      stops: st.stops, excluded: st.excluded, excluded_counts: counts, bridged_km: secs.bridged_km,
      unmatched_highway_names: secs.unmatched_highway_names, warnings: rt.warnings, options: opt,
      highway_km: secs.sections.reduce((s, x) => s + (x.end_km - x.start_km), 0),
    };
  }

  // ---------- 내 위치와 앞에 있는 것만 ----------
  function locate(rt, pt, lastKm, o) {
    const opt = options(o);
    const n = rt.points.length;
    let offset, km;
    if (lastKm === null || lastKm === undefined) [offset, km] = project(rt, pt, 0, n - 1, null, null);
    else {
      const lo = Math.max(0, lastKm - opt.back_km);
      if (lo > rt.total_km) throw new Error("지난 위치가 길 끝보다 너무 멀다");
      const top = lastKm + opt.jump_window_km;
      [offset, km] = project(rt, pt, 0, n - 1, lo, top);
      if (offset > opt.off_route_km || km >= top - 1e-9) [offset, km] = project(rt, pt, 0, n - 1, lo, null);
    }
    return { route_km: km, offset_km: offset, off_route: offset > opt.off_route_km };
  }
  const stopsAhead = (stops, positionKm, aheadMinKm) => stops.filter((s) => s.route_km - positionKm > aheadMinKm);

  const api = { DEFAULTS, REASON_LABEL, normalizeName, piecesFromKakao, buildRoute, project, buildBook, findSections, findStops, matchRoute, locate, stopsAhead };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.EvNavi = api;
}(typeof globalThis !== "undefined" ? globalThis : this));
