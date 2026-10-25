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
//   --recorded-axes  use the AXIS_MAP stored in the recording instead of the current one
const fs = require('fs');
const M = require('../magmath.js');

const RAIL_UT = [24608, 24608, 39648];
const DEFAULT_POS = [[-1.7, -3.4], [1.7, -3.4], [0, 0], [-1.7, 3.4], [1.7, 3.4]];
const DEFAULT_AXIS_MAP = [[0, -1, 0], [0, 0, 1], [-1, 0, 0]];   // keep in sync with AXIS_MAP in viewer.html
const ORIGINAL_AXIS_MAP = [[1, 0, 0], [0, 0, 1], [0, -1, 0]];  // used by recordings made before 2026-10-24 evening
const MIN_THRESH_UT = 50, NOISE_MULT = 5, ZERO_SAMPLES = 25, FIT_MIN_UT = 10;
const ZERO_NOISE_MAX_UT = 6;   // same as viewer.html

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : undefined; };
const range = s => { if (!s) return null; const [a, b] = s.split('-').map(Number); return [a * 1000, b * 1000]; };
const VALUED = ['--tumble', '--spin', '--window', '--axes', '--csv'];
const file = args.find((a, i) => !a.startsWith('--') && !VALUED.includes(args[i - 1]));
if (!file) { console.error('usage: node tools/analyze.js <recording.log> [--tumble A-B] [--spin A-B] [--window A-B] [--axes raw|cal] [--csv out.csv]'); process.exit(1); }

const entries = M.parseLog(fs.readFileSync(file, 'utf8'));
const events = entries.filter(e => e.kind === 'app');
const startEv = events.find(e => e.data.event === 'start');
const config = (startEv && startEv.data.config) || {};
const recordedMap = config.AXIS_MAP || ORIGINAL_AXIS_MAP;
const AXIS_MAP = args.includes('--recorded-axes') ? recordedMap : DEFAULT_AXIS_MAP;
const sameMap = JSON.stringify(recordedMap) === JSON.stringify(AXIS_MAP);
const remap = (C, from) => M.remapAxes(C, from || recordedMap, AXIS_MAP);   // calibrations in the log -> AXIS_MAP
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
if (!sameMap) out(`axes        recorded with an older AXIS_MAP ${JSON.stringify(recordedMap)}; analysed with the current one (--recorded-axes to use the recording's)`);
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
  else if (e.kind === 'app' && e.data.event === 'warning') out(`${sec(e.t).padStart(8)}  viewer warning: ${e.data.text}`);
  else if (e.kind === 'app' && !['start', 'zero_done'].includes(e.data.event)) out(`${sec(e.t).padStart(8)}  ${e.data.event}`);
  else if (e.kind === 'app' && e.data.event === 'zero_done') {
    const thr = e.data.thresholds || [];
    out(`${sec(e.t).padStart(8)}  zero_done  thresholds ${thr.map(x => (+x).toFixed(0)).join('/')} uT`);
    // noise while zeroing is normally ~2 uT; more means a magnet moved nearby (older recordings: from thresholds)
    const zn = e.data.noise || thr.map(x => x > MIN_THRESH_UT ? x / NOISE_MULT : null);
    const bad = zn.map((n, i) => n > ZERO_NOISE_MAX_UT ? i : -1).filter(i => i >= 0);
    if (bad.length) out(`          !! zeroing was disturbed on ${bad.map(i => 'ch' + i).join(', ')} (noise ${bad.map(i => zn[i].toFixed(0)).join(', ')} uT): a magnet moved nearby, so the background is off`);
  }
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
const noise = [];
for (let i = 0; i < N; i++) {
  const vs = samples.map(s => chipVec(s.v, i));
  const ok = vs.filter(v => !v.some(isNaN));
  let clipped = 0, jumps = 0, maxRaw = 0;
  ok.forEach(v => { if (v.some((x, k) => Math.abs(x) >= 0.97 * RAIL_UT[k])) clipped++; maxRaw = Math.max(maxRaw, ...v.map(Math.abs)); });
  for (let k = 1; k < vs.length; k++) if (vs[k].some((x, a) => Math.abs(x - vs[k - 1][a]) > 1.2 * RAIL_UT[a])) jumps++;
  const restV = rest.flatMap(w => w.map(r => chipVec(r, i))).filter(v => !v.some(isNaN));
  const mean = restV.length ? M.mean3(restV) : [NaN, NaN, NaN];
  const rms = noise[i] = Math.sqrt(restV.reduce((t, v) => t + M.dot(M.sub(v, mean), M.sub(v, mean)), 0) / (restV.length || 1));
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
    out(`${r.samples} of ${r.total} samples used (${r.dropped} disturbed), spread ${r.spreadUt.toFixed(1)} uT in the least-turned direction`);
    out(`reference group (taken as mounted like AXIS_MAP): ${r.group.map(i => 'ch' + i).join(', ')}`);
    out('chip  orientation                                  small tilt            applied   misfit   noise  ratio  |B| Earth  offset');
    r.sensors.forEach((s, i) => out(s.live
      ? `ch${i}  ${s.text.padEnd(44)} ${(s.tiltDeg.toFixed(1) + '° ± ' + s.uncDeg.toFixed(1) + '°').padEnd(20)}  ${(s.measured ? 'tilt' : 'square').padEnd(7)} ${s.misfitUt.toFixed(1).padStart(5)} uT ${s.noiseUt.toFixed(1).padStart(4)} uT ${s.ratio.toFixed(1).padStart(5)}  ${s.earthUt.toFixed(1).padStart(6)} uT  ${fmtV(s.offset)}`
      : `ch${i}  ${s.text}`));
    for (const w of r.warnings) out('!! ' + w);
    if (r.spin) out(`spin: field turned ${r.spin.turnedDeg.toFixed(0)}° (positive = not mirrored), vertical ${r.spin.verticalUt.toFixed(1)} uT, horizontal ${r.spin.horizontalUt.toFixed(1)} uT`);
    out('SENSOR_CAL for viewer.html:');
    out(JSON.stringify({ C: r.C.map(C => C.map(row => row.map(x => +x.toFixed(4)))), axisMap: AXIS_MAP, when: startEv ? startEv.data.wall : null }));
  }
}

// --- magnet at each mark ---
// A placement is the stretch around a mark where the strongest chip stays well above the background. Every
// sample in it gets its own magnet fit from all chips with a clear signal (FIT_MIN_UT or 5x their noise), so a
// small magnet that only lights up the chip under it still gets fitted.
const zeros = events.filter(e => e.data.event === 'zero_done' && e.data.baseline);
const applied = events.filter(e => e.data.event === 'calib_applied');
const marks = entries.filter(e => e.kind === 'mark');
const windows = marks.map((e, k) => ({ t: e.t, note: e.text, lo: Math.max(k ? marks[k - 1].t : -Infinity, e.t - 3000), hi: Math.min(k + 1 < marks.length ? marks[k + 1].t : Infinity, e.t + 3000) }));
const w = range(opt('window'));
if (w) windows.push({ t: w[0], end: w[1], note: `--window ${opt('window')}` });
const fitThr = noise.map(n => isNaN(n) ? FIT_MIN_UT : Math.max(FIT_MIN_UT, NOISE_MULT * n));
const clippedRaw = raw => raw.some((x, k) => Math.abs(x) >= 0.97 * RAIL_UT[k]);
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(p * (s.length - 1))] : NaN; };

const useRaw = opt('axes') === 'raw';
function matricesAt(t) {
  if (useRaw) return { C: POS.map(() => AXIS_MAP), src: 'AXIS_MAP for every chip (--axes raw)' };
  if (calC) return { C: calC, src: 'calibration computed above' };
  const a = applied.filter(e => e.t <= t).pop();
  if (a) return { C: remap(a.data.cal.C, a.data.cal.axisMap), src: `calibration applied at ${sec(a.t)}` };
  if (config.cal) return { C: remap(config.cal.C, config.cal.axisMap), src: 'calibration in use when recording started' };
  return { C: POS.map(() => AXIS_MAP), src: 'AXIS_MAP for every chip (no calibration)' };
}

head('magnet at each mark');
if (!windows.length) out('no marks (press Mark while recording, or pass --window A-B)');
const overall = POS.map(() => []);
for (const win of windows) {
  out(`\n[${sec(win.t)}] "${win.note}"`);
  const z = zeros.filter(e => e.t <= win.t).pop();
  if (!z) { out('  no zeroing before this point, skipped'); continue; }
  const base = z.data.baseline.map(v => v === null ? NaN : v);
  const { C, src } = matricesAt(win.t);
  const frame = s => ({ t: s.t, clip: POS.map((_, i) => clippedRaw(chipVec(s.v, i))), d: POS.map((_, i) => {
    const d = M.sub(chipVec(s.v, i), chipVec(base, i));
    return d.some(isNaN) || clippedRaw(chipVec(s.v, i)) ? null : M.matVec(C[i], d);
  }) });
  const strength = f => Math.max(0, ...f.d.map(d => d ? M.norm(d) : 0));
  let run;
  if (win.end) run = samples.filter(s => s.t >= win.t && s.t < win.end).map(frame);
  else {
    const near = samples.filter(s => s.t > z.t && s.t >= win.lo && s.t < win.hi).map(frame);
    const peak = Math.max(0, ...near.map(strength));
    if (peak < 4 * Math.max(...fitThr)) { out('  no magnet near this mark'); continue; }
    // start at the mark if the magnet was already there, else at the strongest moment; grow both ways
    let k = near.findIndex(f => f.t >= win.t);
    if (k < 0 || strength(near[k]) < 0.25 * peak) k = near.map(strength).indexOf(peak);
    let a = k, b = k;
    while (a > 0 && strength(near[a - 1]) >= 0.25 * peak) a--;
    while (b + 1 < near.length && strength(near[b + 1]) >= 0.25 * peak) b++;
    run = near.slice(a, b + 1);
  }
  POS.forEach((_, i) => { const n = run.filter(f => f.clip[i]).length; if (n) out(`  ch${i} clipped in ${n} of ${run.length} samples (magnet too close for its range); left out`); });
  const fits = [];
  let prev = null;
  for (const f of run) {
    const act = POS.map((_, i) => i).filter(i => f.d[i] && M.norm(f.d[i]) > fitThr[i]);
    if (act.length < 3) continue;
    const P = act.map(i => POS[i]), B = act.map(i => f.d[i]), W = act.map(i => 1 / (M.norm(f.d[i]) + fitThr[i]));
    const fit = M.fitDipole(P, B, W, M.dipoleSeeds(P, B).concat(prev ? [prev] : []));
    if (!fit) continue;
    prev = fit.pos;
    fits.push({ fit, ang: POS.map((p, i) => act.includes(i) ? M.angleDeg(f.d[i], M.dipoleField(M.sub(p, fit.pos), fit.m)) : null) });
  }
  out(`  placement ${sec(run[0].t)} - ${sec(run[run.length - 1].t)}, ${run.length} samples, ${fits.length} fitted · chip axes: ${src}`);
  if (!fits.length) { out('  fewer than 3 chips with a clear signal, no fit'); continue; }
  const pos = [0, 1, 2].map(j => pct(fits.map(x => x.fit.pos[j]), 0.5));
  const dir = M.normalize([0, 1, 2].map(j => pct(fits.map(x => M.normalize(x.fit.m)[j]), 0.5)));
  const k = [0, 1, 2].reduce((b, i) => Math.abs(dir[i]) > Math.abs(dir[b]) ? i : b, 0);
  const north = [['right', 'left'], ['up', 'down'], ['toward card bottom', 'toward card top']][k][dir[k] > 0 ? 0 : 1];
  const rel = pct(fits.map(x => x.fit.rel), 0.5);
  const dist = POS.map(p => Math.hypot(p[0] - pos[0], p[2] - pos[2])), ni = dist.indexOf(Math.min(...dist));
  out(`  magnet over ch${ni} (${dist[ni].toFixed(1)} cm off), ${pos[1].toFixed(1)} cm up, north end ${north}, model error ${(rel * 100).toFixed(0)}% (median)${rel > 0.35 ? '  << poor fit: chip axes or positions are probably wrong' : ''}`);
  const said = /ch(\d)/i.exec(win.note);
  if (said && +said[1] !== ni) out(`  !! note says ch${said[1]} but the magnet fits best over ch${ni}: check wiring / SENSOR_POS`);
  const pole = /\bN(?:orth)?\s*(up|down)\b/i.exec(win.note);
  if (pole && k === 1 && pole[1].toLowerCase() !== north) out(`  note says N ${pole[1]} but the fit says north is ${north} (the magnet's poles may be labelled the other way round)`);
  out('  chip    |dB| (median)   angle to model: median  90%');
  POS.forEach((_, i) => {
    const used = fits.map(x => x.ang[i]).filter(v => v !== null);
    const a = used.length >= Math.min(10, fits.length / 2) ? used : [];   // a few stray samples near the noise say little
    const mag = pct(run.map(f => f.d[i] ? M.norm(f.d[i]) : NaN).filter(x => !isNaN(x)), 0.5);
    a.forEach(v => overall[i].push(v));
    out(`  ch${i}  ${mag.toFixed(0).padStart(8)} uT        ` + (a.length ? `${pct(a, 0.5).toFixed(0).padStart(4)}°  ${pct(a, 0.9).toFixed(0).padStart(4)}°${pct(a, 0.5) > 20 ? '  << disagrees' : ''}` : '   (too weak to use)'));
  });
}
if (overall.some(a => a.length)) {
  out('\nall marks: angle between each chip\'s reading and the magnet model (median, 90th percentile)');
  overall.forEach((a, i) => out(`  ch${i}  ${a.length ? `${pct(a, 0.5).toFixed(1).padStart(5)}°  ${pct(a, 0.9).toFixed(1).padStart(5)}°  (${a.length} samples)` : 'no data'}${pct(a, 0.5) > 15 ? '  << this chip disagrees' : ''}`));
}

// --- csv ---
const csv = opt('csv');
if (csv) {
  const cols = [...Array(N).keys()].flatMap(i => ['x', 'y', 'z'].map(a => a + i));
  fs.writeFileSync(csv, ['t_s,' + cols.join(',')].concat(samples.map(s => (s.t / 1000).toFixed(3) + ',' + s.v.join(','))).join('\n') + '\n');
  out(`\nwrote ${samples.length} samples to ${csv}`);
}
