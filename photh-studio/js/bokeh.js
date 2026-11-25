/* 배경 보케 텍스처 생성 — 흐린 배경(base)과 하이라이트 빛망울(glow)을 만든다. */

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/**
 * @param {CanvasImageSource} source 원본(또는 ImageBitmap)
 * @param {number} w 원본 폭
 * @param {number} h 원본 높이
 * @param {HTMLCanvasElement|null} personMask 인물 마스크(있으면 빛망울에서 인물 제외)
 * @returns {{blur: HTMLCanvasElement, glow: HTMLCanvasElement|null}}
 */
export function buildBokehCanvases(source, w, h, personMask) {
  const sw = Math.max(64, Math.min(420, Math.round(w / 7)));
  const sh = Math.max(64, Math.round(sw * h / w));

  // 1) 부드러운 배경: 축소 + 큰 가우시안
  const blur = makeCanvas(sw, sh);
  const bctx = blur.getContext('2d');
  bctx.imageSmoothingQuality = 'high';
  const rBlur = Math.max(1.6, sw * 0.052);
  bctx.filter = `blur(${rBlur.toFixed(2)}px)`;
  bctx.drawImage(source, 0, 0, sw, sh);
  bctx.filter = 'none';

  // 2) 하이라이트 추출 — 인물 영역은 빛망울에서 제외해 인물 주변 번짐(할로)을 막는다
  const hi = makeCanvas(sw, sh);
  const hctx = hi.getContext('2d', { willReadFrequently: true });
  hctx.imageSmoothingQuality = 'high';
  hctx.drawImage(source, 0, 0, sw, sh);

  let maskData = null;
  if (personMask) {
    try {
      const mc = makeCanvas(sw, sh);
      const mctx = mc.getContext('2d', { willReadFrequently: true });
      mctx.imageSmoothingQuality = 'high';
      mctx.filter = `blur(${Math.max(1, sw * 0.006).toFixed(2)}px)`;
      mctx.drawImage(personMask, 0, 0, sw, sh);
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
  const t0 = 0.60, t1 = 0.95;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255;
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    let k = (l - t0) / (t1 - t0);
    k = k <= 0 ? 0 : k >= 1 ? 1 : k;
    k = k * k * (3 - 2 * k);                       // 부드러운 컷
    if (maskData) k *= 1 - Math.min(1, (maskData[i] / 255) * 1.05);
    const boost = 1 + 1.35 * k;
    px[i] = Math.min(255, px[i] * k * boost);
    px[i + 1] = Math.min(255, px[i + 1] * k * boost);
    px[i + 2] = Math.min(255, px[i + 2] * k * boost);
  }
  hctx.putImageData(data, 0, 0);

  // 3) 빛망울: 큰 블러 두 번 → 둥글고 넓게 퍼진 하이라이트
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
