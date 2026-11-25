// 앱 모듈(.js) 글을 읽는 작은 도구: 주석·글·숫자를 가르는 낱말 읽기(lex), import 줄 읽기.
// check4(박힌 값·직접 불러 쓰기)와 build(한 파일로 묶기)가 함께 쓴다.

const ID_CHAR = /[A-Za-z0-9_$]/;
const DIGIT = /[0-9]/;
// 숫자 글: 16·8·2진 또는 10진(소수·지수·큰 정수 n)
const NUM_RX = /0[xX][0-9a-fA-F_]+n?|0[oO][0-7_]+n?|0[bB][01_]+n?|(?:[0-9][0-9_]*(?:\.[0-9_]*)?|\.[0-9][0-9_]*)(?:[eE][+-]?[0-9_]+)?n?/y;
// 이 글자 뒤의 '/' 는 나눗셈이 아니라 정규식의 시작
const REGEX_AFTER = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);
const REGEX_KEYWORDS = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);

// 결과: code(주석·글을 지운 코드 — 줄 번호는 그대로), strings[{text,line}], numbers[{text,line}]
export function lex(src) {
  const out = [];
  const strings = [];
  const numbers = [];
  let i = 0;
  let line = 1;
  let lastSig = '';
  let lastWord = '';
  const n = src.length;
  const tplStack = []; // 템플릿 글 안 ${ } 의 중괄호 깊이

  function readTemplate() {
    // src[i] 는 '`' 다음 글자. 템플릿 끝('`')이나 '${' 를 만날 때까지 글로 읽는다
    let text = '';
    const startLine = line;
    while (i < n) {
      const c = src[i];
      if (c === '\\') { text += src.slice(i, i + 2); i += 2; continue; }
      if (c === '\n') { line++; out.push('\n'); text += c; i++; continue; }
      if (c === '`') { i++; strings.push({ text, line: startLine }); out.push('``'); lastSig = '"'; return; }
      if (c === '$' && src[i + 1] === '{') {
        i += 2;
        strings.push({ text, line: startLine });
        out.push('`${');
        tplStack.push(0);
        lastSig = '{';
        return;
      }
      text += c;
      i++;
    }
  }

  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '\n') { line++; out.push(c); i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { out.push(c); i++; continue; }
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') { line++; out.push('\n'); } i++; }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      let text = '';
      i++;
      while (i < n && src[i] !== c) {
        if (src[i] === '\\') { text += src.slice(i, i + 2); i += 2; continue; }
        if (src[i] === '\n') break;
        text += src[i];
        i++;
      }
      i++;
      strings.push({ text, line });
      out.push('""');
      lastSig = '"';
      lastWord = '';
      continue;
    }
    if (c === '`') { i++; readTemplate(); lastWord = ''; continue; }
    if (tplStack.length && (c === '{' || c === '}')) {
      const top = tplStack.length - 1;
      if (c === '{') { tplStack[top]++; out.push(c); i++; lastSig = c; continue; }
      if (tplStack[top] === 0) { tplStack.pop(); out.push('}`'); i++; readTemplate(); continue; }
      tplStack[top]--; out.push(c); i++; lastSig = c; continue;
    }
    if (c === '/' && (REGEX_AFTER.has(lastSig) || REGEX_KEYWORDS.has(lastWord))) {
      // 정규식 글: 그대로 건너뛴다(코드 자리에는 빈 정규식 표시)
      i++;
      let inClass = false;
      while (i < n) {
        const e = src[i];
        if (e === '\\') { i += 2; continue; }
        if (e === '\n') break;
        if (e === '[') inClass = true;
        else if (e === ']') inClass = false;
        else if (e === '/' && !inClass) break;
        i++;
      }
      i++;
      while (i < n && /[a-z]/.test(src[i])) i++;
      out.push('/(?:)/');
      lastSig = 'a';
      lastWord = '';
      continue;
    }
    if (ID_CHAR.test(c) && !DIGIT.test(c)) {
      let w = '';
      while (i < n && ID_CHAR.test(src[i])) { w += src[i]; i++; }
      out.push(w);
      lastWord = w;
      lastSig = REGEX_KEYWORDS.has(w) ? '(' : 'a';
      continue;
    }
    if (DIGIT.test(c) || (c === '.' && DIGIT.test(d || ''))) {
      NUM_RX.lastIndex = i;
      const m = NUM_RX.exec(src);
      const t = m ? m[0] : c;
      i += t.length;
      numbers.push({ text: t, line });
      out.push(t);
      lastSig = 'a';
      lastWord = '';
      continue;
    }
    out.push(c);
    lastSig = c;
    lastWord = '';
    i++;
  }
  return { code: out.join(''), strings, numbers };
}

export function numberValue(text) {
  const t = text.replace(/_/g, '').replace(/n$/, '');
  return Number(t);
}

// import 줄을 읽는다. 결과: { imports:[{line, kind:'named'|'star', names, from}], bad:[{line,text}] }
export function readImports(src, rx) {
  const imports = [];
  const bad = [];
  const lines = src.split('\n');
  const lineRx = new RegExp(rx.import_line);
  const namedRx = new RegExp(rx.import_named);
  const starRx = new RegExp(rx.import_star);
  lines.forEach((text, idx) => {
    if (!lineRx.test(text)) return;
    let m = text.match(namedRx);
    if (m) {
      const names = m[1].split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
        const p = s.split(/\s+as\s+/);
        return { name: p[0].trim(), as: (p[1] || p[0]).trim() };
      });
      imports.push({ line: idx + 1, kind: 'named', names, from: m[2] });
      return;
    }
    m = text.match(starRx);
    if (m) { imports.push({ line: idx + 1, kind: 'star', as: m[1], from: m[2] }); return; }
    bad.push({ line: idx + 1, text: text.trim() });
  });
  return { imports, bad };
}

// import 줄을 지운 글(줄 수는 그대로)
export function withoutImports(src, rx) {
  const lineRx = new RegExp(rx.import_line);
  return src.split('\n').map((t) => (lineRx.test(t) ? '' : t)).join('\n');
}
