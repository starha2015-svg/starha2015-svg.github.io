/* BLACK LINE SECURITY — page behaviour (no dependencies) */
(function () {
  'use strict';

  var PHONE = '01028959778';
  var EMAIL = 'blackline.guard@gmail.com';
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------------------------------------------------- header */
  var header = document.getElementById('siteHeader');
  var onScroll = function () {
    if (window.scrollY > 12) header.classList.add('scrolled');
    else header.classList.remove('scrolled');
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  /* ---------------------------------------------------------- mobile nav */
  var toggle = document.getElementById('navToggle');
  var nav = document.getElementById('primaryNav');

  function closeNav() {
    document.body.classList.remove('nav-open');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  }
  if (toggle) {
    toggle.addEventListener('click', function () {
      var open = document.body.classList.toggle('nav-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }
  if (nav) {
    nav.addEventListener('click', function (e) {
      if (e.target.closest('a')) closeNav();
    });
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeNav();
  });

  /* ---------------------------------------------------------- reveal */
  var revealItems = Array.prototype.slice.call(document.querySelectorAll('.reveal'));
  if ('IntersectionObserver' in window && !reduce) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          en.target.classList.add('in');
          io.unobserve(en.target);
        }
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });
    revealItems.forEach(function (el) { io.observe(el); });
  } else {
    revealItems.forEach(function (el) { el.classList.add('in'); });
  }

  /* ---------------------------------------------------------- gallery */
  var gallery = document.getElementById('gallery');
  Array.prototype.forEach.call(document.querySelectorAll('[data-gal]'), function (btn) {
    btn.addEventListener('click', function () {
      if (!gallery) return;
      var card = gallery.querySelector('.gal-card');
      var step = card ? card.getBoundingClientRect().width + 20 : 320;
      gallery.scrollBy({ left: step * Number(btn.dataset.gal), behavior: reduce ? 'auto' : 'smooth' });
    });
  });

  /* ---------------------------------------------------------- tabs */
  var tabButtons = Array.prototype.slice.call(document.querySelectorAll('.tab'));
  var panels = {
    quote: document.getElementById('panel-quote'),
    partner: document.getElementById('panel-partner'),
    hire: document.getElementById('panel-hire')
  };
  var result = document.getElementById('qresult');
  var currentTab = 'quote';

  function setTab(name, focus) {
    currentTab = name;
    tabButtons.forEach(function (b) {
      var on = b.id === 'tab-' + name;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.setAttribute('tabindex', on ? '0' : '-1');
      if (on && focus) b.focus();
    });
    Object.keys(panels).forEach(function (k) {
      var p = panels[k];
      if (!p) return;
      var on = k === name;
      p.classList.toggle('is-active', on);
      p.hidden = !on;
    });
    hideResult();
  }

  tabButtons.forEach(function (btn, i) {
    btn.addEventListener('click', function () {
      setTab(btn.id.replace('tab-', ''));
    });
    btn.addEventListener('keydown', function (e) {
      var dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!dir) return;
      e.preventDefault();
      var next = (i + dir + tabButtons.length) % tabButtons.length;
      setTab(tabButtons[next].id.replace('tab-', ''), true);
    });
  });

  /* ---------------------------------------------------------- service shortcut */
  Array.prototype.forEach.call(document.querySelectorAll('[data-service]'), function (btn) {
    btn.addEventListener('click', function () {
      var want = btn.getAttribute('data-service');
      setTab('quote');
      var form = panels.quote;
      var select = form.querySelector('select[name="유형"]');
      if (select) {
        Array.prototype.forEach.call(select.options, function (o) {
          if (o.textContent.replace(/\s/g, '') === want.replace(/\s/g, '')) select.value = o.value || o.textContent;
        });
      }
      var target = document.getElementById('contact');
      if (target) target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
      window.setTimeout(function () {
        if (select) select.focus({ preventScroll: true });
      }, reduce ? 60 : 620);
    });
  });

  /* footer 채용 link */
  Array.prototype.forEach.call(document.querySelectorAll('[data-tab-target]'), function (a) {
    a.addEventListener('click', function () {
      setTab(a.getAttribute('data-tab-target'));
    });
  });

  /* ---------------------------------------------------------- forms */
  var qrBody = document.getElementById('qrBody');
  var qrTitle = document.getElementById('qrTitle');
  var qrMail = document.getElementById('qrMail');
  var qrSms = document.getElementById('qrSms');
  var qrCopy = document.getElementById('qrCopy');

  function hideResult() {
    if (result) result.hidden = true;
  }

  function koreanDate(v) {
    if (!v) return '';
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    if (!m) return v;
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    var dow = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
    return m[1] + '년 ' + Number(m[2]) + '월 ' + Number(m[3]) + '일(' + dow + ')';
  }

  function collect(form) {
    var rows = [];
    Array.prototype.forEach.call(form.querySelectorAll('[data-label]'), function (el) {
      var label = el.getAttribute('data-label');
      var value = (el.value || '').trim();
      if (!value) return;
      if (el.type === 'date') value = koreanDate(value);
      rows.push([label, value]);
    });
    return rows;
  }

  function buildText(kind, rows, form) {
    var isHire = kind.indexOf('채용') > -1;
    var headline = isHire ? '[BLACK LINE 채용 지원]' : '[BLACK LINE ' + kind + ']';
    var who = '';
    var nameEl = form.querySelector('[data-label="이름"], [data-label="담당자명"]');
    if (nameEl && nameEl.value.trim()) who = nameEl.value.trim();
    var lines = [headline, ''];
    rows.forEach(function (r) {
      if (/내용|경력/.test(r[0]) && r[1].length > 40) {
        lines.push('· ' + r[0] + ' :');
        lines.push(r[1]);
      } else {
        lines.push('· ' + r[0] + ' : ' + r[1]);
      }
    });
    lines.push('');
    lines.push('─────────────');
    lines.push('BLACK LINE 홈페이지 ' + kind + (who ? ' · ' + who : ''));
    return lines.join('\n');
  }

  function validate(form) {
    var firstBad = null;
    var msg = [];
    Array.prototype.forEach.call(form.querySelectorAll('[data-required]'), function (el) {
      el.classList.remove('invalid');
      if (!(el.value || '').trim()) {
        el.classList.add('invalid');
        if (!firstBad) firstBad = el;
      }
    });
    var phone = form.querySelector('[data-phone]');
    if (phone && phone.value.trim()) {
      var ok = /^[0-9+\-\s().]{7,20}$/.test(phone.value.trim());
      if (!ok) {
        phone.classList.add('invalid');
        if (!firstBad) firstBad = phone;
        msg.push('연락처는 숫자와 - 만으로 입력해 주세요.');
      }
    }
    var mail = form.querySelector('input[type="email"]');
    if (mail && mail.value.trim()) {
      var okMail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail.value.trim());
      if (!okMail) {
        mail.classList.add('invalid');
        if (!firstBad) firstBad = mail;
        msg.push('이메일 주소를 다시 확인해 주세요.');
      }
    }
    if (firstBad && !msg.length) msg.push('(*) 표시된 항목을 입력해 주세요.');
    return { firstBad: firstBad, message: msg.join(' ') };
  }

  function showResult(kind, text, form) {
    if (!result) return;
    qrTitle.textContent = kind + ' 내용이 정리되었습니다';
    qrBody.textContent = text;

    var subject = '[BLACK LINE] ' + kind;
    var nameEl = form.querySelector('[data-label="이름"], [data-label="담당자명"]');
    if (nameEl && nameEl.value.trim()) subject += ' - ' + nameEl.value.trim();

    qrMail.href = 'mailto:' + EMAIL + '?subject=' + encodeURIComponent(subject) +
      '&body=' + encodeURIComponent(text);
    qrSms.href = 'sms:' + PHONE + '?body=' + encodeURIComponent(text);

    result.hidden = false;
    result.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
  }

  Array.prototype.forEach.call(document.querySelectorAll('.qform'), function (form) {
    var err = form.querySelector('.ferr');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var kind = form.getAttribute('data-kind') || '문의';
      var check = validate(form);
      if (check.firstBad) {
        if (err) {
          err.textContent = check.message;
          err.hidden = false;
        }
        check.firstBad.focus();
        return;
      }
      if (err) {
        err.hidden = true;
        err.textContent = '';
      }
      var rows = collect(form);
      showResult(kind, buildText(kind, rows, form), form);
    });

    form.addEventListener('input', function (e) {
      if (e.target.classList && e.target.classList.contains('invalid')) {
        e.target.classList.remove('invalid');
      }
    });
  });

  if (qrCopy) {
    qrCopy.addEventListener('click', function () {
      var text = qrBody.textContent || '';
      var done = function () {
        qrCopy.textContent = '복사되었습니다';
        window.setTimeout(function () { qrCopy.textContent = '내용 복사'; }, 1800);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, fallback);
      } else {
        fallback();
      }
      function fallback() {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); done(); } catch (e) { /* noop */ }
        document.body.removeChild(ta);
      }
    });
  }

  /* keep the initial tab in sync (in case of restored form state) */
  setTab(currentTab);
})();
