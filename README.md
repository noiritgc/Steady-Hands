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

On Linux you may need serial-port permission: `sudo usermod -aG dialout $USER`, then log out and back in.

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
- `magmath.js`: magnet fit, orientation calibration and recording parser, shared by the viewer and `tools/analyze.js`
- `tools/analyze.js`: command-line report for a recording
- `firmware/code.py`: CircuitPython firmware
- `vendor/`: three.js r128 and OrbitControls, bundled so the viewer works offline
