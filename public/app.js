/* 사진대지 — 양식과 동일한 레이아웃을 캔버스에 그려 미리보기·PDF로, 사진은 서버에서 xlsx로 */

// ── 양식 치수 (템플릿 xlsx에서 그대로 가져옴) ──────────────────────────────
const CHARW = [1.71, 9.43, 9.43, 9.43, 9.43, 10.14, 9.43, 9.43, 1.71];  // A~I 열 너비(문자 단위)
const PX_PER_CHAR = 8;                  // 맑은 고딕 11pt 기준 1문자 = 8px (엑셀 환산)
const COLW = CHARW.map(w => w * PX_PER_CHAR + 5);                       // 96dpi 픽셀
const ROWH = [49.5, 27, 9.75, 21, 27, 27, 27, 27, 27, 27, 27, 27, 20.25, 9.75,
              27, 27, 7.5, 21, 27, 9.75, 27, 27, 27, 27, 36.75, 27, 20.25, 7.5, 27, 27]; // 1~30행, pt
const BOX = [[4, 13], [18, 27]];        // 사진박스 행범위 (테두리는 A~I열 전체)
const INF = [[15, 16], [29, 30]];       // [위치·일자 행, 내용·비고 행]
const PER = 2;                          // 페이지당 사진 수
const INSET = 12;                       // 사진과 박스 테두리 사이 여백 (96dpi 픽셀)
const MARGIN = { lr: 0.7086614, tb: 0.7480315 };   // 양식의 인쇄 여백 (inch)
const F_TITLE = '"Malgun Gothic","맑은 고딕",sans-serif';
const F_TABLE = '"Gulim","굴림","GulimChe","굴림체","Malgun Gothic",sans-serif';

// X[n] = n번째 열의 시작 x, Y[r] = r번째 행의 끝 y (즉 시작은 Y[r-1])
const X = [0, 0]; COLW.forEach(w => X.push(X[X.length - 1] + w));
const Y = [0]; ROWH.forEach(h => Y.push(Y[Y.length - 1] + h * 4 / 3));  // pt → 96dpi 픽셀
const SHEET_W = X[10], SHEET_H = Y[30];

const items = [];   // {bmp, w, h, loc, memo, bigo}
const $ = id => document.getElementById(id);
const esc = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

// ── 사진 추가 ──────────────────────────────────────────────────────────────
async function addFiles(files) {
  const list = [...files].filter(f => f.type.startsWith('image/'));
  if (!list.length) return;
  status(`사진 ${list.length}장 불러오는 중…`);
  let failed = 0;
  for (const f of list) {
    try {
      const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' });
      items.push({ bmp, w: bmp.width, h: bmp.height, loc: $('f_loc').value, memo: $('f_memo').value, bigo: '' });
    } catch (e) { failed++; }
  }
  status(failed ? `⚠️ ${failed}장은 열 수 없어 건너뛰었습니다.` : '');
  render();
}

function del(i) { items.splice(i, 1); render(); }
function set(i, k, v) { items[i][k] = v; schedule(); }

// 입력 중에는 미리보기만 다시 그린다 (목록을 다시 그리면 입력 포커스가 끊김)
let timer = null;
function schedule() { clearTimeout(timer); timer = setTimeout(renderPreview, 300); }

// ── 화면 그리기 ────────────────────────────────────────────────────────────
function render() { renderList(); renderPreview(); }

function renderList() {
  $('empty').style.display = items.length ? 'none' : 'block';
  $('actions').style.display = items.length ? 'flex' : 'none';

  $('list').innerHTML = items.map((it, i) => `
    <div class="card">
      <canvas class="thumb" data-thumb="${i}"></canvas>
      <div class="fields">
        <div class="no">사진 ${i + 1}</div>
        <input value="${esc(it.loc)}" placeholder="위치" oninput="set(${i},'loc',this.value)">
        <input value="${esc(it.memo)}" placeholder="내용" oninput="set(${i},'memo',this.value)">
        <input value="${esc(it.bigo)}" placeholder="비고" oninput="set(${i},'bigo',this.value)">
      </div>
      <button class="del" onclick="del(${i})" aria-label="삭제">✕</button>
    </div>`).join('');
  items.forEach((it, i) => thumb(document.querySelector(`[data-thumb="${i}"]`), it));
}

function renderPreview() {
  const pages = Math.ceil(items.length / PER);
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

/** A4 한 장을 그린다 (엑셀 인쇄와 동일한 배치). dpi=96 미리보기, 200은 PDF용 */
function drawPage(cv, page, dpi) {
  const W = Math.round(8.2677 * dpi), H = Math.round(11.6929 * dpi);
  cv.width = W; cv.height = H;
  cv.style.width = '100%'; cv.style.height = 'auto';
  const g = cv.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);

  // 엑셀과 같이 100%를 넘겨 확대하지 않고, 인쇄영역 안에서 가로 가운데 정렬
  const S = dpi / 72;                                   // pt → 캔버스 px
  const sheetW = SHEET_W * 0.75, sheetH = SHEET_H * 0.75;   // 96dpi px → pt
  const printW = (8.2677 - MARGIN.lr * 2) * 72, printH = (11.6929 - MARGIN.tb * 2) * 72;
  const k = Math.min(1, printW / sheetW, printH / sheetH);
  const ox = MARGIN.lr * 72 + (printW - sheetW * k) / 2, oy = MARGIN.tb * 72;

  const u = v => v * 0.75 * k * S;         // 양식 픽셀(96dpi) → 캔버스 px
  const px = v => (ox * S) + u(v), py = v => (oy * S) + u(v);
  const fs = v => v * k * S;               // 글자 pt → 캔버스 px

  g.strokeStyle = '#000'; g.fillStyle = '#000';
  g.lineWidth = Math.max(1, 0.75 * k * S);
  g.textBaseline = 'middle';

  // 제목 (맑은 고딕 20pt 굵게) / 현장명 (11pt)
  g.font = `bold ${fs(20)}px ${F_TITLE}`;
  g.textAlign = 'center';
  g.fillText('사  진  대  지', px((X[1] + X[10]) / 2), py((Y[0] + Y[1]) / 2));
  g.font = `${fs(11)}px ${F_TITLE}`;
  g.textAlign = 'left';
  g.fillText('현장명 : ' + $('f_site').value, px(X[1]), py((Y[1] + Y[2]) / 2));

  const dateText = fmtDate($('f_date').value);
  for (let s = 0; s < PER; s++) {
    const it = items[page * PER + s];
    const [top, bot] = BOX[s];

    // 사진박스: 테두리는 A~I열 전체 (표와 같은 폭), 사진은 안쪽에 가운데 정렬
    const bx = px(X[1]), by = py(Y[top - 1]);
    const bw = u(X[10] - X[1]), bh = u(Y[bot] - Y[top - 1]);
    g.strokeRect(bx, by, bw, bh);
    if (it) {
      const pad = u(INSET);
      const r = Math.min((bw - pad * 2) / it.w, (bh - pad * 2) / it.h);
      const w = it.w * r, h = it.h * r;
      g.drawImage(it.bmp, bx + (bw - w) / 2, by + (bh - h) / 2, w, h);
    }

    // 위치·일자 / 내용·비고 표 (굴림체 11pt)
    const [rInfo, rMemo] = INF[s];
    row(g, rInfo, '위 치', it ? it.loc : '', '일 자', it ? dateText : '', px, py, fs);
    row(g, rMemo, '내 용', it ? it.memo : '', '비 고', it ? it.bigo : '', px, py, fs);
  }
}

function row(g, r, lab1, val1, lab2, val2, px, py, fs) {
  const y0 = py(Y[r - 1]), y1 = py(Y[r]);
  const cells = [
    [px(X[1]), px(X[3]), lab1],
    [px(X[3]), px(X[6]), val1],
    [px(X[6]), px(X[7]), lab2],
    [px(X[7]), px(X[10]), val2],
  ];
  for (const [x0, x1, text] of cells) {
    g.strokeRect(x0, y0, x1 - x0, y1 - y0);
    if (!text) continue;
    let size = fs(11);
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

function fmtDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return '';
  const [y, m, d] = iso.split('-');
  return `${+y}년 ${+m}월 ${+d}일`;
}

// ── PDF 저장 (브라우저에서 직접 생성) ──────────────────────────────────────
async function savePdf() {
  if (!items.length) return;
  busy(true, 'PDF 만드는 중…');
  try {
    const pages = Math.ceil(items.length / PER), jpegs = [];
    const cv = document.createElement('canvas');
    for (let p = 0; p < pages; p++) {
      drawPage(cv, p, 200);            // 글씨가 또렷하게 나오도록 200dpi
      jpegs.push(await canvasJpeg(cv, 0.92));
    }
    download(new Blob([pdfBytes(jpegs, 595.28, 841.89)], { type: 'application/pdf' }), fileName('pdf'));
    status('✅ PDF 저장 완료');
  } catch (e) { status('⚠️ PDF 실패: ' + e.message); }
  busy(false);
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

// ── XLSX 저장 (서버에서 양식에 삽입) ───────────────────────────────────────
async function saveXlsx() {
  if (!items.length) return;
  busy(true, '엑셀 만드는 중…');
  try {
    let payload = null;
    for (const [max, q] of [[1400, 0.8], [1100, 0.72], [900, 0.65]]) {
      payload = await Promise.all(items.map(it => shrink(it, max, q)));
      const bytes = payload.reduce((s, p) => s + p.data.length, 0);
      if (bytes < 3.2e6) break;
    }
    const res = await fetch('/api/xlsx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site: $('f_site').value, date: $('f_date').value, items: payload }),
    });
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))).error) || res.status);
    download(await res.blob(), fileName('xlsx'));
    status('✅ 엑셀 저장 완료');
  } catch (e) { status('⚠️ 엑셀 실패: ' + e.message); }
  busy(false);
}

async function shrink(it, max, q) {
  const r = Math.min(1, max / Math.max(it.w, it.h));
  const w = Math.round(it.w * r), h = Math.round(it.h * r);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  cv.getContext('2d').drawImage(it.bmp, 0, 0, w, h);
  const jpg = await canvasJpeg(cv, q);
  let bin = '';
  for (const b of jpg) bin += String.fromCharCode(b);
  return { loc: it.loc, memo: it.memo, bigo: it.bigo, w, h, data: btoa(bin) };
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
  $('btnPdf').disabled = on; $('btnXlsx').disabled = on;
  if (t) status(t);
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

window.set = set; window.del = del;
window.addEventListener('DOMContentLoaded', async () => {
  const kst = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  $('f_date').value = kst;
  $('f_site').value = localStorage.getItem('site') || '구리갈매역세권 A-2BL 아파트 건설공사 3공구';
  $('f_loc').value = localStorage.getItem('loc') || '';
  ['f_site', 'f_loc', 'f_memo', 'f_date'].forEach(id => $(id).addEventListener('input', () => {
    if (id === 'f_site') localStorage.setItem('site', $(id).value);
    if (id === 'f_loc') localStorage.setItem('loc', $(id).value);
    schedule();
  }));
  // 입력값 초기화는 사진을 다 읽은 뒤에 (먼저 지우면 파일 데이터가 무효화됨)
  $('pick').addEventListener('change', async e => {
    await addFiles([...e.target.files]);
    e.target.value = '';
  });
  $('btnPdf').addEventListener('click', savePdf);
  $('btnXlsx').addEventListener('click', saveXlsx);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
  await loadShared();
});
