/**
 * Records between Electron main and the Sidekick Camera bridge — docs/protocol.md → The Mac's local
 * contract → Electron main ↔ the bridge. The bridge's side is `BridgeRecord.swift`; the two are held to
 * each other by `webcamBridge.test.ts`, which runs the **built** bridge, not a model of it.
 *
 * A record is a 4-byte big-endian length `L`, a 1-byte type, then `L − 1` body bytes.
 *
 * ### Strict on what comes back
 *
 * The bridge's stdout carries only type-0x81 status records, each a JSON object with a known `op` and
 * exactly that op's fields. Anything else — another type, a length past the cap, bytes that are not
 * JSON, an unknown op, a missing or extra field — is a {@link BridgeOutputError}, and the caller treats
 * the bridge as failed. A stray `print` in the bridge would land here, and the honest response to a
 * corrupted channel is to stop trusting it, not to skip ahead looking for the next plausible record.
 *
 * Main's cap on a status record (64 KiB) is tighter than the contract's 2 MiB + 64 for records in
 * general: a status is a few hundred bytes of JSON, and a reader holding 2 MiB for one would be a
 * bound nobody needs.
 */

import { isSessionId } from './webcamWire';

export const RECORD_CONTROL = 0x01;
export const RECORD_ACCESS_UNIT = 0x02;
export const RECORD_STATUS = 0x81;

/** The contract's cap on `L`, for records main writes. */
export const RECORD_MAX_LENGTH = 2 * 1024 * 1024 + 64;
/** Main's cap on `L` for a status record it reads. */
export const STATUS_MAX_LENGTH = 64 * 1024;

export function encodeRecord(type: number, body: Buffer): Buffer {
  const length = 1 + body.length;
  if (length > RECORD_MAX_LENGTH) throw new Error(`bridge record of ${length} bytes is over the ${RECORD_MAX_LENGTH}-byte cap`);
  const head = Buffer.alloc(5);
  head.writeUInt32BE(length, 0);
  head.writeUInt8(type, 4);
  return Buffer.concat([head, body]);
}

export type BridgeControl =
  | { op: 'session-live'; sessionId: string; generation: number }
  | { op: 'session-ended'; sessionId: string; reason: string }
  | { op: 'shutdown' };

export function controlRecord(control: BridgeControl): Buffer {
  if (control.op !== 'shutdown' && !isSessionId(control.sessionId)) throw new Error('control record: bad sessionId');
  if (control.op === 'session-live' && !(Number.isInteger(control.generation) && control.generation >= 1 && control.generation <= 0xffff)) {
    throw new Error('control record: generation must be 1..65535');
  }
  return encodeRecord(RECORD_CONTROL, Buffer.from(JSON.stringify(control), 'utf8'));
}

/** Type 0x02: the session's 16 raw bytes, then the AU verbatim. */
export function accessUnitRecord(sessionId: string, frame: Buffer): Buffer {
  if (!isSessionId(sessionId)) throw new Error('access-unit record: bad sessionId');
  return encodeRecord(RECORD_ACCESS_UNIT, Buffer.concat([Buffer.from(sessionId, 'hex'), frame]));
}

export type SinkState = 'device-not-installed' | 'refused' | 'idle' | 'feeding';
const SINK_STATES: ReadonlySet<string> = new Set<SinkState>(['device-not-installed', 'refused', 'idle', 'feeding']);

/**
 * `stream-rejected`'s `violation` — the bridge's `StreamFault`, a closed set of fixed tokens held to
 * `docs/fixtures/webcam-vocabulary-v1.json`. Anything else is malformed output: an exception's text is
 * never accepted in its place.
 */
export const STREAM_FAULTS = Object.freeze([
  'shorter-than-frame-header', 'frame-flags-reserved', 'length-over-cap', 'length-mismatch',
  'payload-too-short', 'unknown-version', 'unknown-codec', 'bad-facing', 'bad-rotation',
  'header-reserved-bits', 'bad-dimensions', 'zero-generation', 'no-start-code', 'idr-flag-without-idr',
  'config-flag-without-config', 'generation-went-backwards', 'sequence-did-not-increase',
  'generation-without-keyframe',
] as const);
export type StreamFault = (typeof STREAM_FAULTS)[number];
const STREAM_FAULT_SET: ReadonlySet<string> = new Set(STREAM_FAULTS);

export type BridgeStatus =
  | { op: 'ready'; deviceInstalled: boolean; producerIdentityConfigured: boolean }
  | { op: 'consumers'; count: number }
  | { op: 'session-ended'; sessionId: string; reason: string }
  /**
   * The live session's stream broke the access-unit contract and the bridge has already ended it.
   * Bound to that session; `generation` is 0 when the AU could not be read far enough to say.
   */
  | { op: 'stream-rejected'; sessionId: string; generation: number; violation: StreamFault }
  | { op: 'sink'; state: SinkState }
  | { op: 'counts'; counts: Record<string, number> }
  | { op: 'error'; error: string }
  /**
   * Version 2 (docs/protocol.md → the local contract): the live session's decode chain broke and the
   * bridge now refuses every non-IDR until an IDR. Once per break. Main may answer with `webcam.keyframe`.
   */
  | { op: 'chain-broken'; sessionId: string; generation: number; cause: ChainBreakCause }
  /** The first frame admitted after that break reached the sink. Once per `chain-broken`. */
  | { op: 'chain-recovered'; sessionId: string; generation: number };

/** `chain-broken`'s `cause`, held to `docs/fixtures/webcam-vocabulary-v1.json` (`chainBreakCauses`). */
export const CHAIN_BREAK_CAUSES = Object.freeze(['queue-full', 'decode-failed', 'compose-failed'] as const);
export type ChainBreakCause = (typeof CHAIN_BREAK_CAUSES)[number];
const CHAIN_BREAK_CAUSE_SET: ReadonlySet<string> = new Set(CHAIN_BREAK_CAUSES);

function liveGeneration(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 0xffff) {
    throw new BridgeOutputError(`${field} is not 1..65535`);
  }
  return value;
}

/** The bridge's output broke the contract. The bridge is no longer trusted. */
export class BridgeOutputError extends Error {
  constructor(readonly reason: string) {
    super(`bridge output: ${reason}`);
  }
}

const MAX_TEXT = 4096;
const MAX_COUNTERS = 128;

function exactKeys(obj: Record<string, unknown>, keys: string[]): void {
  const have = Object.keys(obj).sort();
  const want = [...keys].sort();
  if (have.length !== want.length || have.some((k, i) => k !== want[i])) {
    throw new BridgeOutputError(`${String(obj.op)} carries fields [${have.join(', ')}], expected [${want.join(', ')}]`);
  }
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length > MAX_TEXT) throw new BridgeOutputError(`${field} is not a string of ≤ ${MAX_TEXT}`);
  return value;
}

function count(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new BridgeOutputError(`${field} is not a count`);
  return value;
}

/** One status record's body. Throws {@link BridgeOutputError} for anything the contract does not allow. */
export function parseStatus(body: Buffer): BridgeStatus {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString('utf8'));
  } catch {
    throw new BridgeOutputError('status body is not JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new BridgeOutputError('status body is not an object');
  const obj = parsed as Record<string, unknown>;
  switch (obj.op) {
    case 'ready': {
      exactKeys(obj, ['op', 'device', 'producerIdentity']);
      if (obj.device !== 'installed' && obj.device !== 'not-installed') throw new BridgeOutputError('ready.device is not installed/not-installed');
      if (obj.producerIdentity !== 'configured' && obj.producerIdentity !== 'unconfigured') {
        throw new BridgeOutputError('ready.producerIdentity is not configured/unconfigured');
      }
      return { op: 'ready', deviceInstalled: obj.device === 'installed', producerIdentityConfigured: obj.producerIdentity === 'configured' };
    }
    case 'consumers':
      exactKeys(obj, ['op', 'count']);
      return { op: 'consumers', count: count(obj.count, 'consumers.count') };
    case 'session-ended':
      exactKeys(obj, ['op', 'sessionId', 'reason']);
      if (!isSessionId(obj.sessionId)) throw new BridgeOutputError('session-ended.sessionId is not 32 lowercase hex');
      return { op: 'session-ended', sessionId: obj.sessionId, reason: text(obj.reason, 'session-ended.reason') };
    case 'stream-rejected': {
      exactKeys(obj, ['op', 'sessionId', 'generation', 'violation']);
      if (!isSessionId(obj.sessionId)) throw new BridgeOutputError('stream-rejected.sessionId is not 32 lowercase hex');
      const generation = obj.generation;
      if (typeof generation !== 'number' || !Number.isInteger(generation) || generation < 0 || generation > 0xffff) {
        throw new BridgeOutputError('stream-rejected.generation is not 0..65535');
      }
      if (typeof obj.violation !== 'string' || !STREAM_FAULT_SET.has(obj.violation)) {
        throw new BridgeOutputError('stream-rejected.violation is not a known fault');
      }
      return { op: 'stream-rejected', sessionId: obj.sessionId, generation, violation: obj.violation as StreamFault };
    }
    case 'chain-broken': {
      exactKeys(obj, ['op', 'sessionId', 'generation', 'cause']);
      if (!isSessionId(obj.sessionId)) throw new BridgeOutputError('chain-broken.sessionId is not 32 lowercase hex');
      const generation = liveGeneration(obj.generation, 'chain-broken.generation');
      if (typeof obj.cause !== 'string' || !CHAIN_BREAK_CAUSE_SET.has(obj.cause)) {
        throw new BridgeOutputError('chain-broken.cause is not a known cause');
      }
      return { op: 'chain-broken', sessionId: obj.sessionId, generation, cause: obj.cause as ChainBreakCause };
    }
    case 'chain-recovered': {
      exactKeys(obj, ['op', 'sessionId', 'generation']);
      if (!isSessionId(obj.sessionId)) throw new BridgeOutputError('chain-recovered.sessionId is not 32 lowercase hex');
      return { op: 'chain-recovered', sessionId: obj.sessionId, generation: liveGeneration(obj.generation, 'chain-recovered.generation') };
    }
    case 'sink':
      exactKeys(obj, ['op', 'state']);
      if (typeof obj.state !== 'string' || !SINK_STATES.has(obj.state)) throw new BridgeOutputError('sink.state is not a known state');
      return { op: 'sink', state: obj.state as SinkState };
    case 'counts': {
      exactKeys(obj, ['op', 'counts']);
      const raw = obj.counts;
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new BridgeOutputError('counts.counts is not an object');
      const entries = Object.entries(raw as Record<string, unknown>);
      if (entries.length > MAX_COUNTERS) throw new BridgeOutputError(`counts carries ${entries.length} counters`);
      const counts: Record<string, number> = {};
      for (const [key, value] of entries) {
        if (key.length === 0 || key.length > 64) throw new BridgeOutputError('a counter name is empty or over 64 characters');
        counts[key] = count(value, `counts.${key}`);
      }
      return { op: 'counts', counts };
    }
    case 'error':
      exactKeys(obj, ['op', 'error']);
      return { op: 'error', error: text(obj.error, 'error.error') };
    default:
      throw new BridgeOutputError(`unknown status op ${JSON.stringify(obj.op)?.slice(0, 64)}`);
  }
}

/**
 * Reads status records out of the bridge's stdout, in whatever chunks the pipe delivers. The buffer
 * never exceeds one record's 5-byte head plus {@link STATUS_MAX_LENGTH}: a longer `L` is refused from
 * the head alone. After a throw the reader is spent.
 */
export class StatusRecordReader {
  private buffer: Buffer = Buffer.alloc(0);
  private broken = false;

  get buffered(): number {
    return this.buffer.length;
  }

  push(chunk: Buffer): BridgeStatus[] {
    if (this.broken) throw new BridgeOutputError('reader already closed by earlier malformed output');
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    const out: BridgeStatus[] = [];
    try {
      for (;;) {
        if (this.buffer.length < 4) break;
        const length = this.buffer.readUInt32BE(0);
        if (length < 1) throw new BridgeOutputError('record length 0');
        if (length > STATUS_MAX_LENGTH) throw new BridgeOutputError(`record length ${length} is over the ${STATUS_MAX_LENGTH}-byte status cap`);
        if (this.buffer.length >= 5 && this.buffer.readUInt8(4) !== RECORD_STATUS) {
          throw new BridgeOutputError(`record type 0x${this.buffer.readUInt8(4).toString(16)} on the bridge's stdout`);
        }
        if (this.buffer.length < 4 + length) break;
        out.push(parseStatus(this.buffer.subarray(5, 4 + length)));
        this.buffer = this.buffer.subarray(4 + length);
      }
    } catch (error) {
      this.broken = true;
      this.buffer = Buffer.alloc(0);
      throw error;
    }
    if (this.buffer.length > 0 && this.buffer.byteOffset !== 0) this.buffer = Buffer.from(this.buffer);
    return out;
  }
}
