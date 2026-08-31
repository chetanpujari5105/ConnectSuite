# Every hardware reading in this repo came from one phone — which of them hold anywhere?

**Read-only audit, 2026-09-01.** No code was changed and no state on the device was modified. The
device is the only one this project has ever run on:

```
model    SM-S938B          (Galaxy S25 Ultra)
release  Android 16        sdk 36
build    BP4A.251205.006.S938BXXSBCZG3
patch    2026-07-05
users    0 · 95 DUAL_APP · 150 Secure Folder
```

Everything in `docs/testing.md` was measured here. The pile is large enough now that untangling it
after a second device appears would be the expensive version of this work, so it is done first.

---

## 1. The verdicts, and why "unknown" is a result

| Verdict | Means |
|---|---|
| **contract** | Documented platform behaviour. **Not a single-device reading at all** — we confirmed it here, but the claim rests on the Android contract and would be a bug on any device that broke it |
| **AOSP / Mainline** | Measured here, and the code behind it is shipped by Google — an APEX module or a Play-updated app. Portable to any device **at that module version**, which is a different axis from the OS version |
| **vendor** | Samsung's code is behind it. Assume nothing about any other manufacturer |
| **unknown, single-device** | Cannot be told apart with one handset. **This is a correct answer** and it is used freely below |

**The failure this audit exists to prevent is confident portability**, which is the same shape as
every other lookalike in `CLAUDE.md`: a reading that is true, taken for a claim about "Android" when
it was a claim about *this build of this component on this phone*.

---

## 2. The method that made most of this answerable, and it costs one command

**Ask who ships the code behind the reading.** On a single device you cannot compare behaviour
across vendors, but you *can* ask which package implements the thing you measured, and where its APK
lives. That is a strong proxy and it is cheap:

```
$ adb shell pm list packages -f | grep <component>
```

The results reorganised this entire audit, and two of them were surprises:

| Behaviour we measured | Implemented by | Where its APK lives | So |
|---|---|---|---|
| The SAF **picker** — refusals, the disabled confirm button, the starting location | `com.google.android.documentsui` | **`/data/app/…`**, versionName **17**, `targetSdk 37`, last updated **2026-07-16** | **Google, Play-updated.** Not Samsung's, and **not tied to the OS version** — it can change under us from a Play update with no OS upgrade |
| `MediaStore` — the `Download/ConnectSuite` publish, `IS_PENDING`, the `.pending-…` name, `media.*` ordering | `com.google.android.providers.media.module` | **`/apex/com.android.mediaprovider/…`** | **Mainline APEX.** Google's, versioned by the module, portable at that version |
| The SAF tree provider — listings, display names, `fs.list` ordering and its cost | `com.android.externalstorage` | `/system/priv-app/ExternalStorageProvider/` | AOSP **name**, in a Samsung-built system image. No `Sec` prefix, but that is weak evidence |
| `mms-sms/conversations` and every `sms.*` read | `com.android.providers.telephony` | **`/system/priv-app/SecTelephonyProvider/SecTelephonyProvider.apk`** | **Samsung's build behind an AOSP package name.** This is the one that matters most — see 3.C |
| The call log | `com.samsung.android.providers.contacts` | Samsung, by name | **vendor** |
| Dialer / in-call | `com.samsung.android.dialer`, `com.samsung.android.incallui` | Samsung, by name | **vendor** |

**The `SecTelephonyProvider` line is the important one and it validates a rule this repo already
has.** `com.android.providers.telephony` *is* the AOSP package name, and on this phone it is
Samsung's APK. **A package name is not provenance.** That is defect 50's rule — *verify a mechanism
through the same client the product uses* — pointed one layer down: the identifier being AOSP does
not make the code AOSP, exactly as the shell issuing a query does not make it the app's query.

---

## 3. The findings

### A. Storage and SAF

| Finding | Where | Verdict | Reasoning |
|---|---|---|---|
| The **root of internal storage** cannot be granted; the picker lists it and disables `USE THIS FOLDER` | `docs/evidence/saf-probe-2026-08-31/saf1.xml`, `phase-5-fs-media-proposal.md` §1 | **AOSP / Mainline**, versioned by DocumentsUI | The refusal is DocumentsUI's, and DocumentsUI here is Google's Play-updated build. Very likely on any device with a Google DocumentsUI at a comparable version. **Not** guaranteed on a device that ships its own picker |
| **`Download` itself** cannot be granted; folders inside it can | `saf2.xml`, `saf3.xml` | **AOSP / Mainline**, same basis | Same component, same run, with `enabled="true"` controls |
| `Android/data` and `Android/obb` unreachable to every app | `CLAUDE.md` platform walls | **contract** | Android 11 platform restriction, not a picker behaviour |
| Scoped storage — no path view of shared storage at `targetSdk 36` | `phase-5-fs-media-proposal.md` §1 | **contract** | API 30+; `requestLegacyExternalStorage` is gone |
| **The picker's starting location is not stable between runs** — three opens restored `DCIM`, a fourth opened at the refused storage root | `docs/testing.md` → Slice 7, four timestamps | **unknown, single-device** | Location memory is undocumented. It is DocumentsUI's, so it is at least *Google's* undocumented behaviour rather than Samsung's, but whether the transition is caused by the released grant is **one observation and not established** |
| A `DocumentsProvider` does not guarantee unique display names; row order is not ours | `FsPathsTest`, `protocol.md` | **contract** | The SAF interface makes no ordering promise. The tiebreak is correct on any device |
| **Defect 55** — `fs.list` re-read and re-sorted the whole directory per page: 490 s over 16,377 entries, 21 s after the snapshot fix | `docs/testing.md`, defect 55 | **unknown, single-device — and the *number* is device-specific regardless** | The *cause* is contract (SAF honours neither sort nor limit, so the work is O(n) per page whatever the provider). The *cost* is this provider on this storage with this file count. Another device will have a different constant and the same shape. **The fix is portable; the 490 is not** |
| `fs.list` over a 16,377-entry directory, `tieBoundaries: 0` | `docs/testing.md` → Slice 5 | **not a platform fact at all** | A property of this user's filenames. It says the tiebreak was unexercised **here**, which is why it is published |
| A released `persistableUriPermission` **still appears** in `dumpsys activity permissions` at `persisted=0x0` until the owning process lets go | `docs/testing.md` → Slice 6 | **unknown, single-device** — and it is an *instrument* fact, not a product one | This is `ActivityManagerService` behaviour, i.e. framework, so likely AOSP; but it was read through `dumpsys` output whose format is not a contract. Nothing in the product depends on it |

### B. MediaStore and Downloads

| Finding | Where | Verdict | Reasoning |
|---|---|---|---|
| A 256 MB file lands in `Download/ConnectSuite` with **all four storage permissions `false`** | `docs/testing.md` → Slice 2 preliminaries | **contract**, confirmed here | `MediaStore.Downloads` + `RELATIVE_PATH` needs no permission for an app's own inserts. The permission dump is the control |
| The directory **did not exist** before the first publish and the insert created it | same | **AOSP / Mainline** | MediaProvider is the APEX module. Portable at that module version |
| A pending item is visible on disk as `.pending-<n>-<name>` | same | **AOSP / Mainline** | MediaProvider's naming. Undocumented, so portable to the module and **not** a contract — do not build on the exact name |
| The 256 MB publish took **263 ms** | same | **device-specific number**, mechanism portable | Storage speed. The *rule* it produced — a window between samples is a missing reading — is not device-specific at all |
| `media.list` on Camera: 16,369 items, 33 pages, **6 of 32 boundaries in a tie group** | `docs/testing.md` → Slice 2 | **not a platform fact** | A property of this camera roll. Published for exactly that reason |
| 149 `MediaStore` buckets, `Download` holding the newest item | Slice 2 | **not a platform fact** | This user's device |

### C. Telephony — the vendor-heaviest area

| Finding | Where | Verdict | Reasoning |
|---|---|---|---|
| **Defect 50** — `content://mms-sms/conversations` returns an **empty cursor** for a *bound* `date < ?` while honouring the same literal inlined by `adb shell content query` | defect 50, `docs/testing.md` | **vendor — and now with evidence beyond the package name** | The provider is `SecTelephonyProvider.apk`. The AOSP package name misled here in exactly the way §2 describes. **Assume this is Samsung's and that other vendors differ — including possibly not having the bug** |
| The fix — inlining a validated `Long` instead of binding | defect 50 | **portable and safe either way** | A literal works on any provider that honours selections at all; it is the bound form that is unreliable |
| **`SamsungCallLog.Loggable okayToLog:false`** for self-managed calls (defect 47's withdrawal) | defect 47, `docs/testing.md` | **vendor** by name and by package (`com.samsung.android.providers.contacts`) | The *concept* is contract — `SelfManagedConnection` calls are not written to the platform log by design — but the log line, and any behaviour keyed to it, is Samsung's |
| **Defect 45** — `EXTRA_INCOMING_NUMBER` arrives *after* the `PHONE_STATE` state callback | `docs/decision-45-inbound-caller-id.md` | **unknown, single-device**, and the doc already said so | The doc's own words: *"An OEM that delivers the extra earlier relative to the state callback would make option 4 work well."* Ordering between an extra and a callback is not specified anywhere. Option 4 is a correction path precisely because the ordering cannot be relied on |
| Outgoing calls carry no `EXTRA_INCOMING_NUMBER`; `PHONE_STATE` is system-only; `RECEIVER_NOT_EXPORTED` blocks synthetic broadcasts | `decision-45`, `CLAUDE.md` | **contract** | Platform-level |
| SMS send/observer paths, the after-send retry (defect 51) | `docs/testing.md` → step 71 | **unknown, single-device** | Same Samsung provider. The `dropped` over-report is our accounting and is ours everywhere; the delivery timing it mis-reports is the provider's |

### D. Notifications, media session, input, capture

| Finding | Where | Verdict |
|---|---|---|
| Notification listener needs a secure-settings binding the user makes by hand | `permissions.md` | **contract** |
| `MediaSessionManager.getActiveSessions` gated on the notification-listener grant | `Capabilities.kt` | **contract** |
| No public API for an AccessibilityService to synthesise a `KeyEvent`; `INJECT_EVENTS` is signature-level | `CLAUDE.md` | **contract** |
| `performGlobalAction` is the whole of `input.global` | `CLAUDE.md` | **contract** |
| MediaProjection consent cannot be cached; FLAG_SECURE surfaces capture black | `CLAUDE.md` | **contract** |
| Background clipboard reads blocked since Android 10 without an a11y service or IME | `CLAUDE.md` | **contract** |
| `android.remoteInputHistory=null` appearing as a `grep -c` false positive | `CLAUDE.md` control table | **instrument fault, not a platform fact** |
| **Defect 33 / 28** — apps with no launcher icon resolve to their package id through `AppLabels.of` | `AppLabels.kt` | **contract**, and the fallback is correct everywhere |

**This whole section is the portable part of the project.** Everything Phase 3 and most of Phase 4
rests on is documented platform behaviour, which is why those phases closed on one device without
this audit being needed.

### E. Process, install, and multi-user

| Finding | Where | Verdict | Reasoning |
|---|---|---|---|
| `adb install -r` preserves all 11 runtime grants and both secure-settings bindings | `CLAUDE.md`, `docs/testing.md` | **contract** | Reinstall semantics are platform-level |
| …but leaves the app **serverless** — it returns via the notification-listener rebind with no port bound | `CLAUDE.md` | **ours, not the platform's** | A property of `LinkService`'s start conditions. Portable because it is our bug shape |
| **One UI's battery manager kills backgrounded foreground services** | `CLAUDE.md` roadmap, `decision-45` | **vendor — and it is the entire premise of Phase 6** | Named as vendor from the start. Every OEM has a different version of this and some have none |
| Doze suspending sockets | roadmap | **contract**, with vendor-specific aggressiveness on top |
| **Users 95 `DUAL_APP` and 150 `Secure Folder`** exist and hold their own copies of grants | `docs/testing.md` (permission dumps read `false` for user 95 as the control) | **vendor** | Both are Samsung features. On a stock device the permission dump would have **one** user and the control column that made those readings trustworthy **would not exist** |

**The `DUAL_APP` row deserves its own sentence, because it cuts the other way.** Several permission
readings in `docs/testing.md` used *user 95 reading `false` on everything* as the control proving the
grant landed on the copy under test. That control is **Samsung-only**. On a device without work
profiles or a clone user, those readings would need a different control — and an auditor reproducing
them elsewhere will find the control missing and may read that as a failure. Noted here so they do
not.

---

## 4. What is at risk if a verdict is wrong

| If this is wrong | What breaks | How loudly |
|---|---|---|
| The SAF refusals are Google's, not Samsung's | On a device with a different picker, `Download` might be grantable — the Folders screen's wall copy would be **wrong but harmless**: it says a folder cannot be added when it can | Quietly. Nobody is blocked; the copy over-warns |
| Defect 50 is vendor | On a provider that honours bound arguments, our inlined literal still works | Silent and safe. The fix is the conservative direction |
| Defect 45's extra ordering | On an OEM that delivers the extra earlier, option 4's correction simply never fires because the first card is already right | Silent and safe |
| `.pending-<n>-<name>` naming | Nothing depends on the exact name — the rule is *the partial is never at its final name*, which holds either way | Nothing |
| Defect 55's snapshot | A faster provider makes the snapshot unnecessary, never harmful; a slower one makes it more necessary | Nothing |

**Nothing in the current build fails dangerously if a verdict here is wrong**, and that is worth
stating plainly: every vendor-dependent decision so far was taken in the conservative direction,
mostly by accident of being cautious about the phone. The one to watch is the Folders screen's copy,
which is the only place a vendor assumption is asserted **to a user as fact**.

---

## 5. What this audit did not do

- **It did not test a second device**, which is the only thing that can convert most of the
  `unknown` rows. Everything here is provenance reasoning and documentation, not comparison.
- **It did not re-run any probe.** The readings are taken as recorded.
- **It did not audit the Mac side**, which is one macOS version and one Node — a separate and much
  smaller question.
- **It did not check module versions against anything.** DocumentsUI is version 17 and Play-updated;
  that number is not compared to any other device because there is no other device.

## 6. The cheapest next evidence, in order

1. **Any second Android device, even an old one, running `SafProbeActivity`.** Four readings, ten
   minutes, and it converts the largest block of `unknown` rows in §3.A. A Pixel is the highest-value
   one because it isolates *Samsung* from *Google* directly.
2. **The same device's `pm list packages -f`** for the six components in §2. If the telephony
   provider there is not `Sec…`, defect 50's verdict is settled in one command.
3. **A device with no clone user**, to re-establish the permission controls in §3.E without user 95.
4. Anything running a **different DocumentsUI version**, because §2 established that the picker is
   Play-updated and can therefore change on *this* device too. That makes the SAF wall copy the one
   claim in the app with an expiry date nobody controls.

**Point 4 is the finding this audit did not expect.** The most-cited platform wall in this
repo — the one written into `CLAUDE.md`, `docs/protocol.md`, the phone's Folders screen and the Mac's
Files pane — rests on the behaviour of an app that **updates itself from the Play Store**, on a
schedule Samsung does not control and we do not either. It is not fixed by the OS version, and
re-running `SafProbeActivity` after a DocumentsUI update is the only thing that would notice a
change. That is a maintenance obligation and it is recorded here rather than assumed.
