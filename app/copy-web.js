/* web/dist/index.html(한 파일로 합친 앱)을 앱 웹 폴더(www)로 복사한다.
 *   node app/copy-web.js   (먼저 node web/build.js)
 */
"use strict";
const fs = require("fs");
const path = require("path");
const src = path.join(__dirname, "..", "web", "dist", "index.html");
const dst = path.join(__dirname, "www", "index.html");
if (!fs.existsSync(src)) throw new Error("web/dist/index.html 이 없다. 먼저 node web/build.js");
fs.mkdirSync(path.dirname(dst), { recursive: true });
fs.copyFileSync(src, dst);
console.log(`복사: ${path.relative(process.cwd(), dst)} (${(fs.statSync(dst).size / 1024).toFixed(1)} KB)`);
