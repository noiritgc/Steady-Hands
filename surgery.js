// MagTrack OR: a surgery game played with the magnet stack as the instrument. The player stands at the bottom edge
// of the card (ch3/ch4 nearest) and holds the stack like a scalpel over the board; its position and tilt drive the
// instrument on screen. Lowering the tip below the virtual tissue surface cuts/touches; lifting it moves freely.
// Three procedures (incision, tumour removal, biopsy), a patient whose vitals react to mistakes, a report card and
// a leaderboard. Listens for the viewer's 'magnet' events; draws its own full-screen scene.
(function () {
'use strict';
// --- tuning (cm, board axes: x right, y up from the chips, z toward the bottom of the card) ---
const STACK_LEN = 2;          // magnet stack length; the tip is half of it from the fitted middle, along its axis
const SURFACE = 2.6;          // tissue surface height (tip height)
const CUT_TOP = 0.2, CUT_BOTTOM = 0.7;   // cutting band: this far below the surface
const SAMPLE_DT = 1 / 18.7;   // the board sends ~18.7 samples per second
const TIP_SMOOTH = 0.45;      // display smoothing of the tip (scoring uses raw positions)
const LEADER_KEY = 'magtrack.or.leaderboard';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp01 = v => Math.max(0, Math.min(1, v));
const logEvent = d => { if (typeof log === 'function') log('app', d); };

// --- page ---
const css = document.createElement('style');
css.textContent = `
  #or { position: fixed; inset: 0; z-index: 20; display: none; background: #0b0d10; color: #e6e8ec; font-family: system-ui, sans-serif; }
  #or canvas.view { position: absolute; inset: 0; }
  #or .top { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); text-align: center; pointer-events: none; }
  #or .top h2 { margin: 0; font-size: 26px; letter-spacing: .5px; }
  #or .top .obj { color: #b9c0cc; font-size: 16px; margin-top: 4px; }
  #or .timer { font: 700 22px ui-monospace, monospace; margin-top: 4px; }
  #or .monitor { position: absolute; top: 12px; right: 12px; width: 280px; background: #000; border: 2px solid #2b3038; border-radius: 10px; padding: 10px 12px; }
  #or .monitor canvas { width: 100%; height: 70px; display: block; }
  #or .vit { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 10px; margin-top: 6px; font: 700 26px ui-monospace, monospace; }
  #or .vit span { display: block; font: 600 11px system-ui; color: #8a909c; letter-spacing: .5px; }
  #or .hr { color: #45e07a; } #or .bp { color: #ff6b6b; } #or .spo2 { color: #4dc9ff; } #or .loss { color: #ffb547; }
  #or .monitor.alarm { border-color: #ff3b3b; animation: orblink .5s steps(1) infinite; }
  @keyframes orblink { 50% { border-color: #2b3038; } }
  #or .gauge { position: absolute; left: 16px; top: 50%; transform: translateY(-50%); width: 110px; background: #000c; padding: 10px 14px; border-radius: 10px; }
  #or .bar { position: relative; height: 260px; width: 34px; background: #1a1d24; border: 1px solid #333844; border-radius: 6px; margin: 6px 0 10px; }
  #or .band { position: absolute; left: 0; right: 0; background: #2f7d4f; }
  #or .deep { position: absolute; left: 0; right: 0; bottom: 0; background: #6b2222; }
  #or .surf { position: absolute; left: -6px; right: -6px; height: 2px; background: #e6e8ec; }
  #or .tipmark { position: absolute; left: -10px; width: 54px; height: 4px; margin-top: -2px; background: #ffd34d; border-radius: 2px; }
  #or .gauge .lbl { color: #8a909c; font-size: 12px; }
  #or .gauge b { font: 700 18px ui-monospace, monospace; display: block; }
  #or .msg { position: absolute; top: 34%; left: 50%; transform: translate(-50%, -50%); font: 800 40px system-ui; text-shadow: 0 2px 12px #000;
             pointer-events: none; text-align: center; white-space: nowrap; }
  #or .msg.bad { color: #ff5a5a; } #or .msg.good { color: #5fd38d; } #or .msg.info { color: #ffd34d; }
  #or .card { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: min(620px, 92vw); max-height: 86vh; overflow: auto;
              background: #151820ee; border: 1px solid #333844; border-radius: 14px; padding: 22px 26px; }
  #or .card h1 { margin: 0 0 6px; font-size: 34px; } #or .card h3 { margin: 14px 0 6px; }
  #or .card p { color: #b9c0cc; line-height: 1.45; margin: 6px 0; }
  #or .card table { width: 100%; border-collapse: collapse; font-size: 15px; } #or .card td { padding: 4px 6px; border-bottom: 1px solid #262a33; }
  #or .card td:last-child { text-align: right; font-family: ui-monospace, monospace; }
  #or .grade { font: 800 64px system-ui; float: right; margin-left: 12px; }
  #or .card button { margin: 10px 8px 0 0; font-size: 16px; padding: 10px 16px; }
  #or .card input { font-size: 16px; padding: 9px 10px; width: 200px; }
  #or .nohand { position: absolute; bottom: 18px; left: 50%; transform: translateX(-50%); color: #ffb547; font-size: 18px; pointer-events: none; }
  #or .exit { position: absolute; bottom: 14px; right: 14px; }
`;
document.head.appendChild(css);
const root = document.createElement('div');
root.id = 'or';
root.innerHTML = `
  <div class="top"><h2 id="or-title"></h2><div class="obj" id="or-obj"></div><div class="timer" id="or-timer"></div></div>
  <div class="monitor" id="or-mon"><canvas id="or-ecg" width="512" height="140"></canvas>
    <div class="vit"><div class="hr"><span>HR</span><i id="or-hr">72</i></div><div class="bp"><span>BP</span><i id="or-bp">120/80</i></div>
    <div class="spo2"><span>SpO₂</span><i id="or-spo2">98</i></div><div class="loss"><span>BLOOD LOSS mL</span><i id="or-loss">0</i></div></div></div>
  <div class="gauge"><div class="lbl">tip depth</div>
    <div class="bar" id="or-bar"><div class="deep" id="or-deep"></div><div class="band" id="or-band"></div><div class="surf" id="or-surf"></div><div class="tipmark" id="or-tip"></div></div>
    <div class="lbl">below surface</div><b id="or-depth">—</b><div class="lbl">tremor</div><b id="or-tremor">—</b><div class="lbl">tilt</div><b id="or-tilt">—</b></div>
  <div class="msg" id="or-msg"></div>
  <div class="nohand" id="or-nohand"></div>
  <div class="card" id="or-card"></div>
  <button class="exit" id="or-exit">Exit (Esc)</button>`;
document.body.appendChild(root);
const $ = id => document.getElementById(id);

// --- 3D scene: surgeon's view from the bottom edge of the card ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.domElement.className = 'view';
root.insertBefore(renderer.domElement, root.firstChild);
const scene3 = new THREE.Scene();
scene3.background = new THREE.Color(0x0b0d10);
const cam = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
cam.position.set(0, 13.5, 10.5);
cam.lookAt(0, 1.2, -0.6);
scene3.add(new THREE.HemisphereLight(0xffffff, 0x334455, 0.6));
const lamp = new THREE.DirectionalLight(0xffffff, 0.6); lamp.position.set(2, 12, 6); scene3.add(lamp);

function tissueTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(256, 256, 40, 256, 256, 360);
  grad.addColorStop(0, '#e3a39b'); grad.addColorStop(1, '#c97d76');
  g.fillStyle = grad; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(${150 + Math.random() * 60},${70 + Math.random() * 40},${70 + Math.random() * 30},0.15)`; g.fillRect(Math.random() * 512, Math.random() * 512, 3, 3); }
  return new THREE.CanvasTexture(c);
}
// surgical drape around the field, below the deep tissue so it only shows around the edges
const drape = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({ color: 0x1f4d3e }));
drape.rotation.x = -Math.PI / 2; drape.position.y = 0.45; scene3.add(drape);
// tissue is see-through so the structures underneath stay visible (an "x-ray" view)
const tissue = new THREE.Mesh(new THREE.PlaneGeometry(7, 11), new THREE.MeshStandardMaterial({ map: tissueTexture(), transparent: true, opacity: 0.7, depthWrite: false }));
tissue.rotation.x = -Math.PI / 2; tissue.position.y = SURFACE; scene3.add(tissue);
const below = new THREE.Mesh(new THREE.PlaneGeometry(7, 11), new THREE.MeshStandardMaterial({ color: 0x6e2a2a }));   // deep tissue floor
below.rotation.x = -Math.PI / 2; below.position.y = 0.6; scene3.add(below);

// instrument: tip at the group's origin, pointing along -y in its own frame
const tool = new THREE.Group();
const steel = new THREE.MeshStandardMaterial({ color: 0xc9d1dc, metalness: 0.8, roughness: 0.25 });
const blade = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.9, 16), steel); blade.rotation.x = Math.PI; blade.position.y = 0.45;
const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.6, 12), steel); shaft.position.y = 0.9 + 1.8;
const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.2, 3.5, 16), new THREE.MeshStandardMaterial({ color: 0x3a6fd8 })); grip.position.y = 4.5 + 1.75;
tool.add(blade, shaft, grip);
scene3.add(tool);
const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.22, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45 }));
shadow.rotation.x = -Math.PI / 2; scene3.add(shadow);
const plumb = new THREE.Line(new THREE.BufferGeometry().setFromPoints([V3(0, 0, 0), V3(0, 1, 0)]), new THREE.LineBasicMaterial({ color: 0xffd34d }));
scene3.add(plumb);
const procGroup = new THREE.Group(); scene3.add(procGroup);

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix();
}
addEventListener('resize', resize);
let open = false;
(function loop() { if (open) { drawEcg(); renderer.render(scene3, cam); } requestAnimationFrame(loop); })();

// --- sound ---
let actx = null;
function tone(f, ms, type = 'sine', vol = 0.12) {
  if (!actx) return;
  const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
  o.type = type; o.frequency.value = f;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + ms / 1000);
  o.connect(g).connect(actx.destination); o.start(t); o.stop(t + ms / 1000);
}
const alarm = () => { tone(980, 160, 'square', 0.1); setTimeout(() => tone(760, 200, 'square', 0.1), 170); };
const chime = () => { tone(880, 140); setTimeout(() => tone(1320, 260), 150); };

// --- patient ---
let pt;
function resetPatient() { pt = { loss: 0, bleed: 0, stress: 0, lost: false, beatPhase: 0, trace: new Float32Array(512), head: 0 }; }
resetPatient();
function vitals() {
  const hr = 72 + pt.loss * 0.045 + pt.stress, sys = 120 - pt.loss * 0.05, dia = 80 - pt.loss * 0.032;
  const spo2 = 98 - Math.max(0, (pt.loss - 700) * 0.012);
  return { hr: pt.lost ? 0 : hr, sys: pt.lost ? 0 : sys, dia: pt.lost ? 0 : dia, spo2: pt.lost ? 0 : spo2 };
}
function patientTick() {
  pt.loss += pt.bleed * SAMPLE_DT;
  pt.bleed *= Math.pow(0.6, SAMPLE_DT);   // bleeding eases off (~60% left after a second) unless something keeps it going
  pt.stress *= Math.pow(0.5, SAMPLE_DT);
  if (!pt.lost && (pt.loss > 1500 || vitals().sys < 55)) { pt.lost = true; logEvent({ event: 'or_patient_lost', loss: pt.loss }); }
  const v = vitals();
  $('or-hr').textContent = v.hr.toFixed(0);
  $('or-bp').textContent = `${v.sys.toFixed(0)}/${v.dia.toFixed(0)}`;
  $('or-spo2').textContent = v.spo2.toFixed(0);
  $('or-loss').textContent = pt.loss.toFixed(0);
  $('or-mon').classList.toggle('alarm', pt.bleed > 20 || v.sys < 90 || pt.lost);
}
// ECG trace, drawn every frame; one beep per heartbeat
let lastFrame = performance.now(), flatTone = 0;
function ecgShape(p) {   // p = 0..1 through a beat
  const g = (c, w, a) => a * Math.exp(-((p - c) ** 2) / (2 * w * w));
  return g(0.18, 0.025, 0.12) - g(0.29, 0.008, 0.15) + g(0.31, 0.01, 1) - g(0.34, 0.01, 0.25) + g(0.55, 0.045, 0.3);
}
function drawEcg() {
  const now = performance.now(), dt = Math.min(0.1, (now - lastFrame) / 1000); lastFrame = now;
  const v = vitals(), cv = $('or-ecg'), g = cv.getContext('2d');
  const steps = Math.max(1, Math.round(dt * 160));
  for (let s = 0; s < steps; s++) {
    const before = pt.beatPhase;
    if (!pt.lost) pt.beatPhase = (pt.beatPhase + (v.hr / 60) * dt / steps) % 1;
    if (!pt.lost && before < 0.31 && pt.beatPhase >= 0.31) tone(v.spo2 > 92 ? 960 : 700, 45, 'sine', 0.06);
    pt.trace[pt.head] = pt.lost ? 0 : ecgShape(pt.beatPhase);
    pt.head = (pt.head + 1) % pt.trace.length;
  }
  if (pt.lost && open && now > flatTone) { tone(880, 900, 'sine', 0.05); flatTone = now + 900; }
  g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height);
  g.strokeStyle = pt.lost ? '#ff3b3b' : '#45e07a'; g.lineWidth = 3; g.beginPath();
  for (let i = 0; i < pt.trace.length; i++) {
    const y = cv.height * 0.7 - pt.trace[(pt.head + i) % pt.trace.length] * cv.height * 0.55;
    i ? g.lineTo(i, y) : g.moveTo(i, y);
  }
  g.stroke();
}

// --- instrument tracking ---
let tip = null, dir = null, raw = [], present = false;   // dir = unit vector from handle to tip
function onFit(fit) {
  if (!fit) { present = false; return; }
  let ax = M.normalize(fit.m);
  if (ax[1] > 0) ax = M.scale(ax, -1);           // the end pointing down at the board is the tip
  const t = M.add(fit.pos, M.scale(ax, STACK_LEN / 2));
  // tremor uses the stack's middle: the tip moves the same with the hand, but small axis noise is amplified 1 cm out
  raw.push(fit.pos); if (raw.length > 19) raw.shift();   // last ~1 s
  tip = tip && present ? tip.map((v, k) => v + TIP_SMOOTH * (t[k] - v)) : t;
  dir = dir && present ? M.normalize(dir.map((v, k) => v + TIP_SMOOTH * (ax[k] - v))) : ax;
  present = true;
}
const tremorMm = () => {   // rms wobble of the raw tip about its 1 s average
  if (raw.length < 8) return NaN;
  const m = M.mean3(raw);
  return 10 * Math.sqrt(raw.reduce((s, p) => s + M.dot(M.sub(p, m), M.sub(p, m)), 0) / raw.length);
};
const tiltDeg = () => Math.acos(Math.min(1, -dir[1])) * 180 / Math.PI;
function drawTool() {
  tool.visible = shadow.visible = plumb.visible = present && !!tip;
  $('or-nohand').textContent = present ? '' : 'Instrument not detected: hold the magnet stack over the board, 1–5 cm up';
  if (!tool.visible) return;
  tool.position.set(...tip);
  tool.quaternion.setFromUnitVectors(V3(0, -1, 0), V3(...dir));
  shadow.position.set(tip[0], SURFACE + 0.01, tip[2]);
  plumb.geometry.setFromPoints([V3(tip[0], SURFACE, tip[2]), V3(...tip)]);
  plumb.visible = tip[1] < SURFACE;
  // depth gauge: 0.5..5 cm of tip height
  const toPct = y => clamp01((y - 0.5) / 4.5) * 100;
  const band = cur && cur.band;
  $('or-surf').style.bottom = toPct(SURFACE) + '%';
  $('or-band').style.display = $('or-deep').style.display = band ? 'block' : 'none';
  if (band) {
    $('or-band').style.bottom = toPct(band[0]) + '%'; $('or-band').style.height = (toPct(band[1]) - toPct(band[0])) + '%';
    $('or-deep').style.height = toPct(band[0]) + '%';
  }
  $('or-tip').style.top = (100 - toPct(tip[1])) + '%';
  const below = SURFACE - tip[1];
  $('or-depth').textContent = below > 0 ? (below * 10).toFixed(0) + ' mm' : 'above';
  const tr = tremorMm();
  $('or-tremor').textContent = isNaN(tr) ? '—' : tr.toFixed(1) + ' mm';
  $('or-tilt').textContent = tiltDeg().toFixed(0) + '°';
}

// --- messages ---
let msgUntil = 0;
function say(text, cls = 'info', samples = 25) { $('or-msg').textContent = text; $('or-msg').className = 'msg ' + cls; msgUntil = sample + samples; }

// --- procedures ---
// Each has: title, objective, limit (s), band (good tip heights, or null), setup(), tick() -> 'done' | 'fail' | null, score() -> {rows, points}
const tube = (pts, r, color) => new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => V3(...p))), 80, r, 12, false),
  new THREE.MeshStandardMaterial({ color, roughness: 0.5 }));
function curvePts(pts, n = 160) { return new THREE.CatmullRomCurve3(pts.map(p => V3(...p))).getPoints(n).map(v => [v.x, v.y, v.z]); }
function distToPolyline(p, pts, xzOnly) {   // -> { d, s } (s = 0..1 along the line)
  let best = { d: Infinity, s: 0 }, total = 0;
  const seg = []; for (let i = 1; i < pts.length; i++) { const L = M.norm(M.sub(pts[i], pts[i - 1])); seg.push(L); total += L; }
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    let a = pts[i - 1], b = pts[i], q = p;
    if (xzOnly) { a = [a[0], 0, a[2]]; b = [b[0], 0, b[2]]; q = [p[0], 0, p[2]]; }
    const ab = M.sub(b, a), t = clamp01(M.dot(M.sub(q, a), ab) / (M.dot(ab, ab) || 1));
    const d = M.norm(M.sub(q, M.add(a, M.scale(ab, t))));
    if (d < best.d) best = { d, s: (acc + t * seg[i - 1]) / total };
    acc += seg[i - 1];
  }
  return best;
}
function lineOn(pts, color, dashed) {
  const geo = new THREE.BufferGeometry().setFromPoints(pts.map(p => V3(p[0], SURFACE + 0.015, p[2])));
  const l = new THREE.Line(geo, dashed ? new THREE.LineDashedMaterial({ color, dashSize: 0.18, gapSize: 0.14 }) : new THREE.LineBasicMaterial({ color }));
  if (dashed) l.computeLineDistances();
  return l;
}
function bloodPool(p, r) {
  const m = new THREE.Mesh(new THREE.CircleGeometry(1, 24), new THREE.MeshBasicMaterial({ color: 0x8a0000, transparent: true, opacity: 0.75 }));
  m.rotation.x = -Math.PI / 2; m.position.set(p[0], SURFACE + 0.02, p[2]); m.scale.setScalar(r);
  procGroup.add(m); return m;
}

const PROCS = [
  { id: 'incision', title: 'Procedure 1 · Incision', limit: 90,
    objective: 'Cut along the dotted line, start at the green dot. Keep the tip in the green depth band.',
    band: [SURFACE - CUT_BOTTOM, SURFACE - CUT_TOP],
    setup() {
      this.path = curvePts([[-0.3, SURFACE, 3.3], [0.9, SURFACE, 1.6], [-0.6, SURFACE, -0.2], [0.8, SURFACE, -1.9], [-0.2, SURFACE, -3.4]], 120);
      procGroup.add(lineOn(this.path, 0xffffff, true));
      const start = new THREE.Mesh(new THREE.CircleGeometry(0.25, 24), new THREE.MeshBasicMaterial({ color: 0x3fcf6e }));
      start.rotation.x = -Math.PI / 2; start.position.set(this.path[0][0], SURFACE + 0.02, this.path[0][2]); procGroup.add(start);
      this.cutPts = []; this.cutLine = null; this.progress = 0; this.devs = []; this.depths = []; this.deepCount = 0; this.offCount = 0; this.pool = null;
    },
    tick() {
      const cutting = tip[1] < SURFACE - CUT_TOP;
      if (!cutting) return null;
      const { d, s } = distToPolyline(tip, this.path, true);
      const tooDeep = tip[1] < SURFACE - CUT_BOTTOM;
      if (tooDeep) {
        pt.bleed = Math.max(pt.bleed, 30);
        if (this.deepCount++ % 25 === 0) { say('TOO DEEP: bleeding!', 'bad'); alarm(); }
        if (!this.pool) this.pool = bloodPool(tip, 0.2);
        this.pool.scale.setScalar(Math.min(1.4, this.pool.scale.x + 0.01));
      }
      if (d > 0.5) {   // cutting off the line
        pt.bleed = Math.max(pt.bleed, 8);
        if (this.offCount++ % 30 === 0) say('Off the line', 'bad');
        return null;
      }
      if (this.progress === 0 && s > 0.06) { say('Start at the green dot', 'info'); return null; }
      if (s >= this.progress - 0.02 && s <= this.progress + 0.08) {
        this.progress = Math.max(this.progress, s);
        this.devs.push(d); this.depths.push(tip[1]);
        this.cutPts.push([tip[0], SURFACE, tip[2]]);
        if (this.cutLine) procGroup.remove(this.cutLine);
        if (this.cutPts.length > 1) { this.cutLine = lineOn(this.cutPts, 0x8a0000); procGroup.add(this.cutLine); }
      }
      $('or-obj').textContent = `Incision ${(this.progress * 100).toFixed(0)}% · off the line by ${(d * 10).toFixed(1)} mm`;
      return this.progress > 0.97 ? 'done' : null;
    },
    score(t) {
      const dev = this.devs.length ? 10 * this.devs.reduce((a, b) => a + b, 0) / this.devs.length : 10;
      const m = this.depths.length ? this.depths.reduce((a, b) => a + b, 0) / this.depths.length : 0;
      const sd = this.depths.length ? 10 * Math.sqrt(this.depths.reduce((a, b) => a + (b - m) ** 2, 0) / this.depths.length) : 10;
      const rows = [
        ['Line accuracy (mean)', `${dev.toFixed(1)} mm`, 400 * clamp01(1 - dev / 4)],
        ['Depth steadiness', `±${sd.toFixed(1)} mm`, 250 * clamp01(1 - sd / 3)],
        ['Time', `${t.toFixed(1)} s`, 200 * clamp01(1 - (t - 15) / 60)],
        ['Completed', `${(this.progress * 100).toFixed(0)}%`, 150 * clamp01(this.progress)],
        ['Cut too deep', `${(this.deepCount * SAMPLE_DT).toFixed(1)} s`, -Math.min(300, this.deepCount * SAMPLE_DT * 60)],
      ];
      return { rows, stats: { dev, sd, t, progress: this.progress } };
    } },

  { id: 'tumour', title: 'Procedure 2 · Tumour removal', limit: 90,
    objective: 'Reach the purple tumour and hold the tip in it to excise it. Don\'t touch the artery (red) or nerve (yellow). Then withdraw.',
    band: null,
    setup() {
      this.T = [0.25, 1.55, -0.9]; this.R = 0.45;
      this.tumour = new THREE.Mesh(new THREE.IcosahedronGeometry(this.R, 2), new THREE.MeshStandardMaterial({ color: 0x8e44ad, roughness: 0.8, flatShading: true }));
      this.tumour.position.set(...this.T); procGroup.add(this.tumour);
      this.artery = curvePts([[-2.6, 1.7, 3.2], [-1.0, 1.6, 0.8], [-0.62, 1.55, -0.9], [-0.95, 1.65, -2.8], [-2.2, 1.8, -4.5]]);
      this.nerve = curvePts([[2.6, 1.9, 2.8], [1.35, 1.7, 0.6], [1.1, 1.6, -0.9], [1.45, 1.7, -2.8], [2.4, 1.8, -4.4]]);
      procGroup.add(tube(this.artery.map(p => p), 0.28, 0xd32f2f), tube(this.nerve, 0.17, 0xf4d03f));
      this.excise = 0; this.excised = false; this.arteryHits = 0; this.nerveHits = 0; this.touchA = false; this.touchN = false; this.clearA = this.clearN = 99; this.closest = 9; this.pool = null;
    },
    tick() {
      const dA = distToPolyline(tip, this.artery).d, dN = distToPolyline(tip, this.nerve).d;
      const hitA = dA < 0.28 + 0.1, hitN = dN < 0.17 + 0.1;
      // a new hit only counts after ~0.5 s clear of the vessel (contact flickers at its edge)
      this.clearA = hitA ? 0 : this.clearA + 1; this.clearN = hitN ? 0 : this.clearN + 1;
      if (hitA) {
        pt.bleed = Math.max(pt.bleed, 160);
        if (!this.touchA) { this.arteryHits++; say('ARTERY HIT: haemorrhage!', 'bad', 40); alarm(); logEvent({ event: 'or_artery_hit' }); if (!this.pool) this.pool = bloodPool(tip, 0.4); }
        if (this.pool) this.pool.scale.setScalar(Math.min(2.2, this.pool.scale.x + 0.02));
      }
      if (hitN && !this.touchN) { this.nerveHits++; pt.stress += 25; say('NERVE DAMAGE', 'bad', 40); alarm(); logEvent({ event: 'or_nerve_hit' }); }
      this.touchA = hitA || this.clearA < 10; this.touchN = hitN || this.clearN < 10;
      const dT = M.norm(M.sub(tip, this.T));
      this.closest = Math.min(this.closest, dT);
      if (!this.excised) {
        if (dT < this.R) {
          this.excise += SAMPLE_DT;
          this.tumour.material.emissive = new THREE.Color(0x553366);
          if (Math.round(this.excise * 18.7) % 9 === 0) say(`Excising… ${(2 - this.excise).toFixed(1)} s`, 'info', 12);
          if (this.excise >= 2) { this.excised = true; this.tumour.visible = false; say('Tumour removed: withdraw', 'good', 40); chime(); }
        } else this.tumour.material.emissive = new THREE.Color(0x000000);
        $('or-obj').textContent = `Distance to tumour ${(Math.max(0, dT - this.R) * 10).toFixed(0)} mm`;
      } else {
        $('or-obj').textContent = 'Withdraw the instrument above the surface';
        if (tip[1] > SURFACE + 0.3) return 'done';
      }
      return null;
    },
    score(t) {
      const rows = [
        ['Tumour excised', this.excised ? 'yes' : 'no', this.excised ? 400 : 0],
        ['Time', `${t.toFixed(1)} s`, 250 * clamp01(1 - (t - 10) / 60)],
        ['Artery hits', `${this.arteryHits}`, -250 * this.arteryHits],
        ['Nerve hits', `${this.nerveHits}`, -150 * this.nerveHits],
        ['Clean approach', this.arteryHits + this.nerveHits ? 'no' : 'yes', this.arteryHits + this.nerveHits ? 0 : 350],
      ];
      return { rows, stats: { t, arteryHits: this.arteryHits, nerveHits: this.nerveHits, excised: this.excised } };
    } },

  { id: 'biopsy', title: 'Procedure 3 · Biopsy', limit: 75,
    objective: 'Insert along the blue guide (match its angle), reach the nodule and hold perfectly still for 3 s.',
    band: null,
    setup() {
      this.T = [-0.7, 1.2, 1.4];
      this.A = M.normalize([Math.sin(30 * Math.PI / 180), -Math.cos(30 * Math.PI / 180), 0]);   // needle direction: 30° from vertical, leaning right-to-left
      const entry = M.sub(this.T, M.scale(this.A, (SURFACE - this.T[1]) / -this.A[1]));
      const nod = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 16), new THREE.MeshStandardMaterial({ color: 0xe67e22 }));
      nod.position.set(...this.T); procGroup.add(nod);
      const guide = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 6, 10), new THREE.MeshBasicMaterial({ color: 0x4da3ff, transparent: true, opacity: 0.55 }));
      const mid = M.sub(entry, M.scale(this.A, 3)); guide.position.set(...mid);
      guide.quaternion.setFromUnitVectors(V3(0, 1, 0), V3(...M.scale(this.A, -1))); procGroup.add(guide);
      const path = new THREE.Line(new THREE.BufferGeometry().setFromPoints([V3(...entry), V3(...this.T)]), new THREE.LineDashedMaterial({ color: 0x4da3ff, dashSize: 0.12, gapSize: 0.1 }));
      path.computeLineDistances(); procGroup.add(path);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.26, 24), new THREE.MeshBasicMaterial({ color: 0x4da3ff }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(entry[0], SURFACE + 0.02, entry[2]); procGroup.add(ring);
      this.entry = entry; this.angErrs = []; this.hold = 0; this.tremors = []; this.inside = false;
    },
    tick() {
      if (tip[1] < SURFACE) { this.angErrs.push(M.angleDeg(dir, this.A)); }
      const dT = M.norm(M.sub(tip, this.T));
      if (dT < 0.4) {
        this.hold += SAMPLE_DT;
        const tr = tremorMm(); if (!isNaN(tr) && this.hold > 0.6) this.tremors.push(tr);   // after settling in
        if (Math.round(this.hold * 18.7) % 6 === 0) say(`Hold still… ${Math.max(0, 3 - this.hold).toFixed(1)} s`, 'info', 8);
        if (this.hold >= 3) { say('Sample taken', 'good', 40); chime(); return 'done'; }
      } else if (this.hold > 0) { this.hold = 0; say('Lost position: hold again', 'bad'); }
      const ang = tip[1] < SURFACE ? `angle off by ${M.angleDeg(dir, this.A).toFixed(0)}°` : `tilt ${tiltDeg().toFixed(0)}° (target 30°)`;
      $('or-obj').textContent = `Distance to nodule ${(Math.max(0, dT - 0.3) * 10).toFixed(0)} mm · ${ang}`;
      return null;
    },
    score(t) {
      const ang = this.angErrs.length ? this.angErrs.reduce((a, b) => a + b, 0) / this.angErrs.length : 45;
      const tr = this.tremors.length ? this.tremors.reduce((a, b) => a + b, 0) / this.tremors.length : 5;
      const rows = [
        ['Insertion angle error', `${ang.toFixed(0)}°`, 350 * clamp01(1 - ang / 25)],
        ['Tremor while holding', `${tr.toFixed(2)} mm`, 350 * clamp01(1 - (tr - 0.3) / 2.2)],
        ['Time', `${t.toFixed(1)} s`, 200 * clamp01(1 - (t - 10) / 50)],
        ['Sample taken', this.hold >= 3 ? 'yes' : 'no', this.hold >= 3 ? 100 : 0],
      ];
      return { rows, stats: { ang, tremor: tr, t } };
    } },
];

// --- game flow ---
let mode = 'menu', cur = null, curIdx = -1, sample = 0, procStart = 0, caseResults = [], soloRun = false;
function grade(p) { return p >= 900 ? 'A+' : p >= 800 ? 'A' : p >= 680 ? 'B' : p >= 540 ? 'C' : p >= 400 ? 'D' : 'F'; }
function card(html) { $('or-card').innerHTML = html; $('or-card').style.display = html ? 'block' : 'none'; }
function hud(on) { for (const id of ['or-title', 'or-obj', 'or-timer']) $(id).style.display = on ? 'block' : 'none'; }

function menu() {
  mode = 'menu'; cur = null; clearProc(); hud(false);
  card(`<h1>MagTrack OR</h1>
    <p>Stand at the <b>bottom edge of the board</b> (ch3/ch4 nearest you) and hold the magnet stack like a scalpel, 2–4 cm above it.
    Lower the tip to cut or touch; lift it to move freely. Steady hands win.</p>
    <button data-go="case">▶ Start full case (3 procedures)</button>
    ${PROCS.map((p, i) => `<button data-go="${i}">${p.title.split(' · ')[1]}</button>`).join('')}
    <h3>Leaderboard</h3>${leaderboardHtml()}`);
}
function clearProc() { while (procGroup.children.length) procGroup.remove(procGroup.children[0]); }
function startProc(i) {
  curIdx = i; cur = PROCS[i]; clearProc(); cur.setup();
  card(`<h1>${cur.title}</h1><p>${cur.objective}</p><p>Time limit ${cur.limit} s. The patient's vitals react to every mistake.</p>
    <button data-go="begin">Begin (Enter)</button>`);
  mode = 'brief'; hud(true);
  $('or-title').textContent = cur.title; $('or-obj').textContent = cur.objective; $('or-timer').textContent = '';
}
function begin() { card(''); mode = 'play'; procStart = sample; playSamples = 0; logEvent({ event: 'or_start', proc: cur.id }); }
let playSamples = 0;
function finish(outcome) {
  const t = playSamples * SAMPLE_DT;
  const { rows, stats } = cur.score(t);
  const lossPenalty = -Math.min(400, pt.loss * 0.4);
  rows.push(['Blood loss', `${pt.loss.toFixed(0)} mL`, lossPenalty]);
  let points = Math.max(0, Math.round(rows.reduce((a, r) => a + r[2], 0)));
  if (outcome !== 'done') points = Math.min(points, outcome === 'lost' ? 0 : 300);
  const res = { id: cur.id, title: cur.title, outcome, points, grade: grade(points), stats, loss: pt.loss };
  caseResults.push(res);
  logEvent({ event: 'or_result', ...res });
  mode = 'result';
  const head = outcome === 'lost' ? '<h1 style="color:#ff5a5a">Patient lost</h1>' : outcome === 'timeout' ? '<h1 style="color:#ffb547">Out of time</h1>' : '<h1>Procedure complete</h1>';
  const last = soloRun || outcome === 'lost' || curIdx === PROCS.length - 1;
  card(`<div class="grade">${res.grade}</div>${head}<p>${cur.title} · <b>${points}</b> points</p>
    <table>${rows.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2] >= 0 ? '+' : ''}${Math.round(r[2])}</td></tr>`).join('')}</table>
    <button data-go="${last ? 'report' : 'next'}">${last ? 'Case report (Enter)' : 'Next procedure (Enter)'}</button>`);
  if (outcome === 'done') chime(); else alarm();
}
function report() {
  mode = 'report'; hud(false); clearProc();
  const total = caseResults.reduce((a, r) => a + r.points, 0);
  const lost = caseResults.some(r => r.outcome === 'lost');
  const avgDev = caseResults.find(r => r.id === 'incision'), bx = caseResults.find(r => r.id === 'biopsy');
  card(`<div class="grade">${grade(total / Math.max(1, caseResults.length))}</div><h1>${lost ? 'Case failed' : 'Case report'}</h1>
    <p><b>${total}</b> points over ${caseResults.length} procedure${caseResults.length > 1 ? 's' : ''}.
    ${avgDev ? ` Incision accuracy ${avgDev.stats.dev.toFixed(1)} mm.` : ''}${bx ? ` Tremor ${bx.stats.tremor.toFixed(2)} mm.` : ''}</p>
    <table>${caseResults.map(r => `<tr><td>${r.title}</td><td>${r.outcome === 'done' ? r.grade : r.outcome}</td><td>${r.points}</td></tr>`).join('')}</table>
    <h3>Sign the leaderboard</h3><input id="or-name" maxlength="16" placeholder="your name"> <button data-go="save">Save</button>
    <button data-go="menu">Skip</button>`);
  setTimeout(() => $('or-name') && $('or-name').focus(), 50);
  reportTotal = total;
}
let reportTotal = 0;
function leaderboard() { try { return JSON.parse(localStorage.getItem(LEADER_KEY)) || []; } catch (e) { return []; } }
function leaderboardHtml() {
  const lb = leaderboard();
  return lb.length ? `<table>${lb.map((e, i) => `<tr><td>${i + 1}. ${e.name.replace(/[<>&]/g, '')}</td><td>${e.detail}</td><td>${e.score}</td></tr>`).join('')}</table>` : '<p>No scores yet.</p>';
}
function saveScore() {
  const name = ($('or-name').value || 'anonymous').trim().slice(0, 16);
  const lb = leaderboard();
  lb.push({ name, score: reportTotal, detail: caseResults.map(r => r.grade).join(' '), when: new Date().toISOString() });
  lb.sort((a, b) => b.score - a.score);
  try { localStorage.setItem(LEADER_KEY, JSON.stringify(lb.slice(0, 10))); } catch (e) {}
  logEvent({ event: 'or_leaderboard', name, score: reportTotal });
  menu();
}
function go(what) {
  if (what === 'case') { soloRun = false; caseResults = []; resetPatient(); startProc(0); }
  else if (/^\d$/.test(what)) { soloRun = true; caseResults = []; resetPatient(); startProc(+what); }
  else if (what === 'begin') begin();
  else if (what === 'next') startProc(curIdx + 1);
  else if (what === 'report') report();
  else if (what === 'save') saveScore();
  else if (what === 'menu') menu();
}
$('or-card').addEventListener('click', e => { const g = e.target.dataset && e.target.dataset.go; if (g) go(g); });
addEventListener('keydown', e => {
  if (!open) return;
  if (e.key === 'Escape') { if (mode === 'menu') close(); else menu(); }
  else if (e.key === 'Enter') {
    const b = $('or-card').querySelector('button[data-go]');
    if (mode === 'report') saveScore(); else if (b && $('or-card').style.display !== 'none') go(b.dataset.go);
  }
});

// --- per sample ---
addEventListener('magnet', e => {
  if (!open) return;
  sample++;
  onFit(e.detail.fit);
  drawTool();
  if (sample > msgUntil) $('or-msg').textContent = '';
  if (mode !== 'play') { if (mode !== 'result' && mode !== 'report') patientTick(); return; }
  if (!present) { $('or-timer').textContent = 'paused: instrument not detected'; return; }   // the clock only runs while tracking
  playSamples++;
  const t = playSamples * SAMPLE_DT;
  $('or-timer').textContent = `${t.toFixed(1)} s / ${cur.limit} s`;
  const r = cur.tick();
  patientTick();
  if (pt.lost) finish('lost');
  else if (r === 'done') finish('done');
  else if (t >= cur.limit) finish('timeout');
});

// --- open / close ---
function close() { open = false; root.style.display = 'none'; logEvent({ event: 'or_close' }); }
const button = document.createElement('button');
button.textContent = 'Surgery game';
button.title = 'MagTrack OR: a surgery game played with the magnet stack';
document.querySelector('#ui .row').appendChild(button);
button.onclick = () => {
  open = true; root.style.display = 'block'; resize();
  if (!actx && (window.AudioContext || window.webkitAudioContext)) actx = new (window.AudioContext || window.webkitAudioContext)();
  resetPatient(); menu();
  logEvent({ event: 'or_open' });
};
$('or-exit').onclick = close;
})();
