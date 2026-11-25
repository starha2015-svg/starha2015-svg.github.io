/* 배경 보케 텍스처 생성 — 흐린 배경(base)과 하이라이트 빛망울(glow)을 만든다.
   인물 마스크가 있으면 인물을 배경 블러/빛망울에서 완전히 빼고,
   인물 자리는 주변 배경색으로 메워서 인물 주변 번짐(할로)을 없앤다. */

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** 흑백 마스크 캔버스를 알파 마스크(RGB=255, A=마스크값)로 변환 */
function toAlphaMask(maskCanvas, w, h) {
  const cv = makeCanvas(w, h);
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(maskCanvas, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i + 3] = Math.min(255, d[i] * 1.02);
    d[i] = 255; d[i + 1] = 255; d[i + 2] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

/**
 * @param {CanvasImageSource} source 원본(또는 ImageBitmap)
 * @param {number} w 원본 폭
 * @param {number} h 원본 높이
 * @param {HTMLCanvasElement|null} personMask 인물 마스크
 * @returns {{blur: HTMLCanvasElement, glow: HTMLCanvasElement|null}}
 */
export function buildBokehCanvases(source, w, h, personMask) {
  const sw = Math.max(64, Math.min(420, Math.round(w / 7)));
  const sh = Math.max(64, Math.round(sw * h / w));

  const alphaMask = personMask ? toAlphaMask(personMask, sw, sh) : null;

  /* 인물을 뺀 원본 (마스크가 있으면) */
  let base = source;
  if (alphaMask) {
    base = makeCanvas(sw, sh);
    const pctx = base.getContext('2d');
    pctx.imageSmoothingQuality = 'high';
    pctx.drawImage(source, 0, 0, sw, sh);
    pctx.globalCompositeOperation = 'destination-out';
    pctx.drawImage(alphaMask, 0, 0, sw, sh);
    pctx.globalCompositeOperation = 'source-over';
  }

  /* ── 1) 부드러운 배경 ───────────────────────────────── */
  const blur = makeCanvas(sw, sh);
  const bctx = blur.getContext('2d');
  bctx.imageSmoothingQuality = 'high';

  // 1-a) 바탕을 평균 색으로 채워 구멍에서 검은 테가 생기지 않게 한다
  let avg = [160, 160, 160];
  try {
    const one = makeCanvas(1, 1);
    const octx = one.getContext('2d', { willReadFrequently: true });
    octx.drawImage(source, 0, 0, 1, 1);
    const d = octx.getImageData(0, 0, 1, 1).data;
    avg = [d[0], d[1], d[2]];
  } catch (e) { /* 평균색 계산 실패 시 중간 회색 */ }
  bctx.fillStyle = `rgb(${avg[0]},${avg[1]},${avg[2]})`;
  bctx.fillRect(0, 0, sw, sh);

  // 1-b) 인물 구멍 가장자리를 주변 배경으로 메운다 (가장자리 확장)
  if (alphaMask) {
    const off = Math.max(2, Math.round(sw * 0.035));
    bctx.globalAlpha = 0.55;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      bctx.drawImage(base, Math.cos(a) * off, Math.sin(a) * off, sw, sh);
    }
    bctx.globalAlpha = 1;
  }

  // 1-c) 아주 부드러운 저주파 레이어 (인물이 빠진 상태에서)
  const softW = Math.max(8, Math.round(sw / 5));
  const softH = Math.max(8, Math.round(sh / 5));
  const soft = makeCanvas(softW, softH);
  const sctx = soft.getContext('2d');
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(base, 0, 0, softW, softH);
  bctx.filter = `blur(${Math.max(1, sw * 0.075).toFixed(2)}px)`;
  bctx.drawImage(soft, 0, 0, sw, sh);
  bctx.filter = 'none';

  // 1-c) 배경 디테일을 적당히 블러해 위에 얹기
  const rBlur = Math.max(1.6, sw * 0.052);
  bctx.filter = `blur(${rBlur.toFixed(2)}px)`;
  bctx.drawImage(base, 0, 0, sw, sh);
  bctx.filter = 'none';

  /* ── 2) 하이라이트 빛망울 ───────────────────────────── */
  const hi = makeCanvas(sw, sh);
  const hctx = hi.getContext('2d', { willReadFrequently: true });
  hctx.imageSmoothingQuality = 'high';
  hctx.drawImage(source, 0, 0, sw, sh);

  let maskData = null;
  if (alphaMask) {
    try {
      const mc = makeCanvas(sw, sh);
      const mctx = mc.getContext('2d', { willReadFrequently: true });
      mctx.filter = `blur(${Math.max(1, sw * 0.005).toFixed(2)}px)`;
      mctx.drawImage(alphaMask, 0, 0, sw, sh);
      mctx.filter = 'none';
      maskData = mctx.getImageData(0, 0, sw, sh).data;
    } catch (e) {
      maskData = null;
    }
  }

  let data;
  try {
    data = hctx.getImageData(0, 0, sw, sh);
  } catch (e) {
    return { blur, glow: null };
  }
  const px = data.data;
  const t0 = 0.66, t1 = 0.99;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255;
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    let k = (l - t0) / (t1 - t0);
    k = k <= 0 ? 0 : k >= 1 ? 1 : k;
    k = k * k * (3 - 2 * k);
    if (maskData) k *= 1 - Math.min(1, maskData[i + 3] / 255);
    const boost = 1 + 1.0 * k;
    px[i] = Math.min(255, px[i] * k * boost);
    px[i + 1] = Math.min(255, px[i + 1] * k * boost);
    px[i + 2] = Math.min(255, px[i + 2] * k * boost);
  }
  hctx.putImageData(data, 0, 0);

  let cur = hi;
  const rGlow = Math.max(1.5, sw * 0.05);
  for (let i = 0; i < 2; i++) {
    const next = makeCanvas(sw, sh);
    const nctx = next.getContext('2d');
    nctx.imageSmoothingQuality = 'high';
    nctx.filter = `blur(${(rGlow * (i + 1)).toFixed(2)}px)`;
    nctx.drawImage(cur, 0, 0, sw, sh);
    nctx.filter = 'none';
    cur = next;
  }

  return { blur, glow: cur };
}
