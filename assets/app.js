/* =========================================================
   자취생 월세·전세 실부담 계산기 — app.js
   외부 라이브러리 없음. 모든 계산은 입력 즉시 로컬에서 수행.
   ========================================================= */
(function () {
  'use strict';

  var MAN = 10000;                                  // 1만원
  var TAX_RATES = { '5500': 0.17, '8000': 0.15, 'none': 0 };
  var STORE_KEY = 'rentcalc.v1';
  var CAP_TAX_BASE = 10000000;                      // 세액공제 월세 한도 연 1,000만원

  var state = {
    mode: 'single',
    single: { deposit: 1000, rent: 55, mgmt: 7, loan: 700, loanMode: 'amount', pct: 70, loanRate: 1.8 },
    oppRate: 3.0,
    tax: { on: true, key: '5500' },
    conv: { legal: 5.0, market: 6.0 },
    jeonse: 0,
    a: { name: 'A 방', deposit: 1000, rent: 55, mgmt: 7, loan: 700, loanRate: 1.8 },
    b: { name: 'B 방', deposit: 2000, rent: 38, mgmt: 9, loan: 1700, loanRate: 3.8 }
  };

  /* ---------------- helpers ---------------- */

  function $(id) { return document.getElementById(id); }
  function on(el, ev, fn) { if (el) el.addEventListener(ev, fn); }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function parseNum(input) {
    if (typeof input === 'number') return isFinite(input) ? input : 0;
    var s = String(input == null ? '' : input)
      .replace(/[,\s₩]/g, '')
      .replace(/[^0-9.\-]/g, '');
    var n = parseFloat(s);
    return isFinite(n) ? n : 0;
  }

  function trimZeros(s) {
    if (s.indexOf('.') !== -1) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s;
  }

  /* 숫자 → "1,234.5" (dec: 소수 자릿수) */
  function numStr(v, dec) {
    if (!isFinite(v)) return '0';
    var s = trimZeros(v.toFixed(dec == null ? 2 : dec));
    var neg = s.charAt(0) === '-';
    if (neg) s = s.slice(1);
    var parts = s.split('.');
    parts[0] = Number(parts[0] || 0).toLocaleString('ko-KR');
    return (neg ? '-' : '') + parts.join('.');
  }

  /* 원 → "54.45만원" */
  function wonMan(won, dec) {
    return numStr(won / MAN, dec == null ? 2 : dec) + '만원';
  }

  /* 원 → 금액 크기에 맞춘 표기 ("7,500원" / "1.05만원") */
  function money(won) {
    if (!isFinite(won)) return '—';
    if (Math.abs(won) < 10000) return numStr(won, 0) + '원';
    return wonMan(won, 2);
  }

  /* 원 → "1억 5,667만원" */
  function koreanWon(won) {
    if (!isFinite(won)) return '—';
    var man = Math.round(won / MAN);
    if (man === 0) return '0원';
    if (man >= 10000) {
      var eok = Math.floor(man / 10000);
      var rest = man % 10000;
      return eok + '억' + (rest ? ' ' + rest.toLocaleString('ko-KR') + '만원' : '원');
    }
    return man.toLocaleString('ko-KR') + '만원';
  }

  function pctStr(x) { return Math.round(x * 100) + '%'; }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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

  function singleRoom() {
    var s = state.single;
    var loan = s.loanMode === 'pct' ? (s.deposit * s.pct) / 100 : s.loan;
    return { deposit: s.deposit, rent: s.rent, mgmt: s.mgmt, loan: loan, loanRate: s.loanRate };
  }

  function compute(room) {
    var deposit = clamp(parseNum(room.deposit), 0, 1e8);
    var rent = clamp(parseNum(room.rent), 0, 1e6);
    var mgmt = clamp(parseNum(room.mgmt), 0, 1e6);
    var rate = clamp(parseNum(room.loanRate), 0, 30);
    var wanted = clamp(parseNum(room.loan), 0, 1e8);
    var loan = Math.min(wanted, deposit);                 // 대출이 보증금을 넘으면 보증금까지만
    var equity = Math.max(0, deposit - loan);

    var interest = (loan * MAN * rate) / 100 / 12;         // 만기일시상환 기준
    var opp = (equity * MAN * state.oppRate) / 100 / 12;
    var capital = interest + opp;

    var rentWon = rent * MAN;
    var mgmtWon = mgmt * MAN;
    var gross = rentWon + mgmtWon + capital;

    var taxRate = state.tax.on ? (TAX_RATES[state.tax.key] || 0) : 0;
    var taxBase = Math.min(rentWon * 12, CAP_TAX_BASE);
    var annualCredit = taxBase * taxRate;
    var monthlyCredit = annualCredit / 12;

    var net = gross - monthlyCredit;

    return {
      deposit: deposit, rent: rent, mgmt: mgmt, rate: rate,
      loan: loan, equity: equity, interest: interest, opp: opp, capital: capital,
      rentWon: rentWon, mgmtWon: mgmtWon, gross: gross,
      taxRate: taxRate, taxBase: taxBase, annualCredit: annualCredit, monthlyCredit: monthlyCredit,
      net: net, annualNet: net * 12,
      loanOver: wanted > deposit + 1e-9
    };
  }

  /* 전세 환산: 보증금 + (월세×12) ÷ 전환율 */
  function convertJeonse(deposit, rent, ratePct) {
    if (!(ratePct > 0)) return Infinity;
    return deposit * MAN + (rent * MAN * 12) / (ratePct / 100);
  }

  /* 전세로 갈 때의 월 부담(같은 자기자금·관리비 가정) */
  function jeonseScenario(r) {
    var price = clamp(parseNum(state.jeonse), 0, 1e8) * MAN;
    if (!(price > 0)) return null;
    var equityWon = r.equity * MAN;
    var loan = Math.max(0, price - equityWon);
    var interest = (loan * r.rate) / 100 / 12;
    var opp = (equityWon * state.oppRate) / 100 / 12;
    var net = interest + opp + r.mgmtWon;
    return { price: price, loan: loan, interest: interest, opp: opp, net: net, diff: r.net - net };
  }

  /* ---------------- render: mode 1 ---------------- */

  function renderSingle() {
    var r = compute(singleRoom());

    setText('s-net', numStr(r.net / MAN, 2));
    setText('s-exact', numStr(r.net, 0) + '원 · 연 ' + money(r.annualNet));

    var badge = $('s-badge');
    if (badge) {
      badge.textContent = r.taxRate > 0 ? '세액공제 ' + pctStr(r.taxRate) + ' 반영' : '세액공제 미반영';
      badge.className = 'badge-soft' + (r.taxRate > 0 ? '' : ' off');
    }

    /* 계산식 한 줄 */
    var pieces = ['월세 ' + numStr(r.rent, 2), '관리비 ' + numStr(r.mgmt, 2)];
    if (r.interest > 0) pieces.push('이자 ' + numStr(r.interest / MAN, 2));
    if (r.opp > 0) pieces.push('기회비용 ' + numStr(r.opp / MAN, 2));
    var formula = pieces.join(' + ');
    if (r.monthlyCredit > 0) formula += ' − 세액공제 ' + numStr(r.monthlyCredit / MAN, 2);
    formula += '<span class="fx">= ' + money(r.net) + '</span>';
    setHTML('s-formula', formula);

    /* 구성 막대 */
    var total = r.gross > 0 ? r.gross : 1;
    var wRent = (r.rentWon / total) * 100;
    var wMgmt = (r.mgmtWon / total) * 100;
    var wCap = (r.capital / total) * 100;
    if ($('s-bar-rent')) $('s-bar-rent').style.width = wRent.toFixed(2) + '%';
    if ($('s-bar-mgmt')) $('s-bar-mgmt').style.width = wMgmt.toFixed(2) + '%';
    if ($('s-bar-cap')) $('s-bar-cap').style.width = wCap.toFixed(2) + '%';

    setText('s-leg-rent', money(r.rentWon));
    setText('s-leg-mgmt', money(r.mgmtWon));
    setText('s-leg-cap', money(r.capital));
    setText('s-leg-rent-pct', Math.round(wRent) + '%');
    setText('s-leg-mgmt-pct', Math.round(wMgmt) + '%');
    setText('s-leg-cap-pct', Math.round(wCap) + '%');
    setText('s-leg-credit', r.monthlyCredit > 0 ? '−' + money(r.monthlyCredit) : '0원');
    setText('s-leg-credit-pct', r.gross > 0 ? Math.round((r.monthlyCredit / r.gross) * 100) + '%' : '0%');

    /* 항목별 */
    setText('s-val-rent', money(r.rentWon));
    setText('s-val-mgmt', money(r.mgmtWon));
    setText('s-val-int', money(r.interest));
    setText('s-val-opp', money(r.opp));
    setText('s-val-tax', r.monthlyCredit > 0 ? '−' + money(r.monthlyCredit) : '0원');
    setText('s-val-net', money(r.net));
    setText('s-val-year', money(r.annualNet));

    setText('s-desc-int', r.loan > 0
      ? numStr(r.loan, 0) + '만원 × ' + numStr(r.rate, 1) + '%'
      : '대출 없음');
    setText('s-desc-opp', r.equity > 0
      ? numStr(r.equity, 0) + '만원 × ' + numStr(state.oppRate, 1) + '%'
      : '자기자금 없음');
    setText('s-desc-tax', r.taxRate > 0
      ? pctStr(r.taxRate) + ' · 연 ' + money(r.annualCredit)
      : '미반영');

    if (r.loanOver) {
      setText('s-desc-int', numStr(r.loan, 0) + '만원 × ' + numStr(r.rate, 1) + '%; 보증금 초과분 제외');
    }

    /* 전세 환산 */
    var legal = parseNum($('s-legal') ? $('s-legal').value : state.conv.legal);
    var market = parseNum($('s-market') ? $('s-market').value : state.conv.market);
    state.conv.legal = legal;
    state.conv.market = market;

    var convLegal = convertJeonse(r.deposit, r.rent, legal);
    var convMarket = convertJeonse(r.deposit, r.rent, market);
    setText('s-conv-legal', legal > 0 ? koreanWon(convLegal) : '—');
    setText('s-conv-market', market > 0 ? koreanWon(convMarket) : '—');

    /* 전세 시세 비교 */
    var jv = jeonseScenario(r);
    var vEl = $('s-jeonse-verdict');
    if (vEl) {
      if (!jv) {
        vEl.hidden = true;
        vEl.innerHTML = '';
      } else {
        vEl.hidden = false;
        var head;
        if (Math.abs(jv.diff) < 1000) {
          head = '월 부담이 거의 같아요';
        } else if (jv.diff > 0) {
          head = '전세가 월 <b>' + money(jv.diff) + '</b> 더 저렴해요';
        } else {
          head = '지금 월세가 월 <b>' + money(-jv.diff) + '</b> 더 저렴해요';
        }
        var detail = '전세 ' + koreanWon(jv.price) + ' 기준 · 대출 ' + money(jv.loan) +
          ' 이자 ' + money(jv.interest) + ' + 기회비용 ' + money(jv.opp) + ' + 관리비 ' + money(r.mgmtWon) +
          ' = 월 ' + money(jv.net);
        vEl.innerHTML = head + '<span class="muted">' + detail + ' · 취득세·이사비·보증금 반환 위험은 미반영</span>';
      }
    }

    updateSticky();
    updateLoanHint();
    save();
  }

  function updateLoanHint() {
    var hint = $('s-loan-hint');
    if (!hint) return;
    var s = state.single;
    hint.textContent = s.loanMode === 'pct'
      ? '보증금의 ' + numStr(s.pct, 1) + '% · ' + wonMan((s.deposit * s.pct) / 100 * MAN, 0)
      : '대출 없으면 0';
  }

  /* ---------------- render: mode 2 ---------------- */

  var CMP_ROWS = [
    { label: '월세', get: function (r) { return r.rentWon; }, better: 'low' },
    { label: '관리비', get: function (r) { return r.mgmtWon; }, better: 'low' },
    { label: '이자·기회비용', get: function (r) { return r.capital; }, better: 'low' },
    { label: '세액공제 절감', get: function (r) { return -r.monthlyCredit; }, better: null, minus: true },
    { label: '월 실부담', get: function (r) { return r.net; }, better: 'low', total: true },
    { label: '연 부담', get: function (r) { return r.annualNet; }, better: 'low' },
    { label: '보증금', get: function (r) { return r.deposit * MAN; }, better: 'low' }
  ];

  function renderCompare() {
    var ra = compute(state.a);
    var rb = compute(state.b);
    var nameA = state.a.name || 'A 방';
    var nameB = state.b.name || 'B 방';

    setText('a-net', money(ra.net));
    setText('b-net', money(rb.net));
    setText('c-th-a', nameA);
    setText('c-th-b', nameB);

    var diff = ra.net - rb.net;                  // >0 이면 B가 저렴
    var winner = Math.abs(diff) <= 500 ? null : (diff > 0 ? 'b' : 'a');

    toggleClass($('cmp-a'), 'is-winner', winner === 'a');
    toggleClass($('cmp-b'), 'is-winner', winner === 'b');
    var wa = $('win-a'), wb = $('win-b');
    if (wa) wa.hidden = winner !== 'a';
    if (wb) wb.hidden = winner !== 'b';

    var mainEl = $('c-main'), subEl = $('c-sub');
    if (mainEl && subEl) {
      if (!winner) {
        mainEl.innerHTML = '두 집 월 부담이 거의 같아요';
        subEl.textContent = '차이 ' + money(Math.abs(diff)) + ' 수준이에요.';
      } else {
        var winName = winner === 'a' ? nameA : nameB;
        mainEl.innerHTML = esc(winName) + ' 쪽이 월 <span class="won">' + money(Math.abs(diff)) + '</span> 더 저렴해요';
        var winnerR = winner === 'a' ? ra : rb;
        var loserR = winner === 'a' ? rb : ra;
        var depDiff = winnerR.deposit - loserR.deposit;   // 만원
        var sub = '연 ' + money(Math.abs(diff) * 12) + ' 차이 · ';
        if (Math.abs(depDiff) < 1) {
          sub += '보증금은 같아요';
        } else if (depDiff > 0) {
          sub += '대신 보증금 ' + wonMan(depDiff * MAN, 0) + ' 더 필요해요';
        } else {
          sub += '보증금도 ' + wonMan(-depDiff * MAN, 0) + ' 적어요';
        }
        subEl.textContent = sub;
      }
    }

    buildCompareTable(ra, rb);
    updateSticky();
    save();
  }

  function toggleClass(el, cls, on) {
    if (!el) return;
    if (on) el.classList.add(cls); else el.classList.remove(cls);
  }

  function buildCompareTable(ra, rb) {
    var tbody = $('c-tbody');
    if (!tbody) return;
    var frag = document.createDocumentFragment();

    CMP_ROWS.forEach(function (row) {
      var va = row.get(ra);
      var vb = row.get(rb);
      var tr = document.createElement('tr');
      if (row.total) tr.className = 'total';

      var th = document.createElement('td');
      th.textContent = row.label;
      tr.appendChild(th);

      [va, vb].forEach(function (v) {
        var td = document.createElement('td');
        if (row.minus) {
          td.textContent = v < 0 ? '−' + money(-v) : '0원';
        } else {
          td.textContent = money(v);
        }
        if (row.better === 'low') {
          if (va < vb && v === va) td.className = 'best';
          if (vb < va && v === vb) td.className = 'best';
        }
        tr.appendChild(td);
      });
      frag.appendChild(tr);
    });

    tbody.innerHTML = '';
    tbody.appendChild(frag);
  }

  /* ---------------- sticky bar ---------------- */

  function updateSticky() {
    var label = $('sb-label'), val = $('sb-val');
    if (!label || !val) return;
    if (state.mode === 'single') {
      var r = compute(singleRoom());
      label.textContent = '월 실부담';
      val.textContent = numStr(r.net / MAN, 2);
    } else {
      var ra = compute(state.a), rb = compute(state.b);
      var diff = ra.net - rb.net;
      label.textContent = '월 부담 차이';
      val.textContent = numStr(Math.abs(diff) / MAN, 2);
    }
  }

  /* ---------------- copy ---------------- */

  function copySingleText() {
    var r = compute(singleRoom());
    var L = [];
    L.push('[자취방 실부담 계산]');
    L.push('보증금 ' + numStr(r.deposit, 0) + '만원 · 월세 ' + numStr(r.rent, 0) + '만원 · 관리비 ' + numStr(r.mgmt, 0) + '만원');
    if (r.loan > 0) L.push('보증금 대출 ' + numStr(r.loan, 0) + '만원 @ ' + numStr(r.rate, 1) + '% → 월 이자 ' + money(r.interest));
    if (r.equity > 0) L.push('자기자금 ' + numStr(r.equity, 0) + '만원 기회비용(' + numStr(state.oppRate, 1) + '%) → 월 ' + money(r.opp));
    if (r.monthlyCredit > 0) {
      L.push('월세 세액공제 ' + pctStr(r.taxRate) + ' → 연 ' + money(r.annualCredit) + ' (월 ' + money(r.monthlyCredit) + ' 절감)');
    } else {
      L.push('월세 세액공제 미반영');
    }
    L.push('');
    L.push('▶ 월 실부담 ' + money(r.net) + ' / 연 ' + money(r.annualNet));
    var legalTxt = state.conv.legal > 0 ? koreanWon(convertJeonse(r.deposit, r.rent, state.conv.legal)) : '—';
    var marketTxt = state.conv.market > 0 ? koreanWon(convertJeonse(r.deposit, r.rent, state.conv.market)) : '—';
    L.push('전세 환산: 법정 ' + numStr(state.conv.legal, 1) + '% → ' + legalTxt +
      ' / 시장 ' + numStr(state.conv.market, 1) + '% → ' + marketTxt);

    var jv = jeonseScenario(r);
    if (jv) {
      var tail = Math.abs(jv.diff) < 1000 ? '월 부담이 거의 같아요'
        : (jv.diff > 0 ? '전세가 월 ' + money(jv.diff) + ' 더 저렴' : '월세가 월 ' + money(-jv.diff) + ' 더 저렴');
      L.push('전세 시세 ' + koreanWon(jv.price) + ' 가정 시 월 ' + money(jv.net) + ' → ' + tail);
    }
    L.push('— 자취생 월세·전세 실부담 계산기');
    return L.join('\n');
  }

  function copyCompareText() {
    var ra = compute(state.a), rb = compute(state.b);
    var nameA = state.a.name || 'A 방';
    var nameB = state.b.name || 'B 방';
    var line = function (name, r) {
      var s = name + ': 보증금 ' + numStr(r.deposit, 0) + ' / 월세 ' + numStr(r.rent, 0) +
        ' / 관리비 ' + numStr(r.mgmt, 0);
      if (r.loan > 0) s += ' / 대출 ' + numStr(r.loan, 0) + '@' + numStr(r.rate, 1) + '%';
      s += ' → 월 ' + money(r.net) + (r.monthlyCredit > 0 ? ' (세액공제 반영)' : '');
      return s;
    };
    var L = ['[두 방 주거비 비교]', line(nameA, ra), line(nameB, rb), ''];
    var diff = ra.net - rb.net;
    if (Math.abs(diff) <= 500) {
      L.push('▶ 두 집 월 부담이 거의 같아요 (차이 ' + money(Math.abs(diff)) + ')');
    } else {
      var winName = diff > 0 ? nameB : nameA;
      L.push('▶ ' + winName + ' 쪽이 월 ' + money(Math.abs(diff)) + ' 저렴 (연 ' + money(Math.abs(diff) * 12) + ' 차이)');
    }
    L.push('— 자취생 월세·전세 실부담 계산기');
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
    var text;
    if (which === 'compare') text = copyCompareText();
    else if (which === 'current') text = state.mode === 'compare' ? copyCompareText() : copySingleText();
    else text = copySingleText();

    writeClipboard(text).then(function () {
      toast('결과를 복사했어요 · 카톡에 붙여넣기');
    }).catch(function () {
      window.prompt('아래 내용을 복사해 주세요', text);
    });
  }

  /* ---------------- 입력 바인딩 ---------------- */

  var NUM_FIELDS = [
    ['s-deposit', function (v) { state.single.deposit = v; }],
    ['s-rent', function (v) { state.single.rent = v; }],
    ['s-mgmt', function (v) { state.single.mgmt = v; }],
    ['s-loan', function (v) {
      if (state.single.loanMode === 'pct') state.single.pct = v;
      else state.single.loan = v;
    }],
    ['s-rate', function (v) { state.single.loanRate = v; }],
    ['s-opp', function (v) { state.oppRate = v; }],
    ['s-jeonse', function (v) { state.jeonse = v; }],
    ['a-deposit', function (v) { state.a.deposit = v; }],
    ['a-rent', function (v) { state.a.rent = v; }],
    ['a-mgmt', function (v) { state.a.mgmt = v; }],
    ['a-loan', function (v) { state.a.loan = v; }],
    ['a-rate', function (v) { state.a.loanRate = v; }],
    ['b-deposit', function (v) { state.b.deposit = v; }],
    ['b-rent', function (v) { state.b.rent = v; }],
    ['b-mgmt', function (v) { state.b.mgmt = v; }],
    ['b-loan', function (v) { state.b.loan = v; }],
    ['b-rate', function (v) { state.b.loanRate = v; }]
  ];

  function renderAll() {
    if (state.mode === 'single') renderSingle();
    renderCompare();
    if (state.mode === 'compare') updateSticky();
  }

  function bindInputs() {
    NUM_FIELDS.forEach(function (pair) {
      var el = $(pair[0]);
      if (!el) return;
      on(el, 'input', function () {
        pair[1](parseNum(el.value));
        renderAll();
      });
      on(el, 'blur', function () {
        var v = parseNum(el.value);
        el.value = v === 0 ? '' : numStr(v, 2);
        if (v === 0 && el.id !== 's-jeonse') el.value = '0';
      });
      on(el, 'focus', function () { el.select(); });
    });

    ['a-name', 'b-name'].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      on(el, 'input', function () {
        if (id === 'a-name') state.a.name = el.value; else state.b.name = el.value;
        renderAll();
      });
    });

    /* 보증금 조달 방식 */
    Array.prototype.forEach.call(document.querySelectorAll('[data-loanmode]'), function (btn) {
      on(btn, 'click', function () {
        var mode = btn.getAttribute('data-loanmode');
        var s = state.single;
        if (mode === s.loanMode) return;
        if (mode === 'pct') {
          s.pct = s.deposit > 0 ? Math.round((s.loan / s.deposit) * 1000) / 10 : 0;
        } else {
          s.loan = Math.round((s.deposit * s.pct) / 100 * 10) / 10;
        }
        s.loanMode = mode;
        syncLoanModeUI();
        renderSingle();
      });
    });

    /* 금리·기회비용·비율 칩 */
    Array.prototype.forEach.call(document.querySelectorAll('[data-rate]'), function (btn) {
      on(btn, 'click', function () {
        state.single.loanRate = parseFloat(btn.getAttribute('data-rate'));
        var input = $('s-rate');
        if (input) input.value = numStr(state.single.loanRate, 2);
        markChipGroup(btn);
        renderSingle();
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-opp]'), function (btn) {
      on(btn, 'click', function () {
        state.oppRate = parseFloat(btn.getAttribute('data-opp'));
        var input = $('s-opp');
        if (input) input.value = numStr(state.oppRate, 2);
        markChipGroup(btn);
        renderAll();
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-pct]'), function (btn) {
      on(btn, 'click', function () {
        state.single.loanMode = 'pct';
        state.single.pct = parseFloat(btn.getAttribute('data-pct'));
        syncLoanModeUI();
        renderSingle();
      });
    });

    /* 세액공제 토글 */
    var taxEl = $('s-tax');
    on(taxEl, 'change', function () {
      state.tax.on = !!taxEl.checked;
      var radios = $('s-tax-radios');
      if (radios) radios.classList.toggle('is-disabled', !state.tax.on);
      renderAll();
    });

    Array.prototype.forEach.call(document.querySelectorAll('input[name="taxrate"]'), function (el) {
      on(el, 'change', function () {
        if (!el.checked) return;
        state.tax.key = el.value;
        renderAll();
      });
    });

    /* 전환율 직접 입력 */
    ['s-legal', 's-market'].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      on(el, 'input', function () {
        var v = parseNum(el.value);
        if (id === 's-legal') state.conv.legal = v; else state.conv.market = v;
        renderSingle();
      });
    });

    /* 모드 탭 */
    Array.prototype.forEach.call(document.querySelectorAll('[data-mode]'), function (btn) {
      on(btn, 'click', function () { switchMode(btn.getAttribute('data-mode')); });
    });

    /* 복사 버튼 */
    document.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-copy]') : null;
      if (!btn) return;
      e.preventDefault();
      handleCopy(btn.getAttribute('data-copy'));
    });
  }

  function markChipGroup(btn) {
    var group = btn.parentNode;
    if (!group) return;
    Array.prototype.forEach.call(group.querySelectorAll('.chip'), function (c) {
      c.classList.toggle('is-on', c === btn);
    });
  }

  function syncLoanModeUI() {
    var s = state.single;
    var isPct = s.loanMode === 'pct';
    var input = $('s-loan');
    var label = $('s-loan-label');
    var unit = $('s-loan-unit');
    var chips = $('s-pct-chips');

    if (label) label.textContent = isPct ? '보증금 대출 비율' : '보증금 대출금액';
    if (unit) unit.textContent = isPct ? '%' : '만원';
    if (input) input.value = numStr(isPct ? s.pct : s.loan, 2);
    if (chips) chips.hidden = !isPct;

    Array.prototype.forEach.call(document.querySelectorAll('[data-loanmode]'), function (b) {
      b.classList.toggle('is-on', b.getAttribute('data-loanmode') === s.loanMode);
    });

    var hint = $('s-loan-hint');
    if (hint) {
      hint.textContent = isPct
        ? '보증금의 ' + numStr(s.pct, 1) + '% · ' + wonMan(s.deposit * s.pct / 100 * MAN, 0)
        : '대출 없으면 0';
    }

    if (isPct) {
      Array.prototype.forEach.call(document.querySelectorAll('[data-pct]'), function (c) {
        c.classList.toggle('is-on', Math.abs(parseFloat(c.getAttribute('data-pct')) - s.pct) < 0.05);
      });
    }
  }

  function switchMode(mode) {
    if (mode !== 'single' && mode !== 'compare') return;
    state.mode = mode;
    Array.prototype.forEach.call(document.querySelectorAll('[data-mode]'), function (btn) {
      btn.setAttribute('aria-selected', btn.getAttribute('data-mode') === mode ? 'true' : 'false');
    });
    if ($('panel-single')) $('panel-single').hidden = mode !== 'single';
    if ($('panel-compare')) $('panel-compare').hidden = mode !== 'compare';

    updateStickyVisibility();

    renderAll();
  }

  function updateStickyVisibility() {
    var sbar = $('stickybar');
    if (!sbar) return;
    sbar.style.display = (state.mode === 'single' || window.innerWidth < 880) ? '' : 'none';
  }

  /* ---------------- 저장/복원 ---------------- */

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        s: state.single, opp: state.oppRate, tax: state.tax, conv: state.conv,
        jeonse: state.jeonse, a: state.a, b: state.b
      }));
    } catch (e) { /* 저장 실패는 무시 */ }
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      var d = JSON.parse(raw);
      if (!d || typeof d !== 'object') return;
      var merge = function (target, src) {
        if (!src || typeof src !== 'object') return;
        Object.keys(target).forEach(function (k) {
          if (src[k] === undefined || src[k] === null) return;
          if (typeof target[k] === 'number') {
            var n = parseNum(src[k]);
            if (isFinite(n)) target[k] = n;
          } else if (typeof target[k] === 'boolean') {
            target[k] = !!src[k];
          } else if (typeof target[k] === 'string') {
            target[k] = String(src[k]).slice(0, 24);
          }
        });
      };
      merge(state.single, d.s);
      merge(state.a, d.a);
      merge(state.b, d.b);
      merge(state.conv, d.conv);
      if (typeof d.opp === 'number') state.oppRate = d.opp;
      if (typeof d.jeonse === 'number') state.jeonse = d.jeonse;
      if (d.tax && typeof d.tax === 'object') {
        state.tax.on = !!d.tax.on;
        state.tax.key = TAX_RATES[d.tax.key] === undefined && d.tax.key !== 'none' ? '5500' : d.tax.key;
      }
      if (state.single.loanMode !== 'pct') state.single.loanMode = 'amount';
    } catch (e) { /* 복원 실패는 무시 */ }
  }

  function syncInputsFromState() {
    var map = {
      's-deposit': state.single.deposit, 's-rent': state.single.rent, 's-mgmt': state.single.mgmt,
      's-rate': state.single.loanRate, 's-opp': state.oppRate,
      's-legal': state.conv.legal, 's-market': state.conv.market,
      's-jeonse': state.jeonse,
      'a-deposit': state.a.deposit, 'a-rent': state.a.rent, 'a-mgmt': state.a.mgmt,
      'a-loan': state.a.loan, 'a-rate': state.a.loanRate,
      'b-deposit': state.b.deposit, 'b-rent': state.b.rent, 'b-mgmt': state.b.mgmt,
      'b-loan': state.b.loan, 'b-rate': state.b.loanRate
    };
    Object.keys(map).forEach(function (id) {
      var el = $(id);
      if (!el) return;
      var v = map[id];
      el.value = v ? numStr(v, 2) : (id === 's-jeonse' ? '' : '0');
    });
    var an = $('a-name'), bn = $('b-name');
    if (an) an.value = state.a.name;
    if (bn) bn.value = state.b.name;

    var taxEl = $('s-tax');
    if (taxEl) taxEl.checked = state.tax.on;
    var radios = $('s-tax-radios');
    if (radios) radios.classList.toggle('is-disabled', !state.tax.on);
    Array.prototype.forEach.call(document.querySelectorAll('input[name="taxrate"]'), function (el) {
      el.checked = el.value === state.tax.key;
    });
    syncLoanModeUI();
    syncChips();
  }

  function syncChips() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-rate]'), function (c) {
      c.classList.toggle('is-on', Math.abs(parseFloat(c.getAttribute('data-rate')) - state.single.loanRate) < 0.01);
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-opp]'), function (c) {
      c.classList.toggle('is-on', Math.abs(parseFloat(c.getAttribute('data-opp')) - state.oppRate) < 0.01);
    });
  }

  /* ---------------- init ---------------- */

  function init() {
    load();
    syncInputsFromState();
    bindInputs();
    renderAll();
    switchMode('single');
    window.addEventListener('resize', updateStickyVisibility);

    /* 키보드 탭 이동 */
    Array.prototype.forEach.call(document.querySelectorAll('[role="tab"]'), function (tab, i, all) {
      on(tab, 'keydown', function (e) {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        var next = all[(i + (e.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length];
        next.click();
        next.focus();
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
