# 00 — Requirements

## Goals

**G1. Autonomous logging.** Every shot is captured to onboard non-volatile storage with no companion device present. This is the primary goal; everything else is secondary to it.

**G2. Detachable readout.** A separate display unit, wirelessly linked, that can sit on top of the machine at eye level while the scale sits in the drip tray.

**G3. Low profile.** Total scale height ≤ 20 mm. Under a naked or spouted portafilter, vertical clearance is the binding constraint, and it is the single most common complaint about commercial scales.

**G4. Honest flow rate.** Flow rate reported with ≤ 100 ms effective latency and ≤ 0.1 g/s RMS noise during steady extraction.

**G5. Open data.** Shots exportable as plain files (CSV/JSON) without an app, an account, or a cloud service.

**G6. Closed loop with the grinder.** Record grind setting and dose per shot; produce a defensible recommendation for the next grind adjustment.

## Non-goals

- **Not a commercial product.** No FCC/CE certification path, no injection tooling, no manufacturing DFM. One-off to small-batch.
- **Not a general kitchen scale.** Optimized for 0–500 g with espresso-range accuracy. Weighing a 3 kg bag of flour is out of scope.
- **Not a machine controller.** It does not drive the pump or cut the shot. It may *emit* a stop signal on GPIO for someone else to use (see [02](02-firmware.md)), but closing that loop is a separate project with separate safety implications.
- **Not trade-legal.** No NTEP/OIML certification. It is an instrument, not a commercial measure.
- **Not battery-powered on the display side.** See the thermal constraint below.

## Hard constraints

### C1 — Thermal
The scale lives in a drip tray. Ambient there runs 30–45 °C during a session, with transient contact heat from the tray itself and occasional direct hot water from the group flush. The remote display, sitting on top of the machine, sees a hotter and more sustained environment.

Consequences, which drive real decisions later:
- **Lithium-polymer cells above 45 °C degrade rapidly and are a safety concern.** The display unit is therefore **USB-powered, not battery-powered** (see [01](01-hardware.md)). The scale's own battery is at drip-tray level, which is survivable, but the charge circuit must respect a temperature cutoff.
- **Load cell zero drift with temperature is the dominant error source**, not nonlinearity and not resolution. Temperature compensation is not an optional polish item; it is core functionality.
- **PLA is disqualified** as an enclosure material. It creeps under sustained load and softens near 50 °C.

### C2 — Water
Drip trays are wet. Steam wand purges spray. The design target is **IP54** — protected against splashing water — which is achievable with a gasketed seam and a conformal-coated board. Full immersion (IP67) is not a goal and would compromise the height budget.

A consequence: the USB-C port is a hole in the enclosure at the worst possible height. Options are a gasketed plug or eliminating the port entirely via Qi charging. See [01](01-hardware.md).

### C3 — Mechanical shock
A 58 mm portafilter weighs 550–650 g. Setting a cup down carelessly, or the portafilter slipping, applies a multi-kilogram impulse to a cell rated for 1 kg. **Hard overload stops are mandatory**, not optional. A single-point cell that has been overloaded develops a permanent zero shift and a nonlinear response — it is dead, and it dies silently.

### C4 — Vibration
The scale is mechanically coupled to a running vibratory pump through the drip tray. A vibe pump excites at line frequency (50/60 Hz) with strong harmonics; rotary pumps are quieter but not silent. This lands directly in the band we care about and must be dealt with in the sample-rate and filter design, not discovered later. See [02](02-firmware.md).

## Target specifications

| Parameter | Target | Notes |
|---|---|---|
| Capacity | 1000 g | Sized for portafilter + cup, not for headroom |
| Displayed resolution | 0.1 g | 0.01 g in dosing mode |
| Internal resolution | ≥ 0.01 g | Oversampled; never displayed raw |
| Linearity error, 0–300 g | ≤ ±0.15 g | Calibrated over the used range, not full scale |
| Zero drift, 20→45 °C | ≤ ±0.3 g | *After* temperature compensation. Uncompensated is 1–3 g. |
| Output rate | 40 Hz | Decimated from 320 SPS |
| Settling time, step to ±0.1 g | ≤ 400 ms | Dosing mode |
| Flow-rate latency | ≤ 100 ms | Glass-to-glass, ADC to remote display |
| Flow-rate noise, steady flow | ≤ 0.1 g/s RMS | At 1.5–2.5 g/s |
| Scale height | ≤ 20 mm | Hard requirement |
| Scale platform | 100 × 100 mm | Fits a 58 mm portafilter and most cups |
| Battery life | ≥ 20 sessions | ~30 min active each; weeks of standby |
| Onboard shot capacity | ≥ 2000 shots | Full flow curves, not just summaries |
| Parts cost, scale | ≤ $60 | One-off, hand-assembled |
| Parts cost, display | ≤ $35 | |

## Operating modes

**Espresso.** The mode described above: auto-tare on vessel placement, auto-start on first flow, live weight/time/flow, auto-stop detection, shot persisted.

**Pour-over.** Longer timescale, larger masses. Different filter tuning (heavier smoothing, slower response is fine), a target-ratio guide, and bloom timing. Flow rate averaged over a longer window.

**Dose.** High-resolution mode for weighing beans into the single-dose cup. 0.01 g display, heavy filtering, stability lock. The dose recorded here auto-links as `dose_in` for the next espresso shot — this is how dose gets captured without a gram of extra hardware on the grinder. See [05](05-grind-advisor.md).

**Plain.** Just a scale. Tare button, unit toggle (g / oz), no state machine.

## Success criterion

The project succeeds if, after two months of daily use, there is a shot log dense enough that the grind advisor's recommendations are measurably better than the user's own guesses — and if the user never once had to open a phone app to get that data.
