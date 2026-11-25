# PHOTH Studio — 지우개 프록시 (Cloudflare Worker)

`photh-eraser-proxy.js` 는 사이트의 **지우개** 기능이 fal.ai 를 부르는 얇은 프록시입니다.
브라우저는 이 Worker 로만 사진과 마스크를 보내고, `FAL_KEY` 는 Worker Secret 에만 있습니다.

- 엔드포인트: `POST /erase` (헤더 `X-Photh-Auth`), `GET /health`
- 모델: `fal-ai/object-removal/mask` (마스크 흰색 = 지울 영역)
- Secret: `FAL_KEY` (fal.ai API 키), `PHOTH_TOKEN` (사이트 잠금 토큰과 동일)

배포: Cloudflare 대시보드 → Workers & Pages → `photh-eraser-proxy` → Edit code 에 이 파일을 붙여넣고 Deploy.
