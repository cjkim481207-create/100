#!/usr/bin/env python3
"""사진대지 자동생성: 엑셀 양식에 사진을 그대로 삽입해 .xlsx 생성.

사용법:
  python make_daeji.py 사진폴더 [-o 출력.xlsx] [--site 현장명] [--loc 위치] [--memo 내용] [--date YYYY-MM-DD]
사진 파일명 규칙(선택): "위치_내용.jpg" 로 지으면 위치/내용이 자동 입력됨.
필요: pip install openpyxl pillow
"""
import argparse, copy, datetime, os, sys, tempfile
from openpyxl import load_workbook
from openpyxl.drawing.image import Image as XLImage
from openpyxl.drawing.spreadsheet_drawing import OneCellAnchor, AnchorMarker
from openpyxl.drawing.xdr import XDRPositiveSize2D
from openpyxl.utils.units import pixels_to_EMU
from PIL import Image

TEMPLATE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "사진대지_양식.xlsx")
BLOCK = 30            # 1페이지 = 30행
BOXES = [(4, 13), (18, 27)]   # 페이지 내 사진박스 (시작행, 끝행), B~H열
INFO = [(15, 16), (29, 30)]   # 위치/일자 행, 내용/비고 행
COLS = range(2, 9)            # B~H

def col_px(ws, idx):
    from openpyxl.utils import get_column_letter
    cd = ws.column_dimensions.get(get_column_letter(idx))
    w = cd.width if cd and cd.width else (ws.sheet_format.defaultColWidth or 8.43)
    return int(round(w * 7 + 5))

def row_px(ws, r):
    rd = ws.row_dimensions.get(r)
    h = rd.height if rd and rd.height else (ws.sheet_format.defaultRowHeight or 16.5)
    return h * 96 / 72

def clone_page(ws, pages_now, pages_need):
    """1페이지(1~30행)를 복제해 페이지 추가."""
    from openpyxl.utils import get_column_letter
    for p in range(pages_now, pages_need):
        off = p * BLOCK
        for r in range(1, BLOCK + 1):
            src_rd = ws.row_dimensions.get(r)
            if src_rd and src_rd.height:
                ws.row_dimensions[r + off].height = src_rd.height
            for c in range(1, 12):
                s = ws.cell(row=r, column=c)
                d = ws.cell(row=r + off, column=c)
                d.value = s.value
                d._style = copy.copy(s._style)
        for m in [m for m in ws.merged_cells.ranges if m.max_row <= BLOCK]:
            ws.merge_cells(start_row=m.min_row + off, start_column=m.min_col,
                           end_row=m.max_row + off, end_column=m.max_col)

def insert_photo(ws, path, page, slot, tmpdir):
    top, bot = BOXES[slot]
    base = page * BLOCK
    box_w = sum(col_px(ws, c) for c in COLS) - 4
    box_h = sum(row_px(ws, base + r) for r in range(top, bot + 1)) - 4
    im = Image.open(path)
    im = im.convert("RGB")
    ratio = min(box_w / im.width, box_h / im.height)
    w, h = int(im.width * ratio), int(im.height * ratio)
    small = im.resize((min(im.width, 1400), int(im.height * min(1, 1400 / im.width))))
    tmp = os.path.join(tmpdir, f"p{page}s{slot}.jpg")
    small.save(tmp, quality=85)
    img = XLImage(tmp)
    xoff = (box_w - w) // 2 + 2   # 가운데 정렬
    yoff = int((box_h - h) // 2) + 2
    marker = AnchorMarker(col=1, colOff=pixels_to_EMU(xoff),
                          row=base + top - 1, rowOff=pixels_to_EMU(yoff))
    img.anchor = OneCellAnchor(_from=marker,
                               ext=XDRPositiveSize2D(pixels_to_EMU(w), pixels_to_EMU(h)))
    ws.add_image(img)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("folder", help="사진 폴더")
    ap.add_argument("-o", "--out", default=None)
    ap.add_argument("--site", default=None, help="현장명(기본: 양식의 값)")
    ap.add_argument("--loc", default="", help="위치 기본값")
    ap.add_argument("--memo", default="", help="내용 기본값")
    ap.add_argument("--date", default=datetime.date.today().isoformat())
    a = ap.parse_args()

    photos = sorted(os.path.join(a.folder, f) for f in os.listdir(a.folder)
                    if f.lower().endswith((".jpg", ".jpeg", ".png")))
    if not photos:
        sys.exit("사진이 없습니다: " + a.folder)

    wb = load_workbook(TEMPLATE)
    ws = wb.active
    pages = (len(photos) + 1) // 2
    clone_page(ws, 2, pages)

    date = datetime.date.fromisoformat(a.date)
    with tempfile.TemporaryDirectory() as tmpdir:
        for p in range(pages):
            base = p * BLOCK
            if a.site:
                ws.cell(row=base + 2, column=1).value = "현장명 : " + a.site
            for slot in (0, 1):
                i = p * 2 + slot
                r1, r2 = INFO[slot]
                cL, cD = ws.cell(row=base + r1, column=3), ws.cell(row=base + r1, column=7)
                cM, cB = ws.cell(row=base + r2, column=3), ws.cell(row=base + r2, column=7)
                if i < len(photos):
                    name = os.path.splitext(os.path.basename(photos[i]))[0]
                    loc, memo = (name.split("_", 1) + [""])[:2] if "_" in name else (a.loc, a.memo)
                    cL.value, cM.value, cB.value = loc or a.loc, memo or a.memo, None
                    cD.value = date; cD.number_format = 'yyyy"년" m"월" d"일"'
                    insert_photo(ws, photos[i], p, slot, tmpdir)
                else:
                    cL.value = cM.value = cD.value = cB.value = None
        ws.print_area = f"A1:I{pages * BLOCK}"
        for p in range(1, pages):
            from openpyxl.worksheet.pagebreak import Break
            ws.row_breaks.append(Break(id=p * BLOCK))
        out = a.out or f"사진대지_{a.date}.xlsx"
        wb.save(out)
    print("생성 완료:", out, f"(사진 {len(photos)}장, {pages}페이지)")

if __name__ == "__main__":
    main()
