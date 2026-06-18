// TabNest configuration — owner edits these values before publishing.
// Every part of the extension reads from here, so you only have to change
// things in ONE place.

const TABNEST_CONFIG = {
  // ============================================================
  // 1. Apps Script Web App URL
  // After deploying TabNest-OwnerTools/Code.gs to script.google.com,
  // paste the Web App URL here.
  // ============================================================
  VERIFY_URL: 'https://tabnest-backend.janhavirawat25.workers.dev/',

  // ============================================================
  // 2. Landing page URL
  // Where users go to subscribe. Default is your GitHub Pages URL.
  // ============================================================
  PURCHASE_URL: 'https://janhavi12800.github.io/tabnest-website/',

  // ============================================================
  // 3. Trial settings — usually don't need to change
  // ============================================================
  TRIAL_DAYS: 7,
  REVERIFY_INTERVAL_MS: 24 * 60 * 60 * 1000, // re-check status every 24h
  POST_PAY_POLL_MS: 5000,                    // poll every 5s after pay click
  POST_PAY_POLL_TIMEOUT_MS: 2 * 60 * 1000,   // give up after 2 min

  // ============================================================
  // 4. Price (in INR) — shown on subscribe buttons
  // ============================================================
  PRICE_INR: 100,
};

function isServerConfigured() {
  const url = TABNEST_CONFIG.VERIFY_URL || '';
  if (!url) return false;
  if (url.includes('PASTE-YOUR') || url.includes('PASTE-DEPLOYMENT')) return false;
  // Accept both Apps Script (script.google.com) and Cloudflare Workers (.workers.dev or custom domain)
  return url.startsWith('https://');
}

if (typeof module !== 'undefined') {
  module.exports = { TABNEST_CONFIG, isServerConfigured };
}
