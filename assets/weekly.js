/* =========================================================
   알바 주휴수당·실수령액 계산기 — weekly.js
   외부 라이브러리 없음. 모든 계산은 입력 즉시 로컬에서 수행.
   기준: 2026년 최저임금 10,320원 / 4대보험 근로자 부담 9.72%
   ========================================================= */
(function () {
  'use strict';

  var WEEKS_PER_MONTH = 4.345;      // 365일 ÷ 7일 ÷ 12개월
  var MIN_WAGE_2026 = 10320;

  /* 공제율: 3.3% = 소득세 3% + 지방소득세 0.3%,
     4대보험 2026년 근로자 부담 = 국민연금 4.75 + 건강 3.595 + 장기요양 0.4724 + 고용 0.9 */
  var DEDUCT = {
    none:      { rate: 0,        label: '공제 없음',  short: '0%' },
    freelance: { rate: 0.033,    label: '3.3%',      short: '3.3% 프리랜서' },
    insurance: { rate: 0.097174, label: '4대보험 9.72%', short: '4대보험 9.72%' }
  };

  var STORE_KEY = 'weeklycalc.v1';

  var state = {
    wage: MIN_WAGE_2026,
    inputMode: 'days',       // 'days' | 'hours'
    hoursPerDay: 6,
    daysPerWeek: 4,
    weeklyHours: 24,
    holidayOn: true,
    deduct: 'freelance'
  };

  /* ---------------- helpers ---------------- */

  function $(id) { return document.getElementById(id); }
  function on(el, ev, fn) { if (el) el.addEventListener(ev, fn); }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function parseNum(input) {
    if (typeof input === 'number') return isFinite(input) ? input : 0;
    var s = String(input == null ? '' : input)
      .replace(/[,\s₩원]/g, '')
      .replace(/[^0-9.\-]/g, '');
    var n = parseFloat(s);
    return isFinite(n) ? n : 0;
  }

  function trimZeros(s) {
    if (s.indexOf('.') !== -1) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s;
  }

  /* 숫자 → "1,234.5" */
  function numStr(v, dec) {
    if (!isFinite(v)) return '0';
    var s = trimZeros(v.toFixed(dec == null ? 2 : dec));
    var neg = s.charAt(0) === '-';
    if (neg) s = s.slice(1);
    var parts = s.split('.');
    parts[0] = Number(parts[0] || 0).toLocaleString('ko-KR');
    return (neg ? '-' : '') + parts.join('.');
  }

  /* 원 단위 표기 */
  function won(v) {
    if (!isFinite(v)) return '—';
    return numStr(Math.round(v), 0) + '원';
  }

  function setText(id, text) {
    var el = $(id);
    if (el) el.textContent = text;
  }
  function setHTML(id, html) {
    var el = $(id);
    if (el) el.innerHTML = html;
  }

  /* ---------------- 계산 ---------------- */

  function currentWeeklyHours() {
    if (state.inputMode === 'days') {
      return clamp(parseNum(state.hoursPerDay), 0, 24) * clamp(parseNum(state.daysPerWeek), 0, 7);
    }
    return clamp(parseNum(state.weeklyHours), 0, 168);
  }

  function compute() {
    var wage = clamp(parseNum(state.wage), 0, 1000000);
    var weekly = currentWeeklyHours();
    var eligible = weekly >= 15 - 1e-9;

    /* 주휴시간 = (주 소정근로 ÷ 40) × 8 = 주 근무 ÷ 5, 40시간 이상은 8시간 고정 */
    var holidayHours = (state.holidayOn && eligible) ? Math.min(8, weekly / 5) : 0;

    /* 원 단위로 맞춰서 화면 금액끼리 합이 어긋나지 않게 함 */
    var workPay = Math.round(weekly * wage);
    var holidayPay = Math.round(holidayHours * wage);
    var weekTotal = workPay + holidayPay;
    var monthGross = Math.round(weekTotal * WEEKS_PER_MONTH);

    var d = DEDUCT[state.deduct] || DEDUCT.none;
    var deductAmount = Math.round(monthGross * d.rate);
    var monthNet = monthGross - deductAmount;

    var monthWorkHours = weekly * WEEKS_PER_MONTH;
    var effectiveHourly = monthWorkHours > 0 ? monthNet / monthWorkHours : 0;
    var includedHourly = weekly > 0 ? weekTotal / weekly : 0;

    return {
      wage: wage, weekly: weekly, eligible: eligible,
      holidayHours: holidayHours, workPay: workPay, holidayPay: holidayPay,
      weekTotal: weekTotal, monthGross: monthGross, monthNet: monthNet,
      deduct: d, deductAmount: deductAmount,
      monthWorkHours: monthWorkHours, effectiveHourly: effectiveHourly,
      includedHourly: includedHourly, annualNet: monthNet * 12
    };
  }

  /* ---------------- render ---------------- */

  function render() {
    var r = compute();

    setText('w-net', numStr(Math.round(r.monthNet), 0));
    setText('w-exact', '세전 월 ' + won(r.monthGross) + ' · 연 실수령 약 ' + won(r.annualNet));

    /* 배지 */
    var badge = $('w-badge');
    if (badge) {
      var off = !r.eligible || !state.holidayOn;
      badge.textContent = !r.eligible ? '주 15시간 미만' : (state.holidayOn ? '주휴 포함' : '주휴 미포함');
      badge.className = 'badge-soft' + (off ? ' off' : '');
    }

    /* 계산식 한 줄 */
    var formula = '주급 ' + won(r.weekTotal) + ' × 4.345주 = ' + won(r.monthGross);
    if (r.deductAmount > 0) formula += ' − ' + r.deduct.short + ' ' + won(r.deductAmount);
    formula += '<span class="fx">= 실수령 ' + won(r.monthNet) + '</span>';
    setHTML('w-formula', formula);

    /* 구성 막대 */
    var total = r.weekTotal > 0 ? r.weekTotal : 1;
    var wWork = (r.workPay / total) * 100;
    var wHol = (r.holidayPay / total) * 100;
    if ($('w-bar-work')) $('w-bar-work').style.width = wWork.toFixed(2) + '%';
    if ($('w-bar-holiday')) $('w-bar-holiday').style.width = wHol.toFixed(2) + '%';
    setText('w-leg-work', won(r.workPay));
    setText('w-leg-holiday', won(r.holidayPay));
    setText('w-leg-work-pct', Math.round(wWork) + '%');
    setText('w-leg-holiday-pct', Math.round(wHol) + '%');

    /* 항목별 */
    setText('w-val-weekly', numStr(r.weekly, 2) + '시간');
    setText('w-val-holiday-hours', numStr(r.holidayHours, 2) + '시간');
    setText('w-val-work', won(r.workPay));
    setText('w-val-holiday', won(r.holidayPay));
    setText('w-val-week-total', won(r.weekTotal));
    setText('w-val-month', won(r.monthGross));
    setText('w-val-deduct', r.deductAmount > 0 ? '−' + won(r.deductAmount) : '0원');
    setText('w-val-net', won(r.monthNet));
    setText('w-val-eff', won(r.effectiveHourly));
    setText('w-desc-year', '연 약 ' + won(r.annualNet));

    setText('w-desc-work', numStr(r.weekly, 2) + '시간 × ' + won(r.wage));
    setText('w-desc-deduct', r.deduct.short + (r.deductAmount > 0 ? ' · 지급액 기준' : ''));
    setText('w-desc-holiday-hours', !r.eligible
      ? '주 15시간 미만이라 없음'
      : (state.holidayOn ? (r.weekly >= 40 ? '주 40시간 이상 → 8시간' : '주 근무시간 ÷ 5') : '주휴수당 미포함'));
    setText('w-desc-eff', r.monthWorkHours > 0
      ? '실수령 ÷ 한 달 근무 ' + numStr(r.monthWorkHours, 1) + '시간 (주휴 제외)'
      : '근무시간을 넣어주세요');

    renderJudge(r);
    renderFormulaBox(r);
    updateTotalHint(r);
    updateSticky(r);
    save();
  }

  function renderJudge(r) {
    var box = $('w-judge');
    var body = $('w-judge-body');
    if (!box || !body) return;

    if (!r.eligible) {
      box.className = 'judge warn';
      var t1 = box.querySelector('.j-title');
      if (t1) t1.textContent = '주 15시간 미만이라 주휴수당 0원';
      body.textContent = '4주 평균 소정근로시간이 15시간 미만이면 주휴수당·연차·퇴직금 규정이 적용되지 않아요. '
        + '계약서엔 14시간인데 실제로 매주 더 일했다면 근무 기록을 남겨두세요.';
      return;
    }

    if (!state.holidayOn) {
      box.className = 'judge off';
      var t2 = box.querySelector('.j-title');
      if (t2) t2.textContent = '주휴수당을 뺀 근무분만 계산했어요';
      body.textContent = '계약서에 "주휴수당 포함"이라고 적혀 있거나 주휴 포함 시급으로 받고 있다면 이대로 두면 돼요. '
        + '주휴수당을 따로 받는 조건이면 위 스위치를 켜 주세요.';
      return;
    }

    box.className = 'judge ok';
    var t3 = box.querySelector('.j-title');
    if (t3) t3.textContent = '주휴수당 받을 수 있어요';
    body.textContent = '주 ' + numStr(r.weekly, 2) + '시간이면 주휴 ' + numStr(r.holidayHours, 2)
      + '시간분, 1주 ' + won(r.holidayPay) + '이에요. 그 주 소정근로일을 모두 나온 경우 기준이에요.';
  }

  function renderFormulaBox(r) {
    var fx = $('w-fx-line');
    var sub = $('w-fx-sub');
    if (!fx || !sub) return;

    if (r.holidayHours <= 0) {
      fx.textContent = r.eligible
        ? '주휴수당 스위치가 꺼져 있어 0원으로 계산했어요.'
        : '주 ' + numStr(r.weekly, 2) + '시간 → 주 15시간 미만이라 주휴수당 0원';
      sub.textContent = '주 15시간 이상이면서 그 주를 개근하면 (주 근무시간 ÷ 40) × 8시간 × 시급만큼 받아요.';
      return;
    }

    fx.textContent = '(주 ' + numStr(r.weekly, 2) + '시간 ÷ 40) × 8시간 × ' + won(r.wage)
      + ' = ' + won(r.holidayPay);

    var extra = r.weekly >= 40
      ? '주 40시간 이상은 8시간분(2026 최저시급 기준 82,560원)이 최대예요. '
      : '주휴수당은 근무분 임금의 20%라서 주휴 포함 시급은 ' + won(r.includedHourly) + '이 돼요. ';

    sub.textContent = extra + '월로 환산하면 주휴수당만 약 ' + won(r.holidayPay * WEEKS_PER_MONTH) + '이에요.';
  }

  function updateTotalHint(r) {
    var hint = $('w-total-hint');
    if (!hint) return;
    var detail = state.inputMode === 'days'
      ? '하루 ' + numStr(parseNum(state.hoursPerDay), 2) + '시간 × 주 ' + numStr(parseNum(state.daysPerWeek), 2) + '일'
      : '주 총 시간으로 입력';
    hint.textContent = '주 ' + numStr(r.weekly, 2) + '시간 · ' + detail + ' · 휴게시간은 빼고 계산해요';
  }

  function updateSticky(r) {
    var label = $('sb-label'), val = $('sb-val');
    if (!label || !val) return;
    label.textContent = '월 실수령';
    val.textContent = numStr(Math.round(r.monthNet), 0);
  }

  /* ---------------- 복사 ---------------- */

  function copyText() {
    var r = compute();
    var L = [];
    L.push('[알바 주휴수당 계산]');
    L.push('시급 ' + won(r.wage) + ' · 주 ' + numStr(r.weekly, 2) + '시간'
      + (state.inputMode === 'days'
        ? ' (하루 ' + numStr(parseNum(state.hoursPerDay), 1) + '시간 × ' + numStr(parseNum(state.daysPerWeek), 1) + '일)'
        : ''));
    if (r.holidayHours > 0) {
      L.push('주휴수당 1주 ' + won(r.holidayPay) + ' (' + numStr(r.holidayHours, 2) + '시간분)');
    } else {
      L.push(r.eligible ? '주휴수당 미포함' : '주 15시간 미만 → 주휴수당 없음');
    }
    L.push('근무분 주급 ' + won(r.workPay) + ' → 주 총수령 ' + won(r.weekTotal));
    L.push('월급(세전) ' + won(r.monthGross) + ' (4.345주 기준)');
    if (r.deductAmount > 0) {
      L.push('공제 ' + r.deduct.short + ' ' + won(r.deductAmount));
    } else {
      L.push('공제 없음');
    }
    L.push('▶ 월 실수령 ' + won(r.monthNet) + ' / 연 약 ' + won(r.annualNet));
    L.push('실질 시급 ' + won(r.effectiveHourly) + ' (실수령 ÷ 한 달 근무 ' + numStr(r.monthWorkHours, 1) + '시간)');
    L.push('— 알바 주휴수당 계산기 · starha2015-svg.github.io/weekly-allowance.html');
    return L.join('\n');
  }

  function writeClipboard(text) {
    if (navigator.clipboard && window.isSecureContext && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      ta.style.left = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      if (ok) resolve(); else reject(new Error('copy failed'));
    });
  }

  var toastTimer = null;
  function toast(msg) {
    var el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2000);
  }

  function handleCopy() {
    var text = copyText();
    writeClipboard(text).then(function () {
      toast('결과를 복사했어요 · 카톡에 붙여넣기');
    }).catch(function () {
      window.prompt('아래 내용을 복사해 주세요', text);
    });
  }

  /* ---------------- 입력 바인딩 ---------------- */

  function bindInputs() {
    var fields = [
      ['w-wage', function (v) { state.wage = v; }],
      ['w-hours', function (v) { state.hoursPerDay = v; }],
      ['w-days', function (v) { state.daysPerWeek = v; }],
      ['w-weekly', function (v) { state.weeklyHours = v; }]
    ];

    fields.forEach(function (pair) {
      var el = $(pair[0]);
      if (!el) return;
      on(el, 'input', function () {
        pair[1](parseNum(el.value));
        render();
      });
      on(el, 'blur', function () {
        var v = parseNum(el.value);
        el.value = numStr(v, 2);
      });
      on(el, 'focus', function () { el.select(); });
    });

    /* 시급 프리셋 */
    Array.prototype.forEach.call(document.querySelectorAll('[data-wage]'), function (btn) {
      on(btn, 'click', function () {
        state.wage = parseFloat(btn.getAttribute('data-wage'));
        var input = $('w-wage');
        if (input) input.value = numStr(state.wage, 0);
        syncWageChips();
        render();
      });
    });

    /* 입력 방식 */
    Array.prototype.forEach.call(document.querySelectorAll('[data-wmode]'), function (btn) {
      on(btn, 'click', function () {
        var mode = btn.getAttribute('data-wmode');
        if (mode === state.inputMode) return;
        if (mode === 'hours') {
          state.weeklyHours = Math.round(currentWeeklyHours() * 100) / 100;
          var wh = $('w-weekly');
          if (wh) wh.value = numStr(state.weeklyHours, 2);
        } else {
          var wk = clamp(parseNum(state.weeklyHours), 0, 168);
          var days = clamp(parseNum(state.daysPerWeek), 1, 7);
          state.hoursPerDay = Math.round((wk / days) * 1000) / 1000;
          state.daysPerWeek = days;
          var hEl = $('w-hours'), dEl = $('w-days');
          if (hEl) hEl.value = numStr(state.hoursPerDay, 2);
          if (dEl) dEl.value = numStr(state.daysPerWeek, 2);
        }
        state.inputMode = mode;
        syncModeUI();
        render();
      });
    });

    /* 주휴수당 토글 */
    var hol = $('w-holiday');
    on(hol, 'change', function () {
      state.holidayOn = !!hol.checked;
      render();
    });

    /* 공제 방식 */
    Array.prototype.forEach.call(document.querySelectorAll('input[name="deduct"]'), function (el) {
      on(el, 'change', function () {
        if (!el.checked) return;
        state.deduct = el.value;
        render();
      });
    });

    /* 복사 버튼 */
    document.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-copy]') : null;
      if (!btn) return;
      e.preventDefault();
      handleCopy();
    });
  }

  function syncWageChips() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-wage]'), function (c) {
      c.classList.toggle('is-on', Math.abs(parseFloat(c.getAttribute('data-wage')) - state.wage) < 0.01);
    });
  }

  function syncModeUI() {
    var isDays = state.inputMode === 'days';
    var daysFields = $('w-days-fields');
    var hoursField = $('w-hours-field');
    if (daysFields) daysFields.hidden = !isDays;
    if (hoursField) hoursField.hidden = isDays;
    setText('w-mode-hint', isDays ? '소정근로시간' : '주 총 시간');

    Array.prototype.forEach.call(document.querySelectorAll('[data-wmode]'), function (b) {
      b.classList.toggle('is-on', b.getAttribute('data-wmode') === state.inputMode);
    });
  }

  /* ---------------- 저장/복원 ---------------- */

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) { /* 저장 실패는 무시 */ }
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      var d = JSON.parse(raw);
      if (!d || typeof d !== 'object') return;
      ['wage', 'hoursPerDay', 'daysPerWeek', 'weeklyHours'].forEach(function (k) {
        if (d[k] !== undefined && isFinite(parseNum(d[k]))) state[k] = parseNum(d[k]);
      });
      if (d.inputMode === 'hours' || d.inputMode === 'days') state.inputMode = d.inputMode;
      if (typeof d.holidayOn === 'boolean') state.holidayOn = d.holidayOn;
      if (d.deduct && DEDUCT[d.deduct]) state.deduct = d.deduct;
    } catch (e) { /* 복원 실패는 무시 */ }
  }

  function syncInputsFromState() {
    var map = {
      'w-wage': state.wage,
      'w-hours': state.hoursPerDay,
      'w-days': state.daysPerWeek,
      'w-weekly': state.weeklyHours
    };
    Object.keys(map).forEach(function (id) {
      var el = $(id);
      if (!el) return;
      var v = map[id];
      el.value = numStr(v, id === 'w-wage' ? 0 : 2);
    });

    var hol = $('w-holiday');
    if (hol) hol.checked = state.holidayOn;

    Array.prototype.forEach.call(document.querySelectorAll('input[name="deduct"]'), function (el) {
      el.checked = el.value === state.deduct;
    });

    syncModeUI();
    syncWageChips();
  }

  /* ---------------- init ---------------- */

  function init() {
    load();
    syncInputsFromState();
    bindInputs();
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
