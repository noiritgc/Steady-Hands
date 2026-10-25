// MagTrack OR operations: multi-step surgeries (cartoon, PG) modelled loosely on real open operations: cut the skin,
// get through the layers underneath, do the work inside, close up. Every step uses a mechanic that suits the magnet
// tracker (position, depth, tilt, and motion patterns), and the instrument switches for each step:
//   cut    (scalpel)   trace a line at the right depth
//   saw    (bone saw)  saw back and forth along a bone line
//   drag   (retractor) dip into a handle and pull it outward
//   hold   (clamp, needle) hold dead still on a point
//   grab   (forceps)   grab an organ, then lift it out or carry it somewhere
//   pump   (hands)     press down and up in a steady rhythm
//   stitch (needle)    dip into zig-zag points in order
// Registers with surgery.js through window.MagTrackOR.
(function () {
'use strict';
const OR = window.MagTrackOR;
if (!OR) return;
const { SURFACE, SAMPLE_DT, V3, clay, solid, blob, tube, wobble, curvePts, distToPolyline } = OR;
const clamp01 = v => Math.max(0, Math.min(1, v));
const rand = (a, b) => a + Math.random() * (b - a);
const add = o => { OR.group.add(o); return o; };
const xzDist = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const steel = new THREE.MeshStandardMaterial({ color: 0xe6ecf5, metalness: 0.55, roughness: 0.28 });

// --- small animation helpers (driven by surgery.js's per-frame hooks) ---
function tween(sec, fn, done) {
  let t0 = null;
  const f = t => {
    if (t0 === null) t0 = t;
    const u = clamp01((t - t0) / sec);
    fn(u * u * (3 - 2 * u));
    if (u >= 1) { OR.offFrame(f); if (done) done(); }
  };
  OR.onFrame(f);
}
const particles = [], sparkGeo = new THREE.SphereGeometry(0.05, 8, 6);
function spark(p, color) {
  const m = add(new THREE.Mesh(sparkGeo, clay(color, 0.6)));
  m.position.set(...p);
  particles.push({ m, v: [rand(-0.07, 0.07), rand(0.05, 0.12), rand(-0.07, 0.07)], life: 1 });
}
function updateParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.m.position.x += p.v[0]; p.m.position.y += p.v[1]; p.m.position.z += p.v[2];
    p.v[1] -= 0.008; p.life -= 0.035; p.m.scale.setScalar(Math.max(0.01, p.life));
    if (p.life <= 0) { OR.group.remove(p.m); particles.splice(i, 1); }
  }
}
function dotsAt(pts, y, color, spacing = 0.28) {
  const g = new THREE.Group(), mat = clay(color, 0.6);
  let last = null;
  for (const p of pts) {
    if (last && xzDist(p, last) < spacing) continue;
    const d = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), mat);
    d.scale.y = 0.35; d.position.set(p[0], y, p[2]); g.add(d); last = p;
  }
  return add(g);
}
function ring(p, color) {   // pulsing target ring for hold / grab / stitch
  const r = add(solid(new THREE.TorusGeometry(0.34, 0.07, 10, 28), clay(color, 0.4, { emissive: color, emissiveIntensity: 0.4 }), ...p));
  r.rotation.x = Math.PI / 2;
  return wobble(r, 0.12, 6);
}

// --- tools (tip at the origin, pointing along -y) ---
function handle(color, y0 = 2.6, len = 3.4) {
  const c = clay(color, 0.55);
  return [solid(new THREE.CylinderGeometry(0.38, 0.38, len, 28), c, 0, y0 + len / 2, 0),
    solid(new THREE.SphereGeometry(0.38, 24, 14), c, 0, y0, 0), solid(new THREE.SphereGeometry(0.38, 24, 14), c, 0, y0 + len, 0)];
}
function makeTools() {
  // bone saw: a toothy blade under a chunky yellow motor
  const blade = solid(new THREE.BoxGeometry(0.06, 1.4, 0.6), steel, 0, 0.75, 0);
  const teeth = [-0.22, -0.07, 0.08, 0.23].map(z => { const t = solid(new THREE.ConeGeometry(0.06, 0.16, 4), steel, 0, 0.06, z); t.rotation.x = Math.PI; return t; });
  const motor = solid(new THREE.SphereGeometry(0.7, 28, 18), clay(0xffc24d, 0.5), 0, 2.05, 0); motor.scale.set(0.8, 1.05, 1);
  const stripe = solid(new THREE.TorusGeometry(0.58, 0.07, 10, 28), clay(0x2b2540, 0.6), 0, 2.05, 0); stripe.rotation.x = Math.PI / 2;
  OR.registerTool('saw', [blade, ...teeth, motor, stripe, ...handle(0x5b5470, 2.8, 2.6)]);
  // retractor: a steel hook on a green handle
  const hook = solid(new THREE.TorusGeometry(0.28, 0.08, 10, 24, Math.PI), steel, 0, 0.28, 0); hook.rotation.y = Math.PI / 2;
  OR.registerTool('retractor', [hook, solid(new THREE.CylinderGeometry(0.09, 0.09, 2.2, 14), steel, 0, 1.6, 0), ...handle(0x5bd68a)]);
  // forceps: two prongs meeting at the tip
  const prongs = [-1, 1].map(s => { const p = solid(new THREE.BoxGeometry(0.1, 2.4, 0.16), steel, s * 0.17, 1.2, 0); p.rotation.z = s * 0.12; return p; });
  OR.registerTool('forceps', [...prongs, ...handle(0x9b8cff)]);
  // clamp: crossed jaws and finger rings
  const jaws = [-1, 1].map(s => { const j = solid(new THREE.BoxGeometry(0.12, 2.2, 0.12), steel, s * 0.05, 1.1, 0); j.rotation.z = s * 0.1; return j; });
  const rings = [-1, 1].map(s => { const r = solid(new THREE.TorusGeometry(0.32, 0.08, 10, 24), clay(0x6fd6ff, 0.45), s * 0.38, 2.7, 0); r.rotation.y = Math.PI / 2; return r; });
  OR.registerTool('clamp', [...jaws, ...rings, solid(new THREE.SphereGeometry(0.14, 16, 10), steel, 0, 2.1, 0)]);
  // needle holder: a curved needle trailing purple thread
  const needle = solid(new THREE.TorusGeometry(0.3, 0.045, 8, 24, Math.PI * 1.2), steel, 0.22, 0.25, 0);
  const thread = solid(new THREE.TorusGeometry(0.6, 0.03, 6, 24, Math.PI), clay(0x7e57c2, 0.5), -0.5, 0.7, 0);
  OR.registerTool('needle', [needle, thread, solid(new THREE.CylinderGeometry(0.08, 0.08, 2, 12), steel, 0, 1.6, 0), ...handle(0xff7aa8)]);
  // hands: a chunky cartoon glove, palm down
  const glove = clay(0xf4f6ff, 0.6);
  const palm = solid(new THREE.SphereGeometry(0.9, 28, 18), glove, 0, 0.45, 0); palm.scale.set(1, 0.5, 1.15);
  const fingers = [-0.5, -0.17, 0.17, 0.5].map(x => { const f = solid(new THREE.CylinderGeometry(0.17, 0.17, 0.9, 14), glove, x, 0.35, -1.05); f.rotation.x = Math.PI / 2; return f; });
  const thumb = solid(new THREE.CylinderGeometry(0.19, 0.19, 0.7, 14), glove, 0.95, 0.4, -0.2); thumb.rotation.z = Math.PI / 2.6;
  const cuff = solid(new THREE.CylinderGeometry(0.6, 0.65, 0.7, 24), clay(0x6fd6ff, 0.5), 0, 0.95, 0.75); cuff.rotation.x = Math.PI / 2.4;
  OR.registerTool('hands', [palm, ...fingers, thumb, cuff]);
  // suction: a hollow wand with a clear tube trailing off
  const wand = solid(new THREE.CylinderGeometry(0.1, 0.14, 2.4, 16), clay(0xdff6ff, 0.3, { transparent: true, opacity: 0.85 }), 0, 1.2, 0);
  const tubeLine = tube([[0, 2.4, 0], [0.5, 3.4, 0.2], [1.4, 3.9, 0.6], [2.6, 3.6, 1.2]], 0.1, 0xbfefff);
  OR.registerTool('suction', [wand, tubeLine, ...handle(0x3fa7ff, 2.4, 1.6)]);
  // dissector: a fine hooked tip (for teasing tissue apart)
  const hookTip = solid(new THREE.TorusGeometry(0.14, 0.04, 8, 16, Math.PI), steel, 0.14, 0.1, 0);
  OR.registerTool('dissector', [hookTip, solid(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 12), steel, 0, 1.3, 0), ...handle(0xffc24d)]);
  // reamer: a hemispherical cheese-grater on a drill
  const dome = solid(new THREE.SphereGeometry(0.45, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), steel, 0, 0.45, 0);
  const drill = solid(new THREE.BoxGeometry(1.1, 1.2, 0.8), clay(0x5bd68a, 0.5), 0, 2.4, 0);
  OR.registerTool('reamer', [dome, solid(new THREE.CylinderGeometry(0.1, 0.1, 1.6, 12), steel, 0, 1.25, 0), drill, ...handle(0x2b2540, 3.0, 2.2)]);
  // mallet: hits along -y with the cup impactor below it
  const head = solid(new THREE.CylinderGeometry(0.45, 0.45, 1.3, 24), clay(0xb8c2d6, 0.4), 0, 2.2, 0); head.rotation.z = Math.PI / 2;
  OR.registerTool('mallet', [solid(new THREE.CylinderGeometry(0.12, 0.2, 1.8, 14), steel, 0, 0.9, 0), solid(new THREE.SphereGeometry(0.3, 16, 10), steel, 0, 0.15, 0), head, ...handle(0x8b5e3c, 2.9, 2.4)]);
  // trocar: a port with a sharp obturator and a valve
  const port = solid(new THREE.CylinderGeometry(0.22, 0.22, 2.0, 18), clay(0x9be7ff, 0.35), 0, 1.1, 0);
  const valve = solid(new THREE.CylinderGeometry(0.45, 0.45, 0.4, 20), clay(0x2b2540, 0.5), 0, 2.2, 0);
  const point = solid(new THREE.ConeGeometry(0.2, 0.3, 16), steel, 0, 0.0, 0); point.rotation.x = Math.PI;
  OR.registerTool('trocar', [port, valve, point, ...handle(0x6fd6ff, 2.5, 1.4)]);
  // clip applier: long thin jaws holding a titanium clip
  const cjaws = [-1, 1].map(s => { const j = solid(new THREE.BoxGeometry(0.07, 2.6, 0.12), steel, s * 0.07, 1.3, 0); j.rotation.z = s * 0.05; return j; });
  OR.registerTool('clipper', [...cjaws, solid(new THREE.BoxGeometry(0.28, 0.06, 0.06), clay(0xd0d6e0, 0.25, { metalness: 0.7 }), 0, 0.05, 0), ...handle(0x9b8cff)]);
}
makeTools();

// --- body layers ---
// Skin over the whole field except an opening, which is two flaps hinged on its long edges (they fold open / shut).
// darker than the face: the field sits right under the surgical lamp (~1.4x brighter), so this reads as the same
// peach; greys out with the face if the patient is lost
const BODY = 0xc97a5f, bodySkin = clay(BODY, 0.75);
function makeSkin(o) {   // o = { x0, x1, z0, z1 } opening; the incision runs along x = (x0 + x1) / 2
  // (o.along === 'x': a side-to-side incision along z = (z0 + z1) / 2 instead; o.mat: the skin material)
  const W = 3.5, L = 5.5, T = 0.25, y = SURFACE + 0.02 - T / 2, mat = o.mat || bodySkin;
  OR.onFrame(() => mat.color.setHex(OR.pt.lost ? 0x9aa6bb : BODY));
  const box = (x0, x1, z0, z1) => add(solid(new THREE.BoxGeometry(x1 - x0, T, z1 - z0), mat, (x0 + x1) / 2, y, (z0 + z1) / 2));
  box(-W, o.x0, -L, L); box(o.x1, W, -L, L); box(o.x0, o.x1, -L, o.z0); box(o.x0, o.x1, o.z1, L);
  const xm = (o.x0 + o.x1) / 2, zm = (o.z0 + o.z1) / 2, flaps = [];
  if (o.along === 'x') {   // flaps hinged on the opening's long (x) edges, folding up toward and away from you
    for (const [hz, w, s] of [[o.z0, zm - o.z0, 1], [o.z1, o.z1 - zm, -1]]) {
      const pivot = add(new THREE.Group());
      pivot.position.set(xm, SURFACE + 0.02, hz);
      pivot.add(solid(new THREE.BoxGeometry(o.x1 - o.x0, T, w), mat, 0, -T / 2, s * w / 2));
      flaps.push({ pivot, s, axis: 'x' });
    }
  } else
    for (const [hx, w, s] of [[o.x0, xm - o.x0, 1], [o.x1, o.x1 - xm, -1]]) {
      const pivot = add(new THREE.Group());
      pivot.position.set(hx, SURFACE + 0.02, zm);
      pivot.add(solid(new THREE.BoxGeometry(w, T, o.z1 - o.z0), mat, s * w / 2, -T / 2, 0));
      flaps.push({ pivot, s, axis: 'z' });
    }
  const set = a => flaps.forEach(f => { if (f.axis === 'x') f.pivot.rotation.x = -f.s * a; else f.pivot.rotation.z = f.s * a; });
  return { open: () => tween(0.9, u => set(2.5 * u)), close: () => tween(0.9, u => set(2.5 * (1 - u))) };
}
function stripes(colorA, colorB) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = colorA; g.fillRect(0, 0, 64, 64); g.fillStyle = colorB;
  for (let x = 0; x < 64; x += 16) g.fillRect(x, 0, 7, 64);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 1); return t;
}
function face(group, y, z, happy) {   // two eyes and a mouth on the top of an organ
  const ink = clay(0x2b2540, 0.6);
  for (const x of [-0.28, 0.28]) { const e = solid(new THREE.SphereGeometry(0.1, 12, 8), ink, x, y, z); e.scale.y = happy ? 1 : 0.35; group.add(e); }
  const mouth = solid(new THREE.TorusGeometry(0.15, 0.04, 8, 16, Math.PI), ink, 0, y, z + 0.28);
  mouth.rotation.x = happy ? Math.PI / 2 : -Math.PI / 2;   // arc bulging toward the player = a smile from where they stand
  group.add(mouth);
}
function heart(color, happy) {   // chunky cartoon heart lying face up, point toward the feet
  const s = new THREE.Shape();
  s.moveTo(0, -0.9); s.bezierCurveTo(-1.6, 0.0, -0.9, 1.1, 0, 0.45); s.bezierCurveTo(0.9, 1.1, 1.6, 0.0, 0, -0.9);
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.4, bevelEnabled: true, bevelThickness: 0.25, bevelSize: 0.18, bevelSegments: 6, curveSegments: 24 });
  geo.center();
  const g = new THREE.Group(), m = solid(geo, clay(color, 0.35));
  m.rotation.x = -Math.PI / 2; g.add(m);
  face(g, 0.47, -0.15, happy);
  g.scale.setScalar(0.8);
  return g;
}
// the heart beats with the monitor (pt.beatPhase), and stops on bypass or if the patient is lost
function beat(g, base = 0.8) {
  OR.onFrame(() => {
    const pt = OR.pt, on = !pt.lost && !pt.bypass && !g.userData.stopped;
    const k = on ? Math.exp(-(((pt.beatPhase - 0.31 + 1) % 1) ** 2) / 0.004) : 0;
    g.userData.squish = (g.userData.squish || 0) * 0.85;   // a squeeze from the pump step
    g.scale.setScalar(base * (1 + 0.12 * k) * (1 - 0.25 * g.userData.squish));
  });
}
function tray() {
  const t = add(new THREE.Group());
  t.add(solid(new THREE.BoxGeometry(2, 0.18, 2.6), steel, 0, 0, 0));
  for (const [x, z, w, d] of [[0, -1.25, 2, 0.12], [0, 1.25, 2, 0.12], [-0.95, 0, 0.12, 2.6], [0.95, 0, 0.12, 2.6]]) t.add(solid(new THREE.BoxGeometry(w, 0.3, d), steel, x, 0.15, z));
  t.position.set(4.7, SURFACE + 0.1, 2.6);
  return t;
}
function flyTo(obj, dest, done) {   // hop an organ over to a spot in an arc
  const from = obj.position.clone();
  tween(0.8, u => { obj.position.lerpVectors(from, dest, u); obj.position.y += Math.sin(u * Math.PI) * 2.2; obj.rotation.y = u * Math.PI * 2; }, done);
}
function bandage(x, z, len, along) {   // a cheerful bandage over the closed incision
  const b = add(solid(new THREE.BoxGeometry(along === 'z' ? 1.1 : len, 0.12, along === 'z' ? len : 1.1), clay(0xffd6a5, 0.7), x, SURFACE + 0.09, z));
  const pad = add(solid(new THREE.BoxGeometry(along === 'z' ? 0.6 : len * 0.6, 0.14, along === 'z' ? len * 0.6 : 0.6), clay(0xffffff, 0.6), x, SURFACE + 0.1, z));
  b.scale.setScalar(0.01); pad.scale.setScalar(0.01);
  tween(0.5, u => { b.scale.setScalar(u); pad.scale.setScalar(u); });
}

// --- mechanics: each returns a step { name, tool, band?, init(), tick() -> done?, hint(), result() -> {detail, points}, after() } ---
const POINTS = 150;   // per step

function cutStep(o) {   // trace o.line (xz) where the blade enters the skin, tip between o.band heights, from its first point
  let progress = 0, devs = [], deep = 0, off = 0, offRun = 0, last = null;
  const groove = [];   // the cut marks, cleared when the skin opens
  return {
    name: o.name, spec: o, tool: o.tool || 'scalpel', band: o.band, aimY: o.markY ?? SURFACE,
    init() {
      if (o.dots !== false) groove.push(dotsAt(o.line, o.markY ?? SURFACE + 0.03, 0x7e57c2));
      const s = solid(new THREE.SphereGeometry(0.28, 20, 12), clay(0x2ecc71, 0.5), o.line[0][0], (o.markY ?? SURFACE + 0.03) + 0.02, o.line[0][2]);
      s.scale.y = 0.35; this.start = add(wobble(s, 0.12, 4));
    },
    tick() {
      const tip = OR.tip, c = OR.cut;
      if (tip[1] > o.band[1]) { offRun = 0; return false; }
      const { d, s } = distToPolyline(c, o.line, true);
      if (tip[1] < o.band[0]) {
        OR.pt.bleed = Math.max(OR.pt.bleed, o.deepBleed ?? 25);
        if (deep++ % 25 === 0) { OR.say(o.deepMsg || 'TOO DEEP!', 'bad'); OR.alarm(); OR.ouch(); OR.emit(o.deepEvent || 'too_deep'); }
      }
      offRun = d > 0.5 ? offRun + 1 : 0;
      if (d > 0.5) { if (offRun >= 3 && off++ % 30 === 0) { OR.say('Stay on the line', 'bad'); OR.emit('off_line'); } return false; }   // a stray sample is forgiven
      if (progress === 0 && s > 0.08) { OR.say('Start at the green dot', 'info'); OR.emit('start_at_dot'); return false; }
      if (s >= progress - 0.03 && s <= progress + 0.12) {
        progress = Math.max(progress, s); devs.push(d);
        if (o.groove !== false) for (const p of OR.grooveFill(last, c)) { last = p; groove.push(add(OR.cutBlob(p))); }
      }
      return progress > 0.95;
    },
    hint: () => `${Math.round(progress * 100)}% cut`,
    result() {
      const dev = devs.length ? 10 * devs.reduce((a, b) => a + b, 0) / devs.length : 10;
      return { detail: `${dev.toFixed(1)} mm off the line`, points: Math.max(0, POINTS * clamp01(1 - dev / 4) - Math.min(100, deep * SAMPLE_DT * 40)) };
    },
    after() {
      OR.group.remove(this.start);
      if (o.opens) setTimeout(() => groove.forEach(g => OR.group.remove(g)), 250);   // the skin parts along the cut
      if (o.after) o.after();
    },
  };
}

function sawStep(o) {   // saw back and forth along o.line inside o.band until o.need cm of strokes
  let travel = 0, lastS = null, nicks = 0, gap = 0, crack = 0;
  const len = o.line.slice(1).reduce((a, p, i) => a + xzDist(p, o.line[i]), 0);
  return {
    name: o.name, spec: o, tool: 'saw', band: o.band, aimY: o.markY,
    init() { dotsAt(o.line, o.markY, 0xff9f43); },
    tick() {
      const tip = OR.tip, c = OR.cut, { d, s } = distToPolyline(c, o.line, true);
      if (tip[1] < o.band[0] - 0.1) {
        OR.pt.bleed = Math.max(OR.pt.bleed, 70);
        if (gap <= 0) { nicks++; gap = 20; OR.say(o.deepMsg || 'Too deep!', 'bad'); OR.alarm(); OR.ouch(); OR.emit('saw_nick'); }
      } else if (tip[1] < o.band[0] + 0.05) OR.emit('saw_deep_warning');
      gap--;
      if (tip[1] > o.band[1] || d > 0.6) { lastS = null; return false; }
      if (lastS !== null) travel += Math.abs(s - lastS) * len;
      lastS = s;
      if (OR.sample % 2 === 0) { spark([c[0], o.markY + 0.05, c[2]], 0xfffbe8); OR.tone(rand(130, 190), 60, 'sawtooth', 0.04); }
      OR.emit('sawing', { pct: Math.round(100 * clamp01(travel / o.need)) });
      const f = clamp01(travel / o.need);   // the crack grows along the bone with progress
      while (crack < f * o.line.length - 1) {
        const p = o.line[Math.floor(crack++)];
        const c = add(new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), clay(0x6b4a3a, 0.7)));
        c.scale.y = 0.4; c.position.set(p[0], o.markY + 0.02, p[2]);
      }
      return travel >= o.need;
    },
    hint: () => `${Math.round(100 * clamp01(travel / o.need))}% sawn · saw back and forth along the line`,
    result: () => ({ detail: nicks ? `${nicks} nick${nicks > 1 ? 's' : ''}` : 'clean', points: Math.max(0, POINTS - 50 * nicks) }),
    after: o.after,
  };
}

function dragStep(o) {   // o.handles: [{ obj, from:[x,z], to:[x,z] }] pulled in order with the tip dipped into the knob
  // o.y: height of the thing being pulled (default: just under the skin); o.tool (default retractor)
  let k = 0, grabbed = false, u = 0, drops = 0, knob = null, start = null;
  const y = o.y ?? SURFACE;
  const setup = () => {
    const h = o.handles[k];
    start = h.obj.position.clone();
    if (knob) OR.group.remove(knob);
    knob = add(wobble(solid(new THREE.SphereGeometry(0.3, 20, 14), clay(0x5bd68a, 0.4, { emissive: 0x5bd68a, emissiveIntensity: 0.3 }), h.from[0], y - 0.15, h.from[1]), 0.1, 6));
    knob.userData.from = h.from;
  };
  return {
    name: o.name, spec: o, tool: o.tool || 'retractor',
    init: setup,
    tick() {
      const tip = OR.tip, h = o.handles[k], d = [h.to[0] - h.from[0], h.to[1] - h.from[1]];
      if (!grabbed) {
        const dk = Math.hypot(tip[0] - knob.position.x, tip[2] - knob.position.z);
        OR.setTarget(dk, 'handle');
        if (tip[1] < y - 0.05 && dk < 0.7) { grabbed = true; OR.tone(520, 80); OR.say('Hooked: now pull outward', 'info', 20); OR.emit('hooked'); }
        return false;
      }
      if (tip[1] > y + 0.5) { grabbed = false; drops++; OR.say('Keep it down while you pull', 'bad'); OR.emit('drag_drop'); return false; }
      u = Math.max(u, clamp01(((tip[0] - h.from[0]) * d[0] + (tip[2] - h.from[1]) * d[1]) / (d[0] * d[0] + d[1] * d[1])));
      h.obj.position.set(start.x + d[0] * u, start.y, start.z + d[1] * u);
      knob.position.set(h.from[0] + d[0] * u, y - 0.15, h.from[1] + d[1] * u);
      if (u < 0.9) return false;
      h.obj.position.set(start.x + d[0], start.y, start.z + d[1]);
      OR.tone(700, 90); k++; grabbed = false; u = 0;
      if (k >= o.handles.length) { OR.group.remove(knob); return true; }
      setup(); return false;
    },
    hint: () => `side ${k + 1}/${o.handles.length}: ${grabbed ? `pull ${Math.round(u * 100)}%` : 'dip into the green knob'}`,
    result: () => ({ detail: drops ? `let go ${drops}×` : 'smooth', points: Math.max(0, POINTS - 30 * drops) }),
    after: o.after,
  };
}

function holdStep(o) {   // hold the tip within o.radius of each point for o.sec, in order; o.make(p) leaves something there
  let k = 0, held = 0, mark = null, still = [];
  const tremors = [], r = o.radius || 0.4, sec = o.sec || 1.2;
  const place = () => { if (mark) OR.group.remove(mark); mark = k < o.points.length ? ring(o.points[k], o.color || 0x6fd6ff) : null; };
  return {
    name: o.name, spec: o, tool: o.tool,
    init: place,
    tick() {
      const d = M.norm(M.sub(OR.tip, o.points[k]));
      OR.setTarget(Math.max(0, d - r * 0.5), o.what || 'point');
      if (d < r) {
        if (held === 0) OR.emit('hold_start', { secs: sec, what: o.what });
        held += SAMPLE_DT;
        if (held > 0.3) still.push(OR.tip.slice());   // steadiness only counts once settled on the point
        if (held >= sec) {
          if (still.length > 4) {   // rms wobble about the average, in mm
            const m = M.mean3(still);
            tremors.push(10 * Math.sqrt(still.reduce((a, p) => a + M.dot(M.sub(p, m), M.sub(p, m)), 0) / still.length));
          }
          if (o.make) add(o.make(o.points[k]));
          OR.tone(820, 90); held = 0; still = []; k++; place();
          if (k < o.points.length) OR.emit('hold_done', { what: o.what, k, n: o.points.length });
          return k >= o.points.length;
        }
      } else { if (held > 0.4) OR.emit('lost_position'); held = 0; still = []; }
      return false;
    },
    hint: () => `${o.what || 'point'} ${Math.min(k + 1, o.points.length)}/${o.points.length}: ${held > 0 ? `hold still… ${(sec - held).toFixed(1)} s` : 'hold the tip still on the ring'}`,
    result() {
      const tr = tremors.length ? tremors.reduce((a, b) => a + b, 0) / tremors.length : 2;
      return { detail: `tremor ${tr.toFixed(2)} mm`, points: POINTS * clamp01(1 - (tr - 0.3) / 2.2) };
    },
    after: o.after,
  };
}

function grabStep(o) {   // grab o.obj (dip into it and hold), then lift it out (o.lift) or set it down at o.place
  let phase = 'reach', held = 0, t0 = OR.sample, mark = null;
  return {
    name: o.name, spec: o, tool: 'forceps',
    init() { t0 = OR.sample; mark = ring([o.obj.position.x, o.obj.position.y + 0.5, o.obj.position.z], 0x9b8cff); },
    tick() {
      const tip = OR.tip, p = o.obj.position;
      if (phase === 'reach') {
        OR.setTarget(Math.max(0, M.norm(M.sub(tip, [p.x, p.y, p.z])) - (o.radius || 0.7) * 0.5), o.what);
        if (M.norm(M.sub(tip, [p.x, p.y, p.z])) < (o.radius || 0.7)) {
          held += SAMPLE_DT;
          if (held >= 0.5) { phase = 'carry'; OR.group.remove(mark); mark = o.place ? ring(o.place, 0x5bd68a) : null; OR.tone(600, 80); OR.say('Got it!', 'good', 15); OR.emit('grabbed', { what: o.what, lift: !!o.lift }); if (o.onGrab) o.onGrab(); }
        } else held = 0;
        return false;
      }
      p.lerp(V3(tip[0], tip[1] - 0.15, tip[2]), 0.5);   // follows the forceps
      if (o.lift) return tip[1] > SURFACE + 1.0;
      OR.setTarget(Math.max(0, M.norm(M.sub(tip, o.place)) - 0.3), 'placement');
      if (M.norm(M.sub(tip, o.place)) < 0.6) { held += SAMPLE_DT; if (held >= 1.0) { p.set(...o.place); if (mark) OR.group.remove(mark); return true; } }
      else held = 0;
      return false;
    },
    hint: () => phase === 'reach' ? `dip into the ${o.what} and hold` : o.lift ? 'lift it out (raise the instrument)' : `carry it to the green ring and hold`,
    result: () => { const s = (OR.sample - t0) * SAMPLE_DT; return { detail: `${s.toFixed(1)} s`, points: POINTS * clamp01(1 - (s - 4) / 20) }; },
    after: o.after,
  };
}

function pumpStep(o) {   // press down and up over o.at in a steady rhythm (about 100 a minute) until o.need good pumps
  // (also hammer taps: o.tool, o.rhythm [shortest, longest] seconds between strokes, o.noun, o.y of the ring)
  const [fast, slow] = o.rhythm || [0.35, 0.85], noun = o.noun || 'pumps';
  // strokes are relative (a drop from the highest point, then a rise from the lowest): at pumping speed the tracking's
  // smoothing shrinks a ~1 cm stroke to ~3-4 mm, so a 2 mm drop / 1.5 mm rise counts (resting jitter is ~0.5 mm)
  let down = false, good = 0, lastT = null, total = 0, hi = -Infinity, lo = Infinity;
  return {
    name: o.name, spec: o, tool: o.tool || 'hands',
    init() { this.mark = ring([o.at[0], o.y ?? SURFACE, o.at[1]], 0xff7a8a); },
    tick() {
      const tip = OR.tip;
      if (Math.hypot(tip[0] - o.at[0], tip[2] - o.at[1]) > 1.4) { hi = -Infinity; lo = Infinity; return false; }
      hi = Math.max(hi, tip[1]); lo = Math.min(lo, tip[1]);
      if (!down && tip[1] < hi - 0.2 && tip[1] < SURFACE) {
        down = true; lo = tip[1]; total++; if (o.onPump) o.onPump(); OR.tone(o.thud || 95, 140, 'sine', 0.25);
        if (lastT !== null) {
          const iv = (OR.sample - lastT) * SAMPLE_DT, ok = iv > fast && iv < slow;
          if (ok) good++;
          OR.say(ok ? `${good} / ${o.need}` : iv <= fast ? 'slower!' : 'faster!', ok ? 'good' : 'info', 10);
          OR.emit('pump', { ok, dir: ok ? 'good' : iv <= fast ? 'slower' : 'faster', good, need: o.need, noun });
        }
        lastT = OR.sample;
      }
      if (down && tip[1] > lo + 0.15) { down = false; hi = tip[1]; }
      if (good >= o.need) { OR.group.remove(this.mark); return true; }
      return false;
    },
    hint: () => `${good}/${o.need} good ${noun} · ${o.how || 'push down and lift, about 100 a minute'}`,
    result: () => ({ detail: `${good} of ${total} on the beat`, points: POINTS * clamp01(good / Math.max(total - 1, 1)) }),
    after: o.after,
  };
}

function stitchStep(o) {   // dip the needle into each zig-zag point in order (lift between stitches); thread joins them
  let k = 0, up = true, prev = null, mark = null, t0 = OR.sample;
  const tmat = clay(0x7e57c2, 0.45);
  const y = o.y ?? SURFACE;   // the layer being sewn (skin by default)
  const place = () => { if (mark) OR.group.remove(mark); mark = k < o.points.length ? ring([o.points[k][0], y + 0.05, o.points[k][1]], 0xff7aa8) : null; };
  return {
    name: o.name, spec: o, tool: 'needle', aim: true, aimY: o.y,
    init() { t0 = OR.sample; if (o.before) o.before(); place(); },
    tick() {
      const tip = OR.tip, c = OR.cut, p = o.points[k], dp = Math.hypot(c[0] - p[0], c[2] - p[1]);   // where the needle meets the skin
      OR.setTarget(dp, 'stitch point');
      if (tip[1] > y + 0.15) up = true;
      if (up && tip[1] < y && dp < 0.45) {   // touching the layer is enough
        const here = V3(p[0], y + 0.07, p[1]);
        if (prev) add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(prev, here), 4, 0.045, 8), tmat));
        add(solid(new THREE.SphereGeometry(0.08, 10, 8), tmat, here.x, here.y, here.z));
        prev = here; up = false; k++; OR.tone(900, 60); place();
        OR.emit('stitch', { k, n: o.points.length });
        return k >= o.points.length;
      }
      return false;
    },
    hint: () => `stitch ${Math.min(k + 1, o.points.length)}/${o.points.length}: dip into the pink ring, lift, next`,
    result: () => { const s = (OR.sample - t0) * SAMPLE_DT; return { detail: `${s.toFixed(1)} s`, points: POINTS * clamp01(1 - (s - 8) / 30) }; },
    after: o.after,
  };
}

function clearStep(o) {   // clear every item by touching it with the tip: suck up blood pools, or tease away fat
  // o.items: [{ p: [x,y,z], r, mesh }]; o.kind 'suction' (pools shrink while you hover in them) or 'dissect' (each
  // blob pops off at a touch); o.refill: pools slowly come back while something still bleeds (drama, not a reset)
  const items = o.items.map(it => ({ ...it, amount: 1, cleared: false, base: it.mesh.scale.clone() }));
  let t0 = OR.sample, half = false, active = 0;
  const show = it => { const a = Math.max(0.02, it.amount); it.mesh.scale.set(it.base.x * a, it.base.y * Math.max(0.3, a), it.base.z * a); it.mesh.visible = it.amount > 0.03; };
  return {
    name: o.name, spec: o, tool: o.tool || (o.kind === 'suction' ? 'suction' : 'dissector'),
    init() { t0 = OR.sample; },
    tick() {
      const tip = OR.tip;
      let nearest = Infinity;
      for (const it of items) {
        const d = M.norm(M.sub(tip, it.p));
        if (!it.cleared) nearest = Math.min(nearest, d);
        if (d < it.r + 0.15 && it.amount > 0) {
          if (o.kind === 'suction') { it.amount -= SAMPLE_DT / (o.secs || 0.9); if (active++ % 3 === 0) OR.tone(rand(170, 230), 70, 'sawtooth', 0.03); }
          else { it.amount = 0; OR.tone(rand(800, 1000), 50, 'sine', 0.06); spark(it.p, 0xfff1b8); }
          if (it.amount <= 0.05 && !it.cleared) { it.cleared = true; it.amount = 0; }
        } else if (o.refill && it.amount < 0.4) it.amount += o.refill * SAMPLE_DT;
        show(it);
      }
      if (nearest < Infinity) OR.setTarget(nearest, o.what || (o.kind === 'suction' ? 'blood' : 'fat'));
      const n = items.filter(it => it.cleared).length;
      if (!half && n >= items.length / 2) { half = true; OR.emit('halfway'); }
      return n >= items.length;
    },
    hint: () => `${items.filter(it => it.cleared).length}/${items.length} ${o.noun || (o.kind === 'suction' ? 'pools cleared' : 'cleared')} · ${o.how || 'dip the tip into each one'}`,
    result: () => { const s = (OR.sample - t0) * SAMPLE_DT; return { detail: `${s.toFixed(1)} s`, points: POINTS * clamp01(1 - (s - (o.par || 8)) / 25) }; },
    after: o.after,
  };
}

function reamStep(o) {   // circle the tip around o.at (x, z) inside the socket, at depth, for o.turns turns
  // o.band [floor, top]: below the floor goes through the bone; o.onProgress(f) grows the socket
  let total = 0, last = null, deep = 0, gap = 0, t0 = OR.sample;
  const need = 2 * Math.PI * (o.turns || 4);
  return {
    name: o.name, spec: o, tool: 'reamer', band: o.band, aimY: o.band[1],
    init() { t0 = OR.sample; this.mark = ring([o.at[0], o.band[1] + 0.05, o.at[1]], 0xffc24d); },
    tick() {
      const tip = OR.tip, dx = tip[0] - o.at[0], dz = tip[2] - o.at[1], r = Math.hypot(dx, dz);
      OR.setTarget(Math.max(0, r - 0.6), 'socket');
      if (tip[1] < o.band[0]) {
        OR.pt.bleed = Math.max(OR.pt.bleed, 35);
        if (gap <= 0) { deep++; gap = 20; OR.say(o.deepMsg || 'Too deep!', 'bad'); OR.alarm(); OR.ouch(); OR.emit(o.deepEvent || 'too_deep'); }
      }
      gap--;
      if (tip[1] > o.band[1] || r > 0.95 || r < 0.08) { last = null; return false; }
      const a = Math.atan2(dz, dx);
      if (last !== null) { let d = a - last; d = Math.atan2(Math.sin(d), Math.cos(d)); if (Math.abs(d) < 1.2) total += Math.abs(d); }
      last = a;
      if (OR.sample % 2 === 0) { spark([tip[0], o.band[1], tip[2]], 0xf5efe0); OR.tone(rand(110, 150), 60, 'square', 0.03); }
      const f = clamp01(total / need);
      if (o.onProgress) o.onProgress(f);
      OR.emit('reaming', { pct: Math.round(100 * f) });
      if (f >= 1) { OR.group.remove(this.mark); return true; }
      return false;
    },
    hint: () => `${Math.round(100 * clamp01(total / need))}% reamed · small circles inside the socket`,
    result: () => { const s = (OR.sample - t0) * SAMPLE_DT; return { detail: deep ? `${deep} too deep` : `${s.toFixed(1)} s, clean`, points: Math.max(0, POINTS * clamp01(1 - (s - 10) / 30) - 50 * deep) }; },
    after: o.after,
  };
}

// --- operation wrapper: runs the steps in order; plugs into surgery.js's procedure flow ---
function operation(def) {
  OR.register({
    id: def.id, title: def.title, limit: def.limit, op: true, tool: 'scalpel',
    objective: def.blurb + ' Steps: ' + def.stepNames.map((n, i) => `${i + 1}. ${n}`).join(' · '),
    get band() { const s = this.steps && this.steps[this.si]; return (s && s.band) || null; },
    get aim() { const s = this.steps && this.steps[this.si]; return !!(s && s.aim); },
    get aimY() { const s = this.steps && this.steps[this.si]; return s ? s.aimY : null; },
    setup() {
      particles.length = 0;
      OR.onFrame(updateParticles);
      this.steps = def.build(); this.si = -1; this.done = [];
      // structures to stay away from: touching one injures the patient (and Riley warns as you get close)
      this.hazards = (this.steps.hazards || []).map(h => ({ ...h, hits: 0, inside: false }));
      this.next();
    },
    next() {
      this.si++;
      const s = this.steps[this.si];
      if (!s) return;
      s.t0 = OR.sample; OR.setTool(s.tool);
      if (s.init) s.init();
      OR.emit('step_start', { name: s.name, index: this.si, total: this.steps.length, tool: s.tool, op: def.id });
      if (this.si > 0) OR.say(`Step ${this.si + 1}: ${s.name}`, 'info', 35);
    },
    tick() {
      const s = this.steps[this.si];
      if (!s) return 'done';
      if (def.onTick) def.onTick(s.name);
      for (const h of this.hazards) {
        if (h.steps && !h.steps.includes(s.name)) continue;
        const d = distToPolyline(OR.tip, typeof h.line === 'function' ? h.line() : h.line).d;
        if (d < h.r) {
          if (!h.inside) {
            h.inside = true; h.hits++;
            OR.pt.bleed = Math.max(OR.pt.bleed, h.bleed ?? 30); OR.pt.stress += h.stress ?? 10;
            OR.say(h.msg || `You hit the ${h.what}!`, 'bad', 40); OR.alarm(); OR.ouch();
            OR.emit('hazard_hit', { what: h.what });
            OR.logEvent({ event: 'or_hazard', op: def.id, step: s.name, what: h.what });
          }
        } else { h.inside = false; if (d < h.r + (h.near ?? 0.35)) OR.emit('near_hazard', { what: h.what }); }
      }
      const fin = s.tick();
      OR.setObjective(`Step ${this.si + 1}/${this.steps.length} · ${s.name} · ${s.hint()}`);
      if (!fin) return null;
      const r = s.result();
      this.done.push({ name: s.name, ...r });
      OR.logEvent({ event: 'or_step', op: def.id, step: s.name, detail: r.detail, points: Math.round(r.points), secs: (OR.sample - s.t0) * SAMPLE_DT });
      if (s.after) s.after();
      OR.chime();
      if (this.si + 1 < this.steps.length) OR.emit('step_done', { name: s.name });
      this.next();
      return this.si >= this.steps.length ? 'done' : null;
    },
    score(t) {
      const max = this.steps.length * POINTS + POINTS, k = 1000 / max;   // scaled to the same 0..1000 as the training drills
      const rows = this.done.map(d => [d.name, d.detail, d.points * k]);
      rows.push(['Steps completed', `${this.done.length}/${this.steps.length}`, 0]);
      const hits = this.hazards.reduce((a, h) => a + h.hits, 0);
      if (this.hazards.length) rows.push(['Structures injured', hits ? this.hazards.filter(h => h.hits).map(h => `${h.what} ×${h.hits}`).join(', ') : 'none', -POINTS * 0.6 * k * hits]);
      rows.push(['Time', `${t.toFixed(0)} s (par ${def.par} s)`, POINTS * k * clamp01(1 - (t - def.par) / def.par)]);
      return { rows, stats: { t, steps: this.done.length } };
    },
  });
}

// --- Operation 1: appendectomy ---
// Real outline: incision over the lower right abdomen, spread the muscle layers, find the appendix, tie it off at the
// base, cut it free, remove it, close the layers. (The patient's right is the player's left, looking from the feet.)
operation({
  id: 'appendectomy', title: 'Appendectomy', limit: 300, par: 120,
  blurb: 'The appendix is inflamed and has to come out.',
  stepNames: ['Incision', 'Spread the muscle', 'Clamp the appendix', 'Snip it free', 'Remove it', 'Stitch up'],
  build() {
    const open = { x0: -2.3, x1: -0.5, z0: 0.4, z1: 4.4 }, xm = -1.4;
    const skin = makeSkin(open);
    // muscle: two striped curtains under the opening that slide apart under the surrounding skin
    const muscleMat = clay(0xffffff, 0.7, { map: stripes('#e0525e', '#c93d4c') });
    const curtains = [[open.x0, xm], [xm, open.x1]].map(([a, b]) => add(solid(new THREE.BoxGeometry(b - a, 0.18, open.z1 - open.z0), muscleMat, (a + b) / 2, SURFACE - 0.33, (open.z0 + open.z1) / 2)));
    // gut: soft pink loops, and the angry little appendix
    const gut = 0xffa3b8;
    for (const pts of [[[-3, 1.6, 0.2], [-1.8, 1.7, 0.6], [-0.4, 1.6, 0.4], [0.6, 1.7, 1.2]], [[-3, 1.65, 4.8], [-2.2, 1.7, 3.6], [-0.6, 1.65, 3.9], [0.4, 1.6, 2.6]], [[-2.8, 1.55, 2.2], [-2.1, 1.6, 1.6], [-0.9, 1.55, 2.0], [-0.2, 1.6, 1.6]]])
      add(tube(pts, 0.28, gut));
    const appendix = add(new THREE.Group());
    appendix.add(tube([[-0.15, 0, -0.9], [0, 0.05, 0], [0.15, 0.08, 0.9]], 0.2, 0xff7b54));
    face(appendix, 0.25, 0.75, false);
    appendix.position.set(-1.4, 1.72, 2.1);
    wobble(appendix, 0.04, 4);
    const stump = add(solid(new THREE.SphereGeometry(0.22, 16, 10), clay(0xff9a76, 0.5), -1.55, 1.72, 1.2));
    const clampMesh = p => { const g = new THREE.Group(); g.add(solid(new THREE.BoxGeometry(0.7, 0.12, 0.14), steel, 0, 0, 0), solid(new THREE.TorusGeometry(0.14, 0.04, 8, 16), clay(0x6fd6ff, 0.4), 0.42, 0, 0)); g.position.set(...p); g.position.y += 0.18; return g; };
    tray();
    const cuts = curvePts([[xm, SURFACE, 4.1], [xm, SURFACE, 0.7]], 60);
    return [
      cutStep({ name: 'Incision', line: cuts, band: [SURFACE - 0.7, SURFACE - 0.2], opens: true, after: () => skin.open() }),
      dragStep({ name: 'Spread the muscle', handles: [
        { obj: curtains[0], from: [xm - 0.25, 2.4], to: [xm - 1.25, 2.4] },
        { obj: curtains[1], from: [xm + 0.25, 2.4], to: [xm + 1.25, 2.4] }] }),
      holdStep({ name: 'Clamp the appendix', tool: 'clamp', what: 'clamp', points: [[-1.52, 1.78, 1.45], [-1.47, 1.8, 1.85]], make: clampMesh }),
      cutStep({ name: 'Snip it free', line: curvePts([[-1.95, 1.75, 1.65], [-0.95, 1.75, 1.65]], 30), band: [1.35, 2.15], markY: 2.0, groove: false,
        deepMsg: 'Careful: that\'s the gut!', deepBleed: 40, deepEvent: 'gut_nick' }),
      grabStep({ name: 'Remove it', obj: appendix, what: 'appendix', lift: true, after: () => flyTo(appendix, V3(4.7, SURFACE + 0.45, 2.6)) }),
      stitchStep({ name: 'Stitch up',
        before: () => { curtains.forEach((c, i) => { const x0 = c.position.x, x1 = i ? (xm + open.x1) / 2 : (open.x0 + xm) / 2; tween(0.6, u => { c.position.x = x0 + (x1 - x0) * u; }); }); skin.close(); },
        points: [[xm - 0.35, 3.9], [xm + 0.35, 3.3], [xm - 0.35, 2.7], [xm + 0.35, 2.1], [xm - 0.35, 1.5], [xm + 0.35, 0.9]],
        after: () => { OR.group.remove(stump); setTimeout(() => bandage(xm, 2.4, 3.8, 'z'), 300); } }),
    ];
  },
});

// --- Operation 2: heart transplant ---
// Real outline: midline chest incision, saw through the breastbone (sternotomy), spread the ribs, put the patient on
// a heart-lung bypass machine and clamp the great vessels, take out the failing heart, sew in the donor heart,
// restart it, close the chest.
operation({
  id: 'heart', title: 'Heart transplant', limit: 480, par: 220,
  blurb: 'This tired old heart needs replacing with a donor heart.',
  stepNames: ['Incision', 'Saw the breastbone', 'Spread the ribs', 'Clamp the vessels', 'Remove the old heart', 'Place the new heart', 'Connect the vessels', 'Restart the heart', 'Stitch up'],
  build() {
    const open = { x0: -1.6, x1: 1.6, z0: -4.4, z1: 3.4 };   // wide enough that the spread rib edges stay in view
    const skin = makeSkin(open);
    const bone = clay(0xf5efe0, 0.6), lung = 0xffb3c6;
    // breastbone in two halves, each carrying its ribs, so retracting spreads the chest open
    const halves = [-1, 1].map(s => {
      const h = add(new THREE.Group());
      h.add(solid(new THREE.BoxGeometry(0.45, 0.3, 7.8), bone, s * 0.225, SURFACE - 0.42, -0.5));
      for (const z of [-3.6, -2.3, -1.0, 0.3, 1.6, 2.9]) h.add(tube([[s * 0.4, SURFACE - 0.42, z], [s * 1.8, SURFACE - 0.55, z + 0.15], [s * 3.2, SURFACE - 1.0, z + 0.4]], 0.17, 0xf5efe0));
      return h;
    });
    for (const s of [-1, 1]) {
      const l = solid(new THREE.SphereGeometry(1, 24, 16), clay(lung, 0.5), s * 1.7, 1.35, -1.0);
      l.scale.set(1.0, 0.55, 1.9);
      add(wobble(l, 0.03, 1.5));   // gentle breathing
    }
    const oldHeart = add(heart(0xb5546a, false));
    oldHeart.position.set(0, 1.45, -0.6);
    beat(oldHeart);
    const vessels = [tube([[0.25, 1.55, -1.3], [0.35, 1.8, -2.2], [0.1, 1.85, -3.4]], 0.24, 0xff4d6d), tube([[-0.3, 1.5, -1.3], [-0.45, 1.75, -2.0], [-0.55, 1.8, -3.3]], 0.22, 0x6f8cff)];
    vessels.forEach(add);
    // the donor heart waits in a cooler at the bottom right
    const cooler = add(new THREE.Group());
    cooler.add(solid(new THREE.BoxGeometry(1.5, 0.6, 1.3), clay(0xffffff, 0.6), 0, 0, 0), solid(new THREE.BoxGeometry(1.6, 0.14, 1.4), clay(0x3fa7ff, 0.5), 0, 0.36, 0));
    cooler.position.set(2.3, SURFACE + 0.3, 4.2);
    const newHeart = add(heart(0xff4d6d, true));
    newHeart.position.set(2.3, SURFACE + 0.95, 4.2);
    newHeart.userData.stopped = true;
    beat(newHeart);
    const clampAt = [[0.35, 1.8, -2.2], [-0.45, 1.75, -2.0]];
    const clampMesh = p => { const g = new THREE.Group(); g.add(solid(new THREE.BoxGeometry(0.8, 0.12, 0.14), steel, 0, 0, 0), solid(new THREE.TorusGeometry(0.15, 0.04, 8, 16), clay(0x6fd6ff, 0.4), 0.48, 0, 0)); g.position.set(...p); g.position.y += 0.25; return g; };
    const knot = p => solid(new THREE.TorusGeometry(0.18, 0.06, 8, 16), clay(0x7e57c2, 0.45), p[0], p[1] + 0.22, p[2]);
    const clamps = [];
    tray();
    const line = curvePts([[0, SURFACE, 3.1], [0, SURFACE, -4.1]], 80);
    return [
      cutStep({ name: 'Incision', line, band: [SURFACE - 0.7, SURFACE - 0.2], opens: true, after: () => skin.open() }),
      sawStep({ name: 'Saw the breastbone', line, band: [SURFACE - 0.75, SURFACE - 0.25], need: 14, markY: SURFACE - 0.26,
        deepMsg: 'Easy: the heart is right under there!' }),
      dragStep({ name: 'Spread the ribs', handles: [
        { obj: halves[0], from: [-0.25, -0.5], to: [-1.15, -0.5] },
        { obj: halves[1], from: [0.25, -0.5], to: [1.15, -0.5] }] }),
      holdStep({ name: 'Clamp the vessels', tool: 'clamp', what: 'vessel', points: clampAt,
        make: p => { const c = clampMesh(p); clamps.push(c); return c; },
        after: () => { OR.pt.bypass = true; OR.say('On bypass: the heart is stopped', 'info', 40); OR.emit('bypass_on'); } }),
      grabStep({ name: 'Remove the old heart', obj: oldHeart, what: 'old heart', lift: true, radius: 0.9,
        after: () => flyTo(oldHeart, V3(4.7, SURFACE + 0.6, 2.6)) }),
      grabStep({ name: 'Place the new heart', obj: newHeart, what: 'new heart', place: [0, 1.45, -0.6], radius: 0.9 }),
      holdStep({ name: 'Connect the vessels', tool: 'needle', what: 'vessel', color: 0xff7aa8, points: clampAt, make: knot,
        after: () => clamps.forEach(c => OR.group.remove(c)) }),
      pumpStep({ name: 'Restart the heart', at: [0, -0.6], need: 8,
        onPump: () => { newHeart.userData.squish = 1; },
        after: () => { OR.pt.bypass = false; newHeart.userData.stopped = false; OR.say('It\'s beating!', 'good', 45); OR.emit('heart_restarted'); } }),
      stitchStep({ name: 'Stitch up',
        before: () => {
          halves.forEach(h => { const x0 = h.position.x; tween(0.7, u => { h.position.x = x0 * (1 - u); }); });
          setTimeout(() => skin.close(), 500);
        },
        points: [[-0.35, 2.7], [0.35, 1.8], [-0.35, 0.9], [0.35, 0.0], [-0.35, -0.9], [0.35, -1.8], [-0.35, -2.7], [0.35, -3.6]],
        after: () => setTimeout(() => bandage(0, -0.5, 7, 'z'), 300) }),
    ];
  },
});
// --- shared props for the operations below ---
const pool = (x, y, z, r) => { const m = add(solid(new THREE.SphereGeometry(1, 24, 12), clay(0xc8102e, 0.15), x, y, z)); m.scale.set(r, r * 0.2, r); return m; };
const clipMesh = p => { const g = new THREE.Group(); g.add(solid(new THREE.BoxGeometry(0.34, 0.07, 0.1), clay(0xd0d6e0, 0.25, { metalness: 0.7 }), 0, 0, 0)); g.position.set(p[0], p[1] + 0.1, p[2]); g.rotation.y = 0.7; return g; };
const clampAt = p => { const g = new THREE.Group(); g.add(solid(new THREE.BoxGeometry(0.75, 0.12, 0.14), steel, 0, 0, 0), solid(new THREE.TorusGeometry(0.14, 0.04, 8, 16), clay(0x6fd6ff, 0.4), 0.45, 0, 0)); g.position.set(p[0], p[1] + 0.2, p[2]); return g; };
const knotAt = p => solid(new THREE.TorusGeometry(0.16, 0.05, 8, 16), clay(0x7e57c2, 0.45), p[0], p[1] + 0.15, p[2]);
const cooler = (x, z) => { const c = add(new THREE.Group()); c.add(solid(new THREE.BoxGeometry(1.5, 0.6, 1.3), clay(0xffffff, 0.6), 0, 0, 0), solid(new THREE.BoxGeometry(1.6, 0.14, 1.4), clay(0x3fa7ff, 0.5), 0, 0.36, 0)); c.position.set(x, SURFACE + 0.3, z); return c; };
const curtainsUnder = (open, xm, mat) => [[open.x0, xm], [xm, open.x1]].map(([a, b]) => add(solid(new THREE.BoxGeometry(b - a, 0.18, open.z1 - open.z0), mat, (a + b) / 2, SURFACE - 0.33, (open.z0 + open.z1) / 2)));
const muscle = () => clay(0xffffff, 0.7, { map: stripes('#e0525e', '#c93d4c') });
const ring3 = (c, r, y) => [0, 1, 2].map(i => [c[0] + r * Math.cos(i * 2.1 + 0.5), y, c[1] + r * Math.sin(i * 2.1 + 0.5)]);   // three stitches around a join
const zig = (pts, w) => pts.map((p, i) => [p[0] + (i % 2 ? w : -w) * (p[2] || 0), p[1]]);

// --- Operation 3: laparoscopic gallbladder removal (cholecystectomy) ---
// Real outline: open a port at the navel, put in the ports and inflate the belly with gas, lift the gallbladder
// up over the liver, clear Calot's triangle until only two structures go to the gallbladder ("critical view of
// safety"), clip the cystic duct and artery, divide them, peel the gallbladder off the liver bed, bag it and take
// it out through the navel, close the ports. The classic disaster is cutting the common bile duct.
operation({
  id: 'gallbladder', title: 'Gallbladder removal (keyhole)', limit: 420, par: 200,
  blurb: 'Gallstones keep inflaming this gallbladder. Take it out through four small keyhole ports.',
  stepNames: ['Open the navel port', 'Place the ports', 'Lift the gallbladder', 'Clear the triangle', 'Clip the duct and artery', 'Divide them', 'Peel it off the liver', 'Bag it and take it out', 'Close the ports'],
  build() {
    const lapSkin = clay(BODY, 0.75, { transparent: true, opacity: 1 });
    makeSkin({ x0: -0.25, x1: 0.25, z0: 0.6, z1: 1.4, mat: lapSkin });
    const liver = add(solid(new THREE.SphereGeometry(1, 28, 16), clay(0x9c3b3b, 0.45), -1.6, 1.75, -2.6)); liver.scale.set(2.0, 0.42, 1.6);
    add(solid(new THREE.SphereGeometry(1, 24, 14), clay(0xffd1dc, 0.5), 1.3, 1.6, -2.5)).scale.set(1.1, 0.4, 0.9);   // stomach
    for (const pts of [[[-2.4, 1.5, 1.2], [-1, 1.55, 2.2], [0.6, 1.5, 1.4], [1.8, 1.55, 2.6]], [[-2.2, 1.45, 3.4], [-0.4, 1.5, 3.9], [1.2, 1.45, 3.2]]]) add(tube(pts, 0.28, 0xffa3b8));
    const gb = add(new THREE.Group());   // the gallbladder: a green pear hanging off the liver's edge, fundus toward the head
    const pear = solid(new THREE.SphereGeometry(0.55, 24, 16), clay(0x7cc46b, 0.35), 0, 0, 0); pear.scale.set(0.8, 0.55, 1.4); gb.add(pear);
    face(gb, 0.3, 0.3, false);
    gb.position.set(-1.25, 1.95, -1.15);
    wobble(gb, 0.03, 3);
    const duct = [[-0.95, 1.82, -0.3], [-0.6, 1.78, 0.1], [-0.3, 1.74, 0.45]], artery = [[-0.15, 1.86, -1.0], [-0.55, 1.86, -0.7], [-0.9, 1.88, -0.55]];
    add(tube(duct, 0.09, 0x9fd36b)); add(tube(artery, 0.07, 0xff4d6d));
    const cbd = [[-0.3, 1.72, -2.2], [-0.3, 1.74, 0.45], [-0.25, 1.7, 2.4]];   // common bile duct: don't touch
    add(tube(cbd, 0.13, 0xc9e265));
    // fat over Calot's triangle, teased away blob by blob
    const fat = [];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const p = [-0.95 + 0.27 * i, 1.98, -0.75 + 0.3 * j], m = add(solid(new THREE.SphereGeometry(0.19, 14, 10), clay(0xffe08a, 0.6), ...p));
      m.scale.y = 0.6; fat.push({ p, r: 0.2, mesh: m });
    }
    const ports = [[0, 1.0], [0.5, -3.6], [-1.7, -3.2], [-2.7, -1.0]];
    const portMesh = p => { const g = new THREE.Group(); g.add(solid(new THREE.CylinderGeometry(0.22, 0.22, 0.9, 18), clay(0x9be7ff, 0.35), 0, 0.45, 0), solid(new THREE.CylinderGeometry(0.4, 0.4, 0.25, 20), clay(0x2b2540, 0.5), 0, 0.95, 0)); g.position.set(p[0], SURFACE - 0.1, p[2]); return g; };
    const portObjs = [];
    const bag = add(solid(new THREE.SphereGeometry(0.35, 18, 12), clay(0xe6f7ff, 0.3, { transparent: true, opacity: 0.7 }), 0.9, SURFACE + 0.3, 3.6));
    tray();
    const clipPts = [[-0.8, 1.81, -0.12], [-0.6, 1.79, 0.08], [-0.42, 1.88, -0.82], [-0.7, 1.88, -0.62]];
    const steps = [
      cutStep({ name: 'Open the navel port', line: curvePts([[0, SURFACE, 1.35], [0, SURFACE, 0.65]], 20), band: [SURFACE - 0.7, SURFACE - 0.2] }),
      holdStep({ name: 'Place the ports', tool: 'trocar', what: 'port', points: ports.map(([x, z]) => [x, SURFACE - 0.1, z]), sec: 0.9,
        make: p => { const m = portMesh(p); portObjs.push(m); return m; },
        after: () => {   // gas in: the belly rises a little and the camera shows the inside
          tween(1.2, u => { lapSkin.opacity = 1 - 0.72 * u; });
          lapSkin.depthWrite = false;
          OR.say('Insufflated: camera in', 'info', 40); OR.emit('insufflated');
        } }),
      dragStep({ name: 'Lift the gallbladder', tool: 'forceps', y: 2.1, handles: [{ obj: gb, from: [-1.25, -1.7], to: [-1.3, -2.5] }] }),
      clearStep({ name: 'Clear the triangle', kind: 'dissect', items: fat, what: 'fat', noun: 'fat cleared', how: 'tease the yellow fat away; mind the bile duct', par: 10 }),
      holdStep({ name: 'Clip the duct and artery', tool: 'clipper', what: 'clip', points: clipPts, sec: 1.0, radius: 0.32, make: clipMesh }),
      cutStep({ name: 'Divide them', line: curvePts([[-0.48, 1.84, -1.0], [-0.72, 1.82, 0.12]], 20), band: [1.55, 2.05], markY: 1.95, groove: false,
        deepMsg: 'Too deep: that\'s the liver!', deepBleed: 35, deepEvent: 'liver_nick' }),
      cutStep({ name: 'Peel it off the liver', line: curvePts([[-0.95, 1.95, -1.6], [-1.3, 1.95, -2.3], [-1.75, 1.95, -2.75]], 30), band: [1.6, 2.1], markY: 2.02, groove: false,
        deepMsg: 'Into the liver: come up!', deepBleed: 40, deepEvent: 'liver_nick' }),
      grabStep({ name: 'Bag it and take it out', obj: gb, what: 'gallbladder', place: [0, SURFACE - 0.2, 1.0], radius: 0.8,
        onGrab: () => flyTo(bag, V3(-1.3, 2.1, -2.4)),
        after: () => { OR.group.remove(bag); flyTo(gb, V3(4.7, SURFACE + 0.45, 2.6)); } }),
      stitchStep({ name: 'Close the ports', points: ports,
        before: () => { tween(0.8, u => { lapSkin.opacity = 0.28 + 0.72 * u; }, () => { lapSkin.depthWrite = true; }); portObjs.forEach(m => OR.group.remove(m)); } }),
    ];
    steps.hazards = [{ what: 'common bile duct', line: cbd, r: 0.17, near: 0.3, bleed: 25, stress: 20, msg: 'BILE DUCT INJURY!',
      steps: ['Clear the triangle', 'Clip the duct and artery', 'Divide them', 'Peel it off the liver'] }];
    return steps;
  },
});

// --- Operation 4: caesarean section ---
// Real outline: low side-to-side (Pfannenstiel) skin incision, separate the rectus muscles, push the bladder down
// out of the way, a low transverse cut in the uterus, deliver the baby, clamp and cut the cord, deliver the
// placenta, close the uterus, close the skin.
operation({
  id: 'csection', title: 'Caesarean section', limit: 480, par: 240,
  blurb: 'Baby is breech and needs to be delivered by caesarean. Two patients now: mum and baby.',
  stepNames: ['Bikini-line incision', 'Separate the muscles', 'Move the bladder down', 'Open the uterus', 'Deliver the baby', 'Clamp the cord', 'Cut the cord', 'Deliver the placenta', 'Close the uterus', 'Close the skin'],
  build() {
    const open = { x0: -2.4, x1: 2.4, z0: 2.6, z1: 3.9, along: 'x' }, zm = 3.25;
    const skin = makeSkin(open);
    const curtains = [[open.x0, 0], [0, open.x1]].map(([a, b]) => add(solid(new THREE.BoxGeometry(b - a, 0.18, open.z1 - open.z0), muscle(), (a + b) / 2, SURFACE - 0.33, zm)));
    const uterus = add(solid(new THREE.SphereGeometry(1, 32, 20), clay(0xe86a7a, 0.45), 0, 1.15, 1.2)); uterus.scale.set(2.6, 1.0, 2.6);
    const bladder = add(solid(new THREE.SphereGeometry(0.45, 20, 14), clay(0xffd1a8, 0.45), 0, 2.0, 3.45)); bladder.scale.set(1.3, 0.55, 0.8);
    const slit = add(solid(new THREE.BoxGeometry(2.3, 0.05, 0.12), clay(0x7a0f22, 0.4), 0, 1.98, 2.95)); slit.visible = false;
    // the baby: a round, sleepy cartoon baby in a little blue hat
    const baby = add(new THREE.Group());
    const bodyM = solid(new THREE.SphereGeometry(0.62, 24, 16), clay(0xffc9a8, 0.6), 0, 0, 0); bodyM.scale.set(1, 0.8, 1.1);
    baby.add(bodyM, solid(new THREE.SphereGeometry(0.5, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), clay(0x9be7ff, 0.6), 0, 0.1, -0.35));
    face(baby, 0.45, 0.05, true);
    baby.position.set(0, 1.6, 2.4); baby.visible = false;
    const cordPts = () => [[0, 1.95, 2.95], [0.4, 2.35, 3.75], [0.1, SURFACE + 0.4, 4.85]];
    let cord = null;
    const placenta = add(solid(new THREE.SphereGeometry(0.6, 22, 14), clay(0x8f2338, 0.5), 0, 1.98, 2.75)); placenta.scale.set(1, 0.35, 0.9); placenta.visible = false;
    const warmer = add(new THREE.Group());
    warmer.add(solid(new THREE.BoxGeometry(1.6, 0.35, 1.2), clay(0xfff1b8, 0.5), 0, 0, 0), solid(new THREE.BoxGeometry(1.7, 0.12, 1.3), clay(0xffc24d, 0.5), 0, -0.2, 0));
    warmer.position.set(2.4, SURFACE + 0.25, -3.6);
    const cry = () => { [0, 380, 760, 1250].forEach((d, i) => setTimeout(() => { OR.tone(620 + 60 * (i % 2), 300, 'triangle', 0.07); setTimeout(() => OR.tone(540, 180, 'triangle', 0.06), 160); }, d)); };
    tray();
    const steps = [
      cutStep({ name: 'Bikini-line incision', line: curvePts([[-2.0, SURFACE, 3.05], [0, SURFACE, 3.4], [2.0, SURFACE, 3.05]], 60), band: [SURFACE - 0.7, SURFACE - 0.2], opens: true, after: () => skin.open() }),
      dragStep({ name: 'Separate the muscles', handles: [{ obj: curtains[0], from: [-0.25, zm], to: [-1.3, zm] }, { obj: curtains[1], from: [0.25, zm], to: [1.3, zm] }] }),
      dragStep({ name: 'Move the bladder down', y: 2.15, handles: [{ obj: bladder, from: [0, 3.45], to: [0, 4.4] }] }),
      cutStep({ name: 'Open the uterus', line: curvePts([[-1.1, 1.98, 2.95], [1.1, 1.98, 2.95]], 40), band: [1.6, 2.1], markY: 2.0, groove: false,
        deepMsg: 'Careful, the baby is right under there!', deepBleed: 20, deepEvent: 'baby_nick',
        after: () => { slit.visible = true; baby.visible = true; tween(0.6, u => { baby.position.set(0, 1.6 + 0.35 * u, 2.4 + 0.5 * u); }); } }),
      grabStep({ name: 'Deliver the baby', obj: baby, what: 'baby', place: [0, SURFACE + 0.4, 4.85], radius: 0.9,
        onGrab: () => { placenta.visible = true; },
        after: () => { cord = add(tube(cordPts(), 0.09, 0xd9d2f5)); cry(); OR.emit('baby_out'); OR.say('It\'s a baby!', 'good', 45); } }),
      holdStep({ name: 'Clamp the cord', tool: 'clamp', what: 'cord clamp', points: [[0.36, 2.38, 3.8], [0.27, 2.62, 4.25]], sec: 1.0, make: clampAt }),
      cutStep({ name: 'Cut the cord', line: curvePts([[-0.1, 2.5, 4.02], [0.75, 2.5, 4.02]], 15), band: [2.2, 2.75], markY: 2.55, groove: false,
        after: () => { if (cord) OR.group.remove(cord); flyTo(baby, V3(2.4, SURFACE + 0.75, -3.6)); setTimeout(cry, 900); } }),
      grabStep({ name: 'Deliver the placenta', obj: placenta, what: 'placenta', lift: true, radius: 0.85, after: () => flyTo(placenta, V3(4.7, SURFACE + 0.45, 2.6)) }),
      stitchStep({ name: 'Close the uterus', y: 2.0, points: [[-1.0, 2.8], [-0.6, 3.1], [-0.2, 2.8], [0.2, 3.1], [0.6, 2.8], [1.0, 3.1]], after: () => { slit.visible = false; } }),
      stitchStep({ name: 'Close the skin',
        before: () => { curtains.forEach((c, i) => { const x0 = c.position.x, x1 = i ? 1.2 : -1.2; tween(0.6, u => { c.position.x = x0 + (x1 - x0) * u; }); }); skin.close(); },
        points: [[-1.6, 3.05], [-1.0, 3.45], [-0.4, 3.05], [0.4, 3.45], [1.0, 3.05], [1.6, 3.45]],
        after: () => setTimeout(() => bandage(0, 3.25, 4.2, 'x'), 300) }),
    ];
    steps.hazards = [
      { what: 'bladder', line: () => [[bladder.position.x - 0.45, bladder.position.y, bladder.position.z], [bladder.position.x + 0.45, bladder.position.y, bladder.position.z]], r: 0.3, near: 0.25, bleed: 20,
        msg: 'You nicked the bladder!', steps: ['Open the uterus', 'Deliver the baby', 'Close the uterus'] },
    ];
    return steps;
  },
});

// --- Operation 5: total hip replacement ---
// Real outline (posterior approach): incision over the hip, split and retract the muscles (the sciatic nerve runs
// just behind), dislocate the hip, saw through the femoral neck, take out the worn ball, ream the socket into a
// clean hemisphere, hammer in a metal cup, fit the new ball on the stem, put the hip back in, close.
operation({
  id: 'hip', title: 'Hip replacement', limit: 540, par: 260,
  blurb: 'Arthritis has worn this hip joint out. Replace the ball and socket with a new metal-and-plastic joint.',
  stepNames: ['Incision', 'Retract the muscle', 'Dislocate the hip', 'Cut the femoral neck', 'Remove the old ball', 'Ream the socket', 'Hammer in the cup', 'Fit the new ball', 'Put the hip back in', 'Stitch up'],
  build() {
    const open = { x0: -1.5, x1: 1.5, z0: -3.6, z1: 3.4 };
    const skin = makeSkin(open);
    const curtains = curtainsUnder(open, 0, muscle());
    const bone = clay(0xf5efe0, 0.6);
    const pelvis = add(solid(new THREE.SphereGeometry(1, 28, 16), bone, -0.3, 1.25, -2.0)); pelvis.scale.set(2.2, 0.45, 1.5);
    const socket = add(solid(new THREE.SphereGeometry(0.5, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), clay(0x6b4a3a, 0.8), 0, 1.66, -1.2)); socket.scale.set(1, 0.25, 1);
    // the femur (thigh bone) runs toward the feet; the worn ball sits in the socket
    const femur = add(new THREE.Group());
    femur.add(tube([[0.25, 1.75, -0.5], [0.35, 1.65, 1.8], [0.45, 1.55, 4.6]], 0.34, 0xf5efe0), tube([[0, 1.85, -1.2], [0.25, 1.75, -0.5]], 0.24, 0xf5efe0));
    const ball = add(solid(new THREE.SphereGeometry(0.45, 22, 14), clay(0xd9c7a0, 0.7), 0, 1.85, -1.2));
    face(ball, 0.38, 0.0, false);
    let ballOn = true;
    OR.onFrame(() => { if (ballOn) ball.position.set(femur.position.x, 1.85, femur.position.z - 1.2); });
    const nerve = [[-1.45, 1.75, -4.2], [-1.35, 1.72, 0], [-1.25, 1.7, 4.4]];
    add(tube(nerve, 0.13, 0xffe066));
    const cup = add(solid(new THREE.SphereGeometry(0.46, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2), clay(0xd0d6e0, 0.25, { metalness: 0.7 }), 0, 2.15, -1.2)); cup.rotation.x = Math.PI; cup.visible = false;
    // the metal stem goes down the femur's canal; its neck ends where the old ball was
    const stem = add(tube([[1.25, 1.8, 0.1], [1.0, 1.9, -0.55]], 0.11, 0xd0d6e0)); stem.visible = false;
    OR.onFrame(() => { stem.position.set(femur.position.x - 1.0, 0, femur.position.z - 0.6); });
    const newBall = add(solid(new THREE.SphereGeometry(0.4, 22, 14), clay(0xf4f6ff, 0.2, { metalness: 0.5 }), 2.1, SURFACE + 0.55, 3.5));
    add(solid(new THREE.CylinderGeometry(0.6, 0.7, 0.3, 20), clay(0x3fa7ff, 0.5), 2.1, SURFACE + 0.15, 3.5));   // implant stand
    tray();
    const neckMid = [1.12, -0.25];
    const steps = [
      cutStep({ name: 'Incision', line: curvePts([[0.4, SURFACE, 3.0], [0, SURFACE, 0], [0.3, SURFACE, -3.2]], 70), band: [SURFACE - 0.7, SURFACE - 0.2], opens: true, after: () => skin.open() }),
      dragStep({ name: 'Retract the muscle', handles: [{ obj: curtains[0], from: [-0.25, 0], to: [-1.25, 0] }, { obj: curtains[1], from: [0.25, 0], to: [1.25, 0] }] }),
      dragStep({ name: 'Dislocate the hip', y: 2.05, handles: [{ obj: femur, from: [0.3, 1.0], to: [1.3, 1.6] }],
        after: () => { OR.tone(160, 220, 'square', 0.08); OR.say('Pop!', 'info', 15); } }),
      sawStep({ name: 'Cut the femoral neck', line: curvePts([[neckMid[0] - 0.47, 1.95, neckMid[1] + 0.17], [neckMid[0] + 0.47, 1.95, neckMid[1] - 0.17]], 20), band: [1.55, 2.1], need: 6, markY: 2.0,
        deepMsg: 'Easy: mind the soft tissue under the neck!' }),
      grabStep({ name: 'Remove the old ball', obj: ball, what: 'worn ball', lift: true, radius: 0.75, onGrab: () => { ballOn = false; },
        after: () => { flyTo(ball, V3(4.7, SURFACE + 0.45, 2.6)); stem.visible = true; } }),
      reamStep({ name: 'Ream the socket', at: [0, -1.2], band: [1.45, 2.05], turns: 4, deepMsg: 'Through the pelvis: come up!', deepEvent: 'ream_deep',
        onProgress: f => { socket.scale.set(1 + 0.15 * f, 0.25 + 0.5 * f, 1 + 0.15 * f); socket.material.color.setHex(f > 0.95 ? 0xd9785f : 0x6b4a3a); } }),
      pumpStep({ name: 'Hammer in the cup', tool: 'mallet', at: [0, -1.2], y: 2.0, need: 6, rhythm: [0.3, 1.4], noun: 'taps', how: 'firm taps straight down', thud: 180,
        onPump: () => { cup.visible = true; cup.position.y = Math.max(1.75, cup.position.y - 0.07); OR.tone(1200, 40, 'square', 0.05); } }),
      grabStep({ name: 'Fit the new ball', obj: newBall, what: 'new ball', place: [1.0, 1.95, -0.6], radius: 0.7 }),
      dragStep({ name: 'Put the hip back in', y: 2.05, handles: [{ obj: femur, from: [1.3, 1.6], to: [0.3, 1.0] }],
        after: () => { OR.tone(220, 200, 'square', 0.08); } }),
      stitchStep({ name: 'Stitch up',
        before: () => { curtains.forEach((c, i) => { const x0 = c.position.x, x1 = i ? 0.75 : -0.75; tween(0.6, u => { c.position.x = x0 + (x1 - x0) * u; }); }); skin.close(); },
        points: [[-0.35, 2.6], [0.35, 1.6], [-0.35, 0.6], [0.35, -0.4], [-0.35, -1.4], [0.35, -2.4]],
        after: () => setTimeout(() => bandage(0.1, 0, 6, 'z'), 300) }),
    ];
    // the new ball rides on the femur once fitted; the cup shows as soon as hammering starts
    OR.onFrame(() => { if (steps[7].fitted) newBall.position.set(femur.position.x, 1.95, femur.position.z - 1.2); });
    const fitAfter = steps[7].after; steps[7].after = () => { steps[7].fitted = true; if (fitAfter) fitAfter(); };
    steps.hazards = [{ what: 'sciatic nerve', line: nerve, r: 0.22, near: 0.3, bleed: 5, stress: 30, msg: 'SCIATIC NERVE!', steps: steps.map(s => s.name).filter(n => n !== 'Incision' && n !== 'Stitch up') }];
    return steps;
  },
});

// --- Operation 6: kidney transplant ---
// Real outline: a curved "hockey-stick" incision in the lower abdomen, retract the muscles, clamp the external
// iliac artery and vein, bring in the donor kidney on ice, sew its vein and artery to the iliac vessels, release
// the clamps (the kidney pinks up as blood flows in), join its ureter to the bladder, close. The patient's own
// kidneys stay where they are.
operation({
  id: 'kidney', title: 'Kidney transplant', limit: 480, par: 230,
  blurb: 'Kidney failure. A donor kidney is on ice: plumb it into the blood supply and the bladder.',
  stepNames: ['Incision', 'Open the muscle layers', 'Clamp the iliac vessels', 'Bring in the donor kidney', 'Sew the vein', 'Sew the artery', 'Release the clamps', 'Connect the ureter', 'Stitch up'],
  build() {
    const open = { x0: -2.7, x1: -0.1, z0: 0.0, z1: 4.4 }, xm = -1.4;
    const skin = makeSkin(open);
    const curtains = curtainsUnder(open, xm, muscle());
    const art = [[-2.6, 1.62, 0.2], [-1.6, 1.62, 2.4], [-0.7, 1.6, 4.6]], vein = [[-2.15, 1.57, 0.1], [-1.15, 1.57, 2.3], [-0.25, 1.55, 4.5]];
    add(tube(art, 0.17, 0xff4d6d)); add(tube(vein, 0.19, 0x6f8cff));
    const bladder = add(solid(new THREE.SphereGeometry(0.55, 22, 14), clay(0xffd1a8, 0.45), -0.8, 1.75, 3.9)); bladder.scale.set(1.2, 0.6, 0.9);
    for (const pts of [[[-2.5, 1.45, 3.4], [-1.6, 1.4, 4.4], [-0.6, 1.45, 3.0]]]) add(tube(pts, 0.25, 0xffa3b8));
    cooler(2.2, 3.8);
    const kidney = add(new THREE.Group());   // a bean, pale until blood flows into it
    const kMat = clay(0xc9a7a7, 0.5), bean = solid(new THREE.SphereGeometry(0.55, 24, 16), kMat, 0, 0, 0); bean.scale.set(0.75, 0.5, 1.25);
    kidney.add(bean); face(kidney, 0.26, 0.2, true);
    kidney.position.set(2.2, SURFACE + 0.9, 3.8);
    const ureter = { m: null };
    const clamps = [];
    const vClamp = [-1.4, 1.6, 1.75], aClamp = [-1.95, 1.65, 1.35];
    tray();
    const steps = [
      cutStep({ name: 'Incision', line: curvePts([[-0.6, SURFACE, 4.1], [-1.2, SURFACE, 2.6], [-1.8, SURFACE, 1.3], [-2.3, SURFACE, 0.4]], 60), band: [SURFACE - 0.7, SURFACE - 0.2], opens: true, after: () => skin.open() }),
      dragStep({ name: 'Open the muscle layers', handles: [{ obj: curtains[0], from: [xm - 0.25, 2.2], to: [xm - 1.1, 2.2] }, { obj: curtains[1], from: [xm + 0.25, 2.2], to: [xm + 1.1, 2.2] }] }),
      holdStep({ name: 'Clamp the iliac vessels', tool: 'clamp', what: 'vessel', points: [aClamp, vClamp], sec: 1.1, make: p => { const c = clampAt(p); clamps.push(c); return c; } }),
      grabStep({ name: 'Bring in the donor kidney', obj: kidney, what: 'donor kidney', place: [-1.6, 1.95, 3.1], radius: 0.85 }),
      holdStep({ name: 'Sew the vein', tool: 'needle', what: 'stitch', color: 0xff7aa8, points: ring3([-1.15, 2.45], 0.28, 1.7), sec: 0.9, radius: 0.3, make: knotAt }),
      holdStep({ name: 'Sew the artery', tool: 'needle', what: 'stitch', color: 0xff7aa8, points: ring3([-1.75, 2.35], 0.26, 1.72), sec: 0.9, radius: 0.3, make: knotAt }),
      holdStep({ name: 'Release the clamps', tool: 'clamp', what: 'clamp', points: [vClamp, aClamp].map(p => [p[0], p[1] + 0.2, p[2]]), sec: 0.7,
        after: () => {
          clamps.forEach(c => OR.group.remove(c));
          const from = new THREE.Color(0xc9a7a7), to = new THREE.Color(0xff8fa3);
          tween(1.6, u => kMat.color.copy(from).lerp(to, u));
          OR.say('Reperfusion: it\'s pinking up', 'good', 45); OR.emit('kidney_pink');
          ureter.m = add(tube([[-1.6, 1.9, 3.6], [-1.2, 1.85, 3.95], [-0.95, 1.95, 3.85]], 0.08, 0xffe08a));
        } }),
      holdStep({ name: 'Connect the ureter', tool: 'needle', what: 'stitch', color: 0xff7aa8, points: ring3([-0.85, 3.8], 0.25, 2.05), sec: 0.9, radius: 0.3, make: knotAt }),
      stitchStep({ name: 'Stitch up',
        before: () => { curtains.forEach((c, i) => { const x0 = c.position.x, x1 = i ? (xm + open.x1) / 2 : (open.x0 + xm) / 2; tween(0.6, u => { c.position.x = x0 + (x1 - x0) * u; }); }); skin.close(); },
        points: [[-0.55, 3.8], [-1.15, 3.2], [-1.0, 2.4], [-1.7, 1.9], [-1.6, 1.1], [-2.25, 0.7]],
        after: () => setTimeout(() => bandage(xm, 2.2, 4, 'z'), 300) }),
    ];
    steps.hazards = [{ what: 'iliac artery', line: art, r: 0.22, near: 0.2, bleed: 60, stress: 15, msg: 'You hit the iliac artery!', steps: ['Incision', 'Open the muscle layers', 'Bring in the donor kidney', 'Connect the ureter'] }];
    return steps;
  },
});

// --- Operation 7: emergency splenectomy (trauma) ---
// Real outline (trauma laparotomy): long midline incision, suck out the blood, pack all four quadrants with
// sponges to slow the bleeding, find the source (the soaked pack: a ruptured spleen), free the spleen, clamp its
// vessels at the hilum, cut it free and remove it, check that nothing else bleeds, close. The patient arrives in
// shock and keeps bleeding until the spleen's vessels are clamped.
let spleenClamped = false;
operation({
  id: 'spleen', title: 'Emergency splenectomy', limit: 420, par: 220,
  blurb: 'Car crash. The spleen has ruptured and the patient is bleeding into the belly: stop it, fast.',
  stepNames: ['Midline incision', 'Suction the blood', 'Pack the quadrants', 'Lift the soaked pack', 'Free the spleen', 'Clamp the splenic vessels', 'Cut it free', 'Remove the spleen', 'Final check', 'Stitch up'],
  onTick(step) {   // bleeding continues until the vessels are clamped
    if (!spleenClamped && step !== 'Midline incision') OR.pt.bleed = Math.max(OR.pt.bleed, 5);
  },
  build() {
    spleenClamped = false;
    OR.pt.loss = Math.max(OR.pt.loss, 350);   // arrives in shock
    const open = { x0: -1.8, x1: 1.8, z0: -4.4, z1: 3.6 };
    const skin = makeSkin(open);
    add(solid(new THREE.SphereGeometry(1, 24, 14), clay(0x9c3b3b, 0.45), -1.7, 1.6, -2.7)).scale.set(1.3, 0.4, 1.2);   // liver
    add(solid(new THREE.SphereGeometry(1, 24, 14), clay(0xffd1dc, 0.5), 0.3, 1.6, -2.9)).scale.set(0.9, 0.4, 0.8);    // stomach
    const pancreas = [[-0.2, 1.42, -1.9], [0.5, 1.44, -2.0], [1.0, 1.45, -2.2]];
    add(tube(pancreas, 0.15, 0xffd08a));
    for (const pts of [[[-1.6, 1.5, -0.6], [-0.4, 1.55, 0.2], [0.8, 1.5, -0.4], [1.6, 1.55, 0.6]], [[-1.4, 1.5, 1.6], [0, 1.55, 2.6], [1.4, 1.5, 1.8]], [[-1.2, 1.45, 3.2], [0.6, 1.5, 3.4]]]) add(tube(pts, 0.28, 0xffa3b8));
    const spleen = add(new THREE.Group());
    const sp = solid(new THREE.SphereGeometry(0.6, 24, 16), clay(0x7b3fa0, 0.45), 0, 0, 0); sp.scale.set(0.7, 0.5, 1.2); spleen.add(sp);
    face(spleen, 0.27, 0.25, false);
    spleen.position.set(1.75, 1.85, -2.5);
    wobble(spleen, 0.05, 6);
    const pools = [[1.3, -1.6], [0.5, -0.5], [-0.8, 0.5], [0.9, 1.5], [-0.5, 2.6]].map(([x, z]) => ({ p: [x, 1.9, z], r: 0.5, mesh: pool(x, 1.9, z, 0.6) }));
    const packAt = [[-1.1, 2.0, -2.2], [1.2, 2.0, -2.0], [-1.0, 2.0, 1.6], [1.0, 2.0, 1.8]];
    const packs = [];
    const packMesh = p => { const m = solid(new THREE.BoxGeometry(0.75, 0.16, 0.6), clay(0xffffff, 0.8), p[0], p[1] + 0.08, p[2]); packs.push(m); return m; };
    tray();
    const later = [[1.1, -1.4], [-0.3, 0.9], [0.4, 2.3]].map(([x, z]) => { const m = pool(x, 1.9, z, 0.45); m.visible = false; return { p: [x, 1.9, z], r: 0.45, mesh: m }; });
    const hilum = [[0.6, 1.9, -2.45], [0.62, 1.9, -1.95]];
    const steps = [
      cutStep({ name: 'Midline incision', line: curvePts([[0, SURFACE, 3.3], [0, SURFACE, -4.1]], 80), band: [SURFACE - 0.7, SURFACE - 0.2], opens: true, after: () => skin.open() }),
      clearStep({ name: 'Suction the blood', kind: 'suction', items: pools, refill: 0.05, what: 'blood', how: 'hover the suction in each pool', par: 10 }),
      holdStep({ name: 'Pack the quadrants', tool: 'forceps', what: 'pack', points: packAt, sec: 0.7, radius: 0.45, make: packMesh,
        after: () => { const red = new THREE.Color(0xb3122e), m = packs[1].material = clay(0xffffff, 0.8); tween(2.5, u => m.color.setRGB(1, 1, 1).lerp(red, u)); OR.say('Upper left pack is soaking through', 'bad', 40); OR.emit('soaked_pack'); } }),
      grabStep({ name: 'Lift the soaked pack', obj: { get position() { return packs[1].position; } }, what: 'soaked pack', lift: true, radius: 0.7,
        after: () => { flyTo(packs[1], V3(4.7, SURFACE + 0.45, 2.6)); const b = pool(1.5, 1.92, -2.3, 0.4); tween(1.5, u => b.scale.set(0.4 + 0.4 * u, 0.1, 0.4 + 0.4 * u)); OR.emit('spleen_found'); } }),
      dragStep({ name: 'Free the spleen', y: 2.05, handles: [{ obj: spleen, from: [1.95, -2.5], to: [1.55, -2.2] }] }),
      holdStep({ name: 'Clamp the splenic vessels', tool: 'clamp', what: 'vessel', points: hilum, sec: 1.2, make: clampAt,
        after: () => { spleenClamped = true; OR.pt.bleed = 0; OR.say('Bleeding controlled', 'good', 45); OR.emit('bleeding_stopped'); } }),
      cutStep({ name: 'Cut it free', line: curvePts([[0.8, 1.95, -2.65], [0.8, 1.95, -1.75]], 20), band: [1.7, 2.1], markY: 2.0, groove: false,
        deepMsg: 'Too deep: that\'s the pancreas!', deepBleed: 25, deepEvent: 'pancreas_nick' }),
      grabStep({ name: 'Remove the spleen', obj: spleen, what: 'spleen', lift: true, radius: 0.85, after: () => flyTo(spleen, V3(4.7, SURFACE + 0.45, 2.6)) }),
      clearStep({ name: 'Final check', kind: 'suction', items: later, what: 'blood', how: 'clear the last of the blood, then check', par: 6 }),
      stitchStep({ name: 'Stitch up',
        before: () => { packs.forEach(m => OR.group.remove(m)); skin.close(); },
        points: [[-0.35, 2.9], [0.35, 1.9], [-0.35, 0.9], [0.35, -0.1], [-0.35, -1.1], [0.35, -2.1], [-0.35, -3.1]],
        after: () => setTimeout(() => bandage(0, -0.4, 7, 'z'), 300) }),
    ];
    const show = steps[8].init; steps[8].init = () => { later.forEach(l => { l.mesh.visible = true; }); show(); };
    steps.hazards = [
      { what: 'stomach', line: [[-0.3, 1.6, -2.9], [0.9, 1.6, -2.9]], r: 0.45, near: 0.2, bleed: 15, stress: 10, msg: 'You grabbed the stomach!', steps: ['Free the spleen', 'Clamp the splenic vessels'] },
      { what: 'pancreas', line: pancreas, r: 0.2, near: 0.25, bleed: 25, stress: 20, msg: 'PANCREAS INJURY!', steps: ['Clamp the splenic vessels', 'Cut it free'] },
    ];
    return steps;
  },
});
})();
