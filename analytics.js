// ZetaCoach Analytics Engine
// Loaded in both content script context and dashboard page context.
// Exposed as window.ZetaAnalytics — pure functions, no side effects, no DOM access.

(function (root) {
  'use strict';

  // ─── Speed Zone Thresholds (ms) ─────────────────────────────────────────────

  const ZONES = {
    DIRECT_RETRIEVAL_MAX:  400,
    PROCEDURAL_MAX:       1200
  };

  // ─── Zone Classification ─────────────────────────────────────────────────────

  function categorizeSpeedZone(totalLatencyMs) {
    if (totalLatencyMs < ZONES.DIRECT_RETRIEVAL_MAX)  return 'Direct_Retrieval';
    if (totalLatencyMs <= ZONES.PROCEDURAL_MAX)        return 'Procedural_Calculation';
    return 'Systemic_Friction';
  }

  // ─── Problem Parser ───────────────────────────────────────────────────────────
  // Parses text like "47 + 8", "62 − 15", "14 × 14", "144 ÷ 12".
  // Returns { op, a, b } or null.

  function parseProblem(text) {
    if (typeof text !== 'string') return null;
    const s = text.trim().replace(/\s+/g, ' ');

    // Addition
    let m = s.match(/^(\d+)\s*\+\s*(\d+)$/);
    if (m) return { op: 'add', a: parseInt(m[1], 10), b: parseInt(m[2], 10) };

    // Subtraction (hyphen-minus, minus sign U+2212, en-dash)
    m = s.match(/^(\d+)\s*[-−–]\s*(\d+)$/);
    if (m) return { op: 'sub', a: parseInt(m[1], 10), b: parseInt(m[2], 10) };

    // Multiplication (×, *, x, ·)
    m = s.match(/^(\d+)\s*[×\*x·]\s*(\d+)$/i);
    if (m) return { op: 'mul', a: parseInt(m[1], 10), b: parseInt(m[2], 10) };

    // Division (÷, /)
    m = s.match(/^(\d+)\s*[÷\/]\s*(\d+)$/);
    if (m) return { op: 'div', a: parseInt(m[1], 10), b: parseInt(m[2], 10) };

    return null;
  }

  // ─── Structural Tagger ────────────────────────────────────────────────────────
  // Returns { op, a, b, tags[] } where tags are the architectural archetypes
  // used by the prescription engine and the adaptive drill generator.

  function tagMathStructure(text) {
    const parsed = parseProblem(text);
    if (!parsed) return { op: 'unknown', a: null, b: null, tags: [] };

    const { op, a, b } = parsed;
    const tags = [];

    switch (op) {
      case 'add': {
        tags.push('Addition');
        // Tens_Crossing: units digits sum to ≥10, requiring a carry into the tens place.
        if ((a % 10) + (b % 10) >= 10) {
          tags.push('Tens_Crossing');
        }
        // Large_Addend: both operands ≥ 50, pressuring working memory significantly.
        if (a >= 50 && b >= 50) tags.push('Large_Addend');
        break;
      }

      case 'sub': {
        tags.push('Subtraction');
        // Borrowing_Required: minuend's units digit is less than subtrahend's units digit.
        if ((a % 10) < (b % 10)) tags.push('Borrowing_Required');
        // Cross_Hundred: result crosses a hundreds boundary (e.g. 103 - 7 = 96).
        if (Math.floor(a / 100) > Math.floor((a - b) / 100)) tags.push('Cross_Hundred');
        break;
      }

      case 'mul': {
        tags.push('Multiplication');
        if (a === b) {
          tags.push('Perfect_Square');
        }
        // Prime_Adjacent: at least one factor is prime and ≥ 7 (hardest to recall).
        if ((isPrime(a) && a >= 7) || (isPrime(b) && b >= 7)) {
          tags.push('Prime_Adjacent');
        }
        if (a === 5 || b === 5)           tags.push('Times_5');
        if (a === 11 || b === 11)         tags.push('Times_11');
        if (a === 12 || b === 12)         tags.push('Times_12');
        if ((a >= 13 && a <= 19) || (b >= 13 && b <= 19)) tags.push('Teen_Factor');
        if (a === 10 || b === 10 ||
            a === 100 || b === 100)       tags.push('Times_10');
        break;
      }

      case 'div': {
        tags.push('Division');
        if (b >= 10)                      tags.push('Double_Digit_Divisor');
        if (b === 7 || b === 8 || b === 9) tags.push('Hard_Divisor');
        // Remainder_Free: exact integer result (should always be true for ZetaMac but sanity check).
        if (Number.isInteger(a / b))      tags.push('Remainder_Free');
        break;
      }
    }

    return { op, a, b, tags };
  }

  // ─── Fatigue Curve ────────────────────────────────────────────────────────────
  // Compares first-15s window against last-15s window of a session.
  // `problems` must each have: { t1, t2, relativeTime, wasError }

  function computeFatigueCurve(problems) {
    if (!problems || problems.length < 4) return null;

    const sessionEnd  = problems[problems.length - 1].relativeTime;
    const windowMs    = 15000;

    const earlyBatch  = problems.filter(p => p.relativeTime <= windowMs);
    const lateBatch   = problems.filter(p => p.relativeTime >= sessionEnd - windowMs);

    if (earlyBatch.length < 2 || lateBatch.length < 2) return null;

    const avgLat = arr => arr.reduce((s, p) => s + p.t1 + p.t2, 0) / arr.length;
    const errRate = arr => arr.filter(p => p.wasError).length / arr.length;

    const earlyAvg = avgLat(earlyBatch);
    const lateAvg  = avgLat(lateBatch);

    return {
      earlyAvgMs:    Math.round(earlyAvg),
      lateAvgMs:     Math.round(lateAvg),
      deltaMs:       Math.round(lateAvg - earlyAvg),
      earlyErrorPct: Math.round(errRate(earlyBatch) * 100),
      lateErrorPct:  Math.round(errRate(lateBatch)  * 100),
      fatigueRatio:  earlyAvg > 0 ? parseFloat((lateAvg / earlyAvg).toFixed(3)) : null
    };
  }

  // ─── Rolling Velocity (15-second moving window) ───────────────────────────────
  // Returns an array of { time, problemsPerSec, avgLatencyMs } data points
  // for charting a velocity curve over the session.

  function computeRollingVelocity(problems, windowMs = 15000) {
    if (!problems || problems.length < 2) return [];

    const points = [];
    for (let i = 0; i < problems.length; i++) {
      const anchor    = problems[i].relativeTime;
      const inWindow  = problems.filter(
        p => p.relativeTime >= anchor - windowMs && p.relativeTime <= anchor
      );
      if (inWindow.length < 2) continue;

      const avgLat = inWindow.reduce((s, p) => s + p.t1 + p.t2, 0) / inWindow.length;
      points.push({
        time:           anchor,
        problemsPerSec: parseFloat((inWindow.length / (windowMs / 1000)).toFixed(3)),
        avgLatencyMs:   Math.round(avgLat)
      });
    }
    return points;
  }

  // ─── Prescription Engine ──────────────────────────────────────────────────────
  // Rule-based evaluator. Takes a full session object (with .problems and .stats)
  // and optional flattened historical problems array.
  // Returns an array of { severity, title, detail, drill, drillParams } objects.

  function generatePrescriptions(session, historicalProblems) {
    const prescriptions = [];
    const problems = (session && session.problems) ? session.problems : [];
    if (problems.length < 5) return prescriptions;

    const stats = session.stats || {};

    // ── Rule 1: Tens_Crossing spike ─────────────────────────────────────────
    const addProblems  = problems.filter(p => tagIncludes(p, 'Addition'));
    const tensCrossing = problems.filter(p => tagIncludes(p, 'Tens_Crossing'));
    if (addProblems.length >= 3 && tensCrossing.length >= 2) {
      const baseAvg = cognitiveMedianMs(addProblems.filter(p => !tagIncludes(p, 'Tens_Crossing')));
      const tcAvg   = cognitiveMedianMs(tensCrossing);
      if (baseAvg > 0 && tcAvg - baseAvg > 300) {
        prescriptions.push({
          severity:   'critical',
          title:      'Tens-Boundary Blockage Detected',
          detail:     `Tens_Crossing latency is ${Math.round(tcAvg - baseAvg)}ms above your plain-addition baseline (${Math.round(baseAvg)}ms → ${Math.round(tcAvg)}ms). Your carry-handling algorithm is not yet automated. Each crossing forces an active recomputation that is eating your velocity.`,
          drill:      'Tens-Complement Sprint',
          drillParams: { type: 'adaptive', tags: ['Tens_Crossing'], duration: 90 }
        });
      }
    }

    // ── Rule 2: Emotional Hangover ──────────────────────────────────────────
    const postErrorProblems = problems.filter(p => p.isPostError && !p.wasError);
    const baselineProblems  = problems.filter(p => !p.isPostError && !p.wasError);
    if (postErrorProblems.length >= 2 && baselineProblems.length >= 5) {
      const postAvg = cognitiveMedianMs(postErrorProblems);
      const normAvg = cognitiveMedianMs(baselineProblems);
      if (postAvg - normAvg > 500) {
        prescriptions.push({
          severity:   'critical',
          title:      'Emotional Hangover Pattern',
          detail:     `The ${postErrorProblems.length} problems immediately following your errors average ${Math.round(postAvg)}ms — a ${Math.round(postAvg - normAvg)}ms regression from your ${Math.round(normAvg)}ms baseline. Residual anxiety is physically slowing your reading and keypress initiation across two full problem cycles.`,
          drill:      'Anti-Hesitation Metronome',
          drillParams: { type: 'metronome', threshold: 800, duration: 60 }
        });
      }
    }

    // ── Rule 3: Late-Stage Deceleration ─────────────────────────────────────
    const fatigue = computeFatigueCurve(problems);
    if (fatigue && fatigue.deltaMs > 200) {
      prescriptions.push({
        severity:   'warning',
        title:      'Late-Stage Deceleration',
        detail:     `Your last-15s average (${fatigue.lateAvgMs}ms) is ${fatigue.deltaMs}ms slower than your opening-15s average (${fatigue.earlyAvgMs}ms). A fatigue ratio of ${fatigue.fatigueRatio}× is compressing your peak-score ceiling. Your brain is not sustaining recall speed under prolonged activation.`,
        drill:      'Stamina Endurance Mode',
        drillParams: { type: 'stamina', duration: 180 }
      });
    }

    // ── Rule 4: Systemic Friction dominance ─────────────────────────────────
    const frictionProblems = problems.filter(p => p.zone === 'Systemic_Friction');
    if (frictionProblems.length > problems.length * 0.20) {
      const tagCounts = countTags(frictionProblems);
      const topEntry  = Object.entries(tagCounts).sort((a, b) => b[1] - a[1])[0];
      const topTag    = topEntry ? topEntry[0] : null;
      prescriptions.push({
        severity:   'warning',
        title:      `Systemic Friction Overrepresentation${topTag ? `: ${topTag}` : ''}`,
        detail:     `${Math.round((frictionProblems.length / problems.length) * 100)}% of your problems exceeded 1200ms (Systemic Friction threshold). This is above the elite 5% target. ${topTag ? `Primary structural offender: ${topTag}.` : ''} These are not just slow answers — they represent a complete breakdown of procedural fluency.`,
        drill:      'Adaptive Weak-Point Loop',
        drillParams: { type: 'adaptive', tags: topTag ? [topTag] : [], duration: 90 }
      });
    }

    // ── Rule 5: Double-Digit Divisor bloat ──────────────────────────────────
    const dddProblems = problems.filter(p => tagIncludes(p, 'Double_Digit_Divisor'));
    if (dddProblems.length >= 2) {
      const dddAvg = cognitiveMedianMs(dddProblems);
      if (dddAvg > 1200) {
        prescriptions.push({
          severity:   'info',
          title:      'Double-Digit Divisor Bottleneck',
          detail:     `Your ${dddProblems.length} double-digit division problems averaged ${Math.round(dddAvg)}ms, landing firmly in Systemic Friction territory. Lack of automated reciprocal estimates (1/12 ≈ 0.083, 1/11 ≈ 0.09) is forcing multi-step long division each time.`,
          drill:      'Adaptive Weak-Point Loop',
          drillParams: { type: 'adaptive', tags: ['Double_Digit_Divisor'], duration: 90 }
        });
      }
    }

    // ── Rule 6: Perfect Square recall gaps ──────────────────────────────────
    const sqProblems = problems.filter(p => tagIncludes(p, 'Perfect_Square'));
    if (sqProblems.length >= 2) {
      const sqAvg = cognitiveMedianMs(sqProblems);
      if (sqAvg > 600) {
        prescriptions.push({
          severity:   'info',
          title:      'Perfect Square Recall Gap',
          detail:     `Perfect squares averaging ${Math.round(sqAvg)}ms indicates these are not yet in long-term memory. They should be Direct Retrieval (<400ms). Each one solved procedurally costs ~800ms of unnecessary latency versus a memorised response.`,
          drill:      'Adaptive Weak-Point Loop',
          drillParams: { type: 'adaptive', tags: ['Perfect_Square'], duration: 60 }
        });
      }
    }

    // ── Rule 7: Teen Factor drag ─────────────────────────────────────────────
    const teenProblems = problems.filter(p => tagIncludes(p, 'Teen_Factor'));
    if (teenProblems.length >= 3) {
      const teenAvg = cognitiveMedianMs(teenProblems);
      if (teenAvg > 900) {
        prescriptions.push({
          severity:   'info',
          title:      'Teen-Factor Multiplication Drag',
          detail:     `Multiplications involving teen factors (13–19) average ${Math.round(teenAvg)}ms. These are high-frequency ZetaMac problem types. Distributing them: e.g. 14 × 7 = 10×7 + 4×7 = 98, should drop them below 600ms.`,
          drill:      'Adaptive Weak-Point Loop',
          drillParams: { type: 'adaptive', tags: ['Teen_Factor'], duration: 90 }
        });
      }
    }

    // Deduplicate by drill type and cap at 5 prescriptions, critical-first.
    const order = { critical: 0, warning: 1, info: 2 };
    return prescriptions
      .sort((a, b) => order[a.severity] - order[b.severity])
      .slice(0, 5);
  }

  // ─── Fact-Family Heatmap Matrix ───────────────────────────────────────────────
  // Returns a matrix object keyed by "a×b" with avgLatency and zone per cell.
  // Used by the dashboard to render the multiplication/division heatmap.

  function buildFactFamilyMatrix(problems, opFilter = ['mul', 'div']) {
    const cells = {};

    problems.forEach(p => {
      if (!opFilter.includes(p.op) || !p.a || !p.b) return;
      if (p.isPostError) return;
      const lo  = Math.min(p.a, p.b);
      const hi  = Math.max(p.a, p.b);
      const key = `${lo}×${hi}`;
      if (!cells[key]) cells[key] = { latencies: [], count: 0, a: lo, b: hi };
      cells[key].latencies.push(cognitiveLatency(p));
      cells[key].count++;
    });

    Object.values(cells).forEach(cell => {
      const m = median(winsorize(cell.latencies));
      cell.avgLatencyMs = m == null ? 0 : Math.round(m);
      cell.zone = categorizeSpeedZone(cell.avgLatencyMs);
      delete cell.latencies;
    });

    return cells;
  }

  // ─── Weak-Point Extractor ─────────────────────────────────────────────────────
  // Returns the top `limit` structural tags by average total latency,
  // excluding tags with fewer than `minCount` samples.
  // Tags whose average has dropped below `graduateMs` are excluded (they've graduated).

  function getWeakPoints(problems, limit = 5, minCount = 3, graduateMs = 600) {
    const tagStats = {};

    problems.forEach(p => {
      if (p.isPostError) return;
      const lat = cognitiveLatency(p);
      (p.tags || []).forEach(tag => {
        if (!tagStats[tag]) tagStats[tag] = { lats: [], count: 0 };
        tagStats[tag].lats.push(lat);
        tagStats[tag].count += 1;
      });
    });

    return Object.entries(tagStats)
      .filter(([, s]) => s.count >= minCount)
      .map(([tag, s]) => {
        const m = median(winsorize(s.lats));
        return { tag, avgLatencyMs: m == null ? 0 : Math.round(m), count: s.count };
      })
      .filter(t => t.avgLatencyMs >= graduateMs)
      .sort((a, b) => b.avgLatencyMs - a.avgLatencyMs)
      .slice(0, limit);
  }

  // ─── Problem Generator ────────────────────────────────────────────────────────
  // Core drill engine — generates problems for all drill modes.
  // settings: { ops, range, focusTags, weakPointFrequency }

  function generateProblem(settings = {}) {
    const {
      ops              = ['add', 'sub', 'mul', 'div'],
      range            = [2, 25],
      focusTags        = [],
      weakPointFreq    = 0.70
    } = settings;

    // Weighted focus mode: 70% chance of generating a tagged problem if focus tags exist.
    if (focusTags.length > 0 && Math.random() < weakPointFreq) {
      const tag = focusTags[Math.floor(Math.random() * focusTags.length)];
      const problem = generateProblemForTag(tag, range);
      if (problem) return problem;
    }

    const op = ops[Math.floor(Math.random() * ops.length)];
    return generateProblemForOp(op, range);
  }

  function generateProblemForTag(tag, range) {
    const [min, max] = range;
    const rand = (lo, hi) => Math.floor(Math.random() * (hi - lo + 1)) + lo;

    switch (tag) {
      case 'Tens_Crossing': {
        // Force a carry: pick `a` with a non-zero units digit, then pick `b` so units sum ≥ 10.
        let a, b, attempts = 0;
        do {
          attempts++;
          b = undefined;
          a = rand(Math.max(min, 11), Math.max(max, 50));
          const aUnits = a % 10;
          if (aUnits === 0) continue;
          b = rand(10 - aUnits, 9);  // guarantees carry
        } while ((b === undefined || b <= 0) && attempts < 20);
        if (b === undefined || attempts >= 20) return generateProblemForOp('add', range);
        return buildProblem('add', a, b);
      }

      case 'Borrowing_Required': {
        // minuend units digit < subtrahend units digit, and result > 0.
        let a, b, attempts = 0;
        do {
          attempts++;
          b = undefined;
          a = rand(Math.max(min, 12), Math.max(max, 50));
          const aUnits = a % 10;
          // b's units digit must be strictly greater than a's units digit.
          const bUnitsMin = aUnits + 1;
          if (bUnitsMin > 9) continue;
          const bUnits = rand(bUnitsMin, 9);
          // b must be < a; b = (some tens) * 10 + bUnits.
          const bTensMax = Math.floor((a - 1) / 10);
          if (bTensMax < 1) continue;
          const bTens = rand(1, bTensMax);
          b = bTens * 10 + bUnits;
        } while ((b === undefined || b >= a || b <= 0) && attempts < 30);
        if (b === undefined || attempts >= 30) return generateProblemForOp('sub', range);
        return buildProblem('sub', a, b);
      }

      case 'Cross_Hundred': {
        // Result crosses a hundreds boundary: e.g. 102 - 8 = 94.
        const hundreds = rand(1, 3) * 100;
        const b = rand(2, 15);
        const a = hundreds + rand(1, b - 1);  // a is just above a hundreds mark
        if (a <= b) return generateProblemForOp('sub', range);
        return buildProblem('sub', a, b);
      }

      case 'Perfect_Square': {
        const sqMin = Math.max(2, Math.ceil(Math.sqrt(min)));
        const sqMax = Math.min(20, Math.floor(Math.sqrt(max * 4)));
        const n = rand(sqMin, sqMax);
        return buildProblem('mul', n, n);
      }

      case 'Prime_Adjacent': {
        const primes = [7, 11, 13, 17, 19, 23].filter(p => p <= max);
        if (!primes.length) return generateProblemForOp('mul', range);
        const a = primes[Math.floor(Math.random() * primes.length)];
        const b = rand(Math.max(min, 2), Math.min(max, 20));
        return buildProblem('mul', a, b);
      }

      case 'Teen_Factor': {
        const teen = rand(13, Math.min(19, max));
        const b    = rand(Math.max(min, 2), Math.min(max, 15));
        return buildProblem('mul', teen, b);
      }

      case 'Times_5': {
        const a = rand(Math.max(min, 2), Math.min(max, 20));
        return buildProblem('mul', a, 5);
      }

      case 'Times_11': {
        const a = rand(Math.max(min, 2), Math.min(max, 20));
        return buildProblem('mul', a, 11);
      }

      case 'Times_12': {
        const a = rand(Math.max(min, 2), Math.min(max, 15));
        return buildProblem('mul', a, 12);
      }

      case 'Double_Digit_Divisor': {
        const b      = rand(10, Math.min(max, 20));
        const answer = rand(2, 12);
        const a      = b * answer;
        return buildProblem('div', a, b);
      }

      case 'Hard_Divisor': {
        const divisors = [7, 8, 9].filter(d => d <= max);
        const b = divisors[Math.floor(Math.random() * divisors.length)];
        const answer = rand(2, 12);
        return buildProblem('div', b * answer, b);
      }

      case 'Large_Addend': {
        const a = rand(50, Math.max(max, 90));
        const b = rand(50, Math.max(max, 90));
        return buildProblem('add', a, b);
      }

      default:
        return generateProblemForOp('add', range);
    }
  }

  function generateProblemForOp(op, range) {
    const [min, max] = range;
    const rand = (lo, hi) => Math.floor(Math.random() * (hi - lo + 1)) + lo;

    switch (op) {
      case 'add': {
        const a = rand(min, max);
        const b = rand(min, max);
        return buildProblem('add', a, b);
      }
      case 'sub': {
        const a = rand(Math.max(min, 5), max);
        const b = rand(1, a - 1);
        return buildProblem('sub', a, b);
      }
      case 'mul': {
        const a = rand(min, Math.min(max, 20));
        const b = rand(min, Math.min(max, 20));
        return buildProblem('mul', a, b);
      }
      case 'div': {
        const b      = rand(Math.max(min, 2), Math.min(max, 12));
        const answer = rand(2, 12);
        return buildProblem('div', b * answer, b);
      }
      default:
        return generateProblemForOp('add', range);
    }
  }

  // Builds a fully-tagged problem record from op + operands.
  function buildProblem(op, a, b) {
    const OP_SYMBOLS = { add: '+', sub: '−', mul: '×', div: '÷' };

    let answer;
    switch (op) {
      case 'add': answer = a + b; break;
      case 'sub': answer = a - b; break;
      case 'mul': answer = a * b; break;
      case 'div': answer = b !== 0 ? a / b : null; break;
      default:    answer = null;
    }

    const str = `${a} ${OP_SYMBOLS[op]} ${b}`;
    const tagged = tagMathStructure(str);

    return {
      str,
      op,
      a,
      b,
      answer,
      tags: tagged.tags
    };
  }

  // ─── Session Aggregator (used by dashboard for on-the-fly stats) ──────────────

  function aggregateProblems(problems) {
    if (!problems || !problems.length) return null;

    const latencies  = problems.map(p => p.t1 + p.t2);
    const avg        = arr => arr.reduce((s, v) => s + v, 0) / arr.length;
    const sorted     = [...latencies].sort((a, b) => a - b);
    const pct        = (n, d) => d > 0 ? Math.round((n / d) * 100) : 0;
    const median     = sorted[Math.floor(sorted.length / 2)] || 0;
    const p95idx     = Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1);

    const zones = { Direct_Retrieval: 0, Procedural_Calculation: 0, Systemic_Friction: 0 };
    problems.forEach(p => { if (p.zone && zones[p.zone] !== undefined) zones[p.zone]++; });

    const tagLatencies = {};
    problems.forEach(p => {
      const lat = p.t1 + p.t2;
      (p.tags || []).forEach(tag => {
        if (!tagLatencies[tag]) tagLatencies[tag] = [];
        tagLatencies[tag].push(lat);
      });
    });
    const tagAvg = {};
    Object.entries(tagLatencies).forEach(([t, lats]) => {
      tagAvg[t] = Math.round(avg(lats));
    });

    const errors    = problems.filter(p => p.wasError);
    const postError = problems.filter(p => p.isPostError && !p.wasError);

    return {
      total:          problems.length,
      correct:        problems.length - errors.length,
      errorCount:     errors.length,
      errorRate:      pct(errors.length, problems.length),
      avgLatencyMs:   Math.round(avg(latencies)),
      medianLatencyMs: median,
      p95LatencyMs:   sorted[p95idx] || 0,
      avgT1Ms:        Math.round(avg(problems.map(p => p.t1))),
      avgT2Ms:        Math.round(avg(problems.map(p => p.t2))),
      zones,
      tagAvg,
      fatigue:        computeFatigueCurve(problems),
      postErrorAvgMs: postError.length ? Math.round(avg(postError.map(p => p.t1 + p.t2))) : null
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  function isPrime(n) {
    if (n < 2)  return false;
    if (n === 2) return true;
    if (n % 2 === 0) return false;
    for (let i = 3; i * i <= n; i += 2) {
      if (n % i === 0) return false;
    }
    return true;
  }

  function tagIncludes(problem, tag) {
    return Array.isArray(problem.tags) && problem.tags.includes(tag);
  }

  // Returns the think-time only — the cognitive component of total latency.
  // Excludes typing time so that answer-digit-count doesn't leak into the signal.
  function cognitiveLatency(problem) {
    return problem.t1 || 0;
  }

  // Sorted-middle median. Boundary-safe: 0-length → null, 1-length → that value.
  function median(values) {
    if (!values || values.length === 0) return null;
    if (values.length === 1) return values[0];
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  }

  // Read-time outlier suppression. Clips each value to multiplier × median.
  // Robust against single-sample distractions (e.g. a 12-second lapse) without
  // touching the raw data on disk.
  function winsorize(values, multiplier = 3) {
    if (!values || values.length < 2) return values || [];
    const m = median(values);
    if (m == null || m <= 0) return values.slice();
    const cap = multiplier * m;
    return values.map(v => Math.min(v, cap));
  }

  // Canonical scoring pipeline for weak-point detection:
  // (1) drop post-error problems (their slowness reflects panic-recovery, not skill)
  // (2) extract cognitive latency (t1 only)
  // (3) winsorize at 3× session median
  // (4) take median
  // Returns 0 if the filtered set is empty (preserves the old contract for callers
  // that compare against 0 or use it in arithmetic).
  function cognitiveMedianMs(problems) {
    if (!problems || !problems.length) return 0;
    const t1s = problems.filter(p => !p.isPostError).map(cognitiveLatency);
    if (!t1s.length) return 0;
    const m = median(winsorize(t1s));
    return m == null ? 0 : m;
  }

  function countTags(problems) {
    const counts = {};
    problems.forEach(p =>
      (p.tags || []).forEach(t => { counts[t] = (counts[t] || 0) + 1; })
    );
    return counts;
  }

  // ─── Export ───────────────────────────────────────────────────────────────────

  root.ZetaAnalytics = {
    ZONES,
    categorizeSpeedZone,
    parseProblem,
    tagMathStructure,
    computeFatigueCurve,
    computeRollingVelocity,
    generatePrescriptions,
    buildFactFamilyMatrix,
    getWeakPoints,
    generateProblem,
    generateProblemForTag,
    generateProblemForOp,
    aggregateProblems,
    buildProblem,
    isPrime,
    median,
    winsorize,
    cognitiveLatency,
    cognitiveMedianMs
  };

})(typeof window !== 'undefined' ? window : globalThis);
