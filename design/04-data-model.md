# 04 — Data model

The shot record is the actual product. The hardware exists to produce it, and the advisor in [05](05-grind-advisor.md) is only as good as the covariates captured here.

## Design rules

1. **Capture what you cannot reconstruct.** Flow curves, timings, environment. Derived quantities (ratio, average flow) are computed on read — storing them invites them to disagree with the raw data.
2. **Every record is versioned and self-describing.** A schema will change. Records written in year one must still parse in year three.
3. **Record conventions, not just values.** A shot time means nothing without knowing when the timer started ([02](02-firmware.md)). Store the convention alongside the number.
4. **Absent is not zero.** A grind setting that wasn't entered is `null`, and the advisor must be able to tell the difference. Encoding "unknown" as 0 poisons the model silently.
5. **The device record is append-only and immutable.** Ratings and notes attach as a separate mutable layer. Never rewrite a measurement.

---

## Shot record

```jsonc
{
  "schema": 1,
  "shot_id": "01J8X4K2N9QZ7M3P",     // ULID: sortable, no clock sync needed
  "device_id": "scale-a3f1",
  "started_at": "2026-08-25T07:14:22Z",
  "clock_source": "ntp",              // ntp | rtc | uptime_only — trust accordingly

  "mode": "espresso",
  "timer_convention": "first_flow",   // first_flow | manual | pump_signal

  "coffee": {
    "roaster": "Sey",
    "name": "Kiamugumo",
    "roast_date": "2026-08-11",
    "days_off_roast": 14,             // derived at write time; the covariate that matters
    "process": "washed",
    "bag_id": "bag-0031"              // groups shots for the per-bean model
  },

  "prep": {
    "dose_in_g": 18.02,               // auto-linked from DOSE mode, see below
    "grind_setting": 3.4,             // null if not entered — never 0
    "grinder_id": "df64-1",
    "basket": "18g VST",
    "wdt": true,
    "rdt": true,
    "puck_screen": true
  },

  "machine": {
    "machine_id": "linea-mini",
    "water_temp_c": 93.5,
    "preinfusion_s": 6.0,
    "profile": "flat-9bar"
  },

  "env": {                            // from the BME280, see 01
    "temp_c": 24.1,
    "humidity_pct": 58.3,
    "pressure_hpa": 1013.2
  },

  "result": {
    "t_first_drip_s": 8.4,            // strongest no-extra-sensor proxy for puck resistance
    "total_time_s": 31.2,
    "yield_out_g": 36.4,
    "ratio": 2.02,                    // derived, stored for convenience only
    "peak_flow_gs": 2.31,
    "steady_flow_gs": 1.84,           // mean over 40%–90% of the shot
    "flow_slope_late": -0.04          // dq/dt over the last third — the channeling tell
  },

  "curve": {
    "rate_hz": 40,
    "encoding": "delta-varint",
    "weight_cg": "<binary blob>"      // see below
  },

  "refractometer": {                  // optional, links to espresso-extraction-py
    "tds_pct": 9.1,
    "extraction_yield_pct": 20.4,
    "instrument": "DiFluid R2"
  },

  "notes": {                          // mutable layer, added after the fact
    "rating": 8,
    "tags": ["balanced", "juicy"],
    "text": "best of this bag so far"
  }
}
```

### Notes on specific fields

**`shot_id` is a ULID**, not a sequence number and not a UUID. Lexicographically sortable by creation time, generated without coordination, and — importantly for a device that may boot without a synced clock — it does not depend on wall time being correct to preserve ordering.

**`clock_source` is honest about time.** A scale that has never seen NTP and has no RTC knows durations perfectly and absolute time not at all. Recording *which* means downstream analysis can decide whether `days_off_roast` is trustworthy for that record instead of assuming.

**`days_off_roast` is derived and stored.** Normally a derived field would violate rule 1, but this one is derived from `roast_date` *and the shot's own date*, and it is such a strong predictor (CO₂ degassing makes beans measurably "faster" over 2–3 weeks) that having it materialized is worth the redundancy.

**`t_first_drip_s` and `flow_slope_late` are the two highest-value diagnostics** in the record and both come free from the curve. See [05](05-grind-advisor.md).

**`bag_id` groups shots for the per-bean model.** Different bags of nominally the same coffee are different coffees. Grouping by roaster+name would pool data that shouldn't be pooled.

---

## Curve encoding

Raw: 40 Hz × 35 s ≈ 1400 samples. At 4 bytes each that's 5.6 kB — fine, but wasteful for something so compressible.

Weight during a shot is **monotonically increasing and smooth**, so successive deltas are small and slowly varying. Delta encoding plus varint puts most samples in a single byte:

```
[uint16 initial_cg][varint delta][varint delta]...
```

Typical shot: **~1.5 kB.** No timestamps are stored — the sample rate is fixed and in the header, so time is implicit in the index. (The `adc_task` timestamps in [02](02-firmware.md) exist to *detect* rate irregularity, not to be stored per-sample; a shot with dropped samples is flagged in `flags` rather than storing 1400 timestamps to describe a problem that should not happen.)

At 1.5 kB + ~1 kB of metadata, a 4 MB partition holds **well over 2000 shots**, satisfying [00](00-requirements.md) with room to spare. There is no need for an SD card, and adding one to a wet environment would be a liability for no gain.

---

## On-device encoding

**CBOR** for the metadata, with the curve as a byte string. Compact like a packed struct, self-describing like JSON, and a one-line conversion to JSON on export. Choosing a bespoke binary format here would save a few hundred bytes and cost the ability to read a three-year-old record with a five-line script — a bad trade.

Layout:
```
/shots/01J8X4K2N9QZ7M3P.cbor
/shots/01J8X4M7P2RA8N4Q.cbor
/index.cbor                      // id, timestamp, bag_id, summary — for fast listing
/notes/01J8X4K2N9QZ7M3P.cbor     // mutable layer, separate file
/config.cbor
/calibration.cbor                // offset, scale, tempco α, timestamps
```

Notes live in **separate files** so that adding a rating never rewrites a measurement (rule 5). The index exists so the display can list recent shots without deserializing everything.

---

## Dose auto-linking

The single most valuable piece of data plumbing in the project, and it needs **zero hardware on the grinder**.

Single-dosing means the beans are weighed in a cup before grinding — on this scale. So:

1. `DOSE` mode: weigh beans, reading stabilizes, press.
2. Firmware stores it as `pending_dose` with a timestamp.
3. Next espresso shot within a configurable window (default 15 min) consumes it as `dose_in_g`.
4. If the window expires unused, it is discarded rather than attached to a later shot.

The result is that `dose_in_g` — a required input for extraction ratio and for the advisor — is captured **as a side effect of something the user already does.** No extra step, no extra device, no data entry.

The same trick extends to **retention measurement**: weigh beans in, weigh grounds out, and the difference is what the grinder kept. Two extra button presses gives a per-grinder retention figure that most people never measure.

---

## Export

**On USB attach** ([03](03-wireless.md)), the firmware writes a read-only FAT partition containing:

```
/README.txt                  // what these files are, how to read them
/shots.csv                   // one row per shot, summary fields — opens in anything
/shots.json                  // full records including notes
/curves/<shot_id>.csv        // t_s, weight_g, flow_gs — one file per shot
```

Three formats because there are three audiences: `shots.csv` for a spreadsheet, `shots.json` for a script, `curves/` for plotting. Generating all three costs milliseconds and removes every "how do I get at this" question.

---

## Integration with espresso-extraction-py

[espresso-extraction-py](https://github.com/mattlmccoy/espresso-extraction-py) already models extraction yield against temperature and grind size from manually entered data. This project makes that input automatic and adds the time dimension it currently can't see.

The contract:

- The scale exports `shots.csv` with column names matching that project's expected schema where they overlap (`dose_in`, `yield_out`, `grind_setting`, `water_temp_c`, `tds_pct`, `extraction_yield_pct`).
- Fields it doesn't know about (`t_first_drip_s`, `steady_flow_gs`, `flow_slope_late`, humidity) are extra columns, which its pandas ingestion ignores harmlessly.
- TDS is entered by hand — a refractometer reading has no path onto the scale. Entry is via the display encoder post-shot, or by editing the exported JSON.

The interesting consequence: that project currently regresses yield against **grind size**, a quantity nobody can measure directly — everyone substitutes a grinder dial position that is not comparable across grinders or even across burr seasoning. This project supplies `steady_flow_gs` and `t_first_drip_s`, which are **physical measurements of the thing grind size is a proxy for.** Regressing extraction yield against measured flow resistance instead of a dial number should be a materially better model, and it's testable the moment there's data.
