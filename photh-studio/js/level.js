/* 자동 수평 — 브라우저 안에서만 계산한다.
   1) Sobel 엣지 방향 히스토그램으로 ±15° 범위의 지배적인 수평/수직선을 찾고
   2) 선이 거의 없는 근접 인물 사진은 눈 중심 각도를 보조로 쓴다(±8° 클램프). */

const LIMIT = 15;      // 슬라이더 범위
const BIN = 0.25;      // 히스토그램 간격(도)

export function estimateTilt(source, w, h, faceAngle) {
  let edge = null;
  try {
    edge = edgeTilt(source, w, h);
  } catch (e) {
    edge = null;
  }

  if (edge && edge.total > 22 && edge.confidence >= 0.11) {
    return { angle: clamp(edge.angle, -LIMIT, LIMIT), source: 'edge' };
  }
  if (typeof faceAngle === 'number' && isFinite(faceAngle)) {
    return { angle: clamp(-faceAngle, -8, 8), source: 'face' };
  }
  if (edge && edge.total > 8) {
    return { angle: clamp(edge.angle, -LIMIT, LIMIT), source: 'edge' };
  }
  return { angle: 0, source: 'none' };
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function edgeTilt(source, w, h) {
  const maxDim = 420;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const cw = Math.max(32, Math.round(w * scale));
  const ch = Math.max(32, Math.round(h * scale));

  const cvs = document.createElement('canvas');
  cvs.width = cw;
  cvs.height = ch;
  const ctx = cvs.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, cw, ch);
  const data = ctx.getImageData(0, 0, cw, ch).data;

  const n = cw * ch;
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    lum[i] = (0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2]) / 255;
  }

  const bins = new Float32Array(Math.round((2 * LIMIT) / BIN) + 1);
  let total = 0;

  for (let y = 1; y < ch - 1; y++) {
    for (let x = 1; x < cw - 1; x++) {
      const i = y * cw + x;
      const tl = lum[i - cw - 1], tc = lum[i - cw], tr = lum[i - cw + 1];
      const ml = lum[i - 1], mr = lum[i + 1];
      const bl = lum[i + cw - 1], bc = lum[i + cw], br = lum[i + cw + 1];
      const gx = (tr + 2 * mr + br) - (tl + 2 * ml + bl);
      const gy = (bl + 2 * bc + br) - (tl + 2 * tc + tr);
      const mag = Math.sqrt(gx * gx + gy * gy);
      if (mag < 0.12) continue;

      // 엣지의 진행 방향(그라디언트 + 90°)을 -90~90°로 접는다
      let a = Math.atan2(gy, gx) * 180 / Math.PI + 90;
      a = ((a + 90) % 180 + 180) % 180 - 90;

      let corr;
      if (Math.abs(a) <= LIMIT) corr = -a;                       // 수평선
      else if (Math.abs(a) >= 90 - LIMIT) corr = -(a - Math.sign(a) * 90); // 수직선
      else continue;

      // 0°에 가까운 선에 조금 더 무게를 준다 (원근 왜곡 완화)
      const weight = mag * (1 - 0.35 * Math.min(1, Math.abs(corr) / LIMIT));
      const idx = clamp(Math.round((corr + LIMIT) / BIN), 0, bins.length - 1);
      bins[idx] += weight;
      total += weight;
    }
  }

  if (!total) return { angle: 0, total: 0, confidence: 0 };

  // 이웃 빈으로 부드럽게 만든 뒤 최대 지점 탐색
  const smooth = new Float32Array(bins.length);
  const k = 4; // ±1°
  for (let i = 0; i < bins.length; i++) {
    let s = 0, wsum = 0;
    for (let j = -k; j <= k; j++) {
      const t = i + j;
      if (t < 0 || t >= bins.length) continue;
      const wgt = 1 - Math.abs(j) / (k + 1);
      s += bins[t] * wgt;
      wsum += wgt;
    }
    smooth[i] = s / wsum;
  }

  let best = 0;
  for (let i = 1; i < smooth.length; i++) if (smooth[i] > smooth[best]) best = i;

  // 최대 지점 주변 ±2° 무게 중심
  let ws = 0, vs = 0, local = 0;
  const span = Math.round(2 / BIN);
  for (let i = Math.max(0, best - span); i <= Math.min(bins.length - 1, best + span); i++) {
    const ang = i * BIN - LIMIT;
    ws += bins[i];
    vs += bins[i] * ang;
    local += bins[i];
  }
  const angle = ws > 0 ? vs / ws : best * BIN - LIMIT;
  return { angle, total, confidence: local / total };
}
