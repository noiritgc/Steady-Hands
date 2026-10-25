// MagTrack guide: follow a magnet-tipped tube or tool through material you can't see through (a box, a phantom,
// tissue). Mark where the tip should end up and where it must not go; the viewer draws the tip's path, shows how far
// it is from the target and which way to move, confirms arrival, and alerts on entering a no-go zone.
// The tip has to be on the chips' side of the board (the fit keeps the magnet in front of the chips).
(function () {
'use strict';
const TARGET_R = 0.6;          // cm: this close to the target counts as on target
const ON_TARGET_SAMPLES = 15;  // held that close this many samples (~0.8 s) before confirming
const NOGO_R = 1.5;            // cm radius of a no-go zone
const TRAIL = 900;             // path samples kept (~45 s)
const MARK_SAMPLES = 10;       // recent tip positions averaged when marking a point
const BEEP_FROM_CM = 5;        // proximity beeps start this close to the target
const STORE_KEY = 'magtrack.guide.v1';

// --- marks (saved, so a reload keeps them) ---
let marks = { target: null, nogo: [] };
try { const m = JSON.parse(localStorage.getItem(STORE_KEY)); if (m && Array.isArray(m.nogo)) marks = m; } catch (e) {}
const saveMarks = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(marks)); } catch (e) {} };

// --- 3D: path, target, no-go zones, line to target ---
const trailPos = new Float32Array(TRAIL * 3), trailCol = new Float32Array(TRAIL * 3);
const trailGeo = new THREE.BufferGeometry();
trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
trailGeo.setAttribute('color', new THREE.BufferAttribute(trailCol, 3));
trailGeo.setDrawRange(0, 0);
const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ vertexColors: true }));
let trailN = 0;

const targetMesh = new THREE.Mesh(new THREE.SphereGeometry(TARGET_R, 24, 16),
  new THREE.MeshBasicMaterial({ color: 0x3fcf6e, wireframe: true, transparent: true, opacity: 0.8 }));
const targetDrop = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
  new THREE.LineBasicMaterial({ color: 0x3fcf6e }));
const toTarget = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
  new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.25, gapSize: 0.18 }));
const nogoGroup = new THREE.Group();
const group = new THREE.Group();
group.add(trail, targetMesh, targetDrop, toTarget, nogoGroup);
group.visible = false;
scene.add(group);

function drawMarks() {
  targetMesh.visible = targetDrop.visible = !!marks.target;
  if (marks.target) {
    targetMesh.position.set(...marks.target);
    targetDrop.geometry.setFromPoints([new THREE.Vector3(...marks.target), new THREE.Vector3(marks.target[0], 0, marks.target[2])]);
  }
  while (nogoGroup.children.length) nogoGroup.remove(nogoGroup.children[0]);
  for (const z of marks.nogo) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(NOGO_R, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xff3b3b, transparent: true, opacity: 0.22, depthWrite: false }));
    s.position.set(...z);
    nogoGroup.add(s);
  }
}
drawMarks();

// --- panel ---
const css = document.createElement('style');
css.textContent = `
  #guide { position: absolute; right: 12px; width: 360px; max-width: calc(100% - 24px); box-sizing: border-box; display: none; z-index: 4;
           background: var(--panel); border: 1px solid #333844; border-radius: 10px; padding: 14px 16px; }
  #guide .state { font: 700 28px system-ui, sans-serif; padding: 10px 12px; border-radius: 8px; text-align: center; background: #2a2e38; }
  #guide .state.on { background: #1f6b3d; } #guide .state.nogo { background: #8a1f1f; } #guide .state.none { color: var(--muted); }
  #guide .nums { display: grid; grid-template-columns: 1fr auto; gap: 4px 12px; margin: 12px 0 6px; align-items: baseline; }
  #guide .nums span { color: var(--muted); }
  #guide .nums b { font: 700 34px ui-monospace, monospace; text-align: right; }
  #guide .hint { min-height: 40px; color: var(--text); font-size: 16px; line-height: 1.35; }
  #guide .buttons { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  #guide .buttons button { padding: 7px 10px; }
  #guide .note { color: var(--muted); font-size: 12px; margin-top: 8px; }
  body.guide-nogo::after { content: ''; position: fixed; inset: 0; pointer-events: none; box-shadow: inset 0 0 0 10px #ff3b3b; animation: pulse .5s steps(1) infinite; }
`;
document.head.appendChild(css);
const panel = document.createElement('div');
panel.id = 'guide';
panel.innerHTML = `
  <div class="state none" id="g-state">no tip found</div>
  <div class="nums">
    <span>to target</span><b id="g-dist">—</b>
    <span>depth (from the chips)</span><b id="g-depth">—</b>
  </div>
  <div class="hint" id="g-hint">Mark a target: hold the tip where it should end up and click "Mark target here".</div>
  <div class="buttons">
    <button data-act="target">Mark target here</button>
    <button data-act="nogo">Mark no-go here</button>
    <button data-act="clear">Clear marks</button>
    <button data-act="path">Clear path</button>
    <button data-act="sound">🔊 Sound on</button>
  </div>
  <div class="buttons">
    <button data-act="view3d">3D view</button><button data-act="top">Top view</button><button data-act="side">Side view</button>
  </div>
  <div class="note" id="g-note"></div>`;
document.body.appendChild(panel);
const $ = id => document.getElementById(id);

const toggle = document.createElement('button');
toggle.textContent = 'Guide';
toggle.title = 'Guide a magnet-tipped tube or tool to a target you mark';
document.querySelector('#ui .row').appendChild(toggle);
const placeBelowUi = () => { panel.style.top = Math.round(document.getElementById('ui').getBoundingClientRect().bottom + 8) + 'px'; };
addEventListener('resize', placeBelowUi);
toggle.onclick = () => {
  const on = panel.style.display !== 'block';
  panel.style.display = on ? 'block' : 'none';
  group.visible = on;
  toggle.classList.toggle('live', on);
  placeBelowUi();
  if (on) audio();   // a click is needed before the page may play sound
  else document.body.classList.remove('guide-nogo');
  logEvent({ event: 'guide_open', on });
};
function logEvent(d) { if (typeof log === 'function') log('app', d); }

// --- sound: beeps that speed up as the tip closes in, a chime on target, a buzz in a no-go zone ---
let ctx = null, soundOn = true, nextBeep = 0;
function audio() { if (!ctx && (window.AudioContext || window.webkitAudioContext)) ctx = new (window.AudioContext || window.webkitAudioContext)(); return ctx; }
function tone(freq, ms, type = 'sine', vol = 0.15) {
  if (!soundOn || !audio()) return;
  const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + ms / 1000);
  o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + ms / 1000);
}

// --- tracking ---
const recent = [];             // last few tip positions, for marking
let state = 'none', onCount = 0, reachedLogged = false, approachStart = 0, lastNogo = false, sample = 0;

addEventListener('magnet', e => {
  if (panel.style.display !== 'block') return;
  sample++;
  placeBelowUi();
  const { fit } = e.detail;
  if (!fit) {
    setState('none', 'no tip found');
    $('g-hint').textContent = marks.target ? 'Bring the tip within ~7 cm of the chips.' : $('g-hint').textContent;
    recent.length = 0; onCount = 0;
    document.body.classList.remove('guide-nogo');
    return;
  }
  const tip = fit.pos;
  if (!approachStart) approachStart = sample;
  recent.push(tip); if (recent.length > MARK_SAMPLES) recent.shift();
  addTrail(tip);
  $('g-depth').textContent = tip[1].toFixed(1) + ' cm';

  const inNogo = marks.nogo.some(z => M.norm(M.sub(tip, z)) < NOGO_R);
  if (inNogo && !lastNogo) logEvent({ event: 'guide_nogo', tip });
  lastNogo = inNogo;
  document.body.classList.toggle('guide-nogo', inNogo);

  if (!marks.target) {
    $('g-dist').textContent = '—';
    toTarget.visible = false;
    setState(inNogo ? 'nogo' : 'track', inNogo ? '⚠ NO-GO ZONE' : 'tracking');
    if (inNogo && sample >= nextBeep) { tone(140, 220, 'square', 0.12); nextBeep = sample + 5; }
    return;
  }
  const d = M.sub(marks.target, tip), dist = M.norm(d);
  $('g-dist').textContent = dist < 1 ? (dist * 10).toFixed(0) + ' mm' : dist.toFixed(1) + ' cm';
  toTarget.visible = true;
  toTarget.geometry.setFromPoints([new THREE.Vector3(...tip), new THREE.Vector3(...marks.target)]);
  toTarget.computeLineDistances();

  onCount = dist < TARGET_R ? onCount + 1 : 0;
  if (inNogo) setState('nogo', '⚠ NO-GO ZONE');
  else if (onCount >= ON_TARGET_SAMPLES) setState('on', '✓ ON TARGET');
  else setState('track', 'guiding…');
  $('g-hint').textContent = inNogo ? 'Pull back: the tip is inside a no-go zone.' : onCount >= ON_TARGET_SAMPLES ? 'Hold here.' : directions(d);

  if (onCount >= ON_TARGET_SAMPLES && !reachedLogged) {
    reachedLogged = true;
    const secs = (sample - approachStart) / 18.7;
    $('g-note').textContent = `Reached the target in ${secs.toFixed(1)} s, within ${(dist * 10).toFixed(0)} mm.`;
    logEvent({ event: 'guide_on_target', dist, secs });
    tone(880, 150); setTimeout(() => tone(1320, 250), 160);
  }
  if (dist > 2 * TARGET_R) reachedLogged = false;   // leaving the target re-arms the confirmation

  // proximity beeps, faster as it gets closer (like a parking sensor)
  if (inNogo) { if (sample >= nextBeep) { tone(140, 220, 'square', 0.12); nextBeep = sample + 5; } }
  else if (dist < BEEP_FROM_CM && onCount < ON_TARGET_SAMPLES && sample >= nextBeep) {
    tone(660 + 400 * (1 - dist / BEEP_FROM_CM), 60);
    nextBeep = sample + Math.max(2, Math.round(2 + 14 * dist / BEEP_FROM_CM));
  }
});

// Which way to move, in board terms, biggest correction first.
function directions(d) {
  const parts = [
    [Math.abs(d[1]), d[1] > 0 ? 'deeper' : 'shallower'],
    [Math.abs(d[0]), d[0] > 0 ? 'toward the right edge' : 'toward the left edge'],
    [Math.abs(d[2]), d[2] > 0 ? 'toward the bottom of the card' : 'toward the top of the card'],
  ].filter(([v]) => v >= 0.2).sort((a, b) => b[0] - a[0]);
  return parts.length ? 'Move ' + parts.map(([v, w]) => `${v.toFixed(1)} cm ${w}`).join(', ') + '.' : 'Almost there.';
}

function setState(cls, text) {
  if (state === cls && $('g-state').textContent === text) return;
  state = cls;
  $('g-state').className = 'state ' + cls;
  $('g-state').textContent = text;
}

function addTrail(p) {
  if (trailN === TRAIL) { trailPos.copyWithin(0, 3); trailCol.copyWithin(0, 3); trailN--; }
  trailPos.set(p, trailN * 3);
  const inNogo = marks.nogo.some(z => M.norm(M.sub(p, z)) < NOGO_R);
  trailCol.set(inNogo ? [1, 0.25, 0.25] : [0.3, 0.75, 1], trailN * 3);
  trailN++;
  trailGeo.setDrawRange(0, trailN);
  trailGeo.attributes.position.needsUpdate = trailGeo.attributes.color.needsUpdate = true;
}

function markHere(kind) {
  if (recent.length < MARK_SAMPLES) { $('g-note').textContent = 'Hold the tip still where you want the mark (needs a steady fix for ~0.5 s).'; return; }
  const p = M.scale(recent.reduce(M.add, [0, 0, 0]), 1 / recent.length);
  if (kind === 'target') { marks.target = p; reachedLogged = false; approachStart = 0; }
  else marks.nogo.push(p);
  saveMarks(); drawMarks();
  $('g-note').textContent = `${kind === 'target' ? 'Target' : 'No-go zone'} marked at (${p.map(v => v.toFixed(1)).join(', ')}) cm.`;
  logEvent({ event: 'guide_mark', kind, p });
}

panel.addEventListener('click', e => {
  const act = e.target.dataset && e.target.dataset.act;
  if (act === 'target' || act === 'nogo') markHere(act);
  else if (act === 'clear') { marks = { target: null, nogo: [] }; saveMarks(); drawMarks(); toTarget.visible = false; $('g-dist').textContent = '—'; logEvent({ event: 'guide_clear' }); }
  else if (act === 'path') { trailN = 0; trailGeo.setDrawRange(0, 0); approachStart = 0; reachedLogged = false; $('g-note').textContent = ''; }
  else if (act === 'sound') { soundOn = !soundOn; e.target.textContent = soundOn ? '🔊 Sound on' : '🔇 Sound off'; audio(); }
  else if (act === 'top') { camera.position.set(0, 16, 0.01); controls.target.set(0, 0, 0); }
  else if (act === 'side') { camera.position.set(16, 2, 0); controls.target.set(0, 2, 0); }
  else if (act === 'view3d') { camera.position.set(6, 8, 9); controls.target.set(0, 0, 0); }
});
})();
