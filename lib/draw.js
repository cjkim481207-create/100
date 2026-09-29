/* 사진대지 PDF — 서버용.
 * public/app.js 의 미리보기·PDF 그리기(drawPage/drawBlock/drawTemplateCells, pdfBytes)를
 * 같은 순서·같은 좌표 계산으로 옮겼다. 화면과 결과가 같아야 하므로 앱 쪽을 고치면 여기도 함께 고친다.
 * 차이: 글꼴. 서버에는 맑은 고딕·굴림이 없어 Noto Sans KR(OFL)을 쓴다 (안드로이드 폰의 기본 한글 글꼴과 같은 계열). */
const path = require('path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const { forms } = require('./build.js');

const FONT_DIR = path.join(__dirname, '..', 'fonts');
GlobalFonts.registerFromPath(path.join(FONT_DIR, 'NotoSansKR-Regular.ttf'), 'Noto Sans KR');
GlobalFonts.registerFromPath(path.join(FONT_DIR, 'NotoSansKR-Bold.ttf'), 'Noto Sans KR');
const F_TITLE = '"Noto Sans KR"';
const F_TABLE = '"Noto Sans KR"';
const DPI = 200;                 // 앱의 PDF와 같은 해상도
const JPEG_QUALITY = 92;         // 앱: canvas.toBlob(..., 0.92)

/** 양식 치수를 좌표로 (app.js useForm 과 같은 계산) */
function layout(form) {
  const colw = form.cols.map(w => w * (form.pxPerChar || 8) + 5);
  const X = [0, 0]; colw.forEach(w => X.push(X[X.length - 1] + w));
  const Y = [0]; form.rows.forEach(h => Y.push(Y[Y.length - 1] + h * 4 / 3));
  const blockStart = form.blockStart || 1;
  return { X, Y, SHEET_W: X[X.length - 1], blockStart, blockTop: Y[blockStart - 1] };
}

function pageCount(form, n) {
  const blocks = Math.ceil(n / form.perPage);
  const bpp = form.blocksPerPage || 1, fpb = form.firstPageBlocks || bpp;
  return blocks <= fpb ? Math.min(1, blocks) : 1 + Math.ceil((blocks - fpb) / bpp);
}

function fmtDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return '';
  const [y, m, d] = iso.split('-');
  return `${+y}년 ${+m}월 ${+d}일`;
}

function drawTemplateCells(g, L, cells, px, py, fs) {
  const { X, Y } = L;
  for (const cell of cells) {
    const x0 = px(X[cell.c]), x1 = px(X[cell.c2 + 1]);
    const y0 = py(Y[cell.r - 1]), y1 = py(Y[cell.r2]);
    if (cell.fill) { g.fillStyle = cell.fill; g.fillRect(x0, y0, x1 - x0, y1 - y0); }
    g.strokeStyle = '#000';
    for (const side of ['left', 'right', 'top', 'bottom']) {
      if (!cell.borders || !cell.borders[side]) continue;
      if (side === 'left') { g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0, y1); g.stroke(); }
      if (side === 'right') { g.beginPath(); g.moveTo(x1, y0); g.lineTo(x1, y1); g.stroke(); }
      if (side === 'top') { g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y0); g.stroke(); }
      if (side === 'bottom') { g.beginPath(); g.moveTo(x0, y1); g.lineTo(x1, y1); g.stroke(); }
    }
    if (!cell.text) continue;
    const font = cell.font || {};
    g.fillStyle = font.color || '#000';
    g.font = `${font.italic ? 'italic ' : ''}${font.bold ? 'bold ' : ''}${fs(font.size || 11)}px ${F_TITLE}`;
    const my = (y0 + y1) / 2;
    const mid = cell.align === 'center' || cell.align === 'centerContinuous' || cell.align === 'distributed';
    g.textAlign = mid ? 'center' : (cell.align === 'right' ? 'right' : 'left');
    const tx = mid ? (x0 + x1) / 2 : (cell.align === 'right' ? x1 - fs(2) : x0 + fs(2));
    g.fillText(cell.text, tx, my);
    if (font.underline) {
      const tw = g.measureText(cell.text).width;
      const ux = mid ? tx - tw / 2 : (cell.align === 'right' ? tx - tw : tx);
      g.beginPath(); g.moveTo(ux, my + fs((font.size || 11) * .48)); g.lineTo(ux + tw, my + fs((font.size || 11) * .48)); g.stroke();
    }
  }
  g.fillStyle = '#000'; g.strokeStyle = '#000';
}

function drawBlock(g, ctx, block, px, py, u, fs) {
  const { form, L, photos, date } = ctx;
  const { X, Y } = L;
  const last = X.length - 1;
  const styled = form.templateCells && form.templateCells.length;
  const t = form.title;
  if (t && !styled) {
    g.font = `${t.bold ? 'bold ' : ''}${fs(t.size || 20)}px ${F_TITLE}`;
    g.textAlign = 'center';
    g.fillText(t.text, px((X[t.cols[0]] + X[t.cols[1] + 1]) / 2), py((Y[t.row - 1] + Y[t.row]) / 2));
  }
  form.slots.forEach((slot, s) => {
    const it = photos[block * form.perPage + s];
    const val = Object.assign({}, it && it.fields, { date: it ? fmtDate((it.fields || {}).date || date) : '' });

    const [r0, r1] = slot.box.rows, [c0, c1] = slot.box.cols;
    const bx = px(X[c0]), by = py(Y[r0 - 1]);
    const bw = u(X[c1 + 1] - X[c0]), bh = u(Y[r1] - Y[r0 - 1]);
    if (!styled) g.strokeRect(bx, by, bw, bh);
    if (it) {
      const pad = u(form.photoInset || 0);
      const r = Math.min((bw - pad * 2) / it.w, (bh - pad * 2) / it.h);
      const w = it.w * r, h = it.h * r;
      g.drawImage(it.img, bx + (bw - w) / 2, by + (bh - h) / 2, w, h);
    }

    for (const line of slot.rows) {
      const y0 = py(Y[line.row - 1]), y1 = py(Y[line.row]);
      for (const cell of line.cells) {
        const x0 = px(X[cell.cols[0]]), x1 = px(X[Math.min(cell.cols[1] + 1, last)]);
        if (!styled) g.strokeRect(x0, y0, x1 - x0, y1 - y0);
        const text = (styled ? val[cell.field] : (cell.label || val[cell.field])) || '';
        if (!text) continue;
        let size = fs(form.tableSize || 11);
        g.font = `${size}px ${F_TABLE}`;
        const max = (x1 - x0) - fs(5);
        while (g.measureText(text).width > max && size > fs(5)) {
          size -= fs(0.4);
          g.font = `${size}px ${F_TABLE}`;
        }
        g.textAlign = 'center';
        g.fillText(text, (x0 + x1) / 2, (y0 + y1) / 2);
      }
    }
  });
}

/** A4 한 장 (app.js drawPage 와 같은 배치) */
function drawPage(ctx, page, dpi) {
  const { form, L, site, date } = ctx;
  const { X, Y, SHEET_W, blockStart, blockTop } = L;
  const W = Math.round(8.2677 * dpi), H = Math.round(11.6929 * dpi);
  const cv = createCanvas(W, H);
  const g = cv.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);

  const m = form.margins || { lr: 0.7, tb: 0.75 };
  const S = dpi / 72;
  const bpp = form.blocksPerPage || 1, fpb = form.firstPageBlocks || bpp;
  const BH = Y[Y.length - 1] - blockTop;
  const sheetW = SHEET_W * 0.75;
  const sheetH = Math.max(blockTop + fpb * BH, bpp * BH) * 0.75;
  const printW = (8.2677 - m.lr * 2) * 72, printH = (11.6929 - m.tb * 2) * 72;
  const k = Math.min(1, printW / sheetW, printH / sheetH);
  const ox = m.lr * 72 + (printW - sheetW * k) / 2, oy = m.tb * 72;

  const first = page === 0 ? 0 : fpb + (page - 1) * bpp;
  const nBlk = page === 0 ? fpb : bpp;
  let shift = 0;

  const u = v => v * 0.75 * k * S;
  const px = v => (ox * S) + u(v);
  const py = v => (oy * S) + u(v - (page === 0 ? 0 : blockTop) + shift);
  const fs = v => v * k * S;

  g.strokeStyle = '#000'; g.fillStyle = '#000';
  g.lineWidth = Math.max(1, 0.75 * k * S);
  g.textBaseline = 'middle';

  const styled = form.templateCells && form.templateCells.length;
  if (page === 0 && styled) drawTemplateCells(g, L, form.templateCells.filter(c => c.r < blockStart), px, py, fs);
  if (page === 0 && form.header && !styled) {
    for (const c of form.header.cells) {
      g.font = `${c.bold ? 'bold ' : ''}${fs(c.size || 11)}px ${F_TITLE}`;
      const mid = (Y[c.row - 1] + Y[c.row]) / 2;
      if (c.align === 'center') {
        g.textAlign = 'center';
        g.fillText(c.text, px((X[c.cols[0]] + X[Math.min(c.cols[1] + 1, X.length - 1)]) / 2), py(mid));
      } else {
        g.textAlign = 'left';
        g.fillText(c.text, px(X[c.cols[0]]) + fs(2), py(mid));
      }
    }
  }
  const st = form.site;
  if (st && (page === 0 || st.row >= blockStart)) {
    g.font = `${fs(st.size || 11)}px ${F_TITLE}`;
    g.textAlign = 'left';
    g.fillText((st.prefix || '') + (site || ''), px(X[st.col]), py((Y[st.row - 1] + Y[st.row]) / 2));
  }

  for (let b = 0; b < nBlk; b++) {
    shift = b * BH;
    if (styled) drawTemplateCells(g, L, form.templateCells.filter(c => c.r >= blockStart), px, py, fs);
    drawBlock(g, ctx, first + b, px, py, u, fs);
  }
  return cv;
}

function jpgSize(b) {
  for (let i = 2; i < b.length;) {
    if (b[i] !== 0xFF) { i++; continue; }
    const mk = b[i + 1];
    if (mk >= 0xC0 && mk <= 0xCF && mk !== 0xC4 && mk !== 0xC8 && mk !== 0xCC) {
      return [(b[i + 7] << 8) | b[i + 8], (b[i + 5] << 8) | b[i + 6]];
    }
    i += 2 + ((b[i + 2] << 8) | b[i + 3]);
  }
  return [0, 0];
}

/** JPEG 페이지들을 최소 구조의 PDF로 묶는다 (app.js pdfBytes 와 같은 구조) */
function pdfBytes(jpegs, wPt, hPt) {
  const chunks = [], offsets = [];
  let len = 0;
  const put = d => { const b = typeof d === 'string' ? Buffer.from(d, 'latin1') : d; chunks.push(b); len += b.length; };
  const obj = (n, body, stream) => {
    offsets[n] = len;
    put(`${n} 0 obj\n${body}\n`);
    if (stream) { put('stream\n'); put(stream); put('\nendstream\n'); }
    put('endobj\n');
  };
  put('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const kids = jpegs.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Count ${jpegs.length} /Kids [${kids}] >>`);
  jpegs.forEach((jpg, i) => {
    const pg = 3 + i * 3, ct = pg + 1, im = pg + 2;
    const [w, h] = jpgSize(jpg);
    obj(pg, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${wPt} ${hPt}] ` +
            `/Resources << /XObject << /Im0 ${im} 0 R >> >> /Contents ${ct} 0 R >>`);
    const content = `q ${wPt} 0 0 ${hPt} 0 0 cm /Im0 Do Q`;
    obj(ct, `<< /Length ${content.length} >>`, content);
    obj(im, `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} ` +
            `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>`, jpg);
  });
  const xref = len, n = 3 + jpegs.length * 3;
  let t = `xref\n0 ${n}\n0000000000 65535 f \n`;
  for (let i = 1; i < n; i++) t += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  put(t + `trailer\n<< /Size ${n} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(chunks);
}

/** /api/xlsx 와 같은 요청 모양 {form, formDef?, site, date, items:[{fields,w,h,data}]} → PDF Buffer */
async function buildPdf(body) {
  const form = body.formDef || forms().find(f => f.id === body.form) || forms()[0];
  const list = Array.isArray(body.items) ? body.items : [];
  if (!list.length) throw new Error('사진이 없습니다.');
  const photos = [];
  for (const it of list) {
    const img = await loadImage(Buffer.from(String(it.data || ''), 'base64'));
    photos.push({ img, w: it.w || img.width, h: it.h || img.height, fields: it.fields || {} });
  }
  const ctx = { form, L: layout(form), photos, site: body.site || '', date: body.date || '' };
  const jpegs = [];
  for (let p = 0; p < pageCount(form, photos.length); p++) {
    jpegs.push(await drawPage(ctx, p, DPI).encode('jpeg', JPEG_QUALITY));
  }
  return pdfBytes(jpegs, 595.28, 841.89);
}

module.exports = { buildPdf, pageCount, fmtDate };
