// ZetaCoach Popup — Quick Stats
// Reads purely from storage via background GET_QUICK_STATS. No content.js dependency.

'use strict';

document.addEventListener('DOMContentLoaded', () => {
  loadQuickStats();

  document.getElementById('btn-open-dashboard').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD', section: 'analytics' });
    window.close();
  });
});

// ─── Data ──────────────────────────────────────────────────────────────────────

function loadQuickStats() {
  let answered = false;

  // Hard timeout — if background never responds (e.g. service worker crashed),
  // fall back to the empty state instead of spinning forever.
  const timeout = setTimeout(() => {
    if (answered) return;
    answered = true;
    document.getElementById('popup-loading').style.display = 'none';
    const empty = document.getElementById('popup-empty');
    empty.style.display = 'flex';
    const subEl = empty.querySelector('.popup-empty-sub');
    if (subEl) subEl.textContent = 'Could not reach extension service worker. Try reopening the popup.';
  }, 3000);

  chrome.runtime.sendMessage({ type: 'GET_QUICK_STATS' }, res => {
    if (answered) return;
    answered = true;
    clearTimeout(timeout);

    document.getElementById('popup-loading').style.display = 'none';

    if (chrome.runtime.lastError || !res || !res.ok || !res.data || !res.data.hasSessions) {
      document.getElementById('popup-empty').style.display = 'flex';
      return;
    }

    renderQuickStats(res.data);
  });
}

// ─── Rendering ─────────────────────────────────────────────────────────────────

function renderQuickStats(data) {
  document.getElementById('popup-content').style.display = 'flex';

  // Tier badge
  if (window.ZetaTiers) {
    const tier = window.ZetaTiers.getTier(data.allTimeBestScore || 0);
    const card = document.getElementById('popup-tier-card');
    card.style.display = 'flex';
    document.getElementById('popup-tier-icon').innerHTML = window.ZetaTiers.svgFor(tier.name);
    document.getElementById('popup-tier-name').textContent = tier.name;
    document.getElementById('popup-tier-pct').textContent =
      tier.topPct != null ? `Top ${tier.topPct}% · Best ${data.allTimeBestScore}` : `Best score ${data.allTimeBestScore}`;
  }

  // Header session count
  const countEl = document.getElementById('popup-session-count');
  if (countEl) {
    countEl.textContent = `${data.totalSessions} session${data.totalSessions !== 1 ? 's' : ''}`;
  }

  // Last session
  const ls = data.lastSession;
  setKPI('pkpi-score',   ls.score ?? '—');
  setKPI('pkpi-latency',
    ls.avgLatencyMs != null ? `${ls.avgLatencyMs}ms` : '—',
    ls.avgLatencyMs != null
      ? (ls.avgLatencyMs < 500 ? 'ok' : ls.avgLatencyMs < 900 ? 'warn' : 'bad')
      : ''
  );
  setKPI('pkpi-errors',
    ls.errorRate != null ? `${ls.errorRate}%` : '—',
    ls.errorRate != null
      ? (ls.errorRate <= 5 ? 'ok' : ls.errorRate <= 12 ? 'warn' : 'bad')
      : ''
  );

  // All-time records
  setKPI('pkpi-best-score', data.allTimeBestScore ?? '—');
  setKPI('pkpi-best-lat',
    data.allTimeBestLatencyMs != null ? `${data.allTimeBestLatencyMs}ms` : '—',
    'ok'
  );
  setKPI('pkpi-streak',
    data.cleanStreak,
    data.cleanStreak >= 5 ? 'ok' : data.cleanStreak >= 2 ? 'warn' : ''
  );

  renderWeakPoints(data.weakPoints);
}

function renderWeakPoints(weakPoints) {
  const container = document.getElementById('popup-weak-points');

  if (!weakPoints || !weakPoints.length) {
    container.innerHTML =
      '<div class="popup-weak-empty">Need 15+ samples per tag to surface weak points.</div>';
    return;
  }

  container.innerHTML = weakPoints.map((wp, i) => {
    const zone = ZetaAnalytics.categorizeSpeedZone(wp.avgLatencyMs);
    const latClass = zone === 'Direct_Retrieval'       ? 'lat-ok'
                   : zone === 'Procedural_Calculation'  ? 'lat-warn'
                   :                                      'lat-bad';
    return `
      <div class="popup-weak-row">
        <span class="popup-weak-rank">${i + 1}</span>
        <span class="popup-weak-tag">${escHtml(wp.tag.replace(/_/g, ' '))}</span>
        <span class="popup-weak-lat ${latClass}">${wp.avgLatencyMs}ms</span>
      </div>
    `;
  }).join('');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setKPI(id, value, sentiment) {
  const el = document.getElementById(id);
  if (!el) return;
  el.querySelector('.popup-kpi-val').textContent = value;
  el.className = 'popup-kpi' + (sentiment ? ` kpi-${sentiment}` : '');
}

function escHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
