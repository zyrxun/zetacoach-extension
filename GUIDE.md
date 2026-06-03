# The ZetaCoach Field Guide

A practical walkthrough for getting the most out of ZetaCoach — from your first session to breaking a plateau six months in.

ZetaCoach turns [arithmetic.zetamac.com](https://arithmetic.zetamac.com) from a stopwatch into a coached training tool. It watches every problem you solve, separates *thinking time* from *typing time*, builds a private map of your weakest fact families, and tells you exactly what to drill next. Everything stays on your machine — no accounts, no servers, no data leaves your browser.

This guide is organised the way you'll actually use the extension: install it, play your first session, learn what the dashboard is telling you, then graduate to the workflows that produce real improvement.

---

## Part 1 — Installation and your first session

### Install

1. Visit the [ZetaCoach listing on the Chrome Web Store](https://chromewebstore.google.com/search/zetacoach) and click **Add to Chrome**.
2. Pin the icon to your toolbar (puzzle icon → pin) so you can see your tier badge at a glance.
3. Open [arithmetic.zetamac.com](https://arithmetic.zetamac.com) in the same tab you'll play in.

You'll know it's working when a small side panel appears in the bottom-right corner of the Zetamac page. That panel is where ZetaCoach lives during play.

### Your first session

Configure Zetamac the way you normally would — pick which operations are on, set ranges, pick a duration — and click **Start**. Play normally. ZetaCoach is invisible while you play; it just records.

When the timer hits zero, the panel switches to a quick summary: your score, accuracy, average latency, fatigue delta, and a "Open Dashboard" button. Click it.

**Do this 2 more times before you read the dashboard.** Coach won't have enough data to give you meaningful weak points until you've played at least 3 sessions with the same Zetamac configuration. The dashboard will show a "Still learning — Play N more sessions" banner until then. That's not a bug, it's a deliberate gate — Coach refuses to give you bad advice from too little data.

---

## Part 2 — The side panel (while you're playing)

The bottom-right side panel during a Zetamac session shows three things:

- **Live counters** — your score, accuracy, and a rolling latency average as you go.
- **A draggable handle** — you can move the panel anywhere on screen. Position is remembered per-site.
- **A "Stop game" button** — ends the session cleanly and saves what you've done so far. Useful if you realise you're tired or distracted and want a clean stop rather than a junk session in your history.

The panel auto-clamps to the viewport if you resize your browser or open DevTools, so it never gets stranded off-screen.

**A note on what's measured:** every problem you solve is split into `t1` (think time — from the problem appearing to your first keystroke) and `t2` (type time — first keystroke to submit). This separation is the secret sauce. Typing speed varies based on how many digits an answer has; cognitive speed doesn't. ZetaCoach uses `t1` for weak-point detection so a 3-digit answer doesn't look like a "weakness" just because typing took longer.

---

## Part 3 — The dashboard tour

Click the ZetaCoach toolbar icon and select **Open Dashboard**, or click the dashboard button in the side panel.

You'll see five tabs across the top. Here's what each one is for and how to read it.

### Analytics tab

The "what just happened" view. At the top: your big four KPIs.

- **Avg Latency** — your overall median problem time, in milliseconds. Lower is faster.
- **P95** — the 95th percentile. The "even your slow problems" benchmark.
- **Error Rate** — percentage of problems you got wrong (caught via prefix-match — typing the wrong digits then correcting still counts).
- **DR%** — percentage of problems that landed in the Direct Retrieval zone (< 400ms). This is the gold metric. Elite Zetamac players sit at 80–90% DR.

Below the KPIs:

- **Fact-family heatmap** — a grid of multiplication and division facts coloured by your average latency. Green cells are direct retrieval, yellow are procedural calculation, red are systemic friction. Hover over a cell for sample count and exact latency.
- **Tag breakdown table** — every structural tag your problems are labelled with (Tens_Crossing, Perfect_Square, Hard_Divisor, etc.), with average latency, sample count, and a trend arrow showing whether you're improving, holding, or backsliding.

This tab is the diagnostic. When you want to understand *why* your score is what it is, come here.

### Drills tab

In-extension practice that doesn't touch Zetamac. Four modes:

- **Adaptive Weak-Point** — auto-focuses your 5 slowest tags at 70% frequency. The default and the most useful for general improvement.
- **Anti-Hesitation Metronome** — forcibly skips problems beyond your threshold. Trains rhythm recovery; teaches your brain to bail and move on when stuck.
- **Stamina Endurance** — extended fixed-length sprints. For users whose sessions decay in the last 30 seconds.
- **Free Practice** — pick your own ops and range. Standard drill mode for when you know what you want to work on.

Set the duration, hit Start. The arena renders problems one at a time. Type the answer. Wrong answers flash in red with the correct answer shown briefly. When the timer ends you get a results screen.

**Important:** drills in this tab do not save to your session history. They're ephemeral. The KPIs you see at the end are local to that drill. This is intentional — drill practice shouldn't get conflated with your real Zetamac performance numbers.

### History tab

Every Zetamac session you've ever played, newest first. Each row shows date, score, average latency, error rate, DR%, and a fatigue delta (Δ ms means how much slower your last 15 seconds were than your first 15 seconds — positive = you slowed down).

Click any row to expand a full problem-by-problem breakdown — the exact text, your `t1` and `t2`, error and skip flags, and the structural tags.

This is the audit log. Use it to verify Coach is right, to spot patterns across sessions, or to find that one session you're proud of.

### Coach tab

The headline feature. Coach takes the last 15 sessions matching your current Zetamac configuration, runs them through a statistical pipeline, and tells you exactly what to drill.

The pipeline (so you can trust the recommendations):

1. **Cognitive latency only.** Uses `t1` (think time), not total time. Typing speed isn't the signal.
2. **Post-error problems excluded.** When you make a mistake the next 1–2 problems are panic-recovery, not real skill. Coach ignores them for latency math but still counts them for error rate.
3. **Winsorization at 3× session median.** A single 12-second distraction can't poison your stats. The outlier gets clipped at read time; your raw data stays intact.
4. **Median, not mean.** Means get pulled by tails; medians don't.
5. **Pool-based bucketing.** Problems are grouped by what's cognitively hard about them, not by literal operand values:
   - Multiplication and division share fact-family pools (×7 and ÷7 are the same skill)
   - Addition and subtraction are pooled by digit-span (single+double, double+double) × carry status (carry/borrow vs none)
6. **Dynamic threshold.** A pool only qualifies as a weak point if it's slower than `(1 + threshold) × your global median`, where threshold scales with your speed — 15% if you're slow (less noise), 5% if you're elite (catches sub-second gaps).
7. **Speed vs. Accuracy split.** Pools where you're slow but accurate become **Speed** targets. Pools where you make a lot of errors become **Accuracy** targets (latency-agnostic). The two lists are independent.

Each weak-point row shows:

- The pool label (e.g., "×7 / ÷7 fact family" or "Double-digit with carry/borrow")
- A coloured `SPEED` or `ACCURACY` badge
- The latency or error rate
- A confidence line: "Based on N samples · last 15 sessions"

Click a row to select it as your drill target, then hit **Launch Coach Plan** at the bottom. ZetaCoach will inject the right config into Zetamac and reload — you land on the settings screen with the right operations checked and ranges pinned, ready to start.

**A quirk worth knowing:** Zetamac generates division as "multiplication in reverse." If Coach launches you into a `÷7` drill, half the problems will have 7 as the divisor (what you want) and half will have 7 as the answer. Both flavours drill the same fact family, so it's still useful, but expect a 50% on-target hit rate. The Coach UI mentions this inline for division targets.

### Settings tab

The boring but important stuff:

- **Theme** — orchid (default) or a couple of alternatives.
- **Weak-point focus frequency** — controls how often Adaptive drills serve a weak-tag problem vs. a random one. Default 70%.
- **Clear History** — wipes all your sessions, tier, and saved settings. Use with care; this is irreversible.
- **Privacy disclosure** — confirms all data is local.

---

## Part 4 — The 12-tier ranking system

ZetaCoach ranks you across 12 tiers based on your all-time best Zetamac score, defaulting to the standard 2-min addition/subtraction/multiplication/division config.

The tiers run roughly from Bronze (newcomer) up through Silver, Gold, Platinum, Diamond, Master, Grandmaster, and a few elite tiers at the top end. Each tier has a custom SVG icon shown in the popup, the dashboard's tier card, and as an overlay animation when you rank up.

The toolbar popup shows your current tier and how many points you need to hit the next. Rank-ups are saved to storage so they don't re-trigger every time you open the popup — only an actual *new* tier-up fires the celebration overlay.

If your best score drops because you cleared history or are practicing a different config, your tier resets to whatever your current best deserves. The tier is a snapshot of your peak, not your average.

---

## Part 5 — Playbooks (how to actually use this)

### Playbook A — "I just installed it"

1. Play 3 sessions back-to-back with your normal Zetamac config.
2. Open the dashboard. Coach should now show recommendations.
3. Don't act on the first set yet — just read them. Look at the fact-family heatmap on Analytics too. Compare what Coach surfaces to what you "felt" was hard.
4. Play 5 more sessions over the next few days. By session 8 or so, the recommendations have settled and you can trust them.

The temptation is to drill immediately. Resist. Coach gets sharper as your sample size grows; jumping into drills with a noisy initial weak-point list trains the wrong thing.

### Playbook B — "I've been plateaued at score N for weeks"

1. Open the Analytics tab. Look at your **DR%**. If it's below 60%, you have room to grow on automaticity — head to the Coach tab and act on the top **Speed** target.
2. If DR% is above 70%, look at **P95**. A high P95 means specific problems are killing your sessions even though most are fast. Coach's Speed targets are exactly these "long tail" problems.
3. Look at fatigue delta in the History tab. If your sessions consistently slow by 200ms+ in the last 15 seconds, run the **Stamina Endurance** drill from the Drills tab 2–3 times a week.
4. Look at your error rate. If it's above 8–10%, run an **Accuracy Drill** on the top accuracy pool. Slowing down 50ms to halve errors is almost always a net win on score.

The plateau-break sequence is usually: identify the bottleneck (speed vs. accuracy vs. endurance), drill that specifically for a week, retest. Don't chase three things at once.

### Playbook C — "I want to memorize the 12× table"

1. Drills tab → Free Practice mode.
2. Set range to 2–25, operations to multiplication only.
3. After a few sessions on the real Zetamac with mul-only and the 12× table prominent in your settings, Coach will surface "×12 / ÷12 fact family" as a Speed target. Click → Launch Coach Plan.
4. Zetamac loads with `mul_left = 12, mul_left_max = 12, mul_right = 2-25` — every problem has 12 as one factor. Play 5–10 sessions like this.
5. Watch the fact-family heatmap turn green for that row over the following week. The cell colour will shift from yellow → green as your latency drops below 400ms.

### Playbook D — "I want to switch from mixed to division-only training"

1. Change Zetamac settings to division only.
2. Play 1 session. Coach will re-enter "Still learning your new configuration" mode because your last 15 sessions don't match this config.
3. Play 2 more sessions with the new config. Coach unlocks at session 3.
4. From here, Coach will only use sessions matching this exact config — your old mixed-mode data sits in History but doesn't poison the recommendations.

This is the same mechanism that protects you if you accidentally play a "messing around" session — as long as the config differs from your serious config, it won't drag your weak-point analysis around.

### Playbook E — "I want pure cognitive numbers, no typing noise"

You already get this — Coach uses `t1` exclusively. But for *your own* curiosity:

1. Analytics tab → look at the tag table for ops you care about.
2. The latencies shown are total (`t1 + t2`) by design, because that's what you experience as the player. If you want to see `t1` only for a specific session, expand it in History — each problem shows both.
3. Rough rule of thumb: a 1-second `t1` on a single-digit answer is procedural calculation territory; you should aim to get most of those into direct retrieval (<400ms).

---

## Part 6 — Tips and tricks

- **Side panel position is per-site.** ZetaCoach remembers where you dragged the panel on `arithmetic.zetamac.com`. Drag it to wherever it doesn't block your peripheral vision when the problem appears.
- **The dashboard refreshes when a session ends.** If you have the dashboard open in one tab and play in another, the Coach view updates the second your timer hits zero. No need to manually reload.
- **Storage has a quota.** ZetaCoach keeps the most recent ~500 sessions. When you approach the limit it trims the oldest 25% and shows a small notice. Your best scores and tier are unaffected; you only lose deep history that the Coach window (last 15) doesn't use anyway.
- **Coach respects your config exactly.** It won't recommend mul drills when you're in division-only mode. The rolling window is filtered by `configHash` — change ranges, change durations, change which ops are checked, and you're effectively starting a new "context" in Coach's eyes.
- **The console has debug logs.** If you open DevTools on the Zetamac page or the dashboard, you'll see `[ZetaCoach]` lines on drill launches and Coach recomputes. Useful if something looks off — you can verify the config that was actually sent.
- **A session under ~20 problems isn't enough.** Coach's per-pool gate is 8 samples, and a single 30-second session usually only fills 2–3 pools to the threshold. Aim for 2-minute sessions at minimum.

---

## Part 7 — Privacy

ZetaCoach is 100% local. To be specific:

- Every problem, every session, every tier change, every setting — stored only in `chrome.storage.local`, scoped to the extension.
- No network requests are made by the extension. No analytics, no telemetry, no error reporting, no remote config.
- The source code is public at [github.com/zyrxun/zetacoach-extension](https://github.com/zyrxun/zetacoach-extension) so you can verify all of the above.
- Uninstall the extension and everything is wiped. There is no cloud copy to delete.

The only network activity that happens "near" ZetaCoach is what your browser does to load `arithmetic.zetamac.com` itself — a normal Zetamac page load, untouched by the extension.

---

## Part 8 — A philosophy of practice

Mental arithmetic improves predictably when you isolate weak points and grind them. ZetaCoach is built around three opinions:

1. **What you feel is wrong.** Players are bad at self-diagnosis. The fact-family you think is your weakness is often just the one you encounter most. Coach uses data, not vibe.
2. **One bad sample shouldn't anchor you.** A single 12-second distraction in a 100-problem session is noise, not signal. Winsorization prevents one bad day from shaping your training for weeks.
3. **Recent matters more than total.** A user with 50 sessions from 2 years ago and 5 from this week has the same "current form" as someone with just those 5. The rolling 15-session window biases toward present reality.

If you want to go from green to elite on Zetamac, the path is roughly: play consistently, look at Coach once a week, act on the top Speed target until it graduates out of the list, then move to the next. Don't chase shiny new techniques on YouTube; the gains are almost always in the boring grind on the exact pool Coach is pointing at.

---

## Part 9 — Troubleshooting

**"Coach says I have no weak points."**
You probably haven't accumulated enough samples per pool yet, or your performance is genuinely uniform. Play more sessions or check the per-pool sample counts via the dashboard. If you have 30+ sessions and Coach still says nothing, you might genuinely be at a plateau where everything is equally hard — try a Stamina or Metronome drill.

**"Coach surfaces a pool I never play."**
Make sure your Zetamac config matches what you actually want trained. Coach only analyses sessions matching your most recent config. If you played one mixed session by accident, that doesn't affect a series of mul-only sessions.

**"The dashboard says 'Still learning' even though I've played 10 sessions."**
You probably changed your Zetamac configuration. Coach treats each unique config as a separate context to avoid lumping unrelated sessions together. Play 3 sessions with the *current* config and the banner clears.

**"My side panel disappeared."**
You may have dragged it off-screen. Open the dashboard via the toolbar icon, then go to Settings → reset panel position. Or: the panel auto-clamps to viewport on the next page load, so just refresh `arithmetic.zetamac.com`.

**"The 'wrong answer' counter says zero but I definitely got things wrong."**
You're on a pre-v1.0.2 build. Update via the Chrome Web Store. The wrong-answer detection got a structural fix in v1.0.2 that uses prefix-matching against the correct answer instead of length-based comparison.

---

ZetaCoach is opinionated software for a specific audience: people who want to get measurably better at mental arithmetic and are willing to trust data over intuition. If you're that person, you'll get more from one focused weekly Coach review than from twenty random Zetamac sessions. Go drill.
