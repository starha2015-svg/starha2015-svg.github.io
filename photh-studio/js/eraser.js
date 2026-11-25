/* PHOTH Studio — 지우개 (사람·사물 제거)
 * 브러시로 칠한 부분 + 배경 인물 자동 감지 마스크를 모아
 * Cloudflare Worker(fal-ai/object-removal/mask)로 보내고 결과를 원본 해상도에 합성한다.
 * 사진은 이 기능을 실행할 때만 프록시(Worker)를 거쳐 fal.ai로 전송된다.
 */

const SEND_LONG_EDGE = 2560;   // fal 로 보내는 작업 해상도(긴 변)
const MAX_COMPOSE_PIXELS = 24e6;
const WORKER_URL = 'https://photh-eraser-proxy.starha2015.workers.dev';
const AUTH_TOKEN = 'ok:43c060b3a59032e0e8e3';

const $ = (s, r = document) => r.querySelector(s);

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function loadImageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image decode failed')); };
    img.src = url;
  });
}

export function initEraser(hooks) {
  const { getItem, applyErased, toast, setBusy } = hooks;

  const els = {
    panel: $('[data-panel="erase"]'),
    layer: $('#eraseLayer'),
    brush: $('#eraseBrush'),
    brushOut: $('#eraseBrushOut'),
    feather: $('#eraseFeather'),
    featherOut: $('#eraseFeatherOut'),
    btnRun: $('#btnEraseRun'),
    btnUndo: $('#btnEraseUndo'),
    btnClear: $('#btnEraseClear'),
    btnAuto: $('#btnEraseAuto'),
    btnAutoClear: $('#btnEraseAutoClear'),
    btnRestore: $('#btnEraseRestore'),
    status: $('#eraseStatus'),
    sizeInfo: $('#eraseSize'),
    spinner: $('#eraseSpinner'),
    autoInfo: $('#eraseAutoInfo')
  };
  if (!els.layer || !els.btnRun) return null;

  let busy = false;
  let painting = false;
  let last = null;
  let active = false;

  const editing = () => active && !!getItem();

  /* ── 아이템별 지우개 상태 ───────────────────────────── */
  function ensureErase(item) {
    if (!item.erase) {
      item.erase = { alpha: null, w: 0, h: 0, strokes: [], auto: null, autoNote: '' };
    }
    const e = item.erase;
    const scale = Math.min(1, SEND_LONG_EDGE / Math.max(item.width, item.height));
    const w = Math.max(16, Math.round(item.width * scale));
    const h = Math.max(16, Math.round(item.height * scale));
    if (!e.alpha || e.w !== w || e.h !== h) {
      const prev = e.alpha;
      e.alpha = makeCanvas(w, h);
      e.w = w; e.h = h;
      if (prev) e.alpha.getContext('2d').drawImage(prev, 0, 0, w, h);
      e.strokes = [];
      e.auto = null;
    }
    return e;
  }

  /* ── 좌표 매핑 (수평 보정 회전 반영) ───────────────── */
  function displaySize() {
    const inner = $('#canvasInner');
    const r = inner.getBoundingClientRect();
    return { w: r.width, h: r.height, left: r.left, top: r.top };
  }

  function toImagePt(clientX, clientY) {
    const item = getItem();
    if (!item) return null;
    const d = displaySize();
    if (!d.w || !d.h) return null;
    let x = clientX - d.left - d.w / 2;
    let y = clientY - d.top - d.h / 2;
    const deg = (item.settings.tilt && item.settings.tilt.angle) || 0;
    if (deg) {
      // 화면은 +deg 회전되어 그려지므로 역회전
      const t = (deg * Math.PI) / 180;
      const cs = Math.cos(t), sn = Math.sin(t);
      const rx = x * cs + y * sn;
      const ry = -x * sn + y * cs;
      x = rx; y = ry;
      // straightenFor()의 확대 배율 보정
      const w = item.width, h = item.height;
      const a = Math.abs(t);
      const zoom = Math.max(
        Math.cos(a) + Math.sin(a) * (h / w),
        Math.cos(a) + Math.sin(a) * (w / h)
      );
      x /= Math.max(1.0001, zoom);
      y /= Math.max(1.0001, zoom);
    }
    const u = (x + d.w / 2) / d.w;
    const v = (y + d.h / 2) / d.h;
    return { x: u * item.width, y: v * item.height, u, v };
  }

  /* ── 마스크 그리기 ──────────────────────────────────── */
  function alphaCtx(item) {
    const e = ensureErase(item);
    return e.alpha.getContext('2d');
  }

  function strokeMask(item, a, b, radiusPx) {
    const e = ensureErase(item);
    const ctx = e.alpha.getContext('2d');
    const sx = e.w / item.width, sy = e.h / item.height;
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#fff';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1, radiusPx * 2 * sx);
    ctx.beginPath();
    ctx.moveTo(a.x * sx, a.y * sy);
    ctx.lineTo(b.x * sx, b.y * sy);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(b.x * sx, b.y * sy, Math.max(0.7, radiusPx * sx), 0, Math.PI * 2);
    ctx.fill();
  }

  function brushRadius() {
    return Math.max(2, Number(els.brush ? els.brush.value : 36) / 2);
  }

  function strokeRadiusImage() {
    const item = getItem();
    const d = displaySize();
    if (!item || !d.w) return brushRadius();
    return brushRadius() * (item.width / d.w);
  }

  /* ── 미리보기 오버레이 ─────────────────────────────── */
  function drawOverlay() {
    const item = getItem();
    const layer = els.layer;
    const suppressed = hooks.isSuppressed && hooks.isSuppressed();
    if (!item || !active || suppressed) { layer.hidden = true; return; }
    const d = displaySize();
    if (!d.w) { layer.hidden = true; return; }

    layer.hidden = false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.max(8, Math.round(d.w * dpr));
    const H = Math.max(8, Math.round(d.h * dpr));
    if (layer.width !== W || layer.height !== H) { layer.width = W; layer.height = H; }

    const ctx = layer.getContext('2d');
    ctx.clearRect(0, 0, W, H);

    // 화면에 그려진 이미지와 같은 회전/확대를 적용
    const deg = (item.settings.tilt && item.settings.tilt.angle) || 0;
    const e = ensureErase(item);
    ctx.save();
    if (deg) {
      const t = (deg * Math.PI) / 180;
      const a = Math.abs(t);
      const zoom = Math.max(
        Math.cos(a) + Math.sin(a) * (item.height / item.width),
        Math.cos(a) + Math.sin(a) * (item.width / item.height)
      );
      ctx.translate(W / 2, H / 2);
      ctx.rotate(t);
      ctx.scale(Math.max(1.0001, zoom), Math.max(1.0001, zoom));
      ctx.translate(-W / 2, -H / 2);
    }

    if (e.alpha) {
      const tint = makeCanvas(W, H);
      const tctx = tint.getContext('2d');
      tctx.drawImage(e.alpha, 0, 0, W, H);
      tctx.globalCompositeOperation = 'source-in';
      tctx.fillStyle = 'rgba(255, 66, 84, 0.46)';
      tctx.fillRect(0, 0, W, H);
      ctx.drawImage(tint, 0, 0);
    }
    ctx.restore();

    // 브러시 커서 링
    if (cursor) {
      const r = brushRadius();
      ctx.save();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.arc(cursor.x * dpr, cursor.y * dpr, r * dpr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cursor.x * dpr, cursor.y * dpr, r * dpr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  let cursor = null;

  /* ── 상태 표시 ─────────────────────────────────────── */
  function updateInfo() {
    const item = getItem();
    if (!item) {
      if (els.sizeInfo) els.sizeInfo.textContent = '—';
      return;
    }
    const e = ensureErase(item);
    if (els.sizeInfo) {
      els.sizeInfo.textContent = `${e.w} × ${e.h}px 작업 · 원본 ${item.width} × ${item.height}`;
    }
    const has = hasMask(item);
    if (els.btnRun) {
      els.btnRun.disabled = busy || !has;
      els.btnRun.classList.toggle('is-ready', has && !busy);
    }
    if (els.btnUndo) els.btnUndo.disabled = busy || (!e.strokes.length && !e.auto);
    if (els.btnRestore) els.btnRestore.disabled = busy || !(item.eraseUndo && item.eraseUndo.length);
  }

  function hasMask(item) {
    const e = item && item.erase;
    if (!e) return false;
    if (e.auto) return true;
    if (!e.strokes.length) return false;
    // 실제로 칠해진 픽셀이 있는지 확인
    if (!e.alpha) return false;
    const ctx = e.alpha.getContext('2d', { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, e.w, e.h).data;
    for (let i = 3; i < img.length; i += 4 * 13) {
      if (img[i] > 8) return true;
    }
    return false;
  }

  function setStatus(msg, kind) {
    if (!els.status) return;
    els.status.textContent = msg || '';
    els.status.dataset.kind = kind || '';
  }

  /* ── 포인터 ────────────────────────────────────────── */
  function localPt(e) {
    const d = displaySize();
    return { x: e.clientX - d.left, y: e.clientY - d.top };
  }

  function onDown(e) {
    if (!editing() || busy) return;
    const item = getItem();
    if (!item) return;
    els.layer.setPointerCapture?.(e.pointerId);
    painting = true;
    cursor = localPt(e);
    const p = toImagePt(e.clientX, e.clientY);
    if (!p) return;
    const r = strokeRadiusImage();
    ensureErase(item);
    strokeMask(item, p, p, r);
    item.erase.strokes.push({ r, pts: [[p.x, p.y]] });
    drawOverlay();
    updateInfo();
    e.preventDefault();
  }

  function onMove(e) {
    if (!editing()) return;
    cursor = localPt(e);
    if (!painting || busy) { drawOverlay(); return; }
    const item = getItem();
    const p = toImagePt(e.clientX, e.clientY);
    if (!item || !p) return;
    const st = item.erase.strokes[item.erase.strokes.length - 1];
    if (!st) return;
    const prev = st.pts[st.pts.length - 1];
    strokeMask(item, { x: prev[0], y: prev[1] }, p, st.r);
    st.pts.push([p.x, p.y]);
    drawOverlay();
    updateInfo();
  }

  function onUp() {
    painting = false;
  }

  /* ── 자동 감지: 배경 인물 ───────────────────────────── */
  function buildAutoMask(item) {
    const m = item.masks;
    if (!m || !m.person) return { note: '인물 마스크가 아직 없습니다. 사진 분석이 끝난 뒤 다시 시도해 주세요.' };
    const src = m.person;
    const mw = src.width, mh = src.height;
    const c = makeCanvas(mw, mh);
    const cx2 = c.getContext('2d', { willReadFrequently: true });
    cx2.drawImage(src, 0, 0, mw, mh);
    let data;
    try { data = cx2.getImageData(0, 0, mw, mh).data; } catch (err) { return { note: '마스크를 읽을 수 없습니다.' }; }

    const N = mw * mh;
    const on = new Uint8Array(N);
    for (let i = 0; i < N; i++) on[i] = data[i * 4] > 110 ? 1 : 0;

    // 연결 요소 라벨링
    const label = new Int32Array(N).fill(-1);
    const comps = [];
    const stack = new Int32Array(N);
    for (let i = 0; i < N; i++) {
      if (!on[i] || label[i] >= 0) continue;
      const id = comps.length;
      let sp = 0;
      stack[sp++] = i;
      label[i] = id;
      let area = 0, sx = 0, sy = 0, x0 = mw, y0 = mh, x1 = 0, y1 = 0;
      while (sp) {
        const k = stack[--sp];
        const x = k % mw, y = (k - x) / mw;
        area++; sx += x; sy += y;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x > 0 && on[k - 1] && label[k - 1] < 0) { label[k - 1] = id; stack[sp++] = k - 1; }
        if (x < mw - 1 && on[k + 1] && label[k + 1] < 0) { label[k + 1] = id; stack[sp++] = k + 1; }
        if (y > 0 && on[k - mw] && label[k - mw] < 0) { label[k - mw] = id; stack[sp++] = k - mw; }
        if (y < mh - 1 && on[k + mw] && label[k + mw] < 0) { label[k + mw] = id; stack[sp++] = k + mw; }
      }
      comps.push({ id, area, cx: sx / area / mw, cy: sy / area / mh, x0, y0, x1, y1 });
    }
    if (!comps.length) return { note: '인물 영역을 찾지 못했습니다.' };
    comps.sort((a, b) => b.area - a.area);

    // 얼굴별로 어느 덩어리에 속하는지
    const faces = (item.masks.faceBoxes || []).map(f => {
      const x = Math.min(mw - 1, Math.max(0, Math.round(f.cx * mw)));
      const y = Math.min(mh - 1, Math.max(0, Math.round(f.cy * mh)));
      return { ...f, comp: label[y * mw + x] };
    });
    const mainFace = faces.slice().sort((a, b) => b.w - a.w)[0];
    let mainId = mainFace && mainFace.comp >= 0 ? mainFace.comp : comps[0].id;
    if (mainFace && mainFace.comp < 0) mainId = comps[0].id;
    const mainComp = comps.find(cp => cp.id === mainId) || comps[0];

    // 얼굴이 검출된 사진에서는 '얼굴이 있는 다른 덩어리'만 지운다 (번짐·그림자 오검출 방지)
    const hasFaces = faces.length > 0;
    const targets = comps.filter(cp => {
      if (cp.id === mainId) return false;
      if (cp.area > N * 0.45) return false;
      const faceHere = faces.some(f => f.comp === cp.id && f !== mainFace);
      if (hasFaces) return faceHere;
      return cp.area > Math.max(N * 0.0025, mainComp.area * 0.05);
    });

    if (!targets.length) {
      return { note: '중심 인물 말고는 지울 만한 다른 사람을 찾지 못했습니다. 브러시로 직접 칠해 주세요.' };
    }

    // 마스크 그리기 (조금 부풀려서)
    const out = makeCanvas(mw, mh);
    const octx = out.getContext('2d');
    const img = octx.createImageData(mw, mh);
    const keep = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const id = label[i];
      keep[i] = id >= 0 && targets.some(t => t.id === id) ? 1 : 0;
    }
    // 1px 팽창
    for (let y = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++) {
        const i = y * mw + x;
        let v = keep[i];
        if (!v) {
          if (x > 0 && keep[i - 1]) v = 1;
          else if (x < mw - 1 && keep[i + 1]) v = 1;
          else if (y > 0 && keep[i - mw]) v = 1;
          else if (y < mh - 1 && keep[i + mw]) v = 1;
        }
        // 흰색 + 알파(마스크 밖은 투명) — 오버레이·합성에서 배경을 덮지 않게
        img.data[i * 4] = 255; img.data[i * 4 + 1] = 255; img.data[i * 4 + 2] = 255;
        img.data[i * 4 + 3] = v ? 255 : 0;
      }
    }
    octx.putImageData(img, 0, 0);
    const soft = makeCanvas(mw, mh);
    const sctx = soft.getContext('2d');
    sctx.filter = `blur(${Math.max(1, mw / 160)}px)`;
    sctx.drawImage(out, 0, 0);
    sctx.filter = 'none';

    const people = targets.length;
    const faceCount = faces.filter(f => f !== mainFace).length;
    return {
      canvas: soft,
      note: `주변 인물 ${people}덩어리${faceCount ? ` · 얼굴 ${faceCount}명` : ''} 감지 · 필요하면 브러시로 더 칠하세요`
    };
  }

  function applyAuto() {
    const item = getItem();
    if (!item || busy) return;
    ensureErase(item);
    const res = buildAutoMask(item);
    if (!res.canvas) { toast(res.note); if (els.autoInfo) els.autoInfo.textContent = res.note; return; }
    const e = item.erase;
    e.auto = res.canvas;
    e.autoNote = res.note;
    // 미리보기에는 auto 마스크도 합쳐서 보여 준다
    mergeAutoIntoAlpha(item);
    drawOverlay();
    updateInfo();
    if (els.autoInfo) els.autoInfo.textContent = res.note;
    toast(res.note, 3600);
  }

  function mergeAutoIntoAlpha(item) {
    const e = item.erase;
    if (!e || !e.auto || !e.alpha) return;
    const ctx = e.alpha.getContext('2d');
    ctx.drawImage(e.auto, 0, 0, e.w, e.h);
  }

  function clearMask(silent) {
    const item = getItem();
    if (!item) return;
    ensureErase(item);
    item.erase.alpha.getContext('2d').clearRect(0, 0, item.erase.w, item.erase.h);
    item.erase.strokes = [];
    item.erase.auto = null;
    if (els.autoInfo) els.autoInfo.textContent = '';
    drawOverlay();
    updateInfo();
    if (!silent) toast('칠한 부분을 지웠습니다.');
  }

  function undoStroke() {
    const item = getItem();
    if (!item || !item.erase) return;
    const e = item.erase;
    if (!e.strokes.length && !e.auto) { toast('되돌릴 칠이 없습니다.'); return; }
    e.strokes = [];
    e.auto = null;
    e.alpha.getContext('2d').clearRect(0, 0, e.w, e.h);
    if (els.autoInfo) els.autoInfo.textContent = '';
    drawOverlay();
    updateInfo();
    toast('마지막으로 칠한 부분을 되돌렸습니다.');
  }

  /* ── 실행 ──────────────────────────────────────────── */
  function buildPayload(item) {
    const e = ensureErase(item);
    const sw = e.w, sh = e.h;

    const send = makeCanvas(sw, sh);
    const sctx = send.getContext('2d');
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(item.source, 0, 0, sw, sh);

    // 마스크: 알파 채널(흰색) → 흑백 PNG
    const mask = makeCanvas(sw, sh);
    const mctx = mask.getContext('2d');
    mctx.fillStyle = '#000';
    mctx.fillRect(0, 0, sw, sh);
    mctx.drawImage(e.alpha, 0, 0, sw, sh);

    return {
      image: send.toDataURL('image/jpeg', 0.95),
      mask: mask.toDataURL('image/png'),
      w: sw,
      h: sh
    };
  }

  async function composeFull(item, blob) {
    const fullW = item.width, fullH = item.height;
    const img = await loadImageFromBlob(blob);
    if (fullW * fullH > MAX_COMPOSE_PIXELS) {
      // 너무 큰 사진은 결과 해상도 그대로 사용
      const out = makeCanvas(img.naturalWidth || img.width, img.naturalHeight || img.height);
      out.getContext('2d').drawImage(img, 0, 0);
      return out;
    }
    const out = makeCanvas(fullW, fullH);
    const octx = out.getContext('2d');
    octx.imageSmoothingQuality = 'high';
    octx.drawImage(item.source, 0, 0, fullW, fullH);

    const patch = makeCanvas(fullW, fullH);
    const pctx = patch.getContext('2d');
    pctx.imageSmoothingQuality = 'high';
    pctx.drawImage(img, 0, 0, fullW, fullH);

    const fm = makeCanvas(fullW, fullH);
    const fctx = fm.getContext('2d');
    const feather = Number(els.feather ? els.feather.value : 8);
    const blurPx = Math.max(0, (feather / 100) * (Math.max(fullW, fullH) / 100));
    if (blurPx > 0) fctx.filter = `blur(${blurPx.toFixed(2)}px)`;
    fctx.imageSmoothingQuality = 'high';
    fctx.drawImage(item.erase.alpha, 0, 0, fullW, fullH);
    fctx.filter = 'none';

    pctx.globalCompositeOperation = 'destination-in';
    pctx.drawImage(fm, 0, 0);
    octx.drawImage(patch, 0, 0);
    return out;
  }

  async function runErase() {
    const item = getItem();
    if (!item || busy) return;
    if (!hasMask(item)) { toast('지울 사람·사물을 먼저 브러시로 칠해 주세요.'); return; }

    busy = true;
    setBusy && setBusy(true);
    if (els.spinner) els.spinner.hidden = false;
    els.btnRun.disabled = true;
    const t0 = performance.now();
    try {
      const p = buildPayload(item);
      setStatus('사진을 fal.ai로 보내는 중… AI가 주변을 채워 넣습니다 (10~30초)');
      const res = await fetch(WORKER_URL + '/erase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Photh-Auth': AUTH_TOKEN },
        body: JSON.stringify({ image: p.image, mask: p.mask, expand: 12, model: 'best_quality' })
      });

      if (!res.ok) {
        let msg = '지우기에 실패했습니다.';
        try {
          const j = await res.json();
          if (j.error === 'unauthorized') msg = '프록시 인증이 맞지 않습니다. 잠금을 해제한 화면에서 다시 시도해 주세요.';
          else if (j.error === 'fal_no_credit') msg = 'AI 지우개 크레딧이 아직 없습니다. fal.ai 잔액을 충전하면 바로 쓸 수 있어요.';
          else if (j.error === 'too_large') msg = '사진 용량이 너무 큽니다. 조금 작은 사진으로 시도해 주세요.';
          else if (j.error === 'fal_key_missing' || j.error === 'server_not_configured') msg = '프록시에 fal.ai 키가 아직 설정되지 않았습니다.';
          else if (j.error === 'timeout') msg = 'AI 응답이 너무 늦습니다. 잠시 후 다시 시도해 주세요.';
          else if (j.detail) msg = `지우기 실패 (${j.error || res.status})`;
        } catch (e2) { /* 무시 */ }
        throw new Error(msg);
      }

      setStatus('결과를 사진에 합성하는 중…');
      const blob = await res.blob();
      const full = await composeFull(item, blob);
      applyErased(item, full);
      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      setStatus(`지우기 완료 · ${secs}초 · 마음에 안 들면 [이전 상태로]`);
      clearMask(true);
      toast('지운 부분을 주변과 자연스럽게 채웠습니다.');
    } catch (err) {
      console.error(err);
      setStatus(err.message || '지우기에 실패했습니다.', 'error');
      toast(err.message || '지우기에 실패했습니다.', 3600);
    } finally {
      busy = false;
      setBusy && setBusy(false);
      if (els.spinner) els.spinner.hidden = true;
      updateInfo();
      drawOverlay();
    }
  }

  /* ── 이벤트 ────────────────────────────────────────── */
  els.layer.addEventListener('pointerdown', onDown);
  els.layer.addEventListener('pointermove', onMove);
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => els.layer.addEventListener(ev, onUp));
  els.layer.addEventListener('contextmenu', e => e.preventDefault());

  if (els.brush) {
    const paintFill = () => {
      const min = Number(els.brush.min) || 0, max = Number(els.brush.max) || 100;
      els.brush.style.setProperty('--fill', Math.round((Number(els.brush.value) - min) / (max - min) * 100) + '%');
    };
    els.brush.addEventListener('input', () => {
      if (els.brushOut) els.brushOut.textContent = els.brush.value;
      paintFill();
      drawOverlay();
    });
    if (els.brushOut) els.brushOut.textContent = els.brush.value;
    paintFill();
  }
  if (els.feather && els.featherOut) {
    const paintFill = () => {
      const min = Number(els.feather.min) || 0, max = Number(els.feather.max) || 100;
      els.feather.style.setProperty('--fill', Math.round((Number(els.feather.value) - min) / (max - min) * 100) + '%');
    };
    els.feather.addEventListener('input', () => { els.featherOut.textContent = els.feather.value; paintFill(); });
    els.featherOut.textContent = els.feather.value;
    paintFill();
  }
  els.btnRun.addEventListener('click', runErase);
  els.btnUndo.addEventListener('click', undoStroke);
  els.btnClear.addEventListener('click', () => clearMask(false));
  if (els.btnAuto) els.btnAuto.addEventListener('click', applyAuto);
  if (els.btnAutoClear) els.btnAutoClear.addEventListener('click', () => clearMask(false));
  if (els.btnRestore) {
    els.btnRestore.addEventListener('click', () => {
      const item = getItem();
      if (!item || !item.eraseUndo || !item.eraseUndo.length) return;
      applyErased(item, null, { undo: true });
      toast('지우기 전 상태로 되돌렸습니다.');
      updateInfo();
      drawOverlay();
    });
  }

  window.addEventListener('resize', () => { if (active) drawOverlay(); });

  return {
    setActive(on) {
      active = on;
      els.layer.hidden = !on;
      if (on) {
        const item = getItem();
        if (item) ensureErase(item);
        requestAnimationFrame(() => { drawOverlay(); updateInfo(); });
        setStatus('지울 사람·사물을 브러시로 칠한 뒤 [지우기 실행]을 누르세요.');
      } else {
        cursor = null;
        setStatus('');
      }
    },
    refresh() {
      if (!active) return;
      const item = getItem();
      if (item) ensureErase(item);
      drawOverlay();
      updateInfo();
    },
    clearForItem() {
      const item = getItem();
      if (item && item.erase) clearMask(true);
    }
  };
}
