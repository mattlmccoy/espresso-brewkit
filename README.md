# espresso·brewkit

**Measurement tools for espresso.** A browser-based toolkit for logging shots,
propagating measurement uncertainty, and working out which variables actually move
extraction yield — plus the design for an open-source scale that records all of it
without a phone.

**→ [Open the tools](https://mattlmccoy.github.io/espresso-brewkit/)**

Nothing installs, nothing uploads, and there is no account. The tools run entirely
in your browser; your shots live in your browser's local storage and export as a
plain CSV you own.

---

## The tools

| | |
|---|---|
| **[Calculator](https://mattlmccoy.github.io/espresso-brewkit/calculator.html)** | Brix → TDS → extraction yield, brew ratio, solids in the cup, average flow. Plus the ratio you'd need to hit a target yield. |
| **[Shot log](https://mattlmccoy.github.io/espresso-brewkit/logger.html)** | Record shots, derive everything downstream, import and export one CSV. Reads the old one-file-per-shot format too. |
| **[Explore](https://mattlmccoy.github.io/espresso-brewkit/explore.html)** | Regress any response against one variable or two. Confidence bands, residual plots, a rotatable 3D plane fit, and a correlation matrix. |
| **[Quality](https://mattlmccoy.github.io/espresso-brewkit/quality.html)** | Outlier detection by three methods, and the repeatability statistics that tell you whether your data can support a conclusion at all. |
| **[Uncertainty](https://mattlmccoy.github.io/espresso-brewkit/uncertainty.html)** | GUM propagation through the yield equation, with a variance budget showing which measurement is actually limiting you. |

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

## Repository layout

```
site/       the GitHub Pages app — plain HTML + ES modules, no build step
  assets/js/core/    stats, uncertainty, coffee math, CSV, storage, SVG charts
data/       shots.csv (canonical dataset) + the original per-shot files
design/     specification for the scale hardware and firmware
```

### `site/`

Static. No bundler, no framework, no npm. Open `site/index.html` over a local
server and it runs — ES modules need HTTP, so `file://` won't work:

```bash
cp -r data site/data          # the sample loader fetches ./data/shots.csv
python3 -m http.server -d site 8000
```

Charts are hand-rolled SVG rather than a charting library. Three reasons: the chart
types here are few and specific, colours come from CSS custom properties so
everything follows the light/dark theme for free, and the 3D view needs a fitted
regression plane rather than a generic surface. It also keeps the page under
50 kB total instead of pulling ~3 MB of Plotly for four charts.

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
