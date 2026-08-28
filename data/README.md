# Data

## `shots.csv` — the canonical format

One row per shot, one file for all shots. This is the format the web tools import
and export, and the format the [scale](../design/04-data-model.md) writes to its
own flash, so hardware and software share one schema.

| Column | Unit | Meaning |
|---|---|---|
| `shot_id` | — | Unique identifier. `legacy-NNN` for migrated rows, `shot-NNN` for new ones. |
| `timestamp` | — | Local time the shot was pulled. |
| `dose_g` | g | Dry coffee in. **Measured.** |
| `yield_g` | g | Beverage out. **Measured.** |
| `ratio` | — | `yield_g / dose_g`. Derived. |
| `grind_setting` | — | Grinder dial position. Arbitrary and comparable only within one grinder. |
| `grind_label` | — | `fine` / `medium` / `coarse`, from the legacy data. |
| `temp_c` | °C | Water temperature. |
| `pressure_bar` | bar | Brew pressure. |
| `time_s` | s | Shot duration. **Measured.** |
| `brix` | °Bx | Refractometer reading. **Measured.** |
| `tds_pct` | % | `brix × factor`. Derived. |
| `ey_pct` | % | `tds_pct × yield_g / dose_g`. Derived. |
| `flow_gs` | g/s | `yield_g / time_s`. Derived, whole-shot average. |
| `defaulted` | — | Semicolon-separated list of fields that were **assumed**, not measured. |
| `notes` | — | Free text. |

Derived columns are stored for convenience but are always recomputed on import,
so a hand-edited `ey_pct` will be overwritten rather than believed.

### `defaulted`

The legacy format carried `"<field> Used"` booleans marking whether a default had
been substituted for a real measurement. That is worth keeping — when a point
turns up as an outlier later, "this value was assumed" is exactly what you want
to know — so those flags collapse into this one column rather than being dropped.

## `legacy/` — the original format

Fifteen files, one shot each, with the column headers repeated in every one. Kept
so the migration stays reproducible and testable; the importer in
[`site/assets/js/core/csv.js`](../site/assets/js/core/csv.js) reads them directly.

Two conversions happen on the way in:

- **TDS scale.** The legacy files stored TDS as a fraction (`0.11475`) while
  labelling it TDS. It is stored as a percentage (`11.475`) here.
- **Grind size.** Labels mapped to a nominal particle size via
  `{fine: 200, medium: 400, coarse: 600}` microns. That mapping is preserved for
  continuity, but treat it with suspicion: it is three points standing in for a
  continuous distribution, and the numbers were a convention rather than a
  measurement. See [`design/05-grind-advisor.md`](../design/05-grind-advisor.md)
  for what to use instead.

## `figures/`

Plots produced by the original Python version, kept as a record of what the
project looked like before the rework.
