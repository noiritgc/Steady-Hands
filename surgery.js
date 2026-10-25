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
// tracking filter (One Euro): cutoff in Hz when still, rising with speed (per cm/s, or per unit/s for the axis).
// Tuned on a recorded game: the axis is noisy and its error is magnified out to the tip and the skin, so it is
// smoothed hard; the position follows the hand quickly.
const POS_MIN_CUTOFF = 2, POS_BETA = 1, DIR_MIN_CUTOFF = 0.6, DIR_BETA = 0.05;
const DROPOUT_HOLD = 5;       // samples (~0.27 s) a lost fit keeps the last pose before the instrument counts as gone
const JUMP_CM = 2.5;          // a fit this far from the previous one is held back until a second one agrees
const MAX_REACH = 3;          // cm along the axis from the tip to the skin, at most
const GLIDE_S = 0.035;        // the drawn instrument eases toward each new sample over about this long
const LEADER_KEY = 'magtrack.or.leaderboard';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp01 = v => Math.max(0, Math.min(1, v));
const logEvent = d => { if (typeof log === 'function') log('app', d); };

// --- page ---
const css = document.createElement('style');
css.textContent = `
  /* chunky toy look: thick ink outlines, offset "sticker" shadows, rounded type */
  #or { --ink: #2b2540; --paper: #fffdf7; position: fixed; inset: 0; z-index: 20; display: none; background: #bfe3ef; color: var(--ink);
        font-family: ui-rounded, "SF Pro Rounded", system-ui, sans-serif; }
  #or canvas.view { position: absolute; inset: 0; }
  #or .top { position: absolute; top: 14px; left: 50%; transform: translateX(-50%); text-align: center; pointer-events: none; }
  #or .top h2 { margin: 0; font: 900 32px ui-rounded, system-ui; color: #fff; text-shadow: 0 4px 0 var(--ink), 0 0 3px var(--ink), 0 0 3px var(--ink); }
  #or .top .obj, #or .timer { display: inline-block; max-width: 62vw; margin-top: 8px; padding: 6px 16px; border-radius: 999px; background: var(--paper);
        border: 3px solid var(--ink); box-shadow: 0 4px 0 var(--ink); font-weight: 700; font-size: 16px; }
  #or .timer { display: block; width: max-content; margin: 8px auto 0; font: 800 20px ui-rounded, system-ui; }
  #or .monitor { position: absolute; top: 14px; right: 14px; width: 270px; background: #1d1b2e; border: 5px solid var(--ink); outline: 6px solid #f4f1ff;
        border-radius: 24px; padding: 10px 14px 12px; box-shadow: 0 12px 0 var(--ink); }
  #or .monitor canvas { width: 100%; height: 66px; display: block; border-radius: 10px; }
  #or .vit { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 10px; margin-top: 6px; font: 900 28px ui-rounded, system-ui; }
  #or .vit i { font-style: normal; }
  #or .vit span { display: block; font: 800 11px ui-rounded, system-ui; color: #9b95b8; letter-spacing: .6px; }
  #or .hr { color: #5ef08f; } #or .bp { color: #ff7a8a; } #or .spo2 { color: #6fd6ff; } #or .loss { color: #ffc24d; }
  #or .monitor.alarm { animation: orblink .5s steps(1) infinite; }
  @keyframes orblink { 50% { outline-color: #ff5a6e; } }
  #or .gauge { position: absolute; left: 18px; top: 52%; transform: translateY(-50%); width: 112px; background: var(--paper); padding: 12px 14px;
        border: 4px solid var(--ink); border-radius: 22px; box-shadow: 0 8px 0 var(--ink); }
  #or .bar { position: relative; height: 240px; width: 40px; margin: 8px 0 12px 10px; background: #e9e5f7; border: 3px solid var(--ink); border-radius: 16px; }
  #or .band { position: absolute; left: 0; right: 0; background: #5bd68a; }
  #or .deep { position: absolute; left: 0; right: 0; bottom: 0; background: #ff7a8a; border-radius: 0 0 12px 12px; }
  #or .surf { position: absolute; left: -8px; right: -8px; height: 4px; background: var(--ink); border-radius: 2px; }
  #or .tipmark { position: absolute; left: -16px; width: 66px; height: 12px; margin-top: -6px; background: #ffb000; border: 3px solid var(--ink); border-radius: 8px; }
  #or .gauge .lbl { color: #7a7394; font: 800 11px ui-rounded, system-ui; text-transform: uppercase; letter-spacing: .5px; }
  #or .gauge b { font: 900 22px ui-rounded, system-ui; display: block; margin-bottom: 4px; }
  #or .gauge .mot { border-top: 2px dashed #e2ddef; margin-top: 6px; padding-top: 6px; }
  #or .gauge .mot b { font-size: 17px; }
  #or .card td.up { color: #1f9d55; } #or .card td.down { color: #d64545; } #or .card td.dim { color: #9b95b8; font-weight: 700; }
  #or .trend { display: flex; gap: 18px; flex-wrap: wrap; margin: 4px 0 2px; font: 800 12px ui-rounded, system-ui; color: #7a7394; }
  #or .trend svg { display: block; margin-top: 2px; }
  #or .msg { position: absolute; top: 34%; left: 50%; transform: translate(-50%, -50%); font: 900 54px ui-rounded, system-ui; color: #fff;
        text-shadow: 0 5px 0 var(--ink), 0 0 4px var(--ink), 0 0 4px var(--ink); pointer-events: none; text-align: center; white-space: nowrap; }
  #or .msg.bad { color: #ff5a6e; } #or .msg.good { color: #5bd68a; } #or .msg.info { color: #ffc24d; }
  #or .card { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: min(620px, 92vw); max-height: 86vh; overflow: auto;
        background: var(--paper); border: 5px solid var(--ink); border-radius: 28px; padding: 24px 28px; box-shadow: 0 12px 0 var(--ink); }
  #or .card h1 { margin: 0 0 6px; font: 900 38px ui-rounded, system-ui; } #or .card h3 { margin: 16px 0 6px; font: 900 20px ui-rounded, system-ui; }
  #or .card p { color: #5b5470; line-height: 1.45; margin: 6px 0; font-weight: 600; }
  #or .card table { width: 100%; border-collapse: collapse; font-size: 15px; font-weight: 700; }
  #or .card td { padding: 6px 6px; border-bottom: 2px dashed #e2ddef; }
  #or .card td:last-child { text-align: right; font-weight: 900; }
  #or .grade { font: 900 84px ui-rounded, system-ui; float: right; margin-left: 12px; color: #ff5e8a; text-shadow: 0 6px 0 var(--ink), 0 0 3px var(--ink); line-height: 1; }
  #or .card button, #or .exit { margin: 12px 10px 0 0; font: 900 17px ui-rounded, system-ui; padding: 12px 22px; color: var(--ink); background: #9be7ff;
        border: 4px solid var(--ink); border-radius: 999px; box-shadow: 0 5px 0 var(--ink); cursor: pointer; }
  #or .card button:first-of-type { background: #ffc24d; }
  #or .card button:active, #or .exit:active { transform: translateY(3px); box-shadow: 0 2px 0 var(--ink); }
  #or .card input { font: 700 17px ui-rounded, system-ui; padding: 10px 14px; width: 210px; color: var(--ink); background: #fff; border: 4px solid var(--ink); border-radius: 999px; }
  #or .nohand { position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); pointer-events: none; font: 800 17px ui-rounded, system-ui;
        color: #fff; background: #ff7a8a; border: 4px solid var(--ink); border-radius: 999px; padding: 8px 18px; box-shadow: 0 5px 0 var(--ink); }
  #or .nohand:empty { display: none; }
  #or .exit { position: absolute; bottom: 14px; right: 18px; margin: 0; font-size: 14px; padding: 8px 16px; background: var(--paper); }
  /* patient cam: a second camera renders the face into this frame (see the render loop) */
  #or .facecam { position: absolute; right: 14px; top: 236px; width: 270px; height: 190px; box-sizing: border-box; pointer-events: none;
        border: 5px solid var(--ink); outline: 6px solid #f4f1ff; border-radius: 10px; box-shadow: 0 12px 0 var(--ink); }
  #or .facecam span { position: absolute; left: 8px; top: 8px; background: var(--paper); border: 3px solid var(--ink); border-radius: 999px;
        padding: 2px 10px; font: 900 11px ui-rounded, system-ui; letter-spacing: .6px; }
  #or .facecam b { position: absolute; left: 50%; bottom: 8px; transform: translateX(-50%); white-space: nowrap; background: var(--paper);
        border: 3px solid var(--ink); border-radius: 999px; padding: 3px 12px; font: 900 14px ui-rounded, system-ui; }
  #or .facecam b.hurt { background: #ffc24d; } #or .facecam b.crit { background: #ff7a8a; color: #fff; } #or .facecam b.dead { background: var(--ink); color: #fff; }
  @media (max-width: 1100px) {
    #or .top h2 { font-size: 22px; } #or .top .obj, #or .timer { font-size: 13px; max-width: 46vw; }
    #or .monitor { transform: scale(0.78); transform-origin: top right; }
    #or .facecam { top: 186px; transform: scale(0.78); transform-origin: top right; }
    #or .msg { font-size: 34px; }
    #or .gauge { transform: translateY(-50%) scale(0.85); transform-origin: left center; }
  }
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
    <div class="lbl">below surface</div><b id="or-depth">—</b><div class="lbl">tremor</div><b id="or-tremor">—</b><div class="lbl">tilt</div><b id="or-tilt">—</b>
    <div class="mot"><div class="lbl">path</div><b id="or-path">—</b><div class="lbl">movements</div><b id="or-moves">—</b><div class="lbl">idle</div><b id="or-idle">—</b></div></div>
  <div class="facecam" id="or-face"><span>PATIENT CAM</span><b id="or-mood">sleeping peacefully</b></div>
  <div class="msg" id="or-msg"></div>
  <div class="nohand" id="or-nohand"></div>
  <div class="card" id="or-card"></div>
  <button class="exit" id="or-exit">Exit (Esc)</button>`;
document.body.appendChild(root);
const $ = id => document.getElementById(id);

// --- 3D scene: a toy operating room, seen from the surgeon's side (the bottom edge of the card) ---
// Chunky, soft, clay-like shapes in bright colours (think Gang Beasts), not realistic anatomy.
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.className = 'view';
root.insertBefore(renderer.domElement, root.firstChild);
const scene3 = new THREE.Scene();
scene3.background = new THREE.Color(0xbfe3ef);
scene3.fog = new THREE.Fog(0xbfe3ef, 34, 70);
const cam = new THREE.PerspectiveCamera(42, 1, 0.1, 150);
cam.position.set(0, 14.5, 11.5);
cam.lookAt(0, 1.0, -1.6);

const clay = (color, roughness = 0.8, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, ...extra });
const solid = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; return m; };

// lights: soft sky fill plus the surgical lamp overhead, which casts the instrument's shadow onto the tissue
scene3.add(new THREE.HemisphereLight(0xffffff, 0xb7a6d6, 0.6));
const lamp = new THREE.SpotLight(0xfff4e0, 0.85, 0, Math.PI / 6, 0.65);
lamp.position.set(1.5, 26, 2); lamp.target.position.set(0, SURFACE, -0.5);
lamp.castShadow = true; lamp.shadow.mapSize.set(2048, 2048); lamp.shadow.bias = -0.0004;
lamp.shadow.camera.near = 12; lamp.shadow.camera.far = 45;
scene3.add(lamp, lamp.target);
const fill = new THREE.DirectionalLight(0xe4ecff, 0.3); fill.position.set(-8, 10, 14); scene3.add(fill);

function canvasTexture(draw, size = 256) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
// floor: big soft mint tiles
const tiles = canvasTexture((g, n) => { g.fillStyle = '#a6dccd'; g.fillRect(0, 0, n, n); g.fillStyle = '#96d0c0'; g.fillRect(0, 0, n / 2, n / 2); g.fillRect(n / 2, n / 2, n / 2, n / 2); });
tiles.repeat.set(14, 14);
const floor = solid(new THREE.PlaneGeometry(140, 140), clay(0xffffff, 0.9, { map: tiles }), 0, -7, 0);
floor.rotation.x = -Math.PI / 2; scene3.add(floor);

// operating table: chunky slab on a single column
scene3.add(solid(new THREE.BoxGeometry(11, 1, 27), clay(0xc9d3e6, 0.6), 0, SURFACE - 2.85, -1.5));
scene3.add(solid(new THREE.CylinderGeometry(1.4, 1.9, 6.1, 28), clay(0x8f9bb3, 0.5), 0, (SURFACE - 3.35 - 7) / 2, -1.5));
scene3.add(solid(new THREE.CylinderGeometry(3.2, 3.4, 0.6, 32), clay(0x8f9bb3, 0.5), 0, -6.7, -1.5));

// the patient lies under a thick padded drape with an opening over the operating field
const D = 2.0, BEVEL = 0.35;
const drapeShape = new THREE.Shape();
(function roundRect(s, x0, y0, x1, y1, r) {
  s.moveTo(x0 + r, y0); s.lineTo(x1 - r, y0); s.quadraticCurveTo(x1, y0, x1, y0 + r); s.lineTo(x1, y1 - r); s.quadraticCurveTo(x1, y1, x1 - r, y1);
  s.lineTo(x0 + r, y1); s.quadraticCurveTo(x0, y1, x0, y1 - r); s.lineTo(x0, y0 + r); s.quadraticCurveTo(x0, y0, x0 + r, y0);
})(drapeShape, -5.4, -8.5, 5.4, 11.2, 1.6);   // shape y = -z after the rotation below: covers z -11.2 (head end) .. 8.5
const hole = new THREE.Path();
hole.moveTo(-3.5, -5.5); hole.lineTo(3.5, -5.5); hole.lineTo(3.5, 5.5); hole.lineTo(-3.5, 5.5); hole.lineTo(-3.5, -5.5);
drapeShape.holes.push(hole);
const drape = solid(new THREE.ExtrudeGeometry(drapeShape, { depth: D, bevelEnabled: true, bevelThickness: BEVEL, bevelSize: BEVEL, bevelSegments: 4, curveSegments: 10 }),
  clay(0x4fc3b0, 0.95));
drape.rotation.x = -Math.PI / 2; drape.position.y = SURFACE - D - BEVEL;
scene3.add(drape);
// the opening: a pink body cavity under a see-through membrane (an "x-ray" view, so the anatomy stays visible)
const cavityH = SURFACE - 0.6;
scene3.add(solid(new THREE.BoxGeometry(7, cavityH, 11), clay(0xe8798c, 0.75, { side: THREE.BackSide }), 0, 0.6 + cavityH / 2, 0));
const membraneTex = canvasTexture((g, n) => {
  const gr = g.createRadialGradient(n / 2, n / 2, 10, n / 2, n / 2, n * 0.7); gr.addColorStop(0, '#ffc2cc'); gr.addColorStop(1, '#ff9fb0');
  g.fillStyle = gr; g.fillRect(0, 0, n, n);
  for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(255,255,255,0.18)'; g.beginPath(); g.arc(Math.random() * n, Math.random() * n, 4 + Math.random() * 12, 0, 7); g.fill(); }
});
const tissue = new THREE.Mesh(new THREE.PlaneGeometry(7, 11), clay(0xffffff, 0.45, { map: membraneTex, transparent: true, opacity: 0.4, depthWrite: false }));
tissue.rotation.x = -Math.PI / 2; tissue.position.y = SURFACE + 0.005; tissue.receiveShadow = true;
scene3.add(tissue);

// head, sleeping under anaesthesia: cap, closed eyes, nose, oxygen mask; X eyes if the patient is lost
const skinMat = clay(0xffc9a8, 0.7);
const head = new THREE.Group();
head.position.set(0, SURFACE - 0.5, -13);
const skull = solid(new THREE.SphereGeometry(2, 40, 28), skinMat); skull.scale.set(1, 0.92, 1.05);
// a puffy bouffant cap over the back of the head, clear of the face
const capMesh = solid(new THREE.SphereGeometry(2.1, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), clay(0x4fc3b0, 0.95), 0, 0, -1.0);
capMesh.rotation.x = -Math.PI / 2;
const ink = clay(0x2b2540, 0.6);
// the face looks up; going from the crown (-z) toward the body: brows, eyes, nose, oxygen mask
const eyes = [-0.7, 0.7].map(x => { const e = solid(new THREE.SphereGeometry(0.3, 16, 10), ink, x, 1.8, -0.15); e.scale.set(1, 0.3, 0.45); return e; });
const brows = [-0.7, 0.7].map(x => solid(new THREE.BoxGeometry(0.62, 0.12, 0.16), ink, x, 1.83, -0.62));
const xEyes = [-0.7, 0.7].flatMap(x => [0.6, -0.6].map(r => { const b = solid(new THREE.BoxGeometry(0.62, 0.14, 0.14), ink, x, 1.84, -0.15); b.rotation.y = r; b.visible = false; return b; }));
const nose = solid(new THREE.SphereGeometry(0.42, 20, 14), skinMat, 0, 1.75, 0.55);
const mask = new THREE.Mesh(new THREE.SphereGeometry(0.9, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2), clay(0x9be7ff, 0.2, { transparent: true, opacity: 0.55 }));
mask.position.set(0, 1.5, 1.05);
// distress extras: flushed cheeks and a sweat drop by the temple
const blush = [-1.15, 1.15].map(x => { const c = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 10), clay(0xff5c7a, 0.6, { transparent: true, opacity: 0.85 }));
  c.position.set(x, 1.62, 0.35); c.scale.set(1, 0.25, 0.7); c.visible = false; return c; });
const sweat = new THREE.Group();
sweat.add(new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), clay(0x6fd6ff, 0.15)));
const drip = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.42, 16), clay(0x6fd6ff, 0.15)); drip.position.z = -0.27; drip.rotation.x = -Math.PI / 2;
sweat.add(drip); sweat.position.set(1.5, 1.2, -0.7); sweat.visible = false;
head.add(skull, capMesh, ...eyes, ...brows, ...xEyes, nose, mask, ...blush, sweat);
scene3.add(head);
const HEAD_Y = SURFACE - 0.5, HEAD_Z = -13;
// the head sits off the top of the main view, so a patient cam shows the face close up (rendered into #or-face)
const faceCam = new THREE.PerspectiveCamera(30, 1.4, 0.1, 60);
faceCam.position.set(1.2, HEAD_Y + 6.4, HEAD_Z + 4.4);
faceCam.lookAt(0, HEAD_Y + 1.4, HEAD_Z + 0.75);
const faceLight = new THREE.PointLight(0xfff4e0, 0.55, 14); faceLight.position.set(0, HEAD_Y + 5, HEAD_Z + 2.5);
scene3.add(faceLight);
// arms resting at the sides, chunky and soft
for (const s of [-1, 1]) {
  const arm = solid(new THREE.CylinderGeometry(0.85, 0.85, 7.5, 24), skinMat, s * 6.6, SURFACE - 1.7, -6.2); arm.rotation.x = Math.PI / 2;
  scene3.add(arm, solid(new THREE.SphereGeometry(0.85, 24, 16), skinMat, s * 6.6, SURFACE - 1.7, -9.95), solid(new THREE.SphereGeometry(1.05, 24, 16), skinMat, s * 6.6, SURFACE - 1.6, -2.3));
}
// IV stand with a bag and a line to the arm
const pole = solid(new THREE.CylinderGeometry(0.12, 0.12, 16, 12), clay(0xb8c2d6, 0.4), -9.5, 1, -9);
const bag = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), clay(0xbfefff, 0.2, { transparent: true, opacity: 0.75 }));
bag.scale.set(0.8, 1.2, 0.45); bag.position.set(-9.5, 7.6, -8.6);
const ivLine = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V3(-9.5, 6.3, -8.6), V3(-9, 3, -8), V3(-7.6, SURFACE - 0.9, -7)]), 30, 0.06, 8), clay(0xe6f7ff, 0.3));
scene3.add(pole, bag, ivLine);

// instrument: a chunky toy scalpel. Tip at the group's origin, pointing along -y in its own frame.
const tool = new THREE.Group();
const steel = new THREE.MeshStandardMaterial({ color: 0xe6ecf5, metalness: 0.55, roughness: 0.28 });
const toyOrange = clay(0xff8a3d, 0.55);
const blade = solid(new THREE.ConeGeometry(0.27, 1.25, 28), steel, 0, 0.62, 0); blade.rotation.x = Math.PI; blade.scale.z = 0.38;
const neck = solid(new THREE.CylinderGeometry(0.1, 0.13, 1.5, 16), steel, 0, 1.25 + 0.75, 0);
const handle = solid(new THREE.CylinderGeometry(0.38, 0.38, 3.6, 28), toyOrange, 0, 2.75 + 1.8, 0);
const capLo = solid(new THREE.SphereGeometry(0.38, 24, 14), toyOrange, 0, 2.75, 0), capHi = solid(new THREE.SphereGeometry(0.38, 24, 14), toyOrange, 0, 6.35, 0);
const grip = solid(new THREE.TorusGeometry(0.4, 0.09, 10, 28), clay(0xffffff, 0.5), 0, 3.4, 0); grip.rotation.x = Math.PI / 2;
tool.add(blade, neck, handle, capLo, capHi, grip);
tool.visible = false;   // until the instrument is detected
scene3.add(tool);
// tools are swappable (operations.js registers saws, forceps, ...); each is a list of meshes built tip-at-origin
const toolModels = { scalpel: [...tool.children] };
let toolName = 'scalpel', toolPop = 0;
function setTool(name) {
  if (name === toolName || !toolModels[name]) return;
  while (tool.children.length) tool.remove(tool.children[0]);
  for (const k of toolModels[name]) tool.add(k);
  toolName = name; toolPop = 1;   // pops in with a bounce
}
// contact marker: a ring on the skin where the instrument's axis meets it (where the blade cuts, or is about to)
const aimMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false });
const aim = new THREE.Group();
const aimRing = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.045, 8, 32), aimMat); aimRing.rotation.x = Math.PI / 2;
aim.add(aimRing, new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), aimMat));
aim.renderOrder = 5; aim.visible = false;
scene3.add(aim);
const toolGoal = { pos: V3(0, 0, 0), quat: new THREE.Quaternion(), aim: V3(0, 0, 0), fresh: true };
function glideTool(dt) {   // ease the drawn instrument toward the latest sample, so 19 Hz tracking looks smooth at 60 fps
  const k = toolGoal.fresh ? 1 : 1 - Math.exp(-dt / GLIDE_S);
  tool.position.lerp(toolGoal.pos, k); tool.quaternion.slerp(toolGoal.quat, k); aim.position.lerp(toolGoal.aim, k);
  toolGoal.fresh = false;
}
const procGroup = new THREE.Group(); scene3.add(procGroup);

// --- animation: jelly wobble, heartbeat pulse, breathing, flinches ---
const wobblers = [];   // { mesh, base, amp, speed, phase }: squash-and-stretch, cleared with each procedure
const wobble = (mesh, amp = 0.05, speed = 4) => { wobblers.push({ mesh, base: mesh.scale.clone(), amp, speed, phase: Math.random() * 6 }); return mesh; };
const pulsers = [];    // materials that flash on each heartbeat
const frameHooks = []; // per-frame callbacks from the current procedure (tweens, particles), cleared with it
let pulse = 0, flinch = 0;
function animate(t) {
  toolPop *= 0.86;
  tool.scale.setScalar(1 + 0.45 * toolPop);
  for (const f of frameHooks.slice()) f(t);
  for (const w of wobblers) {
    const s = 1 + w.amp * Math.sin(t * w.speed + w.phase);
    w.mesh.scale.set(w.base.x * s, w.base.y / s, w.base.z * s);
  }
  pulse *= 0.9;
  for (const m of pulsers) m.emissiveIntensity = 0.15 + 0.6 * pulse;
  const v = vitals(), distress = !pt.lost && (pt.bleed > 15 || pt.stress > 8), critical = !pt.lost && (pt.bleed > 60 || v.sys < 85);
  // breathing: a slow bob and the mask fogging on each breath, faster as the heart rate climbs
  const bp = pt.lost ? 0 : Math.sin(t * (v.hr / 60) * 1.4);
  mask.material.opacity = pt.lost ? 0.3 : 0.32 + 0.38 * Math.max(0, bp);
  flinch *= 0.93;
  const f = flinch * Math.sin(t * 38);
  head.position.y = HEAD_Y + 0.1 * bp + 0.25 * f;
  head.rotation.z = 0.12 * flinch * Math.sin(t * 31);
  head.scale.set(1 + 0.1 * f, 1 - 0.1 * f, 1 + 0.1 * f);   // squash and stretch
  for (const e of eyes) { e.visible = !pt.lost; e.scale.z = critical ? 1.1 : distress ? 0.85 : 0.45; }   // closed slits; wide when hurt
  for (const x of xEyes) x.visible = pt.lost;
  brows.forEach((b, i) => { b.visible = !pt.lost; b.rotation.y = distress || critical ? (i ? 0.5 : -0.5) : 0; });
  for (const c of blush) c.visible = distress || critical;
  sweat.visible = critical || (distress && pt.stress > 8);
  if (sweat.visible) sweat.position.y = 1.2 - 0.18 * ((t * 0.8) % 1);   // the drop slides down
  skinMat.color.setHex(pt.lost ? 0xc7d3e8 : critical ? 0xffb39a : 0xffc9a8);
  const mood = pt.lost ? ['FLATLINED', 'dead'] : critical ? ['critical!', 'crit'] : distress ? ['ouch!', 'hurt'] : ['sleeping peacefully', ''];
  if ($('or-mood').textContent !== mood[0]) { $('or-mood').textContent = mood[0]; $('or-mood').className = mood[1]; }
}
const ouch = () => { flinch = 1; };

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix();
}
addEventListener('resize', resize);
let open = false;
let lastDraw = performance.now();
(function loop() {
  const now = performance.now(), dt = Math.min(0.1, (now - lastDraw) / 1000);
  lastDraw = now;
  if (open) {
    drawEcg(); glideTool(dt); animate(now / 1000);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, innerWidth, innerHeight);
    renderer.render(scene3, cam);
    // patient cam: render the face camera into the #or-face frame (inside its border; the frame may be scaled)
    const r = $('or-face').getBoundingClientRect();
    if (r.width > 0) {
      const b = 5 * r.width / $('or-face').offsetWidth;
      const x = r.left + b, y = innerHeight - r.bottom + b, w = r.width - 2 * b, h = r.height - 2 * b;
      faceCam.aspect = w / h; faceCam.updateProjectionMatrix();
      renderer.shadowMap.autoUpdate = false;   // reuse this frame's shadows
      renderer.setScissorTest(true); renderer.setScissor(x, y, w, h); renderer.setViewport(x, y, w, h);
      renderer.render(scene3, faceCam);
      renderer.setScissorTest(false); renderer.shadowMap.autoUpdate = true;
    }
  }
  requestAnimationFrame(loop);
})();

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
// bypass: a heart-lung machine keeps the patient alive while the heart is stopped (heart surgery)
function resetPatient() { pt = { loss: 0, bleed: 0, stress: 0, lost: false, bypass: false, beatPhase: 0, trace: new Float32Array(512), head: 0 }; }
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
  if (!pt.lost && (pt.loss > 1500 || vitals().sys < 55)) { pt.lost = true; logEvent({ event: 'or_patient_lost', loss: pt.loss }); emit('patient_lost'); }
  const v = vitals();
  $('or-hr').textContent = pt.bypass && !pt.lost ? 'BYP' : v.hr.toFixed(0);
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
  const now = performance.now(), dt = Math.min(0.1, (now - lastDraw) / 1000); lastFrame = now;
  const v = vitals(), cv = $('or-ecg'), g = cv.getContext('2d');
  const steps = Math.max(1, Math.round(dt * 160));
  for (let s = 0; s < steps; s++) {
    const before = pt.beatPhase;
    if (!pt.lost) pt.beatPhase = (pt.beatPhase + (v.hr / 60) * dt / steps) % 1;
    const beating = !pt.lost && !pt.bypass;
    if (beating && before < 0.31 && pt.beatPhase >= 0.31) { tone(v.spo2 > 92 ? 960 : 700, 45, 'sine', 0.06); pulse = 1; }
    pt.trace[pt.head] = beating ? ecgShape(pt.beatPhase) : 0;
    pt.head = (pt.head + 1) % pt.trace.length;
  }
  if (pt.lost && open && now > flatTone) { tone(880, 900, 'sine', 0.05); flatTone = now + 900; }
  g.fillStyle = '#14121f'; g.fillRect(0, 0, cv.width, cv.height);
  g.strokeStyle = pt.lost ? '#ff5a6e' : pt.bypass ? '#6fd6ff' : '#5ef08f'; g.lineWidth = 5; g.lineJoin = 'round'; g.beginPath();
  for (let i = 0; i < pt.trace.length; i++) {
    const y = cv.height * 0.7 - pt.trace[(pt.head + i) % pt.trace.length] * cv.height * 0.55;
    i ? g.lineTo(i, y) : g.moveTo(i, y);
  }
  g.stroke();
  if (pt.bypass && !pt.lost) { g.fillStyle = '#6fd6ff'; g.font = '900 30px ui-rounded, system-ui'; g.fillText('ON BYPASS', 16, 40); }
}

// --- instrument tracking ---
// Each fit (the stack's middle and its moment) goes through: polarity (which end is the tip, learned from the sign
// of the moment, so tilting past horizontal can't flip the instrument end for end), a jump check (one wild fit is
// held back unless the next agrees), a short hold over dropped fits, and a One Euro filter (smooths hard while the
// hand is still, follows quickly when it moves). The frame loop then glides the drawn instrument between samples.
// `cut` is where the instrument's axis meets the skin: that is what the blade cuts (and, above the skin, where it is
// about to), so lines are judged there rather than under the hidden tip, which sits off to one side when tilted.
let tip = null, dir = null, cut = null, raw = [], present = false;   // dir = unit vector from handle to tip
let polarity = 0, polVotes = 0, missed = 0, lastPos = null, pendingJump = null;
function oneEuro(minCut, beta) {   // https://gery.casiez.net/1euro/ ; vectors, fixed sample rate
  const a = c => 1 / (1 + 1 / (2 * Math.PI * c * SAMPLE_DT));
  let x = null, dx = null;
  return {
    reset() { x = null; },
    f(v) {
      if (!x) { x = v.slice(); dx = v.map(() => 0); return x; }
      dx = dx.map((d, k) => d + a(1) * ((v[k] - x[k]) / SAMPLE_DT - d));
      const ax = a(minCut + beta * Math.hypot(...dx));
      return (x = x.map((p, k) => p + ax * (v[k] - p)));
    },
  };
}
const posFilter = oneEuro(POS_MIN_CUTOFF, POS_BETA), dirFilter = oneEuro(DIR_MIN_CUTOFF, DIR_BETA);
function contactPoint(p, d, y) {   // where the axis through p crosses height y
  const t = d[1] < -0.2 ? (y - p[1]) / d[1] : 0;   // held nearly flat: straight down instead
  const k = Math.max(-MAX_REACH, Math.min(MAX_REACH, t));
  return [p[0] + d[0] * k, y, p[2] + d[2] * k];
}
const aimY = () => (cur && cur.aimY != null ? cur.aimY : SURFACE);   // the tissue the current step works on (skin, or inside)
function lose() { present = false; posFilter.reset(); dirFilter.reset(); lastPos = pendingJump = null; }
// The instrument: how far its tip is from the magnet's centre, along the axis. The bare stack's tip is its end
// (half its length); a physical instrument with the magnet mounted on it is measured or pivot-calibrated (bench.js).
const INSTRUMENT_KEY = 'magtrack.or.instrument';
const BARE = { name: 'Bare magnet stack', offset: STACK_LEN / 2, source: 'default' };
let instrument = (() => {
  try { const v = JSON.parse(localStorage.getItem(INSTRUMENT_KEY)); return v && v.offset > 0 && v.offset < 15 ? v : BARE; } catch (e) { return BARE; }
})();
function setInstrument(v) {
  instrument = v && v.offset > 0 && v.offset < 15 ? { ...v } : BARE;
  try { if (instrument === BARE) localStorage.removeItem(INSTRUMENT_KEY); else localStorage.setItem(INSTRUMENT_KEY, JSON.stringify(instrument)); } catch (e) {}
  logEvent({ event: 'or_instrument', instrument });
}
let rawFit = null;   // this sample's unfiltered fit with the tip-pointing axis, for calibration and validation
function onFit(fit) {
  rawFit = null;
  if (!fit) { if (++missed > DROPOUT_HOLD) lose(); return; }   // brief dropouts keep the last pose
  // a single fit far from the last one is usually a bad solve: wait for a second one nearby before believing it
  if (lastPos && M.norm(M.sub(fit.pos, lastPos)) > JUMP_CM && !(pendingJump && M.norm(M.sub(fit.pos, pendingJump)) < 1)) {
    pendingJump = fit.pos; if (++missed > DROPOUT_HOLD) lose(); return;
  }
  missed = 0; pendingJump = null; lastPos = fit.pos;
  const mN = M.normalize(fit.m);
  if (Math.abs(mN[1]) > 0.5) {   // clearly pointing down or up: vote on which magnetic end is the tip
    const vote = mN[1] < 0 ? 1 : -1;
    if (!polarity) polarity = vote;
    else if (vote !== polarity) { if (++polVotes >= 12) { polarity = vote; polVotes = 0; } }   // stack turned over in the hand
    else polVotes = 0;
  }
  let ax = M.scale(mN, polarity || (mN[1] > 0 ? -1 : 1));
  if (dir && present && M.dot(ax, dir) < 0 && !polarity) ax = M.scale(ax, -1);
  // tremor uses the stack's middle: the tip moves the same with the hand, but small axis noise is amplified 1 cm out
  raw.push(fit.pos); if (raw.length > 19) raw.shift();   // last ~1 s
  const mid = posFilter.f(fit.pos);
  dir = M.normalize(dirFilter.f(ax));
  tip = M.add(mid, M.scale(dir, instrument.offset));
  rawFit = { pos: fit.pos, ax, rel: fit.rel };
  cut = contactPoint(tip, dir, aimY());
  present = true;
}
const tremorMm = () => {   // rms wobble of the raw tip about its 1 s average
  if (raw.length < 8) return NaN;
  const m = M.mean3(raw);
  return 10 * Math.sqrt(raw.reduce((s, p) => s + M.dot(M.sub(p, m), M.sub(p, m)), 0) / raw.length);
};
const tiltDeg = () => Math.acos(Math.min(1, -dir[1])) * 180 / Math.PI;
function drawTool() {
  if (!tool.visible) toolGoal.fresh = true;   // reappearing: jump straight there
  tool.visible = present && !!tip;
  $('or-nohand').textContent = present ? '' : 'Instrument not detected: hold the magnet stack over the board, 1–5 cm up';
  if (!tool.visible) { aim.visible = false; return; }
  toolGoal.pos.set(...tip);
  toolGoal.quat.setFromUnitVectors(V3(0, -1, 0), V3(...dir));
  toolGoal.aim.set(cut[0], cut[1] + 0.04, cut[2]);
  // depth gauge: 0.5..5 cm of tip height
  const toPct = y => clamp01((y - 0.5) / 4.5) * 100;
  const band = cur && cur.band;
  // the marker shows on steps that are aimed at the skin: white above it, green in the cutting band, red too deep
  aim.visible = !!(cur && (band || cur.aim) && mode === 'play');
  aimMat.color.setHex(tip[1] >= aimY() ? 0xffffff : band && tip[1] < band[0] ? 0xff4d5e : band && tip[1] > band[1] ? 0xffd166 : 0x4dff88);
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
// glossy, chunky anatomy; `beat` makes it flash with each heartbeat
function tube(pts, r, color, beat) {
  const mat = clay(color, 0.3, { emissive: color, emissiveIntensity: 0.15 });
  if (beat) pulsers.push(mat);
  const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => V3(...p))), 90, r, 18, false), mat);
  m.castShadow = m.receiveShadow = true;
  return m;
}
// a lumpy jelly blob (noise-displaced sphere) that wobbles
function blob(r, color, lumps = 0.18) {
  const geo = new THREE.IcosahedronGeometry(r, 4), p = geo.attributes.position, v = new THREE.Vector3();
  const seed = Math.random() * 10;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = Math.sin(v.x * 7 + seed) * Math.sin(v.y * 6 + seed * 2) * Math.sin(v.z * 8 + seed * 3);
    v.multiplyScalar(1 + lumps * n); p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  const m = solid(geo, clay(color, 0.35));
  return wobble(m, 0.05, 5);
}
// surgical-marker dots along a line on the surface
function dots(pts, color, spacing = 0.28) {
  const g = new THREE.Group(), mat = clay(color, 0.6);
  let last = null;
  for (const p of pts) {
    if (last && Math.hypot(p[0] - last[0], p[2] - last[2]) < spacing) continue;
    const d = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), mat);
    d.scale.y = 0.3; d.position.set(p[0], SURFACE + 0.02, p[2]); g.add(d); last = p;
  }
  return g;
}
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
// a glossy puddle of blood that grows (growPool) and jiggles
function bloodPool(p, r) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 14), clay(0xc8102e, 0.15));
  m.position.set(p[0], SURFACE + 0.03, p[2]); m.scale.set(r, r * 0.22, r); m.receiveShadow = true;
  procGroup.add(m); wobble(m, 0.04, 3); return m;
}
function growPool(m, max, step) {
  const w = wobblers.find(w => w.mesh === m), r = Math.min(max, (w ? w.base.x : m.scale.x) + step);
  if (w) w.base.set(r, r * 0.22, r); else m.scale.set(r, r * 0.22, r);
}
// the cut: a dark red groove built from small blobs as the blade moves
const blobGeo = new THREE.SphereGeometry(0.11, 10, 8), blobMat = clay(0x7a0f22, 0.4);
function cutBlob(p) {
  const m = new THREE.Mesh(blobGeo, blobMat);
  m.scale.set(1, 0.4, 1); m.position.set(p[0], SURFACE + 0.025, p[2]); return m;
}
// new groove points from the last blob to p, every 0.08 cm, so a quick stroke leaves a continuous cut, not dots
function grooveFill(last, p) {
  if (!last) return [p.slice()];
  const gap = Math.hypot(p[0] - last[0], p[2] - last[2]);
  if (gap < 0.08) return [];
  if (gap > 1.2) return [p.slice()];   // a jump, not a stroke: don't draw a line across
  const n = Math.ceil(gap / 0.08), out = [];
  for (let i = 1; i <= n; i++) out.push([last[0] + (p[0] - last[0]) * i / n, SURFACE, last[2] + (p[2] - last[2]) * i / n]);
  return out;
}

const PROCS = [
  { id: 'incision', title: 'Procedure 1 · Incision', limit: 90,
    objective: 'Cut along the dotted line, start at the green dot. Keep the tip in the green depth band.',
    band: [SURFACE - CUT_BOTTOM, SURFACE - CUT_TOP],
    setup() {
      this.path = curvePts([[-0.3, SURFACE, 3.3], [0.9, SURFACE, 1.6], [-0.6, SURFACE, -0.2], [0.8, SURFACE, -1.9], [-0.2, SURFACE, -3.4]], 120);
      procGroup.add(dots(this.path, 0x7e57c2));
      const start = solid(new THREE.SphereGeometry(0.3, 24, 14), clay(0x2ecc71, 0.5), this.path[0][0], SURFACE + 0.04, this.path[0][2]);
      start.scale.y = 0.35; procGroup.add(wobble(start, 0.12, 4));
      this.cutPts = []; this.progress = 0; this.devs = []; this.depths = []; this.deepCount = 0; this.offCount = 0; this.pool = null;
    },
    tick() {
      const cutting = tip[1] < SURFACE - CUT_TOP;
      if (!cutting) { this.offRun = 0; return null; }
      const { d, s } = distToPolyline(cut, this.path, true);   // judged where the blade enters the skin
      const tooDeep = tip[1] < SURFACE - CUT_BOTTOM;
      if (tooDeep) {
        pt.bleed = Math.max(pt.bleed, 30);
        if (this.deepCount++ % 25 === 0) { say('TOO DEEP: bleeding!', 'bad'); alarm(); ouch(); emit('too_deep'); }
        if (!this.pool) this.pool = bloodPool(tip, 0.2);
        growPool(this.pool, 1.4, 0.01);
      }
      this.offRun = d > 0.5 ? (this.offRun || 0) + 1 : 0;
      if (d > 0.5) {   // cutting off the line (a stray sample or two is forgiven)
        if (this.offRun < 3) return null;
        pt.bleed = Math.max(pt.bleed, 8);
        if (this.offCount++ % 30 === 0) { say('Off the line', 'bad'); emit('off_line'); }
        return null;
      }
      if (this.progress === 0 && s > 0.06) { say('Start at the green dot', 'info'); emit('start_at_dot'); return null; }
      if (s >= this.progress - 0.03 && s <= this.progress + 0.1) {
        this.progress = Math.max(this.progress, s);
        this.devs.push(d); this.depths.push(tip[1]);
        const last = this.cutPts[this.cutPts.length - 1];
        for (const p of grooveFill(last, cut)) { this.cutPts.push(p); procGroup.add(cutBlob(p)); }
      }
      $('or-obj').textContent = `Incision ${(this.progress * 100).toFixed(0)}% · off the line by ${(d * 10).toFixed(1)} mm`;
      if (this.progress > 0.5 && !this.half) { this.half = true; emit('halfway'); }
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
      this.tumour = blob(this.R, 0x9b59b6, 0.22);
      this.tumour.position.set(...this.T); procGroup.add(this.tumour);
      this.artery = curvePts([[-2.6, 1.7, 3.2], [-1.0, 1.6, 0.8], [-0.62, 1.55, -0.9], [-0.95, 1.65, -2.8], [-2.2, 1.8, -4.5]]);
      this.nerve = curvePts([[2.6, 1.9, 2.8], [1.35, 1.7, 0.6], [1.1, 1.6, -0.9], [1.45, 1.7, -2.8], [2.4, 1.8, -4.4]]);
      procGroup.add(tube(this.artery, 0.28, 0xff4d6d, true), tube(this.nerve, 0.17, 0xffd166));
      this.excise = 0; this.excised = false; this.arteryHits = 0; this.nerveHits = 0; this.touchA = false; this.touchN = false; this.clearA = this.clearN = 99; this.closest = 9; this.pool = null;
    },
    tick() {
      const dA = distToPolyline(tip, this.artery).d, dN = distToPolyline(tip, this.nerve).d;
      const hitA = dA < 0.28 + 0.1, hitN = dN < 0.17 + 0.1;
      // a new hit only counts after ~0.5 s clear of the vessel (contact flickers at its edge)
      this.clearA = hitA ? 0 : this.clearA + 1; this.clearN = hitN ? 0 : this.clearN + 1;
      if (hitA) {
        pt.bleed = Math.max(pt.bleed, 160);
        if (!this.touchA) { this.arteryHits++; say('ARTERY HIT: haemorrhage!', 'bad', 40); alarm(); ouch(); emit('artery_hit'); logEvent({ event: 'or_artery_hit' }); if (!this.pool) this.pool = bloodPool(tip, 0.4); }
        if (this.pool) growPool(this.pool, 2.2, 0.02);
      }
      if (hitN && !this.touchN) { this.nerveHits++; pt.stress += 25; say('NERVE DAMAGE', 'bad', 40); alarm(); ouch(); emit('nerve_hit'); logEvent({ event: 'or_nerve_hit' }); }
      if (!hitA && dA < 0.28 + 0.55 && tip[1] < SURFACE) emit('near_artery');   // close calls: the assistant warns
      else if (!hitN && dN < 0.17 + 0.5 && tip[1] < SURFACE) emit('near_nerve');
      this.touchA = hitA || this.clearA < 10; this.touchN = hitN || this.clearN < 10;
      const dT = M.norm(M.sub(tip, this.T));
      this.closest = Math.min(this.closest, dT);
      if (!this.excised) {
        setTarget(Math.max(0, dT - this.R), 'tumour');
        if (dT < this.R) {
          if (this.excise === 0) emit('excising');
          this.excise += SAMPLE_DT;
          this.tumour.material.emissive = new THREE.Color(0x553366);
          if (Math.round(this.excise * 18.7) % 9 === 0) say(`Excising… ${(2 - this.excise).toFixed(1)} s`, 'info', 12);
          if (this.excise >= 2) { this.excised = true; this.tumour.visible = false; say('Tumour removed: withdraw', 'good', 40); chime(); emit('excised'); }
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
      const nod = blob(0.32, 0xff9f43, 0.15);
      nod.position.set(...this.T); procGroup.add(nod);
      // the approach to match: a chunky see-through guide rod above the entry point, dots below it to the nodule
      const guide = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 6, 20), clay(0x6fd6ff, 0.3, { transparent: true, opacity: 0.5 }));
      const mid = M.sub(entry, M.scale(this.A, 3)); guide.position.set(...mid);
      guide.quaternion.setFromUnitVectors(V3(0, 1, 0), V3(...M.scale(this.A, -1))); procGroup.add(guide);
      const steps = 6;
      for (let k = 1; k < steps; k++) {
        const p = M.add(entry, M.scale(M.sub(this.T, entry), k / steps));
        procGroup.add(solid(new THREE.SphereGeometry(0.07, 10, 8), clay(0x6fd6ff, 0.4), ...p));
      }
      const ring = solid(new THREE.TorusGeometry(0.28, 0.07, 10, 28), clay(0x3fa7ff, 0.4), entry[0], SURFACE + 0.04, entry[2]);
      ring.rotation.x = Math.PI / 2; procGroup.add(wobble(ring, 0.08, 4));
      this.entry = entry; this.angErrs = []; this.hold = 0; this.tremors = []; this.inside = false;
    },
    tick() {
      if (tip[1] < SURFACE) { this.angErrs.push(M.angleDeg(dir, this.A)); }
      const dT = M.norm(M.sub(tip, this.T));
      setTarget(Math.max(0, dT - 0.3), 'nodule');
      if (tip[1] < SURFACE && !this.angWarned && M.angleDeg(dir, this.A) > 15) { this.angWarned = true; emit('bad_angle', { deg: M.angleDeg(dir, this.A) }); }
      if (dT < 0.4) {
        if (this.hold === 0) emit('hold_start', { secs: 3 });
        this.hold += SAMPLE_DT;
        const tr = tremorMm(); if (!isNaN(tr) && this.hold > 0.6) this.tremors.push(tr);   // after settling in
        if (Math.round(this.hold * 18.7) % 6 === 0) say(`Hold still… ${Math.max(0, 3 - this.hold).toFixed(1)} s`, 'info', 8);
        if (this.hold >= 3) { say('Sample taken', 'good', 40); chime(); emit('sample_taken'); return 'done'; }
      } else if (this.hold > 0) { this.hold = 0; say('Lost position: hold again', 'bad'); emit('lost_position'); }
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

// --- voice hooks: named game events for voice.js, plus how far the tip is from the current target ---
const emit = (type, data = {}) => dispatchEvent(new CustomEvent('or-event', { detail: { type, data } }));
let target = null;   // { d (cm to the target), what }
const setTarget = (d, what) => { target = { d, what }; };

// --- game flow ---
let mode = 'menu', cur = null, curIdx = -1, sample = 0, procStart = 0, caseResults = [], soloRun = false;
function grade(p) { return p >= 900 ? 'A+' : p >= 800 ? 'A' : p >= 680 ? 'B' : p >= 540 ? 'C' : p >= 400 ? 'D' : 'F'; }
function card(html) { $('or-card').innerHTML = html; $('or-card').style.display = html ? 'block' : 'none'; }
function hud(on) { for (const id of ['or-title', 'or-obj', 'or-timer']) $(id).style.display = on ? '' : 'none'; }

function menu() {
  mode = 'menu'; cur = null; clearProc(); hud(false);
  const ops = PROCS.map((p, i) => [p, i]).filter(([p]) => p.op);
  card(`<h1>MagTrack OR</h1>
    <p>Stand at the <b>bottom edge of the board</b> (ch3/ch4 nearest you) and hold the magnet stack like an instrument, 2–4 cm above it.
    Lower the tip to cut or touch; lift it to move freely. Steady hands win.</p>
    <h3>Training: learn the controls (x-ray view)</h3>
    <button data-go="case">▶ Full training (3 drills)</button>
    ${PROCS.map((p, i) => p.op ? '' : `<button data-go="${i}">${p.title.split(' · ')[1]}</button>`).join('')}
    ${ops.length ? `<h3>Operations: real multi-step surgeries</h3>${ops.map(([p, i]) => `<button data-go="${i}">${p.title}</button>`).join('')}` : ''}
    ${window.MagTrackOR && window.MagTrackOR.menuExtras ? window.MagTrackOR.menuExtras() : ''}
    <h3>Leaderboard</h3>${leaderboardHtml()}`);
}
const nTraining = () => PROCS.filter(p => !p.op).length;   // training drills come first; operations are registered after
function clearProc() {
  while (procGroup.children.length) procGroup.remove(procGroup.children[0]);
  wobblers.length = 0; pulsers.length = 0; frameHooks.length = 0;
}
function startProc(i) {
  curIdx = i; cur = PROCS[i]; clearProc();
  tissue.visible = !cur.op;   // training uses the see-through x-ray membrane; operations build their own body layers
  setTool(cur.tool || 'scalpel');
  cur.setup();
  card(`<h1>${cur.title}</h1><p>${cur.objective}</p><p>Time limit ${cur.limit} s. The patient's vitals react to every mistake.</p>
    <button data-go="begin">Begin (Enter)</button>`);
  mode = 'brief'; hud(true);
  $('or-title').textContent = cur.title; $('or-obj').textContent = cur.objective; $('or-timer').textContent = '';
}
function begin() {
  card(''); mode = 'play'; procStart = sample; playSamples = 0;
  motionSamples = []; stillSince = sample * SAMPLE_DT; hesitated = false;
  for (const id of ['or-path', 'or-moves', 'or-idle']) $(id).textContent = '—';
  logEvent({ event: 'or_start', proc: cur.id }); emit('proc_start', { id: cur.id, title: cur.title, op: !!cur.op });
}

// --- motion analytics (motion.js): the tracked tip during play -> path length, movements, idle time, smoothness,
// kept per procedure in this browser so the result card (and the attending and Riley) can show progress ---
const MM = window.MotionMath;   // if motion.js didn't load, the game runs without analytics
const HISTORY_KEY = 'magtrack.or.history';
let motionSamples = [], stillSince = 0, hesitated = false;
function loadHistory() { try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch (e) { return []; } }
function saveHistory(h) { try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(-300))); } catch (e) {} }
function trackMotion() {
  const now = sample * SAMPLE_DT, contact = tip[1] < aimY();
  motionSamples.push({ t: now, p: tip.slice(), contact });
  if (MM && playSamples % 6 === 0) {   // live readout; smoothness needs the whole run, so it waits for the result card
    const m = MM.analyze(motionSamples, { sparc: false });
    $('or-path').textContent = m.pathCm.toFixed(0) + ' cm'; $('or-moves').textContent = m.moves; $('or-idle').textContent = m.idleS.toFixed(0) + ' s';
  }
  // hesitating: hovering still above the tissue for 5 s (Riley nudges)
  const back = motionSamples[motionSamples.length - 5];
  const v = back && now - back.t < 0.5 ? M.norm(M.sub(tip, back.p)) / (now - back.t) : 0;
  if (contact || v > 1) { stillSince = now; hesitated = false; }
  else if (now - stillSince > 5 && !hesitated) { hesitated = true; emit('hesitating', { secs: now - stillSince }); }
}
const esc = x => String(x).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
function sparkline(vals, color) {
  const w = 150, h = 34, lo = Math.min(...vals), hi = Math.max(...vals), r = hi - lo || 1;
  const xy = vals.map((v, i) => [4 + i * (w - 8) / (vals.length - 1), h - 4 - (v - lo) / r * (h - 8)]);
  const last = xy[xy.length - 1];
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${xy.map(p => p.map(v => v.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="4.5" fill="${color}"/></svg>`;
}
function motionHtml(m, cmp, series) {
  if (!m) return '';
  const n = (Object.values(cmp)[0] || {}).n;
  const cell = k => {
    const c = cmp[k];
    if (!c) return `<td class="dim">${n ? '—' : 'baseline'}</td>`;
    const flat = Math.abs(c.changePct) < 3;
    return `<td class="${flat ? 'dim' : c.improved ? 'up' : 'down'}">${c.changePct > 0 ? '+' : ''}${c.changePct.toFixed(0)}%${!flat && c.improved ? ' ✓' : ''}</td>`;
  };
  const rows = [['Path length', `${m.pathCm.toFixed(1)} cm`, 'pathCm'], ['Movements', m.moves, 'moves'], ['Idle (hesitation)', `${m.idleS.toFixed(1)} s`, 'idleS'],
    ['Smoothness (SPARC)', m.sparc == null ? '—' : m.sparc.toFixed(2), 'sparc']];
  const trend = series.length >= 2 ? `<div class="trend"><div>Score, last ${series.length} runs${sparkline(series.map(x => x.points), '#7e57c2')}</div>
    <div>Path length (lower is better)${sparkline(series.map(x => x.pathCm), '#ff8a3d')}</div></div>` : '';
  return `<h3>Motion analysis</h3><table><tr><td class="dim">measured from the tracked tip</td><td class="dim">this run</td><td class="dim">${n ? `vs your last ${n}` : 'first completed run'}</td></tr>
    ${rows.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td>${cell(r[2])}</tr>`).join('')}</table>${trend}
    <p style="font-size:12px">Idle counts stillness above the tissue (holds in the tissue don't). Smoothness: closer to 0 is smoother.</p>`;
}
let playSamples = 0;
function finish(outcome) {
  const t = playSamples * SAMPLE_DT;
  const { rows, stats } = cur.score(t);
  const lossPenalty = -Math.min(400, pt.loss * 0.4);
  rows.push(['Blood loss', `${pt.loss.toFixed(0)} mL`, lossPenalty]);
  let points = Math.max(0, Math.round(rows.reduce((a, r) => a + r[2], 0)));
  if (outcome !== 'done') points = Math.min(points, outcome === 'lost' ? 0 : 300);
  const res = { id: cur.id, title: cur.title, outcome, points, grade: grade(points), stats, loss: pt.loss };
  // motion analytics, compared with this procedure's earlier completed runs, then saved
  const hist = loadHistory(), prev = hist.filter(h => h.id === cur.id && h.outcome === 'done' && h.m).map(h => h.m);
  const mo = MM && motionSamples.length > 5 ? MM.analyze(motionSamples) : null;
  const metrics = mo && { pathCm: mo.pathCm, moves: mo.moves, idleS: mo.idleS, sparc: mo.sparc, time: t, points };
  const cmp = metrics && outcome === 'done' ? MM.compare(metrics, prev) : {};
  const best = MM ? MM.bestImprovement(cmp) : null;
  if (metrics) { hist.push({ id: cur.id, when: new Date().toISOString(), outcome, m: metrics }); saveHistory(hist); }
  Object.assign(res, { motion: metrics, progress: cmp, priorRuns: prev.length });
  const series = outcome === 'done' && metrics ? prev.slice(-9).concat([metrics]) : [];
  emit('proc_end', { outcome, grade: res.grade, points, improve: best && { key: best.key, pct: Math.round(best.gainPct) } });
  caseResults.push(res);
  logEvent({ event: 'or_result', ...res });
  mode = 'result';
  const head = outcome === 'lost' ? '<h1 style="color:#ff5a5a">Patient lost</h1>' : outcome === 'timeout' ? '<h1 style="color:#ffb547">Out of time</h1>' : '<h1>Procedure complete</h1>';
  const last = soloRun || outcome === 'lost' || curIdx >= nTraining() - 1;
  card(`<div class="grade">${res.grade}</div>${head}<p>${cur.title} · <b>${points}</b> points</p>
    <table>${rows.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2] >= 0 ? '+' : ''}${Math.round(r[2])}</td></tr>`).join('')}</table>
    ${motionHtml(metrics, cmp, series)}
    <button data-go="${last ? 'report' : 'next'}">${last ? 'Case report (Enter)' : 'Next procedure (Enter)'}</button>
    <div id="or-debrief"></div>`);
  if (outcome === 'done') chime(); else alarm();
  if (window.MagTrackOR.onResult) window.MagTrackOR.onResult(res, rows);   // attending.js debriefs here
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
  const what = caseResults.length === 1 ? caseResults[0].title.replace(/^.* · /, '') : 'Training';
  lb.push({ name, score: reportTotal, detail: `${what} ${caseResults.map(r => r.grade).join(' ')}`, when: new Date().toISOString() });
  lb.sort((a, b) => b.score - a.score);
  try { localStorage.setItem(LEADER_KEY, JSON.stringify(lb.slice(0, 10))); } catch (e) {}
  logEvent({ event: 'or_leaderboard', name, score: reportTotal });
  menu();
}
function go(what) {
  if (what === 'case') { soloRun = false; caseResults = []; resetPatient(); startProc(0); }
  else if (/^\d+$/.test(what)) { soloRun = true; caseResults = []; resetPatient(); startProc(+what); }
  else if (what === 'begin') begin();
  else if (what === 'next') startProc(curIdx + 1);
  else if (what === 'report') report();
  else if (what === 'save') saveScore();
  else if (what === 'menu') menu();
  else if (window.MagTrackOR.onGo) window.MagTrackOR.onGo(what);   // bench.js: tracking check, instrument
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
  target = null;   // the procedure sets it again this sample if it has one
  const r = cur.tick();
  trackMotion();
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

// --- for operations.js: building blocks, live state, and registration ---
window.MagTrackOR = {
  SURFACE, SAMPLE_DT, V3, clay, solid, blob, tube, wobble, dots, curvePts, distToPolyline, bloodPool, growPool, cutBlob, grooveFill,
  say, alarm, chime, tone, ouch, logEvent, tremorMm, setTool,
  group: procGroup, scene: scene3, skinMat,
  get tip() { return tip; }, get dir() { return dir; }, get cut() { return cut; }, history: loadHistory,
  get raw() { return rawFit; }, get instrument() { return instrument; }, setInstrument, STACK_LEN,
  card, menu, setup() { mode = 'setup'; hud(false); clearProc(); }, get mode() { return mode; },
  get current() { return cur; },   // the running procedure (tests drive its steps)
  get pt() { return pt; }, get sample() { return sample; },
  setObjective(text) { $('or-obj').textContent = text; },
  registerTool(name, meshes) { toolModels[name] = meshes; },
  onFrame(fn) { frameHooks.push(fn); },
  offFrame(fn) { const i = frameHooks.indexOf(fn); if (i >= 0) frameHooks.splice(i, 1); },
  register(op) { PROCS.push(op); },
  procs: () => PROCS.map((p, i) => ({ index: i, id: p.id, title: p.title, op: !!p.op })),
  emit, setTarget, vitals,
  get target() { return target; },
  get playing() { return open && mode === 'play'; },
  get open() { return open; },
  timeLeft: () => (cur && mode === 'play' ? cur.limit - playSamples * SAMPLE_DT : null),
  root,
  onResult: null,   // set by attending.js: (result, rows) => void
};
})();
