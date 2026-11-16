/*
 * index.html + style.css + engine.js + data.js + app.js 를 한 파일로 합친다.
 *   node web/build.js            (저장소 루트에서)
 * 출력:
 *   web/dist/index.html     폰에서 바로 여는 완전한 HTML 한 장
 *   web/dist/artifact.html  Claude Artifact 용 조각(<html>/<head>/<body> 없음)
 */
"use strict";
const fs = require("fs");
const path = require("path");

const dir = __dirname;
const read = (f) => fs.readFileSync(path.join(dir, f), "utf8");
let html = read("index.html");

function inline(needle, replacement) {
  if (!html.includes(needle)) throw new Error(`index.html 에 ${needle} 가 없다`);
  html = html.replace(needle, () => replacement);
}
inline('<link rel="stylesheet" href="style.css">', `<style>\n${read("style.css")}\n</style>`);
// live.js(실제 충전소 데이터)는 tools/charger_api.py 로 만든 뒤에만 있다. 없으면 예시 데이터만 들어간다
const hasLive = fs.existsSync(path.join(dir, "live.js"));
inline('<script src="live.js"></script>', hasLive ? `<script>\n${read("live.js")}\n</script>` : "");
for (const f of ["engine.js", "live_build.js", "data.js", "navi.js", "regions.js", "around.js", "relay.js", "app.js"]) {
  inline(`<script src="${f}"></script>`, `<script>\n${read(f)}\n</script>`);
}

const outDir = path.join(dir, "dist");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "index.html"), html, "utf8");
// 폰에 옮겨 바로 여는 용도(같은 내용, 알아보기 쉬운 이름)
fs.writeFileSync(path.join(outDir, "충전길잡이.html"), html, "utf8");

// Artifact 조각: <head> 안 내용(title/meta/link/style)과 <body> 안 내용만
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1]
  .replace(/<meta charset[^>]*>\s*/i, "")
  .replace(/<meta name="viewport"[^>]*>\s*/i, "");
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
fs.writeFileSync(path.join(outDir, "artifact.html"), head.trim() + "\n" + body.trim() + "\n", "utf8");

console.log(`dist/index.html ${(html.length / 1024).toFixed(1)} KB, dist/artifact.html 생성, 실제 데이터 ${hasLive ? "포함" : "없음(예시만)"}`);
