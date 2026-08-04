#!/usr/bin/env node
/** 양식 검사기 — 등록된 양식이 실제로 원본과 같은 모양으로 나오는지 확인한다.
 *
 *   node tools/check.js            모든 양식
 *   node tools/check.js jangbi     한 양식만
 *   node tools/check.js --pdf      PDF 로 변환해 실제 인쇄 선 위치까지 확인 (LibreOffice 필요)
 *
 * 검사 항목
 *   1) 정의 ↔ 양식파일   forms.json 의 열 폭·병합 범위가 xlsx 원본과 같은가
 *   2) 파일 형식         만든 xlsx 를 엑셀이 손상으로 보지 않는가
 *   3) 사진 정렬         사진이 사진칸 정중앙에 놓였는가
 *   4) 인쇄 결과(--pdf)  실제로 그려진 칸 경계가 정의와 같은가
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const ExcelJS = require('exceljs');
const ROOT = path.join(__dirname, '..');
const { buildXlsx, forms } = require(path.join(ROOT, 'lib/build.js'));

const EMU = 9525;
const A = 'A'.charCodeAt(0);
const colNum = s => [...s].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - A + 1), 0);
const colName = n => { let s = ''; while (n > 0) { s = String.fromCharCode(A + (n - 1) % 26) + s; n = Math.floor((n - 1) / 26); } return s; };
const ok = (c, m) => console.log(`   ${c ? '✓' : '✗'} ${m}`);

/** 검사용 사진 (색이 다른 JPEG 를 즉석에서 만든다) */
function samplePhotos(n) {
  const dir = path.join(ROOT, 'photos');
  if (fs.existsSync(dir)) {
    const names = fs.readdirSync(dir).filter(f => /\.jpe?g$/i.test(f));
    if (names.length) return names.slice(0, n).map(f => readJpeg(path.join(dir, f)));
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chk'));
  execFileSync('python3', ['-c', `
from PIL import Image, ImageDraw
for i in range(${n}):
    w,h = (1600,1200) if i%2 else (1200,1600)
    im = Image.new('RGB',(w,h),(60+i*25,120,200-i*20))
    ImageDraw.Draw(im).rectangle([w//6,h//6,w*5//6,h*5//6],outline=(255,255,0),width=12)
    im.save('${tmp}/p%d.jpg'%i, quality=80)`]);
  return fs.readdirSync(tmp).sort().map(f => readJpeg(path.join(tmp, f)));
}

function readJpeg(p) {
  const b = fs.readFileSync(p);
  let w = 0, h = 0, i = 2;
  while (i < b.length) {
    if (b[i] !== 0xFF) { i++; continue; }
    const m = b[i + 1];
    if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
      h = b.readUInt16BE(i + 5); w = b.readUInt16BE(i + 7); break;
    }
    i += 2 + b.readUInt16BE(i + 2);
  }
  return { data: b.toString('base64'), w, h };
}

/** 1) 정의가 양식 파일과 같은 모양을 가리키는지 */
async function checkDef(form) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(ROOT, 'templates', form.template));
  const ws = (form.sheet && wb.getWorksheet(form.sheet)) || wb.worksheets[0];

  let bad = 0;
  form.cols.forEach((w, i) => {
    const real = ws.getColumn(i + 1).width;
    if (Math.abs((real || 0) - w) > 0.01) { bad++; console.log(`      열 ${colName(i + 1)} 정의 ${w} ≠ 양식 ${real}`); }
  });
  ok(!bad, `열 폭 ${form.cols.length}개`);

  const rowsBad = (form.rows || []).filter((h, i) => Math.abs((ws.getRow(i + 1).height || 0) - h) > 0.01).length;
  ok(!rowsBad, `행 높이 ${(form.rows || []).length}개`);

  // 병합 범위: 정의가 말하는 칸이 양식에도 그 범위로 병합돼 있어야 한다
  const merges = new Set((ws.model.merges || []));
  const has = (r, c0, c1) => c0 === c1 || merges.has(`${colName(c0)}${r}:${colName(c1)}${r}`);
  let mbad = 0;
  form.slots.forEach((slot, si) => {
    for (const line of slot.rows) for (const cell of line.cells) {
      if (!has(line.row, cell.cols[0], cell.cols[1])) {
        mbad++;
        console.log(`      ${si + 1}번 칸 ${line.row}행 ${colName(cell.cols[0])}:${colName(cell.cols[1])}` +
          ` (${cell.label || cell.field}) 가 양식의 병합과 다름`);
      }
    }
  });
  ok(!mbad, '표 칸 병합 범위');
  return !bad && !rowsBad && !mbad;
}

/** 2) 만든 파일을 엑셀이 받아들이는 형태인지 */
function checkXlsx(file) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xz'));
  execFileSync('unzip', ['-oq', file, '-d', dir]);
  const sheet = fs.readFileSync(path.join(dir, 'xl/worksheets/sheet1.xml'), 'utf8');
  const wbx = fs.readFileSync(path.join(dir, 'xl/workbook.xml'), 'utf8');
  const styles = fs.readFileSync(path.join(dir, 'xl/styles.xml'), 'utf8');

  const pa = (/<definedName[^>]*>([^<]*)<\/definedName>/.exec(wbx) || [])[1] || '';
  const merges = [...sheet.matchAll(/ref="([A-Z]+\d+:[A-Z]+\d+)"/g)].map(m => m[1]);
  const maxS = Math.max(0, ...[...sheet.matchAll(/<c [^>]*s="(\d+)"/g)].map(m => +m[1]));
  const nXf = +(/<cellXfs count="(\d+)"/.exec(styles) || [0, 0])[1];
  const rows = [...sheet.matchAll(/<row r="(\d+)"/g)].map(m => +m[1]);
  const brk = [...sheet.matchAll(/<brk [^>]*max="(\d+)"/g)].map(m => +m[1]);

  const ORDER = ['sheetPr', 'dimension', 'sheetViews', 'sheetFormatPr', 'cols', 'sheetData',
    'sheetCalcPr', 'sheetProtection', 'autoFilter', 'mergeCells', 'conditionalFormatting',
    'dataValidations', 'hyperlinks', 'printOptions', 'pageMargins', 'pageSetup', 'headerFooter',
    'rowBreaks', 'colBreaks', 'drawing', 'legacyDrawing'];
  const top = []; let depth = 0;
  for (const [, close, name, selfc] of sheet.replace(/^<\?xml[^>]*\?>/, '').matchAll(/<(\/?)([a-zA-Z:]+)[^>]*?(\/?)>/g)) {
    if (close) { depth--; continue; }
    if (depth === 1) top.push(name);
    if (!selfc) depth++;
  }
  const oi = top.map(n => ORDER.indexOf(n));
  const sp = (/<sheetPr>(.*?)<\/sheetPr>/.exec(sheet) || [])[1] || '';
  const SP = ['tabColor', 'outlinePr', 'pageSetUpPr'];
  const si = [...sp.matchAll(/<([a-zA-Z]+)/g)].map(m => SP.indexOf(m[1]));

  const tests = [
    [!/\$\$/.test(pa), '인쇄영역 표기'],
    [merges.length === new Set(merges).size, '병합 중복 없음'],
    [maxS < nXf, '서식 번호 범위'],
    [rows.every((r, i) => i === 0 || r > rows[i - 1]), '행 번호 오름차순'],
    [brk.every(v => v <= 16383), '페이지 나눔 열 번호'],
    [oi.every((v, i) => v >= 0 && (i === 0 || v > oi[i - 1])), '시트 요소 순서'],
    [si.every((v, i) => v >= 0 && (i === 0 || v > si[i - 1])), 'sheetPr 요소 순서'],
  ];
  tests.forEach(([c, m]) => { if (!c) ok(false, m); });
  const pass = tests.every(([c]) => c);
  if (pass) ok(true, '엑셀 파일 형식 7개 항목');
  return pass;
}

/** 3) 사진이 칸 정중앙인지 */
async function checkCenter(file, form) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  const colPx = c => Math.round((ws.getColumn(c).width || 8.43) * (form.pxPerChar || 8) + 5);
  const rowPx = r => (ws.getRow(r).height || 16.5) * 4 / 3;
  const xAt = (col, off) => { let x = 0; for (let c = 1; c < col; c++) x += colPx(c); return x + off; };
  const yAt = (row, off) => { let y = 0; for (let r = 1; r < row; r++) y += rowPx(r); return y + off; };

  let bad = 0;
  const imgs = ws.getImages();
  imgs.forEach((im, i) => {
    const { tl, br } = im.range;
    const x0 = xAt(tl.nativeCol + 1, tl.nativeColOff / EMU);
    const x1 = br ? xAt(br.nativeCol + 1, br.nativeColOff / EMU) : x0 + im.range.ext.width;
    const y0 = yAt(tl.nativeRow + 1, tl.nativeRowOff / EMU);
    const y1 = br ? yAt(br.nativeRow + 1, br.nativeRowOff / EMU) : y0 + im.range.ext.height;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    for (let blk = 0; blk < 8; blk++) for (const s of form.slots) {
      const X0 = xAt(s.box.cols[0], 0), X1 = xAt(s.box.cols[1] + 1, 0);
      const Y0 = yAt(s.box.rows[0] + blk * form.block, 0), Y1 = yAt(s.box.rows[1] + 1 + blk * form.block, 0);
      if (cx >= X0 && cx <= X1 && cy >= Y0 && cy <= Y1) {
        if (Math.abs((x0 - X0) - (X1 - x1)) > 1.5 || Math.abs((y0 - Y0) - (Y1 - y1)) > 1.5) {
          bad++; console.log(`      사진 ${i + 1} 치우침`);
        }
        return;
      }
    }
    bad++; console.log(`      사진 ${i + 1} 이 사진칸 밖에 있음`);
  });
  ok(!bad, `사진 ${imgs.length}장 가운데 정렬`);
  return !bad;
}

/** 4) 실제 인쇄 결과의 세로 선 위치가 정의와 같은지 */
function checkPrint(file, form) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pz'));
  execFileSync('libreoffice', ['--headless', '--convert-to', 'pdf', '--outdir', dir, file], { stdio: 'ignore' });
  const pdf = path.join(dir, path.basename(file).replace(/\.xlsx$/, '.pdf'));
  // 사진칸이 나란히 놓인 양식은 한 줄에 여러 칸의 표가 함께 인쇄된다 → 같은 행을 모두 모은다
  const row = form.slots[0].rows[0].row;
  const cells = form.slots.flatMap(s => s.rows.filter(l => l.row === row).flatMap(l => l.cells))
    .sort((a, b) => a.cols[0] - b.cols[0]);
  const want = cells.map(c => form.cols.slice(c.cols[0] - 1, c.cols[1]).reduce((a, b) => a + b, 0));
  const out = execFileSync('python3', [path.join(__dirname, 'rules.py'), pdf, String(cells.length)], { encoding: 'utf8' }).trim();
  if (!out) { ok(false, '인쇄 결과에서 표를 찾지 못함'); return false; }
  const got = out.split(' ').map(Number);
  const norm = a => a.map(v => v / a.reduce((x, y) => x + y, 0));
  const [W, G] = [norm(want), norm(got)];
  const diff = W.length === G.length ? Math.max(...W.map((v, i) => Math.abs(v - G[i]))) : 1;
  ok(diff < 0.02, `인쇄된 칸 폭 비율 (최대 오차 ${(diff * 100).toFixed(1)}%)`);
  if (diff >= 0.02) console.log('      정의', W.map(v => v.toFixed(3)).join(' '), '\n      인쇄', G.map(v => v.toFixed(3)).join(' '));
  return diff < 0.02;
}

(async () => {
  const args = process.argv.slice(2);
  const wantPdf = args.includes('--pdf');
  const only = args.filter(a => !a.startsWith('--'));
  const list = forms().filter(f => !only.length || only.includes(f.id));
  const photos = samplePhotos(5);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chkout'));
  let allOk = true;

  for (const form of list) {
    console.log(`\n■ ${form.name} (${form.id})`);
    let good = await checkDef(form);
    const items = photos.map((p, i) => Object.assign({
      fields: { memo: '검사 ' + (i + 1), loc: 'A구역', bigo: '', '업체명': '한보건설', '내용': '검사' },
    }, p));
    const file = path.join(tmp, form.id + '.xlsx');
    fs.writeFileSync(file, await buildXlsx({ form: form.id, site: '검사 현장', date: '2026-08-04', items }));
    good = checkXlsx(file) && good;
    good = (await checkCenter(file, form)) && good;
    if (wantPdf) good = checkPrint(file, form) && good;
    allOk = allOk && good;
  }
  console.log(`\n${allOk ? '전부 통과' : '문제 있음'} — 결과 파일 ${tmp}`);
  process.exit(allOk ? 0 : 1);
})();
