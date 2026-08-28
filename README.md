# espresso·brewkit

**Measurement tools for espresso.** A browser-based toolkit for pulling a shot with
a Bluetooth scale streaming into the log, propagating measurement uncertainty, and
working out which variables actually move extraction yield — plus the design for an
open-source scale that records all of it without a phone.

**→ [Open the tools](https://mattlmccoy.github.io/espresso-brewkit/)**

Nothing installs, nothing uploads, and there is no account. The tools run entirely
in your browser; your shots live in your browser's local storage and export as a
plain CSV you own.

---

## The tools

| | |
|---|---|
| **[Live](https://mattlmccoy.github.io/espresso-brewkit/live.html)** | The session, driven by the scale. Weigh, grind, pull, rate — it steps itself. |
| **[Shots](https://mattlmccoy.github.io/espresso-brewkit/shots.html)** | Every shot you have pulled, with its flow curve, its diagnosis, and how it sits against the rest. |
| **[Advisor](https://mattlmccoy.github.io/espresso-brewkit/advisor.html)** | Which way to move the grind — one model inverts the flow physics, another searches your own ratings. |
| **[Kit](https://mattlmccoy.github.io/espresso-brewkit/kit.html)** | Bags, grinders, machines and consumables. What a shot was made with, how stale it was, and what is running out. |
| **[Lab](https://mattlmccoy.github.io/espresso-brewkit/lab.html)** | The analysis half: refractometry, regression, outlier detection, uncertainty propagation. |

Pulling a shot and analysing one are different activities on different schedules.
The first happens with a wet hand while coffee is going cold; the second happens
afterwards, needs a refractometer for its most interesting output, and rewards
sitting down. Putting all of it in one flat navigation bar made eight things look
equally routine when four of them are occasional — hence **Lab**.

## The session steps itself

The Live page is **Dose → Grind → Brew → Rate**, and the scale drives it. You weigh
beans, grind into the portafilter, lock in and pull; the only thing you touch is the
rating at the end. It produces a single row with 35 fields in it, including the flow
curve, and every other tool reads that row.

What makes this readable is not clever event detection. A scale-side tare and a
lifted vessel both just drop the reported number, and **nothing in the stream tells
them apart**. What separates them is that a vessel is not dose-sized:

```
dosing cup on      52 g    too heavy to be a dose  → ignored
press tare          0 g    a drop, but nothing was a candidate → ignored
beans in         18.2 g    plausible               → candidate
lift cup off      -52 g    a drop, with a candidate → COMMIT 18.2 g
portafilter on    469 g    too heavy               → ignored
press tare          0 g    ignored
grind into it    17.9 g    plausible               → candidate
carry to machine -521 g    → COMMIT 17.9 g
```

So: remember the last settled reading that could plausibly be coffee, and commit it
when the weight falls away. A drop with **no** candidate behind it is a tare or a
vessel being swapped, and it means nothing — which is exactly why the machine has to
sit still through it rather than advance.

Dose into an untared cup and brewkit only ever sees cup-plus-beans, which is not
dose-sized, so nothing is captured. It says so rather than recording the cup as
coffee.

Every captured value is displayed and stays editable, and every step is still
reachable by hand. The earlier auto-tare bug was not caused by automation; it was
caused by automation you could not see.

- **Dose and grounds-out are weighed, not assumed.** The difference is retention —
  the grounds still inside the grinder — which is why a single-dose workflow rarely
  gives back what you put in.
- **The curve is kept.** First-drip time, peak flow, steady flow and the late-shot
  flow slope are computed at full rate, then the curve is stored downsampled to 4 Hz
  (`t:w|t:w|…`, about 1.4 kB) so a CSV of shots still opens in a spreadsheet.
- **Idle means idle.** Weighing beans, taring, swapping a dosing cup for a
  portafilter — none of that is a shot, and the state machine does not react to
  any of it. Only arming starts vessel detection. Your scale's own tare button
  works too: when the reading jumps to zero brewkit follows it rather than
  stacking its own offset on top and showing a large negative number.

## Kit is a set of real objects

Bags, grinders and machines are entities, not free text typed onto each shot.
The shot stores an id; the name is copied alongside it so the exported CSV still
means something months later on a computer with no local storage.

A machine carries the settings it usually runs at — temperature, pressure,
pre-infusion, basket — and those become a shot's defaults, so they stop being
four fields retyped every time. Anything set on the shot itself still wins.
Machine *type* is recorded too, and is not decoration: a lever's pressure is
whatever the spring or your arm is doing at that instant, which means something
quite different from a pump machine's gauge reading.

## What is running out

Shots alone never account for a bag. Beans get purged through the grinder to
clear the last coffee, spilled, used for a pour-over, or thrown out when a bag
goes stale — so a log that only subtracts logged doses will always say you have
more left than you do, and **the error only grows**.

The balance is a ledger rather than a subtraction: shots deduct automatically,
and anything else you write down against the bag with a reason (purge, spill,
other brew method, gave some away, threw away, correction). A negative entry
corrects upward, which is what reconciling against what the bag actually weighs
looks like.

Remaining is reported in shots as well as grams, estimated from **your own recent
doses** rather than a nominal 18 g — pull triples and a nominal figure is wrong
by a third, and a wrong number there is worse than no number.

The same machinery covers everything else that depletes, because those differ
only in what they count: a **water filter** by shots pulled, **burrs** by kilos
ground, a **descale** by days elapsed. All of it appears on the Live dashboard
worst-first, so the thing about to bite is the thing you see while you are
standing at the machine.

## What you can watch while it pours

Six live numbers, none of which a scale's own display gives you:

| | |
|---|---|
| **Weight** and **Time** | tared and running, as you'd expect |
| **Flow** | estimated as a Kalman state, not differenced off the weight |
| **Lands at** | where the cup ends up if you cut *now*, including the drip that follows the pump |
| **To target** | seconds until you should cut, at the current flow |
| **Flow trend** | which way flow is heading, g/s² over the last few seconds |

That last one is the one worth having. An intact puck compacts as it runs, so
flow should be **sagging** by the middle of the shot. Flow that climbs is water
finding a path around the bed — and brewkit says so **while the shot is still
running**, about 0.5 s after the channel opens in testing, rather than in the
post-mortem. The trend is deliberately undefined until there is enough shot to
judge, so the opening ramp can never set it off.
- **The stop is predicted, not observed.** The puck keeps dripping after the pump
  cuts, so stopping when the cup reads the target overshoots it every time. The lag
  is learned from your own completed shots rather than assumed.
- **Nothing is required.** No scale, no bag, no rating — every step can be skipped
  or typed. A tool that insists on the full ceremony before it will time anything
  gets closed.

## What the curve tells you

Shot time and final weight cannot distinguish a channelled shot from a coarse one;
both are "22 seconds, 36 grams". The shape can. `diagnose.js` reads four scalars off
the curve and separates them:

| Signature | Reading |
|---|---|
| Flow **rises** through the back half | A channel opened. Grinding finer to fix the sourness makes the next one worse — it's a prep fault. |
| Flow falls steeply late | Fines migrating down and blocking the basket. Normal in small amounts. |
| First drop past ~12 s | Close to choking the machine; poor repeatability. |
| First drop under 3 s with fast flow | The bed is offering almost no resistance. |

An intact puck compacts as it runs, so its flow should **sag**. Flow that climbs is
water finding a path with less resistance than the bed around it, and that is the
one finding you cannot get from a stopwatch.

## Two models

**"What grind hits my target time?"** is physics. Flow through a packed bed is
Darcy's law, permeability goes as the square of particle size, and a grinder dial is
roughly linear in burr gap — so `log(flow)` comes out near-linear in dial setting.
Fit it, invert it, done. Usable after about three shots.

The grind sensitivity is **partially pooled**: it is mostly a property of the
grinder, not the bag, because the same dial step moves the burrs the same distance
whatever is in the hopper. So it is estimated across every shot on that grinder and
shrunk toward, rather than refit from the two shots a fresh bag has. The intercept
stays bag-specific, since how much a particular coffee resists is exactly what
changes between bags. The page says which half of the answer it borrowed.

**"What grind tastes best?"** is not physics — nobody has a model of your palate. So
it is a search: a Matérn 5/2 Gaussian process over your ratings, with expected
improvement picking the next setting to try, and a distance penalty so it does not
tell you to jump eight steps on the strength of six shots. It needs closer to ten
rated shots, and it says so instead of guessing.

Ratings are ordinal — the step from 6 to 7 is not necessarily the step from 8 to 9 —
and this treats them as continuous with a generous noise term. That approximation is
stated in the UI, because it is why the suggestion is a place to look rather than an
answer.

## Three things this does that a spreadsheet won't

**It tells you when not to believe the fit.** Every regression reports the slope's
95% confidence interval and says plainly whether it excludes zero. A trend line
through eight points with an interval spanning zero gets drawn — and labelled as
something not to act on. R² alone will not tell you that.

**It shows you which measurement is limiting you.** The uncertainty budget
decomposes the error in an extraction-yield figure into per-input contributions and
ranks them by share of variance. The usual result is that scale resolution
contributes essentially nothing while the Brix→TDS conversion factor dominates —
which means a better scale is not the upgrade, and buying one is money spent on the
wrong term.

**It doesn't trust the z-score.** A plain z-score is computed against a mean and
standard deviation that the outlier itself inflates, so at n=15 one extreme point
can push the threshold out past itself and vanish. Outliers are scored three ways,
including a median/MAD-based modified z-score that an outlier cannot drag.

## Live capture over Bluetooth

The Live page talks to a scale directly from the browser over Web Bluetooth —
no app, no phone, no server. It computes its own flow rate from the weight
stream with a constant-velocity Kalman filter (`site/assets/js/core/filter.js`),
because most scales report weight only, and differencing a smoothed weight signal
costs filter delay twice and amplifies the noise you just removed.

**Steps are detected, not filtered.** A constant-velocity model is a good
description of espresso and a terrible one of putting 18 g of beans on a scale: a
step has no velocity, so the filter can only explain a jump as an enormous one, and
it slingshots past. The plain version overshot an 18 g step to 25 g and took 1.7 s
to settle. Now a single large innovation is still damped as a droplet impact or a
knock, but several in a row all in the same direction are taken as the world having
genuinely changed — believe the scale, zero the flow, carry on. That settles in one
sample with no overshoot, and it frees the process noise to be tuned for flow
smoothness alone rather than for chasing steps.

**A saved scale is one click.** `requestDevice()` always shows the browser's
chooser — that *is* the permission prompt, so there is no way around it the first
time. But `navigator.bluetooth.getDevices()` returns devices the origin already
holds a persisted permission for, and connecting to one of those needs no chooser
at all. Saved scales are buttons: click yours and it connects. Where the browser
has no `getDevices()`, clicking still opens the chooser — filtered to that one
device rather than everything in the room — and the page says which of the two is
about to happen instead of promising one click and delivering the other.

**Browser support is the real constraint.** Chrome, Edge and Opera have Web
Bluetooth; Firefox and Safari do not, and on iOS no browser does. It also needs a
secure context, which GitHub Pages provides but a plain-http LAN address does not.

**Undocumented scales.** Most cheap BLE scales send an unlabelled fixed-layout
frame, and there are only a few hundred plausible encodings. Rather than needing a
datasheet, the Live page searches: put known masses on, tell it what the scale
reads, and it solves for offset, width, byte order, sign and scale factor, then
remembers the answer for that device. There is a byte-level frame view alongside it
for the cases that need a human.

**Supporting more scales, without guessing at protocols.** Shipping a driver
reverse-engineered from memory is worse than shipping none: a wrong scale factor
produces *plausible* numbers, which is the failure mode that is never caught by
eye. So breadth comes from two places that do not require inventing anything.

The first is the **standard [SIG Weight Scale profile](https://www.bluetooth.com/specifications/specs/weight-scale-service-1-0/)**
(`0x181D` / `0x2A9D`) — a published spec, implemented exactly, so a scale that
speaks it works with no teaching step. Its flags byte carries a metric/imperial
bit, so the scale factor is a property of the frame rather than of the device; a
driver that assumed one would be wrong by a factor of 2.2 on a scale set to the
other. Worth knowing before you rely on it: **the profile's resolution is 0.005 kg
— 5 g steps.** That is fine for a bathroom scale and useless for dosing espresso,
and the page says so rather than presenting a confident-looking 18 g.

The second is **shareable profiles**. Once a scale has been taught, Device
settings exports a small JSON file describing how it encodes weight; anyone with
the same model imports it and skips the teaching step entirely. A scale is then
worked out once by somebody rather than once by everybody, and adding support is
a file rather than a code change. Imported decoders run against live frames, so
every field is validated on the way in rather than trusted — and a profile whose
characteristic the connected scale does not notify on is refused as being for a
different model.

**A limitation worth knowing before you start.** Web Bluetooth will not enumerate a
GATT service the page did not declare in advance — there is no "list everything"
call. `transport.js` asks for a list of service UUIDs that cheap scales commonly
use, but a scale outside that list will appear to have no services at all. That is
the API behaving as designed, not a broken device.

The same driver interface is what the [scale in `design/`](design/03-wireless.md)
will connect through, so building this is not throwaway work.

## Repository layout

```
site/       the GitHub Pages app — plain HTML + ES modules, no build step
  assets/js/core/    stats, uncertainty, coffee math, CSV, storage, charts, filters,
                     bags and grinders, curve diagnosis, the two advisor models
  assets/js/ble/     Web Bluetooth transport, protocol auto-decoder, mock scale
data/       shots.csv (canonical dataset) + the original per-shot files
design/     specification for the scale hardware and firmware
test/       Playwright UI suite and its static server
```

### `site/`

Static. No bundler, no framework, and nothing to build — the site has no runtime
dependencies at all. ES modules need HTTP, so `file://` won't work; serve it:

```bash
npm run serve                 # prints a local URL, serves site/ with data/ mounted
```

## Tests

`npm test` drives the site in a real browser and asserts on what actually renders.
212 assertions across the site in both themes: the analysis results, the
legacy CSV import path, the 3D drag interaction, theme persistence, font loading,
WCAG contrast on chrome pairs, grid alignment, horizontal overflow, chart sizing,
and the absence of rhetorical-question headings.

The models are tested against ground truth rather than against themselves. The
resistance fit is given shots generated from a known `log(Q) = a + b·grind + c·days`
and has to recover `b` and `c`; the recommendation has to match the closed-form
inverse; the curve metrics have to recover a flow profile whose peak, steady rate
and late slope are known by construction; and the filter has to survive a step, a
droplet impact, a slow pour and a whole shot. Refusals are tested too — the advisor
must decline to fit two shots, or eight shots all at the same setting, rather than
emitting a confident number.

```bash
npm install
npx playwright install chromium
npm test
```

Playwright is the only dependency and it is dev-only — nothing ships to the browser.
The suite runs on every pull request via `.github/workflows/test.yml`.

It exists because it keeps finding real defects that reading the source did not: a
grid adjacency margin staircasing a row of controls, a `min-width:auto` track forcing
29px of horizontal page overflow, an illegible colour pairing that only appears in
dark mode, and a chart size cap applying to the wrong charts.

Charts are hand-rolled SVG rather than a charting library. Three reasons: the chart
types here are few and specific, colours come from CSS custom properties so
everything follows the light/dark theme and the design language for free, and the
3D view needs a fitted regression plane rather than a generic surface. Markup, CSS
and JS come to roughly 55 kB across the whole site, against ~3 MB for Plotly.

Fonts (Archivo, Archivo Black, Space Mono) are self-hosted from `site/assets/fonts/`
— latin subsets only, ~160 kB, cached after the first page. Self-hosted rather than
linked from Google Fonts so there is no third-party request, no render-blocking
dependency on a host outside the project, and the pages render identically offline.

### Design language

Hard edges and offset shadows, no border radius anywhere, Archivo Black for display
type, Space Mono for every number. One accent for chrome and data points, one for the
fitted line, one for anything flagged — so no colour has to mean two things at once.
Both themes are defined in `site/assets/css/app.css` as custom properties; the chart
module reads those properties and knows nothing about the palette, which is why
restyling the site does not touch the maths.

Page headings state the tool's name. No rhetorical questions, no taglines.

### `design/`

The scale is a design, not a build — see [`design/`](design/) for the full
specification and [`design/06-roadmap.md`](design/06-roadmap.md) for the plan.
Short version of the interesting decisions:

- **NAU7802 over the usual HX711.** 320 SPS rather than 80 leaves room to
  oversample and to build an anti-alias filter that rejects vibration pump noise
  at 50/60 Hz. At 80 SPS that noise aliases into the passband, where it is
  unrecoverable by any downstream filter.
- **Flow rate as a Kalman state, not a derivative.** A constant-velocity filter
  carries `[weight, flow]` jointly, so flow comes out as an estimate rather than
  `Δw/Δt` on a smoothed signal — no derivative noise amplification, no second
  helping of filter delay.
- **ESP-NOW for the detachable display.** ~2 ms round trip against BLE's realistic
  15–30 ms, which is the difference between a readout that feels attached to the
  scale and one that feels like a laggy remote.
- **~$52 in parts.** The $200 scales use the same load cells.

## Migrating from the Python version

This repository previously held a 1,059-line interactive CLI (`espresso_extraction.py`)
that wrote one CSV per shot. That is gone; the git history has it if you want it.
Everything it did is now in the web tools, and a few things it did wrong are fixed:

| Then | Now |
|---|---|
| One CSV per shot, headers repeated in each | One table, `data/shots.csv` |
| TDS stored as a fraction but labelled TDS | Stored as a percentage, consistently |
| Brix factor treated as an exact constant | Treated as a measured value with its own uncertainty |
| R² and RMSE only | Slope confidence intervals, significance, residual plots, adjusted R² |
| Z-score outliers | Z-score, IQR, and modified z-score side by side |
| matplotlib windows and saved PNGs | Interactive SVG, themed, in the page |

Your old files still work — drop any of the original `extraction_N.csv` files onto
the [shot log](https://mattlmccoy.github.io/espresso-brewkit/logger.html) and they
convert on import. The 15 original extractions are preserved in
[`data/legacy/`](data/legacy/) and ship as the sample dataset.

### About the Brix factor

The largest correctness change is that the Brix→TDS factor is no longer treated as
exact. A refractometer measures refractive index and reports it on a sucrose scale;
coffee solubles are not sucrose, so a correction is applied. 0.85 is the common
convention, but the true value depends on roast level, reference method, and
instrument, and published values span roughly 0.79–0.89. Propagating only the Brix
and mass uncertainties — as the original did — understates the result. Set `u(k)`
to 0 in the [uncertainty tool](https://mattlmccoy.github.io/espresso-brewkit/uncertainty.html)
to reproduce the old numbers and see the difference.

## Deploying

`.github/workflows/pages.yml` builds and deploys `site/` on every push to `main`.
It needs **Settings → Pages → Source: GitHub Actions** enabled once.

## Video

The original project walkthrough, from the Python era:
<https://www.youtube.com/watch?v=FDcUICSV3XE>

## License

MIT — see [LICENSE](LICENSE).
