/* 인물 마스크 — MediaPipe(Image Segmenter + Face Landmarker)로 피부·인물 영역을 뽑고,
   실패하면 피부톤 기반 마스크로 안전하게 폴백한다. 모든 계산은 브라우저 안에서만. */

const MP_VERSION = '0.10.14';
const MP_MODULE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/vision_bundle.mjs`;
const MP_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
const SEG_MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/1/selfie_multiclass_256x256.tflite';
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

const EYE_A = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
const EYE_B = [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398];
const LIPS = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185];
const BROW_A = [70, 63, 105, 66, 107, 55, 65, 52, 53, 46];
const BROW_B = [300, 293, 334, 296, 336, 285, 295, 282, 283, 276];

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/* ── 폴백: 피부톤 기반 마스크 ─────────────────────────── */
export function buildFallbackMasks(source, w, h) {
  const maxDim = 220;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const mw = Math.max(16, Math.round(w * scale));
  const mh = Math.max(16, Math.round(h * scale));

  const base = makeCanvas(mw, mh);
  const bctx = base.getContext('2d', { willReadFrequently: true });
  bctx.imageSmoothingQuality = 'high';
  bctx.drawImage(source, 0, 0, mw, mh);

  let img;
  try { img = bctx.getImageData(0, 0, mw, mh); } catch (e) { return { skin: null, person: null, mode: 'none' }; }
  const px = img.data;

  const skin = new Float32Array(mw * mh);
  let found = 0;
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      const i = (y * mw + x) * 4;
      const r = px[i], g = px[i + 1], b = px[i + 2];
      const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
      const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
      const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

      let p = 1;
      const dcb = Math.abs(cb - 103);
      const dcr = Math.abs(cr - 152);
      p *= 1 - Math.min(1, Math.max(0, (dcb - 12) / 20));
      p *= 1 - Math.min(1, Math.max(0, (dcr - 14) / 22));
      p *= Math.min(1, Math.max(0, (luma - 0.12) / 0.14));
      p *= 1 - Math.min(1, Math.max(0, (luma - 0.94) / 0.06));

      // 중앙 가중 (따뜻한 배경 오검출 완화)
      const dx = (x / mw - 0.5) * 1.1, dy = (y / mh - 0.5) * 1.1;
      const d = Math.sqrt(dx * dx + dy * dy);
      p *= 0.35 + 0.65 * (1 - Math.min(1, d / 0.62));

      skin[y * mw + x] = p;
      if (p > 0.5) found++;
    }
  }

  const covered = found / (mw * mh);
  if (covered < 0.004) return { skin: null, person: null, mode: 'none' };

  const skinCanvas = maskFromFloat(skin, mw, mh, 3.2);
  const personCanvas = maskFromFloat(skin, mw, mh, 10.0, 0.55);
  return { skin: skinCanvas, person: personCanvas, mode: 'fallback', coverage: covered };
}

function maskFromFloat(arr, w, h, blurPx, gamma) {
  const cv = makeCanvas(w, h);
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(w, h);
  const g = gamma || 1;
  for (let i = 0; i < arr.length; i++) {
    let v = Math.max(0, Math.min(1, arr[i]));
    if (g !== 1) v = Math.pow(v, g);
    const b = Math.round(v * 255);
    img.data[i * 4] = b;
    img.data[i * 4 + 1] = b;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  if (blurPx > 0) {
    const out = makeCanvas(w, h);
    const octx = out.getContext('2d');
    octx.filter = `blur(${blurPx}px)`;
    octx.drawImage(cv, 0, 0);
    octx.filter = 'none';
    return out;
  }
  return cv;
}

/* ── MediaPipe 로더 ──────────────────────────────────── */
let segPromise = null;
let facePromise = null;

async function getSegmenter() {
  if (!segPromise) {
    segPromise = (async () => {
      const { FilesetResolver, ImageSegmenter } = await import(MP_MODULE);
      const fileset = await FilesetResolver.forVisionTasks(MP_WASM);
      const opts = {
        baseOptions: { modelAssetPath: SEG_MODEL, delegate: 'GPU' },
        runningMode: 'IMAGE',
        outputCategoryMask: false,
        outputConfidenceMasks: true
      };
      try {
        return await ImageSegmenter.createFromOptions(fileset, opts);
      } catch (e) {
        opts.baseOptions.delegate = 'CPU';
        return await ImageSegmenter.createFromOptions(fileset, opts);
      }
    })().catch(err => { segPromise = null; throw err; });
  }
  return segPromise;
}

async function getFaceLandmarker() {
  if (!facePromise) {
    facePromise = (async () => {
      const { FilesetResolver, FaceLandmarker } = await import(MP_MODULE);
      const fileset = await FilesetResolver.forVisionTasks(MP_WASM);
      const opts = {
        baseOptions: { modelAssetPath: FACE_MODEL, delegate: 'GPU' },
        runningMode: 'IMAGE',
        numFaces: 3
      };
      try {
        return await FaceLandmarker.createFromOptions(fileset, opts);
      } catch (e) {
        opts.baseOptions.delegate = 'CPU';
        return await FaceLandmarker.createFromOptions(fileset, opts);
      }
    })().catch(err => { facePromise = null; throw err; });
  }
  return facePromise;
}

/* ── 인물 분석 ───────────────────────────────────────── */
let analysisQueue = Promise.resolve();

export function analyzePortrait(source, w, h) {
  const run = () => analyzePortraitInner(source, w, h);
  const p = analysisQueue.then(run, run);
  analysisQueue = p.catch(() => {});
  return p;
}

async function analyzePortraitInner(source, w, h) {
  // 분석용 입력 (최대 512px)
  const maxDim = 512;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const iw = Math.max(32, Math.round(w * scale));
  const ih = Math.max(32, Math.round(h * scale));
  const input = makeCanvas(iw, ih);
  const ictx = input.getContext('2d', { willReadFrequently: true });
  ictx.imageSmoothingQuality = 'high';
  ictx.drawImage(source, 0, 0, iw, ih);

  const segmenter = await getSegmenter();
  const res = segmenter.segment(input);

  const conf = res.confidenceMasks;
  if (!conf || conf.length < 4) {
    res.close?.();
    throw new Error('no confidence masks');
  }

  const mw = conf[0].width, mh = conf[0].height;
  const bg = conf[0].getAsFloat32Array();
  const hair = conf[1].getAsFloat32Array();
  const bodySkin = conf[2].getAsFloat32Array();
  const faceSkin = conf[3].getAsFloat32Array();
  const clothes = conf[4] ? conf[4].getAsFloat32Array() : null;
  const other = conf[5] ? conf[5].getAsFloat32Array() : null;

  const skinArr = new Float32Array(mw * mh);
  const personArr = new Float32Array(mw * mh);
  const hairArr = new Float32Array(mw * mh);
  let skinCount = 0;
  for (let i = 0; i < mw * mh; i++) {
    const s = Math.min(1, bodySkin[i] + faceSkin[i]);
    // 부드러운 S 커브로 경계 정리
    const q = s <= 0.32 ? 0 : s >= 0.72 ? 1 : (() => { const t = (s - 0.32) / 0.4; return t * t * (3 - 2 * t); })();
    skinArr[i] = q;
    if (q > 0.5) skinCount++;

    let p = 1 - bg[i];
    if (hair) p = Math.max(p, hair[i]);
    if (clothes) p = Math.max(p, clothes[i] * 0.98);
    if (other) p = Math.max(p, other[i] * 0.9);
    personArr[i] = Math.min(1, p);
    hairArr[i] = hair ? Math.min(1, hair[i]) : 0;
  }
  const coverage = skinCount / (mw * mh);

  res.close?.();

  let skinCanvas = maskFromFloat(skinArr, mw, mh, 1.6);
  const personCanvas = maskFromFloat(personArr, mw, mh, 3.4, 0.85);

  // 눈·입술·눈썹은 스무딩에서 제외 (표정과 디테일 보존)
  let faces = 0;
  let faceAngle = null;
  let faceCanvas = null;
  let features = null;
  try {
    const lm = await getFaceLandmarker();
    const fres = lm.detect(input);
    faces = fres.faceLandmarks ? fres.faceLandmarks.length : 0;
    if (faces > 0) {
      skinCanvas = protectFeatures(skinCanvas, fres.faceLandmarks, iw, ih, mw, mh);
      faceCanvas = buildFaceDepth(fres.faceLandmarks, iw, ih, mw, mh);
      features = buildFeatureMasks(fres.faceLandmarks, mw, mh);
      const a = fres.faceLandmarks[0][33];
      const b = fres.faceLandmarks[0][263];
      if (a && b) {
        const dx = (b.x - a.x) * iw;
        const dy = (b.y - a.y) * ih;
        faceAngle = Math.atan2(dy, dx) * 180 / Math.PI;
      }
    }
    fres.close?.();
  } catch (e) {
    /* 얼굴 인식 실패는 무시 — 피부 마스크만으로 동작 */
  }

  return {
    skin: skinCanvas,
    person: personCanvas,
    face: faceCanvas,
    hair: hair ? maskFromFloat(hairArr, mw, mh, 3.0) : null,
    eyes: features ? features.eyes : null,
    lips: features ? features.lips : null,
    teeth: features ? features.teeth : null,
    cheek: features ? features.cheek : null,
    underEye: features ? features.underEye : null,
    catchlight: features ? features.catchlight : null,
    shape: features ? features.shape : null,
    faceAngle,
    mode: 'ai',
    coverage,
    faces,
    size: [mw, mh]
  };
}

/* 얼굴 랜드마크 → 부위별 마스크(눈·입술·치아·볼·눈밑·캐치라이트)와 얼굴형 좌표 */
const LIPS_OUTER = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146];
const MOUTH_INNER = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95];

function buildFeatureMasks(landmarksList, mw, mh) {
  const lms = landmarksList[0];
  if (!lms) return null;
  const P = i => (lms[i] ? [lms[i].x * mw, lms[i].y * mh] : null);
  const jawL = P(234), jawR = P(454), chin = P(152), top = P(10);
  if (!jawL || !jawR) return null;

  const faceW = Math.hypot(jawR[0] - jawL[0], jawR[1] - jawL[1]) || Math.min(mw, mh) * 0.3;
  const faceH = chin && top ? Math.abs(chin[1] - top[1]) : faceW * 1.25;
  const cx = (jawL[0] + jawR[0]) / 2;

  const blank = () => {
    const c = makeCanvas(mw, mh);
    const x = c.getContext('2d');
    x.fillStyle = '#000';
    x.fillRect(0, 0, mw, mh);
    return { c, x };
  };
  const soften = (src, px) => {
    const o = makeCanvas(mw, mh);
    const octx = o.getContext('2d');
    octx.filter = `blur(${px}px)`;
    octx.drawImage(src, 0, 0);
    return o;
  };
  const poly = (ctx, idxs) => {
    const pts = idxs.map(i => [lms[i].x * mw, lms[i].y * mh]);
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.closePath();
    ctx.fill();
  };
  const blob = (ctx, x, y, rx, ry, a) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(0.55, `rgba(255,255,255,${a * 0.72})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, ry / Math.max(rx, ry));
    ctx.translate(-x, -y);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(rx, ry), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  // 눈 영역 (윤곽 + 홍채 중심)
  const eye = blank();
  eye.x.fillStyle = '#fff';
  for (const grp of [EYE_A, EYE_B]) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const idx of grp) {
      const p = P(idx);
      if (!p) continue;
      x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
      y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
    }
    if (x1 < x0) continue;
    eye.x.beginPath();
    eye.x.ellipse((x0 + x1) / 2, (y0 + y1) / 2, Math.max(2, (x1 - x0) * 0.62), Math.max(2, (y1 - y0) * 0.8), 0, 0, Math.PI * 2);
    eye.x.fill();
  }

  // 입술
  const lip = blank();
  lip.x.fillStyle = '#fff';
  try { poly(lip.x, LIPS_OUTER); } catch (e) { /* 무시 */ }

  // 치아(입 안쪽) — 밝기를 곱해 실제 치아만 남긴다
  const teeth = blank();
  teeth.x.fillStyle = '#fff';
  try { poly(teeth.x, MOUTH_INNER); } catch (e) { /* 무시 */ }

  // 볼
  const cheek = blank();
  const lcC = P(50), rcC = P(280);
  const cheekR = Math.max(4, faceW * 0.24);
  if (lcC) blob(cheek.x, lcC[0], lcC[1], cheekR, cheekR * 0.85, 0.95);
  if (rcC) blob(cheek.x, rcC[0], rcC[1], cheekR, cheekR * 0.85, 0.95);

  // 눈 밑
  const under = blank();
  const eyeLc = P(145), eyeRc = P(374);
  const uR = Math.max(3, faceW * 0.17);
  if (eyeLc) blob(under.x, eyeLc[0], eyeLc[1] + uR * 0.35, uR, uR * 0.62, 0.9);
  if (eyeRc) blob(under.x, eyeRc[0], eyeRc[1] + uR * 0.35, uR, uR * 0.62, 0.9);

  // 캐치라이트 (홍채 중심에서 살짝 위)
  const catchL = blank();
  const irisL = P(468) || eyeLc, irisR = P(473) || eyeRc;
  const cR = Math.max(2, faceW * 0.055);
  if (irisL) blob(catchL.x, irisL[0] + cR * 0.45, irisL[1] - cR * 0.5, cR, cR, 1);
  if (irisR) blob(catchL.x, irisR[0] + cR * 0.45, irisR[1] - cR * 0.5, cR, cR, 1);

  const shape = {
    jawL, jawR, chin, top, faceW, faceH, cx,
    eyeL: eyeLc, eyeR: eyeRc,
    noseL: P(129), noseR: P(358),
    mouthL: P(61), mouthR: P(291)
  };

  return {
    eyes: soften(eye.c, 1.6),
    lips: soften(lip.c, 1.8),
    teeth: soften(teeth.c, 1.2),
    cheek: soften(cheek.c, 6),
    underEye: soften(under.c, 3.5),
    catchlight: soften(catchL.c, 1.0),
    shape
  };
}

/* 얼굴 랜드마크 → 2.5D 높이장(얼굴 돔 + 코). 햇빛 방향 계산에 쓰인다. */
function buildFaceDepth(landmarksList, iw, ih, mw, mh) {
  const arr = new Float32Array(mw * mh);
  let any = false;
  for (const lms of landmarksList) {
    const pt = i => {
      const p = lms[i];
      return p ? [p.x * mw, p.y * mh] : null;
    };
    const top = pt(10), nose = pt(1), chin = pt(152), lc = pt(234), rc = pt(454);
    if (!top || !nose || !chin || !lc || !rc) continue;
    const faceW = Math.hypot(rc[0] - lc[0], rc[1] - lc[1]);
    if (!(faceW > 4)) continue;
    any = true;
    const cx = (lc[0] + rc[0]) / 2;
    const cy = (top[1] + chin[1]) / 2;
    const rx = Math.max(4, faceW * 0.66);
    const ry = Math.max(4, Math.abs(chin[1] - top[1]) * 0.62);
    for (let y = Math.max(0, Math.floor(cy - ry)); y < Math.min(mh, Math.ceil(cy + ry)); y++) {
      for (let x = Math.max(0, Math.floor(cx - rx)); x < Math.min(mw, Math.ceil(cx + rx)); x++) {
        const dx = (x - cx) / rx, dy = (y - cy) / ry;
        const d2 = dx * dx + dy * dy;
        if (d2 >= 1) continue;
        const v = Math.sqrt(1 - d2) * 0.82;
        const i = y * mw + x;
        if (v > arr[i]) arr[i] = v;
      }
    }
    // 코: 작고 뾰족한 봉우리
    const sigma = Math.max(2, faceW * 0.13);
    const rad = Math.ceil(sigma * 3);
    for (let y = Math.max(0, Math.floor(nose[1]) - rad); y < Math.min(mh, Math.ceil(nose[1]) + rad); y++) {
      for (let x = Math.max(0, Math.floor(nose[0]) - rad); x < Math.min(mw, Math.ceil(nose[0]) + rad); x++) {
        const dx = x - nose[0], dy = y - nose[1];
        const v = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma)) * 0.55;
        const i = y * mw + x;
        arr[i] = Math.min(1, arr[i] + v);
      }
    }
  }
  if (!any) return null;
  return maskFromFloat(arr, mw, mh, 1.4);
}

function protectFeatures(skinCanvas, landmarksList, iw, ih, mw, mh) {
  const out = makeCanvas(mw, mh);
  const ctx = out.getContext('2d');
  ctx.drawImage(skinCanvas, 0, 0, mw, mh);
  ctx.globalCompositeOperation = 'destination-out';

  const sx = mw / iw, sy = mh / ih;
  for (const lms of landmarksList) {
    const groups = [EYE_A, EYE_B, LIPS, BROW_A, BROW_B];
    const scales = [1.15, 1.15, 1.05, 1.0, 1.0];
    groups.forEach((grp, gi) => {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const idx of grp) {
        const pt = lms[idx];
        if (!pt) continue;
        const x = pt.x * mw, y = pt.y * mh;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      if (x1 < x0) return;
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const rx = Math.max(2, ((x1 - x0) / 2) * scales[gi]);
      const ry = Math.max(2, ((y1 - y0) / 2) * scales[gi]);
      const grad = ctx.createRadialGradient(cx, cy, Math.min(rx, ry) * 0.55, cx, cy, Math.max(rx, ry));
      grad.addColorStop(0, 'rgba(0,0,0,1)');
      grad.addColorStop(0.72, 'rgba(0,0,0,0.95)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(rx / Math.max(rx, ry), ry / Math.max(rx, ry));
      ctx.translate(-cx, -cy);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(rx, ry), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }
  ctx.globalCompositeOperation = 'source-over';
  return out;
}
