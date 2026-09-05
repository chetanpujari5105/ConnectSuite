# What is left — the complete remaining-work inventory · 2026-09-05

> **A scoping read, not a plan.** Nothing here was built, started, or changed. Every row cites a
> file, a defect number, or a reading taken this sitting. Where a thing is recorded as done and the
> evidence is not there, the row says so instead of carrying the claim forward. Where I do not know
> what something needs, the row says **I do not know**.

---

## 0 · What was actually run to produce this, and what was not

Readings taken this sitting, so nothing below is a memory:

| Command | Result |
|---|---|
| `npm test` in `desktop/` | **600 pass, 0 fail**, 2.8 s |
| the nine `git commit` guards, each fed a `git commit` payload | **9 of 9 `rc=0`** |
| `node scripts/check-protocol-spec.mjs` | 63 of 64 types specified · **debt: `net.state`** · **mac-side gap: `mirror.screenoff`** |
| `node scripts/check-renderer-views.mjs` | 13 view classes · **11 covered / 2 on the debt list** (`MirrorView`, `ShellView`) |
| `node scripts/check-state-vocabulary.mjs` | **84 states across 19 panes**, every printed number matches its table |
| `node scripts/check-versions.mjs` | Android and desktop both **2.0.0** |
| `bash scripts/target-device.test.sh` (uncommitted) | **17 pass, 0 fail** |
| `find . -type d -name test -not -path '*/build/*'` | `app` · `core` · `input-module` · `mirror-module` · `sync-module` — **and one more, see §8.6** |
| `git status --short` | 3 modified, 4 untracked, **nothing committed** since `9589892` |

**Not run, and therefore not claimed:** Gradle. The phone-side test *counts* in this document are
**file counts** (`app` 1, `core` 12, `input-module` 4, `mirror-module` 4, `sync-module` 28), not
test counts. No device was touched — no `adb`, no install, no launch of either app. The
card-visibility sweep in §7 needs the running Electron app and was **not** re-taken; §8.4 is why
that matters.

---

## 1 · The phases, one row each

**Source for the numbering is `CLAUDE.md`'s roadmap table and nothing else, by its own statement.**

| Phase | State | What is left in it |
|---|---|---|
| **1** — transport, QR pairing, TLS, discovery, auto reconnect | **Done**, hardware 2026-08-25 | **Defect 17** only: the Mac holds one phone structurally and refuses a second rather than evicting it. Deferred since Phase 4; no route on one handset (`docs/phase-6-closeout.md` U7). Nothing else. |
| **2** — screen mirroring | **Done**, closed 2026-08-26 | Four unbuilt tool-rail / Advanced rows, all Mac-side or wire-side, none a wall: **M4** Record, **M7** Sound from phone, **M9** Keep screen on, **M13** tap-and-swipe on the canvas. **M13 is the substantive one** — it needs the coordinate mapping and the drag/stale rules lifted out of `mirror.ts` into a shared seam, because a second copy of defect 19/20's logic is the copy that does not get the next fix. Plus `mirror.screenoff`, deliberately unimplemented and asserted never-registered. |
| **3** — input injection | **Done**, hardware 2026-08-27, closed on paper 2026-08-31 | **Nothing open.** The one step not marked PASS is **step 33** (`InputFailure.PhoneLocked`), *not runnable as written* on this hardware — locking the phone kills MediaProjection before input can be attempted. That is an observation about the step. (Note: `docs/phase-5-closeout.md` calls this *"Defect 33"*, which is a different thing — see §8.3.) |
| **4** — notifications, calls, SMS/MMS, media remote, contacts | **Done**, closed 2026-08-31 | **Defect 30's no-thread half** — one send to a number with no thread, with the absence proven in `mms-sms/conversations` **and** `content://sms` first. **Defect 38** (deferred) — a volume change made on the phone never reaches the Mac. **Defect 33** (fixed 2026-09-03, not proven on hardware). |
| **5** — files, photos, clipboard, contacts | **Done**, closed 2026-09-02 against both its conditions | **Nothing outstanding as a feature.** What remains from its close-out is measurement, not code: the four **Class B gate** rows in `docs/phase-5-closeout.md` — refusal branches implemented and never once observed (`remote`, `photos`, `sms`/`calls`/`contacts`, `mic`) — plus the frame-cap refusal path, `fs.list`'s id tiebreak on real data (`tieBoundaries: 0`), and `media.*` under a grant revoked mid-request. See §3. |
| **6** — background reliability on One UI | **Done**, closed 2026-09-03 against an honest accounting | **Defect 80's start half** (`ACCESSIBILITY_BIND` has fired three times and started the link zero times) — the only row with a route on this device. **U1, U2, U7 have no route at all**: is any fix a fix or a One UI workaround; the unexempt *and neglected* case; defect 17. **U3** needs the owner's eyes on Device Care; **U4/U6** need an unplugged night. |
| **7** — Mac UX, packaging, app launching, polish | **In progress** — the live phase | The four §2-overtaken rows are discharged and the design pass has run over Calls, Clipboard, Settings, Overview, Photos and Messages. What is left: **the designer's hour** (the *unavailable / partial / failed / empty* vocabulary, a drawn pairing screen, X9, the latency threshold); **the two unhomed features** — the clipboard's Restore and the trust controls, neither reachable from the palette (verified: `DEEP_LINKS` holds exactly two entries, `deep.remote` and `deep.contacts`); **the unbuilt departure rows** in §4; **`net.state`**, the last type on the protocol debt list; **`MirrorView` / `ShellView`** on the renderer-view debt list. Camera is *not* in Phase 7. |
| **8** — *no row exists* | **Never opened, and it has no scope written anywhere in this repo** | See below. |
| **9** — distribution, packaging, signing | **Started** 2026-09-02, only the $0 parts | **D3** (the `.dmg` has never been installed from `/Applications` after a real download with quarantine set), **D4** (no application icon exists — the build says so itself), **D7** (a relocated Downloads folder), **D9** (`applicationId` is a personal namespace — a decision, not a task), **D10** (the `LOCAL` pill), **D11** (packaged and dev builds share `userData`), **D12/D14/D15** (all three are the missing Developer ID — §5). **D13 is recorded open in the audit and is closed by evidence** — see §8.1. |

### Phase 8's actual scope, since you asked for it rather than the one-line summary

**There is no Phase 8. The number is unallocated and always has been.** This is not an omission in
one file, it is consistent across four:

- `CLAUDE.md`'s roadmap table runs **1, 2, 3, 4, 5, 6, 7, 9**. There is no row 8 and never was.
- `docs/mac-ui-design-proposals.md:10`, written 2026-08-29, states it outright: *"The roadmap has
  seven phases and no Camera row. 'Camera is Phase 8' is not in the table."*
- `desktop/src/renderer/navModel.ts:216` — the Camera screen's own `unbuiltReason` — says *"The
  virtual webcam is **not in any phase yet**."* and its `unbuiltHandle` is *"no namespace proposed
  yet"*.
- The only two places that name Phase 8 as a container are `docs/phase-7-state.md:21` (*"Phase 8 is
  shut"*) and `:115` (*"Camera needs Phase 8's signing"*), and **both attribute to Phase 8 the
  content of Phase 9's row** — *Distribution — packaging, signing, release builds*.

So the honest scope of Phase 8 is **empty**, and the question underneath it is *what would go in
it*. Exactly one candidate has ever been proposed, and this is its measured state:

| Camera — phone as a Mac webcam | Reading |
|---|---|
| Nav row | exists, twelfth of twelve, `state: 'unbuilt'`, `⌘9` |
| Protocol namespace | **none.** `grep -c 'camera\.' docs/protocol.md` → **0** |
| Capability enum | **none.** `Capabilities.kt` has `mic`; it has no camera member |
| Mac-side mechanism | a **macOS Camera Extension** (CMIO) — a *system* extension, which must be signed and (for distribution) notarized |
| Phone-side mechanism | not specified anywhere in this repo |
| Blocked on | **the Developer ID** first (§5), and a protocol namespace second |

**What I do not know:** whether the phone half is `CameraX` frames over the existing video socket or
a second encoder path, what the latency budget is, and whether the Camera Extension can be loaded
from a non-notarized bundle at all on macOS 26. None of that has been measured or proposed, and I am
not going to guess it into a table.

---

## 2 · Every open defect, one line each

The register's own status values: **open** · **fixed** (code changed, not yet proven on hardware) ·
**closed** (fixed *and* verified on hardware) · **deferred**. `scripts/check-defects.sh` guards
existence, **not** status wording, and says so — which is why §8.2 exists.

### Genuinely open or deferred — four

| # | What it is | Touches a shipped feature? | What it needs |
|---|---|---|---|
| **17** | The Mac holds one phone structurally and refuses the second rather than evicting it | **Yes** — pairing and the trust store, on the first screen anyone meets with two phones | **A second device**, and Mac-side code. `phase-6-brief.md` §3 calls it *"the single most concrete thing a second handset buys"*. A moto g34 now exists (§6) but is somebody else's phone |
| **30** (half) | The Mac cannot start an SMS conversation with a number that has **no existing thread**. The explicit-address path closed on hardware at step 71 | **Yes** — Messages, the New conversation panel | **Your hands**, and a precondition first: the absence must be proven in `mms-sms/conversations` **and** `content://sms`, because orphaned `sms` rows outlive a deleted conversation. That precondition is what cost step 71 its no-thread case. No code pending |
| **38** | A volume change made **on the phone** never reaches the Mac — `onAudioInfoChanged` is not overridden | **Yes** — the media remote, which is a shipped, working feature | **Code**, plus your hands to test it. Its note must survive the fix: check `playbackInfo.playbackType`, and test with the phone's own volume keys — a `volume_set` from the Mac goes through `onCommand` and makes a broken build look fixed |
| **89** | The album rail lists Samsung Gallery's **trash** as an ordinary album, and cannot tell four folders sharing a leaf name apart (`BUCKET_DISPLAY_NAME` is the leaf only) | **Yes** — Photos, and it shows the user's deleted photographs as a normal album | **Code, and a wire change**: `relativePath` (or a `trashed` flag) on `media.buckets`, then drop `Android/.Trash/**` and disambiguate a repeated name with its parent segment. Two surface-only workarounds were built and both removed after being drawn |

### Fixed, and the hardware proof is genuinely missing — three

| # | What it is | Touches a shipped feature? | What it needs |
|---|---|---|---|
| **33** | The phone names packages where it means apps, in sentences users read | **Yes** — notification reply refusals on the phone | **Code is done** (`AppLabels.of` at both call sites, guarded by `PackageIdInProseTest`, red-first 1 of 3). Its *Verified by* column is `—`. Needs **your hands**: produce a no-reply-action refusal on the phone and read the sentence |
| **80** (start half) | `ACCESSIBILITY_BIND` is a start route into a process that installs every feature and binds no socket | **Yes** — the link's recovery after a low-memory kill, a service toggle, or a crash `START_STICKY` missed | **Your hands and a debug affordance.** Revoke the notification-listener grant, **stop `LinkService` first**, then `am crash` — three attempts have all lost to a faster route, most recently `START_STICKY` by 16 ms. The branch is unexercised, three times over |
| **84** (cooldown branch) | A per-key notification cooldown, window sized by whether the key has ever been `ongoing` this session | **Yes** — native banners, the feature that keeps the Mac from being silent | **Time, not hands.** The stimulus is any app that advances `when` while flapping `ongoing` — Jio's next active period. Not producible on demand; 90 s of live traffic gave `39 replay / 10 group-summary / 7 ongoing` and **zero `notify`**, so there was no banner to hold and the zero is a missing reading |

### The remaining `fixed` rows — 51, 52, 53, 57, 69, 71, 77, 78, 79, 81, 82, 87, 94, 95

**Fourteen rows, and none of them is work.** Ten — **57, 69, 77, 78, 79, 81, 82, 87, 94, 95** —
carry hardware or measurement evidence **in their own text** and by the register's own definition
should read `closed`; see §8.2. The other four — **51, 52, 53, 71** — are log-line, counter and copy
changes with red-first unit tests and no hardware stimulus that would add anything: 51 counts
`pushed / deferred / recovered / still owed` instead of predicting a loss, 52 splits one `dropped`
counter into three reasons, 53 gives the two silent Mac call refusals a line each, and 71 is one
onboarding card guarded by a test. Their *pre-fix* behaviour was observed on hardware; the fixes are
about what gets written down.

---

## 3 · Built, and unproven on hardware — with the stimulus each one needs

You named defect 84's cooldown and F6/P3. Both are real and are in the table; the rest were found by
sweeping `docs/testing.md` for *"unproven"*, *"stimulus"*, *"never observed"* and *"synthetic"*, and
`docs/phase-5-closeout.md`'s Class B gate sweep, which nothing has revisited since Phase 5 closed.

**Twelve.** Ordered by what a user would notice first.

| # | Built thing | Why it is unproven | The stimulus |
|---|---|---|---|
| 1 | **`pair.rejected` — the wire half.** The phone sends it (`ControlSession.kt`), it is in the contract, in `MessageType`, typed on the Mac, and the Mac now renders its own copy keyed on `reason` and arms a fresh code | **No `pair.rejected` has ever crossed the wire to this Mac.** The Mac half is unit-tested only. A synthetic IPC event was deliberately not fired — it would have proven the drawing while claiming the wire | Four steps, written out at `docs/testing.md` → Slice 12 §4: open the pairing screen, scan on the phone, press **Show a fresh code** *before* pairing completes, let the Mac dial with the new token → `TOKEN_MISMATCH`. Expect `W [pairing] The phone refused this pairing: TOKEN_MISMATCH` |
| 2 | **F6 / P3 — the Mac tells "nobody scanned" from "scanned, and searching."** Both halves exist: the phone publishes `pair` in its mDNS TXT (`NsdAdvertiser.kt:66`, driven by `LinkServer.pairIntentSink`), the Mac browses for its own fingerprint | The watch is measured **arming** (`[pair-intent] Watching mDNS for a phone publishing 3030c8ebcddcd0fb`, 2 lines in the window). *A registration line is not an execution line* — whether a real phone publishes it, whether this Mac's browser sees it, and whether the screen draws the line are all unobserved | Forget the phone on the Mac, open the pairing screen, scan. **The line must appear before the link comes up** — that ordering is the whole feature. Unpairing leaves the Mac unable to reconnect until somebody walks over with the handset |
| 3 | **Defect 84's per-key cooldown** | Zero `notify` decisions in 90 s of live traffic, so there was no banner to hold | Jio's next active playback period. Self-announcing when it comes: the suppression logs its window kind and its held/posted counts |
| 4 | **Defect 80's `ACCESSIBILITY_BIND` start route** | Three attempts, three no-op branches, each behind a faster route | Listener grant revoked → **stop `LinkService`** → `am crash`. Needs a debug affordance and your say-so, since it turns notification mirroring off for the run |
| 5 | **Defect 33's resolved `appName` in the phone's refusal sentences** | Guarded by a source scan; never read on a screen | Produce a no-reply-action refusal on the phone |
| 6 | **The app-hosted-call card** — *"WhatsApp is hosting this call, not the phone network"* (Slice 35). Guarded on `category: "call"` + no number + `ongoing` | The card was driven **synthetically** through the real render path and is labelled so. `category` was proven populated on the device (7 notifications, `msg` 1 / `service` 1 / `status` 1 / none 4, ongoing 3) but there was no `call` row, correctly | **One incoming WhatsApp call.** Needs your phone |
| 7 | **Contact photographs on the live-call card** (Slice 34). The list half is real; the live card was measured separately | *"A ring cannot be scheduled"* — the live card was synthetic, `initialsUnderneath: "SC"`, labelled and reverted | One real inbound call |
| 8 | **Class B gate — `remote` / `NOTIFICATION_LISTENER`.** The claim that `MediaSessionManager.getActiveSessions` needs a listener component is documentation-derived, exactly as the clipboard wall was before Slice 11 measured it | Never exercised in the **denied** direction. `docs/phase-5-closeout.md` calls this *"the twin of the clipboard finding, and the reason this sweep was worth running"* | Revoke the notification-listener grant and call `getActiveSessions` — a probe that goes **around** the capability gate, the way `ClipProbeActivity` does, because the gate makes its own premise untestable |
| 9 | **Class B gate — `photos`, `sms`, `calls`, `contacts` refusal branches** | Every one exercised only in the **granted** direction. Contacts' `PERMISSION_DENIED` is recorded as *"reachable with `pm revoke`"* — reachable, not reached | `pm revoke` on each, one at a time, on a device we own. Deliberately **not** done in Phase 5: a bad revoke run replaces *unobserved* with *wrongly observed*, and `dumpsys activity permissions` already lies about grant state (`persisted=0x0` rows) |
| 10 | **`media.*` under a grant revoked mid-request** | The Files pane's `ROOT_NOT_GRANTED` was produced live; the Photos equivalent — revoking *Photos and videos* mid-listing — was never run | Revoke the media grant while the Mac holds an in-flight `media.list` |
| 11 | **The bulk channel's frame-cap *refusal* path** | Unit-test-only since Phase 5 slice 1, and named as such then. The only way to emit an over-cap frame on a real socket is **a peer built to violate a rule our own writer refuses to break**. The *accept* path is proven | A hostile second client. **I do not know** whether that is worth building; it is the one row here whose stimulus costs more than the reading |
| 12 | **`fs.list`'s `id` tiebreak on real data** | `tieBoundaries: 0` over 16,377 real entries — 33 pages, ids distinct, sums reached, and **not one page boundary fell inside a tie group**. That run proves the pager advances and proves nothing about the tiebreak. Deleting it would have left the run identically green | A directory with duplicate display names spanning a page boundary. Only the shuffle unit test can see it today |

**Two things I checked and found already proven, so they are not on this list:** the pending
`MediaStore` resume across process death (measured at Phase 5 Slice 9, pid 2766 → 6191, 12,058,624 +
11,941,420 = 24,000,000 exactly — a stale comment in `desktop/src/main/main.ts:1498` still calls it
*"carried as unproven"*), and the phone's clipboard auto-apply, which Slice 13 closed with
*"Nothing in Phase 5's clipboard work is unproven on hardware now."*

---

## 4 · Every design-departures row still open

`docs/design-departures.md` carries **88 distinct row ids**. **Eighteen** are tagged `unbuilt`
(seventeen plain, plus **X9** as *unbuilt, needs one sentence from the designer*); **eight** are
walls that will never be built; the rest are `reshaped`, `shipped` or `—`. Counted by parsing the
status column, not by hand.

**The `Not yet` tag is a shipping UI string, not a document status.** Seven rows draw it in the app
— `Sound from phone` and `Keep screen on` in Mirror → Advanced (`renderer.ts:934`), and `Interface
sounds`, `Automatic updates`, `Per-app filters`, `Quiet hours`, `Convert HEIC to JPEG` in Settings.
Two more draw **Not possible**, which is the deliberate opposite.

### All eighteen `unbuilt` rows, with what each would take

| Row | What the design draws | What it would take | Blocked on |
|---|---|---|---|
| **N1** | A **Muted** filter with a designed empty state | A `muted: boolean` on `notif.posted`, or a `notif.muted` list. *The phone knows; it just does not say* | **Wire change** |
| **N2** | An **UNREAD** pill on the notification detail card | A read/unread field. **Android does not model this either**, so it would have to be a Mac-side notion of *"seen in this pane"* | A product decision, then Mac code |
| **M4** | Tool rail **Record** | Nothing on the wire — Mac-side from the canvas stream, same mechanism as Capture which shipped | **Nothing. Buildable today** |
| **M5** | Mirror tool rail **Transfer** | **Nothing — this row is stale.** `docs/phase-7-state.md` §2 records it *built 2026-09-04* as a third rail slot routing to Files. The departures row was never updated. See §8.5 |
| **M7** | Advanced **Sound from phone** | An audio channel in the protocol plus phone-side `AudioPlaybackCapture`. Not a wall (call audio separately is). Note apps can opt out, so it ships as *"sound from most apps"* | **Wire change + phone code** |
| **M9** | Advanced **Keep screen on** | A `mirror.start` field, or holding a wake lock unconditionally while mirroring — *"arguably the right behaviour anyway"* | **Nothing, if the unconditional answer is accepted** |
| **M13** | Tap and swipe on the mirror canvas | **The substantive one.** A shared input seam: the coordinate mapping and the drag/stale rules lifted out of `mirror.ts` into `src/renderer/` or `src/shared/` with its own tests, then both views feed one queue. A second copy is the copy that does not get the next fix, and for input that means a stroke landing on the wrong app — which defect 20 already cost | **Nothing but the refactor.** Named as the follow-up; not a wall and not a wire gap |
| **S4** | A battery percentage on the device card, connected strip and Overview hero | *Superseded in part.* `battery.state` is specified and handled as of Slice 24 and the Overview ring is real; the **three DOM slots in the card/strip/hero are still `hidden`**. `phase-7-state.md` says *"do not fix this"* on the strength of the old debt list, and that instruction is now stale for battery and still correct for `net.state` | A decision about the strip, not a wire change |
| **S7** | Eleven sidebar rows, all live | *Almost discharged.* Of the five that drew "Not built yet", **four are built** — Files, Photos, Clipboard, Activity. **Camera is the only one left** | §5 — the Developer ID |
| **S8** | No pairing / first-run screen anywhere | **A designed pairing screen.** The build has a route with no sidebar row and a placeholder QR card; `design-departures.md` carries a full proposal in the handoff's language. *"Still the most useful hour a designer could spend on this app"* | **The designer** |
| **G3** | Settings → General → **Interface sounds** | Nothing to build — there are no transfer or alert sounds, and the one sound switch lives on Notifications where it belongs. Drawn as **Not yet** with the reason | Nothing. It is a stated cut |
| **G4** | Settings → General → **Automatic updates** | There is no update server and no account. Sibling of X2 | Nothing. A stated cut |
| **G7** | Settings → Notifications → **Per-app filters** and **Quiet hours** | Per-app needs a wire rule (a Mac-only list is a filter the phone keeps sending through); Quiet hours would silently disagree with macOS's own | **Wire change** for the first; the second is refused on principle |
| **T1** | Settings → File transfer → **Save downloads to**, configurable | A picker, a persisted path, a security-scoped reference, and an answer for a folder renamed / unmounted / absent **with a transfer in flight**. *"A day's work with a real failure surface, not a checkbox."* The path has **one** home now (`main/downloads.ts`); a third copy on a settings screen is the one that goes stale | Mac code, and a decision that it is worth a day |
| **T2** | Settings → File transfer → **Convert HEIC to JPEG** | Decoding every image on this Mac and handing back a file that is not the one on the phone. *"A decision, not a missing checkbox"* | Nothing. A stated cut |
| **C2** | **Mute** and **Speaker** on the live-call card | Two new messages and an **`InCallService`** — a role the user grants, not a permission. The build draws one line instead: *"Mute, speaker and keypad tones are on the phone. Nothing on the wire carries them."* | **The designer** — see the open questions below |
| **C3** | **Keypad as an in-call control** (DTMF) | A `call.dtmf` verb. The keypad exists and dials *before* a call; it cannot send a tone into one, and the pane says so rather than hiding it | **The designer**, same question |
| **X9** | Overview **Quick actions: 8 tiles**, header `8 available` | **One sentence from the designer:** does *Quick actions* mean *the eight screens* or *the things you do most*? Under the first, nothing changes. Under the second, the media remote belongs there and the header needs rewording | **The designer** |

### The rows that are open questions rather than work

| | The question | Who answers it |
|---|---|---|
| **P3 / P5 (pairing)** | P5's countdown — `armPairing` already holds `expiresAt` and the renderer is simply not told. *No wire change* | Mac code, ~an hour |
| **N4 · P5 · F7 · A2** | Four panes have each invented their own *unavailable / partial / failed / empty* vocabulary. **A fifth will invent a fifth** — Calls already did, making it five in practice | **The designer.** `docs/phase-7-state.md` calls it *"the single most useful hour available"*, and it is the same ask three separate documents make |
| **Latency threshold** | The Overview latency figure is drawn neutral, deliberately, because the handoff assigns `#32E58A` **no threshold** and the prototype holds a single value. *"What figure does it stop at, and is there an amber band before red?"* | **The designer** |
| **C2 / C3** | Mute + Speaker, and DTMF, on the live-call card. Both need an **`InCallService`** — a role the user grants — plus two new messages / a `call.dtmf` verb | **The designer first** — *is a Mute you press on a Mac you cannot hear through worth the role prompt?* |
| **Settings third column** | With Security and the account block cut by X2 and Mirror living in its own pane, the design's eight panes reduce to six. *"Is a 320px third column still worth drawing?"* | **The designer** |
| **Messages third column** | Shared media, Mute notifications, Block contact — all four removed, each for a stated wire reason. `BlockedNumberContract` is restricted to the default dialer or SMS app | Answered and closed; recorded so nobody reopens it |

### Eight walls — recorded so they are not mistaken for work

**F1, F2, F3** (no path-based view of shared storage; the storage root and `Download` are ungrantable),
**M1, M2, M6, M8** (FLAG_SECURE black frames; MediaProjection consent uncacheable; no call audio; no
`KeyEvent` injection), **C1** (call audio). Two of these are drawn in Settings → Advanced as
**Not possible** — *Show touches* and *Phone screen off* — which is the deliberate distinction from
**Not yet**.

---

## 5 · Everything gated on the $99/yr Apple Developer Programme

**One purchase. Here is the exact set it unblocks.** Everything below is Mac-side; the source for
each is `docs/phase-9-distribution-audit.md` unless another file is named.

| # | What is blocked today | What the Developer ID changes | Free once a member? |
|---|---|---|---|
| **D12** | The `.dmg`'s app is **ad-hoc signed**. `spctl -a -t exec` → **`rejected` (rc=3)**, in both quarantine states, with Calculator `accepted / Apple System` and Chrome `accepted / Notarized Developer ID` as controls in the same run. A stranger gets *"unverified developer"* and must go to **System Settings → Privacy & Security → Open Anyway** (right-click → Open is long gone on macOS 26) | A **Developer ID Application** certificate is issued to members only — free Apple IDs get development-only certs Gatekeeper refuses for distribution. Then `notarytool submit --wait` + `stapler staple`, and the dialog goes away entirely | **Notarization is free once a member.** Hardened runtime is already on |
| **D14** | Fixed with `com.apple.security.cs.disable-library-validation`, $0 and no account — the packaged app could not launch at all before it (`dyld: … different Team IDs`, `TeamIdentifier=not set` on both app and framework) | **The entitlement should be deleted in the same change that fills in `identity:`.** With a real Developer ID every nested component shares one Team ID and library validation passes on its own. It is documented in `build/entitlements.mac.plist` as load-bearing *only while ad-hoc* | Yes — it is a deletion |
| **D15** | **A rebuilt packaged app cannot start unattended.** `safeStorage` decryption blocks on a Keychain dialog *ahead of the first paint*; measured 4m40s of nothing, `SecurityAgent` spawned in the same second, port 9222 bound, no window. Partly fixed 2026-09-04 by moving `createWindow()` ahead of `loadIdentity()`, so the dialog now appears over a visible window — **the unattended cost is unchanged.** Every unattended screenshot or probe run against the packaged build is impossible | A keychain ACL matches on the **designated requirement**, and an ad-hoc DR is pinned to the **cdhash**, which every rebuild changes. *Always Allow* is a per-build reprieve worth nothing across a rebuild. **A stable DR is a Developer ID, and nothing else ends this** | Yes |
| **Defect 81** | Native notifications are **refused in the dev build** — macOS never registered it as a notification client, so there is no *Electron* row in System Settings → Notifications to switch on. The copy is chosen by `refusalCopy({ packaged })` and a dev run is told the mechanism and given **no instruction, because there is no action** | A packaged, properly signed build registers. The packaged build already posts with **0 refusals against a control of 3 in the same file** — so this is really *"the dev workflow is second-class"* rather than a user-facing gap | Yes |
| **Camera** — the phone as a Mac webcam | A **macOS Camera Extension** is a *system* extension. It requires the `com.apple.developer.system-extension.install` entitlement and a Developer ID; ad-hoc will not load one | Unblocks the *distribution* half. **The code half is still entirely unstarted** — no `camera.*` in `docs/protocol.md` (`grep -c` → 0), no camera member in `Capabilities.kt`, `unbuiltHandle: 'no namespace proposed yet'` | The entitlement is; the work is not |
| **D3** | The `.dmg` has never been installed from `/Applications` after a **real download with quarantine set** — the only two mechanisms that treat a downloaded file differently from a local one. Reopened deliberately for exactly this | Notarization removes the question rather than answering it | Yes |

**Not in this group, despite being adjacent:**

- **D13** — the Android release APK. **Nothing to do with Apple.** It is a Google Play / Android
  signing matter, it is *already signed* (RSA 4096, v3 + a v4 `.idsig`), and it **installed on
  hardware on 2026-09-02** — see §8.1, where the audit row is stale.
- **D4** — no application icon. `electron-builder` says so itself: *"default Electron icon is
  used  reason=application icon is not set"*, and the only `.icns` in the tree is Electron's own
  `electron.icns` inside the built bundle. **This is a design asset, not money** — there is none to
  install.
- **The Play position** (`docs/permissions.md`). `SEND_SMS`, `READ_SMS`, `RECEIVE_SMS` and
  `READ_CALL_LOG` are Play **restricted permissions**. A companion-app declaration with a demo video
  is required per submission. That is Google's $25 one-off console fee plus a review, not Apple's
  $99, and it is *"the single most likely reason a build of this app is rejected."*

**So the $99 buys: a Gatekeeper `accepted` verdict, notarization, the deletion of one entitlement, an
end to the per-launch Keychain dialog, native notifications in dev builds, and the door to Camera.**
Five of those six are workflow and distribution; only Camera is a feature.

---

## 6 · Everything that needs a second device

**A second device now exists and is not ours.** A moto g34 5G (`ZA222JT75K`, Android 15 / SDK 35,
near-stock, Qualcomm) was read on 2026-09-05 — `docs/second-device-moto-g34.md`. **It belongs to
someone else who was using it during the run**, which cost one reading and produced a doze-whitelist
entry nobody asked for. Read §5 of `docs/RESUME.md` before planning another session on it.

### Settled by the moto, so no longer in this group

Nine predictions confirmed: the whole SAF block (storage root refused, `Download` refused, folders
inside it grantable, no vendor overlay on DocumentsUI) across **two DocumentsUI versions, 16 and
17**; no full clone user, which retires the Samsung-only `DUAL_APP` control and settles audit §6.3;
and package visibility **109/109 with the `<queries>` block, 3/109 without** — the R3 control the
Samsung run never had. One prediction was **contradicted**: a bad `EXTRA_INITIAL_URI` aim does *not*
degrade to the parent here, it lands in `DCIM`. It changes no product decision.

### Still needs a second device — and what kind

| # | What | Why one handset cannot answer it | What kind of device |
|---|---|---|---|
| **U1** | **Whether any Phase 6 fix is a fix or a One UI workaround** | *The load-bearing one.* Every claimable Phase 6 behaviour is one vendor's. Two skins agreeing makes a behaviour general; disagreeing names the vendor. `CLAUDE.md`: *"never quote the first list without the second."* The moto could answer this — **it has not been left running overnight** | A device nobody is holding, for a night |
| **Separating Samsung's battery manager from AOSP's Doze** | Two mechanisms act on the same process simultaneously; every observation is their sum | **A Pixel.** A second *skinned* device gives two sums, not a decomposition — explicitly reasoned in `phase-6-brief.md` §3 |
| **U2** | **The unexempt *and* neglected case** | H1 removed the exemption but the bucket stayed `ACTIVE`; the harsh restrictions live in `RARE`/`RESTRICTED`. `am set-standby-bucket … 5` is refused and P6 is withdrawn, so nothing can put a daily driver back | Any device that can be left unused for days |
| **U7 / defect 17** | **The Mac holds one phone and refuses the second** | Two phones on the bus at once, both paired | **Two phones.** `scripts/target-device.sh` now knows two and refuses ambiguity, so the harness is ready |
| **P6 / defect 50** | Does `content://mms-sms/conversations` answer a **bound** `date < ?` with an empty cursor, or is that Samsung's `SecTelephonyProvider`? | The moto carries **stock `TelephonyProvider`** — which is the provenance audit §6.2 asked for — but **provenance is not behaviour**. Taking the reading means `READ_SMS` and paging a third party's real message threads. Not authorised, not proportionate | **A device we own.** Stays `unknown, single-device` until then. This is the largest single `unknown` left |
| **P13 / defect 55** | `fs.list` per-page cost on a large directory | Needs a persisted grant on a ~16k-entry directory, which here is the owner's `DCIM` | A device we own with a big photo library. **The number was never portable**; the *fix* is |
| **P8** | Standby bucket after first launch | Confounded — a third party granted a doze exemption mid-run | A device nobody else is holding |
| **P9** | Whether Motorola's **BatteryCare** kills a backgrounded service | It exists (`v2.0.0.127`, holds `WRITE_SECURE_SETTINGS`) but **zero packages device-wide** are restricted through `RUN_ANY_IN_BACKGROUND`, so it does not enforce through the AOSP op. Whether it enforces by another route is unmeasured | The overnight run, on the moto |
| **The frame-cap refusal path** | Needs a peer built to violate a rule our own writer refuses to break | **Not a phone — a hostile client.** §3 row 11 |
| **U3** | Samsung Device Care's *Sleeping apps* / *Deep sleeping apps* | Not readable from `adb`; the state is in `com.samsung.android.sm`'s private storage. Asked for on 2026-09-03 and **never answered** | **Your eyes on the Samsung's screen** — not a second device at all |

**The recommendation the brief already made, unchanged and now better evidenced:** an **AOSP
emulator** is a free, disposable control for standby buckets, Doze transitions, the boot receiver,
package visibility, and — the one with an expiry date nobody controls — **DocumentsUI's folder
refusal**. It cannot answer real battery draw, Device Care, telephony through a real provider,
MediaProjection throughput, or anything about a vendor skin.

---

## 7 · Every empty and failure state drawn across all panes

**This enumeration exists.** It is `docs/empty-and-failure-states.md`, written 2026-09-04, revised
and re-verified against the source on 2026-09-05, and guarded at commit time by
`scripts/check-state-vocabulary.mjs` — which I ran this sitting: **84 states across 19 panes, in 8
groups, every printed number matching the table it is drawn from.** I spot-checked eight of the
strings back to source with `grep -rF`; all eight are present exactly as quoted.

It is reproduced in full below so this document answers the question rather than pointing at
another one. **Grouped by what the sentences mean, not by pane, because the question is how many
different sentences say the same thing.**

**Two things it does not cover, and the second is the larger gap** — both stated in the source
document's own "What was excluded" section:

1. **Settings row descriptions and standing wall copy.** Explanatory copy for a control, and copy
   that is always present rather than produced by a condition — the clipboard's Android paragraph,
   the Files `Download` wall, the Calls audio wall. They carry the same vocabulary and would triple
   the list without being states.
2. **The phone's own sentences.** `reason` and `fixHint` arrive over the wire and are drawn
   verbatim on the Mac, and **they are a second vocabulary nothing has ever enumerated.** Counted
   this sitting across `*/src/main`: **54 distinct `reason` literals and 40 distinct `fixHint`
   literals — 94 sentences** written to a different set of conventions, appearing on the same
   screens as the 84 below. If the designer's hour is about making one vocabulary, this is half the
   corpus and it is invisible from the Mac's source.

### 1 · "There is nothing here" — 28 sentences for one idea

| Pane | Condition | Verbatim |
|---|---|---|
| Activity | `summary.total === 0` | Nothing yet today. The table below covers everything on record. |
| Activity (shared) | `fetch.events.length === 0` | Nothing has happened yet |
| Apps | `apps.length === 0`, searched | Nothing matches that |
| Apps | `apps.length === 0`, unsearched | The phone listed no apps |
| Calls | `log.length === 0` | There are no calls in the phone’s log. |
| Calls | `rows.length === 0` (stats) | Nothing in the log to count yet. |
| Calls | contact has no numbers | No number on this contact |
| Calls | `state !== 'active'` | No call in progress |
| Clipboard | `entries.length === 0` | Nothing yet. Copy something on either machine. |
| Clipboard | tab `phone`, `rows.length === 0` | Nothing from the phone yet. Open ConnectSuite on it after copying — that is the only moment Android lets it look. |
| Clipboard | tab `mac`, `rows.length === 0` | Nothing copied on this Mac yet. |
| Clipboard | `kind === 'empty'` | The phone’s clipboard was empty. |
| Clipboard | `kind === 'empty'` (row) | Nothing to copy |
| Clipboard | clear pressed, list empty | There is nothing in the list to clear. |
| Contacts | `contacts.length === 0` | The phone’s contact book is empty. |
| Contacts | no numbers and no emails | This contact has no number and no email address. |
| Files | no granted roots | This phone hasn’t shared a folder yet |
| Mirror | `framesDecoded === 0` | There is no picture to capture yet. |
| Mirror | `framesDecoded === 0` (input) | Nothing is being mirrored yet, so there is nothing to click on. |
| Float | `framesPainted() === 0` | There is no picture to save yet. |
| Notifications | `visible.length === 0` | Nothing on the phone’s notification shade right now. |
| Notifications | `visible.length === 0` (title) | The shade is empty |
| Notifications | no selection | Nothing to inspect yet. |
| Notifications | no selection in filter | Nothing to inspect in this filter. |
| Overview | `events.length === 0` | Nothing yet. Transfers, calls and clipboard syncs appear here as they happen. |
| Photos | `items.length === 0` | Nothing in this album |
| Remote | `!state.active` | Nothing is playing on the phone. |
| SMS | `threads.length === 0` | There are no conversations on the phone. |

**Four different openings for the same state:** *Nothing yet…* · *There are no…* · *The phone listed
no…* · *…is empty*. Two panes use a heading plus a sentence (Notifications, Apps); the rest use one
or the other.

---

### 2 · "It failed" — 19 sentences

| Pane | Condition | Verbatim |
|---|---|---|
| Apps | `!result.ok` on launch | The phone did not answer. |
| Apps | `this.failure` set | The phone is not sharing its apps |
| Calls | `!result.ok` on `callLog` | The call log could not be read. |
| Calls | `!result.ok` on `callDial` | The call was not placed. |
| Calls | `!result.ok`, generic | That did not work. |
| Contacts | `!result.ok` | The contacts could not be read. |
| Files | `listFailure` set | Couldn’t open this folder |
| Files (shared) | `kind === 'failed'` | Couldn’t read the phone’s folders |
| Activity (shared) | `kind === 'failed'` | The activity log could not be read |
| Overview | activity fetch failed | The activity log could not be read. |
| Mirror | no 2D context | This Mac could not open a 2D canvas to draw the phone screen on. |
| Photos | transfer failed | The transfer did not finish. |
| SMS | `!result.ok` on threads | The conversations could not be read. |
| SMS | `!result.ok` on messages | That conversation could not be read. |
| SMS | `!result.ok` on older page | Older messages could not be read. |
| SMS | `!result.ok` on send | The message was not sent. |
| Notifications | `!result.ok` on reply | The reply was not sent. |
| Transfers (shared) | checksum mismatch | ConnectSuite transfer failed — checksum mismatch |
| Link (shared) | unknown socket error | The connection to your phone failed. See the log for details. |

**Three different verbs for one thing:** *could not be read* (6 uses) · *did not / was not* (6 uses)
· *Couldn’t* (2 uses, and the only contractions in the set). **Overview and shared/activity draw the
same sentence with and without a full stop** — one of them is wrong and nothing says which.

---

### 3 · "The phone is not offering this" — 8 sentences

| Pane | Condition | Verbatim |
|---|---|---|
| Apps | `!advertised` (title) | Your phone cannot show the request |
| Apps | `!advertised` (body) | The phone is not offering the apps feature right now. |
| Clipboard (shared) | `!facts.advertised` (title) | Your phone is not offering its clipboard |
| Clipboard (shared) | `!facts.advertised` (body) | The phone is connected but is not advertising the clipboard feature right now. |
| Files | `!advertised` | This phone is not offering the Files feature right now. |
| Files (shared) | `kind === 'unavailable'` | This phone isn’t offering Files right now |
| Photos | `failure` set | The phone is not sharing its photos |
| Files | `degraded` banner | Copying to the Mac works. Sending files to this phone does not — it is not offering that channel. |

**`files` says it two ways in one pane** — `This phone is not offering the Files feature right now.`
and `This phone isn’t offering Files right now` — differing in contraction, article and full stop.
**`offering` (5) vs `sharing` (2) vs `advertising` (1)** for one condition.

---

### 4 · "Not connected" — 9 sentences

| Pane | Condition | Verbatim |
|---|---|---|
| Clipboard (shared) | `!facts.connected` (title) | Not connected to your phone |
| Clipboard (shared) | `!facts.connected` (body) | Nothing can arrive from the phone until the link is back. This is not the Android clipboard limit — it is the connection. |
| Overview | `!connected` | Not connected. Nothing is being sent anywhere. |
| Float | `!connected` | The link to the phone dropped, so there is nothing to show. |
| Shell | route blocked, unpaired | Pair a phone first — there is nothing to show until you do. |
| Shell | `health === 'repudiated'` | No phone paired |
| Renderer | `handshaking` / `reconnecting` | Not paired yet |
| Link (shared) | connection refused | Could not reach your phone. Check that both are on the same Wi-Fi and that ConnectSuite is open on it. |
| Link (shared) | `repudiated` | Your phone no longer recognises this Mac. Open ConnectSuite on the phone and scan a new code. |

**`No phone paired` and `Not paired yet` are two states or one, and the copy does not say which.**

---

### 5 · "Waiting / not yet" — 5 sentences

| Pane | Condition | Verbatim |
|---|---|---|
| Device status (shared) | `state === null` | Waiting for the phone to report |
| Device status (shared) | `capacityUnknown` | This phone does not report its level |
| Device status (shared) | storage null | This phone did not report its storage |
| Float | awaiting keyframe | Waiting for the phone’s next keyframe… |
| Mirror | `awaitingFreshFrame` | The phone just turned — waiting for the new picture before sending that. |

---

### 6 · "This build / this Mac cannot" — 8 sentences

| Pane | Condition | Verbatim |
|---|---|---|
| Notifications (shared) | dev build refusal | Notifications cannot work in this development build |
| Notifications | filter has no match | Not in this build |
| Notifications | mute list | Muted apps are not mirrored |
| Notifications | mute list (body) | The phone does not tell the Mac which apps are muted, so this list cannot be built here. |
| Overview | `screen.state !== 'built'` | Not built yet |
| Nav model | camera | There is no virtual camera on this Mac |
| Calls | live card, `!appCall` | Mute, speaker and keypad tones are on the phone. Nothing on the wire carries them. |
| Calls | live card, `appCall` — **replaces** the row above | WhatsApp is hosting this call, not the phone network. Mute, speaker and keypad tones are on the phone, and whether Answer and Reject reach an in-app call is not measured — if nothing happens, answer on the phone. |

---

### 7 · Input refusals — Mirror only, 5 sentences, and nothing else in the app does this

| Condition | Verbatim |
|---|---|
| `!inputAdvertised` | This phone is not accepting taps or typing yet. |
| no screen shape yet | The phone has not said what shape its screen is yet, so that was not sent. |
| rotated mid-press | The phone turned while you were pressing, so that was not sent. |
| mirror stopped mid-press | The mirror stopped while you were pressing, so that was not sent. |
| rotation pending | The phone just turned — waiting for the new picture before sending that. |

**Mirror is the only pane that explains a refusal in terms of what the user was doing.** Every other
pane states a fact about the system. It is also the only one that says *"so that was not sent"* —
naming the consequence — which nothing else does.

---

### 8 · Empty-input guards — 2 sentences, same shape, different words

| Pane | Condition | Verbatim |
|---|---|---|
| Notifications | `text.length === 0` | An empty reply was not sent. |
| SMS | `body.length === 0` | An empty message was not sent. |

The only pair in the whole set that is already consistent.

---

### The count that answers the question

**Eight ideas, 84 sentences, 19 panes.** The largest group is *"there is nothing here"* at 28 uses
with **four** distinct grammatical openings; failures use **three** different verbs; unavailability
uses **three** different words for one predicate. Two panes state one condition two ways within
themselves (Files, Apps), and one sentence appears twice with different punctuation (the activity
log). **Calls is the fifth pane to invent its own vocabulary**, after Notifications (N4), Photos
(P5), Files (F7) and Activity (A2).

**And the container problem, which is the designer's second decision:** the panes use **seven
different container conventions** for what is visually one thing — `.card`, `.side-card`, `.pane-*`,
`.clip-panel`, `.files-panel`, `.calls-log-panel`, `.files-rail-title`. A vocabulary decision that
says *"the empty state goes in the card header"* has seven places to land.

---

## 8 · Where the repo currently disagrees with itself

Reported because you asked for evidence rather than recall, and because `docs/RESUME.md` has been
wrong about its own state twice. **None of these is a defect in the product.** Each is a document
that a reader would act on.

### 8.1 · D13 is recorded **open** and the evidence says it is closed

`docs/phase-9-distribution-audit.md` D13 reads: *"**Still open**, because the point of the row is an
install that works: the APK has never been installed on the SM-S938B."*

`docs/testing.md` → **Phase 9 Slice 3, 2026-09-02**, is titled *"the signed APK installs"* and
carries the install, the pin's `OK target RZCY12330DT (SM-S938B, sdk 36)`, `Success` in 790 ms, both
packages in `pm list packages`, `apkSigningVersion=4`, and a walked five-page first run. The
artifact is on disk (`app-release.apk`, 26.6 MB, with its `.idsig`). **The row is stale in the
pessimistic direction** — the audit was not updated when the slice landed.

### 8.2 · Ten defects are labelled `fixed` whose own text says they were proven on hardware

The register defines **fixed** as *"code changed, not yet proven on hardware"* and **closed** as
*"fixed and verified on hardware."* By that definition **57, 69, 77, 78, 79, 81, 82, 87, 94, 95**
should read `closed` — each carries its hardware or measurement evidence in the same row (57: a
corrupt JPEG in `Download/ConnectSuite`; 78: *"549 became 64"* on the 11:53 boot; 79: both directions
with the permission flipped and restored; 82: `LAUNCHED` after, refused before; 87: three
instruments agreeing on `1752, 95, 1440, 920`).

`scripts/check-defects.sh` guards **existence, not status wording**, and `CLAUDE.md` says so
deliberately — *"the statuses are prose, and a checker that forced them into four buckets would
either reject honest rows or quietly accept wrong ones."* That reasoning is sound and I am not
proposing a checker. **The consequence to know is that the register cannot be counted by status**:
the honest open count is **four** (17, 30-half, 38, 89) plus **three** genuinely-unproven fixes
(33, 80's start half, 84's cooldown), not the fourteen a `grep -c fixed` returns.

### 8.3 · `phase-5-closeout.md` names a defect where it means a step

Its unproven-table row 5 reads *"**Defect 33** (Phase 3, carried) — `InputFailure.PhoneLocked`."*
That is **step 33**. **Defect 33** is *"the phone names packages where it means apps"*, and the same
document's own "Deferred and open, by number" table gets it right two sections later. Two different
numbering spaces, one label.

### 8.4 · `empty-and-failure-states.md` quotes a sweep number defect 95 explicitly supersedes

Its below-the-fold section reads **"23 blocks: 21 visible at rest, 2 reachable by scrolling, 0
stranded."** Defect 95's row says in terms: *"**Two published numbers are superseded**, Slice 29's
*21 visible / 2 reachable* and Slice 30's *20 / 3*"* — because `__probe.onScreen` was measuring
against the viewport rather than the scroll port that clips. The corrected sweep in that row reads
**21 cards, 12 visible, 9 reachable, 0 stranded**; Slice 32's reads **23 / 15 / 8 / 0**.

`docs/empty-and-failure-states.md` was last written at `HEAD` (`9589892`), **after** defect 95
landed (`d16022a`), and still carries the superseded pair. `check-state-vocabulary.mjs` verifies the
group tables against their own headings and **has no opinion about this block** — which is exactly
the shape `CLAUDE.md` predicts. **`0 stranded` is the only figure that survives all three runs.** A
fresh `scripts/card-visibility-sweep.mjs` against the running app is the fix, and it was not run
this sitting.

### 8.5 · `docs/phase-7-state.md` is three weeks of work out of date

Written 2026-09-03. Since then Slices 11–35 landed. Read against the build today:

| It says | Measured now |
|---|---|
| §4 item 1: *"`pair.rejected` on the Mac. One handler."* | **Built** — Slice 12, with `PairRejectReason` copy keyed on `reason` and a fresh code armed in the same beat |
| §5.2: *"`Notification` among electron's named imports → **false**"*, and the whole death-spiral argument | **Stale.** `desktop/src/main/nativeNotifier.ts:228` is `new Notification({...})`. Native notifications, dock badge, sound and click-to-pane all shipped in Slices 11–13 and 16, with defects 81–84 fixed on top |
| §1: Calls, Clipboard, Settings, Overview *"half-built"*; Messages *"structurally different"* | All five have had their design pass — Slices 15, 27–33. Messages is `280 / 539 / 300` now, matching the canvas |
| §4 item 3: *"Settings → General / Notifications / File transfer"* | **Built** — six panes, Slice 29 |
| §4 item 3: *"Deep links for Restore and trust"* | **Still true.** `DEEP_LINKS` holds exactly two entries, `deep.remote` and `deep.contacts`. Restore, `displaced`, `history`, `forget`, `trust`, `unpair` and `pair` all return `[]` from the palette |
| §2: *"S4 / S5 — still correct, do not fix this"* | **Half stale.** `battery.state` is specified and handled since Slice 24 and the Overview ring is real; only `net.state` remains on the debt list. The three battery DOM slots are still `hidden` |

`docs/design-departures.md` has the same problem in one row: **M5 is tagged `unbuilt`** while
`phase-7-state.md` §2 records it built 2026-09-04, and its **Messages structural row** still reads
`grid(815px 320px)` against a pane that is now three columns.

**Neither file is wrong about anything it measured.** They are both snapshots, and nothing in the
build can compare two prose claims — which is the failure `docs/phase-5-closeout.md`'s own banner is
about.

### 8.6 · A Kotlin test file that no Gradle module owns, and has never run

```
desktop/core/src/test/java/com/chetan/connectsuite/core/ScreenGeometryRegistryTest.kt
```

Tracked in git since `6445fdd`. `settings.gradle.kts` includes `:app :core :sync-module
:mirror-module :input-module` — **`desktop/core` is not a module**, so this file has never been
compiled, let alone run. The class it tests is real and load-bearing: `ScreenGeometryRegistry` in
`core/.../screen/ScreenGeometry.kt`, used by `MirrorEngine` and `InputFeature` — **the stamp that
stops a tap landing in the wrong place**, which is defects 19 and 20's entire subject. Its own KDoc
says so. `core/src/test/.../core/` holds ten test files and **not this one**.

This is `CLAUDE.md`'s defect-65 lesson one level worse: not a module with no test source set, but a
test in **no module at all**. `find . -type d -name test` returns it, which is how it was found; no
count in this repo has ever included it, and nothing would have noticed.

**What I do not know:** whether the file is a stray copy of something that was moved, or the only
copy. No `ScreenGeometryRegistryTest` exists under `core/`, so on the evidence it is the only copy.

### 8.7 · Smaller drifts, listed so they are not rediscovered

- **`CLAUDE.md` says `scripts/check-renderer-scripts.mjs` is "the eighth commit hook."** There are
  **nine** `git commit` hooks in `.claude/settings.json` (plus `no-force-stop` on `adb`), and
  `docs/RESUME.md` says *"all eight commit guards pass."* All nine pass; I ran them.
- **`CLAUDE.md`'s Phase 4 banner still reads "17, 33 and 38 stay deferred."** 33 was fixed
  2026-09-03.
- **`desktop/src/main/main.ts:1498`** still describes the pending-`MediaStore`-resume-across-process-
  death claim as *"carried as unproven"*. It was measured at Phase 5 Slice 9 and
  `DownloadsStore.kt:194` says so.
- **`app/src/debug/.../ClipProbeActivity.kt:27`** still reads *"has never been observed on this
  handset"* about the background-clipboard wall. Slice 11 observed it, 90/90 and 60/60. Both are
  pre-run KDoc that outlived their run; neither is a work item.
- **`docs/status.md`** is stale by its own banner since 2026-08-27 and should not be read as an
  inventory. Its headline claim — *"`LinkServer.register` is never called anywhere"* — is false.
- **`AppsProbeActivity`'s hardcoded ground truth** prints `244 launcher-resolvable, 615 installed`
  from the SM-S938B; on the moto the real figures are 109 and 474, so its banner is wrong by 2.2×
  and reads as a catastrophic visibility gap. **Left unpatched deliberately** — changing an
  instrument between the halves of an A/B is how it stops being one. Patch it *after* the A/B is
  finished, not before.

---

## 9 · The recommendation — one thing

**Commit the working tree, then spend the next sitting on the four hardware readings that need a
phone in your hand, in one run: defect 33's sentence, defect 30's no-thread send, F6/P3's pairing
sighting, and `pair.rejected`'s wire half.**

The reason is that this project's remaining work is not evenly shaped. Everything in §4 and §5 is
blocked on somebody else — a designer's hour, Apple's $99 — and everything in §6 is blocked on a
phone nobody is holding. But §3 is twelve items that are **already built, already tested, and
unproven only because nobody has stood in front of the device and produced the stimulus**, and four
of them share one setup: an unpaired phone with the Mac's pairing screen open. Forgetting the phone
is the expensive part of that run, and it is the same expensive part for F6/P3 and for
`pair.rejected` — so doing them separately costs it twice. Defects 33 and 30 need the same handset in
the same sitting and nothing else. Two of the four are on the **first screen a stranger ever sees**,
where the current failure mode is an indefinite silent wait, which is the shape this repo rules out
everywhere else. And the uncommitted tree is the precondition rather than a chore: the two-device pin
with its 17 fixtures is exactly what makes a run like this safe, and it is sitting untracked on a
machine that has already nearly issued a signed build at a stranger's OPPO.

**What I would cut, and cut now rather than carry:** the Mirror unbuilt rows — **M4 Record, M7 Sound
from phone, M9 Keep screen on** — and **N1, N2, T1, T2, G3, G4, G7**. Nine departure rows that are
each either a stated design cut already argued in the document, or a new feature wearing a design
row's clothes. They inflate every count in this file and none of them is the reason anyone would stop
using the app. **Camera should be cut from the roadmap conversation entirely until the $99 is spent**
— it has no protocol namespace, no capability, no phone-side design and no phase, and calling it
"Phase 8" three times has already produced a phase number that does not exist. And I would stop
maintaining `docs/phase-7-state.md` and `docs/status.md` as live documents: §8.5 shows what a
three-week-old snapshot costs when someone reads it as current, and the fix is a banner, not an
update.
