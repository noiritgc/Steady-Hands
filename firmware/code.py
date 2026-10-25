# MagTrack: reads 5x MLX90393 behind a TCA9548A and streams field vectors over USB serial.
# Output line: B,x0,y0,z0,x1,y1,z1,...,x4,y4,z4   (microtesla, "nan" if a sensor is missing)
import time
import busio
import digitalio
import microcontroller
import supervisor

NUM_SENSORS = 5
MLX_ADDRS = (0x0C, 0x0D, 0x0E, 0x0F)
GAIN_SEL = 0                  # least sensitive gain, so a magnet up close doesn't saturate
OSR = 2                       # oversampling (0-3) and on-chip filter (0-7): more = less noise, slower
DIG_FILT = 5
CONV_TIME = 0.035             # seconds to wait for an X/Y/Z conversion at these OSR/DIG_FILT settings
SENS_XY = 0.751               # uT/LSB at GAIN_SEL=0, RES=0, HALLCONF=0xC
SENS_Z = 1.210


def pin(n):
    return getattr(microcontroller.pin, "GPIO%d" % n)


def unstick(sda, scl):
    # A chip interrupted mid-transfer can hold SDA low forever; clocking SCL 9 times releases it.
    s = digitalio.DigitalInOut(pin(sda))
    c = digitalio.DigitalInOut(pin(scl))
    s.switch_to_input(pull=digitalio.Pull.UP)
    c.switch_to_output(value=True)
    stuck = not s.value
    for _ in range(9):
        c.value = False
        time.sleep(0.00001)
        c.value = True
        time.sleep(0.00001)
    s.deinit()
    c.deinit()
    return stuck


def find_bus():
    # Try adjacent SDA/SCL pairs until one has a TCA9548A on it (Qwiic GP16/17 first).
    for sda in [16] + list(range(0, 29, 2)):
        try:
            stuck = unstick(sda, sda + 1)
            i2c = busio.I2C(pin(sda + 1), pin(sda), frequency=100000)
        except Exception as e:
            if sda == 16:
                print("# GP16/17: %s" % e)
            continue
        while not i2c.try_lock():
            pass
        found = i2c.scan()
        i2c.unlock()
        if sda == 16 or found:
            print("# GP%d/%d%s: devices %s" % (sda, sda + 1, " (SDA was stuck low)" if stuck else "",
                                               [hex(a) for a in found]))
        mux = [a for a in found if 0x70 <= a <= 0x77]
        if mux:
            print("# i2c SDA=GP%d SCL=GP%d mux=0x%02X" % (sda, sda + 1, mux[0]))
            return i2c, mux[0]
        i2c.deinit()
    return None, None


def xfer(i2c, addr, out, n_in):
    buf = bytearray(n_in)
    i2c.writeto_then_readfrom(addr, bytes(out), buf)
    return buf


def select(i2c, mux, ch):
    i2c.writeto(mux, bytes([1 << ch]))


def setup_sensor(i2c, addr):
    xfer(i2c, addr, [0x80], 1)                                  # exit any mode
    time.sleep(0.002)
    reg0 = 0x000C | (GAIN_SEL << 4)                              # HALLCONF=0xC, GAIN_SEL
    xfer(i2c, addr, [0x60, reg0 >> 8, reg0 & 0xFF, 0x00 << 2], 1)
    reg2 = (DIG_FILT << 2) | OSR                                 # RES_XYZ=0
    xfer(i2c, addr, [0x60, reg2 >> 8, reg2 & 0xFF, 0x02 << 2], 1)


def to_i16(hi, lo):
    v = (hi << 8) | lo
    return v - 65536 if v & 0x8000 else v


def find_sensors(i2c, mux):
    sensors = []                                                 # (channel, address) or None
    for ch in range(NUM_SENSORS):
        sensor = None
        for attempt in range(3):                                 # retry: one I2C glitch shouldn't drop a sensor
            try:
                select(i2c, mux, ch)
                present = [a for a in i2c.scan() if a in MLX_ADDRS]
                if present:
                    setup_sensor(i2c, present[0])
                    sensor = (ch, present[0])
                break
            except OSError:
                time.sleep(0.01)
        sensors.append(sensor)
        print("# ch%d %s" % (ch, "MLX90393 at 0x%02X" % sensor[1] if sensor else "no sensor"))
    return sensors


def main():
    i2c, mux = None, None
    while i2c is None:
        i2c, mux = find_bus()
        if i2c is None:
            print("# no TCA9548A found, retrying")
            time.sleep(2)

    while not i2c.try_lock():
        pass
    sensors = find_sensors(i2c, mux)
    dead_frames = 0

    while True:
        for s in sensors:                                        # start all conversions
            if s:
                try:
                    select(i2c, mux, s[0])
                    xfer(i2c, s[1], [0x3E], 1)                   # single measurement, X/Y/Z
                except OSError:
                    pass
        time.sleep(CONV_TIME)
        out = ["B"]
        for s in sensors:
            vals = ["nan", "nan", "nan"]
            if s:
                try:
                    select(i2c, mux, s[0])
                    d = xfer(i2c, s[1], [0x4E], 7)               # status + X,Y,Z
                    vals = ["%.1f" % (to_i16(d[1], d[2]) * SENS_XY),
                            "%.1f" % (to_i16(d[3], d[4]) * SENS_XY),
                            "%.1f" % (to_i16(d[5], d[6]) * SENS_Z)]
                except OSError:
                    pass
            out += vals
        print(",".join(out))
        dead_frames = dead_frames + 1 if all(v == "nan" for v in out[1:]) else 0
        if dead_frames >= 10:                                    # bus wedged (e.g. loose wire): start over
            raise OSError("all sensors stopped responding")


try:
    main()
except Exception as e:                                           # never sit idle at the REPL prompt
    print("# crashed: %r - restarting" % e)
    time.sleep(1)
    supervisor.reload()
