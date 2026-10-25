// End-to-end check of the tracking-validation re-analysis: writes a synthetic recording (magnet at known grid
// points, raw chip readings from the dipole model plus noise, logged like the game's tracking check), runs
// `node tools/analyze.js <log> --validate`, and checks the re-fitted error. Run with `node --test tests/`.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const AXIS_MAP = [[0, -1, 0], [0, 0, 1], [-1, 0, 0]];   // board = AXIS_MAP . raw (as viewer.html)
const CHIPS = [[-1.7, -3.4], [1.7, -3.4], [0, 0], [-1.7, 3.4], [1.7, 3.4]];
const POS = CHIPS.map(([x, z]) => [x, 0.05, z]);
let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function chipRaw(magnet, offsets, noise) {   // raw readings (uT) of all chips for a magnet { p, m } in board cm
  return POS.flatMap((s, i) => {
    let b = [0, 0, 0];
    if (magnet) {
      const r = s.map((v, k) => v - magnet.p[k]), d = Math.hypot(...r), u = r.map(v => v / d), md = dot(magnet.m, u);
      b = b.map((_, k) => (3 * md * u[k] - magnet.m[k]) / d ** 3);
    }
    const raw = [0, 1, 2].map(j => AXIS_MAP[0][j] * b[0] + AXIS_MAP[1][j] * b[1] + AXIS_MAP[2][j] * b[2]);   // transpose: board -> raw
    return raw.map((v, k) => v + offsets[i][k] + gauss() * noise);
  });
}

function writeLog(file, points, { noise = 1, bias = [0, 0, 0] } = {}) {
  const off = POS.map(() => [gauss() * 20, gauss() * 20, gauss() * 20]);
  const lines = ['# MagTrack recording v1 (synthetic, tests/validate.test.js)'];
  let t = 0;
  const put = (kind, x) => lines.push(`${t.toFixed(1)}\t${kind}\t${typeof x === 'string' ? x : JSON.stringify(x)}`);
  const B = v => put('dev', 'B,' + v.map(x => x.toFixed(2)).join(','));
  put('app', { event: 'start', config: { SENSOR_POS: CHIPS, AXIS_MAP, cal: null } });
  for (let k = 0; k < 25; k++) { t += 53.5; B(chipRaw(null, off, noise)); }
  put('app', { event: 'zero_done', baseline: off.flat() });
  for (const [k, known] of points.entries()) {
    for (let j = 0; j < 20; j++) { t += 53.5; B(chipRaw(null, off, noise)); }   // magnet away between points
    const truePos = known.map((v, j) => v + bias[j]);
    for (let j = 0; j < 28; j++) { t += 53.5; B(chipRaw({ p: truePos, m: [0, -15000, 0] }, off, noise)); }
    put('app', { event: 'or_validation_point', what: 'magnet', offset: null, k: k + 1, known, measured: truePos, sd: 0.01, n: 28, secs: 1.5, rel: 0.02, tiltDeg: 0, manual: false });
  }
  fs.writeFileSync(file, lines.join('\n') + '\n');
}
const run = file => execFileSync(process.execPath, [path.join(__dirname, '..', 'tools', 'analyze.js'), file, '--validate'], { encoding: 'utf8' });
const known = [[-2, 3.15, -3], [0, 3.15, 0], [2, 3.15, 3], [2, 3.15, -3], [-2, 3.15, 3]];

test('re-fits tracking-check points from raw data: a perfect tracker scores near 0 mm', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'magtrack-')), 'v.log');
  writeLog(file, known);
  const outText = run(file);
  const m = /MEASURED over (\d+) points: error mean ([\d.]+) mm/.exec(outText);
  assert.ok(m, outText.slice(-800));
  assert.strictEqual(+m[1], known.length);
  assert.ok(+m[2] < 1, `mean error ${m[2]} mm`);
});

test('a real offset between the known and true positions shows up as error and bias', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'magtrack-')), 'v.log');
  writeLog(file, known, { bias: [0.3, 0, 0] });   // the magnet really sat 3 mm to the right of each cross
  const outText = run(file);
  const m = /error mean ([\d.]+) mm/.exec(outText), b = /systematic offset \(x, y, z\) ([-\d.]+), ([-\d.]+), ([-\d.]+) mm/.exec(outText);
  assert.ok(Math.abs(+m[1] - 3) < 1, `mean ${m[1]}`);
  assert.ok(Math.abs(+b[1] - 3) < 1 && Math.abs(+b[2]) < 1 && Math.abs(+b[3]) < 1, `bias ${b.slice(1)}`);
});

test('says so when a recording has no tracking-check points', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'magtrack-')), 'v.log');
  writeLog(file, []);
  assert.match(run(file), /no tracking-check points/);
});
