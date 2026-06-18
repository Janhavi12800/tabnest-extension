// TabNest tab notes — keyed by normalized URL so notes survive tab restarts.

const NOTES_KEY = 'tabNotes';

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    u.search = ''; // keep notes attached to a page even if query params change
    let s = u.toString();
    if (s.endsWith('/')) s = s.slice(0, -1);
    return s;
  } catch {
    return url || '';
  }
}

async function getAllNotes() {
  try {
    const r = await chrome.storage.local.get(NOTES_KEY);
    return r[NOTES_KEY] || {};
  } catch {
    return {};
  }
}

async function getNote(url) {
  const all = await getAllNotes();
  return all[normalizeUrl(url)] || null;
}

async function setNote(url, note) {
  const all = await getAllNotes();
  const key = normalizeUrl(url);
  if (note && note.trim()) {
    all[key] = { text: note.trim(), updatedAt: Date.now() };
  } else {
    delete all[key];
  }
  await chrome.storage.local.set({ [NOTES_KEY]: all });
}

async function deleteNote(url) {
  await setNote(url, '');
}

async function countNotes() {
  const all = await getAllNotes();
  return Object.keys(all).length;
}

if (typeof module !== 'undefined') {
  module.exports = { getAllNotes, getNote, setNote, deleteNote, countNotes, normalizeUrl };
}
