// MagTrack OR voice: Riley, an AI surgical assistant who talks you through each procedure in a Cartesia Sonic voice
// (requested from server.js, which holds the API key). Event-driven: the game emits 'or-event's (artery hit, step
// start, too deep, ...), and this also watches the live state (distance to target, hand speed, tremor, vitals, clock).
// A small director decides what is worth saying: priorities, per-event cooldowns, interruptions, escalating wording
// and urgency, and a countdown. Speech is fetched and played asynchronously, so the tracking loop never waits on it.
// Every line is also shown as a caption.
(function () {
'use strict';
const OR = window.MagTrackOR;
if (!OR) return;
const P = { chatter: 0, guide: 1, warn: 2, crit: 3 };
const pick1 = a => a[Math.floor(Math.random() * a.length)];

// --- what Riley says ---
// lines: variants (strings or data => string); levels: escalating variants for repeats within escWindow (ms);
// cd: cooldown (ms) for this event; emotion/speed (or per-level emotions/speeds) go to Cartesia.
const TOOL = { scalpel: 'Scalpel.', saw: 'Bone saw.', retractor: 'Retractor.', clamp: 'Clamp.', forceps: 'Forceps.', needle: 'Needle driver.', hands: 'Hands on the heart.' };
const STEP = {
  'Incision': 'Make your incision on the line.',
  'Spread the muscle': 'Hook the muscle and pull it open.',
  'Clamp the appendix': 'Clamp the base of the appendix. Hold dead still.',
  'Snip it free': 'Snip between the clamps. Not too deep, the gut is right there.',
  'Remove it': 'Grab the appendix and lift it out.',
  'Saw the breastbone': 'Saw along the line, nice and even. The heart is right underneath.',
  'Spread the ribs': 'Hook the edge and pull the chest open.',
  'Clamp the vessels': 'Clamp the vessels. Hold dead still on each one.',
  'Remove the old heart': 'Grab the old heart and lift it out.',
  'Place the new heart': 'Donor heart is in the cooler. Bring it in, gently.',
  'Connect the vessels': 'Reconnect the vessels. Steady hands.',
  'Restart the heart': 'Now restart it. Pump about two beats a second.',
  'Stitch up': 'Close up. In, out, next.',
};
const START = {
  incision: 'Scalpel is in your hand, Doctor. Start at the green dot and follow the line at a steady depth.',
  tumour: 'The tumour sits between the artery and the nerve. Come straight down, slowly.',
  biopsy: 'Match the angle of the blue guide, then hold dead still on the nodule.',
  appendectomy: 'Patient is under. Appendectomy. Let\'s begin.',
  heart: 'Patient is prepped for a heart transplant. Every second counts. Let\'s begin.',
};
const LINES = {
  proc_start: { pri: P.guide, cd: 0, maxAge: 4000, lines: [d => START[d.id] || `${d.title}. Let's begin.`] },
  step_start: { pri: P.guide, cd: 0, maxAge: 4000, lines: [d => (d.index > 0 ? `${TOOL[d.tool] || ''} ` : '') + (STEP[d.name] || d.name + '.')] },
  step_done: { pri: P.chatter, cd: 0, lines: ['Nice.', 'Good work.', 'Clean.', 'That\'s it.', 'Perfect.'] },
  start_at_dot: { pri: P.guide, cd: 6000, lines: ['Start at the green dot.'] },
  halfway: { pri: P.chatter, cd: 0, lines: ['Halfway. Keep it steady.'] },
  off_line: { pri: P.warn, cd: 3500, levels: [['Stay on the line.'], ['Back to the line.'], ['You\'re off the line!']] },
  too_deep: { pri: P.warn, cd: 2500, levels: [['Too deep.'], ['Too deep, ease up!'], ['You\'re too deep, pull up now!']],
    emotions: ['calm', 'determined', 'scared'], speeds: [1.05, 1.15, 1.3] },
  gut_nick: { pri: P.crit, cd: 2500, levels: [['Careful, that\'s the gut!'], ['You\'re in the gut, come up!']], emotions: ['determined', 'scared'], speeds: [1.15, 1.3] },
  near_artery: { pri: P.warn, cd: 4000, levels: [['Careful, the artery is right there.'], ['Watch the artery!'], ['Too close to the artery!']],
    emotions: ['calm', 'determined', 'scared'], speeds: [1.05, 1.15, 1.25] },
  near_nerve: { pri: P.warn, cd: 4000, levels: [['Mind the nerve.'], ['Nerve, careful!']] },
  artery_hit: { pri: P.crit, cd: 2500, levels: [['Bleeder! You hit the artery!'], ['The artery is bleeding, get off it!'], ['Pressure is dropping, move away from the artery!']],
    emotions: ['scared', 'scared', 'scared'], speeds: [1.25, 1.3, 1.35] },
  nerve_hit: { pri: P.crit, cd: 2500, lines: ['Nerve! Back off!', 'You nicked the nerve!'], emotion: 'scared', speed: 1.25 },
  excising: { pri: P.guide, cd: 4000, lines: ['Good, hold it there.', 'That\'s it, hold.'] },
  excised: { pri: P.guide, cd: 0, lines: ['Tumour is out. Withdraw slowly.'], emotion: 'content' },
  hold_start: { pri: P.guide, cd: 2500, lines: [d => d.secs >= 2.5 ? 'Hold it. Three, two, one.' : 'Hold still.'] },
  hold_done: { pri: P.chatter, cd: 0, lines: ['One down.', 'Got it. Next one.'] },
  lost_position: { pri: P.warn, cd: 3000, lines: ['You drifted. Back on it.', 'Lost it. Hold again.'] },
  sample_taken: { pri: P.guide, cd: 0, lines: ['Sample is in. Beautiful.'], emotion: 'content' },
  bad_angle: { pri: P.guide, cd: 8000, lines: [d => `Your angle is off by ${Math.round(d.deg)} degrees. Match the guide.`] },
  saw_nick: { pri: P.crit, cd: 2500, levels: [['Stop! You nicked the heart!'], ['Easy! That\'s the heart under there!']], emotion: 'scared', speed: 1.3 },
  saw_deep_warning: { pri: P.warn, cd: 4000, lines: ['Not so deep with the saw.', 'Shallower. The heart is under there.'] },
  sawing: { pri: P.chatter, cd: 6000, lines: [d => d.pct > 75 ? 'Almost through.' : d.pct > 40 ? 'Halfway through the bone. Keep going.' : 'Good rhythm. Keep sawing.'] },
  hooked: { pri: P.guide, cd: 2000, lines: ['Hooked. Now pull it open.'] },
  drag_drop: { pri: P.warn, cd: 3000, lines: ['You let go. Hook it again.'] },
  grabbed: { pri: P.guide, cd: 2000, lines: [d => d.lift ? 'Got it. Lift it out.' : 'Got it. Bring it over, gently.'] },
  pump: { pri: P.warn, cd: 900, maxAge: 900, lines: [d => d.dir === 'faster' ? 'Faster!' : d.dir === 'slower' ? 'Slower!' : `${d.good}!`], speed: 1.3, emotion: 'determined' },
  stitch: { pri: P.chatter, cd: 1500, lines: [d => d.k >= d.n ? 'Last one. Nice.' : pick1(['Next.', 'Good stitch.', 'Keep going.'])] },
  bypass_on: { pri: P.guide, cd: 0, lines: ['We\'re on bypass. The heart is stopped. Clock is ticking.'], emotion: 'determined' },
  heart_restarted: { pri: P.crit, cd: 0, lines: ['We have a heartbeat! Normal rhythm!'], emotion: 'excited', speed: 1.1 },
  patient_lost: { pri: P.crit, cd: 0, maxAge: 6000, lines: ['We\'ve lost the patient.'], emotion: 'sad', speed: 0.9 },
  proc_end: { pri: P.crit, cd: 0, maxAge: 6000, lines: [d => d.outcome === 'done' ? (d.points >= 800 ? 'Procedure complete. Outstanding work, Doctor.' : 'Procedure complete. Good job, Doctor.') : d.outcome === 'timeout' ? 'Time is up.' : ''] },
  // from the live monitors below
  approach: { pri: P.chatter, cd: 7000, lines: [d => `Getting close to the ${d.what}.`] },
  almost: { pri: P.guide, cd: 6000, lines: [d => `Almost at the ${d.what}. Slow down.`, 'Almost there. Gently.'] },
  too_fast: { pri: P.warn, cd: 3000, levels: [['Easy. Small movements.'], ['Slow down in there!'], ['You\'re moving too fast!']], speeds: [1.05, 1.2, 1.3] },
  tremor: { pri: P.warn, cd: 5000, levels: [['Steady.'], ['You\'re shaking. Breathe.'], ['Steady hands!']] },
  bp_low: { pri: P.warn, cd: 8000, lines: [d => `Blood pressure is ${d.sys} over ${d.dia}.`] },
  bp_critical: { pri: P.crit, cd: 4500, levels: [[d => `Pressure is crashing, ${d.sys} over ${d.dia}!`], ['We\'re losing pressure! Stop the bleeding!'], ['The patient is crashing!']],
    emotions: ['scared', 'scared', 'scared'], speeds: [1.25, 1.3, 1.35], escWindow: 20000 },
  blood_loss: { pri: P.crit, cd: 0, lines: [d => `That's ${d.ml} millilitres of blood loss!`], emotion: 'scared', speed: 1.2 },
  time_call: { pri: P.warn, cd: 0, maxAge: 1500, lines: [d => `${d.words} seconds left.`], emotion: 'determined' },
  count: { pri: P.crit, cd: 0, maxAge: 700, lines: [d => d.words + '!'], speed: 1.25, emotion: 'determined' },
};
const WORDS = { 30: 'Thirty', 15: 'Fifteen', 10: 'Ten', 5: 'Five', 4: 'Four', 3: 'Three', 2: 'Two', 1: 'One' };

// --- speech output: Cartesia via server.js, the browser's own voice as a fallback, or off ---
let mode = 'off', muted = false;
const ttsUrl = u => `/api/tts?text=${encodeURIComponent(u.text)}&emotion=${u.emotion}&speed=${u.speed}`;
fetch('/api/tts/status').then(r => r.json()).then(s => { mode = s.enabled ? 'cartesia' : fallbackMode(); status = s; ui(); prefetchCommon(); })
  .catch(() => { mode = fallbackMode(); ui(); });
let status = null;
function fallbackMode() { return 'speechSynthesis' in window ? 'browser' : 'off'; }

// prefetching fills server.js's cache (one request at a time, so live lines are never queued behind it)
const prefetchQ = [], prefetched = new Set();
let prefetching = false;
function prefetch(text, emotion = 'calm', speed = 1.05) {
  if (mode !== 'cartesia' || !text) return;
  const url = ttsUrl({ text, emotion, speed });
  if (prefetched.has(url)) return;
  prefetched.add(url); prefetchQ.push(url); pump();
}
async function pump() {
  if (prefetching) return;
  prefetching = true;
  while (prefetchQ.length) { try { await (await fetch(prefetchQ.shift())).arrayBuffer(); } catch (e) {} }
  prefetching = false;
}
function variantsOf(ev, data = {}) {
  const s = LINES[ev]; if (!s) return [];
  return (s.levels || [s.lines]).flatMap((pool, lvl) => pool.map(l => [typeof l === 'function' ? l(data) : l, (s.emotions || [])[lvl] || s.emotion || 'calm', (s.speeds || [])[lvl] || s.speed || 1.05]));
}
function prefetchEvents(evs, data) { for (const ev of evs) for (const [t, e, sp] of variantsOf(ev, data)) prefetch(t, e, sp); }
function prefetchCommon() {
  prefetchEvents(['too_deep', 'off_line', 'step_done', 'tremor', 'too_fast', 'lost_position', 'hold_start', 'artery_hit', 'patient_lost']);
  for (const n of [30, 15, 10]) prefetch(`${WORDS[n]} seconds left.`, 'determined', 1.05);
  for (const n of [5, 4, 3, 2, 1]) prefetch(WORDS[n] + '!', 'determined', 1.25);
}
const PREFETCH_FOR = {   // likely lines per procedure / step, fetched as it starts
  tumour: ['near_artery', 'near_nerve', 'nerve_hit', 'excising', 'excised', 'almost'],
  biopsy: ['sample_taken', 'almost', 'bad_angle'],
  'Saw the breastbone': ['sawing', 'saw_nick', 'saw_deep_warning'],
  'Spread the ribs': ['hooked', 'drag_drop'], 'Spread the muscle': ['hooked', 'drag_drop'],
  'Remove the old heart': ['grabbed'], 'Place the new heart': ['grabbed'], 'Remove it': ['grabbed'],
  'Restart the heart': ['pump', 'heart_restarted'], 'Stitch up': ['stitch'], 'Snip it free': ['gut_nick'],
};

// --- the director ---
const st = { cur: null, pending: null, last: {}, lastText: {}, esc: {} };
function trigger(ev, data = {}) {
  const spec = LINES[ev];
  if (!spec || mode === 'off' || muted) return;
  const now = performance.now();
  if (now - (st.last[ev] ?? -1e9) < (spec.cd ?? 3000)) return;
  let level = 0;
  if (spec.levels) {   // repeating a mistake soon after escalates the wording and urgency
    const e = st.esc[ev];
    level = e && now - e.t < (spec.escWindow || 12000) ? Math.min(e.lvl + 1, spec.levels.length - 1) : 0;
    st.esc[ev] = { lvl: level, t: now };
  }
  const pool = (spec.levels ? spec.levels[level] : spec.lines).map(l => (typeof l === 'function' ? l(data) : l)).filter(Boolean);
  if (!pool.length) return;
  let text = pick1(pool);
  if (pool.length > 1 && text === st.lastText[ev]) text = pool.find(t => t !== text);   // don't say the same thing twice running
  st.last[ev] = now; st.lastText[ev] = text;
  speak({ ev, text, pri: spec.pri, t: now, maxAge: spec.maxAge ?? (spec.pri >= P.crit ? 4000 : 1800),
    emotion: (spec.emotions || [])[level] || spec.emotion || 'calm', speed: (spec.speeds || [])[level] || spec.speed || 1.05 });
}
function speak(u) {
  if (!st.cur) return play(u);
  if (u.pri > st.cur.pri) { stopCurrent(); return play(u); }   // more urgent: interrupt
  if (!st.pending || u.pri >= st.pending.pri) st.pending = u;    // otherwise keep the most important line waiting (newest on ties)
}
function next() {
  st.cur = null;
  const u = st.pending; st.pending = null;
  if (u && performance.now() - u.t < u.maxAge) setTimeout(() => { if (!st.cur) play(u); else speak(u); }, 120);
}
function stopCurrent() {
  const c = st.cur; st.cur = null;
  if (!c) return;
  if (c.audio) { c.audio.onended = c.audio.onerror = null; c.audio.pause(); c.audio.removeAttribute('src'); }
  if (c.utter && 'speechSynthesis' in window) speechSynthesis.cancel();
}
function play(u) {
  st.cur = u;
  caption(u);
  OR.logEvent({ event: 'or_voice', line: u.ev, text: u.text, voice: mode });
  if (mode === 'cartesia') {
    const a = new Audio(ttsUrl(u));   // streams: starts playing as the first bytes arrive
    u.audio = a;
    a.onended = () => { if (st.cur === u) next(); };
    a.onerror = () => { if (st.cur === u) next(); };
    a.play().catch(() => { if (st.cur === u) next(); });
  } else if (mode === 'browser') {
    const s = new SpeechSynthesisUtterance(u.text);
    s.rate = u.speed; u.utter = s;
    s.onend = s.onerror = () => { if (st.cur === u) next(); };
    speechSynthesis.speak(s);
  } else next();
}

// --- captions and the voice button ---
const css = document.createElement('style');
css.textContent = `
  #or .voicebtn { position: absolute; bottom: 14px; left: 228px; margin: 0; font: 900 14px ui-rounded, system-ui; padding: 8px 16px; color: var(--ink);
                  background: var(--paper); border: 4px solid var(--ink); border-radius: 999px; box-shadow: 0 5px 0 var(--ink); cursor: pointer; }
  #or .voicebtn.on { background: #ffc24d; }
  #or .caption { position: absolute; left: 50%; bottom: 74px; transform: translateX(-50%); max-width: min(720px, 80vw); text-align: center; pointer-events: none;
                 font: 800 19px ui-rounded, system-ui; padding: 8px 18px; border-radius: 16px; background: #2b2540e6; color: #fff;
                 border: 3px solid var(--ink); opacity: 0; transition: opacity .25s; }
  #or .caption.show { opacity: 1; }
  #or .caption.p2 { background: #c9762ae6; } #or .caption.p3 { background: #c8102ee6; }
  #or .caption b { color: #9be7ff; }
`;
document.head.appendChild(css);
const btn = document.createElement('button'); btn.className = 'voicebtn';
const cap = document.createElement('div'); cap.className = 'caption';
OR.root.appendChild(btn); OR.root.appendChild(cap);
function ui() {
  const label = muted ? 'muted' : mode === 'cartesia' ? 'Cartesia' : mode === 'browser' ? 'browser voice' : 'off';
  btn.textContent = `🔊 Riley: ${label}`;
  btn.classList.toggle('on', !muted && mode === 'cartesia');
  btn.title = mode === 'cartesia' ? `Cartesia ${status && status.model} · voice ${status && status.voice}` : 'Run node server.js with CARTESIA_API_KEY set for the Cartesia voice';
}
ui();
btn.onclick = () => { muted = !muted; if (muted) { stopCurrent(); st.pending = null; } ui(); };
let capTimer = 0;
function caption(u) {
  cap.innerHTML = `<b>Riley:</b> ${u.text.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}`;
  cap.className = `caption show p${u.pri}`;
  clearTimeout(capTimer);
  capTimer = setTimeout(() => cap.classList.remove('show'), 1500 + 55 * u.text.length);
}

// --- game events ---
addEventListener('or-event', e => {
  const { type, data } = e.detail;
  if (type === 'proc_start') {
    resetMonitors();
    prefetchEvents(PREFETCH_FOR[data.id] || []);
  }
  if (type === 'step_start') prefetchEvents(PREFETCH_FOR[data.name] || [], data);
  if (type === 'proc_end' && data.outcome !== 'lost') { stopCurrent(); st.pending = null; }   // the result line replaces whatever was playing
  trigger(type, data);
});

// --- live monitors (each tracking sample): approach, hand speed, tremor, vitals, clock ---
let mon;
function resetMonitors() { mon = { zone: 3, fast: 0, prevTip: null, bp: 0, lossMark: 0, lastSecs: null }; }
resetMonitors();
addEventListener('magnet', () => {
  if (!OR.playing || !OR.tip) { if (mon) mon.prevTip = null; return; }
  const tip = OR.tip, t = OR.target, S = OR.SURFACE;
  // approaching the target: speak on entering each closer zone (with hysteresis so it doesn't chatter)
  if (t) {
    const zone = t.d < 0.8 ? 1 : t.d < 2.5 ? 2 : 3;
    if (zone < mon.zone) { if (zone === 2) trigger('approach', { what: t.what }); else trigger('almost', { what: t.what }); }
    if (zone < mon.zone || t.d > (mon.zone === 1 ? 1.2 : 3.0)) mon.zone = zone;
    // shaking while settled on a target
    if (t.d < 0.3) { const tr = OR.tremorMm(); if (tr > 1.2) trigger('tremor'); }
  } else mon.zone = 3;
  // moving fast while inside the patient
  if (mon.prevTip && tip[1] < S) {
    const v = M.norm(M.sub(tip, mon.prevTip)) / OR.SAMPLE_DT;   // cm/s
    mon.fast = v > 9 ? mon.fast + 1 : 0;
    if (mon.fast >= 3) { trigger('too_fast'); mon.fast = 0; }
  }
  mon.prevTip = tip.slice();
  // vitals: warn as pressure falls, shout when it crashes, call out big blood loss
  const v = OR.vitals(), pt = OR.pt;
  if (!pt.lost) {
    const sys = Math.round(v.sys), dia = Math.round(v.dia);
    const band = sys < 85 ? 2 : sys < 100 ? 1 : 0;
    if (band === 2) trigger('bp_critical', { sys, dia });
    else if (band === 1 && mon.bp < 1) trigger('bp_low', { sys, dia });
    mon.bp = band;
    const mark = pt.loss >= 1000 ? 1000 : pt.loss >= 500 ? 500 : 0;
    if (mark > mon.lossMark) { mon.lossMark = mark; trigger('blood_loss', { ml: mark }); }
  }
  // the clock: 30, 15, 10 seconds left, then a countdown from five
  const left = OR.timeLeft();
  if (left !== null) {
    const s = Math.ceil(left);
    if (s !== mon.lastSecs) {
      if ([30, 15, 10].includes(s)) trigger('time_call', { words: WORDS[s] });
      else if (s >= 1 && s <= 5) trigger('count', { words: WORDS[s] });
      mon.lastSecs = s;
    }
  }
});
})();
