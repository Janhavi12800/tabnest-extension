// TabNest popup logic

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

let allTabs = [];
let workspaces = [];
let searchQuery = '';
let openNests = new Set();

document.addEventListener('DOMContentLoaded', init);

async function init() {
  await initTheme();
  const acc = await getAccount();
  // Not signed up yet → send straight to onboarding from the popup itself.
  if (acc.status === 'none' || acc.status === 'pending') {
    const url = chrome.runtime.getURL('onboarding.html');
    await chrome.tabs.create({ url });
    window.close();
    return;
  }
  // If the user picked "Open as: Full dashboard tab", popup hops to the dashboard
  // and closes itself the moment it's shown.
  try {
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
      window.close();
      return;
    }
  } catch {}
  const stored = await chrome.storage.local.get('customNests');
  if (typeof setCustomNests === 'function') setCustomNests(stored.customNests || []);
  await loadTabs();
  await loadWorkspaces();
  await renderProStrip();
  setupListeners();
  $('#search').focus();
}

async function renderProStrip() {
  const strip = $('#pro-strip');
  if (!strip) return;
  const acc = await getAccount();
  if (acc.status === 'pro') {
    strip.style.display = 'none';
    return;
  }
  strip.style.display = 'flex';
  const text = strip.querySelector('.pro-strip-text');
  if (!text) return;
  if (acc.status === 'trial') {
    const left = (acc.trialEnd || 0) - Date.now();
    const days = Math.max(0, Math.ceil(left / (24 * 60 * 60 * 1000)));
    text.innerHTML = `<strong>🎁 Trial: ${days} day${days === 1 ? '' : 's'} left</strong>
      <span>Subscribe ₹100 to keep TabNest forever</span>`;
  } else if (acc.status === 'expired') {
    text.innerHTML = `<strong>🔒 Trial ended</strong>
      <span>Subscribe ₹100 / year · all features back</span>`;
  } else {
    text.innerHTML = `<strong>✨ Unlock TabNest Pro</strong>
      <span>7 days free, then ₹100 / year</span>`;
  }
}

async function loadTabs() {
  try {
    allTabs = await chrome.tabs.query({ currentWindow: true });
  } catch {
    allTabs = [];
  }
  renderNests();
}

async function loadWorkspaces() {
  const stored = await chrome.storage.local.get('workspaces');
  workspaces = stored.workspaces || [];
  renderWorkspaces();
}

function renderNests() {
  const filtered = searchQuery
    ? allTabs.filter(t => {
        const q = searchQuery.toLowerCase();
        return (t.title || '').toLowerCase().includes(q) ||
               (t.url || '').toLowerCase().includes(q);
      })
    : allTabs;

  const groups = new Map();
  for (const tab of filtered) {
    const cat = categorizeTab(tab);
    if (!groups.has(cat.id)) groups.set(cat.id, { cat, tabs: [] });
    groups.get(cat.id).tabs.push(tab);
  }

  const sorted = Array.from(groups.values()).sort((a, b) => b.tabs.length - a.tabs.length);

  $('#tab-count').textContent = allTabs.length;
  $('#nest-count').textContent = groups.size;

  const container = $('#nests');
  container.innerHTML = '';

  if (sorted.length === 0) {
    container.innerHTML = '<div class="empty">' +
      (searchQuery ? 'No tabs match your search 🪶' : 'No tabs yet — start browsing!') +
      '</div>';
    return;
  }

  for (const { cat, tabs } of sorted) {
    const isOpen = openNests.has(cat.id) || (searchQuery && filtered.length < 30);
    const nest = document.createElement('div');
    nest.className = 'nest' + (isOpen ? ' open' : '');

    nest.innerHTML = `
      <div class="nest-header">
        <div class="nest-icon" style="background:${hexAlpha(cat.color, 0.18)};color:${cat.color}">${cat.icon}</div>
        <div class="nest-name">${cat.name}</div>
        <div class="nest-count" style="background:${hexAlpha(cat.color, 0.18)};color:${cat.color}">${tabs.length}</div>
        <div class="nest-chevron">▼</div>
      </div>
      <div class="nest-body">
        ${tabs.map(t => `
          <div class="tab-item${t.active ? ' active' : ''}" data-id="${t.id}">
            <img class="tab-favicon" data-fallback="1" src="${t.favIconUrl ? escapeAttr(t.favIconUrl) : 'icons/icon16.png'}" />
            <div class="tab-title">${escapeHtml(t.title || t.url || 'Untitled')}</div>
            <button class="tab-close" data-id="${t.id}" title="Close tab">✕</button>
          </div>
        `).join('')}
      </div>
    `;

    nest.querySelector('.nest-header')?.addEventListener('click', () => {
      if (openNests.has(cat.id)) openNests.delete(cat.id);
      else openNests.add(cat.id);
      renderNests();
    });

    nest.querySelectorAll('.tab-item').forEach(item => {
      item.addEventListener('click', async (e) => {
        if (e.target.closest('.tab-close')) return;
        const id = parseInt(item.dataset.id);
        await chrome.tabs.update(id, { active: true });
        const tab = await chrome.tabs.get(id);
        await chrome.windows.update(tab.windowId, { focused: true });
        window.close();
      });
    });

    nest.querySelectorAll('.tab-close').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.id);
        await chrome.tabs.remove(id);
        await loadTabs();
      });
    });

    nest.querySelectorAll('.tab-favicon').forEach(img => {
      img.addEventListener('error', () => {
        img.src = 'icons/icon16.png';
        img.removeAttribute('data-fallback');
      });
    });

    container.appendChild(nest);
  }
}

function renderWorkspaces() {
  const container = $('#workspaces');
  container.innerHTML = '';
  if (workspaces.length === 0) {
    container.innerHTML = '<div class="empty">Save a workspace to come back to it later 🌿</div>';
    return;
  }
  for (const ws of workspaces.slice(0, 5)) {
    const date = new Date(ws.createdAt);
    const el = document.createElement('div');
    el.className = 'workspace';
    el.innerHTML = `
      <div class="workspace-icon">🪺</div>
      <div class="workspace-info">
        <div class="workspace-name">${escapeHtml(ws.name)}</div>
        <div class="workspace-meta">${ws.tabs.length} tabs · ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div>
      </div>
      <button class="workspace-delete" data-id="${ws.id}" title="Delete workspace">🗑</button>
    `;
    el.addEventListener('click', async (e) => {
      if (e.target.closest('.workspace-delete')) return;
      await chrome.runtime.sendMessage({ type: 'open-workspace', id: ws.id });
      toast('Opening your nest...');
      setTimeout(() => window.close(), 350);
    });
    el.querySelector('.workspace-delete')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const ok = await confirmModal('Remove this workspace?', `"${ws.name}" will be deleted.`);
      if (!ok) return;
      await chrome.runtime.sendMessage({ type: 'delete-workspace', id: ws.id });
      await loadWorkspaces();
      toast('Workspace removed');
    });
    container.appendChild(el);
  }
}

function setupListeners() {
  $('#search')?.addEventListener('input', (e) => {
    searchQuery = e.target.value.trim();
    renderNests();
  });

  $('#search')?.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      const first = document.querySelector('.tab-item');
      if (first) first.click();
    } else if (e.key === 'Escape') {
      if (searchQuery) {
        $('#search').value = '';
        searchQuery = '';
        renderNests();
      }
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
    toast(res?.removed > 0
      ? `Closed ${res.removed} duplicate${res.removed === 1 ? '' : 's'} ✂️`
      : 'No duplicates here 🪶');
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
    const ok = await confirmModal('Sweep stale tabs?', 'Close tabs you haven\'t touched in 24+ hours.');
    if (!ok) return;
    const res = await chrome.runtime.sendMessage({ type: 'close-stale', hours: 24 });
    await loadTabs();
    toast(res?.closed > 0
      ? `Swept away ${res.closed} stale tab${res.closed === 1 ? '' : 's'} 🍂`
      : 'No stale tabs found 🪶');
  });

  $('#dashboard-btn')?.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'open-dashboard' });
    window.close();
  });

  $('#pro-strip')?.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'open-dashboard' });
    window.close();
  });
  $('#pro-strip-btn')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    chrome.tabs.create({ url: PURCHASE_URL });
    window.close();
  });

  $('#modal-cancel')?.addEventListener('click', () => closeModal(false));
  $('#modal-ok')?.addEventListener('click', () => closeModal(true));
  $('#modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'modal') closeModal(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('#modal').classList.contains('show')) {
      closeModal(false);
    }
  });
}

// ---------- Modal helpers ----------

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
  $('#modal').classList.remove('show');
  const resolve = modalResolve;
  modalResolve = null;
  if (!resolve) return;
  if (modalType === 'prompt') {
    if (!ok) return resolve(null);
    const input = $('#modal-input');
    const val = input ? input.value.trim() : '';
    resolve(val || null);
  } else {
    resolve(!!ok);
  }
}

// ---------- Helpers ----------

function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 1800);
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
