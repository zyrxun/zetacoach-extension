# ZetaCoach TODO

Single source of truth for v1.0.1+ work. Check items off in the same commit that ships them.

## Known bugs (investigate first)

- [x] **Wrong answers not captured** — `content.js onInputChange` used a length-guarded exact compare; missed errors with fewer digits than the correct answer. Replaced with prefix-match (`!expectedStr.startsWith(val)`), single-flag per problem, and `prevInputVal = ''` reset in `onNewProblem`.
- [x] **Division drills missing from Coach** — `analyseSpecificTargets` bucketed mul/add under both operands but div/sub under one, halving the effective sample rate. Replaced flat `MIN_COUNT=4` with op-aware `{mul:8, add:8, div:4, sub:4}`. Added `console.debug` on both sides of the launch handoff and a UI hint explaining Zetamac's reverse-multiplication generation.
- [x] **Drill arena rendered "undefined"** — root cause in `generateProblemForTag` for `Borrowing_Required` (and `Tens_Crossing`): the do-while could exit on first iteration with `b` undefined (e.g., `aUnits===9` → `bUnitsMin=10` → `continue` skipped b-assignment, then `b>=a` and `b<=0` both evaluated false against `undefined` so the loop exited cleanly). Hit ~10% of generations when the tag was active. Fixed by resetting `b=undefined` at the top of each iteration, moving `attempts++` to the top so `continue` counts, and checking `b===undefined` in both the while-condition and the post-loop fallback. Kept defensive guards in `nextDrillProblem` (warn + safe fallback) and display (`?? '?'`, `|| '—'`).
- [x] **Game-end detection sometimes misses timer-zero** — observer config was already permissive; suspect was Zetamac swapping the `#game` node entirely, killing the observer. Added a 500ms `startSessionWatchdog` polling fallback that runs only while `sessionActive`, re-queries `#game` each tick, fires `endSession` on `seconds===0`, and self-clears in `endSession`.

## v1.0.1 (post-Chrome-Store-approval)

### Coach reliability (from Gemini collaboration)
- [ ] Winsorize per-problem latency at 3 × session_median (read-time, not write-time)
- [ ] Use t1 (think time) for cognitive weak-point scoring; reserve t2 for any future typing-speed feature
- [ ] Exclude isPostError===true from latency pools; keep them in error-rate stats
- [ ] Replace mean/average with rolling medians throughout analytics.js scoring paths
- [ ] Pool tagging: mul/div by fact family; add/sub by carry/no-carry × digit-span (no answer-digit-count split — t1/t2 separation already isolates typing latency from cognitive load)
- [ ] ≥8 samples per pool before that pool can be flagged weakest
- [ ] ≥3 completed sessions before any prescription fires
- [ ] "Still learning — N more sessions" banner gated on the above
- [ ] Dynamic threshold: >3.0s → 15%, 1.5–3.0s → 10%, <1.5s → 5%
- [ ] Rolling window: last 15 sessions filtered by matching Zetamac config
- [ ] Speed Drill vs. Accuracy Drill — two prescription types with independent gates
- [ ] Coach state cache key = (latestSessionId, configHash) — invalidates on mode switch
- [ ] "Based on N samples" confidence badge per prescription
- [ ] Convert background.js storage layer to async/await

### Practice Session feature
Plan: `~/.claude/plans/also-we-should-probably-composed-fairy.md`
- [ ] New Practice tab in dashboard (idle / active / review / summary states)
- [ ] Duration presets 15/30/45/60 + custom minutes input
- [ ] Top-3 rotating queue from buildCoachPlan
- [ ] Hybrid advance flow: auto-load next config, show review screen, user clicks Start
- [ ] Persist active session under chrome.storage.local key `zetacoach_practice_active`
- [ ] Practice history under `zetacoach_practice_sessions` (separate from Zetamac session history)
- [ ] Re-rank check after each round; swap target only if it falls out of top-N
- [ ] Summary report on time-out: per-target before/after, biggest mover

### Hardening
- [ ] Dedupe `truncateWords()` between content.js + dashboard.js → utils.js
- [ ] Remove `DIAGNOSTIC_SELECTORS` dead code from content.js
- [ ] Replace `applyPendingConfig()` 400 ms setTimeout with MutationObserver (self-disconnect on first match)
- [ ] e2e smoke test on minified build: grep for pool-key string literals, DOM IDs, chrome.* API names

### Post-approval listing
- [ ] Update landing page (zyrxun.github.io/zetacoach) — replace "Coming soon" with real Web Store URL
- [ ] Move STORE_LISTING.md from zetacoach/ to Zetamac/ root
- [ ] (Optional) 1400×560 marquee promo tile

## v1.0.2+ backlog
- [ ] Practice-session daily reminders (notifications permission)
- [ ] Multi-day practice streak tracking
- [ ] Export sessions + practice history to CSV
- [ ] EMA half-life weighting (alternative to rolling window cutoff)
