import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { publishPulled } from './bulk';
import { pullDestination } from './files';
import { pullPartPathFor } from '../shared/transferFiles';

/**
 * Defects 150 and 151, and the name a phone chooses — the Files and Photos pull into a Mac folder.
 *
 * - 150: a finished pull was published with `rename`, which replaces whatever appeared at the final
 *   name during the transfer.
 * - 151: the partial was `<name>.part`, and an unrecorded `<name>.part` was deleted before a pull —
 *   another app's download in progress.
 * - A `../` in the phone's name would have put the file outside the receive folder.
 */

const dir = () => mkdtempSync(join(tmpdir(), 'sidekick-pull-'));

test('150: a file that appeared at the final name during the transfer is kept; the pull takes the next name', async () => {
  const folder = dir();
  const destination = join(folder, 'IMG.jpg');
  const part = pullPartPathFor(destination);
  writeFileSync(part, 'pulled bytes');
  writeFileSync(destination, 'the person saved this meanwhile');

  const result = await publishPulled(part, destination);

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.path, join(folder, 'IMG (2).jpg'));
  assert.equal(readFileSync(destination, 'utf8'), 'the person saved this meanwhile', 'never replaced');
  assert.equal(readFileSync(join(folder, 'IMG (2).jpg'), 'utf8'), 'pulled bytes');
  assert.equal(existsSync(part), false, 'the partial is gone once the final name holds the bytes');
});

test('150: on a folder with no hard links the pull still saves, by an exclusive copy that never replaces', async () => {
  const folder = dir();
  const destination = join(folder, 'doc.pdf');
  const part = pullPartPathFor(destination);
  writeFileSync(part, 'pdf bytes');
  writeFileSync(destination, 'already here');
  const noLinks = {
    link: async () => { throw Object.assign(new Error('no links'), { code: 'ENOTSUP' }); },
    copyFile: (a: string, b: string, mode: number) => import('node:fs/promises').then((m) => m.copyFile(a, b, mode)),
  };

  const result = await publishPulled(part, destination, noLinks);

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.path, join(folder, 'doc (2).pdf'));
  assert.equal(readFileSync(destination, 'utf8'), 'already here');
  assert.equal(readFileSync(join(folder, 'doc (2).pdf'), 'utf8'), 'pdf bytes');
  assert.equal(existsSync(part), false);
});

test('151: the pull partial is a name only Sidekick writes, so another app’s IMG.jpg.part is a different file', () => {
  const destination = '/Users/x/Downloads/Sidekick/IMG.jpg';
  const part = pullPartPathFor(destination);
  assert.equal(part, '/Users/x/Downloads/Sidekick/.IMG.jpg.sidekick-pull.part');
  assert.notEqual(part, `${destination}.part`, 'a browser’s partial for the same name is not ours');
  assert.equal(dirname(part), dirname(destination), 'same folder, so the publish link cannot cross a volume');
});

test('a phone name with ../ or / is saved inside the receive folder', async () => {
  const folder = dir();
  for (const name of ['../../escape.txt', 'a/b.txt', '/etc/passwd', '..', '.hidden']) {
    const destination = await pullDestination(folder, name);
    assert.equal(dirname(destination), folder, `${name} → ${destination}`);
  }
  assert.equal(readdirSync(dirname(folder)).includes('escape.txt'), false);
});
