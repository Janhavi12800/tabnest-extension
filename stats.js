// TabNest Stats — daily/weekly tracking of tab activity.
// Tracks: tabs created, closed, hibernated, focus sessions completed,
// minutes per nest (by category id).
// Pro-only display; free users see a teaser card with last-7-day summary blurred.

const STATS_KEY = 'stats_state';

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

async function getStats() {
  const s = await chrome.storage.local.get(STATS_KEY);
  return s[STATS_KEY] || { byDay: {}, byCategory: {}, lifetime: { tabsOpened: 0, tabsClosed: 0, focusSessions: 0 } };
}

async function bump(field, n = 1) {
  const stats = await getStats();
  const day = todayKey();
  if (!stats.byDay[day]) stats.byDay[day] = { tabsOpened: 0, tabsClosed: 0, hibernated: 0, focusSessions: 0, duplicatesRemoved: 0 };
  stats.byDay[day][field] = (stats.byDay[day][field] || 0) + n;
  if (stats.lifetime[field] !== undefined) stats.lifetime[field] += n;
  // Prune older than 60 days
  const cutoff = Date.now() - 60 * 24 * 60 * 60 * 1000;
  for (const d of Object.keys(stats.byDay)) {
    const ts = new Date(d).getTime();
    if (ts < cutoff) delete stats.byDay[d];
  }
  await chrome.storage.local.set({ [STATS_KEY]: stats });
}

async function bumpCategory(catId, mins) {
  const stats = await getStats();
  stats.byCategory[catId] = (stats.byCategory[catId] || 0) + mins;
  await chrome.storage.local.set({ [STATS_KEY]: stats });
}

async function getToday() {
  const stats = await getStats();
  return stats.byDay[todayKey()] || { tabsOpened: 0, tabsClosed: 0, hibernated: 0, focusSessions: 0, duplicatesRemoved: 0 };
}

async function getLast7Days() {
  const stats = await getStats();
  let opened = 0, closed = 0, hib = 0, focus = 0, dupes = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const day = stats.byDay[key];
    if (!day) continue;
    opened += day.tabsOpened || 0;
    closed += day.tabsClosed || 0;
    hib += day.hibernated || 0;
    focus += day.focusSessions || 0;
    dupes += day.duplicatesRemoved || 0;
  }
  return { opened, closed, hibernated: hib, focusSessions: focus, duplicatesRemoved: dupes };
}

async function topCategoriesAllTime(limit = 5) {
  const stats = await getStats();
  return Object.entries(stats.byCategory)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, mins]) => ({ id, mins }));
}

async function resetStats() {
  await chrome.storage.local.set({ [STATS_KEY]: { byDay: {}, byCategory: {}, lifetime: { tabsOpened: 0, tabsClosed: 0, focusSessions: 0 } } });
}

if (typeof module !== 'undefined') {
  module.exports = { getStats, bump, bumpCategory, getToday, getLast7Days, topCategoriesAllTime, resetStats };
}
