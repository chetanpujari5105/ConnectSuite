# Getting audio and video onto the Mac — the three routes, measured

**Written 2026-09-14.** This exists so the Bluetooth role tables never have to be re-derived. The
one-paragraph version of the call-audio finding is the platform wall in `CLAUDE.md`; this is the
working behind it, plus the two adjacent features that were assumed to share its blocker and do
not.

Every reading here came off one Mac (MacBook Pro, macOS 26.6.1, BCM_4388 controller) and one phone
(SM-S938B, the handset in `docs/single-device-audit.md`). Treat vendor-specific claims accordingly.

---

## 1. Call audio over Bluetooth: it pairs, and the profile intersection is empty

The question was always asked as a pairing question. It is not one. **The bond is real and
persistent** — the phone holds the Mac at `bond_type:BOND_TYPE_PERSISTENT`,
`bredr_linkkey_type:AUTH_COMB_P_256`, and `system_profiler SPBluetoothDataType` lists the phone with
vendor id, firmware and RSSI. The two devices pair and then have nothing to offer each other.

**A pairing that fails and a pairing that succeeds into an empty profile intersection want
completely different answers.** Only the second happens here.

### The role tables

Read from the phone, which is the end that can tell the difference
(`adb shell dumpsys bluetooth_manager`, bonded-device table, `[BR/EDR UUIDs]` column):

| | advertises | role |
|---|---|---|
| **the Mac** | `SPP AudioSource Avrcp `**`Handsfree_AG`** | A2DP **source**, HFP **audio gateway** |
| **the phone** | `A2dpService`, `HeadsetService` — and no `HeadsetClientService`, no `A2dpSinkService` | A2DP **source**, HFP **audio gateway** |
| **every headset bonded here** (5 of them) | `HSP AudioSink Avrcp `**`Handsfree`** | A2DP **sink**, HFP **hands-free** |

`Handsfree` is `0x111E` (the HF, headset side). `Handsfree_AG` is `0x111F` (the AG, phone side).
**Both ends here are the gateway. Both want to be the phone.**

HFP connects AG↔HF. There is no HF on either side, so nothing negotiates:

- the phone never built an HFP state machine for the Mac — `HFSM size: 1`, and the one is a pair
  of earbuds;
- every profile connection policy for the Mac reads `-1`;
- `A2DP: Connected: 0`, `HFP: Connected: 0`.

**A2DP is not a second chance.** It is one-way and carries no microphone, so it is not a call route
even where it does connect. The profile that matters for a call is HFP, and its SCO link is the only
thing in Bluetooth that carries a voice path in both directions.

### The control that makes this a reading rather than a guess

The same query, over the same bonded table, returns `AudioSink`+`Handsfree` for five other devices.
**The attribute separating a headset from the Mac is the `_AG` suffix, and it is present in the
output rather than inferred.** Without that column the Mac's record and a headset's record are the
same shape, which is exactly the lookalike this repo keeps writing rules about.

---

## 2. What macOS actually ships — and the sentence not to write

**"macOS can drive a headset but cannot be one" is true of the shipped system and false of the
platform.** Write the first half, never the second.

True of the system, and it is the entire reason the pairing does nothing: macOS publishes no HF
service record and has no UI that would.

False of the platform: `IOBluetoothHandsFreeDevice` is present in the **running** runtime on
26.6.1, public since 10.7, and carries **no deprecation attribute** in the 26.5 SDK. It is not a
stub. The public header declares a complete HFP hands-free client:

| public API | what it is |
|---|---|
| `initWithDevice:delegate:`, `connect`, `disconnect` | **connects outbound** to a remote device's HFP AG |
| `connectSCO`, `disconnectSCO`, `isSCOConnected` | the voice link |
| `transferAudioToComputer`, `transferAudioToPhone` | *"Transfer audio source to the computer."* |
| `acceptCall`, `endCall`, `dialNumber:`, `sendDTMF:`, `holdCall`, `currentCallList` | call control |
| `handsFree:incomingCallFrom:`, `…isCallActive:`, `…scoConnectionOpened:` | delegate callbacks |
| `inputVolume`, `outputVolume`, `inputMuted`, `outputMuted` | on the `IOBluetoothHandsFree` base |

**The audio routing is internal, and that is the load-bearing fact for cost.** `inputDeviceID`,
`outputDeviceID`, `configureVPAU`, `SCOInputBuffer`/`SCOOutputBuffer` and
`receiveVoiceProcessedData:…` exist in the runtime but are **not in the header** — found by
introspecting the class, not by reading the API. So the framework owns the SCO↔CoreAudio bridge
(through a Voice-Processing I/O unit, which is the echo-cancelling one) and there is **no driver to
write and nothing to install**.

The cost of that convenience: no public control over *which* CoreAudio device it uses. That is the
part §5 stage 2 has to observe rather than assume.

### The local SDP publisher exists, and may not be needed

`IOBluetoothSDPServiceRecord.publishedServiceRecordWithDictionary:` — *"Adds a service to the local
SDP server."* Public, not deprecated, takes a plist-shaped attribute dictionary (so an HF record can
be a resource file rather than code), reassigns the RFCOMM channel if the requested one is busy, and
is **transient by default**: it is removed when the publishing process exits, unless
`LocalAttributes.Persistent` is set. Nothing to uninstall after a failed experiment.

**But the HF role connects outbound.** `connect` opens RFCOMM *to the phone's* `Handsfree_AG`,
which the phone already advertises. For a Mac-initiated session the Mac is the client, so publishing
a record is the **fallback for the phone-initiated direction, not a precondition**.

---

## 3. The three routes do not share a blocker

This was assumed once and is wrong. Camera, mic and call audio all end at "a system-level audio or
video device on macOS", and that resemblance is where the similarity stops.

| | Mac-side mechanism | Entitlement | Needs the $99 account |
|---|---|---|---|
| **Camera** — phone as webcam | **CMIO Camera Extension** — a *system* extension | `com.apple.developer.system-extension.install` + Developer ID | **Yes** |
| **Mic** — phone as Mac microphone | **AudioServerPlugIn** — a HAL plug-in in `/Library/Audio/Plug-Ins/HAL/` | **none** | **No** to build; Developer ID to ship |
| **Call audio** — the HF route | **no driver at all**; the framework owns SCO→CoreAudio | **none** | **No** |

**The evidence for the middle row is on this disk.** `/Library/Audio/Plug-Ins/HAL/` holds
`SRAudioDriver2ch.driver` and `ParrotAudioPlugin.driver` — third-party virtual audio devices, on a
machine where `systemextensionsctl list` reports **0 extensions**. `SRAudioDriver2ch` carries
**zero entitlements** (controlled: the same `codesign -d --entitlements -` returns a real dict for
`/usr/sbin/bluetoothd`, so the empty result is a reading and not a failed query). And `coreaudiod`
holds `com.apple.private.security.clear-library-validation`, so it loads plug-ins Apple did not
sign — **ad-hoc signing is enough locally**. The driver on disk *is* Developer ID signed, which is
what shipping needs, not what building needs.

So **only the camera queues behind the purchase**, and solving it would unlock neither of the other
two, because neither was ever locked. The mic has been buildable the whole time.

### What the mic actually is here

`Capability.MIC = "mic"` exists in `core/.../protocol/Messages.kt` and in
`desktop/src/shared/protocol.ts`, and its contract requires `RECORD_AUDIO` **on the phone** — so the
feature is *the phone's microphone, used by the Mac*, and it needs a virtual audio **input** device
on the Mac. `CapabilityContract.kt` says the rest out loud:

> `docs/protocol.md` defines no `mic.*` messages at all. The capability name exists on both sides
> but there is no wire protocol to carry it, so it can never be honestly advertised until one is
> designed.

A capability name with nothing behind it, on both sides, with no entitlement in its way.

(Note for whoever reads `docs/remaining.md:72` — it says *"`Capabilities.kt` has `mic`"*. The
constant is in `Messages.kt`; `Capabilities.kt` holds the detection machinery. Substance right,
file wrong.)

---

## 4. The staged proof for the HF route

Cheapest-first, so it dies early if it is going to die. **Stage 1 is the decision point** and is
reachable inside an hour. No project, no bundle, no signing: a Swift CLI against the CLT SDK.

| Stage | Action | The reading | Dead if |
|---|---|---|---|
| **0** | `IOBluetoothHandsFreeDevice(device:delegate:)` then `connect()` | delegate `handsFree:connected:` fires | the class is a 10.7-era zombie |
| **1** | — | **phone: `dumpsys bluetooth_manager` → a `StateMachine for …08:55`, `HFSM size: 2`** | the phone will not build one |
| **1b** | only if 1 fails: publish an HF record, let the phone initiate | same | the phone ignores a non-advertising HF |
| **2** | a real call → `connectSCO`, `transferAudioToComputer` | audio both directions, and *which* CoreAudio device it lands on | SCO opens and routes nowhere |

**Name the lookalikes before reading a stage-1 failure.** A missing state machine is also what you
get from TCC denying Bluetooth to the tool, and from RFCOMM never opening at all. Stage 0's callback
is the control that makes stage 1's absence mean anything — without it, an absence at stage 1 is
three different findings wearing one face.

**Baseline, already measured:** `HFSM size: 1`, and the one is a pair of earbuds. Anything that
moves that number is the signal.

**The one thing that can stretch this past an afternoon is TCC**, not the Bluetooth work: a bare CLI
has no `NSBluetoothAlwaysUsageDescription`, and the prompt is attributed to the *responsible*
process — the terminal — rather than to the tool. Mitigation is a minimal `.app` wrapper carrying
the usage string, or granting the terminal Bluetooth access once in System Settings → Privacy &
Security → Bluetooth.

---

## 5. What would change any of this

- **The Mac's advertised roles are not ours to change**, but they are read from
  `system_profiler SPBluetoothDataType` (`Supported services:`) and, better, from the phone's own
  SDP record of the Mac. Re-read the phone's side; the Mac's bitmask is role-blind and will happily
  say `HFP` while meaning only the gateway half.
- **`IOBluetoothHandsFreeDevice` is 10.7-era public API in a framework Apple has been hollowing
  out.** "Not deprecated" is not "works". Only stage 0 answers that, and the answer has a shelf
  life — recheck it after a major macOS release rather than citing this document.
- **The DAL plug-in path is gone.** `/Library/CoreMediaIO/Plug-Ins/DAL/` holds nothing but a
  `plugins-info.txt`. The camera route is Camera Extensions or nothing, which is what puts it behind
  the account and keeps it there.

---

## 6. Stages 0 and 1 were run — 2026-09-14. **Both pass.**

The probe is a ~60-line Swift CLI (`swiftc` against the CLT SDK, no project, no bundle, no
signing, no entitlement). It did not need an `.app` wrapper and **no TCC dialog appeared** — the
responsible process (VS Code) already held Bluetooth access. The control proved it:
`IOBluetoothDevice.pairedDevices()` → **9 devices**, named, so a later failure could not be TCC
wearing an HFP costume.

### Stage 0 — the class is alive on 26.6.1

```
target: 08-02-3c-b4-6f-59  name=Chetan's S25 Ultra  paired=true
target.isHandsFreeAudioGateway = true
deviceSupportedFeatures (from the phone's SDP) = 303
DELEGATE handsFree:connected: status=0 (0 == kIOReturnSuccess)
isConnected = true
```

**SLC in under one second.** The 10.7-era API is not a zombie.

### Stage 1 — the phone builds the state machine

HFP state machines on the phone went **1 → 2** (the baseline 1 is a pair of earbuds), and the new
one is a complete service-level connection, not a stub:

| record | what crossed |
|---|---|
| `Connecting → Connected` @ `17:07:38.521` | SLC established |
| `EVENT_TYPE_BRSF valInt=4079` | the Mac presented HF feature bits |
| `AT+CIND`, `AT+CLCC` | indicator and call-list negotiation |
| `+CSMS`, `+CMGF`, `+CNMI=3,1,0,0,0`, `+CSCS="UTF-8"` | the framework's SMS-over-HFP setup |
| `DEVICE_STATE_CHANGED: hasCellularService=1, signalStrength=3, batteryCharge=3` | **the phone pushed its cellular state to the Mac** |
| `Connected → Disconnecting` @ `17:07:48.873` | our own `disconnect()`, ten seconds later |

**The strongest single reading is not in the log — it is the policy change.** The phone's HFP
connection policy for the Mac moved from `HEADSET=-1` (UNKNOWN) to **`HEADSET=100`** (ALLOWED),
which is the same value as the real earbuds read by the same query. The phone has durably
reclassified this Mac as a headset it is willing to connect to.

**So §1's "the intersection is empty" was true of the advertised roles and is not a statement about
what the platform will do when asked directly.** The Mac never advertises HF, and it does not need
to in order to *initiate*.

### ~~The open defect: reconnect is a silent no-op~~ — **withdrawn, see §7**

**This section was wrong and is kept struck rather than deleted, because the way it was wrong is
the lesson.** It read 1-of-4 attempts and concluded the reconnect path was broken. Subsequent runs
connected **3 times out of 3**, one SLC **recovered by itself** with no intervention
(17:37:23 drop → 17:43:13 return), and another held **25 minutes continuously with zero drops**.
Four samples taken inside one ten-minute stretch were treated as a property of the mechanism when
they were a property of that ten minutes. The original text follows.

### The reported defect: reconnect is a silent no-op

**1 of 4 attempts connected.** Attempts 3, 4 and 5 returned no `handsFree:connected:` callback
within 20 s and left `isConnected = false`.

**It is Mac-side, and the phone proves it rather than the Mac:** the phone's state-machine log stood
at `total records=18`, last entry `17:07:48`, through every subsequent attempt. **The phone saw
nothing.** `connect()` returns without error and never reaches the air.

Ruled out: the baseband link. Forcing it first gives `openConnection() -> 0`,
`isConnected(ACL) = true`, and the HFP connect still does not fire. SDP is not stale either —
`deviceSupportedFeatures = 303` is read correctly on every attempt.

**Not attempted, deliberately: cycling the Mac's Bluetooth.** This Mac's keyboard and mouse are
Bluetooth devices; toggling the radio to test a hypothesis would take the user's input devices out
from under them. That needs their say-so, not a probe's.

### Where this leaves it

| | |
|---|---|
| Stage 0 | **PASS** |
| Stage 1 | **PASS** — and the policy change is stronger evidence than the transcript |
| Reconnect | **open defect**, Mac-side, silent |
| Stage 2 (real call, `connectSCO`, `transferAudioToComputer`, which CoreAudio device it lands on) | **not attempted** |

It did not die at stage 1, so the mic does not inherit the slot by default. The next question is
whether the reconnect no-op is a framework bug with a workaround or the thing that actually kills
this — and that is answered at stage 2's cost, not stage 1's.

The probe is `scripts/support/hfprobe.swift` if promoted; it currently lives in the session
scratchpad.

---

## 7. Stage 2 was run — 2026-09-14, on two live calls. **Audio does not cross.**

The SLC is not the problem and never was. What fails is the SCO voice link, and it fails the same
way from both public entry points.

### The four questions, answered or explicitly not

| | Result |
|---|---|
| **1. Does call audio reach the Mac?** | **No.** `transferAudioToComputer()` and `connectSCO()` both return `SCO OPENED status=-536870201`. `isSCOConnected()` read **false** on every sample across a continuous 4-minute SLC during a live call |
| **2. Does the Mac's microphone reach the phone?** | **Untestable — blocked by 1.** There is no voice link in either direction, so there is nothing for uplink audio to travel over. Not inferred from 1: the phone's `mAudioState` stayed at **10** (AUDIO_DISCONNECTED) throughout, which is the independent reading |
| **3. Which CoreAudio device, by name?** | **None.** Device list **6 before, 6 during**, no Bluetooth entry ever appeared; `inputDeviceID` and `outputDeviceID` both **0**. The absence *is* the answer |
| **4. Does the call survive the SCO link dropping?** | **Untestable — blocked by 1.** SCO never came up, so nothing dropped. The call did survive two failed SCO *attempts* and an SLC expiry, which is adjacent and is not the question |

**Two of four are blocked by the same cause, and saying so is the honest report.** An earlier
draft of this table was one sentence away from reading *"the mic does not reach the phone"*, which
is a claim about a mechanism that was never exercised.

### The discriminator earned its place

The uplink question is the one no instrument on either machine can answer — it needs a human at the
far end. That makes it the one most likely to be faked by the phone's own microphone picking up a
room. The guard was **`mAudioState`** in the Mac's `HeadsetStateMachine` on the phone: `10` =
AUDIO_DISCONNECTED, `12` = AUDIO_CONNECTED. It read **10 for the entire call**.

So had the far end reported hearing speech, that would have been the phone's own mic, and the run
would have recorded a **false pass on the only question requiring judgement**. Control: the bonded
earbuds read `mAudioState: 10` in the same dump while disconnected, so 10 is genuinely the idle
value.

### What works, and it is not nothing

The control channel is fully functional and tracked a real call live:
`callSetupMode 2 → 3 → 0` (outgoing → remote alerting → connected), `isCallActive=1`, `AT+CLCC`
returning the actual number, indicator and SMS negotiation, and the phone promoting the Mac to its
**ACTIVE HFP device** (`HFP: Connected: 1, Active: Chetan's MacBook Pro`). **Call control works.
Call audio does not.** Any future design must not read the first as evidence for the second — they
travel on different links, and only one of them is up.

### The error, not guessed

`status=-536870201` = `0xE0000207`. It is **not** in IOBluetooth's own error family —
`iokit_bluetooth_err(n)` lives at `0xE002xxxx`, and `IOBluetoothTypes.h` has no constant matching
`0x207`. Reported raw rather than named, because a plausible-sounding decode would be a guess
wearing a hex value.

### The one route not tried

**Phone-initiated SCO.** Everything above is the *Mac* asking for the voice link. Selecting the Mac
in the phone's in-call audio picker makes the **phone** initiate, which is a different mechanism and
is untried — the picker was never tapped during either call. Until that is read, the honest status
is *"audio does not cross by the Mac-initiated route"*, **not** *"audio cannot cross"*. Do not
promote this to a platform wall until that tap has been made and recorded.

---

## 8. The untried route was tried — 2026-09-14, later the same evening. **This is a wall.**

§7 closed by refusing to call this a wall while phone-initiated SCO was unread. It has now been
read, driven over adb, and it fails too — differently, which is what makes the mechanism clear.

### The phone does offer the Mac

The in-call screen carries it as a named control, not a coordinate:

```
id=third_button   content-desc="Off, Chetan's MacBook Pro, Button"   bounds=[936,1672][1296,2065]
```

So the earlier guess that the phone might not list it was wrong. **It lists it, by name, beside
Mute and Speaker.**

### Selecting it starts a transition that never finishes

Tapped twice — once from earpiece, once from speaker. The button stayed `Off`, `mAudioState`
stayed `10`, and the Mac logged **zero** SCO events. But Telecom's own state says the request was
not ignored:

```
Current route:  AudioRoute[Type=TYPE_SPEAKER, Address=invalid]
Pending route:  mDestRoute=AudioRoute[Type=TYPE_BLUETOOTH_SCO, Address=…08:55], mActive=true
```

**The phone accepted the route change, targeted the Mac by address, and hung.** It never becomes
the current route.

### The control that makes the two taps evidence

A button that stays `Off` after a tap is indistinguishable from a tap that never landed. So
**Speaker was tapped by the same mechanism and went `"Off, Speaker" → "On, Speaker"`.** Taps
register; the MacBook route genuinely refuses.

This is the *"prove the stimulus happened before reading its absence"* rule, and without it the
whole section would have been a confident claim about a tap that might never have occurred.

### Both directions fail, and they fail differently

| direction | mechanism | result |
|---|---|---|
| **Mac → phone** (`transferAudioToComputer`, `connectSCO`) | the Mac asks for SCO | returns **`status=-536870201`** immediately |
| **phone → Mac** (in-call audio picker) | Telecom asks for SCO | **hangs in `PendingAudioRoute` forever**, never completes |

Two independent initiators, two different failure modes, one outcome: **the SCO voice link cannot
be established between this Mac and this phone.** Everything above SCO — the SLC, call control,
indicators, call lists, SMS negotiation, the phone promoting the Mac to ACTIVE HFP device — works
perfectly and carries no audio.

**This is the wall.** Not "unproven", not "needs a different API": the one link that carries voice
does not come up, from either end, with the platform's own UI driving it.

### One side effect worth recording, because it is a real defect in something

The stuck `PendingAudioRoute` **wedged the route controller**. With it pending, the Speaker button
would no longer toggle off, and killing the SLC did not clear it either — the call stayed on
speaker with a pending route to a device that was no longer connected. The call itself was
unaffected throughout (`state=ACTIVE`).

That is a One UI / Telecom bug rather than ours, and it is the practical cost of this experiment:
**selecting a Bluetooth route that cannot establish leaves the phone's call-audio controls stuck
for the rest of the call.** Anyone repeating this should expect it and should not repeat it on a
call that matters.
