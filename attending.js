// Steady Hands "AI attending": after each procedure, Claude reviews the game's own measurements (points per step,
// mm off the line, tremor, angle error, blood loss, vessel hits) plus the trainee's recent attempts, and gives a short
// debrief: what went well, the one thing to fix (tied to a measured number), and which drill to do next.
// The game keeps the score; Claude only explains it. Uses the official Anthropic SDK straight from the browser, with
// an API key the player pastes in, stored only in this browser's localStorage (never in the repo or recordings).
(function () {
'use strict';
const OR = window.SteadyHands;
if (!OR) return;
const MODEL = 'claude-sonnet-5-5';   // Sonnet: plenty for a short debrief, and easier on API credits than Opus
const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.133.0/+esm';
const KEY_STORE = 'magtrack.anthropicKey';
// Who the trainee is: the debrief's tone and level follow this. Adjust it to the community you're building for.
const TRAINEE = 'a medical student or junior surgical trainee practising fine-motor skills without access to a surgical simulator';
const TEACHES = {
  incision: 'tracing a line at a constant depth (depth control, path accuracy)',
  tumour: 'reaching a target between an artery and a nerve (spatial precision, avoiding structures)',
  biopsy: 'inserting at a set angle and holding still (angle control, tremor)',
  appendectomy: 'a full 6-step operation (sequencing several instruments)',
  heart: 'a full 9-step operation (sawing rhythm, retraction, steady holds, pumping rhythm)',
  gallbladder: 'a 9-step keyhole operation (port placement, fine dissection near the common bile duct, clip placement)',
  csection: 'a 10-step caesarean (depth control over the baby, delivery, cord clamps, layered closure)',
  hip: 'a 10-step hip replacement (sawing, circular reaming at a set depth, hammer rhythm, avoiding the sciatic nerve)',
  kidney: 'a 9-step kidney transplant (vessel clamps, fine anastomosis stitches, steady holds)',
  spleen: 'a 10-step trauma splenectomy under time pressure (suction, packing, clamping while the patient bleeds)',
};
const SYSTEM = `You are the attending surgeon in Steady Hands, a cartoon surgical-skills training game. The trainee holds a small magnet stack like an instrument; a sensor board tracks it in 3D, so the game measures their real hand: path accuracy, depth control, tool angle, steadiness (tremor) and timing. Lowering the tip below the virtual tissue surface cuts or touches; the patient's vitals react to mistakes.

The trainee is ${TRAINEE}.

You get the game's measurements for the attempt they just finished, and their recent attempts. You also get motion analysis of the tracked instrument tip, the hand-motion measures used in surgical-skills assessment, with their earlier completed runs of the same procedure (oldest first) and the change versus their recent average:
- path_cm: total distance the tip travelled. Shorter for the same task = more economical motion.
- moves: number of distinct movements. Fewer = more deliberate.
- idle_s: time spent still while hovering above the tissue (hesitation). Intentional holds in the tissue are not counted.
- sparc: smoothness of each movement (spectral arc length). Closer to 0 is smoother; a single smooth reach is about -1.6.
Progress over repeated runs matters more than any single number: say what improved, if anything did.

Debrief them the way a good attending does at the end of a case: brief, specific and encouraging. Name what went well, then the single most useful thing to fix next time, tied to a number from the data and to what to do with their hands. Then pick the drill that best trains that weakness.

Use only the numbers provided; never invent measurements or change the score. This is a training game, not medical advice, so don't give clinical guidance about real patients.`;

const SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string', description: 'One-sentence verdict on this attempt, under 15 words.' },
    went_well: { type: 'array', items: { type: 'string' }, description: 'One or two specific strengths, each under 15 words.' },
    fix: { type: 'string', description: 'The one thing to fix next time: cite the measured number and say what to do with the hands. Under 40 words.' },
    drill: { type: 'string', description: 'id of the drill to do next' },
    drill_reason: { type: 'string', description: 'Why that drill, under 20 words.' },
  },
  required: ['headline', 'went_well', 'fix', 'drill', 'drill_reason'],
  additionalProperties: false,
};

// --- key and button ---
const getKey = () => { try { return localStorage.getItem(KEY_STORE) || ''; } catch (e) { return ''; } };
const css = document.createElement('style');
css.textContent = `
  #or .att { position: absolute; bottom: 14px; left: 18px; margin: 0; font: 900 14px ui-rounded, system-ui; padding: 8px 16px; color: var(--ink);
             background: var(--paper); border: 4px solid var(--ink); border-radius: 999px; box-shadow: 0 5px 0 var(--ink); cursor: pointer; }
  #or .att.on { background: #5bd68a; }
  #or .attpanel { position: absolute; bottom: 70px; left: 18px; width: min(380px, 90vw); background: var(--paper); border: 4px solid var(--ink);
                  border-radius: 20px; box-shadow: 0 8px 0 var(--ink); padding: 14px 16px; display: none; font-weight: 600; }
  #or .attpanel p { margin: 4px 0 8px; color: #5b5470; font-size: 13px; line-height: 1.4; }
  #or .attpanel input { width: 100%; box-sizing: border-box; font: 600 14px ui-monospace, monospace; padding: 8px 12px; border: 3px solid var(--ink); border-radius: 12px; }
  #or .attpanel button { margin: 10px 8px 0 0; font: 900 14px ui-rounded, system-ui; padding: 7px 14px; border: 3px solid var(--ink); border-radius: 999px;
                         background: #ffc24d; box-shadow: 0 4px 0 var(--ink); cursor: pointer; color: var(--ink); }
  #or .debrief { margin-top: 14px; padding: 12px 14px; border: 3px dashed #c9c2e4; border-radius: 16px; background: #f7f4ff; }
  #or .debrief h3 { margin: 0 0 6px; font: 900 16px ui-rounded, system-ui; }
  #or .debrief .head { font: 900 18px ui-rounded, system-ui; margin: 2px 0 8px; }
  #or .debrief ul { margin: 4px 0 8px 18px; padding: 0; font-weight: 700; }
  #or .debrief .fix { background: #fff3d1; border-radius: 10px; padding: 8px 10px; font-weight: 700; }
  #or .debrief .muted { color: #7a7394; font-weight: 600; font-size: 13px; }
  #or .debrief button { background: #9be7ff; }
`;
document.head.appendChild(css);
const btn = document.createElement('button');
btn.className = 'att';
const panel = document.createElement('div');
panel.className = 'attpanel';
panel.innerHTML = `<b>🩺 AI attending</b>
  <p>After each procedure, Claude reviews your measured results and tells you what to fix and which drill to do next. Paste an Anthropic API key;
  it stays in this browser only (and is sent only to Anthropic). Don't use this on a shared or public computer.</p>
  <input id="att-key" type="password" placeholder="sk-ant-..." autocomplete="off">
  <button data-att="save">Save</button><button data-att="remove">Remove key</button><button data-att="close">Close</button>`;
OR.root.appendChild(btn);
OR.root.appendChild(panel);
const refreshBtn = () => { const on = !!getKey(); btn.textContent = on ? '🩺 AI attending: on' : '🩺 AI attending: off'; btn.classList.toggle('on', on); };
refreshBtn();
btn.onclick = () => { panel.style.display = panel.style.display === 'block' ? 'none' : 'block'; panel.querySelector('#att-key').value = ''; };
panel.addEventListener('click', e => {
  const a = e.target.dataset && e.target.dataset.att;
  if (!a) return;
  try {
    if (a === 'save') { const k = panel.querySelector('#att-key').value.trim(); if (k) localStorage.setItem(KEY_STORE, k); }
    if (a === 'remove') localStorage.removeItem(KEY_STORE);
  } catch (err) {}
  client = null; panel.style.display = 'none'; refreshBtn();
});

// --- Claude ---
let sdk = null, client = null;
async function getClient() {
  if (!sdk) sdk = import(SDK_URL).then(m => m.default);   // loaded on first use; needs internet like the API itself
  const Anthropic = await sdk;
  if (!client) client = new Anthropic({ apiKey: getKey(), dangerouslyAllowBrowser: true });   // key is the player's own, kept locally
  return { Anthropic, client };
}

const recent = [];   // this session's attempts, newest last, so the attending can see progress
function summarize(res, rows) {
  const r1 = x => typeof x === 'number' ? Math.round(x * 10) / 10 : x;
  const mo = m => m && { path_cm: r1(m.pathCm), moves: m.moves, idle_s: r1(m.idleS), sparc: m.sparc == null ? null : Math.round(m.sparc * 100) / 100, time_s: r1(m.time), points: m.points };
  return {
    procedure: res.title, outcome: res.outcome, points: res.points, grade: res.grade,
    measurements: rows.map(r => ({ item: r[0], value: r[1], points: Math.round(r[2]) })),
    motion: mo(res.motion),
    change_vs_recent_average_pct: Object.fromEntries(Object.entries(res.progress || {}).map(([k, c]) => [k, Math.round(c.changePct)])),
    earlier_runs_of_this_procedure: (OR.history ? OR.history() : []).filter(h => h.id === res.id && h.outcome === 'done' && h.m).slice(-6, -1).map(h => mo(h.m)),
  };
}

async function debrief(res, rows) {
  const box = document.getElementById('or-debrief');
  if (!box) return;
  const attempt = summarize(res, rows);
  const drills = OR.procs().map(p => ({ id: p.id, title: p.title, teaches: TEACHES[p.id] || '' }));
  const history = recent.slice(-4);
  recent.push(attempt);
  refreshBtn();
  if (!getKey()) {
    box.innerHTML = '<div class="debrief"><span class="muted">🩺 Turn on the AI attending (bottom left) to get a personal debrief after each procedure.</span></div>';
    return;
  }
  box.innerHTML = '<div class="debrief"><h3>🩺 Attending debrief</h3><span class="muted">The attending is reviewing your case…</span></div>';
  try {
    const { Anthropic, client } = await getClient();
    const schema = { ...SCHEMA, properties: { ...SCHEMA.properties, drill: { ...SCHEMA.properties.drill, enum: drills.map(d => d.id) } } };
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: 'low', format: { type: 'json_schema', schema } },   // a short debrief: keep it quick
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',   // if a safety check misfires on surgical wording, the API retries on its recommended model
      system: SYSTEM,
      messages: [{ role: 'user', content: JSON.stringify({ attempt, recent_attempts: history, available_drills: drills }) }],
    });
    if (document.getElementById('or-debrief') !== box) return;   // the player moved on
    if (response.stop_reason === 'refusal') {
      box.innerHTML = '<div class="debrief"><span class="muted">The attending couldn\'t review this one. Try another procedure.</span></div>';
      return;
    }
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const d = JSON.parse(text);
    const drill = OR.procs().find(p => p.id === d.drill);
    const esc = s => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
    box.innerHTML = `<div class="debrief"><h3>🩺 Attending debrief</h3>
      <div class="head">${esc(d.headline)}</div>
      ${d.went_well.length ? `<ul>${d.went_well.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      <div class="fix">Fix next: ${esc(d.fix)}</div>
      ${drill ? `<p class="muted">Next drill: <b>${esc(drill.title)}</b>. ${esc(d.drill_reason)}</p><button data-go="${drill.index}">Practise ${esc(drill.title.replace(/^.* · /, ''))}</button>` : ''}</div>`;
    OR.logEvent({ event: 'or_debrief', procedure: res.id, debrief: d, model: response.model });
  } catch (err) {
    const { Anthropic } = sdk ? { Anthropic: await sdk.catch(() => null) } : { Anthropic: null };
    let why = 'no internet connection, or the SDK couldn\'t load.';
    if (Anthropic && err instanceof Anthropic.AuthenticationError) why = 'the API key was rejected. Check it with the 🩺 button.';
    else if (Anthropic && err instanceof Anthropic.RateLimitError) why = 'too many requests right now. Try again in a moment.';
    else if (Anthropic && err instanceof Anthropic.APIError && err.status) why = `the API returned an error (${err.status}).`;
    else if (err instanceof SyntaxError) why = 'the reply couldn\'t be read.';
    if (document.getElementById('or-debrief') === box)
      box.innerHTML = `<div class="debrief"><span class="muted">🩺 No debrief: ${why}</span></div>`;
    console.warn('attending:', err);
  }
}
OR.onResult = (res, rows) => { debrief(res, rows); };
})();
