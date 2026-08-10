/** 사진대지 xlsx 생성: 양식 파일에 사진을 그대로 삽입.
 *  양식마다 다른 칸 위치는 templates/forms.json 에 정의되어 있다. */
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

// ExcelJS는 sheetPr 안의 요소를 규격과 다른 순서(tabColor→pageSetUpPr→outlinePr)로 쓴다.
// 엑셀은 순서를 엄격히 보므로 '손상된 파일'로 판정한다 → 규격 순서로 바로잡는다.
const SheetPropertiesXform = require('exceljs/lib/xlsx/xform/sheet/sheet-properties-xform');
SheetPropertiesXform.prototype.render = function (xmlStream, model) {
  if (!model) return;
  xmlStream.addRollback();
  xmlStream.openNode('sheetPr');
  let inner = false;
  inner = this.map.tabColor.render(xmlStream, model.tabColor) || inner;
  inner = this.map.outlinePr.render(xmlStream, model.outlineProperties) || inner;
  inner = this.map.pageSetUpPr.render(xmlStream, model.pageSetup) || inner;
  if (inner) { xmlStream.closeNode(); xmlStream.commit(); } else { xmlStream.rollback(); }
};

const DIR = path.join(__dirname, '..', 'templates');
const EMU = 9525;                          // 1px(96dpi) = 9525 EMU
const DEFAULT_COL_W = 8.43;

const forms = () => JSON.parse(fs.readFileSync(path.join(DIR, 'forms.json'), 'utf8'));
const findForm = id => {
  const list = forms();
  return list.find(f => f.id === id) || list[0];
};

const colPx = (ws, c, form) =>
  Math.round((ws.getColumn(c).width || DEFAULT_COL_W) * (form.pxPerChar || 8) + 5);
const rowPx = (ws, r) => (ws.getRow(r).height || 16.5) * 4 / 3;

const A = 'A'.charCodeAt(0);
const colNum = s => [...s].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - A + 1), 0);
const colName = n => { let s = ''; while (n > 0) { s = String.fromCharCode(A + (n - 1) % 26) + s; n = Math.floor((n - 1) / 26); } return s; };

const cellText = (ws, r, c) => {
  const v = ws.getCell(r, c).value;
  return (v && typeof v === 'object' && v.richText) ? v.richText.map(x => x.text).join('')
       : (v == null ? '' : String(v));
};

/** 양식 1페이지 안의 병합 목록 (페이지를 늘릴 때 그대로 복제) */
function blockMerges(ws, blockStart, block) {
  const end = blockStart + block - 1, out = [];
  for (const m of (ws.model.merges || [])) {
    const p = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(m);
    if (!p) continue;
    const r1 = +p[2], r2 = +p[4];
    if (r1 >= blockStart && r2 <= end) out.push([r1, colNum(p[1]), r2, colNum(p[3])]);
  }
  return out;
}

/** 사진칸에 이미 박혀 있던 사진을 걷어낸다.
 *  사용자가 올리는 '양식'은 빈 서식이 아니라 지난달에 다 작성한 보고서인 경우가 많다.
 *  그대로 두면 옛 사진 위에 새 사진이 겹쳐 찍힌다. 머리글의 회사 로고 같은 그림은 남긴다. */
function clearPhotoBoxImages(ws, form) {
  const bs = form.blockStart || 1, blk = form.block;
  const inBox = row => {
    if (row < bs) return false;                       // 머리글 (로고 자리)
    const rel = ((row - bs) % blk) + bs;              // 몇 번째 블록이든 같은 자리로 접어서 본다
    return form.slots.some(s => rel >= s.box.rows[0] && rel <= s.box.rows[1]);
  };
  // getImages() 는 _media 안의 객체를 그대로 돌려주므로 그 자체로 가려낼 수 있다
  const keep = new Set((ws.getImages() || []).filter(im => {
    const r1 = im.range.tl.nativeRow + 1;
    const r2 = im.range.br ? im.range.br.nativeRow + 1 : r1;
    for (let r = r1; r <= r2; r++) if (inBox(r)) return false;
    return true;
  }));
  ws._media = (ws._media || []).filter(m => m.type !== 'image' || keep.has(m));
}

/** 어느 시트도 더는 쓰지 않는 그림의 '알맹이'를 통합문서에서 버린다.
 *  자리만 치우면 사진 알맹이는 파일 안에 그대로 남는다 — 지난달 사진 8장이 3MB 를 차지한 적이 있다.
 *  (남의 현장 사진이 파일 속에 딸려 가고, 카톡으로 보내기도 무거워진다) */
function dropUnusedMedia(wb) {
  const used = new Set();
  wb.eachSheet(s => (s._media || []).forEach(m => used.add(Number(m.imageId))));
  if (used.size === (wb.media || []).length) return;          // 버릴 게 없다
  const at = new Map();                                        // 옛 번호 → 새 번호
  const kept = [];
  (wb.media || []).forEach((m, i) => { if (used.has(i)) { at.set(i, kept.length); kept.push(m); } });
  wb.eachSheet(s => (s._media || []).forEach(m => { m.imageId = at.get(Number(m.imageId)); }));
  wb.media = kept;
}

/** 다른 통합문서를 가리키는 '이름'을 버린다.
 *  ExcelJS 는 외부 링크(externalLinks)를 읽지 않고 버리면서, 그 링크를 번호로 가리키는
 *  정의된 이름('[7]TOT'!$H$55 같은 것)은 그대로 남긴다. 가리킬 곳이 없어진 이름이 하나라도
 *  있으면 엑셀은 파일을 아예 열지 못한다 — 회사 양식에는 이런 이름이 수십 개씩 들어 있다. */
function dropExternalNames(wb) {
  const m = wb.definedNames.model || [];
  const kept = m.filter(d => !(d.ranges || []).some(r => /\[\d+\]/.test(r)));
  if (kept.length !== m.length) wb.definedNames.model = kept;
}

/** 올린 양식에서 지난달 사진을 걷어낸 '빈 양식' 을 만들어 돌려준다.
 *  앱은 이 깨끗한 파일을 저장해 두고 매번 서버로 보낸다 (원본을 그대로 두면
 *  지난달 사진 몇 MB 를 내보낼 때마다 실어 나르게 된다). */
async function stripPhotos(buf, form) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = (form.sheet && wb.getWorksheet(form.sheet)) || wb.worksheets[0];
  const before = (ws.getImages() || []).length;
  clearPhotoBoxImages(ws, form);
  dropUnusedMedia(wb);
  dropExternalNames(wb);
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()),
           removed: before - (ws.getImages() || []).length };
}

/** 실제로 쓰는 범위 밖에 원본 양식 파일에 남아 있던 여분 내용을 지운다.
 *  사람이 만든 원본 엑셀에는 예비로 만들어 둔 페이지가 그대로 남아 있는 경우가 흔하다
 *  (실제 현장 이름까지 박힌 채로). 사진이 적어 그 자리까지 안 채워지면 그 여분 페이지가
 *  그대로 파일에 남아, 인쇄 미리보기에는 안 보이지만 엑셀을 스크롤하면 이상한 선·글자로 보인다. */
function trimBeyond(ws, lastRow, lastCol) {
  const maxRow = Math.max(lastRow, ws.rowCount || 0, ws.actualRowCount || 0);
  if (maxRow <= lastRow) return;
  for (const m of [...(ws.model.merges || [])]) {
    const p = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(m);
    if (p && +p[2] > lastRow) { try { ws.unMergeCells(m); } catch (e) { /* 무시 */ } }
  }
  // 셀 값·서식만 비우면 '한 번 손댄 칸'으로 남아 엑셀이 그 자리까지 계속 사용 범위로 본다.
  // ws.spliceRows 는 뒤에 옮겨올 행이 없는(시트 맨 끝까지 지우는) 경우 아무 일도 안 하는
  // 버그가 있어서, 내부 행 배열을 직접 잘라낸다 (사진은 전부 이보다 위쪽에 있으니 안전하다).
  ws._rows.length = Math.min(ws._rows.length, lastRow);
}

/** LibreOffice 가 엑셀과 다르게 그리는 부분을, 엑셀이 그리는 모양과 같아지도록 바꾼다.
 *  변환 서버에 보낼 사본에만 쓴다 — 사용자가 내려받는 엑셀 파일은 원본 그대로 둔다.
 *
 *  1) 열 너비: 엑셀은 열 너비를 '기본 글꼴의 숫자 폭' 단위로 저장한다. Carlito(=Calibri)를
 *     넣어 글꼴은 맞췄지만 두 프로그램의 환산식이 달라, 실측하면 LibreOffice 표가 10%
 *     좁게 나온다 (인쇄 배율을 꺼도 같은 비율이므로 배율 문제가 아니라 환산 문제다).
 *     칸마다 붙는 여백(+5px)은 그대로 두고 너비만 곱해 주면 두 환산식이 일치한다.
 *  2) 균등 분할: 엑셀은 마지막 줄을 펼치지 않으므로(justifyLastLine 기본값 거짓) 한 줄짜리
 *     '일 자', '비 고' 라벨을 가운데로 그린다. LibreOffice 는 칸 좌우 끝까지 벌려 자간이
 *     벌어져 보인다. 여러 줄로 접히는 칸은 엑셀도 펼치므로 건드리지 않는다.
 *  3) 행 높이: 가로선 위치를 한 줄씩 재어 보면 LibreOffice 의 행이 엑셀보다 2% 씩 짧다.
 *     이 양식들의 행 높이는 36.75, 9.75 처럼 소수인데 LibreOffice 는 정수로 끊어 버려
 *     매 행 조금씩 잃고 그게 쌓인다. 아래로 갈수록 벌어져 한 장 끝에서 0.13인치쯤 밀리고,
 *     사진은 칸에서 정해진 거리(EMU)로 붙어 있으므로 칸 선과 어긋나 흰 틈이 생긴다
 *     ("선이 끊겨 보인다"는 신고). 정수로 반올림해 봤지만 더 나빠져(0.976) 원인은 단순
 *     절삭이 아니었고, 결국 실측으로 계수를 잡았다. 높이를 2% 늘리면 결과는 1% 만 늘어나
 *     반응이 절반이므로 4% 를 넣어야 2% 가 메워진다. 다만 양식마다 조금씩 달라
 *     4.12% 는 어떤 양식에서 1.9% 넘쳤고, 3.1% 가 네 양식 모두 ±1% 안에 들었다. */
const COL_WIDTH_FIX = Number(process.env.LO_COL_WIDTH_FIX || 1.109);    // Calibri 11pt 기준 실측값
const ROW_HEIGHT_FIX = Number(process.env.LO_ROW_HEIGHT_FIX || 1.031); // 실측: 넣은 값의 절반만 반영된다

function normalizeForLibreOffice(ws) {
  ws.columns.forEach(c => { if (c.width) c.width = c.width * COL_WIDTH_FIX; });
  ws.eachRow({ includeEmpty: true }, row => {
    if (row.height) row.height = row.height * ROW_HEIGHT_FIX;
    row.eachCell({ includeEmpty: true }, cell => {
      const a = cell.alignment;
      if (!a || a.horizontal !== 'distributed' || a.wrapText) return;
      cell.alignment = Object.assign({}, a, { horizontal: 'center' });
    });
  });
}

/** 페이지가 모자라면 1페이지 블록을 복제해서 늘린다 */
function clonePage(ws, form, merges, pageIndex) {
  const off = pageIndex * form.block, bs = form.blockStart || 1;
  const from = bs + off, to = from + form.block - 1;
  for (const m of [...(ws.model.merges || [])]) {          // 그 자리에 있던 병합 해제
    const p = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(m);
    if (p && +p[2] >= from && +p[4] <= to) { try { ws.unMergeCells(m); } catch (e) { /* 무시 */ } }
  }
  for (let r = bs; r <= bs + form.block - 1; r++) {
    const src = ws.getRow(r), dst = ws.getRow(r + off);
    dst.height = src.height;
    dst.hidden = !!src.hidden;          // 원본에서 숨겨둔 행일 수 있으므로 상태까지 맞춘다
    for (let c = 1; c <= form.cols.length + 2; c++) {
      const sc = src.getCell(c), dc = dst.getCell(c);
      dc.style = JSON.parse(JSON.stringify(sc.style || {}));
      dc.value = (typeof sc.value === 'string') ? sc.value : null;   // 제목·항목명만 복사
    }
    dst.commit && dst.commit();
  }
  for (const [r1, c1, r2, c2] of merges) ws.mergeCells(r1 + off, c1, r2 + off, c2);
}

/**
 * @param {{form?:string, site?:string, date?:string,
 *          items:Array<{loc?:string,memo?:string,bigo?:string,data:string,w:number,h:number}>}} input
 * @returns {Promise<Buffer>}
 */
async function buildXlsx(input) {
  const items = input.items || [];
  if (!items.length) throw new Error('사진이 없습니다.');
  // 앱에서 직접 추가한 양식이면 정의와 양식 파일이 함께 넘어온다
  const form = input.formDef || findForm(input.form);

  const wb = new ExcelJS.Workbook();
  if (input.template) await wb.xlsx.load(Buffer.from(input.template, 'base64'));
  else await wb.xlsx.readFile(path.join(DIR, form.template));
  const ws = (form.sheet && wb.getWorksheet(form.sheet)) || wb.worksheets[0];

  clearPhotoBoxImages(ws, form);        // 양식에 남아 있던 지난달 사진을 걷어내고
  dropUnusedMedia(wb);                  // 그 알맹이까지 버린다 (새 사진을 넣기 전에)
  dropExternalNames(wb);                // 가리킬 곳 없어진 이름을 버린다 (엑셀이 파일을 거부한다)

  const bs = form.blockStart || 1;
  const merges = blockMerges(ws, bs, form.block);
  const blocks = Math.ceil(items.length / form.perPage);      // 사진칸 묶음 수
  const bpp = form.blocksPerPage || 1, fpb = form.firstPageBlocks || bpp;

  // 블록을 필요한 만큼 복제한다 (양식에 다른 형태의 페이지가 섞여 있어도 첫 블록 기준으로 통일)
  for (let p = 1; p < blocks; p++) clonePage(ws, form, merges, p);

  const slots = blocks * form.perPage;
  for (let i = 0; i < slots; i++) {
    const p = Math.floor(i / form.perPage), s = i % form.perPage, base = p * form.block;
    const slot = form.slots[s];
    const it = items[i];
    const val = Object.assign({}, it && it.fields, {
      date: it ? formatDate((it.fields && it.fields.date) || input.date) : null,
    });

    for (const line of slot.rows) {
      for (const cell of line.cells) {
        if (!cell.field) continue;
        ws.getCell(base + line.row, cell.cols[0]).value =
          (val[cell.field] === undefined || val[cell.field] === '') ? null : val[cell.field];
      }
    }
    if (!it) continue;

    const [c0, c1] = slot.box.cols, [r0, r1] = slot.box.rows;
    let boxW = 0;
    for (let c = c0; c <= c1; c++) boxW += colPx(ws, c, form);
    let boxH = 0;
    for (let r = r0; r <= r1; r++) boxH += rowPx(ws, base + r);

    const pad = form.photoInset || 0;
    const scale = Math.min((boxW - pad * 2) / it.w, (boxH - pad * 2) / it.h);
    const w = Math.round(it.w * scale), h = Math.round(it.h * scale);
    const xOff = Math.round((boxW - w) / 2), yOff = Math.round((boxH - h) / 2);   // 가운데 정렬

    // 오프셋은 그 칸(열/행) 안에 들어가야 한다. 넘치면 다음 칸으로 넘겨 잡는다
    // (한 열에 몰아 넣으면 프로그램에 따라 사진이 왼쪽으로 치우친다)
    let ac = c0, ax = xOff;
    while (ac < c1 && ax >= colPx(ws, ac, form)) { ax -= colPx(ws, ac, form); ac++; }
    let ar = r0, ay = yOff;
    while (ar < r1 && ay >= rowPx(ws, base + ar)) { ay -= rowPx(ws, base + ar); ar++; }

    // 오른쪽 아래 모서리까지 칸 좌표로 지정한다 (프로그램마다 크기를 달리 그리는 것을 막는다)
    let bc = c0, bx = xOff + w;
    while (bc < c1 && bx >= colPx(ws, bc, form)) { bx -= colPx(ws, bc, form); bc++; }
    let br = r0, by = yOff + h;
    while (br < r1 && by >= rowPx(ws, base + br)) { by -= rowPx(ws, base + br); br++; }

    const id = wb.addImage({ base64: it.data, extension: 'jpeg' });
    ws.addImage(id, {
      tl: {
        nativeCol: ac - 1, nativeColOff: Math.round(ax * EMU),
        nativeRow: base + ar - 1, nativeRowOff: Math.round(ay * EMU),
      },
      br: {
        nativeCol: bc - 1, nativeColOff: Math.round(bx * EMU),
        nativeRow: base + br - 1, nativeRowOff: Math.round(by * EMU),
      },
      editAs: 'oneCell',
    });
  }

  if (input.site && form.site) {
    const text = (form.site.prefix || '') + input.site;
    if (form.site.row < bs) {                       // 문서 머리글에 있으면 맨 위 한 번만
      ws.getCell(form.site.row, form.site.col).value = text;
    } else {
      for (let p = 0; p < blocks; p++) ws.getCell(p * form.block + form.site.row, form.site.col).value = text;
    }
  }

  const rows = bs - 1 + blocks * form.block;
  const lastCol = colName(form.cols.length);

  trimBeyond(ws, rows, form.cols.length + 2);   // 여분 페이지 등 안 쓰는 부분 정리

  ws.pageSetup = Object.assign({}, ws.pageSetup, {
    // 열 앞의 $ 는 ExcelJS가 붙인다. 여기서 붙이면 '$$A$1' 이 되어 파일이 손상된다.
    printArea: `A$1:${lastCol}$${rows}`,
    orientation: 'portrait',
    paperSize: 9,                                     // A4 고정 — 안 적으면 프로그램마다 Letter 로 잡아 배율이 달라진다
    fitToPage: true, fitToWidth: 1, fitToHeight: 0,   // 가로만 맞추고 세로는 여러 장
  });
  // 마지막 열 번호를 직접 넘긴다 (기본값 16838은 엑셀 최대 열 16383을 넘어 파일 손상으로 판정된다)
  for (let b = fpb; b < blocks; b += bpp) ws.getRow(bs - 1 + b * form.block).addPageBreak(0, 16384);

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

module.exports = { buildXlsx, formatDate, forms, stripPhotos, normalizeForLibreOffice };
