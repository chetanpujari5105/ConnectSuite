# Sidekick for Android — the redesign plan

> **Revision 3 — 2026-09-21. For final sign-off.** Revision 1 was the discovery; revision 2 folded in
> eleven decisions and **corrected the rename scope, which I had got wrong twice**. This revision
> folds in **seven more decisions** (§0.1), **re-sequences the rename phone-first**, and reports
> **both blockers re-read rather than recalled** (§0.2).
>
> **Still Step 1. No Android code and no Mac code has been applied.** The one file changed outside
> this plan is `PRODUCT.md`, by decision 18.
>
> **Read from the code, not recalled.** Every count was taken with the command that produced it named
> beside it. Where a number is the instrument's rather than the product's, it says so.
>
> **Nothing here has been compared against a Figma frame**, because the MCP is still unauthorized as
> of this revision (§0.2). §3.1 holds the re-check, ready to run. Until it runs, every row in §3 reads
> *adapted from the Mac design system* — **and that is what it will keep reading unless a frame
> actually renders.**

---

## 0.1 · Decisions taken

Eleven from revisions 1–2, seven from this round. Recorded so no later batch re-litigates one.

### From revisions 1 and 2

| # | Decision | Where it lands |
|---|---|---|
| **1** | **Re-skin only.** `applicationId`, package, Keystore identity, trust store, folder grants **untouched** | §11.1. No re-pair is forced |
| **2** | **`PairingRequestDialog` keeps its fingerprint prominent** and keeps the human comparison. Restyle only | §8.1 |
| **3** | **The Mac-path fingerprint moves to Details** — diagnostic only | §8.2, §8.5 |
| **4** | **"Wi-Fi Direct" stays in the Sync feature.** No blanket replace | §1 |
| **5** | **Distinct tone tokens — neutral / amber / red.** A user's own setting is not a malfunction; a wall does not share a colour with a permission prompt | §9.2 |
| **6** | **One state vocabulary on `FeatureUnavailableScreen`'s file and name** — evolved, two layouts | §9.2 |
| **7** | **Minimal Compose UI test infrastructure** | §12.1, Batch 0 |
| **8** | **The user-visible name becomes Sidekick.** `applicationId` unchanged | Batch 1, Appendix A |
| **9** | **Material Symbols, restyled**; originals only where there is no counterpart | §6 |
| **10** | **No phone overview screen.** `Connect a Mac` is a named action | §8.2, §10 |
| **11** | **Defect 100 acknowledged.** Mirror `RUNNING` not screenshotted, not claimed | §2.4 D6, §12.4 |

### From this round

| # | Decision | Where it lands |
|---|---|---|
| **12** | **Rename scope: option 2 — the phone goes first.** The full Android surface (56 Kotlin lines + 8 resource strings) renames as one pass; **the Mac change is re-scoped afterwards** against the smaller diff that remains. **The old ten-line Mac patch is not applied** | **Batch 1**, Appendix A. Appendix B holds the deferred Mac half |
| **13** | **`input_service_label` ships inside the phone rename**, same pass. **The Mac's *"Sidekick Input"* sentence may never go live before the Android resource says it** — if they cannot ship together, the Mac sentence is held back | Appendix A.3, Appendix B |
| **14** | **The three exclusions confirmed**: `renderer.ts:2058` not renamed · `linkHealth.ts:89–90` split, with **its doc comment corrected in the same commit** · the four test assertions updated **in the same commit as the string they assert on** | Appendix B |
| **15** | **New wording for the downloads sentence** — *"Earlier downloads stay in ~/Downloads/ConnectSuite — named for Sidekick's earlier name, not moved."* Path unchanged | Appendix B.2, and see the note there on reading 14 and 15 together |
| **16** | **Run the Figma re-check** once authorization lands | §3.1 |
| **17** | **Batch 0 is stop-and-report, not stop-and-fall-back.** If Robolectric + `createComposeRule` does not work at this Compose BOM, **report it; do not silently take the screenshot-only route** | §12.1 |
| **18** | **`PRODUCT.md` updated.** **Applied this revision** — it no longer claims the Android app is out of scope for design work | `PRODUCT.md`, two sentences |

**One decision of mine nobody has overruled:** type face is **Roboto**, not a bundled Inter (§4.3).
The single place I deliberately do not match the Mac. Reversible on one word.

---

## 0.2 · Both blockers, re-read this revision

Neither is recalled from revision 2. Both were re-run.

### Figma — still unauthorized

```
ToolSearch "+figma frame node file screenshot code metadata variables"
  → mcp__plugin_figma_figma__authenticate
  → mcp__plugin_figma_figma__complete_authentication
  (and nothing else)
```

**That is the control decision 16 asks for, and it fails:** the real tools have not appeared, only the
two auth tools. **Signing the browser extension into the right Figma account does not complete the MCP
grant** — they are separate, and the OAuth flow still has to be walked.

**One thing did change, and it corroborates the re-sign-in:** the server re-registered. The client id
moved from `QQP6ov10uoIGamjJuYmPsn` to `dMWwGRIeGn1uVbmbnbu11o` and the callback port from `57154` to
`50965`. So the extension state is different; the grant is still missing. A fresh URL is in the
covering message.

### Device — still nothing on the bus

```
$ adb start-server && adb devices -l
List of devices attached
                                    # empty, daemon confirmed up
$ scripts/target-device.sh
FAIL  no device on the bus.
```

**Unchanged after the cable, screen-unlock, USB-debugging revoke/re-authorize and MTP work.** The
control is the same one the pin script names: a cold daemon prints an identical empty list, so the
daemon was started first and the list re-read. `adb version` answers, so the query is live.

**This is not an authorization problem.** An unauthorized device prints a **row** reading
`unauthorized`, and an offline one prints `offline`. There is **no row at all** — which means the host
is not enumerating the phone over USB, so nothing on the phone's side (including re-authorizing the
RSA key) can change it. That points at the cable, the port, or a hub rather than at a setting.
`system_profiler SPUSBDataType` returns **0 lines** on this machine, so it cannot narrow it further —
an instrument that produces nothing has not told us the USB bus is empty.

**What this blocks, precisely:** every screenshot, the reduced-motion reading (§7.2), the 48 dp icon
reading (§11.4), and all ten rows of §12.4. **It blocks no batch from being written** — Batch 0 and
Batch 1 are a JVM test suite and a string pass, and both run on `./gradlew test` with no device.

---

## 0 · The plan in one paragraph

The Android app is **18 Compose files, 3,551 lines**, three bottom tabs, and a Material 3 theme whose
accent is **the user's wallpaper** on every device running Android 12 or later. The Mac has shipped
the full Sidekick system — lime `#C6FF33` on near-black, 58 light/dark token pairs at 0 failing
contrast, one state component, one motion vocabulary, fifteen commit guards. Porting it is four
pieces of work in a fixed order: **kill dynamic colour and build the token layer** (nothing else can
land first), **rebuild the connect-a-Mac path**, **collapse fourteen inline state treatments into
one component**, then **icons, icon, motion**. Two things in the brief need decisions before Batch 1
and both are in §13: whether the Android app is *renamed* or only *re-skinned*, and what to do about
the fact that **the module holding every screen a user meets has one test file and no instrument that
can assert anything about a composable**.

---

## 1 · What the brief's premise gets right, and the three places it is out of date

This matters more than politeness. Two of the three stale items describe copy that was **deliberately
removed as a defect**, and one describes language that is **correct where it still appears** — so
"remove the Wi-Fi Direct wording" executed literally would reintroduce the exact mistake this
repository has a rule about (`CLAUDE.md`, *a true sentence about the wrong one of two paths*).

### Right, and measured

| Claim | Reading |
|---|---|
| Blue Material theme | `core/.../core/ui/Theme.kt` — `primary = #00629E` light, `#98CBFF` dark. **18 raw `Color(` literals, all in that one file**, 0 anywhere else |
| Generic bottom tabs Sync / Mirror / Mac | `AppNavigation.kt` — `TopLevelTab` enum, three entries, `NavigationBar` |
| Generic Material icons | **20 distinct** `Icons.*` referenced; `material-icons-extended` is a declared dependency |
| Raw technical wording | `LinkRoute.kt`: `Ports 42501, 42502, 42503 · protocol v1`, `Key <16 chars>…`, `Forget`, `Pair another Mac`, `Restart listening` |
| A completely different icon system | launcher icon is `#0F3460` navy with `#4FC3F7` / `#81D4FA` rectangles — *"Two linked devices: the ConnectSuite mark"* |
| Still called ConnectSuite | `app_name`, `applicationId com.chetan.connectsuite`, and the app name in 5 `strings.xml` files |

### Out of date — and one of the three is a trap

| Brief says | Actually |
|---|---|
| Onboarding shows Wi-Fi Direct technical language | **Removed, defect 69.** The permissions page asked for `NEARBY_WIFI_DEVICES` under *"Finding your Mac"* with a Wi-Fi Direct rationale; the permission was measured unnecessary for the v2 link on hardware 2026-09-03 and the page now asks for one thing. `OnboardingCopy.forbiddenMechanisms` **fails the build** on `adb`, `tcpip`, *wireless debugging*, *developer options*, *build number* and *"a key confirmed on both screens"* |
| The pairing screen buries the action under diagnostics | **Reordered, F2 of `docs/phase-7-pairing-flow.md`.** Order is state → action → paired list → **Advanced, collapsed**. The ports line is inside `AnimatedVisibility(advancedOpen)` |
| "Wi-Fi Direct" should be replaced with plain language | **Only on the Mac path.** Every surviving *Wi-Fi Direct* string is in `DevicesScreen.kt` / `SyncRoute.kt`, which is the **v1 Android-to-Android Sync feature, where Wi-Fi Direct is literally the transport**. `onJoinWifiDirect`, `WifiDirectState.UNSUPPORTED/DISABLED`, `DiscoveryChannel.WIFI_DIRECT`. Rewriting those would make a true sentence false |

**The phone's pairing wait states already exist and are already good.** `LinkWaitStatus` in `core/`
is a sealed interface with four members — `NotListening`, `Connected`, `Waiting(showNetworkHint)`,
`Refused(fingerprintPrefix, address)` — a pure function `of(state, nowMillis)`, `HINT_AFTER_MS =
20_000`, `REFUSAL_VISIBLE_MS = 60_000`, and prose that names the lookalike it cannot separate
(*"if it stays like this"* rather than *"your Mac is on a different network"*). **The redesign renders
this. It does not reinvent it**, and it must not move the decision into a composable — defect 67 is
in this file for that exact move.

---

## 2 · Full phone-app screen and state inventory

Every destination, every state, read from source. `Where` is the file that draws it. **Container** is
the Material 3 colour role currently carrying the state meaning, because §9 is about those six roles
meaning fourteen things.

### 2.1 · First run — `app/`

| # | Screen / state | Where | Container | Notes |
|---|---|---|---|---|
| A1 | Onboarding 1 · Welcome | `OnboardingScreen.kt` `WelcomePage` | 2× default Card, 1× `surfaceVariant` | Title is the literal string `"ConnectSuite"` |
| A2 | Onboarding 2 · Permissions, notifications ungranted | `PermissionsPage` | `surface` | `PermissionCard`, `ErrorOutline` + `outline` tint |
| A3 | Onboarding 2 · granted | `PermissionsPage` | `surfaceVariant` | primary label swaps to `Next` |
| A4 | Onboarding 2 · below API 33 | `PermissionsPage` | — | **card absent entirely**; page has a footnote and nothing else |
| A5 | Onboarding 3 · About mirroring | `MirrorPage` | 2× `surfaceVariant` | the two platform walls |
| A6 | Onboarding 4 · Reliability, unexempt | `ReliabilityPage` | `surface` + `tertiaryContainer` | |
| A7 | Onboarding 4 · exempt | `ReliabilityPage` | `surfaceVariant` + `tertiaryContainer` | re-read on `ON_RESUME` |
| A8 | Onboarding 5 · Connect your Mac | `PairPage` | plain text | primary `Scan the code`, secondary `I'll do this later` |
| A9 | Onboarding 5 · paired | `PairPage` | `secondaryContainer` | `CheckCircle`, `Paired with %s` |
| A10 | QR scan · asking for camera | `QrScanScreen.kt` | none — bare `Column` | `systemBarsPadding()` only; no Scaffold |
| A11 | QR scan · camera refused | `QrScanScreen.kt` | none | *"Camera access is needed…"* + `Allow camera` |
| A12 | QR scan · scanning | `QrScanScreen.kt` | none | `PreviewView` in `AndroidView`, full weight |
| A13 | QR scan · not a Sidekick code | `QrScanScreen.kt` | none | status line only; **no visual distinction from A12** |
| A14 | QR scan · pairing | `QrScanScreen.kt` | none | `Pairing with <name>…`, one-shot `consumed` latch |

### 2.2 · The Mac tab — `app/.../link/LinkRoute.kt`

| # | State | Container | Notes |
|---|---|---|---|
| B1 | `NotListening` | `surfaceVariant` | detail is `state.lastError` |
| B2 | `Waiting`, under 20 s | `surfaceVariant` | headline only, `detail == null` |
| B3 | `Waiting`, past 20 s | `surfaceVariant` | the network hint — **same container as B2**, so the state change is text-only |
| B4 | `Refused` | `errorContainer` | fingerprint prefix + address |
| B5 | `Connected` | `secondaryContainer` | `Connected to <names>` |
| B6 | Unpaired addendum | inside the status card | *"Pairing lets your Mac see this phone's…"* |
| B7 | Background-restricted | `errorContainer` | `BackgroundRestriction.{HEADLINE,BODY,STEPS,NOT_THE_SAME_SWITCH}` + `Open App info` |
| B8 | Primary action, unpaired | filled `Button` | `Scan pairing code` |
| B9 | Primary action, paired | `OutlinedButton` | `Pair another Mac` |
| B10 | Paired list · empty | plain text | `None yet.` |
| B11 | Paired list · rows | default Card | `Key <16 chars>…` + `Forget` |
| B12 | `lastPaired` toast line | plain text | `Paired with <name>.` — never clears |
| B13 | Advanced, collapsed / open | default Card | ports, protocol version, last disconnect, capability list, held-back summary, `Start/Restart listening` |

### 2.3 · Sync — `sync-module/`, five tabs inside one `TabRow`

| # | Screen / state | Where | Container |
|---|---|---|---|
| C1 | Devices · this-device card | `DevicesScreen.kt` | default Card, `Key <fp>` in `FontFamily.Monospace` |
| C2 | Devices · scanning | same card | `CircularProgressIndicator` 20.dp |
| C3 | Devices · no Wi-Fi Direct radio | `InfoCard` | `tertiaryContainer` |
| C4 | Devices · Wi-Fi off | `InfoCard` | `tertiaryContainer` |
| C5 | Devices · empty, scanning | `EmptyDevicesCard` | default Card |
| C6 | Devices · empty, idle | `EmptyDevicesCard` | default Card |
| C7–C12 | Device row · 6 action states | `DeviceRow` | `primaryContainer` when connected, else `surfaceVariant` |
| C13 | Device row · 9 status lines | `Device.statusLine()` | — |
| C14 | Pairing request dialog | `PairingRequestDialog` | `AlertDialog` — **the one human fingerprint comparison in the app** |
| C15 | Transfers · empty | `TransfersScreen.kt` | default Card |
| C16 | Transfers · in progress | `ActiveTransferCard` | default Card, `LinearProgressIndicator` |
| C17–C22 | Transfers · 6 history statuses | `HistoryRow` | `errorContainer` FAILED · `tertiaryContainer` PAUSED · `surfaceVariant` rest |
| C23 | Incoming offer dialog | `IncomingOfferDialog` | `AlertDialog` |
| C24 | Folders · header | `FoldersScreen.kt` | none |
| C25 | Folders · quick picks | `QuickPickRow` | `AssistChip` |
| C26 | Folders · none | `NoFoldersCard` | default Card |
| C27 | Folders · rows | `FolderCard` | default Card |
| C28 | Folders · grant outlived the folder | `FolderCard` | `surfaceVariant` |
| C29 | Folders · the `Download` wall | `WallCard` | `tertiaryContainer` — **furniture, drawn in every state, deliberately** |
| C30 | Clipboard · How this works | `ClipboardSection.kt` | default Card |
| C31 | Clipboard · send-to-Mac steps | same | default Card |
| C32 | Clipboard · sent / nothing / not connected | same | default Card |
| C33 | Clipboard · auto-apply switch | same | default Card |
| C34 | Clipboard · received / none / applied | same | `secondaryContainer` |
| C35 | Clipboard · history bound | same | plain text |
| C36 | Feed · listener off | `NotificationsScreen.kt` | `tertiaryContainer` |
| C37 | Feed · mirroring off | same | **`errorContainer`** — and see §9 |
| C38 | Feed · empty | same | default Card |
| C39 | Feed · rows | `NotificationRow` | default Card |
| C40 | Sync settings · master switch | `SyncSettingsScreen.kt` | `primaryContainer` on, `errorContainer` off |
| C41–C45 | Sync settings · 5 toggles | `SettingCard` | |
| C46 | Sync settings · per device | | |
| C47 | Sync settings · excluded apps + search | | `OutlinedTextField`, `app.packageName` as the subtitle |

### 2.4 · Mirror — `mirror-module/`, plus the input card from `input-module/`

| # | State | Container | Notes |
|---|---|---|---|
| D1 | `IDLE`, link up — *Ready to mirror* | `surfaceVariant` | |
| D2 | `IDLE`, link down — *Not mirroring* | `surfaceVariant` | + the reason under the disabled button |
| D3 | `AWAITING_FOREGROUND` | **`primaryContainer`** | the one state the user was sent here to act on |
| D4 | `REQUESTING_CONSENT` | `surfaceVariant` | |
| D5 | `STARTING` | `surfaceVariant` | |
| D6 | `RUNNING` | `surfaceVariant` | geometry line; Stop replaces Start |
| D7 | `STOPPED` | `surfaceVariant` | `lastError` kept after the session ends |
| D8 | Input onboarding card | `InputOnboardingCard.kt` | accessibility-service grant |
| D9 | The every-session consent footnote | plain text | standing copy |

### 2.5 · Defined and never drawn

| # | What | Reading |
|---|---|---|
| E1 | `FeatureUnavailableScreen(title, reason, detail)` in `app/` | **0 call sites.** A whole *unavailable-with-a-reason* component, with a doc comment explaining the rule it enforces, that nothing in the app uses — while §9 counts fourteen inline treatments of the same idea. Same shape as the Mac's `discHue.ts` and its deleted `--dur-bar` |

**Totals: 14 + 13 + 47 + 9 = 83 drawn states across 13 destinations**, plus one component drawn
nowhere.

**The arithmetic is shown because this repository has a rule about counts that were typed rather than
counted** (`docs/empty-and-failure-states.md` got three of its own group totals wrong, twice, that
way). §2.3 has **33 table rows** carrying **47 states**: three rows are ranges — `C7–C12` (6 device-row
action states), `C17–C22` (6 transfer statuses) and `C41–C45` (5 settings toggles) — so
`33 − 3 + 6 + 6 + 5 = 47`. A reader counting rows will get 70 and should get 83.

Compare the Mac before component 11 collapsed them: **84 states across 19 panes.** Two halves of one
product, at the same scale of debt, and only one half has been through it.

---

## 3 · Figma — **the file has now been read**, and there are no Android frames

> **Revision 4, 2026-09-21. This section is no longer an assumption.** The MCP was abandoned after
> three failed OAuth attempts; the file was read instead through **browser automation against the
> owner's own authenticated Figma session**. Every number below came off the live document.

### 3.0 · Method, and why it is not the method used before

Three different routes have now touched this file, and they are not interchangeable:

| Route | Used for | Reach |
|---|---|---|
| **Figma Plugin API** | the **45 icon glyphs** in `icons.ts` — `vectorPaths` plus each vector's offset, from Design System → *13 · Iconography* (`36:18762`) | full node data. **Not available to me** — it needs a plugin running inside Figma |
| **Figma MCP** | one frame ever (`32:4382`), before a plan limit | rendered frames + node data. **Unauthorized; abandoned** |
| **Browser automation** *(this pass)* | the enumeration below | the editor's **DOM** — layer names, page list, and the right-hand Design panel per selected node. **Not** canvas text, **not** vector data |

### 3.1 · What was read, with the control for each

| # | Reading | Control |
|---|---|---|
| 1 | File is **`sidekick mac app ui`**, `editor_type: design`, **last modified `2026-09-17T13:28:34Z`** | `/api/files/{key}` returned 200 with the real name; the sibling `/api/file/{key}` returned 404, so the endpoint discriminates |
| 2 | **Two pages: `Page 1`, `Design System`** | matches the handoff's "Two pages" exactly |
| 3 | **Design System holds exactly three boards** — `00 · Foundations`, `01 · Components`, `02 · Decisions & open questions` | the page switch was **verified before reading**: the URL moved to `node-id=28-542` and the Page 1 layer names disappeared. Two earlier clicks that did *not* switch were caught this way |
| 4 | **Page 1 holds 59 top-level layers: 55 Sidekick screen frames + 3 `BRAND`/`ASSET` utility frames + 1 stray `Frame 1`** | scrolled to exhaustion; the unique count **plateaued at 59 across three further scroll steps** |
| 5 | The 55 match the handoff's §1 list **name for name**, and the per-pane counts match: Overview 5 · Mirror 5 · Files 4 · Photos 4 · Messages 4 · Notifications 5 · Clipboard 4 · Calls 4 · Apps 4 · Activity 4 · Settings 5 · Camera 1 · Pair a phone 6 = **55** | the arithmetic is shown rather than asserted |
| 6 | **`00 · Foundations` is 1260 × 2779** | read from the Design panel with the board selected |
| 7 | **There is no Android frame, no phone-shaped frame, and no phone-sized artboard anywhere in the file** | every one of the 55 is a named Mac pane already in the handoff. The three extras are `BRAND / head_logo contrast check` and two `ASSET /` frames — logo source material, not screens |

### 3.2 · The instrument fault I caught, because it nearly became a finding about the file

**The layers panel virtualizes, and its inner container lies about it.** The first enumeration read
**44** layers from a box whose `scrollHeight === clientHeight === 1888` — which reads as *the whole
list is rendered*. It was the rendered **window**.

That reading was one sentence from being written down as: *"Page 1 has 41 Sidekick frames — Mirror
and Files are absent entirely."* **A confident, specific, wrong claim about the design file**, and the
kind that would have sent someone looking for deleted work. Scrolling to exhaustion returned **59**.

`sh === ch` is the lookalike here, and it is a good one: it is the exact signature of a
non-virtualized list. What separates them is not a property but a **stimulus** — scroll it and see
whether the set grows. **The plateau is the control**, not the first number.

### 3.3 · What this settles, and the expectation it corrects

**Android tokens cannot be Figma-verified, because there is nothing in the file to verify them
against.** That is now a **measurement** rather than the assumption revision 1 recorded — and it is
the opposite of what the brief hoped for, so it is worth stating plainly rather than burying:

- **Every §4 token stays marked *adapted from the Mac design system*.** No row moves to **F**.
- The brief anticipated this: *"If the Figma file does not yet contain Android-specific screens, do
  not invent a divergent design… extract the Sidekick tokens from the existing Mac frames and propose
  an Android adaptation."* **That is the branch we are on**, and it is now confirmed rather than
  presumed.
- **What the Mac tokens rest on is unchanged and is not weak:** `docs/sidekick-figma-handoff.md` §2
  was transcribed from this file's Foundations board, and `tokens.css` carries those values marked
  `FIGMA` — `#C6FF33`, `#0A0A0A`, `#161616`, `#1C1C1C`, `#1A1A1A`, `#FFB547`, `#FF5C5C`, `#9C9EB0`,
  `#F2F3F5`, `#9A9CA8`, `#6B6E7A`, `#4A4C55`. The Android port copies *those*, so it inherits the
  file's values one hop removed.
- **The one hop is real and is not closed.** Handoff ↔ `tokens.css` agree byte-for-byte; **file ↔
  handoff has not been re-verified value by value** in this pass. §3.4 says what that would take.

### 3.4 · What the browser could still get, and what it costs

The right-hand **Design panel is DOM-readable per selected node** — reading 6 above is proof. So
fills, radii, type size/weight/line-height and Auto Layout values are all reachable, **one selected
node at a time**: select in the layers tree, read the panel, repeat. For the Foundations board's
swatches that is on the order of a hundred selections.

**Two things are *not* reachable this way**, and they are the two the earlier routes were used for:

- **Canvas text.** Figma renders text into `<canvas>`, so the Foundations board's written token
  values cannot be scraped from the DOM — only re-read through the Design panel per text node.
- **Vector geometry.** `vectorPaths` came from the **Plugin API**. Nothing in the DOM exposes it,
  which is why `icons.ts` could not have been produced this way.

**Recommendation: do not spend that budget.** The port copies `tokens.css`, which already carries the
file's values; a per-node re-transcription would be verifying a transcription rather than producing
anything new, and §6 already establishes that the **icon set cannot come from this file at all** —
SF Symbols is Apple-licensed and the Android set is Material Symbols restyled (decision 9).

**If you want the handoff ↔ file check done anyway**, the cheapest honest version is a **sample with
a control**: ten swatches chosen in advance, read through the Design panel, compared against handoff
§2 — and the result reported as *ten of ten agree* or as the specific disagreements, never as
"the palette is verified".

---

## 4 · The token port, with values

Four token families. **Values are the shipped Mac ones, copied, not re-derived** — a second derivation
is a second opinion about a colour, and `check-contrast.mjs` has already scored these at 58 pairs / 0
failing.

### 4.1 · Where they live, and the Android version of the one-owner rule

The Mac's rule is *`tokens.css` owns colour, `shell.css` owns the frame, `styles.css` owns the
inside of a screen*, enforced because three sheets load into one cascade and the later one wins
silently. **Compose has no cascade, so that specific failure cannot happen — and the failure that
replaces it is worse, because it is invisible rather than merely silent: a composable can write a
literal and nothing anywhere will ever mention it.** The Mac at least had a stylesheet to grep. So:

| Layer | Owns | File |
|---|---|---|
| `SidekickColors` | the 24 colour roles, dark and light | `core/.../ui/theme/SidekickColors.kt` |
| `SidekickTypography` | the 7 type roles | `core/.../ui/theme/SidekickTypography.kt` |
| `SidekickDimens` | spacing, radius, hairline width, icon sizes | `core/.../ui/theme/SidekickDimens.kt` |
| `SidekickMotion` | durations, easings, press scales | `core/.../ui/theme/SidekickMotion.kt` |
| `SidekickTheme` | provides all four + a mapped M3 `ColorScheme` | `core/.../ui/theme/SidekickTheme.kt` |

**Two providers, not one, and this is the load-bearing decision of Batch 1.** M3's `ColorScheme` has
**no slot** for `hairline`, `warning`, `unknown`, `text-meta`, `accent-tint` or `accent-on-fill`. Six
of Sidekick's roles are unrepresentable in it. So:

- `MaterialTheme` is fed a **mapped** `ColorScheme`, so every stock M3 component (`Switch`,
  `AlertDialog`, `TabRow`, `LinearProgressIndicator`, `AssistChip`, ripple) is correct by default
  rather than by per-call-site override.
- `LocalSidekick` carries the full set. **A colour a composable needs that is not in it means the
  token is missing** — the Mac's rule, verbatim.

`ConnectSuiteTheme` stays as a deprecated `@Deprecated` alias delegating to `SidekickTheme` for one
batch, so no module breaks mid-port.

### 4.2 · Colour — 24 roles, dark and light

Dark is authority; light is the shipped derivation. `DERIVED` values are marked in `tokens.css` and
stay marked in Kotlin, for the same reason.

| Role | Dark | Light | Job |
|---|---|---|---|
| `canvas` | `#0A0A0A` | `#F4F4F7` | window ground · M3 `background` |
| `chrome` | `#0F0F0F` | `#F7F7F9` | app bar, bottom bar · M3 `surface` |
| `card` | `#161616` | `#FFFFFF` | every standard panel · M3 `surfaceContainer` |
| `cardRaised` | `#1C1C1C` | `#F7F7F9` | nested / selected · M3 `surfaceContainerHigh` |
| `control` | `#1A1A1A` | `#EFEFF3` | buttons, inputs, tiles |
| `well` | `#111111` | `#EFEFF3` | recessed |
| `hairline` | `#FFFFFF` @ 8% | `#000000` @ 7% | **the only border**; 12% / 13% raised |
| `accent` | `#C6FF33` | `#9ED600` | **the one accent** · M3 `primary` |
| `accentHover` | `#D4FF4A` | `#86BA00` | |
| `accentPressed` | `#A8DF1F` | `#86BA00` | |
| `accentOnFill` | `#0B1002` | `#10130A` | text on lime · M3 `onPrimary` |
| `accentText` | `#D8FF70` | `#4F5E00` | lime **as text**, contrast-safe |
| `accentTint` | lime @ 12% | lime @ 12% | selected row · M3 `primaryContainer` |
| `accentBorder` | lime @ 30% | lime @ 32% | |
| `live` | `#C6FF33` | `#4F6A00` | **connected is lime. The `#32E58A` green is gone (D1)** |
| `warning` | `#FFB547` | `#8C6523` | a **real** limitation only |
| `destructive` | `#FF5C5C` | `#BA4444` | a **real** failure or destructive control · M3 `error` |
| `unknown` | `#9C9EB0` | `#5F6172` | connecting, unavailable, unknown |
| `textPrimary` | `#F2F3F5` | `#121316` | titles, values · M3 `onSurface` |
| `textBody` | `#9A9CA8` | `#5A5D6B` | body · M3 `onSurfaceVariant` |
| `textMeta` | `#6B6E7A` | `#9698A2` | labels, timestamps. **Held to the 2.4–3.6 band in both themes, not exempted** |
| `textDisabled` | `#4A4C55` | `#B1B3BC` | an unavailable control, **never a promise** |
| `textOnControl` | — | `#2A2B33` | |
| `overlay` | `255,255,255` | `0,0,0` | scrim / elevation mixing base |

**The three rules that come with the palette, unchanged from handoff §2:**

- **Lime is allowed on:** the primary action, the selected navigation destination, a selected
  segment, healthy progress and transfer fills, and a small connected/ready dot.
- **Lime is never on:** every chip, every icon, list rows, inactive controls, anything in a
  disconnected or failed state, glows, or repeated background gradients.
- **No purple, blue, cyan, pink or per-category hue exists anywhere.** Features are told apart by
  glyph and label. Amber for a real limitation, red for a real failure, grey for unknown — a value
  the phone does not have is `—` in grey, never a lime bar at zero.

### 4.3 · Typography — 7 roles, and how they map onto M3's 15

The handoff's seven roles, in `sp` rather than `px` because Android scales text and refusing to is an
accessibility defect, not a design decision. `Numeral` is the one that needs a real monospace face.

| Sidekick role | Size / weight | Tracking | Line height | M3 slot it fills | Used for |
|---|---|---|---|---|---|
| `display` | 31sp / 600 | −0.02em | 36sp | `headlineMedium` | page title, onboarding headline |
| `title` | 21sp / 600 | −0.015em | 26sp | `titleLarge` | card headings |
| `section` | 15sp / 600 | −0.005em | 20sp | `titleMedium` | section and row titles |
| `body` | 13.5sp / 400–500 | 0 | 20sp | `bodyMedium` | body and control labels |
| `caption` | 11.5sp / 500 | +0.01em | 14sp | `bodySmall` | metadata, captions |
| `micro` | 10sp / 500 | +0.06em, **uppercase** | 12sp | `labelSmall` | group labels |
| `numeral` | 21sp / 500 **mono** | 0 | 26sp | — | metrics, byte counts, **fingerprints** |

**Nothing sits between these sizes.** The 11 M3 roles the app uses today collapse onto them: the
45 `bodySmall` and 22 `titleMedium` calls become `caption` and `section`, and the eight remaining
roles fold in. **The mapping is one table in `SidekickTypography`, not a rename at 100 call sites** —
so an M3 component that asks for `labelLarge` still gets a Sidekick value.

**Face.** The Mac uses SF Pro / SF Mono. Android's system face is **Roboto**, and Roboto is the right
answer — a bundled Inter would add ~400 KB to a 25 MB APK to make the phone look like a Mac rather
than like itself, and the handoff records that the Figma file is set in Inter only because *SF Pro
renders zero-width in that document*. Mono is **`FontFamily.Monospace`** (Roboto Mono on this
handset), which is what the fingerprint already uses in `DevicesScreen.kt`. **Flagged as a new
decision** in §13 — it is the one place I am choosing *not* to match the Mac.

### 4.4 · Spacing and radius

**Current state, measured: 125 raw `.dp` literals across 12 distinct values** — `0, 2, 4, 6, 8, 10,
12, 14, 16, 20, 24, 28`. That is *already almost* the Mac's scale, which is `4, 6, 8, 10, 12, 14, 16,
18, 20, 24, 28, 32`. So this is a naming job, not a re-spacing job: the two scales differ by `2` (phone
only), `18` and `32` (Mac only).

| Token | Value | Used for |
|---|---|---|
| `space1` … `space12` | `4 6 8 10 12 14 16 18 20 24 28 32` | the Mac's scale verbatim |
| `hairlineWidth` | `1.dp` | the only border width |
| `radiusControl` | `10.dp` | buttons, chips, inputs |
| `radiusMedia` | `12.dp` | thumbnails |
| `radiusCard` | `14.dp` | **every standard panel** |
| `radiusHero` | `20.dp` | the one hero |
| `radiusPill` | `999.dp` | pills, status chips, badges |

**`2.dp` is not in the scale and is a real question, not a rounding error.** It appears 3× — a
`CircularProgressIndicator` stroke and two 2dp gaps. A stroke width is not spacing; it goes to
`SidekickDimens.strokeThin`. The two gaps become `space1`.

**Radius is where Android and the Mac genuinely diverge and I am keeping the Mac's numbers.** M3's
default shape scale is `4 / 8 / 12 / 16 / 28`; Sidekick's is `10 / 12 / 14 / 20 / 999`. Overriding
`MaterialTheme.shapes` makes every stock component follow, so this costs one mapping rather than a
per-component fight.

### 4.5 · Motion — the vocabulary, ported exactly

`cubic-bezier` maps to Compose with no loss: `CubicBezierEasing(0.22f, 1f, 0.36f, 1f)`.

| Token | Mac value | Android |
|---|---|---|
| `ease` | `cubic-bezier(.22,1,.36,1)` | `CubicBezierEasing(0.22f, 1f, 0.36f, 1f)` — the default, for anything **arriving** |
| `easeInOut` | `cubic-bezier(.77,0,.175,1)` | `CubicBezierEasing(0.77f, 0f, 0.175f, 1f)` — between two resting places |
| `durPress` | `100ms` | press **down**. Feedback lands on press, not release |
| `durRelease` | `160ms` | press **up**. Slower — nobody is waiting on it |
| `durState` | `180ms` | a colour or label changing because a state changed |
| `durToggle` | `160ms` | switch knob, segment |
| `durRouteFade` | `140ms` | destination change, **opacity only** |
| `durArrive` | `220ms` | one new row entering a list |
| `durSpin` | `1.2s` | one turn of an indeterminate spinner |
| `pressScale` | `0.97` | |
| `pressScaleIcon` | `0.94` | round icon button: less area, so more travel to read |

**The asymmetry is not a preference.** `AUDIT.md` §4 calls symmetric press-and-release a finding;
Apple's rule is *respond on pointer-down*. 100 down, 160 up, and §7 says how that is expressed in
Compose, where `Modifier.clickable` gives you no such hook for free.

---

## 5 · Dynamic colour must go, and it is the sharpest finding in this document

```kotlin
fun ConnectSuiteTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = true,          // <— this
```

On **Android 12 and later**, `dynamicDarkColorScheme(context)` derives the whole palette from the
user's **wallpaper**. `minSdk` is 29 and `targetSdk` is 36, so on the overwhelming majority of
installs today:

- **`#C6FF33` is never drawn.** Neither is the blue fallback. The accent is whatever tonal palette
  the launcher extracted from a photograph.
- **Two phones running this build do not look like the same product**, and neither looks like the Mac.
- **The state colours move too.** `errorContainer`, `tertiaryContainer` and `primaryContainer` — the
  six roles §9 shows are carrying fourteen different meanings — are all wallpaper-derived. So the
  *only* thing distinguishing a failure from a permission prompt from a platform wall on the phone
  today is a hue the app does not choose.

This is the Mac's `accent-color: auto` defect with a much larger blast radius. On the Mac it tinted
checkboxes with the user's macOS accent; here it is the entire palette including every state colour.
**It is also the reason the plan cannot be reordered:** any screen work done before this lands is
work whose colours were never once seen.

**`dynamicColor` is deleted rather than defaulted to `false`.** A parameter that must always be
`false` is one autocomplete from being `true` again — the Mac's `--dur-bar` lesson, and
`MessageType.APPS_LAUNCH`'s.

**What is lost, stated honestly:** blending with the OEM skin, which the current doc comment names as
the intent. That intent and "one Sidekick product across two platforms" are incompatible, and the
brief chose the second. **Recorded as a departure row, not silently reversed.**

**Light theme ships in the same batch.** The Mac has a full light theme — 58 token pairs, 0 failing,
`System` following macOS live. `isSystemInDarkTheme()` is already wired here and
`values-night/themes.xml` already exists, so the phone gets both from day one. **Dark is authority,
light is derived**, and the Mac's own derivation rule applies: each semantic colour is its dark
counterpart scaled in luminance until it clears AA, with `textMeta` held to the design's 2.4–3.6 band
in **both** themes rather than exempted.

---

## 6 · Iconography — the Mac's contract cannot be ported, and that is a licence fact

**The Mac's icon language is SF Symbols** (handoff §5b: 45 glyphs, a mapping table that *is* the
contract, seven named approximations). **None of it can come to Android.** SF Symbols is an Apple
font licensed for use on Apple platforms; the brief already rules out tracing it, and it is also
simply not available to a Compose app.

So what ports is the **rules**, not the glyphs:

- One family, one style. No emoji, no filled/outline mixing, no second icon pack.
- **Regular weight by default.** Medium for a selected navigation destination and a primary-action
  glyph. Semibold only where clarity is at risk at 12–14 dp.
- **Sizes: 16 · 18 · 20 · 24 · 32 dp.** List rows and nav 24 (Android's touch conventions are larger
  than the Mac's 16) · inside buttons and chips 18 · section badges 20 · state-block badge 24 · empty
  state 32, quiet and monochrome, **never an illustration**.
- **Colour:** default `textBody` grey. Lime **only** on the selected navigation destination and on a
  glyph inside a lime button (`accentOnFill`). Amber only for a real limitation, red only for a real
  failure, `textDisabled` for a briefly-unavailable control. **Never colour as decoration.**
- **An icon is never the only explanation of a destructive or consequential action.** Forget,
  Remove, Decline, Stop and Cancel keep their labels.
- No icon is added because a space looks empty.
- **The lime Sidekick mark is the one brand icon**, and it is never a navigation icon, a button
  glyph, a status icon or a spinner.

**The geometry source is a decision, and it is in §13.** My recommendation: **Material Symbols
(Apache 2.0) at one fixed weight / grade / optical size, restyled to the Sidekick rules**, rather
than 30 original drawings. Reasons, in order: it is licensable and redistributable, it is what an
Android user's eye already reads as "an icon in an Android app", it costs one dependency instead of a
month, and the brief's actual requirement — *"do not trace SF Symbols, do not use unlicensed
third-party packs"* — is satisfied. Where Material Symbols has no counterpart (the Sidekick mark, the
clipboard direction pair) the icon is drawn original, in the same family. **This is a new decision
and not a Figma frame**, which is why it is flagged rather than assumed.

**The enumeration rule comes too, because it has already cost this project a phase.** The Mac shipped
**with no icons at all** and nothing noticed — empty `.tool-glyph` rings, visible in a screenshot and
invisible to every check. The Android answer is one `SidekickIcons` object plus
`iconNamesUsedByTheApp()`, with a JVM test asserting every name resolves and none is empty. **An icon
name that is not in an enumeration is an icon nobody can check.**

**Mapping — the 20 Material icons in use today, plus what the redesign needs:**

| Today | Used for | Sidekick family | Note |
|---|---|---|---|
| `Outlined.SyncAlt` | Sync tab | `sync` | |
| `Outlined.Cast` | Mirror tab, Start mirroring | `mirror` | Mac uses `rectangle.on.rectangle` |
| `Outlined.Laptop` / `Outlined.Computer` | Mac tab, desktop device | `laptop` | **two icons for one concept today** |
| `Outlined.PhoneAndroid` / `TabletAndroid` / `DeviceUnknown` | device rows | `phone` / `tablet` / `deviceUnknown` | |
| `Outlined.Settings` | Sync settings | `settings` | |
| `Outlined.StopCircle` | Stop mirroring | `stop` | |
| `Outlined.ArrowUpward` / `ArrowDownward` | transfer direction | `upload` / `download` | |
| `Default.CheckCircle` / `Outlined.CheckCircle` | granted, paired | `checkCircle` | **two variants of one glyph today** |
| `Default.ErrorOutline` | permission ungranted | `alert` | |
| `Default.Refresh` | scan again | `refresh` | |
| `Default.Close` | dismiss | `x` | |
| `Filled.KeyboardArrowUp` / `Down` | Advanced disclosure | `chevronUp` / `chevronDown` | |
| `AutoMirrored.Filled.ArrowBack` | back | `back` | **stays auto-mirrored** — RTL |
| `Outlined.TouchApp` | input onboarding | `input` | |
| — | folders, clipboard, feed, transfers, camera/QR, lock, link, linkMinus, wrench, info, trash, copy | 12 more | needed by the redesign |

**Four of the twenty are duplicates or near-duplicates** (`Laptop`/`Computer`,
`Default`/`Outlined.CheckCircle`), which is the mixed-set problem the Mac's departure row 6 records.

---

## 7 · Motion on Android — what ports, what must be measured, and what the skills cannot tell us

### 7.1 · The skills are not Compose skills

The installed set is `apple-design`, `animation-vocabulary`, `find-animation-opportunities`,
`improve-animations`, `animate`, `review-animations` — plus `animate-expo`. **`animate` targets the
web** (CSS transitions, Framer Motion) and **`animate-expo` targets React Native Reanimated. Neither
targets Jetpack Compose.** So they supply the **principles, the audit categories and the finding
vocabulary** — which is what produced the Mac's MA-1…MA-7 — and the *values* must be translated by
hand into `tween`, `spring`, `CubicBezierEasing` and `Animatable`. Stated here so nobody later reads
"the skills were used" as "the implementation guidance was followed literally".

### 7.2 · Reduced motion — the mechanism, and why it is a measurement rather than a claim

Android's user-facing switch is **Settings → Accessibility → Remove animations**, which sets
`Settings.Global.ANIMATOR_DURATION_SCALE` to `0`. Compose has a `MotionDurationScale`
`CompositionLocal`, and the Android `AndroidUiDispatcher` is documented to supply one from that
global.

**Whether that actually reaches `animate*AsState`, `AnimatedVisibility` and
`rememberInfiniteTransition` on this handset is NOT established and must not be claimed.** The Mac's
equivalent cost two findings — MA-3, where the global reduced-motion kill set
`animation-duration: .01ms` and thereby **froze a spinner mid-turn**, so it still read as a spinner
and conveyed nothing. An indeterminate spinner is exactly the case a duration scale of zero handles
worst.

**The stimulus that settles it**, to be run before any motion claim is written: toggle *Remove
animations* on the SM-S938B, then observe (a) a `AnimatedVisibility` disclosure, (b) an
`animateColorAsState` state change, (c) `CircularProgressIndicator`, and (d) a
`rememberInfiniteTransition` loop if one exists. **The prediction on the table is that (a)–(c) scale
and (d) does not**, because an infinite transition driven by `withFrameNanos` has no duration to
scale. **A prediction is not a reading.** Until it is taken, the plan carries an explicit
`LocalReducedMotion` read from `ANIMATOR_DURATION_SCALE` so the app can answer the setting itself,
and the reading decides whether that provider is load-bearing or belt-and-braces.

### 7.3 · What must not animate — ported unchanged

The Mac's §4 list, translated: **byte counts, transfer rates, the fingerprint, disconnected and error
states** (an error that moves is an error that nags), **static cards**, **disabled controls** (a
disabled control that responds is lying), **the Sidekick wordmark**, and **anything that moves
position under reduced motion**. Opacity and colour survive; transforms do not.

### 7.4 · Where Android needs motion the Mac does not

- **Predictive back.** `targetSdk 36` — this is Android's own transition and the app must not fight
  it. Currently `OnboardingScreen`'s `AnimatedContent` page swap has no back handling at all, so the
  hardware back gesture leaves onboarding rather than stepping a page. **That is a navigation defect
  found while reading for motion**, and it belongs in the pairing batch.
- **Bottom-bar / nav destination change**, which is the Mac's nav-pill story on a different axis.
- **The press.** `Modifier.clickable` gives ripple and no scale. The Mac's asymmetric 100/160 press
  needs an explicit `InteractionSource` + `animateFloatAsState` with two durations, in **one**
  reusable modifier — because the Mac's MA-1 was *134 of 265 buttons snapping their press* from
  exactly the mistake of expressing it per-component.

---

## 8 · Step 2 — the connect-a-Mac flow, and the one place simplifying it *would* weaken security

### 8.1 · The two pairing paths, and why the brief's fingerprint instruction is right about one and dangerous about the other

The brief says: *"Replace raw fingerprint/key display with a short, friendly device identity… while
keeping the real fingerprint available only in an Advanced or Details area."*

**That is correct for the Mac path and must not be applied to the Sync path.** This app has two
pairing mechanisms with two different trust models, and `docs/defects.md` 63 exists because a
sentence describing one of them sat four pages from the other with nothing saying which.

| | **Mac path** (v2, QR) | **Sync path** (v1, Android↔Android) |
|---|---|---|
| Where | `QrScanScreen` → `completePairing`; `LinkRoute` | `PairingRequestDialog` in `DevicesScreen.kt` |
| How trust is established | the Mac draws a QR, the phone scans it, **the fingerprint inside the code is pinned** | **trust on first use** — both users read an 8-group `displayFingerprint` and compare them by eye |
| What the user does with the fingerprint | **nothing.** They never see it during pairing | **the comparison IS the authentication** |
| Where it appears afterwards | `Key <16 chars>…` on a paired-Mac row — **diagnostics** | on the dialog, at `titleMedium` in `FontFamily.Monospace` |
| Safe to move behind *Details*? | **Yes.** It is a diagnostic, and nothing is weakened | **No. Hiding it removes the only defence against a man in the middle on the local network** |

**So Step 2's fingerprint simplification applies to `LinkRoute` only.** `PairingRequestDialog` keeps
its fingerprint at full prominence and gets *more* legible, not less — grouping, mono, and a plainer
instruction than *"Only accept if you started this on the other device, and the key below matches the
one it is showing."* **Restyling it is in scope. Demoting it is a security downgrade and is refused**
under the brief's own boundary (*"the pairing/security mechanism itself must not become less
secure"*).

### 8.2 · The flow

**One entry point.** Today the path to a Mac is a third bottom tab called `Mac`. It becomes a named
action — **`Connect a Mac`** — reachable from an overview surface and from the first-run flow, and the
tab-shaped destination becomes the *details* screen described in 8.5. **A settings-like tab is not an
entry point**; that is the brief's core complaint and it is correct.

**Three steps, in the user's words, and the numbers are what the phone actually knows:**

| Step | Copy | What drives it |
|---|---|---|
| 1 | **Open Sidekick on your Mac** — it will show a code | standing copy; no state |
| 2 | **Point your camera at the code** | `QrScanScreen`, states A10–A14 |
| 3 | **Done — connected to <Mac name>** | `LinkWaitStatus.Connected` |

**Nothing about protocols appears in any of the three.** Replacement copy for what is there today:

| Today | Becomes |
|---|---|
| `Ports 42501, 42502, 42503 · protocol v1` | stays, **inside Details** — it has earned its place in this project's own testing a dozen times |
| `Scan pairing code` | `Connect a Mac` |
| `Pair another Mac` | `Connect another Mac` |
| `Key 3030c8ebcddcd0fb…` (a paired Mac) | the Mac's **name** + a small identity badge; the key in Details |
| `Forget` | `Disconnect this Mac` with a confirmation naming what stops working |
| `Start / Restart listening` | Details only. The phone listening is not a user concept |
| `Available to the Mac: sms, calls, …` | Details only, and as **Sidekick capability rows** (component 20) rather than a namespace list |

**Protocol language is moved, never deleted** — the brief's own rule, and this repository's.

### 8.3 · The four wait states, which already exist and only need drawing

`LinkWaitStatus` is rendered as four **visibly different** states rather than four sentences in one
grey card. Today B2 and B3 differ only by a paragraph appearing, and B1/B2/B3 share `surfaceVariant`.

| State | Tone | Copy |
|---|---|---|
| `Waiting`, < 20 s | neutral, quiet spinner | *Waiting for your Mac* |
| `Waiting`, ≥ 20 s | **warning** | the existing hint — *"If it stays like this, check that your Mac is awake and on the same Wi-Fi as this phone."* Its hedge is deliberate: the phone **cannot** tell J2 from J6, and the honest sentence for a state you cannot separate from its lookalike names the lookalike |
| `Refused` | **warning, not failure** | the existing sentence with the key prefix. Handoff §6: *a phone that has not paired yet has not failed* |
| `Connected` | **live / lime** | *Connected to <name>* |

**Failure is amber, never red.** Ported from handoff §6's pairing rule, for the same reason.

### 8.4 · Plain descriptions of what is actually happening

| Instead of | Say |
|---|---|
| Wi-Fi Direct *(on the Mac path — it is not the mechanism there)* | **Your phone and your Mac talk to each other directly over your Wi-Fi. Nothing goes through the internet.** |
| mDNS / discovery / listening | **Your Mac finds this phone on the network by itself.** |
| certificate / fingerprint / TLS pinning | **The code you scanned is what lets these two recognise each other. Nothing else can connect.** |
| `SSLV3_ALERT_CERTIFICATE_UNKNOWN` | **This Mac's identity has changed — reinstalling Sidekick on it does that. Scan its new code to reconnect.** Machine code in Details |

The existing security sentence in `OnboardingCopy.welcome` is already right and stays:
*"Pairing is a code you scan once. The certificate behind it is pinned, and every connection after
that is checked against it — an unpaired device is refused without asking you anything."* It survived
defect 63 by naming its path.

### 8.5 · Where the technical detail goes

The current `Mac` tab becomes **Advanced / This Mac**, reached from the connected state, not from the
bottom bar. It holds, in Sidekick surfaces: paired Macs with names and keys, the ports and protocol
version, last disconnect, **the capability list as component-20 rows**, the background-restriction
card, and the listening control. **Nothing from Advanced is deleted.**

**One thing must not move into Advanced: B7, the background-restriction card.** It is the one wall
the phone raises on its own, and `LinkRoute`'s own comment cites defect 85 for keeping it at rest —
*a card carrying a state has to be visible where the person is, because somebody asking "why did
mirroring not start" does not open Advanced to find out whether an answer exists.* It stays in the
connected state's body, drawn only while the restriction is set.

### 8.6 · What still cannot be told apart, and is not this redesign's to fix

`docs/phase-7-pairing-flow.md` §3.3, rows **J6** (scanned, wrong network) and **J2** (scanned, Mac
still searching): **both are silence on the accept loop and nothing on the phone can separate them.**
The 20-second hint is the honest treatment and it is already built. **No copy change makes this
better**, and any wording that reads as a diagnosis would be a confident guess rendered as a fact.
Stated here so the flow redesign does not try.

---

## 9 · The largest structural finding — six colours, fourteen meanings

### 9.1 · The measurement

`docs/empty-and-failure-states.md` records the Mac's version of this as its largest named design
debt: *84 states, 19 panes, five competing vocabularies*, settled by component 11 and finished by D67
(*"one state system, two layouts"* — five vocabularies and 32 CSS rules deleted). **The phone has the
same debt, undiagnosed, and its measurement is this:**

**Fourteen distinct drawn treatments of "something is absent, limited or broken":** `EmptyDevicesCard`,
`InfoCard`, Transfers-empty, `NoFoldersCard`, `WallCard`, Feed-listener-off, Feed-mirroring-off,
Feed-empty, Clipboard-nothing-yet, Mirror `StateCard`, `LinkRoute` status card, the
background-restriction card, `PermissionCard`, `NoteCard`. **Plus `FeatureUnavailableScreen`, which
is written for exactly this job and has zero call sites.**

**Carried on six M3 container roles, with no rule about which means what:**

| Role | Uses | Meanings it currently carries |
|---|---|---|
| `surfaceVariant` | 10 | neutral info · loading · granted · ready · stopped · a stale folder grant |
| `tertiaryContainer` | 5 | **no Wi-Fi Direct radio (info)** · **the `Download` platform wall** · **notification access off (permission)** · **"some manufacturers need more" (warning)** · a paused transfer |
| `errorContainer` | 5 | a refused connection (failure) · background-restricted (a wall) · a failed transfer (failure) · **mirroring turned off in settings** · the master switch being off |
| `secondaryContainer` | 4 | paired · connected · clipboard received |
| `primaryContainer` | 3 | device connected · mirror awaiting your tap · master switch on |
| `surface` | 1 | a permission not yet granted |

**Two rows are defects on their face, not merely inconsistencies:**

1. **`errorContainer` for *"All mirroring is turned off. Turn it back on in Sync settings."*** That is
   **the user's own setting**, drawn in the failure colour. A deliberate choice rendered as a
   malfunction. `NotificationsScreen.kt` — and the master switch does the same thing in
   `SyncSettingsScreen.kt`.
2. **`tertiaryContainer` for a platform wall and for a permission prompt.** The `Download` wall can
   *never* be acted on — handoff §5's `Wall` kind takes **no retry, ever, because there is nothing to
   retry** — and notification access is one tap away. Same colour, opposite actionability.

### 9.2 · The fix — decisions 5 and 6, and the structural problem in executing 6 literally

**Decision 6 says consolidate onto `FeatureUnavailableScreen` rather than invent a third pattern.
Read literally that cannot be done, and the reason is worth stating before the fix.**

```kotlin
fun FeatureUnavailableScreen(title: String, reason: String, detail: String) {
    Scaffold(topBar = { TopAppBar(title = { Text(title) }) }) { padding -> … }
}
```

It is **a full-screen `Scaffold` with its own `TopAppBar`**, taking three strings and carrying **no
kind, no tone and no action slot**. The fourteen treatments are **cards inside `LazyColumn` items**.
A `Scaffold` nested in a list item draws a second app bar and consumes the status-bar inset twice — so
using it as it stands would convert fourteen inline explanations into fourteen navigations, and would
still be unable to express decision 5's tones or the `Wall` / `Permission` split.

**So it is evolved, keeping that file and name as the one home — which is the Mac's own D67 answer,
"one state system, two layouts", cited in the decision itself.** Approved as such.

| Part | What |
|---|---|
| **Six kinds** | `Empty` · `Unavailable` · `Loading` · `Permission` · `Error` · `Wall`. Because *nothing here*, *this cannot work* and *this failed* are different facts |
| **One tone map** | `toneOf(kind)` → `Neutral` / `Amber` / `Red`, in **one** place, an exhaustive `when` on a sealed kind, so the compiler refuses a seventh variant nobody gave a tone |
| **Two layouts** | `Pane` — today's full-screen shape, and `FeatureUnavailableScreen` survives as a thin wrapper over it, so its intended use finally has a caller. `Inline` — a card for a list item, which is what the fourteen become |
| **`Wall` takes no action, ever** | There is nothing to retry. Handoff §5 |
| **`Permission` takes exactly one** | And only because the user can act |

**Decision 5 applied, the two defects by name:**

| Was | Becomes |
|---|---|
| *"All mirroring is turned off. Turn it back on in Sync settings."* in **`errorContainer`** — the user's own choice drawn as a malfunction | kind `Empty`, tone **Neutral**. Same for the master switch in `SyncSettingsScreen.kt` |
| The `Download` platform wall and *"Notification access is off"* sharing **`tertiaryContainer`** | the wall is `Wall`/**Amber with no action**; notification access is `Permission`/**Amber with one action**. Same tone, opposite actionability — and the difference is now in the *kind*, the action and the copy rather than in a colour they happened to share |

**And the test asserts the projection, not the absence of the bad colour.** The Mac learned this from a
mutation: a check for *contradicting labels* passed with the defect fully restored, because a distance
is a claim about two things and either can move. The Android form is
`assertEquals(expectedTone, toneOf(kind))` against the **production** function — one sentence
constrained by itself, no second party that can drift.

**One rule ports with it and constrains the work: a state that cannot be reached must not be drawn**
beside states that can. `FoldersScreen`'s doc comment already gets this exactly right —
`persistedUriPermissions` is in-process and synchronous, so the screen *cannot* fail to load, and an
`Error` card there would be unfalsifiable forever. **Four kinds on that screen, and `Error` is not one
of them.**

---

## 10 · Prioritised implementation order

**Nine batches. Batch 1 is new — decision 12 puts the phone rename before everything visual.** Each
ends at a stop for approval.

**Why the rename goes second rather than last.** It is a **string-and-resource pass with a clean
diff**, it is independently revertible, and it **unblocks the Mac side**: about twenty of the Mac's
stale sentences are `fixHint` strings the *phone* authors, so renaming here fixes them at the source
and shrinks the Mac diff before anyone scopes it (decision 12). Doing it after the visual work would
mean touching the same files twice and reviewing a string change inside a structural one.

**Batch 0 — the test instrument, and nothing else (decisions 7, 17).** `ui-test-junit4`,
`ui-test-manifest`, Robolectric, `isIncludeAndroidResources = true`, and one test that renders one
existing screen and asserts one thing about it. **Gated on a red-first proof** (§12.1): shown to fail
against a deliberate break before it is trusted. Ships no UI change. **If the combination does not
work at Compose BOM `2025.09.00` / AGP `8.13.1` / Kotlin `2.2.20`, this batch stops and reports.
There is no silent fallback** — decision 17.

**Batch 1 — the rename, phone-side and complete (decisions 8, 12, 13).** The full surface in Appendix
A: 56 Kotlin lines, 8 resource strings, `app_name`, `app_display_name`, `input_service_label`. One
commit, all five modules, **strings only** — no layout, no structure, no logic. Verified by
`./gradlew test` (`OnboardingCopyTest` already guards part of it) and by the must-not-change list in
A.4, which is the half that matters. **The launcher icon stays the old blue mark until Batch 7**, so
the app is briefly named Sidekick under a ConnectSuite icon; stated rather than discovered.

**Batch 2 — the design system foundation.** `SidekickColors` / `Typography` / `Dimens` / `Motion` /
`Theme` in `core/`; **`dynamicColor` deleted** (§5); dark and light complete; the M3 `ColorScheme`,
`Typography` and `Shapes` mapping so stock components follow; `SidekickIcons` +
`iconNamesUsedByTheApp()` from **Material Symbols, restyled** (decision 9); the one press modifier.
`ConnectSuiteTheme` kept as a deprecated alias for one batch. **Nothing else moves.** Highest-risk
batch — it changes every pixel at once, and the verification is a screenshot of every state in §2 that
can be produced.

**Batch 3 — the connect-a-Mac flow (§8), and the navigation change decision 10 settles.**
`Connect a Mac` becomes a named action; today's `Mac` tab becomes the link screen (status, then
Advanced/Details); **no overview screen is added.** Onboarding page 5, `QrScanScreen`, the four wait
states as four visibly distinct states, the Mac-path fingerprint into Details (decision 3),
`PairingRequestDialog` restyled with its fingerprint **kept prominent** (decision 2), and
predictive-back on the onboarding pager.

**Batch 4 — the state system (§9.2, decisions 5 and 6).** Before the daily screens, because it touches
all of them and every later batch consumes it. `FeatureUnavailableScreen` evolved into one system with
two layouts; the six kinds, the one tone map, the two colour defects fixed.

**Batch 5 — the primary daily screens.** Devices/Sync overview, Transfers, Folders. Real transfer
behaviour, resume and SAF grant semantics **untouched**; presentation and wording only. **Wi-Fi Direct
copy stays where it is true** (decision 4).

**Batch 6 — the secondary screens.** Clipboard — the Android background-read wall in the Sidekick
voice, and it is a **`Wall`**, not an error — Feed, Mirror controls, Sync settings.

**Batch 7 — app icon and branding (§11.4).** Adaptive foreground / background / **monochrome**
(today's points at a three-colour vector, which is wrong by definition) and the 48 dp legibility
reading. **Needs a device** (§0.2).

**Batch 8 — motion polish (§7).** The reduced-motion reading **first**, then the vocabulary, then a
sweep. **Needs a device.** The Mac's MA-7 is why the sweep is separate from the application: reading a
stylesheet found 8 snapping selectors and running the app found 3 more plus 2 at the wrong duration.

**After Batch 1, outside the chain — the Mac re-scope (Appendix B).** Re-enumerated against whatever
the phone rename left, then brought to you before anything is edited. Its own clearly-labelled commit.
**Decision 13's ordering constraint binds it**: the Mac's *"Sidekick Input"* sentence may not ship
before `input_service_label` does.

---

## 11 · Risky — each needs separate approval before it is touched

### 11.1 · The rename — decided as a re-skin, and a count of mine that was wrong

**Decisions 1 and 8: the user-visible name becomes Sidekick; `applicationId` stays
`com.chetan.connectsuite`.** So the identity break revision 1 warned about **does not happen**, and
this section is now a copy change plus one resource string. Recorded for the next person, because the
warning is still true of the road not taken:

> Changing `applicationId` would be a new app — new Keystore, new hardware-backed P-256 identity, and
> an empty Room database, trust store, folder-grant set, notification-listener binding and
> accessibility binding, with the old app still installed beside it. The Mac already spent one
> re-pair on exactly this: its `appId` change to `com.chetan.sidekick.desktop` re-keyed its
> `safeStorage` TLS key and the paired SM-S938B returned `SSLV3_ALERT_CERTIFICATE_UNKNOWN` — observed,
> not predicted (`docs/design-departures.md` → *The rename*).

**Four things stay, and decision 1 settles all four:**

| Stays | Why it would have broken |
|---|---|
| `Link.SERVICE_TYPE = "_connectsuite._tcp"` | the Mac's `shared/protocol.ts` still says `SERVICE_TYPE = 'connectsuite'`. Renaming one side ends discovery |
| `FsPaths.DOWNLOADS_ROOT_ID = "downloads:connectsuite"`, `RELATIVE_PATH = "Download/ConnectSuite/"` | the Mac keys the Files rail on that root id, and changing the path is **a folder move on the user's phone** that orphans every file already received |
| `applicationId` | the paragraph above |
| `input_service_description` | the **trust copy** a user reads before granting an accessibility service. Its *wording* is a consent surface and is not touched |

**What changes:** `app_name`, `app_display_name`, every in-app sentence, the notification channel
names, the launcher icon — **and `input_service_label`, which §11.1a shows is not optional.**

#### 11.1a · The count, corrected — and the coupling it exposed

**Revision 1 said "ten Mac-side user-facing strings". That figure was typed, not counted, and it is
wrong in two directions at once.** Counted with a script rather than by hand:

```
$ python3  # count 'ConnectSuite' per line at each grep hit
TOTAL: 11 lines, 13 occurrences of the word
```

**11 lines, 13 occurrences, and "ten" was neither.** This is the units failure `CLAUDE.md` records
against `query-activities` — *246 activities against 123 packages* — committed in a document that has
a section about it. The unit is named from here on: **lines** where a line is edited, **occurrences**
where the word is replaced.

**And two of the eleven are not in scope, for two different reasons:**

| Line | Occ. | What it actually names | In scope |
|---|---|---|---|
| `clipboard.ts:352` | 1 | the phone app | **yes** |
| `clipboard.ts:353` | **2** | the phone app | **yes** |
| `clipboard.ts:611` | 1 | the phone app | **yes** |
| `float.ts:338` | 1 | the app **as listed in Accessibility settings** | **yes** — and see below |
| `float.ts:361` | 1 | same | **yes** — and see below |
| `float.ts:676` | 1 | the literal label **"ConnectSuite Input"** | **yes** — and see below |
| `mirror.ts:996` | 1 | `Settings > Accessibility > Installed apps > ConnectSuite Input` | **yes** — and see below |
| `renderer.ts:519` | 1 | the literal label **"ConnectSuite Input"** | **yes** — and see below |
| `renderer.ts:2058` | **2** | **the Mac's own former name, and a real path on disk** | **NO — excluded** |
| `index.html:179` | 1 | the phone app — **and two Android labels this redesign renames** | **yes, partly deferred** |
| `pairCard.ts:72` | 1 | **a doc comment**, not display text | **no — optional** |

**`renderer.ts:2058` must not be touched, and it is the sharpest thing in this section.**

```ts
// Earlier downloads: ConnectSuite saved into `~/Downloads/ConnectSuite` before the rename, and
// those files stay exactly where they are.
'Files saved by ConnectSuite remain in ~/Downloads/ConnectSuite.',
```

That *"ConnectSuite"* is **the Mac app's own former name** — the comment directly above says so — and
the second occurrence is **a real folder on the user's disk**. Rewriting it to *"Files saved by
Sidekick remain in ~/Downloads/Sidekick"* would be **false twice**: those files were saved by the app
when it was called ConnectSuite, and no such folder exists. The authorization was scoped to strings
*"wherever they refer to the Android/phone app's name"*, and this one does not. **It is the two-paths
problem again** — one word, two referents, and only one of them is the phone.

**`pairCard.ts:72` is a doc comment.** The rules say *plain display-text/copy changes only*, so
strictly it is out. Left unchanged it becomes prose describing a string that no longer reads that way.
**Offered as optional, not taken on my own.**

**The coupling, and it is why the Mac change is incomplete alone: five of the nine in-scope lines name
the accessibility service label**, which lives in `input-module/src/main/res/values/strings.xml` as
`input_service_label = "ConnectSuite Input"`. Renaming only the Mac copy tells the user to look for
**Sidekick Input** in a system Settings list that still reads **ConnectSuite Input** — a *worse*
defect than the stale name, because it sends them hunting for something that is not there. **So
`input_service_label` → `"Sidekick Input"` ships in the same change.** That is an Android resource
string, inside the layout/theme/copy/resource boundary.

**`index.html:179` needs two edits and only one of them is now.** It reads *"Open ConnectSuite on the
phone, go to the **Mac** tab, tap **Scan pairing code**"* — and §8.2 renames both of those Android
surfaces (the `Mac` tab becomes the link screen, `Scan pairing code` becomes `Connect a Mac`).
**Recommendation: swap the app name now, and leave the tab and button names until Batch 2 actually
renames them**, because instructing the user toward labels the phone does not yet have would make the
Mac wrong in a new way rather than a stale one.

**That accounting was itself incomplete.** The grep behind it covered `desktop/src/renderer/` only;
the rename surface also includes `src/shared/` and `src/main/`. **Corrected: 15 in-scope Mac lines
across 7 files, 8 that must not change, one that needs a wording call, and four tests that assert
strings the change would touch — beside a phone-side surface of 56 Kotlin lines plus 8 `strings.xml`
entries.**

**Decision 12 then re-sequenced it: the phone goes first.** About twenty of the Mac's stale sentences
are `fixHint` strings the *phone* authors, so Batch 1 fixes them at the source and the Mac diff
shrinks before anyone scopes it. **Appendix A is the phone rename; Appendix B is the deferred Mac
half.** Nothing on either side is applied.

### 11.2 · Permissions — nothing is removed, and one thing must not be re-asked

No permission is added or removed. Two specifics:

- **`NEARBY_WIFI_DEVICES` stays in the manifest and stays out of the Mac flow.** Defect 69 removed it
  from onboarding after measuring that the v2 link works without it; Sync still needs it and still
  asks. A redesign that "tidies" the manifest would break Sync silently.
- **The battery-optimisation prompt must not be offered as the fix for a background restriction.**
  `BackgroundRestriction`'s doc comment names this as a wrong fix, twice: they are different
  switches, this app already holds the exemption, and it is restricted anyway. Sending someone to a
  toggle they have already turned on is the mistake with a new subject.

### 11.3 · Protocol-level renaming — none, and the guard that enforces it

`docs/protocol.md` is untouched. No message type, namespace, capability name, IPC channel or port
changes. This is a **rendering and vocabulary** change on the phone, exactly as the Mac's was. The
existing commit hooks (`check-protocol-spec.mjs`, `check-defects.sh`, `check-apps-verb.mjs`,
`check-suites-run.mjs`) all still apply and all still run.

### 11.4 · The app icon, and the reading that has to come before the drawing

`LOGOS/main_logo.png` is **1254 × 1254, the mask on a cream `#EFEDE6` squircle — an app-icon tile**.
`LOGOS/head_logo.png` is **1774 × 887, the mask alone, fully transparent**. Neither contains the word
*Sidekick*.

**Android's adaptive icon cannot take either file as-is, and resizing the Mac's `.icns` is explicitly
out.** The system masks the foreground to a shape the OEM chooses and **only the centre 66 dp of the
108 dp canvas is guaranteed visible** — the outer ring is parallax and crop. So:

- **background layer** — a flat Sidekick ground. `#0A0A0A` is the honest brand value; whether a
  near-black tile is *legible* in a launcher folder is a reading, not an opinion.
- **foreground layer** — the mask from `head_logo.png`, **inside the 66 dp safe zone**, redrawn as a
  vector rather than a resized raster.
- **monochrome layer** — required for Android 13 themed icons. Currently the manifest points
  `monochrome` at `ic_launcher_foreground`, **a three-colour vector**, which is wrong by definition.
- **The reading that gates the drawing:** `docs/sidekick-motion-system.md` §5 measured the mask at
  **1.09:1 against its own near-black sidebar** on the Mac, and the fix was *a shape against varying
  light*, explicitly **not** a contrast win. A launcher gives you no gradient and no hairline. **So
  the Mac's solution does not transfer, and the icon has to be measured at 48 dp before it is
  accepted** — which is the brief's own "legible at small launcher sizes", turned into a number.

**There are no raster launcher assets today** — only `mipmap-anydpi-v26/`, which is sufficient at
`minSdk 29` and is worth stating so nobody "fixes" a missing `mipmap-hdpi` that is correctly absent.

### 11.5 · Copy that is already load-bearing and must survive the voice pass

Six strings whose *current wording is the fix for a recorded defect*. Rewriting them in a friendlier
voice without reading the defect would reintroduce it:

| Copy | Defect |
|---|---|
| `OnboardingCopy.welcome.body[4]` — the security sentence | **63** — names its path on purpose |
| `"On your Mac"` as the first feature card title | **71** — it was titled *Sync*, and *Sync* is a different feature in the same app |
| The clipboard *"Android forbids every app…"* opener | names **whose** limit it is in the first clause, so it does not read as unfinished work |
| `BackgroundRestriction.NOT_THE_SAME_SWITCH` | **102** — exists because the two screens are one tap apart |
| `FoldersScreen`'s *"Files sent to this phone need no folder at all"* | a limit with no working case beside it reads as the feature being broken |
| `"I'll do this later"` rather than *Skip* | names the one situation it is for |

**And `OnboardingCopy.forbiddenMechanisms` will fail the build** on any copy naming `adb`, `tcpip`,
*wireless debugging*, *developer options*, *build number*, *another device's screen*, or *a key
confirmed on both screens*. That is a feature of the port, not an obstacle to it.

---

## 12 · Verification — and the instrument that does not exist

### 12.1 · The gap, measured — and what decision 7 puts in it

```
$ find . -type d \( -name test -o -name androidTest \) -not -path '*/build/*'
./app/src/test  ./core/src/test  ./input-module/src/test
./mirror-module/src/test  ./sync-module/src/test        # no androidTest, anywhere
```

| Module | Test files |
|---|---|
| `core` | 14 |
| `sync-module` | 28 |
| `mirror-module` | 5 |
| `input-module` | 4 |
| **`app`** — every screen a first-time user meets | **1** (`OnboardingCopyTest.kt`) |

**`androidTestImplementation(libs.androidx.junit)` and `espresso-core` are declared in five
`build.gradle.kts` files and there is no directory to put a test in.** No Compose UI test artifact
(`ui-test-junit4`, `ui-test-manifest`) appears in `gradle/libs.versions.toml` at all.

**This is defect 65, exactly, one module over** — *"the module with the only user-facing copy in the
product was the one module with no test source set"*. 335 phone tests and 288 Mac tests, and not one
could see a string in the onboarding flow. `app/` got a `src/test` then. **It still has no way to
assert anything about a composable**, and this redesign rewrites every one of them.

#### The shape, chosen to match how the Mac verifies its UI

Decision 7 asks for *whatever pattern is closest to how the Mac side verifies its UI*. The Mac uses
**three** layers, and the Android answer maps one-for-one:

| Mac | What it does | Android equivalent |
|---|---|---|
| `*.test.ts` on `src/shared/` | pure rules, no DOM | **plain JUnit on pure functions in `core/`** — already the pattern, already 450 tests |
| `scripts/probe.mjs` over CDP | reads the **rendered** tree of the **running app**, with a required control | **Robolectric + `createComposeRule()`** on the JVM — the real composable, really composed, its real semantics tree read |
| `scripts/shot.mjs` | the visual claim | `adb exec-out screencap` |

**Robolectric rather than an instrumented `androidTest`, for the reason the Mac's own guard exists:** a
test that needs hardware on the cable is a test nobody runs, and `check-suites-run.mjs` was written
because *a green is a statement about the suite that ran*. Robolectric puts the composable tests inside
the existing `./gradlew test`, so the 450 becomes 450 + n and one command still answers for all of it.

**Artifacts:** `androidx.compose.ui:ui-test-junit4`, `androidx.compose.ui:ui-test-manifest`
(`debugImplementation`), `org.robolectric:robolectric`, and
`testOptions { unitTests { isIncludeAndroidResources = true } }`.

#### The gate, because this is a claim I have not yet proven

**I have not run a Robolectric Compose test in this project and will not assert that this combination
works** at Compose BOM `2025.09.00` / AGP `8.13.1` / Kotlin `2.2.20` until it has. Batch 0 exists to
find out, and it is gated the way this repo gates everything:

- **Red first, against a real break.** The first test renders a screen and asserts one visible fact;
  the fact is then broken in the production composable and the test must go red. **A test that cannot
  fail is the same shape as an empty accessibility query** — it reads as evidence and is not.
- **`isIncludeAndroidResources` is the thing most likely to bite**, because without it a composable
  reading a string resource throws rather than fails, and a thrown test and a failing test are
  different findings.
- **The `Telephony` lesson still applies.** A JVM test that merely *references* an object holding an
  Android static in a field initializer dies with `ExceptionInInitializerError`; `SmsStore` does.
  Robolectric changes that calculus but does not repeal it, and the answer is still *move the pure part
  out*, never `returnDefaultValues = true`.

**If Batch 0 cannot be made to work, it stops and reports — decision 17.** There is no silent
fallback, and the distinction is the point: quietly dropping to screenshots would leave every later
batch making composable claims backed by nothing, in a document that reads as though a test suite
stood behind them. That is `check-suites-run.mjs`'s own lesson — *a green is a statement about the
suite that ran* — with the suite absent instead of unrun. **The failure gets reported with the error,
and the route is chosen then, by you.**

### 12.2 · What ports as a rule rather than a tool

Four Mac verification rules apply unchanged, and each has already cost this project a defect:

- **A card carrying a state must be visible at rest, not merely reachable** (defect 85 — excellent
  copy at 828 px in an 865 px window, 21% on screen). On a phone this is sharper, not softer: the
  viewport is smaller and there is more scrolling. `LinkRoute`'s restriction card already obeys it.
- **Prove the query returns a known positive before believing a negative.** For a
  `uiautomator dump` that means confirming nodes you know are present come back, before reading
  anything into an absent one.
- **Never drive the phone by coordinates when a named target exists.** `FoldersScreen` already carries
  `contentDescription` on its chips and Remove buttons for exactly this reason, and its comment says
  so. Every new control gets one.
- **Report the effect, not the stimulus.** A screenshot after a tap is not evidence the tap landed.

### 12.3 · Per batch

1. `./gradlew :app:assembleDebug` and `./gradlew test` — the phone suite stands at **450**.
2. `./gradlew lint`.
3. The commit guards. `check-defects.sh` and the other fourteen hooks are unchanged and still run.
4. Install through the pin — **`adb -s "$(scripts/target-device.sh)" install -r`**, or
   `scripts/adb-pinned.sh`. An install is a **state change** and a signed APK was once issued at an
   OPPO CPH1859 that had replaced the Samsung on the cable; what stopped it was `minSdk 29` against
   an SDK 28 device, which was an accident rather than a check.
5. Screenshots, dark **and** light, of every state in §2 that can be produced. `adb exec-out screencap`
   is a read and may stay loose.
6. Record the batch in `docs/testing.md` with its controls; record deviations as departure rows in the
   same commit.
7. **Stop for approval.**

### 12.4 · Pending manual verification — marked pending, never claimed

| # | What | Why a screenshot cannot settle it |
|---|---|---|
| 1 | Real pairing, end to end | needs the Mac drawing a code and this phone scanning it. **And note the Mac's `appId` change means the current pairing may already be stale** |
| 2 | `LinkWaitStatus.Refused` | needs an unpaired Mac to actually dial in |
| 3 | The 20-second hint | needs 20 s of real silence; the branch is unit-tested, the *screen* is not |
| 4 | **Mirror `RUNNING` (state D6)** | **defect 100 is open: the mirror has never survived its own start on this handset.** The encoder reaches `RUNNING`, the FGS ends 106–116 ms in, and no log in this repo has ever shown a frame. **D6 cannot be screenshotted today and must not be presented as built-and-seen** |
| 5 | Background-restricted (B7) | One UI sets it on its own; it cannot be requested |
| 6 | Every permission-denied state | needs grants revoked by hand, one at a time |
| 7 | Transfers: paused / resumed | needs a real interruption, and the probe must report bytes **delivered** (defect 56) |
| 8 | Clipboard phone→Mac | only happens in the moment the app comes to the front |
| 9 | Reduced motion (§7.2) | **the reading that gates every motion claim** |
| 10 | Icon legibility at 48 dp | a launcher on a real device, not a preview |

---

## 13 · What remains open

**Every decision is taken (§0.1). What is left is two dependencies and one reading I want confirmed.**

| # | Open | Blocks | Who clears it |
|---|---|---|---|
| 1 | **Figma authorization** | finalizing §3's per-screen reference class. **Blocks no batch** — all nine proceed on *built to the handoff* | you. Fresh URL in the covering message; §3.1 runs the moment the real tools appear |
| 2 | **A device on the bus** | Batches 7 and 8, every screenshot, the reduced-motion reading (§7.2), the 48 dp icon reading (§11.4), all ten rows of §12.4. **Batches 0–6 need no device** | you. §0.2 says why this looks like a cable rather than a setting |
| 3 | **My reading of decisions 14 and 15 against each other** (Appendix B.2) — 14 says `renderer.ts:2058` stays unchanged, 15 rewords that same line. I have read them as *do not rename it, do reword it*, which is coherent and is the better sentence | one line in the deferred Mac pass | you, if my reading is wrong |

**Sign-off asked for on:** revision 3 as a whole, and **Batch 0** as the first thing to run.
Batch 0 touches no UI, ships no string, and answers the one question that decides whether every later
batch can say *tested* or must say *unproven* (decision 17).

---

## 14 · What this plan does not do

- **It has changed no Android code and no Mac code.** The only file edited outside this plan is
  `PRODUCT.md`, by decision 18, which stopped it claiming the Android app was out of scope for design.
- **The Mac half is deferred, not resolved** (Appendix B). Decision 12 sequenced the phone first
  precisely so the Mac exception can be re-scoped against a smaller, measured diff — and the earlier
  ten-line and fifteen-line patches are both unapplied.
- **It does not change the protocol, a port, a namespace, a capability name, or `docs/protocol.md`.**
- **It does not weaken pairing.** §8.1 refuses the one part of the brief that would.
- **It does not remove a permission or a capability.**
- **It does not claim Figma parity for anything.** §3.
- **It pushes nothing.**

---

## A · Appendix A — the phone rename, Batch 1

> **Decision 12: the phone goes first.** This is the complete Android surface. Nothing here is
> applied; it is the spec Batch 1 executes on approval. The Mac half is **Appendix B**, deferred and
> re-scoped afterwards.

**Why the enumeration rather than a patch:** `CLAUDE.md`'s defect 28 was believed to be two copies of
a raw package name and turned out to be **three**, *"found only by enumerating rather than fixing the
one on screen"*. Revision 1 made exactly that mistake on the Mac side. This is the enumeration.

**Measured:** `grep -rn ConnectSuite --include='*.kt'` over the five modules, comments and
`src/test/` excluded, quoted literals only → **56 lines**. Plus **8 `strings.xml` entries**.

### A.1 · Ordinary copy — renamed

Every user-facing sentence naming the app. `OnboardingCopy.kt` ×4 (including `title = "ConnectSuite"`,
the welcome headline) · `QrScanScreen.kt:98` · `FoldersScreen.kt` ×3 · `DevicesScreen.kt:270` ·
`ClipboardSection.kt:157` · `ClipboardCopy.kt:57` · `TransfersScreen.kt` ×2 ·
`NotificationsScreen.kt:64` · `InputOnboardingCard.kt:93` · `NotificationChannels.kt:65` ·
`AppPermissions.kt:29` · `BackgroundRestriction.kt:54` · `MirrorNotifications.kt:52` ·
`MirrorStopReason.kt:142` · `FsPartials.kt:191` (a **user-visible sidecar file** written beside a
failed transfer — it names the app, so it renames).

**`OnboardingCopy.kt` is guarded**: `OnboardingCopyTest` runs `forbiddenMechanisms` over the page list
and will keep running. The rename adds no forbidden mechanism, so it should stay green — **and if it
does not, that is a finding rather than a test to edit.**

### A.2 · `fixHint` and `reason` strings — renamed here, and this is what fixes the Mac for free

~20 lines the **phone authors and the Mac only displays**: `AppsFeature.kt:205,207` ·
`ContactsFeature.kt:193` · `CallFeature.kt:336` · `SmsFeature.kt:545` · `MediaFeature.kt:277` ·
`FsFeature.kt:691` · `FsRoots.kt:37` · `NotificationFeature.kt:387,410` ·
`NotificationDelivery.kt:61` · `RemoteFeature.kt:601` · `ClipFeature.kt:352,354` ·
`MirrorFailure.kt:66` · `MirrorEngine.kt:1116,1119` · `InputFailure.kt:38,40`.

**These are the reason decision 12 sequences the phone first.** The Mac never wrote them; it renders
whatever arrives on the wire. Renaming them here corrects the Mac's display with no Mac edit at all —
which is why Appendix B cannot be scoped until this batch lands.

**Any Mac test asserting one of these is a fixture, not an assertion about Mac behaviour**, and is
updated in the same commit as the string (decision 14).

### A.3 · Resource strings — renamed, including the one decision 13 pins

| File | Key | Note |
|---|---|---|
| `app/.../values/strings.xml` | `app_name` | the launcher label |
| `core/.../values/strings.xml` | `app_display_name` | |
| `core/.../values/strings.xml` | `pairing_request_text`, `pairing_request_big_text` | the **Sync path** pairing notification. Its fingerprint stays exactly as it is (decision 2) — only the app's name changes |
| `sync-module/.../values/strings.xml` | `notification_listener_label` | |
| **`input-module/.../values/strings.xml`** | **`input_service_label`** → `"Sidekick Input"` | **decision 13.** Five Mac sentences name this exact label; the Mac's version may not ship before this does |
| `input-module/.../values/strings.xml` | `input_service_description` | names the app **twice in its body**. **The name changes; the sentences do not.** It is the consent copy read before an accessibility grant, and its wording is not ours to improve in a rename pass |

### A.4 · Must not change — the half that matters

| Line | Why |
|---|---|
| `Link.SERVICE_TYPE = "_connectsuite._tcp"` | the Mac's `shared/protocol.ts` still says `'connectsuite'`. Renaming one side ends discovery |
| `DeviceIdentity.kt:112` — `X500Principal("CN=$deviceId, O=ConnectSuite")` | the **TLS certificate subject**. Minted once into the Keystore, so a change would not break an existing pairing — and there is no reason whatever to touch identity in a copy pass |
| `FsPaths.APP_ROOT_LABEL`, `DownloadsStore.RELATIVE_PATH`, `ReceivedFileStore` `"/ConnectSuite"` | **real paths.** Renaming is a folder move on the user's phone that orphans every file already received |
| `LinkLog.TAG = "ConnectSuiteLink"` | a logcat tag. Every script and every reading in `docs/testing.md` greps it |
| `LinkService.kt:203,228,243` wake-lock and wifi-lock tags | machine handles that appear in `dumpsys`. Defect 61's readings are keyed to them |
| **`MirrorEngine.kt:587`** — `createVirtualDisplay("ConnectSuite", …)` | a system display name. Low-risk in principle — **and defect 100 is open on this exact code path.** Editing `MirrorEngine` while the mirror has never once survived its own start would put a confound into the one investigation that cannot afford another |

### A.5 · Two judgment calls, with the reading behind each

**`NsdAdvertiser.kt:59` — `serviceName = "ConnectSuite $deviceName"` — rename it.** Verified safe
rather than assumed: **both** Mac browsers were checked. `discovery.ts:79` filters on `SERVICE_TYPE`
alone and reads `service.addresses`; the F6/P3 pair-intent watcher at `discovery.ts:151` matches on
the **TXT record** via `pairIntentMatches(service.txt, ourFingerprint)` and only *logs* `service.name`.
**Neither matches on the instance name.** It is user-visible on the Mac as a pairing sighting, so it
renames. `_connectsuite._tcp` itself is untouched.

**`ClipFeature.kt:534` — `ClipData.newPlainText("ConnectSuite", text)` — rename it.** That argument is
the clip's human-readable label, which some Android surfaces show. It is a description, not a handle.

### A.6 · A pre-existing defect this enumeration turned up

**`DeviceRepository.kt:130` names the *Mac* app, and it has been wrong since 2026-09-17.**

```kotlin
"${device.name} is a Mac. Macs connect to the phone, not the other way " +
    "round — open ConnectSuite on the Mac instead.",
```

The Mac app was renamed to **Sidekick** on 2026-09-17. This sentence tells a user to open an app that
no longer exists under that name — **and it is stale independently of everything in this plan.** It
was invisible to the Mac's rename because it lives in Kotlin, and invisible to the phone's review
because a grep for "ConnectSuite" on the phone reads as *"our own name, correct"*.

**One word, two referents, one repository** — the same shape as `linkHealth.ts:89–90` on the Mac
(Appendix B.1), found from the opposite direction. Fixed in Batch 1 and worth a defect row of its own,
because the class is *a string naming the other half of the product by a name that half no longer
uses*, and nothing in either build can see it.

### A.7 · Verification for Batch 1

1. `./gradlew test` — the phone suite stands at **450**. A rename should move it by zero.
2. `OnboardingCopyTest` green, and **not** edited to accommodate the rename.
3. **The must-not-change list in A.4 asserted, not eyeballed** — one grep per row, each shown
   returning its expected value afterwards.
4. `./gradlew :app:assembleDebug`.
5. **No screenshot claim**: Batch 1 is strings, and §0.2 says there is no device anyway.


---

## B · Appendix B — the Mac half, deferred

> **Decision 12: not now.** The ten-line patch from revision 1 is **not applied** and the fifteen-line
> one from revision 2 is **not applied either**. This appendix records what is known so far, so that
> after Batch 1 the re-scope is a subtraction rather than a fresh investigation.

**Why it shrinks rather than moves.** About twenty of the Mac's stale sentences are `fixHint` strings
the **phone** authors (Appendix A.2). Batch 1 fixes those at the source with no Mac edit. **What
remains is only the copy the Mac wrote itself**, and it cannot be counted honestly until Batch 1 has
landed — which is the whole argument for this sequence.

### B.1 · What is already known, and will still be true after Batch 1

**Mac-authored, names the phone app — 15 lines across 7 files:** `renderer/clipboard.ts` 352, 353,
611 · `renderer/float.ts` 338, 361, 676 · `renderer/mirror.ts` 996 · `renderer/renderer.ts` 519 ·
`renderer/index.html` 179 · `shared/clipPhoneState.ts` 156, 211 · `shared/filesRoots.ts` 240 ·
`shared/linkHealth.ts` 80, 90, 131.

**`linkHealth.ts:83–90` — one constant, both referents, and a doc comment that the rename makes
false.** Decision 14 confirms the split:

```ts
/**
 * … "ConnectSuite on your phone" is correct — the Android app kept its name.   ← CORRECTED, same commit
 */
export const RENAME_REFUSAL =
  'Sidekick replaced ConnectSuite on this Mac and now uses a new security key. …
                    // ↑ the MAC's former name — STAYS
  … Open ConnectSuite on your phone and scan the new pairing code.';
                    //      ↑ the PHONE's name — CHANGES, once Batch 1 has landed
```

Two occurrences of one word, two lines apart, in one constant, meaning two different things, under
prose asserting the thing about to become untrue. **A find-and-replace over this file gets it wrong in
exactly one direction and nothing would catch it.**

**Must not change — 8 lines:** `renderer/renderer.ts` 2058 *(see B.2)* and 2069 ·
`shared/filesRoots.ts` 121 · `shared/linkHealth.ts` 89 · `main/main.ts` 851, 862, 868, 1790. Each
names either **the Mac's own former name** or **a real path on disk**.

**Four test assertions, all in `src/shared/` — updated in the same commit as the string they assert
on (decision 14):** `renderer/clipboardView.test.ts:395` · `shared/clipPhoneState.test.ts` 41, 51, 67.
**Row 67 asserts an *ordering* between two routes**, so it is a behavioural assertion wearing a
string, not a fixture. It gets read before it gets edited.

**Still owed a wording call:** `shared/filesRoots.ts:239` — *"Received files and ConnectSuite's own
folder are always here."* The **folder** keeps the name; the **app** does not. Naming the app
possessively about a folder makes it both at once. Decision 15 settles the sibling sentence and this
one is the same shape; it is carried here rather than assumed.

### B.2 · Decision 15's wording, and how I read it against decision 14

Decision 14 says `renderer.ts:2058` **stays unchanged**. Decision 15 supplies **new wording for the
downloads sentence** — which is that same line. Read literally the two conflict, so here is the
reading I have applied, stated rather than chosen silently:

| | |
|---|---|
| Decision 14 | **do not swap `ConnectSuite` → `Sidekick` on this line.** The name there is the Mac's own history and the path is real; a swap makes it false twice |
| Decision 15 | **do reword it**, keeping both — *"Earlier downloads stay in ~/Downloads/ConnectSuite — named for Sidekick's earlier name, not moved."* |

**They are compatible, and 15 is strictly better than what is there**: it keeps the real path, keeps
the historical reference, and **says out loud why the folder carries an old name** — which is the
ambiguity revision 2 flagged and could not resolve. So the line is **reworded, not renamed**, in the
deferred Mac pass. **If that reading is wrong, this is the paragraph to correct.**

### B.3 · The ordering constraint decision 13 imposes

**The Mac's *"Sidekick Input"* sentences may not ship before `input_service_label` says
`"Sidekick Input"`.** Five of the fifteen name that exact Settings entry —
`float.ts` 338, 361, 676 · `mirror.ts` 996 · `renderer.ts` 519. Shipping them early sends the user
hunting in a Settings list that still reads *ConnectSuite Input*, **which is worse than a stale name
because it sends them looking for something that is not there.**

Batch 1 ships `input_service_label` (A.3), so after Batch 1 the constraint is satisfied and these five
are free. **If for any reason `input_service_label` does not land, these five are held back
individually** — not the whole Mac pass.

### B.4 · Unchanged — what the Mac pass will not do

- No logic, function, variable, id, event, filename or class name changes.
- No protocol string, no `_connectsuite._tcp`, no `downloads:connectsuite`, no `Download/ConnectSuite`.
- No TLS identity, pairing, trust-store, migration or Android-detection change.
- Nothing in the motion system, the brand lockup, or the recent Mac motion pass.
- **No test assertion edited to make a string change pass.** B.1's four are edited *with* their
  strings, deliberately and named — which is a different act from editing a test to go green.
