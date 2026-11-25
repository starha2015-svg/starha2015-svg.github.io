/* 색공간 통계 — 레퍼런스 색감 매칭(Reinhard Lab transfer)과 보정량 추정에 사용. */

const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function linearToSrgb(c) {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

const Xn = 0.95047, Yn = 1.0, Zn = 1.08883;
const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
const finv = t => { const t3 = t * t * t; return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787; };

export function rgbToLab(r, g, b) {
  const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);
  const X = 0.4124564 * R + 0.3575761 * G + 0.1804375 * B;
  const Y = 0.2126729 * R + 0.7151522 * G + 0.0721750 * B;
  const Z = 0.0193339 * R + 0.1191920 * G + 0.9503041 * B;
  const fx = f(X / Xn), fy = f(Y / Yn), fz = f(Z / Zn);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/**
 * 캔버스/이미지에서 축소 샘플링으로 Lab 평균·표준편차를 구한다.
 * @returns {{mean:number[], std:number[], meanRGB:number[], luma:number, pixels:number}}
 */
export function imageStats(source, maxDim = 256) {
  const sw = source.width || source.naturalWidth;
  const sh = source.height || source.naturalHeight;
  const scale = Math.min(1, maxDim / Math.max(sw, sh));
  const w = Math.max(8, Math.round(sw * scale));
  const h = Math.max(8, Math.round(sh * scale));

  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);

  let data;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch (e) {
    return { mean: [56, 8, 8], std: [18, 8, 8], meanRGB: [0.5, 0.5, 0.5], luma: 0.5, pixels: 0 };
  }

  let mL = 0, mA = 0, mB = 0, sL = 0, sA = 0, sB = 0, n = 0;
  let mR = 0, mG = 0, mBl = 0, mY = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
    const [L, A, B] = rgbToLab(r, g, b);
    mL += L; mA += A; mB += B;
    sL += L * L; sA += A * A; sB += B * B;
    mR += r; mG += g; mBl += b;
    mY += 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
    n++;
  }
  mL /= n; mA /= n; mB /= n;
  mR /= n; mG /= n; mBl /= n; mY /= n;
  return {
    mean: [mL, mA, mB],
    std: [Math.sqrt(Math.max(0, sL / n - mL * mL)), Math.sqrt(Math.max(0, sA / n - mA * mA)), Math.sqrt(Math.max(0, sB / n - mB * mB))],
    meanRGB: [mR, mG, mBl],
    luma: mY,
    pixels: n
  };
}

/** 두 통계로부터 체감되는 보정량을 추정 (UI 표시용) */
export function estimateAdjust(srcStats, refStats) {
  const srcY = Math.max(1e-4, srcStats.luma);
  const refY = Math.max(1e-4, refStats.luma);
  const ev = Math.log2(refY / srcY);
  const contrast = (refStats.std[0] / Math.max(1e-3, srcStats.std[0]) - 1) * 100;
  const db = refStats.mean[2] - srcStats.mean[2];
  const kelvin = Math.round(db * 42 / 10) * 10;
  const da = refStats.mean[1] - srcStats.mean[1];
  return { ev, contrast, kelvin, tint: da };
}

export function fmtEV(ev) {
  const v = Math.abs(ev) < 0.05 ? 0 : ev;
  const s = v > 0 ? '+' : '';
  return `${s}${v.toFixed(2).replace(/0$/, '')}EV`;
}
export function fmtSigned(v, unit = '') {
  const n = Math.round(v);
  const s = n > 0 ? '+' : '';
  return `${s}${n}${unit}`;
}
