// TabNest onboarding — 5-step trial signup flow.
// Slides: 1 welcome → 2 email signup → 3 code verify → 4 theme pick → 5 done.
//
// On slide 2, "Continue" calls account.signUp() which triggers the Apps Script
// to email a 6-digit code. On slide 3, the code is verified. Both 'trial' and
// 'pro' are valid verification outcomes — pro just means a returning customer
// who already paid before reinstalling.

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

let step = 1;
const TOTAL = 5;
let signedUp = false;   // true once /signup succeeded (code is en route)
let verified = false;   // true once /verify-code succeeded

document.addEventListener('DOMContentLoaded', async () => {
  await initTheme();
  renderThemePicker();
  setupNav();
  setupSignup();
  setupVerify();
  setupDone();
});

function renderThemePicker() {
  const grid = $('#theme-grid');
  if (!grid) return;
  grid.innerHTML = '';
  const current = document.documentElement.getAttribute('data-theme') || 'forest';
  for (const t of THEMES) {
    const card = document.createElement('div');
    card.className = 'theme-card' + (t.id === current ? ' active' : '');
    card.innerHTML = `
      <div class="theme-head">
        <div class="theme-icon">${t.icon}</div>
        <div class="theme-name">${t.name}</div>
      </div>
      <div class="theme-desc">${t.description}</div>
      <div class="theme-swatches">
        ${t.swatch.map(c => `<div class="theme-swatch" style="background:${c}"></div>`).join('')}
      </div>
    `;
    card.addEventListener('click', async () => {
      applyTheme(t.id);
      await saveTheme(t.id);
      renderThemePicker();
    });
    grid.appendChild(card);
  }
}

function setupNav() {
  $('#next')?.addEventListener('click', handleNext);
  $('#prev')?.addEventListener('click', () => goTo(step - 1));
}

async function handleNext() {
  if (step === 1) { goTo(2); return; }
  if (step === 2) { await doSignUp(); return; }
  if (step === 3) { await doVerify(); return; }
  if (step === 4) { goTo(5); return; }
  if (step === 5) { await finish(); return; }
}

function goTo(n) {
  if (n < 1 || n > TOTAL) return;
  if (n > 2 && !signedUp) return;
  if (n > 3 && !verified) return;
  step = n;
  $$('.slide').forEach(s => s.classList.toggle('active', parseInt(s.dataset.step) === step));
  $$('.dot').forEach((d, i) => d.classList.toggle('active', i === step - 1));
  $('#prev').disabled = step === 1 || step === 3; // can't go back to email entry once code sent
  $('#next').textContent = step === TOTAL ? 'Finish ✓' : (step === 4 ? 'Continue →' : 'Continue →');
  // Hide nav buttons on signup/verify slides — they have their own primary CTA
  $('#next').style.display = (step === 2 || step === 3) ? 'none' : '';
  $('#prev').style.display = (step === 2 || step === 3) ? 'none' : '';

  if (step === 2) setTimeout(() => $('#signup-email')?.focus(), 100);
  if (step === 3) setTimeout(() => $('#verify-code')?.focus(), 100);
}

/* ---------- Signup ---------- */

function setupSignup() {
  $('#send-code-btn')?.addEventListener('click', doSignUp);
  $('#signup-email')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSignUp();
  });
}

async function doSignUp() {
  const email = ($('#signup-email')?.value || '').trim();
  const errEl = $('#signup-error');
  const btn = $('#send-code-btn');
  errEl.textContent = '';
  errEl.classList.remove('success');

  if (!email || !/\S+@\S+\.\S+/.test(email)) {
    errEl.textContent = 'Please enter a valid email address.';
    $('#signup-email').focus();
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Sending…';

  const r = await signUp(email);

  btn.disabled = false;
  btn.textContent = 'Send me a code →';

  if (r.ok) {
    signedUp = true;
    $('#verify-email-out').textContent = email;
    errEl.classList.add('success');
    errEl.textContent = r.resent
      ? '✓ Code re-sent — check your email.'
      : '✓ Code sent. Check your email.';
    setTimeout(() => goTo(3), 700);
    return;
  }

  // Friendly error mapping
  const e = String(r.error || '').toLowerCase();
  if (e.includes('device_already_trialed')) {
    errEl.innerHTML = '🔒 This device already had a trial. <a href="' + TABNEST_CONFIG.PURCHASE_URL + '" target="_blank">Subscribe ₹100 lifetime</a> to keep using TabNest.';
  } else if (e.includes('email_already_used')) {
    errEl.textContent = 'This email already had a trial that ended. Use a different email, or subscribe.';
  } else if (e.includes('server isn\'t configured') || e.includes('server_not_configured')) {
    errEl.textContent = 'Pro server isn\'t configured on this build yet. (Owner: set VERIFY_URL in config.js)';
  } else {
    errEl.textContent = r.error || 'Sign up failed. Please try again.';
  }
}

/* ---------- Verify ---------- */

function setupVerify() {
  $('#verify-btn')?.addEventListener('click', doVerify);
  $('#verify-code')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doVerify();
  });
  $('#verify-code')?.addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
  });
  $('#resend-link')?.addEventListener('click', async (e) => {
    e.preventDefault();
    const email = ($('#signup-email')?.value || '').trim();
    const errEl = $('#verify-error');
    errEl.classList.remove('success');
    errEl.textContent = 'Resending…';
    const r = await signUp(email);
    if (r.ok) {
      errEl.classList.add('success');
      errEl.textContent = '✓ Code re-sent.';
    } else {
      errEl.textContent = r.error || 'Could not resend.';
    }
  });
  $('#change-email-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    signedUp = false;
    goTo(2);
  });
}

async function doVerify() {
  const email = ($('#signup-email')?.value || '').trim();
  const code = ($('#verify-code')?.value || '').trim();
  const errEl = $('#verify-error');
  const btn = $('#verify-btn');
  errEl.textContent = '';
  errEl.classList.remove('success');

  if (!/^\d{6}$/.test(code)) {
    errEl.textContent = 'Code should be exactly 6 digits.';
    $('#verify-code').focus();
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Verifying…';

  const r = await verifyCode(email, code);

  btn.disabled = false;
  btn.textContent = 'Activate TabNest';

  if (r.ok) {
    verified = true;
    errEl.classList.add('success');
    errEl.textContent = r.status === 'pro' ? '✓ Welcome back, Pro!' : '✓ Trial activated — 7 days unlocked!';
    if (r.status === 'pro') {
      $('#done-message').textContent = 'You\'re back in TabNest Pro. All features unlocked, forever.';
    }
    setTimeout(() => goTo(4), 800);
    return;
  }

  const e = String(r.error || '').toLowerCase();
  if (e.includes('trial_expired')) {
    errEl.innerHTML = '⏰ This trial ended. <a href="' + TABNEST_CONFIG.PURCHASE_URL + '" target="_blank">Subscribe ₹100 lifetime</a> to keep using TabNest.';
  } else if (e.includes('invalid')) {
    errEl.textContent = 'Wrong code. Check your email and try again.';
  } else {
    errEl.textContent = r.error || 'Verification failed.';
  }
}

/* ---------- Finish ---------- */

function setupDone() {
  $('#open-dashboard')?.addEventListener('click', finish);
}

async function finish() {
  await chrome.storage.local.set({ onboarded: true });
  const url = chrome.runtime.getURL('dashboard.html');
  const existing = await chrome.tabs.query({ url });
  const cur = await chrome.tabs.getCurrent();
  if (existing.length > 0) {
    await chrome.tabs.update(existing[0].id, { active: true });
    if (cur) await chrome.tabs.remove(cur.id);
  } else if (cur) {
    await chrome.tabs.update(cur.id, { url });
  } else {
    await chrome.tabs.create({ url });
  }
}
