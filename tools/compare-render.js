#!/usr/bin/env node
/** 진짜 엑셀이 인쇄한 결과와 변환 서버(LibreOffice)가 인쇄한 결과를 나란히 재어 본다.
 *
 *   node tools/compare-render.js                       등록된 모든 양식
 *   node tools/compare-render.js daeji2                한 양식만
 *   node tools/compare-render.js --file 어떤양식.xlsx    아직 등록 안 한 파일
 *   node tools/compare-render.js --keep                 비교 이미지를 남긴다
 *
 * 화면·PDF가 '양식 그대로'인지는 사람 눈으로만 보면 놓친다. 같은 xlsx 를 두 엔진에
 * 넣어 픽셀로 견줘야 '얼마나 가까워졌는지'를 숫자로 말할 수 있다.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const ExcelJS = require('exceljs');
const ROOT = path.join(__dirname, '..');
const { buildXlsx, forms, stripPhotos, normalizeForLibreOffice } = require(path.join(ROOT, 'lib/build.js'));
const { analyzeBuffer } = require(path.join(ROOT, 'tools/add-form.js'));

const RENDER_URL = process.env.RENDER_SERVICE_URL || 'https://sajin-render-1004282132575.asia-northeast3.run.app';
const RENDER_KEY = process.env.RENDER_SERVICE_KEY || '';
const DPI = 150;

const PY = (() => {
  for (const c of ['python3', 'python']) {
    try {
      if (/^\d+\.\d+/.test(execFileSync(c, ['-c', 'import sys;print(sys.version.split()[0])'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim())) return c;
    } catch (e) { /* 다음 */ }
  }
  return null;
})();

/** 진짜 엑셀로 인쇄 (윈도우 + 엑셀 설치 필요) */
function renderExcel(xlsx, sheet, outPdf) {
  const target = sheet ? `$wb.Worksheets.Item('${sheet.replace(/'/g, "''")}')` : '$wb';
  const ps = `$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false; $xl.DisplayAlerts = $false
try { $wb = $xl.Workbooks.Open('${xlsx.replace(/'/g, "''")}', 0, $true)
      ${target}.ExportAsFixedFormat(0, '${outPdf.replace(/'/g, "''")}'); $wb.Close($false) }
finally { $xl.Quit() }`;
  try {
    execFileSync('powershell', ['-NonInteractive', '-NoProfile', '-Command', ps], { stdio: 'ignore' });
  } catch (e) { /* 아래에서 존재 여부로 판정 */ }
  return fs.existsSync(outPdf) ? outPdf : null;
}

/** 변환 서버(LibreOffice)로 인쇄 */
async function renderService(xlsx, outPdf) {
  const r = await fetch(RENDER_URL.replace(/\/$/, '') + '/convert', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, RENDER_KEY ? { 'x-api-key': RENDER_KEY } : {}),
    body: JSON.stringify({ xlsx: fs.readFileSync(xlsx).toString('base64'), format: 'pdf' }),
  });
  if (!r.ok) throw new Error('변환 서버 ' + r.status + ': ' + (await r.text()).slice(0, 200));
  const out = await r.json();
  if (out.error) throw new Error(out.error);
  fs.writeFileSync(outPdf, Buffer.from(out.pdf, 'base64'));
  return outPdf;
}

function toPng(pdf, prefix) {
  execFileSync('pdftoppm', ['-png', '-r', String(DPI), pdf, prefix]);
  const dir = path.dirname(prefix), base = path.basename(prefix);
  return fs.readdirSync(dir).filter(f => f.startsWith(base) && f.endsWith('.png')).sort()
    .map(f => path.join(dir, f));
}

/** 두 이미지의 차이를 잰다: 다른 픽셀 비율 + 글자가 그려진 가로 구간의 어긋남 */
function diff(pngA, pngB, outPng) {
  if (!PY) throw new Error('파이썬이 필요합니다.');
  const code = `
import sys, json
import numpy as np
from PIL import Image
a = np.array(Image.open(sys.argv[1]).convert('L'))
b = np.array(Image.open(sys.argv[2]).convert('L'))
h = min(a.shape[0], b.shape[0]); w = min(a.shape[1], b.shape[1])
a = a[:h, :w]; b = b[:h, :w]
da = a < 128; db = b < 128
inked = da | db
both  = da & db
res = {
  'size': [int(w), int(h)],
  'inkA': int(da.sum()), 'inkB': int(db.sum()),
  'overlap': float(both.sum() / max(1, inked.sum())),
  'diffRatio': float((da ^ db).sum() / (w * h)),
}
# 표 바깥 테두리 위치로 가로·세로 배율과 치우침을 잰다.
# 배율이 1 이 아니면 열 너비/행 높이 계산이 서로 다르다는 뜻이다.
def box(d):
    rows = np.where(d.sum(axis=1) > w * 0.25)[0]
    cols = np.where(d.sum(axis=0) > h * 0.15)[0]
    if not len(rows) or not len(cols):
        return None
    return dict(top=int(rows.min()), bottom=int(rows.max()),
                left=int(cols.min()), right=int(cols.max()),
                w=int(cols.max() - cols.min()), h=int(rows.max() - rows.min()))
ba, bb = box(da), box(db)
if ba and bb and ba['w'] and ba['h']:
    res['scaleX'] = round(bb['w'] / ba['w'], 4)
    res['scaleY'] = round(bb['h'] / ba['h'], 4)
    res['offsetX'] = int(bb['left'] - ba['left'])
    res['offsetY'] = int(bb['top'] - ba['top'])
# 잉크가 있는 행 구간을 비교 (표 선 위치가 밀렸는지)
rowsA = np.where(da.sum(axis=1) > w * 0.25)[0]
rowsB = np.where(db.sum(axis=1) > w * 0.25)[0]
res['hLinesA'] = len(rowsA); res['hLinesB'] = len(rowsB)
if len(sys.argv) > 3:
    d = np.zeros((h, w, 3), dtype=np.uint8) + 255
    d[da & ~db] = [220, 0, 0]      # 엑셀에만 있는 잉크 = 빨강
    d[db & ~da] = [0, 90, 220]     # LO 에만 있는 잉크 = 파랑
    d[both] = [170, 170, 170]      # 겹침 = 회색
    Image.fromarray(d).save(sys.argv[3])
print(json.dumps(res))
`;
  const args = [pngA, pngB];
  if (outPng) args.push(outPng);
  const out = execFileSync(PY, ['-c', code, ...args], { encoding: 'utf8' });
  return JSON.parse(out.trim());
}

const TINY = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCABkAGQBAREA/8QAHwAAAQUBAQEB' +
  'AQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1Fh' +
  'ByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZ' +
  'WmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXG' +
  'x8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/APn+iiigD//Z', 'base64').toString('base64');

/** 검사용 사진대지 xlsx 를 만든다 (api/render.js 와 같은 경로: 해당 시트만 남김) */
async function makeSample(def, templateB64, dir, name) {
  const items = Array.from({ length: def.perPage }, (_, i) => ({
    fields: { loc: 'A구역', memo: '검사 ' + (i + 1), bigo: '', '업체명': '한보건설', '내용': '검사' },
    data: TINY, w: 100, h: 100,
  }));
  const buf = await buildXlsx(Object.assign(
    { site: '검사 현장', date: '2026-08-04', items },
    templateB64 ? { formDef: def, template: templateB64 } : { form: def.id }));
  // 엑셀에 보여 줄 파일 = 사용자가 내려받는 것 그대로 (손대지 않는다).
  // 엑셀 쪽은 해당 시트만 내보내므로 다른 시트를 지울 필요가 없다.
  const forExcel = path.join(dir, name + '.xlsx');
  fs.writeFileSync(forExcel, buf);

  // 변환 서버에 보낼 사본 (api/render.js 와 똑같이: 다른 시트는 숨기고 보정을 먹인다)
  const wbL = new ExcelJS.Workbook();
  await wbL.xlsx.load(buf);
  const keepL = (def.sheet && wbL.getWorksheet(def.sheet)) || wbL.worksheets[0];
  for (const ws of wbL.worksheets) ws.state = ws.id === keepL.id ? 'visible' : 'hidden';
  normalizeForLibreOffice(keepL);
  const forLo = path.join(dir, name + '-lo.xlsx');
  fs.writeFileSync(forLo, Buffer.from(await wbL.xlsx.writeBuffer()));

  return { forExcel, forLo };
}

async function compareOne(label, def, templateB64, dir, keep) {
  const { forExcel, forLo } = await makeSample(def, templateB64, dir, label.replace(/\W/g, '_'));
  const ePdf = renderExcel(forExcel, def.sheet, path.join(dir, 'excel.pdf'));
  if (!ePdf) { console.log(`   ✗ 엑셀 인쇄 실패 (윈도우 + 엑셀 필요)`); return null; }
  const lPdf = await renderService(forLo, path.join(dir, 'lo.pdf'));

  const eImgs = toPng(ePdf, path.join(dir, 'e'));
  const lImgs = toPng(lPdf, path.join(dir, 'l'));
  if (eImgs.length !== lImgs.length) {
    console.log(`   ✗ 쪽수가 다름 — 엑셀 ${eImgs.length}장 / LibreOffice ${lImgs.length}장`);
  }
  const n = Math.min(eImgs.length, lImgs.length);
  let worst = null;
  for (let i = 0; i < n; i++) {
    const outPng = keep ? path.join(dir, `diff-${i + 1}.png`) : null;
    const d = diff(eImgs[i], lImgs[i], outPng);
    console.log(`   ${i + 1}쪽  글자겹침 ${(d.overlap * 100).toFixed(1)}%` +
                `  가로배율 ${d.scaleX ?? '?'}  세로배율 ${d.scaleY ?? '?'}` +
                `  치우침 ${d.offsetX ?? '?'},${d.offsetY ?? '?'}px`);
    if (!worst || d.overlap < worst.overlap) worst = Object.assign({ page: i + 1 }, d);
  }
  return { pages: n, pagesE: eImgs.length, pagesL: lImgs.length, worst };
}

(async () => {
  const args = process.argv.slice(2);
  const keep = args.includes('--keep');
  const fi = args.indexOf('--file');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmp'));
  const results = [];

  if (fi >= 0) {
    const file = args[fi + 1];
    const raw = fs.readFileSync(file);
    const def = await analyzeBuffer(raw, { id: 'cmp', name: path.basename(file) });
    const clean = await stripPhotos(raw, def);
    console.log(`\n■ ${path.basename(file)}`);
    results.push([path.basename(file), await compareOne('up', def, clean.buffer.toString('base64'), dir, keep)]);
  } else {
    const only = args.filter(a => !a.startsWith('--'));
    for (const def of forms().filter(f => !only.length || only.includes(f.id))) {
      console.log(`\n■ ${def.name} (${def.id})`);
      results.push([def.id, await compareOne(def.id, def, null, dir, keep)]);
    }
  }

  console.log('\n=== 요약 ===');
  let allGood = true;
  for (const [name, r] of results) {
    if (!r) { console.log(`  ${name.padEnd(22)} 측정 실패`); allGood = false; continue; }
    const sx = r.worst.scaleX ?? 0, sy = r.worst.scaleY ?? 0;
    const ok = r.pagesE === r.pagesL && r.worst.overlap >= 0.80
      && Math.abs(sx - 1) <= 0.01 && Math.abs(sy - 1) <= 0.01;
    if (!ok) allGood = false;
    console.log(`  ${ok ? '✓' : '✗'} ${name.padEnd(22)} 겹침 ${(r.worst.overlap * 100).toFixed(1)}%` +
                `  배율 ${sx}/${sy}  치우침 ${r.worst.offsetX ?? '?'},${r.worst.offsetY ?? '?'}px  쪽수 ${r.pagesE}/${r.pagesL}`);
  }
  if (keep) console.log(`\n비교 이미지: ${dir}  (빨강=엑셀만, 파랑=LibreOffice만, 회색=일치)`);
  process.exit(allGood ? 0 : 1);
})().catch(e => { console.error('오류:', e.message); process.exit(1); });
