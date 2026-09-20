# Sidekick — full-app screen and state inventory

> Written 2026-09-19 at the start of the full-app parity pass; **status column updated 2026-09-20**
> as each screen landed. Rows 4–13 and the cross-cutting surfaces are built; what is still open is
> listed in §5 at the foot. **Read from the code, not recalled**:
> routes from `desktop/src/renderer/navModel.ts` (`SCREENS`, `PAIRING_SCREEN`, `COMMANDS`,
> `DEEP_LINKS`), sections from `index.html`, frame ids from `docs/sidekick-figma-handoff.md` §1, and
> current status from a baseline screenshot of every route taken the same hour at 1440 × 920
> (dark, live phone, `scripts/shot.mjs --viewport=1440x920`).

## 0 · What each reference column means

| Mark | Meaning |
|---|---|
| **F** | compared against the **real Figma frame**, rendered through the Figma MCP and saved in `docs/evidence/figma-reference/` |
| **H** | compared against the **handoff's written spec** only — the frame could not be rendered |
| — | not compared yet |

**The Figma MCP rendered exactly one frame this sitting** — `32:4382` Messages · Thread — before the
Starter-plan limit returned. It is saved as `docs/evidence/figma-reference/messages-thread-32-4382.png`.
Every other frame is owed one render. **No screen marked H may be called Figma-exact**; it is
"built to the handoff", which is a weaker claim and is stated as such everywhere it appears.

## 1 · Routes

Twelve sidebar rows (the handoff's eleven plus Apps, appended — departure recorded) and one route
without a row (pairing). The Settings panes are sub-routes inside one screen.

| # | Route | Sidebar | Figma frames (handoff §1) | Current status (baseline) | Required states | Compared | Priority |
|---|---|---|---|---|---|---|---|
| 1 | `overview` | MENU ⌘1 | `6:2` Connected · `22:6` Connecting · `22:184` Disconnected · `22:362` Degraded · `40:20881` Media playing | **Batch 2, built to handoff.** Hero + phone, media remote, Recent ×4, two metric cards, Connection & security | connected, connecting, disconnected, degraded, media idle/playing/permission | H | 1 demo |
| 2 | `mirror` | MENU ⌘2 | `31:1566` Ready · `31:1749` Mirroring · `31:1966` Locked · `31:2166` Consent · `31:2350` Secure | **Batch 3, built to handoff.** Session (one of Start/Stop), Quality, Link; Tools stay a rail (D26) | ready, mirroring, locked, consent, secure, disconnected | H | 1 demo |
| 3 | `pairing` | *(no row — forced while unpaired)* | `34:11219` Ready · `34:11409` Searching · `34:11605` Verifying · `34:11793` Paired · `34:11956` Rejected · `34:12152` No network | **Four steps built 2026-09-20** (`9ebcd4a`) from `shared/pairSteps.ts`, plus *Not finding it?* and the manual address. **Rejected / No-network frames still unbuilt** | ready, searching, verifying, paired, rejected, no network, re-pair | H | 1 demo |
| 4 | `messages` | MENU ⌘5 | `32:4382` Thread · `32:4613` Send failed · `32:4845` Permission · `32:5013` Disconnected | **Rebuilt 2026-09-19** (`66ca178`) against the real frame: 300/520/300, transcript blocks, lime Send, person column, footer strip. Permission / disconnected / send-failed states built | thread, send failed, permission, disconnected, loading, no threads | **F** (`32:4382`) | 2 daily |
| 5 | `notifications` | MENU ⌘6 | `34:5254` Inbox · `34:5499` Replying · `34:5744` Read only · `34:5989` Access needed · `40:21209` Media session | **Rebuilt 2026-09-20** (`8f41a00`): Muted filter gone, Reply pills, Read-only box, shared state block, 812 + 324 cards. Media-session row built (`34809be`) | inbox, replying, read only, access needed, media session, empty, disconnected | H | 2 daily |
| 6 | `clipboard` | MENU ⌘7 | `34:6160` History · `34:6408` Phone to Mac · `34:6627` Sensitive · `34:6867` Disconnected | **Rebuilt 2026-09-20** (`0205e4b`): direction chips, neutral kind badges, two cards at 796 + 340 | history, phone→Mac, sensitive, empty, disconnected | H | 2 daily |
| 7 | `calls` | MENU ⌘8 | `34:7045` Idle · `34:7326` Incoming · `34:7618` In call · `34:7907` Permission | **Rebuilt 2026-09-20** (`e2cb988`), and **defect 124 fixed** — the retracted Bluetooth remedy is gone from both audio sentences | idle, incoming, in call, permission, disconnected | H | 2 daily |
| 8 | `settings` → General | SYSTEM ⌘, | `34:10156` | Rail is seven panes now (Device info added). The side-column chip card is **removed** (`889f88f`) | — | H | 2 daily |
| 8a | `settings` → Device info | — | `44:23491` | **Built 2026-09-20** (`889f88f`): device facts + 13 component-20 rows from `shared/capabilityStatus.ts` | available, limited, needs permission, unavailable, unbuilt | H | 2 daily |
| 8b | `settings` → Connection | — | `34:10376` | Built, pre-Sidekick; destructive action not in its own bordered section | connected, disconnected | H | 2 daily |
| 8c | `settings` → Notifications | — | `34:10618` | Built, pre-Sidekick | permission-aware | H | 2 daily |
| 8d | `settings` → File transfer | — | `34:10843` | **Batch 3, built to handoff** | — | H | 1 demo |
| 8e | `settings` → Advanced, About | — | *(not drawn)* | Built; no frame exists | — | — | 3 |
| 9 | `activity` | SYSTEM | `34:9188` All · `34:9478` Filtered empty · `34:9686` Nothing recorded · `34:9849` Disconnected | **Rebuilt 2026-09-20** (`9fbd195`): donut and sparkline gone, counts + busiest hour, per-event tone (D23 discharged) | all, filtered empty, nothing recorded, disconnected | H | 2 daily |
| 10 | `apps` | MENU ⌘0 | `34:8127` Browsing · `34:8440` Loading · `34:8700` No results · `34:8865` Disconnected | **Rebuilt 2026-09-20** (`8fd2f36`): card surface, viewport-bounded scroller, pane footer explaining ask-and-tap | browsing, loading (with count), no results, disconnected | H | 2 daily |
| 11 | `files` | MENU ⌘3 | `31:2550` Browsing · `31:2819` No folders · `31:2985` Couldn't open · `31:3175` Sending | **Rebuilt 2026-09-20** (`8fd2f36`): one card surface, shared empty state in the detail column | browsing, no folders, error, sending, disconnected | H | 2 daily |
| 12 | `photos` | MENU ⌘4 | `31:3431` Browsing · `31:3704` Thumbnails only · `31:3956` Permission · `31:4122` Loading | **Rebuilt 2026-09-20** (`8fd2f36`): captions are meta, one card surface, shared empty state | browsing, partial, permission, loading, disconnected | H | 2 daily |
| 13 | `camera` | MENU ⌘9 | `34:11064` Not built | **Rebuilt 2026-09-20** (`8fd2f36`): route to Mirror, neutral nav pill, the handoff's handle string | unbuilt | H | 3 |

## 2 · Shell, overlays and cross-cutting

| Surface | Figma | Current | Priority |
|---|---|---|---|
| Sidebar (lockup, device card, MENU/SYSTEM, account) | nav row `28:915`, frame shells | Batch 1 | 1 |
| Header (title, subtitle, Search ⌘K, Device settings) | every frame | Batch 1 | 1 |
| **Status pill beside the title** | every frame | Drawn as the centred **status island** (D14) | 1 |
| **Connected-device strip under the header** | **not in any Sidekick frame** — the real `32:4382` render has none | **Removed 2026-09-19** (`66ca178`) from markup, CSS and `shell.ts` | done |
| Pane footer strip (one pane-specific sentence) | `32:4382` draws one; handoff §6 "other panes keep theirs" | Built on Messages, Calls, Apps and Notifications | 2 — others as they are touched |
| Command palette | frames' chrome; no animation | Batch 1 re-skin | 2 |
| Toasts | not drawn | shell.css | 3 |
| Dialogs (New conversation, confirmations) | not drawn | styles.css | 3 |
| State block (component 11: empty · unavailable · loading · permission · error · wall) | `28:1226` | **Built 2026-09-19** as `renderer/stateBlock.ts`; used by Messages, Notifications, Calls, Files, Photos | done |
| Disconnected component (`32:4380`: banner · overlay · inline · blocked action) | `32:4380` | `disconnectedBanner()` in the same file; used by Messages | 2 — other panes as they are touched |
| Focus rings | `:focus-visible` in tokens.css | Present | 2 |
| Light theme | **not drawn** (dark only) | Checked on Messages, Clipboard, Calls, Activity, Apps, Settings | 2 — remaining panes owed |
| Reduced motion / transparency | §8, D20 | Present | 2 |
| Window sizes | 1440 × 980 frames | Demo 1440 × 920 (D21), minimum 1100 × 700 | 1 |

## 3 · Implementation order

Chosen so the change that touches every pane lands first, then the panes in the order a demo and a
day of use would meet them.

1. **Cross-cutting**: remove the device strip; one state-block and one disconnected component in
   `styles.css`; neutral avatars; lime off every list row and chip.
2. **Messages** — the only pane with a real Figma render to score against.
3. **Calls** — including the retracted-Bluetooth copy defect.
4. **Notifications**.
5. **Clipboard**.
6. **Settings** — the Device info pane (D22's real home), destructive section, chip card removed.
7. **Activity** — component 18 rows, the donut and sparkline removed (D9), per-event tone (D23).
8. **Apps**, **Files**, **Photos**.
9. **Camera**, **pairing's four-step column**.
10. Palette, toasts, dialogs; a final light-theme and 1100 × 700 sweep over every pane.

Each group ends with typecheck, the full suite, the guards, shots at 1440 × 920 dark and light and
1100 × 700, departure rows, and a local commit. Nothing is pushed.

## 4 · What cannot be proven here

- **Figma-exactness** for every row marked H — owed one `get_screenshot` per frame.
- States that need the phone in a condition this Mac cannot produce: an incoming call, a live
  mirror session, a revoked permission, a failed send. These are rendered by driving the pane's own
  methods with synthetic input, **labelled SYNTHETIC in the file name**, and put back on real data
  afterwards.
- **Evidence screenshots of Messages, Notifications, Clipboard and Calls are taken on synthetic
  data.** The live panes show real SMS (including one-time codes), real notification text and real
  contact names, and none of that belongs in a committed PNG.


## 5 · State at the end of the 2026-09-20 sitting

**Built this pass** (commits `66ca178`, `e2cb988`, `8f41a00`, `0205e4b`, `889f88f`, `9fbd195`,
`8fd2f36`, `9ebcd4a`): the cross-cutting pass (device strip removed, one state vocabulary, hues
gone, content at y = 140), Messages, Calls, Notifications, Clipboard, Settings → Device info,
Activity, Apps, Files, Photos, Camera and pairing's four steps.

**Still open, in the order I would take them:**

| # | What | Why it is not done |
|---|---|---|
| ~~1~~ | ~~**The media-session row in the Notifications feed** (`40:21209`)~~ | **Built 2026-09-20** (`34809be`) — `shared/mediaSessionRow.ts`, transport gated on what the session offers, no scrubber. **Never seen against a real session**: everything was driven by hand |
| 2 | **One Figma render per screen** | The MCP allowed exactly one frame in two sittings (`32:4382`). Every other screen is *built to the handoff*, which is a weaker claim and is stated as such in every row and commit |
| 3 | **States that need the phone in a condition this Mac cannot produce** | A real revoked grant (permission states), a real send failure, an incoming call, a live mirror session, a real scan advancing the pairing column |
| 4 | **Files' and Photos' remaining frames** | *Sending*, *no folders*, *couldn't open*, *partial*, *permission* were not re-captured after the surface change; all five have tests and none was touched beyond the surface |
| 5 | **Mirror's right column at 920** | Its *Advanced* reference card sits below the fold (`onScreen` **reachable**, 0.72). Carries no state; D26's layout |
| 6 | **The designer's hour** | Still owed and now seven panes deep: the *unavailable / partial / failed / empty* vocabulary is settled in code (component 11), but Calls' audio sentence, Apps' ask-and-tap sentence and the pairing help copy are new prose nobody has approved |
