# Pairing, end to end — the flow proposal, both surfaces

> **Written 2026-09-02. Nothing here is built.** The Mac's *screen* already has a proposal, in
> `docs/design-departures.md` → "A request, not a departure: the pairing screen", and this does not
> repeat it. What that one does not cover is **the phone half and the join between them**, which is
> where the actual blocker is.
>
> The blocker, stated once: *"I paired by hand in Phase 1 and a stranger has no path from 'app
> opened' to 'phone connected'."* That is exactly right, and §1 walks the path a stranger is on
> today so the fix is aimed at where it breaks rather than at where it is easiest to build.

## 0. What exists, measured on both surfaces

**The Mac**, read through `scripts/pairing-probe.mjs` against the live window, with the route
restored afterwards:

```
the pairing section → {"cards":1,"buttons":1,"inputs":0,"hasQr":true,
                       "headings":["Scan this with your phone"]}      [control=12]
progress rows on the pairing screen (the proposal asks for four) → 0  [control=1]
a manual-address field on the pairing screen itself             → 0   [control=1]
does the pairing screen show any countdown or expiry → {"mentionsRefresh":false,"noteText":""}
nav rows / dock tiles / device card while running → {"navRows":11,"dockTiles":5,"deviceCard":true}
```

So: one card, one QR, one button, no progress, no escape hatch, no countdown. That matches the
existing proposal's own description of it as *"a placeholder standing in for a design"*.

**The phone**, read from source:

- `AppNavigation.kt` has three tabs — **Sync · Mirror · Mac** — and pairing lives on the third.
- `OnboardingScreen.kt` has four pages: *ConnectSuite · Finding your devices · Before you can
  mirror · Keeping it running*. **None of them mentions pairing, scanning, or a QR code.** The word
  *paired* appears once, in a security note: *"Devices are paired by confirming a key on both
  screens, and every connection after that is checked against it."*
- `LinkRoute.kt` — the Mac tab — leads with a card reading **"Ports 42501, 42502, 42503 · protocol
  v1"**, then a capability list, then *"Not offered yet: … 3 not built, 1 awaiting a permission"*,
  and **then** the button: *"Scan pairing code on Mac"*.

## 1. The path a stranger is actually on

| # | What happens | What is wrong with it |
|---|---|---|
| 1 | They install the phone app and see onboarding | Four pages that ask for permissions and explain mirroring. **Pairing is never mentioned.** The flow ends on **Done** with nothing to do next |
| 2 | Onboarding drops them on the **Sync** tab | Which is the v1 Android-to-Android feature. Nothing on it concerns the Mac |
| 3 | They install the Mac app, which opens on the pairing screen | This part works: `paired` is false, the shell forces the route, and a QR is drawn |
| 4 | The Mac's copy says: *"Open ConnectSuite on the phone, go to the **Mac** tab, tap **Scan pairing code**"* | The instruction is on the wrong device. The person is holding the phone, looking at the Mac, and the phone is showing them a Sync tab. **Verified correct in one respect**: the tab really is called *Mac* and the button really does say *Scan pairing code on Mac* — the copy and the app agree, which is more than the note in §0 does |
| 5 | They find the Mac tab | And meet *"Ports 42501, 42502, 42503 · protocol v1"* and *"Not offered yet: … 3 not built"* above the button they need. A diagnostics screen wearing the onboarding screen's job |
| 6 | They scan | This works. The phone trusts the fingerprint and starts listening |
| 7 | The Mac dials out and connects | Or it does not, and **the screen says the same thing either way** — see §3 |

**Steps 1, 2, 5 and 7 are the flow.** Steps 3, 4 and 6 already work. That is the useful shape of
this: the pairing *mechanism* is sound and shipped, and what is missing is that **nothing on either
device tells anybody to use it**, plus one honest failure state at the end.

## 2. The phone half — what to build

### 2.1 A fifth onboarding page, and it is the important one

Onboarding today ends at *"Keeping it running"* → **Done** → the Sync tab. It should end at
**pairing**, because pairing is the only thing that makes any of the previous three pages matter.

**Proposed page five: "Connect your Mac."**

- Title: *Connect your Mac*. Subtitle: *Open ConnectSuite on your Mac. It will show a code — scan
  it here, once.*
- A single primary button, **Scan the code**, which opens `QrScanScreen` directly. The user never
  has to learn that a tab called *Mac* exists.
- A secondary, **I'll do this later**, which finishes onboarding as today. Not *Skip*: this one is
  genuinely optional for somebody who has not installed the Mac app yet, and the label should say
  which situation it is for.
- On a successful scan, the page becomes a success state — *Paired with "Chetan's MacBook Pro"* —
  and **Done** finishes onboarding onto the **Mac** tab rather than **Sync**.

**Why a page rather than a card on the Sync tab:** onboarding is the only moment when the app has
the user's undivided attention and a linear order it controls. A card is something to be scrolled
past.

### 2.2 The Mac tab, reordered

`LinkRoute` is a good diagnostics screen and a bad first screen. It should lead with the state a
person cares about and put the numbers underneath.

Proposed order, unpaired: **Scan pairing code** (primary, full width) → *"No Mac paired yet"* with
one line saying what pairing gets you → the paired-Macs list (empty) → **Advanced**, collapsed,
holding ports, protocol version and the capability diagnostics.

Paired: the connection state card → the paired-Macs list → **Advanced**, collapsed. The scan button
moves to a secondary **Pair another Mac**.

**The `Advanced` fold is the whole change.** Nothing is deleted — the ports line has earned its
place a dozen times in this project's own testing — it just stops being the first thing a new user
reads.

### 2.3 One copy defect, found while reading

> *"Devices are paired by confirming a key on both screens, and every connection after that is
> checked against it."*

**Nothing is confirmed on both screens.** The Mac draws a QR; the phone scans it; the fingerprint
inside is pinned. There is no confirmation step on the Mac and no key shown on the phone. The
sentence describes a numeric-comparison pairing flow this app does not have — and a user who reads
it will stand there waiting for a key to appear on the Mac.

The second clause is true and worth keeping. Proposed replacement: *"Pairing is a code you scan
once. The certificate behind it is pinned, and every connection after that is checked against it —
an unpaired device is refused without asking you anything."*

This is a defect rather than a proposal: it is a false statement in shipped user-facing copy. It
belongs in the register whether or not the rest of this document is built.

## 3. The join, and the two states that look alike

This is where the design work actually is, and it is the same shape as every other row in
`docs/design-departures.md` that this project has had to solve.

### 3.1 The Mac cannot tell "nobody scanned" from "scanned, and failing"

Already recorded as **P3** in the existing pairing-screen proposal, and it is the reason the four
progress steps there are worth building. Restating the mechanism because it constrains the phone
side too: the phone is the listener and the Mac dials out (locked decision #2). Before mDNS
resolves, there is **no signal that a scan happened at all**. So:

- a code nobody has scanned, and
- a code scanned by a phone on a different Wi-Fi network

produce **the same screen, indefinitely.** That is the *what else would look exactly like this*
rule at the one moment a new user has no idea what is supposed to happen, and the honest fix is a
signal rather than better wording — which is what P3 asks for.

### 3.2 The phone has the mirror-image problem, and nobody has written it down

After a successful scan the phone shows *"Paired with X"* and starts listening. It then has no way
to distinguish:

- the Mac has not dialled yet (normal, takes a second or two),
- the Mac dialled and the TLS handshake was refused,
- the Mac is on a different network and never will dial.

All three render as *"Listening for your Mac"*, forever. **The phone's screen is the one the user is
holding**, so it is arguably the more important of the two — and unlike §3.1 it needs no protocol
change to improve, because the phone can see its own accept loop:

- a connection was accepted and the handshake failed → say so, with the fingerprint prefix
- nothing has connected in 30 seconds → offer the network hint, rather than a spinner with no end

`LinkTls.checkClientTrusted` already logs `Rejected unpaired client …`. That is the fact; it just
never reaches the screen.

### 3.3 The state table both surfaces should be built against

| # | Mac shows | Phone shows | Reachable today | Distinguishable today |
|---|---|---|---|---|
| J1 | Code up, nothing scanned | Not on the pairing screen | yes | — |
| J2 | Code up, scanned, Mac searching | *Listening for your Mac* | yes | **no** — J1 and J2 are the same Mac screen (§3.1) |
| J3 | Handshaking | *Listening* | yes | Mac: yes (`handshaking` phase). Phone: no |
| J4 | Paired, released to Overview | *Connected to …* | yes | yes |
| J5 | Code expired before the scan | Scan reports failure | yes | **no on the Mac** — needs P4 |
| J6 | Scanned, wrong network | *Listening for your Mac* | yes | **no on either side** |
| J7 | Scanned, fingerprint refused | *Listening*, with a rejection in the log | yes | **no on either side**, and the phone could |

**J6 is the one that will hurt most**, because it is the commonest real failure and both devices
show a state that means "everything is fine, wait". Neither can detect it alone; a timeout on each
side with the network hint is the honest treatment, and it costs nothing on the wire.

## 4. What needs the wire, and what does not

The existing proposal's P1–P5 stand and are not repeated. What this document adds:

| # | Need | Wire change? | Note |
|---|---|---|---|
| **F1** | Onboarding page five | **No** | Phone-side UI only. The largest single improvement in this document and the cheapest |
| **F2** | Mac tab reordered, diagnostics folded | **No** | Phone-side UI only |
| **F3** | The security-note copy corrected | **No** | A shipped false statement. Register it |
| **F4** | Phone-side pairing timeout with a network hint (J6) | **No** | The phone knows nothing has connected; it is not saying so |
| **F5** | Phone surfaces a refused handshake (J7) | **No** | `LinkTls` already logs it; the screen never hears |
| **F6** | Mac distinguishes J1 from J2 | **Yes** — P3 | mDNS publication at scan time is the cheapest form and changes no message |
| **F7** | Mac renders a refusal reason (J5) | **Yes** — P4, `pair.reject { reason }` | One message. `docs/protocol.md` first, both sides after |

**Five of the seven need no protocol change at all**, which is the finding that should decide the
order of work. F1 alone converts *"a stranger has no path"* into *"a stranger is walked to it"*.

## 5. What is deliberately not decided here

- **Whether page five is skippable.** Proposed yes, because somebody may not have the Mac app yet.
  If the answer is no, the page needs a third state for *"I don't have a Mac"* and the app needs to
  behave sensibly for a phone that will never pair.
- **Whether the Mac's pairing screen keeps the sidebar dimmed** — the existing proposal says yes and
  it is the designer's call.
- **Whether pairing gets a palette entry.** `scripts/homeless-features-probe.mjs` measured
  `"pair" → []` and it was left that way deliberately: adding a way to *re-pair* while paired is a
  product decision, not a discoverability fix, and it belongs with the rest of this flow.

## 6. Why nothing here is built

Two of the seven items change `docs/protocol.md`, which is the contract and is changed there first
and deliberately. The other five are phone-side UI: they change what the first screen of somebody
else's app says, they need a build and an install on the device, and they rest on the shape of a
flow this document is asking to have reviewed rather than assuming.

**F3 is the exception and should be taken regardless** — a shipped sentence that describes a pairing
mechanism this app does not have is wrong whether or not the flow is redesigned around it.
