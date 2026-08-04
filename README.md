# 현장 문서 자동화

두 갈래가 한 저장소에 있습니다.

| | 내용 | 배포 |
|---|---|---|
| **사진대지 앱** (`public/`, `api/`, `lib/`, `templates/`) | 폰에서 사진을 넣으면 회사 사진대지 양식 그대로 **xlsx + PDF** 생성 | Vercel — 이 저장소를 그대로 배포하면 앱이 열립니다 |
| **현장문서 3종 세트** (`index.html`, `tools/`, `SALES.md`) | 설치 없이 브라우저로 여는 사진대지·공사일보·물량계산기 + 판매 랜딩 | 파일을 직접 열어 사용 (배포 시 서비스되지 않음 — 아래 참고) |

> Vercel은 `public/` 폴더를 사이트 루트로 서비스하므로, 배포된 주소에서는 **사진대지 앱**이 열립니다.
> `index.html`·`tools/`는 저장소에 그대로 남아 있고, 파일을 내려받아 브라우저로 열면 그대로 동작합니다.

---

## 사진대지 앱

- 페이지당 사진 2장, 사진은 칸 안에 자동 가운데 정렬
- 사진이 늘어나면 페이지 자동 추가 (인쇄영역·페이지 나눔 포함)
- PDF는 브라우저에서 바로 생성(인터넷 불필요), xlsx는 서버가 양식 파일에 사진을 삽입

| 경로 | 역할 |
|------|------|
| `public/` | 모바일 화면 (사진 선택·항목 입력·미리보기, PDF 생성) |
| `api/xlsx.js` | 양식 xlsx에 사진을 넣어 내려주는 서버 함수 |
| `lib/build.js` | 엑셀 생성 로직 (ExcelJS) |
| `templates/template.xlsx` | 사진대지 양식 원본 — 양식이 바뀌면 이 파일만 교체 |
| `make_daeji.py` | PC에서 폴더 단위 일괄 생성 (`pip install openpyxl pillow`) |

### Vercel 배포

1. [vercel.com](https://vercel.com) → **Add New → Project** → 이 저장소 **Import**
2. 설정은 기본값(Framework Preset = Other) → **Deploy**
3. 1~2분 뒤 `https://<프로젝트이름>.vercel.app` 발급

### 휴대폰에서 쓰기

1. 발급된 주소를 폰 크롬으로 열기 → 메뉴(⋮) → **홈 화면에 추가**
2. 매일: 사진 촬영 → 갤러리에서 여러 장 선택 → **공유 → 사진대지**
   (또는 앱을 열고 [사진 추가])
3. 위치·내용 확인 → **엑셀(xlsx) 저장** / **PDF 저장**

### 양식 추가·교체

양식은 코드가 아니라 `templates/forms.json` 에 정의돼 있고, 앱 화면 위쪽에서 골라 쓴다
(양식이 1개면 선택칸은 숨겨진다).

**앱에서 바로 추가하기 (휴대폰)**

앱 상단 탭 줄의 **[+ 양식]** → 양식 엑셀 파일을 고르면, 서버가 칸 위치를 읽어 새 탭으로 추가한다.
추가한 양식은 그 기기(브라우저)에 저장되고, 엑셀을 만들 때 양식 파일도 함께 전송된다 —
서버에는 남지 않는다. 탭 이름은 **✎** 로 바꾸고, 이름을 비우면 그 양식을 지운다.

여러 사람이 함께 쓸 양식은 아래처럼 저장소에 등록해 두면 모두에게 기본 탭으로 보인다.

**명령 한 줄로 만들기 (슬랙·PC)**

```bash
node tools/make.js --list                       # 등록된 양식 보기
node tools/make.js --form 용역 --site "양주회천 A-25BL" --date 2026-08-03 \
                   --set 내용="현장 정리" photos/*.jpg
```

양식을 그대로 채운 **xlsx 와 PDF 를 함께** 만든다 (PDF는 LibreOffice가 있을 때).
사진 파일명을 `위치_내용.jpg` 처럼 밑줄로 나누면 앞에서부터 항목에 채워진다.

**저장소에 등록하기 (명령)**

```bash
node tools/add-form.js templates/lh-daeji.xlsx --name "LH 사진대지"
node tools/add-form.js templates/lh-daeji.xlsx --name "LH 사진대지" --dry   # 등록 없이 인식 결과만 확인
```

양식 파일을 `templates/` 에 넣고 위 명령을 실행하면, 사진칸·항목칸·열 너비·행 높이·인쇄 여백을
읽어 `templates/forms.json` 에 등록한다. 인식 결과를 아래처럼 보여주므로 맞는지 확인하면 된다.

```
사진 1칸  : 4~13행 / A~I열, 항목 15,16행 [loc, date, memo, bigo]
```

같은 `--id` 로 다시 실행하면 갱신된다. 인식이 어긋나면 `--block 30`, `--px 7`, `--inset 8` 로
바로잡거나 forms.json 을 직접 손보면 된다.

**직접 쓰는 경우의 형식**

```jsonc
{
  "id": "lh",                       // 겹치지 않는 영문 id
  "name": "LH 사진대지",             // 화면 선택칸에 보이는 이름
  "template": "lh-daeji.xlsx",
  "block": 30,                      // 1페이지가 차지하는 행 수
  "perPage": 2,                     // 페이지당 사진 수
  "pxPerChar": 8,                   // 열 너비 환산 (맑은 고딕 11pt = 8)
  "cols": [1.71, 9.43, ...],        // A열부터 열 너비 (엑셀의 열 너비 값)
  "rows": [49.5, 27, ...],          // 1행부터 행 높이 (pt)
  "margins": { "lr": 0.71, "tb": 0.75 },   // 인쇄 여백 (inch)
  "title": { "row": 1, "cols": [1, 9], "text": "사  진  대  지", "size": 20, "bold": true },
  "site":  { "row": 2, "col": 1, "prefix": "현장명 : ", "size": 11 },
  "photoInset": 12,                 // 사진과 테두리 사이 여백 (px)
  "slots": [                        // 사진 한 장이 들어가는 자리마다
    { "box": { "rows": [4, 13], "cols": [1, 9] },     // 사진칸 위치
      "rows": [                                        // 그 아래 항목 표
        { "row": 15, "cells": [
          { "cols": [1, 2], "label": "위 치" }, { "cols": [3, 5], "field": "loc" },
          { "cols": [6, 6], "label": "일 자" }, { "cols": [7, 9], "field": "date" }] }
      ] }
  ]
}
```

`field` 로 쓸 수 있는 값: `loc`(위치) · `memo`(내용) · `bigo`(비고) · `date`(일자).
행 높이·열 너비는 엑셀에서 행/열 머리글을 끌어보면 나오는 값이며,
`python3 -c "import openpyxl; ..."` 로 확인해도 된다.

미리보기·PDF와 엑셀 삽입이 모두 이 정의 하나를 보고 동작하므로, 정의만 맞으면 세 가지가 함께 맞는다.

---

## 현장문서 3종 세트 (오프라인 HTML)

| 도구 | 파일 | 설명 |
|---|---|---|
| 📷 사진대지 생성기 | [`tools/photo-report.html`](tools/photo-report.html) | 사진 드래그앤드롭 → A4 사진대지. EXIF 촬영일 인식, 2/4/6장 레이아웃 |
| 📋 공사일보 작성기 | [`tools/daily-report.html`](tools/daily-report.html) | 출역인원·장비·자재·작업사항 → 결재란 포함 A4 공사일보 |
| 🧮 물량 계산기 | [`tools/calculator.html`](tools/calculator.html) | 콘크리트 타설량, 철근 중량, 거푸집, 벽돌/블록, 타일 |

파일을 다운로드해 크롬/엣지로 열고, 입력 후 **인쇄 / PDF 저장**을 누릅니다
(여백: 없음, 배경 그래픽: 켜기 권장). 데이터는 브라우저 안에서만 처리됩니다.

판매 실행 계획은 [`SALES.md`](SALES.md) 참고.
