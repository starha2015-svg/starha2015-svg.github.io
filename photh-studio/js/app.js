import { PRESETS, PRESET_BY_ID, blendLook } from './presets.js?v=14';
import { Renderer } from './gl.js?v=14';
import { buildBokehCanvases } from './bokeh.js?v=14';
import { imageStats, estimateAdjust, fmtEV, fmtSigned } from './color.js?v=14';
import { buildFallbackMasks, analyzePortrait } from './ai.js?v=14';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

/* 진단용: 예상치 못한 오류를 조용히 모아 둔다 (화면에는 나오지 않음) */
window.__phothErrors = window.__phothErrors || [];
window.addEventListener('error', e => window.__phothErrors.push(String(e.message || e)));
window.addEventListener('unhandledrejection', e => window.__phothErrors.push('promise: ' + String((e.reason && e.reason.message) || e.reason)));

const SAMPLE_FILES = [
  { url: './assets/samples/sample-01.jpg', name: 'portrait_studio.jpg' },
  { url: './assets/samples/sample-02.jpg', name: 'field_portrait.jpg' },
  { url: './assets/samples/sample-03.jpg', name: 'street_mood.jpg' }
];

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
  btnHold: $('#btnHold')
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

function newSettings() {
  return {
    presetId: 'original',
    presetStrength: 100,
    adjust: { exposure: 0, contrast: 0, highlights: 0, shadows: 0, temp: 0, tint: 0, saturation: 0, clarity: 0, vignette: 0, grain: 0 },
    retouch: { smooth: 0, brighten: 0, bokeh: 0, bokehLight: 0 },
    match: { refId: null, strength: 75 }
  };
}

const activeItem = () => state.items.find(i => i.id === state.activeId) || null;
const isActive = it => it && it.id === state.activeId;

/* ── 렌더러 ──────────────────────────────────────────── */
let renderer = null;
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
function uniformsFor(item, override = {}) {
  const s = item.settings;
  const presetId = override.presetId || s.presetId;
  const preset = PRESET_BY_ID[presetId] || PRESETS[0];
  const strength = override.presetStrength != null ? override.presetStrength : s.presetStrength;
  const look = blendLook(preset.look, Math.max(0, Math.min(100, strength)) / 100);
  const a = s.adjust;
  const r = s.retouch;
  const ref = !override.noMatch && s.match.refId ? state.refs.get(s.match.refId) : null;
  const st = item.stats || { mean: [55, 6, 6], std: [18, 7, 7] };

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
    smoothRadius: 0.0035 + 0.0085 * (r.smooth / 100),
    bokeh: r.bokeh / 100,
    bokehLight: r.bokehLight / 100,
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
  bctx.drawImage(item.source, 0, 0, bw, bh);

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
    Object.values(s.adjust).some(v => v !== 0) ||
    s.retouch.smooth > 0 || s.retouch.brighten > 0 || s.retouch.bokeh > 0 || s.retouch.bokehLight > 0 ||
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
  }
  updateFilmSelection();
  els.fileChip.hidden = false;
  els.fileName.textContent = item.name;
  els.fileMeta.textContent = `${item.width} × ${item.height}`;
  syncUI();
  updateMeta();
  draw();
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
    item.masks = { skin: res.skin, person: res.person, mode: 'ai', coverage: res.coverage, faces: res.faces };
    try {
      item.bokeh = buildBokehCanvases(item.source, item.width, item.height, res.person);
      item.bokehMasked = true;
    } catch (e) { /* 보케 텍스처는 기존 것 유지 */ }
    if (isActive(item) && renderer) {
      renderer.setMasks(item.masks);
      renderer.setBokeh(item.bokeh || {});
      if (item.settings.retouch.smooth > 0 || item.settings.retouch.brighten > 0 || item.settings.retouch.bokeh > 0 || item.settings.retouch.bokehLight > 0) scheduleRender();
      updateAiStatus();
    }
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
  updateNamePreview();
  els.showMask && (els.showMask.checked = state.maskView);
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
function bindEvents() {
  const pick = () => els.fileInput.click();
  $('#btnImport').addEventListener('click', pick);
  $('#btnPickEmpty').addEventListener('click', pick);
  $('#btnFilmAdd').addEventListener('click', pick);
  els.fileInput.addEventListener('change', e => {
    addFiles(e.target.files);
    e.target.value = '';
  });

  const loadSamples = async () => {
    if (state.busy) return;
    toast('샘플 사진을 불러오는 중…');
    for (const s of SAMPLE_FILES) {
      try {
        const res = await fetch(s.url);
        if (!res.ok) throw new Error('fetch');
        const blob = await res.blob();
        const file = new File([blob], s.name, { type: blob.type || 'image/jpeg' });
        await addFiles([file]);
      } catch (e) {
        console.warn('sample load failed', s.url, e);
      }
    }
    if (!state.items.length) toast('샘플을 불러오지 못했습니다. 사진을 직접 올려 주세요.');
  };
  $('#btnSample').addEventListener('click', loadSamples);
  $('#btnSampleEmpty').addEventListener('click', loadSamples);

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
      if (g === 'skin') { item.settings.retouch.smooth = 0; item.settings.retouch.brighten = 0; }
      if (g === 'bg') { item.settings.retouch.bokeh = 0; item.settings.retouch.bokehLight = 0; }
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

/* ── 초기화 ─────────────────────────────────────────── */
function init() {
  buildPresetGrid();
  bindSliders();
  bindEvents();
  setTab('light');
  setCompare(false);
  ['exposure', 'contrast', 'highlights', 'shadows', 'temp', 'tint', 'saturation', 'clarity', 'vignette', 'grain', 'smooth', 'brighten', 'bokeh', 'bokehLight', 'matchStrength'].forEach(k => {
    const el = document.querySelector(`.slider[data-key="${k}"]`);
    if (el) {
      const input = el.querySelector('input[type=range]');
      paintSlider(el, Number(input.value));
    }
  });
  paintSlider(els.qualityRow, state.quality);
  els.presetStrength.style.setProperty('--fill', '100%');
  updateNamePreview();
  updateMeta();
  if (!renderer) toast('이 브라우저에서는 WebGL2를 사용할 수 없습니다.', 6000);
}
init();
