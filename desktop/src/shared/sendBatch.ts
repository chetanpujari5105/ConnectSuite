/**
 * Mac → phone sends, as one value: which files, where they are going, and what **the phone** has
 * said about each of them.
 *
 * ### Why the phone's numbers and not ours
 *
 * The Mac knows how many bytes it *wrote*. That is bytes queued, not bytes delivered — the
 * push-resume probe reported 12 MB "sent before the cut" when zero had arrived (`CLAUDE.md`, the
 * stimulus rule; defect 56). The phone is the receiver: its `fs.transfer.progress` counts bytes that
 * landed, and its `fs.transfer.done` is the verdict, `verified` included. So an item is `arrived`
 * only on the phone's `done`, and the bar is drawn only from the phone's `bytes`.
 *
 * The Mac's own "finished writing" moves an item to `confirming`, never to `arrived`: the file has
 * left this Mac, and the phone has not yet said what it made of it. **A small file usually emits no
 * progress at all** — only the final event (`docs/protocol.md`, *no progress events is a normal,
 * successful shape*) — so `confirming` with an empty bar is an ordinary state, not a stall.
 *
 * ### Order is not guaranteed, and the reducers do not assume it
 *
 * `fs.transfer.done` arrives on the control channel; the push's own resolution arrives through IPC
 * after the bulk socket closes. Either can be first. `onWriteFinished` therefore never downgrades an
 * item the phone has already answered for.
 *
 * Module-free for the same reason as `filesRoots.ts`: the renderer loads it as a classic script.
 */

type SendPhase =
  | 'queued'
  | 'sending'
  | 'confirming'
  | 'arrived'
  | 'failed'
  | 'cancelled';

interface SendItem {
  /** The local path, and the item's identity within its batch. */
  source: string;
  /** The name as picked on this Mac. */
  name: string;
  /** The name the phone agreed to receive it under — differs only after a collision. */
  sentAs: string | null;
  size: number;
  phase: SendPhase;
  transferId: string | null;
  /** Bytes the **phone** reports as landed. Never the Mac's write count. */
  delivered: number;
  /** The phone's word, from `fs.transfer.done`. `null` until it has spoken. */
  verified: boolean | null;
  reason: string | null;
  code: string | null;
}

interface SendBatch {
  phoneName: string;
  /** The breadcrumb of the destination, in the words the Files pane already uses. */
  destination: string;
  items: SendItem[];
  /** Set when the person pressed Stop. Nothing queued after it starts. */
  stopped: boolean;
}

function sendBatchCreate(
  files: Array<{ source: string; name: string; size: number }>,
  phoneName: string,
  destination: string,
): SendBatch {
  return {
    phoneName,
    destination,
    stopped: false,
    items: files.map((f) => ({
      source: f.source,
      name: f.name,
      sentAs: null,
      size: f.size,
      phase: 'queued',
      transferId: null,
      delivered: 0,
      verified: null,
      reason: null,
      code: null,
    })),
  };
}

function updateItem(
  batch: SendBatch,
  match: (item: SendItem) => boolean,
  change: (item: SendItem) => SendItem,
): SendBatch {
  let touched = false;
  const items = batch.items.map((item) => {
    if (touched || !match(item)) return item;
    touched = true;
    return change(item);
  });
  return touched ? { ...batch, items } : batch;
}

/**
 * This Mac has begun this file — hashing it and asking the phone — and the phone has not agreed yet.
 * It is `sending` with no `transferId`, which draws as *Starting…*; the point is that [sendBatchNext]
 * never hands the same file out twice while its agreement is in flight.
 */
function sendBatchOnStarted(batch: SendBatch, source: string): SendBatch {
  return updateItem(
    batch,
    (i) => i.source === source && i.phase === 'queued',
    (i) => ({ ...i, phase: 'sending' }),
  );
}

/** The phone agreed a `transferId` for this file, possibly under a suffixed name. */
function sendBatchOnAgreed(
  batch: SendBatch,
  source: string,
  transferId: string,
  sentAs: string,
): SendBatch {
  return updateItem(
    batch,
    (i) => i.source === source && (i.phase === 'queued' || (i.phase === 'sending' && i.transferId === null)),
    (i) => ({ ...i, phase: 'sending', transferId, sentAs }),
  );
}

/** `fs.transfer.progress` — bytes that landed on the phone. Never moves a count backwards. */
function sendBatchOnProgress(batch: SendBatch, transferId: string, bytes: number): SendBatch {
  return updateItem(
    batch,
    (i) => i.transferId === transferId,
    (i) => ({ ...i, delivered: Math.max(i.delivered, Math.min(bytes, i.size)) }),
  );
}

/**
 * The Mac finished its half — the push promise resolved.
 *
 * `ok` moves `sending` to `confirming` and nothing else: an item the phone has already answered for
 * keeps the phone's answer. A refusal before any `transferId` (a `NO_SPACE`, a revoked grant) fails
 * the item with the phone's own sentence and code.
 */
function sendBatchOnWriteFinished(
  batch: SendBatch,
  source: string,
  outcome: { ok: boolean; reason?: string; code?: string },
): SendBatch {
  return updateItem(
    batch,
    (i) => i.source === source && (i.phase === 'queued' || i.phase === 'sending'),
    (i) => {
      if (outcome.ok) return { ...i, phase: 'confirming' };
      return {
        ...i,
        phase: batch.stopped ? 'cancelled' : 'failed',
        reason: outcome.reason ?? 'The phone did not accept it.',
        code: outcome.code ?? null,
      };
    },
  );
}

/** `fs.transfer.done` — the phone's verdict, which is the only thing that makes an item `arrived`. */
function sendBatchOnDone(
  batch: SendBatch,
  done: { transferId: string; ok: boolean; bytes?: number; verified?: boolean; message?: string; code?: string },
): SendBatch {
  return updateItem(
    batch,
    (i) => i.transferId === done.transferId,
    (i) =>
      done.ok
        ? {
            ...i,
            phase: 'arrived',
            delivered: typeof done.bytes === 'number' ? Math.min(done.bytes, i.size) : i.size,
            verified: done.verified === true,
          }
        : {
            ...i,
            phase: batch.stopped ? 'cancelled' : 'failed',
            reason: done.message ?? i.reason ?? 'The phone reported the transfer as failed.',
            code: done.code ?? i.code,
          },
  );
}

/** The person pressed Stop: every queued item is cancelled; the one in flight is left to report. */
function sendBatchStop(batch: SendBatch): SendBatch {
  return {
    ...batch,
    stopped: true,
    items: batch.items.map((i) =>
      i.phase === 'queued' ? { ...i, phase: 'cancelled', reason: 'Not sent — stopped before it started.' } : i,
    ),
  };
}

/** Nothing left that can still change. */
function sendBatchSettled(batch: SendBatch): boolean {
  return batch.items.every(
    (i) => i.phase === 'arrived' || i.phase === 'failed' || i.phase === 'cancelled',
  );
}

/**
 * How many files of one batch this Mac writes at once. Each keeps its own `transferId`, its own
 * progress from the phone, its own digest and its own verdict; the phone serves every bulk socket on
 * its own coroutine.
 *
 * **Measured** (2026-09-29, SM-S938B on its own hotspot, `scripts/transfer-speed-probe.mjs`): eight
 * 1 MiB files one after another took 1,571 ms to the last verdict, against 574 ms for the same 8 MiB as
 * one file. The phone's log places the per-file cost: ≈ 30 ms to authorise the bulk socket, ≈ 50 ms of
 * bytes, then **≈ 165 ms after the last byte** to hash, publish into MediaStore (`IS_PENDING` 0) and
 * record it — ≈ 80 ms each when three commit together. A first version counted files awaiting that
 * verdict against this window, which made the fourth file wait for three commits and measured **no
 * gain** (4 × 1 MiB, 813–843 ms before, 829–842 ms after). So a finished write frees a writing slot, and
 * the phone's commits overlap the next file's bytes, bounded by [SEND_AWAITING_MAX].
 */
const SEND_WINDOW = 3;

/**
 * How many written files may wait for the phone's verdict at once. A bound, so a batch of hundreds
 * of small files cannot leave hundreds of pending items unanswered on the phone; not a tuned value.
 */
const SEND_AWAITING_MAX = 8;

/**
 * The name a file could land under on the phone, reduced to what can collide there: case folded
 * (the phone's shared storage is case-insensitive) and a `stem (n).ext` retry suffix removed (a
 * `TARGET_STALE` is answered by [suffixedName]). Two items with one key could reach one name.
 */
function sendNameKey(name: string): string {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : '';
  return (stem.replace(/ \(\d+\)$/, '') + extension).toLowerCase();
}

/**
 * The next file that should start, or null.
 *
 * - At most [SEND_WINDOW] files are `sending` (being written by this Mac) at once, and at most
 *   [SEND_AWAITING_MAX] are `sending` or `confirming` (written, not yet answered by the phone).
 * - **A file waits while any other file with its [sendNameKey] is in flight, or queued ahead of it.**
 *   The phone's Received files reuses a pending item with the same name (its resume path), so two
 *   such files in flight together could share one partial. The earlier one must have the phone's
 *   verdict first — after which a clash is an ordinary `TARGET_STALE` and a renamed retry. This also
 *   holds with a window of one: the Mac finishing its write is long before the phone has the bytes.
 */
function sendBatchNext(batch: SendBatch): SendItem | null {
  if (batch.stopped) return null;
  const inFlight = (i: SendItem) => i.phase === 'sending' || i.phase === 'confirming';
  if (batch.items.filter((i) => i.phase === 'sending').length >= SEND_WINDOW) return null;
  if (batch.items.filter(inFlight).length >= SEND_AWAITING_MAX) return null;
  for (const [index, item] of batch.items.entries()) {
    if (item.phase !== 'queued') continue;
    const key = sendNameKey(item.name);
    const blocked = batch.items.some(
      (other, at) =>
        other !== item &&
        (sendNameKey(other.name) === key || (other.sentAs !== null && sendNameKey(other.sentAs) === key)) &&
        (inFlight(other) || (other.phase === 'queued' && at < index)),
    );
    if (!blocked) return item;
  }
  return null;
}

/**
 * The batch's headline and bar, from the phone's numbers only.
 *
 * `fraction` is delivered bytes over total bytes — a batch of one 2 GB video and nine photos is 99%
 * the video, and a count-based bar would sit at 90% while almost nothing had moved.
 */
function sendBatchSummary(batch: SendBatch): {
  headline: string;
  detail: string;
  fraction: number;
  arrived: number;
  failed: number;
  cancelled: number;
  total: number;
} {
  const total = batch.items.length;
  const arrived = batch.items.filter((i) => i.phase === 'arrived').length;
  const failed = batch.items.filter((i) => i.phase === 'failed').length;
  const cancelled = batch.items.filter((i) => i.phase === 'cancelled').length;
  const bytesTotal = batch.items.reduce((s, i) => s + i.size, 0);
  const bytesDone = batch.items.reduce((s, i) => s + i.delivered, 0);
  const fraction = bytesTotal > 0 ? bytesDone / bytesTotal : arrived === total ? 1 : 0;
  const noun = (n: number) => `${n} file${n === 1 ? '' : 's'}`;

  let headline: string;
  if (!sendBatchSettled(batch)) {
    headline = `Sending ${noun(total)} to ${batch.phoneName}`;
  } else if (arrived === total) {
    headline = `${noun(total)} arrived on ${batch.phoneName}`;
  } else if (arrived === 0 && failed === 0) {
    // "Nothing arrived", never "nothing was sent": a Stop mid-file leaves real bytes on the phone as
    // a resumable partial (measured: 29.6 MB kept, and the next send resumed from exactly there).
    headline = 'Stopped — nothing arrived';
  } else {
    headline = `${arrived} of ${noun(total)} arrived`;
  }

  // The denominator every time, so "2 arrived" is never read as "2 left".
  const parts = [`${arrived} of ${total} arrived`];
  if (failed) parts.push(`${failed} failed`);
  if (cancelled) parts.push(`${cancelled} stopped`);
  return {
    headline,
    detail: `${parts.join(' · ')} · to ${batch.destination}`,
    fraction: Math.max(0, Math.min(1, fraction)),
    arrived,
    failed,
    cancelled,
    total,
  };
}

/**
 * `name`, `name (2)`, `name (3)` — the same rule `freeName` uses for a pull into a Mac folder, so a
 * collision is resolved the same way in both directions. `n` is 1-based; 1 is the name itself.
 */
function suffixedName(name: string, n: number): string {
  if (n <= 1) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : '';
  return `${stem} (${n})${extension}`;
}

{
  const g = globalThis as Record<string, unknown>;
  g.sendBatchCreate = sendBatchCreate;
  g.sendBatchOnAgreed = sendBatchOnAgreed;
  g.sendBatchOnProgress = sendBatchOnProgress;
  g.sendBatchOnWriteFinished = sendBatchOnWriteFinished;
  g.sendBatchOnDone = sendBatchOnDone;
  g.sendBatchStop = sendBatchStop;
  g.sendBatchSettled = sendBatchSettled;
  g.sendBatchNext = sendBatchNext;
  g.sendBatchSummary = sendBatchSummary;
  g.suffixedName = suffixedName;
  g.sendBatchOnStarted = sendBatchOnStarted;
  g.sendNameKey = sendNameKey;
  g.SEND_WINDOW = SEND_WINDOW;
  g.SEND_AWAITING_MAX = SEND_AWAITING_MAX;
}

if (typeof module !== 'undefined') {
  module.exports = {
    sendBatchCreate,
    sendBatchOnAgreed,
    sendBatchOnProgress,
    sendBatchOnWriteFinished,
    sendBatchOnDone,
    sendBatchStop,
    sendBatchSettled,
    sendBatchNext,
    sendBatchSummary,
    suffixedName,
    sendBatchOnStarted,
    sendNameKey,
    SEND_WINDOW,
    SEND_AWAITING_MAX,
  };
}
