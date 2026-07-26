/** 사진대지 xlsx 생성: 양식(template.xlsx)에 사진을 그대로 삽입. */
const ExcelJS = require('exceljs');
const path = require('path');

const BLOCK = 30;                          // 1페이지 = 30행
const BOX = [[4, 13], [18, 27]];           // 사진박스 (시작행, 끝행) · B~H열
const INF = [[15, 16], [29, 30]];          // [위치/일자 행, 내용/비고 행]
const PHOTO_COLS = [2, 8];                 // B~H
const DEFAULT_COL_W = 8.43;

// 페이지 블록 내 병합 (행1,열1,행2,열2)
const MERGES = [
  [1, 1, 1, 9], [4, 2, 13, 8], [18, 2, 27, 8],
  [15, 1, 15, 2], [15, 3, 15, 5], [15, 7, 15, 9],
  [16, 1, 16, 2], [16, 3, 16, 5], [16, 7, 16, 9],
  [29, 1, 29, 2], [29, 3, 29, 5], [29, 7, 29, 9],
  [30, 1, 30, 2], [30, 3, 30, 5], [30, 7, 30, 9],
];

const EMU = 9525;                          // 1px(96dpi) = 9525 EMU
const colPx = (ws, c) => Math.round((ws.getColumn(c).width || DEFAULT_COL_W) * 7 + 5);
const rowPx = (ws, r) => (ws.getRow(r).height || 16.5) * 4 / 3;

/** 3페이지 이상은 1페이지 블록을 복제 (양식에는 2페이지까지 있음) */
function clonePage(ws, pageIndex) {
  const off = pageIndex * BLOCK;
  for (let r = 1; r <= BLOCK; r++) {
    const src = ws.getRow(r), dst = ws.getRow(r + off);
    dst.height = src.height;
    for (let c = 1; c <= 11; c++) {
      const sc = src.getCell(c), dc = dst.getCell(c);
      dc.style = JSON.parse(JSON.stringify(sc.style || {}));
      // 값은 정적 텍스트(제목·현장명·항목명)만 복사, 나머지는 비움
      dc.value = (typeof sc.value === 'string') ? sc.value : null;
    }
    dst.commit && dst.commit();
  }
  for (const [r1, c1, r2, c2] of MERGES) {
    ws.mergeCells(r1 + off, c1, r2 + off, c2);
  }
}

/**
 * @param {{site?:string, date?:string, items:Array<{loc?:string,memo?:string,bigo?:string,data:string,w:number,h:number}>}} input
 *   data = base64 JPEG (헤더 없음), w/h = 사진 픽셀 크기
 * @returns {Promise<Buffer>}
 */
async function buildXlsx(input) {
  const items = input.items || [];
  if (!items.length) throw new Error('사진이 없습니다.');

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(__dirname, '..', 'templates', 'template.xlsx'));
  const ws = wb.worksheets[0];

  const pages = Math.ceil(items.length / 2);
  for (let p = 2; p < pages; p++) clonePage(ws, p);

  if (input.site) {
    for (let p = 0; p < pages; p++) {
      ws.getCell(p * BLOCK + 2, 1).value = '현장명 : ' + input.site;
    }
  }

  const dateText = formatDate(input.date);
  const slots = Math.max(pages, 2) * 2;
  for (let i = 0; i < slots; i++) {
    const p = Math.floor(i / 2), s = i % 2, base = p * BLOCK;
    const [rInfo, rMemo] = INF[s];
    const it = items[i];
    ws.getCell(base + rInfo, 3).value = it ? (it.loc || null) : null;   // 위치
    ws.getCell(base + rInfo, 7).value = it ? dateText : null;           // 일자
    ws.getCell(base + rMemo, 3).value = it ? (it.memo || null) : null;  // 내용
    ws.getCell(base + rMemo, 7).value = it ? (it.bigo || null) : null;  // 비고
    if (!it) continue;

    const [top, bot] = BOX[s];
    let boxW = 0;
    for (let c = PHOTO_COLS[0]; c <= PHOTO_COLS[1]; c++) boxW += colPx(ws, c);
    let boxH = 0;
    for (let r = top; r <= bot; r++) boxH += rowPx(ws, base + r);

    const scale = Math.min((boxW - 6) / it.w, (boxH - 6) / it.h);
    const w = Math.round(it.w * scale), h = Math.round(it.h * scale);
    const xOff = Math.round((boxW - w) / 2), yOff = Math.round((boxH - h) / 2);  // 가운데 정렬

    // ExcelJS의 소수 좌표는 오차가 크므로 EMU 오프셋을 직접 지정
    const id = wb.addImage({ base64: it.data, extension: 'jpeg' });
    ws.addImage(id, {
      tl: {
        nativeCol: PHOTO_COLS[0] - 1, nativeColOff: xOff * EMU,
        nativeRow: base + top - 1, nativeRowOff: yOff * EMU,
      },
      ext: { width: w, height: h },
      editAs: 'oneCell',
    });
  }

  const rows = pages * BLOCK;
  ws.pageSetup = Object.assign({}, ws.pageSetup, {
    printArea: `A1:I${rows}`,
    orientation: 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 1,
  });
  for (let p = 1; p < pages; p++) ws.getRow(p * BLOCK).addPageBreak();

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** 'YYYY-MM-DD' → 'YYYY년 M월 D일' (시간대 영향 없이 문자열로 처리) */
function formatDate(iso) {
  const s = /^\d{4}-\d{2}-\d{2}$/.test(iso || '')
    ? iso
    : new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);   // KST 기준 오늘
  const [y, m, d] = s.split('-');
  return `${+y}년 ${+m}월 ${+d}일`;
}

module.exports = { buildXlsx, formatDate };
