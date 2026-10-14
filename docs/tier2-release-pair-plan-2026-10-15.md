# Tier 2 — supervised release-pair sitting for G1 and G6, and the G5 design (2026-10-15)

> **A plan. Nothing in it has been built, flipped, signed or installed.** Owner decision 2026-10-15: the first DMG
> ships what is already built and honestly labelled, with **every gate off**. Tier 2 is G1 (several files per
> share), G6 (large saves with integrity checks) and G5 (drag from Photos to Finder). G1 and G6 are proven on a
> **release** build pair before any gate moves on the main line; G5 is designed here as a small Mac-only change.
>
> **Labels:** **[V]** verified from code or a dated record · **[U]** unverified · **[A]** assumed.
> Gate names and lines: `docs/feature-parity-audit-2026-10-14.md` §1.

## 0. Two findings that shape the sitting

1. **G6 is two problems, and the gate fixes only one.** `fs.blocks` covers **Files** pulls; *"share and
   `media.original` are untouched"* (`docs/protocol.md` → Block-verified, resumable pulls) **[V]**. Flipping
   `FS_BLOCKS_RELEASE` therefore checksums large **Files** pulls and leaves **Photos → Save to Mac above 64 MiB**
   exactly as today: length-checked only, and saying so (`docs/transfer-integrity-inventory-2026-10-07.md` row 4)
   **[V]**. Large Photos saves need a build — §4. Phone → Mac **sharing** is already hashed at every size (row 6)
   **[V]**, so G1 needs no integrity work.
2. **A release pair cannot be read the way the development pair is.** A packaged Mac refuses
   `--remote-debugging-port` (`releaseGuards.ts`) **[V]**, so `scripts/probe.mjs` cannot read its UI; a release APK
   is not debuggable, so `run-as` cannot read the phone's `files/logs/link.log` **[V by Android rule; U on this
   APK]**. What remains: the phone's **logcat** (tag `ConnectSuiteLink` — `LinkLog` writes every line there too
   **[V]**), the packaged Mac's log file (copied out by you), checksums of the files themselves, and what you read off
   the screens. Every step below is written to those instruments.

## 1. Preconditions (each is yours, in this order)

| # | Precondition | Why |
|---|---|---|
| P1 | **Approve a candidate branch** `sitting/tier2-candidate` (local, never merged without a further approval) carrying only the flips: Mac `SHARE_V3_RELEASE = true`; phone `MULTI_FILE_RELEASE = true` **and** `@bool/share_many_enabled` true in main res (`ShareManyManifestTest` holds the two together **[V]**); for G6 also Mac and phone `FS_BLOCKS_RELEASE = true`. `WEBCAM_RELEASE`, `SHARE_WAIT_RELEASE`/`WAIT_RELEASE` stay false | the gates on the main line stay off; the candidate is a test artifact |
| P2 | **Phone: use a second phone** (the Moto g34 / g45 / vivo from `docs/second-device-moto-g34.md` etc., if still available) with **no** Sidekick debug build on it | the release package `com.chetan.connectsuite` and the debug `com.chetan.connectsuite.debug` are different apps **[V, `applicationIdSuffix`]** and both bind 42501–42503 **[A]**; on the SM-S938B the debug link would have to be stopped first, and `am force-stop` of our package is refused by a hook |
| P3 | **Sign the candidate APK** — an unsigned release APK is refused by Android (D13) **[V]**. Recommended **[A]**: a **throwaway key made for this sitting only**, never the production key, so no production-signed artifact with unreleased gates exists | signing is yours; a hook (`no-release-signing.sh`) stops me |
| P4 | **A fresh macOS user** for the packaged candidate (defect 207: never on your account) **[V]**, with Local Network allowed when macOS asks | the packaged app shares the development profile folder on your account |
| P5 | **A beta token** entered on that user (a packaged build always checks) — issue one for the sitting with `scripts/issue-trial-token.mjs` | I do not read `~/.sidekick-trial-key` |
| P6 | A shared folder for evidence: `/Users/Shared/sidekick-sitting-<date>/` | how the fresh user's log reaches me |

I build both candidates from `git archive` of the candidate branch in a scratch folder (as every RC was), run the
RC static checks plus: the four flipped constants read back from `dist/` and from the APK's dex, and every
other gate still `false`. **I install nothing**; you install the APK (or approve me doing it through
`scripts/adb-pinned.sh` with the second phone's model pinned).

## 2. G1 — several files per share, on the release pair

Synthetic files only, made by me on the Mac and sent to the phone with the pair's own **Send to phone** (which
verifies at every size **[V]**): `g1-photo.jpg` (~3 MB), `g1-clip.mp4` (~120 MB), `g1-pic.png`, `g1-notes.txt`,
`g1-table.csv`. I record each SHA-256 before sending.

| Step | You press / do | I read | Pass |
|---|---|---|---|
| 1 | Pair the second phone with the packaged candidate (QR) | Mac log: `share.file 3 ADVERTISED (… packaged: true; release policy SHARE_V3_RELEASE: true)`; logcat: the handshake's negotiated `share.file 3` | both lines; **control:** the shipping DMG/APK pair, read the same way, negotiates 2 (or 1) |
| 2 | Gallery → select `g1-photo.jpg`, `g1-clip.mp4`, `g1-pic.png` → Share | — | **Sidekick is listed** for a multi-selection (the thing a release phone lacks today) |
| 3 | Tap Sidekick; the phone's review screen | logcat: three offers staged | three rows, each named |
| 4 | Look at the Mac (do not click yet) | Mac log: three `share.offer` lines, **no pull/claim** before any Accept | three cards *waiting for your answer*, nothing written to the receive folder (`ls` of it unchanged) |
| 5 | Accept the mp4, Decline the png, Accept the jpg | Mac log: two pulls, one decline; `shasum -a 256` of the two saved files | both hashes equal the sources; **no png and no `.part`** anywhere in the receive folder; *Saved* shown only after the publish |
| 6 | Share `g1-photo.jpg` again, Accept | saved name | arrives as `g1-photo (2).jpg`; the first copy's hash unchanged |
| 7 | My Files → select `g1-notes.txt` + `g1-table.csv` only → Share | — | **Sidekick listed** for a text-only selection (F-9's open item); both arrive with equal hashes |
| 8 | Share three again; on the phone's review screen **Cancel** one row before the Mac answers | Mac: that card ends (*cancelled*), the other two still wait | no file for the cancelled one |
| 9 | Share the mp4; Accept; **turn the phone's Wi-Fi off** at about half way, back on after 10 s | Mac log and card; receive folder | **no file under the final name unless its hash matches**; whatever the card says is recorded verbatim (this path is unmeasured on a release pair) |

**G1 passes** when 1–8 pass and 9 shows no unverified file published. **It fails** on any unequal hash, any
file before Accept, any `.part` left, or Sidekick missing from a share sheet in step 2 or 7.

## 3. G6 (Files half) — block-verified pulls above 64 MiB, on the release pair

The same candidates with `FS_BLOCKS_RELEASE` on both sides (can share the sitting with G1). Synthetic
`g6-300m.bin` and `g6-1g.bin` (random bytes, hashed first), sent with **Send to phone** into
`Download/ConnectSuite` (the grant-free root **[V]**). Mac free space checked first; nothing above it.

| Step | You press / do | I read | Pass |
|---|---|---|---|
| 1 | — (handshake) | Mac log `fs.blocks 1 ADVERTISED (… packaged: true; release policy FS_BLOCKS_RELEASE: true)`; logcat advertises `fs.blocks` | both; **control:** the shipping pair does not |
| 2 | Files → `g6-300m.bin` → Copy to Mac | card wording; saved file's SHA-256 | *Verified block by block…*; hash equals the source |
| 3 | Copy `g6-1g.bin`; **phone Wi-Fi off** at ~40 %, on after 15 s | Mac log: paused, then resumed from an offset; card *…checked block by block* | final hash equal; **no `.part` left**; the resume offset > 0 (so it resumed, not restarted) |
| 4 | Photos → a **synthetic** video > 64 MiB (`g1-clip.mp4` from G1, now in the phone's media) → Save to Mac | the saved line | **expected and recorded, not a pass:** *No checksum was agreed in advance…* — confirms §0.1 on the release pair |

**G6-Files passes** on 1–3. Step 4 is the control that says the Photos half is still open.

## 4. G6 (Photos half) — what it needs, for your decision (not built)

| Option | What | Effort / risk **[A]** |
|---|---|---|
| a | Extend `fs.blocks` to `media.original` (the phone reads the `MediaStore` stream by offset) — protocol first, then both sides | 2–3 sessions; medium (a second consumer of the block verifier) |
| b | The phone hashes while streaming and sends the digest in the transfer's end message; the Mac publishes only on a match | 1–2 sessions; low–medium; no resume benefit; a protocol addition |
| c | Keep the honest *no checksum* line (today) | none |

## 5. Rollback (after the sitting, whatever the result)

1. You uninstall the candidate APK from the second phone (its data goes with it).
2. On the fresh user: quit Sidekick, delete it from Applications and its profile folder; delete the Keychain item
   *Sidekick Safe Storage* there.
3. I delete every `g1-*` / `g6-*` file **by literal path** on the Mac; you delete the phone copies in
   `Download/ConnectSuite` and the Gallery (or approve me removing those exact MediaStore rows).
4. The candidate branch stays local as the record; **the main line's gates are untouched**. Flipping them is a
   separate commit, approved after a pass, carrying this sitting's evidence.
5. The throwaway signing key (P3) is deleted, or kept offline labelled *sitting only*.

## 6. G5 — drag from Photos to Finder (Mac-only design, not built)

**What exists [V]:** the Files pane drags rows with `fs-drag` (`main.ts:3163`), which refuses any path this
process did not produce (`producedFiles`) and any path that does not exist. **Photos' Save to Mac already grants
its saved path** (`ipc.handle('media-original', …)` → `producedFiles.grant`, `main.ts:3257`). So no main-process,
preload or protocol change is needed.

**Design [A]:**
- **A photo becomes draggable once it is on the Mac.** Finder needs a file, and `startDrag` must be called
  synchronously in `dragstart` (the Files pane learned this — *"Copy it to the Mac before dragging it to
  Finder"*). So: in the detail card, after a successful **Save to Mac**, the saved-file row (name + *Reveal in
  Finder*) and the stage image get `draggable = true`; `dragstart` calls the same bridge Files uses with
  `[savedPath]`.
- **Grid tiles** of items saved in this session are draggable too (the pane already holds the saved result).
  Unsaved tiles are not draggable and show nothing new.
- **Never drag the preview cache.** Viewed originals live in a 0700 temp folder that is emptied at disconnect and
  quit (`main/mediaPreview.ts`) and are not in `producedFiles`; the guard would refuse them anyway.
- **Copy:** one line under Save to Mac — *"Saved. Drag it to Finder, or Reveal in Finder."* No promise appears
  before the feature exists.
- **Tests (red-first):** `photosView.test.ts` — a saved item exposes a drag source whose handler sends exactly its
  saved path; an unsaved item exposes none; a failed save exposes none. Mutation: drag an unsaved item's
  preview-cache path → red.
- **Proof on hardware:** one drag of a saved synthetic photo to the Desktop on the development app; the copy's
  hash equals the saved file's; the Mac log's `fs-drag` success line (*`N started / M refused`*).

**Effort:** about one session. **Risk:** low — renderer only, behind an existing guard. **Not built** until you
say so.
