#!/usr/bin/env node
/** 사진 파일들로 사진대지를 만든다 — 엑셀(xlsx)과 PDF를 함께 낸다.
 *
 *   node tools/make.js --form yongyeok --site "양주회천 A-25BL" --date 2026-08-03 \
 *                      --set 내용="현장 정리" photos/*.jpg
 *
 *   --form   양식 id (생략하면 첫 번째 양식). 이름 일부로도 찾는다: --form 용역
 *   --list   등록된 양식 보기
 *   --set    사진 항목 기본값 (여러 번 쓸 수 있다). 예: --set 업체명=한보건설
 *   --out    출력 파일 이름 (확장자 제외)
 *   --no-pdf PDF 없이 엑셀만
 *
 * 사진 파일명을 "위치_내용.jpg" 처럼 밑줄로 나누면 앞에서부터 항목에 채워진다.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { buildXlsx, forms, formatDate } = require('../lib/build.js');

const jpegSize = b => {                       // JPEG 가로·세로 읽기
  for (let i = 2; i < b.length;) {
    if (b[i] !== 0xFF) { i++; continue; }
    const m = b[i + 1];
    if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
      return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    }
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
};

/** 양식이 요구하는 항목 이름들 (일자는 --date 로 들어간다) */
function fieldKeys(form) {
  const out = [];
  for (const slot of form.slots) {
    for (const line of slot.rows) {
      for (const cell of line.cells) {
        if (cell.field && cell.field !== 'date' && !out.includes(cell.field)) out.push(cell.field);
      }
    }
  }
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const list = forms();

  if (args.includes('--list') || !args.length) {
    console.log('등록된 양식:');
    for (const f of list) {
      console.log(`  ${f.id.padEnd(10)} ${f.name}  (한 장에 사진 ${f.perPage * (f.firstPageBlocks || 1)}장, 항목: ${fieldKeys(f).join(', ') || '없음'})`);
    }
    if (!args.length) console.log('\n사용법: node tools/make.js --form <id> [--site 현장명] [--date YYYY-MM-DD] [--set 항목=값] 사진들...');
    return;
  }

  const opt = { set: {} }, photos = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--set') { const [k, ...v] = args[++i].split('='); opt.set[k] = v.join('='); }
    else if (a === '--no-pdf') opt.noPdf = true;
    else if (a.startsWith('--')) opt[a.slice(2)] = args[++i];
    else photos.push(a);
  }
  if (!photos.length) { console.error('사진 파일을 지정해 주세요.'); process.exit(1); }

  const form = list.find(f => f.id === opt.form)
            || list.find(f => opt.form && f.name.includes(opt.form))
            || list[0];
  const keys = fieldKeys(form);

  const items = photos.map(p => {
    const buf = fs.readFileSync(p);
    const size = jpegSize(buf);
    if (!size) throw new Error(`JPEG 형식이 아닙니다: ${p}`);
    const parts = path.basename(p, path.extname(p)).split('_');
    const fields = Object.assign({}, opt.set);
    if (parts.length > 1) keys.forEach((k, i) => { if (parts[i]) fields[k] = parts[i]; });
    return { fields, data: buf.toString('base64'), w: size.w, h: size.h };
  });

  const date = /^\d{4}-\d{2}-\d{2}$/.test(opt.date || '') ? opt.date : new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const base = opt.out || `사진대지_${date}`;

  buildXlsx({ form: form.id, site: opt.site, date, items }).then(buf => {
    fs.writeFileSync(base + '.xlsx', buf);
    const blocks = Math.ceil(items.length / form.perPage);
    const fpb = form.firstPageBlocks || form.blocksPerPage || 1, bpp = form.blocksPerPage || 1;
    const pages = blocks <= fpb ? 1 : 1 + Math.ceil((blocks - fpb) / bpp);
    console.log(`양식: ${form.name}`);
    console.log(`사진 ${items.length}장 → ${pages}페이지`);
    console.log(`  ${base}.xlsx`);

    if (opt.noPdf) return;
    try {
      execFileSync('soffice', ['--headless', '--convert-to', 'pdf', base + '.xlsx',
                               '--outdir', path.dirname(path.resolve(base)) || '.'],
                   { stdio: 'ignore', timeout: 180000 });
      if (fs.existsSync(base + '.pdf')) console.log(`  ${base}.pdf`);
      else console.log('  (PDF 변환 실패 — 엑셀 파일을 열어 PDF로 저장해 주세요)');
    } catch (e) {
      console.log('  (LibreOffice가 없어 PDF는 만들지 못했습니다 — 엑셀만 사용하세요)');
    }
  }).catch(e => { console.error('실패:', e.message); process.exit(1); });
}

if (require.main === module) main();
