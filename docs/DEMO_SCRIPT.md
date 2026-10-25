# MagTrack OR: demo script

## Before judging (do this in the hall)

1. Start the server and leave its terminal open:
   ```bash
   cd ~/Desktop/magtrack && node server.js
   ```
   It should print `Voice: Cartesia sonic-3.6, voice Clive`.
2. Open Chrome at http://localhost:8765/viewer.html, then click **Connect**.
3. **Zero with magnets far away** (more than 30 cm, phones off the table). If a warning about a disturbed zero or a strong field appears, move magnets away and zero again.
4. Turn on the 🩺 AI attending (paste the key). Turn the volume up, and check that the 🔊 button says **Riley: Cartesia**.
5. **Warm the history.** Play the Incision drill 2–3 times so the result card shows a trend and Riley has an improvement to announce.
6. **Run Setup › Tracking check once** on the printed grid, then put the measured RMS in the Devpost.
7. **Make backups.**
   - A screen recording (with sound) of one clean appendectomy: the demo video doubles as the fallback if the board or USB fails live.
   - Click **Record** while you play it. **Open recording** can replay the raw data in the 3D viewer to show the tracking, but a replay isn't synced to a fresh game, so use the video for the game itself.
8. Keep the venue Wi-Fi in mind: Claude and Cartesia need internet. Without them, Riley falls back to the browser voice and the debrief says why it's missing; the game itself keeps working.

## 2-minute video / pitch (demo first)

**0:00–0:15 · Hook (hands on the instrument, game on screen)**
> "This is a surgical-skills trainer. There's no camera: five magnetometers under here track this instrument in 3D, through anything, and score my hand motion the way surgical-skills research does."

**0:15–1:05 · One complete flow: Operations › Appendectomy (start it and keep talking over Riley)**
- Riley hands you the scalpel. Cut along the line with the instrument **tilted**, and point out the ring on the skin: "it judges where the blade meets the tissue, not the hidden tip."
- Go deliberately too deep once. Riley escalates: "Bit deep. Come up a touch." Then the vitals react.
- Retractor, then clamp and hold. Riley counts the hold.
- Finish, or fast-forward in the edit to the result card.

**1:05–1:30 · The result**
- Point to the **Motion analysis** card: path length, movements, idle, smoothness, each compared with your last runs, plus the trend line.
- Riley: "That's N percent less wasted motion than your average."
- The **AI attending** debrief: one specific fix tied to a number, and the next drill.

**1:30–2:00 · Problem and how it's built**
> "Med students practise suturing at home with zero feedback. [Name] told us [one line]. MagTrack gives them the measures sim labs use, for the cost of a few sensors.
> Under the hood: a magnetic dipole fit at 19 Hz in the browser, tuned on recorded sessions; motion analytics with SPARC smoothness; Claude turns the numbers into coaching; Cartesia makes it spoken, because your hands and eyes are busy.
> And we measured our accuracy with a printed grid: [X] mm RMS. Measured, not estimated."

## Live judging (3–5 minutes per table)

1. **Let the judge hold the instrument.** Start the **Incision** drill. It's quick, Riley guides them, and they get a grade. The judge-plays-it moment is the strongest part of the demo.
2. **Show the result card**, and the debrief if the network allows.
3. **Show the depth:**
   - Setup › Tracking check result: measured vs not measured.
   - Setup › Instrument: pivot calibration, done live if you have a plastic instrument.
   - The terminal: `node --test tests/*.test.js` → 11 passing.
4. **Pitch the impact in one line:** "Objective, at-home surgical-skills feedback without a sim lab."

## Likely questions

- **How accurate is it?** Quote the Tracking check: N points, height, RMS, worst. Add that hand placement is ±1 mm and that untested heights and tilts aren't claimed.
- **Why magnets, not a camera?** No line of sight, so hands and instruments don't block it. It's cheap, works in any light, and reads tilt as well as position.
- **What about metal instruments?** Steel distorts the field, so use plastic, wooden or 3D-printed instruments. That's why there's a calibrated-instrument mode.
- **Is the AI making up scores?** No. The game computes every number; Claude only explains them, and is told never to invent measurements or give clinical advice.
- **What does Cartesia add?** Low-latency streamed speech with per-line emotion and speed, so warnings sound urgent and guidance sounds calm. Voice is the only feedback channel that works while your hands and eyes are busy.
- **Does it measure real skill?** These measures (path length, movements, time) are the standard hand-motion measures in skills research. Showing that ours separates novices from experts is the next step, and we're not claiming it yet.
