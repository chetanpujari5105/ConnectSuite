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

/** The suffix on the sidecar left where a checksum failed. */
export const FAILED_SUFFIX = '.failed';

export function partPathFor(destination: string): string {
  return `${destination}${PART_SUFFIX}`;
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
export function sidecarText(options: {
  name: string;
  whenIso: string;
  bytes: number;
  expected: string;
  actual: string;
}): string {
  return [
    'ConnectSuite transfer failed — checksum mismatch',
    `file      ${options.name}`,
    `when      ${options.whenIso}`,
    `size      ${options.bytes} bytes received`,
    `expected  ${options.expected}`,
    `actual    ${options.actual}`,
    'The partial file was deleted because the bytes that arrived were wrong.',
    'A retry starts from zero; there is nothing here to resume.',
    '',
  ].join('\n');
}
