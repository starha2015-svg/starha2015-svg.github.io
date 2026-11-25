/* 비공개 잠금 — 비밀번호 원문은 두지 않고 SHA-256 해시만 비교한다.
   인증 전에는 편집 화면(app)을 그리지도, 스크립트를 불러오지도 않는다. */

const PASSWORD_HASH = '43c060b3a59032e0e8e3aa68cb60211a26523ed118263b8814d5bf70e68fb5d1';
const SESSION_KEY = 'photh.unlock';
const REMEMBER_KEY = 'photh.unlock.remember';
const TOKEN = 'ok:' + PASSWORD_HASH.slice(0, 20);
const APP_URL = './app.js?v=26';

const body = document.body;
const form = document.getElementById('lockForm');
const input = document.getElementById('lockInput');
const submitBtn = document.getElementById('lockSubmit');
const errorEl = document.getElementById('lockError');
const rememberEl = document.getElementById('lockRemember');
const lockScreen = document.getElementById('lockScreen');

let started = false;
let fails = 0;
let waitUntil = 0;

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256(text) {
  if (!(window.crypto && crypto.subtle && crypto.subtle.digest)) throw new Error('crypto unavailable');
  const data = new TextEncoder().encode(text);
  return toHex(await crypto.subtle.digest('SHA-256', data));
}

function hasAccess() {
  try {
    if (sessionStorage.getItem(SESSION_KEY) === TOKEN) return true;
    if (localStorage.getItem(REMEMBER_KEY) === TOKEN) return true;
  } catch (e) { /* 저장소를 못 쓰면 매번 잠금 해제 */ }
  return false;
}

async function openApp() {
  if (started) return;
  started = true;
  body.classList.remove('is-locked');
  if (lockScreen) lockScreen.setAttribute('aria-hidden', 'true');
  try {
    await import(APP_URL);
  } catch (e) {
    console.error(e);
    started = false;
    body.classList.add('is-locked');
    if (lockScreen) lockScreen.removeAttribute('aria-hidden');
    if (errorEl) errorEl.textContent = '앱을 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.';
  }
}

function showError(msg) {
  if (errorEl) errorEl.textContent = msg;
}

if (hasAccess()) {
  openApp();
} else if (input) {
  setTimeout(() => input.focus(), 60);
}

if (form) {
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const value = input ? input.value.trim() : '';
    if (!value) { showError('비밀번호를 입력해 주세요.'); return; }
    if (Date.now() < waitUntil) {
      showError(`${Math.ceil((waitUntil - Date.now()) / 1000)}초 후에 다시 시도해 주세요.`);
      return;
    }
    submitBtn.disabled = true;
    try {
      const h = await sha256(value);
      if (h === PASSWORD_HASH) {
        try {
          sessionStorage.setItem(SESSION_KEY, TOKEN);
          if (rememberEl && rememberEl.checked) localStorage.setItem(REMEMBER_KEY, TOKEN);
          else localStorage.removeItem(REMEMBER_KEY);
        } catch (err) { /* 저장 실패해도 이번 방문은 열어 준다 */ }
        if (input) input.value = '';
        showError('');
        form.classList.remove('is-error');
        await openApp();
      } else {
        fails += 1;
        if (fails >= 5) { waitUntil = Date.now() + 8000; fails = 0; }
        showError('비밀번호가 맞지 않습니다.');
        form.classList.add('is-error');
        setTimeout(() => form.classList.remove('is-error'), 420);
        if (input) { input.value = ''; input.focus(); }
      }
    } catch (err) {
      showError('이 브라우저에서는 잠금을 확인할 수 없습니다. 보안 연결(https)에서 열어 주세요.');
    } finally {
      submitBtn.disabled = false;
    }
  });
}

/* 상단 잠금 버튼: 인증을 지우고 즉시 다시 잠근다 */
const lockBtn = document.getElementById('btnLock');
if (lockBtn) {
  lockBtn.addEventListener('click', () => {
    try {
      sessionStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(REMEMBER_KEY);
    } catch (e) { /* 무시 */ }
    location.reload();
  });
}
