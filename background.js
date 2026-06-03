// ZetaCoach Service Worker — MV3 background
// Responsibilities: session aggregation, storage management, tab routing, alarm scheduling.

'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY_SESSIONS   = 'zetacoach_sessions';
const STORAGE_KEY_SETTINGS   = 'zetacoach_settings';
const STORAGE_KEY_TIER       = 'zetacoach_tier';
const MAX_STORED_SESSIONS    = 200;  // rolling cap to avoid storage bloat

// ─── Tier Table ───────────────────────────────────────────────────────────────

const TIERS = [
  { name: 'Unranked',    min: 0,   topPct: null },
  { name: 'Iron',        min: 15,  topPct: 80   },
  { name: 'Bronze',      min: 25,  topPct: 65   },
  { name: 'Stone',       min: 35,  topPct: 55   },
  { name: 'Silver',      min: 50,  topPct: 45   },
  { name: 'Gold',        min: 65,  topPct: 30   },
  { name: 'Platinum',    min: 80,  topPct: 18   },
  { name: 'Diamond',     min: 100, topPct: 10   },
  { name: 'Master',      min: 125, topPct: 5    },
  { name: 'Grandmaster', min: 150, topPct: 2    },
  { name: 'Elite',       min: 175, topPct: 0.5  },
  { name: 'Legend',      min: 200, topPct: 0.1  },
];

function getTierForScore(score) {
  let tier = TIERS[0];
  for (const t of TIERS) {
    if (score >= t.min) tier = t;
  }
  return tier;
}

const DEFAULT_SETTINGS = {
  metronomeThresholdMs:  800,
  weakPointFrequency:    0.70,   // 70% forced weak-point appearance in adaptive mode
  weakPointWindowSize:   5,      // top N slowest tags to focus
  weakPointGraduateMs:   600,    // tag graduates out of weak list once avg drops below this
  defaultDrillDuration:  90,     // seconds
  staminaDuration:       180,
  heatmapOpsFilter:      ['mul', 'div', 'add', 'sub'],

  // Speed-zone thresholds on cognitive latency (t1, ms). Defaults bumped from the
  // old 400/1200 to reflect real perceptual + motor floors. Users can override.
  drZoneMaxMs:           600,
  procZoneMaxMs:         1500
};

// ─── Lifecycle ────────────────────────────────────────────────────────────────

self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', e  => e.waitUntil(clients.claim()));

// ─── Message Router ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {

    case 'SESSION_COMPLETE':
      handleSessionComplete(msg.payload, sender.tab?.id)
        .then(result => sendResponse({ ok: true, result }))
        .catch(err  => sendResponse({ ok: false, error: err.message }));
      return true;  // keep channel open for async

    case 'GET_SESSIONS':
      getRecentSessions(msg.limit || 50)
        .then(sessions => sendResponse({ ok: true, sessions }))
        .catch(err     => sendResponse({ ok: false, error: err.message }));
      return true;

    case 'GET_ALL_PROBLEMS':
      getAllProblemsFlattened(msg.limit || 2000)
        .then(problems => sendResponse({ ok: true, problems }))
        .catch(err     => sendResponse({ ok: false, error: err.message }));
      return true;

    case 'GET_SETTINGS':
      (async () => {
        const data = await chrome.storage.local.get(STORAGE_KEY_SETTINGS);
        sendResponse({ ok: true, settings: Object.assign({}, DEFAULT_SETTINGS, data[STORAGE_KEY_SETTINGS] || {}) });
      })();
      return true;

    case 'SAVE_SETTINGS':
      (async () => {
        await chrome.storage.local.set({ [STORAGE_KEY_SETTINGS]: msg.settings });
        sendResponse({ ok: true });
      })();
      return true;

    case 'CLEAR_HISTORY':
      (async () => {
        await chrome.storage.local.remove([STORAGE_KEY_SESSIONS, STORAGE_KEY_TIER]);
        sendResponse({ ok: true });
      })();
      return true;

    case 'OPEN_DASHBOARD':
      openDashboard(msg.section || 'analytics')
        .then(() => sendResponse({ ok: true }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;

    case 'GET_TIER':
      loadSessions()
        .then(sessions => {
          const best     = sessions.reduce((b, s) => Math.max(b, s.score || 0), 0);
          const tier     = getTierForScore(best);
          const tierIdx  = TIERS.findIndex(t => t.name === tier.name);
          const nextTier = TIERS[tierIdx + 1] || null;
          sendResponse({ ok: true, tier, nextTier, bestScore: best });
        })
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;

    case 'GET_QUICK_STATS':
      getQuickStats()
        .then(data => sendResponse({ ok: true, data }))
        .catch(err  => sendResponse({ ok: false, error: err.message }));
      return true;

    case 'CONFIGURE_ZETAMAC': {
      const { tabId, payload } = msg;
      chrome.tabs.sendMessage(tabId, { type: 'CONFIGURE_ZETAMAC', payload });
      sendResponse({ ok: true });
      return true;
    }

    default:
      sendResponse({ ok: false, error: `Unknown message type: ${msg.type}` });
      return false;
  }
});

// ─── Core Functions ───────────────────────────────────────────────────────────

async function handleSessionComplete(payload, tabId) {
  // payload = { score, durationMs, problems: [{...}], timestamp }

  if (!payload || !Array.isArray(payload.problems)) {
    throw new Error('Invalid session payload');
  }

  const sessions = await loadSessions();

  // Build session record
  const session = {
    id:         generateId(),
    timestamp:  payload.timestamp || Date.now(),
    score:      payload.score || 0,
    durationMs: payload.durationMs || 120000,
    problems:   payload.problems,
    config:     payload.config || null,

    // Pre-compute aggregate stats for fast dashboard rendering
    stats: computeSessionStats(payload.problems)
  };

  sessions.unshift(session);

  // Enforce rolling cap
  if (sessions.length > MAX_STORED_SESSIONS) {
    sessions.length = MAX_STORED_SESSIONS;
  }

  await saveSessions(sessions);

  // ── Tier-up detection ────────────────────────────────────────────────────
  const allTimeBest = sessions.reduce((best, s) => Math.max(best, s.score || 0), 0);
  const newTier     = getTierForScore(allTimeBest);

  const tierData     = await chrome.storage.local.get(STORAGE_KEY_TIER);
  const prevTierName = tierData[STORAGE_KEY_TIER] || null;
  const prevIdx = prevTierName ? TIERS.findIndex(t => t.name === prevTierName) : -1;
  const newIdx  = TIERS.findIndex(t => t.name === newTier.name);
  // Tier-up only counts when we have a known previous tier and it's strictly lower.
  // First-ever session never triggers a tier-up animation.
  const tierUp  = prevIdx >= 0 && newIdx > prevIdx;

  await chrome.storage.local.set({ [STORAGE_KEY_TIER]: newTier.name });

  // Broadcast to any open dashboard tabs
  broadcastToExtensionPages({ type: 'SESSION_SAVED', session, tier: newTier, tierUp: tierUp ? { from: prevTierName, to: newTier } : null });

  return { ...session, tier: newTier, tierUp: tierUp ? { from: prevTierName, to: newTier } : null };
}

function computeSessionStats(problems) {
  if (!problems.length) return {};

  const latencies     = problems.map(p => p.t1 + p.t2);
  const t1s           = problems.map(p => p.t1);
  const t2s           = problems.map(p => p.t2);
  const errors        = problems.filter(p => p.wasError);
  const postError     = problems.filter(p => p.isPostError);

  const avg  = arr => arr.reduce((s, v) => s + v, 0) / arr.length;
  const pct  = (n, d) => d > 0 ? Math.round((n / d) * 100) : 0;

  // Speed zone distribution
  const zones = { Direct_Retrieval: 0, Procedural_Calculation: 0, Systemic_Friction: 0 };
  problems.forEach(p => { if (p.zone && zones[p.zone] !== undefined) zones[p.zone]++; });

  // Tag latency map
  const tagLatencies = {};
  problems.forEach(p => {
    const lat = p.t1 + p.t2;
    (p.tags || []).forEach(tag => {
      if (!tagLatencies[tag]) tagLatencies[tag] = [];
      tagLatencies[tag].push(lat);
    });
  });
  const tagAvgLatencies = {};
  Object.entries(tagLatencies).forEach(([tag, lats]) => {
    tagAvgLatencies[tag] = Math.round(avg(lats));
  });

  // Fact family matrix (mul/div operand pairs)
  const factFamily = {};
  problems.forEach(p => {
    if ((p.op === 'mul' || p.op === 'div') && p.a && p.b) {
      const key = `${Math.min(p.a, p.b)}×${Math.max(p.a, p.b)}`;
      if (!factFamily[key]) factFamily[key] = [];
      factFamily[key].push(p.t1 + p.t2);
    }
  });
  const factFamilyAvg = {};
  Object.entries(factFamily).forEach(([k, lats]) => {
    factFamilyAvg[k] = Math.round(avg(lats));
  });

  // Fatigue: compare first 15s vs last 15s
  let earlyAvg = null, lateAvg = null;
  const earlyProblems = problems.filter(p => p.relativeTime < 15000);
  const lateProblems  = problems.filter(p => p.relativeTime > (problems[problems.length - 1].relativeTime - 15000));
  if (earlyProblems.length > 0) earlyAvg = Math.round(avg(earlyProblems.map(p => p.t1 + p.t2)));
  if (lateProblems.length > 0)  lateAvg  = Math.round(avg(lateProblems.map(p => p.t1 + p.t2)));

  return {
    totalProblems:      problems.length,
    correctCount:       problems.length - errors.length,
    errorCount:         errors.length,
    errorRate:          pct(errors.length, problems.length),
    avgLatencyMs:       Math.round(avg(latencies)),
    avgT1Ms:            Math.round(avg(t1s)),
    avgT2Ms:            Math.round(avg(t2s)),
    medianLatencyMs:    median(latencies),
    p95LatencyMs:       percentile(latencies, 95),
    zones,
    tagAvgLatencies,
    factFamilyAvg,
    fatigue: {
      earlyAvgMs: earlyAvg,
      lateAvgMs:  lateAvg,
      deltaMs:    (earlyAvg !== null && lateAvg !== null) ? lateAvg - earlyAvg : null
    },
    postErrorAvgMs: postError.length > 0
      ? Math.round(avg(postError.map(p => p.t1 + p.t2)))
      : null
  };
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

async function loadSessions() {
  const data = await chrome.storage.local.get(STORAGE_KEY_SESSIONS);
  return data[STORAGE_KEY_SESSIONS] || [];
}

async function saveSessions(sessions) {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY_SESSIONS]: sessions });
  } catch (err) {
    // Likely quota exceeded — trim oldest 25% and retry once.
    // Better to lose old sessions than to lose the brand-new one.
    const trimmed = sessions.slice(0, Math.max(1, Math.floor(sessions.length * 0.75)));
    try {
      await chrome.storage.local.set({ [STORAGE_KEY_SESSIONS]: trimmed });
      broadcastToExtensionPages({ type: 'STORAGE_TRIMMED', kept: trimmed.length, dropped: sessions.length - trimmed.length });
    } catch (err2) {
      broadcastToExtensionPages({ type: 'STORAGE_ERROR', error: err2.message });
      throw err2;
    }
  }
}

async function getRecentSessions(limit) {
  const sessions = await loadSessions();
  return sessions.slice(0, limit);
}

async function getAllProblemsFlattened(limit) {
  const sessions = await loadSessions();
  const problems = [];
  for (const session of sessions) {
    for (const p of (session.problems || [])) {
      problems.push({ ...p, sessionId: session.id, sessionTimestamp: session.timestamp });
      if (problems.length >= limit) return problems;
    }
  }
  return problems;
}

// ─── Dashboard tab management ─────────────────────────────────────────────────

async function openDashboard(section) {
  const dashboardBase = chrome.runtime.getURL('dashboard.html');
  const dashboardUrl  = `${dashboardBase}?section=${section}`;

  // Idempotent routing: find an existing dashboard tab, focus it, avoid duplicate processes.
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.url && tab.url.startsWith(dashboardBase)) {
      // Update the tab's URL to the requested section and pull its window into focus.
      await chrome.tabs.update(tab.id, { active: true, url: dashboardUrl });
      await chrome.windows.update(tab.windowId, { focused: true });
      return;
    }
  }

  await chrome.tabs.create({ url: dashboardUrl });
}

// ─── Quick Stats Aggregator ───────────────────────────────────────────────────

async function getQuickStats() {
  const sessions = await loadSessions();

  if (!sessions.length) {
    return { hasSessions: false };
  }

  const lastSession = sessions[0];

  // All-time best score
  const bestScore = sessions.reduce((best, s) => Math.max(best, s.score || 0), 0);

  // All-time best avg latency (lowest positive value = fastest)
  let bestAvgLatency = Infinity;
  for (const s of sessions) {
    const lat = s.stats && s.stats.avgLatencyMs;
    if (lat && lat > 0) bestAvgLatency = Math.min(bestAvgLatency, lat);
  }

  // Flatten up to 2000 problems for tag analysis
  const allProblems = [];
  outer: for (const s of sessions) {
    for (const p of (s.problems || [])) {
      allProblems.push(p);
      if (allProblems.length >= 2000) break outer;
    }
  }

  // Weak points: minimum 15 total appearances before a tag is eligible
  const tagStats = {};
  allProblems.forEach(p => {
    const lat = p.t1 + p.t2;
    (p.tags || []).forEach(tag => {
      if (!tagStats[tag]) tagStats[tag] = { sum: 0, count: 0 };
      tagStats[tag].sum   += lat;
      tagStats[tag].count += 1;
    });
  });
  const weakPoints = Object.entries(tagStats)
    .filter(([, s]) => s.count >= 15)
    .map(([tag, s]) => ({ tag, avgLatencyMs: Math.round(s.sum / s.count) }))
    .sort((a, b) => b.avgLatencyMs - a.avgLatencyMs)
    .slice(0, 3);

  // Clean streak: consecutive sessions from most-recent where errorRate <= 10%
  let cleanStreak = 0;
  for (const s of sessions) {
    const errorRate = (s.stats && s.stats.errorRate != null) ? s.stats.errorRate : 100;
    if (errorRate <= 10) cleanStreak++;
    else break;
  }

  return {
    hasSessions:           true,
    totalSessions:         sessions.length,
    lastSession: {
      score:        lastSession.score || 0,
      avgLatencyMs: (lastSession.stats && lastSession.stats.avgLatencyMs) || null,
      errorRate:    (lastSession.stats && lastSession.stats.errorRate)    != null
                      ? lastSession.stats.errorRate : null,
      timestamp:    lastSession.timestamp
    },
    allTimeBestScore:      bestScore,
    allTimeBestLatencyMs:  bestAvgLatency === Infinity ? null : bestAvgLatency,
    weakPoints,
    cleanStreak
  };
}

function broadcastToExtensionPages(msg) {
  chrome.tabs.query({}, tabs => {
    const dashboardPrefix = chrome.runtime.getURL('dashboard.html');
    tabs.forEach(tab => {
      if (tab.url && tab.url.startsWith(dashboardPrefix)) {
        chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
      }
    });
  });
}

// ─── Math utilities ───────────────────────────────────────────────────────────

function median(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function generateId() {
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
