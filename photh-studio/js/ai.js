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
  }
  const coverage = skinCount / (mw * mh);

  res.close?.();

  let skinCanvas = maskFromFloat(skinArr, mw, mh, 1.6);
  const personCanvas = maskFromFloat(personArr, mw, mh, 3.4, 0.85);

  // 눈·입술·눈썹은 스무딩에서 제외 (표정과 디테일 보존)
  let faces = 0;
  try {
    const lm = await getFaceLandmarker();
    const fres = lm.detect(input);
    faces = fres.faceLandmarks ? fres.faceLandmarks.length : 0;
    if (faces > 0) {
      skinCanvas = protectFeatures(skinCanvas, fres.faceLandmarks, iw, ih, mw, mh);
    }
    fres.close?.();
  } catch (e) {
    /* 얼굴 인식 실패는 무시 — 피부 마스크만으로 동작 */
  }

  return {
    skin: skinCanvas,
    person: personCanvas,
    mode: 'ai',
    coverage,
    faces,
    size: [mw, mh]
  };
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
