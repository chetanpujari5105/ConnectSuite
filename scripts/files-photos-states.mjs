/**
 * The five Files and Photos states that could not be re-captured after the Sidekick surface change.
 *
 * `docs/sidekick-full-app-inventory.md` §5 row 4: *Sending*, *no folders* and *couldn't open* on
 * Files; *partial* and *permission* on Photos. Every one of them needs the phone in a condition
 * this Mac cannot produce — a revoked media grant, a folder whose grant outlived it, a transfer
 * caught mid-flight — and producing them for real would mean revoking the owner's grants.
 *
 * ### How the state is produced, and why it is not by poking a private field
 *
 * Each view takes a **bridge** of async functions. This replaces the bridge's answers and then
 * calls the view's own public `refresh()`, so the code that runs is the production failure path —
 * the same one the pane takes when the phone really refuses. A test that set `view.failure` and
 * called `render()` would be photographing a field, not a state: TypeScript's `private` is erased
 * at runtime, so it is *possible*, which is exactly why it has to be ruled out deliberately.
 *
 * The bridge is restored and both panes refreshed from the live phone before this exits.
 *
 *   node scripts/files-photos-states.mjs
 */
import { openProbe, format } from './probe.mjs';
import { execFileSync } from 'node:child_process';

const OUT = 'docs/evidence/sidekick-batch6';
const probe = await openProbe({ port: 9222 });
let failures = 0;

const shot = (name, screen, prep, expect) => {
  execFileSync('node', [
    'scripts/shot.mjs',
    `--out=${OUT}/${name}.png`,
    `--screen=${screen}`,
    '--viewport=1440x920',
    '--settle=700',
    `--prep=${prep}`,
    `--prep-expect=${expect}`,
  ], { stdio: 'inherit' });
};

/**
 * Puts both panes back on the phone's own answers. Called **before** the run as well as after it.
 *
 * The after-call is obvious. The before-call is here because the first version of this script had
 * only the after-call, a shot failed, the process exited on the exception, and the app was left
 * holding an invented permission refusal — which then poisoned the *next* run: the partial-notice
 * capture could not draw, because a failure outranks a partial notice, and the shot refused with
 * `--prep did not land` for a reason that had nothing to do with the prep.
 *
 * A probe that edits the thing it measures is bad enough; one that edits it for the next run is
 * worse, because by then nothing connects the symptom to the cause.
 */
async function restoreLive() {
  await probe.rawEvaluate(`(async () => {
    if (window.__realBuckets) { photos.bridge.mediaBuckets = window.__realBuckets; delete window.__realBuckets; }
    if (window.__realRoots) { files.bridge.fsRoots = window.__realRoots; delete window.__realRoots; }
    /*
     * Release the held push before restoring the bridge, so the awaiting sendFiles() settles
     * rather than being left as an orphaned promise holding 'pushing'.
     *
     * The two field writes after it are the one place this script touches a private field, and
     * they are a cleanup rather than a stimulus: 'lastPush' is not cleared by refresh()
     * — it survives until the next push — so without them the pane would be left showing a
     * sentence about a transfer that never happened.
     */
    if (window.__releasePush) { window.__releasePush({ ok: false, reason: 'probe released' }); delete window.__releasePush; }
    if (window.__realPush) { files.bridge.fsPush = window.__realPush; delete window.__realPush; }
    await new Promise((r) => setTimeout(r, 50));
    files.pushing = null;
    files.lastPush = null;
    photos.setAdvertised(true);
    await photos.refresh();
    await files.refresh();
  })()`);
}

await restoreLive();

// The control every capture below depends on: the panes are real and reachable right now, so a
// state they then enter is a state and not an absence.
const before = await probe.read({
  question: 'control: Files and Photos hold real content before anything is faked',
  read: `(async () => {
    shell.route('photos'); await new Promise((r) => setTimeout(r, 1200));
    const albums = document.querySelectorAll('.photos-album').length;
    shell.route('files'); await new Promise((r) => setTimeout(r, 1200));
    const roots = document.querySelectorAll('.files-root, [data-files-root]').length;
    return { albums, roots };
  })()`,
  control: `document.querySelectorAll('section[data-screen="photos"], section[data-screen="files"]').length`,
});
console.log('  ' + format(before));
if (!before.value.albums) {
  console.log('\n  NO READING — Photos holds no albums, so "permission" would be indistinguishable from "empty"');
  failures += 1;
}

try {
  console.log('\n-- Photos: partial (thumbnails only) — 31:3704 --');
  shot(
    'photos-partial-SYNTHETIC-1440x920',
    'photos',
    /*
     * The real capability path: the pane is told the phone no longer advertises `photos`, which is
     * what happens when `media.original` cannot be served. Nothing else is touched.
     *
     * Set true first, so the call is idempotent. `setAdvertised` returns early when the value has
     * not changed — so a prep of `setAdvertised(false)` alone does nothing at all on a pane already
     * in that state, draws no banner, and the shot fails its own expect for a reason that has
     * nothing to do with the feature.
     */
    'photos.setAdvertised(true); photos.setAdvertised(false);',
    "document.querySelectorAll('.photos-banner.partial').length === 1",
  );

  console.log('\n-- Photos: permission refused — 31:3956 --');
  shot(
    'photos-permission-SYNTHETIC-1440x920',
    'photos',
    `(async () => {
       window.__realBuckets = photos.bridge.mediaBuckets;
       photos.bridge.mediaBuckets = async () => ({ ok: false,
         reason: 'Sidekick does not have permission to read photos on this phone.',
         fixHint: 'Open Sidekick on the phone and allow access to photos and videos.' });
       await photos.refresh();
     })()`,
    "document.querySelectorAll('.photos-banner.unavailable').length === 1",
  );

  console.log('\n-- Files: sending a file — 31:3175 --');
  shot(
    'files-sending-SYNTHETIC-1440x920',
    'files',
    /*
     * The real push path: `sendFiles` sets `lastPush`, `pushing` and re-renders, then awaits
     * `fsPush`. The bridge is replaced with one that stays **in flight**, so the pane sits in the
     * state a transfer occupies for as long as a transfer takes — rather than in a rendering of
     * what that state would look like.
     *
     * The file object is synthetic and carries only what the path reads, `name` and `path`. It is
     * never opened: the bridge that would read it is the one being held.
     */
    `(async () => {
       window.__realPush = files.bridge.fsPush;
       window.__releasePush = null;
       files.bridge.fsPush = () => new Promise((resolve) => { window.__releasePush = resolve; });
       void files.sendFiles([{ name: 'holiday-clip.mp4', path: '/tmp/holiday-clip.mp4' }]);
     })()`,
    `/Sending/.test(document.querySelector('.files-drop') ? document.querySelector('.files-drop').textContent : '')`,
  );

  console.log('\n-- Files: no folders shared — 31:2819 --');
  shot(
    'files-no-folders-SYNTHETIC-1440x920',
    'files',
    `(async () => {
       window.__realRoots = files.bridge.fsRoots;
       files.bridge.fsRoots = async () => ({ ok: true, data: { roots: [] } });
       await files.refresh();
     })()`,
    `document.querySelectorAll('section[data-screen="files"] .files-state-card').length === 1`,
  );

  console.log('\n-- Files: could not open a folder — 31:2985 --');
  shot(
    'files-couldnt-open-SYNTHETIC-1440x920',
    'files',
    `(async () => {
       files.bridge.fsRoots = async () => ({ ok: false,
         reason: 'The phone could not open that folder.',
         code: 'TARGET_STALE' });
       await files.refresh();
     })()`,
    `document.querySelectorAll('section[data-screen="files"] .files-state--destructive').length === 1
       && document.querySelectorAll('section[data-screen="files"] .files-state-code').length === 1`,
  );
} finally {
  // Always, including on a failed shot — see `restoreLive`.
  await restoreLive();
}


const after = await probe.read({
  question: 'control: both panes are back on the phone’s own data',
  read: `(async () => {
    shell.route('photos'); await new Promise((r) => setTimeout(r, 1200));
    return { albums: document.querySelectorAll('.photos-album').length }; })()`,
  control: `document.querySelectorAll('section[data-screen="photos"]').length`,
});
console.log('\n  ' + format(after));
if (after.value.albums !== before.value.albums) {
  console.log(`  FAIL the pane was left changed: ${before.value.albums} albums before, ${after.value.albums} after`);
  failures += 1;
}

console.log(`\n${failures === 0 ? 'ALL READINGS OK' : `${failures} FAILED`}\n`);
await probe.close();
process.exit(failures === 0 ? 0 : 1);
