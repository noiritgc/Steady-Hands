// Tests for motion.js: run with `node --test tests/` (Node 18+, no dependencies).
// Synthetic instrument paths sampled like the board (18.7 Hz) with sensor-like noise, so the expected answers are known.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const MM = require('../motion.js');
const M = require('../magmath.js');

const FS = 18.7, DT = 1 / FS;
function rng(seed) {   // deterministic noise (mulberry32 + Box-Muller)
  let a = seed >>> 0;
  const u = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return sd => sd * Math.sqrt(-2 * Math.log(u() || 1e-12)) * Math.cos(2 * Math.PI * u());
}
const noisy = (samples, sd, seed = 1) => { const g = rng(seed); return samples.map(s => ({ ...s, p: s.p.map(v => v + g(sd)) })); };
const minJerk = u => 10 * u ** 3 - 15 * u ** 4 + 6 * u ** 5;   // a smooth point-to-point reach, 0..1
// a path built from pieces: { reach: [dx,dy,dz], secs } or { pause: secs }
function build(pieces, contact = false) {
  const out = [];
  let t = 0, p = [0, 3, 0];
  for (const pc of pieces) {
    const n = Math.round((pc.secs ?? pc.pause) * FS);
    const from = p.slice();
    for (let i = 1; i <= n; i++) {
      if (pc.reach) { const s = minJerk(i / n); p = from.map((v, j) => v + s * pc.reach[j]); }
      if (pc.wobble) p = p.map((v, j) => v + (j === 2 ? pc.wobble * Math.sin(2 * Math.PI * 3 * i / FS) * Math.sin(Math.PI * i / n) : 0));
      out.push({ t, p: p.slice(), contact });
      t += DT;
    }
  }
  return out;
}

test('path length ignores sensor noise', () => {
  const line = build([{ pause: 0.5 }, { reach: [10, 0, 0], secs: 2.5 }, { pause: 0.5 }]);
  const clean = MM.analyze(line), dirty = MM.analyze(noisy(line, 0.05));
  assert.ok(Math.abs(clean.pathCm - 10) < 0.2, `clean ${clean.pathCm}`);
  assert.ok(Math.abs(dirty.pathCm - 10) < 0.8, `noisy ${dirty.pathCm}`);
  // the naive sum of sample-to-sample distances would be far too long
  const naive = noisy(line, 0.05).slice(1).reduce((a, s, i, arr) => a + Math.hypot(...s.p.map((v, j) => v - (i ? arr[i - 1] : noisy(line, 0.05)[0]).p[j])), 0);
  assert.ok(naive > dirty.pathCm + 1.5, `naive ${naive}`);
});

test('holding still: no path, no movements, idle only when not touching tissue', () => {
  const still = noisy(build([{ pause: 5 }]), 0.05, 2);
  const a = MM.analyze(still);
  assert.ok(a.pathCm < 0.6, `path ${a.pathCm}`);
  assert.strictEqual(a.moves, 0);
  assert.ok(Math.abs(a.idleS - 5) < 0.3, `idle ${a.idleS}`);
  const inTissue = MM.analyze(still.map(s => ({ ...s, contact: true })));
  assert.strictEqual(inTissue.idleS, 0);
});

test('counts separate movements and the pauses between them', () => {
  const three = noisy(build([{ pause: 1 }, { reach: [3, 0, 0], secs: 0.8 }, { pause: 1.2 }, { reach: [0, 0, 3], secs: 0.8 }, { pause: 1.2 }, { reach: [-3, 0, 0], secs: 0.8 }, { pause: 1 }]), 0.04, 3);
  const a = MM.analyze(three);
  assert.strictEqual(a.moves, 3);
  assert.ok(a.idleS > 3.8 && a.idleS < 5.2, `idle ${a.idleS}`);   // 4.4 s of pauses plus the slow ends of each reach
  assert.ok(Math.abs(a.pathCm - 9) < 1, `path ${a.pathCm}`);
});

test('a tracking gap splits the path instead of adding a jump', () => {
  const a = build([{ reach: [3, 0, 0], secs: 1 }]);
  const b = build([{ reach: [3, 0, 0], secs: 1 }]).map(s => ({ ...s, t: s.t + 5, p: [s.p[0] + 20, s.p[1], s.p[2]] }));
  const r = MM.analyze(a.concat(b));
  assert.ok(Math.abs(r.pathCm - 6) < 0.4, `path ${r.pathCm}`);
});

// p(t) from overlapping min-jerk sub-movements [{ at (s), secs, d: [dx,dy,dz] }], with rest before and after
function subs(parts, total) {
  const out = [];
  for (let t = 0; t <= total; t += DT) {
    const p = [0, 3, 0];
    for (const s of parts) { const u = Math.min(1, Math.max(0, (t - s.at) / s.secs)); for (let j = 0; j < 3; j++) p[j] += s.d[j] * minJerk(u); }
    out.push({ t, p, contact: false });
  }
  return out;
}
test('SPARC: one smooth reach near -1.6, a reach made of hesitant sub-movements lower, noise barely matters', () => {
  const one = subs([{ at: 0.5, secs: 1.5, d: [6, 0, 0] }], 2.5);
  const choppy = subs([{ at: 0.5, secs: 0.6, d: [2, 0, 0] }, { at: 0.95, secs: 0.6, d: [2, 0, 0] }, { at: 1.4, secs: 0.6, d: [2, 0, 0] }], 2.5);
  const smooth = MM.analyze(one), wobbly = MM.analyze(choppy), smoothNoisy = MM.analyze(noisy(one, 0.05, 4));
  assert.ok(smooth.sparc < -1.3 && smooth.sparc > -2.0, `smooth ${smooth.sparc}`);
  assert.ok(wobbly.sparc < smooth.sparc - 0.3, `wobbly ${wobbly.sparc} vs ${smooth.sparc}`);
  assert.ok(Math.abs(smoothNoisy.sparc - smooth.sparc) < 0.35, `noisy ${smoothNoisy.sparc} vs ${smooth.sparc}`);
});

test('compare with earlier attempts and pick the improvement to announce', () => {
  const prev = [{ pathCm: 40, moves: 20, idleS: 10, sparc: -2.6, time: 60, points: 500 }, { pathCm: 36, moves: 18, idleS: 8, sparc: -2.4, time: 50, points: 600 }];
  const cmp = MM.compare({ pathCm: 26.6, moves: 19, idleS: 9, sparc: -2.0, time: 55, points: 700 }, prev);
  assert.ok(Math.abs(cmp.pathCm.changePct - -30) < 0.1 && cmp.pathCm.improved);
  assert.ok(cmp.sparc.improved && cmp.sparc.changePct > 0);
  assert.strictEqual(cmp.moves.improved, false);   // 19 vs an average of 19: no change, not an improvement
  const best = MM.bestImprovement(cmp);
  assert.strictEqual(best.key, 'pathCm');
  assert.strictEqual(MM.bestImprovement(MM.compare({ pathCm: 40 }, [{ pathCm: 40 }])), null);
  assert.deepStrictEqual(MM.compare({ pathCm: 10 }, []), {});
});

test('validation statistics', () => {
  const pts = [
    { known: [0, 3, 0], measured: [0.1, 3, 0], sd: 0.02 },
    { known: [2, 3, 0], measured: [2.1, 3, 0], sd: 0.04 },
    { known: [0, 3, 2], measured: [0.1, 3.3, 2], sd: 0.03 },
  ];
  const s = MM.validationStats(pts);
  assert.strictEqual(s.n, 3);
  assert.ok(Math.abs(s.bias[0] - 0.1) < 1e-9 && Math.abs(s.bias[1] - 0.1) < 1e-9);
  assert.ok(Math.abs(s.maxErr - Math.hypot(0.1, 0.3)) < 1e-9);
  assert.ok(Math.abs(s.horizRms - 0.1) < 1e-9);
  assert.ok(Math.abs(s.precision - 0.03) < 1e-9);
});

test('pivot calibration recovers the magnet-to-tip offset', () => {
  const g = rng(7), T = [0.5, 2.6, -1], offset = 4.2, samples = [];
  for (let i = 0; i < 150; i++) {   // rocking in a cone of ~30 degrees around vertical, with sensor-like noise
    const a = 2 * Math.PI * i / 37, tilt = (0.3 + 0.2 * Math.sin(i / 11)) ;
    const dTrue = [Math.sin(tilt) * Math.cos(a), -Math.cos(tilt), Math.sin(tilt) * Math.sin(a)];
    const p = T.map((v, j) => v - offset * dTrue[j] + g(0.03));
    const d = M.normalize(dTrue.map(v => v + g(0.015)));
    samples.push({ p, d });
  }
  const c = MM.pivotCalibrate(samples, M.solve);
  assert.ok(Math.abs(c.offset - offset) < 0.1, `offset ${c.offset}`);
  assert.ok(Math.hypot(...c.tip.map((v, j) => v - T[j])) < 0.15, `tip ${c.tip}`);
  assert.ok(c.spreadDeg > 20 && c.rms < 0.2, `spread ${c.spreadDeg} rms ${c.rms}`);
  assert.strictEqual(MM.pivotCalibrate(samples.slice(0, 5), M.solve), null);
});
