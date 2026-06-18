// TabNest themes — definitions + apply + picker helpers

const THEMES = [
  {
    id: 'forest',
    name: 'Forest',
    icon: '🌿',
    description: 'Warm cream, mossy green — the original cozy nest.',
    swatch: ['#FBF5E6', '#8B6F47', '#7A9B7E', '#E07856']
  },
  {
    id: 'sunset',
    name: 'Sunset',
    icon: '🌅',
    description: 'Golden hour — peach, terracotta, dusty rose.',
    swatch: ['#FFEEDC', '#C0673E', '#F4A261', '#E27B58']
  },
  {
    id: 'midnight',
    name: 'Midnight',
    icon: '🌙',
    description: 'Dark mode — deep navy with gold and sage.',
    swatch: ['#1A1F35', '#D4A574', '#9CC4A2', '#FF9978']
  },
  {
    id: 'cherry',
    name: 'Cherry Blossom',
    icon: '🌸',
    description: 'Soft sakura pink, blush and rose.',
    swatch: ['#FFF0F3', '#C77B8E', '#F4A1B0', '#FF7B91']
  }
];

const DEFAULT_THEME = 'forest';

async function loadTheme() {
  try {
    const stored = await chrome.storage.local.get('theme');
    return stored.theme || DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

async function saveTheme(themeId) {
  try {
    await chrome.storage.local.set({ theme: themeId });
  } catch {}
}

function applyTheme(themeId) {
  const root = document.documentElement;
  root.setAttribute('data-theme', themeId || DEFAULT_THEME);
}

async function initTheme() {
  const t = await loadTheme();
  applyTheme(t);
  return t;
}

if (typeof module !== 'undefined') {
  module.exports = { THEMES, DEFAULT_THEME, loadTheme, saveTheme, applyTheme, initTheme };
}
