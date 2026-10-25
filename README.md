# MagTrack

Five MLX90393 3-axis magnetometers on a Pro Micro RP2040, shown live in 3D in the browser. Hold a magnet near the sensors and each one draws an arrow for the field it measures, and the viewer fits a single magnet to all five readings to show where it is and which way its north end points.

## Using it

1. Plug the board in over USB.
2. Open `viewer.html` in **Chrome or Edge** (Firefox/Safari don't support Web Serial). No install or internet needed.
3. Click **Connect** and pick the board's serial port.
4. Keep magnets away for ~1.5 s while it zeroes, then bring a magnet close.

Click **Zero** any time to re-measure the background field (keep magnets away while it does). Re-zero after moving or turning the board: the Earth's field is part of the background.

What you see:

- **Arrows** show the measured field change at each chip, in its true direction. A magnet's field curves around it, so arrows at different chips don't all point at the magnet; they follow its field lines (out of the north end, into the south end).
- **Bar magnet** (red = north end): the one magnet that best explains every chip above threshold. It needs 3 chips above threshold and is hidden when no single magnet fits.
- **Faint white arrows**: the field that fitted magnet should make at each chip. The readout lists how many degrees each chip's arrow is off from it; a chip that is consistently far off is mounted, wired or placed differently from what the viewer assumes.
- **Orange chip**: its reading hit the end of its range (magnet too close), so it's ignored for a moment.
- **Orange warnings** under the buttons mean the zero (background) is probably off:
  - zeroing was disturbed (a magnet moved nearby while it was taken)
  - a chip saw a very strong field (over 5 mT) up close, which can shift its zero by about 20 µT
  - chips read a steady field that no magnet explains (a magnet parked nearby)

  In each case, move magnets at least 50 cm away and click **Zero**. A strong stack needs to be well away from the board while zeroing.

On Linux you may need serial-port permission: `sudo usermod -aG dialout $USER`, then log out and back in.

## Controller mode

Click **Controller** to use the magnet as an input device, e.g. a small magnet on a ring or fingertip:

- **Point:** move the magnet over the board, about 1–4 cm above it, and the cursor follows. Choose how the board lies in front of you; with the top of the card to your left, the keyboard's long side runs along the card.
- **Click:** flip the magnet over (north end up ↔ down). The click lands where the magnet was before the flip. Or tick **Dwell click** and hold still on a key for about a second.
- **Keyboard:** type on the on-screen keyboard. **Speak** reads the text aloud with the browser's built-in voice.
- **Target game:** pop as many targets as you can in 45 seconds.

Mouse clicks work too. Key presses and game hits are logged in recordings.

**Auto-zero** (on by default) keeps the background up to date. When no magnet is found and every chip's reading is small and steady for about 1.5 s, it folds the change into the zero. That covers the board being nudged, a chip's zero shifting after a strong field, or a magnet parked well away. A big leftover (over 100 µT) still needs **Zero** with magnets moved away.

## Surgery game and AI attending

Click **Surgery game** for MagTrack OR: **Training** drills (incision, tumour removal, biopsy) teach the controls with an x-ray view, then **Operations** (appendectomy, heart transplant) are multi-step cartoon surgeries where the instrument changes each step: scalpel, bone saw, retractor, clamp, forceps, hands, needle.

**🩺 AI attending** (bottom left in the game): after each procedure, Claude (`claude-sonnet-5-5`) reads the game's measurements (points per step, mm off the line, tremor, angle error, blood loss, vessel hits) and your recent attempts, and returns a short debrief: what went well, the one thing to fix (tied to a measured number), and which drill to do next. The game keeps the score; Claude only explains it. It needs internet and an Anthropic API key, which you paste in the game: the key stays in that browser's localStorage and is sent only to Anthropic (the official SDK is loaded from jsdelivr, pinned). Don't enter a key on a shared computer, and don't host the page publicly with a key in it. Debriefs are logged in recordings (`or_debrief`) so you can measure progress.

## Voice: Riley, the AI surgical assistant (Cartesia)

During the surgery game, **Riley** talks you through each procedure in a Cartesia **Sonic** voice, reacting to your real instrument movements. She hands you each instrument ("Bone saw."), gives the step, and calls out what she sees: getting close to a target, too deep, too close to the artery, shaking, moving too fast, blood pressure falling, blood loss, the last 30 seconds and a countdown. When you hit the artery: "Bleeder! You hit the artery!"

**Setup** (the key stays on your machine, never in the browser or the repo):

```
cp .env.example .env          # then put your key in .env: CARTESIA_API_KEY=sk_car_...
node server.js                # or: CARTESIA_API_KEY=sk_car_... node server.js
```

Open http://localhost:8765/viewer.html. `server.js` (Node 18+, no dependencies) serves the viewer and proxies speech to Cartesia; it listens on 127.0.0.1 only and won't serve dotfiles such as `.env`. Optional settings: `CARTESIA_VOICE_ID` (otherwise it picks a calm English voice), `CARTESIA_MODEL` (default `sonic-3.6`).

**How it works:**
- The game emits events (step start, too deep, artery hit, …) and `voice.js` also watches live state each tracking sample: distance to the target, hand speed inside the patient, tremor while holding, blood pressure, blood loss, and the clock.
- A director picks what to say: four priority levels (critical, warning, guidance, chatter). More urgent lines interrupt less urgent ones; otherwise only the most important waiting line is kept, and stale ones are dropped. Each event has a cooldown, and repeating a mistake escalates the wording, speed and emotion.
- Cartesia features used: the Sonic TTS bytes API (`/tts/bytes`) with `sonic-3.6`, per-line `generation_config` speed and emotion (calm, then determined, then scared as things get worse; excited when the heart restarts), and the voices API to pick a voice. Audio streams as MP3 and starts playing on the first bytes. `server.js` caches recent lines and prefetches likely ones per step, so frequent callouts are instant and don't spend credits again.
- Speech never blocks tracking: requests and playback are asynchronous. Every line also appears as a caption, so it works with the sound off and for players who are deaf or hard of hearing. The 🔊 button mutes Riley.

**Known limitations:**
- It needs internet. Without `server.js`, or without a key, Riley falls back to the browser's built-in voice, and the button says so.
- The first time a line is said there is a short delay while Cartesia generates it; prefetching hides most of this.
- Lines are scripted, with numbers filled in from the game. The free-form debrief comes from the AI attending (Claude), which is not spoken.
- It's a training game, not medical advice. Spoken text is game-generated and contains no personal data.

## Calibrating chip orientation

The viewer assumes every chip is mounted the same way. If a breakout is turned or flipped, its arrow points the wrong way. To measure how each chip is really mounted:

1. Connect, click **Calibrate orientation**, then **Start**.
2. Keep magnets, phones and tools away and slowly turn the board through every orientation for 30–40 s.
3. Click **Next: flat spin**, lay the board flat with the chips up and turn it slowly clockwise (seen from above) one full turn. Click **Finish**.
4. Check the table (for example "ch3 turned 180° (seen from above)") and click **Apply**, then put the board down and **Zero**.

This works because the Earth's field is the same at every chip, so after removing each chip's offset they should all agree. The flat spin checks the axes aren't mirrored.

Do it about 1 m from computers, phones and metal furniture, on a long USB cable. Samples where something besides the Earth's field reaches a chip are left out. A chip turned 90° or 180° is always caught, but small tilts are only applied when they're clearly measurable: a field a few µT different at one chip looks like a tilt, so otherwise each chip gets its nearest square orientation. The **agreement** column shows how well each chip matches the others in multiples of its noise (about 1 is perfect). The calibration is saved in the browser; **Copy** gives JSON you can paste as `SENSOR_CAL` in `viewer.html` to make it the default everywhere.

## Recording and analysing

Click **Record** and save the file into `recordings/` (kept out of git). Everything is recorded: every line the board sends (all samples and `#` messages) with a timestamp, plus viewer events (connect, zeroing with its baseline, calibration). The file is written every 2 s, so a crash loses at most ~2 s. Start recording before **Connect** to also capture the board's start-up messages.

While recording, type a note and press **Mark** (or Enter) to timestamp what you're doing, e.g. `magnet over ch3, N down`.

**Open recording** plays a file back through the viewer as if the board were connected (choose the speed next to it), including any calibration done during the recording.

To analyse a recording (needs only [Node.js](https://nodejs.org)):

```
node tools/analyze.js recordings/magtrack-20261024-213000.log
```

It reports sample rate and gaps, the board's messages, per-chip noise and clipping, the orientation calibration (if the recording includes one, or pass `--tumble A-B` / `--spin A-B` in seconds), and for every mark: where a single magnet fits and how far each chip's reading is from that fit. `--axes raw` repeats the fits without calibration for comparison, and `--csv out.csv` exports every sample.

The file format is plain text, one entry per line: `<ms since start> TAB <kind> TAB <text>`, where kind is `dev` (a line from the board), `app` (a viewer event as JSON) or `mark` (a note). Lines starting with `#` are comments.

## Hardware

| Part | Qty |
|---|---|
| SparkFun Pro Micro RP2040 | 1 |
| TCA9548A / PCA9548A I2C multiplexer | 1 |
| MLX90393 breakout (I2C address 0x0C) | 5 |

Wiring:

- Pro Micro SDA/SCL → multiplexer SDA/SCL. Any adjacent GPIO pair works; the firmware searches for it (currently GP2 = SDA, GP3 = SCL).
- Multiplexer channels 0–4 → one MLX90393 each.
- 3.3V and GND to everything.

Sensor layout (all chips facing the same way, viewed from the chip side), about 3.4 cm across and 6.8 cm top to bottom:

```
ch0       ch1

     ch2

ch3       ch4
```

A different layout needs `SENSOR_POS` at the top of `viewer.html` changed to match.

Each chip's axes, as measured with a magnet over each chip: **X points toward the top of the card** (from ch3/ch4 toward ch0/ch1), **Y toward the left**, **Z out of the chip**. Mounting the breakouts differently needs `AXIS_MAP` in `viewer.html` (and `DEFAULT_AXIS_MAP` in `tools/analyze.js`) changed to match. A magnet test checks it: record with the magnet held over each chip in turn, pressing **Mark** each time, then run `tools/analyze.js`. Every chip should agree with the fitted magnet to within about 10°.

## Flashing a new board

1. Hold **BOOT** while plugging the board in. A drive called `RPI-RP2` appears.
2. Copy the [CircuitPython 10.x UF2 for the SparkFun Pro Micro RP2040](https://circuitpython.org/board/sparkfun_pro_micro_rp2040/) onto it. The board restarts as a drive called `CIRCUITPY`.
3. Copy `firmware/code.py` onto `CIRCUITPY`.

No CircuitPython libraries are needed.

## Data format

The board prints one line per sample over USB serial (about 20 Hz):

```
B,x0,y0,z0,x1,y1,z1,x2,y2,z2,x3,y3,z3,x4,y4,z4
```

Values are in microtesla, ordered by multiplexer channel; `nan` means that sensor didn't respond. Lines starting with `#` are status messages.

## Files

- `viewer.html`: the 3D viewer (Web Serial + three.js), recording, replay and orientation calibration
- `controller.js`: controller mode (cursor, flip-to-click, keyboard, target game)
- `surgery.js`, `operations.js`: the surgery game (training drills, multi-step operations)
- `voice.js`: Riley, the spoken surgical assistant (Cartesia Sonic)
- `server.js`: local server, serves the viewer and proxies Cartesia TTS with the key from the environment
- `attending.js`: the AI attending debrief (Claude via the Anthropic SDK)
- `magmath.js`: magnet fit, orientation calibration and recording parser, shared by the viewer and `tools/analyze.js`
- `tools/analyze.js`: command-line report for a recording
- `firmware/code.py`: CircuitPython firmware
- `vendor/`: three.js r128 and OrbitControls, bundled so the viewer works offline
