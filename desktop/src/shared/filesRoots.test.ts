import { test } from 'node:test';
import assert from 'node:assert/strict';
const {
  ADDED_ON_THE_PHONE,
  DOWNLOAD_WALL,
  filesPaneView,
  freeSpace,
  loadedFooter,
  uploadAffordance,
} = require('./filesRoots.ts');

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

test('one root is the almost-empty state, and it says the list is short by design', () => {
  const view = filesPaneView(ready([appRoot]), false);
  assert.equal(view.id, 'M2');
  assert.match(view.headline, /one folder/);
  // One working root looks like a broken list of many unless the pane says otherwise.
  assert.ok(view.body.some((p) => p.includes('Sync › Folders')));
});

test('the Download wall is in the pane, in every ready state', () => {
  // It belongs here rather than in a doc: a Mac user meets it by looking for a file that is
  // definitely on their phone and definitely not in this list.
  for (const roots of [[appRoot], [appRoot, treeRoot]]) {
    const view = filesPaneView(ready(roots), false);
    assert.ok(view.body.includes(DOWNLOAD_WALL), `wall missing from ${view.id}`);
  }
});

test('the pane never tells the user to add a folder from the Mac', () => {
  // There is no fs.grant and there will not be one — the Mac cannot open a consent surface only a
  // person holding the phone can answer.
  const view = filesPaneView(ready([appRoot]), false);
  assert.ok(view.body.includes(ADDED_ON_THE_PHONE));
  const text = [view.headline, ...view.body].join(' ').toLowerCase();
  assert.ok(!text.includes('add folder'), 'the Mac must not offer to add a folder');
});

test('empty and failed differ in four independent ways', () => {
  // One difference is a bug away from none. Colour alone fails for anyone who cannot see it; the
  // icon alone fails at a glance; the headline alone fails when someone reuses a component.
  const empty = filesPaneView(ready([appRoot]), false);
  const broken = filesPaneView(failed, false);
  assert.notEqual(empty.tone, broken.tone);
  assert.notEqual(empty.icon, broken.icon);
  assert.notEqual(empty.headline, broken.headline);
  assert.notEqual(empty.retry, broken.retry);
});

test('the failed state states what happened; the ready state states what is', () => {
  // Not decoration: "no folders" and "couldn't read folders" are different sentences, and the
  // second must never be produced by an empty list.
  assert.match(filesPaneView(failed, false).headline, /Couldn’t/);
  assert.ok(!/couldn|could not|failed|error/i.test(filesPaneView(ready([appRoot]), false).headline));
});

test('only the failed state offers a retry, and only it shows a code', () => {
  assert.equal(filesPaneView(failed, false).retry, true);
  assert.equal(filesPaneView(failed, false).code, 'TIMEOUT');
  for (const fetch of [
    { kind: 'loading' } as FilesFetch,
    ready([appRoot, treeRoot]),
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
  assert.equal(view.tone, 'warning');
});

test('unavailable and failed are not the same state', () => {
  const absent = filesPaneView({ kind: 'unavailable', reason: 'x' }, false);
  assert.notEqual(absent.id, filesPaneView(failed, false).id);
  assert.notEqual(absent.tone, filesPaneView(failed, false).tone);
});

test('no upload affordance while push is unavailable, in every state', () => {
  // The canvas draws a "Drop files to send to phone" tile. push answers FEATURE_UNAVAILABLE, and
  // docs/protocol.md forbids the affordance against this build.
  const fetches: FilesFetch[] = [
    { kind: 'idle' },
    { kind: 'loading' },
    ready([appRoot]),
    ready([appRoot, treeRoot]),
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
