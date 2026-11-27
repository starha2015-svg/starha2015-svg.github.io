/* BLACK LINE 명함 편집기 — 정적 웹앱 */
(function () {
  'use strict';

  /* ---------------------------------------------------------------- 기본값 */

  var CARD = { w: 90, h: 50 };          // 명함 규격 (mm)
  var CAP = 0.707;                       // Pretendard 대문자 높이 비율
  var FONT = "'Pretendard', -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', sans-serif";
  var INK = '#121212';
  var STORE = 'blackline.card.v1';

  var DEFAULTS = {
    company: 'BLACK LINE',
    name: '최성길',
    nameEn: 'CHOI SEONG GIL',
    role: '[대표]',
    insta: 'Blackline_security',
    phone: '010 2895 9778',
    email: 'blackline.guard@gmail.com',
    web: 'www.blackline-security.co.kr',
    address: '서울특별시 관악구 서림길 48 , 202호',
    qr: 'https://m.site.naver.com/23AXY',
    qrFrame: true
  };

  /* ------------------------------------------------------------ 상태 관리 */

  var data = Object.assign({}, DEFAULTS, readStore());

  function readStore() {
    try {
      var raw = localStorage.getItem(STORE);
      if (!raw) return {};
      var obj = JSON.parse(raw);
      return (obj && typeof obj === 'object') ? obj : {};
    } catch (e) { return {}; }
  }

  var saveTimer = 0;
  function saveStore() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { localStorage.setItem(STORE, JSON.stringify(data)); } catch (e) {}
    }, 250);
  }

  /* -------------------------------------------------------------- 캔버스 */

  var frontCanvas = document.getElementById('frontCanvas');
  var backCanvas = document.getElementById('backCanvas');

  function hasCanvasSupport(cv) {
    return !!(cv && cv.getContext && cv.getContext('2d'));
  }

  var fontReady = false;
  function whenFonts() {
    if (!document.fonts || !document.fonts.load) { fontReady = true; return; }
    Promise.all([
      document.fonts.load('400 20px Pretendard'),
      document.fonts.load('500 20px Pretendard'),
      document.fonts.load('700 20px Pretendard')
    ]).then(function () { fontReady = true; drawAll(); })
      .catch(function () { fontReady = true; drawAll(); });
  }

  /* -------------------------------------------------------------- 그리기 */

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  // 한 줄 텍스트. 반환값: 그린 텍스트의 실제 폭(px)
  function drawText(ctx, str, xmm, baselineMm, opt, u, v) {
    if (str == null) return 0;
    str = String(str);
    if (!str.length) return 0;

    var weight = opt.weight || 400;
    var sizeMm = opt.size;
    var maxW = (opt.maxW || Infinity) * u;

    ctx.font = weight + ' ' + (sizeMm * v) + 'px ' + FONT;
    var w = ctx.measureText(str).width;
    if (w > maxW) {
      sizeMm = sizeMm * (maxW / w);
      ctx.font = weight + ' ' + (sizeMm * v) + 'px ' + FONT;
      w = maxW;
    }

    var x = xmm * u;
    var align = opt.align || 'left';
    if (align === 'center') x -= w / 2;
    else if (align === 'right') x -= w;

    ctx.fillStyle = opt.color || INK;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(str, x, baselineMm * v);
    return w;
  }

  function drawInstaIcon(ctx, xmm, centerMm, sizeMm, u, v) {
    var s = sizeMm * v;
    var x = xmm * u;
    var y = centerMm * v - s / 2;
    ctx.save();
    ctx.strokeStyle = INK;
    ctx.fillStyle = INK;
    ctx.lineWidth = Math.max(1, s * 0.095);
    roundRect(ctx, x + ctx.lineWidth / 2, y + ctx.lineWidth / 2, s - ctx.lineWidth, s - ctx.lineWidth, s * 0.27);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + s / 2, y + s / 2, s * 0.245, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + s * 0.755, y + s * 0.245, s * 0.052, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // QR 코드 — 모듈 단위로 그린 뒤 확대해 인쇄에서도 또렷하게
  function drawQR(ctx, text, xmm, ymm, sizeMm, u, v, frame) {
    var content = String(text || '').trim();
    if (!content) return false;
    var qr;
    try {
      qr = qrcode(0, 'M');
      qr.addData(content, 'Byte');
      qr.make();
    } catch (e) { return false; }

    var n = qr.getModuleCount();
    if (!n) return false;

    var pad = 2;                       // 조용한 여백(모듈)
    var total = n + pad * 2;
    var off = document.createElement('canvas');
    off.width = off.height = total;
    var octx = off.getContext('2d');
    octx.fillStyle = '#ffffff';
    octx.fillRect(0, 0, total, total);
    octx.fillStyle = '#000000';
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (qr.isDark(r, c)) octx.fillRect(c + pad, r + pad, 1, 1);
      }
    }

    var bx = Math.round(xmm * u);
    var by = Math.round(ymm * v);
    var bw = Math.round(sizeMm * u);
    var bh = Math.round(sizeMm * v);
    var inset = frame ? Math.max(1, Math.round(0.22 * v)) : 0;

    if (frame) {
      ctx.save();
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = inset;
      ctx.strokeRect(bx + inset / 2, by + inset / 2, bw - inset, bh - inset);
      ctx.restore();
    }

    var smooth = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, bx + inset, by + inset, bw - inset * 2, bh - inset * 2);
    ctx.imageSmoothingEnabled = smooth;
    return true;
  }

  /* ------------------------------------------------------------- 앞면 */

  function drawFront(ctx, u, v) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, CARD.w * u, CARD.h * v);

    // 상·하단 중앙 수직선
    var lw = Math.max(1, 0.5 * u);
    ctx.fillStyle = INK;
    ctx.fillRect(45 * u - lw / 2, 0, lw, 15 * v);
    ctx.fillRect(45 * u - lw / 2, 35 * v, lw, 15 * v);

    // 중앙 로고
    drawText(ctx, data.company, 45, 25 + 7.35 / 2, {
      size: 7.35 / CAP,
      weight: 700,
      align: 'center',
      maxW: 78,
      color: INK
    }, u, v);
  }

  /* ------------------------------------------------------------- 뒷면 */

  function measureMm(ctx, str, sizeMm, weight, v) {
    if (!str) return 0;
    ctx.font = weight + ' ' + (sizeMm * v) + 'px ' + FONT;
    return ctx.measureText(String(str)).width / v;
  }

  function drawBack(ctx, u, v) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, CARD.w * u, CARD.h * v);

    // 좌상단 로고
    drawText(ctx, data.company, 4.2, 8.7, {
      size: 3.3 / CAP,
      weight: 700,
      maxW: 39,
      color: INK
    }, u, v);

    // 중앙 세로 구분선
    var dw = Math.max(1, 0.25 * u);
    ctx.fillStyle = INK;
    ctx.fillRect(45 * u - dw / 2, 4.2 * v, dw, 41.6 * v);

    // 우상단 QR
    drawQR(ctx, data.qr, 77.9, 4.5, 7.9, u, v, data.qrFrame !== false);

    // 우측 연락처
    var rows = [['mobile.', data.phone], ['email.', data.email], ['web.', data.web]];
    var base = [25.9, 29.5, 33.1];
    for (var i = 0; i < rows.length; i++) {
      drawText(ctx, rows[i][0], 55.0, base[i], { size: 2.0, weight: 400, color: INK }, u, v);
      var labW = measureMm(ctx, rows[i][0], 2.0, 400, v);
      drawText(ctx, rows[i][1], 86.0, base[i], {
        size: 2.0, weight: 400, align: 'right', maxW: 86.0 - (55.0 + labW + 1.5), color: INK
      }, u, v);
    }

    // 우측 하단 주소
    drawText(ctx, data.address, 55.0, 44.0, {
      size: 1.88, weight: 400, maxW: 31, color: INK
    }, u, v);

    // 좌하단 이름 — 남은 폭에 맞춰 세 요소를 함께 줄인다
    var startX = 7.4;
    var avail = 43.6 - startX;
    var sK = 3.45, sE = 2.05, sR = 2.05, g1 = 1.5, g2 = 1.2;
    var hasEn = !!String(data.nameEn || '').trim();
    var hasRole = !!String(data.role || '').trim();
    var wK = measureMm(ctx, data.name, sK, 500, v);
    var wE = hasEn ? measureMm(ctx, data.nameEn, sE, 400, v) : 0;
    var wR = hasRole ? measureMm(ctx, data.role, sR, 400, v) : 0;
    var total = wK + (hasEn ? g1 + wE : 0) + (hasRole ? (hasEn ? g2 : g1) + wR : 0);
    if (total > avail && total > 0) {
      var k = avail / total;
      sK *= k; sE *= k; sR *= k; g1 *= k; g2 *= k;
      wK *= k; wE *= k; wR *= k;
    }

    drawText(ctx, data.name, startX, 35.4, { size: sK, weight: 500, color: INK }, u, v);
    var nx = startX + wK;
    if (hasEn) {
      nx += g1;
      drawText(ctx, data.nameEn, nx, 35.4, { size: sE, weight: 400, color: INK }, u, v);
      nx += wE;
    }
    if (hasRole) {
      nx += (hasEn ? g2 : g1);
      drawText(ctx, data.role, nx, 35.4, { size: sR, weight: 400, color: INK }, u, v);
    }

    // 인스타그램
    var iconX = startX + wK + (hasEn ? g1 : 0);
    var insta = String(data.insta || '').replace(/^@+/, '').trim();
    drawInstaIcon(ctx, iconX, 38.55, 2.15, u, v);
    if (insta) {
      drawText(ctx, insta, iconX + 2.8, 39.25, {
        size: 2.25, weight: 400, maxW: 19, color: INK
      }, u, v);
    }
  }

  /* ------------------------------------------------------------ 미리보기 */

  function drawSide(cv, side) {
    if (!hasCanvasSupport(cv)) return;
    var rect = cv.getBoundingClientRect();
    if (rect.width < 8) return;

    var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    var w = Math.round(rect.width * dpr);
    var h = Math.round(w * CARD.h / CARD.w);
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
    }
    var ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    var u = w / CARD.w;
    var v = h / CARD.h;
    if (side === 'front') drawFront(ctx, u, v);
    else drawBack(ctx, u, v);
  }

  var rafId = 0;
  function scheduleDraw() {
    if (rafId) return;
    rafId = requestAnimationFrame(function () {
      rafId = 0;
      drawAll();
    });
  }

  function drawAll() {
    drawSide(frontCanvas, 'front');
    drawSide(backCanvas, 'back');
    updateQRHint();
  }

  /* ---------------------------------------------------------------- 내보내기 */

  function renderCard(side, wpx, hpx) {
    var cv = document.createElement('canvas');
    cv.width = wpx;
    cv.height = hpx;
    var ctx = cv.getContext('2d');
    var u = wpx / CARD.w;
    var v = hpx / CARD.h;
    if (side === 'front') drawFront(ctx, u, v);
    else drawBack(ctx, u, v);
    return cv;
  }

  function DPI_W(dpi) { return Math.round(CARD.w / 25.4 * dpi); }
  function DPI_H(dpi) { return Math.round(CARD.h / 25.4 * dpi); }

  function safeName() {
    var n = String(data.name || '명함').replace(/[\\/:*?"<>|\s]+/g, '');
    return n || '명함';
  }

  function downloadCanvas(cv, filename) {
    return new Promise(function (resolve, reject) {
      cv.toBlob(function (blob) {
        if (!blob) { reject(new Error('PNG 생성 실패')); return; }
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
          URL.revokeObjectURL(url);
          a.remove();
          resolve();
        }, 1500);
      }, 'image/png');
    });
  }

  function exportPNG(side) {
    var cv = renderCard(side, DPI_W(300), DPI_H(300));
    var label = side === 'front' ? '앞면' : '뒷면';
    var fname = 'BLACKLINE_' + safeName() + '_' + label + '_300dpi.png';
    return downloadCanvas(cv, fname).then(function () {
      toast(label + ' PNG를 저장했습니다');
    });
  }

  function exportPDF() {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      toast('PDF 모듈을 불러오지 못했습니다');
      return Promise.resolve();
    }
    var dpi = 600;
    var front = renderCard('front', DPI_W(dpi), DPI_H(dpi));
    var back = renderCard('back', DPI_W(dpi), DPI_H(dpi));

    var jsPDF = window.jspdf.jsPDF;
    var pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [90, 50], compress: true });
    pdf.addImage(front.toDataURL('image/png'), 'PNG', 0, 0, 90, 50, undefined, 'FAST');
    pdf.addPage([90, 50], 'landscape');
    pdf.addImage(back.toDataURL('image/png'), 'PNG', 0, 0, 90, 50, undefined, 'FAST');
    pdf.save('BLACKLINE_' + safeName() + '_명함.pdf');
    toast('PDF를 저장했습니다');
    return Promise.resolve();
  }

  /* ------------------------------------------------------------------ UI */

  function bindInputs() {
    var nodes = document.querySelectorAll('[data-key]');
    for (var i = 0; i < nodes.length; i++) {
      (function (el) {
        var key = el.dataset.key;
        if (el.type === 'checkbox') el.checked = data[key] !== false && !!data[key];
        else el.value = data[key] == null ? '' : data[key];

        var evt = (el.tagName === 'TEXTAREA' || el.type === 'text' || el.type === 'tel' || el.type === 'email') ? 'input' : 'change';
        el.addEventListener(evt, function () {
          data[key] = el.type === 'checkbox' ? el.checked : el.value;
          saveStore();
          scheduleDraw();
          if (key === 'role' || key === 'insta') syncChips();
        });
        if (el.type === 'checkbox') {
          el.addEventListener('change', function () {
            data[key] = el.checked;
            saveStore();
            scheduleDraw();
          });
        }
      })(nodes[i]);
    }
  }

  function syncChips() {
    var chips = document.querySelectorAll('#roleChips .chip');
    for (var i = 0; i < chips.length; i++) {
      chips[i].classList.toggle('on', chips[i].dataset.role === data.role);
    }
  }

  function bindChips() {
    var chips = document.querySelectorAll('#roleChips .chip');
    for (var i = 0; i < chips.length; i++) {
      chips[i].addEventListener('click', function () {
        data.role = this.dataset.role;
        document.getElementById('f-role').value = data.role;
        saveStore();
        syncChips();
        scheduleDraw();
      });
    }

    var fmt = document.getElementById('phoneFormat');
    if (fmt) fmt.addEventListener('click', function () {
      var digits = String(data.phone || '').replace(/[^0-9]/g, '');
      var out = digits;
      if (digits.length === 11) out = digits.slice(0, 3) + ' ' + digits.slice(3, 7) + ' ' + digits.slice(7);
      else if (digits.length === 10) out = digits.slice(0, 3) + ' ' + digits.slice(3, 6) + ' ' + digits.slice(6);
      data.phone = out;
      document.getElementById('f-phone').value = out;
      saveStore();
      scheduleDraw();
      toast('휴대폰 번호를 정리했습니다');
    });

    var fromWeb = document.getElementById('qrFromWeb');
    if (fromWeb) fromWeb.addEventListener('click', function () {
      var web = String(data.web || '').trim();
      if (!web) { toast('웹사이트 주소를 먼저 입력해 주세요'); return; }
      var url = /^https?:\/\//i.test(web) ? web : 'https://' + web.replace(/^\/+/, '');
      data.qr = url;
      document.getElementById('f-qr').value = url;
      saveStore();
      scheduleDraw();
      toast('QR에 웹사이트 주소를 넣었습니다');
    });

    var nav = document.getElementById('qrNaver');
    if (nav) nav.addEventListener('click', function () {
      data.qr = DEFAULTS.qr;
      document.getElementById('f-qr').value = data.qr;
      saveStore();
      scheduleDraw();
      toast('원본 QR 링크로 되돌렸습니다');
    });
  }

  var qrHintTimerText = '';
  function updateQRHint() {
    var hint = document.getElementById('qrHint');
    if (!hint) return;
    var txt = String(data.qr || '').trim();
    if (!txt) {
      hint.textContent = '내용을 입력하면 QR 코드가 만들어집니다.';
      hint.classList.add('warn');
    } else {
      hint.textContent = '내용을 바꾸면 QR 코드가 바로 새로 만들어집니다.';
      hint.classList.remove('warn');
    }
  }

  var toastEl = document.getElementById('toast');
  var toastTimer = 0;
  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2200);
  }

  function bindExports() {
    var btns = document.querySelectorAll('[data-export]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () {
        var kind = this.dataset.export;
        this.disabled = true;
        var self = this;
        var work = kind === 'pdf' ? exportPDF()
          : kind === 'png-front' ? exportPNG('front')
            : exportPNG('back');
        Promise.resolve(work).catch(function (e) {
          toast('저장에 실패했습니다');
          if (window.console) console.error(e);
        }).then(function () {
          setTimeout(function () { self.disabled = false; }, 400);
        });
      });
    }
  }

  function bindReset() {
    var btn = document.getElementById('resetBtn');
    if (!btn) return;
    var armed = false, timer = 0;
    btn.addEventListener('click', function () {
      if (!armed) {
        armed = true;
        btn.textContent = '한 번 더 누르면 초기화';
        btn.classList.add('dark');
        timer = setTimeout(function () {
          armed = false;
          btn.textContent = '처음 값으로';
          btn.classList.remove('dark');
        }, 3200);
        return;
      }
      clearTimeout(timer);
      armed = false;
      btn.textContent = '처음 값으로';
      btn.classList.remove('dark');
      data = Object.assign({}, DEFAULTS);
      try { localStorage.removeItem(STORE); } catch (e) {}
      var nodes = document.querySelectorAll('[data-key]');
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        var key = el.dataset.key;
        if (el.type === 'checkbox') el.checked = !!data[key];
        else el.value = data[key] == null ? '' : data[key];
      }
      syncChips();
      drawAll();
      toast('처음 값으로 되돌렸습니다');
    });
  }

  /* ---------------------------------------------------------------- 시작 */

  function init() {
    bindInputs();
    bindChips();
    bindExports();
    bindReset();
    syncChips();
    drawAll();
    whenFonts();

    var resizeTimer = 0;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(drawAll, 120);
    });

    if (document.fonts && document.fonts.addEventListener) {
      document.fonts.addEventListener('loadingdone', drawAll);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
