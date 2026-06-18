// TabNest Hibernation — auto-suspend tabs unused for too long to save RAM.
// Uses Chrome's native chrome.tabs.discard() which truly frees the tab's
// memory while keeping it in the tab bar. Clicking the tab re-loads it.
//
// Pro-only. Free users see a sample card but can't enable the auto behaviour.

const HIB_KEY = 'hibernation_state';
const HIB_SETTINGS_KEY = 'hibernation_settings';
const AVG_TAB_RAM_MB = 60; // Conservative average — Chrome tabs use 30-200 MB.

const HIB_DEFAULTS = {
  enabled: true,
  afterMinutes: 30,
  skipPinned: true,
  skipPlayingAudio: true
};

async function getHibSettings() {
  const s = await chrome.storage.local.get(HIB_SETTINGS_KEY);
  return { ...HIB_DEFAULTS, ...(s[HIB_SETTINGS_KEY] || {}) };
}

async function setHibSettings(updates) {
  const cur = await getHibSettings();
  await chrome.storage.local.set({ [HIB_SETTINGS_KEY]: { ...cur, ...updates } });
}

async function getHibState() {
  const s = await chrome.storage.local.get(HIB_KEY);
  return s[HIB_KEY] || { hibernatedCount: 0, mbSaved: 0, lifetime: { count: 0, mb: 0 } };
}

async function recordHibernation(n) {
  const state = await getHibState();
  state.hibernatedCount += n;
  state.mbSaved += n * AVG_TAB_RAM_MB;
  state.lifetime.count += n;
  state.lifetime.mb += n * AVG_TAB_RAM_MB;
  await chrome.storage.local.set({ [HIB_KEY]: state });
}

async function resetHibCounters() {
  const state = await getHibState();
  await chrome.storage.local.set({
    [HIB_KEY]: { ...state, hibernatedCount: 0, mbSaved: 0 }
  });
}

// Run a hibernation pass. Returns count of tabs hibernated.
async function runHibernationPass(force = false) {
  const settings = await getHibSettings();
  if (!settings.enabled && !force) return 0;

  const { tabStamps = {} } = await chrome.storage.local.get('tabStamps');
  const cutoff = Date.now() - settings.afterMinutes * 60 * 1000;

  const tabs = await chrome.tabs.query({});
  const candidates = [];
  for (const t of tabs) {
    if (t.discarded) continue;
    if (t.active) continue;
    if (settings.skipPinned && t.pinned) continue;
    if (settings.skipPlayingAudio && t.audible) continue;
    if (!t.url || t.url.startsWith('chrome://') || t.url.startsWith('chrome-extension://')) continue;
    const stamp = tabStamps[t.id];
    if (stamp && stamp < cutoff) candidates.push(t.id);
    else if (!stamp && t.lastAccessed && t.lastAccessed < cutoff) candidates.push(t.id);
  }

  let hibernated = 0;
  for (const id of candidates) {
    try {
      await chrome.tabs.discard(id);
      hibernated++;
    } catch {}
  }
  if (hibernated > 0) await recordHibernation(hibernated);
  return hibernated;
}

function formatMb(mb) {
  if (mb < 1024) return `${Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

if (typeof module !== 'undefined') {
  module.exports = {
    getHibSettings, setHibSettings,
    getHibState, recordHibernation, resetHibCounters,
    runHibernationPass, formatMb, AVG_TAB_RAM_MB
  };
}
