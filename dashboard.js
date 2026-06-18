// TabNest dashboard logic — full page view

const $ = (s) => document.querySelector(s);

let allTabs = [];
let workspaces = [];
let customNests = [];
let proState = { active: false };
let accountState = { status: 'none' };
let tabNotes = {};
let searchQuery = '';
let focusMode = { active: false, hiddenIds: [], endsAt: null };
let archiveList = [];
let archiveQuery = '';
let activeReminders = [];
let statsTotals = { today: {}, last7: {}, hibState: null };

document.addEventListener('DOMContentLoaded', init);

function setupViewNav() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const view = item.dataset.view;
      showView(view);
    });
  });
}

function showView(name) {
  document.querySelectorAll('.nav-item').forEach(n => {
    n.classList.toggle('active', n.dataset.view === name);
  });
  document.querySelectorAll('.view').forEach(v => {
    if (v.dataset.view === name) v.removeAttribute('hidden');
    else v.setAttribute('hidden', '');
  });
  // Re-render section-specific data when switching to it
  if (name === 'workspaces') renderWorkspaces();
  if (name === 'closed') renderArchive();
  if (name === 'reminders') renderReminders();
  if (name === 'stats') renderMetrics();
}

function updateNavBadges() {
  const groupCount = $('#stat-nests')?.textContent || '0';
  const wsCount = workspaces?.length || 0;
  const closedCount = archiveList?.length || 0;
  const remCount = activeReminders?.length || 0;
  const set = (id, val) => {
    const el = $(id);
    if (el) {
      el.textContent = val > 0 ? String(val) : '';
      el.style.display = val > 0 ? '' : 'none';
    }
  };
  set('#nav-count-nests', parseInt(groupCount) || 0);
  set('#nav-count-workspaces', wsCount);
  set('#nav-count-closed', closedCount);
  set('#nav-count-reminders', remCount);
}

async function init() {
  await initTheme();
  setupViewNav();
  accountState = await getAccount();
  proState = await getProState();
  // If the user lands here without ever signing up, send them to onboarding.
  if (accountState.status === 'none' || accountState.status === 'pending') {
    const url = chrome.runtime.getURL('onboarding.html');
    await chrome.tabs.update({ url });
    return;
  }
  await Promise.all([
    loadTabs(),
    loadWorkspaces(),
    loadSettings(),
    loadCustomNests(),
    loadNotes(),
    loadFocus(),
    loadArchive(),
    loadReminders(),
    loadStats()
  ]);
  renderThemePicker();
  renderCustomNests();
  renderProStatus();
  renderMetrics();
  renderArchive();
  renderReminders();
  renderAccessState();
  updateNavBadges();
  setupListeners();
  setupTour();
  maybeStartTour();
  // Periodic trial countdown refresh
  setInterval(renderAccessState, 60 * 1000);
  // Background status refresh every 5 min
  setInterval(async () => {
    const newStatus = await refreshStatus();
    if (newStatus !== accountState.status) {
      accountState = await getAccount();
      proState = await getProState();
      renderAccessState();
      renderProStatus();
    }
  }, 5 * 60 * 1000);
  setInterval(async () => {
    renderFocusUI();
    if (focusMode.active && focusMode.endsAt && focusMode.endsAt < Date.now()) {
      focusMode = { active: false, hiddenIds: [], endsAt: null };
      await chrome.storage.local.set({ focusMode });
      renderFocusUI();
      renderNests();
      await bump('focusSessions');
      await loadStats();
      renderMetrics();
      toast('🍃 Focus session complete — well done!');
    }
  }, 1000);
  setInterval(async () => {
    await loadStats();
    renderMetrics();
    updateNavBadges();
  }, 30000);
  $('#search').focus();
}

async function loadArchive() {
  archiveList = await getArchive();
}

async function loadReminders() {
  activeReminders = (await getReminders()).filter(r => r.fireAt > Date.now())
    .sort((a, b) => a.fireAt - b.fireAt);
}

async function loadStats() {
  statsTotals.today = await getToday();
  statsTotals.last7 = await getLast7Days();
  statsTotals.hibState = await getHibState();
}

function renderMetrics() {
  if (!$('#metric-ram')) return;
  const hibCard = $('#metric-ram').closest('.metric-card');
  if (proState.active) {
    const mb = statsTotals.hibState?.lifetime?.mb || 0;
    $('#metric-ram').textContent = formatMb(mb || 0);
    $('#metric-ram-sub').textContent = `${statsTotals.hibState?.lifetime?.count || 0} tabs hibernated · running in background`;
    hibCard?.classList.remove('locked');
  } else {
    $('#metric-ram').textContent = '— MB';
    $('#metric-ram-sub').innerHTML = '<span style="color:var(--brown-primary);font-weight:700">🔒 Pro</span> — Tab hibernation saves GBs of RAM automatically';
    hibCard?.classList.add('locked');
  }
  $('#metric-today-tabs').textContent = String(statsTotals.today?.tabsOpened || 0);
  $('#metric-today-dupes').textContent = String(statsTotals.last7?.duplicatesRemoved || 0);
  $('#metric-focus').textContent = String(statsTotals.last7?.focusSessions || 0);
}

function renderArchive() {
  const list = $('#archive-list');
  const locked = $('#archive-locked');
  if (!list) return;
  const filtered = archiveQuery
    ? archiveList.filter(e =>
        (e.title || '').toLowerCase().includes(archiveQuery) ||
        (e.url || '').toLowerCase().includes(archiveQuery))
    : archiveList;
  const visible = proState.active ? filtered : filtered.slice(0, freeVisibleLimit());

  list.innerHTML = '';
  if (visible.length === 0) {
    list.innerHTML = `
      <div class="archive-empty">
        <div class="big">🔍</div>
        <div class="empty-title">${archiveQuery ? `No closed tabs match "${escapeHtml(archiveQuery)}"` : 'Nothing closed yet'}</div>
        <div class="empty-sub">${archiveQuery ? 'Try a different word.' : 'Tabs you close will appear here for 30 days — searchable, restorable in one click.'}</div>
      </div>`;
  } else {
    for (const e of visible) {
      const item = document.createElement('div');
      item.className = 'archive-item';
      const ago = timeAgo(e.closedAt);
      const fav = e.favIconUrl ? `<img class="archive-fav" src="${escapeAttr(e.favIconUrl)}" />` : '<div class="archive-fav"></div>';
      item.innerHTML = `
        ${fav}
        <div class="archive-info">
          <div class="archive-title">${escapeHtml(e.title || e.url)}</div>
          <div class="archive-meta">${escapeHtml(getHostname(e.url) || 'unknown')} · ${ago}</div>
        </div>
        <div class="archive-actions">
          <button data-action="open" title="Reopen">↗</button>
          <button data-action="delete" class="delete" title="Remove">✕</button>
        </div>
      `;
      item.querySelector('[data-action="open"]')?.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        await chrome.runtime.sendMessage({ type: 'reopen-closed', url: e.url });
        await deleteFromArchive(e.url, e.closedAt);
        await loadArchive();
        renderArchive();
        toast('Reopened 🪶');
      });
      item.querySelector('[data-action="delete"]')?.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        await deleteFromArchive(e.url, e.closedAt);
        await loadArchive();
        renderArchive();
      });
      item.addEventListener('click', async () => {
        await chrome.runtime.sendMessage({ type: 'reopen-closed', url: e.url });
        await deleteFromArchive(e.url, e.closedAt);
        await loadArchive();
        renderArchive();
        toast('Reopened 🪶');
      });
      item.querySelector('img.archive-fav')?.addEventListener('error', (ev) => {
        ev.target.outerHTML = '<div class="archive-fav"></div>';
      });
      list.appendChild(item);
    }
  }
  $('#archive-meta').textContent = `${archiveList.length} tracked`;
  if (locked) {
    locked.style.display = (proState.active || archiveList.length <= freeVisibleLimit()) ? 'none' : 'flex';
  }
}

function renderReminders() {
  const sec = $('#reminders-section');
  const list = $('#reminders-list');
  if (!sec || !list) return;
  if (activeReminders.length === 0) {
    sec.style.display = 'none';
    return;
  }
  sec.style.display = '';
  $('#reminders-meta').textContent = `${activeReminders.length} active`;
  list.innerHTML = '';
  for (const r of activeReminders) {
    const item = document.createElement('div');
    item.className = 'reminder-item';
    item.innerHTML = `
      <div class="reminder-icon">🔔</div>
      <div class="reminder-info">
        <div class="reminder-title">${escapeHtml(r.title)}</div>
        <div class="reminder-time">${formatFireAt(r.fireAt)} · ${escapeHtml(getHostname(r.url) || '')}</div>
      </div>
      <button class="reminder-cancel">Cancel</button>
    `;
    item.querySelector('.reminder-cancel')?.addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ type: 'remove-reminder', id: r.id });
      await loadReminders();
      renderReminders();
      toast('Reminder cancelled');
    });
    list.appendChild(item);
  }
}

function timeAgo(ts) {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

function formatFireAt(ts) {
  const ms = ts - Date.now();
  if (ms <= 0) return 'now';
  const min = Math.floor(ms / 60000);
  if (min < 60) return `in ${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `in ${hr}h ${min % 60}m`;
  const d = Math.floor(hr / 24);
  return `in ${d}d`;
}

async function loadCustomNests() {
  const stored = await chrome.storage.local.get('customNests');
  customNests = stored.customNests || [];
  if (typeof setCustomNests === 'function') setCustomNests(customNests);
}

async function loadNotes() {
  tabNotes = await getAllNotes();
}

async function loadFocus() {
  const stored = await chrome.storage.local.get('focusMode');
  focusMode = stored.focusMode || { active: false, hiddenIds: [], endsAt: null };
  if (focusMode.active && focusMode.endsAt && focusMode.endsAt < Date.now()) {
    focusMode = { active: false, hiddenIds: [], endsAt: null };
    await chrome.storage.local.set({ focusMode });
  }
  renderFocusUI();
}

function renderFocusUI() {
  const banner = $('#focus-banner');
  if (!banner) return;
  if (!focusMode.active) {
    banner.classList.remove('show');
    return;
  }
  banner.classList.add('show');
  const remaining = focusMode.endsAt ? Math.max(0, focusMode.endsAt - Date.now()) : 0;
  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  const hiddenNames = focusMode.hiddenIds.map(id => {
    const all = [...CATEGORIES, OTHER_CATEGORY, ...customNests];
    const c = all.find(x => x.id === id);
    return c ? `${c.icon} ${c.name}` : id;
  }).join(' · ');
  $('#focus-banner-text').innerHTML = `
    <strong>🎯 Focus mode</strong> — hiding ${hiddenNames || 'nothing'}
    ${focusMode.endsAt ? `<span class="focus-timer">${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}</span>` : ''}
  `;
}

function renderAccessState() {
  const banner = $('#trial-banner');
  const overlay = $('#locked-overlay');
  if (!banner || !overlay) return;

  if (accountState.status === 'trial') {
    overlay.classList.remove('show');
    const left = (accountState.trialEnd || 0) - Date.now();
    if (left <= 0) {
      // Trial flipped to expired — refresh state
      (async () => {
        await refreshStatus();
        accountState = await getAccount();
        proState = await getProState();
        renderAccessState();
        renderProStatus();
      })();
      return;
    }
    const days = Math.floor(left / (24 * 60 * 60 * 1000));
    const hours = Math.floor((left % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    const mins = Math.floor((left % (60 * 60 * 1000)) / (60 * 1000));
    let headline = 'Free trial active';
    let sub;
    if (days >= 1) sub = `${days} day${days === 1 ? '' : 's'} ${hours}h left · all features unlocked`;
    else if (hours >= 1) sub = `${hours}h ${mins}m left · all features unlocked`;
    else sub = `${mins} min left · subscribe before it ends!`;
    $('#trial-headline').textContent = headline;
    $('#trial-sub').textContent = sub;
    banner.classList.toggle('urgent', left < 24 * 60 * 60 * 1000);
    banner.classList.add('show');
    return;
  }

  banner.classList.remove('show', 'urgent');

  if (accountState.status === 'expired' || accountState.status === 'none') {
    overlay.classList.add('show');
  } else {
    overlay.classList.remove('show');
  }
}

function renderProStatus() {
  const status = $('#pro-status');
  const cta = $('#pro-cta');
  const key = $('#pro-key');
  const heroBadge = $('#hero-pro-badge');
  if (!status) return;
  const email = escapeHtml(accountState.email || 'your email');

  if (accountState.status === 'pro') {
    status.classList.add('active');
    status.innerHTML = `<span>✨</span> <span>Pro active · signed in as <strong>${email}</strong></span>`;
    cta.style.display = 'none';
    key.textContent = 'Sign out';
    if (heroBadge) heroBadge.style.display = '';
  } else if (accountState.status === 'trial') {
    status.classList.add('active');
    const left = (accountState.trialEnd || 0) - Date.now();
    const days = Math.max(0, Math.ceil(left / (24 * 60 * 60 * 1000)));
    status.innerHTML = `<span>🎁</span> <span>Trial active · ${days} day${days === 1 ? '' : 's'} left · ${email}</span>`;
    cta.style.display = '';
    cta.querySelector('.pro-cta-text').textContent = 'Subscribe before trial ends';
    key.textContent = 'Sign out';
    if (heroBadge) heroBadge.style.display = 'none';
  } else {
    status.classList.remove('active');
    status.innerHTML = '<span>🪶</span> <span>Trial ended — subscribe to keep using TabNest.</span>';
    cta.style.display = '';
    key.textContent = 'Already paid? Sign in';
    if (heroBadge) heroBadge.style.display = 'none';
  }
}

function renderThemePicker() {
  const grid = $('#theme-grid');
  if (!grid) return;
  const current = document.documentElement.getAttribute('data-theme') || 'forest';
  grid.innerHTML = '';
  for (const t of THEMES) {
    const isLocked = t.id !== 'forest' && !proState.active;
    const card = document.createElement('div');
    card.className = 'theme-card' + (t.id === current ? ' active' : '') + (isLocked ? ' locked' : '');
    card.innerHTML = `
      <div class="theme-head">
        <div class="theme-icon">${t.icon}</div>
        <div class="theme-name">${t.name}</div>
        ${isLocked ? '<div class="theme-lock">🔒 Pro</div>' : ''}
      </div>
      <div class="theme-desc">${t.description}</div>
      <div class="theme-swatches">
        ${t.swatch.map(c => `<div class="theme-swatch" style="background:${c}"></div>`).join('')}
      </div>
    `;
    card.addEventListener('click', async () => {
      if (isLocked) {
        toast('🔒 Unlock TabNest Pro to use this theme');
        document.querySelector('.pro-section').scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      applyTheme(t.id);
      await saveTheme(t.id);
      renderThemePicker();
      toast(`Theme: ${t.name} ${t.icon}`);
    });
    grid.appendChild(card);
  }
}

function renderCustomNests() {
  const list = $('#custom-nests');
  const addBtn = $('#add-nest-btn');
  if (!list) return;
  list.innerHTML = '';
  if (customNests.length === 0) {
    list.innerHTML = `
      <div class="empty-row" style="padding:12px">
        <div class="empty-row-emoji" style="font-size:22px">🎯</div>
        <div>
          <div class="empty-title" style="font-size:13px">No custom nests yet</div>
          <div class="empty-sub" style="font-size:11px">Make your own categories — "Side project", "Recipes", whatever you organise by.</div>
        </div>
      </div>`;
  } else {
    for (const n of customNests) {
      const row = document.createElement('div');
      row.className = 'custom-nest-row';
      row.innerHTML = `
        <div class="custom-nest-icon" style="background:${hexAlpha(n.color || '#8B6F47', 0.18)};color:${n.color || '#8B6F47'}">${n.icon || '🪶'}</div>
        <div class="custom-nest-info">
          <div class="custom-nest-name">${escapeHtml(n.name)}</div>
          <div class="custom-nest-meta">${(n.domains || []).length} domain${n.domains?.length === 1 ? '' : 's'}${(n.keywords || []).length ? ` · ${n.keywords.length} keyword${n.keywords.length === 1 ? '' : 's'}` : ''}</div>
        </div>
        <div class="custom-nest-actions">
          <button class="cn-icon-btn" data-action="edit" data-id="${n.id}" title="Edit">✎</button>
          <button class="cn-icon-btn danger" data-action="delete" data-id="${n.id}" title="Delete">✕</button>
        </div>
      `;
      row.querySelector('[data-action="edit"]')?.addEventListener('click', () => openCustomNestEditor(n));
      row.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
        const ok = await confirmModal('Delete this nest?', `"${n.name}" will be removed.`);
        if (!ok) return;
        customNests = customNests.filter(x => x.id !== n.id);
        await chrome.storage.local.set({ customNests });
        if (typeof setCustomNests === 'function') setCustomNests(customNests);
        renderCustomNests();
        await loadTabs();
        toast('Nest removed');
      });
      list.appendChild(row);
    }
  }
  if (addBtn) {
    const free = customNests.length;
    const limit = proState.active ? Infinity : 1;
    if (free >= limit && !proState.active) {
      addBtn.innerHTML = '🔒 Add more nests with Pro';
      addBtn.onclick = () => {
        toast('🔒 Free version supports 1 custom nest. Unlock Pro for unlimited.');
        document.querySelector('.pro-section').scrollIntoView({ behavior: 'smooth', block: 'center' });
      };
    } else {
      addBtn.innerHTML = '＋ Add a nest';
      addBtn.onclick = () => openCustomNestEditor(null);
    }
  }
}

async function openCustomNestEditor(existing) {
  const data = await customNestModal(existing);
  if (!data) return;
  if (existing) {
    customNests = customNests.map(n => n.id === existing.id ? { ...n, ...data } : n);
  } else {
    customNests.push({ id: `cn_${Date.now()}`, ...data });
  }
  await chrome.storage.local.set({ customNests });
  if (typeof setCustomNests === 'function') setCustomNests(customNests);
  renderCustomNests();
  await loadTabs();
  toast(existing ? 'Nest updated 🪺' : 'Nest created 🪺');
}

async function loadTabs() {
  try {
    allTabs = await chrome.tabs.query({});
  } catch {
    allTabs = [];
  }
  renderNests();
  updateStats();
}

async function loadWorkspaces() {
  const stored = await chrome.storage.local.get('workspaces');
  workspaces = stored.workspaces || [];
  renderWorkspaces();
  updateStats();
}

async function loadSettings() {
  const stored = await chrome.storage.local.get('settings');
  const s = stored.settings || {};
  const autoGroup = s.autoGroup !== false;
  $('#set-autogroup').checked = autoGroup;
  $('#set-onupdate').checked = s.groupOnUpdate !== false;
  $('#set-stale').value = String(s.staleAfterHours || 24);
  if ($('#set-pause')) $('#set-pause').checked = !autoGroup;
  if ($('#set-openas')) $('#set-openas').value = s.openAs || 'popup';
}

async function saveSetting(key, value) {
  const stored = await chrome.storage.local.get('settings');
  const settings = stored.settings || {};
  settings[key] = value;
  await chrome.storage.local.set({ settings });
}

function updateStats() {
  $('#stat-tabs').textContent = allTabs.length;
  const groups = new Set(allTabs.map(t => categorizeTab(t).id));
  $('#stat-nests').textContent = groups.size;
  const wins = new Set(allTabs.map(t => t.windowId));
  $('#stat-windows').textContent = wins.size;
  $('#stat-workspaces').textContent = workspaces.length;
  $('#workspaces-meta').textContent = `${workspaces.length} saved`;
}

function renderNests() {
  const filtered = (searchQuery
    ? allTabs.filter(t => {
        const q = searchQuery.toLowerCase();
        return (t.title || '').toLowerCase().includes(q) ||
               (t.url || '').toLowerCase().includes(q);
      })
    : allTabs);

  const groups = new Map();
  for (const tab of filtered) {
    const cat = categorizeTab(tab);
    if (!groups.has(cat.id)) groups.set(cat.id, { cat, tabs: [] });
    groups.get(cat.id).tabs.push(tab);
  }

  // Focus mode: hide nests in hiddenIds (unless search is active)
  const hidden = (focusMode.active && !searchQuery) ? new Set(focusMode.hiddenIds) : new Set();
  const sorted = Array.from(groups.values())
    .filter(g => !hidden.has(g.cat.id))
    .sort((a, b) => b.tabs.length - a.tabs.length);

  const grid = $('#nest-grid');
  grid.innerHTML = '';

  $('#nests-meta').textContent = searchQuery
    ? `${filtered.length} match${filtered.length === 1 ? '' : 'es'} across ${groups.size} nest${groups.size === 1 ? '' : 's'}`
    : `${allTabs.length} tabs · ${groups.size} nests`;

  if (sorted.length === 0) {
    if (searchQuery) {
      grid.innerHTML = `
        <div class="empty-state">
          <div class="big">🔎</div>
          <div class="empty-title">No tabs match "${escapeHtml(searchQuery)}"</div>
          <div class="empty-sub">Try a different word, or check your closed-tabs archive below.</div>
          <button class="empty-btn" id="empty-clear-search">Clear search</button>
        </div>
      `;
      grid.querySelector('#empty-clear-search')?.addEventListener('click', () => {
        $('#search').value = '';
        searchQuery = '';
        renderNests();
      });
    } else {
      grid.innerHTML = `
        <div class="empty-state">
          <div class="big">🪶</div>
          <div class="empty-title">Your nest is empty</div>
          <div class="empty-sub">Open a few tabs and they'll auto-organise here.</div>
          <button class="empty-btn" id="empty-new-tab">Open a new tab</button>
        </div>
      `;
      grid.querySelector('#empty-new-tab')?.addEventListener('click', async () => {
        await chrome.tabs.create({ url: 'chrome://newtab' });
      });
    }
    return;
  }

  for (const { cat, tabs } of sorted) {
    const card = document.createElement('div');
    card.className = 'nest-card';
    card.innerHTML = `
      <div class="nest-card-head">
        <div class="nest-card-icon" style="background:${hexAlpha(cat.color, 0.18)};color:${cat.color}">${cat.icon}</div>
        <div class="nest-card-title">
          <div class="nest-card-name">${cat.name}</div>
          <div class="nest-card-count">${tabs.length} tab${tabs.length === 1 ? '' : 's'}</div>
        </div>
        <div class="nest-card-actions">
          <button class="nest-action-btn" data-action="ungroup-nest" data-cat="${cat.id}" title="Ungroup this nest — tabs stay open">📤</button>
          <button class="nest-action-btn danger" data-action="close-nest" data-cat="${cat.id}" title="Close all tabs in this nest">✕</button>
        </div>
      </div>
      <div class="nest-card-body">
        ${tabs.map(t => {
          const note = tabNotes[normalizeUrl(t.url || '')];
          return `
          <div class="nest-tab${t.active ? ' active' : ''}${note ? ' has-note' : ''}" data-id="${t.id}" data-url="${escapeAttr(t.url || '')}">
            <img class="nest-tab-favicon" src="${t.favIconUrl ? escapeAttr(t.favIconUrl) : 'icons/icon16.png'}" />
            <div class="nest-tab-info">
              <div class="nest-tab-title">${escapeHtml(t.title || 'Untitled')}</div>
              <div class="nest-tab-host">${escapeHtml(getHostname(t.url || '') || 'unknown')}</div>
              ${note ? `<div class="nest-tab-note">📝 ${escapeHtml(note.text)}</div>` : ''}
            </div>
            <button class="nest-tab-remind" data-id="${t.id}" title="Set reminder">⏰</button>
            <button class="nest-tab-note-btn" data-url="${escapeAttr(t.url || '')}" title="${note ? 'Edit note' : 'Add note'}">${note ? '📝' : '📋'}</button>
            <button class="nest-tab-close" data-id="${t.id}" title="Close tab">✕</button>
          </div>
        `;
        }).join('')}
      </div>
    `;

    card.querySelectorAll('.nest-tab').forEach(item => {
      item.addEventListener('click', async (e) => {
        if (e.target.closest('.nest-tab-close') || e.target.closest('.nest-tab-note-btn')) return;
        const id = parseInt(item.dataset.id);
        const tab = await chrome.tabs.get(id);
        await chrome.tabs.update(id, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
      });
    });

    card.querySelectorAll('.nest-tab-close').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.id);
        await chrome.tabs.remove(id);
        await loadTabs();
      });
    });

    card.querySelectorAll('.nest-tab-note-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const url = btn.dataset.url;
        const existing = tabNotes[normalizeUrl(url)];
        const noteCount = Object.keys(tabNotes).length;
        if (!proState.active && !existing && noteCount >= 3) {
          toast('🔒 Free version supports 3 notes. Unlock Pro for unlimited.');
          document.querySelector('.pro-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          $('#drawer').classList.add('show');
          return;
        }
        const note = await noteModal(url, existing?.text || '');
        if (note === undefined) return;
        await setNote(url, note);
        await loadNotes();
        renderNests();
        toast(note ? 'Note saved 📝' : 'Note removed');
      });
    });

    card.querySelectorAll('.nest-tab-remind').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!proState.active) {
          toast('🔒 Tab reminders are a Pro feature.');
          document.querySelector('.pro-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          $('#drawer').classList.add('show');
          return;
        }
        const tabId = parseInt(btn.dataset.id);
        const tab = allTabs.find(t => t.id === tabId);
        if (!tab) return;
        const minutes = await remindModal(tab.title || tab.url);
        if (!minutes) return;
        const fireAt = Date.now() + minutes * 60 * 1000;
        await chrome.runtime.sendMessage({
          type: 'add-reminder',
          payload: { url: tab.url, title: tab.title, favIconUrl: tab.favIconUrl, fireAt }
        });
        await loadReminders();
        renderReminders();
        toast(`Reminder set for ${formatFireAt(fireAt)} 🔔`);
      });
    });

    card.querySelectorAll('.nest-tab-favicon').forEach(img => {
      img.addEventListener('error', () => { img.src = 'icons/icon16.png'; });
    });

    card.querySelector('[data-action="ungroup-nest"]')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const catId = e.currentTarget.dataset.cat;
      const res = await chrome.runtime.sendMessage({ type: 'ungroup-nest', categoryId: catId });
      await loadTabs();
      toast(res?.ungrouped > 0
        ? `📤 Ungrouped ${res.ungrouped} tab${res.ungrouped === 1 ? '' : 's'} from ${cat.name}`
        : 'No tabs to ungroup');
    });

    card.querySelector('[data-action="close-nest"]')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const catId = e.currentTarget.dataset.cat;
      const ok = await confirmModal(
        `Close all tabs in ${cat.name}?`,
        `${tabs.length} tab${tabs.length === 1 ? '' : 's'} will be closed (pinned and active tabs stay).`
      );
      if (!ok) return;
      const res = await chrome.runtime.sendMessage({ type: 'close-nest', categoryId: catId });
      await loadTabs();
      if (res?.closed > 0) {
        toast(
          `✕ Closed ${res.closed} tab${res.closed === 1 ? '' : 's'} from ${cat.name}`,
          { label: 'Undo', onClick: () => restoreTabs(res.restorable) }
        );
      } else {
        toast('No tabs to close');
      }
    });

    grid.appendChild(card);
  }
}

function renderWorkspaces() {
  const row = $('#workspaces-row');
  row.innerHTML = '';
  if (workspaces.length === 0) {
    row.innerHTML = `
      <div class="empty-state-inline">
        <div class="empty-row">
          <div class="empty-row-emoji">🌿</div>
          <div>
            <div class="empty-title">No saved workspaces yet</div>
            <div class="empty-sub">A workspace is a snapshot of all your open tabs — restore them anytime later.</div>
          </div>
          <button class="empty-btn" id="empty-save-ws">Save current tabs</button>
        </div>
      </div>
    `;
    row.querySelector('#empty-save-ws')?.addEventListener('click', () => $('#save-btn')?.click());
    return;
  }
  for (const ws of workspaces) {
    const date = new Date(ws.createdAt);
    const card = document.createElement('div');
    card.className = 'workspace-card';
    const favicons = ws.tabs.slice(0, 12).map(t => {
      const fav = t.favIconUrl ? escapeAttr(t.favIconUrl) : 'icons/icon16.png';
      return `<img class="ws-favicon" src="${fav}" onerror="this.src='icons/icon16.png'" />`;
    }).join('');
    card.innerHTML = `
      <div class="workspace-card-head">
        <div class="workspace-card-icon">🪺</div>
        <div class="workspace-card-info">
          <div class="workspace-card-name">${escapeHtml(ws.name)}</div>
          <div class="workspace-card-meta">${ws.tabs.length} tabs · ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</div>
        </div>
      </div>
      <div class="workspace-card-tabs">${favicons}</div>
      <div class="workspace-card-actions">
        <button class="ws-action open">Open</button>
        <button class="ws-action delete">Delete</button>
      </div>
    `;
    card.querySelector('.ws-action.open')?.addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ type: 'open-workspace', id: ws.id });
      toast(`Opening "${ws.name}"...`);
    });
    card.querySelector('.ws-action.delete')?.addEventListener('click', async () => {
      const ok = await confirmModal('Remove workspace?', `"${ws.name}" will be deleted.`);
      if (!ok) return;
      const wsBackup = JSON.parse(JSON.stringify(ws));
      await chrome.runtime.sendMessage({ type: 'delete-workspace', id: ws.id });
      await loadWorkspaces();
      toast('Workspace removed', { label: 'Undo', onClick: async () => {
        const stored = await chrome.storage.local.get('workspaces');
        const list = stored.workspaces || [];
        list.unshift(wsBackup);
        await chrome.storage.local.set({ workspaces: list });
        await loadWorkspaces();
        toast('Workspace restored 🌿');
      }});
    });
    row.appendChild(card);
  }
}

function setupListeners() {
  $('#search')?.addEventListener('input', (e) => {
    searchQuery = e.target.value.trim();
    renderNests();
  });

  $('#search')?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      $('#search').value = '';
      searchQuery = '';
      renderNests();
    }
    if (e.key === 'Enter') {
      const first = document.querySelector('.nest-tab');
      if (first) first.click();
    }
  });

  $('#regroup-btn')?.addEventListener('click', async () => {
    toast('Re-nesting your tabs...');
    await chrome.runtime.sendMessage({ type: 'regroup-all' });
    await loadTabs();
    setTimeout(() => toast('All cozy now 🪺'), 100);
  });

  $('#dedupe-btn')?.addEventListener('click', async () => {
    const res = await chrome.runtime.sendMessage({ type: 'dedupe' });
    await loadTabs();
    if (res?.removed > 0) {
      toast(
        `Removed ${res.removed} duplicate${res.removed === 1 ? '' : 's'} ✂️`,
        { label: 'Undo', onClick: () => restoreTabs(res.restorable) }
      );
    } else {
      toast('No duplicates 🪶');
    }
  });

  $('#save-btn')?.addEventListener('click', async () => {
    const defaultName = `Nest · ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
    const name = await promptModal('Save your nest', defaultName);
    if (!name) return;
    await chrome.runtime.sendMessage({ type: 'save-workspace', name });
    await loadWorkspaces();
    toast('Workspace saved 🌿');
  });

  $('#stale-btn')?.addEventListener('click', async () => {
    const hours = parseInt($('#set-stale').value || '24');
    const ok = await confirmModal('Sweep stale tabs?', `Close tabs untouched for ${hours} hour${hours === 1 ? '' : 's'} or more.`);
    if (!ok) return;
    const res = await chrome.runtime.sendMessage({ type: 'close-stale', hours });
    await loadTabs();
    if (res?.closed > 0) {
      toast(
        `Swept ${res.closed} stale tab${res.closed === 1 ? '' : 's'} 🍂`,
        { label: 'Undo', onClick: () => restoreTabs(res.restorable) }
      );
    } else {
      toast('Nothing stale here 🪶');
    }
  });

  $('#focus-btn')?.addEventListener('click', async () => {
    if (!proState.active) {
      toast('🔒 Focus mode is a Pro feature.');
      $('#drawer').classList.add('show');
      document.querySelector('.pro-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (focusMode.active) {
      const ok = await confirmModal('End focus mode?', 'All your nests will reappear.');
      if (!ok) return;
      focusMode = { active: false, hiddenIds: [], endsAt: null };
      await chrome.storage.local.set({ focusMode });
      renderFocusUI();
      renderNests();
      toast('Focus ended 🪶');
      return;
    }
    const data = await focusModal();
    if (!data) return;
    const endsAt = data.duration > 0 ? Date.now() + data.duration * 60 * 1000 : null;
    focusMode = { active: true, hiddenIds: data.hiddenIds, endsAt };
    await chrome.storage.local.set({ focusMode });
    renderFocusUI();
    renderNests();
    toast(`Focus on 🎯 — ${data.duration > 0 ? `${data.duration} min` : 'no timer'}`);
  });

  $('#focus-end-btn')?.addEventListener('click', async () => {
    focusMode = { active: false, hiddenIds: [], endsAt: null };
    await chrome.storage.local.set({ focusMode });
    renderFocusUI();
    renderNests();
    toast('Focus ended 🪶');
  });

  $('#smart-cleanup-btn')?.addEventListener('click', async () => {
    if (!proState.active) {
      toast('🔒 Smart Cleanup is a Pro feature.');
      $('#drawer').classList.add('show');
      document.querySelector('.pro-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const dry = await chrome.runtime.sendMessage({ type: 'smart-cleanup', options: { dryRun: true } });
    const total = (dry.dupes || 0) + (dry.stale || 0) + (dry.hibernate || 0);
    if (total === 0) {
      toast('Nothing to clean — your nest is tidy 🪶');
      return;
    }
    const ok = await confirmModal(
      `Smart Cleanup found ${total} tab${total === 1 ? '' : 's'}`,
      `${dry.dupes} duplicate${dry.dupes === 1 ? '' : 's'} · ${dry.stale} stale · ${dry.hibernate} to hibernate. Estimated RAM saved: ~${formatMb(dry.mbSaved)}.`
    );
    if (!ok) return;
    const res = await chrome.runtime.sendMessage({ type: 'smart-cleanup', options: {} });
    await loadTabs();
    await loadStats();
    renderMetrics();
    toast(`Cleaned up ${res.dupes + res.stale + res.hibernate} tabs · saved ~${formatMb(res.mbSaved)} 🧹`);
  });

  $('#hibernate-btn')?.addEventListener('click', async () => {
    if (!proState.active) {
      toast('🔒 Tab hibernation is a Pro feature.');
      $('#drawer').classList.add('show');
      document.querySelector('.pro-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const res = await chrome.runtime.sendMessage({ type: 'hibernate-now' });
    await loadTabs();
    await loadStats();
    renderMetrics();
    toast(res.hibernated > 0
      ? `Hibernated ${res.hibernated} idle tab${res.hibernated === 1 ? '' : 's'} · saved ~${formatMb(res.hibernated * 60)} 🛏️`
      : 'No idle tabs to hibernate yet');
  });

  $('#archive-search')?.addEventListener('input', (e) => {
    archiveQuery = e.target.value.trim().toLowerCase();
    renderArchive();
  });

  $('#archive-unlock-btn')?.addEventListener('click', () => {
    document.querySelector('.pro-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('#drawer').classList.add('show');
  });

  $('#help-btn')?.addEventListener('click', () => $('#help-drawer').classList.add('show'));
  $('#help-drawer-close')?.addEventListener('click', () => $('#help-drawer').classList.remove('show'));
  $('#help-drawer')?.addEventListener('click', (e) => {
    if (e.target.id === 'help-drawer') $('#help-drawer').classList.remove('show');
  });
  $('#help-open-shortcuts')?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });
  $('#help-replay-tour')?.addEventListener('click', () => {
    $('#help-drawer').classList.remove('show');
    setTimeout(() => startTour(), 300);
  });

  // Legacy drawer — kept hidden but may still be referenced. Use optional chaining
  // so missing elements don't crash dashboard.js.
  $('#settings-btn')?.addEventListener('click', () => $('#drawer')?.classList.add('show'));
  $('#drawer-close')?.addEventListener('click', () => $('#drawer')?.classList.remove('show'));
  $('#drawer')?.addEventListener('click', (e) => {
    if (e.target.id === 'drawer') $('#drawer')?.classList.remove('show');
  });

  $('#set-autogroup')?.addEventListener('change', (e) => saveSetting('autoGroup', e.target.checked));
  $('#set-onupdate')?.addEventListener('change', (e) => saveSetting('groupOnUpdate', e.target.checked));
  $('#set-stale')?.addEventListener('change', (e) => saveSetting('staleAfterHours', parseInt(e.target.value)));

  // Open-as mode: popup (default) / side panel / dashboard tab
  $('#set-openas')?.addEventListener('change', async (e) => {
    const mode = e.target.value;
    await saveSetting('openAs', mode);
    await chrome.runtime.sendMessage({ type: 'apply-open-mode', mode });
    toast(mode === 'sidepanel' ? '📐 Side panel mode active — click toolbar icon to test'
        : mode === 'tab' ? '🗂 Full tab mode — click toolbar icon to test'
        : '🪺 Popup mode active');
  });

  // Pause toggle is the inverse of autoGroup — easier mental model for users.
  $('#set-pause')?.addEventListener('change', async (e) => {
    const paused = e.target.checked;
    await saveSetting('autoGroup', !paused);
    $('#set-autogroup').checked = !paused;
    toast(paused ? '⏸️ Auto-grouping paused' : '▶️ Auto-grouping on');
  });

  // Ungroup all — toolbar
  $('#ungroup-btn')?.addEventListener('click', async () => {
    const res = await chrome.runtime.sendMessage({ type: 'ungroup-all' });
    await loadTabs();
    toast(res?.ungrouped > 0
      ? `📤 Pulled ${res.ungrouped} tab${res.ungrouped === 1 ? '' : 's'} out of nests`
      : 'No grouped tabs to ungroup');
  });

  // Ungroup all — settings drawer
  $('#ungroup-all-settings')?.addEventListener('click', async () => {
    const res = await chrome.runtime.sendMessage({ type: 'ungroup-all' });
    await loadTabs();
    toast(res?.ungrouped > 0
      ? `📤 Ungrouped ${res.ungrouped} tab${res.ungrouped === 1 ? '' : 's'}`
      : 'No grouped tabs');
  });

  // Close all grouped tabs — destructive, confirm first, undo available for 6 sec
  $('#close-grouped-settings')?.addEventListener('click', async () => {
    const ok = await confirmModal(
      'Close all grouped tabs?',
      'This will close every tab that\'s in a nest (pinned and active tabs stay).'
    );
    if (!ok) return;
    const res = await chrome.runtime.sendMessage({ type: 'close-grouped' });
    await loadTabs();
    if (res?.closed > 0) {
      toast(
        `🗑 Closed ${res.closed} grouped tab${res.closed === 1 ? '' : 's'}`,
        { label: 'Undo', onClick: () => restoreTabs(res.restorable) }
      );
    } else {
      toast('No grouped tabs to close');
    }
  });

  $('#modal-cancel')?.addEventListener('click', () => closeModal(false));
  $('#modal-ok')?.addEventListener('click', () => closeModal(true));
  $('#modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'modal') closeModal(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if ($('#modal').classList.contains('show')) closeModal(false);
      else if ($('#help-drawer').classList.contains('show')) $('#help-drawer').classList.remove('show');
      else if ($('#drawer').classList.contains('show')) $('#drawer').classList.remove('show');
    }
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT') {
      e.preventDefault();
      $('#search').focus();
    }
    if (e.key === '?' && e.shiftKey && document.activeElement.tagName !== 'INPUT') {
      e.preventDefault();
      $('#help-drawer')?.classList.toggle('show');
    }
  });

  if (chrome.tabs?.onCreated) {
    chrome.tabs.onCreated.addListener(() => loadTabs());
    chrome.tabs.onRemoved.addListener(async () => {
      await loadTabs();
      setTimeout(async () => {
        await loadArchive();
        renderArchive();
      }, 200);
    });
    chrome.tabs.onUpdated.addListener((id, info) => {
      if (info.title || info.url || info.favIconUrl) loadTabs();
    });
    chrome.tabs.onActivated.addListener(() => loadTabs());
  }

  // Trial banner subscribe CTA + locked overlay subscribe CTA
  const openPurchase = async () => {
    const email = accountState.email || '';
    const u = new URL(PURCHASE_URL);
    if (email) u.searchParams.set('email', email);
    u.searchParams.set('from', 'extension');
    await chrome.tabs.create({ url: u.toString() });
    // Start polling — flip to Pro the moment server confirms.
    const paying = $('#locked-paying');
    if (paying) paying.style.display = 'flex';
    startPostPayPolling(async ({ done, status }) => {
      if (status === 'pro') {
        accountState = await getAccount();
        proState = await getProState();
        renderAccessState();
        renderProStatus();
        renderThemePicker();
        renderCustomNests();
        if (paying) paying.style.display = 'none';
        toast('✨ Welcome to TabNest Pro!');
      } else if (done) {
        if (paying) paying.style.display = 'none';
      }
    });
  };

  $('#trial-cta')?.addEventListener('click', openPurchase);
  $('#locked-subscribe-btn')?.addEventListener('click', openPurchase);

  $('#locked-signin-btn')?.addEventListener('click', async () => {
    const creds = await proSigninModal();
    if (!creds) return;
    const res = await verifyCode(creds.email, creds.code);
    if (res.ok) {
      accountState = await getAccount();
      proState = await getProState();
      renderAccessState();
      renderProStatus();
      renderThemePicker();
      renderCustomNests();
      toast('✓ Signed in');
    } else {
      toast(res.error || 'Sign-in failed');
    }
  });

  $('#locked-switch-btn')?.addEventListener('click', async () => {
    const newEmail = await promptModal('Switch to a different email', '');
    if (!newEmail) return;
    const res = await switchAccount(newEmail);
    if (res.ok) {
      accountState = await getAccount();
      toast('Code sent to ' + newEmail);
      const creds = await proSigninModal();
      if (!creds) return;
      const verify = await verifyCode(creds.email, creds.code);
      if (verify.ok) {
        accountState = await getAccount();
        proState = await getProState();
        renderAccessState();
        renderProStatus();
        toast('✓ Switched to ' + newEmail);
      } else {
        toast(verify.error || 'Verify failed');
      }
    } else {
      toast(res.error || 'Switch failed');
    }
  });

  // Pro CTA + license key (in settings drawer)
  $('#pro-cta')?.addEventListener('click', openPurchase);
  $('#pro-key')?.addEventListener('click', async () => {
    if (proState.active) {
      const ok = await confirmModal('Sign out of Pro?', `${proState.email || 'You'} will lose access on this browser. (Your purchase is safe — sign back in anytime.)`);
      if (!ok) return;
      await deactivatePro();
      proState = await getProState();
      renderProStatus();
      renderThemePicker();
      renderCustomNests();
      toast('Signed out');
      return;
    }
    const creds = await proSigninModal();
    if (!creds) return;
    const res = await activatePro(creds.email, creds.code);
    if (res.ok) {
      proState = await getProState();
      renderProStatus();
      renderThemePicker();
      renderCustomNests();
      toast('✨ Welcome to TabNest Pro!');
    } else {
      toast(res.error || 'Activation failed');
    }
  });

  // Export workspaces
  $('#export-btn')?.addEventListener('click', async () => {
    const data = {
      app: 'TabNest',
      version: 1,
      exportedAt: Date.now(),
      workspaces,
      customNests,
      theme: document.documentElement.getAttribute('data-theme') || 'forest'
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tabnest-backup-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast(`Exported ${workspaces.length} workspace${workspaces.length === 1 ? '' : 's'} 💾`);
  });

  // Import workspaces
  $('#import-btn')?.addEventListener('click', () => $('#import-file').click());
  $('#import-file')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (data.app !== 'TabNest') throw new Error('Not a TabNest backup');
      const ok = await confirmModal('Import backup?',
        `Found ${(data.workspaces||[]).length} workspace${(data.workspaces||[]).length === 1 ? '' : 's'} and ${(data.customNests||[]).length} custom nest${(data.customNests||[]).length === 1 ? '' : 's'}. This will merge with your current data.`);
      if (!ok) { e.target.value = ''; return; }
      if (Array.isArray(data.workspaces)) {
        const existing = workspaces;
        const seen = new Set(existing.map(w => w.id));
        const merged = [...existing, ...data.workspaces.filter(w => !seen.has(w.id))];
        await chrome.storage.local.set({ workspaces: merged.slice(0, 100) });
      }
      if (Array.isArray(data.customNests)) {
        const existing = customNests;
        const seen = new Set(existing.map(n => n.id));
        const merged = [...existing, ...data.customNests.filter(n => !seen.has(n.id))];
        await chrome.storage.local.set({ customNests: merged });
      }
      await loadWorkspaces();
      await loadCustomNests();
      renderCustomNests();
      await loadTabs();
      toast('Backup imported ✓');
    } catch (err) {
      toast('Import failed: ' + err.message);
    } finally {
      e.target.value = '';
    }
  });

  $('#open-shortcuts')?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });
}

// ---------- Reminder modal ----------

function remindModal(title) {
  return new Promise(resolve => {
    modalResolve = resolve;
    modalType = 'remind';
    $('#modal-title').textContent = '🔔 Remind me about this tab';
    $('#modal-body').innerHTML = `
      <p style="font-size:13px;color:var(--text-medium);text-align:center;margin-bottom:14px">
        ${escapeHtml(title || 'this tab')}
      </p>
      <div class="cn-field">
        <label>Remind me in</label>
        <div class="remind-grid">
          <button class="remind-chip" data-min="15">15 min</button>
          <button class="remind-chip" data-min="30">30 min</button>
          <button class="remind-chip" data-min="60">1 hour</button>
          <button class="remind-chip" data-min="180">3 hours</button>
          <button class="remind-chip" data-min="1440">Tomorrow</button>
          <button class="remind-chip" data-min="10080">Next week</button>
        </div>
        <div style="margin-top:10px;display:flex;gap:8px;align-items:center">
          <span style="font-size:11px;color:var(--text-medium);font-weight:700">or custom:</span>
          <input type="number" id="remind-custom" min="1" max="43200" placeholder="minutes" style="flex:1;padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;font-family:inherit;font-size:12px" />
        </div>
      </div>
    `;
    $('#modal-ok').textContent = 'Set reminder';
    $('#modal-cancel').textContent = 'Cancel';
    $('#modal').classList.add('show');
    setTimeout(() => {
      document.querySelectorAll('.remind-chip').forEach(btn => {
        btn.addEventListener('click', () => {
          const min = parseInt(btn.dataset.min);
          closeModal(true);
          // Use the helper: we trigger close with the min stored
          modalRemindValue = min;
        });
      });
    }, 30);
  });
}

let modalRemindValue = null;

function readRemindForm() {
  if (modalRemindValue) {
    const v = modalRemindValue;
    modalRemindValue = null;
    return v;
  }
  const custom = parseInt($('#remind-custom')?.value || '0');
  return custom > 0 ? custom : null;
}

// ---------- Pro sign-in modal ----------

function proSigninModal() {
  return new Promise(resolve => {
    modalResolve = resolve;
    modalType = 'signin';
    $('#modal-title').textContent = 'Activate TabNest Pro';
    $('#modal-body').innerHTML = `
      <p style="font-size:13px;color:var(--text-medium);text-align:center;margin-bottom:12px">
        After paying, we email you a 6-digit code. Enter it below to unlock Pro on this browser.
      </p>
      <div class="cn-form">
        <div class="cn-field">
          <label>Your purchase email</label>
          <input type="email" id="signin-email" placeholder="you@example.com" autocomplete="email" />
        </div>
        <div class="cn-field">
          <label>6-digit code from email</label>
          <input type="text" id="signin-code" placeholder="123456" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" />
        </div>
        <div style="font-size:11px;color:var(--text-light);text-align:center;margin-top:4px">
          Didn't get the email? Check spam, or
          <a href="#" id="signin-resend" style="color:var(--brown-primary);font-weight:700">resend code</a>.
        </div>
      </div>
    `;
    $('#modal-ok').textContent = 'Activate';
    $('#modal-cancel').textContent = 'Cancel';
    $('#modal').classList.add('show');
    setTimeout(() => $('#signin-email')?.focus(), 30);
    // Resend link — sends user to purchase page where they re-enter their email.
    setTimeout(() => {
      $('#signin-resend')?.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: PURCHASE_URL });
      });
      $('#signin-code')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); closeModal(true); }
      });
    }, 50);
  });
}

function readSigninForm() {
  const email = ($('#signin-email')?.value || '').trim();
  const code = ($('#signin-code')?.value || '').trim();
  if (!email || !code) return null;
  return { email, code };
}

// ---------- Custom nest modal ----------

function customNestModal(existing) {
  return new Promise(resolve => {
    modalResolve = resolve;
    modalType = 'custom';
    const data = existing || { name: '', icon: '🪶', color: '#8B6F47', domains: [], keywords: [] };
    $('#modal-title').textContent = existing ? 'Edit your nest' : 'Create a new nest';
    $('#modal-body').innerHTML = `
      <div class="cn-form">
        <div class="cn-field">
          <label>Nest name</label>
          <input type="text" id="cn-name" placeholder="e.g. Side project" maxlength="40" value="${escapeAttr(data.name)}" />
        </div>
        <div class="cn-row">
          <div class="cn-field">
            <label>Icon</label>
            <input type="text" id="cn-icon" placeholder="🪶" maxlength="2" value="${escapeAttr(data.icon)}" />
          </div>
          <div class="cn-field">
            <label>Colour</label>
            <input type="color" id="cn-color" value="${escapeAttr(data.color)}" />
          </div>
        </div>
        <div class="cn-field">
          <label>Domains (one per line)</label>
          <textarea id="cn-domains" placeholder="example.com&#10;notion.so">${escapeHtml((data.domains||[]).join('\n'))}</textarea>
        </div>
        <div class="cn-field">
          <label>Title keywords (one per line, optional)</label>
          <textarea id="cn-keywords" placeholder="invoice&#10;mvp">${escapeHtml((data.keywords||[]).join('\n'))}</textarea>
        </div>
      </div>
    `;
    $('#modal-ok').textContent = existing ? 'Save changes' : 'Create nest';
    $('#modal-cancel').textContent = 'Cancel';
    $('#modal').classList.add('show');
    setTimeout(() => $('#cn-name').focus(), 30);
  });
}

function readCustomNestForm() {
  const name = ($('#cn-name')?.value || '').trim();
  if (!name) return null;
  const icon = ($('#cn-icon')?.value || '🪶').trim() || '🪶';
  const color = $('#cn-color')?.value || '#8B6F47';
  const splitLines = (s) => (s || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const domains = splitLines($('#cn-domains')?.value);
  const keywords = splitLines($('#cn-keywords')?.value);
  if (domains.length === 0 && keywords.length === 0) return null;
  return { name, icon, color, domains, keywords };
}

// ---------- Note modal ----------

function noteModal(url, existing) {
  return new Promise(resolve => {
    modalResolve = resolve;
    modalType = 'note';
    $('#modal-title').textContent = existing ? 'Edit your note' : 'Add a note to this tab';
    $('#modal-body').innerHTML = `
      <div class="cn-form">
        <div class="cn-field">
          <label>Note</label>
          <textarea id="note-text" placeholder="Why this tab matters..." maxlength="400" rows="4">${escapeHtml(existing || '')}</textarea>
        </div>
        <div class="note-url">📎 ${escapeHtml(url || '')}</div>
      </div>
    `;
    $('#modal-ok').textContent = existing ? 'Save' : 'Add note';
    $('#modal-cancel').textContent = existing ? 'Delete' : 'Cancel';
    $('#modal').classList.add('show');
    setTimeout(() => { $('#note-text')?.focus(); $('#note-text')?.select(); }, 30);
  });
}

// ---------- Focus mode modal ----------

function focusModal() {
  return new Promise(resolve => {
    modalResolve = resolve;
    modalType = 'focus';
    const all = [...CATEGORIES, OTHER_CATEGORY, ...customNests];
    const defaultHidden = ['social', 'media'];
    $('#modal-title').textContent = '🎯 Start focus mode';
    $('#modal-body').innerHTML = `
      <p style="font-size:13px;color:var(--text-medium);margin-bottom:12px;text-align:center">
        Hide distracting nests and start a Pomodoro timer.
      </p>
      <div class="cn-field">
        <label>Hide these nests</label>
        <div class="focus-nests">
          ${all.map(c => `
            <label class="focus-chip">
              <input type="checkbox" value="${c.id}" ${defaultHidden.includes(c.id) ? 'checked' : ''} />
              <span>${c.icon} ${c.name}</span>
            </label>
          `).join('')}
        </div>
      </div>
      <div class="cn-field" style="margin-top:12px">
        <label>Duration</label>
        <select id="focus-duration">
          <option value="15">15 minutes</option>
          <option value="25" selected>25 minutes (Pomodoro)</option>
          <option value="45">45 minutes</option>
          <option value="60">1 hour</option>
          <option value="0">Until I stop it</option>
        </select>
      </div>
    `;
    $('#modal-ok').textContent = 'Start focus';
    $('#modal-cancel').textContent = 'Cancel';
    $('#modal').classList.add('show');
  });
}

function readFocusForm() {
  const checks = Array.from(document.querySelectorAll('.focus-chip input:checked'));
  const hiddenIds = checks.map(c => c.value);
  const duration = parseInt($('#focus-duration')?.value || '25');
  return { hiddenIds, duration };
}

// ---------- Modal ----------

let modalResolve = null;
let modalType = 'prompt';

function promptModal(title, defaultValue = '') {
  return new Promise(resolve => {
    modalResolve = resolve;
    modalType = 'prompt';
    $('#modal-title').textContent = title;
    $('#modal-body').innerHTML = '<input type="text" id="modal-input" placeholder="Give it a cozy name..." maxlength="60" />';
    const input = $('#modal-input');
    input.value = defaultValue;
    $('#modal-ok').textContent = 'Save';
    $('#modal-cancel').textContent = 'Cancel';
    $('#modal').classList.add('show');
    setTimeout(() => { input.focus(); input.select(); }, 30);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); closeModal(true); }
    });
  });
}

function confirmModal(title, body) {
  return new Promise(resolve => {
    modalResolve = resolve;
    modalType = 'confirm';
    $('#modal-title').textContent = title;
    $('#modal-body').innerHTML = `<p>${escapeHtml(body)}</p>`;
    $('#modal-ok').textContent = 'Yes';
    $('#modal-cancel').textContent = 'No';
    $('#modal').classList.add('show');
    setTimeout(() => $('#modal-ok').focus(), 30);
  });
}

function closeModal(ok) {
  const resolve = modalResolve;
  if (modalType === 'custom' && ok) {
    const data = readCustomNestForm();
    if (!data) {
      toast('Add a name and at least one domain or keyword');
      return;
    }
    $('#modal').classList.remove('show');
    modalResolve = null;
    resolve?.(data);
    return;
  }
  if (modalType === 'note') {
    $('#modal').classList.remove('show');
    modalResolve = null;
    if (!resolve) return;
    if (ok) {
      const val = $('#note-text')?.value.trim() || '';
      return resolve(val);
    }
    // Cancel button = "Delete" when editing existing, "Cancel" when adding new
    return resolve('');
  }
  if (modalType === 'focus' && ok) {
    const data = readFocusForm();
    $('#modal').classList.remove('show');
    modalResolve = null;
    return resolve?.(data);
  }
  if (modalType === 'signin' && ok) {
    const data = readSigninForm();
    if (!data) {
      toast('Enter both your email and the 6-digit code.');
      return;
    }
    $('#modal').classList.remove('show');
    modalResolve = null;
    return resolve?.(data);
  }
  if (modalType === 'remind' && ok) {
    const minutes = readRemindForm();
    if (!minutes || minutes <= 0) {
      toast('Pick a time or enter custom minutes.');
      return;
    }
    $('#modal').classList.remove('show');
    modalResolve = null;
    return resolve?.(minutes);
  }
  $('#modal').classList.remove('show');
  modalResolve = null;
  if (!resolve) return;
  if (modalType === 'prompt') {
    if (!ok) return resolve(null);
    const input = $('#modal-input');
    const val = input ? input.value.trim() : '';
    resolve(val || null);
  } else if (modalType === 'custom' || modalType === 'focus' || modalType === 'signin' || modalType === 'remind') {
    resolve(null);
  } else {
    resolve(!!ok);
  }
}

// ---------- Helpers ----------

// ---------- First-time tour ----------

const TOUR_STEPS = [
  {
    selector: '#trial-banner.show',
    fallback: '.hero',
    title: '🎁 Your trial timer',
    body: 'This banner counts down your 7 days. Subscribe anytime — your code emails instantly.'
  },
  {
    selector: '#search',
    title: '🔍 Search everything',
    body: 'Type to find any tab across every nest. Press / from anywhere to jump here.'
  },
  {
    selector: '#smart-cleanup-btn',
    title: '🧹 One-button magic',
    body: 'Closes duplicates, sweeps stale tabs, hibernates idle ones — all in one click.'
  },
  {
    selector: '#hibernate-btn',
    title: '🛏️ Save GBs of RAM',
    body: 'Idle tabs auto-hibernate every 5 minutes. Click this to do it now manually.'
  },
  {
    selector: '#help-btn',
    title: '❓ Help is always here',
    body: 'Stuck? Click this for shortcuts, FAQs, and feature explanations. Press ? anytime.'
  },
  {
    selector: '#settings-btn',
    title: '⚙️ Everything else',
    body: 'Themes, custom nests, account switch, export/import — all your controls live here.'
  }
];

let tourStep = 0;

async function maybeStartTour() {
  const stored = await chrome.storage.local.get('tourCompleted');
  if (stored.tourCompleted) return;
  setTimeout(() => startTour(), 1200);
}

function startTour() {
  tourStep = 0;
  const overlay = $('#tour-overlay');
  if (!overlay) return;
  overlay.classList.add('show');
  showTourStep();
}

async function endTour(completed) {
  $('#tour-overlay')?.classList.remove('show');
  if (completed) {
    await chrome.storage.local.set({ tourCompleted: true });
  }
}

function showTourStep() {
  const step = TOUR_STEPS[tourStep];
  if (!step) return endTour(true);
  let target = document.querySelector(step.selector);
  if (!target && step.fallback) target = document.querySelector(step.fallback);
  if (!target) {
    tourStep++;
    return showTourStep();
  }
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  // Wait for scroll, then position
  setTimeout(() => positionTour(target, step), 320);
}

function positionTour(target, step) {
  const rect = target.getBoundingClientRect();
  const pad = 6;
  const spotlight = $('#tour-spotlight');
  const popover = $('#tour-popover');
  if (!spotlight || !popover) return;

  spotlight.style.top = `${rect.top - pad}px`;
  spotlight.style.left = `${rect.left - pad}px`;
  spotlight.style.width = `${rect.width + 2 * pad}px`;
  spotlight.style.height = `${rect.height + 2 * pad}px`;

  $('#tour-step-counter').textContent = `${tourStep + 1} of ${TOUR_STEPS.length}`;
  $('#tour-title').textContent = step.title;
  $('#tour-body').textContent = step.body;
  $('#tour-next').textContent = tourStep === TOUR_STEPS.length - 1 ? 'Done ✓' : 'Got it →';

  // Position popover BELOW target by default, ABOVE if no room
  const popH = 220;
  const popW = 340;
  let top = rect.bottom + 18;
  let left = rect.left;
  let arrow = '';
  if (top + popH > window.innerHeight - 16) {
    top = rect.top - popH - 18;
    arrow = 'arrow-bottom';
  }
  if (left + popW > window.innerWidth - 16) {
    left = window.innerWidth - popW - 16;
  }
  if (left < 16) left = 16;
  popover.style.top = `${Math.max(16, top)}px`;
  popover.style.left = `${left}px`;
  popover.classList.toggle('arrow-bottom', !!arrow);
}

function setupTour() {
  $('#tour-next')?.addEventListener('click', () => {
    tourStep++;
    if (tourStep >= TOUR_STEPS.length) {
      endTour(true);
      toast('🪶 You\'re all set! Help is in the ? button anytime.');
      return;
    }
    showTourStep();
  });
  $('#tour-skip')?.addEventListener('click', () => endTour(true));
  $('#tour-overlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'tour-overlay') endTour(true);
  });
  window.addEventListener('resize', () => {
    if ($('#tour-overlay')?.classList.contains('show')) {
      const step = TOUR_STEPS[tourStep];
      const t = document.querySelector(step?.selector) || document.querySelector(step?.fallback);
      if (t) positionTour(t, step);
    }
  });
}

async function restoreTabs(restorable) {
  if (!Array.isArray(restorable) || restorable.length === 0) return;
  // Cap at 50 to avoid runaway restores on huge sweeps.
  const slice = restorable.slice(0, 50);
  for (const t of slice) {
    try {
      await chrome.tabs.create({
        url: t.url,
        pinned: !!t.pinned,
        windowId: t.windowId,
        active: false
      });
    } catch {
      try { await chrome.tabs.create({ url: t.url, pinned: !!t.pinned, active: false }); } catch {}
    }
  }
  await loadTabs();
  toast(`Restored ${slice.length} tab${slice.length === 1 ? '' : 's'} 🪶`);
}

function toast(text, action) {
  const t = $('#toast');
  if (!t) return;
  t.innerHTML = '';
  const msg = document.createElement('span');
  msg.className = 'toast-text';
  msg.textContent = text;
  t.appendChild(msg);
  if (action && typeof action.onClick === 'function') {
    const btn = document.createElement('button');
    btn.className = 'toast-action';
    btn.textContent = action.label || 'Undo';
    btn.addEventListener('click', async () => {
      t.classList.remove('show');
      clearTimeout(toast._t);
      try { await action.onClick(); } catch {}
    });
    t.appendChild(btn);
  }
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), action ? 6000 : 2000);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function escapeAttr(s) {
  return String(s).replace(/["'<>&]/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function hexAlpha(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
