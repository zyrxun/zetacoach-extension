# ZetaCoach

**A Chrome extension that turns arithmetic.zetamac.com from a stopwatch into a coached training tool — 100% local, zero servers, with a diagnostic engine that actually works.**

---

## Inspiration

Zetamac is the de facto mental-arithmetic benchmark used by quant traders, competitive math kids, and anyone trying to get faster at numbers. It has been online for a decade and has never changed: a 2-minute timer, a problem on screen, your score at the end. That's it.

But "your score at the end" doesn't tell you *why* the score is what it is. Was it the ÷7 problems? The carries? Did you fall apart in the last 20 seconds? Players plateau for months because they're optimising blind. They drill what *feels* hard — usually the wrong thing — and improvement stalls.

We wanted to know what was actually slowing us down, problem by problem. Not vibes, not gut feel — data. So we built one.

---

## What it does

ZetaCoach silently observes every Zetamac session you play and turns it into a personal coaching system:

- **Splits every problem into think-time vs. type-time** — so 3-digit answers don't look like cognitive weaknesses when they're actually typing motor latency.
- **Identifies your specific weak fact families** using a pooled-statistical model that resists outliers, low-sample noise, and recency bias.
- **Auto-prescribes the right drill** with one click: ZetaCoach injects the optimal Zetamac configuration into the game page and reloads — pinned to the operand or pool you actually struggle with.
- **Ranks you across 12 tiers** based on your best score so progress is visible and motivating.
- **Renders a full diagnostic dashboard**: fact-family heatmap, structural-tag breakdown with trend arrows, fatigue curves per session, session history with problem-by-problem expansion, and an in-extension drill arena with adaptive / metronome / stamina / free modes.

Everything happens in your browser. There is no backend. There is no account. We literally cannot see your data even if we wanted to.

---

## How we built it

### The data pipeline

Every problem captured by the content script is split into two latencies — `t1` (problem appearing to first keystroke) and `t2` (first keystroke to submit). This separation is the single most important design decision in the project. **Cognitive speed is `t1`. Motor speed is `t2`. Anyone using total latency is conflating two completely different signals.**

Sessions are stored in `chrome.storage.local` as `{ id, timestamp, score, problems[], stats, config }`. The `config` field records the exact Zetamac settings used — checkbox state and range inputs — so the coaching engine can later compare apples to apples.

### The coaching engine

This is where the project earned its name. The naive approach — "average each operand's latency, surface the slowest" — produces garbage. We rebuilt it in three structural passes:

1. **Read-time Winsorization at 3× session median.** A single 12-second distraction on one problem would otherwise poison that operand's average for weeks. Clipping at read time kills the outlier without touching the raw data on disk.

2. **Pool-based bucketing instead of literal operand.** Problems are grouped by what's *cognitively hard* about them, not by the specific numbers involved. Multiplication and division share fact-family pools (×7 and ÷7 are the same skill). Addition and subtraction are bucketed by digit-span × carry-status (single+double with carry, double+double no-carry, etc.). This produces both faster sample accumulation and pedagogically meaningful recommendations.

3. **Dynamic threshold scaled to user speed.** A 5% latency gap matters at elite levels and is noise at beginner levels. The "weak point" qualification threshold is 15% if your global median is above 3 seconds, 10% in the middle, 5% below 1.5 seconds.

We also added:
- A rolling 15-session window filtered by `configHash` — your old mixed-mode data doesn't poison your new division-only training context.
- Activation gating: no prescriptions fire below 3 matching sessions, and a per-pool sample floor of 8.
- Split prescription types: **Speed Drill** (slow but accurate pools) and **Accuracy Drill** (error-prone pools, latency-agnostic), with independent thresholds.
- Post-error filtering: the 1–2 problems after a wrong answer are panic-recovery, not skill. They get excluded from latency math but stay in error-rate stats.
- A "Based on N samples · last 15 sessions" confidence badge under every recommendation so users can see the evidence base.

### The Zetamac injection trick

To launch a targeted drill, the dashboard writes the desired config to Zetamac's `sessionStorage` and then navigates to the page root. On load, our content script reads it, programmatically fills the form, and the user lands on a pre-configured "ready to start" screen. This works because Zetamac's setup form is plain HTML — no SPA framework, no API, just `<input>` elements.

The trick required:
- Synthesising real `input` and `change` events (programmatic value-setters don't trigger React-style listeners on their own — though Zetamac is vanilla HTML, the principle generalises).
- Reading division's "reverse-multiplication" generation model from Zetamac and exposing the quirk in the UI (a `÷7` drill produces problems with 7 as the divisor half the time and as the answer the other half).
- A 500ms `setInterval` watchdog that re-queries the DOM in case Zetamac swaps out our observed `#game` node and kills the MutationObserver.

### The bugs we hunted

A short list of things that broke and how we found them:

- **Wrong-answer detection didn't catch wrong answers.** The original detector compared input-length-equals-expected-length, which missed every wrong attempt with fewer digits than the correct answer (`100` when the answer is `1000`). We replaced it with prefix-matching: if at any point the input isn't a prefix of the correct answer, the user is on a wrong path. Now catches everything.

- **Division was invisible in the Coach view.** The operand-bucketing code put mul/add problems into *two* buckets (both operands) but div/sub into *one*. With a flat sample threshold, div fact families almost never qualified. The eventual fix went further — full pool refactor, no more asymmetry.

- **The drill arena occasionally rendered `"57 − undefined"`.** Root cause was a `do…while` in `generateProblemForTag` that could exit on the first iteration with `b` undefined when the loop's `continue` skipped `b`'s assignment and the while-condition `(b >= a || b <= 0)` evaluated to false against `undefined`. ~10% hit rate. Patched the loop structure to reset `b = undefined` at the top of each iteration and explicitly check the sentinel in both the while and the post-loop fallback.

- **Game-end detection sometimes missed timer-zero.** MutationObserver config was already permissive; root suspect was Zetamac swapping the entire `#game` node. Added a polling watchdog as belt-and-braces.

---

## Challenges we ran into

**Statistics on small samples.** The whole point of the project is to extract reliable signal from very few data points — sometimes 3 sessions of 50 problems. We over-corrected in early iterations (the gates were too strict; users with 8 sessions saw "Still learning") and under-corrected in others (too noisy with 3 sessions). The final calibration came from collaborating with Gemini on the statistical model — two full rounds of review where Gemini caught real edge cases (post-error contamination spilling into innocent pools, decade-pooling being wrong for Zetamac's actual ranges, the typing-vs-thinking conflation we'd nearly missed) and we pushed back on the ones we disagreed with (suggested write-time outlier clipping was wrong — destroys raw data; we kept Winsorization purely read-time).

**Chrome extension architecture.** Manifest V3, three execution contexts (content script, background service worker, dashboard tab), no shared global namespace, async messaging with weird quirks around when `chrome.storage.local.set` actually flushes vs. when callbacks fire. We rebuilt the storage layer twice to get the SESSION_COMPLETE → broadcast ordering right.

**Minification preserving correctness.** Terser mangles identifiers but not string literals. Our pool keys (`addsub_double-double_carry` etc.) and storage keys had to survive intact through the minified production bundle. We added grep-the-bundle verification to the build script — string literals appear verbatim or the build is wrong.

**Designing for a tool we'd actually use.** This is the underrated challenge. It is easy to ship a "here are some stats" dashboard. It is hard to ship a tool that *changes behaviour* — that makes a player actually drill what they should drill. Most of the UX work was about reducing the gap between "Coach surfaces a weak point" and "user starts a targeted session." One-click launch, exact config injection, the right ranges automatically pinned.

---

## Accomplishments we're proud of

- **A coaching engine that we'd actually trust.** Every recommendation has a documented statistical pipeline behind it, gated by sample size and recency, with a visible confidence count. No more vibes.
- **Zero-server architecture for a real-world product.** No accounts, no data exfiltration, no telemetry, no analytics calls. The privacy policy is "we can't see anything because we built it that way." Code is open-source so anyone can verify.
- **A four-phase versioned release cadence.** v1.0.0 → v1.0.4 in a week, each version independently shippable and bisectable. Foundation math (Winsorize + median + t1-only) shipped first as v1.0.2, then activation gates and the rolling-config window in v1.0.3, then pool tagging + Speed/Accuracy split + dynamic threshold + async refactor in v1.0.4.
- **The bugs we caught before users did.** Defensive guards in the drill renderer that pre-empted a real-world `undefined` leak, a watchdog poller that protects against arbitrary DOM swaps, a wrong-answer detector that actually detects wrong answers.

---

## What we learned

- **Splitting `t1` from `t2` is the single most valuable design decision in arithmetic training tooling.** Everyone using total latency is wrong. We were too, until we weren't.
- **Pool bucketing produces better recommendations than operand bucketing**, both pedagogically (carry/no-carry is what the brain actually trains) and statistically (samples accumulate fast enough for medians to settle).
- **Read-time outlier handling beats write-time.** If storage isn't the bottleneck, never throw away raw data. You will want it later.
- **Per-feature ship phases beat big-bang releases.** Three small versions are easier to reason about and revert than one big one.

---

## What's next

Currently in development:

- **A structured Practice Session feature** — a 30-minute timed coaching block where ZetaCoach rotates through your top-3 weak points, launches each into Zetamac, watches your performance, and queues the next one between rounds. Already designed; implementation queued behind v1.0.4 production observation.
- **In-extension drill persistence** (optional) so the practice arena's data can feed Coach the same way real Zetamac sessions do.
- **Multi-day streak tracking** and daily practice reminders.
- **Export sessions to CSV** for users who want to do their own analysis.
- **EMA-weighted recency** as an alternative to the rolling-window cutoff.

---

## Built with

- **JavaScript (ES2022+)** — vanilla, no framework
- **Chrome Extension Manifest V3** — service worker background, content scripts, MV3 promise-native storage APIs
- **HTML + CSS** — custom glassmorphic UI, no UI library
- **Terser** — production minification with verified string-literal preservation
- **chrome.storage.local** — only persistence layer; ~500 sessions cap with quota-handling trim
- **MutationObserver + setInterval watchdog** — game-state detection that survives DOM swaps

**Codebase:** ~3,500 lines across content/dashboard/background/analytics/tiers.

**Architecture:** content script tracks problems and renders side panel; service worker handles storage and tier computation; dashboard renders analytics and Coach; popup shows tier. Pure functions in analytics.js are shared across all three contexts via the `window.ZetaAnalytics` export contract.

**Repo:** [github.com/zyrxun/zetacoach-extension](https://github.com/zyrxun/zetacoach-extension)
**Listing:** [chromewebstore.google.com/search/zetacoach](https://chromewebstore.google.com/search/zetacoach)
**Landing:** [zyrxun.github.io/zetacoach](https://zyrxun.github.io/zetacoach)
**Privacy:** [zyrxun.github.io/zetacoach-privacy](https://zyrxun.github.io/zetacoach-privacy)

---

ZetaCoach is what we wish had existed when we started training on Zetamac. Now it does.
