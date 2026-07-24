/** 사진대지 자동생성 (Google Apps Script)
 * 흐름: 폰에서 사진을 드라이브 '사진대지업로드' 폴더에 공유 → 웹앱 URL 열고 [생성] →
 *       '사진대지완성' 폴더에 xlsx + PDF 자동 생성, 처리된 사진은 '처리됨'으로 이동.
 * 설정: 아래 CONFIG 3개 ID만 본인 것으로 교체.
 */
const CONFIG = {
  templateId: '여기에_양식_구글시트_ID',   // 양식 xlsx를 구글시트로 변환한 파일의 ID
  inFolderId: '여기에_업로드_폴더_ID',     // 사진 올리는 폴더
  outFolderId: '여기에_완성본_폴더_ID',    // 결과물 저장 폴더
  defaultLoc: '구리갈매A-2BL 현장내',
  defaultMemo: ''
};
const BLOCK = 30, BOX = [[4,13],[18,27]], INF = [[15,16],[29,30]];

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.run) {
    try { const r = generate(p);
      return page('✅ 완료 (' + r.count + '장, ' + r.pages + '페이지)<br><br>' +
        '<a class=b href="' + r.xlsx + '">📄 XLSX 열기</a> <a class=b href="' + r.pdf + '">📕 PDF 열기</a>' +
        '<br><br><a href="?">← 처음으로</a>');
    } catch (err) { return page('⚠️ ' + err.message + '<br><br><a href="?">← 처음으로</a>'); }
  }
  const today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  return page(
    '<form>' +
    '<label>위치</label><input name=loc value="' + CONFIG.defaultLoc + '">' +
    '<label>내용</label><input name=memo placeholder="예: 가배수로 정리">' +
    '<label>일자</label><input type=date name=date value="' + today + '">' +
    '<input type=hidden name=run value=1>' +
    '<button>사진대지 생성 (xlsx + PDF)</button></form>' +
    '<p class=t>먼저 갤러리에서 사진 선택 → 공유 → 드라이브 → 업로드 폴더에 저장한 뒤 누르세요.</p>');
}

function page(body) {
  return HtmlService.createHtmlOutput(
    '<meta name=viewport content="width=device-width,initial-scale=1">' +
    '<style>body{font-family:sans-serif;max-width:420px;margin:24px auto;padding:0 16px}' +
    'label{display:block;font-size:13px;color:#555;margin:10px 0 2px}' +
    'input{width:100%;padding:10px;font-size:16px;box-sizing:border-box}' +
    'button{width:100%;margin-top:16px;padding:14px;font-size:16px;background:#25a;color:#fff;border:0;border-radius:8px}' +
    '.b{display:inline-block;padding:12px 18px;background:#25a;color:#fff;border-radius:8px;text-decoration:none}' +
    '.t{font-size:13px;color:#777}</style>' +
    '<h2>📷 사진대지 자동생성</h2>' + body);
}

function generate(p) {
  const inF = DriveApp.getFolderById(CONFIG.inFolderId);
  const files = [];
  for (const it = inF.getFiles(); it.hasNext();) {
    const f = it.next();
    if (f.getMimeType().indexOf('image/') === 0) files.push(f);
  }
  if (!files.length) throw new Error('업로드 폴더에 사진이 없습니다.');
  files.sort((a, b) => a.getDateCreated() - b.getDateCreated());

  const date = p.date || Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  const name = '사진대지_' + date;
  const outF = DriveApp.getFolderById(CONFIG.outFolderId);
  const copy = DriveApp.getFileById(CONFIG.templateId).makeCopy(name, outF);
  const ss = SpreadsheetApp.openById(copy.getId());
  const sh = ss.getSheets()[0];

  const pages = Math.ceil(files.length / 2);
  for (let pg = 2; pg < pages; pg++) {            // 양식엔 2페이지까지 있음
    sh.getRange(1, 1, BLOCK, 11).copyTo(sh.getRange(pg * BLOCK + 1, 1));
    for (let r = 1; r <= BLOCK; r++) sh.setRowHeight(pg * BLOCK + r, sh.getRowHeight(r));
  }

  files.forEach((f, i) => {
    const pg = (i / 2) | 0, s = i % 2, base = pg * BLOCK;
    sh.getRange(base + INF[s][0], 3).setValue(p.loc || CONFIG.defaultLoc);
    sh.getRange(base + INF[s][0], 7).setValue(date).setNumberFormat('yyyy"년" m"월" d"일"');
    sh.getRange(base + INF[s][1], 3).setValue(p.memo || CONFIG.defaultMemo);
    const [top, bot] = BOX[s];
    let bw = 0; for (let c = 2; c <= 8; c++) bw += sh.getColumnWidth(c);
    let bh = 0; for (let r = top; r <= bot; r++) bh += sh.getRowHeight(base + r);
    const img = sh.insertImage(f.getBlob(), 2, base + top);
    const ratio = Math.min((bw - 6) / img.getWidth(), (bh - 6) / img.getHeight());
    img.setWidth(Math.round(img.getWidth() * ratio));
    img.setHeight(Math.round(img.getHeight() * ratio));
    img.setAnchorCellXOffset(((bw - img.getWidth()) / 2) | 0);   // 가운데 정렬
    img.setAnchorCellYOffset(((bh - img.getHeight()) / 2) | 0);
  });

  // 안 쓰는 칸 비우기 (빈 슬롯의 참조 수식 제거)
  const totalSlots = Math.max(pages, 2) * 2;
  for (let i = files.length; i < totalSlots; i++) {
    const pg = (i / 2) | 0, s = i % 2, base = pg * BLOCK;
    sh.getRange(base + INF[s][0], 3).clearContent();
    sh.getRange(base + INF[s][0], 7).clearContent();
    sh.getRange(base + INF[s][1], 3).clearContent();
  }
  SpreadsheetApp.flush();

  const rows = pages * BLOCK;
  const token = ScriptApp.getOAuthToken();
  const url = 'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export';
  const opt = { headers: { Authorization: 'Bearer ' + token } };
  const pdf = outF.createFile(UrlFetchApp.fetch(url + '?format=pdf&portrait=true&fitw=true&gridlines=false&gid=' + sh.getSheetId() + '&range=A1:I' + rows, opt).getBlob().setName(name + '.pdf'));
  const xlsx = outF.createFile(UrlFetchApp.fetch(url + '?format=xlsx', opt).getBlob().setName(name + '.xlsx'));
  copy.setTrashed(true);   // 중간 구글시트는 정리

  const doneIt = inF.getFoldersByName('처리됨');
  const done = doneIt.hasNext() ? doneIt.next() : inF.createFolder('처리됨');
  files.forEach(f => f.moveTo(done));

  return { count: files.length, pages: pages, xlsx: xlsx.getUrl(), pdf: pdf.getUrl() };
}
