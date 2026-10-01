/**
 * The on-disk convention for a transfer in progress, and the one place the suffixes are spelled.
 *
 * Three states, three appearances, so a person looking at the folder can tell which happened without
 * reading a log. They are opposite situations that both amount to "something went wrong with a file"
 * and they want opposite responses — one resumes, one retries from zero.
 *
 * | State | On disk | Means |
 * |---|---|---|
 * | In flight, or interrupted | `holiday.mov.part` | Bytes are good as far as they go. **Resumable.** |
 * | Verified complete | `holiday.mov` | Done. Any stale `.part` or `.failed` for this name is gone. |
 * | Checksum mismatch | `holiday.mov.failed`, and **no** `.part` | The bytes were wrong and have been deleted. **Retry from zero.** |
 *
 * ### The suffixes live here and nowhere else
 *
 * That is the enforceable half of this convention, and `transferFiles.test.ts` holds the check —
 * the same shape as `stylesheets.test.ts` failing on a selector declared twice. A literal `'.part'`
 * built inline wherever a path is needed is how two spellings of one rule start to disagree.
 *
 * ### What is **not** enforceable, stated rather than papered over
 *
 * **Nothing can stop something else on the phone leaving a `.part` in a folder we can see, and
 * nothing ever will.** These are not our directories: a granted SAF tree is `DCIM` or `Documents`,
 * shared with every browser downloader, sync client and torrent app on the device, and all of them
 * write `.part` files as a matter of course. "Resume from any `.part` we find" would mean offering to
 * resume some other program's half-finished download, and on a push it would mean appending our
 * bytes to a file we did not create.
 *
 * So the convention is a **display convenience and must never be load-bearing**. Anything that
 * decides to append to, delete or overwrite a file consults the transfer record, not the filename —
 * see [isResumable], which takes the recorded length and refuses to guess without one.
 */

/** The suffix on a partial. Declared once; see the note above about why that is checked. */
export const PART_SUFFIX = '.part';

/** The suffix on the sidecar left where a transfer failed ([FailedMarker] says why). */
export const FAILED_SUFFIX = '.failed';

export function partPathFor(destination: string): string {
  return `${destination}${PART_SUFFIX}`;
}

/**
 * The partial of a Files or Photos **pull** into a Mac folder (defect 151).
 *
 * It is `.<name>.sidekick-pull.part`, not `<name>.part`, because the receive folder is shared with
 * every other downloader on the Mac: a browser downloading `IMG.jpg` writes `IMG.jpg.part` (or
 * similar) there, and a pull that picked the free name `IMG.jpg` used to delete that file as "a
 * partial we have no record of". **The name is the ownership claim**: nothing but Sidekick writes
 * this suffix, so a partial at this name is Sidekick's own and may be replaced; a partial at any
 * other name is never touched. The leading dot keeps it out of Finder while it grows.
 */
export function pullPartPathFor(destination: string): string {
  const slash = destination.lastIndexOf('/');
  const folder = slash >= 0 ? destination.slice(0, slash + 1) : '';
  const name = slash >= 0 ? destination.slice(slash + 1) : destination;
  return `${folder}.${name}.sidekick-pull${PART_SUFFIX}`;
}

export function failedPathFor(destination: string): string {
  return `${destination}${FAILED_SUFFIX}`;
}

/**
 * Whether a partial on disk may be resumed, given what our own record says about it.
 *
 * **The record is authoritative and the filename is not.** A `.part` we have no record of is a
 * stranger's file: it is left alone, and a transfer to that name starts over rather than appending.
 * A `.part` longer than our record is also refused — it is either not ours or our record is wrong,
 * and appending to it would produce a file whose digest can never match.
 *
 * Equal lengths resume. Shorter-than-recorded resumes from the **file's** length, not the record's,
 * because the file is what the digest will actually cover: a record claiming more bytes than exist
 * is how a resumed digest silently omits a hole.
 */
export function isResumable(options: {
  partBytes: number | null;
  recordedBytes: number | null;
  totalBytes: number;
}): { resume: false; reason: string } | { resume: true; offset: number } {
  const { partBytes, recordedBytes, totalBytes } = options;
  if (partBytes === null) return { resume: false, reason: 'there is no partial file' };
  if (recordedBytes === null) {
    return {
      resume: false,
      reason: 'a partial with no transfer record of ours beside it — treated as another app\'s file',
    };
  }
  if (partBytes > recordedBytes) {
    return {
      resume: false,
      reason: `the partial holds ${partBytes} bytes where our record says ${recordedBytes}`,
    };
  }
  if (partBytes >= totalBytes) {
    return {
      resume: false,
      reason: `the partial already holds ${partBytes} of ${totalBytes} bytes`,
    };
  }
  if (partBytes === 0) return { resume: false, reason: 'the partial is empty' };
  return { resume: true, offset: partBytes };
}

/**
 * The sidecar's contents — a small text file, readable by whoever opens it.
 *
 * **A sidecar rather than a rename, and that is the whole point of the design.** Renaming the bad
 * partial to `holiday.mov.corrupt` would be simpler and is wrong: it keeps the corrupt bytes, which
 * is exactly what *a corrupt file is worse than a missing one* forbids, and it leaves something a
 * hopeful user can rename back. The sidecar carries the **fact** without carrying the bytes.
 */
/**
 * The first words of every marker this app writes. **It is the ownership token**: a later successful
 * publish at the same name removes a `.failed` only if it starts with this (`removeStaleSidecar`), so a
 * file of the person's that merely carries the suffix is never deleted. Every kind below keeps it.
 */
export const FAILED_MARKER_HEADER = 'Sidekick transfer failed';

/**
 * Why a transfer left a marker. Each kind says only what was actually established (defect 159):
 * - `checksum` — the whole file arrived and its SHA-256 differs from the one agreed in advance, so both
 *   whole-file digests are real;
 * - `block` — a block-verified pull stopped at the first block that did not match. The phone's and the
 *   Mac's digests **of that block** are known; there is **no** whole-file hash, because the file never
 *   arrived whole, and none is written;
 * - `source-changed` — the phone ended the transfer because its file changed (`SOURCE_CHANGED`, e.g. a
 *   resume whose prefix no longer hashes). Nothing that arrived was wrong; it was out of date;
 * - `unverified` — the transfer finished but failed another check (a count, a length, the manifest).
 */
export type FailedMarker = { name: string; whenIso: string; bytes: number } & (
  | { kind: 'checksum'; expected: string; actual: string }
  | { kind: 'block'; block: number; phoneDigest?: string; macDigest?: string }
  | { kind: 'source-changed'; why: string; message: string }
  | { kind: 'unverified'; reason: string }
);

export function sidecarText(m: FailedMarker): string {
  const head = [`file      ${m.name}`, `when      ${m.whenIso}`, `size      ${m.bytes} bytes received`];
  const retry = 'A retry starts from zero; there is nothing here to resume.';
  switch (m.kind) {
    case 'checksum':
      return [`${FAILED_MARKER_HEADER} — checksum mismatch`, ...head,
        `expected  ${m.expected}`, `actual    ${m.actual}`,
        'The partial file was deleted because the bytes that arrived were wrong.', retry, ''].join('\n');
    case 'block':
      return [`${FAILED_MARKER_HEADER} — block ${m.block} did not match what the phone read`, ...head,
        `block     ${m.block} (blocks before it matched)`,
        `phone     ${m.phoneDigest ?? '(not known)'}`, `this Mac  ${m.macDigest ?? '(not known)'}`,
        'whole-file SHA-256: not computed — the transfer stopped at this block, so the file never arrived whole.',
        'The partial file was deleted because the bytes that arrived were wrong.', retry, ''].join('\n');
    case 'source-changed':
      return [`${FAILED_MARKER_HEADER} — the file changed on the phone`, ...head,
        `why       ${m.why}`, `phone     ${m.message}`,
        'Nothing that arrived was wrong; it was out of date, so the partial file was deleted rather than finished.',
        'Copying it again fetches the changed file from the start.', ''].join('\n');
    case 'unverified':
      return [`${FAILED_MARKER_HEADER} — the file did not verify`, ...head, `reason    ${m.reason}`,
        'The partial file was deleted because it could not be shown to match what the phone read.', retry, ''].join('\n');
  }
}
