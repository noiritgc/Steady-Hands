#!/usr/bin/env node
// Summarise a MagTrack recording: data quality per chip, board messages, orientation calibration (from a
// tumble) and a one-magnet fit at every mark. Needs only Node; shares its math with the viewer (magmath.js).
//
// usage: node tools/analyze.js <recording.log> [options]
//   --tumble A-B   run the orientation calibration on this stretch (seconds from the start of the recording)
//   --spin A-B     flat clockwise spin used to check for mirrored axes
//   --window A-B   also fit a magnet over this stretch, like a mark
//   --axes raw|cal which chip orientation to use for magnet fits: raw = AXIS_MAP for every chip,
//                  cal = best calibration available (default)
//   --csv out.csv  write every sample as CSV (t_s, x0, y0, z0, ... x4, y4, z4; raw uT)
const fs = require('fs');
const M = require('../magmath.js');

const RAIL_UT = [24608, 24608, 39648];
const DEFAULT_POS = [[-1.7, -3.4], [1.7, -3.4], [0, 0], [-1.7, 3.4], [1.7, 3.4]];
const DEFAULT_AXIS_MAP = [[1, 0, 0], [0, 0, 1], [0, -1, 0]];
const MIN_THRESH_UT = 50, NOISE_MULT = 5, ZERO_SAMPLES = 25;

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : undefined; };
const range = s => { if (!s) return null; const [a, b] = s.split('-').map(Number); return [a * 1000, b * 1000]; };
const file = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (!file) { console.error('usage: node tools/analyze.js <recording.log> [--tumble A-B] [--spin A-B] [--window A-B] [--axes raw|cal] [--csv out.csv]'); process.exit(1); }

const entries = M.parseLog(fs.readFileSync(file, 'utf8'));
const events = entries.filter(e => e.kind === 'app');
const startEv = events.find(e => e.data.event === 'start');
const config = (startEv && startEv.data.config) || {};
const AXIS_MAP = config.AXIS_MAP || DEFAULT_AXIS_MAP;
const POS = (config.SENSOR_POS || DEFAULT_POS).map(([x, z]) => [x, 0.05, z]);
const N = POS.length;
const samples = entries.map(e => e.kind === 'dev' && { t: e.t, v: M.parseSample(e.text) }).filter(s => s && s.v);
const sec = ms => (ms / 1000).toFixed(1) + ' s';
const chipVec = (v, i) => [v[3 * i], v[3 * i + 1], v[3 * i + 2]];
const fmtV = v => '(' + v.map(x => x.toFixed(1)).join(', ') + ')';
const between = (a, b) => samples.filter(s => s.t >= a && s.t < b).map(s => s.v);
const out = (...a) => console.log(...a);
const head = t => out('\n== ' + t + ' ' + '='.repeat(Math.max(0, 66 - t.length)));

if (!samples.length) { out('no sensor samples in ' + file); process.exit(1); }

// --- overview ---
head('overview');
const t0 = samples[0].t, t1 = samples[samples.length - 1].t;
const dts = samples.slice(1).map((s, k) => s.t - samples[k].t).sort((a, b) => a - b);
const gaps = samples.slice(1).filter((s, k) => s.t - samples[k].t > 150);
out(`file        ${file}`);
if (startEv) out(`recorded    ${startEv.data.wall}`);
out(`samples     ${samples.length} over ${sec(t1 - t0)} (${(samples.length / ((t1 - t0) / 1000 || 1)).toFixed(1)} Hz, median spacing ${(dts[dts.length >> 1] || 0).toFixed(0)} ms)`);
out(`gaps >150ms ${gaps.length}` + (gaps.length ? ` (longest ${Math.max(...gaps.map(g => g.t - samples[samples.indexOf(g) - 1].t)).toFixed(0)} ms)` : ''));
out(`orientation ${config.cal ? 'calibration was in use when recording started' : 'no calibration when recording started (AXIS_MAP for every chip)'}`);

// --- board messages, events, marks ---
const msgs = {};
for (const e of entries) if (e.kind === 'dev' && e.text.startsWith('#')) (msgs[e.text] ||= { n: 0, t: e.t }).n++;
head('board messages');
if (!Object.keys(msgs).length) out('(none; start recording before connecting to capture the start-up messages)');
for (const [text, m] of Object.entries(msgs)) out(`${sec(m.t).padStart(8)}  ${m.n > 1 ? `x${m.n} ` : ''}${text}`);

head('events and marks');
for (const e of entries) {
  if (e.kind === 'mark') out(`${sec(e.t).padStart(8)}  MARK  ${e.text}`);
  else if (e.kind === 'app' && !['start', 'zero_done'].includes(e.data.event)) out(`${sec(e.t).padStart(8)}  ${e.data.event}`);
  else if (e.kind === 'app' && e.data.event === 'zero_done') out(`${sec(e.t).padStart(8)}  zero_done  thresholds ${(e.data.thresholds || []).map(x => (+x).toFixed(0)).join('/')} uT`);
}

// --- per-chip quality ---
// Noise comes from the zeroing windows (magnets away); without one, from the quietest 25 samples.
let rest = events.filter(e => e.data.event === 'zero_start').map(e => samples.filter(s => s.t >= e.t).slice(0, ZERO_SAMPLES).map(s => s.v)).filter(w => w.length);
let restNote = 'zeroing windows';
if (!rest.length) {
  let best = null, bestVar = Infinity;
  for (let k = 0; k + ZERO_SAMPLES <= samples.length; k += 5) {
    const w = samples.slice(k, k + ZERO_SAMPLES).map(s => s.v);
    const v = [...Array(N * 3).keys()].reduce((t, j) => { const x = w.map(r => r[j]).filter(a => !isNaN(a)); const m = x.reduce((a, b) => a + b, 0) / x.length; return t + x.reduce((a, b) => a + (b - m) ** 2, 0) / x.length; }, 0);
    if (v < bestVar) { bestVar = v; best = w; }
  }
  rest = [best]; restNote = 'quietest stretch (no zeroing in this recording)';
}
head('chips');
out(`noise from ${restNote}`);
out('chip  valid   noise rms   rest reading (raw uT)            max |raw|  clipped  jumps');
for (let i = 0; i < N; i++) {
  const vs = samples.map(s => chipVec(s.v, i));
  const ok = vs.filter(v => !v.some(isNaN));
  let clipped = 0, jumps = 0, maxRaw = 0;
  ok.forEach(v => { if (v.some((x, k) => Math.abs(x) >= 0.97 * RAIL_UT[k])) clipped++; maxRaw = Math.max(maxRaw, ...v.map(Math.abs)); });
  for (let k = 1; k < vs.length; k++) if (vs[k].some((x, a) => Math.abs(x - vs[k - 1][a]) > 1.2 * RAIL_UT[a])) jumps++;
  const restV = rest.flatMap(w => w.map(r => chipVec(r, i))).filter(v => !v.some(isNaN));
  const mean = restV.length ? M.mean3(restV) : [NaN, NaN, NaN];
  const rms = Math.sqrt(restV.reduce((t, v) => t + M.dot(M.sub(v, mean), M.sub(v, mean)), 0) / (restV.length || 1));
  out(`ch${i}  ${(100 * ok.length / vs.length).toFixed(1).padStart(5)}%  ${rms.toFixed(2).padStart(6)} uT   ${fmtV(mean).padEnd(30)}  ${maxRaw.toFixed(0).padStart(8)}  ${String(clipped).padStart(7)}  ${String(jumps).padStart(5)}`);
}

// --- orientation calibration ---
let calC = null;
const lastEv = name => [...events].reverse().find(e => e.data.event === name);
let tumbleR = range(opt('tumble')), spinR = range(opt('spin'));
if (!tumbleR) {
  const s = lastEv('calib_tumble_start'), sp = s && events.find(e => e.t > s.t && e.data.event === 'calib_spin_start');
  const end = s && events.find(e => e.t > s.t && ['calib_end', 'calib_cancel'].includes(e.data.event));
  if (s && end) { tumbleR = [s.t, sp && sp.t < end.t ? sp.t : end.t]; if (sp && sp.t < end.t && !spinR) spinR = [sp.t, end.t]; }
}
head('orientation calibration');
if (!tumbleR) out('no tumble in this recording (use the viewer\'s Calibrate orientation while recording, or pass --tumble A-B)');
else {
  const r = M.calibrateTumble(between(...tumbleR), spinR ? between(...spinR) : [], AXIS_MAP, N);
  out(`tumble ${sec(tumbleR[0])} - ${sec(tumbleR[1])}` + (spinR ? `, spin ${sec(spinR[0])} - ${sec(spinR[1])}` : ', no spin'));
  if (r.error) out('failed: ' + r.error);
  else {
    calC = r.C;
    out(`${r.samples} samples, spread ${r.spreadUt.toFixed(1)} uT in the least-turned direction${r.spreadUt < 12 ? '  << not turned enough, unreliable' : ''}`);
    out(`reference group (taken as mounted like AXIS_MAP): ${r.group.map(i => 'ch' + i).join(', ')}`);
    r.sensors.forEach((s, i) => out(s.live
      ? `ch${i}  ${s.text.padEnd(46)} misfit ${s.residUt.toFixed(1).padStart(5)} uT  ${s.snapErrDeg.toFixed(1).padStart(5)}° from square  |B| ${s.earthUt.toFixed(1)} uT  offset ${fmtV(s.offset)}`
      : `ch${i}  ${s.text}`));
    if (r.spin) out(`spin: field turned ${r.spin.turnedDeg.toFixed(0)}° (positive = not mirrored), vertical ${r.spin.verticalUt.toFixed(1)} uT, horizontal ${r.spin.horizontalUt.toFixed(1)} uT`);
    out('SENSOR_CAL for viewer.html:');
    out(JSON.stringify({ C: r.C.map(C => C.map(row => row.map(x => +x.toFixed(4)))), when: startEv ? startEv.data.wall : null }));
  }
}

// --- magnet fits at marks ---
const zeros = events.filter(e => e.data.event === 'zero_done' && e.data.baseline);
const applied = events.filter(e => e.data.event === 'calib_applied');
const windows = entries.filter(e => e.kind === 'mark').map(e => ({ t: e.t, note: e.text }));
const w = range(opt('window'));
if (w) windows.push({ t: w[0], end: w[1], note: `--window ${opt('window')}` });
const boundaries = entries.filter(e => e.kind === 'mark' || (e.kind === 'app' && /^(zero_start|calib_|disconnected|stop)/.test(e.data.event))).map(e => e.t);

const useRaw = opt('axes') === 'raw';
function matricesAt(t) {
  if (useRaw) return { C: POS.map(() => AXIS_MAP), src: 'AXIS_MAP for every chip (--axes raw)' };
  if (calC) return { C: calC, src: 'calibration computed above' };
  const a = applied.filter(e => e.t <= t).pop();
  if (a) return { C: a.data.cal.C, src: `calibration applied at ${sec(a.t)}` };
  if (config.cal) return { C: config.cal.C, src: 'calibration in use when recording started' };
  return { C: POS.map(() => AXIS_MAP), src: 'AXIS_MAP for every chip (no calibration)' };
}

head('magnet at each mark');
if (!windows.length) out('no marks (press Mark while recording, or pass --window A-B)');
for (const win of windows) {
  const end = win.end ?? Math.min(t1 + 1, ...boundaries.filter(b => b > win.t));
  const z = zeros.filter(e => e.t <= win.t).pop();
  out(`\n[${sec(win.t)}] "${win.note}"`);
  if (!z) { out('  no zeroing before this point, skipped'); continue; }
  const base = z.data.baseline.map(v => v === null ? NaN : v), thr = z.data.thresholds || POS.map(() => MIN_THRESH_UT);
  const { C, src } = matricesAt(win.t);
  const rows = between(win.t + 300, end);
  const clips = POS.map((_, i) => rows.filter(v => chipVec(v, i).some((x, k) => Math.abs(x) >= 0.97 * RAIL_UT[k])).length);
  clips.forEach((n, i) => { if (n) out(`  ch${i} clipped in ${n} of ${rows.length} samples (magnet too close for its range); those readings are left out`); });
  const frames = rows.map(v => POS.map((_, i) => {
    const raw = chipVec(v, i);
    if (raw.some(isNaN) || raw.some((x, k) => Math.abs(x) >= 0.97 * RAIL_UT[k])) return null;
    const d = M.sub(raw, chipVec(base, i));
    return d.some(isNaN) ? null : M.matVec(C[i], d);
  }));
  if (!frames.length) { out('  no samples'); continue; }
  // average the strongest half of the stretch, when the magnet was where the note says
  const strength = frames.map(f => f.reduce((t, d) => t + (d ? M.norm(d) : 0), 0));
  const top = Math.max(...strength), keep = frames.filter((_, k) => strength[k] >= 0.5 * top);
  const avg = POS.map((_, i) => { const ds = keep.map(f => f[i]).filter(Boolean); return ds.length ? M.mean3(ds) : null; });
  const mags = avg.map(d => d ? M.norm(d) : 0), strongest = mags.indexOf(Math.max(...mags));
  out(`  ${keep.length} of ${frames.length} samples averaged · chip axes: ${src}`);
  out(`  strongest: ch${strongest} (${mags[strongest].toFixed(0)} uT)`);
  const active = POS.map((_, i) => i).filter(i => avg[i] && mags[i] > (thr[i] || MIN_THRESH_UT));
  let fit = null;
  if (active.length >= 3) {
    const P = active.map(i => POS[i]), B = active.map(i => avg[i]), W = active.map(i => 1 / (mags[i] + (thr[i] || MIN_THRESH_UT)));
    fit = M.fitDipole(P, B, W, M.dipoleSeeds(P, B));
  }
  if (!fit) out(`  only ${active.length} chips above threshold, need 3 for a fit`);
  else {
    const near = POS.map((p, i) => Math.hypot(p[0] - fit.pos[0], p[2] - fit.pos[2])), ni = near.indexOf(Math.min(...near));
    const dir = M.normalize(fit.m), k = [0, 1, 2].reduce((b, i) => Math.abs(dir[i]) > Math.abs(dir[b]) ? i : b, 0);
    const north = [['right', 'left'], ['up', 'down'], ['toward card bottom', 'toward card top']][k][dir[k] > 0 ? 0 : 1];
    out(`  fit: magnet at ${fmtV(fit.pos)} cm, above ch${ni} (${near[ni].toFixed(1)} cm off), north end ${north}, model error ${(fit.rel * 100).toFixed(0)}%${fit.rel > 0.35 ? '  << poor fit' : ''}`);
    const said = /ch(\d)/i.exec(win.note);
    if (said && +said[1] !== ni && +said[1] !== strongest) out(`  !! note says ch${said[1]} but the magnet looks closest to ch${ni}: check wiring / SENSOR_POS`);
    POS.forEach((p, i) => {
      if (!avg[i]) { out(`  ch${i}  missing`); return; }
      const pred = M.dipoleField(M.sub(p, fit.pos), fit.m);
      const ang = M.angleDeg(avg[i], pred);
      out(`  ch${i}  ${mags[i].toFixed(0).padStart(6)} uT  measured ${fmtV(M.normalize(avg[i]))}  model ${fmtV(M.normalize(pred))}  ${active.includes(i) ? ang.toFixed(0).padStart(4) + '° off' : '   (below threshold)'}${active.includes(i) && ang > 30 ? '  << disagrees' : ''}`);
    });
  }
}

// --- csv ---
const csv = opt('csv');
if (csv) {
  const cols = [...Array(N).keys()].flatMap(i => ['x', 'y', 'z'].map(a => a + i));
  fs.writeFileSync(csv, ['t_s,' + cols.join(',')].concat(samples.map(s => (s.t / 1000).toFixed(3) + ',' + s.v.join(','))).join('\n') + '\n');
  out(`\nwrote ${samples.length} samples to ${csv}`);
}
