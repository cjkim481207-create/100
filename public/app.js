/* 사진대지 — 양식 정의(forms.json)대로 화면·PDF를 그리고, 엑셀은 서버가 양식 파일에 삽입 */

let FORM = null;                 // 현재 선택된 양식 정의
let FORMS = [];                  // 사용 가능한 양식 목록
let FIELDS = [];                 // 이 양식이 요구하는 사진별 입력 항목
let COLW = [], X = [], Y = [], SHEET_W = 0, SHEET_H = 0;
const F_TITLE = '"Malgun Gothic","맑은 고딕",sans-serif';
const F_TABLE = '"Gulim","굴림","GulimChe","굴림체","Malgun Gothic",sans-serif';

/** 양식이 요구하는 입력 항목 (일자는 위쪽 날짜칸을 쓰므로 제외) */
function fieldDefs(form) {
  const out = [], seen = {};
  for (const slot of form.slots) {
    for (const line of slot.rows) {
      let label = '';
      for (const cell of line.cells) {
        if (cell.label) label = cell.label;
        else if (cell.field && !seen[cell.field]) {
          seen[cell.field] = 1;
          out.push({ key: cell.field, label: (label || cell.field).replace(/\s+/g, ' ').trim() });
        }
      }
    }
  }
  return out;
}

/** 선택한 양식의 치수를 화면 좌표로 미리 계산 */
function useForm(form) {
  FORM = form;
  FIELDS = fieldDefs(form);
  COLW = form.cols.map(w => w * (form.pxPerChar || 8) + 5);          // 96dpi 픽셀
  X = [0, 0]; COLW.forEach(w => X.push(X[X.length - 1] + w));        // X[n] = n번째 열 시작
  Y = [0]; form.rows.forEach(h => Y.push(Y[Y.length - 1] + h * 4 / 3));  // Y[r] = r행 끝
  SHEET_W = X[X.length - 1]; SHEET_H = Y[Y.length - 1];
}
const blockStart = () => FORM.blockStart || 1;
const blockTop = () => Y[blockStart() - 1];        // 머리글 높이

const items = [];   // {bmp, w, h, loc, memo, bigo}
const $ = id => document.getElementById(id);
// 시크릿 모드·저장공간 부족에서도 예외로 앱이 멈추지 않게
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 무시 */ } },
};
const esc = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/** 내가 추가한 양식은 이 기기에 저장한다 (정의 + 양식 파일) */
const idb = {
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('daeji', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('forms', { keyPath: 'id' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  },
  async run(mode, fn) {
    try {
      const db = await this.open();
      return await new Promise(res => {
        const req = fn(db.transaction('forms', mode).objectStore('forms'));
        req.onsuccess = () => res(req.result);
        req.onerror = () => res(null);
      });
    } catch (e) { return null; }
  },
  all() { return this.run('readonly', st => st.getAll()); },
  put(v) { return this.run('readwrite', st => st.put(v)); },
  del(id) { return this.run('readwrite', st => st.delete(id)); },
};
const custom = {};        // id → { def, data(base64) }

// ── 사진 추가 ──────────────────────────────────────────────────────────────
const MAX_SRC = 1600;   // 원본을 이 크기로 줄여 보관 (사진이 많아도 폰 메모리가 버티도록)

/** 기기·브라우저마다 다른 이미지 읽기 방식을 차례로 시도 */
async function loadImage(f) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(f, { imageOrientation: 'from-image' }); } catch (e) { /* 아래로 */ }
    try { return await createImageBitmap(f); } catch (e) { /* 아래로 */ }
  }
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(f), im = new Image();
    im.onload = () => { URL.revokeObjectURL(url); res(im); };
    im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('read')); };
    im.src = url;
  });
}

async function loadPhoto(f) {
  const src = await loadImage(f);
  const w = src.width || src.naturalWidth, h = src.height || src.naturalHeight;
  if (!w || !h) throw new Error('empty');
  const r = Math.min(1, MAX_SRC / Math.max(w, h));
  if (r === 1) return { bmp: src, w, h };
  const cv = document.createElement('canvas');
  cv.width = Math.round(w * r); cv.height = Math.round(h * r);
  cv.getContext('2d').drawImage(src, 0, 0, cv.width, cv.height);
  if (src.close) src.close();
  return { bmp: cv, w: cv.width, h: cv.height };
}

async function addFiles(files) {
  const list = [...files].filter(f => f.type.startsWith('image/'));
  if (!list.length) return;
  status(`사진 ${list.length}장 불러오는 중…`);
  let failed = 0;
  for (const f of list) {
    try {
      const p = await loadPhoto(f);
      const v = {};
      for (const fd of FIELDS) {
        v[fd.key] = fd.key === 'date' ? $('f_date').value : (($('d_' + fd.key) || {}).value || '');
      }
      items.push({ ...p, v });
    } catch (e) { failed++; }
  }
  status(failed ? `⚠️ ${failed}장은 열 수 없어 건너뛰었습니다.` : '');
  invalidate();
  render();
  warmUp();
}

function del(i) { items.splice(i, 1); invalidate(); render(); }
function set(i, k, v) { items[i].v[k] = v; invalidate(); schedule(); }

// 입력 중에는 미리보기만 다시 그린다 (목록을 다시 그리면 입력 포커스가 끊김)
let timer = null;
function schedule() { clearTimeout(timer); timer = setTimeout(renderPreview, 300); }

// ── 화면 그리기 ────────────────────────────────────────────────────────────
function render() { renderDefaults(); renderList(); renderPreview(); }

function renderList() {
  $('empty').style.display = items.length ? 'none' : 'block';
  $('actions').style.display = items.length ? 'flex' : 'none';
  $('saves').style.display = items.length ? 'flex' : 'none';

  $('list').innerHTML = items.map((it, i) => `
    <div class="card">
      <canvas class="thumb" data-thumb="${i}"></canvas>
      <div class="fields">
        <div class="no">사진 ${i + 1}</div>
        ${FIELDS.map(f => `<input ${f.key === 'date' ? 'type="date"' : ''} value="${esc(it.v[f.key])}" placeholder="${esc(f.label)}"
           oninput="set(${i},'${esc(f.key)}',this.value)">`).join('')}
      </div>
      <button class="del" onclick="del(${i})" aria-label="삭제">✕</button>
    </div>`).join('');
  items.forEach((it, i) => thumb(document.querySelector(`[data-thumb="${i}"]`), it));
}

function pageCount() {
  const blocks = Math.ceil(items.length / FORM.perPage);
  const bpp = FORM.blocksPerPage || 1, fpb = FORM.firstPageBlocks || bpp;
  return blocks <= fpb ? Math.min(1, blocks) : 1 + Math.ceil((blocks - fpb) / bpp);
}

function renderPreview() {
  const pages = pageCount();
  $('pvLabel').style.display = pages ? 'block' : 'none';
  const box = $('preview');
  box.innerHTML = '';
  for (let p = 0; p < pages; p++) {
    const c = document.createElement('canvas');
    box.appendChild(c);
    drawPage(c, p, 96);
  }
}

function thumb(cv, it) {
  if (!cv) return;
  const S = 96;
  cv.width = S; cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = '#d8dbe0'; g.fillRect(0, 0, S, S);
  const r = Math.min(S / it.w, S / it.h), w = it.w * r, h = it.h * r;
  g.drawImage(it.bmp, (S - w) / 2, (S - h) / 2, w, h);
}

function drawTemplateCells(g, cells, px, py, fs) {
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
    // 엑셀 '균등 분할'(distributed): 글자를 칸 너비에 고르게 펼친다.
    // 한글 양식의 '일 자', '비 고' 같은 라벨이 흔히 이 정렬을 쓴다.
    if (cell.align === 'distributed' && [...cell.text].length > 1) {
      const chars = [...cell.text], pad = fs(2);
      const wid = chars.map(ch => g.measureText(ch).width);
      const gap = ((x1 - x0 - pad * 2) - wid.reduce((t, w) => t + w, 0)) / (chars.length - 1);
      g.textAlign = 'left';
      let cx = x0 + pad;
      chars.forEach((ch, i) => { g.fillText(ch, cx, my); cx += wid[i] + gap; });
      continue;
    }
    const mid = cell.align === 'center' || cell.align === 'centerContinuous';
    g.textAlign = mid ? 'center' : (cell.align === 'right' ? 'right' : 'left');
    const tx = mid ? (x0 + x1) / 2 : (cell.align === 'right' ? x1 - fs(2) : x0 + fs(2));
    g.fillText(cell.text, tx, my);
    if (font.underline) { const tw = g.measureText(cell.text).width; const ux = mid ? tx - tw / 2 : (cell.align === 'right' ? tx - tw : tx); g.beginPath(); g.moveTo(ux, my + fs((font.size || 11) * .48)); g.lineTo(ux + tw, my + fs((font.size || 11) * .48)); g.stroke(); }
  }
  g.fillStyle = '#000'; g.strokeStyle = '#000';
}

/** A4 한 장을 그린다 (엑셀 인쇄와 동일한 배치). dpi=96 미리보기, 200은 PDF용 */
function drawPage(cv, page, dpi) {
  const W = Math.round(8.2677 * dpi), H = Math.round(11.6929 * dpi);
  cv.width = W; cv.height = H;
  cv.style.width = '100%'; cv.style.height = 'auto';
  const g = cv.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);

  // 엑셀과 같이 100%를 넘겨 확대하지 않고, 인쇄영역 안에서 가로 가운데 정렬
  const m = FORM.margins || { lr: 0.7, tb: 0.75 };
  const S = dpi / 72;                                       // pt → 캔버스 px
  const _bpp = FORM.blocksPerPage || 1, _fpb = FORM.firstPageBlocks || _bpp;
  const _BH = Y[Y.length - 1] - blockTop();
  const sheetW = SHEET_W * 0.75;
  const sheetH = Math.max(blockTop() + _fpb * _BH, _bpp * _BH) * 0.75;   // 96dpi px → pt
  const printW = (8.2677 - m.lr * 2) * 72, printH = (11.6929 - m.tb * 2) * 72;
  const k = Math.min(1, printW / sheetW, printH / sheetH);
  const ox = m.lr * 72 + (printW - sheetW * k) / 2, oy = m.tb * 72;

  const bpp = FORM.blocksPerPage || 1, fpb = FORM.firstPageBlocks || bpp;
  const BH = Y[Y.length - 1] - blockTop();               // 블록 한 개 높이
  const first = page === 0 ? 0 : fpb + (page - 1) * bpp;  // 이 장의 첫 블록 번호
  const nBlk = page === 0 ? fpb : bpp;
  let shift = 0;                                          // 블록을 아래로 쌓는 양

  const u = v => v * 0.75 * k * S;           // 양식 픽셀(96dpi) → 캔버스 px
  const px = v => (ox * S) + u(v);
  const py = v => (oy * S) + u(v - (page === 0 ? 0 : blockTop()) + shift);
  const fs = v => v * k * S;               // 글자 pt → 캔버스 px
  const last = X.length - 1;

  g.strokeStyle = '#000'; g.fillStyle = '#000';
  g.lineWidth = Math.max(1, 0.75 * k * S);
  g.textBaseline = 'middle';

  const styled = FORM.templateCells && FORM.templateCells.length;
  if (page === 0 && styled) drawTemplateCells(g, FORM.templateCells.filter(c => c.r < blockStart()), px, py, fs);
  if (page === 0 && FORM.header && !styled) {
    for (const c of FORM.header.cells) {
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
  const st0 = FORM.site;

  const st = FORM.site;
  if (st && (page === 0 || st.row >= blockStart())) {
    g.font = `${fs(st.size || 11)}px ${F_TITLE}`;
    g.textAlign = 'left';
    g.fillText((st.prefix || '') + $('f_site').value, px(X[st.col]), py((Y[st.row - 1] + Y[st.row]) / 2));
  }

  const dateText = fmtDate($('f_date').value);
  for (let b = 0; b < nBlk; b++) {
    shift = b * BH;
    if (styled) drawTemplateCells(g, FORM.templateCells.filter(c => c.r >= blockStart()), px, py, fs);
    drawBlock(g, first + b, dateText, px, py, u, fs);
  }
  shift = 0;
}

function drawBlock(g, block, dateText, px, py, u, fs) {
  const last = X.length - 1;
  const styled = FORM.templateCells && FORM.templateCells.length;
  const t = FORM.title;
  if (t && !styled) {
    g.font = `${t.bold ? 'bold ' : ''}${fs(t.size || 20)}px ${F_TITLE}`;
    g.textAlign = 'center';
    g.fillText(t.text, px((X[t.cols[0]] + X[t.cols[1] + 1]) / 2), py((Y[t.row - 1] + Y[t.row]) / 2));
  }
  FORM.slots.forEach((slot, s) => {
    const it = items[block * FORM.perPage + s];
    const val = Object.assign({}, it && it.v, { date: it ? fmtDate((it.v || {}).date || $('f_date').value) : '' });

    // 사진박스 + 사진 가운데 정렬
    const [r0, r1] = slot.box.rows, [c0, c1] = slot.box.cols;
    const bx = px(X[c0]), by = py(Y[r0 - 1]);
    const bw = u(X[c1 + 1] - X[c0]), bh = u(Y[r1] - Y[r0 - 1]);
    if (!styled) g.strokeRect(bx, by, bw, bh);
    if (it) {
      const pad = u(FORM.photoInset || 0);
      const r = Math.min((bw - pad * 2) / it.w, (bh - pad * 2) / it.h);
      const w = it.w * r, h = it.h * r;
      g.drawImage(it.bmp, bx + (bw - w) / 2, by + (bh - h) / 2, w, h);
    }

    // 항목 표
    for (const line of slot.rows) {
      const y0 = py(Y[line.row - 1]), y1 = py(Y[line.row]);
      for (const cell of line.cells) {
        const x0 = px(X[cell.cols[0]]), x1 = px(X[Math.min(cell.cols[1] + 1, last)]);
        if (!styled) g.strokeRect(x0, y0, x1 - x0, y1 - y0);
        const text = (styled ? val[cell.field] : (cell.label || val[cell.field])) || '';
        if (!text) continue;
        let size = fs(FORM.tableSize || 11);
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

function fmtDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return '';
  const [y, m, d] = iso.split('-');
  return `${+y}년 ${+m}월 ${+d}일`;
}

// ── PDF 만들기 (브라우저에서 직접 생성) ────────────────────────────────────
async function buildPdf() {
  const pages = pageCount(), jpegs = [];
  const cv = document.createElement('canvas');
  for (let p = 0; p < pages; p++) {
    drawPage(cv, p, 200);              // 글씨가 또렷하게 나오도록 200dpi
    jpegs.push(await canvasJpeg(cv, 0.92));
  }
  return new Blob([pdfBytes(jpegs, 595.28, 841.89)], { type: 'application/pdf' });
}

function canvasJpeg(cv, q) {
  return new Promise(res => cv.toBlob(b => b.arrayBuffer().then(a => res(new Uint8Array(a))), 'image/jpeg', q));
}

/** JPEG 페이지들을 최소 구조의 PDF로 묶는다 (외부 라이브러리 없음) */
function pdfBytes(jpegs, wPt, hPt) {
  const enc = new TextEncoder(), chunks = [], offsets = [];
  let len = 0;
  const put = d => { const u = typeof d === 'string' ? enc.encode(d) : d; chunks.push(u); len += u.length; };
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
    obj(pg, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${wPt} ${hPt}] ` +
            `/Resources << /XObject << /Im0 ${im} 0 R >> >> /Contents ${ct} 0 R >>`);
    const content = `q ${wPt} 0 0 ${hPt} 0 0 cm /Im0 Do Q`;
    obj(ct, `<< /Length ${content.length} >>`, content);
    obj(im, `<< /Type /XObject /Subtype /Image /Width ${jpgSize(jpg)[0]} /Height ${jpgSize(jpg)[1]} ` +
            `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>`, jpg);
  });

  const xref = len, n = 3 + jpegs.length * 3;
  let t = `xref\n0 ${n}\n0000000000 65535 f \n`;
  for (let i = 1; i < n; i++) t += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  put(t + `trailer\n<< /Size ${n} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(len);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
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

// ── XLSX 만들기 (서버가 양식 파일에 사진을 삽입) ───────────────────────────
async function buildXlsx() {
  let payload = null;
  for (const [max, q] of [[1400, 0.8], [1100, 0.72], [900, 0.65]]) {
    payload = await Promise.all(items.map(async it => Object.assign(
      { fields: it.v }, await shrink(it, max, q))));
    if (payload.reduce((s, p) => s + p.data.length, 0) < 3.2e6) break;
  }
  if (payload.reduce((s, p) => s + p.data.length, 0) > 3.6e6) {
    throw new Error(`사진이 너무 많습니다 (${items.length}장) — 15장쯤으로 나눠서 만들어 주세요`);
  }
  const body = { form: FORM.id, site: $('f_site').value, date: $('f_date').value, items: payload };
  if (custom[FORM.id]) { body.formDef = FORM; body.template = custom[FORM.id].data; }
  const res = await fetch('/api/xlsx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))).error) || res.status);
  return res.blob();
}

// ── 저장 / 공유 ────────────────────────────────────────────────────────────
const MIME = { pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
let ready = null;   // 만들어 둔 파일 {kind, file} — 공유 재시도·취소 후 재사용
function invalidate() {
  ready = null;
  for (const k of ['pdf', 'xlsx']) {
    const b = shareBtn(k);
    if (b && b.classList.contains('rdy')) { b.classList.remove('rdy'); b.textContent = `${LABEL[k]} 공유`; }
  }
}

async function makeFile(kind) {
  if (ready && ready.kind === kind) return ready.file;
  busy(true, kind === 'pdf' ? 'PDF 만드는 중…' : '엑셀 만드는 중… (몇 초 걸립니다)');
  const blob = kind === 'pdf' ? await buildPdf() : await buildXlsx();
  busy(false);
  return new File([blob], fileName(kind), { type: MIME[kind] });
}

async function save(kind) {
  if (!items.length) return;
  try {
    const file = await makeFile(kind);
    download(file, file.name);
    status('✅ 저장 완료 · ' + file.name);
  } catch (e) { busy(false); status('⚠️ 실패: ' + e.message); }
}

const shareBtn = kind => $(kind === 'pdf' ? 'btnSharePdf' : 'btnShareXlsx');
const LABEL = { pdf: 'PDF', xlsx: '엑셀' };

/** 준비된 파일을 곧바로 공유. await 없이 호출해야 브라우저가 공유창을 열어준다. */
function shareNow(kind) {
  if (!ready || ready.kind !== kind) return false;
  const file = ready.file;
  navigator.share({ files: [file], title: file.name })
    .then(() => { invalidate(); status('✅ 공유 완료'); })
    .catch(e => {
      if (e.name === 'AbortError') { status(''); return; }
      if (e.name === 'NotAllowedError') {
        // 인앱 브라우저 등에서 공유가 차단된 경우 — 만든 파일은 저장해 준다
        download(file, file.name);
        $('inapp').style.display = 'block';
        status('공유가 막혀 파일로 저장했습니다 · ' + file.name);
      } else status('⚠️ 공유 실패: ' + e.name);
    });
  return true;
}

async function share(kind) {
  if (!items.length) return;
  if (shareNow(kind)) return;                     // 이미 만들어 둔 파일이면 즉시 공유
  try {
    const file = await makeFile(kind);
    if (!(navigator.canShare && navigator.canShare({ files: [file] }))) {
      download(file, file.name);
      status('이 브라우저는 파일 공유를 지원하지 않아 저장했습니다.');
      return;
    }
    ready = { kind, file };
    try {
      await navigator.share({ files: [file], title: file.name });
      invalidate();
      status('✅ 공유 완료');
    } catch (e) {
      if (e.name === 'AbortError') { status(''); return; }
      if (e.name !== 'NotAllowedError') throw e;
      if (inAppBrowser()) {          // 인앱 브라우저는 다시 눌러도 막히므로 바로 저장
        download(file, file.name);
        invalidate();
        $('inapp').style.display = 'block';
        status('공유가 막혀 파일로 저장했습니다 · ' + file.name);
        return;
      }
      // 파일 만드는 사이 터치 권한이 만료됨 → 버튼을 '지금 공유'로 바꿔 한 번 더 누르게 한다
      const b = shareBtn(kind);
      b.textContent = `${LABEL[kind]} 지금 공유 ▶`;
      b.classList.add('rdy');
      status('파일 준비 완료 — 버튼을 한 번 더 눌러주세요');
    }
  } catch (e) { busy(false); status('⚠️ 공유 실패: ' + e.message); }
}

async function shrink(it, max, q) {
  if (it.small && it.small.max === max && it.small.q === q) return it.small.payload;
  const r = Math.min(1, max / Math.max(it.w, it.h));
  const w = Math.round(it.w * r), h = Math.round(it.h * r);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  cv.getContext('2d').drawImage(it.bmp, 0, 0, w, h);
  const jpg = await canvasJpeg(cv, q);
  let bin = '';
  for (const b of jpg) bin += String.fromCharCode(b);
  const payload = { w, h, data: btoa(bin) };
  it.small = { max, q, payload };
  return payload;
}

/** 사진을 미리 압축해 두고 서버도 깨워 둔다 (공유 버튼을 눌렀을 때 기다리지 않도록) */
function warmUp() {
  fetch('/api/xlsx', { method: 'GET' }).catch(() => {});
  setTimeout(async () => {
    for (const it of items) { try { await shrink(it, 1400, 0.8); } catch (e) { /* 나중에 다시 */ } }
  }, 300);
}

// ── 공통 ───────────────────────────────────────────────────────────────────
const fileName = ext => `사진대지_${$('f_date').value || 'today'}.${ext}`;
function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}
function status(t) { $('status').textContent = t; }
function busy(on, t) {
  ['btnPdf', 'btnXlsx', 'btnSharePdf', 'btnShareXlsx'].forEach(id => { $(id).disabled = on; });
  if (t) status(t);
}

/** 네이버·카톡 등 앱 안의 브라우저인지 (여기서는 파일 공유가 막힘) */
function inAppBrowser() {
  const ua = navigator.userAgent;
  return /NAVER|KAKAOTALK|DaumApps|Instagram|FBAN|FBAV|Line\//i.test(ua);
}

function setupInApp() {
  if (!inAppBrowser()) return;
  $('inapp').style.display = 'block';
  const url = location.href.split('#')[0];
  $('openChrome').addEventListener('click', () => {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    location.href = ios
      ? url.replace(/^https:/, 'googlechromes:')
      : `intent://${location.host}${location.pathname}#Intent;scheme=https;package=com.android.chrome;end`;
  });
  $('copyUrl').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(url); status('주소를 복사했습니다 — 크롬에 붙여넣어 주세요'); }
    catch (e) { status(url); }
  });
}

/** 공유로 들어온 사진 받기 (서비스워커가 캐시에 넣어둠) */
async function loadShared() {
  if (!('caches' in window)) return;
  const cache = await caches.open('shared');
  const c = await cache.match('count');
  if (!c) return;
  const n = +await c.text();
  const files = [];
  for (let i = 0; i < n; i++) {
    const r = await cache.match('photo' + i);
    if (r) files.push(await r.blob());
  }
  await caches.delete('shared');
  if (files.length) await addFiles(files);
}

const formName = f => store.get('name:' + f.id) || f.name;

function renderTabs() {
  const bar = $('tabs');
  bar.innerHTML = FORMS.map(f => `
    <button class="tab${f.id === FORM.id ? ' on' : ''}" data-id="${esc(f.id)}">${esc(formName(f))}</button>`).join('')
    + `<button class="tab edit" id="tabEdit" title="탭 이름 바꾸기">✎</button>`
    + `<button class="tab add" id="tabAdd" title="양식 추가">+ 양식</button>`;
  bar.querySelectorAll('.tab[data-id]').forEach(b => b.addEventListener('click', () => selectForm(b.dataset.id)));
  $('tabEdit').addEventListener('click', renameTab);
  $('tabAdd').addEventListener('click', () => $('formFile').click());
  const on = bar.querySelector('.tab.on');
  if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'center' });
}

function selectForm(id) {
  if (id === FORM.id) return;
  store.set('form', id);
  useForm(FORMS.find(f => f.id === id));
  invalidate();
  renderTabs();
  render();
}

// 카톡 등 인앱 브라우저에서는 window.prompt/confirm이 막혀 있어 자체 모달을 쓴다.
let delArmed = false;
function renameTab() {
  const mine = !!custom[FORM.id];
  $('renameInput').value = formName(FORM);
  const del = $('renameDel');
  del.hidden = !mine;
  del.textContent = '양식 삭제';
  delArmed = false;
  $('renameModal').classList.add('show');
  $('renameInput').focus();
}

function closeRenameModal() {
  $('renameModal').classList.remove('show');
}

function saveRenameModal() {
  const mine = !!custom[FORM.id];
  const t = $('renameInput').value.trim();
  store.set('name:' + FORM.id, t || FORM.name);
  renderTabs();
  closeRenameModal();
}

function deleteRenameModal() {
  const del = $('renameDel');
  if (!delArmed) { delArmed = true; del.textContent = '정말 삭제할까요? (다시 누르면 삭제)'; return; }
  closeRenameModal();
  removeForm(FORM.id);
}

async function removeForm(id) {
  await idb.del(id);
  delete custom[id];
  FORMS = FORMS.filter(f => f.id !== id);
  useForm(FORMS[0]);
  store.set('form', FORMS[0].id);
  invalidate();
  renderTabs();
  render();
  status('양식을 지웠습니다.');
}

/** 엑셀 양식 파일을 올리면 서버가 칸 위치를 읽어 새 탭으로 추가한다 */
async function addForm(file) {
  if (!file) return;
  status('양식 분석 중…');
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 8192) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 8192));
    const data = btoa(bin);
    const name = file.name.replace(/\.xlsx?$/i, '');
    const res = await fetch('/api/analyze', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, data }),
    });
    const def = await res.json();
    if (!res.ok) throw new Error(def.error || '인식 실패');

    custom[def.id] = { id: def.id, def, data };
    await idb.put({ id: def.id, def, data });
    FORMS = FORMS.concat([def]);
    store.set('form', def.id);
    useForm(def);
    invalidate();
    renderTabs();
    render();
    status(`✅ '${name}' 추가 — 사진 ${def.perPage}장/페이지, 항목 [${FIELDS.map(f => f.label).join(', ') || '없음'}]`);
  } catch (e) {
    status('⚠️ 양식 추가 실패: ' + e.message);
  }
}

async function loadForms() {
  let list = null;
  try {
    // 양식 정의가 바뀌면 미리보기/PDF 렌더링도 즉시 같은 정의를 써야 한다.
    // 브라우저나 CDN의 이전 forms.json 응답을 재사용하지 않는다.
    const res = await fetch('/api/forms?rev=20260808-style', { cache: 'no-store' });
    if (res.ok) { list = await res.json(); store.set('forms', JSON.stringify(list)); }
  } catch (e) { /* 오프라인 → 캐시 사용 */ }
  if (!list) { try { list = JSON.parse(store.get('forms')); } catch (e) { /* 무시 */ } }
  if (!list || !list.length) throw new Error('양식 정보를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.');

  const mine = (await idb.all()) || [];
  for (const m of mine) { custom[m.id] = m; list = list.concat([m.def]); }

  FORMS = list;
  const saved = store.get('form');
  useForm(list.find(f => f.id === saved) || list[0]);
  $('tabs').style.display = 'flex';
  renderTabs();
}

/** 양식이 요구하는 항목의 '기본값' 입력칸 (사진 추가 때 자동으로 채워진다) */
function renderDefaults() {
  $('defaults').innerHTML = FIELDS.map(f => `
    <div><label for="d_${esc(f.key)}">${esc(f.label)} (새 사진 기본값)</label>
      <input id="d_${esc(f.key)}" value="${esc(store.get('d:' + FORM.id + ':' + f.key) || '')}"></div>`).join('');
  FIELDS.forEach(f => $('d_' + f.key).addEventListener('input', e =>
    store.set('d:' + FORM.id + ':' + f.key, e.target.value)));
}

window.set = set; window.del = del;
window.addEventListener('DOMContentLoaded', async () => {
  try { await loadForms(); }
  catch (e) { status('⚠️ ' + e.message); return; }
  const kst = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  $('f_date').value = kst;
  $('f_site').value = store.get('site') || '';
  ['f_site', 'f_date'].forEach(id => $(id).addEventListener('input', () => {
    if (id === 'f_site') store.set('site', $(id).value);
    invalidate();
    schedule();
  }));
  renderDefaults();
  // 입력값 초기화는 사진을 다 읽은 뒤에 (먼저 지우면 파일 데이터가 무효화됨)
  $('formFile').addEventListener('change', async e => {
    await addForm(e.target.files[0]);
    e.target.value = '';
  });
  $('pick').addEventListener('change', async e => {
    await addFiles([...e.target.files]);
    e.target.value = '';
  });
  $('renameSave').addEventListener('click', saveRenameModal);
  $('renameCancel').addEventListener('click', closeRenameModal);
  $('renameDel').addEventListener('click', deleteRenameModal);
  $('renameInput').addEventListener('keydown', e => { if (e.key === 'Enter') saveRenameModal(); });
  $('btnSharePdf').addEventListener('click', () => share('pdf'));
  $('btnShareXlsx').addEventListener('click', () => share('xlsx'));
  $('btnPdf').addEventListener('click', () => save('pdf'));
  $('btnXlsx').addEventListener('click', () => save('xlsx'));
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
  setupInApp();
  await loadShared();
});
