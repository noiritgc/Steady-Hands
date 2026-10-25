# MagTrack

Five MLX90393 3-axis magnetometers on a Pro Micro RP2040, shown live in 3D in the browser. Hold a magnet near the sensors and each one draws an arrow for the field it measures.

## Using it

1. Plug the board in over USB.
2. Open `viewer.html` in **Chrome or Edge** (Firefox/Safari don't support Web Serial). No install or internet needed.
3. Click **Connect** and pick the board's serial port.
4. Keep magnets away for ~1.5 s while it zeroes, then bring a magnet close.

Click **Zero** any time to re-measure the background field (keep magnets away while it does).

On Linux you may need serial-port permission: `sudo usermod -aG dialout $USER`, then log out and back in.

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

- `viewer.html`: the 3D viewer (Web Serial + three.js)
- `firmware/code.py`: CircuitPython firmware
- `vendor/`: three.js r128 and OrbitControls, bundled so the viewer works offline
