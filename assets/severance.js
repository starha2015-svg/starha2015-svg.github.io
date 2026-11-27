/* =========================================================
   퇴직금 · 실업급여(구직급여) 계산기 — severance.js
   외부 라이브러리 없음. 모든 계산은 입력 즉시 브라우저에서 수행.
   기준: 근로자퇴직급여 보장법 / 근로기준법 / 고용보험법 (2026년)
   ========================================================= */
(function () {
  'use strict';

  var STORE_KEY = 'severancecalc.v1';

  /* 최저임금(시간급) — 2026년 10,320원, 2025년 10,030원, 2027년 10,700원 */
  var MIN_WAGE = { 2024: 9860, 2025: 10030, 2026: 10320, 2027: 10700 };

  /* 고용보험법 시행령 제68조 — 급여기초임금일액 상한
     2026.1.1. 이후 이직자 113,500원 / 그 전 이직자 110,000원 */
  var BASE_CAP_2026 = 113500;
  var BASE_CAP_OLD = 110000;
  var BASE_CAP_MIN_YEAR = 2026;

  /* 고용보험법 [별표 1] 소정급여일수 — [50세 미만, 50세 이상·장애인] */
  var BANDS = [
    { key: 'u1',    label: '1년 미만',  days: 120, days50: 120 },
    { key: 'y1_3',  label: '1~3년',     days: 150, days50: 180 },
    { key: 'y3_5',  label: '3~5년',     days: 180, days50: 210 },
    { key: 'y5_10', label: '5~10년',    days: 210, days50: 240 },
    { key: 'y10p',  label: '10년 이상', days: 240, days50: 270 }
  ];

  /* ---------------- helpers ---------------- */

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

  function numStr(v, dec) {
    if (!isFinite(v)) return '0';
    var s = trimZeros(v.toFixed(dec == null ? 2 : dec));
    var neg = s.charAt(0) === '-';
    if (neg) s = s.slice(1);
    var parts = s.split('.');
    parts[0] = Number(parts[0] || 0).toLocaleString('ko-KR');
    return (neg ? '-' : '') + parts.join('.');
  }

  function won(v) {
    if (!isFinite(v)) return '—';
    return numStr(Math.round(v), 0) + '원';
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /* ---------------- 날짜 (UTC 기준으로 계산해 시간대 영향 제거) ---------------- */

  function toDate(iso) {
    if (!iso) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso).slice(0, 10));
    if (!m) return null;
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return isNaN(d.getTime()) ? null : d;
  }

  function isoDate(d) {
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }

  function dotDate(d) {
    return d.getUTCFullYear() + '.' + pad2(d.getUTCMonth() + 1) + '.' + pad2(d.getUTCDate());
  }

  function daysBetween(a, b) { return Math.round((b.getTime() - a.getTime()) / 86400000); }

  function shiftMonths(date, n) {
    var y = date.getUTCFullYear();
    var m = date.getUTCMonth() + n;
    var d = date.getUTCDate();
    var first = new Date(Date.UTC(y, m, 1));
    var lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, lastDay)));
  }

  /* ---------------- 퇴직소득세 (추정, 지방소득세 10% 포함) ---------------- */

  function bracketTax(base) {
    var t = [
      [14000000, 0.06, 0],
      [50000000, 0.15, 1260000],
      [88000000, 0.24, 5760000],
      [150000000, 0.35, 15440000],
      [300000000, 0.38, 19940000],
      [500000000, 0.40, 25940000],
      [1000000000, 0.42, 35940000],
      [Infinity, 0.45, 65940000]
    ];
    for (var i = 0; i < t.length; i++) {
      if (base <= t[i][0]) return Math.max(0, base * t[i][1] - t[i][2]);
    }
    return 0;
  }

  /* 근속연수 — 총근속월수/12, 1월 미만 일수는 1월로,
     1년 미만 월수는 1년으로 (소득세법 제48조①, 시행규칙 별지 제40호의2서식) */
  function serviceYears(start, end) {
    var months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12
      + (end.getUTCMonth() - start.getUTCMonth());
    if (end.getUTCDate() < start.getUTCDate()) months -= 1;
    if (months < 0) months = 0;
    var anchor = shiftMonths(start, months);
    var totalMonths = months + (daysBetween(anchor, end) > 0 ? 1 : 0);
    return Math.max(1, Math.ceil(totalMonths / 12));
  }

  function severanceTax(amount, years) {
    if (!(amount > 0)) return 0;
    years = Math.max(1, Math.round(years || 1));

    /* 근속연수공제 (2023.1.1. 이후 퇴직자) */
    var deduct;
    if (years <= 5) deduct = 1000000 * years;
    else if (years <= 10) deduct = 5000000 + 2000000 * (years - 5);
    else if (years <= 20) deduct = 15000000 + 2500000 * (years - 10);
    else deduct = 40000000 + 3000000 * (years - 20);

    var income = amount - Math.min(amount, deduct);   // 퇴직소득금액 − 근속연수공제
    if (income <= 0) return 0;

    var converted = income * 12 / years;              // 환산급여

    /* 환산급여공제 */
    var convDed;
    if (converted <= 8000000) convDed = converted;
    else if (converted <= 70000000) convDed = 8000000 + (converted - 8000000) * 0.6;
    else if (converted <= 100000000) convDed = 45200000 + (converted - 70000000) * 0.55;
    else if (converted <= 300000000) convDed = 61700000 + (converted - 100000000) * 0.45;
    else convDed = 151700000 + (converted - 300000000) * 0.35;

    var base = Math.max(0, converted - convDed);
    var tax = bracketTax(base) / 12 * years;
    return Math.round(tax * 1.1);
  }

  /* ---------------- 퇴직금 ---------------- */

  function computeSeverance(s) {
    var start = toDate(s.startDate);
    var end = toDate(s.endDate);
    var out = {
      ok: false, serviceDays: 0, years: 0, periodStart: null, periodDays: 0,
      total3: 0, bonusAdd: 0, leaveAdd: 0, wageSum: 0, avg: 0,
      dailyOrdinary: 0, applied: 0, usedOrdinary: false,
      weeklyHours: 0, eligible: false, reason: '', amount: 0, tax: 0, net: 0,
      refAmount: 0
    };
    if (!start || !end || daysBetween(start, end) <= 0) return out;

    out.ok = true;
    out.serviceDays = daysBetween(start, end);
    out.years = out.serviceDays / 365;

    /* 평균임금 산정 기간: 퇴직일 전 3개월 (퇴직일 = 마지막 근무일 다음 날) */
    var periodStart = shiftMonths(end, -3);
    if (periodStart < start) periodStart = start;      // 3개월을 못 채우면 입사일부터
    out.periodStart = periodStart;
    out.periodDays = Math.max(1, daysBetween(periodStart, end));

    var monthly = clamp(parseNum(s.monthly), 0, 1000000000);
    out.total3 = s.payMode === 'total'
      ? clamp(parseNum(s.total3), 0, 3000000000)
      : monthly * 3;

    out.bonusAdd = clamp(parseNum(s.bonus), 0, 1000000000) * 3 / 12;
    out.leaveAdd = clamp(parseNum(s.leave), 0, 1000000000) * 3 / 12;
    out.wageSum = out.total3 + out.bonusAdd + out.leaveAdd;
    out.avg = out.wageSum / out.periodDays;

    out.dailyOrdinary = clamp(parseNum(s.dailyOrdinary), 0, 10000000);
    out.usedOrdinary = out.dailyOrdinary > out.avg;
    out.applied = out.usedOrdinary ? out.dailyOrdinary : out.avg;

    out.weeklyHours = parseNum(s.weeklyHours);
    if (out.serviceDays < 365) {
      out.eligible = false;
      out.reason = 'short';
    } else if (!(out.weeklyHours >= 15)) {
      out.eligible = false;
      out.reason = 'hours';
    } else {
      out.eligible = true;
      out.reason = '';
    }

    out.refAmount = Math.round(out.applied * 30 * out.serviceDays / 365);
    out.amount = out.eligible ? out.refAmount : 0;
    out.taxYears = serviceYears(start, end);
    out.tax = out.eligible ? severanceTax(out.amount, out.taxYears) : 0;
    out.net = out.amount - out.tax;
    return out;
  }

  /* ---------------- 실업급여(구직급여) ---------------- */

  function bandByKey(key) {
    for (var i = 0; i < BANDS.length; i++) if (BANDS[i].key === key) return BANDS[i];
    return BANDS[1];
  }

  function ratesFor(year) {
    var y = Math.min(2027, Math.max(2024, year || 2026));
    var minWage = MIN_WAGE[y] || MIN_WAGE[2026];
    var baseCap = y >= BASE_CAP_MIN_YEAR ? BASE_CAP_2026 : BASE_CAP_OLD;
    return {
      year: y,
      minWage: minWage,
      baseCap: baseCap,
      floorPerHour: minWage * 0.8,
      cap: Math.round(baseCap * 0.6)
    };
  }

  function computeBenefit(b) {
    var today = new Date();
    var leave = toDate(b.leaveDate) || new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    var rate = ratesFor(leave.getUTCFullYear());

    var hoursRaw = parseNum(b.hours);
    var hours = hoursRaw > 0 ? Math.min(8, Math.max(1, hoursRaw)) : 8;
    var floor = Math.round(rate.floorPerHour * hours);

    var monthly = clamp(parseNum(b.monthly), 0, 1000000000);
    var total3 = b.payMode === 'total'
      ? clamp(parseNum(b.total3), 0, 3000000000)
      : monthly * 3;

    var periodStart = shiftMonths(leave, -3);
    var periodDays = Math.max(1, daysBetween(periodStart, leave));

    var rawBase = total3 / periodDays;
    var base = Math.min(rawBase, rate.baseCap);

    var sixty = base * 0.6;
    var daily = sixty;
    var applied = 'sixty';        // sixty | cap | floor
    if (sixty >= rate.cap) { daily = rate.cap; applied = 'cap'; }
    else if (sixty <= floor) { daily = floor; applied = 'floor'; }
    if (daily < floor) { daily = floor; applied = 'floor'; }   // 하한 > 상한인 해 대비
    daily = Math.round(daily);

    var band = bandByKey(b.band);
    var age50 = !!b.age50;
    var days = age50 ? band.days50 : band.days;
    var total = daily * days;

    return {
      leaveDate: leave,
      leaveISO: isoDate(leave),
      rate: rate,
      hours: hours,
      floor: floor,
      periodStart: periodStart,
      periodDays: periodDays,
      total3: total3,
      rawBase: rawBase,
      base: base,
      cappedBase: rawBase > rate.baseCap,
      sixty: sixty,
      daily: daily,
      applied: applied,
      band: band,
      age50: age50,
      days: days,
      total: total,
      month30: daily * 30,
      months: days / 30
    };
  }

  /* ---------------- Node 검증용 export ---------------- */

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      computeSeverance: computeSeverance,
      computeBenefit: computeBenefit,
      severanceTax: severanceTax,
      ratesFor: ratesFor,
      bandByKey: bandByKey,
      toDate: toDate,
      isoDate: isoDate,
      daysBetween: daysBetween,
      BANDS: BANDS
    };
    return;
  }

  /* =========================================================
     이하 브라우저(화면) 코드
     ========================================================= */

  function $(id) { return document.getElementById(id); }
  function on(el, ev, fn) { if (el) el.addEventListener(ev, fn); }
  function setText(id, text) { var el = $(id); if (el) el.textContent = text; }
  function setHTML(id, html) { var el = $(id); if (el) el.innerHTML = html; }

  function todayUTC() {
    var n = new Date();
    return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()));
  }

  function defaultStart() {
    var t = todayUTC();
    return new Date(Date.UTC(t.getUTCFullYear() - 3, t.getUTCMonth(), t.getUTCDate()));
  }

  var state = {
    tab: 'sev',
    s: {
      startDate: isoDate(defaultStart()),
      endDate: isoDate(todayUTC()),
      payMode: 'month',          // month | total
      monthly: 3000000,
      total3: 9000000,
      bonus: 0,
      leave: 0,
      dailyOrdinary: 0,
      weeklyHours: 40
    },
    b: {
      leaveDate: isoDate(todayUTC()),
      band: 'y1_3',
      age50: false,
      payMode: 'month',
      monthly: 3000000,
      total3: 9000000,
      hours: 8
    }
  };

  /* ---------------- 퇴직금 렌더 ---------------- */

  function renderSeverance() {
    var r = computeSeverance(state.s);

    if (!r.ok) {
      setText('s-big', '0');
      setText('s-exact', '입사일과 퇴직일을 확인해 주세요');
      setHTML('s-formula', '퇴직일이 입사일보다 뒤여야 계산할 수 있어요.');
      setText('s-badge', '날짜 확인');
      var bg = $('s-badge');
      if (bg) bg.className = 'badge-soft off';
      setText('s-val-days', '—');
      setText('s-val-avg', '—');
      setText('s-val-wage3', won(0));
      setText('s-val-bonus', won(0));
      setText('s-val-leave', won(0));
      setText('s-val-total', won(0));
      setText('s-val-tax', won(0));
      setText('s-val-net', won(0));
      setText('s-fx-line', '—');
      setText('s-fx-sub', '입사일과 퇴직일을 넣으면 1일 평균임금부터 바로 계산해요.');
      updateSticky();
      return;
    }

    /* 결과 카드 */
    setText('s-big', numStr(r.amount, 0));
    setText('s-exact', '1일 평균임금 ' + won(r.applied)
      + ' · 재직 ' + numStr(r.serviceDays, 0) + '일 (' + numStr(r.years, 1) + '년)');

    var badge = $('s-badge');
    if (badge) {
      badge.textContent = r.eligible ? '퇴직금 대상'
        : (r.reason === 'short' ? '1년 미만' : '주 15시간 미만');
      badge.className = 'badge-soft' + (r.eligible ? '' : ' off');
    }

    var formula = '1일 평균임금 ' + won(r.applied) + ' × 30일 × (' + numStr(r.serviceDays, 0) + '일 ÷ 365)'
      + '<span class="fx">= 세전 ' + won(r.amount) + '</span>';
    if (!r.eligible) {
      formula += '<span class="fx">1년을 채우면 약 ' + won(r.refAmount) + '</span>';
    }
    setHTML('s-formula', formula);

    /* 항목 */
    setText('s-val-days', numStr(r.serviceDays, 0) + '일');
    setText('s-val-avg', won(r.applied));
    setText('s-val-wage3', won(r.total3));
    setText('s-val-bonus', r.bonusAdd > 0 ? '+' + won(r.bonusAdd) : '0원');
    setText('s-val-leave', r.leaveAdd > 0 ? '+' + won(r.leaveAdd) : '0원');
    setText('s-val-total', won(r.amount));
    setText('s-val-tax', r.tax > 0 ? '−' + won(r.tax) : '0원');
    setText('s-val-net', won(r.net));

    /* 설명 문구 */
    setText('s-desc-days', numStr(r.years, 1) + '년 · ' + dotDate(toDate(state.s.startDate)) + ' ~ '
      + dotDate(new Date(toDate(state.s.endDate).getTime() - 86400000)));
    setText('s-desc-avg', '3개월(' + r.periodDays + '일) 임금 ' + won(r.wageSum)
      + (r.usedOrdinary ? ' · 통상임금이 더 커서 통상임금 적용' : ''));
    setText('s-desc-wage3', state.s.payMode === 'month' ? '월급 × 3개월' : '3개월 임금 총액 직접 입력');
    setText('s-desc-bonus', '연간 상여금 × 3/12');
    setText('s-desc-leave', '이미 받은 연차수당 × 3/12');
    setText('s-desc-tax', '추정치 · IRP로 받으면 0원');

    renderSevJudge(r);
    renderSevFormula(r);
    updateSticky();
    save();
  }

  function renderSevJudge(r) {
    var box = $('s-judge');
    var title = $('s-judge-title');
    var body = $('s-judge-body');
    if (!box || !body) return;

    if (r.eligible) {
      box.className = 'judge ok';
      if (title) title.textContent = '퇴직금 받을 수 있어요';
      body.textContent = '계속근로 ' + numStr(r.serviceDays, 0) + '일(1년 이상)에 주 '
        + numStr(r.weeklyHours, 1) + '시간 일했으니 대상이에요. 계약직·아르바이트·5인 미만 사업장도 똑같이 적용돼요.';
      return;
    }
    box.className = 'judge warn';
    if (r.reason === 'short') {
      if (title) title.textContent = '1년을 못 채워서 퇴직금 0원';
      body.textContent = '계속근로 ' + numStr(r.serviceDays, 0) + '일이라 법정 퇴직금 대상이 아니에요. '
        + '3월 1일 입사라면 다음 해 2월 말일까지 일해야 1년이에요. 수습·계약 갱신으로 끊긴 것처럼 보여도 실제로 이어서 일했다면 처음 입사일부터 세요.';
      return;
    }
    if (title) title.textContent = '주 15시간 미만이라 퇴직금 0원';
    body.textContent = '4주 평균 1주 소정근로시간이 15시간 미만이면 퇴직금 제도가 적용되지 않아요. '
      + '계약서는 14시간인데 실제로 더 일했다면 근무표·급여 이체 내역을 남겨두세요.';
  }

  function renderSevFormula(r) {
    var fx = $('s-fx-line');
    var sub = $('s-fx-sub');
    if (!fx || !sub) return;

    if (!r.eligible) {
      fx.textContent = '재직 ' + numStr(r.serviceDays, 0) + '일 → 법정 퇴직금 0원 (1년 채우면 약 ' + won(r.refAmount) + ')';
      sub.textContent = '퇴직금 = 1일 평균임금 × 30일 × (계속근로일수 ÷ 365). 1년 이상이고 4주 평균 주 15시간 이상일 때만 나와요.';
      return;
    }

    fx.textContent = won(r.applied) + ' × 30 × (' + numStr(r.serviceDays, 0) + ' ÷ 365) = ' + won(r.amount);
    sub.textContent = '1일 평균임금은 퇴직 전 3개월(' + dotDate(r.periodStart) + ' ~ '
      + dotDate(new Date(toDate(state.s.endDate).getTime() - 86400000)) + ', ' + r.periodDays + '일) 임금 '
      + won(r.wageSum) + '을 그 일수로 나눈 값이에요. '
      + (r.tax > 0
        ? '퇴직소득세 약 ' + won(r.tax) + '을 떼면 ' + won(r.net) + '이고, IRP로 옮기면 세금을 나중으로 미룰 수 있어요.'
        : '이 금액은 근속연수공제 덕분에 퇴직소득세가 0원인 구간이에요.');
  }

  /* ---------------- 실업급여 렌더 ---------------- */

  function renderBenefit() {
    var r = computeBenefit(state.b);

    setText('b-big', numStr(r.total, 0));
    setText('b-exact', '1일 ' + won(r.daily) + ' × ' + numStr(r.days, 0) + '일 · 약 '
      + numStr(r.months, 1) + '개월');

    var badge = $('b-badge');
    if (badge) {
      badge.textContent = r.applied === 'cap' ? '상한액 적용'
        : (r.applied === 'floor' ? '하한액 적용' : '평균임금 60%');
      badge.className = 'badge-soft' + (r.applied === 'floor' ? '' : ' off');
    }

    var label = r.applied === 'cap' ? '상한액' : (r.applied === 'floor' ? '하한액' : '60% 금액');
    setHTML('b-formula',
      '기초일액 ' + won(r.base) + ' × 60% = ' + won(r.sixty)
      + '<span class="fx">→ ' + label + ' ' + won(r.daily) + ' × ' + numStr(r.days, 0) + '일 = ' + won(r.total) + '</span>');

    setText('b-val-base', won(r.base));
    setText('b-val-sixty', won(r.sixty));
    setText('b-val-floor', won(r.floor) + ' (최저임금 80%)');
    setText('b-val-cap', won(r.rate.cap) + ' (기초일액 ' + numStr(r.rate.baseCap, 0) + '원 기준)');
    setText('b-val-daily', won(r.daily));
    setText('b-val-days', numStr(r.days, 0) + '일');
    setText('b-val-total', won(r.total));
    setText('b-val-month', won(r.month30) + ' (30일 기준)');
    setText('b-val-period', '약 ' + numStr(r.months, 1) + '개월 (주 7일 지급)');

    setText('b-desc-base', '3개월(' + r.periodDays + '일) 임금 ' + won(r.total3)
      + (r.cappedBase ? ' · 상한 적용' : ''));
    setText('b-desc-floor', '최저임금 ' + numStr(r.rate.minWage, 0) + '원 × ' + numStr(r.hours, 1) + '시간 × 80%');
    setText('b-desc-cap', r.rate.year + '년 이직자 기준');
    setText('b-desc-days', r.age50 ? '50세 이상 · 장애인' : '50세 미만');
    setText('b-desc-total', '1일 ' + won(r.daily) + ' × ' + numStr(r.days, 0) + '일');

    renderBenefitBands(r);
    renderBenefitJudge(r);
    renderBenefitFormula(r);
    updateSticky();
    save();
  }

  function renderBenefitBands(r) {
    Array.prototype.forEach.call(document.querySelectorAll('[data-band-days]'), function (el) {
      var band = bandByKey(el.getAttribute('data-band-days'));
      el.textContent = '→ ' + (r.age50 ? band.days50 : band.days) + '일';
    });
  }

  function renderBenefitJudge(r) {
    var box = $('b-judge');
    var title = $('b-judge-title');
    var body = $('b-judge-body');
    if (!box || !body) return;

    box.className = 'judge';
    if (title) title.textContent = '수급 요건은 따로 확인해야 해요';
    body.textContent = '실업급여는 ① 이직 전 18개월 중 피보험단위기간 180일 이상 '
      + '② 권고사직·계약만료·정리해고처럼 내 사정이 아닌 이직 '
      + '③ 근로 의사와 능력이 있으면서 적극적으로 구직활동을 해야 받을 수 있어요. '
      + '이 계산기는 ' + r.rate.year + '년 이직자 기준 금액만 계산해요.';

    if (r.band.key === 'u1') {
      box.className = 'judge warn';
      if (title) title.textContent = '가입기간 1년 미만은 180일 요건부터 확인';
      body.textContent = '피보험단위기간이 180일 이상이면 가입기간이 1년이 안 돼도 120일분을 받을 수 있어요. '
        + '180일에 못 미치면 수급자격이 안 되니 고용24에서 피보험단위기간을 먼저 확인하세요.';
    }
  }

  function renderBenefitFormula(r) {
    var fx = $('b-fx-line');
    var sub = $('b-fx-sub');
    if (!fx || !sub) return;

    var label = r.applied === 'cap' ? '상한액' : (r.applied === 'floor' ? '하한액' : '60% 금액');
    fx.textContent = '기초일액 ' + won(r.base) + ' × 60% = ' + won(r.sixty)
      + ' → ' + label + ' ' + won(r.daily);
    sub.textContent = '1일 구직급여는 기초일액의 60%인데, 하한(최저임금 80% × 1일 소정근로시간)과 '
      + '상한(' + won(r.rate.cap) + ') 사이로 맞춰요. '
      + '기초일액이 ' + won(r.base) + '이라 ' + label + '이 적용됐어요. '
      + '평균임금이 아주 높지 않으면 대부분 하한액을 받아요.';
  }

  /* ---------------- 탭 / sticky ---------------- */

  function setTab(tab) {
    state.tab = tab === 'ben' ? 'ben' : 'sev';
    Array.prototype.forEach.call(document.querySelectorAll('[data-tabbtn]'), function (btn) {
      var onTab = btn.getAttribute('data-tabbtn') === state.tab;
      btn.setAttribute('aria-selected', onTab ? 'true' : 'false');
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-tabpanel]'), function (p) {
      p.hidden = p.getAttribute('data-tabpanel') !== state.tab;
    });
    updateSticky();
    save();
  }

  function updateSticky() {
    var label = $('sb-label'), val = $('sb-val');
    if (!label || !val) return;
    if (state.tab === 'ben') {
      var b = computeBenefit(state.b);
      label.textContent = '총 예상 수령액';
      val.textContent = numStr(b.total, 0);
    } else {
      var s = computeSeverance(state.s);
      label.textContent = '세전 퇴직금';
      val.textContent = numStr(s.amount, 0);
    }
  }

  /* ---------------- 복사 ---------------- */

  function sevCopyText() {
    var r = computeSeverance(state.s);
    if (!r.ok) return '퇴직금 계산: 입사일과 퇴직일을 확인해 주세요.';
    var L = ['[퇴직금 계산]'];
    L.push('재직 ' + numStr(r.serviceDays, 0) + '일 (' + numStr(r.years, 1) + '년)');
    L.push('1일 평균임금 ' + won(r.applied) + ' (3개월 임금 ' + won(r.wageSum) + ' ÷ ' + r.periodDays + '일)');
    if (r.usedOrdinary) L.push('통상임금이 평균임금보다 커서 통상임금 기준으로 계산');
    if (!r.eligible) {
      L.push(r.reason === 'short' ? '1년 미만 → 법정 퇴직금 대상 아님' : '주 15시간 미만 → 법정 퇴직금 대상 아님');
      L.push('1년을 채우면 약 ' + won(r.refAmount));
    } else {
      L.push('▶ 세전 퇴직금 ' + won(r.amount));
      if (r.tax > 0) L.push('예상 퇴직소득세 ' + won(r.tax) + ' (지방소득세 포함) → 세후 약 ' + won(r.net));
      else L.push('예상 퇴직소득세 0원 → 세후 동일');
    }
    L.push('— 퇴직금·실업급여 계산기 · starha2015-svg.github.io/severance-unemployment.html');
    return L.join('\n');
  }

  function benCopyText() {
    var r = computeBenefit(state.b);
    var L = ['[실업급여(구직급여) 계산]'];
    L.push(r.rate.year + '년 이직 기준 · ' + (r.age50 ? '50세 이상·장애인' : '50세 미만')
      + ' · 가입기간 ' + r.band.label);
    L.push('기초일액 ' + won(r.base) + ' × 60% = ' + won(r.sixty));
    L.push('1일 구직급여 ' + won(r.daily)
      + (r.applied === 'cap' ? ' (상한액)' : r.applied === 'floor' ? ' (하한액)' : ' (60% 금액)'));
    L.push('소정급여일수 ' + numStr(r.days, 0) + '일 · 약 ' + numStr(r.months, 1) + '개월');
    L.push('▶ 총 예상 수령액 ' + won(r.total));
    L.push('30일 환산 ' + won(r.month30) + ' / 주 7일 지급 기준');
    L.push('— 퇴직금·실업급여 계산기 · starha2015-svg.github.io/severance-unemployment.html');
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

  function handleCopy(which) {
    var text = which === 'ben' || (which === 'current' && state.tab === 'ben')
      ? benCopyText()
      : sevCopyText();
    writeClipboard(text).then(function () {
      toast('결과를 복사했어요 · 카톡에 붙여넣기');
    }).catch(function () {
      window.prompt('아래 내용을 복사해 주세요', text);
    });
  }

  /* ---------------- 입력 바인딩 ---------------- */

  function bindNumberInput(id, get, set) {
    var el = $(id);
    if (!el) return;
    on(el, 'input', function () {
      set(parseNum(el.value));
      get();
    });
    on(el, 'blur', function () { el.value = numStr(parseNum(el.value), 0); });
    on(el, 'focus', function () { el.select(); });
  }

  function bindDateInput(id, get, set) {
    var el = $(id);
    if (!el) return;
    on(el, 'change', function () {
      set(el.value);
      get();
    });
  }

  function bindInputs() {
    /* ---- 퇴직금 ---- */
    bindDateInput('s-start', renderSeverance, function (v) { state.s.startDate = v; });
    bindDateInput('s-end', renderSeverance, function (v) { state.s.endDate = v; });
    bindNumberInput('s-monthly', renderSeverance, function (v) { state.s.monthly = v; });
    bindNumberInput('s-total3', renderSeverance, function (v) { state.s.total3 = v; });
    bindNumberInput('s-bonus', renderSeverance, function (v) { state.s.bonus = v; });
    bindNumberInput('s-leave', renderSeverance, function (v) { state.s.leave = v; });
    bindNumberInput('s-ordinary', renderSeverance, function (v) { state.s.dailyOrdinary = v; });
    bindNumberInput('s-weekly-hours', renderSeverance, function (v) { state.s.weeklyHours = v; });

    Array.prototype.forEach.call(document.querySelectorAll('[data-spmode]'), function (btn) {
      on(btn, 'click', function () {
        state.s.payMode = btn.getAttribute('data-spmode');
        syncSevPayMode();
        renderSeverance();
      });
    });

    /* ---- 실업급여 ---- */
    bindDateInput('b-leave-date', renderBenefit, function (v) { state.b.leaveDate = v; });
    bindNumberInput('b-monthly', renderBenefit, function (v) { state.b.monthly = v; });
    bindNumberInput('b-total3', renderBenefit, function (v) { state.b.total3 = v; });
    bindNumberInput('b-hours', renderBenefit, function (v) { state.b.hours = v; });

    Array.prototype.forEach.call(document.querySelectorAll('[data-bpmode]'), function (btn) {
      on(btn, 'click', function () {
        state.b.payMode = btn.getAttribute('data-bpmode');
        syncBenPayMode();
        renderBenefit();
      });
    });

    Array.prototype.forEach.call(document.querySelectorAll('input[name="band"]'), function (el) {
      on(el, 'change', function () {
        if (!el.checked) return;
        state.b.band = el.value;
        renderBenefit();
      });
    });

    Array.prototype.forEach.call(document.querySelectorAll('input[name="age50"]'), function (el) {
      on(el, 'change', function () {
        if (!el.checked) return;
        state.b.age50 = el.value === 'yes';
        renderBenefit();
      });
    });

    /* ---- 탭 ---- */
    Array.prototype.forEach.call(document.querySelectorAll('[data-tabbtn]'), function (btn) {
      on(btn, 'click', function () { setTab(btn.getAttribute('data-tabbtn')); });
    });

    /* ---- 복사 ---- */
    document.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-copy]') : null;
      if (!btn) return;
      e.preventDefault();
      handleCopy(btn.getAttribute('data-copy'));
    });
  }

  function syncSevPayMode() {
    var isMonth = state.s.payMode === 'month';
    var f1 = $('s-monthly-field'), f2 = $('s-total3-field');
    if (f1) f1.hidden = !isMonth;
    if (f2) f2.hidden = isMonth;
    Array.prototype.forEach.call(document.querySelectorAll('[data-spmode]'), function (b) {
      b.classList.toggle('is-on', b.getAttribute('data-spmode') === state.s.payMode);
    });
  }

  function syncBenPayMode() {
    var isMonth = state.b.payMode === 'month';
    var f1 = $('b-monthly-field'), f2 = $('b-total3-field');
    if (f1) f1.hidden = !isMonth;
    if (f2) f2.hidden = isMonth;
    Array.prototype.forEach.call(document.querySelectorAll('[data-bpmode]'), function (b) {
      b.classList.toggle('is-on', b.getAttribute('data-bpmode') === state.b.payMode);
    });
  }

  /* ---------------- 저장/복원 ---------------- */

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* 무시 */ }
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      var d = JSON.parse(raw);
      if (!d || typeof d !== 'object') return;

      if (d.tab === 'ben' || d.tab === 'sev') state.tab = d.tab;

      if (d.s && typeof d.s === 'object') {
        ['startDate', 'endDate', 'payMode'].forEach(function (k) {
          if (typeof d.s[k] === 'string') state.s[k] = d.s[k];
        });
        ['monthly', 'total3', 'bonus', 'leave', 'dailyOrdinary', 'weeklyHours'].forEach(function (k) {
          if (d.s[k] !== undefined && isFinite(parseNum(d.s[k]))) state.s[k] = parseNum(d.s[k]);
        });
      }
      if (d.b && typeof d.b === 'object') {
        if (typeof d.b.leaveDate === 'string') state.b.leaveDate = d.b.leaveDate;
        if (typeof d.b.band === 'string' && bandByKey(d.b.band).key === d.b.band) state.b.band = d.b.band;
        if (typeof d.b.age50 === 'boolean') state.b.age50 = d.b.age50;
        if (d.b.payMode === 'month' || d.b.payMode === 'total') state.b.payMode = d.b.payMode;
        ['monthly', 'total3', 'hours'].forEach(function (k) {
          if (d.b[k] !== undefined && isFinite(parseNum(d.b[k]))) state.b[k] = parseNum(d.b[k]);
        });
      }
    } catch (e) { /* 무시 */ }
  }

  function syncInputsFromState() {
    var s = state.s, b = state.b;
    var map = {
      's-start': s.startDate,
      's-end': s.endDate,
      's-monthly': numStr(s.monthly, 0),
      's-total3': numStr(s.total3, 0),
      's-bonus': numStr(s.bonus, 0),
      's-leave': numStr(s.leave, 0),
      's-ordinary': s.dailyOrdinary > 0 ? numStr(s.dailyOrdinary, 0) : '',
      's-weekly-hours': numStr(s.weeklyHours, 1),
      'b-leave-date': b.leaveDate,
      'b-monthly': numStr(b.monthly, 0),
      'b-total3': numStr(b.total3, 0),
      'b-hours': numStr(b.hours, 1)
    };
    Object.keys(map).forEach(function (id) {
      var el = $(id);
      if (el) el.value = map[id];
    });

    Array.prototype.forEach.call(document.querySelectorAll('input[name="band"]'), function (el) {
      el.checked = el.value === b.band;
    });
    Array.prototype.forEach.call(document.querySelectorAll('input[name="age50"]'), function (el) {
      el.checked = (el.value === 'yes') === b.age50;
    });
  }

  /* ---------------- init ---------------- */

  function init() {
    load();
    syncInputsFromState();
    syncSevPayMode();
    syncBenPayMode();
    bindInputs();
    setTab(state.tab);
    renderSeverance();
    renderBenefit();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
