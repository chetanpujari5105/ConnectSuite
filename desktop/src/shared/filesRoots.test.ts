import { test } from 'node:test';
import assert from 'node:assert/strict';
const {
  ADDED_ON_THE_PHONE,
  DOWNLOAD_WALL,
  RECEIVED_FILES_ALWAYS_WORKS,
  filesPaneView,
  freeSpace,
  loadedFooter,
  pushOffered,
  sharedFolderCount,
  uploadAffordance,
  shouldPrefetchForDrag,
  multiSelectionSummary,
  downloadWallHome,
  wallHomeVisibility,
} = require('./filesRoots.ts');

/**
 * The two roots on **every** phone, before anything is granted.
 *
 * They are a pair in these fixtures rather than one `appRoot`, because that is the situation every
 * real user is in and testing the other one is how the almost-empty state stopped being reachable.
 */
const downloadsRoot: FsRootRow = {
  rootId: 'downloads:connectsuite',
  label: 'Received files',
  kind: 'downloads',
  writable: true,
  freeBytes: 27_233_689_600,
};
const appRoot: FsRootRow = {
  rootId: 'app:files',
  label: 'ConnectSuite',
  kind: 'app',
  writable: true,
  freeBytes: 27_233_689_600,
};
const treeRoot: FsRootRow = {
  rootId: 'saf:primary%3ADCIM',
  label: 'DCIM',
  kind: 'tree',
  writable: true,
  freeBytes: 27_233_681_408,
};

const ready = (roots: FsRootRow[]): FilesFetch => ({ kind: 'ready', roots, grantHint: 'hint' });
const failed: FilesFetch = {
  kind: 'failed',
  reason: 'The phone did not answer.',
  code: 'TIMEOUT',
};

test('a phone that has shared nothing is the almost-empty state, however many roots it has', () => {
  // **The regression this test exists for.** `Received files` and `ConnectSuite` are on every
  // phone, so the old `roots.length > 1` reading made this state unreachable and told a user who
  // had shared nothing that their phone had shared two folders.
  const view = filesPaneView(ready([downloadsRoot, appRoot]), true);
  assert.equal(view.id, 'M2');
  assert.ok(!/\b1\b|\b2\b|one folder|two folders/.test(view.headline), view.headline);
  // Two working roots look like a broken list of many unless the pane says otherwise.
  assert.ok(view.body.some((p) => p.includes('Sync › Folders')));
});

test('the almost-empty state is not a dead end: sending works with nothing shared', () => {
  // The one thing that changed when the grant-free destination landed. Without this sentence the
  // state says "go to the phone" and nothing else, over a pane that can already receive a drop.
  const view = filesPaneView(ready([downloadsRoot, appRoot]), true);
  assert.ok(view.body.includes(RECEIVED_FILES_ALWAYS_WORKS));
  assert.equal(view.upload, true, 'push is offered, so the drop tile belongs here');
});

test('one granted tree is one shared folder, beside the two that are always there', () => {
  const view = filesPaneView(ready([downloadsRoot, appRoot, treeRoot]), false);
  assert.equal(view.id, 'M3');
  assert.match(view.headline, /one folder/);
});

test('sharedFolderCount counts trees, never the list length', () => {
  assert.equal(sharedFolderCount([downloadsRoot, appRoot]), 0);
  assert.equal(sharedFolderCount([downloadsRoot, appRoot, treeRoot]), 1);
  // An unrecognised kind from a future phone is not a shared folder either — it is carried through
  // and drawn, but it must not be counted as something the user granted.
  assert.equal(
    sharedFolderCount([downloadsRoot, appRoot, { ...treeRoot, kind: 'all' }]),
    0,
  );
});

test('the Download wall is in the pane, in every ready state', () => {
  // It belongs here rather than in a doc: a Mac user meets it by looking for a file that is
  // definitely on their phone and definitely not in this list.
  for (const roots of [[downloadsRoot, appRoot], [downloadsRoot, appRoot, treeRoot]]) {
    const view = filesPaneView(ready(roots), false);
    assert.ok(view.body.includes(DOWNLOAD_WALL), `wall missing from ${view.id}`);
  }
});

test('the pane never tells the user to add a folder from the Mac', () => {
  // There is no fs.grant and there will not be one — the Mac cannot open a consent surface only a
  // person holding the phone can answer.
  const view = filesPaneView(ready([downloadsRoot, appRoot]), false);
  assert.ok(view.body.includes(ADDED_ON_THE_PHONE));
  const text = [view.headline, ...view.body].join(' ').toLowerCase();
  assert.ok(!text.includes('add folder'), 'the Mac must not offer to add a folder');
});

test('empty and failed differ in four independent ways', () => {
  // One difference is a bug away from none. Colour alone fails for anyone who cannot see it; the
  // icon alone fails at a glance; the headline alone fails when someone reuses a component.
  const empty = filesPaneView(ready([downloadsRoot, appRoot]), false);
  const broken = filesPaneView(failed, false);
  // The tone and the glyph are the component's now, derived from `kind` — so they differ here by
  // construction, and `filesView.test.ts` asserts all four on the tree a user actually sees.
  assert.notEqual(empty.kind, broken.kind);
  assert.notEqual(empty.headline, broken.headline);
  assert.notEqual(empty.retry, broken.retry);
});

test('the failed state states what happened; the ready state states what is', () => {
  // Not decoration: "no folders" and "couldn't read folders" are different sentences, and the
  // second must never be produced by an empty list.
  assert.match(filesPaneView(failed, false).headline, /Couldn’t/);
  assert.ok(!/couldn|could not|failed|error/i.test(filesPaneView(ready([downloadsRoot, appRoot]), false).headline));
});

test('only the failed state offers a retry, and only it shows a code', () => {
  assert.equal(filesPaneView(failed, false).retry, true);
  assert.equal(filesPaneView(failed, false).code, 'TIMEOUT');
  for (const fetch of [
    { kind: 'loading' } as FilesFetch,
    ready([downloadsRoot, appRoot, treeRoot]),
    { kind: 'unavailable', reason: 'Files needs a folder.' } as FilesFetch,
  ]) {
    assert.equal(filesPaneView(fetch, false).retry, false, `${fetch.kind} must not offer a retry`);
    assert.equal(filesPaneView(fetch, false).code, null);
  }
});

test('an unavailable capability renders the phone’s own sentence, not a paraphrase', () => {
  const reason = 'Files needs at least one folder shared from this phone.';
  const view = filesPaneView({ kind: 'unavailable', reason, fixHint: 'Open Sync › Folders.' }, false);
  assert.equal(view.id, 'M5');
  assert.ok(view.body.includes(reason));
  // A feature the phone is not offering is not a failure. Red in a connection product reads as
  // "the link is down".
  assert.equal(view.kind, 'permission');
});

test('unavailable and failed are not the same state', () => {
  const absent = filesPaneView({ kind: 'unavailable', reason: 'x' }, false);
  assert.notEqual(absent.id, filesPaneView(failed, false).id);
  assert.notEqual(absent.kind, filesPaneView(failed, false).kind);
});

test('no upload affordance while push is unavailable, in every state', () => {
  // The canvas draws a "Drop files to send to phone" tile. push answers FEATURE_UNAVAILABLE, and
  // docs/protocol.md forbids the affordance against this build.
  const fetches: FilesFetch[] = [
    { kind: 'idle' },
    { kind: 'loading' },
    ready([downloadsRoot, appRoot]),
    ready([downloadsRoot, appRoot, treeRoot]),
    failed,
    { kind: 'unavailable', reason: 'x' },
  ];
  for (const fetch of fetches) {
    assert.equal(filesPaneView(fetch, false).upload, false, `${fetch.kind} drew an upload`);
    assert.equal(filesPaneView(fetch, false).degraded, true);
  }
  assert.equal(uploadAffordance(true), true, 'the tile must return when push ships');
  assert.equal(filesPaneView(ready([appRoot]), true).degraded, false);
});

test('a phone that does not mention push is a phone that cannot receive', () => {
  // Every phone built before push shipped omits the field. Reading that as "unknown" — or as a
  // reason to try — puts a drop target over a phone that answers FEATURE_UNAVAILABLE.
  assert.equal(pushOffered(true), true);
  for (const raw of [undefined, null, false, 'true', 1, {}, []]) {
    assert.equal(pushOffered(raw), false, `pushOffered(${JSON.stringify(raw)}) must be false`);
  }
});

test('the footer never claims a total the phone did not send', () => {
  // fs.list has no count. A total means paging to exhaustion — defect 55.
  assert.equal(loadedFooter(200, true), '200 loaded · more on the phone');
  assert.equal(loadedFooter(1, false), '1 item');
  assert.equal(loadedFooter(1245, false), '1,245 items');
});

test('free space is omitted rather than shown as a plausible zero', () => {
  assert.equal(freeSpace(null), '');
  assert.equal(freeSpace(27_233_689_600), '25 GB free');
  assert.equal(freeSpace(5_368_709_120), '5.0 GB free');
});

test('a file that is not yet here is prefetched on selection, so the first drag is a drag', () => {
  assert.equal(
    shouldPrefetchForDrag({ isDir: false, rootSelected: true, alreadyLocal: false, alreadyCopying: false }),
    true,
  );
});

test('a directory is never prefetched — fs.transfer moves one file', () => {
  assert.equal(
    shouldPrefetchForDrag({ isDir: true, rootSelected: true, alreadyLocal: false, alreadyCopying: false }),
    false,
  );
});

test('a file already on this Mac is not pulled again', () => {
  assert.equal(
    shouldPrefetchForDrag({ isDir: false, rootSelected: true, alreadyLocal: true, alreadyCopying: false }),
    false,
  );
});

test('a copy already in flight is not started twice', () => {
  assert.equal(
    shouldPrefetchForDrag({ isDir: false, rootSelected: true, alreadyLocal: false, alreadyCopying: true }),
    false,
  );
});

test('nothing is fetched with no root selected', () => {
  assert.equal(
    shouldPrefetchForDrag({ isDir: false, rootSelected: false, alreadyLocal: false, alreadyCopying: false }),
    false,
  );
});

// --- the ~104 ms ceiling, surfaced ------------------------------------------------------------

test('a small selection is already copying, and says so', () => {
  const s = multiSelectionSummary({ files: 3, totalBytes: 3 * 1024 * 1024, prefetchMax: 8, perFileOverheadMs: 104 });
  assert.equal(s.prefetching, true);
  assert.equal(s.headline, '3 files selected');
  assert.match(s.note, /copying to this Mac now/);
});

test('a large selection quotes the cost and copies nothing until asked', () => {
  const s = multiSelectionSummary({ files: 100, totalBytes: 100 * 1024 * 1024, prefetchMax: 8, perFileOverheadMs: 104 });
  assert.equal(s.prefetching, false);
  // 100 x 104ms = 10.4s. The number a user would otherwise meet by waiting for it.
  assert.match(s.note, /at least 10s of setup/);
  assert.match(s.note, /nothing is copied until you drag them/);
});

test('the boundary is the cap itself, not one past it', () => {
  assert.equal(multiSelectionSummary({ files: 8, totalBytes: 1, prefetchMax: 8, perFileOverheadMs: 104 }).prefetching, true);
  assert.equal(multiSelectionSummary({ files: 9, totalBytes: 1, prefetchMax: 8, perFileOverheadMs: 104 }).prefetching, false);
});

test('twenty files reads in seconds, not milliseconds', () => {
  const s = multiSelectionSummary({ files: 20, totalBytes: 1, prefetchMax: 8, perFileOverheadMs: 104 });
  assert.match(s.note, /at least 2.1s/);
});

test('the headline is singular for one file', () => {
  assert.equal(
    multiSelectionSummary({ files: 1, totalBytes: 1, prefetchMax: 8, perFileOverheadMs: 104 }).headline,
    '1 file selected',
  );
});

// --- the Download wall's two homes ------------------------------------------------------------
//
// This condition has been wrong twice, in both directions, and on the second break four tests went
// red and none of them touched it. These are the tests that would have caught either version.

test('complementary homes — exactly one home is ever on screen', () => {
  for (const home of ['state-card', 'rail-line']) {
    const v = wallHomeVisibility(home);
    assert.equal(
      Number(v.stateCard) + Number(v.railLine),
      1,
      `${home} must light exactly one home, got ${JSON.stringify(v)}`,
    );
  }
});

test('the wall is in the state card before anything is shared — the slice 9 break', () => {
  // Two grant-free roots and nothing granted. `roots.length > 1` is true here, which is exactly
  // what made the M2 card stop drawing; the count that matters is shared folders, and it is 0.
  assert.equal(downloadWallHome({ ready: true, sharedFolders: 0 }), 'state-card');
});

test('the wall moves to the rail once a folder is shared', () => {
  assert.equal(downloadWallHome({ ready: true, sharedFolders: 1 }), 'rail-line');
  assert.equal(downloadWallHome({ ready: true, sharedFolders: 9 }), 'rail-line');
});

test('a pane that is not ready shows the state card, whatever the roots say', () => {
  assert.equal(downloadWallHome({ ready: false, sharedFolders: 0 }), 'state-card');
  assert.equal(downloadWallHome({ ready: false, sharedFolders: 5 }), 'state-card');
});

test('control — the two homes are not the same expression, so a swap is visible', () => {
  // If both homes were driven by one boolean read the same way, these two would agree. They must
  // not: this is the pair that a single wrong `!` collapses.
  const shared = wallHomeVisibility(downloadWallHome({ ready: true, sharedFolders: 3 }));
  const bare = wallHomeVisibility(downloadWallHome({ ready: true, sharedFolders: 0 }));
  assert.notDeepEqual(shared, bare);
  assert.equal(shared.railLine, true);
  assert.equal(bare.stateCard, true);
});

test('the renderer sets each home once, and both from the shared decision', () => {
  // The source guard. `filesPaneView` and `sharedFolderCount` were covered when this broke; the two
  // assignments that consume the decision were not, and they are where a drift shows up.
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'renderer', 'files.ts'),
    'utf8',
  );
  const count = (needle) => src.split(needle).length - 1;
  assert.equal(count('this.stateEl.hidden ='), 1, 'stateEl.hidden must be assigned in exactly one place');
  assert.equal(count('this.wallEl.hidden ='), 1, 'wallEl.hidden must be assigned in exactly one place');
  assert.equal(count('wallHomeVisibility('), 1, 'the decision must be taken once');
  assert.equal(count('showsState'), 0, 'the old renderer-local condition must not come back');
  // Control: the scan can see these strings at all.
  assert.ok(count('this.stateEl.hidden') > 0 && count('this.wallEl.hidden') > 0);
});
