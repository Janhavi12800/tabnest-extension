# 🪺 TabNest

> A cozy little home for your tabs. Auto-organises every tab into beautiful smart nests so you can actually find what you opened.

[![Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-coming%20soon-D4A574?style=flat-square)](https://janhavi12800.github.io/tabnest-website/)
[![Pro](https://img.shields.io/badge/Pro-%E2%82%B9100%20lifetime-8B6F47?style=flat-square)](https://janhavi12800.github.io/tabnest-website/)
[![License](https://img.shields.io/badge/license-MIT-7A9B7E?style=flat-square)](LICENSE)

![TabNest screenshot](https://janhavi12800.github.io/tabnest-website/assets/icon-large.png)

## What it does

TabNest watches your tabs and quietly tucks each one into a **nest** — a smart category like Code, Learning, Media, Work, AI — using Chrome's native tab groups. The dashboard shows every nest at a glance, with search, dedupe, workspaces, and (with Pro) focus mode, custom nests, tab notes, and themes.

## Features

- 🪺 **Auto-nest** — every tab into a smart group, the moment it opens
- 🌿 **Workspaces** — save sets of tabs as "Monday morning" or "Thesis research"
- ✂️ **Dedupe & sweep** — close duplicates and stale tabs with one click
- 🔍 **Search** — fuzzy search across every tab in every window
- 🎨 **4 themes** — Forest, Sunset, Midnight, Cherry Blossom *(Pro)*
- 🎯 **Custom nests** — make your own categories *(Pro)*
- 📝 **Tab notes** — sticky notes attached to URLs *(Pro)*
- ⏰ **Focus mode** — hide distracting nests + Pomodoro timer *(Pro)*
- 💾 **Export / Import** — your data backs up to a JSON file

## Install

### From source (right now)

1. Clone or download this repo
2. Open `chrome://extensions/` in Chrome
3. Toggle **Developer mode** (top right)
4. Click **Load unpacked** → choose this folder
5. Pin TabNest to your toolbar

### From Chrome Web Store

Coming soon — currently under review.

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Alt+Shift+T` | Open the popup |
| `Alt+Shift+D` | Open the full dashboard |
| `Alt+Shift+F` | Jump to search |
| `/` | Focus search inside the dashboard |
| `Esc` | Clear search / close modals |

Change any of these at `chrome://extensions/shortcuts`.

## Architecture

```
extension/
├── manifest.json          MV3 manifest (minimal permissions)
├── background.js          Service worker — auto-grouping, alarms, messages
├── categories.js          Built-in nest definitions + custom-nest support
├── themes.js + themes.css 4 themes via CSS variable swap
├── pro.js                 Email + 6-digit code Pro verification
├── notes.js               Tab notes keyed by URL
├── popup.html/css/js      The compact 380×600 popup
├── dashboard.html/css/js  Full-page dashboard with settings drawer
├── onboarding.html/css/js First-run welcome
└── icons/                 16/32/48/128/256 px nest illustrations
```

## Privacy

TabNest stores **everything on your computer**. We don't run a tracking server, we don't sell data, and we don't even know how many tabs you have.

The only data that ever leaves your machine is your **purchase email + 6-digit activation code**, and only when you're activating or re-verifying Pro (every 7 days).

[Full privacy policy →](https://janhavi12800.github.io/tabnest-website/privacy.html)

## Buying Pro

₹100 one-time gets you every Pro feature, forever, on every browser you sign into with your email.

[Get TabNest Pro →](https://janhavi12800.github.io/tabnest-website/)

## Building from source

There's no build step — the extension is plain HTML/CSS/JS. To develop:

1. Make your changes
2. Open `chrome://extensions/`
3. Click the refresh icon on TabNest
4. Reload any tab where you want to see the change

## Contributing

If you spot a bug or want a feature, open an issue. PRs welcome.

## License

MIT — see [LICENSE](LICENSE).

---

Made with 🪶 in India by [Janhavi](https://github.com/Janhavi12800).
