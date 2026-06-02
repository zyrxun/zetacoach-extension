// ZetaCoach Content Script — arithmetic.zetamac.com
// Injects a live side panel into the game page. Zero gameplay interference.

'use strict';

// ─── Real ZetaMac selectors (verified from live DOM) ──────────────────────────

const SEL_PROBLEM = 'span.problem';
const SEL_INPUT   = 'input.answer';
const SEL_SCORE   = 'p.correct';
const SEL_GAME    = '#game';

// ─── Session state ─────────────────────────────────────────────────────────────

let sessionActive      = false;
let sessionStartTime   = null;
let sessionProblems    = [];
let currentProblem     = null;
let postErrorCount     = 0;
let lastProblemText    = '';
let prevTimerVal       = null;
let panelEl            = null;
let liveInterval       = null;
let sessionWatchdog    = null;

// ─── Context liveness ─────────────────────────────────────────────────────────
// After an extension reload the content script's chrome.runtime context is
// invalidated. Any chrome API call throws. We check liveness before every
// call and tear everything down on first failure so nothing keeps throwing.

let _contextDead = false;

function isContextAlive() {
  if (_contextDead) return false;
  try { return !!chrome.runtime?.id; }
  catch (e) { _contextDead = true; teardown(); return false; }
}

function teardown() {
  // Stop the live-update interval and remove the panel so the dead script
  // leaves no visible artifacts on the page.
  if (liveInterval) { clearInterval(liveInterval); liveInterval = null; }
  const panel = document.getElementById('zc-panel');
  if (panel) panel.remove();
}

function safeSend(msg, cb) {
  if (!isContextAlive()) return;
  try { chrome.runtime.sendMessage(msg, cb); }
  catch (e) { _contextDead = true; teardown(); }
}

// ─── Boot ──────────────────────────────────────────────────────────────────────

function boot() {
  injectPanel();
  waitForGame();
  applyPendingConfig();
}

function applyPendingConfig() {
  const raw = sessionStorage.getItem('zetacoach_pending_config');
  if (!raw) return;
  sessionStorage.removeItem('zetacoach_pending_config');
  try {
    const payload = JSON.parse(raw);
    // Wait for ZetaMac's JS to finish rendering the pre-game settings form
    setTimeout(() => applyZetaMacConfig(payload), 400);
  } catch (e) { /* malformed — ignore */ }
}

function applyZetaMacConfig({ ops, ranges, duration, autoStart }) {
  const SEL = {
    addition:      'input[name="add"]',
    subtraction:   'input[name="sub"]',
    multiplication:'input[name="mul"]',
    division:      'input[name="div"]',
    duration:      'select[name="duration"]',
    add_left_min:  'input[name="add_left_min"]',
    add_left_max:  'input[name="add_left_max"]',
    add_right_min: 'input[name="add_right_min"]',
    add_right_max: 'input[name="add_right_max"]',
    mul_left_min:  'input[name="mul_left_min"]',
    mul_left_max:  'input[name="mul_left_max"]',
    mul_right_min: 'input[name="mul_right_min"]',
    mul_right_max: 'input[name="mul_right_max"]',
    startBtn:      'input[type="submit"]',
  };

  const inputSetter  = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,  'value').set;
  const selectSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;

  function setVal(sel, val) {
    const el = document.querySelector(sel);
    if (!el) return;
    if (el.tagName === 'SELECT') selectSetter.call(el, String(val));
    else inputSetter.call(el, String(val));
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setCheck(sel, checked) {
    const el = document.querySelector(sel);
    if (!el) return;
    if (el.checked !== checked) el.click();
  }

  if (duration) {
    const sel = document.querySelector(SEL.duration);
    if (sel) {
      const options = Array.from(sel.options).map(o => parseInt(o.value, 10));
      const closest = options.reduce((a, b) => Math.abs(b - duration) < Math.abs(a - duration) ? b : a);
      setVal(SEL.duration, closest);
    }
  }

  setCheck(SEL.addition,       !!ops?.addition);
  setCheck(SEL.subtraction,    !!ops?.subtraction);
  setCheck(SEL.multiplication, !!ops?.multiplication);
  setCheck(SEL.division,       !!ops?.division);

  console.debug('[ZetaCoach] applyZetaMacConfig setting ops:', ops, 'ranges:', ranges);

  if (ranges) {
    for (const [key, sel] of Object.entries(SEL)) {
      if (key in ranges) setVal(sel, ranges[key]);
    }
  }

  if (autoStart) {
    const btn = document.querySelector(SEL.startBtn);
    if (btn) btn.click();
  }
}

// ─── Wait for game elements ────────────────────────────────────────────────────

function waitForGame() {
  let tries = 0;
  const poll = setInterval(() => {
    tries++;
    if (tries > 150) { clearInterval(poll); return; }

    const gameEl    = document.querySelector(SEL_GAME);
    const problemEl = document.querySelector(SEL_PROBLEM);
    const inputEl   = document.querySelector(SEL_INPUT);

    if (!gameEl || !problemEl || !inputEl) return;

    clearInterval(poll);
    attachObservers(gameEl, problemEl, inputEl);
  }, 300);
}

// ─── Observers ────────────────────────────────────────────────────────────────

function attachObservers(gameEl, problemEl, inputEl) {

  // Watch #game text for "Seconds left: N" — session start/end detection
  new MutationObserver(() => {
    if (!isContextAlive()) return;
    const seconds = parseSeconds(gameEl.textContent);
    if (seconds === null) return;

    // Session start: first time we see a countdown value > 0
    if (!sessionActive && seconds > 0) {
      startSession(seconds);
    }

    // Session end: timer just hit 0
    if (sessionActive && seconds === 0 && prevTimerVal !== null && prevTimerVal > 0) {
      endSession(gameEl);
    }

    prevTimerVal = seconds;
  }).observe(gameEl, { childList: true, subtree: true, characterData: true });

  // Watch span.problem for new problem text
  new MutationObserver(() => {
    if (!isContextAlive()) return;
    const text = problemEl.textContent.trim();
    if (!text || text === lastProblemText) return;
    if (!sessionActive) return;
    lastProblemText = text;
    onNewProblem(text);
  }).observe(problemEl, { childList: true, subtree: true, characterData: true });

  // Input: keystroke timing
  inputEl.addEventListener('keydown',  onKeyDown,     { passive: true });
  inputEl.addEventListener('input',    onInputChange, { passive: true });
}

function parseSeconds(text) {
  const m = (text || '').match(/seconds\s+left[:\s]+(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

// ─── Session lifecycle ─────────────────────────────────────────────────────────

function startSession(initialSeconds) {
  sessionActive    = true;
  sessionStartTime = performance.now();
  sessionProblems  = [];
  postErrorCount   = 0;
  prevTimerVal     = initialSeconds;
  lastProblemText  = '';

  // Capture the problem already showing
  const problemEl = document.querySelector(SEL_PROBLEM);
  if (problemEl) {
    const t = problemEl.textContent.trim();
    if (t) { lastProblemText = t; onNewProblem(t); }
  }

  // Attach input listener if not yet done
  const inputEl = document.querySelector(SEL_INPUT);
  if (inputEl) {
    inputEl.addEventListener('keydown',  onKeyDown,     { passive: true });
    inputEl.addEventListener('input',    onInputChange, { passive: true });
  }

  setPanelState('live');
  startLiveUpdater();
  startSessionWatchdog();
}

// Fallback poller: if Zetamac swaps the #game node, the MutationObserver dies and
// we'd miss timer-zero forever. Re-query each tick and trigger endSession if the
// countdown reads 0 while we still think we're active.
function startSessionWatchdog() {
  if (sessionWatchdog) clearInterval(sessionWatchdog);
  sessionWatchdog = setInterval(() => {
    if (!sessionActive) { clearInterval(sessionWatchdog); sessionWatchdog = null; return; }
    const gameEl = document.querySelector(SEL_GAME);
    if (!gameEl) return;
    const seconds = parseSeconds(gameEl.textContent);
    if (seconds === 0 && prevTimerVal !== null && prevTimerVal > 0) {
      endSession(gameEl);
    }
    if (seconds !== null) prevTimerVal = seconds;
  }, 500);
}

function endSession(gameEl) {
  sessionActive = false;
  stopLiveUpdater();
  if (sessionWatchdog) { clearInterval(sessionWatchdog); sessionWatchdog = null; }

  if (currentProblem) finalizeCurrentProblem();

  // Read score: "Score: 12" → 12
  const scoreEl  = document.querySelector(SEL_SCORE);
  const score    = scoreEl
    ? parseInt((scoreEl.textContent || '').replace(/[^0-9]/g, ''), 10) || 0
    : 0;

  const payload = {
    timestamp:  Date.now(),
    score,
    durationMs: Math.round(performance.now() - sessionStartTime),
    problems:   sessionProblems.slice()
  };

  safeSend({ type: 'SESSION_COMPLETE', payload }, res => {
    if (res && res.ok) {
      if (res.result.tierUp) showTierUpOverlay(res.result.tierUp.to);
      showPostGamePanel(res.result);
    } else {
      showPostGamePanel({ score, problems: sessionProblems, stats: {} });
    }
  });
}

// ─── Problem tracking ──────────────────────────────────────────────────────────

function onNewProblem(text) {
  if (!sessionActive) return;
  if (currentProblem) finalizeCurrentProblem();

  prevInputVal = '';

  const tagged = window.ZetaAnalytics
    ? window.ZetaAnalytics.tagMathStructure(text)
    : { op: null, a: null, b: null, tags: [] };

  currentProblem = {
    text,
    op:            tagged.op,
    a:             tagged.a,
    b:             tagged.b,
    tags:          tagged.tags || [],
    t1Start:       performance.now(),
    t1End:         null,
    t2Start:       null,
    wasError:      false,
    isPostError:   postErrorCount > 0,
    relativeTime:  performance.now() - sessionStartTime,
    firstKeyTs:    null
  };

  if (postErrorCount > 0) postErrorCount--;
}

function finalizeCurrentProblem() {
  if (!currentProblem) return;
  const now = performance.now();

  if (!currentProblem.t1End) {
    currentProblem.t1End  = now;
    currentProblem.t2Start = now;
  }

  const t1      = Math.round(currentProblem.t1End - currentProblem.t1Start);
  const t2      = Math.round(now - currentProblem.t2Start);
  const total   = t1 + t2;
  const zone    = window.ZetaAnalytics
    ? window.ZetaAnalytics.categorizeSpeedZone(total)
    : (total < 400 ? 'Direct_Retrieval' : total < 1200 ? 'Procedural_Calculation' : 'Systemic_Friction');

  sessionProblems.push({
    text:         currentProblem.text,
    op:           currentProblem.op,
    a:            currentProblem.a,
    b:            currentProblem.b,
    tags:         currentProblem.tags,
    t1, t2, zone,
    wasError:     currentProblem.wasError,
    isPostError:  currentProblem.isPostError,
    relativeTime: currentProblem.relativeTime
  });

  currentProblem = null;
}

// ─── Input listeners ───────────────────────────────────────────────────────────

function onKeyDown(e) {
  if (!sessionActive || !currentProblem) return;
  if (!currentProblem.t1End) {
    currentProblem.t1End   = performance.now();
    currentProblem.t2Start = performance.now();
  }
}

let prevInputVal = '';
function onInputChange(e) {
  if (!sessionActive || !currentProblem) return;

  const val = e.target.value;

  if (val.length > 0) {
    const expected = computeAnswer(currentProblem);
    if (expected !== null) {
      const expectedStr = String(expected);
      // Wrong-path detection: any input that isn't a prefix of the correct answer is a mistake.
      // Single-flag per problem so a stuck-wrong user doesn't pile on the post-error counter.
      if (!expectedStr.startsWith(val) && !currentProblem.wasError) {
        currentProblem.wasError = true;
        postErrorCount = 2;
      }
    }
  }

  prevInputVal = val;
}

function computeAnswer(p) {
  if (!p || p.a === null || p.b === null) return null;
  switch (p.op) {
    case 'add': return p.a + p.b;
    case 'sub': return p.a - p.b;
    case 'mul': return p.a * p.b;
    case 'div': return p.b !== 0 ? p.a / p.b : null;
    default:    return null;
  }
}

// ─── Embedded Side Panel ───────────────────────────────────────────────────────

function injectPanel() {
  if (document.getElementById('zc-panel')) return;

  const style = document.createElement('style');
  style.textContent = PANEL_CSS;
  document.head.appendChild(style);

  panelEl = document.createElement('div');
  panelEl.id = 'zc-panel';
  panelEl.innerHTML = `
    <div id="zc-panel-header">
      <span id="zc-panel-logo">⚡ ZetaCoach</span>
      <button id="zc-panel-toggle" title="Collapse">−</button>
    </div>
    <div id="zc-panel-body">
      <div id="zc-idle-msg">Waiting for game…</div>
      <button class="zc-pg-btn" id="zc-btn-dashboard-idle" style="margin-top:8px;">Open Dashboard →</button>
      <div id="zc-live" style="display:none;">
        <div class="zc-live-row">
          <span class="zc-live-label">Comprehension</span>
          <span class="zc-live-val" id="zc-live-t1">—</span>
        </div>
        <div class="zc-live-row">
          <span class="zc-live-label">Execution</span>
          <span class="zc-live-val" id="zc-live-t2">—</span>
        </div>
        <div class="zc-live-row">
          <span class="zc-live-label">Avg Latency</span>
          <span class="zc-live-val" id="zc-live-avg">—</span>
        </div>
        <div class="zc-live-divider"></div>
        <div class="zc-live-row">
          <span class="zc-live-label">Correct</span>
          <span class="zc-live-val" id="zc-live-correct">0</span>
        </div>
        <div class="zc-live-row">
          <span class="zc-live-label">Errors</span>
          <span class="zc-live-val" id="zc-live-errors">0</span>
        </div>
        <div class="zc-live-row">
          <span class="zc-live-label">Speed Zone</span>
          <span class="zc-live-val" id="zc-live-zone">—</span>
        </div>
        <button class="zc-stop-btn" id="zc-btn-stop-game" title="Abort game and return to settings">■ Stop Game</button>
      </div>
      <div id="zc-postgame" style="display:none;"></div>
    </div>
  `;

  document.body.appendChild(panelEl);

  // Click logo or idle button to open dashboard
  document.getElementById('zc-panel-logo').addEventListener('click', () => {
    safeSend({ type: 'OPEN_DASHBOARD', section: 'analytics' });
  });
  document.getElementById('zc-btn-dashboard-idle').addEventListener('click', () => {
    safeSend({ type: 'OPEN_DASHBOARD', section: 'analytics' });
  });

  // Stop game: save partial data and return to settings screen
  document.getElementById('zc-btn-stop-game').addEventListener('click', () => {
    if (!sessionActive) return;
    if (currentProblem) finalizeCurrentProblem();
    sessionActive = false;
    stopLiveUpdater();

    if (sessionProblems.length >= 3) {
      const scoreEl = document.querySelector(SEL_SCORE);
      const score   = scoreEl
        ? parseInt((scoreEl.textContent || '').replace(/[^0-9]/g, ''), 10) || 0
        : 0;
      safeSend({ type: 'SESSION_COMPLETE', payload: {
        timestamp:  Date.now(),
        score,
        durationMs: Math.round(performance.now() - sessionStartTime),
        problems:   sessionProblems.slice(),
        partial:    true
      }});
    }

    location.href = location.origin + '/';
  });

  // Draggable header — user can reposition the panel anywhere
  makeDraggable(panelEl, document.getElementById('zc-panel-header'));

  // Toggle collapse
  let collapsed = false;
  document.getElementById('zc-panel-toggle').addEventListener('click', () => {
    collapsed = !collapsed;
    document.getElementById('zc-panel-body').style.display = collapsed ? 'none' : 'block';
    document.getElementById('zc-panel-toggle').textContent = collapsed ? '+' : '−';
  });
}

function setPanelState(state) {
  if (!panelEl) return;
  document.getElementById('zc-idle-msg').style.display    = state === 'idle'     ? 'block' : 'none';
  document.getElementById('zc-live').style.display        = state === 'live'     ? 'block' : 'none';
  document.getElementById('zc-postgame').style.display    = state === 'postgame' ? 'block' : 'none';
}

// ─── Live panel updater ────────────────────────────────────────────────────────

function startLiveUpdater() {
  stopLiveUpdater();
  liveInterval = setInterval(updateLivePanel, 200);
}

function stopLiveUpdater() {
  if (liveInterval) { clearInterval(liveInterval); liveInterval = null; }
}

function updateLivePanel() {
  if (!panelEl || !isContextAlive()) return;
  const probs   = sessionProblems;
  const correct = probs.filter(p => !p.wasError);
  const errors  = probs.filter(p => p.wasError);

  // Current problem in-flight T1
  let t1Disp = '—', t2Disp = '—', zoneDisp = '—';
  if (currentProblem && currentProblem.t1End === null) {
    t1Disp = Math.round(performance.now() - currentProblem.t1Start) + 'ms';
  } else if (currentProblem && currentProblem.t1End) {
    t1Disp = Math.round(currentProblem.t1End - currentProblem.t1Start) + 'ms';
    t2Disp = Math.round(performance.now() - currentProblem.t2Start) + 'ms';
  }

  // Last completed problem's zone
  if (probs.length > 0) {
    const last = probs[probs.length - 1];
    zoneDisp = last.zone === 'Direct_Retrieval'      ? 'Direct Retrieval'
             : last.zone === 'Procedural_Calculation' ? 'Procedural'
             : 'Systemic Friction';
    const zoneEl = document.getElementById('zc-live-zone');
    if (zoneEl) {
      zoneEl.textContent = zoneDisp;
      zoneEl.className   = 'zc-live-val zc-zone-' +
        (last.zone === 'Direct_Retrieval' ? 'dr' : last.zone === 'Procedural_Calculation' ? 'proc' : 'fric');
    }
  }

  // Avg latency over last 5 correct problems
  const recent = correct.slice(-5);
  const avg = recent.length
    ? Math.round(recent.reduce((s, p) => s + p.t1 + p.t2, 0) / recent.length)
    : null;

  setText('zc-live-t1',      t1Disp);
  setText('zc-live-t2',      t2Disp);
  setText('zc-live-avg',     avg ? avg + 'ms' : '—');
  setText('zc-live-correct', correct.length);
  setText('zc-live-errors',  errors.length);
}

// ─── Post-game panel ───────────────────────────────────────────────────────────

function showPostGamePanel(session) {
  setPanelState('postgame');

  const stats       = session.stats || {};
  const problems    = session.problems || [];
  const prescriptions = window.ZetaAnalytics
    ? window.ZetaAnalytics.generatePrescriptions({ problems, stats }, null)
    : [];

  const zones   = stats.zones || {};
  const total   = stats.totalProblems || problems.length || 1;
  const drPct   = Math.round((zones.Direct_Retrieval || 0) / total * 100);
  const procPct = Math.round((zones.Procedural_Calculation || 0) / total * 100);
  const fricPct = Math.round((zones.Systemic_Friction || 0) / total * 100);

  const rxHTML = prescriptions.slice(0, 3).map(rx => `
    <div class="zc-rx zc-rx-${rx.severity}">
      <div class="zc-rx-title">${escHtml(rx.title)}</div>
      <div class="zc-rx-body">${escHtml(truncateWords(rx.detail, 90))}</div>
    </div>
  `).join('') || '<div class="zc-rx-clean">✓ Clean session</div>';

  document.getElementById('zc-postgame').innerHTML = `
    <div class="zc-pg-score">${session.score || 0}</div>
    <div class="zc-pg-score-lbl">Score</div>

    <div class="zc-pg-stat-row">
      <span class="zc-pg-stat-label">Avg Latency</span>
      <span class="zc-pg-stat-val">${stats.avgLatencyMs || '—'}ms</span>
    </div>
    <div class="zc-pg-stat-row">
      <span class="zc-pg-stat-label">Errors</span>
      <span class="zc-pg-stat-val zc-bad">${stats.errorCount || 0}</span>
    </div>
    <div class="zc-pg-stat-row">
      <span class="zc-pg-stat-label">Comprehension avg</span>
      <span class="zc-pg-stat-val">${stats.avgT1Ms || '—'}ms</span>
    </div>
    <div class="zc-pg-stat-row">
      <span class="zc-pg-stat-label">Execution avg</span>
      <span class="zc-pg-stat-val">${stats.avgT2Ms || '—'}ms</span>
    </div>

    <div class="zc-pg-zones">
      <div class="zc-zone-bar">
        <div class="zc-zone-seg zc-zone-dr"   style="flex:${drPct}"   title="Direct Retrieval">${drPct}%</div>
        <div class="zc-zone-seg zc-zone-proc" style="flex:${procPct}" title="Procedural">${procPct}%</div>
        <div class="zc-zone-seg zc-zone-fric" style="flex:${fricPct}" title="Systemic Friction">${fricPct}%</div>
      </div>
    </div>

    <div class="zc-pg-rx-label">⚡ Prescriptions</div>
    <div class="zc-pg-rx">${rxHTML}</div>

    <button class="zc-pg-btn" id="zc-btn-dashboard">Full Stats →</button>
  `;

  document.getElementById('zc-btn-dashboard').addEventListener('click', () => {
    safeSend({ type: 'OPEN_DASHBOARD', section: 'analytics' });
  });
}

// ─── Draggable Panel ───────────────────────────────────────────────────────────

const PANEL_POS_KEY = 'zetacoach_panel_pos';

function makeDraggable(panel, handle) {
  // Restore saved position, but clamp into the current viewport in case the
  // window is smaller than when it was saved (e.g. DevTools responsive mode).
  try {
    const saved = JSON.parse(localStorage.getItem(PANEL_POS_KEY) || 'null');
    if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
      requestAnimationFrame(() => {
        const rect = panel.getBoundingClientRect();
        const left = Math.max(0, Math.min(window.innerWidth  - rect.width,  saved.left));
        const top  = Math.max(0, Math.min(window.innerHeight - rect.height, saved.top));
        applyPanelPos(panel, left, top);
      });
    }
  } catch (e) { /* malformed — ignore */ }

  // Keep the panel visible if the viewport shrinks (DevTools, window resize)
  window.addEventListener('resize', () => {
    const rect = panel.getBoundingClientRect();
    if (rect.right > window.innerWidth || rect.bottom > window.innerHeight || rect.left < 0 || rect.top < 0) {
      const left = Math.max(0, Math.min(window.innerWidth  - rect.width,  rect.left));
      const top  = Math.max(0, Math.min(window.innerHeight - rect.height, rect.top));
      applyPanelPos(panel, left, top);
    }
  });

  let dragging = false;
  let startX = 0, startY = 0;
  let startLeft = 0, startTop = 0;

  handle.style.cursor = 'grab';

  handle.addEventListener('mousedown', e => {
    // Don't start drag when clicking the collapse button
    if (e.target.id === 'zc-panel-toggle') return;
    e.preventDefault();
    dragging = true;
    const rect = panel.getBoundingClientRect();
    startLeft = rect.left;
    startTop  = rect.top;
    startX    = e.clientX;
    startY    = e.clientY;
    handle.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const rect = panel.getBoundingClientRect();
    // Clamp within viewport so the panel never disappears off-screen
    const left = Math.max(0, Math.min(window.innerWidth  - rect.width,  startLeft + dx));
    const top  = Math.max(0, Math.min(window.innerHeight - rect.height, startTop  + dy));
    applyPanelPos(panel, left, top);
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    handle.style.cursor = 'grab';
    document.body.style.userSelect = '';
    // Persist position
    const rect = panel.getBoundingClientRect();
    try {
      localStorage.setItem(PANEL_POS_KEY, JSON.stringify({ left: rect.left, top: rect.top }));
    } catch (e) { /* storage full or blocked — ignore */ }
  });
}

function applyPanelPos(panel, left, top) {
  panel.style.left   = `${left}px`;
  panel.style.top    = `${top}px`;
  panel.style.right  = 'auto';
  panel.style.bottom = 'auto';
}

// ─── Tier-Up Overlay ───────────────────────────────────────────────────────────

function showTierUpOverlay(tier) {
  // Remove any existing overlay
  const existing = document.getElementById('zc-tierup');
  if (existing) existing.remove();

  const el = document.createElement('div');
  el.id = 'zc-tierup';
  const svg = window.ZetaTiers ? window.ZetaTiers.svgFor(tier.name) : '';
  el.innerHTML = `
    <div id="zc-tierup-inner">
      <div id="zc-tierup-icon">${svg}</div>
      <div id="zc-tierup-label">Tier Up!</div>
      <div id="zc-tierup-name">${tier.name}</div>
      ${tier.topPct != null ? `<div id="zc-tierup-pct">Top ${tier.topPct}% of players</div>` : ''}
    </div>
  `;
  document.body.appendChild(el);

  // Auto-dismiss after 4s
  setTimeout(() => {
    el.classList.add('zc-tierup-out');
    setTimeout(() => el.remove(), 600);
  }, 4000);
}

// ─── Utilities ─────────────────────────────────────────────────────────────────

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function truncateWords(s, maxChars) {
  const str = String(s || '');
  if (str.length <= maxChars) return str;
  const trimmed = str.slice(0, maxChars).replace(/\s+\S*$/, '');
  return (trimmed || str.slice(0, maxChars)) + '…';
}

// ─── Tier-Up + Panel CSS (injected inline so no external file needed) ─────────

const PANEL_CSS = `

/* ── Tier-Up Overlay ───────────────────────────────────────────────────────── */
@keyframes zc-tierup-in {
  0%   { opacity: 0; transform: translate(-50%, -50%) scale(0.7); }
  60%  { opacity: 1; transform: translate(-50%, -50%) scale(1.08); }
  100% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
}
@keyframes zc-tierup-shimmer {
  0%   { background-position: -200% center; }
  100% { background-position: 200% center; }
}
@keyframes zc-tierup-particles {
  0%   { opacity: 1; transform: translateY(0) scale(1); }
  100% { opacity: 0; transform: translateY(-60px) scale(0.4); }
}

#zc-tierup {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  pointer-events: none;
  background: rgba(0,0,0,0.55);
  backdrop-filter: blur(3px);
  animation: none;
  transition: opacity 0.6s;
}
#zc-tierup.zc-tierup-out {
  opacity: 0;
}
#zc-tierup-inner {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) scale(1);
  background: #0e0e18;
  border: 1px solid rgba(224,146,199,0.25);
  border-radius: 24px;
  padding: 36px 52px 30px;
  text-align: center;
  box-shadow: 0 0 80px rgba(224,146,199,0.2), 0 20px 60px rgba(0,0,0,0.7);
  font-family: 'Inter','Segoe UI','SF Pro Display',system-ui,sans-serif;
  animation: zc-tierup-in 0.55s cubic-bezier(.22,.68,0,1.2) forwards;
  min-width: 260px;
}
#zc-tierup-icon {
  width: 80px;
  height: 80px;
  margin: 0 auto 12px;
  filter: drop-shadow(0 0 18px rgba(224,146,199,0.5));
}
#zc-tierup-icon svg {
  width: 100%;
  height: 100%;
}
#zc-tierup-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: #e092c7;
  margin-bottom: 6px;
  background: linear-gradient(90deg, #e092c7, #8a8bcf, #e092c7);
  background-size: 200% auto;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: zc-tierup-shimmer 1.8s linear infinite;
}
#zc-tierup-name {
  font-size: 38px;
  font-weight: 800;
  color: #fff;
  letter-spacing: -0.01em;
  line-height: 1.1;
  margin-bottom: 10px;
}
#zc-tierup-pct {
  font-size: 12px;
  color: #8a8bcf;
  font-weight: 500;
  letter-spacing: 0.04em;
}

#zc-panel {
  position: fixed;
  bottom: 14px;
  right: 14px;
  z-index: 2147483640;
  width: 210px;
  background: #121214;
  border: 1px solid #25252a;
  border-radius: 16px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.55), 0 2px 8px rgba(0,0,0,0.4), 0 0 0 1px rgba(224,146,199,0.06);
  font-family: 'Inter','Segoe UI','SF Pro Display',system-ui,sans-serif;
  font-size: 11px;
  color: #d4d4e8;
  user-select: none;
  transition: opacity 0.15s;
}

#zc-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px 7px;
  border-bottom: 1px solid #1e1e23;
  background: rgba(26,26,30,0.9);
  border-radius: 16px 16px 0 0;
}

#zc-panel-logo {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #e092c7;
  cursor: pointer;
}
#zc-panel-logo:hover { opacity: 0.8; }

#zc-panel-toggle {
  background: none;
  border: none;
  color: #44445a;
  font-size: 15px;
  cursor: pointer;
  line-height: 1;
  padding: 0 1px;
  font-family: inherit;
  transition: color 0.12s;
}
#zc-panel-toggle:hover { color: #e092c7; }

#zc-panel-body { padding: 10px 12px; }

#zc-idle-msg {
  font-size: 10px;
  color: #44445a;
  text-align: center;
  padding: 8px 0;
  letter-spacing: 0.03em;
}

/* Live stats */
.zc-live-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 3px 0;
}
.zc-live-label {
  color: #55556a;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.04em;
}
.zc-live-val {
  font-weight: 700;
  color: #e092c7;
  font-variant-numeric: tabular-nums;
  font-size: 11px;
}

.zc-zone-dr   { color: #719c81 !important; }
.zc-zone-proc { color: #8a8bcf !important; }
.zc-zone-fric { color: #c97070 !important; }

.zc-live-divider {
  height: 1px;
  background: #1e1e23;
  margin: 5px 0;
}

/* Post-game score */
.zc-pg-score {
  font-size: 36px;
  font-weight: 800;
  color: #e092c7;
  text-align: center;
  letter-spacing: -0.01em;
  line-height: 1.1;
}
.zc-pg-score-lbl {
  font-size: 9px;
  text-align: center;
  color: #44445a;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  font-weight: 600;
  margin-bottom: 10px;
}

.zc-pg-stat-row {
  display: flex;
  justify-content: space-between;
  padding: 3px 0;
  border-bottom: 1px solid #1a1a1e;
}
.zc-pg-stat-label { color: #55556a; font-size: 10px; font-weight: 500; }
.zc-pg-stat-val   { color: #9090aa; font-weight: 600; font-variant-numeric: tabular-nums; }
.zc-bad           { color: #c97070 !important; }

/* Zone distribution bar */
.zc-pg-zones { margin: 10px 0 5px; }
.zc-zone-bar {
  display: flex;
  height: 5px;
  border-radius: 4px;
  overflow: hidden;
  gap: 1px;
}
.zc-zone-seg {
  min-width: 3px;
  border-radius: 3px;
  font-size: 0;
}
.zc-zone-seg.zc-zone-dr   { background: #719c81; }
.zc-zone-seg.zc-zone-proc { background: #8a8bcf; }
.zc-zone-seg.zc-zone-fric { background: #c97070; }

/* Prescriptions */
.zc-pg-rx-label {
  font-size: 9px;
  color: #8a8bcf;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  font-weight: 700;
  margin: 8px 0 5px;
}
.zc-pg-rx { display: flex; flex-direction: column; gap: 5px; }

.zc-rx {
  padding: 6px 8px;
  border-radius: 8px;
  border-left: 2px solid #2a2a35;
  background: #1a1a1e;
}
.zc-rx.zc-rx-critical { border-left-color: #c97070; }
.zc-rx.zc-rx-warning  { border-left-color: #8a8bcf; }
.zc-rx.zc-rx-info     { border-left-color: #e092c7; }
.zc-rx-title { font-weight: 700; font-size: 10px; color: #d4d4e8; margin-bottom: 2px; }
.zc-rx-body  { font-size: 9px; color: #55556a; line-height: 1.5; }
.zc-rx-clean { font-size: 10px; color: #719c81; text-align: center; padding: 5px; font-weight: 600; }

/* Stop game button */
.zc-stop-btn {
  display: block;
  width: 100%;
  margin-top: 10px;
  background: rgba(201,112,112,0.12);
  color: #c97070;
  border: 1px solid rgba(201,112,112,0.25);
  border-radius: 7px;
  padding: 5px 0;
  font-family: inherit;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.07em;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.zc-stop-btn:hover {
  background: rgba(201,112,112,0.22);
  border-color: rgba(201,112,112,0.45);
}

/* Full stats button */
.zc-pg-btn {
  display: block;
  width: 100%;
  margin-top: 10px;
  background: linear-gradient(135deg, #a17592 0%, #8a8bcf 100%);
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 7px 0;
  font-family: inherit;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  cursor: pointer;
  box-shadow: 0 2px 10px rgba(161,117,146,0.3);
  transition: opacity 0.15s, box-shadow 0.15s;
}
.zc-pg-btn:hover {
  opacity: 0.88;
  box-shadow: 0 4px 14px rgba(161,117,146,0.45);
}
`;

// ─── Partial session rescue on tab close ──────────────────────────────────────
// If the user closes the tab mid-game, save whatever problems were captured.
// Uses sendBeacon via a background message so the write completes even as the
// page is unloading. Requires at least 3 problems to be worth saving.

window.addEventListener('beforeunload', () => {
  if (!sessionActive || sessionProblems.length < 3 || !isContextAlive()) return;

  // Finalize any in-flight problem
  if (currentProblem) finalizeCurrentProblem();

  const scoreEl  = document.querySelector(SEL_SCORE);
  const score    = scoreEl
    ? parseInt((scoreEl.textContent || '').replace(/[^0-9]/g, ''), 10) || 0
    : 0;

  const payload = {
    timestamp:  Date.now(),
    score,
    durationMs: Math.round(performance.now() - sessionStartTime),
    problems:   sessionProblems.slice(),
    partial:    true   // flag so dashboard can show "⚠ partial" badge
  };

  // sendMessage with keepalive — fires even during unload in MV3
  safeSend({ type: 'SESSION_COMPLETE', payload });
});

// ─── ZetaMac Auto-Configure ────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (!isContextAlive()) return;
  if (msg.type === 'DIAGNOSTIC_SELECTORS') {
    const results = [];
    document.querySelectorAll('input, select, button').forEach(el => {
      results.push({ tag: el.tagName, type: el.type, name: el.name, id: el.id, className: el.className, value: el.value });
    });
    console.log('[ZetaCoach diagnostic]', JSON.stringify(results, null, 2));
    return;
  }
  if (msg.type !== 'CONFIGURE_ZETAMAC') return;

  // If a game is currently running the settings form is hidden.
  // Stash the config and reload so the pre-game screen is shown.
  if (sessionActive) {
    sessionStorage.setItem('zetacoach_pending_config', JSON.stringify(msg.payload));
    location.href = location.origin + '/';
    return;
  }

  applyZetaMacConfig(msg.payload);
});

// ─── Start ─────────────────────────────────────────────────────────────────────

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
