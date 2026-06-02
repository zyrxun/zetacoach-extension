// ZetaCoach Dashboard — standalone extension page
// Loads analytics.js first (via script tag in dashboard.html), then this file.

'use strict';

// ─── App State ────────────────────────────────────────────────────────────────

const State = {
  sessions:        [],        // raw session objects from storage
  allProblems:     [],        // flattened across all loaded sessions
  settings:        {},        // loaded from background
  activeSection:   'analytics',
  heatmapOp:       'mul',     // currently displayed heatmap operation
  sessionRange:    20,

  // History tab state
  history: {
    range:             20,
    expandedSessionId: null
  },

  // Drill runtime state
  drill: {
    mode:          'adaptive',
    active:        false,
    paused:        false,
    durationMs:    90000,
    remainingMs:   90000,
    timerHandle:   null,
    metronomeHandle: null,
    problemStartTs:  null,     // performance.now() when problem appeared
    firstKeystrokeTs: null,
    currentProblem:  null,
    problems:        [],       // problems completed in this drill run
    score:           0,
    errors:          0,
    skipped:         0,
    streak:          0,
    weakTags:        [],       // computed once at drill start
    lastResultMode:  null
  },

  coachPlan:        null,   // stashed by renderCoach() for the launch button
  coachTargetIdx:   0       // which target is currently selected for launch
};

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // Hard dependency check — if analytics.js failed to load, render a friendly error
  // instead of letting downstream renders explode with `ZetaAnalytics is not defined`.
  if (!window.ZetaAnalytics || !window.ZetaTiers) {
    document.body.classList.remove('app-loading');
    document.body.innerHTML =
      '<div style="padding:40px;text-align:center;font-family:Inter,system-ui,sans-serif;color:#d4d4e8;background:#121214;min-height:100vh;">' +
        '<h2 style="color:#c97070;">ZetaCoach failed to initialize</h2>' +
        '<p style="opacity:.7;">A required script did not load. Try reloading the page, or reinstall the extension.</p>' +
      '</div>';
    return;
  }

  await loadSettings();
  await loadData();
  applyInitialSection();
  bindNav();
  bindAnalyticsControls();
  bindDrillControls();
  bindSettingsControls();
  bindHeatmapControls();
  bindHistoryControls();
  renderAnalytics();
  renderTierCard();
  document.body.classList.remove('app-loading');

  // Listen for new sessions saved while this tab is open
  chrome.runtime.onMessage.addListener(msg => {
    if (msg.type === 'SESSION_SAVED') {
      State.sessions.unshift(msg.session);
      State.allProblems = flattenProblems(State.sessions);
      renderAnalytics();
      renderTierCard();
      if (msg.tierUp) showDashboardTierUp(msg.tierUp.to);
      if (State.activeSection === 'history') renderHistory();
      if (State.activeSection === 'coach')   renderCoach();
    }
    if (msg.type === 'STORAGE_TRIMMED') {
      showStorageNotice(`Storage was getting full — dropped ${msg.dropped} oldest sessions to make room.`);
    }
    if (msg.type === 'STORAGE_ERROR') {
      showStorageNotice(`Storage error: ${msg.error}. Try clearing history.`, true);
    }
  });

  document.getElementById('btn-coach-launch').addEventListener('click', () => {
    if (State.coachPlan) applyCoachPlan(State.coachPlan);
  });

  document.getElementById('btn-coach-next').addEventListener('click', () => {
    const plan = State.coachPlan;
    if (!plan || !plan.targets.length) return;
    State.coachTargetIdx = (State.coachTargetIdx + 1) % Math.min(3, plan.targets.length);
    plan.primary = plan.targets[State.coachTargetIdx];
    highlightCoachTarget(State.coachTargetIdx);
    renderCoachPlanGrid(plan);
  });
});

// ─── Data Loading ─────────────────────────────────────────────────────────────

async function loadSettings() {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, res => {
      State.settings = (res && res.ok) ? res.settings : {
        metronomeThresholdMs: 800,
        weakPointFrequency:   0.70,
        weakPointWindowSize:  5,
        weakPointGraduateMs:  600,
        defaultDrillDuration: 90,
        staminaDuration:      180
      };
      resolve();
    });
  });
}

async function loadData() {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'GET_SESSIONS', limit: 200 }, res => {
      if (res && res.ok) {
        State.sessions    = res.sessions;
        State.allProblems = flattenProblems(res.sessions);
      }
      const countEl = document.getElementById('nav-session-count');
      if (countEl) countEl.textContent = `${State.sessions.length} session${State.sessions.length !== 1 ? 's' : ''}`;
      resolve();
    });
  });
}

function flattenProblems(sessions) {
  const out = [];
  for (const s of sessions) {
    for (const p of (s.problems || [])) {
      out.push({ ...p, sessionId: s.id, sessionTs: s.timestamp });
    }
  }
  return out;
}

// ─── Navigation ───────────────────────────────────────────────────────────────

function applyInitialSection() {
  const params  = new URLSearchParams(window.location.search);
  const section = params.get('section') || 'analytics';
  switchSection(section);
}

function bindNav() {
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.addEventListener('click', () => switchSection(btn.dataset.section));
  });
}

function switchSection(name) {
  State.activeSection = name;
  document.querySelectorAll('.nav-tab').forEach(b => b.classList.toggle('active', b.dataset.section === name));
  document.querySelectorAll('.section').forEach(s => s.classList.toggle('active', s.id === `section-${name}`));
  if (name === 'settings') renderSettingsPage();
  if (name === 'analytics') renderAnalytics();
  // Canvas rendering wrapped in rAF so the browser completes tab-switch reflow
  // before we read container dimensions — prevents 0px-width canvas bugs.
  if (name === 'history') requestAnimationFrame(() => renderHistory());
  if (name === 'coach')   renderCoach();
}

// ─── Tier Card ────────────────────────────────────────────────────────────────

function renderTierCard() {
  chrome.runtime.sendMessage({ type: 'GET_TIER' }, res => {
    if (!res || !res.ok) return;
    const { tier, nextTier, bestScore } = res;

    const iconEl = document.getElementById('tier-icon');
    iconEl.innerHTML = window.ZetaTiers.svgFor(tier.name);
    iconEl.setAttribute('role', 'img');
    iconEl.setAttribute('aria-label', `${tier.name} tier`);
    document.getElementById('tier-name').textContent = tier.name;

    const pctEl = document.getElementById('tier-pct');
    pctEl.textContent = tier.topPct != null
      ? `Top ${tier.topPct}% of players  ·  Best score: ${bestScore}`
      : `Best score: ${bestScore}`;

    const progressWrap  = document.getElementById('tier-progress-wrap');
    const progressBar   = document.getElementById('tier-progress-bar');
    const progressLabel = document.getElementById('tier-progress-label');

    if (nextTier) {
      const range = Math.max(1, nextTier.min - tier.min);
      const pct   = Math.max(0, Math.min(100, Math.round(((bestScore - tier.min) / range) * 100)));
      progressWrap.style.display  = 'block';
      progressBar.style.width     = `${pct}%`;
      progressLabel.textContent   = `${bestScore} / ${nextTier.min} to ${nextTier.name}`;
    } else {
      progressWrap.style.display  = 'none';
      progressLabel.textContent   = 'Maximum tier reached';
    }
  });
}

function showStorageNotice(text, isError) {
  let el = document.getElementById('storage-notice');
  if (!el) {
    el = document.createElement('div');
    el.id = 'storage-notice';
    document.body.appendChild(el);
  }
  el.className = isError ? 'storage-notice storage-notice-error' : 'storage-notice';
  el.textContent = text;
  el.style.display = 'block';
  clearTimeout(showStorageNotice._t);
  showStorageNotice._t = setTimeout(() => { el.style.display = 'none'; }, 8000);
}

function showDashboardTierUp(tier) {
  const el = document.getElementById('tier-card');
  if (!el) return;
  el.classList.remove('tier-card-pop');
  void el.offsetWidth; // reflow to restart animation
  el.classList.add('tier-card-pop');
}

// ─── Analytics Section ────────────────────────────────────────────────────────

function bindAnalyticsControls() {
  document.getElementById('session-range-select').addEventListener('change', e => {
    State.sessionRange = e.target.value === 'all' ? 99999 : parseInt(e.target.value, 10);
    renderAnalytics();
  });
}

function getSessionsInRange() {
  return State.sessions.slice(0, State.sessionRange);
}

function getProblemsInRange() {
  return flattenProblems(getSessionsInRange());
}

function renderAnalytics() {
  const problems  = getProblemsInRange();
  const sessions  = getSessionsInRange();

  renderKPIs(problems, sessions);
  renderHeatmap(problems);
  renderPrescriptions(problems, sessions);
  renderTagTable(problems);
  renderSessionHistory(sessions);
}

function renderKPIs(problems, sessions) {
  if (!problems.length) {
    ['kpi-avg-score','kpi-avg-latency','kpi-p95','kpi-error-rate','kpi-dr-pct','kpi-fatigue']
      .forEach(id => {
        const el = document.getElementById(id);
        if (el) el.querySelector('.kpi-value').textContent = '—';
      });
    return;
  }

  const avgScore = sessions.length
    ? Math.round(sessions.reduce((s, x) => s + (x.score || 0), 0) / sessions.length)
    : 0;

  const latencies   = problems.map(p => p.t1 + p.t2);
  const avgLat      = Math.round(latencies.reduce((a,b) => a+b,0) / latencies.length);
  const sorted      = [...latencies].sort((a,b) => a-b);
  const p95         = sorted[Math.min(sorted.length-1, Math.ceil(0.95 * sorted.length)-1)];
  const errorRate   = Math.round(problems.filter(p => p.wasError).length / problems.length * 100);
  const drPct       = Math.round(problems.filter(p => p.zone === 'Direct_Retrieval').length / problems.length * 100);
  const fatigue     = ZetaAnalytics.computeFatigueCurve(problems);

  setKPI('kpi-avg-score',   avgScore);
  setKPI('kpi-avg-latency', `${avgLat}ms`);
  setKPI('kpi-p95',         `${p95}ms`);
  setKPI('kpi-error-rate',  `${errorRate}%`,  errorRate > 10 ? 'bad' : errorRate > 5 ? 'warn' : 'ok');
  setKPI('kpi-dr-pct',      `${drPct}%`,      drPct > 60 ? 'ok' : drPct > 30 ? 'warn' : 'bad');
  setKPI('kpi-fatigue',
    fatigue ? `${fatigue.deltaMs > 0 ? '+' : ''}${fatigue.deltaMs}ms` : '—',
    fatigue ? (fatigue.deltaMs > 200 ? 'bad' : fatigue.deltaMs > 50 ? 'warn' : 'ok') : ''
  );
}

function setKPI(id, value, sentiment) {
  const el = document.getElementById(id);
  if (!el) return;
  const valEl = el.querySelector('.kpi-value');
  valEl.textContent = value;
  el.className = 'kpi' + (sentiment ? ` kpi-${sentiment}` : '');
}

// ─── Heatmap ──────────────────────────────────────────────────────────────────

function bindHeatmapControls() {
  document.querySelectorAll('.hmap-op-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.hmap-op-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      State.heatmapOp = btn.dataset.op;
      renderHeatmap(getProblemsInRange());
    });
  });
}

function renderHeatmap(problems) {
  const op        = State.heatmapOp;
  const canvas    = document.getElementById('heatmap-canvas');
  const emptyEl   = document.getElementById('heatmap-empty');
  const tooltip   = document.getElementById('heatmap-tooltip');
  const matrix    = ZetaAnalytics.buildFactFamilyMatrix(problems, [op]);

  const entries = Object.keys(matrix);
  if (!entries.length) {
    canvas.style.display  = 'none';
    emptyEl.style.display = 'block';
    return;
  }
  emptyEl.style.display = 'none';
  canvas.style.display  = 'block';

  // Determine range of operands to display
  let minN = Infinity, maxN = 0;
  entries.forEach(k => {
    const cell = matrix[k];
    minN = Math.min(minN, cell.a, cell.b);
    maxN = Math.max(maxN, cell.a, cell.b);
  });
  minN = Math.max(minN, 2);
  maxN = Math.min(maxN, 25);

  const range    = maxN - minN + 1;
  const cellSize = Math.floor(Math.min(500, 500) / (range + 1));
  const offset   = cellSize;             // space for axis labels
  const total    = cellSize * (range + 1);

  canvas.width  = total;
  canvas.height = total;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, total, total);

  // Background
  ctx.fillStyle = '#0a0a14';
  ctx.fillRect(0, 0, total, total);

  // Axis labels
  ctx.fillStyle    = '#445';
  ctx.font         = `${Math.max(9, cellSize - 6)}px monospace`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';

  for (let i = 0; i < range; i++) {
    const n   = minN + i;
    const pos = offset + i * cellSize + cellSize / 2;
    ctx.fillText(n, pos, offset / 2);
    ctx.fillText(n, offset / 2, pos);
  }

  // Cells
  const ZONE_COLORS = {
    Direct_Retrieval:      '#719c81',
    Procedural_Calculation: '#8a8bcf',
    Systemic_Friction:     '#c97070'
  };

  // Store cell rects for tooltip
  const cellRects = [];

  for (let ri = 0; ri < range; ri++) {
    for (let ci = 0; ci < range; ci++) {
      const a   = minN + ri;
      const b   = minN + ci;
      const lo  = Math.min(a, b);
      const hi  = Math.max(a, b);
      const key = `${lo}×${hi}`;
      const cell = matrix[key];

      const x = offset + ci * cellSize;
      const y = offset + ri * cellSize;
      const pad = 2;

      if (cell) {
        const base  = ZONE_COLORS[cell.zone] || '#333';
        const alpha = 0.15 + Math.min(0.75, cell.count / 10) * 0.85;

        ctx.fillStyle = hexToRgba(base, alpha);
        ctx.fillRect(x + pad, y + pad, cellSize - pad*2, cellSize - pad*2);

        // Latency text
        ctx.fillStyle = base;
        ctx.font      = `${Math.max(8, cellSize - 10)}px monospace`;
        ctx.fillText(`${cell.avgLatencyMs}`, x + cellSize / 2, y + cellSize / 2);

        cellRects.push({ x, y, w: cellSize, h: cellSize, a, b, cell });
      } else {
        ctx.fillStyle = '#0f0f1e';
        ctx.fillRect(x + pad, y + pad, cellSize - pad*2, cellSize - pad*2);
      }
    }
  }

  // Tooltip on mousemove
  canvas.onmousemove = e => {
    const rect = canvas.getBoundingClientRect();
    const mx   = (e.clientX - rect.left) * (canvas.width  / rect.width);
    const my   = (e.clientY - rect.top)  * (canvas.height / rect.height);

    const hit = cellRects.find(r => mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h);
    if (hit) {
      tooltip.style.display = 'block';
      const opSym = { mul: '×', div: '÷', add: '+', sub: '−' }[op] || op;
      tooltip.innerHTML = `
        <strong>${hit.a} ${opSym} ${hit.b}</strong><br>
        Avg: ${hit.cell.avgLatencyMs}ms<br>
        Zone: ${hit.cell.zone.replace(/_/g,' ')}<br>
        Samples: ${hit.cell.count}
      `;
      // Clamp to viewport so tooltip stays visible near edges
      const ttRect = tooltip.getBoundingClientRect();
      const pad    = 8;
      let left = e.clientX + 12;
      let top  = e.clientY - 20;
      if (left + ttRect.width  > window.innerWidth  - pad) left = e.clientX - ttRect.width - 12;
      if (top  + ttRect.height > window.innerHeight - pad) top  = window.innerHeight - ttRect.height - pad;
      if (top < pad) top = pad;
      tooltip.style.left = `${left}px`;
      tooltip.style.top  = `${top}px`;
    } else {
      tooltip.style.display = 'none';
    }
  };
  canvas.onmouseleave = () => { tooltip.style.display = 'none'; };
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ─── Prescriptions ────────────────────────────────────────────────────────────

function renderPrescriptions(problems, sessions) {
  const container = document.getElementById('prescriptions-list');
  const label     = document.getElementById('rx-session-label');
  if (!container) return;

  if (!problems.length) {
    container.innerHTML = '<div class="empty-state">No session data loaded.</div>';
    if (label) label.textContent = '—';
    return;
  }

  const fakeSession = { problems, stats: ZetaAnalytics.aggregateProblems(problems) };
  const rxList      = ZetaAnalytics.generatePrescriptions(fakeSession, null);

  if (label) label.textContent = `${sessions.length} session${sessions.length !== 1 ? 's' : ''}`;

  if (!rxList.length) {
    container.innerHTML = '<div class="empty-state clean">✓ No critical patterns detected across selected range.</div>';
    return;
  }

  container.innerHTML = rxList.map(rx => `
    <div class="rx-card rx-${rx.severity}">
      <div class="rx-header">
        <span class="rx-severity-dot"></span>
        <span class="rx-title">${escHtml(rx.title)}</span>
      </div>
      <p class="rx-detail">${escHtml(rx.detail)}</p>
      <button class="rx-drill-btn" data-drill-type="${escHtml(rx.drillParams.type)}"
              data-drill-tags="${escHtml(JSON.stringify(rx.drillParams.tags || []))}"
              data-drill-duration="${rx.drillParams.duration || 90}"
              data-drill-threshold="${rx.drillParams.threshold || 800}">
        ⚡ ${escHtml(rx.drill)}
      </button>
    </div>
  `).join('');

  container.querySelectorAll('.rx-drill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const type      = btn.dataset.drillType;
      const tags      = JSON.parse(btn.dataset.drillTags || '[]');
      const duration  = parseInt(btn.dataset.drillDuration, 10) || 90;
      const threshold = parseInt(btn.dataset.drillThreshold, 10) || 800;
      launchDrillFromPrescription({ type, tags, duration, threshold });
    });
  });
}

function launchDrillFromPrescription({ type, tags, duration, threshold }) {
  switchSection('drills');

  // Select the corresponding mode button
  const modeMap = { adaptive: 'adaptive', metronome: 'metronome', stamina: 'stamina', free: 'free' };
  const mode    = modeMap[type] || 'adaptive';
  document.querySelectorAll('.drill-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  State.drill.mode = mode;

  document.getElementById('cfg-duration').value         = duration;
  document.getElementById('cfg-duration-val').textContent = `${duration}s`;

  if (mode === 'metronome') {
    document.getElementById('cfg-threshold').value         = threshold;
    document.getElementById('cfg-threshold-val').textContent = `${threshold}ms`;
  }

  updateDrillConfigPanels(mode);
  startDrill();
}

// ─── Tag Breakdown Table ──────────────────────────────────────────────────────

function renderTagTable(problems) {
  const tbody = document.getElementById('tag-table-body');
  if (!tbody) return;

  if (!problems.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">No data</td></tr>';
    return;
  }

  const tagStats = {};
  problems.forEach(p => {
    const lat = p.t1 + p.t2;
    (p.tags || []).forEach(tag => {
      if (!tagStats[tag]) tagStats[tag] = { latencies: [], sessionSets: {} };
      tagStats[tag].latencies.push(lat);
    });
  });

  // Compute session-bucketed averages for trend arrow
  const recentProblems = flattenProblems(State.sessions.slice(0, 5));
  const olderProblems  = flattenProblems(State.sessions.slice(5, 20));
  const recentTagAvg   = computeTagAvgMap(recentProblems);
  const olderTagAvg    = computeTagAvgMap(olderProblems);

  const rows = Object.entries(tagStats)
    .map(([tag, data]) => {
      const avg   = Math.round(data.latencies.reduce((a,b)=>a+b,0) / data.latencies.length);
      const zone  = ZetaAnalytics.categorizeSpeedZone(avg);
      const trend = olderTagAvg[tag]
        ? (avg < olderTagAvg[tag] - 20 ? 'improving' : avg > olderTagAvg[tag] + 20 ? 'worsening' : 'stable')
        : 'stable';
      return { tag, avg, zone, count: data.latencies.length, trend };
    })
    .sort((a, b) => b.avg - a.avg);

  const ZONE_CLASS = {
    Direct_Retrieval:      'zone-dr',
    Procedural_Calculation: 'zone-proc',
    Systemic_Friction:     'zone-fric'
  };
  const TREND_ICON  = { improving: '▼', worsening: '▲', stable: '▶' };
  const TREND_CLASS = { improving: 'trend-good', worsening: 'trend-bad', stable: 'trend-neutral' };

  tbody.innerHTML = rows.map(r => `
    <tr>
      <td class="tag-name">${escHtml(r.tag)}</td>
      <td>${r.avg}ms</td>
      <td><span class="zone-badge ${ZONE_CLASS[r.zone]}">${r.zone.replace(/_/g,' ')}</span></td>
      <td>${r.count}</td>
      <td class="${TREND_CLASS[r.trend]}">${TREND_ICON[r.trend]}</td>
    </tr>
  `).join('');
}

function computeTagAvgMap(problems) {
  const map = {};
  const counts = {};
  problems.forEach(p => {
    const lat = p.t1 + p.t2;
    (p.tags || []).forEach(tag => {
      map[tag]    = (map[tag] || 0) + lat;
      counts[tag] = (counts[tag] || 0) + 1;
    });
  });
  Object.keys(map).forEach(t => { map[t] = Math.round(map[t] / counts[t]); });
  return map;
}

// ─── Session History ──────────────────────────────────────────────────────────

function renderSessionHistory(sessions) {
  const container = document.getElementById('session-history-list');
  if (!container) return;

  if (!sessions.length) {
    container.innerHTML = '<div class="empty-state">No sessions recorded yet.</div>';
    return;
  }

  container.innerHTML = sessions.slice(0, 30).map(s => {
    const st    = s.stats || {};
    const date  = new Date(s.timestamp).toLocaleDateString(undefined, { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
    const fatigue = st.fatigue || {};
    return `
      <div class="session-row${s.partial ? ' session-row-partial' : ''}">
        <div class="session-date">${date}</div>
        <div class="session-score score-val">${s.score || 0}</div>
        <div class="session-lat">${st.avgLatencyMs || '—'}ms</div>
        <div class="session-err">${st.errorRate || 0}% err</div>
        <div class="session-dr">${st.zones ? Math.round((st.zones.Direct_Retrieval||0)/Math.max(st.totalProblems,1)*100) : '—'}% DR</div>
        <div class="session-fatigue ${fatigue.deltaMs > 200 ? 'text-bad' : ''}">${fatigue.deltaMs !== null && fatigue.deltaMs !== undefined ? `Δ${fatigue.deltaMs > 0 ? '+' : ''}${fatigue.deltaMs}ms` : '—'}</div>
      </div>
    `;
  }).join('');
}

// ─── Drills Section ───────────────────────────────────────────────────────────

function bindDrillControls() {
  // Mode selection
  document.querySelectorAll('.drill-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.drill-mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      State.drill.mode = btn.dataset.mode;
      updateDrillConfigPanels(btn.dataset.mode);
    });
  });

  // Duration slider
  const durSlider = document.getElementById('cfg-duration');
  const durVal    = document.getElementById('cfg-duration-val');
  durSlider.addEventListener('input', () => { durVal.textContent = `${durSlider.value}s`; });

  // Metronome threshold slider
  const thrSlider = document.getElementById('cfg-threshold');
  const thrVal    = document.getElementById('cfg-threshold-val');
  thrSlider.addEventListener('input', () => { thrVal.textContent = `${thrSlider.value}ms`; });

  // Stamina sprint buttons
  document.querySelectorAll('.sprint-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sprint-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('cfg-duration').value = btn.dataset.dur;
      durVal.textContent = `${btn.dataset.dur}s`;
    });
  });

  // Start drill
  document.getElementById('btn-start-drill').addEventListener('click', () => startDrill());

  // Stop drill
  document.getElementById('btn-stop-drill').addEventListener('click', () => stopDrill(true));

  // Arena input
  const arenaInput = document.getElementById('arena-input');
  arenaInput.addEventListener('keydown', e => {
    if (!State.drill.active) return;
    if (State.drill.firstKeystrokeTs === null) {
      State.drill.firstKeystrokeTs = performance.now();
    }
    // Enter submits whatever is typed (handles wrong-answer confirmation)
    if (e.key === 'Enter' || e.keyCode === 13) {
      submitDrillAnswer(arenaInput.value.trim());
    }
  });
  arenaInput.addEventListener('input', () => {
    if (!State.drill.active) return;
    const val = arenaInput.value.trim();
    if (val.length > 0 && State.drill.firstKeystrokeTs === null) {
      State.drill.firstKeystrokeTs = performance.now();
    }
    // Auto-submit the instant the typed value matches the correct answer
    const problem = State.drill.currentProblem;
    if (problem && val.length > 0) {
      const typed = parseInt(val, 10);
      if (Number.isFinite(typed) && typed === problem.answer) {
        submitDrillAnswer(val);
      }
    }
  });

  // Results actions
  document.getElementById('btn-results-again').addEventListener('click', () => startDrill());
  document.getElementById('btn-results-analytics').addEventListener('click', () => switchSection('analytics'));
}

function updateDrillConfigPanels(mode) {
  document.getElementById('cfg-metronome-panel').style.display = mode === 'metronome' ? 'block' : 'none';
  document.getElementById('cfg-free-panel').style.display      = mode === 'free'      ? 'block' : 'none';
  document.getElementById('cfg-stamina-panel').style.display   = mode === 'stamina'   ? 'block' : 'none';

  // Duration slider: stamina overrides to sprint button value
  if (mode === 'stamina') {
    const activeBtn = document.querySelector('.sprint-btn.active');
    const dur = activeBtn ? parseInt(activeBtn.dataset.dur, 10) : 180;
    document.getElementById('cfg-duration').value         = dur;
    document.getElementById('cfg-duration-val').textContent = `${dur}s`;
  }
}

// ─── Drill Engine ─────────────────────────────────────────────────────────────

function startDrill() {
  if (State.drill.active) stopDrill(false);

  const mode     = State.drill.mode;
  const duration = parseInt(document.getElementById('cfg-duration').value, 10) * 1000;
  const threshold = mode === 'metronome'
    ? parseInt(document.getElementById('cfg-threshold').value, 10)
    : State.settings.metronomeThresholdMs || 800;

  // Compute weak tags from stored problem history for adaptive / metronome modes.
  let weakTags = [];
  if ((mode === 'adaptive' || mode === 'metronome') && State.allProblems.length >= 5) {
    const weakPoints = ZetaAnalytics.getWeakPoints(
      State.allProblems,
      State.settings.weakPointWindowSize || 5,
      3,
      State.settings.weakPointGraduateMs || 600
    );
    weakTags = weakPoints.map(w => w.tag);
  }

  Object.assign(State.drill, {
    active:           true,
    mode,
    durationMs:       duration,
    remainingMs:      duration,
    threshold,
    weakTags,
    currentProblem:   null,
    problems:         [],
    score:            0,
    errors:           0,
    skipped:          0,
    streak:           0,
    problemStartTs:   null,
    firstKeystrokeTs: null,
    lastResultMode:   mode
  });

  // Show arena
  showArenaState('active');
  document.getElementById('arena-mode-badge').textContent = modeBadgeLabel(mode);

  // Reset live stats
  updateLiveStats();

  // Start countdown
  const tickMs   = 100;
  let lastTickTs = performance.now();
  State.drill.timerHandle = setInterval(() => {
    const now   = performance.now();
    const delta = now - lastTickTs;
    lastTickTs  = now;
    State.drill.remainingMs = Math.max(0, State.drill.remainingMs - delta);
    renderTimerDisplay(State.drill.remainingMs);

    if (State.drill.remainingMs <= 0) {
      stopDrill(false);
    }
  }, tickMs);

  // First problem
  nextDrillProblem();
}

function stopDrill(userInitiated) {
  if (!State.drill.active && !userInitiated) return;
  State.drill.active = false;

  clearInterval(State.drill.timerHandle);
  clearTimeout(State.drill.metronomeHandle);
  State.drill.timerHandle   = null;
  State.drill.metronomeHandle = null;

  if (userInitiated && State.drill.problems.length === 0) {
    showArenaState('idle');
    return;
  }

  showDrillResults();
}

function nextDrillProblem() {
  if (!State.drill.active) return;
  clearTimeout(State.drill.metronomeHandle);

  const mode     = State.drill.mode;
  const settings = buildProblemGenSettings();
  let problem  = ZetaAnalytics.generateProblem(settings);

  // Defensive: if the generator hands back something with undefined operands or symbol,
  // log the offender and regenerate once via a safe fallback.
  if (!problem || !problem.str || problem.str.includes('undefined') || problem.answer == null) {
    console.warn('[ZetaCoach] malformed problem from generator, retrying with safe fallback', { problem, settings });
    problem = ZetaAnalytics.generateProblem({ ops: ['add'], range: [2, 25], focusTags: [], weakPointFreq: 0 });
  }

  State.drill.currentProblem   = problem;
  State.drill.problemStartTs   = performance.now();
  State.drill.firstKeystrokeTs = null;

  // Render
  document.getElementById('arena-problem-display').textContent = problem.str || '—';
  document.getElementById('arena-input').value = '';
  document.getElementById('arena-input').focus();
  document.getElementById('arena-feedback').textContent = '';
  document.getElementById('arena-feedback').className   = 'arena-feedback';

  // Render tags
  const tagBadges = document.getElementById('arena-tag-badges');
  tagBadges.innerHTML = (problem.tags || []).map(t =>
    `<span class="tag-badge">${t.replace(/_/g,' ')}</span>`
  ).join('');

  // Metronome: schedule forced skip
  if (mode === 'metronome' || mode === 'adaptive') {
    const skipMs = mode === 'metronome'
      ? State.drill.threshold
      : 2000;  // adaptive has a generous soft cap (not forced in adaptive mode)
    if (mode === 'metronome') {
      State.drill.metronomeHandle = setTimeout(() => {
        if (State.drill.active && State.drill.currentProblem === problem) {
          forcedSkip(problem);
        }
      }, skipMs);
    }
  }

  // Progress bar for metronome
  const progressWrap = document.getElementById('arena-progress-wrap');
  const progressBar  = document.getElementById('arena-progress-bar');
  if (mode === 'metronome') {
    progressWrap.style.display = 'block';
    progressBar.style.transition = 'none';
    progressBar.style.width      = '100%';
    // Force reflow then animate
    progressBar.getBoundingClientRect();
    progressBar.style.transition = `width ${State.drill.threshold}ms linear`;
    progressBar.style.width      = '0%';
  } else {
    progressWrap.style.display = 'none';
  }
}

function forcedSkip(problem) {
  if (!State.drill.active) return;
  State.drill.skipped++;
  State.drill.streak = 0;

  recordDrillProblem(problem, null, true, false);

  flashFeedback('SKIP', 'skip');
  updateLiveStats();
  nextDrillProblem();
}

function submitDrillAnswer(rawValue) {
  if (!State.drill.active || !State.drill.currentProblem) return;
  clearTimeout(State.drill.metronomeHandle);

  const problem    = State.drill.currentProblem;
  const inputInt   = parseInt(rawValue, 10);
  const correct    = Number.isFinite(inputInt) && inputInt === problem.answer;

  if (!correct) {
    State.drill.errors++;
    State.drill.streak = 0;
    flashFeedback(`✕ ${problem.answer ?? '?'}`, 'error');
    recordDrillProblem(problem, rawValue, false, false);
    updateLiveStats();

    // Clear input and offer next problem after brief delay
    document.getElementById('arena-input').value = '';
    setTimeout(() => { if (State.drill.active) nextDrillProblem(); }, 400);
    return;
  }

  State.drill.score++;
  State.drill.streak++;
  flashFeedback('✓', 'correct');
  recordDrillProblem(problem, rawValue, false, true);
  updateLiveStats();
  nextDrillProblem();
}

function recordDrillProblem(problem, rawAnswer, skipped, correct) {
  const now      = performance.now();
  const t1Start  = State.drill.problemStartTs || now;
  const t1End    = State.drill.firstKeystrokeTs || now;
  const t2End    = now;

  const t1 = Math.round(Math.max(0, t1End - t1Start));
  const t2 = Math.round(Math.max(0, t2End - t1End));

  State.drill.problems.push({
    ...problem,
    t1,
    t2,
    wasError:     !correct && !skipped,
    skipped,
    isPostError:  false,
    relativeTime: now - (State.drill.durationMs - State.drill.remainingMs),
    zone:         ZetaAnalytics.categorizeSpeedZone(t1 + t2)
  });
}

function buildProblemGenSettings() {
  const mode    = State.drill.mode;
  const weakFreq = State.settings.weakPointFrequency || 0.70;

  switch (mode) {
    case 'adaptive':
      return {
        ops:           ['add','sub','mul','div'],
        range:         [2, 25],
        focusTags:     State.drill.weakTags,
        weakPointFreq: weakFreq
      };

    case 'metronome':
      return {
        ops:           ['add','sub','mul','div'],
        range:         [2, 25],
        focusTags:     State.drill.weakTags,
        weakPointFreq: weakFreq * 0.5  // lighter bias in metronome (rhythm matters more)
      };

    case 'stamina':
      return { ops: ['add','sub','mul','div'], range: [2, 25], focusTags: [], weakPointFreq: 0 };

    case 'free': {
      const checkedOps = [...document.querySelectorAll('.config-checkboxes input:checked')]
        .map(cb => cb.dataset.op)
        .filter(Boolean);
      const minEl = document.getElementById('cfg-range-min');
      const maxEl = document.getElementById('cfg-range-max');
      let minR = parseInt(minEl?.value, 10);
      let maxR = parseInt(maxEl?.value, 10);
      if (!Number.isFinite(minR) || minR < 1) minR = 2;
      if (!Number.isFinite(maxR) || maxR < 2) maxR = 25;
      // Swap if user inverted the range so we don't generate empty intervals
      if (minR > maxR) [minR, maxR] = [maxR, minR];
      return { ops: checkedOps.length ? checkedOps : ['add'], range: [minR, maxR], focusTags: [], weakPointFreq: 0 };
    }

    default:
      return { ops: ['add','sub','mul','div'], range: [2, 25], focusTags: [], weakPointFreq: 0 };
  }
}

function renderTimerDisplay(remainingMs) {
  const totalSecs = Math.ceil(remainingMs / 1000);
  const mins      = Math.floor(totalSecs / 60);
  const secs      = totalSecs % 60;
  const el        = document.getElementById('arena-timer-display');
  el.textContent  = `${mins}:${String(secs).padStart(2,'0')}`;
  el.className    = remainingMs < 10000 ? 'timer-critical' : '';
}

function updateLiveStats() {
  const d = State.drill;
  document.getElementById('lst-correct').textContent = d.score;
  document.getElementById('lst-errors').textContent  = d.errors;
  document.getElementById('lst-skipped').textContent = d.skipped;
  document.getElementById('lst-streak').textContent  = d.streak;
  document.getElementById('arena-score-display').textContent = d.score;

  if (d.problems.length > 0) {
    const correctProblems = d.problems.filter(p => !p.wasError && !p.skipped);
    if (correctProblems.length) {
      const avg = Math.round(
        correctProblems.reduce((s, p) => s + p.t1 + p.t2, 0) / correctProblems.length
      );
      document.getElementById('lst-avg-lat').textContent = `${avg}ms`;
    }
  }
}

function flashFeedback(text, type) {
  const el  = document.getElementById('arena-feedback');
  el.textContent = text;
  el.className   = `arena-feedback feedback-${type}`;
  // Force reflow to restart animation
  void el.offsetWidth;
  el.classList.add('feedback-animate');
}

function showArenaState(state) {
  document.getElementById('arena-idle').style.display    = state === 'idle'    ? 'flex' : 'none';
  document.getElementById('arena-active').style.display  = state === 'active'  ? 'flex' : 'none';
  document.getElementById('arena-results').style.display = state === 'results' ? 'flex' : 'none';
}

function modeBadgeLabel(mode) {
  return { adaptive: 'ADAPTIVE', metronome: 'METRONOME', stamina: 'STAMINA', free: 'FREE DRILL' }[mode] || mode.toUpperCase();
}

// ─── Drill Results ────────────────────────────────────────────────────────────

function showDrillResults() {
  showArenaState('results');

  const d        = State.drill;
  const problems = d.problems;
  const total    = problems.length;
  const correct  = problems.filter(p => !p.wasError && !p.skipped).length;
  const avgLat   = total > 0
    ? Math.round(problems.reduce((s, p) => s + p.t1 + p.t2, 0) / total)
    : 0;

  const kpiHtml = [
    ['Score',       correct],
    ['Total',       total],
    ['Errors',      d.errors],
    ['Skipped',     d.skipped],
    ['Avg Latency', `${avgLat}ms`]
  ].map(([label, val]) => `
    <div class="results-kpi">
      <div class="results-kpi-val">${val}</div>
      <div class="results-kpi-lbl">${label}</div>
    </div>
  `).join('');

  document.getElementById('results-kpis').innerHTML = kpiHtml;

  // Quick prescriptions from drill session
  const fakeSession = { problems, stats: ZetaAnalytics.aggregateProblems(problems) };
  const rxList      = ZetaAnalytics.generatePrescriptions(fakeSession, null);
  const rxContainer = document.getElementById('results-rx');

  if (rxList.length) {
    rxContainer.innerHTML = rxList.slice(0, 3).map(rx => `
      <div class="results-rx-item rx-${rx.severity}">
        <strong>${escHtml(rx.title)}</strong>
        <span>${escHtml(truncateWords(rx.detail, 100))}</span>
      </div>
    `).join('');
  } else {
    rxContainer.innerHTML = '<div class="results-rx-item clean">✓ Clean drill. No critical patterns detected.</div>';
  }
}

// ─── Settings Page ────────────────────────────────────────────────────────────

function applyTheme(name) {
  const t = (name === 'orchid' || !name) ? '' : name;
  document.documentElement.dataset.theme = t || 'orchid';
  document.querySelectorAll('.theme-swatch').forEach(s => {
    s.classList.toggle('active', s.dataset.theme === (t || 'orchid'));
  });
}

function bindSettingsControls() {
  // Theme picker
  document.querySelectorAll('.theme-swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
      const theme = swatch.dataset.theme;
      applyTheme(theme);
      chrome.storage.local.set({ zetacoach_theme: theme });
    });
  });

  // Load saved theme on init
  chrome.storage.local.get('zetacoach_theme', data => {
    if (data.zetacoach_theme) applyTheme(data.zetacoach_theme);
  });

  document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
  document.getElementById('btn-settings-clear').addEventListener('click', () => {
    document.getElementById('clear-confirm-row').style.display = '';
    document.getElementById('btn-settings-clear').style.display = 'none';
  });
  document.getElementById('btn-clear-cancel').addEventListener('click', () => {
    document.getElementById('clear-confirm-row').style.display = 'none';
    document.getElementById('btn-settings-clear').style.display = '';
  });
  document.getElementById('btn-clear-confirm').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'CLEAR_HISTORY' }, () => {
      State.sessions    = [];
      State.allProblems = [];
      document.getElementById('clear-confirm-row').style.display = 'none';
      document.getElementById('btn-settings-clear').style.display = '';
      document.getElementById('nav-session-count').textContent = '0 sessions';
      renderAnalytics();
      renderTierCard();
      renderSettingsPage();
    });
  });
}

function renderSettingsPage() {
  const s = State.settings;
  setInputVal('set-drill-duration',      s.defaultDrillDuration || 90);
  setInputVal('set-metronome-threshold', s.metronomeThresholdMs  || 800);
  setInputVal('set-stamina-duration',    s.staminaDuration       || 180);
  setInputVal('set-wp-frequency',        s.weakPointFrequency    || 0.70);
  setInputVal('set-wp-pool',             s.weakPointWindowSize   || 5);
  setInputVal('set-wp-graduate',         s.weakPointGraduateMs   || 600);

  // Storage info
  chrome.storage.local.getBytesInUse(null, bytes => {
    const kb = (bytes / 1024).toFixed(1);
    const el = document.getElementById('storage-info');
    if (el) el.textContent = `${State.sessions.length} sessions stored · ${kb} KB used`;
  });
}

function saveSettings() {
  const settings = {
    defaultDrillDuration: intVal('set-drill-duration'),
    metronomeThresholdMs:  intVal('set-metronome-threshold'),
    staminaDuration:       intVal('set-stamina-duration'),
    weakPointFrequency:    floatVal('set-wp-frequency'),
    weakPointWindowSize:   intVal('set-wp-pool'),
    weakPointGraduateMs:   intVal('set-wp-graduate')
  };
  State.settings = settings;
  chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings }, () => {
    const indicator = document.getElementById('settings-saved-indicator');
    indicator.style.display = 'inline';
    setTimeout(() => { indicator.style.display = 'none'; }, 2000);
  });
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function escHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function truncateWords(s, maxChars) {
  const str = String(s || '');
  if (str.length <= maxChars) return str;
  const trimmed = str.slice(0, maxChars).replace(/\s+\S*$/, '');
  return (trimmed || str.slice(0, maxChars)) + '…';
}

function setInputVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

function intVal(id) {
  return parseInt(document.getElementById(id)?.value || '0', 10);
}

// ═══════════════════════════════════════════════════════════════════════════════
// HISTORY TAB
// ═══════════════════════════════════════════════════════════════════════════════

function bindHistoryControls() {
  document.getElementById('history-range-select').addEventListener('change', e => {
    State.history.range = e.target.value === 'all' ? 99999 : parseInt(e.target.value, 10);
    requestAnimationFrame(() => renderHistory());
  });
}

function getHistorySessions() {
  return State.sessions.slice(0, State.history.range);
}

function renderHistory() {
  const sessions = getHistorySessions();
  renderHistoryRecords(sessions);
  renderTrendChart(sessions);
  renderTagSparklines(sessions);
  renderSessionDrilldown(sessions);
}

// ─── Personal Records KPI strip ───────────────────────────────────────────────

function renderHistoryRecords(sessions) {
  const RECORD_IDS = ['hrec-best-score','hrec-best-latency','hrec-dr-streak','hrec-clean-streak'];

  if (!sessions.length) {
    RECORD_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.querySelector('.kpi-value').textContent = '—';
    });
    return;
  }

  // Best score
  const bestScore = Math.max(...sessions.map(s => s.score || 0));

  // Best avg latency (lowest positive)
  let bestLatency = Infinity;
  sessions.forEach(s => {
    const lat = s.stats && s.stats.avgLatencyMs;
    if (lat && lat > 0) bestLatency = Math.min(bestLatency, lat);
  });

  // Longest Direct Retrieval streak across all problems (oldest → newest)
  let longestDR = 0, currentDR = 0;
  [...sessions].reverse().forEach(s => {
    (s.problems || []).forEach(p => {
      if (p.zone === 'Direct_Retrieval') {
        currentDR++;
        if (currentDR > longestDR) longestDR = currentDR;
      } else {
        currentDR = 0;
      }
    });
  });

  // Clean streak (most-recent first, stop on first session with errorRate > 10)
  let cleanStreak = 0;
  for (const s of sessions) {
    const rate = (s.stats && s.stats.errorRate != null) ? s.stats.errorRate : 100;
    if (rate <= 10) cleanStreak++;
    else break;
  }

  setKPI('hrec-best-score',   bestScore);
  setKPI('hrec-best-latency', bestLatency === Infinity ? '—' : `${bestLatency}ms`, 'ok');
  setKPI('hrec-dr-streak',    longestDR);
  setKPI('hrec-clean-streak', cleanStreak,
    cleanStreak >= 5 ? 'ok' : cleanStreak >= 2 ? 'warn' : '');
}

// ─── Trend Chart ─────────────────────────────────────────────────────────────
// Dual-axis canvas line chart: Score (solid cyan) + Avg Latency (dashed yellow).
// rAF is called by switchSection before renderHistory — DOM dimensions are safe here.

function renderTrendChart(sessions) {
  const canvas   = document.getElementById('trend-chart-canvas');
  const emptyEl  = document.getElementById('trend-chart-empty');

  if (!sessions || sessions.length < 2) {
    canvas.style.display  = 'none';
    emptyEl.style.display = 'block';
    return;
  }
  emptyEl.style.display = 'none';
  canvas.style.display  = 'block';

  // Oldest-first for left-to-right chronological display
  const data = [...sessions].reverse().map(s => ({
    date:    new Date(s.timestamp),
    score:   s.score || 0,
    latency: (s.stats && s.stats.avgLatencyMs) ? s.stats.avgLatencyMs : null
  }));

  const n = data.length;
  const MARGIN = { left: 52, right: 54, top: 24, bottom: 38 };
  const W = Math.max(460, n * 36 + MARGIN.left + MARGIN.right);
  const H = 200;
  canvas.width  = W;
  canvas.height = H;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#08080f';
  ctx.fillRect(0, 0, W, H);

  const plotW = W - MARGIN.left - MARGIN.right;
  const plotH = H - MARGIN.top  - MARGIN.bottom;

  // Y ranges
  const scores   = data.map(d => d.score);
  const minScore = Math.max(0, Math.min(...scores) - 5);
  const maxScore = Math.max(...scores) + 5;

  const lats      = data.map(d => d.latency).filter(v => v !== null);
  const minLat    = lats.length ? Math.max(0, Math.min(...lats) - 100) : 0;
  const maxLat    = lats.length ? Math.max(...lats) + 100 : 2000;

  const xOf      = i => MARGIN.left + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
  const yScore   = v => MARGIN.top + plotH - ((v - minScore)  / (maxScore - minScore  || 1)) * plotH;
  const yLatency = v => MARGIN.top + plotH - ((v - minLat)    / (maxLat   - minLat    || 1)) * plotH;

  // Horizontal grid lines (5)
  ctx.strokeStyle = '#1a1a38';
  ctx.lineWidth   = 1;
  for (let g = 0; g <= 4; g++) {
    const y = MARGIN.top + (g / 4) * plotH;
    ctx.beginPath();
    ctx.moveTo(MARGIN.left, y);
    ctx.lineTo(MARGIN.left + plotW, y);
    ctx.stroke();
  }

  // Left axis: Score labels (pink)
  ctx.fillStyle    = '#e092c7';
  ctx.font         = '10px monospace';
  ctx.textAlign    = 'right';
  ctx.textBaseline = 'middle';
  for (let g = 0; g <= 4; g++) {
    const v = minScore + ((maxScore - minScore) * (4 - g) / 4);
    ctx.fillText(Math.round(v), MARGIN.left - 6, MARGIN.top + (g / 4) * plotH);
  }

  // Right axis: Latency labels (lavender)
  ctx.fillStyle = '#8a8bcf';
  ctx.textAlign = 'left';
  for (let g = 0; g <= 4; g++) {
    const v = minLat + ((maxLat - minLat) * (4 - g) / 4);
    ctx.fillText(`${Math.round(v)}`, MARGIN.left + plotW + 6, MARGIN.top + (g / 4) * plotH);
  }

  // Score: translucent area fill
  ctx.beginPath();
  data.forEach((d, i) => {
    i === 0 ? ctx.moveTo(xOf(i), yScore(d.score)) : ctx.lineTo(xOf(i), yScore(d.score));
  });
  ctx.lineTo(xOf(n - 1), MARGIN.top + plotH);
  ctx.lineTo(xOf(0),     MARGIN.top + plotH);
  ctx.closePath();
  ctx.fillStyle = 'rgba(224,146,199,0.07)';
  ctx.fill();

  // Score: solid line
  ctx.beginPath();
  data.forEach((d, i) => {
    i === 0 ? ctx.moveTo(xOf(i), yScore(d.score)) : ctx.lineTo(xOf(i), yScore(d.score));
  });
  ctx.strokeStyle = '#e092c7';
  ctx.lineWidth   = 2;
  ctx.setLineDash([]);
  ctx.stroke();

  // Score: dots
  data.forEach((d, i) => {
    ctx.beginPath();
    ctx.arc(xOf(i), yScore(d.score), 3, 0, Math.PI * 2);
    ctx.fillStyle = '#e092c7';
    ctx.fill();
  });

  // Latency: dashed line (only non-null points)
  const latPts = data.map((d, i) => d.latency !== null ? { i, v: d.latency } : null).filter(Boolean);
  if (latPts.length >= 2) {
    ctx.beginPath();
    latPts.forEach((pt, idx) => {
      idx === 0 ? ctx.moveTo(xOf(pt.i), yLatency(pt.v)) : ctx.lineTo(xOf(pt.i), yLatency(pt.v));
    });
    ctx.strokeStyle = '#8a8bcf';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);

    latPts.forEach(pt => {
      ctx.beginPath();
      ctx.arc(xOf(pt.i), yLatency(pt.v), 2.5, 0, Math.PI * 2);
      ctx.fillStyle = '#8a8bcf';
      ctx.fill();
    });
  }

  // X-axis date labels (max 10 to prevent crowding)
  ctx.fillStyle    = '#44445a';
  ctx.font         = '9px monospace';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'top';
  const step = Math.max(1, Math.ceil(n / 10));
  data.forEach((d, i) => {
    if (i % step !== 0 && i !== n - 1) return;
    ctx.fillText(
      d.date.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' }),
      xOf(i), MARGIN.top + plotH + 8
    );
  });

  // Axis baseline
  ctx.strokeStyle = '#242450';
  ctx.lineWidth   = 1;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(MARGIN.left, MARGIN.top + plotH);
  ctx.lineTo(MARGIN.left + plotW, MARGIN.top + plotH);
  ctx.stroke();
}

// ─── Tag Sparklines ───────────────────────────────────────────────────────────
// One 200×28 bar canvas per qualifying tag. Sparklines are also canvas-drawn
// inside rAF so DOM layout is settled before we write pixels.
// Filter: tag must have >= 5 problem samples per session across >= 3 distinct sessions.

function renderTagSparklines(sessions) {
  const container = document.getElementById('tag-sparklines-container');
  const emptyEl   = document.getElementById('tag-sparklines-empty');

  const lookback = sessions.slice(0, 10);
  if (!lookback.length) {
    emptyEl.style.display = 'block';
    container.innerHTML   = '';
    return;
  }
  emptyEl.style.display = 'none';

  // Build tagData: tagName → array[lookback.length] of { avgMs, sampleCount } | null
  const allTags = new Set();
  lookback.forEach(s => {
    Object.keys((s.stats && s.stats.tagAvgLatencies) || {}).forEach(t => allTags.add(t));
  });

  // For each tag, gather per-session counts from raw problems (stored in session.problems)
  // We need counts per session to apply the min-5-samples-per-session filter
  const tagSessionData = {};
  allTags.forEach(tag => { tagSessionData[tag] = new Array(lookback.length).fill(null); });

  lookback.forEach((session, si) => {
    const tagAvg    = (session.stats && session.stats.tagAvgLatencies) || {};
    const tagCounts = {};
    (session.problems || []).forEach(p => {
      (p.tags || []).forEach(t => { tagCounts[t] = (tagCounts[t] || 0) + 1; });
    });

    allTags.forEach(tag => {
      // Only record this session's data if it had >= 5 samples for this tag
      if (tagCounts[tag] >= 5 && tagAvg[tag] != null) {
        tagSessionData[tag][si] = tagAvg[tag];
      }
    });
  });

  // Filter: tag must be non-null in >= 3 distinct sessions
  const qualifiedTags = Object.entries(tagSessionData)
    .filter(([, vals]) => vals.filter(v => v !== null).length >= 3)
    .sort(([, a], [, b]) => {
      const avgA = a.filter(Boolean).reduce((s, v) => s + v, 0) / (a.filter(Boolean).length || 1);
      const avgB = b.filter(Boolean).reduce((s, v) => s + v, 0) / (b.filter(Boolean).length || 1);
      return avgB - avgA;  // worst first
    });

  // Remove old sparkline rows (keep empty-state node)
  container.querySelectorAll('.sparkline-row').forEach(el => el.remove());

  if (!qualifiedTags.length) {
    emptyEl.style.display = 'block';
    return;
  }

  qualifiedTags.forEach(([tag, vals]) => {
    const row    = document.createElement('div');
    row.className = 'sparkline-row';

    const label  = document.createElement('div');
    label.className   = 'sparkline-label';
    label.textContent = tag.replace(/_/g, ' ');

    const canvas  = document.createElement('canvas');
    canvas.width  = 200;
    canvas.height = 28;
    canvas.className = 'sparkline-canvas';

    row.appendChild(label);
    row.appendChild(canvas);
    container.appendChild(row);

    drawSparkline(canvas, vals);
  });
}

function drawSparkline(canvas, vals) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const nonNull = vals.filter(v => v !== null);
  if (!nonNull.length) return;

  const maxVal = Math.max(...nonNull, 1200);
  const n      = vals.length;
  const barW   = Math.max(4, Math.floor((W - 4) / n) - 2);
  const pad    = 2;

  vals.forEach((v, i) => {
    if (v === null) return;
    const x    = pad + i * (barW + 2);
    const frac = Math.min(1, v / maxVal);
    const barH = Math.max(3, Math.round(frac * (H - 6)));
    const y    = H - barH - 2;

    const zone = ZetaAnalytics.categorizeSpeedZone(v);
    ctx.fillStyle = zone === 'Direct_Retrieval'      ? '#719c81'
                  : zone === 'Procedural_Calculation' ? '#8a8bcf'
                  :                                     '#c97070';
    ctx.fillRect(x, y, barW, barH);
  });
}

// ─── Session Drill-Down ───────────────────────────────────────────────────────

function renderSessionDrilldown(sessions) {
  const container = document.getElementById('session-drilldown-list');
  if (!container) return;

  if (!sessions.length) {
    container.innerHTML = '<div class="empty-state">No sessions recorded yet.</div>';
    return;
  }

  container.innerHTML = sessions.map(s => {
    const st     = s.stats || {};
    const date   = new Date(s.timestamp).toLocaleDateString(undefined,
                     { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
    const drPct  = st.zones
      ? Math.round((st.zones.Direct_Retrieval || 0) / Math.max(st.totalProblems || 1, 1) * 100)
      : null;
    const fat    = st.fatigue || {};
    const fatStr = fat.deltaMs != null
      ? `Δ${fat.deltaMs > 0 ? '+' : ''}${fat.deltaMs}ms`
      : '—';

    return `
      <div class="history-session-row" data-session-id="${s.id}">
        <div class="history-session-header" data-expand-id="${escHtml(s.id)}">
          <div class="history-session-date">${escHtml(date)}${s.partial ? ' <span class="partial-badge" title="Session closed early">⚠ partial</span>' : ''}</div>
          <div class="history-session-score">${s.score || 0}</div>
          <div class="history-session-lat">${st.avgLatencyMs != null ? st.avgLatencyMs + 'ms' : '—'}</div>
          <div class="history-session-err">${st.errorRate != null ? st.errorRate + '%' : '—'}</div>
          <div class="history-session-dr">${drPct != null ? drPct + '% DR' : '—'}</div>
          <div class="history-session-fatigue ${fat.deltaMs > 200 ? 'text-bad' : ''}">${fatStr}</div>
          <div class="history-expand-icon">▶</div>
        </div>
        <div class="history-session-detail" id="detail-${escHtml(s.id)}" style="display:none;">
          ${buildSessionDetailHTML(s)}
        </div>
      </div>
    `;
  }).join('');

  // Expand/collapse on header click
  container.querySelectorAll('.history-session-header').forEach(hdr => {
    hdr.addEventListener('click', () => {
      const id     = hdr.dataset.expandId;
      const detail = document.getElementById(`detail-${id}`);
      const icon   = hdr.querySelector('.history-expand-icon');
      const wasOpen = detail.style.display !== 'none';

      // Collapse all open rows
      container.querySelectorAll('.history-session-detail').forEach(d => {
        d.style.display = 'none';
      });
      container.querySelectorAll('.history-expand-icon').forEach(ic => {
        ic.textContent = '▶';
      });

      if (!wasOpen) {
        detail.style.display = 'block';
        icon.textContent     = '▼';
        State.history.expandedSessionId = id;
      } else {
        State.history.expandedSessionId = null;
      }
    });
  });
}

function buildSessionDetailHTML(session) {
  const problems = session.problems || [];
  if (!problems.length) {
    return '<div class="session-detail-empty">No problem data recorded for this session.</div>';
  }

  const ZONE_CLASS = {
    Direct_Retrieval:      'zone-dr',
    Procedural_Calculation: 'zone-proc',
    Systemic_Friction:     'zone-fric'
  };

  const rows = problems.map(p => {
    const latency  = (p.t1 || 0) + (p.t2 || 0);
    const zone     = p.zone || ZetaAnalytics.categorizeSpeedZone(latency);
    const zc       = ZONE_CLASS[zone] || '';
    const errMark  = p.wasError ? '<span class="detail-error-mark">✕</span>' : '';
    const skipMark = p.skipped  ? '<span class="detail-skip-mark">skip</span>' : '';
    const tags     = (p.tags || []).map(t =>
      `<span class="tag-badge">${escHtml(t.replace(/_/g,' '))}</span>`
    ).join('');

    return `
      <tr class="${p.wasError ? 'detail-row-error' : ''}">
        <td class="detail-problem">${escHtml(p.text || p.str || '?')}</td>
        <td>${p.t1 != null ? p.t1 + 'ms' : '—'}</td>
        <td>${p.t2 != null ? p.t2 + 'ms' : '—'}</td>
        <td><span class="${zc}">${latency}ms</span></td>
        <td><span class="zone-badge ${zc}">${zone.replace(/_/g,' ')}</span></td>
        <td>${errMark}${skipMark}</td>
        <td class="detail-tags">${tags}</td>
      </tr>
    `;
  }).join('');

  return `
    <div class="session-detail-wrap">
      <table class="session-detail-table">
        <thead>
          <tr>
            <th>Problem</th><th>T1</th><th>T2</th><th>Total</th>
            <th>Zone</th><th></th><th>Tags</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function floatVal(id) {
  return parseFloat(document.getElementById(id)?.value || '0');
}

// ─── Coach Section ────────────────────────────────────────────────────────────

const TAG_TIPS = {
  Tens_Crossing:          'Carry automation not firing',
  Large_Addend:           'Large additions slowing you down',
  Cross_Hundred:          'Crossing hundreds boundary costly',
  Borrowing_Required:     'Regrouping adding latency',
  Subtraction:            'Subtraction recall needs work',
  Addition:               'Addition recall needs work',
  Multiplication:         'Multiplication recall needs work',
  Division:               'Division recall needs work',
  Teen_Factor:            'Teen multiples not memorised',
  Double_Digit_Divisor:   'Long division slowing throughput',
  Perfect_Square:         'Square recall not automatic',
  Prime_Adjacent:         'Primes ±1 tripping you up',
  Times_5:                'Times-5 pattern not automated',
  Times_11:               'Times-11 trick not firing',
  Times_12:               'Times-12 not in memory',
  Hard_Divisor:           'Irregular divisors costly',
  Remainder_Free:         'Exact division recall slow',
};

// ─── Operand-level weakness analysis ─────────────────────────────────────────
// Analyses raw a/b/op fields to find which specific numbers you're slow on.
// Returns targets like: { label:'× 12', op:'multiplication', avgLatency:980,
//   count:14, ranges:{mulMin1:12,mulMax1:12,mulMin2:2,mulMax2:25} }

function analyseSpecificTargets(problems) {
  // Bucket: opKey → fixedVal → [latency, ...]
  const buckets = {};

  for (const p of problems) {
    if (!p.op || p.a == null || p.b == null) continue;
    if (p.isPostError) continue;
    const lat = ZetaAnalytics.cognitiveLatency(p);
    if (lat <= 0) continue;

    const op = p.op; // 'add' | 'sub' | 'mul' | 'div'

    if (op === 'mul') {
      // Both operands are meaningful — bucket each as the "fixed" factor
      for (const fixed of [p.a, p.b]) {
        const k = `mul_${fixed}`;
        if (!buckets[k]) buckets[k] = { op: 'mul', fixed, lats: [] };
        buckets[k].lats.push(lat);
      }
    } else if (op === 'div') {
      // Divisor is the characteristic operand
      const fixed = p.b;
      const k = `div_${fixed}`;
      if (!buckets[k]) buckets[k] = { op: 'div', fixed, lats: [] };
      buckets[k].lats.push(lat);
    } else if (op === 'add') {
      // Bucket by the tens-digit of the larger addend (captures "adding 10s", "adding 7s" etc.)
      for (const fixed of [p.a, p.b]) {
        const k = `add_${fixed}`;
        if (!buckets[k]) buckets[k] = { op: 'add', fixed, lats: [] };
        buckets[k].lats.push(lat);
      }
    } else if (op === 'sub') {
      const fixed = p.b; // subtrahend
      const k = `sub_${fixed}`;
      if (!buckets[k]) buckets[k] = { op: 'sub', fixed, lats: [] };
      buckets[k].lats.push(lat);
    }
  }

  // mul/add bucket each problem under BOTH operands (2x inflation); div/sub bucket under one.
  // Normalize so all ops need the same number of underlying problems.
  const MIN_COUNT_BY_OP = { mul: 8, add: 8, div: 4, sub: 4 };
  const targets = [];

  for (const b of Object.values(buckets)) {
    if (b.lats.length < (MIN_COUNT_BY_OP[b.op] || 4)) continue;
    const m = ZetaAnalytics.median(ZetaAnalytics.winsorize(b.lats));
    const avg = m == null ? 0 : Math.round(m);
    if (avg < 400) continue; // already automatic — not a weak point

    let label, ranges, zetaOps;

    if (b.op === 'mul') {
      label   = `× ${b.fixed} table`;
      zetaOps = { multiplication: true };
      // Pin one factor to the weak number; let the other range freely (2–25)
      ranges  = { mul_left_min: b.fixed, mul_left_max: b.fixed, mul_right_min: 2, mul_right_max: 25 };
    } else if (b.op === 'div') {
      label   = `÷ ${b.fixed} table`;
      zetaOps = { division: true };
      // ZetaMac has no separate div range inputs — drive it via mul ranges
      // (ZetaMac generates division problems from the multiplication range)
      ranges  = { mul_left_min: b.fixed, mul_left_max: b.fixed, mul_right_min: 2, mul_right_max: 25 };
    } else if (b.op === 'add') {
      label   = `+ ${b.fixed}s`;
      zetaOps = { addition: true };
      ranges  = { add_left_min: b.fixed, add_left_max: b.fixed, add_right_min: 2, add_right_max: 100 };
    } else {
      label   = `− ${b.fixed}s`;
      zetaOps = { subtraction: true };
      // ZetaMac has no separate sub range — drive via add ranges
      ranges  = { add_left_min: b.fixed, add_left_max: b.fixed, add_right_min: 2, add_right_max: 100 };
    }

    targets.push({ label, op: b.op, fixed: b.fixed, avgLatency: avg, count: b.lats.length, ranges, zetaOps });
  }

  // Sort by avg latency descending, dedupe same op+fixed
  const seen = new Set();
  return targets
    .sort((a, b) => b.avgLatency - a.avgLatency)
    .filter(t => {
      const k = `${t.op}_${t.fixed}`;
      if (seen.has(k)) return false;
      seen.add(k); return true;
    })
    .slice(0, 8);
}

function buildCoachPlan(sessions) {
  const problems     = sessions.slice(0, 30).flatMap(s => s.problems || []);
  const targets      = analyseSpecificTargets(problems);
  const weakPoints   = ZetaAnalytics.getWeakPoints(problems, 8, 5, 500);
  const recentSess   = sessions.slice(0, 10);
  const avgError     = recentSess.reduce((s, x) => s + (x.stats?.errorRate || 0), 0) / Math.max(1, recentSess.length);
  const duration     = avgError > 15 ? 60 : 120;
  const sessionBasis = Math.min(sessions.length, 30);

  // Primary target = worst specific operand. Fallback to tag-level if no operand data.
  const primary = targets[0] || null;

  return { targets, weakPoints, primary, duration, sessionBasis };
}

function renderCoach() {
  const emptyEl  = document.getElementById('coach-empty');
  const wpCard   = document.getElementById('card-coach-weakpoints');
  const planCard = document.getElementById('card-coach-plan');
  const launchW  = document.getElementById('coach-launch-wrap');

  if (State.sessions.length < 3) {
    emptyEl.style.display  = '';
    wpCard.style.display   = 'none';
    planCard.style.display = 'none';
    launchW.style.display  = 'none';
    return;
  }

  emptyEl.style.display  = 'none';
  wpCard.style.display   = '';
  planCard.style.display = '';
  launchW.style.display  = '';

  const plan      = buildCoachPlan(State.sessions);
  State.coachPlan       = plan;
  State.coachTargetIdx  = 0;

  document.getElementById('coach-session-basis').textContent =
    `${plan.sessionBasis} sessions analysed`;

  renderCoachTargets(plan.targets, plan.weakPoints);
  renderCoachPlanGrid(plan);
  checkZetaMacTab();
}

function renderCoachTargets(targets, weakPoints) {
  const list = document.getElementById('coach-weakpoints-list');

  if (!targets.length && !weakPoints.length) {
    list.innerHTML =
      '<div class="empty-state">' +
        'Need more variety in your problems before Coach can identify weak fact families.<br>' +
        '<span style="opacity:.6;font-size:11px;">Each operand needs at least 4 attempts. Play a few more sessions covering different operations.</span>' +
      '</div>';
    return;
  }

  const opSymbol = { mul: '×', div: '÷', add: '+', sub: '−' };

  // Show specific operand targets if we have them
  const rows = targets.slice(0, 6).map((t, i) => {
    const zone   = ZetaAnalytics.categorizeSpeedZone(t.avgLatency);
    const latCls = zone === 'Direct_Retrieval' ? 'lat-dr'
                 : zone === 'Procedural_Calculation' ? 'lat-proc' : 'lat-fric';
    const sym    = opSymbol[t.op] || t.op;
    const tip    = TAG_TIPS[
      t.op === 'mul' ? (t.fixed >= 13 && t.fixed <= 19 ? 'Teen_Factor' : t.fixed === 12 ? 'Times_12' : t.fixed === 11 ? 'Times_11' : 'Multiplication')
      : t.op === 'div' ? (t.fixed >= 10 ? 'Double_Digit_Divisor' : 'Division')
      : t.op === 'add' ? 'Addition'
      : 'Subtraction'
    ] || '';
    return `
      <div class="coach-weakpoint-row" data-target-idx="${i}" style="cursor:pointer;" title="Click to select this as your drill target">
        <span class="coach-rank">#${i + 1}</span>
        <div>
          <div class="coach-tag-name">${sym} ${t.fixed} &nbsp;<span style="font-size:10px;opacity:.5">(${sym}${t.fixed} table)</span></div>
          ${tip ? `<div class="coach-tag-tip">${tip}</div>` : ''}
          ${t.op === 'div' ? `<div class="coach-tag-tip" style="opacity:.55;font-style:italic;">Zetamac generates division as reverse multiplication — your target ÷${t.fixed} will sometimes appear with ${t.fixed} as the answer. Both flavors drill the same fact family.</div>` : ''}
        </div>
        <span class="coach-lat-pill ${latCls}">${t.avgLatency}ms</span>
        <span class="coach-sample-count">${t.count}×</span>
      </div>
    `;
  });

  list.innerHTML = rows.join('');

  // Clicking a row picks that target
  list.querySelectorAll('.coach-weakpoint-row').forEach(row => {
    row.addEventListener('click', () => {
      const idx    = parseInt(row.dataset.targetIdx, 10);
      const target = State.coachPlan?.targets?.[idx];
      if (!target) return;
      State.coachPlan.primary = target;
      State.coachTargetIdx    = idx;
      highlightCoachTarget(idx);
      renderCoachPlanGrid(State.coachPlan);
    });
  });
}

function highlightCoachTarget(idx) {
  const list = document.getElementById('coach-weakpoints-list');
  if (!list) return;
  list.querySelectorAll('.coach-weakpoint-row').forEach((r, i) => {
    r.style.background = i === idx ? 'rgba(224,146,199,0.07)' : '';
  });
}

function renderCoachPlanGrid(plan) {
  const t    = plan.primary;
  const grid = document.getElementById('coach-plan-grid');

  if (!t) {
    grid.innerHTML = '<div class="empty-state" style="padding:12px 0">Not enough data yet for a specific target.</div>';
    document.getElementById('coach-plan-summary').textContent = '';
    return;
  }

  const opSymbol = { mul: '×', div: '÷', add: '+', sub: '−' };
  const opName   = { mul: 'Multiplication', div: 'Division', add: 'Addition', sub: 'Subtraction' };
  const sym      = opSymbol[t.op] || t.op;

  // Build range description
  let rangeDesc = '';
  if (t.op === 'mul') rangeDesc = `? ${sym} ${t.fixed}  (all multipliers)`;
  else if (t.op === 'div') rangeDesc = `? ÷ ${t.fixed}  (all dividends)`;
  else if (t.op === 'add') rangeDesc = `? + ${t.fixed}  (all addends)`;
  else rangeDesc = `? − ${t.fixed}  (all minuends)`;

  grid.innerHTML = [
    { label: 'Target',     value: `${sym} ${t.fixed} table` },
    { label: 'Operation',  value: opName[t.op] || t.op },
    { label: 'Range',      value: rangeDesc },
    { label: 'Duration',   value: `${plan.duration}s` },
  ].map(p => `
    <div class="coach-plan-pill">
      <div class="coach-plan-pill-label">${p.label}</div>
      <div class="coach-plan-pill-value">${p.value}</div>
    </div>
  `).join('');

  const zone = ZetaAnalytics.categorizeSpeedZone(t.avgLatency);
  const zoneLabel = zone === 'Direct_Retrieval' ? 'Direct Retrieval'
                  : zone === 'Procedural_Calculation' ? 'Procedural' : 'Systemic Friction';
  document.getElementById('coach-plan-summary').textContent =
    `Your ${sym}${t.fixed} table averages ${t.avgLatency}ms (${zoneLabel}) across ${t.count} attempts. ` +
    `ZetaMac will be set to drill this exact table for ${plan.duration}s.`;
}

async function checkZetaMacTab() {
  const btn  = document.getElementById('btn-coach-launch');
  const hint = document.getElementById('coach-launch-hint');
  const tabs = await chrome.tabs.query({ url: '*://arithmetic.zetamac.com/*' });
  if (tabs.length > 0) {
    btn.disabled = false;
    hint.textContent = `Ready — will configure: ${tabs[0].title || 'ZetaMac'}`;
  } else {
    btn.disabled = true;
    hint.textContent = 'Open arithmetic.zetamac.com first, then return here';
  }
}

async function applyCoachPlan(plan) {
  const tabs = await chrome.tabs.query({ url: '*://arithmetic.zetamac.com/*' });
  if (!tabs.length) { checkZetaMacTab(); return; }
  const t = plan.primary;
  if (!t) return;

  const payload = { ops: t.zetaOps, ranges: t.ranges, duration: plan.duration, autoStart: false };
  console.debug('[ZetaCoach] applyCoachPlan payload:', payload, 'target:', t);

  // Write the config into the tab's sessionStorage then reload.
  // This guarantees the user lands on the clean pre-game screen with params
  // already filled in — regardless of whether a game was in progress.
  await chrome.scripting.executeScript({
    target: { tabId: tabs[0].id },
    func: (cfg) => {
      sessionStorage.setItem('zetacoach_pending_config', JSON.stringify(cfg));
      // Navigate to the base URL rather than reloading — ZetaMac restores an
      // in-progress game on reload but shows the settings form on fresh navigation.
      location.href = location.origin + '/';
    },
    args: [payload]
  });

  // Focus the tab so the user can see the result
  chrome.tabs.update(tabs[0].id, { active: true });
  chrome.windows.update(tabs[0].windowId, { focused: true });
}
