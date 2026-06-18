// TabNest Recently Closed Archive — track every closed tab for 30 days so the
// user can find that thing they accidentally closed.
// Pro-only feature; free users see the section but it's locked at 5 entries.

const ARCHIVE_KEY = 'closedTabs';
const ARCHIVE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const ARCHIVE_MAX = 500;
const FREE_VISIBLE = 5;

async function getArchive() {
  const s = await chrome.storage.local.get(ARCHIVE_KEY);
  const list = s[ARCHIVE_KEY] || [];
  const cutoff = Date.now() - ARCHIVE_TTL_MS;
  return list.filter(e => e.closedAt > cutoff);
}

async function recordClose(tab) {
  if (!tab || !tab.url) return;
  if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) return;
  const list = await getArchive();
  list.unshift({
    url: tab.url,
    title: tab.title || tab.url,
    favIconUrl: tab.favIconUrl || null,
    closedAt: Date.now(),
    windowId: tab.windowId || null
  });
  const trimmed = list.slice(0, ARCHIVE_MAX);
  await chrome.storage.local.set({ [ARCHIVE_KEY]: trimmed });
}

async function clearArchive() {
  await chrome.storage.local.set({ [ARCHIVE_KEY]: [] });
}

async function deleteFromArchive(url, closedAt) {
  const list = await getArchive();
  const filtered = list.filter(e => !(e.url === url && e.closedAt === closedAt));
  await chrome.storage.local.set({ [ARCHIVE_KEY]: filtered });
}

function freeVisibleLimit() { return FREE_VISIBLE; }

if (typeof module !== 'undefined') {
  module.exports = { getArchive, recordClose, clearArchive, deleteFromArchive, freeVisibleLimit };
}
