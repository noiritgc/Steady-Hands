# MagTrack OR: Devpost write-up

> Fill in everything marked **[FILL]** before submitting. The accuracy numbers below come from the tracking check
> on 2026-10-25 (docs/validation/). If you run it again, update them from the new report.

**Tagline:** A surgical-skills trainer that tracks a real instrument with five magnetometers and no camera, scores your hand motion the way skills research does, and coaches you out loud.

## Inspiration

Surgical skill is hand skill, and hand skill takes repetition with feedback. Hospital simulation labs track instrument motion with expensive systems, but they're booked, far away, and closed at 11 pm. A student practising suturing at their desk gets no feedback at all: they can't tell whether they're getting more economical, steadier or smoother.

**[FILL: the named community and the conversation.]** For example: "We talked to [name], a [year] medical student at [school], who practises suturing on a pad at home before [rotation/exam]. They told us: '[quote]'." Anthropic's track asks for a named community and a problem you have lived or heard first-hand. Put it here, specifically.

## What it does

- **Tracks an instrument in 3D with magnets.** A small magnet stack, bare or mounted on a plastic instrument, is tracked in position and direction (5 degrees of freedom) above a board of five 3-axis magnetometers. There's no camera and no line of sight, so your hands can't block it.
- **A surgery game built on that tracking.** Training drills (incision, tumour removal, biopsy) and multi-step operations (appendectomy, heart transplant) with instrument changes, a patient whose vitals react to mistakes, blood loss and a patient cam.
- **Judges what you actually cut.** Cuts are judged where the blade meets the tissue, not at the hidden tip. On our own recorded play, people held the instrument about 46° from vertical, which puts the tip roughly 5 mm away from where the blade enters.
- **Scores motion like skills research does.** Path length, number of movements, idle (hesitation) time and SPARC smoothness for every procedure, tracked across attempts, so you can see whether you're improving.
- **🩺 AI attending (Claude).** After each case, Claude reads the measured numbers and your history and gives a debrief: what went well, the one thing to fix (tied to a number) and the drill to do next.
- **🔊 Riley, a spoken assistant (Cartesia).** Your hands are busy and your eyes are on the field, so feedback has to be spoken:
  - hands you each instrument with the instruction and the reason
  - warns you before you hit the artery
  - escalates as vitals crash
  - counts down the clock
  - tells you what improved: "That's 23 percent less wasted motion than your average."
- **Validation and calibration tools.**
  - **Tracking check** measures accuracy against a printed 1:1 grid, keeps measured results separate from estimates, and can be re-fitted from the raw data.
  - **Pivot calibration** finds a physical instrument's tip offset.

## How we built it

- **Hardware:** 5× MLX90393 magnetometers on an I²C mux, read by a Pro Micro RP2040 running CircuitPython at about 19 Hz over USB serial. **[FILL: magnet type/size, board photo, parts cost]**
- **Tracking:** in the browser over Web Serial.
  - Each sample is fitted with a magnetic-dipole model: a Levenberg–Marquardt search over position with a closed-form linear solve for the moment.
  - Each chip's orientation was calibrated by tumbling the board in Earth's field.
  - Auto-zeroing follows the background field, and dropped connections reconnect automatically.
  - On top: a One Euro filter tuned on our recorded sessions, outlier rejection and a fixed tip polarity.
  - Everything is recorded in a re-analysable log format.
- **Game:** three.js. Recordings replay through the same pipeline, so we could debug from real sessions.
- **Motion analytics:** `motion.js`, shared by the game, a command-line tool and the tests. It handles noise floors, speed hysteresis and SPARC (spectral arc length), which is designed to stay stable under measurement noise.
- **Claude:** `claude-sonnet-5-5` through the official Anthropic SDK, with structured JSON output. The game keeps the score; Claude only explains it, and is told never to invent numbers.
- **Cartesia:** Sonic (`sonic-3.6`), the Clive voice, per-line emotion and speed. A small Node server keeps the key on the machine, caches lines and prefetches likely ones. A director with priorities, interruptions and cooldowns decides what's worth saying.
- **Tests:** `node --test tests/*.test.js`. They cover the motion metrics on synthetic paths with known answers, pivot calibration, and an end-to-end re-fit of tracking-check points from a synthetic raw recording.

## Challenges we ran into

- **The sensor vectors disagreed.** Recording and re-analysing raw data showed the chip axis mapping was wrong; fixing it cut model error from 52.5% to 8.6%.
- **Calibration that lied.** Earth-field gradients made small "tilts" look real, so calibration now snaps to square orientations unless a tilt is clearly measurable.
- **Tilted cuts landing off the line.** Solved by judging the cut at the blade's entry point.
- **Jittery, jumpy tracking.** Solved with filter tuning measured on recordings, not by eye.

## Accomplishments we're proud of

- Tracking a magnet in 3D from five cheap sensors well enough to play a precision game.
- **Measured accuracy, with the vertical axis reported honestly.** We measured 9 points on a printed 1:1 grid, with the magnet upright on a 3 cm spacer (centre about 4 cm above the sensors). We re-fitted every point from the raw sensor data and got the same answer to within 0.1 mm.
  - **Sideways (x/z): 2.8 mm RMS.**
  - **While held still:** 0.4 mm of jitter.
  - **Vertical: the weak axis.** It reads about 6 mm low on average, with ±4.9 mm of scatter on top.
  - **Overall: 8.2 mm RMS in 3D, worst point 12.8 mm.**
  - **Not covered:** other heights and tilts, and anything finer than the ±1 mm of placing by hand.
- Motion analytics that track improvement, with tests.

## What we learned

- Record everything and re-analyse it. Most of our biggest fixes came from recordings, not guesses.
- Feedback that is measured, specific and spoken is what makes practice useful.

## What's next

- Run a validation study against an optical tracker.
- Build procedure modules with surgical educators.
- Make the board thinner so it slides under any practice pad.
- Fix the vertical axis. The measured height drifts about 1 cm from one end of the board to the other, which points to chip gain and position errors that a calibration should remove. We'll check any fix on a fresh set of points, not the ones we tuned on.
- Run a small study on whether the measures separate novices from experienced trainees.

## Responsible design

- **It's a training aid, not a medical device.** The attending is told not to give clinical advice about real patients.
- **Claude's numbers are grounded.** Claude only sees measured numbers, and the game, not the model, sets the score.
- **Keys stay local.** The Cartesia key stays on the local server and is never sent to the browser or the repo. The Anthropic key is the player's own, kept in that browser only.
- **Accessible voice.** Every spoken line is also a caption, and voice can be muted.
- **Honest accuracy claims.** The tracking check keeps measured accuracy apart from estimates and says what wasn't tested.

## Built with

`javascript` `three.js` `web-serial` `node.js` `circuitpython` `rp2040` `mlx90393` `anthropic` `claude` `cartesia`

## Prize tracks

- **Best Use of Cartesia:**
  - Voice is the feedback channel for a hands-busy, eyes-busy task.
  - Uses Sonic 3.6 with emotion and speed per line, low-latency streaming, caching and prefetch, and a priority and interruption director.
  - Live progress feedback is spoken.
  - Captions for accessibility.
- **Anthropic:**
  - The named community is **[FILL]**.
  - Claude turns measured motion data and history into one specific fix and the right next drill.
  - Failure modes are handled: it never invents numbers, never gives clinical advice, and the game works without it.
- **Best Hardware Hack / Most Technically Complex:**
  - Camera-free 5-DoF magnetic tracking.
  - Calibration, filtering and validation tooling.
  - Pivot calibration for real instruments.
- **Best People-First Hack:** affordable, at-home skills practice with objective feedback.

**Repo:** **[FILL: GitHub link]** · **Demo video:** **[FILL]**
