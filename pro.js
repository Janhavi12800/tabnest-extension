// pro.js — compatibility shim.
// The actual trial / pro state machine lives in account.js. This file just
// translates the old "isPro / activatePro" API the rest of the UI uses into
// account.js calls so we didn't have to rewrite every screen at once.

async function getProState() {
  const acc = await getAccount();
  const accessLevel = await getAccessLevel();
  return {
    active: accessLevel === 'unlocked', // true during trial AND pro
    status: acc.status,                  // 'none' | 'pending' | 'trial' | 'pro' | 'expired'
    email: acc.email,
    code: acc.code,
    since: acc.upgradedAt || acc.trialStart,
    trialEnd: acc.trialEnd,
    lastVerified: acc.lastVerified
  };
}

async function isProShim() {
  const acc = await getAccount();
  return acc.status === 'pro';
}

async function activatePro(email, code) {
  return await verifyCode(email, code);
}

async function deactivatePro() {
  return await signOut();
}

const PURCHASE_URL = (typeof TABNEST_CONFIG !== 'undefined' && TABNEST_CONFIG.PURCHASE_URL)
  || 'https://janhavi12800.github.io/tabnest-website/';

if (typeof module !== 'undefined') {
  module.exports = { getProState, isProShim, activatePro, deactivatePro, PURCHASE_URL };
}
