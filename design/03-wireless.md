# 03 — Wireless & connectivity

Four links, each with one job.

| Link | Between | Purpose | Latency |
|---|---|---|---|
| **ESP-NOW** | scale ↔ display | live state + commands | ~2 ms |
| **BLE GATT** | scale → phone | live view, third-party app interop | ~30 ms |
| **Wi-Fi** | scale → LAN | bulk shot sync | seconds |
| **USB-C** | scale → computer | mass storage, firmware update | — |

**None of them is required for the scale to work.** This is the design commitment from [00](00-requirements.md) restated in radio terms: every link is a view or a sync, never a dependency.

---

## ESP-NOW: the display link

### Why not BLE

BLE is the obvious choice and it's the wrong one.

BLE's timing is governed by the connection interval, floor 7.5 ms. In practice a peripheral gets 15–30 ms with jitter that the *central* controls, plus notification batching, plus stack latency. For a display showing a 40 Hz weight readout, that means visible lag and — worse — irregular lag. The eye is very good at noticing a number that updates unevenly.

ESP-NOW is connectionless: an 802.11 action frame addressed to a peer MAC. No connection, no interval negotiation, no GATT table. Send-to-received is 1–3 ms. It also means **no pairing state to lose** — the display doesn't "disconnect," it just stops hearing frames, and starts hearing them again when they resume. For a device that gets unplugged and moved, this is a much better failure model than a BLE link that needs to renegotiate.

### Protocol

Fixed-size structs, little-endian, versioned. No serialization library.

**Scale → display, 40 Hz:**
```c
typedef struct __attribute__((packed)) {
    uint8_t  version;        // protocol version
    uint8_t  mode;           // ESPRESSO | POUROVER | DOSE | PLAIN
    uint8_t  brew_state;     // see 02
    uint8_t  flags;          // stable, battery_low, logging, link_quality
    int32_t  weight_cg;      // centigrams, signed
    int16_t  flow_cgs;       // centigrams/second
    uint16_t elapsed_ms;
    uint16_t target_cg;
    uint8_t  battery_pct;
    uint8_t  seq;            // wraparound sequence, for loss detection
} scale_state_t;             // 20 bytes
```

**Display → scale, on user action:**
```c
typedef struct __attribute__((packed)) {
    uint8_t  version;
    uint8_t  cmd;            // TARE | START | STOP | MODE | SET_TARGET | SET_GRIND | RATE_SHOT
    int32_t  arg;
    uint8_t  seq;
} display_cmd_t;             // 7 bytes
```

Commands are **acknowledged in the next state frame** by echoing the command sequence number, rather than with a dedicated ack packet. At 40 Hz the acknowledgement arrives within 25 ms, which is faster than a human can perceive, and it avoids a second message type and a retry state machine.

`SET_GRIND` is how the grind setting reaches the shot record — the encoder on the display unit, two seconds of work. See [05](05-grind-advisor.md) for why this interaction's *speed* is load-bearing for the whole analysis story.

### Pairing

Press-and-hold on both units for 3 s. They exchange MACs on the broadcast address, store the peer in NVS, and never broadcast again. No app, no QR code, no cloud.

### Channel: the gotcha

**ESP-NOW peers must be on the same Wi-Fi channel.** If the scale also joins a home Wi-Fi network, the STA connection dictates its channel, and the display — which has no Wi-Fi connection and therefore no reason to know — will silently stop receiving. This is the single most common way ESP-NOW deployments break, and it fails *silently*.

Resolution:
- The scale advertises its current channel in the pairing exchange and re-advertises on change.
- The display scans channels on link loss, rather than assuming.
- **Simplest and preferred: the scale does not join Wi-Fi during a session.** Wi-Fi sync happens between sessions, on a fixed schedule or on demand, when nobody is watching the display. This sidesteps the problem entirely rather than managing it, and Wi-Fi sync has no reason to be concurrent with brewing.

### Link loss behaviour

After 500 ms without a frame, the display greys the reading and shows "link lost." It does **not** blank, and it does **not** show a stale value as if it were live.

**The scale does not care.** It keeps measuring, keeps running the state machine, and keeps logging. When frames resume, the display simply catches up. There is no resynchronization, because there is no shared state to resynchronize — the frames are absolute, not incremental.

### Latency budget

| Stage | ms |
|---|---|
| ADC conversion + I²C read | 3 |
| Decimation group delay (320→40 Hz FIR) | ~25 |
| Kalman estimation delay (effective) | ~15 |
| ESP-NOW transmit | 2 |
| Display render + panel response | ~18 |
| **Total, glass-to-glass** | **~63 ms** |

Against the ≤ 100 ms target in [00](00-requirements.md), with ~35 ms of margin.

Note what dominates: **the decimation filter, not the radio.** This is worth internalizing — the instinct is to optimize the wireless link, but the link is 3 % of the budget. If latency ever needs to come down, the FIR design is where to look, and it trades directly against the anti-alias performance discussed in [02](02-firmware.md). That is the real tradeoff; the radio is not.

---

## BLE: the phone view

A standard GATT peripheral. One service, notify characteristics for weight/flow/state, write characteristics for tare and mode. Nothing exotic.

### Third-party app interoperability

**Worth doing, and cheap.** Apps like Beanconqueror already speak several scale protocols. Emulating one means the scale drops into an existing, mature logging ecosystem on day one.

The Felicita Arc protocol is the pragmatic target: a periodic notification of a simple fixed-layout frame, no handshake, no heartbeat. Acaia's is more capable but requires an ongoing heartbeat and a more involved handshake, and is a poorer effort-to-value trade.

This is a **compatibility shim, not the data path.** It sits alongside the native service. The authoritative record is always the one on flash — see [04](04-data-model.md).

### Coexistence

The ESP32-S3 has **one radio** shared between Wi-Fi (and therefore ESP-NOW) and BLE, time-multiplexed by the controller. Running both concurrently costs airtime and adds jitter to whichever is lower priority.

Policy:
- **ESP-NOW has priority.** It drives a display someone is watching in real time.
- BLE notifications run at 20 Hz, half the ESP-NOW rate, and are explicitly droppable.
- If BLE ever measurably degrades the display link, BLE loses. It is the redundant path; the shot is being logged regardless.

---

## USB-C: the "it just works" path

Native USB on the ESP32-S3, enumerating as **two** devices:

**Mass storage (MSC).** Plug it into any computer and the shot files appear as a drive. No app, no driver, no pairing, no account. This is the direct answer to the complaint that started the project — *the data is right there, in files, on a thing you plugged in*.

Implementation note: MSC exposes a block device, so the host mounts a **FAT partition** while the firmware's working store is LittleFS. Two options: keep a small FAT partition that the firmware populates with exported files at attach time, or generate the FAT image on the fly. **The former is simpler and preferred** — export on attach, mount read-only to the host, and sidestep the entire class of bugs where host and firmware both write the same filesystem. Read-only to the host also means a user cannot corrupt the store by dragging things into it.

**CDC serial.** Console, diagnostics, calibration routines, and the raw-trace capture used for the test corpus in [02](02-firmware.md).

**DFU.** Firmware update over the same cable. No programmer, no button combination.

---

## Wi-Fi: bulk sync

Optional and off by default. When enabled, the scale joins the home network between sessions and pushes new shots to a configured HTTP endpoint — a local server, or a small script that commits them into an analysis repo.

- **Between sessions only**, for the channel reason above.
- **Push, not poll**, so there is no server requirement and no open port on the scale.
- **Credentials via the USB CDC console or a temporary SoftAP**, never hardcoded. Stored in NVS.
- Local endpoint by default. **No vendor cloud, no account, no telemetry** — the absence of these is a feature and is one of the reasons this project exists.
