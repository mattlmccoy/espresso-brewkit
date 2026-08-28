# Scale design

Specification for an open-source espresso scale that logs shots to onboard flash
with no phone attached, and drives a detachable wireless display.

The tools in this repository analyse shot data. This is the instrument intended
to produce it — currently a design, not a build. Nothing here is fabricated yet;
[06](06-roadmap.md) is the plan for getting there and is deliberately sequenced so
that data starts flowing from a breadboard long before any enclosure exists.

| | |
|---|---|
| [00 — Requirements](00-requirements.md) | Goals, non-goals, hard constraints, target specs |
| [01 — Hardware](01-hardware.md) | Load cell, ADC, MCU, display selection with tradeoffs; BOM; mechanical |
| [02 — Firmware](02-firmware.md) | Task architecture, filtering, calibration, brew state machine |
| [03 — Wireless](03-wireless.md) | ESP-NOW display link, BLE, USB, latency budget, coexistence |
| [04 — Data model](04-data-model.md) | Shot schema, on-device storage, sync, interop |
| [05 — Grind advisor](05-grind-advisor.md) | Flow-curve diagnosis, resistance model, taste optimization |
| [06 — Roadmap & risks](06-roadmap.md) | Build phases, what to measure first, what will bite you |

The data model in [04](04-data-model.md) is a superset of
[`data/shots.csv`](../data/shots.csv): the same fields, plus the flow curve and
per-shot metadata that only an instrumented scale can capture.
