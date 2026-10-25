// MagTrack math shared by viewer.html (loaded as a plain <script>) and tools/analyze.js (via require).
// Vectors are [x, y, z] arrays, matrices are arrays of rows. Fields in microtesla, positions in cm.
(function (root) {
'use strict';

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = a => Math.sqrt(dot(a, a));
const normalize = a => scale(a, 1 / (norm(a) || 1));
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const matVec = (M, v) => M.map(r => dot(r, v));
const matMul = (A, B) => A.map(r => [0, 1, 2].map(j => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
const transpose = A => [0, 1, 2].map(i => [A[0][i], A[1][i], A[2][i]]);
const det3 = A => dot(A[0], [A[1][1] * A[2][2] - A[1][2] * A[2][1], A[1][2] * A[2][0] - A[1][0] * A[2][2], A[1][0] * A[2][1] - A[1][1] * A[2][0]]);
const mean3 = vs => scale(vs.reduce(add, [0, 0, 0]), 1 / vs.length);
const angleDeg = (a, b) => Math.acos(clamp(dot(a, b) / (norm(a) * norm(b) || 1), -1, 1)) * 180 / Math.PI;

// Solve A x = b (n x n) by Gaussian elimination with partial pivoting; null if singular.
function solve(A, b) {
  const n = b.length, a = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (!(Math.abs(a[p][c]) > 1e-300)) return null;
    [a[c], a[p]] = [a[p], a[c]];
    for (let r = c + 1; r < n; r++) {
      const f = a[r][c] / a[c][c];
      for (let k = c; k <= n; k++) a[r][k] -= f * a[c][k];
    }
  }
  const x = new Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = a[r][n];
    for (let k = r + 1; k < n; k++) s -= a[r][k] * x[k];
    x[r] = s / a[r][r];
  }
  return x;
}

// Eigen-decomposition of a symmetric matrix (cyclic Jacobi). vectors[k] belongs to values[k].
function eigSym(S) {
  const n = S.length, a = S.map(r => r.slice()), v = a.map((_, i) => a.map((_, j) => +(i === j)));
  const total = a.reduce((s, r) => s + r.reduce((t, x) => t + x * x, 0), 0);
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] ** 2;
    if (off <= 1e-30 * total) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (a[p][q] === 0) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) {
        const kp = a[k][p], kq = a[k][q];
        a[k][p] = c * kp - s * kq; a[k][q] = s * kp + c * kq;
      }
      for (let k = 0; k < n; k++) {
        const pk = a[p][k], qk = a[q][k];
        a[p][k] = c * pk - s * qk; a[q][k] = s * pk + c * qk;
      }
      for (let k = 0; k < n; k++) {
        const kp = v[k][p], kq = v[k][q];
        v[k][p] = c * kp - s * kq; v[k][q] = s * kp + c * kq;
      }
    }
  }
  return { values: a.map((r, i) => r[i]), vectors: a.map((_, k) => v.map(r => r[k])) };
}

// --- rotations ---

const quatToMat = ([w, x, y, z]) => [
  [w * w + x * x - y * y - z * z, 2 * (x * y - w * z), 2 * (x * z + w * y)],
  [2 * (x * y + w * z), w * w - x * x + y * y - z * z, 2 * (y * z - w * x)],
  [2 * (x * z - w * y), 2 * (y * z + w * x), w * w - x * x - y * y + z * z],
];

// Rotation R minimising sum |R p_k - q_k|^2 (Horn's quaternion method).
function fitRotation(P, Q) {
  const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  P.forEach((p, k) => { for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) S[i][j] += p[i] * Q[k][j]; });
  const [[xx, xy, xz], [yx, yy, yz], [zx, zy, zz]] = S;
  const { values, vectors } = eigSym([
    [xx + yy + zz, yz - zy, zx - xz, xy - yx],
    [yz - zy, xx - yy - zz, xy + yx, zx + xz],
    [zx - xz, xy + yx, -xx + yy - zz, yz + zy],
    [xy - yx, zx + xz, yz + zy, -xx - yy + zz],
  ]);
  return quatToMat(normalizeQ(vectors[values.indexOf(Math.max(...values))]));
}
const normalizeQ = q => { const n = Math.hypot(...q) || 1; return q.map(x => x / n); };

const rotationAngle = R => Math.acos(clamp((R[0][0] + R[1][1] + R[2][2] - 1) / 2, -1, 1)) * 180 / Math.PI;

function axisAngle(R) {
  const angle = rotationAngle(R);
  if (angle < 1e-6) return { angle: 0, axis: [0, 1, 0] };
  if (angle > 179) {   // R ~ 2aa' - I: any column of (R + I)/2 is a multiple of the axis
    const d = [0, 1, 2].map(i => R[i][i]), k = d.indexOf(Math.max(...d));
    return { angle, axis: normalize([0, 1, 2].map(i => R[i][k] + (i === k ? 1 : 0))) };
  }
  return { angle, axis: normalize([R[2][1] - R[1][2], R[0][2] - R[2][0], R[1][0] - R[0][1]]) };
}

// The 24 ways to mount a chip square to the board (signed permutation matrices with det +1).
const RIGHT_ANGLE_ROTATIONS = (() => {
  const out = [];
  for (const p of [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]])
    for (let s = 0; s < 8; s++) {
      const M = [0, 1, 2].map(i => [0, 1, 2].map(j => j === p[i] ? ((s >> i) & 1 ? -1 : 1) : 0));
      if (det3(M) > 0) out.push(M);
    }
  return out;
})();

function snapRotation(R) {
  let best = null, errDeg = Infinity;
  for (const S of RIGHT_ANGLE_ROTATIONS) {
    const e = rotationAngle(matMul(transpose(S), R));
    if (e < errDeg) { errDeg = e; best = S; }
  }
  return { R: best, errDeg };
}

// Plain-words description of a rotation given in scene axes (x = left-right, y = up, z = top-bottom of card).
function describeRotation(R) {
  const { angle, axis } = axisAngle(R), a = Math.round(angle);
  if (a < 8) return 'matches the others';
  const k = [0, 1, 2].reduce((b, i) => Math.abs(axis[i]) > Math.abs(axis[b]) ? i : b, 0);
  if (Math.abs(axis[k]) < 0.95) return `rotated ${a}° about (${axis.map(v => v.toFixed(2)).join(', ')})`;
  if (k === 1) return a >= 172 ? 'turned 180° (seen from above)' : `turned ${a}° ${axis[1] > 0 ? 'counter-clockwise' : 'clockwise'} (seen from above)`;
  const word = k === 0 ? 'left-right' : 'top-bottom';
  return a >= 172 ? `flipped upside-down about the ${word} axis` : `tilted ${a}° about the ${word} axis`;
}

// --- fits ---

// Sphere through points: |p - c|^2 = r^2 is linear in (c, r^2 - |c|^2).
function fitSphere(pts) {
  const A = [0, 1, 2, 3].map(() => [0, 0, 0, 0]), b = [0, 0, 0, 0];
  for (const p of pts) {
    const row = [2 * p[0], 2 * p[1], 2 * p[2], 1], y = dot(p, p);
    for (let i = 0; i < 4; i++) { b[i] += row[i] * y; for (let j = 0; j < 4; j++) A[i][j] += row[i] * row[j]; }
  }
  const s = solve(A, b);
  if (!s) return null;
  const center = s.slice(0, 3), radius = Math.sqrt(Math.max(0, s[3] + dot(center, center)));
  const rms = Math.sqrt(pts.reduce((t, p) => t + (norm(sub(p, center)) - radius) ** 2, 0) / pts.length);
  return { center, radius, rms };
}

// Field of a point dipole at offset r = sensor - magnet is G(r) m, with G = (3 u u' - I) / |r|^3
// (moment m in uT*cm^3, i.e. with mu0/4pi folded in).
function dipoleMatrix(r) {
  const d = norm(r), u = scale(r, 1 / d), k = 1 / (d * d * d);
  return [0, 1, 2].map(i => [0, 1, 2].map(j => k * (3 * u[i] * u[j] - (i === j ? 1 : 0))));
}
const dipoleField = (r, m) => matVec(dipoleMatrix(r), m);

// For a trial magnet position, the best moment is a linear least-squares solve; returns the weighted misfit.
function dipoleResidual(p, pos, fields, w) {
  const AtA = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], Atb = [0, 0, 0];
  const Gs = pos.map(s => dipoleMatrix(sub(s, p)));
  Gs.forEach((G, i) => {
    const w2 = w[i] * w[i];
    for (let a = 0; a < 3; a++) {
      for (let k = 0; k < 3; k++) Atb[a] += w2 * G[k][a] * fields[i][k];
      for (let b = 0; b < 3; b++) for (let k = 0; k < 3; k++) AtA[a][b] += w2 * G[k][a] * G[k][b];
    }
  });
  const m = solve(AtA, Atb);
  if (!m || m.some(isNaN)) return null;
  const e = [];
  Gs.forEach((G, i) => { const pr = matVec(G, m); for (let k = 0; k < 3; k++) e.push(w[i] * (fields[i][k] - pr[k])); });
  return { m, e, cost: e.reduce((t, x) => t + x * x, 0) };
}

// Levenberg-Marquardt over the magnet position (moment solved exactly at each step).
// The magnet is kept above the board (y >= yMin): with every sensor in one plane, a magnet below the
// board gives the same readings as its mirror image above it.
function fitDipoleFrom(p0, pos, fields, w, yMin, maxR) {
  const fix = p => { const q = [p[0], Math.max(yMin, p[1]), p[2]], n = norm(q); return n > maxR ? scale(q, maxR / n) : q; };
  let p = fix(p0), cur = dipoleResidual(p, pos, fields, w), lambda = 1e-3;
  if (!cur) return null;
  for (let it = 0; it < 40; it++) {
    const h = 1e-4, J = [];
    for (let c = 0; c < 3; c++) {
      const pp = p.slice(); pp[c] += h;
      const r = dipoleResidual(pp, pos, fields, w);
      if (!r) return { pos: p, m: cur.m, cost: cur.cost };
      J.push(r.e.map((x, k) => (x - cur.e[k]) / h));
    }
    const H = [0, 1, 2].map(a => [0, 1, 2].map(b => J[a].reduce((t, x, k) => t + x * J[b][k], 0)));
    const g = [0, 1, 2].map(a => J[a].reduce((t, x, k) => t + x * cur.e[k], 0));
    let step = null;
    for (let tries = 0; tries < 12 && !step; tries++) {
      const A = H.map((r, i) => r.map((x, j) => x + (i === j ? lambda * (H[i][i] + 1e-12) : 0)));
      const d = solve(A, g.map(x => -x));
      if (!d) { lambda *= 10; continue; }
      const np = fix(add(p, d)), nr = dipoleResidual(np, pos, fields, w);
      if (nr && nr.cost < cur.cost) { step = norm(sub(np, p)); p = np; cur = nr; lambda = Math.max(lambda / 3, 1e-9); }
      else lambda *= 8;
    }
    if (step === null || step < 1e-5) break;
  }
  return { pos: p, m: cur.m, cost: cur.cost };
}

// Fit one magnet to the field vectors seen at pos[] (scene axes). Tries each seed, keeps the best.
// rel = weighted misfit / weighted signal (0 = perfect); pred = what the fitted magnet makes at each sensor.
function fitDipole(pos, fields, w, seeds, opts = {}) {
  const yMin = opts.yMin ?? 0.2, maxR = opts.maxR ?? 20;
  let best = null;
  for (const s of seeds) {
    const r = fitDipoleFrom(s, pos, fields, w, yMin, maxR);
    if (r && (!best || r.cost < best.cost)) best = r;
  }
  if (!best) return null;
  const signal = fields.reduce((t, f, i) => t + w[i] * w[i] * dot(f, f), 0);
  best.rel = Math.sqrt(best.cost / (signal || 1));
  best.pred = pos.map(s => dipoleField(sub(s, best.pos), best.m));
  return best;
}

// Starting guesses: above the strongest sensor at a few heights, and above the strength-weighted centroid.
function dipoleSeeds(pos, fields) {
  const mags = fields.map(norm), k = mags.indexOf(Math.max(...mags)), tot = mags.reduce((a, b) => a + b, 0);
  const c = pos.reduce((a, p, i) => add(a, scale(p, mags[i] / tot)), [0, 0, 0]);
  return [[pos[k][0], 1, pos[k][2]], [pos[k][0], 2.5, pos[k][2]], [pos[k][0], 4.5, pos[k][2]], [c[0], 2, c[2]], [c[0], 6, c[2]]];
}

// --- orientation calibration ---

// "Tumble" calibration. While the board is turned through many orientations away from magnets, every chip
// sees the same Earth field, each in its own axes. Comparing chips after removing their means (which also
// removes each chip's offset) gives each chip's rotation relative to the others. The largest group of
// chips that agree is taken as mounted the way axisMap assumes.
// tumble/spin: raw 15-value samples; axisMap: sensor -> scene matrix shared by correctly mounted chips.
function calibrateTumble(tumble, spin, axisMap, n = 5) {
  const vec = (r, i) => [r[3 * i], r[3 * i + 1], r[3 * i + 2]];
  const valid = (r, i) => !vec(r, i).some(isNaN);
  const live = [...Array(n).keys()].filter(i => tumble.filter(r => valid(r, i)).length >= 0.8 * tumble.length && tumble.length);
  const rows = tumble.filter(r => live.every(i => valid(r, i)));
  if (live.length < 2 || rows.length < 50)
    return { error: `need at least 50 samples from at least 2 chips (got ${rows.length} samples, ${live.length} chips)` };

  const per = [], centered = [];
  for (const i of live) {
    per[i] = rows.map(r => vec(r, i));
    const m = mean3(per[i]);
    centered[i] = per[i].map(v => sub(v, m));
  }
  const ref = live.includes(2) ? 2 : live[0];

  // how far the reference chip's readings spread in their narrowest direction (small = not tumbled enough)
  const cov = [0, 1, 2].map(a => [0, 1, 2].map(b => centered[ref].reduce((t, v) => t + v[a] * v[b], 0) / rows.length));
  const spreadUt = Math.sqrt(Math.max(0, Math.min(...eigSym(cov).values)));

  const toRef = [], snaps = [];
  for (const i of live) { toRef[i] = fitRotation(centered[i], centered[ref]); snaps[i] = snapRotation(toRef[i]); }
  const groups = {};
  for (const i of live) (groups[JSON.stringify(snaps[i].R)] ||= []).push(i);
  const biggest = Object.values(groups).sort((a, b) => b.length - a.length || b.includes(ref) - a.includes(ref))[0];
  const G = snaps[biggest[0]].R;   // axes of the biggest group -> reference chip axes

  const sensors = [...Array(n).keys()].map(i => {
    if (!live.includes(i)) return { live: false, C: axisMap, text: 'no data (left as is)' };
    const Q = matMul(transpose(G), toRef[i]);   // chip i axes -> axes of a correctly mounted chip
    const C = matMul(axisMap, Q);
    const target = centered[ref].map(v => matVec(transpose(G), v));
    const residUt = Math.sqrt(centered[i].reduce((t, v, k) => t + dot(sub(matVec(Q, v), target[k]), sub(matVec(Q, v), target[k])), 0) / rows.length);
    const sph = fitSphere(per[i]);
    return {
      live: true, C, Q, residUt,
      snapErrDeg: snapRotation(Q).errDeg,
      text: describeRotation(matMul(matMul(axisMap, Q), transpose(axisMap))),
      offset: sph && sph.center, earthUt: sph && sph.radius, sphereRms: sph && sph.rms,
    };
  });

  // Flat clockwise spin: in the board's frame the Earth's horizontal field turns the other way, i.e. its angle
  // atan2(x, z) increases. If it decreases, the axis map is mirrored (or the board was spun the other way).
  let spinCheck = null;
  const spinRows = spin.filter(r => live.every(i => valid(r, i)));
  if (spinRows.length >= 20) {
    const board = spinRows.map(r => mean3(live.map(i => matVec(sensors[i].C, sub(vec(r, i), sensors[i].offset || [0, 0, 0])))));
    let turned = 0;
    for (let k = 1; k < board.length; k++) {
      let d = Math.atan2(board[k][0], board[k][2]) - Math.atan2(board[k - 1][0], board[k - 1][2]);
      d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
      if (Math.abs(d) < Math.PI / 9) turned += d;   // skip jumps (board being put down), not a slow spin
    }
    spinCheck = {
      turnedDeg: turned * 180 / Math.PI,
      verticalUt: board.reduce((t, v) => t + v[1], 0) / board.length,
      horizontalUt: board.reduce((t, v) => t + Math.hypot(v[0], v[2]), 0) / board.length,
    };
  }
  return { sensors, C: sensors.map(s => s.C), ref, group: biggest, spreadUt, samples: rows.length, spin: spinCheck };
}

// --- recordings ---

// Recording format, one entry per line: "<ms since start>\t<kind>\t<text>". kind is dev (a line from the
// board), app (a viewer event, JSON) or mark (a note typed while recording). Lines starting with # are comments.
function parseLog(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line || line[0] === '#') continue;
    const a = line.indexOf('\t'), b = line.indexOf('\t', a + 1);
    if (a < 0 || b < 0) continue;
    const e = { t: +line.slice(0, a), kind: line.slice(a + 1, b), text: line.slice(b + 1).replace(/\r$/, '') };
    if (isNaN(e.t)) continue;
    if (e.kind === 'app') { try { e.data = JSON.parse(e.text); } catch (err) { e.data = {}; } }
    out.push(e);
  }
  return out;
}

// "B,x0,y0,z0,...,x4,y4,z4" -> 15 numbers ("nan" -> NaN), or null for anything else.
function parseSample(line) {
  if (!line.startsWith('B,')) return null;
  const v = line.trim().split(',').slice(1).map(Number);
  return v.length === 15 ? v : null;
}

const MagMath = {
  add, sub, scale, dot, norm, normalize, matVec, matMul, transpose, det3, mean3, angleDeg, solve, eigSym,
  fitRotation, rotationAngle, axisAngle, snapRotation, describeRotation, RIGHT_ANGLE_ROTATIONS,
  fitSphere, dipoleMatrix, dipoleField, fitDipole, dipoleSeeds, calibrateTumble, parseLog, parseSample,
};
if (typeof module === 'object' && module.exports) module.exports = MagMath;
else root.MagMath = MagMath;
})(typeof globalThis !== 'undefined' ? globalThis : this);
