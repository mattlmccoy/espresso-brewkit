# 06 — Roadmap & risks

## Sequencing principle

**Get real shot data flowing as early as possible, in the ugliest way that works.**

The instinct is to design the PCB and the enclosure first, because those are the parts that feel like "the product." That ordering is wrong here. The thing the project exists to fix is *the absence of a shot log* — and a breadboard on a scrap of aluminium under the portafilter fixes that just as well as a finished product does. Meanwhile the analysis in [05](05-grind-advisor.md) needs **weeks of data** before it can say anything, so the data collection clock should start as early as possible and run in parallel with the hardware work.

Concretely: **P1 is worth more than P3.** A working data pipeline on an ugly prototype beats a beautiful enclosure with nothing in it. Every week P1 slips is a week of shots that don't exist.

---

## P0 — Characterization *(a weekend)*

**Measure before committing to anything.** No enclosure, no PCB, no product decisions. Load cell + NAU7802 breakout + ESP32-S3 devkit + OLED, wired on a bench, cell bolted between two scraps of aluminium.

Deliverables — each one is a **number that settles a decision left open in [01](01-hardware.md)**:

| Measurement | Settles |
|---|---|
| Noise floor at gain 128 / 320 SPS (Allan deviation, 0.1 s – 100 s) | Achievable resolution; the `R` in the Kalman filter ([02](02-firmware.md)) |
| Creep: 40 g applied, log 5 min | Whether 30-second creep is inside the error budget |
| TC-zero: cold start to thermal equilibrium, logging zero vs. die temp | Whether linear tempco is sufficient or hysteresis needs modelling |
| **Vibration spectrum with the machine running**, 320 SPS FFT | The decimation filter design; whether soft feet alone suffice |
| Settling time after a 100 g step | Whether the 400 ms target is reachable |
| Stack height of the real cell + plates + stops | Low-profile cell vs. pocketed base; whether Qi's 5 mm is affordable |

**Exit criterion:** the noise floor supports 0.1 g display resolution, and the pump's vibration is either mechanically attenuated or falls where a realizable FIR can reject it. If the vibration measurement comes back ugly, that changes the sample-rate and filter design — which is exactly why it happens *before* anything is committed.

*If P0 says the cheap cell can't do it, that is a successful P0.* Finding out now costs a weekend; finding out after a PCB spin costs a month.

---

## P1 — Firmware core & data capture *(2–4 weeks)*

Still a breadboard, but living under the espresso machine full-time in a printed sled. **This is the phase that delivers the original complaint's fix.**

- Kalman filter + robust update + decimation, tuned against P0's measurements
- Two-point calibration, tempco correction, auto-zero with the brew-state interlock
- Brew state machine, all four modes
- LittleFS shot storage, CBOR records
- USB MSC export
- Tier 1 flow-curve diagnosis on-device
- Host-side test harness and the recorded-trace corpus from [02](02-firmware.md)

**Exit criterion:** a week of daily shots logged with zero manual intervention, exported by plugging in a USB cable. **The phone never opens.** At this point the project has already succeeded at its primary goal (G1) on a breadboard, and everything after is refinement.

---

## P2 — The wireless display *(2–3 weeks)*

- ESP-NOW protocol, pairing, channel handling, link-loss behaviour
- Display unit: ST7789, encoder, buttons, USB power
- Fast grind-setting entry — *the two-second interaction that [05](05-grind-advisor.md) depends on*
- Post-shot rating prompt
- Latency measured end-to-end against the ~63 ms budget in [03](03-wireless.md), not assumed

**Exit criterion:** grind setting and rating are captured on **every** shot without friction. Measured by the missingness rate in the log, not by how it feels.

---

## P3 — PCB & enclosure *(4–8 weeks, the long pole)*

- Custom PCB, both units
- ≤ 20 mm scale enclosure, PETG/ASA, aluminium load path
- Overload stops with shim adjustment, verified by test
- IP54 gasketing; Qi vs. gasketed USB-C decided by P0's height numbers
- Battery, temperature-gated charging, power management
- BLE + Felicita-compatible shim

**Exit criterion:** it looks like a scale, survives a month in the drip tray, and survives a deliberate portafilter drop onto the platform.

---

## P4 — The advisor *(ongoing, gated on data)*

Starts once P1 has produced ~50 shots and cannot start earlier no matter how much anyone wants it to.

- Tier 2 hierarchical resistance model
- Hold-out validation; the error-vs-`n` curve from [05](05-grind-advisor.md)
- Tier 3 Bayesian optimization, once ~20 rated shots per bean exist
- Merge with [espresso-extraction-py](https://github.com/mattlmccoy/espresso-extraction-py); regress extraction yield against *measured* flow resistance rather than dial position

---

## P5 — Grinder instrumentation *(optional)*

Deliberately last, because **the dose auto-linking in [04](04-data-model.md) already captures the important covariate with zero grinder hardware.** This phase buys convenience and a few second-order signals, not the core capability. Doing it earlier would be building hardware to solve a problem already solved in software.

- **AS5600** magnetic encoder on the adjustment collar → grind setting read automatically, eliminating manual entry and its non-random missingness
- **INA219** motor current sensing → grind time and load, which correlate with bean hardness and burr wear
- Automatic retention measurement (beans in vs. grounds out, both on the same scale)

---

## Risks

Ordered by expected pain.

### High

**Load cell zero drift in a hot drip tray.** The most likely reason this reads 0.4 g with nothing on it. TC-zero is 0.02–0.05 % FS/°C — grams, not tenths, across a warm-up ([01](01-hardware.md)). *Mitigation:* per-unit tempco calibration, auto-zero tracking, and P0 characterization before committing. *If it fails anyway:* a second reference cell for differential measurement, at real cost in height and complexity.

**Pump vibration aliasing.** Once folded into the passband it is **unrecoverable in software** ([02](02-firmware.md)). *Mitigation:* measure the spectrum in P0 — before the filter is designed — soft feet first, then a decimation FIR with deliberate nulls at 50/60 Hz.

**Not enough data for the advisor.** Five shots a day is ~150/month spread across several bags. Tier 3 may simply never have enough per-bean data if bags rotate weekly. *Mitigation:* hierarchical pooling across bags is designed for exactly this, and Tiers 1 and 2 remain useful regardless. *Accept:* Tier 3 may stay a "sometimes" feature for people who buy the same coffee repeatedly. Say so rather than faking it.

### Medium

**The 20 mm height budget.** Cell body + plates + stops + battery + PCB adds up faster than it looks, and Qi charging wants 5 mm of it. *Mitigation:* P0 measures the real stack before anything is designed around it. *Fallback:* 24 mm, which is still thinner than most commercial scales.

**Overload destroying a cell.** A dropped portafilter is several kg on a 1 kg cell, and the failure is *silent* — a permanent zero shift and a nonlinear response that still looks like a working scale. *Mitigation:* shim-adjustable hard stops, verified at assembly. *Detection:* a periodic check-weight routine that flags a calibration that has moved more than expected.

**Printed plastic creep near a hot machine.** PLA is disqualified outright ([00](00-requirements.md)). Even PETG creeps under sustained load at 45 °C. *Mitigation:* aluminium in the load path, plastic only for the shell.

**BLE / ESP-NOW coexistence jitter.** One radio, time-shared ([03](03-wireless.md)). *Mitigation:* ESP-NOW has priority, BLE is droppable, Wi-Fi doesn't run during sessions.

### Low

**OLED burn-in** from a static `0.0 g`. *Mitigation:* dim, pixel-shift, blank on idle.

**Water ingress.** IP54 is achievable with a gasket and conformal coating; the USB port is the weak point. *Mitigation:* Qi if the height allows, gasketed plug otherwise.

**Third-party BLE protocol drift.** The Felicita shim ([03](03-wireless.md)) could break if an app changes. *Accept:* it is a convenience layer. The authoritative record is on flash and nothing depends on it.

---

## What "done" looks like

From [00](00-requirements.md), unchanged:

> After two months of daily use, there is a shot log dense enough that the grind advisor's recommendations are measurably better than the user's own guesses — and the user never once had to open a phone app to get that data.

Note that **P1 alone satisfies the second half.** The first half needs P4, and P4 needs P1's data to have been accumulating the whole time. Which is the argument for the sequencing at the top of this document, restated as an outcome.
