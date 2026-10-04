/**
 * Stand-ins for the webcam controller's tests. **Every class here is labelled a stand-in, and none of
 * them is evidence about the thing it stands in for**: the phone link, the stream socket and the bridge
 * are modelled so the production `WebcamController` can be driven; the bridge's real behaviour is
 * `webcamBridge.test.ts`'s, against the built Swift binary.
 *
 * Access units are generated from the golden fixture `docs/fixtures/webcam-au-v1.hex` — the one copy
 * of the wire bytes — with only the fields a test varies rewritten.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CameraSocket, CameraTimers } from './camera';
import { WebcamController, type WebcamLinkPort, type WebcamStatus } from './webcam';
import type { BridgeExit, BridgeHooks, BridgePort, BridgeSideCounts } from './webcamBridge';
import type { BridgeStatus } from '../shared/webcamBridgeRecords';

export const TOKEN = 'a'.repeat(64);
export const OTHER_TOKEN = 'b'.repeat(64);
export const SESSION = '0123456789abcdef0123456789abcdef';
export const SESSION_2 = 'fedcba9876543210fedcba9876543210';
export const SESSION_3 = '00112233445566778899aabbccddeeff';

/** The golden AU, exactly as the fixture spells it. */
export function goldenAU(): Buffer {
  const text = readFileSync(join(__dirname, '../../../docs/fixtures/webcam-au-v1.hex'), 'utf8')
    .split('\n')
    .filter((line) => !line.startsWith('#'))
    .join('')
    .replace(/\s+/g, '');
  return Buffer.from(text, 'hex');
}

/**
 * A generated AU: the golden one with [generation], [sequence] and keyframe-ness rewritten, padded to
 * at least [size] bytes with a filler NAL so backpressure can be exercised. A non-keyframe is the golden
 * AU's IDR slice retyped as a non-IDR slice (type 1) with SPS and PPS removed — structurally what the
 * bridge expects of a P-frame.
 */
export function makeAU(opts: { generation?: number; sequence?: number; keyframe?: boolean; size?: number } = {}): Buffer {
  const golden = goldenAU();
  const header = Buffer.from(golden.subarray(13, 29));
  header.writeUInt16BE(opts.generation ?? 7, 6);
  header.writeUInt32BE(opts.sequence ?? 1, 12);
  const keyframe = opts.keyframe ?? true;
  let annexB = keyframe ? Buffer.from(golden.subarray(29)) : Buffer.from([0, 0, 0, 1, 0x41, 0x9a, 0x02, 0x03]);
  const want = opts.size ?? 0;
  if (13 + 16 + annexB.length < want) {
    const fill = Buffer.alloc(want - (13 + 16 + annexB.length));
    if (fill.length >= 5) {
      fill.writeUInt32BE(1, 0);
      fill[4] = 0x0c; // filler data NAL
      fill.fill(0xff, 5);
    }
    annexB = Buffer.concat([annexB, fill]);
  }
  const payload = Buffer.concat([header, annexB]);
  const frame = Buffer.alloc(13);
  frame.writeUInt8(keyframe ? 0x03 : 0x00, 0);
  frame.writeBigUInt64BE(BigInt(opts.sequence ?? 1) * 33_000n, 1);
  frame.writeUInt32BE(payload.length, 9);
  return Buffer.concat([frame, payload]);
}

/** STAND-IN for the claimed 42502 socket. */
export class StandInSocket implements CameraSocket {
  private data: Array<(chunk: Buffer) => void> = [];
  private closers: Array<(reason: string) => void> = [];
  destroyed = false;
  constructor(private readonly events: string[], readonly claim: string) {}
  onData(listener: (chunk: Buffer) => void): void {
    this.data.push(listener);
  }
  onClose(listener: (reason: string) => void): void {
    this.closers.push(listener);
  }
  destroy(): void {
    if (!this.destroyed) this.events.push('socket.destroy');
    this.destroyed = true;
  }
  feed(chunk: Buffer): void {
    for (const l of this.data) l(chunk);
  }
  hangUp(): void {
    for (const l of this.closers) l('closed by the phone');
  }
}

/** STAND-IN for the bridge child. Records every call in order; reports whatever a test tells it to. */
export class StandInBridge implements BridgePort {
  readonly pid = 4242;
  calls: Array<{ op: string; sessionId?: string; generation?: number; reason?: string; bytes?: number; keyframe?: boolean }> = [];
  accept = true;
  stopped = false;
  constructor(private readonly hooks: BridgeHooks, private readonly events: string[]) {}
  sessionLive(sessionId: string, generation: number): void {
    this.calls.push({ op: 'session-live', sessionId, generation });
    this.events.push(`bridge.session-live ${sessionId.slice(0, 4)} g${generation}`);
  }
  sessionEnded(sessionId: string, reason: string): void {
    this.calls.push({ op: 'session-ended', sessionId, reason });
    this.events.push(`bridge.session-ended ${sessionId.slice(0, 4)} ${reason}`);
  }
  sendAccessUnit(sessionId: string, frame: Buffer, keyframe: boolean): boolean {
    this.calls.push({ op: 'au', sessionId, bytes: frame.length, keyframe });
    this.events.push(`bridge.au ${sessionId.slice(0, 4)} seq${frame.readUInt32BE(13 + 12)}`);
    return this.accept;
  }
  counts(): BridgeSideCounts {
    return { forwarded: 0, droppedBridge: 0, discardedEnded: 0, maxPending: 0, stderrLines: 0 };
  }
  async stop(): Promise<BridgeExit> {
    this.stopped = true;
    const exit: BridgeExit = { code: 0, signal: null, requested: true, cause: 'stopped' };
    this.hooks.onExit(exit);
    return exit;
  }
  report(status: BridgeStatus): void {
    this.hooks.onStatus(status);
  }
  crash(): void {
    this.hooks.onExit({ code: null, signal: 'SIGSEGV', requested: false, cause: 'exited' });
  }
  aus(sessionId?: string): number {
    return this.calls.filter((c) => c.op === 'au' && (sessionId === undefined || c.sessionId === sessionId)).length;
  }
}

type Reply = (type: string, payload: Record<string, unknown>) => Promise<{ payload?: unknown }>;

/** STAND-IN for the phone, as the control link presents it. */
export interface StandInPhone {
  connected: boolean;
  token: string | null;
  capabilities: string[];
  unavailable: Record<string, string>;
  negotiated: Record<string, number>;
  /** What each request is answered with. Tests replace it to hold an ack, refuse, or answer late. */
  reply: Reply;
  sent: Array<{ type: string; payload: Record<string, unknown> }>;
  /** The session ids the stand-in phone mints, in order. */
  nextSessionIds: string[];
}

export interface Rig {
  controller: WebcamController;
  phone: StandInPhone;
  bridges: StandInBridge[];
  bridge(): StandInBridge;
  sockets: StandInSocket[];
  states: WebcamStatus[];
  last(): WebcamStatus;
  logs: string[];
  /** Every observable effect, in the order it happened, across the link, the socket and the bridge. */
  events: string[];
  clock: { now: number; timeouts: Array<{ fn: () => void; at: number; cleared: boolean }> };
  tick(ms: number): void;
  requests(type?: string): Array<{ type: string; payload: Record<string, unknown> }>;
  /** Bridge up, Sidekick Camera installed, producer identity configured — **INJECTED**: on this Mac
   * today the real bridge reports `not-installed` / `unconfigured`, and no request is ever sent. */
  ready(opts?: { device?: boolean; producer?: boolean }): void;
  consumers(n: number): void;
  /** Lets every pending promise run. */
  flush(): Promise<void>;
}

export function rig(opts: { bridgePresent?: boolean; openSocketThrows?: boolean } = {}): Rig {
  const events: string[] = [];
  const phone: StandInPhone = {
    connected: true,
    token: TOKEN,
    capabilities: ['camera', 'webcam'],
    unavailable: {},
    negotiated: { webcam: 1 },
    sent: [],
    nextSessionIds: [SESSION, SESSION_2, SESSION_3],
    reply: async (type) => {
      if (type === 'webcam.request') {
        const sessionId = phone.nextSessionIds.shift() ?? SESSION_3;
        return { payload: { state: 'awaiting-approval', sessionId, facing: 'front', expiresInMs: 30_000 } };
      }
      if (type === 'webcam.stop') return { payload: { stopped: true } };
      return { payload: {} };
    },
  };
  const link: WebcamLinkPort = {
    isConnected: () => phone.connected,
    token: () => (phone.connected ? phone.token : null),
    address: () => '10.0.0.2',
    capabilities: () => phone.capabilities,
    unavailableReason: (name) => phone.unavailable[name] ?? null,
    negotiated: () => phone.negotiated,
    request: (type, payload) => {
      phone.sent.push({ type, payload });
      events.push(`link.${type}${payload.cause ? ` ${String(payload.cause)}` : ''}`);
      return phone.reply(type, payload);
    },
  };
  const clock = { now: 1_000_000, timeouts: [] as Array<{ fn: () => void; at: number; cleared: boolean }> };
  const timers: CameraTimers = {
    now: () => clock.now,
    setInterval: () => null,
    clearInterval: () => undefined,
    setTimeout: (fn, ms) => {
      const entry = { fn, at: clock.now + ms, cleared: false };
      clock.timeouts.push(entry);
      return entry;
    },
    clearTimeout: (h) => {
      if (h) (h as { cleared: boolean }).cleared = true;
    },
  };
  const bridges: StandInBridge[] = [];
  const sockets: StandInSocket[] = [];
  const states: WebcamStatus[] = [];
  const logs: string[] = [];
  const controller = new WebcamController({
    link,
    openSocket: (_host, claim) => {
      if (opts.openSocketThrows) throw new Error('stand-in: connect refused');
      const socket = new StandInSocket(events, claim);
      sockets.push(socket);
      events.push('socket.open');
      return socket;
    },
    startBridge:
      opts.bridgePresent === false
        ? null
        : (hooks) => {
            const b = new StandInBridge(hooks, events);
            bridges.push(b);
            return b;
          },
    bridgeAbsentReason: 'the camera bridge is not built (stand-in: absent)',
    emitState: (s) => states.push(s),
    timers,
    log: { info: (m) => logs.push(`I ${m}`), warn: (m) => logs.push(`W ${m}`) },
  });
  const r: Rig = {
    controller,
    phone,
    bridges,
    bridge: () => bridges[bridges.length - 1]!,
    sockets,
    states,
    last: () => controller.current(),
    logs,
    events,
    clock,
    tick: (ms) => {
      clock.now += ms;
      for (const t of [...clock.timeouts]) {
        if (!t.cleared && t.at <= clock.now) {
          t.cleared = true;
          t.fn();
        }
      }
    },
    requests: (type) => phone.sent.filter((s) => type === undefined || s.type === type),
    ready: (o = {}) => {
      controller.start();
      r.bridge().report({ op: 'ready', deviceInstalled: o.device ?? true, producerIdentityConfigured: o.producer ?? true });
      r.bridge().report({ op: 'consumers', count: 0 });
    },
    consumers: (n) => r.bridge().report({ op: 'consumers', count: n }),
    flush: async () => {
      for (let i = 0; i < 10; i++) await new Promise<void>((resolve) => setImmediate(resolve));
    },
  };
  return r;
}

/** A promise and its resolver: lets a test hold the phone's ack while it does something else. */
export function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
