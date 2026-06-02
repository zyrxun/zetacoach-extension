# ZetaCoach

A Chrome extension that turns [arithmetic.zetamac.com](https://arithmetic.zetamac.com) into a coached training tool. Tracks every problem (separating *think time* from *type time*), identifies your weakest fact families, auto-prescribes targeted drills, and ranks you across 12 tiers.

**100% local** — no accounts, no servers, no tracking. All data lives in `chrome.storage.local`.

- **Chrome Web Store:** https://chromewebstore.google.com/search/zetacoach
- **Landing page:** https://zyrxun.github.io/zetacoach/
- **Privacy policy:** https://zyrxun.github.io/zetacoach-privacy/

## Features

- Live side panel during play with running stats
- Dashboard with analytics, fact-family heatmap, fatigue curves, full session history
- Coach tab that surfaces your slowest operands and prescribes targeted drills
- In-extension Drills arena (adaptive, metronome, stamina, free modes)
- 12-tier ranking from your best score
- Draggable, persistable panel position

## Build

```bash
./build.sh
```

Produces a minified, zipped build at `../zetacoach.zip` ready for upload to the Chrome Web Store.

## Project layout

| Path | Purpose |
|---|---|
| `manifest.json` | MV3 manifest |
| `content.js` | Injected into zetamac.com — tracks problems, observes timer, renders side panel |
| `background.js` | Service worker — storage, tier computation, message broadcasts |
| `dashboard.html`/`.js`/`.css` | Full dashboard (Analytics / Drills / History / Coach / Settings) |
| `popup.html`/`.js`/`.css` | Toolbar popup |
| `analytics.js` | Pure analytics engine — tagging, prescriptions, problem generation |
| `tiers.js` | 12-tier ranking definitions + SVG icons |
| `build.sh` | Minify + zip for store submission |
| `store-assets/` | Screenshots, icons, promo tile for Web Store listing |
| `STORE_LISTING.md` | Listing copy and submission checklist |
| `TODO.md` | Outstanding work (bugs, v1.0.1 reliability, features) |

## Contributing / Issues

Bug reports welcome via GitHub Issues. Include browser version and a console paste from the dashboard or `chrome://extensions` service worker if relevant.

## License

MIT
