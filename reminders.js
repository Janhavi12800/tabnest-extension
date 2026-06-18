// TabNest Tab Reminders — set a future reminder on any tab. When it fires:
//   - chrome notification with the tab title + "Open" action
//   - if the tab was closed in the meantime, re-open it
// Pro-only.

const REM_KEY = 'reminders';

async function getReminders() {
  const s = await chrome.storage.local.get(REM_KEY);
  return s[REM_KEY] || [];
}

async function setReminders(list) {
  await chrome.storage.local.set({ [REM_KEY]: list });
}

async function addReminder({ url, title, favIconUrl, fireAt, note }) {
  if (!url || !fireAt) throw new Error('invalid_reminder');
  const list = await getReminders();
  const id = `rem_${Date.now()}_${Math.floor(Math.random() * 9999)}`;
  list.push({ id, url, title: title || url, favIconUrl: favIconUrl || null, fireAt, note: note || '', createdAt: Date.now() });
  await setReminders(list);
  // Schedule the alarm
  if (chrome.alarms) {
    await chrome.alarms.create('reminder:' + id, { when: fireAt });
  }
  return id;
}

async function removeReminder(id) {
  const list = await getReminders();
  await setReminders(list.filter(r => r.id !== id));
  if (chrome.alarms) {
    await chrome.alarms.clear('reminder:' + id);
  }
}

async function getPendingCount() {
  const list = await getReminders();
  return list.filter(r => r.fireAt > Date.now()).length;
}

async function getOverdueReminders() {
  const list = await getReminders();
  return list.filter(r => r.fireAt <= Date.now());
}

if (typeof module !== 'undefined') {
  module.exports = { getReminders, addReminder, removeReminder, getPendingCount, getOverdueReminders };
}
