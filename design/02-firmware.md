# 02 — Firmware

ESP-IDF + FreeRTOS. C, or C++ where it earns it.

## Architectural principle

**One producer, many consumers, no shared mutable state.**

The measurement chain produces a single stream of `WeightSample` events. The display, the BLE stack, the ESP-NOW link, the shot recorder, and the logger are all *subscribers* to that stream. None of them can influence it, and none of them can block it.

This is what makes G1 true. The logger doesn't care whether a display is attached. The shot state machine doesn't care whether a phone is connected. Pull any consumer and the rest is unaffected.

```
NAU7802 ─DRDY─► adc_task ─┐
                          │  raw ring buffer (320 Hz)
                          ▼
                     filter_task ──► event bus (40 Hz, calibrated grams + flow)
                                        │
             ┌──────────────┬───────────┼──────────┬────────────┐
             ▼              ▼           ▼          ▼            ▼
         brew_task      ui_task    espnow_task  ble_task    log_task
```

## Task table

| Task | Core | Prio | Period | Responsibility |
|---|---|---|---|---|
| `adc_task` | 1 | 24 | DRDY IRQ | Read NAU7802, timestamp, push to ring buffer. Nothing else. |
| `filter_task` | 1 | 20 | 8 samples | Decimate, filter, calibrate, estimate flow. Publish. |
| `brew_task` | 0 | 15 | on event | Shot state machine, target tracking, drip prediction. |
| `log_task` | 0 | 12 | on event | Append to shot buffer; commit to LittleFS at shot end. |
| `espnow_task` | 0 | 14 | 40 Hz | Transmit state to display; receive commands. |
| `ble_task` | 0 | 10 | 20 Hz | GATT notifications. Lowest priority — it is the most droppable consumer. |
| `ui_task` | 0 | 8 | 30 Hz | Local OLED render. |

`adc_task` and `filter_task` are pinned to core 1 and share it with nothing else. Wi-Fi and BLE stacks live on core 0. **The measurement chain must never contend with the radio.** A missed DRDY is an irrecoverable hole in the sample stream; a dropped BLE notification is nothing.

`adc_task` does *only* the I²C read. Any temptation to do filtering there should be resisted — the I²C transaction is already the long pole and the interrupt-to-read latency directly becomes timestamp jitter.

---

## Signal processing

This is the hard part and the part that separates a good scale from a bad one.

### The problem

Three demands in direct conflict:

1. **Low noise.** Displaying a jittering last digit destroys trust in the instrument.
2. **Low latency.** Flow rate is only useful if it describes *now*. A 300 ms lag means the number on screen describes a moment that has passed, and any decision made on it — cut the shot, adjust — is late.
3. **Impulse rejection.** Espresso does not flow smoothly onto a scale. It arrives as droplets and streams that *impact* the vessel. Each impact is a force spike far larger than the mass it delivers. A naive filter treats these as signal.

A moving average trades (1) against (2) linearly and does nothing for (3). An N-tap moving average has a group delay of exactly `(N-1)/2` samples — at 40 Hz, a 12-tap average costs 137 ms of lag before you've even differentiated. Then differentiating a smoothed signal to get flow rate compounds the delay and amplifies whatever noise survived. **This is why naive DIY scales feel bad**, and it is not fixable by tuning the average length.

### The approach: a constant-velocity Kalman filter

Model the state as

```
x = [ w  ]   mass, grams
    [ q  ]   flow rate, grams/second
```

with the process model

```
w[k] = w[k-1] + q[k-1]·Δt
q[k] = q[k-1] + noise
```

That is, *flow rate is assumed constant and slowly varying* — which is a genuinely good description of espresso extraction, where the flow curve is smooth over hundreds of milliseconds. This model fits the physics, and that is why it outperforms generic smoothing.

The payoff: **flow rate comes out as an estimated state, not a numerical derivative.** There is no `(w[k] - w[k-1])/Δt` anywhere, and therefore no derivative noise amplification and no second helping of filter delay. The filter uses the *whole* history, optimally weighted, to estimate both mass and its rate simultaneously.

```
Predict:   x⁻ = F·x,           P⁻ = F·P·Fᵀ + Q
Update:    y  = z − H·x⁻                        (innovation)
           S  = H·P⁻·Hᵀ + R
           K  = P⁻·Hᵀ·S⁻¹
           x  = x⁻ + K·y,      P = (I − K·H)·P⁻

F = [1  Δt]    H = [1  0]      (we measure mass only)
    [0   1]
```

**Tuning.** `R` is the measurement noise variance, measured directly in P0 from the static noise floor — it is not a knob, it is a number you go and measure. `Q` encodes how fast flow is allowed to change, and it *is* the tuning knob: too small and the filter lags real changes in flow; too large and it tracks noise. Expect different `Q` per mode (espresso vs. pour-over vs. dosing).

### Impulse rejection: robust update

The standard Kalman update assumes Gaussian measurement noise. Droplet impacts are emphatically not Gaussian — they are large, one-sided, short outliers. Applied naively they kick the estimate and, worse, the filter's own gain logic interprets a run of them as genuine signal.

Two layers:

1. **Hampel prefilter** on the decimated stream. Over a sliding window, compute the median and the median absolute deviation; replace any sample more than ~3·MAD from the median with the median. This kills single-sample spikes without the blunt-instrument delay of a plain median filter.
2. **Innovation gating in the update.** Compute the normalized innovation `|y|/√S`. If it exceeds ~4σ, this sample is an outlier: inflate `R` for this step only (equivalently, apply a Huber-style bounded gain) rather than rejecting outright. Inflating rather than rejecting is important — a genuine fast transient (someone sets a cup down, the shot suddenly gushes) also produces large innovations, and a hard reject would make the filter blind exactly when the world is changing. Inflating degrades gracefully; rejecting fails hard.

### Two operating regimes

The optimal filter for dosing beans and the optimal filter for tracking a live shot are not the same filter.

| | **Settle mode** | **Track mode** |
|---|---|---|
| Used for | dosing, tare, static weighing | extraction, pour-over |
| `Q` | small | large |
| Priority | noise | latency |
| Display | 0.01 g, locks when stable | 0.1 g, live |

Switch automatically on sustained innovation magnitude: consistently large innovations mean the world is moving, so go to track mode; a quiet period means go to settle. A **stability detector** — variance below threshold for ~500 ms — locks the settle-mode display and lights a "stable" indicator, which is what makes a dosing readout feel authoritative rather than twitchy.

### Anti-alias and the pump (constraint C4)

Decimating 320 → 40 Hz folds everything above 20 Hz into the passband. A vibratory pump at 50/60 Hz plus harmonics lands squarely in the fold-down zone, and once aliased it is **mathematically unrecoverable** — no downstream filter can remove it.

So the decimation filter is not a formality:

- A **CIC or polyphase FIR decimator** with real stopband attenuation (≥ 60 dB) above 20 Hz, not an 8-sample box average. A box average's first null is at 40 Hz, which happens to help at 60 Hz but leaves 50 Hz and the odd harmonics poorly attenuated.
- Place **deliberate nulls at 50 and 60 Hz** in the FIR design so both mains regions are covered regardless of locale.
- Soft feet (see [01](01-hardware.md)) attenuate mechanically before any of this matters. **Mechanical isolation is cheaper than DSP** and should do most of the work.

P0 must characterize the actual spectrum with the actual machine. Designing this filter from theory alone is guessing.

---

## Calibration

### Two-point, over the range that matters

```
grams = (raw − offset) · scale
```

`offset` from a zero reading; `scale` from a known mass. **Calibrate with a 100 g mass, not a 1 kg mass** — see [01](01-hardware.md) on why local linearity beats full-scale linearity for our working range. Store both in NVS along with the calibration timestamp and the temperature at which it was performed.

Optionally, a three-point fit (0 / 100 / 300 g) with a quadratic term, if P0 measurements show it earns its complexity. Default to linear.

### Temperature compensation

This is the highest-value correction in the whole firmware, because TC-zero is the dominant error source (constraint C1, and see [01](01-hardware.md) — uncompensated zero shift is measured in *grams*, not tenths).

**Bake-out procedure**, run once per unit at build time:
1. Empty platform, unit powered, logging raw zero and NAU7802 die temperature at 1 Hz.
2. Let it self-heat and, ideally, sit on the machine through a warm-up cycle. Capture 20 → 45 °C.
3. Fit `offset(T) = offset₀ + α·(T − T₀)`. Store `α` in NVS.

`α` is **per-unit**, not per-design — cell-to-cell variation in TC-zero is large. Assuming a shared constant would leave most of the error on the table.

Whether a linear model suffices, or whether hysteresis (different `α` warming vs. cooling) demands something with memory, is a P0 measurement question.

### Auto-zero tracking

Every commercial scale does this and so must we: slowly drag the offset toward zero when the platform is plausibly empty. It absorbs residual thermal drift, creep recovery, and the fine grounds that accumulate on the platform over a week.

Guard conditions — **all** must hold:
- |weight| < 0.5 g
- stable (settle-mode stability detector asserted) for > 2 s
- not in any brew state other than `IDLE`
- correction rate limited to ≤ 0.05 g/s

**The interlock on brew state is critical.** Auto-zero running during a shot would slowly eat the very mass you are trying to measure, and it would do so silently and plausibly. This is the kind of bug that produces months of subtly wrong data before anyone notices. Assert it in code, and test it.

---

## Brew state machine

```
                    ┌─────────┐
        ┌──────────►│  IDLE   │◄──────────────────────┐
        │           └────┬────┘                       │
        │      mode = espresso                        │
        │                ▼                            │
        │      ┌──────────────────┐                   │
        │      │ AWAITING_VESSEL  │  "Place cup"      │
        │      └────────┬─────────┘                   │
        │   w > 20 g AND stable 400 ms                │
        │        → auto-tare                          │
        │                ▼                            │
        │      ┌──────────────────┐                   │
        │      │  AWAITING_FLOW   │  "Ready — pull"   │
        │      └────────┬─────────┘                   │
        │      q > 0.3 g/s for 200 ms                 │
        │        → t₀, record t_first_drip            │
        │                ▼                            │
        │      ┌──────────────────┐                   │
        │      │    EXTRACTING    │  live w, t, q     │
        │      └────────┬─────────┘                   │
        │      q < 0.15 g/s for 1.5 s                 │
        │                ▼                            │
        │      ┌──────────────────┐                   │
        │      │    DRIPPING      │  3 s settle       │
        │      └────────┬─────────┘                   │
        │                ▼                            │
        │      ┌──────────────────┐                   │
        └──────┤    COMPLETE      │  persist, rate    │
   vessel      └──────────────────┘                   │
   removed              │  w drops > 20 g             │
                        └─────────────────────────────┘
```

### Details that matter

**Vessel removal must not be mistaken for the shot ending.** Both look like "weight changed." The discriminator is sign and magnitude: a rapid *decrease* exceeding 20 g is a removal, at any state, and returns to `IDLE`. Getting this wrong means truncated or duplicated shot records.

**`t_first_drip` is recorded separately from `t₀`** and is a genuinely diagnostic metric — it is the most direct observable of puck resistance available without a pressure sensor, and it feeds [05](05-grind-advisor.md).

**Timer start convention.** Starting on first flow rather than on pump-on measures the puck, not the machine's pre-infusion program. This is the right choice for a scale that cannot see the pump — but it means the recorded time is *not* comparable to a machine-mounted timer, and the data model records `timer_convention` explicitly so nobody is misled later ([04](04-data-model.md)).

**Manual override everywhere.** Every automatic transition can be forced by a button. The state machine is a convenience, not a cage; when it guesses wrong the user must be able to just start the timer.

### Predictive stop

After the pump cuts, 1–3 g still drips from the puck. Stopping *at* the target overshoots by that much, every time.

```
w_signal = w_target − q̂ · t_lag
```

where `q̂` is the current filtered flow estimate and `t_lag` is the machine's stop latency. The good part: **`t_lag` is learnable.** Every completed shot yields `(w_at_stop_signal, w_final)`, so

```
t_lag ← running estimate of (w_final − w_at_stop_signal) / q̂_at_stop
```

converges to a per-machine, per-basket constant after a handful of shots. Seed at 1.0 s, adapt with a slow exponential moving average, clamp to [0.2 s, 3.0 s].

The output is an audible/visual cue to stop. A **GPIO stop signal** is exposed for anyone wanting to close the loop into a machine (Gaggiuino and similar), but this repo does not drive a pump — see the non-goals in [00](00-requirements.md).

---

## Storage

**LittleFS** on a dedicated flash partition. Power-loss resilient, wear-levelled, and appropriate for a device with no shutdown ritual — someone *will* pull the battery mid-shot.

- During a shot, samples accumulate in a **PSRAM ring buffer** (8 MB available; a 60 s shot at 40 Hz is trivial).
- On `COMPLETE`, the record is encoded and committed as a single file write.
- **A shot in progress is never written incrementally.** Flash writes at 40 Hz would wear the part and inject latency into the measurement chain for no benefit. The cost of a mid-shot power loss is one shot, which is acceptable.

Wear-levelling note: at ~5 shots/day and ~2 kB/shot, a 4 MB partition sees roughly 3 MB of writes per year. Flash endurance is a non-issue at this duty cycle.

Schema and encoding are in [04](04-data-model.md).

---

## Testing

The measurement chain is the part that is both hardest to get right and easiest to test in isolation, so:

**Host-side unit tests.** The filter, calibration, and state machine compile and run on a host with no hardware. Feed them recorded sample streams; assert on outputs. This is the whole reason the architecture is a pure event pipeline.

**A corpus of real recordings.** From P0 onward, save raw 320 SPS traces of: a normal shot, a gusher, a choked shot, a portafilter dropped on the platform, a cup slid across, a shot with the steam wand purging mid-pull, and a full warm-up thermal ramp. Every filter change is then evaluated against **all** of them, which prevents the classic failure of tuning for one nice-looking shot and regressing everything else.

**Assertions worth writing explicitly:**
- Auto-zero never fires outside `IDLE`.
- No state transition on a monotonic weight *decrease* except removal.
- Reported flow rate integrates to within 1 % of the measured mass delta over a shot. *(This is a strong end-to-end invariant — it catches filter delay, gain errors, and calibration drift in a single assertion.)*
- A shot record is recoverable after a power cut at any point after `COMPLETE`.
