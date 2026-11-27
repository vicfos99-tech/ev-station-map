// 앱 설정 모으기: config/*.json + config/shape/*.shape.json + (저장소 밖) 앱 비밀 값 + 빌드 기록 → window.EV_CONFIG 꼴.
// build.mjs(브라우저용 한 파일)와 try_a1.mjs(node 에서 바로 조립)가 함께 쓴다.
import fs from 'node:fs';
import path from 'node:path';
import { listFiles } from './lib_tools.mjs';

// JSON 글 안에서 같은 객체에 같은 키가 두 번 나오는 자리(설계 5-7 (1) 빌드 검사)
export function duplicateKeys(text) {
  const out = [];
  const stack = [];
  let expectKey = false;
  let line = 1;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '\n') line += 1;
    else if (ch === '{') { stack.push(new Set()); expectKey = true; }
    else if (ch === '[') { stack.push(null); expectKey = false; }
    else if (ch === '}' || ch === ']') { stack.pop(); expectKey = false; }
    else if (ch === ',') expectKey = stack.length > 0 && stack[stack.length - 1] !== null;
    else if (ch === '"') {
      let s = '';
      i += 1;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\') { s += text.slice(i, i + 2); i += 2; continue; }
        s += text[i];
        i += 1;
      }
      const top = stack[stack.length - 1];
      if (expectKey && top) {
        if (top.has(s)) out.push({ key: s, line });
        top.add(s);
      }
      expectKey = false;
    }
  }
  return out;
}

function readJson(p, errors) {
  try {
    const text = fs.readFileSync(p, 'utf8');
    const dups = duplicateKeys(text);
    if (dups.length) throw new Error('같은 키 두 번: ' + dups.map((d) => d.key + '(' + d.line + '줄)').join(', '));
    return JSON.parse(text);
  } catch (e) {
    errors.push({ file: p, why: e.message });
    return undefined;
  }
}

// (정비 나 ①) 제목 꾸러미의 계산 줄(config_topic_<제목>.calc_rows) — 시험이 조립과 같은 표(StateCalc.expandTable(기본 표, 이 줄, slot_key))를 쓰게.
// topic 을 안 주면 첫 꾸러미(이름 차례 — 조립이 주소 꼬리 없이 켜는 것과 같음). 꾸러미가 없으면 빈 목록
export function topicRowsOf(app, b, topic) {
  const names = listFiles(path.join(app, b.config_dir), b.config_ext).map((p) => path.basename(p, b.config_ext)).filter((n) => n.startsWith(b.topic_config_prefix)).sort();
  const want = topic ? b.topic_config_prefix + topic : names[0];
  if (!want || !names.includes(want)) return [];
  return JSON.parse(fs.readFileSync(path.join(app, b.config_dir, want + b.config_ext), 'utf8')).calc_rows || [];
}

// b = tc.build. opts = {secretPath, buildInfo, overrides: {이름: 객체}}
export function loadAppConfig(app, b, opts) {
  const errors = [];
  const files = {};
  const shapes = {};
  const broken = {};
  for (const p of listFiles(path.join(app, b.config_dir), b.config_ext)) {
    const name = path.basename(p, b.config_ext);
    const v = readJson(p, errors);
    if (v === undefined) broken[name] = errors[errors.length - 1].why;
    else files[name] = v;
  }
  for (const p of listFiles(path.join(app, b.shape_dir), b.shape_ext)) {
    const v = readJson(p, errors);
    if (v !== undefined) shapes[path.basename(p, b.shape_ext)] = v;
  }
  if (opts.secretPath) {
    if (fs.existsSync(opts.secretPath)) {
      const v = readJson(opts.secretPath, errors);
      if (v === undefined) broken[b.secret_name] = errors[errors.length - 1].why;
      else files[b.secret_name] = v;
    }
  }
  if (opts.buildInfo) files[b.build_name] = opts.buildInfo;
  for (const [k, v] of Object.entries(opts.overrides || {})) files[k] = v;
  // (추가3 앞) 더하기 칸 이름(cfg.js 가 꾸러미 설정의 이 칸을 다른 설정에 더함 — 꾸러미가 자기 등급·이름 글을 밝힘)
  return { raw: { files, shapes, broken, adds_key: b.adds_key }, errors };
}
