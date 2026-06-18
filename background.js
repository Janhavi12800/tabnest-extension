// TabNest — service worker that auto-groups tabs into nests and tracks
// last-accessed times so the dashboard can flag stale tabs.

importScripts(
  'config.js',
  'account.js',
  'categories.js',
  'hibernation.js',
  'archive.js',
  'stats.js',
  'reminders.js'
);

const DEFAULT_SETTINGS = {
  autoGroup: true,
  groupOnCreate: true,
  groupOnUpdate: true,
  staleAfterHours: 24
};

async function refreshCustomNests() {
  const stored = await chrome.storage.local.get('customNests');
  setCustomNests(stored.customNests || []);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.customNests) {
    setCustomNests(changes.customNests.newValue || []);
  }
});

async function getSettings() {
  const stored = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
}

async function touchTab(tabId) {
  const { tabStamps = {} } = await chrome.storage.local.get('tabStamps');
  tabStamps[tabId] = Date.now();
  await chrome.storage.local.set({ tabStamps });
}

async function applyOpenMode(mode) {
  try {
    if (mode === 'sidepanel') {
      // Clear the popup so the side panel can take over the action click.
      await chrome.action.setPopup({ popup: '' });
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    } else if (mode === 'tab') {
      // Clear popup + disable side panel → action.onClicked listener fires.
      await chrome.action.setPopup({ popup: '' });
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
    } else {
      // popup (default) — restore popup, disable side panel auto-open.
      await chrome.action.setPopup({ popup: 'popup.html' });
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
    }
  } catch (e) {
    // sidePanel API not available on older Chrome — ignore.
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  // Only fires when popup is empty (i.e. side panel or tab mode picked).
  const { settings = {} } = await chrome.storage.local.get('settings');
  if (settings.openAs === 'tab') {
    const dashUrl = chrome.runtime.getURL('dashboard.html');
    const existing = await chrome.tabs.query({ url: dashUrl });
    if (existing.length > 0) {
      await chrome.tabs.update(existing[0].id, { active: true });
      await chrome.windows.update(existing[0].windowId, { focused: true });
    } else {
      await chrome.tabs.create({ url: dashUrl });
    }
  }
  // For sidepanel mode, sidePanel.setPanelBehavior already handles the click.
});

chrome.runtime.onInstalled.addListener(async (details) => {
  const cur = await chrome.storage.local.get(['settings', 'onboarded']);
  if (!cur.settings) {
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  }
  await refreshCustomNests();
  if (details.reason === 'install' && !cur.onboarded) {
    await chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
  }
  const settings = (await chrome.storage.local.get('settings')).settings || {};
  await applyOpenMode(settings.openAs || 'popup');
  scheduleAutoGroupForAllTabs();
});

chrome.runtime.onStartup.addListener(async () => {
  await refreshCustomNests();
  const settings = (await chrome.storage.local.get('settings')).settings || {};
  await applyOpenMode(settings.openAs || 'popup');
  scheduleAutoGroupForAllTabs();
});

async function scheduleAutoGroupForAllTabs() {
  const settings = await getSettings();
  if (!settings.autoGroup) return;
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (canGroup(tab)) await placeTabInNest(tab);
  }
}

function canGroup(tab) {
  if (!tab || !tab.url) return false;
  if (tab.pinned) return false;
  if (tab.url.startsWith('chrome://')) return false;
  if (tab.url.startsWith('chrome-extension://')) return false;
  if (tab.url.startsWith('edge://')) return false;
  if (tab.url.startsWith('about:')) return false;
  return true;
}

async function placeTabInNest(tab) {
  try {
    const category = categorizeTab(tab);
    const groupTitle = `${category.icon} ${category.name}`;

    const existing = await chrome.tabGroups.query({ windowId: tab.windowId });
    const match = existing.find(g => g.title === groupTitle);

    if (match) {
      if (tab.groupId !== match.id) {
        await chrome.tabs.group({ tabIds: [tab.id], groupId: match.id });
      }
    } else {
      const newGroupId = await chrome.tabs.group({
        tabIds: [tab.id],
        createProperties: { windowId: tab.windowId }
      });
      await chrome.tabGroups.update(newGroupId, {
        title: groupTitle,
        color: category.chromeColor
      });
    }
  } catch (e) {
    // Tab might have been closed mid-flight, or moved by user — fine, skip.
  }
}

chrome.tabs.onCreated.addListener(async (tab) => {
  await touchTab(tab.id);
  bump('tabsOpened');
  const settings = await getSettings();
  if (!settings.autoGroup || !settings.groupOnCreate) return;
  if (canGroup(tab)) await placeTabInNest(tab);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url) await touchTab(tabId);
  if (!changeInfo.url && changeInfo.status !== 'complete') return;
  const settings = await getSettings();
  if (!settings.autoGroup || !settings.groupOnUpdate) return;
  if (canGroup(tab)) await placeTabInNest(tab);
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await touchTab(tabId);
});

// Track closed tabs in the archive (so the recently-closed feature works).
// We listen to onUpdated to capture title/url before close, and onRemoved for the close itself.
const recentTabSnapshots = {};
chrome.tabs.onUpdated.addListener((tabId, _info, tab) => {
  if (tab && tab.url && !tab.url.startsWith('chrome://')) {
    recentTabSnapshots[tabId] = {
      url: tab.url, title: tab.title, favIconUrl: tab.favIconUrl, windowId: tab.windowId
    };
  }
});

chrome.tabs.onRemoved.addListener(async (tabId, info) => {
  const { tabStamps = {} } = await chrome.storage.local.get('tabStamps');
  if (tabStamps[tabId]) {
    delete tabStamps[tabId];
    await chrome.storage.local.set({ tabStamps });
  }
  const snap = recentTabSnapshots[tabId];
  if (snap) {
    await recordClose(snap);
    delete recentTabSnapshots[tabId];
  }
  bump('tabsClosed');
});

// Background alarms — periodic hibernation pass, account status refresh, reminders.
chrome.alarms.create('hibernationPass', { periodInMinutes: 5 });
chrome.alarms.create('accountStatusCheck', { periodInMinutes: 60 * 24 }); // once a day
chrome.alarms.create('trialExpiryCheck', { periodInMinutes: 60 }); // hourly check for expiry transition

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'hibernationPass') {
    const n = await runHibernationPass();
    if (n) await bump('hibernated', n);
    return;
  }
  if (alarm.name === 'accountStatusCheck') {
    try { await refreshStatus(); } catch {}
    return;
  }
  if (alarm.name === 'trialExpiryCheck') {
    const acc = await getAccount();
    if (acc.status === 'trial' && acc.trialEnd && acc.trialEnd < Date.now()) {
      await setAccount({ status: 'expired' });
      try {
        chrome.notifications.create('trial_expired', {
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: '🪺 Your TabNest trial ended',
          message: `Subscribe ₹${TABNEST_CONFIG.PRICE_INR} lifetime to keep using TabNest.`,
          priority: 2
        });
      } catch {}
    }
    return;
  }
  if (alarm.name && alarm.name.startsWith('reminder:')) {
    await fireReminder(alarm.name.slice('reminder:'.length));
  }
});

async function fireReminder(id) {
  const list = await getReminders();
  const rem = list.find(r => r.id === id);
  if (!rem) return;
  try {
    const tabs = await chrome.tabs.query({ url: rem.url });
    if (tabs.length === 0) {
      await chrome.tabs.create({ url: rem.url, active: true });
    } else {
      await chrome.tabs.update(tabs[0].id, { active: true });
      await chrome.windows.update(tabs[0].windowId, { focused: true });
    }
  } catch {}
  try {
    chrome.notifications.create('rem_' + id, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: '🪺 TabNest reminder',
      message: rem.note ? `${rem.title}\n${rem.note}` : rem.title,
      priority: 1
    });
  } catch {}
  await removeReminder(id);
}

// Messages from popup/dashboard ------------------------------------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {
        case 'regroup-all': {
          await scheduleAutoGroupForAllTabs();
          sendResponse({ ok: true });
          break;
        }
        case 'dedupe': {
          const r = await dedupeTabs();
          sendResponse({ ok: true, ...r });
          break;
        }
        case 'close-stale': {
          const r = await closeStaleTabs(msg.hours || 24);
          sendResponse({ ok: true, ...r });
          break;
        }
        case 'save-workspace': {
          await saveWorkspace(msg.name);
          sendResponse({ ok: true });
          break;
        }
        case 'open-workspace': {
          await openWorkspace(msg.id, msg.replace);
          sendResponse({ ok: true });
          break;
        }
        case 'delete-workspace': {
          await deleteWorkspace(msg.id);
          sendResponse({ ok: true });
          break;
        }
        case 'open-dashboard': {
          await openDashboard();
          sendResponse({ ok: true });
          break;
        }
        case 'hibernate-now': {
          const n = await runHibernationPass(true);
          sendResponse({ ok: true, hibernated: n });
          break;
        }
        case 'smart-cleanup': {
          const result = await runSmartCleanup(msg.options || {});
          sendResponse({ ok: true, ...result });
          break;
        }
        case 'add-reminder': {
          const id = await addReminder(msg.payload);
          sendResponse({ ok: true, id });
          break;
        }
        case 'remove-reminder': {
          await removeReminder(msg.id);
          sendResponse({ ok: true });
          break;
        }
        case 'reopen-closed': {
          if (msg.url) await chrome.tabs.create({ url: msg.url, active: true });
          sendResponse({ ok: true });
          break;
        }
        case 'ungroup-all': {
          const n = await ungroupAllTabs();
          sendResponse({ ok: true, ungrouped: n });
          break;
        }
        case 'close-grouped': {
          const r = await closeGroupedTabs();
          sendResponse({ ok: true, ...r });
          break;
        }
        case 'ungroup-nest': {
          const n = await ungroupNest(msg.categoryId);
          sendResponse({ ok: true, ungrouped: n });
          break;
        }
        case 'close-nest': {
          const r = await closeNest(msg.categoryId);
          sendResponse({ ok: true, ...r });
          break;
        }
        case 'refresh-account': {
          const status = await refreshStatus();
          sendResponse({ ok: true, status });
          break;
        }
        case 'sign-up': {
          const r = await signUp(msg.email);
          sendResponse(r);
          break;
        }
        case 'verify-code': {
          const r = await verifyCode(msg.email, msg.code);
          sendResponse(r);
          break;
        }
        case 'sign-out': {
          await signOut();
          sendResponse({ ok: true });
          break;
        }
        case 'switch-account': {
          const r = await switchAccount(msg.newEmail);
          sendResponse(r);
          break;
        }
        case 'apply-open-mode': {
          await applyOpenMode(msg.mode);
          sendResponse({ ok: true });
          break;
        }
        default:
          sendResponse({ ok: false, error: 'unknown' });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
  })();
  return true;
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'open-dashboard' || command === 'focus-search') {
    await openDashboard();
  }
});

async function openDashboard() {
  const url = chrome.runtime.getURL('dashboard.html');
  const existing = await chrome.tabs.query({ url });
  if (existing.length > 0) {
    await chrome.tabs.update(existing[0].id, { active: true });
    await chrome.windows.update(existing[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
}

// Tab operations ---------------------------------------------------------------

async function dedupeTabs() {
  const tabs = await chrome.tabs.query({});
  // Sort so the active tab (per window) is considered first, then by lastAccessed if available.
  tabs.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return (b.lastAccessed || 0) - (a.lastAccessed || 0);
  });
  const seen = new Map();
  const toClose = [];
  const restorable = [];
  for (const t of tabs) {
    if (!t.url || t.pinned) continue;
    const key = t.url.split('#')[0];
    if (seen.has(key)) {
      toClose.push(t.id);
      restorable.push({ url: t.url, title: t.title, pinned: t.pinned, windowId: t.windowId });
    } else {
      seen.set(key, t.id);
    }
  }
  if (toClose.length) await chrome.tabs.remove(toClose);
  if (toClose.length) await bump('duplicatesRemoved', toClose.length);
  return { removed: toClose.length, restorable };
}

async function ungroupNest(categoryId) {
  const tabs = await chrome.tabs.query({});
  const ids = tabs
    .filter(t => t.groupId !== undefined && t.groupId !== -1)
    .filter(t => categorizeTab(t).id === categoryId)
    .map(t => t.id);
  if (ids.length === 0) return 0;
  try {
    await chrome.tabs.ungroup(ids);
  } catch {
    for (const id of ids) { try { await chrome.tabs.ungroup(id); } catch {} }
  }
  return ids.length;
}

async function closeNest(categoryId) {
  const tabs = await chrome.tabs.query({});
  const target = tabs
    .filter(t => t.groupId !== undefined && t.groupId !== -1)
    .filter(t => !t.pinned && !t.active)
    .filter(t => categorizeTab(t).id === categoryId);
  const ids = target.map(t => t.id);
  const restorable = target.map(t => ({ url: t.url, title: t.title, pinned: t.pinned, windowId: t.windowId }));
  if (ids.length === 0) return { closed: 0, restorable: [] };
  await chrome.tabs.remove(ids);
  return { closed: ids.length, restorable };
}

async function ungroupAllTabs() {
  const tabs = await chrome.tabs.query({});
  const ids = tabs.filter(t => t.groupId !== undefined && t.groupId !== -1).map(t => t.id);
  if (ids.length === 0) return 0;
  try {
    await chrome.tabs.ungroup(ids);
  } catch (e) {
    // Some tabs may belong to groups in other windows; ungroup per-tab as fallback.
    for (const id of ids) {
      try { await chrome.tabs.ungroup(id); } catch {}
    }
  }
  return ids.length;
}

async function closeGroupedTabs() {
  const tabs = await chrome.tabs.query({});
  const target = tabs.filter(t => t.groupId !== undefined && t.groupId !== -1 && !t.pinned && !t.active);
  const ids = target.map(t => t.id);
  const restorable = target.map(t => ({ url: t.url, title: t.title, pinned: t.pinned, windowId: t.windowId }));
  if (ids.length === 0) return { closed: 0, restorable: [] };
  await chrome.tabs.remove(ids);
  return { closed: ids.length, restorable };
}

async function runSmartCleanup(options) {
  const tabs = await chrome.tabs.query({});
  const settings = await getHibSettings();

  // 1. Find duplicates
  tabs.sort((a, b) => (a.active === b.active ? 0 : a.active ? -1 : 1));
  const seen = new Map();
  const dupes = [];
  for (const t of tabs) {
    if (!t.url || t.pinned || t.url.startsWith('chrome://')) continue;
    const key = t.url.split('#')[0];
    if (seen.has(key)) dupes.push(t.id);
    else seen.set(key, t.id);
  }

  // 2. Find stale (untouched > N hours)
  const { tabStamps = {} } = await chrome.storage.local.get('tabStamps');
  const staleHours = options.staleHours || 48;
  const staleCutoff = Date.now() - staleHours * 60 * 60 * 1000;
  const stale = [];
  for (const t of tabs) {
    if (!t.url || t.pinned || t.active) continue;
    if (t.url.startsWith('chrome://')) continue;
    if (dupes.includes(t.id)) continue;
    const stamp = tabStamps[t.id] || t.lastAccessed || 0;
    if (stamp && stamp < staleCutoff) stale.push(t.id);
  }

  // 3. Find hibernation candidates (>= 30min idle, not active/pinned/discarded)
  const hibCutoff = Date.now() - settings.afterMinutes * 60 * 1000;
  const hibCandidates = [];
  for (const t of tabs) {
    if (t.discarded || t.active || t.pinned) continue;
    if (!t.url || t.url.startsWith('chrome://') || t.url.startsWith('chrome-extension://')) continue;
    if (dupes.includes(t.id) || stale.includes(t.id)) continue;
    if (settings.skipPlayingAudio && t.audible) continue;
    const stamp = tabStamps[t.id] || t.lastAccessed || 0;
    if (stamp && stamp < hibCutoff) hibCandidates.push(t.id);
  }

  const totalMbSaved =
    dupes.length * AVG_TAB_RAM_MB +
    stale.length * AVG_TAB_RAM_MB +
    hibCandidates.length * AVG_TAB_RAM_MB;

  if (options.dryRun) {
    return {
      dupes: dupes.length,
      stale: stale.length,
      hibernate: hibCandidates.length,
      mbSaved: totalMbSaved
    };
  }

  // Apply
  if (dupes.length) await chrome.tabs.remove(dupes);
  if (stale.length) await chrome.tabs.remove(stale);
  let hibernated = 0;
  for (const id of hibCandidates) {
    try { await chrome.tabs.discard(id); hibernated++; } catch {}
  }
  if (dupes.length) await bump('duplicatesRemoved', dupes.length);
  if (hibernated) {
    await recordHibernation(hibernated);
    await bump('hibernated', hibernated);
  }
  return {
    dupes: dupes.length,
    stale: stale.length,
    hibernate: hibernated,
    mbSaved: totalMbSaved
  };
}

async function closeStaleTabs(hours) {
  const { tabStamps = {} } = await chrome.storage.local.get('tabStamps');
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  const tabs = await chrome.tabs.query({});
  const toClose = [];
  const restorable = [];
  for (const t of tabs) {
    if (t.pinned || t.active) continue;
    const stamp = tabStamps[t.id] || 0;
    if (stamp && stamp < cutoff) {
      toClose.push(t.id);
      restorable.push({ url: t.url, title: t.title, pinned: t.pinned, windowId: t.windowId });
    }
  }
  if (toClose.length) await chrome.tabs.remove(toClose);
  return { closed: toClose.length, restorable };
}

// Workspaces -------------------------------------------------------------------

async function saveWorkspace(name) {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const snapshot = tabs
    .filter(t => t.url && !t.url.startsWith('chrome://'))
    .map(t => ({ url: t.url, title: t.title, pinned: t.pinned }));
  const { workspaces = [] } = await chrome.storage.local.get('workspaces');
  workspaces.unshift({
    id: `${Date.now()}`,
    name: name || `Nest ${new Date().toLocaleString()}`,
    createdAt: Date.now(),
    tabs: snapshot
  });
  await chrome.storage.local.set({ workspaces: workspaces.slice(0, 50) });
}

async function openWorkspace(id, replace = false) {
  const { workspaces = [] } = await chrome.storage.local.get('workspaces');
  const ws = workspaces.find(w => w.id === id);
  if (!ws) return;
  const window = await chrome.windows.create({ focused: true });
  const blank = (await chrome.tabs.query({ windowId: window.id }))[0];
  for (const tab of ws.tabs) {
    await chrome.tabs.create({ windowId: window.id, url: tab.url, pinned: tab.pinned });
  }
  if (blank) await chrome.tabs.remove(blank.id);
  if (replace) {
    // close other normal windows
    const all = await chrome.windows.getAll();
    for (const w of all) {
      if (w.id !== window.id && w.type === 'normal') {
        await chrome.windows.remove(w.id);
      }
    }
  }
}

async function deleteWorkspace(id) {
  const { workspaces = [] } = await chrome.storage.local.get('workspaces');
  await chrome.storage.local.set({ workspaces: workspaces.filter(w => w.id !== id) });
}
