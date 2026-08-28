# 01 — Hardware

## System partition

Two independent units.

```
┌─────────────────────────────┐          ┌──────────────────────────┐
│  SCALE UNIT (drip tray)     │          │  DISPLAY UNIT (on machine)│
│                             │          │                          │
│  load cell ──► NAU7802 ──┐  │ ESP-NOW  │  ESP32-S3                │
│                          ▼  │◄────────►│    ├── 2.1" IPS ST7789   │
│  BME280 ──────────► ESP32-S3│  ~2 ms   │    ├── rotary encoder    │
│                       │     │          │    └── 2 buttons         │
│  1000 mAh LiPo ───────┤     │          │                          │
│  Qi receiver ─────────┤     │          │  USB-C power (5 V)       │
│  0.96" OLED ──────────┘     │          │                          │
│  USB-C (MSC + DFU)          │          └──────────────────────────┘
└─────────────────────────────┘
         │
         └── BLE GATT ──► phone (optional, a view only)
```

The scale is autonomous. The display is a peripheral that renders state and sends commands back. Powering off the display changes nothing about logging.

---

## Load cell

**Selection: 1 kg single-point (parallel-beam) aluminium strain gauge cell, low-profile body.**

### Why single-point
A parallel-beam cell has two machined flexures that make the output insensitive to *where* on the platform the load sits. This matters enormously here — a cup is never centred, and a portafilter sitting half-off the platform is normal. A simple cantilever (S-beam, bending beam) reads differently depending on load position and would be unusable without a rigid platform and a centring feature you don't have room for.

### Why 1 kg and not 3 kg
The temptation is to size up for headroom. Resist it. Strain-gauge cell error scales with **full scale**, not with the applied load. A 3 kg cell with the same 0.02 % FS combined error gives ±0.6 g; a 1 kg cell gives ±0.2 g. Since we only ever weigh 0–700 g, the 1 kg cell is strictly better — *provided* the overload stops (below) actually work.

### What actually matters in the datasheet
Ranked by how much it will hurt you:

1. **Creep (and creep recovery).** Under a constant load, output drifts. Spec is typically given as % FS over 30 minutes — but espresso shots are 30 *seconds*, and most creep happens in the first minute. A cheap cell at 0.03 % FS/30 min still moves a few tenths of a gram during a shot, in the direction that inflates your yield. Budget for it; measure it in P0.
2. **Temperature effect on zero (TC-zero).** Typically 0.02–0.05 % FS/°C. At 1 kg FS and a 20 °C swing that's **4–10 g of zero shift.** This is the number that makes temperature compensation mandatory (see [02](02-firmware.md)).
3. **Temperature effect on span.** Much smaller in practice because the bridge is ratiometric and the gauges partially self-compensate. Second-order.
4. **Hysteresis.** Matters for load/unload cycles; minor here.
5. **Nonlinearity.** Almost irrelevant — see below.
6. **Rated output (mV/V).** 1.0 mV/V is standard. With 3.3 V excitation and a 1 kg cell, full scale is 3.3 mV, and a 30 g shot is ~100 µV. This sets the ADC gain requirement.

**Nonlinearity is a non-issue and it's worth understanding why.** A 0.05 % FS nonlinearity spec on a 1 kg cell sounds like 0.5 g of error. But nonlinearity is a bow across the *whole* range — over the 0–120 g window espresso actually uses, the deviation from a local straight line is a small fraction of that. Calibrate with a 100 g mass over the range you use, not with a 1 kg mass, and the residual is well inside the ±0.15 g target.

### Overload protection
Non-negotiable (constraint C3). Design a **hard mechanical stop** that arrests platform travel at roughly **1.3× rated deflection**. A typical 1 kg cell deflects ~0.3 mm at full scale, so the stop sits at ~0.4 mm.

This is a tight tolerance for 3D printing. Implementation: a printed boss with a **shim stack or a set screw** so the gap is adjusted at assembly, not printed to size. Test it by standing the assembled scale on a bathroom scale and pressing until the stop engages — the reading should plateau.

### Mounting
The load path is the whole ballgame; more DIY scales fail here than anywhere else.

- **Fixed end and floating end both bolt to rigid plates.** 2 mm aluminium, not printed plastic. Printed plastic in the load path creeps, and near a hot machine (C1) it creeps a lot. The rest of the enclosure can be printed; the load path cannot.
- **Nothing else may bridge platform to base.** Not the USB cable, not a wire, not a gasket under compression, not a stray blob of filament. Any parallel path is a spring in parallel with the cell and it will be nonlinear and temperature-dependent. Route the load-cell wires in a deliberate service loop with slack.
- **Feet mount to the base, directly under the fixed end** where practical, so tray flex doesn't load the flexure.
- **Soft feet** (silicone, ~50 Shore A) — these are the first line of defence against pump vibration (C4).

### Low profile
Standard 1 kg bar cells are ~12–13 mm tall in the body, which after plates and stops leaves the 20 mm budget very tight. Two ways out, to be decided in P0:
- Source a **low-profile cell** (~8 mm body; sold for retail/kitchen scale use).
- Or **pocket the base plate** so the cell body sits recessed, trading base thickness for cell clearance.

---

## ADC

**Selection: NAU7802.**

| | HX711 | **NAU7802** | ADS1232 |
|---|---|---|---|
| Resolution | 24-bit | 24-bit | 24-bit |
| Max rate | 80 SPS | **320 SPS** | 80 SPS |
| Interface | bit-banged 2-wire | **I²C** | SPI-like |
| PGA | 32/64/128 only | **1–128** | 1/2/64/128 |
| Bridge excitation | AVDD, external | **internal LDO** | external |
| Temperature sensor | no | **yes, on-die** | no |
| Clock | RC, drifty | **RC + optional xtal** | RC |
| Cost | ~$1 | ~$2 | ~$5 |

Four reasons the NAU7802 wins, in order:

1. **320 SPS enables oversampling.** We want 40 Hz output. Sampling at 320 SPS and decimating 8:1 buys ~9 dB of noise reduction *for free* and, critically, gives the anti-alias filter something to work with against pump vibration (C4). The HX711 at 80 SPS has no margin — a 50/60 Hz vibration component aliases straight into the passband and there is nothing you can do about it in software. **This alone disqualifies the HX711.**
2. **The on-die temperature sensor sits in the same package as the analogue front end**, giving a temperature signal correlated with the actual drift source. This makes the temperature compensation in [02](02-firmware.md) possible without a separate sensor near the cell.
3. **Internal LDO for bridge excitation.** A regulated, quiet, ratiometric reference for the bridge — the excitation and the ADC reference come from the same node, so supply variation cancels to first order. With the HX711 you're driving the bridge from whatever your rail is.
4. **I²C** shares a bus with the BME280 and frees pins. The HX711's bit-banged protocol also has a nasty failure mode: an interrupt longer than ~60 µs during a read puts the chip into power-down and you silently lose the sample.

Note the HX711's advertised 80 SPS usually requires cutting a trace or lifting a pin on common breakout boards — the RATE pin is hard-tied low for 10 SPS. Another reason to skip it.

**Configuration:** gain 128, 320 SPS, internal LDO at 3.0 V, DRDY on a GPIO interrupt. At gain 128 the input range is ±15.6 mV against a 3.3 mV full-scale signal — comfortable headroom for the tare offset, which can be a large fraction of the signal.

---

## MCU

**Selection: ESP32-S3 (WROOM-1, N16R8 — 16 MB flash, 8 MB PSRAM), on both units.**

| | nRF52840 | **ESP32-S3** | RP2040 + radio |
|---|---|---|---|
| BLE | best-in-class | good | via module |
| Wi-Fi | no | yes | via module |
| **Low-latency P2P link** | proprietary ESB | **ESP-NOW** | — |
| Active current | ~5 mA | ~40 mA | ~25 mA |
| Deep sleep | ~2 µA | ~10 µA | ~1 mA |
| Native USB | yes | **yes (MSC + DFU)** | yes |
| Flash | 1 MB | **16 MB** | external |
| Toolchain | Zephyr / nRF SDK | ESP-IDF | pico-sdk |

The nRF52840 is the better *radio and power* part and it isn't close. It loses anyway, on three counts:

1. **ESP-NOW is the right answer for the detachable display.** It's connectionless 802.11 action frames — no pairing handshake, no GATT, no connection interval. Round-trip is 1–3 ms. BLE's floor is a 7.5 ms connection interval, and in practice notification batching and slave latency put you at 15–30 ms with jitter you don't control. For a live readout at 40 Hz this is the difference between a display that feels attached to the scale and one that feels like a laggy remote. Building the equivalent on nRF means Enhanced ShockBurst and writing the protocol yourself.
2. **16 MB flash + native USB MSC** is the entire "plug it in and the shots are files" story (G1, G5) with no external memory and no host driver.
3. **Power isn't actually the binding constraint.** The duty cycle is ~30 minutes of activity a day. At 40 mA that's 20 mAh/day; a 1000 mAh cell gives weeks. Deep sleep at 10 µA is ~1 mAh/day of standby. The nRF's advantage buys battery life we don't need, at the cost of the feature we do.

**Wake behaviour:** deep sleep between sessions. Waking on load-cell activity is attractive but the NAU7802 has no threshold-interrupt mode, so the practical approach is a timer wake at ~1 Hz that takes a single conversion and decides whether to come up fully — a few tens of µA average — plus a wake on the physical button and on USB attach.

---

## Display

### Scale unit: 0.96" SSD1306 OLED (mono, I²C)
Small, cheap, on the same bus. Its job is standalone operation when the remote display isn't around: weight, time, mode, battery.

**Burn-in is a real risk** — a scale spends its life showing `0.0 g` in the same pixels. Mitigations: dim aggressively, shift the digit block by a few pixels every few minutes, and blank after 60 s of inactivity.

### Display unit: 2.1" round IPS, ST7789 (240×240, SPI)
Legible from across the kitchen with large digits, refreshes fast enough for a 40 Hz flow readout, and cheap.

**E-ink is explicitly rejected.** Full refresh is 0.3–2 s and partial refresh still ghosts. It cannot display a live flow rate. It is the wrong technology for this even though it's the fashionable one.

**Sharp memory-in-pixel (LS013B7DH03)** is the interesting runner-up — microamps, sunlight-readable, 1-bit, no backlight. Rejected on cost and size, but it's the right call if the display unit ever needs to be battery-powered.

### Display unit power
**USB-C, 5 V, not battery.** This follows directly from C1: the top of an espresso machine is the worst place in the kitchen to put a lithium cell. Machines have accessible outlets nearby and the cable is a non-issue for a device that never moves. If a cable is genuinely unacceptable, the answer is LiFePO₄ (tolerates 60 °C) or a supercapacitor with a charging dock — not a LiPo.

### Input
A **rotary encoder with a push switch** plus two buttons. The encoder is how grind setting gets entered in under two seconds (see [05](05-grind-advisor.md)) — if that interaction is slow, the covariate that makes the whole advisor work simply won't get recorded, and the model is dead on arrival.

---

## Power (scale unit)

- **1000 mAh LiPo pouch cell**, chosen in a flat form factor that fits the height budget. Pouch, not 18650 — an 18650 is 18 mm in diameter and would consume the entire budget by itself.
- **MCP73831** single-cell charger. Simpler and quieter than the ubiquitous TP4056, with a programmable charge current via one resistor.
- **Temperature-gated charging** using the BME280 or the NAU7802's die sensor. Charging a LiPo above 45 °C is a genuine hazard, and this device is specifically designed to sit somewhere hot. Inhibit charge outside 5–43 °C.
- **Fuel gauge:** a simple resistor divider to an ADC pin is adequate. A MAX17048 is nicer but not worth the parts and I²C address for a device that shows four battery bars.
- **Qi wireless charging (stretch).** Removes the USB port from the enclosure, which is the largest single win available for the IP54 target (C2). Costs ~5 mm of height for the receiver coil, which conflicts with G3 — this is a real tradeoff and it should be settled with a measurement in P0, not an opinion now. If Qi wins, USB-C moves to an internal service port on the PCB.

---

## Environmental sensor

**BME280** (~$3, I²C). Temperature, humidity, pressure.

Not a nice-to-have. **Ambient humidity measurably changes how coffee grinds and how the puck behaves**, and it is one of the cheapest real covariates available to the grind model (see [05](05-grind-advisor.md)). Without it, humidity-driven shot variance looks like unexplained noise and inflates the model's uncertainty for free.

Mount it away from the MCU and vented to outside air; self-heating from a nearby ESP32 will otherwise dominate the reading.

---

## Bill of materials

Prices are one-off hobby quantities (DigiKey/LCSC/AliExpress mix), USD, mid-2026, ±30 %.

### Scale unit
| Item | Qty | Est. |
|---|---|---|
| 1 kg single-point load cell, low profile | 1 | $9 |
| NAU7802 (bare IC + passives) | 1 | $2 |
| ESP32-S3-WROOM-1 N16R8 | 1 | $5 |
| BME280 | 1 | $3 |
| 0.96" SSD1306 OLED | 1 | $4 |
| LiPo pouch, 1000 mAh | 1 | $6 |
| MCP73831 + passives | 1 | $2 |
| USB-C receptacle, ESD, misc passives | — | $4 |
| PCB (JLCPCB, 5-off, amortized) | 1 | $4 |
| Aluminium plates, fasteners, feet, gasket | — | $10 |
| Filament | — | $3 |
| **Total** | | **~$52** |

### Display unit
| Item | Qty | Est. |
|---|---|---|
| ESP32-S3-WROOM-1 N8 | 1 | $4 |
| 2.1" round IPS ST7789 | 1 | $12 |
| Rotary encoder + 2 buttons | 1 | $3 |
| USB-C + regulation + passives | — | $4 |
| PCB (amortized) | 1 | $4 |
| Enclosure, fasteners | — | $5 |
| **Total** | | **~$32** |

### Tools and consumables (one-time)
| Item | Est. |
|---|---|
| 100 g + 200 g calibration masses (class M1) | $15 |
| Hot-air / soldering, assumed on hand | — |

**~$84 in parts for both units.** The comparison to a $200 scale with no logging and no remote display is the entire premise of the project, and it holds.

---

## What P0 must settle

The following are deliberately left open because they should be decided from measurement, not from datasheets (see [06](06-roadmap.md)):

- Low-profile cell sourcing vs. base-plate pocketing, for the 20 mm budget.
- Whether Qi's height cost is affordable, or USB-C with a gasketed plug wins.
- Measured noise floor at gain 128 / 320 SPS, which sets the achievable resolution and validates the 0.1 g/s flow-noise target.
- Measured creep and TC-zero on the actual cell purchased, which sets the compensation model's form.
- The pump's vibration spectrum as seen by the cell, which sets the decimation filter design.
