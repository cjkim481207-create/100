# 사진대지 자동생성

현장에서 찍은 사진을 넣으면 **회사 사진대지 양식 그대로** 엑셀(xlsx)과 PDF를 만들어 주는 모바일 웹앱.

## 구성

| 경로 | 역할 |
|------|------|
| `public/` | 모바일 화면 (사진 선택·항목 입력·미리보기, PDF는 브라우저에서 직접 생성) |
| `api/xlsx.js` | 양식 xlsx에 사진을 삽입해 엑셀 파일로 내려주는 서버 함수 |
| `lib/build.js` | 엑셀 생성 로직 (ExcelJS) |
| `templates/template.xlsx` | 사진대지 양식 원본 — 양식이 바뀌면 이 파일만 교체 |
| `make_daeji.py` | PC에서 폴더 단위로 일괄 생성 (`pip install openpyxl pillow`) |

- 페이지당 사진 2장, 사진은 칸 안에 자동 가운데 정렬
- 사진이 늘어나면 페이지 자동 추가 (인쇄영역·페이지 나눔 포함)

## Vercel 배포

1. [vercel.com](https://vercel.com) 로그인 → **Add New → Project**
2. 이 GitHub 저장소를 **Import** (설정은 모두 기본값, Framework Preset = Other)
3. **Deploy** → 1~2분 뒤 `https://<프로젝트이름>.vercel.app` 주소 발급

## 휴대폰에서 쓰기

1. 발급된 주소를 폰 크롬으로 열기 → 메뉴(⋮) → **홈 화면에 추가**
2. 매일: 사진 촬영 → 갤러리에서 여러 장 선택 → **공유 → 사진대지**
   (또는 앱을 열고 [사진 추가])
3. 위치·내용 확인 → **엑셀(xlsx) 저장** / **PDF 저장**

PDF는 인터넷이 없어도 만들어지고, 엑셀은 서버를 거칩니다.

## 양식을 바꿀 때

`templates/template.xlsx`를 새 양식으로 교체하고, 칸 위치가 달라졌다면
`lib/build.js`와 `public/app.js` 위쪽의 `BOX`·`INF`·`COLW`·`ROWH` 값을 맞춰 주세요.
