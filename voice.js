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
// Riley talks like a senior surgeon at your shoulder: the instrument comes with the instruction, and the instruction
// says why ("the bowel's right underneath"). The game's own on-screen prompts are not read out word for word.
// lines: variants (strings or data => string); levels: escalating variants for repeats within escWindow (ms);
// cd: cooldown (ms) for this event; emotion/speed (or per-level emotions/speeds) go to Cartesia.
const STEP = {   // each step's opening, instrument handover included
  'Incision': ['Let\'s open up. Blade in at the green dot, then just follow the line. Nice and shallow.',
    'Right, first cut. Start at the green dot and follow the line, gently does it.'],
  'Spread the muscle': ['Okay, here\'s the retractor. Catch the edge of the muscle and ease it apart for me.',
    'Retractor now. Hook the muscle and draw it open, nice and slowly.'],
  'Clamp the appendix': ['Clamp next. There\'s the appendix, angry little thing. Get the clamp right at its base and keep your hand still.',
    'Now the clamp. Right at the base of the appendix, and hold nice and still while it bites.'],
  'Snip it free': ['Back to the scalpel. Cut between the clamps, but keep it shallow, the bowel\'s sitting just underneath.',
    'Scalpel again. Snip it free between the clamps. Easy on the depth, there\'s gut right below.'],
  'Remove it': ['Forceps. Take hold of the appendix and lift it straight out.',
    'Okay, forceps. Grab it and lift it clear.'],
  'Saw the breastbone': ['Here\'s the saw. Long, even strokes down the breastbone, and don\'t go deep, the heart is right under there.',
    'Saw now. Nice steady strokes along the line. Keep it shallow, yeah? The heart\'s just below.'],
  'Spread the ribs': ['Retractor. Hook the edge and open the chest up for me.',
    'Let\'s get some room in there. Hook the ribs with the retractor and pull them apart, slowly.'],
  'Clamp the vessels': ['Clamps. One on each vessel, and stay dead still while each one closes.',
    'Now we clamp the vessels. Find each one and keep your hand still while it takes.'],
  'Remove the old heart': ['Forceps. Take hold of the old heart and lift it out, gently.',
    'Okay, the old heart comes out. Get a grip on it and lift it clear.'],
  'Place the new heart': ['Donor heart\'s in the cooler. Bring it across and set it in, gently, gently.',
    'Here comes the new one. Take it from the cooler and lower it into place.'],
  'Connect the vessels': ['Needle driver. Sew each vessel back on, and hold steady while the knot sets.',
    'Let\'s hook it up. One vessel at a time, steady hands.'],
  'Restart the heart': ['Moment of truth. Hands on the heart, and pump. About two beats a second.',
    'Now let\'s get it going. Press and release, about two a second. Come on.'],
  'Stitch up': ['Nearly there. Needle driver, let\'s close. Little stitches, work your way along.',
    'Right, let\'s close up. In, out, and on to the next one.'],
};
const ACK = ['Lovely.', 'Nice work.', 'Good.', 'That\'s it.', 'Beautiful.', 'Brilliant.'];   // said before the next step's opening
const START = {
  incision: 'Okay, Doctor, scalpel\'s in your hand. Start at the green dot and follow the line at an even depth. Take your time.',
  tumour: 'Right. The tumour sits between the artery and the nerve, so come straight down and take it slowly.',
  biopsy: 'See the blue guide? Line your needle up with it, go in, and then hold perfectly still on the nodule.',
  appendectomy: 'Okay, patient\'s asleep. We\'re taking out an inflamed appendix. Nice and calm, let\'s begin.',
  heart: 'Right, everyone, heart transplant. The donor heart won\'t wait, so we keep moving. Ready when you are.',
};
const LINES = {
  proc_start: { pri: P.guide, cd: 0, maxAge: 4000, speed: 1, lines: [d => START[d.id] || `${d.title}. Let's begin.`] },
  // waits behind the opening line, so it can be stale for longer
  step_start: { pri: P.guide, cd: 0, maxAge: 9000, speed: 1, lines: [d => (d.index > 0 ? pick1(ACK) + ' ' : '') + (STEP[d.name] ? pick1(STEP[d.name]) : d.name + '.')] },
  start_at_dot: { pri: P.guide, cd: 6000, lines: ['Ah, start from the green dot.', 'Begin at the green dot, just there.'] },
  halfway: { pri: P.chatter, cd: 0, lines: ['That\'s halfway. Lovely, keep that going.', 'Halfway there. Same again.'] },
  off_line: { pri: P.warn, cd: 3500, levels: [['Drifting a bit. Back to the line.', 'Little off there, bring it back.'], ['Back onto the line, please.'], ['You\'re well off the line, come back!']] },
  too_deep: { pri: P.warn, cd: 2500, levels: [['Bit deep. Come up a touch.', 'Ease up, you\'re a little deep.'], ['Too deep, lift up!'], ['Up, up, you\'re far too deep!']],
    emotions: ['calm', 'determined', 'scared'], speeds: [1.05, 1.15, 1.3] },
  gut_nick: { pri: P.crit, cd: 2500, levels: [['Careful, that\'s bowel!'], ['You\'re in the bowel, come up now!']], emotions: ['determined', 'scared'], speeds: [1.15, 1.3] },
  near_artery: { pri: P.warn, cd: 4000, levels: [['Careful, the artery\'s just there.', 'Easy, you\'re right by the artery.'], ['Watch the artery!'], ['Too close to the artery, back off!']],
    emotions: ['calm', 'determined', 'scared'], speeds: [1.05, 1.15, 1.25] },
  near_nerve: { pri: P.warn, cd: 4000, levels: [['Mind the nerve.', 'Gently, the nerve is right there.'], ['Nerve, careful!']] },
  artery_hit: { pri: P.crit, cd: 2500, levels: [['Bleeder! You\'ve hit the artery!'], ['It\'s bleeding, get off the artery!'], ['Pressure\'s falling, come away from the artery!']],
    emotions: ['scared', 'scared', 'scared'], speeds: [1.25, 1.3, 1.35] },
  nerve_hit: { pri: P.crit, cd: 2500, lines: ['Ah, that\'s the nerve! Back off!', 'You\'ve nicked the nerve!'], emotion: 'scared', speed: 1.25 },
  excising: { pri: P.guide, cd: 4000, lines: ['Good, hold it right there.', 'That\'s it, stay with it.'] },
  excised: { pri: P.guide, cd: 0, lines: ['Tumour\'s out. Lovely. Now come out nice and slowly.'], emotion: 'content' },
  hold_start: { pri: P.guide, cd: 2500, lines: [d => d.secs >= 2.5 ? 'Hold it there. Three, two, one.' : pick1(['Hold still.', 'Stay right there.', 'And hold.'])] },
  hold_done: { pri: P.chatter, cd: 0, lines: ['That\'s one.', 'Good. Next one.', 'Lovely, on to the next.'] },
  lost_position: { pri: P.warn, cd: 3000, lines: ['Ooh, you slipped. Find it again.', 'Drifted off. Back on and hold.'] },
  sample_taken: { pri: P.guide, cd: 0, lines: ['Got the sample. Beautiful work.'], emotion: 'content' },
  bad_angle: { pri: P.guide, cd: 8000, lines: [d => `You're about ${Math.round(d.deg)} degrees off. Tilt to match the blue guide.`] },
  saw_nick: { pri: P.crit, cd: 2500, levels: [['Stop! You\'ve nicked the heart!'], ['Easy! The heart is right under there!']], emotion: 'scared', speed: 1.3 },
  saw_deep_warning: { pri: P.warn, cd: 4000, lines: ['Shallower with the saw.', 'Not so deep, the heart\'s under there.'] },
  sawing: { pri: P.chatter, cd: 6000, lines: [d => d.pct > 75 ? 'Almost through, keep going.' : d.pct > 40 ? 'Halfway through the bone. Good rhythm.' : 'That\'s it, nice long strokes.'] },
  hooked: { pri: P.guide, cd: 2000, lines: ['That\'s got it. Now draw it open.', 'Hooked. Pull it apart, slowly.'] },
  drag_drop: { pri: P.warn, cd: 3000, lines: ['Lost it. Hook it again, and keep it down.', 'It slipped off. Catch it again.'] },
  grabbed: { pri: P.guide, cd: 2000, lines: [d => d.lift ? pick1(['Got it. Up and out.', 'You\'ve got it. Lift it clear.']) : pick1(['Got it. Bring it across, gently.', 'Okay, carry it over, nice and slow.'])] },
  pump: { pri: P.warn, cd: 900, maxAge: 900, lines: [d => d.dir === 'faster' ? 'Faster, push!' : d.dir === 'slower' ? 'Bit slower.' : `${d.good}!`], speed: 1.3, emotion: 'determined' },
  stitch: { pri: P.chatter, cd: 1500, lines: [d => d.k >= d.n ? 'And that\'s the last one. Lovely.' : pick1(['Next.', 'Good stitch.', 'And the next.', 'Nice, keep going.'])] },
  bypass_on: { pri: P.guide, cd: 0, lines: ['Okay, we\'re on bypass. The heart\'s stopped now, so the clock is running.'], emotion: 'determined' },
  heart_restarted: { pri: P.crit, cd: 0, lines: ['There it is! We\'ve got a heartbeat!'], emotion: 'excited', speed: 1.1 },
  patient_lost: { pri: P.crit, cd: 0, maxAge: 6000, lines: ['We\'ve lost the patient.'], emotion: 'sad', speed: 0.9 },
  proc_end: { pri: P.crit, cd: 0, maxAge: 6000, lines: [d => d.outcome === 'done' ? (d.points >= 800 ? 'And we\'re done. Outstanding work, Doctor.' : 'That\'s it, we\'re done. Good job, Doctor.') : d.outcome === 'timeout' ? 'That\'s time, I\'m afraid.' : ''] },
  // from the live monitors below
  approach: { pri: P.chatter, cd: 7000, lines: [d => `Getting close to the ${d.what} now.`, d => `The ${d.what} is just ahead.`] },
  almost: { pri: P.guide, cd: 6000, lines: [d => `Nearly at the ${d.what}. Slow right down.`, 'Almost there. Gently now.'] },
  too_fast: { pri: P.warn, cd: 3000, levels: [['Easy. Small movements.', 'Slow it down a little.'], ['Slow down in there!'], ['You\'re moving far too fast!']], speeds: [1.05, 1.2, 1.3] },
  tremor: { pri: P.warn, cd: 5000, levels: [['Nice and steady.', 'Steady now.'], ['Bit of a shake there. Breathe.'], ['Steady hands!']] },
  bp_low: { pri: P.warn, cd: 8000, lines: [d => `Pressure's drifting down. ${d.sys} over ${d.dia}.`] },
  bp_critical: { pri: P.crit, cd: 4500, levels: [[d => `Pressure's crashing, ${d.sys} over ${d.dia}!`], ['We\'re losing pressure, stop the bleeding!'], ['The patient is crashing!']],
    emotions: ['scared', 'scared', 'scared'], speeds: [1.25, 1.3, 1.35], escWindow: 20000 },
  blood_loss: { pri: P.crit, cd: 0, lines: [d => `We've lost ${d.ml} millilitres of blood!`], emotion: 'scared', speed: 1.2 },
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
  prefetchEvents(['too_deep', 'off_line', 'tremor', 'too_fast', 'lost_position', 'hold_start', 'artery_hit', 'patient_lost']);
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
