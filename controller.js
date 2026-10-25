// MagTrack controller: the tracked magnet (e.g. on a ring) as an input device. Move it over the board to point;
// flip it over (north end up <-> down) to click, or hold still on a key to click. Listens for the viewer's
// 'magnet' events (one per sample, with the fitted magnet) and draws its own overlay. Clicks work with a mouse too.
(function () {
'use strict';
// Board area (cm) mapped onto the overlay. "long" runs along the card (top to bottom), "short" across it.
const AREA = { long: [-4.4, 4.4], short: [-2.4, 2.4] };
const FLIP_ON = 0.55;     // |north . up| beyond this counts as north up / north down
const FLIP_AIM = 0.8;     // the cursor only moves (and aims the next click) while the magnet is this upright
const FLIP_STABLE = 2;    // samples a new pole must hold before it counts, so one noisy sample can't click
// Timing counts samples (~19 per second), so it also holds when a recording is replayed faster.
const CLICK_GAP = 7;      // ignore a second click within this many samples (~0.35 s)
const DWELL = 20;         // hold this many samples (~1 s) on a key to click it (when dwell is on)
const CURSOR_SMOOTH = 0.4;
const GAME_MS = 45000;

const KEYS = [
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', '⌫'],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M', '.', ',', '?'],
  [['SPACE', 5], ['SPEAK', 3], ['CLEAR', 2]],
];

// --- overlay ---
const css = document.createElement('style');
css.textContent = `
  #ctrl { position: absolute; inset: 132px 12px 12px; display: none; flex-direction: column; gap: 10px; z-index: 5;
          background: color-mix(in srgb, var(--bg) 94%, transparent); border: 1px solid #333844; border-radius: 10px; padding: 14px; }
  #ctrl .bar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; color: var(--muted); }
  #ctrl .bar .tab.on { border-color: var(--accent); color: var(--accent); }
  #ctrl .bar .grow { flex: 1; }
  #ctrl-status { font: 13px ui-monospace, monospace; }
  #ctrl-text { min-height: 44px; font: 28px ui-monospace, monospace; padding: 6px 12px; background: var(--panel);
               border-radius: 8px; white-space: pre-wrap; word-break: break-all; }
  #ctrl-text::after { content: '▏'; color: var(--accent); animation: blink 1s steps(1) infinite; }
  @keyframes blink { 50% { opacity: 0; } }
  #ctrl-area { position: relative; flex: 1; min-height: 180px; border-radius: 8px; overflow: hidden; }
  #ctrl-keys { position: absolute; inset: 0; display: grid; grid-template-columns: repeat(10, 1fr); grid-auto-rows: 1fr; gap: 6px; }
  #ctrl-keys div { display: flex; align-items: center; justify-content: center; background: var(--panel); border: 1px solid #333844;
                   border-radius: 8px; font: 600 clamp(14px, 2.6vw, 30px) system-ui, sans-serif; user-select: none; cursor: pointer;
                   background-image: linear-gradient(to top, #4da3ff55 var(--dwell, 0%), transparent var(--dwell, 0%)); }
  #ctrl-keys div.hover { border-color: var(--accent); background-color: #1f2a3a; }
  #ctrl-keys div.hit { background-color: #2f7d4f; border-color: #5fd38d; }
  #ctrl-game { position: absolute; inset: 0; display: none; background: var(--panel); }
  #ctrl-game .target { position: absolute; border-radius: 50%; background: radial-gradient(#ff8a5c, #ff5a5a); transform: translate(-50%, -50%);
                       display: flex; align-items: center; justify-content: center; color: #fff; font: 600 16px system-ui; text-align: center; }
  #ctrl-game .score { position: absolute; top: 10px; left: 14px; font: 600 20px system-ui; }
  #ctrl-cursor { position: absolute; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%; pointer-events: none;
                 border: 4px solid #ff5a5a; box-shadow: 0 0 12px #000a; display: none; transition: border-color .15s; z-index: 2; }
  #ctrl-cursor.south { border-color: #4d7dff; }
  #ctrl-cursor.flipping { border-style: dashed; }
  #ctrl-cursor.click { transform: scale(1.6); transition: transform .12s; }
`;
document.head.appendChild(css);

const root = document.createElement('div');
root.id = 'ctrl';
root.innerHTML = `
  <div class="bar">
    <button class="tab on" data-mode="keys">Keyboard</button>
    <button class="tab" data-mode="game">Target game</button>
    <select id="ctrl-orient" title="How the board lies in front of you">
      <option value="landscape">Board: top of card to the left</option>
      <option value="portrait">Board: top of card away from you</option>
    </select>
    <label class="check"><input id="ctrl-dwell" type="checkbox"> Dwell click</label>
    <span class="grow"></span>
    <span id="ctrl-status">no magnet</span>
  </div>
  <div id="ctrl-text"></div>
  <div id="ctrl-area">
    <div id="ctrl-keys"></div>
    <div id="ctrl-game"><div class="score"></div></div>
    <div id="ctrl-cursor"></div>
  </div>`;
document.body.appendChild(root);
const $ = id => document.getElementById(id);
const area = $('ctrl-area'), cursorEl = $('ctrl-cursor'), textEl = $('ctrl-text'), keysEl = $('ctrl-keys'), gameEl = $('ctrl-game');

for (const row of KEYS) for (const k of row) {
  const [label, span] = Array.isArray(k) ? k : [k, 1];
  const d = document.createElement('div');
  d.textContent = label === 'SPACE' ? 'space' : label === 'SPEAK' ? '🔊 speak' : label === 'CLEAR' ? 'clear' : label;
  d.dataset.key = label;
  d.style.gridColumn = `span ${span}`;
  keysEl.appendChild(d);
}

const toggle = document.createElement('button');
toggle.textContent = 'Controller';
toggle.title = 'Use the magnet as a pointer: move to aim, flip it over to click';
document.querySelector('#ui .row').appendChild(toggle);
// start just below the viewer's controls, which grow when warnings appear
const placeBelowUi = () => { root.style.top = Math.round(document.getElementById('ui').getBoundingClientRect().bottom + 8) + 'px'; };
addEventListener('resize', placeBelowUi);
toggle.onclick = () => {
  const on = root.style.display !== 'flex';
  root.style.display = on ? 'flex' : 'none';
  placeBelowUi();
  toggle.classList.toggle('live', on);
  logEvent({ event: 'ctrl_open', on });
};

let mode = 'keys';
root.querySelectorAll('.tab').forEach(b => b.onclick = () => {
  mode = b.dataset.mode;
  root.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t === b));
  keysEl.style.display = mode === 'keys' ? 'grid' : 'none';
  gameEl.style.display = mode === 'game' ? 'block' : 'none';
  textEl.style.display = mode === 'keys' ? 'block' : 'none';
  if (mode === 'game') gameIdle();
});

function logEvent(d) { if (typeof log === 'function') log('app', d); }   // viewer.html's recorder

// --- pointing ---
let cur = null;          // smoothed cursor, 0..1 in both directions
let aim = null;          // where the next flip-click lands: the last point where the magnet was upright
let pole = 0, candidate = 0, candidateCount = 0, sample = 0, lastClick = -Infinity;
let dwellEl = null, dwellStart = 0;

function toArea(p) {      // magnet position (cm, scene axes) -> 0..1 across / down the overlay area
  const L = AREA.long, S = AREA.short, clamp = v => Math.min(1, Math.max(0, v));
  if ($('ctrl-orient').value === 'portrait') return [clamp((p[0] - S[0]) / (S[1] - S[0])), clamp((p[2] - L[0]) / (L[1] - L[0]))];
  // top of card (-z) to the left: along the card -> across the screen; card's right edge (+x) points away from you
  return [clamp((p[2] - L[0]) / (L[1] - L[0])), clamp((S[1] - p[0]) / (S[1] - S[0]))];
}
const px = uv => { const r = area.getBoundingClientRect(); return [r.left + uv[0] * r.width, r.top + uv[1] * r.height]; };

addEventListener('magnet', e => {
  if (root.style.display !== 'flex') return;
  sample++;
  placeBelowUi();
  const { fit } = e.detail;
  if (!fit) {
    cursorEl.style.display = 'none';
    setHover(null);
    $('ctrl-status').textContent = 'no magnet: bring it within ~5 cm of the board';
    candidateCount = 0;
    return;
  }
  const up = M.normalize(fit.m)[1];    // +1 = north end up
  const upright = Math.abs(up) > FLIP_AIM;
  if (upright) {
    const uv = toArea(fit.pos);
    cur = cur ? cur.map((c, k) => c + CURSOR_SMOOTH * (uv[k] - c)) : uv;
    aim = cur.slice();
  }
  if (!cur) return;
  const r = area.getBoundingClientRect();
  cursorEl.style.display = 'block';
  cursorEl.style.left = cur[0] * r.width + 'px';
  cursorEl.style.top = cur[1] * r.height + 'px';
  cursorEl.classList.toggle('south', up < 0);
  cursorEl.classList.toggle('flipping', !upright);
  $('ctrl-status').textContent = `height ${fit.pos[1].toFixed(1)} cm · north ${up > 0 ? 'up' : 'down'}` + (fit.pos[1] > 5 ? ' · move closer' : '');

  // flip to click: the pole has to settle for a couple of samples, and the click lands where the magnet was
  // last upright (the position wobbles mid-flip)
  const s = up > FLIP_ON ? 1 : up < -FLIP_ON ? -1 : 0;
  if (s && s === candidate) candidateCount++; else { candidate = s; candidateCount = s ? 1 : 0; }
  if (candidate && candidateCount >= FLIP_STABLE && candidate !== pole) {
    if (pole && aim) click(aim, 'flip');
    pole = candidate;
  }

  const hovered = upright ? hitKey(cur) : null;
  setHover(hovered);
  if ($('ctrl-dwell').checked && hovered && mode === 'keys') {
    if (hovered !== dwellEl) { dwellEl = hovered; dwellStart = sample; }
    const t = (sample - dwellStart) / DWELL;
    hovered.style.setProperty('--dwell', Math.max(0, Math.min(100, t * 100)) + '%');
    if (t >= 1) { click(cur, 'dwell'); dwellStart = sample + CLICK_GAP; }   // pause before it can repeat
  } else if (dwellEl) { dwellEl.style.removeProperty('--dwell'); dwellEl = null; }
  if (mode === 'game') gameTick();
});

function hitKey(uv) {
  if (mode !== 'keys') return null;
  const [x, y] = px(uv);
  const el = document.elementFromPoint(x, y);
  return el && el.parentElement === keysEl ? el : null;
}
let hoverEl = null;
function setHover(el) {
  if (el === hoverEl) return;
  if (hoverEl) { hoverEl.classList.remove('hover'); hoverEl.style.removeProperty('--dwell'); }
  hoverEl = el;
  if (el) el.classList.add('hover');
}

function click(uv, how) {
  if (how !== 'mouse') { if (sample - lastClick < CLICK_GAP) return; lastClick = sample; }
  cursorEl.classList.add('click');
  setTimeout(() => cursorEl.classList.remove('click'), 150);
  if (mode === 'keys') { const el = hitKey(uv); if (el) press(el, how); }
  else gameClick(uv, how);
}

// --- keyboard ---
let text = '', typedChars = 0, firstKeyAt = 0;
function press(el, how) {
  const k = el.dataset.key;
  el.classList.add('hit');
  setTimeout(() => el.classList.remove('hit'), 180);
  if (k === '⌫') text = text.slice(0, -1);
  else if (k === 'SPACE') text += ' ';
  else if (k === 'CLEAR') { text = ''; typedChars = 0; firstKeyAt = 0; }
  else if (k === 'SPEAK') speak(text);
  else text += k;
  if (k.length === 1 || k === 'SPACE') { if (!firstKeyAt) firstKeyAt = performance.now(); typedChars++; }
  textEl.textContent = text;
  showRate();
  logEvent({ event: 'ctrl_key', key: k, how });
}
function showRate() {
  const min = (performance.now() - firstKeyAt) / 60000;
  if (typedChars >= 5 && min > 0) textEl.title = `${typedChars} characters · ${(typedChars / 5 / min).toFixed(1)} words per minute`;
}
function speak(t) {
  if (!t.trim() || !('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  speechSynthesis.speak(new SpeechSynthesisUtterance(t.toLowerCase()));
}
keysEl.addEventListener('click', e => { if (e.target.parentElement === keysEl) press(e.target, 'mouse'); });   // mouse works too

// --- target game: flip on as many targets as you can ---
let game = null;   // { end, score, target: {u, v, r} }
function gameIdle() {
  game = null;
  showTarget({ u: 0.5, v: 0.5, r: 0.16, label: 'flip here<br>to start' });
  gameEl.querySelector('.score').textContent = best ? `best: ${best}` : 'Aim with the magnet, flip it to pop the target';
}
let best = 0;
function showTarget(t) {
  gameEl.querySelectorAll('.target').forEach(n => n.remove());
  const r = area.getBoundingClientRect(), n = document.createElement('div');
  n.className = 'target';
  const d = 2 * t.r * Math.min(r.width, r.height);
  Object.assign(n.style, { left: t.u * 100 + '%', top: t.v * 100 + '%', width: d + 'px', height: d + 'px' });
  n.innerHTML = t.label || '';
  gameEl.appendChild(n);
  gameEl.target = t;
}
function newTarget() {
  const r = 0.07 + 0.05 * Math.random();
  showTarget({ u: r + Math.random() * (1 - 2 * r), v: r + Math.random() * (1 - 2 * r), r });
}
function gameClick(uv, how) {
  const t = gameEl.target, rect = area.getBoundingClientRect();
  if (!t) return;
  const dx = (uv[0] - t.u) * rect.width, dy = (uv[1] - t.v) * rect.height;
  if (Math.hypot(dx, dy) > t.r * Math.min(rect.width, rect.height)) return;
  if (!game) { game = { end: performance.now() + GAME_MS, score: 0 }; logEvent({ event: 'ctrl_game_start' }); }
  else { game.score++; logEvent({ event: 'ctrl_game_hit', score: game.score, how }); }
  newTarget();
  gameTick();
}
function gameTick() {
  if (!game) return;
  const left = game.end - performance.now();
  if (left <= 0) {
    best = Math.max(best, game.score);
    logEvent({ event: 'ctrl_game_end', score: game.score });
    const s = game.score;
    gameIdle();
    gameEl.querySelector('.score').textContent = `score ${s} · best ${best}`;
    return;
  }
  gameEl.querySelector('.score').textContent = `score ${game.score} · ${Math.ceil(left / 1000)} s`;
}
gameEl.addEventListener('click', e => {   // mouse works too
  const r = area.getBoundingClientRect();
  gameClick([(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height], 'mouse');
});
setInterval(gameTick, 250);
})();
