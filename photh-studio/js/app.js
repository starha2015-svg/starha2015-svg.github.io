import { PRESETS, PRESET_BY_ID, blendLook } from './presets.js?v=33';
import { Renderer } from './gl.js?v=33';
import { buildBokehCanvases } from './bokeh.js?v=33';
import { imageStats, estimateAdjust, fmtEV, fmtSigned } from './color.js?v=33';
import { buildFallbackMasks, analyzePortrait } from './ai.js?v=33';
import { estimateTilt } from './level.js?v=33';
import { initEraser } from './eraser.js?v=33';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

/* 진단용: 예상치 못한 오류를 조용히 모아 둔다 (화면에는 나오지 않음) */
window.__phothErrors = window.__phothErrors || [];
window.addEventListener('error', e => window.__phothErrors.push(String(e.message || e)));
window.addEventListener('unhandledrejection', e => window.__phothErrors.push('promise: ' + String((e.reason && e.reason.message) || e.reason)));

const els = {
  app: $('#app'),
  stage: $('.stage'),
  canvasScroll: $('#canvasScroll'),
  canvasInner: $('#canvasInner'),
  beforeCanvas: $('#beforeCanvas'),
  afterCanvas: $('#afterCanvas'),
  afterHolder: $('#afterHolder'),
  compareLine: $('#compareLine'),
  emptyState: $('#emptyState'),
  fileInput: $('#fileInput'),
  filmstrip: $('#filmstrip'),
  filmTrack: $('#filmTrack'),
  presetGrid: $('#presetGrid'),
  presetStrength: $('#presetStrength'),
  presetStrengthOut: $('#presetStrengthOut'),
  panelPresets: $('#panelPresets'),
  panelAdjust: $('#panelAdjust'),
  backdrop: $('#sheetBackdrop'),
  toast: $('#toast'),
  fileName: $('#fileName'),
  fileMeta: $('#fileMeta'),
  fileChip: $('#fileChip'),
  aiStatus: $('#aiStatus'),
  aiStatusText: $('#aiStatusText'),
  exportProgress: $('#exportProgress'),
  exportBar: $('#exportBar'),
  exportProgressText: $('#exportProgressText'),
  estimate: $('#estimate'),
  estimateChips: $('#estimateChips'),
  refDrop: $('#refDrop'),
  refInput: $('#refInput'),
  refEmpty: $('#refEmpty'),
  refFilled: $('#refFilled'),
  refThumb: $('#refThumb'),
  refName: $('#refName'),
  refSize: $('#refSize'),
  btnRefBatch: $('#btnRefBatch'),
  namePreview: $('#namePreview'),
  metaName: $('#metaName'),
  metaSize: $('#metaSize'),
  metaCount: $('#metaCount'),
  qualityRow: $('#qualityRow'),
  showMask: $('#showMask'),
  btnCompare: $('#btnCompare'),
  btnHold: $('#btnHold'),
  sunPad: $('#sunPad'),
  sunHandle: $('#sunHandle'),
  tiltStatus: $('#tiltStatus'),
  bgColor: $('#bgColor'),
  hslDots: $('#hslDots'),
  hslName: $('#hslName'),
  btnAutoLevel: $('#btnAutoLevel'),
  btnRefSave: $('#btnRefSave'),
  refSavedList: $('#refSavedList'),
  refSavedEmpty: $('#refSavedEmpty')
};

function updateMeta() {
  const item = activeItem();
  els.metaName.textContent = item ? item.name : '—';
  els.metaSize.textContent = item ? `${item.width} × ${item.height}` : '—';
  els.metaCount.textContent = String(state.items.length);
}

/* ── 상태 ────────────────────────────────────────────── */
const state = {
  items: [],
  activeId: null,
  refs: new Map(),
  refSeq: 0,
  hslSel: 0,
  compare: false,
  split: 50,
  zoom: 1,
  maskView: false,
  hold: false,
  format: 'jpeg',
  quality: 92,
  busy: false
};
let uid = 0;
let renderRaf = 0;
let thumbTimer = 0;
let thumbToken = 0;
let thumbRenderer = null;

const HSL_COLORS = [
  { name: '빨강', h: 0 }, { name: '주황', h: 32 }, { name: '노랑', h: 58 }, { name: '초록', h: 120 },
  { name: '아쿠아', h: 180 }, { name: '파랑', h: 238 }, { name: '보라', h: 278 }, { name: '마젠타', h: 320 }
];

function newSettings() {
  return {
    presetId: 'original',
    presetStrength: 100,
    tilt: { angle: 0 },
    adjust: {
      exposure: 0, contrast: 0, highlights: 0, shadows: 0, temp: 0, tint: 0,
      saturation: 0, clarity: 0, vignette: 0, grain: 0,
      bgBrightness: 0, bgColor: ''
    },
    hsl: HSL_COLORS.map(() => ({ h: 0, s: 0, l: 0 })),
    retouch: {
      smooth: 0, brighten: 0, blemish: 0, darkCircle: 0, shine: 0,
      eyes: 0, catchlight: 0, teeth: 0,
      lip: 0, blush: 0, hair: 0,
      bokeh: 0, bokehLight: 0
    },
    shape: { slim: 0, eyes: 0, nose: 0, smile: 0 },
    sun: { strength: 0, x: 0, y: 0, glow: 0, temp: 0 },
    match: { refId: null, strength: 75 }
  };
}

const activeItem = () => state.items.find(i => i.id === state.activeId) || null;
const isActive = it => it && it.id === state.activeId;

/* ── 렌더러 ──────────────────────────────────────────── */
let renderer = null;
let eraser = null;
try {
  renderer = new Renderer(els.afterCanvas);
} catch (e) {
  console.error(e);
  els.aiStatusText.textContent = '이 브라우저에서는 WebGL2를 쓸 수 없어 편집 화면을 열 수 없습니다.';
}

/* ── 공통 UI ─────────────────────────────────────────── */
let toastTimer = 0;
function toast(msg, ms = 2400) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  requestAnimationFrame(() => els.toast.classList.add('is-on'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.classList.remove('is-on');
    setTimeout(() => { els.toast.hidden = true; }, 220);
  }, ms);
}

/* ── 프리셋 그리드 ───────────────────────────────────── */
function buildPresetGrid() {
  els.presetGrid.innerHTML = '';
  PRESETS.forEach(p => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'preset';
    b.dataset.preset = p.id;
    b.title = p.name;
    const grad = `linear-gradient(135deg, ${p.swatch[0]} 0%, ${p.swatch[1]} 55%, ${p.swatch[2]} 100%)`;
    b.innerHTML = `
      <span class="preset-swatch" style="background-image:${grad}"></span>
      <span class="preset-name">${p.name}</span>
      <span class="preset-check">✓</span>`;
    b.addEventListener('click', () => {
      const it = activeItem();
      if (!it) { toast('먼저 사진을 불러와 주세요.'); return; }
      it.settings.presetId = p.id;
      if (p.id !== 'original' && it.settings.presetStrength === 0) it.settings.presetStrength = 100;
      syncUI();
      scheduleRender();
      markEdited(it);
      if (isMobile()) closeSheet();
    });
    els.presetGrid.appendChild(b);
  });
}

function refreshPresetThumbs() {
  const item = activeItem();
  if (!item || !renderer) return;
  clearTimeout(thumbTimer);
  const token = ++thumbToken;
  thumbTimer = setTimeout(async () => {
    try {
      if (!thumbRenderer) thumbRenderer = new Renderer(document.createElement('canvas'));
      thumbRenderer.setSource(item.source);
      thumbRenderer.setMasks(item.masks || {});
      thumbRenderer.setBokeh(item.bokeh || {});
      const tw = 140;
      const th = Math.max(24, Math.round(tw * item.height / item.width));
      for (const p of PRESETS) {
        if (token !== thumbToken || !isActive(item)) return;
        const u = uniformsFor(item, { presetId: p.id, presetStrength: 100, noMatch: true });
        thumbRenderer.render(u, tw, th);
        const url = thumbRenderer.canvas.toDataURL('image/jpeg', 0.7);
        const sw = els.presetGrid.querySelector(`.preset[data-preset="${p.id}"] .preset-swatch`);
        if (sw) sw.style.backgroundImage = `url(${url})`;
      }
    } catch (e) {
      /* 실패하면 CSS 그라데이션 유지 */
    }
  }, 140);
}

/* ── 유니폼 ──────────────────────────────────────────── */
const DEG = Math.PI / 180;

/* 수평 회전 + 모서리 여백이 생기지 않는 최소 확대 배율 */
function straightenFor(item) {
  const deg = item.settings.tilt.angle || 0;
  if (!deg) return { rot: 0, zoom: 1 };
  const t = Math.abs(deg) * DEG;
  const w = item.width, h = item.height;
  const zoom = Math.max(
    Math.cos(t) + Math.sin(t) * (h / w),
    Math.cos(t) + Math.sin(t) * (w / h)
  );
  return { rot: -deg * DEG, zoom: Math.max(1.0001, zoom) };
}

const BG_COLORS = {
  white: [0.972, 0.972, 0.968],
  gray: [0.815, 0.825, 0.835],
  dark: [0.078, 0.090, 0.110],
  cream: [0.962, 0.935, 0.870],
  blue: [0.545, 0.670, 0.855]
};

/* ── 얼굴형 워핑 (변위 맵) ───────────────────────────── */
function shapeSig(item) {
  const s = item.settings.shape;
  return `${s.slim}|${s.eyes}|${s.nose}|${s.smile}`;
}

function warpFor(item) {
  const shape = item.masks && item.masks.shape;
  const size = item.masks && item.masks.size;
  if (!shape || !size) return null;
  const key = shapeSig(item);
  if (item.warpKey === key && item.warpCanvas !== undefined) return item.warpCanvas;
  item.warpKey = key;
  item.warpCanvas = buildWarpCanvas(item, shape, size);
  return item.warpCanvas;
}

function buildWarpCanvas(item, shape, size) {
  const sh = item.settings.shape;
  if (!(sh.slim || sh.eyes || sh.nose || sh.smile)) return null;
  const mw = size[0], mh = size[1];
  const N = 64;
  const ar = item.height / item.width;
  const uv = p => (p ? { x: p[0] / mw, y: p[1] / mh } : null);
  const fw = shape.faceW / mw;
  const fh = shape.faceH / mh;
  const A = v => v / 100;
  const jawL = uv(shape.jawL), jawR = uv(shape.jawR), chin = uv(shape.chin);
  const eyeL = uv(shape.eyeL), eyeR = uv(shape.eyeR);
  const noseL = uv(shape.noseL), noseR = uv(shape.noseR);
  const mouthL = uv(shape.mouthL), mouthR = uv(shape.mouthR);

  const pushes = [];
  if (sh.slim) {
    const a = A(sh.slim) * fw * 0.085;
    if (jawL) pushes.push({ p: jawL, d: [a, 0], r: fw * 0.62 });
    if (jawR) pushes.push({ p: jawR, d: [-a, 0], r: fw * 0.62 });
    if (chin) pushes.push({ p: chin, d: [0, -A(sh.slim) * fh * 0.03], r: fw * 0.45 });
  }
  if (sh.nose) {
    const a = A(sh.nose) * fw * 0.028;
    if (noseL) pushes.push({ p: noseL, d: [a, 0], r: fw * 0.22 });
    if (noseR) pushes.push({ p: noseR, d: [-a, 0], r: fw * 0.22 });
  }
  if (sh.smile) {
    const a = A(sh.smile) * fw * 0.035, b = A(sh.smile) * fh * 0.022;
    if (mouthL) pushes.push({ p: mouthL, d: [-a, -b], r: fw * 0.28 });
    if (mouthR) pushes.push({ p: mouthR, d: [a, -b], r: fw * 0.28 });
  }
  const radial = [];
  if (sh.eyes) {
    const a = A(sh.eyes) * 0.34;
    if (eyeL) radial.push({ c: eyeL, r: fw * 0.20, a });
    if (eyeR) radial.push({ c: eyeR, r: fw * 0.20, a });
  }

  const cvs = document.createElement('canvas');
  cvs.width = N;
  cvs.height = N;
  const ctx = cvs.getContext('2d');
  const img = ctx.createImageData(N, N);
  const MAX = 0.06;

  for (let gy = 0; gy < N; gy++) {
    for (let gx = 0; gx < N; gx++) {
      const x = (gx + 0.5) / N;
      const y = (gy + 0.5) / N;
      const px = x, py = y * ar;
      let dxp = 0, dyp = 0;
      for (const q of pushes) {
        const dd = Math.hypot(px - q.p.x, py - q.p.y * ar);
        const wgt = Math.exp(-(dd * dd) / (2 * q.r * q.r));
        dxp += q.d[0] * wgt;
        dyp += q.d[1] * wgt;
      }
      for (const e of radial) {
        const vx = px - e.c.x, vy = py - e.c.y * ar;
        const dd = Math.hypot(vx, vy);
        const wgt = Math.exp(-(dd * dd) / (2 * e.r * e.r)) * e.a;
        dxp += vx * wgt;
        dyp += vy * wgt;
      }
      const ux = Math.max(-MAX, Math.min(MAX, dxp));
      const uy = Math.max(-MAX, Math.min(MAX, dyp / ar));
      const i = (gy * N + gx) * 4;
      img.data[i] = Math.round((ux / MAX * 0.5 + 0.5) * 255);
      img.data[i + 1] = Math.round((uy / MAX * 0.5 + 0.5) * 255);
      img.data[i + 2] = 128;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cvs;
}

function uniformsFor(item, override = {}) {
  const s = item.settings;
  const presetId = override.presetId || s.presetId;
  const preset = PRESET_BY_ID[presetId] || PRESETS[0];
  const strength = override.presetStrength != null ? override.presetStrength : s.presetStrength;
  const look = blendLook(preset.look, Math.max(0, Math.min(100, strength)) / 100);
  const a = s.adjust;
  const r = s.retouch;
  const sh = s.shape;
  const sun = s.sun;
  const ref = !override.noMatch && s.match.refId ? state.refs.get(s.match.refId) : null;
  const st = item.stats || { mean: [55, 6, 6], std: [18, 7, 7] };
  const str = straightenFor(item);

  // 해 방향(2D 패드) → 3D 광원 벡터
  const rad = Math.min(1, Math.hypot(sun.x, sun.y));
  const backTop = Math.max(0, -sun.y) * rad;
  let lz = Math.max(0.16, 1 - 0.92 * rad);
  lz *= 1 - 0.5 * backTop;
  const lv = [sun.x * 1.3, sun.y * 1.3, Math.max(lz, 0.14)];
  const ll = Math.hypot(lv[0], lv[1], lv[2]) || 1;
  const sunL = [lv[0] / ll, lv[1] / ll, lv[2] / ll];

  const warm = Math.max(0, Math.min(1, sun.temp / 100));
  const mix3 = (x, y, t) => [x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t];
  const sunColor = mix3([1.0, 0.975, 0.94], [1.0, 0.74, 0.45], warm);
  const sunGlowColor = mix3([1.0, 0.95, 0.85], [1.0, 0.63, 0.30], warm);

  const hslH = new Float32Array(8), hslS = new Float32Array(8), hslL = new Float32Array(8);
  s.hsl.forEach((c, i) => { hslH[i] = c.h / 100; hslS[i] = c.s / 100; hslL[i] = c.l / 100; });

  const bgKey = a.bgColor || '';
  const bgColor = BG_COLORS[bgKey] || [0, 0, 0];

  return {
    ev: look.ev + a.exposure / 50,
    contrast: a.contrast / 100,
    high: a.highlights / 100,
    shadow: a.shadows / 100,
    temp: a.temp / 100,
    tint: a.tint / 100,
    saturation: a.saturation / 100,
    clarity: a.clarity / 100,
    vignette: Math.max(0, a.vignette / 100 + look.vignette),
    grain: Math.max(0, a.grain / 100 + look.grain),
    lift: look.lift,
    gain: look.gain,
    gamma: look.gamma,
    fade: look.fade,
    shadowTint: look.shadowTint,
    highTint: look.highTint,
    shadowAmt: look.shadowTintAmt,
    highAmt: look.highTintAmt,
    lookSat: look.sat,
    lookContrast: look.contrast,
    smooth: r.smooth / 100,
    brighten: r.brighten / 100,
    blemish: r.blemish / 100,
    darkCircle: r.darkCircle / 100,
    shine: r.shine / 100,
    eyes: r.eyes / 100,
    catchlight: r.catchlight / 100,
    teeth: r.teeth / 100,
    lip: r.lip / 100,
    blush: r.blush / 100,
    hair: r.hair / 100,
    smoothRadius: 0.0035 + 0.0085 * (r.smooth / 100),
    bokeh: r.bokeh / 100,
    bokehLight: r.bokehLight / 100,
    bgBright: a.bgBrightness / 100,
    bgColor,
    bgMix: bgKey ? 1 : 0,
    hslH, hslS, hslL,
    sunStrength: sun.strength / 100,
    sunGlow: sun.glow / 100,
    sunL,
    sunColor,
    sunGlowColor,
    sunUV: [0.5 + Math.max(-1, Math.min(1, sun.x)) * 0.47, 0.5 + Math.max(-1, Math.min(1, sun.y)) * 0.47],
    sunCenter: (item.masks && item.masks.center) || [0.5, 0.5],
    rot: str.rot,
    zoom: str.zoom,
    warp: (sh.slim || sh.eyes || sh.nose || sh.smile) ? 1 : 0,
    matchStrength: ref ? s.match.strength / 100 : 0,
    srcMean: st.mean,
    srcStd: st.std,
    refMean: ref ? ref.stats.mean : null,
    refStd: ref ? ref.stats.std : null,
    maskView: state.maskView,
    seed: item.seed || 0
  };
}

/* ── 그리기 ──────────────────────────────────────────── */
function scheduleRender() {
  if (renderRaf) return;
  renderRaf = requestAnimationFrame(() => { renderRaf = 0; draw(); });
}

function draw() {
  const item = activeItem();
  if (!item || !renderer) return;

  const availW = Math.max(160, els.canvasScroll.clientWidth - 36);
  const availH = Math.max(160, els.canvasScroll.clientHeight - 36);
  const fit = Math.min(availW / item.width, availH / item.height);
  const scale = fit * state.zoom;
  const dispW = Math.max(40, Math.round(item.width * scale));
  const dispH = Math.max(40, Math.round(item.height * scale));
  els.canvasInner.style.width = dispW + 'px';
  els.canvasInner.style.height = dispH + 'px';

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cap = 2400;
  let bw = Math.round(dispW * dpr);
  let bh = Math.round(dispH * dpr);
  const k = Math.min(1, cap / Math.max(bw, bh));
  bw = Math.max(8, Math.round(bw * k));
  bh = Math.max(8, Math.round(bh * k));

  if (els.beforeCanvas.width !== bw || els.beforeCanvas.height !== bh) {
    els.beforeCanvas.width = bw;
    els.beforeCanvas.height = bh;
  }
  const bctx = els.beforeCanvas.getContext('2d');
  bctx.imageSmoothingQuality = 'high';
  bctx.clearRect(0, 0, bw, bh);
  const tilt = item.settings.tilt.angle || 0;
  if (tilt) {
    const st = straightenFor(item);
    bctx.save();
    bctx.translate(bw / 2, bh / 2);
    bctx.rotate(-st.rot);
    bctx.scale(st.zoom, st.zoom);
    bctx.drawImage(item.source, -bw / 2, -bh / 2, bw, bh);
    bctx.restore();
  } else {
    bctx.drawImage(item.source, 0, 0, bw, bh);
  }

  renderer.setWarp(warpFor(item));
  renderer.render(uniformsFor(item), bw, bh);
}

/* ── 아이템 관리 ─────────────────────────────────────── */
async function loadBitmap(file) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file); } catch (e) { /* fallback */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = rej;
      im.src = url;
    });
    return img;
  } finally {
    // img는 drawImage용으로만 쓰고 곧바로 해제하지 않는다 (뒤에서 revoke)
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}

function sanitizeBase(name) {
  return (name || 'photo').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60) || 'photo';
}

async function addFiles(fileList) {
  const files = Array.from(fileList || []).filter(f => /image\//.test(f.type) || /\.(jpe?g|png|webp|bmp)$/i.test(f.name));
  if (!files.length) { toast('사진 파일을 선택해 주세요.'); return; }
  if (state.busy) { toast('이전 사진을 불러오는 중입니다.'); return; }
  state.busy = true;
  let firstAdded = null;

  for (const f of files) {
    try {
      const bmp = await loadBitmap(f);
      const w = bmp.width || bmp.naturalWidth;
      const h = bmp.height || bmp.naturalHeight;
      if (!w || !h) throw new Error('empty');
      const item = {
        id: 'it' + (++uid),
        name: f.name,
        baseName: sanitizeBase(f.name),
        width: w,
        height: h,
        source: bmp,
        url: URL.createObjectURL(f),
        settings: newSettings(),
        stats: imageStats(bmp, 220),
        masks: { skin: null, person: null, mode: 'none' },
        bokeh: null,
        seed: Math.random() * 100,
        analysisStarted: false,
        edited: false
      };
      state.items.push(item);
      if (!firstAdded) firstAdded = item;
      addFilmItem(item);
    } catch (e) {
      console.warn(e);
      toast(`"${f.name}" 파일을 열 수 없습니다.`);
    }
  }
  state.busy = false;
  if (firstAdded && !state.activeId) selectItem(firstAdded.id);
  else if (firstAdded && files.length) { selectItem(firstAdded.id); }
  updateMeta();
  els.emptyState.hidden = state.items.length > 0;
}

function addFilmItem(item) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'film-item';
  b.dataset.id = item.id;
  b.title = item.name;
  b.innerHTML = `<img src="${item.url}" alt=""><span class="film-dot"></span>`;
  b.addEventListener('click', () => {
    if (state.activeId !== item.id) selectItem(item.id);
    if (isMobile()) closeSheet();
  });
  els.filmTrack.appendChild(b);
  els.filmstrip.hidden = false;
}

function updateFilmSelection() {
  $$('.film-item').forEach(el => el.classList.toggle('is-on', el.dataset.id === state.activeId));
}

function markEdited(item) {
  const s = item.settings;
  const changed =
    s.presetId !== 'original' ||
    (s.tilt.angle || 0) !== 0 ||
    Object.values(s.adjust).some(v => typeof v === 'number' && v !== 0) || s.adjust.bgColor !== '' ||
    s.hsl.some(c => c.h || c.s || c.l) ||
    Object.values(s.retouch).some(v => v > 0) ||
    Object.values(s.shape).some(v => v > 0) ||
    (s.sun.strength > 0) ||
    (s.match.refId && s.match.strength > 0);
  item.edited = changed;
  const el = els.filmTrack.querySelector(`.film-item[data-id="${item.id}"]`);
  if (el) el.classList.toggle('is-edited', changed);
}

function selectItem(id) {
  const item = state.items.find(i => i.id === id);
  if (!item) return;
  state.activeId = id;
  state.zoom = 1;
  els.emptyState.hidden = true;
  els.canvasInner.style.visibility = 'visible';

  if (!item.bokeh) {
    try {
      item.bokeh = buildBokehCanvases(item.source, item.width, item.height, (item.masks && item.masks.person) || null);
      item.bokehMasked = !!(item.masks && item.masks.person);
    } catch (e) { item.bokeh = {}; }
  }
  if (renderer) {
    renderer.setSource(item.source);
    renderer.setMasks(item.masks || {});
    renderer.setBokeh(item.bokeh || {});
    renderer.setWarp(warpFor(item));
  }
  updateFilmSelection();
  els.fileChip.hidden = false;
  els.fileName.textContent = item.name;
  els.fileMeta.textContent = `${item.width} × ${item.height}`;
  syncUI();
  updateMeta();
  draw();
  if (eraser) eraser.refresh();
  updateAiStatus();
  ensureAnalysis(item);
  refreshPresetThumbs();
}

async function ensureAnalysis(item) {
  if (item.analysisStarted) { if (isActive(item)) updateAiStatus(); return; }
  item.analysisStarted = true;

  // 1) 즉시 사용할 피부톤 폴백
  try {
    const fb = buildFallbackMasks(item.source, item.width, item.height);
    if (fb.mode !== 'none') {
      item.masks = { skin: fb.skin, person: fb.person, mode: 'fallback', coverage: fb.coverage };
      if (isActive(item) && renderer) {
        renderer.setMasks(item.masks);
        scheduleRender();
      }
    }
  } catch (e) { /* 폴백도 실패하면 마스크 없이 진행 */ }

  if (isActive(item)) setAiWorking();
  try {
    const res = await analyzePortrait(item.source, item.width, item.height);
    item.masks = {
      skin: res.skin, person: res.person, face: res.face, hair: res.hair,
      eyes: res.eyes, lips: res.lips, teeth: res.teeth, cheek: res.cheek,
      underEye: res.underEye, catchlight: res.catchlight,
      shape: res.shape, faceAngle: res.faceAngle, center: res.center,
      mode: 'ai', coverage: res.coverage, faces: res.faces, faceBoxes: res.faceBoxes || [], size: res.size
    };
    item.warpSig = null;
    try {
      item.bokeh = buildBokehCanvases(item.source, item.width, item.height, res.person);
      item.bokehMasked = true;
    } catch (e) { /* 보케 텍스처는 기존 것 유지 */ }
    if (isActive(item) && renderer) {
      renderer.setMasks(item.masks);
      renderer.setBokeh(item.bokeh || {});
      renderer.setWarp(warpFor(item));
      if (item.settings.retouch.smooth > 0 || item.settings.retouch.brighten > 0 || item.settings.retouch.bokeh > 0 || item.settings.retouch.bokehLight > 0) scheduleRender();
      updateAiStatus();
    }
    if (isActive(item) && eraser) eraser.refresh();
  } catch (e) {
    console.warn('portrait analysis failed', e);
    if (isActive(item)) updateAiStatus();
  }
}

function setAiWorking() {
  els.aiStatus.classList.remove('is-ready', 'is-fallback');
  els.aiStatus.classList.add('is-working');
  els.aiStatusText.textContent = '인물 영역을 분석하는 중…';
}

function updateAiStatus() {
  const item = activeItem();
  els.aiStatus.classList.remove('is-working', 'is-ready', 'is-fallback');
  if (!item) {
    els.aiStatusText.textContent = '사진을 불러오면 인물 영역을 분석합니다.';
    return;
  }
  const m = item.masks || {};
  if (m.mode === 'ai') {
    els.aiStatus.classList.add('is-ready');
    const pct = Math.round((m.coverage || 0) * 100);
    const face = m.faces > 0 ? `얼굴 ${m.faces}명 인식` : '얼굴 미검출';
    els.aiStatusText.textContent = pct >= 1
      ? `인물 인식 완료 · 피부 영역 ${pct}% · ${face}`
      : `인물을 찾지 못했습니다 · 배경 보케는 중앙 초점으로 적용됩니다`;
  } else if (m.mode === 'fallback') {
    els.aiStatus.classList.add('is-fallback');
    els.aiStatusText.textContent = '피부톤 기준으로 영역을 잡았습니다 (인물 모델 로드 실패)';
  } else {
    els.aiStatusText.textContent = '인물 영역을 찾지 못했습니다 · 중앙 초점 기준으로 동작합니다';
  }
}

/* ── 슬라이더 정의 ───────────────────────────────────── */
const SLIDERS = {
  exposure: { get: s => s.adjust.exposure, set: (s, v) => s.adjust.exposure = v, fmt: v => fmtEV(v / 50) },
  contrast: { get: s => s.adjust.contrast, set: (s, v) => s.adjust.contrast = v, fmt: v => fmtSigned(v) },
  highlights: { get: s => s.adjust.highlights, set: (s, v) => s.adjust.highlights = v, fmt: v => fmtSigned(v) },
  shadows: { get: s => s.adjust.shadows, set: (s, v) => s.adjust.shadows = v, fmt: v => fmtSigned(v) },
  temp: { get: s => s.adjust.temp, set: (s, v) => s.adjust.temp = v, fmt: v => fmtSigned(v) },
  tint: { get: s => s.adjust.tint, set: (s, v) => s.adjust.tint = v, fmt: v => fmtSigned(v) },
  saturation: { get: s => s.adjust.saturation, set: (s, v) => s.adjust.saturation = v, fmt: v => fmtSigned(v) },
  clarity: { get: s => s.adjust.clarity, set: (s, v) => s.adjust.clarity = v, fmt: v => fmtSigned(v) },
  vignette: { get: s => s.adjust.vignette, set: (s, v) => s.adjust.vignette = v, fmt: v => `${v}` },
  grain: { get: s => s.adjust.grain, set: (s, v) => s.adjust.grain = v, fmt: v => `${v}` },
  smooth: { get: s => s.retouch.smooth, set: (s, v) => s.retouch.smooth = v, fmt: v => `${v}` },
  brighten: { get: s => s.retouch.brighten, set: (s, v) => s.retouch.brighten = v, fmt: v => `${v}` },
  blemish: { get: s => s.retouch.blemish, set: (s, v) => s.retouch.blemish = v, fmt: v => `${v}` },
  darkCircle: { get: s => s.retouch.darkCircle, set: (s, v) => s.retouch.darkCircle = v, fmt: v => `${v}` },
  shine: { get: s => s.retouch.shine, set: (s, v) => s.retouch.shine = v, fmt: v => `${v}` },
  eyes: { get: s => s.retouch.eyes, set: (s, v) => s.retouch.eyes = v, fmt: v => `${v}` },
  catchlight: { get: s => s.retouch.catchlight, set: (s, v) => s.retouch.catchlight = v, fmt: v => `${v}` },
  teeth: { get: s => s.retouch.teeth, set: (s, v) => s.retouch.teeth = v, fmt: v => `${v}` },
  lip: { get: s => s.retouch.lip, set: (s, v) => s.retouch.lip = v, fmt: v => `${v}` },
  blush: { get: s => s.retouch.blush, set: (s, v) => s.retouch.blush = v, fmt: v => `${v}` },
  hair: { get: s => s.retouch.hair, set: (s, v) => s.retouch.hair = v, fmt: v => `${v}` },
  shapeSlim: { get: s => s.shape.slim, set: (s, v) => s.shape.slim = v, fmt: v => `${v}` },
  shapeEyes: { get: s => s.shape.eyes, set: (s, v) => s.shape.eyes = v, fmt: v => `${v}` },
  shapeNose: { get: s => s.shape.nose, set: (s, v) => s.shape.nose = v, fmt: v => `${v}` },
  shapeSmile: { get: s => s.shape.smile, set: (s, v) => s.shape.smile = v, fmt: v => `${v}` },
  straighten: { get: s => s.tilt.angle, set: (s, v) => s.tilt.angle = v, fmt: v => `${v > 0 ? '+' : ''}${v.toFixed(1)}°` },
  bgBrightness: { get: s => s.adjust.bgBrightness, set: (s, v) => s.adjust.bgBrightness = v, fmt: v => `${v > 0 ? '+' : ''}${v}` },
  sunStrength: { get: s => s.sun.strength, set: (s, v) => s.sun.strength = v, fmt: v => `${v}` },
  sunTemp: { get: s => s.sun.temp, set: (s, v) => s.sun.temp = v, fmt: v => `${Math.round(5500 - 23 * v)}K` },
  sunGlow: { get: s => s.sun.glow, set: (s, v) => s.sun.glow = v, fmt: v => `${v}` },
  hslHue: { get: s => s.hsl[state.hslSel].h, set: (s, v) => s.hsl[state.hslSel].h = v, fmt: v => `${v > 0 ? '+' : ''}${v}` },
  hslSat: { get: s => s.hsl[state.hslSel].s, set: (s, v) => s.hsl[state.hslSel].s = v, fmt: v => `${v > 0 ? '+' : ''}${v}` },
  hslLum: { get: s => s.hsl[state.hslSel].l, set: (s, v) => s.hsl[state.hslSel].l = v, fmt: v => `${v > 0 ? '+' : ''}${v}` },
  bokeh: { get: s => s.retouch.bokeh, set: (s, v) => s.retouch.bokeh = v, fmt: v => `${v}` },
  bokehLight: { get: s => s.retouch.bokehLight, set: (s, v) => s.retouch.bokehLight = v, fmt: v => `${v}` },
  matchStrength: { get: s => s.match.strength, set: (s, v) => s.match.strength = v, fmt: v => `${v}%` },
  quality: { get: () => state.quality, set: (s, v) => { state.quality = v; }, fmt: v => `${v}` }
};

function paintSlider(el, value) {
  const input = el.querySelector('input[type=range]');
  const out = el.querySelector('output');
  const min = Number(input.min), max = Number(input.max);
  input.value = value;
  const pct = ((value - min) / (max - min)) * 100;
  input.style.setProperty('--fill', pct + '%');
  const conf = SLIDERS[el.dataset.key];
  if (out && conf) out.textContent = conf.fmt(value);
  el.classList.toggle('is-changed', el.dataset.key === 'quality' ? false : value !== (Number(input.dataset.default ?? 0)));
}

function syncUI() {
  const item = activeItem();
  if (!item) return;
  $$('.slider[data-key]').forEach(el => {
    const key = el.dataset.key;
    const conf = SLIDERS[key];
    if (!conf) return;
    const v = conf.get(item.settings);
    paintSlider(el, v);
  });
  els.presetStrength.value = item.settings.presetStrength;
  els.presetStrengthOut.textContent = item.settings.presetStrength + '%';
  els.presetStrength.style.setProperty('--fill', item.settings.presetStrength + '%');
  $$('.preset').forEach(b => b.classList.toggle('is-on', b.dataset.preset === item.settings.presetId));
  syncMatchUI();
  syncSunUI(item);
  syncTiltUI(item);
  syncHslUI(item);
  if (els.bgColor) els.bgColor.value = item.settings.adjust.bgColor || '';
  updateNamePreview();
  els.showMask && (els.showMask.checked = state.maskView);
}

function syncSunUI(item) {
  const sun = item.settings.sun;
  els.sunHandle.style.left = (50 + sun.x * 46) + '%';
  els.sunHandle.style.top = (50 + sun.y * 46) + '%';
  els.sunPad.classList.toggle('is-off', !(sun.strength > 0));
  els.sunPad.setAttribute('aria-valuetext', `햇빛 ${sun.strength}% · 방향 ${Math.round(sun.x * 100)}, ${Math.round(sun.y * 100)}`);
}

function syncTiltUI(item) {
  const d = item.settings.tilt.angle || 0;
  els.tiltStatus.textContent = `수평 ${d > 0 ? '+' : ''}${d.toFixed(1)}°`;
}

function syncHslUI(item) {
  $$('.hsl-dot').forEach(b => b.classList.toggle('is-on', Number(b.dataset.hsl) === state.hslSel));
  els.hslName.textContent = HSL_COLORS[state.hslSel].name;
  ['hslHue', 'hslSat', 'hslLum'].forEach(k => {
    const el = document.querySelector(`.slider[data-key="${k}"]`);
    if (el) paintSlider(el, SLIDERS[k].get(item.settings));
  });
}

function bindSliders() {
  $$('.slider[data-key]').forEach(el => {
    const key = el.dataset.key;
    const conf = SLIDERS[key];
    const input = el.querySelector('input[type=range]');
    if (input) {
      input.dataset.default = input.value;
      const lbl = el.querySelector('label');
      if (lbl && !input.getAttribute('aria-label')) input.setAttribute('aria-label', lbl.textContent.trim());
    }
    input.addEventListener('input', () => {
      const v = Number(input.value);
      const item = activeItem();
      if (key === 'quality') {
        state.quality = v;
        paintSlider(el, v);
        els.qualityRow.style.display = state.format === 'png' ? 'none' : '';
        return;
      }
      if (!item) return;
      conf.set(item.settings, v);
      paintSlider(el, v);
      scheduleRender();
      markEdited(item);
    });
    input.addEventListener('change', () => { const it = activeItem(); if (it) markEdited(it); });
  });

  els.presetStrength.addEventListener('input', () => {
    const item = activeItem();
    const v = Number(els.presetStrength.value);
    if (item) { item.settings.presetStrength = v; markEdited(item); scheduleRender(); }
    els.presetStrengthOut.textContent = v + '%';
    els.presetStrength.style.setProperty('--fill', v + '%');
  });
}

/* ── 탭 ──────────────────────────────────────────────── */
function setTab(name) {
  $$('.tab').forEach(t => {
    const on = t.dataset.tab === name;
    t.classList.toggle('is-on', on);
    t.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  $$('.tab-panel').forEach(p => p.classList.toggle('is-on', p.dataset.panel === name));
  if (eraser) eraser.setActive(name === 'erase');
}

/* ── 모바일 시트 ─────────────────────────────────────── */
const isMobile = () => window.matchMedia('(max-width: 900px)').matches;

function openSheet(which) {
  closeSheet(true);
  els.backdrop.hidden = false;
  if (which === 'presets') els.panelPresets.classList.add('is-open');
  else {
    setTab(which);
    els.panelAdjust.classList.add('is-open');
  }
  $$('.mnav').forEach(b => b.classList.toggle('is-on', b.dataset.mnav === which));
}
function closeSheet(keepNav) {
  els.panelPresets.classList.remove('is-open');
  els.panelAdjust.classList.remove('is-open');
  els.backdrop.hidden = true;
  if (!keepNav) $$('.mnav').forEach(b => b.classList.remove('is-on'));
}

/* ── 내보내기 ────────────────────────────────────────── */
function fileNameFor(item) {
  const ext = state.format === 'png' ? 'png' : 'jpg';
  return `${item.baseName}_edited.${ext}`;
}

function updateNamePreview() {
  const item = activeItem();
  els.namePreview.textContent = item ? fileNameFor(item) : 'photo_edited.jpg';
}

function download(blob, filename) {
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

async function renderFullBlob(item) {
  const canvas = document.createElement('canvas');
  const r = new Renderer(canvas);
  try {
    r.setSource(item.source);
    r.setMasks(item.masks || {});
    if (!item.bokeh || (!item.bokehMasked && item.masks && item.masks.person)) {
      item.bokeh = buildBokehCanvases(item.source, item.width, item.height, (item.masks && item.masks.person) || null);
      item.bokehMasked = !!(item.masks && item.masks.person);
    }
    r.setBokeh(item.bokeh || {});
    r.setWarp(warpFor(item));
    const maxTex = Math.min(r.maxTex || 4096, 10000);
    let w = item.width, h = item.height;
    const k = Math.min(1, maxTex / Math.max(w, h));
    if (k < 1) { w = Math.round(w * k); h = Math.round(h * k); }
    r.render(uniformsFor(item), w, h);
    const mime = state.format === 'png' ? 'image/png' : 'image/jpeg';
    const blob = await new Promise(res => canvas.toBlob(res, mime, state.quality / 100));
    if (!blob) throw new Error('encode failed');
    return blob;
  } finally {
    r.dispose();
  }
}

async function exportOne() {
  const item = activeItem();
  if (!item) { toast('먼저 사진을 불러와 주세요.'); return; }
  try {
    setProgress(0.15, '사진을 저장하는 중…');
    const blob = await renderFullBlob(item);
    download(blob, fileNameFor(item));
    setProgress(1, '저장 완료');
    toast(`${fileNameFor(item)} 저장했습니다.`);
  } catch (e) {
    console.error(e);
    toast('저장에 실패했습니다. 다른 형식으로 시도해 주세요.');
  } finally {
    setTimeout(() => setProgress(-1), 1600);
  }
}

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = res;
    s.onerror = () => rej(new Error('load failed: ' + src));
    document.head.appendChild(s);
  });
}

async function exportZip() {
  if (!state.items.length) { toast('사진이 없습니다.'); return; }
  if (state.busy) { toast('이미 작업 중입니다.'); return; }
  state.busy = true;
  try {
    setProgress(0.05, 'ZIP 도구를 준비하는 중…');
    if (!window.JSZip) await loadScript('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js');
    const zip = new window.JSZip();
    const total = state.items.length;
    for (let i = 0; i < total; i++) {
      const it = state.items[i];
      setProgress(0.08 + (i / total) * 0.85, `${i + 1}/${total} · ${it.name} 처리 중…`);
      if (!it.analysisStarted) await ensureAnalysis(it);
      if (!it.bokeh || (!it.bokehMasked && it.masks && it.masks.person)) {
        it.bokeh = buildBokehCanvases(it.source, it.width, it.height, (it.masks && it.masks.person) || null);
        it.bokehMasked = !!(it.masks && it.masks.person);
      }
      const blob = await renderFullBlob(it);
      zip.file(fileNameFor(it), blob);
    }
    setProgress(0.94, 'ZIP 파일을 만드는 중…');
    const out = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, meta => {
      setProgress(0.94 + meta.percent / 100 * 0.05, 'ZIP 파일을 만드는 중…');
    });
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    download(out, `photh-studio_${stamp}.zip`);
    setProgress(1, `${total}장 저장 완료`);
    toast(`${total}장을 ZIP으로 저장했습니다.`);
  } catch (e) {
    console.error(e);
    toast('ZIP 저장에 실패했습니다.');
  } finally {
    state.busy = false;
    setTimeout(() => setProgress(-1), 1800);
  }
}

function setProgress(v, text) {
  if (v < 0) { els.exportProgress.hidden = true; return; }
  els.exportProgress.hidden = false;
  els.exportBar.style.width = Math.round(v * 100) + '%';
  els.exportProgressText.textContent = text || '';
}

/* ── 레퍼런스 ────────────────────────────────────────── */
async function setReferenceFile(file) {
  if (!file || !/image\//.test(file.type)) { toast('이미지 파일을 선택해 주세요.'); return; }
  try {
    const bmp = await loadBitmap(file);
    const stats = imageStats(bmp, 256);
    const id = 'ref' + (++state.refSeq);
    const thumbCanvas = document.createElement('canvas');
    const tw = 120, th = Math.round(tw * (bmp.height || bmp.naturalHeight) / (bmp.width || bmp.naturalWidth));
    thumbCanvas.width = tw; thumbCanvas.height = Math.max(24, th);
    thumbCanvas.getContext('2d').drawImage(bmp, 0, 0, thumbCanvas.width, thumbCanvas.height);
    state.refs.set(id, { id, name: file.name, stats, thumb: thumbCanvas.toDataURL('image/jpeg', 0.8) });

    const item = activeItem();
    if (item) {
      item.settings.match = { refId: id, strength: item.settings.match.strength ?? 75 };
      markEdited(item);
      scheduleRender();
    }
    syncMatchUI();
    toast('레퍼런스 색감을 적용했습니다.');
  } catch (e) {
    console.error(e);
    toast('레퍼런스 사진을 열 수 없습니다.');
  }
}

function syncMatchUI() {
  const item = activeItem();
  const ref = item && item.settings.match.refId ? state.refs.get(item.settings.match.refId) : null;
  if (els.btnRefSave) els.btnRefSave.disabled = !ref || !!ref.saved;
  if (els.btnRefSave && ref) els.btnRefSave.textContent = ref.saved ? '+ 이미 내 레퍼런스에 있음' : '+ 지금 사진을 내 레퍼런스로 저장';
  if (ref) {
    els.refFilled.hidden = false;
    els.refEmpty.hidden = true;
    els.refThumb.src = ref.thumb;
    els.refName.textContent = ref.name;
    els.refSize.textContent = '색감 분석 완료';
    els.btnRefBatch.disabled = state.items.length < 1;
    // 추정 보정량
    if (item && item.stats) {
      const est = estimateAdjust(item.stats, ref.stats);
      const chips = [];
      chips.push(`노출 ${fmtEV(est.ev)}`);
      chips.push(`대비 ${fmtSigned(est.contrast)}`);
      if (Math.abs(est.kelvin) >= 30) chips.push(`색온도 ${fmtSigned(est.kelvin, 'K')}`);
      if (Math.abs(est.tint) >= 1.2) chips.push(`틴트 ${fmtSigned(est.tint)}`);
      els.estimate.hidden = false;
      els.estimateChips.innerHTML = chips.map(c => `<span class="chip">${c}</span>`).join('');
    }
  } else {
    els.refFilled.hidden = true;
    els.refEmpty.hidden = false;
    els.btnRefBatch.disabled = true;
    els.estimate.hidden = true;
  }
}

/* ── 전/후 비교 · 보기 ───────────────────────────────── */
function setCompare(on) {
  state.compare = on;
  els.afterHolder.style.setProperty('--split', on ? state.split + '%' : '0%');
  if (!on) els.canvasInner.style.setProperty('--split', '0%');
  else els.canvasInner.style.setProperty('--split', state.split + '%');
  els.compareLine.hidden = !on;
  els.compareLine.style.left = state.split + '%';
  els.canvasInner.classList.toggle('is-compare', on);
  els.btnCompare.setAttribute('aria-pressed', on ? 'true' : 'false');
  if (eraser) eraser.refresh();
}

function updateSplit(pct) {
  state.split = Math.max(0, Math.min(100, pct));
  els.canvasInner.style.setProperty('--split', state.split + '%');
  els.compareLine.style.left = state.split + '%';
}

function setHold(on) {
  state.hold = on;
  els.afterHolder.style.opacity = on ? '0' : '1';
  $('#btnHold').classList.toggle('is-active', on);
}

function currentFit(item) {
  const availW = Math.max(160, els.canvasScroll.clientWidth - 36);
  const availH = Math.max(160, els.canvasScroll.clientHeight - 36);
  return Math.min(availW / item.width, availH / item.height);
}

function setZoomMode(mode) {
  const item = activeItem();
  if (item) state.zoom = mode === 'fit' ? 1 : Math.min(8, 1 / currentFit(item));
  $('#zoomFit').classList.toggle('is-on', mode === 'fit');
  $('#zoom100').classList.toggle('is-on', mode === '100');
  draw();
}

/* ── 일괄 적용 / 초기화 ─────────────────────────────── */
function batchApply() {
  const src = activeItem();
  if (!src) { toast('먼저 사진을 불러와 주세요.'); return; }
  const others = state.items.filter(i => i.id !== src.id);
  if (!others.length) { toast('다른 사진이 없습니다. 사진을 더 불러와 주세요.'); return; }
  const snapshot = JSON.stringify(src.settings);
  others.forEach(it => {
    it.settings = JSON.parse(snapshot);
    markEdited(it);
  });
  toast(`현재 설정을 ${others.length}장에 적용했습니다.`);
}

function resetActive() {
  const item = activeItem();
  if (!item) return;
  item.settings = newSettings();
  state.maskView = false;
  if (els.showMask) els.showMask.checked = false;
  syncUI();
  scheduleRender();
  markEdited(item);
  toast('이 사진의 보정을 초기화했습니다.');
}

/* ── 이벤트 ─────────────────────────────────────────── */
/* ── 지우개 결과 반영 ───────────────────────────────── */
async function applyErased(item, canvas, opts = {}) {
  item.eraseUndo = item.eraseUndo || [];
  if (opts.undo) {
    const prev = item.eraseUndo.pop();
    if (!prev) return;
    item.source = prev.source;
    item.width = prev.width;
    item.height = prev.height;
    item.url = prev.url;
  } else if (canvas) {
    item.eraseUndo.push({ source: item.source, width: item.width, height: item.height, url: item.url });
    if (item.eraseUndo.length > 4) item.eraseUndo.shift();
    let bmp;
    try { bmp = await createImageBitmap(canvas); } catch (e) { bmp = canvas; }
    item.source = bmp;
    item.width = bmp.width;
    item.height = bmp.height;
    const t = document.createElement('canvas');
    const tw = 220, th = Math.max(24, Math.round(tw * item.height / item.width));
    t.width = tw; t.height = th;
    t.getContext('2d').drawImage(canvas, 0, 0, tw, th);
    item.url = t.toDataURL('image/jpeg', 0.7);
  } else {
    return;
  }

  // 사진이 바뀌었으므로 인물·피부 마스크와 보케를 새로 계산한다
  item.masks = { skin: null, person: null, mode: 'none' };
  item.analysisStarted = false;
  item.bokeh = null;
  item.bokehMasked = false;
  item.warpKey = null;
  item.warpCanvas = undefined;
  try { item.stats = imageStats(item.source, 220); } catch (e) { /* 통계는 기존 값 유지 */ }

  const film = els.filmTrack.querySelector(`.film-item[data-id="${item.id}"] img`);
  if (film) film.src = item.url;
  if (renderer) {
    renderer.setSource(item.source);
    renderer.setMasks({});
    renderer.setBokeh({});
    renderer.setWarp(null);
  }
  els.fileMeta.textContent = `${item.width} × ${item.height}`;
  markEdited(item);
  draw();
  updateMeta();
  ensureAnalysis(item);
  refreshPresetThumbs();
  if (eraser) eraser.refresh();
}

function bindEvents() {
  const pick = () => els.fileInput.click();
  $('#btnImport').addEventListener('click', pick);
  $('#btnPickEmpty').addEventListener('click', pick);
  $('#btnFilmAdd').addEventListener('click', pick);
  els.fileInput.addEventListener('change', e => {
    addFiles(e.target.files);
    e.target.value = '';
  });

  // 자동 수평
  els.btnAutoLevel.addEventListener('click', async () => {
    const item = activeItem();
    if (!item) { toast('먼저 사진을 불러와 주세요.'); return; }
    els.btnAutoLevel.disabled = true;
    try {
      if (!item.analysisStarted) await ensureAnalysis(item);
      const est = estimateTilt(item.source, item.width, item.height, item.masks && item.masks.faceAngle);
      const deg = Math.max(-15, Math.min(15, Math.round(est.angle * 10) / 10));
      item.settings.tilt.angle = deg;
      syncUI();
      draw();
      markEdited(item);
      const how = est.source === 'face' ? '얼굴 눈높이 기준' : est.source === 'edge' ? '수평·수직선 기준' : '기준선을 찾지 못함';
      toast(`자동 수평 ${deg > 0 ? '+' : ''}${deg.toFixed(1)}° · ${how}`);
    } finally {
      els.btnAutoLevel.disabled = false;
    }
  });

  // 해 방향 패드
  let sunDrag = false;
  const setSunFrom = e => {
    const item = activeItem();
    if (!item) return;
    const r = els.sunPad.getBoundingClientRect();
    let x = ((e.clientX - r.left) / Math.max(1, r.width) - 0.5) * 2 / 0.92;
    let y = ((e.clientY - r.top) / Math.max(1, r.height) - 0.5) * 2 / 0.92;
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    const sun = item.settings.sun;
    sun.x = Math.round(Math.max(-1, Math.min(1, x)) * 100) / 100;
    sun.y = Math.round(Math.max(-1, Math.min(1, y)) * 100) / 100;
    if (sun.strength === 0) sun.strength = 55;
    syncSunUI(item);
    const sl = document.querySelector('.slider[data-key="sunStrength"]');
    if (sl) paintSlider(sl, sun.strength);
    scheduleRender();
    markEdited(item);
  };
  els.sunPad.addEventListener('pointerdown', e => {
    if (!activeItem()) return;
    sunDrag = true;
    els.sunPad.setPointerCapture?.(e.pointerId);
    setSunFrom(e);
  });
  els.sunPad.addEventListener('pointermove', e => { if (sunDrag) setSunFrom(e); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => els.sunPad.addEventListener(ev, () => { sunDrag = false; }));
  els.sunPad.addEventListener('keydown', e => {
    const item = activeItem();
    if (!item) return;
    const sun = item.settings.sun;
    const step = e.shiftKey ? 0.2 : 0.08;
    let moved = true;
    if (e.key === 'ArrowLeft') sun.x -= step;
    else if (e.key === 'ArrowRight') sun.x += step;
    else if (e.key === 'ArrowUp') sun.y -= step;
    else if (e.key === 'ArrowDown') sun.y += step;
    else moved = false;
    if (!moved) return;
    e.preventDefault();
    const len = Math.hypot(sun.x, sun.y);
    if (len > 1) { sun.x /= len; sun.y /= len; }
    sun.x = Math.round(sun.x * 100) / 100;
    sun.y = Math.round(sun.y * 100) / 100;
    if (sun.strength === 0) sun.strength = 55;
    syncSunUI(item);
    const sl = document.querySelector('.slider[data-key="sunStrength"]');
    if (sl) paintSlider(sl, sun.strength);
    scheduleRender();
    markEdited(item);
  });

  // HSL 색상 선택
  $$('.hsl-dot').forEach(b => {
    b.addEventListener('click', () => {
      state.hslSel = Number(b.dataset.hsl) || 0;
      const item = activeItem();
      if (item) syncHslUI(item);
    });
  });

  // 배경 색
  $('#btnRefSave').addEventListener('click', saveCurrentRef);
  els.bgColor.addEventListener('change', e => {
    const item = activeItem();
    if (!item) { e.target.value = ''; return; }
    item.settings.adjust.bgColor = e.target.value;
    markEdited(item);
    scheduleRender();
  });

  $('#btnExportTop').addEventListener('click', () => {
    if (!activeItem()) { els.fileInput.click(); return; }
    setTab('export');
    if (isMobile()) openSheet('export');
    exportOne();
  });
  $('#btnExportOne').addEventListener('click', exportOne);
  $('#btnExportZip').addEventListener('click', exportZip);
  $('#exportFormat').addEventListener('change', e => {
    state.format = e.target.value;
    els.qualityRow.style.display = state.format === 'png' ? 'none' : '';
    updateNamePreview();
  });

  $('#btnCompare').addEventListener('click', () => setCompare(!state.compare));
  $('#btnResetOne').addEventListener('click', resetActive);
  $('#btnBatchApply').addEventListener('click', batchApply);

  const hold = $('#btnHold');
  hold.addEventListener('pointerdown', e => { e.preventDefault(); setHold(true); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => hold.addEventListener(ev, () => setHold(false)));

  $('#zoomFit').addEventListener('click', () => setZoomMode('fit'));
  $('#zoom100').addEventListener('click', () => setZoomMode('100'));

  // 비교선 드래그
  let dragging = false;
  const startDrag = e => {
    if (!state.compare) return;
    dragging = true;
    els.compareLine.setPointerCapture?.(e.pointerId);
    moveDrag(e);
  };
  const moveDrag = e => {
    if (!dragging) return;
    const rect = els.canvasInner.getBoundingClientRect();
    if (!rect.width) return;
    updateSplit(((e.clientX - rect.left) / rect.width) * 100);
  };
  els.compareLine.addEventListener('pointerdown', startDrag);
  els.canvasInner.addEventListener('pointerdown', e => {
    if (!state.compare) return;
    if (e.target.closest('.compare-line')) return;
    dragging = true;
    moveDrag(e);
  });
  window.addEventListener('pointermove', moveDrag);
  window.addEventListener('pointerup', () => { dragging = false; });

  // 탭
  $$('.tab').forEach(t => t.addEventListener('click', () => setTab(t.dataset.tab)));
  $$('.mnav').forEach(b => b.addEventListener('click', () => {
    const which = b.dataset.mnav;
    if (which === 'presets') openSheet('presets');
    else openSheet(which);
  }));
  $('#presetClose').addEventListener('click', () => closeSheet());
  $('#adjustClose').addEventListener('click', () => closeSheet());
  els.backdrop.addEventListener('click', () => closeSheet());

  // 마스크 미리보기
  if (els.showMask) {
    els.showMask.addEventListener('change', e => {
      state.maskView = e.target.checked;
      scheduleRender();
    });
  }

  // 그룹 초기화
  $$('.mini-reset').forEach(b => {
    b.addEventListener('click', () => {
      const item = activeItem();
      if (!item) return;
      const g = b.dataset.resetGroup;
      if (g === 'light') { item.settings.adjust.exposure = 0; item.settings.adjust.contrast = 0; item.settings.adjust.highlights = 0; item.settings.adjust.shadows = 0; }
      if (g === 'color') { item.settings.adjust.temp = 0; item.settings.adjust.tint = 0; item.settings.adjust.saturation = 0; item.settings.adjust.clarity = 0; }
      if (g === 'texture') { item.settings.adjust.vignette = 0; item.settings.adjust.grain = 0; }
      if (g === 'skin') { item.settings.retouch.smooth = 0; item.settings.retouch.brighten = 0; item.settings.retouch.blemish = 0; item.settings.retouch.darkCircle = 0; item.settings.retouch.shine = 0; }
      if (g === 'eye') { item.settings.retouch.eyes = 0; item.settings.retouch.catchlight = 0; item.settings.retouch.teeth = 0; }
      if (g === 'makeup') { item.settings.retouch.lip = 0; item.settings.retouch.blush = 0; item.settings.retouch.hair = 0; }
      if (g === 'shape') { item.settings.shape = { slim: 0, eyes: 0, nose: 0, smile: 0 }; item.warpKey = null; }
      if (g === 'bg') { item.settings.retouch.bokeh = 0; item.settings.retouch.bokehLight = 0; }
      if (g === 'bgcolor') { item.settings.adjust.bgBrightness = 0; item.settings.adjust.bgColor = ''; }
      if (g === 'tilt') { item.settings.tilt.angle = 0; }
      if (g === 'hsl') { item.settings.hsl = HSL_COLORS.map(() => ({ h: 0, s: 0, l: 0 })); }
      if (g === 'sun') { item.settings.sun = { strength: 0, x: 0, y: 0, glow: 0, temp: 0 }; }
      syncUI();
      scheduleRender();
      markEdited(item);
    });
  });

  // 레퍼런스
  const openRef = () => els.refInput.click();
  els.refDrop.addEventListener('click', e => { if (!e.target.closest('#refRemove')) openRef(); });
  els.refDrop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openRef(); } });
  els.refInput.addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    if (f) setReferenceFile(f);
    e.target.value = '';
  });
  els.refDrop.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); els.refDrop.classList.add('is-over'); });
  els.refDrop.addEventListener('dragleave', () => els.refDrop.classList.remove('is-over'));
  els.refDrop.addEventListener('drop', e => {
    e.preventDefault();
    e.stopPropagation();
    els.refDrop.classList.remove('is-over');
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) setReferenceFile(f);
  });
  $('#refRemove').addEventListener('click', e => {
    e.stopPropagation();
    const item = activeItem();
    if (item) { item.settings.match.refId = null; markEdited(item); scheduleRender(); }
    syncMatchUI();
    toast('레퍼런스를 제거했습니다.');
  });
  $('#btnRefBatch').addEventListener('click', () => {
    const item = activeItem();
    if (!item || !item.settings.match.refId) return;
    const m = { refId: item.settings.match.refId, strength: item.settings.match.strength };
    state.items.forEach(it => {
      it.settings.match = { ...m };
      markEdited(it);
    });
    toast(`${state.items.length}장에 이 색감을 적용했습니다.`);
  });

  // 드래그&드롭으로 사진 추가
  ['dragenter', 'dragover'].forEach(ev => window.addEventListener(ev, e => {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
    e.preventDefault();
    if (e.target.closest('#refDrop')) return;
    els.emptyState.querySelector('.empty-card')?.classList.add('is-drag');
  }));
  window.addEventListener('dragleave', e => {
    if (e.relatedTarget) return;
    els.emptyState.querySelector('.empty-card')?.classList.remove('is-drag');
  });
  window.addEventListener('drop', e => {
    if (!e.dataTransfer) return;
    if (e.target.closest('#refDrop')) return;
    const files = e.dataTransfer.files;
    if (files && files.length) {
      e.preventDefault();
      els.emptyState.querySelector('.empty-card')?.classList.remove('is-drag');
      addFiles(files);
    }
  });

  // 키보드
  window.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea, select')) return;
    if (e.key === 'b' || e.key === 'B') setCompare(!state.compare);
    if (e.key === '0') setZoomMode('fit');
    if (e.key === '1') setZoomMode('100');
    if (e.key === '[' || e.key === ']') {
      const idx = state.items.findIndex(i => i.id === state.activeId);
      if (idx < 0) return;
      const next = e.key === '[' ? Math.max(0, idx - 1) : Math.min(state.items.length - 1, idx + 1);
      if (next !== idx) selectItem(state.items[next].id);
    }
  });

  // 리사이즈
  let rt = 0;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => { closeSheet(); draw(); }, 140);
  });
  window.addEventListener('orientationchange', () => setTimeout(draw, 240));
}

/* ── 내 레퍼런스 (localStorage) ─────────────────────── */
const REF_STORE = 'photh.refs.v1';

function loadRefLibrary() {
  try {
    const raw = localStorage.getItem(REF_STORE);
    if (!raw) return;
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return;
    list.forEach(e => {
      if (!e || !e.id || !e.stats || !e.thumb) return;
      state.refs.set(e.id, { ...e, saved: true });
      const n = Number(String(e.id).replace(/\D/g, '')) || 0;
      if (n > state.refSeq) state.refSeq = n;
    });
  } catch (e) { /* 저장된 레퍼런스가 깨져 있으면 무시 */ }
}

function saveRefLibrary() {
  try {
    const list = [...state.refs.values()]
      .filter(r => r.saved)
      .map(r => ({ id: r.id, name: r.name, thumb: r.thumb, stats: r.stats, createdAt: r.createdAt || Date.now() }));
    localStorage.setItem(REF_STORE, JSON.stringify(list));
  } catch (e) {
    toast('브라우저 저장 공간이 부족해 레퍼런스를 저장하지 못했습니다.');
  }
}

function renderRefCards() {
  if (!els.refSavedList) return;
  const list = [...state.refs.values()].filter(r => r.saved).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const item = activeItem();
  const activeRef = item && item.settings.match ? item.settings.match.refId : null;
  els.refSavedList.innerHTML = '';
  els.refSavedEmpty.hidden = list.length > 0;

  list.forEach(r => {
    const card = document.createElement('div');
    card.className = 'ref-card' + (r.id === activeRef ? ' is-on' : '');
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `${r.name} 색감 적용`);

    const img = document.createElement('img');
    img.src = r.thumb;
    img.alt = '';
    const name = document.createElement('span');
    name.textContent = r.name;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'ref-card-del';
    del.textContent = '✕';
    del.setAttribute('aria-label', `${r.name} 삭제`);
    card.append(img, name, del);

    const apply = () => {
      const it = activeItem();
      if (!it) { toast('먼저 사진을 불러와 주세요.'); return; }
      it.settings.match = { refId: r.id, strength: it.settings.match.strength || 75 };
      markEdited(it);
      syncUI();
      scheduleRender();
      renderRefCards();
      toast(`'${r.name}' 색감을 적용했습니다.`);
    };
    card.addEventListener('click', e => { if (e.target.closest('.ref-card-del')) return; apply(); });
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); apply(); } });
    del.addEventListener('click', e => {
      e.stopPropagation();
      state.refs.delete(r.id);
      saveRefLibrary();
      const it = activeItem();
      if (it && it.settings.match.refId === r.id) { it.settings.match.refId = null; markEdited(it); scheduleRender(); }
      syncMatchUI();
      renderRefCards();
      toast(`${r.name}을(를) 삭제했습니다.`);
    });
    els.refSavedList.appendChild(card);
  });
}

function saveCurrentRef() {
  const item = activeItem();
  const ref = item && item.settings.match.refId ? state.refs.get(item.settings.match.refId) : null;
  if (!ref) { toast('먼저 레퍼런스 사진을 올려 주세요.'); return; }
  if (ref.saved) { toast('이미 내 레퍼런스에 저장되어 있습니다.'); return; }
  const count = [...state.refs.values()].filter(r => r.saved).length;
  ref.name = `레퍼런스 ${count + 1}`;
  ref.saved = true;
  ref.createdAt = Date.now();
  saveRefLibrary();
  renderRefCards();
  toast(`'${ref.name}'으로 저장했습니다.`);
}

/* ── 초기화 ─────────────────────────────────────────── */
function init() {
  buildPresetGrid();
  bindSliders();
  bindEvents();
  eraser = initEraser({
    getItem: activeItem,
    applyErased,
    toast,
    setBusy: v => { state.busy = v; },
    isSuppressed: () => state.compare
  });
  loadRefLibrary();
  renderRefCards();
  setTab('light');
  setCompare(false);
  $$('.slider[data-key]').forEach(el => {
    if (el === els.qualityRow) return;
    const input = el.querySelector('input[type=range]');
    if (input) paintSlider(el, Number(input.value));
  });
  paintSlider(els.qualityRow, state.quality);
  els.presetStrength.style.setProperty('--fill', '100%');
  updateNamePreview();
  updateMeta();
  if (!renderer) toast('이 브라우저에서는 WebGL2를 사용할 수 없습니다.', 6000);
}
init();
