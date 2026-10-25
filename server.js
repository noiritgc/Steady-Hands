#!/usr/bin/env node
// MagTrack local server: serves the viewer and proxies text-to-speech to Cartesia, so the API key stays on this
// machine (CARTESIA_API_KEY in the environment, or in a git-ignored .env file) and never reaches the browser or repo.
//   CARTESIA_API_KEY=sk_car_... node server.js      then open http://localhost:8765/viewer.html
// Optional: CARTESIA_VOICE_ID (default "Clive"), CARTESIA_MODEL (default sonic-3.6), PORT.
// No dependencies (Node 18+). Listens on 127.0.0.1 only, so nobody else on the network can spend your credits.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
loadDotEnv(path.join(ROOT, '.env'));
const PORT = +(process.env.PORT || 8765);
const KEY = process.env.CARTESIA_API_KEY || '';
const MODEL = process.env.CARTESIA_MODEL || 'sonic-3.6';
const API = process.env.CARTESIA_API_BASE || 'https://api.cartesia.ai';   // overridable for testing against a mock
const VERSION = '2026-08-14';
const EMOTIONS = new Set(['neutral', 'calm', 'angry', 'content', 'sad', 'scared', 'happy', 'excited', 'determined']);
const MAX_TEXT = 240, MAX_CACHE = 400, MAX_INFLIGHT = 4;
// Riley's voice: "Clive", a composed, articulate British (en-GB) voice from the Cartesia library
const DEFAULT_VOICE = { id: 'b24f41fd-00a3-4cd8-992a-a0c9f13f3ef1', name: 'Clive' };
const VOICE_ID = process.env.CARTESIA_VOICE_ID || DEFAULT_VOICE.id;
let voice = { id: VOICE_ID, name: VOICE_ID === DEFAULT_VOICE.id ? DEFAULT_VOICE.name : '' };

function loadDotEnv(file) {   // KEY=value lines; real environment variables win
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return; }
  for (const line of text.split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
const cartesia = (p, opts = {}) => fetch(API + p, {
  ...opts, headers: { Authorization: `Bearer ${KEY}`, 'Cartesia-Version': VERSION, 'Content-Type': 'application/json', ...(opts.headers || {}) },
});

// Look up the configured voice's name for the status line (the voices API is searched by ID).
async function chooseVoice() {
  if (!KEY || voice.name) return;
  try {
    const r = await cartesia(`/voices?q=${encodeURIComponent(voice.id)}&limit=1`);
    const v = r.ok && ((await r.json()).data || [])[0];
    if (v && v.id === voice.id) voice.name = v.name;
  } catch (e) { console.warn('Could not look up the voice:', e.message); }
}

// --- speech: GET /api/tts?text=...&emotion=calm&speed=1.1 -> MP3, streamed as it arrives ---
const cache = new Map();   // recent lines, so repeated callouts play instantly and cost nothing
let inflight = 0;
async function tts(req, res, q) {
  const text = (q.get('text') || '').trim().slice(0, MAX_TEXT);
  const emotion = EMOTIONS.has(q.get('emotion')) ? q.get('emotion') : 'neutral';
  const speed = Math.min(1.5, Math.max(0.6, +q.get('speed') || 1));
  if (!KEY) return send(res, 503, { error: 'CARTESIA_API_KEY is not set' });
  if (!text) return send(res, 400, { error: 'text is required' });
  const ck = `${voice.id}|${emotion}|${speed}|${text}`;
  if (cache.has(ck)) {
    const buf = cache.get(ck); cache.delete(ck); cache.set(ck, buf);   // keep it fresh in the LRU
    res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': buf.length, 'Cache-Control': 'no-store', 'X-Cache': 'hit' });
    return res.end(buf);
  }
  if (inflight >= MAX_INFLIGHT) return send(res, 429, { error: 'busy' });
  inflight++;
  try {
    const r = await cartesia('/tts/bytes', {
      method: 'POST',
      body: JSON.stringify({
        model_id: MODEL, transcript: text, voice: { id: voice.id }, language: 'en',
        output_format: { container: 'mp3', sample_rate: 24000, bit_rate: 64000 },   // small and quick to start playing
        generation_config: { speed, emotion },
      }),
    });
    if (!r.ok) {
      const detail = (await r.text()).slice(0, 300);
      console.warn(`Cartesia ${r.status}: ${detail}`);
      return send(res, r.status === 401 ? 401 : 502, { error: `Cartesia returned ${r.status}` });
    }
    res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', 'X-Cache': 'miss' });
    const parts = [];
    for await (const chunk of r.body) { parts.push(chunk); res.write(chunk); }   // the browser starts playing on the first bytes
    res.end();
    cache.set(ck, Buffer.concat(parts));
    if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
  } catch (e) {
    console.warn('TTS failed:', e.message);
    if (!res.headersSent) send(res, 502, { error: 'could not reach Cartesia' }); else res.end();
  } finally { inflight--; }
}

// --- static files ---
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css', '.json': 'application/json', '.log': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };
function serveFile(res, urlPath) {
  const rel = decodeURIComponent(urlPath === '/' ? '/viewer.html' : urlPath);
  const file = path.normalize(path.join(ROOT, rel));
  // only files inside the project, and never dotfiles (.env holds the key, .git the history)
  if (!file.startsWith(ROOT + path.sep) || path.relative(ROOT, file).split(path.sep).some(p => p.startsWith('.')))
    return send(res, 404, { error: 'not found' });
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}
function send(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/api/tts/status') return send(res, 200, { enabled: !!KEY && !!voice.id, model: MODEL, voice: voice.name || voice.id });
  if (u.pathname === '/api/tts' && req.method === 'GET') return tts(req, res, u.searchParams);
  if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' });
  serveFile(res, u.pathname);
}).listen(PORT, '127.0.0.1', async () => {
  await chooseVoice();
  console.log(`MagTrack: http://localhost:${PORT}/viewer.html`);
  console.log(KEY ? `Voice: Cartesia ${MODEL}, voice ${voice.name || voice.id}` : 'Voice: off (set CARTESIA_API_KEY in the environment or .env)');
});
