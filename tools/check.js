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

// 윈도우의 'python3' 는 실행하면 스토어를 여는 껍데기라 그대로 쓰면 검사기가 통째로 죽는다.
// 실제로 파이썬이 뜨는 이름을 한 번만 찾아 둔다.
const PY = (() => {
  for (const c of ['python3', 'python']) {
    try {
      if (/^\d+\.\d+/.test(execFileSync(c, ['-c', 'import sys;print(sys.version.split()[0])'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim())) return c;
    } catch (e) { /* 다음 이름으로 */ }
  }
  return null;
})();
const needPy = what => { if (!PY) throw new Error(`${what}에는 파이썬이 필요합니다 (python3/python 을 찾지 못했습니다).`); return PY; };

/** 검사용 사진 (색이 다른 JPEG 를 즉석에서 만든다) */
function samplePhotos(n) {
  const dir = path.join(ROOT, 'photos');
  if (fs.existsSync(dir)) {
    const names = fs.readdirSync(dir).filter(f => /\.jpe?g$/i.test(f));
    if (names.length) return names.slice(0, n).map(f => readJpeg(path.join(dir, f)));
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chk'));
  const out = tmp.replace(/\\/g, '/');      // 윈도우 경로의 \ 는 파이썬 문자열에서 이스케이프로 먹힌다
  execFileSync(needPy('검사용 사진 만들기'), ['-c', `
from PIL import Image, ImageDraw
for i in range(${n}):
    w,h = (1600,1200) if i%2 else (1200,1600)
    im = Image.new('RGB',(w,h),(60+i*25,120,200-i*20))
    ImageDraw.Draw(im).rectangle([w//6,h//6,w*5//6,h*5//6],outline=(255,255,0),width=12)
    im.save('${out}/p%d.jpg'%i, quality=80)`]);
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
  const wsDir = path.join(dir, 'xl/worksheets');
  // 시트 파일 이름은 sheet1.xml 이라는 보장이 없다 (올린 양식은 sheet4.xml 인 경우도 있다)
  const names = fs.readdirSync(wsDir).filter(f => /^sheet\d+\.xml$/i.test(f));
  const wbx = fs.readFileSync(path.join(dir, 'xl/workbook.xml'), 'utf8');
  const styles = fs.readFileSync(path.join(dir, 'xl/styles.xml'), 'utf8');
  const pa = (/<definedName[^>]*>([^<]*)<\/definedName>/.exec(wbx) || [])[1] || '';
  const nXf = +(/<cellXfs count="(\d+)"/.exec(styles) || [0, 0])[1];

  const ORDER = ['sheetPr', 'dimension', 'sheetViews', 'sheetFormatPr', 'cols', 'sheetData',
    'sheetCalcPr', 'sheetProtection', 'autoFilter', 'mergeCells', 'conditionalFormatting',
    'dataValidations', 'hyperlinks', 'printOptions', 'pageMargins', 'pageSetup', 'headerFooter',
    'rowBreaks', 'colBreaks', 'drawing', 'legacyDrawing'];
  const SP = ['tabColor', 'outlinePr', 'pageSetUpPr'];

  // 아래 일곱 가지는 시트마다 따로 봐야 한다 (여러 시트를 이어 붙이면 순서 검사가 무너진다)
  const bad = new Set();
  for (const name of names) {
    const sheet = fs.readFileSync(path.join(wsDir, name), 'utf8');
    const merges = [...sheet.matchAll(/ref="([A-Z]+\d+:[A-Z]+\d+)"/g)].map(m => m[1]);
    const maxS = Math.max(0, ...[...sheet.matchAll(/<c [^>]*s="(\d+)"/g)].map(m => +m[1]));
    const rows = [...sheet.matchAll(/<row r="(\d+)"/g)].map(m => +m[1]);
    const brk = [...sheet.matchAll(/<brk [^>]*max="(\d+)"/g)].map(m => +m[1]);

    const top = []; let depth = 0;
    for (const [, close, tag, selfc] of sheet.replace(/^<\?xml[^>]*\?>/, '').matchAll(/<(\/?)([a-zA-Z:]+)[^>]*?(\/?)>/g)) {
      if (close) { depth--; continue; }
      if (depth === 1) top.push(tag);
      if (!selfc) depth++;
    }
    const oi = top.map(n => ORDER.indexOf(n));
    const sp = (/<sheetPr>(.*?)<\/sheetPr>/.exec(sheet) || [])[1] || '';
    const si = [...sp.matchAll(/<([a-zA-Z]+)/g)].map(m => SP.indexOf(m[1]));
    const asc = a => a.every((v, i) => v >= 0 && (i === 0 || v > a[i - 1]));

    for (const [good, label] of [
      [merges.length === new Set(merges).size, '병합 중복 없음'],
      [maxS < nXf, '서식 번호 범위'],
      [rows.every((r, i) => i === 0 || r > rows[i - 1]), '행 번호 오름차순'],
      [brk.every(v => v <= 16383), '페이지 나눔 열 번호'],
      [asc(oi), '시트 요소 순서'],
      [asc(si), 'sheetPr 요소 순서'],
    ]) if (!good) bad.add(`${label} (${name})`);
  }
  if (/\$\$/.test(pa)) bad.add('인쇄영역 표기');
  // 외부 통합문서를 가리키던 이름이 남아 있으면 엑셀이 파일을 아예 열지 못한다
  const orphan = [...wbx.matchAll(/<definedName[^>]*>([^<]*)<\/definedName>/g)]
    .filter(m => /\[\d+\]/.test(m[1])).length;
  if (orphan && !fs.existsSync(path.join(dir, 'xl/externalLinks'))) {
    bad.add(`가리킬 곳 없는 외부참조 이름 ${orphan}개`);
  }

  bad.forEach(m => ok(false, m));
  if (!bad.size) ok(true, `엑셀 파일 형식 7개 항목 (시트 ${names.length}개)`);
  return !bad.size;
}

/** 3) 사진이 칸 정중앙인지 */
async function checkCenter(file, form) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = (form.sheet && wb.getWorksheet(form.sheet)) || wb.worksheets[0];
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

/** 결과물에 원본 양식의 여분 페이지·서식이 안 남았는지.
 *  사람이 만든 원본에는 예비로 만들어 둔 페이지가 실제 현장명까지 박힌 채로 남아 있는
 *  경우가 흔하다. 사진 수가 적어 그 자리를 안 채우면 그게 그대로 파일에 남아, 인쇄
 *  미리보기에는 안 보이지만 엑셀을 스크롤하면 이상한 선·남의 현장명으로 나타난다. */
async function checkNoLeftover(file, form, blocks) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = (form.sheet && wb.getWorksheet(form.sheet)) || wb.worksheets[0];
  const bs = form.blockStart || 1;
  const want = bs - 1 + blocks * form.block;
  const got = ws.rowCount;
  const bad = got > want;
  ok(!bad, `여분 없음 (사용 ${want}행, 실제 ${got}행)`);
  return !bad;
}

/** xlsx 를 실제 인쇄 모양 그대로 PDF 로 바꾼다.
 *  엑셀이 깔려 있으면 엑셀에게 시킨다 — 우리가 흉내 낸 그림이 아니라 '정답지'가 된다. */
function toPdf(file, sheet) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pz'));
  const pdf = path.join(dir, path.basename(file).replace(/\.xlsx$/i, '.pdf'));
  const target = sheet ? `$wb.Worksheets.Item('${sheet.replace(/'/g, "''")}')` : '$wb';
  const ps = `$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false; $xl.DisplayAlerts = $false
try { $wb = $xl.Workbooks.Open('${file.replace(/'/g, "''")}', 0, $true)
      ${target}.ExportAsFixedFormat(0, '${pdf.replace(/'/g, "''")}'); $wb.Close($false) }
finally { $xl.Quit() }`;
  try {
    execFileSync('powershell', ['-NonInteractive', '-NoProfile', '-Command', ps], { stdio: 'ignore' });
    if (fs.existsSync(pdf)) return pdf;
  } catch (e) { /* 엑셀이 없으면 아래로 */ }
  for (const app of ['soffice', 'libreoffice']) {
    try {
      execFileSync(app, ['--headless', '--convert-to', 'pdf', '--outdir', dir, file], { stdio: 'ignore' });
      if (fs.existsSync(pdf)) return pdf;
    } catch (e) { /* 다음 이름으로 */ }
  }
  return null;
}

/** 4) 실제 인쇄 결과의 세로 선 위치가 정의와 같은지 */
function checkPrint(file, form) {
  const pdf = toPdf(file, form.sheet);
  if (!pdf) { ok(false, '인쇄 결과 검사에는 엑셀이나 LibreOffice 가 필요합니다'); return false; }
  // 사진칸이 나란히 놓인 양식은 한 줄에 여러 칸의 표가 함께 인쇄된다 → 같은 행을 모두 모은다
  const row = form.slots[0].rows[0].row;
  const cells = form.slots.flatMap(s => s.rows.filter(l => l.row === row).flatMap(l => l.cells))
    .sort((a, b) => a.cols[0] - b.cols[0]);
  const want = cells.map(c => form.cols.slice(c.cols[0] - 1, c.cols[1]).reduce((a, b) => a + b, 0));
  const out = execFileSync(needPy('인쇄 결과 검사'), [path.join(__dirname, 'rules.py'), pdf, String(cells.length)], { encoding: 'utf8' }).trim();
  if (!out) { ok(false, '인쇄 결과에서 표를 찾지 못함'); return false; }
  const got = out.split(' ').map(Number);
  const norm = a => a.map(v => v / a.reduce((x, y) => x + y, 0));
  const [W, G] = [norm(want), norm(got)];
  const diff = W.length === G.length ? Math.max(...W.map((v, i) => Math.abs(v - G[i]))) : 1;
  ok(diff < 0.02, `인쇄된 칸 폭 비율 (최대 오차 ${(diff * 100).toFixed(1)}%)`);
  if (diff >= 0.02) console.log('      정의', W.map(v => v.toFixed(3)).join(' '), '\n      인쇄', G.map(v => v.toFixed(3)).join(' '));
  return diff < 0.02;
}

/** 아직 등록하지 않은 양식(앱에 올리는 그 파일)이 원본 그대로 뽑혔는지.
 *  화면·PDF 는 원본을 변환하는 게 아니라 추출한 정의로 다시 그리므로,
 *  정의가 원본과 한 칸이라도 다르면 그만큼 화면이 원본과 달라진다. */
async function checkUpload(file, wantPrint) {
  const { analyze } = require(path.join(__dirname, 'add-form.js'));
  const def = await analyze(file, { id: 'chk', name: path.basename(file) });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = (def.sheet && wb.getWorksheet(def.sheet)) || wb.worksheets[0];
  const bs = def.blockStart, be = bs + def.block - 1;
  console.log(`   블록 ${bs}~${be}행 · 사진 ${def.perPage}장 · ${def.cols.length}열` +
              ` · 항목 [${[...new Set(def.slots.flatMap(s => s.rows.flatMap(l =>
                 l.cells.filter(c => c.field).map(c => c.field))))].join(', ')}]`);
  let good = true;
  const fail = (m, list) => { good = false; ok(false, m); (list || []).slice(0, 8).forEach(x => console.log('      ' + x)); };

  // 열 폭·행 높이
  const cw = def.cols.filter((w, i) => Math.abs((ws.getColumn(i + 1).width || 8.43) - w) > 0.01);
  cw.length ? fail(`열 폭 ${cw.length}개 어긋남`) : ok(true, `열 폭 ${def.cols.length}개`);
  const rh = def.rows.filter((h, i) => Math.abs((ws.getRow(i + 1).height || 16.5) - h) > 0.01);
  rh.length ? fail(`행 높이 ${rh.length}개 어긋남`) : ok(true, `행 높이 ${def.rows.length}개`);

  // 정의가 그리는 칸이 원본의 병합 범위와 같은가
  const merges = new Set(ws.model.merges || []);
  const spanBad = def.templateCells.filter(c =>
    (c.c !== c.c2 || c.r !== c.r2) && !merges.has(`${colName(c.c)}${c.r}:${colName(c.c2)}${c.r2}`));
  spanBad.length ? fail('병합 범위가 원본과 다름',
    spanBad.map(c => `${colName(c.c)}${c.r}:${colName(c.c2)}${c.r2}`)) : ok(true, '병합 범위');

  // 테두리 — 네 변은 각각 그 변에 닿은 칸에 저장돼 있다
  const bordBad = [];
  for (const c of def.templateCells) {
    for (const [side, cell] of [['left', [c.r, c.c]], ['right', [c.r, c.c2]],
                                ['top', [c.r, c.c]], ['bottom', [c.r2, c.c]]]) {
      const src = ((ws.getCell(cell[0], cell[1]).border || {})[side] || {}).style || null;
      const got = c.borders[side] || null;
      // 블록 끝줄의 아래선은 다음 블록의 윗선에서 빌려 오므로 원본에 없어도 정상이다
      if (src !== got && !(side === 'bottom' && c.r2 === be && got && !src)) {
        bordBad.push(`${colName(c.c)}${c.r} ${side}: 원본 ${src || '없음'} → 정의 ${got || '없음'}`);
      }
    }
  }
  bordBad.length ? fail(`테두리 ${bordBad.length}군데 어긋남`, bordBad) : ok(true, '테두리');

  // 정렬 — 균등분할(distributed) 같은 값이 빠지면 글자가 엉뚱한 쪽에 붙는다
  const alBad = def.templateCells.filter(c =>
    c.text && ((ws.getCell(c.r, c.c).alignment || {}).horizontal || 'left') !== c.align)
    .map(c => `${colName(c.c)}${c.r} "${c.text}"`);
  alBad.length ? fail(`정렬 ${alBad.length}군데 어긋남`, alBad) : ok(true, '글자 정렬');

  // 화면이 모르는 정렬은 조용히 왼쪽으로 떨어진다 (균등분할을 놓쳐 라벨이 왼쪽에 붙은 적이 있다)
  const DRAWN = new Set(['left', 'center', 'right', 'centerContinuous', 'distributed', 'justify', 'general']);
  const used = [...new Set(def.templateCells.filter(c => c.text).map(c => c.align))];
  const unknown = used.filter(a => !DRAWN.has(a));
  unknown.length ? fail(`화면이 그릴 줄 모르는 정렬: ${unknown.join(', ')}`)
                 : ok(true, `쓰인 정렬 [${used.join(', ')}]`);

  // 사람이 채울 칸에 견본 값이 남아 있으면 지워지지 않는 글자가 된다
  const dyn = new Set();
  for (const s of def.slots) for (const l of s.rows) for (const c of l.cells) if (c.field) dyn.add(`${l.row}:${c.cols[0]}`);
  const stuck = def.templateCells.filter(c => c.text && dyn.has(`${c.r}:${c.c}`))
    .map(c => `${colName(c.c)}${c.r} "${c.text}"`);
  stuck.length ? fail('입력칸에 견본 글자가 박혀 있음', stuck) : ok(true, '입력칸 비어 있음');

  // 라벨마다 값칸이 하나씩 있어야 한다 (견본 값을 라벨로 오인하면 입력칸이 사라진다)
  const lost = [];
  for (const s of def.slots) for (const l of s.rows) {
    const cs = l.cells;
    cs.forEach((c, i) => { if (c.label && !(cs[i + 1] && cs[i + 1].field)) lost.push(`${l.row}행 "${c.label}"`); });
  }
  lost.length ? fail('라벨에 값칸이 없음 — 입력칸이 사라짐', lost) : ok(true, '라벨마다 입력칸 있음');

  // 수식·날짜 칸이 글자로 새어 나오지 않았는가
  const junk = def.templateCells.filter(c => /\[object|GMT|Invalid Date/.test(c.text))
    .map(c => `${colName(c.c)}${c.r} "${c.text}"`);
  junk.length ? fail('셀 값이 글자로 잘못 변환됨', junk) : ok(true, '글자 변환');

  // 실제로 사진을 넣어 뽑아 보고, 엑셀이 인쇄한 선 위치와 정의를 맞춰 본다
  if (wantPrint) {
    const { stripPhotos } = require(path.join(ROOT, 'lib/build.js'));
    const clean = await stripPhotos(fs.readFileSync(file), def);
    const photos = samplePhotos(def.perPage);
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pr')), 'out.xlsx');
    fs.writeFileSync(out, await buildXlsx({
      formDef: def, template: clean.buffer.toString('base64'),
      site: '검사 현장', date: '2026-08-04',
      items: photos.map((p, i) => Object.assign({ fields: { memo: '검사 ' + (i + 1), loc: 'A구역', bigo: '' } }, p)),
    }));
    good = checkXlsx(out) && good;
    good = (await checkCenter(out, def)) && good;
    good = (await checkNoLeftover(out, def, 1)) && good;
    good = checkPrint(out, def) && good;
  }

  return good;
}

(async () => {
  const args = process.argv.slice(2);
  const wantPdf = args.includes('--pdf');
  const fi = args.indexOf('--file');
  if (fi >= 0) {
    const f = args[fi + 1];
    if (!f) { console.error('사용법: node tools/check.js --file <양식.xlsx> [--pdf]'); process.exit(1); }
    console.log(`\n■ ${path.basename(f)}`);
    const good = await checkUpload(f, wantPdf).catch(e => { ok(false, e.message); return false; });
    console.log(`\n${good ? '원본 그대로 나옵니다' : '원본과 다르게 나옵니다'}`);
    process.exit(good ? 0 : 1);
  }
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
    good = (await checkNoLeftover(file, form, Math.ceil(items.length / form.perPage))) && good;
    if (wantPdf) good = checkPrint(file, form) && good;
    allOk = allOk && good;
  }
  console.log(`\n${allOk ? '전부 통과' : '문제 있음'} — 결과 파일 ${tmp}`);
  process.exit(allOk ? 0 : 1);
})();
