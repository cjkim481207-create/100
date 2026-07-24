/** 사진대지 자동생성 (Google Apps Script) — ID 입력 불필요 버전
 *
 * ▶ 준비 (딱 1번):
 *   1) 양식 파일(사진대지_양식.xlsx)을 구글드라이브에 올린다.
 *   2) 그 파일을 열고 → [파일] > [Google Sheets로 저장]
 *   3) 저장된 구글시트 이름을 정확히  사진대지양식  으로 바꾼다. (띄어쓰기 없음)
 *   ※ 업로드/완성 폴더는 스크립트가 자동으로 만들어 줍니다. ID 복사 필요 없음.
 *
 * ▶ 배포:  [배포] > [새 배포] > 유형 '웹 앱' > 액세스 '나만' > 배포 → 나온 URL을 폰 홈에 추가
 *
 * ▶ 매일 사용:
 *   갤러리에서 사진 선택 → 공유 → 드라이브 → '사진대지업로드' 폴더에 저장
 *   → 홈의 버튼 터치 → [생성] → '사진대지완성' 폴더에 xlsx + PDF 자동 생성
 */
const NAMES = {
  template: '사진대지양식',      // 준비 3)에서 만든 구글시트 이름 (그대로 두세요)
  inFolder: '사진대지업로드',    // 사진 올리는 폴더 (자동 생성)
  outFolder: '사진대지완성',     // 결과물 폴더 (자동 생성)
  defaultLoc: '구리갈매A-2BL 현장내',
  defaultMemo: ''
};
const BLOCK = 30, BOX = [[4, 13], [18, 27]], INF = [[15, 16], [29, 30]];

function folderByName(name) {
  const it = DriveApp.getFoldersByName(name);
  return it.hasNext() ? it.next() : DriveApp.createFolder(name);
}
function findTemplate() {
  const it = DriveApp.getFilesByName(NAMES.template);
  if (!it.hasNext()) throw new Error('양식을 못 찾았습니다. 드라이브에 "' + NAMES.template + '" 이름의 구글시트가 있는지 확인하세요.');
  return it.next();
}

function doGet(e) {
  const today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  const html =
    '<meta name=viewport content="width=device-width,initial-scale=1">' +
    '<style>body{font-family:sans-serif;max-width:420px;margin:24px auto;padding:0 16px}' +
    'label{display:block;font-size:13px;color:#555;margin:10px 0 2px}' +
    'input{width:100%;padding:10px;font-size:16px;box-sizing:border-box}' +
    'button{width:100%;margin-top:16px;padding:14px;font-size:16px;background:#25a;color:#fff;border:0;border-radius:8px}' +
    'button:disabled{background:#9ab}' +
    '.b{display:inline-block;margin:4px;padding:12px 18px;background:#25a;color:#fff;border-radius:8px;text-decoration:none}' +
    '.t{font-size:13px;color:#777}#msg{margin-top:16px;font-size:16px;line-height:1.6}</style>' +
    '<h2>📷 사진대지 자동생성</h2>' +
    '<label>위치</label><input id=loc value="' + NAMES.defaultLoc + '">' +
    '<label>내용</label><input id=memo placeholder="예: 가배수로 정리">' +
    '<label>일자</label><input type=date id=date value="' + today + '">' +
    '<button id=btn onclick="go()">사진대지 생성 (xlsx + PDF)</button>' +
    '<div id=msg></div>' +
    '<p class=t>먼저 갤러리에서 사진 선택 → 공유 → 드라이브 → "' + NAMES.inFolder + '" 폴더에 저장한 뒤 누르세요.</p>' +
    '<script>' +
    'function v(id){return document.getElementById(id).value;}' +
    'function reset(){var b=document.getElementById("btn");b.disabled=false;b.textContent="사진대지 생성 (xlsx + PDF)";}' +
    'function ok(r){document.getElementById("msg").innerHTML="✅ 완료 ("+r.count+"장, "+r.pages+"페이지)<br><br><a class=b target=_blank href=\\""+r.xlsx+"\\">📄 XLSX 열기</a> <a class=b target=_blank href=\\""+r.pdf+"\\">📕 PDF 열기</a>";reset();}' +
    'function err(e){document.getElementById("msg").innerHTML="⚠️ "+e.message;reset();}' +
    'function go(){var b=document.getElementById("btn");b.disabled=true;b.textContent="생성 중… 잠시만요 (최대 30초)";document.getElementById("msg").textContent="";' +
    'google.script.run.withSuccessHandler(ok).withFailureHandler(err).generate({loc:v("loc"),memo:v("memo"),date:v("date")});}' +
    '<\/script>';
  return HtmlService.createHtmlOutput(html).addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function generate(p) {
  const inF = folderByName(NAMES.inFolder);
  const files = [];
  for (const it = inF.getFiles(); it.hasNext();) {
    const f = it.next();
    if (f.getMimeType().indexOf('image/') === 0) files.push(f);
  }
  if (!files.length) throw new Error('"' + NAMES.inFolder + '" 폴더에 사진이 없습니다. 사진을 먼저 공유해 주세요.');
  files.sort((a, b) => a.getDateCreated() - b.getDateCreated());

  const date = p.date || Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  const name = '사진대지_' + date;
  const outF = folderByName(NAMES.outFolder);
  const copy = findTemplate().makeCopy(name, outF);
  const ss = SpreadsheetApp.openById(copy.getId());
  const sh = ss.getSheets()[0];

  const pages = Math.ceil(files.length / 2);
  for (let pg = 2; pg < pages; pg++) {            // 양식엔 2페이지까지 있으니 그 이후만 복제
    sh.getRange(1, 1, BLOCK, 11).copyTo(sh.getRange(pg * BLOCK + 1, 1));
    for (let r = 1; r <= BLOCK; r++) sh.setRowHeight(pg * BLOCK + r, sh.getRowHeight(r));
  }

  files.forEach((f, i) => {
    const pg = (i / 2) | 0, s = i % 2, base = pg * BLOCK;
    sh.getRange(base + INF[s][0], 3).setValue(p.loc || NAMES.defaultLoc);
    sh.getRange(base + INF[s][0], 7).setValue(date).setNumberFormat('yyyy"년" m"월" d"일"');
    sh.getRange(base + INF[s][1], 3).setValue(p.memo || NAMES.defaultMemo);
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

  const totalSlots = Math.max(pages, 2) * 2;      // 빈 슬롯 정리
  for (let i = files.length; i < totalSlots; i++) {
    const pg = (i / 2) | 0, s = i % 2, base = pg * BLOCK;
    sh.getRange(base + INF[s][0], 3).clearContent();
    sh.getRange(base + INF[s][0], 7).clearContent();
    sh.getRange(base + INF[s][1], 3).clearContent();
  }
  SpreadsheetApp.flush();

  const rows = pages * BLOCK;
  const token = ScriptApp.getOAuthToken();
  const base = 'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export';
  const opt = { headers: { Authorization: 'Bearer ' + token } };
  const pdf = outF.createFile(UrlFetchApp.fetch(base + '?format=pdf&portrait=true&fitw=true&gridlines=false&gid=' + sh.getSheetId() + '&range=A1:I' + rows, opt).getBlob().setName(name + '.pdf'));
  const xlsx = outF.createFile(UrlFetchApp.fetch(base + '?format=xlsx', opt).getBlob().setName(name + '.xlsx'));
  copy.setTrashed(true);   // 중간 구글시트 정리

  const done = (function () {
    const dit = inF.getFoldersByName('처리됨');
    return dit.hasNext() ? dit.next() : inF.createFolder('처리됨');
  })();
  files.forEach(f => f.moveTo(done));

  return { count: files.length, pages: pages, xlsx: xlsx.getUrl(), pdf: pdf.getUrl() };
}
