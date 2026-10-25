// MagTrack motion analytics: surgical-skill measures of the tracked instrument, plus the maths for tracking
// validation and instrument (pivot) calibration. Shared by the game (plain <script>, window.MotionMath) and by
// tests/ and tools/ (require). Positions in cm, times in s, speeds in cm/s.
//
// The measures are the hand-motion analysis used in surgical-skills research (path length, number of movements,
// time), plus idle time and smoothness. All are built to be robust to sensor noise, which would otherwise inflate
// them: path length only counts motion in steps bigger than the noise, speed is a centred difference over ~0.2 s,
// movements need hysteresis to start and stop, and smoothness is SPARC (spectral arc length; Balasubramanian et
// al. 2015), chosen because, unlike jerk-based measures, it barely changes with measurement noise.
(function (root) {
'use strict';

const DEFAULTS = {
  gap: 0.3,                      // s: samples further apart belong to separate stretches (instrument not tracked)
  pathStep: 0.15,                // cm: path length counts motion in steps of at least this (after a light smoothing)
  speedHalf: 2,                  // samples each side of the centred difference used for speed
  moveOn: 2.5, moveOff: 1.2,     // cm/s: a movement starts above moveOn and ends below moveOff
  minMove: 0.15,                 // s: shorter bursts are not counted as movements
  idleSpeed: 1.0, idleMin: 0.5,  // still (below idleSpeed) for idleMin s or more, while not touching tissue
  sparcFc: 10, sparcAmp: 0.05, sparcPad: 4, sparcMin: 0.3,   // SPARC settings (as published), and the shortest movement measured
};

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const median = xs => { const s = xs.filter(x => !isNaN(x)).sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN; };
const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
const quantile = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.round(q * (s.length - 1)))] : NaN; };

// samples: [{ t, p: [x, y, z], contact? }] in time order -> stretches without tracking gaps
function stretches(samples, o = DEFAULTS) {
  const out = [];
  let cur = [];
  for (const s of samples) {
    if (cur.length && s.t - cur[cur.length - 1].t > o.gap) { out.push(cur); cur = []; }
    cur.push(s);
  }
  if (cur.length) out.push(cur);
  return out;
}
function sampleDt(st) { return st.length > 1 ? median(st.slice(1).map((s, i) => s.t - st[i].t)) : 0; }

// centred moving average over 2h+1 samples (shorter at the ends)
function smoothed(st, h) {
  return st.map((_, i) => {
    const a = Math.max(0, i - h), b = Math.min(st.length - 1, i + h), q = [0, 0, 0];
    for (let j = a; j <= b; j++) for (let k = 0; k < 3; k++) q[k] += st[j].p[k] / (b - a + 1);
    return q;
  });
}
// Path length with a noise floor: positions are lightly smoothed, then the path only advances once the point has
// moved pathStep from the last anchor, so jitter around a still point adds nothing.
function pathLength(st, o = DEFAULTS) {
  const ps = smoothed(st, o.speedHalf);
  let L = 0, anchor = ps[0];
  for (const p of ps) { const d = dist(p, anchor); if (d >= o.pathStep) { L += d; anchor = p; } }
  if (ps.length) L += dist(ps[ps.length - 1], anchor);   // the last partial step
  return L;
}

// speed: centred difference over 2h samples of the lightly smoothed positions
function speeds(st, o = DEFAULTS) {
  const h = o.speedHalf, ps = smoothed(st, 1);
  return st.map((_, i) => {
    const a = Math.max(0, i - h), b = Math.min(st.length - 1, i + h);
    return b > a ? dist(ps[b], ps[a]) / (st[b].t - st[a].t) : 0;
  });
}
// movement = speed rises above moveOn and later falls below moveOff; returns [startIndex, endIndex] pairs
function movements(v, st, o = DEFAULTS) {
  const out = [];
  let start = -1;
  for (let i = 0; i <= v.length; i++) {
    if (start < 0 && i < v.length && v[i] > o.moveOn) {
      start = i;
      while (start > 0 && v[start - 1] > o.moveOff) start--;   // the movement began when speed left the rest level
    } else if (start >= 0 && (i === v.length || v[i] < o.moveOff)) {
      const end = i - 1;
      if (st[end].t - st[start].t >= o.minMove) out.push([start, end]);
      start = -1;
    }
  }
  return out;
}
// still for idleMin or more while not touching the tissue: hesitation, not an intentional hold in the tissue
function idleTime(v, st, o = DEFAULTS) {
  const dt = sampleDt(st);
  let total = 0, run = 0;
  for (let i = 0; i <= v.length; i++) {
    if (i < v.length && v[i] < o.idleSpeed && !st[i].contact) run++;
    else { if (run * dt >= o.idleMin) total += run * dt; run = 0; }
  }
  return total;
}
// SPARC of one speed profile sampled at fs (Hz). Closer to 0 = smoother; a single smooth reach is about -1.6.
function sparc(v, fs, o = DEFAULTS) {
  if (v.length < 4) return NaN;
  const n = 2 ** (Math.ceil(Math.log2(v.length)) + o.sparcPad);
  const fc = Math.min(o.sparcFc, fs / 2), kMax = Math.floor(fc * n / fs);
  const mag = [];
  for (let k = 0; k <= kMax; k++) {   // DFT of the zero-padded profile, only up to the cutoff
    let re = 0, im = 0;
    for (let j = 0; j < v.length; j++) { const a = -2 * Math.PI * k * j / n; re += v[j] * Math.cos(a); im += v[j] * Math.sin(a); }
    mag.push(Math.hypot(re, im));
  }
  const peak = Math.max(...mag);
  if (!(peak > 0)) return NaN;
  const m = mag.map(x => x / peak);
  let last = 0;
  for (let k = 0; k < m.length; k++) if (m[k] >= o.sparcAmp) last = k;   // adaptive cutoff: last bin above the threshold
  if (last < 1) return NaN;
  let arc = 0;
  for (let k = 1; k <= last; k++) arc += Math.hypot(1 / last, m[k] - m[k - 1]);
  return -arc;
}

// Everything at once. opts.sparc = false skips smoothness (the live view recomputes often).
function analyze(samples, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  let path = 0, moves = 0, idle = 0, tracked = 0;
  const sp = [];
  for (const st of stretches(samples, o)) {
    if (st.length < 2) continue;
    const dt = sampleDt(st), v = speeds(st, o), mv = movements(v, st, o);
    tracked += st[st.length - 1].t - st[0].t + dt;
    path += pathLength(st, o);
    moves += mv.length;
    idle += idleTime(v, st, o);
    if (opts.sparc !== false)
      for (let [a, b] of mv) {
        if (st[b].t - st[a].t < o.sparcMin) continue;
        // SPARC wants the whole speed profile from rest to rest: widen to the speed minima on either side
        while (a > 0 && v[a - 1] < v[a]) a--;
        while (b < v.length - 1 && v[b + 1] < v[b]) b++;
        sp.push(sparc(v.slice(a, b + 1), 1 / dt, o));
      }
  }
  return {
    trackedS: tracked, pathCm: path, moves, idleS: idle,
    movesPerMin: tracked > 0 ? 60 * moves / tracked : 0,
    sparc: sp.length ? median(sp) : null, sparcN: sp.length,
  };
}

// --- progress across attempts ---
// lower is better for these, higher for the others
const BETTER = { pathCm: -1, moves: -1, idleS: -1, sparc: 1, time: -1, points: 1 };
const LABEL = { pathCm: 'path length', moves: 'movements', idleS: 'idle time', sparc: 'smoothness', time: 'time', points: 'score' };
// cur: { pathCm, moves, ... }; prev: earlier attempts of the same procedure, oldest first. Compares with the
// average of the last `window` of them.
function compare(cur, prev, window = 3) {
  const out = {};
  const last = prev.slice(-window);
  for (const k of Object.keys(BETTER)) {
    const before = last.map(p => p[k]).filter(x => typeof x === 'number' && isFinite(x));
    if (typeof cur[k] !== 'number' || !isFinite(cur[k]) || !before.length) continue;
    const b = mean(before), pct = b ? 100 * (cur[k] - b) / Math.abs(b) : 0;
    out[k] = { now: cur[k], before: b, n: before.length, changePct: pct, improved: BETTER[k] * pct > 0 };
  }
  return out;
}
// the clearest improvement worth saying out loud (at least minPct better), or null
function bestImprovement(cmp, minPct = 8) {
  let best = null;
  for (const [k, c] of Object.entries(cmp)) {
    const gain = BETTER[k] * c.changePct;
    if (k !== 'points' && gain >= minPct && (!best || gain > best.gainPct)) best = { key: k, label: LABEL[k], gainPct: gain, ...c };
  }
  return best;
}

// --- tracking validation ---
// points: [{ known: [x,y,z], measured: [x,y,z], sd?: number (cm, spread of the samples) }] -> error statistics (cm)
function validationStats(points) {
  const errs = points.map(p => [0, 1, 2].map(j => p.measured[j] - p.known[j]));
  const e = errs.map(v => Math.hypot(...v)), h = errs.map(v => Math.hypot(v[0], v[2])), y = errs.map(v => Math.abs(v[1]));
  const rms = xs => Math.sqrt(mean(xs.map(x => x * x)));
  const sds = points.map(p => p.sd).filter(x => typeof x === 'number');
  return {
    n: points.length, meanErr: mean(e), medianErr: median(e), rmsErr: rms(e), p95Err: quantile(e, 0.95), maxErr: Math.max(...e),
    horizRms: rms(h), vertRms: rms(y),
    bias: [0, 1, 2].map(j => mean(errs.map(v => v[j]))),   // systematic offset; what is left after removing it is scatter
    precision: sds.length ? mean(sds) : null,                // how much the reading wanders while the magnet is still
    errors: e,
  };
}

// --- pivot calibration ---
// Hold the instrument's tip still on one point and rock the handle. Every sample (p = magnet centre, d = unit axis
// pointing from the handle to the tip) satisfies p + offset * d = tip, so offset and tip come from linear least
// squares. Returns { offset (cm), tip, rms (cm), spreadDeg, n } or null if the samples don't pin it down.
function pivotCalibrate(samples, solve) {
  if (samples.length < 10) return null;
  const A = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], b = [0, 0, 0, 0];
  for (const { p, d } of samples) {   // unknowns [offset, Tx, Ty, Tz]; each sample: offset*d - T = -p
    const rows = [0, 1, 2].map(j => [d[j], ...[0, 1, 2].map(k => (k === j ? -1 : 0))]);
    rows.forEach((r, j) => { for (let a = 0; a < 4; a++) { b[a] += r[a] * -p[j]; for (let c = 0; c < 4; c++) A[a][c] += r[a] * r[c]; } });
  }
  const x = solve(A, b);
  if (!x || !x.every(isFinite)) return null;
  const offset = x[0], tip = x.slice(1);
  const res = samples.map(({ p, d }) => dist([0, 1, 2].map(j => p[j] + offset * d[j]), tip));
  const md = (() => { const m = [0, 1, 2].map(j => mean(samples.map(s => s.d[j]))), l = Math.hypot(...m); return m.map(v => v / l); })();
  const spreadDeg = Math.max(...samples.map(s => Math.acos(Math.min(1, s.d[0] * md[0] + s.d[1] * md[1] + s.d[2] * md[2])) * 180 / Math.PI));
  return { offset, tip, rms: Math.sqrt(mean(res.map(r => r * r))), spreadDeg, n: samples.length };
}

const MotionMath = { DEFAULTS, BETTER, LABEL, stretches, pathLength, speeds, movements, idleTime, sparc, analyze, compare, bestImprovement, validationStats, pivotCalibrate, median, mean };
if (typeof module === 'object' && module.exports) module.exports = MotionMath;
else root.MotionMath = MotionMath;
})(typeof globalThis !== 'undefined' ? globalThis : this);
