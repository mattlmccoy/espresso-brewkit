# 05 — Grind advisor

> *"We could tell it what grind setting we're on, and then analyze and figure out what the next best grind setting could be."*

Yes — but the honest version of this has three tiers with very different data requirements, and conflating them is how these projects end up shipping confident nonsense.

| Tier | What it does | Needs | Available |
|---|---|---|---|
| **1. Diagnosis** | Reads the flow curve, names the failure | nothing | **shot #1** |
| **2. Resistance model** | Predicts grind change to hit a target time/flow | ~6 shots on a bean | **week 1** |
| **3. Taste optimization** | Proposes the setting that maximizes predicted rating | ~20 rated shots | **month 1+** |

Ship them in that order. Tier 1 is useful immediately and never wrong, because it doesn't predict anything — it describes. Tier 3 is the exciting one and it is worthless until the data exists.

---

## The physics

Espresso is flow through a packed bed. Darcy's law:

```
Q = (k · A · ΔP) / (μ · L)
```

`Q` flow rate, `k` bed permeability, `A` basket area, `ΔP` pressure drop, `μ` viscosity, `L` puck depth.

The Kozeny–Carman relation gives permeability's dependence on particle size:

```
k ∝ d² · ε³ / (1 − ε)²
```

`d` particle diameter, `ε` bed porosity. **Permeability goes as the square of particle diameter.** Finer grind, dramatically lower permeability, dramatically lower flow at fixed pressure.

Two things follow, and they are what make the modelling tractable:

1. **The relationship is monotonic.** Finer is always slower. There is no local optimum in flow-vs-grind to get trapped in, which means a simple local model can extrapolate direction with confidence even when it's unsure about magnitude.
2. **Grinder dials are roughly logarithmic in particle size** — steps are usually designed to produce roughly constant *ratio* changes in burr gap, not constant absolute changes. Combined with the `d²` term, this means `log(Q)` is approximately **linear** in dial setting over a working range. That is the modelling assumption everything in Tier 2 rests on, and it is a far better one than assuming `Q` itself is linear.

Important caveat stated up front: **dial numbers are not comparable across grinders**, or even across the same grinder after burr seasoning or a realignment. Every model here is per-grinder and treats the dial as an arbitrary monotonic index. There is no universal "grind 3.4."

---

## Tier 1 — Flow curve diagnosis

Rules over the measured curve. No training data, no fitting, no model. It works on the first shot and its claims are directly observable.

The key insight: **the *shape* of the flow curve diagnoses failures that the summary numbers hide.** Two shots can both be "18 g in, 36 g out, 30 seconds" with one excellent and one badly channelled. The summary cannot tell them apart. The curve can.

| Signature | Diagnosis | Action |
|---|---|---|
| `flow_slope_late > +0.05 g/s²` — flow *rising* late | **Channelling.** The bed eroded, a preferential path opened, resistance fell. | Distribution first (WDT, RDT, tamp level). Do **not** adjust grind. |
| `t_first_drip < 5 s` and `peak_flow > 3 g/s` | Too coarse. | Finer, 2–4 steps. |
| `t_first_drip > 15 s`, flow declining throughout | Choked. Puck too fine or too dense. | Coarser, 3–5 steps. |
| Fast start, then stall | Puck migration or a fines-blocked screen. | Puck screen; check basket condition. |
| Curve smooth, time on target, taste sour | Under-extracted at correct flow. | Finer *and* longer, or raise temperature. |
| High variance in `steady_flow` across identical shots | Prep inconsistency, not grind. | Fix prep before trusting any model. |

**The channelling rule is the highest-value one here**, because channelling is the most common cause of a bad shot and the one most often misdiagnosed as a grind problem. Someone chasing a grind adjustment to fix a distribution problem will make it worse, then make it worse again. Catching it costs one derivative of data you already have.

That last row is a **gate on the rest of the system**, not just advice: if shot-to-shot variance at a fixed setting exceeds the effect size of a grind step, no model can extract signal, and the advisor should say so rather than fitting noise.

---

## Tier 2 — The resistance model

### Target

Predict the grind setting that produces a desired flow.

Use `steady_flow_gs` — mean flow over 40–90 % of the shot — rather than total time, because total time conflates puck resistance with when the user chose to stop. Flow rate over the steady portion is a much closer measurement of the actual physical property.

### Model

Per `(grinder_id, bag_id, basket)` group:

```
log(Q) = a + b · g + c · d_roast + ε
```

`Q` steady flow, `g` grind setting, `d_roast` days off roast, `ε ~ N(0, σ²)`.

To hit target `Q*`:

```
Δg = ( log(Q*) − log(Q_last) ) / b
```

`b` is the **grinder's sensitivity** — how much flow changes per dial step. It is a property of the grinder's mechanics far more than of the coffee.

### The sparse-data problem, and the right fix

The obvious objection: on a new bag there are two shots. You cannot fit a slope from two points, and least-squares on two points will happily give you a confident, absurd one.

But note **`b` is mostly a grinder property.** A DF64's dial does roughly the same thing to flow regardless of what's in it. Different beans mainly shift the *intercept* `a` — a denser, fresher, lighter roast is slower at every setting — while the *slope* is comparatively stable.

That structure is exactly what a **hierarchical (partially pooled) model** encodes:

```
b_bag ~ Normal(b_grinder, τ²)      // per-bag slope, shrunk toward the grinder's
a_bag ~ Normal(a_grinder, ν²)
b_grinder ~ Normal(μ_b, ω²)        // learned across every bag ever run
```

The consequences are precisely what you want:

- **Shot 1 on a new bag:** no bag-specific data. `b_bag` collapses to `b_grinder` — the pooled slope from every bag you've run. Already useful, because the grinder hasn't changed.
- **Shots 2–8:** the estimate slides continuously from the grinder-wide prior toward this bag's own behaviour, weighted by how much this bag's data actually disagrees.
- **Shot 20+:** effectively bag-specific.

There is no threshold and no special case for "not enough data" — shrinkage handles it as a smooth function of evidence. This is the statistically correct answer to sparse groups, and it is the single most important modelling decision in this document.

Fit with a small MCMC or variational routine on the host (PyMC / Stan / NumPyro). This does **not** run on the ESP32 — the scale records, the host infers, and the resulting recommendation is a couple of numbers pushed back for display.

### Reporting

Every recommendation carries an interval:

> **Go 2 steps finer** (95 % CI: 1.2 – 3.1 steps)
> Predicted flow 1.9 g/s, currently 2.4 g/s. Based on 7 shots on this bag.

And it must be willing to say nothing:

- **If the CI spans less than one grinder step:** *"You're within one click. Don't change it."*
- **If the CI is wider than ±5 steps:** *"Not enough data — pull two more at this setting."*
- **If Tier 1 flagged channelling:** suppress the grind recommendation entirely and surface the distribution warning instead. **A model fitted to channelled shots learns the wrong thing**, and letting it speak over a Tier 1 diagnosis is actively harmful.

An advisor that knows when to be quiet is the difference between a tool and a toy.

---

## Tier 3 — Taste optimization

Tiers 1 and 2 hit a *flow target*. But the flow target is a proxy — the actual objective is that the coffee tastes good, and nobody knows a priori what flow rate that corresponds to for a given bean.

So learn it. This is a **Bayesian optimization** problem, and it fits unusually well:

- The objective (taste rating) is **expensive to evaluate** — one shot, ~15 g of coffee, several minutes.
- It is **noisy** — the same setting rated twice will differ, and mood and palate drift.
- The space is **low-dimensional** — grind, ratio, temperature, maybe dose. Three or four dimensions.
- There is **no gradient**.

That is the textbook setting for BO.

### Formulation

Gaussian process over `(grind, ratio, temp, days_off_roast)` with rating as output. Matérn 5/2 kernel — Gaussian kernels assume a smoothness that taste responses don't have. Ordinal likelihood, since a 1–10 rating is ordered categories, not a real number; treating it as Gaussian overstates the information in the difference between a 7 and an 8.

Acquisition: **Expected Improvement**, with a penalty on distance from the current setting. Without that penalty the optimizer will happily propose jumping 8 steps to explore, which wastes coffee and, on a real grinder, requires purging.

Priors carry over from Tier 2: the GP's length scale along the grind axis is informed by the grinder sensitivity `b` already learned. The tiers compose rather than competing.

### Honesty about this tier

- **~20 rated shots per bean before it beats a competent human's intuition.** Possibly more. That may be a whole bag.
- **Rating quality is the binding constraint, not the algorithm.** Ratings drift with mood, time of day, what you ate, and knowing what setting you used. Blind or semi-blind rating would fix it and nobody will do that. Expect a noise floor.
- **It will propose settings you disagree with.** That is the point — exploration is how it learns — but it needs to be presented as a suggestion with a stated reason, not a verdict.
- The realistic honest framing: **this is a structured way to explore the parameter space, not an oracle.** Its main value may be that it stops you re-pulling the same setting eleven times and calling it experimentation.

---

## Covariates that matter, ranked

From the shot record ([04](04-data-model.md)), in rough order of predictive value per unit of effort to capture:

1. **`grind_setting`** — the thing being optimized. Manual entry. Everything depends on it.
2. **`days_off_roast`** — large, monotonic, free. Beans get faster as CO₂ escapes over 2–3 weeks. Costs one date entry per bag.
3. **`dose_in_g`** — free via dose auto-linking ([04](04-data-model.md)). Changes puck depth `L` directly, which is in Darcy's law.
4. **`humidity_pct`** — free from the BME280. Real, second-order, and *only* separable from noise because it's free to record.
5. **`water_temp_c`** — affects viscosity `μ` and extraction kinetics. Manual unless the machine reports it.
6. **`basket`** — changes `A` and `L`. Categorical; group by it rather than modelling it.
7. **Burr seasoning / age** — real and slow. Shows up as drift in `b_grinder` over months, which the hierarchical model will track if the fit is periodically refreshed.

**The whole model rests on #1 being entered reliably.** Which is why the encoder interaction in [01](01-hardware.md) and the `SET_GRIND` command in [03](03-wireless.md) are treated as load-bearing rather than as UI polish: if entering the grind setting takes more than about two seconds, it will get skipped on busy mornings, the data will be missing exactly when behaviour was unusual, and the missingness will be non-random — the worst kind. **A two-second interaction is a modelling decision.**

---

## Implementation split

| Where | What |
|---|---|
| **Scale firmware** | Tier 1 rules. Cheap, immediate, no dependencies. Displayed right after the shot. |
| **Host (Python)** | Tiers 2 and 3. Runs against exported shots. Shares ground with, and eventually merges into, [espresso-extraction-py](https://github.com/mattlmccoy/espresso-extraction-py). |
| **Back to the display** | Recommendation cached as `(target_grind, ci_low, ci_high, n_shots)` and pushed over ESP-NOW or picked up at next sync. |

Tier 1 on the device means the diagnosis appears **while you're still standing at the machine**, which is when it can change what you do next. Tiers 2 and 3 are things you look at with a coffee, on a laptop, deciding what to do tomorrow. That split is deliberate and matches when each kind of information is actually actionable.

---

## Evaluation

Claims about a predictive model deserve a test, so:

- **Hold-out validation.** Fit Tier 2 on the first `n` shots of a bag, predict shot `n+1`'s flow, record the error. Plot error vs. `n`. This directly answers "how many shots before it's useful?" with a number rather than a guess.
- **Baseline comparison.** The baseline is "change nothing" and "the user's own guess, recorded before seeing the recommendation." A model that doesn't beat both is not earning its complexity. **Log the user's guess before revealing the recommendation** — otherwise the comparison is contaminated and the model will look better than it is.
- **Calibration check.** Do the 95 % intervals actually contain the truth 95 % of the time? An overconfident advisor is worse than no advisor, because it gets trusted.
