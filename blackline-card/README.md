# BLACK LINE 명함 편집기

BLACK LINE 팀 명함(90×50mm)을 브라우저에서 바로 수정하고 인쇄용 파일로 내려받는 정적 웹앱입니다.
서버 없이 HTML·CSS·JS만으로 동작하며, 입력한 값은 그 브라우저(localStorage)에만 남습니다.

## 쓰는 법

1. 오른쪽(모바일은 아래) 입력칸에서 이름·직급·연락처·QR 주소를 고칩니다.
2. 앞면 로고 스타일을 고릅니다 — `새 로고`(기본, `BLACK LINE` + `SECURITY` 로고 이미지) / `기존 + SECURITY`(BLACK LINE 텍스트 아래 SECURITY 서브텍스트) / `기존`(BLACK LINE 텍스트만). 세 가지 모두 위·아래 중앙 세로선은 그대로 유지됩니다. `새 로고`를 고르면 뒷면 좌상단도 같은 로고 이미지로 바뀌고, 나머지 두 가지는 뒷면에 회사명 텍스트가 들어갑니다.
3. 미리보기가 바로 바뀌는지 확인합니다.
4. `앞면 PNG 저장` / `뒷면 PNG 저장` (300dpi, 1063×591px) 또는 `앞·뒷면 PDF` (90×50mm, 600dpi 이미지)를 누릅니다.

QR 코드는 입력한 주소·내용으로 그때그때 새로 만들어집니다.
`웹사이트 주소 넣기`를 누르면 QR이 홈페이지 주소로 바뀌고, `원본 링크`를 누르면 원래 QR 내용으로 돌아갑니다.

## 구성

- `index.html` — 화면
- `styles.css` — 스타일
- `app.js` — 명함 렌더링(Canvas)·QR 생성·PNG/PDF 내보내기
- `assets/blackline-logo-ink.png` — 새 로고(`BLACK LINE` + `SECURITY`, 글자 중앙 가로줄·SECURITY 좌우 대시 없음, 투명 배경 4308×807 PNG)
- `vendor/qrcode.js` — QR 생성 (qrcode-generator, MIT)
- `vendor/jspdf.umd.min.js` — PDF 생성 (jsPDF, MIT)
- `fonts/Pretendard-Regular.woff2` · `Pretendard-Medium.woff2` · `Pretendard-Bold.woff2` — 본문·로고 서체 (Pretendard, SIL OFL 1.1)

## 인쇄 메모

PDF는 재단 규격 그대로 90×50mm입니다. 인쇄소에 넘길 때 도련(bleed)이 필요하면 말씀해 주세요.
