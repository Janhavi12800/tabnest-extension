// TabNest account state — trial / pro / expired.
// Replaces the old pro.js gate. Backed by chrome.storage.local + Apps Script.
//
// Account statuses:
//   'none'    — no account yet (fresh install)
//   'pending' — email submitted, awaiting 6-digit code verification
//   'trial'   — verified, free trial active for TRIAL_DAYS
//   'pro'     — paid lifetime subscription
//   'expired' — trial ran out, no payment yet
//
// Anti-abuse:
//   - 6-digit code emailed to verify ownership of the address
//   - device fingerprint (silent SHA-256 hash) sent to server on signup;
//     same fingerprint + new email → server denies a second trial

const ACCOUNT_KEY = 'account_state';

const ACCOUNT_DEFAULT = {
  status: 'none',
  email: null,
  code: null,
  fingerprint: null,
  trialStart: null,
  trialEnd: null,
  upgradedAt: null,
  lastVerified: null
};

async function getAccount() {
  try {
    const s = await chrome.storage.local.get(ACCOUNT_KEY);
    return { ...ACCOUNT_DEFAULT, ...(s[ACCOUNT_KEY] || {}) };
  } catch {
    return { ...ACCOUNT_DEFAULT };
  }
}

async function setAccount(updates) {
  const cur = await getAccount();
  await chrome.storage.local.set({ [ACCOUNT_KEY]: { ...cur, ...updates } });
}

async function clearAccount() {
  await chrome.storage.local.set({ [ACCOUNT_KEY]: { ...ACCOUNT_DEFAULT } });
}

// Compute the access level the rest of the extension should respect.
// Returns 'unlocked' (Pro or active trial) or 'locked' (everything else).
async function getAccessLevel() {
  const acc = await getAccount();
  if (acc.status === 'pro') return 'unlocked';
  if (acc.status === 'trial') {
    if (acc.trialEnd && acc.trialEnd < Date.now()) {
      await setAccount({ status: 'expired' });
      return 'locked';
    }
    return 'unlocked';
  }
  return 'locked';
}

async function isPro() {
  const acc = await getAccount();
  return acc.status === 'pro';
}

async function isOnTrial() {
  const acc = await getAccount();
  return acc.status === 'trial' && acc.trialEnd && acc.trialEnd > Date.now();
}

async function getTimeLeft() {
  const acc = await getAccount();
  if (acc.status !== 'trial' || !acc.trialEnd) return 0;
  return Math.max(0, acc.trialEnd - Date.now());
}

// Silent device fingerprint — combines browser + screen + locale + timezone.
// Hashed with SHA-256 so the server stores nothing identifying about the user,
// just an opaque 64-char string used to detect duplicate signups.
async function getFingerprint() {
  const parts = [
    (typeof navigator !== 'undefined' && navigator.userAgent) || '',
    (typeof navigator !== 'undefined' && navigator.platform) || '',
    (typeof navigator !== 'undefined' && navigator.language) || '',
    (typeof screen !== 'undefined' && String(screen.width || '')) || '',
    (typeof screen !== 'undefined' && String(screen.height || '')) || '',
    (typeof screen !== 'undefined' && String(screen.colorDepth || '')) || '',
    (typeof Intl !== 'undefined' && Intl.DateTimeFormat().resolvedOptions().timeZone) || ''
  ];
  const data = parts.join('|');
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const enc = new TextEncoder().encode(data);
    const buf = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  // Fallback (background service worker has SubtleCrypto, so this rarely runs)
  let h = 5381;
  for (let i = 0; i < data.length; i++) h = ((h << 5) + h) ^ data.charCodeAt(i);
  return String(h >>> 0).padStart(16, '0');
}

async function callServer(params) {
  if (!isServerConfigured()) throw new Error('server_not_configured');
  const url = new URL(TABNEST_CONFIG.VERIFY_URL);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), { method: 'GET' });
  if (!res.ok) throw new Error('http_' + res.status);
  return await res.json();
}

// ---------- Public API ----------

async function signUp(email) {
  email = (email || '').toLowerCase().trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return { ok: false, error: 'That email doesn\'t look right.' };
  }
  if (!isServerConfigured()) {
    return { ok: false, error: 'Pro server isn\'t configured on this build yet.' };
  }
  const fingerprint = await getFingerprint();
  try {
    const result = await callServer({ action: 'signup', email, fingerprint });
    if (result.ok) {
      await setAccount({
        status: 'pending',
        email,
        fingerprint,
        code: null,
        trialStart: null,
        trialEnd: null
      });
      return {
        ok: true,
        alreadyTrialed: !!result.alreadyTrialed,
        message: result.message || null
      };
    }
    return { ok: false, error: result.error || 'Sign up failed.' };
  } catch (e) {
    if (String(e).includes('server_not_configured')) {
      return { ok: false, error: 'Pro server isn\'t configured on this build yet.' };
    }
    return { ok: false, error: 'Couldn\'t reach the server. Check your connection.' };
  }
}

async function verifyCode(email, code) {
  email = (email || '').toLowerCase().trim();
  code = (code || '').trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) return { ok: false, error: 'Email looks off.' };
  if (!/^\d{6}$/.test(code)) return { ok: false, error: 'Code must be 6 digits.' };
  try {
    const result = await callServer({ action: 'verify-code', email, code });
    if (result.ok) {
      await setAccount({
        status: result.status || 'trial',
        email,
        code,
        trialStart: result.trialStart || null,
        trialEnd: result.trialEnd || null,
        upgradedAt: result.upgradedAt || null,
        lastVerified: Date.now()
      });
      return { ok: true, status: result.status };
    }
    return { ok: false, error: result.error || 'Code didn\'t match. Try again.' };
  } catch (e) {
    return { ok: false, error: 'Couldn\'t reach the server. Try again.' };
  }
}

async function refreshStatus() {
  const acc = await getAccount();
  if (!acc.email || !acc.code) return acc.status;
  if (!isServerConfigured()) return acc.status;
  try {
    const result = await callServer({ action: 'status', email: acc.email, code: acc.code });
    if (result.ok) {
      await setAccount({
        status: result.status,
        trialEnd: result.trialEnd || acc.trialEnd,
        upgradedAt: result.upgradedAt || acc.upgradedAt,
        lastVerified: Date.now()
      });
      return result.status;
    }
    if (result.error === 'invalid') {
      // Server explicitly says this account is invalid — wipe locally.
      await clearAccount();
      return 'none';
    }
    return acc.status;
  } catch {
    return acc.status; // network error: keep current state
  }
}

async function signOut() {
  await clearAccount();
}

// Switch the locally-stored email/code without restarting the trial.
// Server transfers state (trial dates / pro flag) to the new email.
async function switchAccount(newEmail) {
  newEmail = (newEmail || '').toLowerCase().trim();
  if (!/^\S+@\S+\.\S+$/.test(newEmail)) return { ok: false, error: 'New email looks off.' };
  const acc = await getAccount();
  if (!acc.email || !acc.code) return { ok: false, error: 'You aren\'t signed in.' };
  try {
    const result = await callServer({
      action: 'switch-account',
      oldEmail: acc.email,
      oldCode: acc.code,
      newEmail
    });
    if (result.ok) {
      await setAccount({
        status: 'pending',
        email: newEmail,
        code: null,
        lastVerified: null
      });
      return { ok: true, message: 'We\'ve emailed a new 6-digit code to ' + newEmail };
    }
    return { ok: false, error: result.error || 'Switch failed.' };
  } catch (e) {
    return { ok: false, error: 'Couldn\'t reach the server.' };
  }
}

// Quick-fire polling after the user clicks Subscribe, so as soon as the
// server records the payment, the extension flips to 'pro' without making the
// user re-paste anything.
async function startPostPayPolling(onUpdate) {
  const start = Date.now();
  const tick = async () => {
    if (Date.now() - start > TABNEST_CONFIG.POST_PAY_POLL_TIMEOUT_MS) {
      onUpdate?.({ done: true, status: (await getAccount()).status });
      return;
    }
    const status = await refreshStatus();
    if (status === 'pro') {
      onUpdate?.({ done: true, status: 'pro' });
      return;
    }
    setTimeout(tick, TABNEST_CONFIG.POST_PAY_POLL_MS);
  };
  tick();
}

if (typeof module !== 'undefined') {
  module.exports = {
    getAccount, setAccount, clearAccount,
    getAccessLevel, isPro, isOnTrial, getTimeLeft,
    signUp, verifyCode, refreshStatus, signOut, switchAccount,
    startPostPayPolling
  };
}
