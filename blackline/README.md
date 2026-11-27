# BLACK LINE SECURITY — 공식 홈페이지

`https://starha2015-svg.github.io/blackline/`

## 구성

- `index.html` — 한 페이지 구성 (히어로 · 현장 기록 · 회사소개 · 미션 · 차별점 · 서비스 · 행사 안내 · 진행절차 · FAQ · 문의)
- `styles.css` — 다크/메탈 톤 디자인, PC·모바일 반응형
- `main.js` — 메뉴, 스크롤 등장, 갤러리 이동, 문의 탭(견적·협업·채용), 메일/문자/복사 연결
- `privacy.html` — 개인정보 처리방침
- `sitemap.xml`, `robots.txt` — 검색엔진 등록용
- `assets/` — 로고(흰색 PNG), OG 이미지, 현장 사진, AI 배경 이미지
- `fonts/` — Pretendard (SIL OFL 1.1)

## 문의 기능

문의 폼은 서버로 아무것도 보내지 않습니다. 입력한 내용을 정리해 보여주고,
방문자의 메일 앱(`mailto:blackline.guard@gmail.com`), 문자 앱(`sms:010-2895-9778`),
또는 클립보드 복사로 전달합니다. 전화는 `tel:`로 바로 연결됩니다.
따라서 별도 백엔드·DB가 필요 없고, 문의 내용이 사이트에 저장되지 않습니다.

## 이미지

- `assets/hero.jpg` — 히어로 대표 이미지(AI 생성). 야간 호텔 앞, 인이어로 교신하는 수행 경호원
- `assets/vip.jpg`, `venue.jpg`, `briefing.jpg` — `FIELD RECORD`의 `대표 비주얼` 탭 3장(AI 생성)
- `assets/team.jpg` — 회사소개 섹션 이미지(AI 생성)
- `assets/event.jpg`, `metal.jpg` — 행사·미션 밴드 배경(AI 생성)
- `assets/field-01~03.jpg` — 기존 공식 사이트(blackline-security.co.kr)의 실제 현장 사진. 메인에는 쓰지 않고 `FIELD RECORD`의 `현장사진` 탭/라이트박스에서만 노출
- `assets/og-image.jpg` — 검색·SNS 공유 썸네일(hero.jpg에서 크롭)

## 수정할 때

- 연락처·주소는 `index.html`과 `privacy.html`에서 문자열 검색으로 바꿉니다.
- 사업자등록번호·경비업 허가번호를 넣으려면 `index.html`의 푸터 `.f-legal`에 덧붙입니다.
- 새 사진은 `assets/`에 넣고 해당 `img`의 `src`와, 라이트박스용 `button.gal-zoom`의 `data-lb-src`를 함께 바꿉니다.
