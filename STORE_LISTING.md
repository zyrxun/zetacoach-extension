# Chrome Web Store Listing — ZetaCoach

## Name (max 45 chars)
ZetaCoach — Math Drill Coach for ZetaMac

## Short description (max 132 chars)
Live analytics, weak-point detection, and personalised practice plans for arithmetic.zetamac.com. Track every drill. Climb tiers.

## Category
Productivity

## Language
English

---

## Detailed description (~1000 chars)

ZetaCoach turns arithmetic.zetamac.com into a real training tool.

Every problem you solve gets timed — comprehension speed, execution speed, and total latency — then sliced by operation, operand, and fact family. The result: you stop guessing what's slow and start seeing exactly which numbers cost you points.

**What you get**

⚡ **Live side panel** — comprehension and execution times update as you type, with speed-zone classification (Direct Retrieval → Procedural → Systemic Friction).

📊 **Full dashboard** — fact-family heatmap, trend chart, per-tag sparklines, session drill-down, and prescriptions that target your weakest patterns.

🎯 **Coach tab** — auto-detects your weakest fact family (e.g. "× 12 table") and pre-configures a ZetaMac session to drill exactly that. One click.

🏅 **12-tier ranking system** — Unranked → Iron → Bronze → ... → Legend, based on your all-time best score. Get a tier-up animation when you break through.

🎮 **In-dashboard drills** — Adaptive, Metronome, Stamina, and Free modes for offline practice between ZetaMac sessions.

🔒 **100% local** — All data stored in your browser. No accounts, no servers, no tracking.

Open arithmetic.zetamac.com, play a game, and ZetaCoach starts learning. After 3 sessions, the Coach tab unlocks.

---

## Single-purpose statement (Chrome requires this)
ZetaCoach provides analytics, practice tools, and personalised coaching for the arithmetic.zetamac.com mental math drill website.

---

## Permission justifications (paste verbatim into the dev console)

**storage** — Stores your session history, problem timings, settings, and tier rank locally in your browser. Required for the dashboard, analytics, and coaching features to work across sessions.

**tabs** — Used to detect when an arithmetic.zetamac.com tab is open (for the Coach "Launch" button) and to open the dashboard in a new tab when you click "Open Dashboard".

**scripting** — Used to inject the coach's prescribed drill configuration into the ZetaMac settings form when you click "Launch on ZetaMac" from the Coach tab.

**host_permissions (zetamac.com)** — Required to inject the live side panel and tracking content script onto arithmetic.zetamac.com pages. ZetaCoach only runs on zetamac.com domains and never touches any other site.

---

## Privacy policy

**Live URL (paste this into the Chrome Web Store form):**

```
https://zyrxun.github.io/zetacoach-privacy/
```

Source: https://github.com/zyrxun/zetacoach-privacy — edit `index.md` to update.

---

## Screenshots to capture (1280×800)

1. **Live panel during a game** — the orchid panel on the right of arithmetic.zetamac.com showing live comprehension/execution times
2. **Analytics dashboard** — tier card + KPI strip + fact-family heatmap visible
3. **Coach tab** — weak points list + recommended practice plan + Launch button
4. **Tier-up animation** — capture mid-animation if possible
5. **History tab** — trend chart + session drill-down expanded

Tip: Use Chrome DevTools device emulation set to 1280×800 for consistent dimensions.

---

## Submission checklist

- [ ] Increment `version` in manifest.json if you've changed anything since last build
- [ ] Run a clean install test: load extension from a fresh zip, play one game end-to-end
- [ ] Host privacy policy at a public URL, paste URL into store listing
- [ ] Capture 3–5 screenshots at 1280×800
- [ ] Create 440×280 promo tile
- [ ] Zip the extension folder (exclude `.git`, `STORE_LISTING.md`, `node_modules`, etc.)
- [ ] Upload at chrome.google.com/webstore/devconsole
- [ ] Paste short description, detailed description, category, single-purpose statement
- [ ] Paste permission justifications
- [ ] Submit for review (typically 1–3 business days)
