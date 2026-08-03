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
const textOf = v => (v && typeof v === 'object' && v.richText)
  ? v.richText.map(r => r.text).join('') : (v == null ? '' : String(v));

function parseMerges(ws) {
  return (ws.model.merges || []).map(m => {
    const p = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(m);
    return p ? { r1: +p[2], c1: colNum(p[1]), r2: +p[4], c2: colNum(p[3]) } : null;
  }).filter(Boolean);
}

function analyze(file, opt) {
  return new ExcelJS.Workbook().xlsx.readFile(file).then(wb => {
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
    const blockStart = title.r1;

    // 2) 1페이지 행 수: 같은 제목이 다시 나오는 간격
    const same = titles.filter(t => textOf(ws.getCell(t.r1, t.c1).value) === titleText).map(t => t.r1);
    let block = opt.block || (same.length > 1 ? same[1] - same[0] : 0);
    if (!block) throw new Error('1페이지 행 수를 찾지 못했습니다. --block 30 처럼 지정해 주세요.');
    const blockEnd = blockStart + block - 1;

    // 3) 열 너비 · 행 높이
    const cols = [];
    for (let c = 1; c <= lastCol; c++) cols.push(ws.getColumn(c).width || 8.43);
    const rows = [];
    for (let r = 1; r <= blockEnd; r++) rows.push(ws.getRow(r).height || 16.5);

    // 문서 머리글 (블록 위쪽 행들 — 첫 장에만 나온다)
    let header = null;
    if (blockStart > 1) {
      const cells = [];
      for (let r = 1; r < blockStart; r++) {
        for (let c = 1; c <= lastCol; c++) {
          const t = textOf(ws.getCell(r, c).value);
          if (!t.trim() || /현장명|공사명/.test(t)) continue;
          const m = merges.find(x => x.r1 === r && x.c1 === c);
          cells.push({ row: r, cols: [c, m ? Math.min(m.c2, lastCol) : c], text: t,
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

    // 5) 사진칸: 블록 안의 '비어 있는 큰 병합' (여러 행짜리 또는 한 행이 아주 높은 것)
    const heightOf = m => { let h = 0; for (let r = m.r1; r <= m.r2; r++) h += ws.getRow(r).height || 16.5; return h; };
    const boxes = merges
      .filter(m => m.r1 >= blockStart && m.r2 <= blockEnd && m.c2 - m.c1 >= 2
                && !textOf(ws.getCell(m.r1, m.c1).value).trim()
                && (m.r2 - m.r1 >= 4 || heightOf(m) >= 100))
      .sort((a, b) => a.r1 - b.r1);
    if (!boxes.length) throw new Error('사진칸(큰 병합 영역)을 찾지 못했습니다.');

    // 테두리는 병합보다 넓을 수 있다 → 위쪽 행에서 좌우 테두리 위치를 확인
    const boxCols = box => {
      let c0 = box.c1, c1 = box.c2;
      for (let c = 1; c <= lastCol; c++) {
        const b = ws.getCell(box.r1, c).border || {};
        if (b.left && b.left.style && c < c0) c0 = c;
        if (b.right && b.right.style && c > c1) c1 = c;
      }
      return [c0, c1];
    };

    // 6) 각 사진칸 아래의 항목 표
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

    const slots = boxes.map((box, i) => {
      const until = boxes[i + 1] ? boxes[i + 1].r1 - 1 : blockEnd;
      const tableRows = [];
      for (let r = box.r2 + 1; r <= until; r++) {
        const regions = rowRegions(r);
        if (!regions.some(g => fieldOf(g.text))) continue;      // 항목명이 없는 행은 건너뜀
        const cells = [];
        let pending = null;
        for (const g of regions) {
          const f = fieldOf(g.text);
          if (f) { cells.push({ cols: g.cols, label: g.text }); pending = f; }
          else if (pending) { cells.push({ cols: g.cols, field: pending }); pending = null; }
          else cells.push({ cols: g.cols });
        }
        tableRows.push({ row: r, cells });
      }
      return { box: { rows: [box.r1, box.r2], cols: boxCols(box) }, rows: tableRows };
    }).filter(s => s.rows.length);

    if (!slots.length) throw new Error('위치·내용 항목칸을 찾지 못했습니다.');

    const label = slots[0].rows[0].cells.find(c => c.label);
    const m = ws.pageSetup && ws.pageSetup.margins;
    return {
      id: opt.id,
      name: opt.name,
      template: path.basename(file),
      sheet: ws.name,
      block,
      blockStart,
      header,
      perPage: slots.length,
      pxPerChar: opt.px || 8,
      cols, rows,
      margins: { lr: m ? m.left : 0.7086614, tb: m ? m.top : 0.7480315 },
      title: { row: blockStart, cols: [title.c1, title.c2], text: titleText,
               size: ws.getCell(blockStart, title.c1).font?.size || 20,
               bold: !!(ws.getCell(blockStart, title.c1).font || {}).bold },
      site,
      photoInset: opt.inset || 12,
      tableSize: (label && ws.getCell(slots[0].rows[0].row, label.cols[0]).font?.size) || 11,
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
  for (const k of ['name', 'id', 'block', 'px', 'inset', 'sheet', 'start']) {
    const i = args.indexOf('--' + k);
    if (i >= 0) opt[k] = ['block', 'px', 'inset', 'start'].includes(k) ? +args[i + 1] : args[i + 1];
  }
  opt.id = opt.id || path.basename(file, '.xlsx').replace(/[^a-zA-Z0-9_-]/g, '') || 'form';
  opt.name = opt.name || path.basename(file, '.xlsx');

  analyze(file, opt).then(def => {
    console.log(`양식: ${def.name} (${def.id})`);
    console.log(`  제목      : "${def.title.text}"  (${def.title.size}pt${def.title.bold ? ' 굵게' : ''})`);
    console.log(`  현장명 행  : ${def.site ? def.site.row + '행 "' + def.site.prefix + '"' : '없음'}`);
    console.log(`  시트      : ${def.sheet}`);
    console.log(`  1페이지    : ${def.blockStart}행부터 ${def.block}행, 사진 ${def.perPage}장` +
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
module.exports = { analyze };
