// MagTrack OR bench: the Setup tools in the game's menu.
// 1. Tracking check (validation): place the magnet (or a calibrated instrument's tip) on known points of a printed
//    1:1 grid (validation-grid.html) and record where the tracker puts it. Reports measured error, kept apart from
//    anything that is only an estimate. Every point is logged in recordings (or_validation_point) so it can be
//    re-fitted from the raw sensor data later: node tools/analyze.js <recording> --validate
// 2. Instrument: a physical, non-metallic instrument with the magnet mounted on it. Its magnet-to-tip offset is
//    typed in (ruler) or measured by pivot calibration (hold the tip still, rock the handle).
(function () {
'use strict';
const OR = window.MagTrackOR, MM = window.MotionMath;
if (!OR || !MM) return;
const GRID = [[-2, -3], [0, -3], [2, -3], [-2, 0], [0, 0], [2, 0], [-2, 3], [0, 3], [2, 3]];   // (x, z) cm, crosses 1-9 of the template
const CHIPS = typeof SENSOR_POS !== 'undefined' ? SENSOR_POS : [[-1.7, -3.4], [1.7, -3.4], [0, 0], [-1.7, 3.4], [1.7, 3.4]];
const VAL_KEY = 'magtrack.or.validation', SETUP_KEY = 'magtrack.or.validationSetup';
const HOLD_S = 1.5, STEADY_CM = 0.1, MOVE_ON_CM = 1;   // capture after 1.5 s within 1 mm; next point needs 1 cm of movement
// auto-record only on the right cross, upright: the known position assumes both (a first run recorded a magnet
// hovering over the wrong cross, and stacks tilted 30 degrees). Anything else needs Space, so it can't slip in.
const AUTO_RADIUS_CM = 2, AUTO_TILT_DEG = 12;
const PIVOT_S = 10;
const SAMPLE_DT = OR.SAMPLE_DT;
const esc = x => String(x).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const mm = cm => (cm * 10).toFixed(1);
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

const css = document.createElement('style');
css.textContent = `
  #or .bench label { display: block; margin: 8px 0 2px; font-weight: 800; }
  #or .bench input[type=number], #or .bench input[type=text], #or .bench select { font: 700 15px ui-rounded, system-ui; padding: 6px 10px;
        border: 3px solid var(--ink); border-radius: 10px; width: 9em; }
  #or .bench input[type=text] { width: 16em; }
  #or .bench .measured { border: 3px solid #1f9d55; border-radius: 14px; padding: 8px 12px; margin: 10px 0; background: #effaf3; }
  #or .bench .measured b.tag, #or .bench .estimate b.tag { font: 900 12px ui-rounded, system-ui; letter-spacing: .6px; padding: 2px 8px; border-radius: 999px; color: #fff; }
  #or .bench .measured b.tag { background: #1f9d55; } #or .bench .estimate b.tag { background: #9b95b8; }
  #or .bench .estimate { border: 3px dashed #c9c2e4; border-radius: 14px; padding: 8px 12px; margin: 10px 0; }
  #or .bench .estimate li { color: #5b5470; font-weight: 600; font-size: 14px; margin: 3px 0; }
  #or .bench .live { font: 800 16px ui-monospace, monospace; margin: 6px 0; }
  #or .bench .bar { height: 10px; border-radius: 999px; background: #e2ddef; overflow: hidden; margin: 4px 0 8px; }
  #or .bench .bar i { display: block; height: 100%; background: #5bd68a; }
  #or .bench .ok { color: #1f9d55; font-weight: 900; } #or .bench .warn { color: #d64545; font-weight: 900; }
  #or .bench svg { display: block; margin: 6px auto; }
`;
document.head.appendChild(css);

// --- menu ---
OR.menuExtras = () => {
  const ins = OR.instrument, v = load(VAL_KEY, null);
  return `<h3>Setup</h3><button data-go="validate">🎯 Tracking check</button><button data-go="instrument">🔧 Instrument</button>
    <p style="font-size:13px">Instrument: <b>${esc(ins.name)}</b>, tip ${mm(ins.offset)} mm from the magnet centre (${esc(ins.source)}).
    ${v ? `Last tracking check: <b>${mm(v.stats.rmsErr)} mm RMS</b> error over ${v.stats.n} measured points (${esc(v.when.slice(0, 10))}).` : 'Tracking accuracy: not measured yet.'}</p>`;
};
let bench = null;   // the running tool: { kind: 'validate' | 'pivot', ... }
OR.onGo = what => {
  if (what === 'validate') validateSetup();
  else if (what === 'val-start') validateStart();
  else if (what === 'val-capture') capture(true);
  else if (what === 'val-skip') nextPoint(true);
  else if (what === 'val-finish') validateFinish();
  else if (what === 'val-download') download();
  else if (what === 'instrument') instrumentCard();
  else if (what === 'ins-save') instrumentSave();
  else if (what === 'ins-bare') { OR.setInstrument(null); instrumentCard('Back to the bare magnet stack.'); }
  else if (what === 'pivot-start') pivotStart();
  else if (what === 'pivot-accept') pivotAccept();
};
addEventListener('keydown', e => {
  if (!bench || OR.mode !== 'setup' || bench.kind !== 'validate' || !bench.running) return;
  if (e.key === ' ') { e.preventDefault(); capture(true); }
  else if (e.key === 's' || e.key === 'S') nextPoint(true);
});

// top view of the board and template: chips, crosses, the current target and the live reading
function mapSvg(target, live, done) {
  const sx = x => (x + 3.5) * 26, sz = z => (z + 4.6) * 26;
  return `<svg width="182" height="239" viewBox="0 0 182 239" style="background:#f7f4ff;border-radius:12px">
    ${CHIPS.map(([x, z], i) => `<rect x="${sx(x) - 4}" y="${sz(z) - 4}" width="8" height="8" fill="#b07cff"/><text x="${sx(x)}" y="${sz(z) + (z < 0 ? -9 : 15)}" font-size="9" text-anchor="middle" fill="#9b95b8">ch${i}</text>`).join('')}
    ${GRID.map(([x, z], i) => `<g stroke="${i === target ? '#ff8a3d' : done.has(i) ? '#1f9d55' : '#c9c2e4'}" stroke-width="${i === target ? 3 : 2}">
      <line x1="${sx(x) - 7}" y1="${sz(z)}" x2="${sx(x) + 7}" y2="${sz(z)}"/><line x1="${sx(x)}" y1="${sz(z) - 7}" x2="${sx(x)}" y2="${sz(z) + 7}"/></g>
      <text x="${sx(x) + 10}" y="${sz(z) + 4}" font-size="11" font-weight="800" fill="#5b5470">${i + 1}</text>`).join('')}
    ${live ? `<circle cx="${sx(live[0])}" cy="${sz(live[2])}" r="5" fill="#2b2540"/>` : ''}
    <text x="91" y="234" font-size="9" text-anchor="middle" fill="#7a7394">card bottom (your side)</text></svg>`;
}

// --- tracking check ---
function validateSetup() {
  OR.setup(); bench = null;
  const s = load(SETUP_KEY, { paper: 0.15, spacer: 2.0, what: 'magnet' }), ins = OR.instrument;
  OR.card(`<div class="bench"><h1>🎯 Tracking check</h1>
    <p>Measures how far the tracker's position is from where the magnet really is, on known points. It needs the printed grid:
    <a href="validation-grid.html" target="_blank">validation-grid.html</a>. Print it at 100% (check its 5 cm bar with a ruler), lay it on the board
    with the chip marks over the chips, and tape it down. Keep phones, tools and metal away.</p>
    <label>What goes on each cross</label><select id="val-what"><option value="magnet"${s.what === 'magnet' ? ' selected' : ''}>The bare magnet stack, standing upright (measures its centre)</option>
      <option value="tip"${s.what === 'tip' ? ' selected' : ''}>The instrument's tip, held upright (${esc(ins.name)}, tip offset ${mm(ins.offset)} mm)</option></select>
    <label>Spacer height (cm): a flat non-metal block about 2 cm tall (a stack of sticky notes, a small box) under the magnet, so it sits where the game is played; measure it with a ruler</label><input id="val-spacer" type="number" step="0.05" min="0" value="${s.spacer}">
    <label>Paper above the chips' sensing plane (cm): chip top to sensor plus the paper, about 0.15</label><input id="val-paper" type="number" step="0.01" min="0" value="${s.paper}">
    <p>For each of the 9 crosses: put the spacer on the cross, stand the magnet (or the tip) on it, upright, and let go or hold it still.
    It records automatically after ${HOLD_S} s steady; <b>Space</b> records now, <b>S</b> skips a point. Lift it at least 1 cm between points.</p>
    <button data-go="val-start">Start (Enter)</button><button data-go="menu">Back</button></div>`);
}
function validateStart() {
  const num = id => { const v = parseFloat(document.getElementById(id).value); return isFinite(v) && v >= 0 ? v : null; };
  const spacer = num('val-spacer'), paper = num('val-paper'), what = document.getElementById('val-what').value;
  if (spacer === null || paper === null) return;
  store(SETUP_KEY, { spacer, paper, what });
  const offset = OR.instrument.offset;
  bench = { kind: 'validate', running: true, what, spacer, paper, offset, k: 0, points: [], buf: [], armed: true, lastCap: null, done: new Set(), started: new Date().toISOString() };
  OR.logEvent({ event: 'or_validation_start', what, spacer, paper, offset: what === 'tip' ? offset : null, grid: GRID });
  renderValidate();
}
// the known position of the thing on cross k
function known(k) {
  const [x, z] = GRID[k], b = bench;
  return [x, b.paper + b.spacer + (b.what === 'magnet' ? OR.STACK_LEN / 2 : 0), z];
}
const tiltOf = ax => M.angleDeg(ax, [0, -1, 0]);
const sideways = (p, kn) => Math.hypot(p[0] - kn[0], p[2] - kn[2]);
function onTarget(live) { return live && sideways(live.p, known(bench.k)) <= AUTO_RADIUS_CM && tiltOf(live.ax) <= AUTO_TILT_DEG; }
function hint(live, kn) {   // what's stopping auto-record, in words
  if (!live) return '';
  const side = sideways(live.p, kn), dy = live.p[1] - kn[1], tilt = tiltOf(live.ax);
  if (side > AUTO_RADIUS_CM) return `That's ${(side).toFixed(1)} cm from cross ${bench.k + 1}: move onto it.`;
  if (tilt > AUTO_TILT_DEG) return `Tilted ${tilt.toFixed(0)}°: stand it upright on the spacer (the known position assumes upright).`;
  if (Math.abs(dy) > 1) return `The reading is ${Math.abs(dy).toFixed(1)} cm ${dy < 0 ? 'lower' : 'higher'} than spacer + paper${bench.what === 'magnet' ? ' + half the stack' : ''}. Is it standing on the spacer, and is the spacer height right? (Recording anyway: it counts as error.)`;
  return '';
}
function renderValidate(live) {
  const b = bench, k = b.k, kn = known(k);
  const steady = steadyFor(), why = hint(live, kn);
  OR.card(`<div class="bench"><h1>🎯 Point ${k + 1} of ${GRID.length}</h1>
    <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">${mapSvg(k, live && live.p, b.done)}
    <div><p>Put the ${b.what === 'magnet' ? 'magnet stack' : 'instrument tip'} on <b>cross ${k + 1}</b> (x ${GRID[k][0]}, z ${GRID[k][1]} cm), on the ${b.spacer} cm spacer.</p>
    <div class="live">${live ? `reading (${live.p.map(v => v.toFixed(2)).join(', ')}) cm<br>sideways ${mm(sideways(live.p, kn))} mm · height ${live.p[1] >= kn[1] ? '+' : ''}${mm(live.p[1] - kn[1])} mm · tilt ${tiltOf(live.ax).toFixed(0)}°` : 'no magnet detected'}</div>
    ${why ? `<p class="warn">${esc(why)}</p>` : ''}
    ${b.armed ? `<div class="bar"><i style="width:${onTarget(live) ? Math.min(100, 100 * steady / HOLD_S) : 0}%"></i></div>` : '<p class="warn">Lift and move to the next cross</p>'}
    <p>${b.points.length} recorded, ${k - b.points.length} skipped</p></div></div>
    <button data-go="val-capture">Record now (Space)</button><button data-go="val-skip">Skip (S)</button>
    <button data-go="val-finish">Finish</button><button data-go="menu">Cancel</button></div>`);
}
function reading(raw) {   // the measured point: magnet centre, or the instrument tip from the unfiltered axis
  return bench.what === 'magnet' ? raw.pos : M.add(raw.pos, M.scale(raw.ax, bench.offset));
}
function steadyFor() {   // seconds the reading has stayed within STEADY_CM of its mean (ending now)
  const buf = bench.buf;
  let n = 0;
  for (let i = buf.length - 1; i >= 0 && buf[i]; i--) {
    const seg = buf.slice(i), m = M.mean3(seg.map(s => s.p));
    if (seg.some(s => M.norm(M.sub(s.p, m)) > STEADY_CM)) break;
    n = seg.length;
  }
  return n * SAMPLE_DT;
}
function capture(manual) {
  const b = bench;
  if (!b || !b.running) return;
  const hold = Math.round(HOLD_S / SAMPLE_DT);
  const seg = b.buf.slice(-hold).filter(Boolean);
  if (seg.length < (manual ? 5 : hold)) return;
  const p = M.mean3(seg.map(s => s.p));
  const sd = Math.sqrt(MM.mean(seg.map(s => M.dot(M.sub(s.p, p), M.sub(s.p, p)))));
  const tilt = MM.mean(seg.map(s => M.angleDeg(s.ax, [0, -1, 0])));
  const point = { k: b.k + 1, known: known(b.k), measured: p, sd, n: seg.length, secs: seg.length * SAMPLE_DT, rel: MM.mean(seg.map(s => s.rel)), tiltDeg: tilt, manual: !!manual };
  b.points.push(point); b.done.add(b.k); b.lastCap = p; b.armed = false;
  OR.logEvent({ event: 'or_validation_point', what: b.what, offset: b.what === 'tip' ? b.offset : null, ...point });
  OR.chime();
  nextPoint(false);
}
function nextPoint(skip) {
  const b = bench;
  if (!b || !b.running) return;
  if (skip) OR.logEvent({ event: 'or_validation_skip', k: b.k + 1 });
  b.k++; b.buf = [];
  if (b.k >= GRID.length) validateFinish(); else renderValidate();
}
function validateFinish() {
  const b = bench;
  if (!b) return;
  b.running = false;
  if (!b.points.length) { validateSetup(); return; }
  const stats = MM.validationStats(b.points);
  const heights = [...new Set(b.points.map(p => p.known[1].toFixed(2)))];
  const result = { when: new Date().toISOString(), what: b.what, spacer: b.spacer, paper: b.paper, offset: b.what === 'tip' ? b.offset : null,
    stats: { ...stats, errors: undefined }, points: b.points, skipped: GRID.length - b.points.length };
  store(VAL_KEY, result);
  OR.logEvent({ event: 'or_validation', ...result });
  b.result = result;
  const s = stats, relMean = MM.mean(b.points.map(p => p.rel));
  OR.card(`<div class="bench"><h1>🎯 Tracking check</h1>
    <div class="measured"><b class="tag">MEASURED</b> ${s.n} point${s.n > 1 ? 's' : ''} on the printed grid, ${b.what === 'magnet' ? 'magnet centre' : 'instrument tip'} at
      ${heights.join(', ')} cm above the sensors, ${esc(result.when.slice(0, 16).replace('T', ' '))}
      <table><tr><td>Error, mean / median</td><td>${mm(s.meanErr)} / ${mm(s.medianErr)} mm</td></tr>
      <tr><td>Error, RMS</td><td>${mm(s.rmsErr)} mm</td></tr><tr><td>Error, worst${s.n >= 5 ? ' / 95th percentile' : ''}</td><td>${mm(s.maxErr)}${s.n >= 5 ? ` / ${mm(s.p95Err)}` : ''} mm</td></tr>
      <tr><td>Horizontal / vertical RMS</td><td>${mm(s.horizRms)} / ${mm(s.vertRms)} mm</td></tr>
      <tr><td>Systematic offset (x, y, z)</td><td>${s.bias.map(mm).join(', ')} mm</td></tr>
      <tr><td>Precision (jitter while still)</td><td>${s.precision == null ? '—' : mm(s.precision) + ' mm'}</td></tr></table></div>
    <table><tr><td>cross</td><td>known (cm)</td><td>tilt</td><td>error</td></tr>${b.points.map(p => `<tr><td>${p.k}${p.manual ? ' (manual)' : ''}</td><td>${p.known.map(v => v.toFixed(1)).join(', ')}</td><td>${p.tiltDeg.toFixed(0)}°</td><td>${mm(MM.validationStats([p]).meanErr)} mm</td></tr>`).join('')}</table>
    <div class="estimate"><b class="tag">NOT MEASURED / ESTIMATES</b><ul>
      <li>Only these ${s.n} points at ${heights.join(', ')} cm were measured. Accuracy at other heights, positions or tilts is not covered by this check.</li>
      <li>Placing by hand on a printed cross is good to about ±1 mm, so errors below ~1 mm can't be told apart from placement.</li>
      <li>Points record automatically only within ${AUTO_RADIUS_CM} cm of the cross and ${AUTO_TILT_DEG}° of upright; a reading further off than that would never auto-record and had to be recorded by hand (marked manual).</li>
      <li>Model fit residual averaged ${(relMean * 100).toFixed(0)}%: how well the readings fit a magnet model. It is an estimate of fit quality, not an accuracy measurement.</li>
      ${b.what === 'tip' ? `<li>The tip offset (${mm(b.offset)} mm) came from ${esc(OR.instrument.source)}; tip error includes any error in it.</li>` : ''}</ul></div>
    <p>Logged in the recording (if one is running) as or_validation_point events; re-fit from the raw data with <code>node tools/analyze.js &lt;recording&gt; --validate</code>.</p>
    <button data-go="val-download">Download results (JSON)</button><button data-go="validate">Run again</button><button data-go="menu">Menu</button></div>`);
}
function download() {
  const r = bench && bench.result || load(VAL_KEY, null);
  if (!r) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' }));
  a.download = `magtrack-validation-${r.when.slice(0, 19).replace(/[:T]/g, '-')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// --- instrument ---
function instrumentCard(note) {
  OR.setup(); bench = null;
  const ins = OR.instrument;
  OR.card(`<div class="bench"><h1>🔧 Instrument</h1>
    ${note ? `<p class="ok">${esc(note)}</p>` : ''}
    <p>Now: <b>${esc(ins.name)}</b>, tip <b>${mm(ins.offset)} mm</b> from the magnet's centre along the instrument (${esc(ins.source)}).</p>
    <p>Mount the magnet stack on a <b>plastic, wooden or 3D-printed</b> instrument, in line with it and close to the tip. Steel (even "non-magnetic"
    stainless) bends the field and spoils tracking. The magnet should stay within about 5 cm of the board while you work.</p>
    <label>Name</label><input id="ins-name" type="text" maxlength="40" value="${esc(ins.source === 'default' ? 'My instrument' : ins.name)}">
    <label>Tip offset (mm): from the middle of the magnet stack to the tip, measured with a ruler</label><input id="ins-offset" type="number" step="0.5" min="1" max="140" value="${mm(ins.offset)}">
    <div><button data-go="ins-save">Save offset</button><button data-go="ins-bare">Use the bare stack</button></div>
    <h3>Or measure it: pivot calibration</h3>
    <p>Put the tip in a small dimple or on a cross (on a spacer, so the magnet is in range) and keep the <b>tip still</b> while you rock the handle
    in a slow circle, 20–30° each way, for ${PIVOT_S} s. The point that stays still is the tip.</p>
    <button data-go="pivot-start">Start pivot calibration</button><button data-go="menu">Back</button></div>`);
}
function instrumentSave() {
  const name = (document.getElementById('ins-name').value || 'My instrument').trim().slice(0, 40);
  const off = parseFloat(document.getElementById('ins-offset').value) / 10;
  if (!(off >= 0.1 && off < 15)) { instrumentCard('The offset must be between 1 and 140 mm.'); return; }
  OR.setInstrument({ name, offset: off, source: 'measured with a ruler' });
  instrumentCard(`Saved: tip ${mm(off)} mm from the magnet.${off > 3.5 ? ' That is a long offset: keep the instrument low, the magnet has to stay within ~5 cm of the board.' : ''}`);
}
function pivotStart() {
  const name = (document.getElementById('ins-name') && document.getElementById('ins-name').value || 'My instrument').trim().slice(0, 40);
  bench = { kind: 'pivot', name, samples: [], t0: null, result: null };
  OR.logEvent({ event: 'or_pivot_start' });
  renderPivot();
}
function renderPivot() {
  const b = bench, secs = b.samples.length * SAMPLE_DT;
  const spread = b.samples.length > 5 ? MM.pivotCalibrate(b.samples, M.solve) : null;
  OR.card(`<div class="bench"><h1>🔧 Pivot calibration</h1>
    <p>Tip still, rock the handle in a slow circle.</p>
    <div class="bar"><i style="width:${Math.min(100, 100 * secs / PIVOT_S)}%"></i></div>
    <div class="live">${b.samples.length} samples · rocked ±${spread ? spread.spreadDeg.toFixed(0) : 0}°</div>
    <button data-go="instrument">Cancel</button></div>`);
}
function pivotDone() {
  const b = bench, r = MM.pivotCalibrate(b.samples, M.solve);
  b.result = r;
  OR.logEvent({ event: 'or_pivot', result: r, n: b.samples.length });
  if (!r || r.offset <= 0) {
    OR.card(`<div class="bench"><h1>🔧 Pivot calibration</h1><p class="warn">Couldn't work out the tip from that. Keep the tip planted and rock the handle further.</p>
      <button data-go="pivot-start">Try again</button><button data-go="instrument">Back</button></div>`);
    return;
  }
  const good = r.rms <= 0.2 && r.spreadDeg >= 15;
  OR.card(`<div class="bench"><h1>🔧 Pivot calibration</h1>
    <div class="${good ? 'measured' : 'estimate'}"><b class="tag">${good ? 'MEASURED' : 'UNRELIABLE'}</b>
    <table><tr><td>Tip offset</td><td><b>${mm(r.offset)} mm</b></td></tr>
    <tr><td>Fit residual (how still the computed tip stayed)</td><td>${mm(r.rms)} mm</td></tr>
    <tr><td>Rocked</td><td>±${r.spreadDeg.toFixed(0)}° over ${r.n} samples</td></tr></table></div>
    ${good ? '' : `<p class="warn">${r.spreadDeg < 15 ? 'Rock the handle further (at least 15° each way).' : 'The tip moved or tracking was noisy: plant the tip and go slower.'}</p>`}
    <button data-go="pivot-accept">Use ${mm(r.offset)} mm</button><button data-go="pivot-start">Try again</button><button data-go="instrument">Back</button></div>`);
}
function pivotAccept() {
  const b = bench;
  if (!b || !b.result) return;
  const r = b.result;
  OR.setInstrument({ name: b.name || 'My instrument', offset: r.offset, source: `pivot calibration, ${mm(r.rms)} mm residual, ±${r.spreadDeg.toFixed(0)}°`, pivot: { rms: r.rms, spreadDeg: r.spreadDeg, n: r.n, when: new Date().toISOString() } });
  instrumentCard(`Saved: tip ${mm(r.offset)} mm from the magnet (pivot calibration).${r.offset > 3.5 ? ' That is a long offset: keep the instrument low, the magnet has to stay within ~5 cm of the board.' : ''}`);
}

// --- per sample (the game ignores samples in setup mode; these tools use them) ---
addEventListener('magnet', () => {
  if (!bench || OR.mode !== 'setup') return;
  const raw = OR.raw;
  if (bench.kind === 'validate' && bench.running) {
    const live = raw && { p: reading(raw), ax: raw.ax, rel: raw.rel };
    bench.buf.push(live || null);
    if (bench.buf.length > 200) bench.buf.shift();
    if (!bench.armed && (!live || M.norm(M.sub(live.p, bench.lastCap)) > MOVE_ON_CM)) { bench.armed = true; bench.buf = []; }
    if (bench.armed && onTarget(live) && steadyFor() >= HOLD_S) capture(false);
    else if (OR.sample % 3 === 0) renderValidate(live);
  } else if (bench.kind === 'pivot' && !bench.result) {
    if (raw) bench.samples.push({ p: raw.pos, d: raw.ax });
    if (bench.samples.length * SAMPLE_DT >= PIVOT_S) pivotDone();
    else if (OR.sample % 4 === 0) renderPivot();
  }
});
})();
