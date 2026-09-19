# Sidekick — full-app screen and state inventory

> Written 2026-09-19, at the start of the full-app parity pass. **Read from the code, not recalled**:
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
| 3 | `pairing` | *(no row — forced while unpaired)* | `34:11219` Ready · `34:11409` Searching · `34:11605` Verifying · `34:11793` Paired · `34:11956` Rejected · `34:12152` No network | **Batch 3, partly.** Code draws on arrival; **the four-step column, amber failure, inert sidebar and No-network state are not built** | ready, searching, verifying, paired, rejected, no network, re-pair | H | 1 demo |
| 4 | `messages` | MENU ⌘5 | `32:4382` Thread · `32:4613` Send failed · `32:4845` Permission · `32:5013` Disconnected | **Pre-Sidekick layout.** Device strip; per-contact avatar hues; lime unread badges; no status pill; no pane footer; the empty centre column | thread, send failed, permission, disconnected, loading, no threads | **F** (`32:4382`) | 2 daily |
| 5 | `notifications` | MENU ⌘6 | `34:5254` Inbox · `34:5499` Replying · `34:5744` Read only · `34:5989` Access needed · `40:21209` Media session | **Pre-Sidekick layout.** Device strip; a **Muted** filter the handoff removed (N1); 3-line rows; loose sound checkbox above the list; dashed empty detail | inbox, replying, read only, access needed, media session, empty, disconnected | H | 2 daily |
| 6 | `clipboard` | MENU ⌘7 | `34:6160` History · `34:6408` Phone to Mac · `34:6627` Sensitive · `34:6867` Disconnected | **Pre-Sidekick layout.** Device strip; lime-tinted selected row with a lime rail; no direction chips; body copy in the detail column overruns the viewport | history, phone→Mac, sensitive, empty, disconnected | H | 2 daily |
| 7 | `calls` | MENU ⌘8 | `34:7045` Idle · `34:7326` Incoming · `34:7618` In call · `34:7907` Permission | **Pre-Sidekick layout, and a copy defect**: the audio card offers the **Bluetooth remedy CLAUDE.md retracted** on 2026-09-14. Call button is a lime→grey gradient; avatar hues | idle, incoming, in call, permission, disconnected | H | 2 daily |
| 8 | `settings` → General | SYSTEM ⌘, | `34:10156` | Pre-Sidekick rail; retired **capability-chip card** still in the side column (D22) | — | H | 2 daily |
| 8a | `settings` → Device info | — | `44:23491` | **Not built.** Capabilities live as chips in the side column (D22 said: Batch 5) | available, limited, needs permission, unavailable, unbuilt | H | 2 daily |
| 8b | `settings` → Connection | — | `34:10376` | Built, pre-Sidekick; destructive action not in its own bordered section | connected, disconnected | H | 2 daily |
| 8c | `settings` → Notifications | — | `34:10618` | Built, pre-Sidekick | permission-aware | H | 2 daily |
| 8d | `settings` → File transfer | — | `34:10843` | **Batch 3, built to handoff** | — | H | 1 demo |
| 8e | `settings` → Advanced, About | — | *(not drawn)* | Built; no frame exists | — | — | 3 |
| 9 | `activity` | SYSTEM | `34:9188` All · `34:9478` Filtered empty · `34:9686` Nothing recorded · `34:9849` Disconnected | **Pre-Sidekick.** Still draws the **donut and 7-day sparkline** D9 removed; dot rows, not component 18 rows; per-event tone missing (D23) | all, filtered empty, nothing recorded, disconnected | H | 2 daily |
| 10 | `apps` | MENU ⌘0 | `34:8127` Browsing · `34:8440` Loading · `34:8700` No results · `34:8865` Disconnected | Pre-Sidekick; loading is a single sentence in a bordered box | browsing, loading (with count), no results, disconnected | H | 2 daily |
| 11 | `files` | MENU ⌘3 | `31:2550` Browsing · `31:2819` No folders · `31:2985` Couldn't open · `31:3175` Sending | Pre-Sidekick; nested panel inside a panel; detail column is bare text | browsing, no folders, error, sending, disconnected | H | 2 daily |
| 12 | `photos` | MENU ⌘4 | `31:3431` Browsing · `31:3704` Thumbnails only · `31:3956` Permission · `31:4122` Loading | Pre-Sidekick; **lime** album owner captions (lime is not allowed on list rows); nested panel | browsing, partial, permission, loading, disconnected | H | 2 daily |
| 13 | `camera` | MENU ⌘9 | `34:11064` Not built | Unbuilt card; **active nav row takes the lime tint** (row 11 of handoff §11 forbids); no route to Mirror; handle text differs | unbuilt | H | 3 |

## 2 · Shell, overlays and cross-cutting

| Surface | Figma | Current | Priority |
|---|---|---|---|
| Sidebar (lockup, device card, MENU/SYSTEM, account) | nav row `28:915`, frame shells | Batch 1 | 1 |
| Header (title, subtitle, Search ⌘K, Device settings) | every frame | Batch 1 | 1 |
| **Status pill beside the title** | every frame | Drawn as the centred **status island** (D14) | 1 |
| **Connected-device strip under the header** | **not in any Sidekick frame** — the real `32:4382` render has none | On 10 of 12 panes. Its comment cites *"per the handoff"* — the **retired** ConnectSuite handoff | 1 — **remove** |
| Pane footer strip (one pane-specific sentence) | `32:4382` draws one; handoff §6 "other panes keep theirs" | Absent on most panes | 2 |
| Command palette | frames' chrome; no animation | Batch 1 re-skin | 2 |
| Toasts | not drawn | shell.css | 3 |
| Dialogs (New conversation, confirmations) | not drawn | styles.css | 3 |
| State block (component 11: empty · unavailable · loading · permission · error · wall) | `28:1226` | Five per-pane vocabularies | 2 — **build once, use everywhere** |
| Disconnected component (`32:4380`: banner · overlay · inline · blocked action) | `32:4380` | Per-pane | 2 |
| Focus rings | `:focus-visible` in tokens.css | Present | 2 |
| Light theme | **not drawn** (dark only) | Shipped 2026-09-16, re-derived Batch 1 | 2 — check each rebuilt pane |
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
