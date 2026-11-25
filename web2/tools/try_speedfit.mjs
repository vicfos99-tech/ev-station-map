// 속도판 '세 자리 숫자 다 보임' 시험(브라우저 없이 — 다리도 필요 없음).
//   node web2/tools/try_speedfit.mjs
// 가상 창에는 그림(글꼴 폭)이 없어서 실제 폭을 잴 수 없다. 그래서 판 폭(clientWidth 을 시험이 정해 넣음)마다 속도판이 고른 숫자 크기로
// '자리 수 × 숫자 한 자 폭(설정 digit_em × 크기) + 판 안쪽 여백 ≤ 판 폭' 인지 셈해 본다(한계: digit_em 은 고정폭 숫자의 어림값).
// 또 왼편 자리의 가장 좁은 폭(config_ui_boards.slot_min_px.left)이 '판 폭 + 자리 여백'보다 좁지 않은지 본다.
// try_a2na.mjs 가 이 표를 함께 쓴다. 혼자 돌리면 표를 찍고 실패가 있으면 0 아닌 코드.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { loadToolsConfig, appDir } from './lib_tools.mjs';
import { loadAppConfig } from './lib_appfiles.mjs';
import { fakeDoc } from './lib_apprun.mjs';

export async function speedFitRows(tc, app) {
  const S = tc.speedfit;
  const src = path.join(app, tc.build.src_dir);
  const { raw } = loadAppConfig(app, tc.build, { overrides: tc.check4.build_supplied });
  const { createConfig } = await import(pathToFileURL(path.join(src, 'cfg' + tc.build.module_ext)).href);
  const board = await import(pathToFileURL(path.join(src, 'board' + tc.build.module_ext)).href);
  const mod = await import(pathToFileURL(path.join(src, S.board + tc.build.module_ext)).href);
  const view = fs.readFileSync(path.join(src, tc.build.view_prefix + S.board + tc.build.view_ext), 'utf8');
  const cfg = createConfig(raw);
  const c = cfg.section(S.config);
  const f = c.fit;
  const boards = cfg.section(S.boards_config);
  const rows = [];
  const fitsIn = (text, size, width) => text.length * f.digit_em * size + f.pad_px <= width;
  const smallestFits = (width) => fitsIn('9'.repeat(f.max_digits), Math.min(...f.size_steps_px), width);
  // ① 판 폭마다 199·115 가 다 들어가는 크기를 고르나
  const lines = [];
  let allOk = true;
  for (const w of [0, ...S.widths_px]) {
    for (const v of S.values) {
      const doc = fakeDoc([view]);
      doc.els[c.ids.root].clientWidth = w;
      const panel = mod.create({ cfg, doc, board });
      panel.show({ [c.speed_piece]: { kmh: v, judge: null }, [c.health_piece]: { ok: true } });
      const text = doc.els[c.ids.value].textContent;
      const size = Number(doc.els[c.ids.root].getAttribute(f.size_attr));
      const styleSize = doc.els[c.ids.root].style.getPropertyValue(f.size_var);
      const width = w > 0 ? w : f.panel_width_px;
      const need = text.length * f.digit_em * size + f.pad_px;
      const ok = text === String(v) && styleSize === size + f.size_unit && (smallestFits(width) ? need <= width : size === Math.min(...f.size_steps_px));
      if (!ok) allOk = false;
      lines.push((w ? w + 'px' : '그려지기 전') + ':' + v + '→' + size + 'px(' + need.toFixed(0) + '/' + width + ')' + (ok ? '' : '✗'));
    }
  }
  rows.push({ no: '속도-1', title: "세 자리 숫자 다 보임 — 판 폭마다 고른 크기로 셈(가상 창)", expect: '글 = 값 · 숫자 칸(자리 수 × ' + f.digit_em + ' × 크기 + 여백 ' + f.pad_px + ') ≤ 판 폭 · 크기는 정해 둔 단계(' + f.size_steps_px.join('/') + ')',
    actual: lines.join(' · '), ok: allOk });
  // ② 왼편 자리 가장 좁은 폭 ≥ 설정 판 폭 + 자리 여백, 그 폭에서 199 가 가장 큰 단계로 들어감
  const slotMin = boards.slot_min_px[c.slot];
  const okSlot = typeof slotMin === 'number' && slotMin >= f.panel_width_px + S.slot_pad_px && fitsIn('9'.repeat(f.max_digits), Math.max(...f.size_steps_px), f.panel_width_px);
  rows.push({ no: '속도-2', title: '왼편 자리 가장 좁은 폭(판 폭 설정)', expect: '자리 ' + slotMin + 'px ≥ 판 ' + f.panel_width_px + ' + 자리 여백 ' + S.slot_pad_px + ' · 그 폭에서 199 가 가장 큰 단계(' + Math.max(...f.size_steps_px) + 'px)로 들어감',
    actual: '자리 ' + slotMin + ' · 199 숫자 칸 ' + (f.max_digits * f.digit_em * Math.max(...f.size_steps_px) + f.pad_px).toFixed(0) + 'px', ok: okSlot });
  return rows;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const tc = loadToolsConfig();
  const rows = await speedFitRows(tc, appDir(tc));
  for (const r of rows) console.log('| ' + [r.no, r.title, r.expect, r.actual, r.ok ? tc.pass_word : tc.fail_word].join(' | ') + ' |');
  const ok = rows.every((r) => r.ok);
  console.log('속도판 세 자리: ' + (ok ? tc.pass_word : tc.fail_word));
  process.exitCode = ok ? tc.exit.ok : tc.exit.fail;
}
