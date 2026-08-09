#!/usr/bin/env node
/** 사진대지 양식 엑셀을 읽어 templates/forms.json 항목을 자동 생성한다.
 *
 *   node tools/add-form.js templates/lh-daeji.xlsx --name "LH 사진대지"
 *   node tools/add-form.js templates/lh-daeji.xlsx --name "..." --dry   (등록 없이 결과만 확인)
 *
 * 사진칸(큰 병합 영역)과 위치·내용·일자·비고 항목칸을 찾아 정의를 만든다.
 */
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'templates');
const A = 'A'.charCodeAt(0);
const colName = n => { let s = ''; while (n > 0) { s = String.fromCharCode(A + (n - 1) % 26) + s; n = Math.floor((n - 1) / 26); } return s; };
const colNum = s => [...s].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - A + 1), 0);

// 항목 이름 → 채워 넣을 값
const FIELDS = [
  [/^(위치|장소|위 치)$/, 'loc'],
  [/^(내용|작업내용|공종|내 용)$/, 'memo'],
  [/^(일자|날짜|촬영일|촬영일자|일 자)$/, 'date'],
  [/^(비고|비 고)$/, 'bigo'],
];
const LABEL_RE = /^[가-힣A-Za-z][가-힣A-Za-z0-9()\/·]{0,9}$/;
const fieldOf = text => {
  const t = String(text).replace(/\s+/g, '');
  for (const [re, f] of FIELDS) if (re.test(t)) return f;
  return LABEL_RE.test(t) ? t : null;      // 모르는 항목명도 그대로 입력칸으로
};
const TITLE_RE = /(사진대지|사진첩|사진목록)/;
const sheetHasTitle = ws => {
  for (let r = 1; r <= Math.min(ws.rowCount, 40); r++)
    for (let c = 1; c <= 3; c++)
      if (TITLE_RE.test(textOf(ws.getCell(r, c).value).replace(/\s+/g, ''))) return true;
  return false;
};
// 수식·날짜 셀은 실제 제출 문서(빈 양식이 아니라 이미 채워 넣은 파일)를 업로드하면 자주 섞여 들어온다.
// String(v)로 그대로 찍으면 "[object Object]" 같은 값이 정적 머리글 텍스트로 그대로 박제된다.
const textOf = v => {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map(r => r.text).join('');
    if (v instanceof Date) return '';                  // 날짜 값은 정적 텍스트로 쓰지 않는다
    if ('result' in v) return v.result == null ? '' : String(v.result);   // 수식 셀(계산 결과)
    if ('formula' in v) return '';                      // 계산 결과가 캐시되지 않은 수식
    if ('text' in v) return String(v.text);              // 하이퍼링크 등
    return '';
  }
  return String(v);
};

// 브라우저 미리보기/PDF에서도 엑셀 원본의 표·채움·글꼴을 재현할 수 있도록
// 첫 양식 블록의 셀 서식을 간결한 JSON으로 보관한다.
const rgb = color => color && color.argb ? '#' + color.argb.slice(-6) : null;
function templateCells(ws, merges, lastCol, blockEnd, dynamic) {
  const out = [];
  for (let r = 1; r <= blockEnd; r++) for (let c = 1; c <= lastCol; c++) {
    const merged = merges.find(m => m.r1 <= r && m.r2 >= r && m.c1 <= c && m.c2 >= c);
    if (merged && (merged.r1 !== r || merged.c1 !== c)) continue;
    const cell = ws.getCell(r, c), f = cell.font || {}, a = cell.alignment || {};
    const fill = cell.fill && cell.fill.type === 'pattern' ? rgb(cell.fill.fgColor) : null;
    const r2 = merged ? merged.r2 : r, c2 = merged ? merged.c2 : c;
    // 병합된 칸의 테두리는 네 변이 각각 그 변에 닿은 칸에 나뉘어 저장된다.
    // 왼쪽 위 칸만 읽으면 오른쪽·아래 선이 통째로 빠져 미리보기에서 끊겨 보인다.
    const edge = { left: [r, c], right: [r, c2], top: [r, c], bottom: [r2, c] };
    const borders = {};
    for (const side of ['left', 'right', 'top', 'bottom']) {
      const b = (ws.getCell(edge[side][0], edge[side][1]).border || {})[side];
      if (b && b.style) borders[side] = b.style;
    }
    // 반복되는 블록끼리 경계선을 나눠 가진 원본이 많다(내 칸엔 top만, 다음 블록 칸엔 top만 있고
    // 그게 시각적으로 이어지는 식). 블록을 한 덩어리만 떼어 쓰면 그 아래쪽 줄이 끊겨 보이므로,
    // 블록의 마지막 행에서 bottom이 없으면 바로 다음 행의 top 테두리를 빌려 채운다.
    if (r2 === blockEnd && !borders.bottom) {
      const below = ws.getCell(blockEnd + 1, c).border || {};
      if (below.top && below.top.style) borders.bottom = below.top.style;
    }
    const text = textOf(cell.value);
    if (!text && !fill && !Object.keys(borders).length) continue;
    out.push({ r, c, r2, c2, text: dynamic.has(`${r}:${c}`) ? '' : text,
      fill, borders, font: { size: f.size || 11, bold: !!f.bold, italic: !!f.italic,
        underline: !!f.underline, color: rgb(f.color) }, align: a.horizontal || 'left' });
  }
  return out;
}

function parseMerges(ws) {
  return (ws.model.merges || []).map(m => {
    const p = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(m);
    return p ? { r1: +p[2], c1: colNum(p[1]), r2: +p[4], c2: colNum(p[3]) } : null;
  }).filter(Boolean);
}

function analyze(file, opt) {
  const o = Object.assign({ template: path.basename(file) }, opt);
  return new ExcelJS.Workbook().xlsx.readFile(file).then(wb => analyzeBook(wb, o));
}

/** 업로드된 엑셀(버퍼)에서 바로 분석 */
function analyzeBuffer(buf, opt) {
  return new ExcelJS.Workbook().xlsx.load(buf).then(wb => analyzeBook(wb, opt));
}

function analyzeBook(wb, opt) {
  return Promise.resolve().then(() => {
    const ws = opt.sheet
      ? wb.worksheets.find(w => w.name === opt.sheet)
      : (wb.worksheets.find(w => sheetHasTitle(w)) || wb.worksheets[0]);
    if (!ws) throw new Error(`시트를 찾지 못했습니다: ${opt.sheet || '(자동)'}`);
    const merges = parseMerges(ws);

    // 1) 제목 행: 가로로 긴 병합 중 '사진대지' 같은 제목이 든 칸 (문서 머리글 아래일 수 있다)
    const titles = merges
      .filter(m => m.c2 - m.c1 >= 3 && m.r1 === m.r2 && TITLE_RE.test(textOf(ws.getCell(m.r1, m.c1).value).replace(/\s+/g, '')))
      .sort((a, b) => a.r1 - b.r1);
    const title = opt.start ? titles.find(t => t.r1 === opt.start) : titles[0];
    if (!title) throw new Error('제목 칸(예: "사 진 대 지")을 찾지 못했습니다.');
    const lastCol = title.c2;
    const titleText = textOf(ws.getCell(title.r1, title.c1).value);
    let blockStart = opt.blockstart || title.r1;

    // 사진칸(큰 병합)과 그 아래 위치·내용 항목표를 찾는 도우미.
    // block 크기를 아직 모를 때도 넉넉한 상한을 주고 먼저 훑어볼 수 있도록 분리해 둔다.
    const heightOf = m => { let h = 0; for (let r = m.r1; r <= m.r2; r++) h += ws.getRow(r).height || 16.5; return h; };
    // 테두리는 병합보다 넓을 수 있다 → 위쪽 행에서 좌우 테두리 위치를 확인
    const boxCols = (box, siblings) => {
      const others = (siblings || []).filter(b => b !== box);
      const lo = Math.max(1, ...others.filter(b => b.c2 < box.c1).map(b => b.c2 + 1));
      const hi = Math.min(lastCol, ...others.filter(b => b.c1 > box.c2).map(b => b.c1 - 1));
      let c0 = box.c1, c1 = box.c2;
      for (let c = lo; c <= hi; c++) {
        const b = ws.getCell(box.r1, c).border || {};
        if (b.left && b.left.style && c < c0) c0 = c;
        if (b.right && b.right.style && c > c1) c1 = c;
      }
      return [c0, c1];
    };
    const rowRegions = r => {                       // 한 행을 병합 단위로 나눈다
      const out = [];
      for (let c = 1; c <= lastCol;) {
        const m = merges.find(x => x.r1 <= r && x.r2 >= r && x.c1 === c);
        const c2 = m ? Math.min(m.c2, lastCol) : c;
        out.push({ cols: [c, c2], text: textOf(ws.getCell(r, c).value) });
        c = c2 + 1;
      }
      return out;
    };
    // 사진칸(비어 있는 큰 병합)과 그 아래 위치·내용 항목표를 boundEnd 행까지 찾는다
    function findSlots(boundEnd) {
      const boxes = merges
        .filter(m => m.r1 >= blockStart && m.r2 <= boundEnd && m.c2 - m.c1 >= 2
                  && !textOf(ws.getCell(m.r1, m.c1).value).trim()
                  && (m.r2 - m.r1 >= 4 || heightOf(m) >= 100))
        .sort((a, b) => a.r1 - b.r1);
      // 같은 행 범위에 놓인 사진칸끼리 묶는다 (좌·우 배치)
      const groups = [];
      for (const b of boxes) {
        const g = groups.find(x => x.r1 === b.r1 && x.r2 === b.r2);
        if (g) g.boxes.push(b); else groups.push({ r1: b.r1, r2: b.r2, boxes: [b] });
      }
      groups.forEach(g => g.boxes.sort((a, b) => a.c1 - b.c1));
      const slots = [];
      groups.forEach((g, gi) => {
        const until = groups[gi + 1] ? groups[gi + 1].r1 - 1 : boundEnd;
        const lines = [];
        for (let r = g.r2 + 1; r <= until; r++) {
          const regions = rowRegions(r);
          if (regions.some(x => fieldOf(x.text))) lines.push({ row: r, regions });
        }
        for (const box of g.boxes) {
          const [bc0, bc1] = boxCols(box, g.boxes);
          const tableRows = [];
          for (const line of lines) {
            const cells = [];
            let pending = null;
            for (const x of line.regions) {
              if (x.cols[1] < bc0 || x.cols[0] > bc1) continue;    // 이 사진칸의 열 범위만
              const f = fieldOf(x.text);
              if (f) { cells.push({ cols: x.cols, label: x.text }); pending = f; }
              else if (pending) { cells.push({ cols: x.cols, field: pending }); pending = null; }
              else cells.push({ cols: x.cols });
            }
            if (cells.length) tableRows.push({ row: line.row, cells });
          }
          if (tableRows.length) slots.push({ box: { rows: [box.r1, box.r2], cols: [bc0, bc1] }, rows: tableRows });
        }
      });
      return { boxes, slots };
    }

    // 2) 1페이지 행 수: 같은 제목이 다시 나오는 간격.
    // 제목이 한 번만 나오는 양식(대부분의 새 업로드)은 사진칸·항목표가 끝나는 곳까지를 한 블록으로 본다.
    const same = titles.filter(t => textOf(ws.getCell(t.r1, t.c1).value) === titleText).map(t => t.r1);
    let block = opt.block || (same.length > 1 ? same[1] - same[0] : 0);
    if (!block) {
      const probe = findSlots(blockStart + 500);
      // 사진칸이 일정한 간격으로 3번 이상 반복되면, 한 시트 안에 여러 페이지 분량이
      // 이어 붙어 있는 것이다 (예: 몇 달치 사진대지를 한 시트에 쭉 이어 만든 파일).
      // 이때는 시트 전체가 아니라 그 반복 간격 하나를 한 페이지(블록)로 본다.
      const groupRows = [...new Set(probe.boxes.map(b => b.r1))].sort((a, b) => a - b);
      const deltas = groupRows.slice(1).map((r, i) => r - groupRows[i]);
      const period = deltas[0];
      if (groupRows.length >= 3 && deltas.every(d => d === period)) {
        const firstGroupSlots = probe.slots.filter(s => s.box.rows[0] === groupRows[0]);
        const lastRow = firstGroupSlots.reduce((m, s) => Math.max(m, ...s.rows.map(r => r.row)), groupRows[0]);
        if (lastRow - period + 1 > 0) {
          block = period;
          if (!opt.blockstart) blockStart = lastRow - period + 1;
        }
      }
      if (!block) {
        const last = probe.slots.reduce((m, s) => Math.max(m, s.box.rows[1], ...s.rows.map(r => r.row)), 0);
        if (last > blockStart) block = last - blockStart + 1;
      }
    }
    if (!block) throw new Error('1페이지 행 수를 찾지 못했습니다. --block 30 처럼 지정해 주세요.');
    const blockEnd = blockStart + block - 1;
    const titleInBlock = title.r1 >= blockStart;

    // 3) 열 너비 · 행 높이
    const cols = [];
    for (let c = 1; c <= lastCol; c++) cols.push(ws.getColumn(c).width || 8.43);

    // 열 너비 → 픽셀 환산값은 기본 글꼴에 따라 7 또는 8이다.
    // 양식은 인쇄 폭에 맞춰 만들어지므로, 인쇄 가능 폭 안에 들어오는 큰 값을 고른다.
    const mg = (ws.pageSetup && ws.pageSetup.margins) || {};
    const printIn = 8.2677 - ((mg.left != null ? mg.left : 0.7) + (mg.right != null ? mg.right : 0.7));
    const widthIn = px => cols.reduce((t, w) => t + Math.round(w * px + 5), 0) / 96;
    const pxPerChar = opt.px || (widthIn(8) <= printIn + 0.02 ? 8 : 7);
    const rows = [];
    for (let r = 1; r <= blockEnd; r++) rows.push(ws.getRow(r).height || 16.5);

    // 문서 머리글 (블록 위쪽 행들 — 첫 장에만 나온다)
    let header = null;
    if (blockStart > 1) {
      const cells = [];
      for (let r = 1; r < blockStart; r++) {
        for (let c = 1; c <= lastCol; c++) {
          // 병합된 칸은 왼쪽 위 한 번만 (그렇지 않으면 같은 글자가 열마다 겹쳐 그려진다)
          const inside = merges.find(x => x.r1 <= r && x.r2 >= r && x.c1 <= c && x.c2 >= c);
          if (inside && !(inside.r1 === r && inside.c1 === c)) continue;
          const t = textOf(ws.getCell(r, c).value);
          if (!t.trim() || /현장명|공사명/.test(t)) continue;
          const al = (ws.getCell(r, c).alignment || {}).horizontal;
          cells.push({ row: r, cols: [c, inside ? Math.min(inside.c2, lastCol) : c], text: t,
                       align: al === 'center' ? 'center' : 'left',
                       size: ws.getCell(r, c).font?.size || 11, bold: !!(ws.getCell(r, c).font || {}).bold });
        }
      }
      header = { rows: [1, blockStart - 1], cells };
    }

    // 4) 현장명 행
    let site = null;
    for (let r = 1; r <= blockEnd; r++) {
      const t = textOf(ws.getCell(r, 1).value);
      if (/현장명|공사명/.test(t)) {
        const m = /^([^:：]*[:：]\s*)/.exec(t);
        site = { row: r, col: 1, prefix: m ? m[1] : t + ' : ', size: ws.getCell(r, 1).font?.size || 11 };
        break;
      }
    }

    // 5) 사진칸과 그 아래 항목 표 — block 크기가 확정된 최종 범위로 다시 찾는다
    const { boxes, slots } = findSlots(blockEnd);
    if (!boxes.length) throw new Error('사진칸(큰 병합 영역)을 찾지 못했습니다.');
    if (!slots.length) throw new Error('위치·내용 항목칸을 찾지 못했습니다.');

    const label = slots[0].rows[0].cells.find(c => c.label);
    const m = ws.pageSetup && ws.pageSetup.margins;

    // 한 장에 블록이 몇 개 들어가는지 (첫 장은 머리글만큼 덜 들어간다)
    const sum = (a, b) => rows.slice(a - 1, b).reduce((t, h) => t + h, 0);
    const headerH = blockStart > 1 ? sum(1, blockStart - 1) : 0;
    const blockH = sum(blockStart, blockEnd);
    const printH = (11.6929 - ((m && m.top != null ? m.top : 0.75) + (m && m.bottom != null ? m.bottom : 0.75))) * 72;
    const blocksPerPage = Math.max(1, Math.floor(printH / blockH));
    const firstPageBlocks = Math.max(1, Math.floor((printH - headerH) / blockH));
    const dynamic = new Set();
    for (const slot of slots) for (const line of slot.rows) for (const cell of line.cells)
      if (cell.field) dynamic.add(`${line.row}:${cell.cols[0]}`);
    if (site) dynamic.add(`${site.row}:${site.col}`);
    return {
      id: opt.id,
      name: opt.name,
      template: opt.template || '',
      sheet: ws.name,
      block,
      blockStart,
      header,
      perPage: slots.length,
      blocksPerPage, firstPageBlocks,
      pxPerChar,
      cols, rows,
      margins: { lr: m ? m.left : 0.7086614, tb: m ? m.top : 0.7480315 },
      title: titleInBlock ? { row: title.r1, cols: [title.c1, title.c2], text: titleText,
               size: ws.getCell(title.r1, title.c1).font?.size || 20,
               bold: !!(ws.getCell(title.r1, title.c1).font || {}).bold } : null,
      site,
      photoInset: opt.inset || 12,
      tableSize: (label && ws.getCell(slots[0].rows[0].row, label.cols[0]).font?.size) || 11,
      templateCells: templateCells(ws, merges, lastCol, blockEnd, dynamic),
      slots,
    };
  });
}

function main() {
  const args = process.argv.slice(2);
  const file = args[0];
  if (!file) {
    console.error('사용법: node tools/add-form.js <양식.xlsx> --name "표시 이름" [--id 아이디] [--block 30] [--dry]');
    process.exit(1);
  }
  const opt = { dry: args.includes('--dry') };
  for (const k of ['name', 'id', 'block', 'px', 'inset', 'sheet', 'start', 'blockstart']) {
    const i = args.indexOf('--' + k);
    if (i >= 0) opt[k] = ['block', 'px', 'inset', 'start', 'blockstart'].includes(k) ? +args[i + 1] : args[i + 1];
  }
  opt.id = opt.id || path.basename(file, '.xlsx').replace(/[^a-zA-Z0-9_-]/g, '') || 'form';
  opt.name = opt.name || path.basename(file, '.xlsx');

  analyze(file, opt).then(def => {
    console.log(`양식: ${def.name} (${def.id})`);
    console.log(`  제목      : ${def.title ? `"${def.title.text}" (${def.title.size}pt)` : '머리글에 포함'}`);
    console.log(`  현장명 행  : ${def.site ? def.site.row + '행 "' + def.site.prefix + '"' : '없음'}`);
    console.log(`  시트      : ${def.sheet}`);
    console.log(`  한 장에    : 사진 ${def.perPage * def.firstPageBlocks}장 (2장부터 ${def.perPage * def.blocksPerPage}장)`);
    console.log(`  블록      : ${def.blockStart}행부터 ${def.block}행, 사진 ${def.perPage}장` +
                (def.header ? ` (머리글 ${def.header.rows[0]}~${def.header.rows[1]}행)` : ''));
    console.log(`  표 너비    : A~${colName(def.cols.length)}열`);
    def.slots.forEach((s, i) => {
      const items = s.rows.flatMap(r => r.cells.filter(c => c.field).map(c => c.field));
      console.log(`  사진 ${i + 1}칸  : ${s.box.rows[0]}~${s.box.rows[1]}행 / ${colName(s.box.cols[0])}~${colName(s.box.cols[1])}열` +
                  `, 항목 ${s.rows.map(r => r.row).join(',')}행 [${items.join(', ')}]`);
    });

    if (opt.dry) { console.log('\n--dry 이므로 등록하지 않았습니다.'); return; }
    const p = path.join(DIR, 'forms.json');
    const list = JSON.parse(fs.readFileSync(p, 'utf8'));
    const at = list.findIndex(f => f.id === def.id);
    if (at >= 0) list[at] = def; else list.push(def);
    fs.writeFileSync(p, JSON.stringify(list, null, 2) + '\n');
    console.log(`\n${at >= 0 ? '갱신' : '등록'} 완료 → templates/forms.json (총 ${list.length}개)`);
  }).catch(e => { console.error('실패:', e.message); process.exit(1); });
}

if (require.main === module) main();
module.exports = { analyze, analyzeBuffer };
