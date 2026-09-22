/**
 * One HTTP `Range: bytes=…` header against a file of known size — the decision a video element's
 * seek depends on, kept apart from the protocol handler so a test can reach it.
 *
 * Chromium's `<video>` seeks by asking for a byte range; a handler that ignores `Range` and answers
 * 200 with the whole file plays from the start and **cannot seek**, which looks exactly like a
 * broken seek bar. So the preview protocol (`main/mediaPreview.ts`) answers 206 for every range it
 * can satisfy and 416 for one it cannot, and this function is the whole of that decision.
 *
 * Only a single range is honoured. A multi-range request is answered as the full file — which the
 * spec allows, and which a media element never sends.
 *
 * Main-process only (not loaded by `index.html`), so it keeps its exports.
 */
export type RangeAnswer =
  | { kind: 'full' }
  | { kind: 'partial'; start: number; end: number }
  | { kind: 'unsatisfiable' };

export function parseByteRange(header: string | null | undefined, size: number): RangeAnswer {
  if (!header) return { kind: 'full' };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return { kind: 'full' };
  const [, a, b] = match;
  if (a === '' && b === '') return { kind: 'full' };
  if (size <= 0) return { kind: 'unsatisfiable' };
  let start: number;
  let end: number;
  if (a === '') {
    // `bytes=-500`: the last 500 bytes.
    const suffix = Number(b);
    if (suffix === 0) return { kind: 'unsatisfiable' };
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(a);
    end = b === '' ? size - 1 : Math.min(Number(b), size - 1);
  }
  if (start >= size || start > end) return { kind: 'unsatisfiable' };
  return { kind: 'partial', start, end };
}
