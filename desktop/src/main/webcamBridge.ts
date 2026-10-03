/**
 * The Sidekick Camera bridge as a child of Electron main — docs/protocol.md → The Mac's local contract.
 *
 * Electron-free: `child_process` only, so `webcamBridge.test.ts` runs this class against the **built**
 * Swift bridge and against labelled stand-in children, with no Electron in the loop.
 *
 * ### What it guarantees
 *
 * - **One executable, no shell.** `spawn(path, [], { shell: false })` on a path {@link resolveBridgeExecutable}
 *   produced and checked. Nothing is interpolated into a command line; there is no command line.
 * - **Two channels kept apart.** stdout is framed records and nothing else — a byte that breaks the
 *   framing fails the bridge. stderr is diagnostics, read as bounded lines into the log.
 * - **Bounded towards the bridge.** At most {@link BRIDGE_AU_BOUND} access units are held here or
 *   handed to a pipe that has not taken them; past that the contract's keyframe rule drops, counted
 *   `droppedBridge`. Control records are never dropped and go ahead of waiting AUs.
 * - **Reaped, always.** `stop()` asks (`shutdown`, then stdin closed), then escalates — SIGTERM, then
 *   SIGKILL — and resolves only on the child's `exit`. A bridge that never says `ready` is treated as
 *   failed and stopped the same way.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { lstatSync, realpathSync, constants as fsConstants, accessSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, sep } from 'node:path';
import { log } from './logger';
import { KeyframeQueue } from '../shared/webcamWire';
import {
  BridgeOutputError,
  StatusRecordReader,
  accessUnitRecord,
  controlRecord,
  type BridgeControl,
  type BridgeStatus,
} from '../shared/webcamBridgeRecords';

/** Electron main → bridge: 4 AUs (docs/protocol.md → Bounded buffering). */
export const BRIDGE_AU_BOUND = 4;
export const BRIDGE_EXECUTABLE_NAME = 'sidekick-camera-bridge';

const STDERR_LINE_MAX = 2048;

export interface BridgeLog {
  info(message: string): void;
  warn(message: string): void;
}

const realLog: BridgeLog = {
  info: (message) => log.info('webcam', message),
  warn: (message) => log.warn('webcam', message),
};

/** How the child ended, and whether this side asked it to. */
export interface BridgeExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  /** True only when `stop()` was called before the exit. */
  requested: boolean;
  /** What ended it, in words for the log: `stopped`, `exited`, `malformed-output`, `no-ready`, `spawn-failed: …`. */
  cause: string;
}

export interface BridgeHooks {
  onStatus(status: BridgeStatus): void;
  onExit(exit: BridgeExit): void;
}

/** What the webcam controller needs of a bridge. {@link BridgeProcess} is the real one. */
export interface BridgePort {
  readonly pid: number | null;
  sessionLive(sessionId: string, generation: number): void;
  sessionEnded(sessionId: string, reason: string): void;
  /** Hands one AU, verbatim, to the bridge. False when the bound dropped it. */
  sendAccessUnit(sessionId: string, frame: Buffer, keyframe: boolean): boolean;
  counts(): BridgeSideCounts;
  stop(): Promise<BridgeExit>;
}

export interface BridgeSideCounts {
  /** AUs written to the pipe. */
  forwarded: number;
  /** AUs the bound dropped (the keyframe rule). */
  droppedBridge: number;
  /** AUs waiting here when their session ended — never written. */
  discardedEnded: number;
  /** The most AUs ever held here and in flight at once — the bound's own reading. */
  maxPending: number;
  stderrLines: number;
}

export interface BridgeProcessOptions extends BridgeHooks {
  /** An absolute path from {@link resolveBridgeExecutable} — or, in the tests only, a labelled stand-in. */
  executable: string;
  /** Empty for the real bridge. The tests' stand-ins are scripts run by `node`. */
  args?: readonly string[];
  /** How long the bridge has to say `ready`. */
  readyTimeoutMs?: number;
  /** After `shutdown` and a closed stdin, how long before SIGTERM; then how long before SIGKILL. */
  gracefulMs?: number;
  termMs?: number;
  log?: BridgeLog;
}

interface PendingAU {
  sessionId: string;
  record: Buffer;
}

export class BridgeProcess implements BridgePort {
  private readonly child: ChildProcess;
  private readonly reader = new StatusRecordReader();
  private readonly aus = new KeyframeQueue<PendingAU>(BRIDGE_AU_BOUND);
  private readonly controls: Buffer[] = [];
  /** The last write the pipe did not take at once, while it drains. */
  private inFlight: { au: boolean } | null = null;
  private stdinOpen = true;
  private exitInfo: BridgeExit | null = null;
  private stopRequested = false;
  private stopping: Promise<BridgeExit> | null = null;
  private exitWaiters: Array<(exit: BridgeExit) => void> = [];
  private failCause: string | null = null;
  private readyTimer: NodeJS.Timeout | null = null;
  private killTimers: NodeJS.Timeout[] = [];
  private stderrPartial = '';
  private readonly tally: BridgeSideCounts = { forwarded: 0, droppedBridge: 0, discardedEnded: 0, maxPending: 0, stderrLines: 0 };
  private readonly log: BridgeLog;
  private readonly gracefulMs: number;
  private readonly termMs: number;

  constructor(private readonly options: BridgeProcessOptions) {
    this.log = options.log ?? realLog;
    this.gracefulMs = options.gracefulMs ?? 2_000;
    this.termMs = options.termMs ?? 1_000;
    if (!isAbsolute(options.executable)) throw new Error('bridge executable must be an absolute path');
    this.child = spawn(options.executable, [...(options.args ?? [])], {
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { PATH: '/usr/bin:/bin' },
    });
    this.log.info(`camera bridge spawned: pid ${this.child.pid ?? 'none'} (${basename(options.executable)})`);

    this.child.on('error', (error) => {
      // Spawn failure (ENOENT, EACCES) arrives here and may never be followed by `exit`.
      this.failCause ??= `spawn-failed: ${(error as NodeJS.ErrnoException).code ?? error.message}`;
      if (this.child.pid === undefined) this.finish({ code: null, signal: null });
    });
    this.child.on('exit', (code, signal) => this.finish({ code, signal }));
    this.child.stdin?.on('error', (error) => {
      // EPIPE: the bridge went away mid-write. Its exit reports why; this only stops further writes.
      this.stdinOpen = false;
      this.log.warn(`camera bridge stdin: ${(error as NodeJS.ErrnoException).code ?? error.message}`);
    });
    this.child.stdout?.on('data', (chunk: Buffer) => this.onStdout(chunk));
    this.child.stderr?.on('data', (chunk: Buffer) => this.onStderr(chunk));

    this.readyTimer = setTimeout(() => {
      this.readyTimer = null;
      this.fail('no-ready', 'the camera bridge did not report ready');
    }, options.readyTimeoutMs ?? 5_000);
  }

  get pid(): number | null {
    return this.child.pid ?? null;
  }

  /** True once the child's exit (or spawn failure) has been seen. Until then its pid cannot be reused. */
  get exited(): boolean {
    return this.exitInfo !== null;
  }

  counts(): BridgeSideCounts {
    return { ...this.tally };
  }

  // ---- towards the bridge ----------------------------------------------------------------------

  sessionLive(sessionId: string, generation: number): void {
    // AUs of any other session have no business behind this one.
    this.tally.discardedEnded += this.aus.removeWhere((au) => au.sessionId !== sessionId);
    this.sendControl({ op: 'session-live', sessionId, generation });
  }

  sessionEnded(sessionId: string, reason: string): void {
    this.tally.discardedEnded += this.aus.removeWhere((au) => au.sessionId === sessionId);
    this.sendControl({ op: 'session-ended', sessionId, reason });
  }

  sendAccessUnit(sessionId: string, frame: Buffer, keyframe: boolean): boolean {
    if (!this.writable()) return false;
    const inFlight = this.inFlight?.au ? 1 : 0;
    const before = this.aus.dropped;
    const taken = this.aus.offer({ sessionId, record: accessUnitRecord(sessionId, frame) }, keyframe, inFlight);
    this.tally.droppedBridge += this.aus.dropped - before;
    this.tally.maxPending = Math.max(this.tally.maxPending, this.aus.length + inFlight);
    this.pump();
    return taken;
  }

  private sendControl(control: BridgeControl): void {
    if (!this.writable()) return;
    this.controls.push(controlRecord(control));
    this.pump();
  }

  private writable(): boolean {
    return this.stdinOpen && this.exitInfo === null && this.child.stdin !== null && !this.child.stdin.destroyed;
  }

  /** Writes while the pipe takes them: control records first, then AUs in order. */
  private pump(): void {
    const stdin = this.child.stdin;
    while (this.inFlight === null && this.writable() && stdin) {
      let buf: Buffer | undefined;
      let isAU = false;
      if (this.controls.length > 0) {
        buf = this.controls.shift();
      } else {
        const au = this.aus.shift();
        if (au) {
          buf = au.record;
          isAU = true;
        }
      }
      if (!buf) return;
      if (isAU) this.tally.forwarded += 1;
      if (!stdin.write(buf)) {
        this.inFlight = { au: isAU };
        stdin.once('drain', () => {
          this.inFlight = null;
          this.pump();
        });
      }
    }
  }

  // ---- from the bridge -------------------------------------------------------------------------

  private onStdout(chunk: Buffer): void {
    if (this.exitInfo !== null || this.failCause !== null) return;
    let statuses: BridgeStatus[];
    try {
      statuses = this.reader.push(chunk);
    } catch (error) {
      const reason = error instanceof BridgeOutputError ? error.reason : String(error);
      this.fail('malformed-output', `camera bridge output broke the contract (${reason})`);
      return;
    }
    for (const status of statuses) {
      if (status.op === 'ready' && this.readyTimer !== null) {
        clearTimeout(this.readyTimer);
        this.readyTimer = null;
      }
      this.options.onStatus(status);
    }
  }

  private onStderr(chunk: Buffer): void {
    this.stderrPartial += chunk.toString('utf8');
    let nl: number;
    while ((nl = this.stderrPartial.indexOf('\n')) >= 0) {
      this.diag(this.stderrPartial.slice(0, nl));
      this.stderrPartial = this.stderrPartial.slice(nl + 1);
    }
    if (this.stderrPartial.length > STDERR_LINE_MAX) {
      this.diag(`${this.stderrPartial.slice(0, STDERR_LINE_MAX)} …(truncated)`);
      this.stderrPartial = '';
    }
  }

  private diag(line: string): void {
    this.tally.stderrLines += 1;
    if (line.length > 0) this.log.info(`camera bridge says: ${line.slice(0, STDERR_LINE_MAX)}`);
  }

  // ---- ending ----------------------------------------------------------------------------------

  /** The bridge can no longer be trusted: stop it, and say why on exit. */
  private fail(cause: string, sentence: string): void {
    if (this.failCause !== null || this.exitInfo !== null) return;
    this.failCause = cause;
    this.log.warn(`${sentence}; stopping it`);
    void this.terminate(false);
  }

  stop(): Promise<BridgeExit> {
    this.stopRequested = true;
    return this.terminate(true);
  }

  private terminate(ask: boolean): Promise<BridgeExit> {
    if (this.exitInfo) return Promise.resolve(this.exitInfo);
    if (this.stopping) return this.stopping;
    this.stopping = new Promise<BridgeExit>((resolve) => this.exitWaiters.push(resolve));
    if (ask && this.writable()) {
      // Ahead of any waiting AU: the shutdown is the last word, and nothing after it matters.
      this.aus.clear();
      this.controls.push(controlRecord({ op: 'shutdown' }));
      this.pump();
    }
    if (this.child.stdin && !this.child.stdin.destroyed) this.child.stdin.end();
    this.stdinOpen = false;
    const pid = this.child.pid;
    if (pid !== undefined) {
      this.killTimers.push(
        setTimeout(() => {
          if (this.exitInfo) return;
          this.log.warn(`camera bridge pid ${pid} still running ${this.gracefulMs} ms after shutdown; SIGTERM`);
          this.child.kill('SIGTERM');
          this.killTimers.push(
            setTimeout(() => {
              if (this.exitInfo) return;
              this.log.warn(`camera bridge pid ${pid} ignored SIGTERM for ${this.termMs} ms; SIGKILL`);
              this.child.kill('SIGKILL');
            }, this.termMs),
          );
        }, ask ? this.gracefulMs : 0),
      );
    }
    return this.stopping;
  }

  private finish(how: { code: number | null; signal: NodeJS.Signals | null }): void {
    if (this.exitInfo) return;
    if (this.readyTimer !== null) clearTimeout(this.readyTimer);
    this.readyTimer = null;
    for (const t of this.killTimers) clearTimeout(t);
    this.killTimers = [];
    if (this.stderrPartial.length > 0) this.diag(this.stderrPartial);
    this.stderrPartial = '';
    this.stdinOpen = false;
    const cause = this.failCause ?? (this.stopRequested ? 'stopped' : 'exited');
    this.exitInfo = { code: how.code, signal: how.signal, requested: this.stopRequested, cause };
    this.log.info(
      `camera bridge pid ${this.child.pid ?? 'none'} ended: ${cause}, code ${how.code ?? '-'}, signal ${how.signal ?? '-'} — ` +
        `${this.tally.forwarded} AUs forwarded, ${this.tally.droppedBridge} dropped at the bound, ` +
        `${this.tally.discardedEnded} discarded at a session end, at most ${this.tally.maxPending} pending`,
    );
    const waiters = this.exitWaiters;
    this.exitWaiters = [];
    for (const w of waiters) w(this.exitInfo);
    this.options.onExit(this.exitInfo);
  }
}

/**
 * The one path the bridge is spawned from, by build kind. There is no override — no environment
 * variable, no setting — because an override is a way to run some other binary as the producer.
 *
 * - **Packaged:** `Contents/MacOS/sidekick-camera-bridge`, beside the Electron executable (README step 8;
 *   the final bundle name is W4's decision).
 * - **Unpackaged:** `<app>/native/SidekickCamera/.build/release/sidekick-camera-bridge` — a release build
 *   made with `swift build -c release`. No fallback to the debug build.
 *
 * Returns the path when it is an absolute, regular, executable file named exactly
 * {@link BRIDGE_EXECUTABLE_NAME} whose real path stays inside the expected directory; otherwise null,
 * with the reason. Null means *the helper is not present*, and the webcam feature says so.
 */
export function resolveBridgeExecutable(opts: {
  packaged: boolean;
  /** `app.getAppPath()` — the `desktop/` directory when unpackaged. */
  appPath: string;
  /** `process.execPath` — `…/Contents/MacOS/Sidekick` when packaged. */
  execPath: string;
}): { path: string } | { path: null; reason: string } {
  const root = opts.packaged ? dirname(opts.execPath) : join(opts.appPath, 'native', 'SidekickCamera', '.build');
  const candidate = opts.packaged ? join(root, BRIDGE_EXECUTABLE_NAME) : join(root, 'release', BRIDGE_EXECUTABLE_NAME);
  if (!isAbsolute(candidate)) return { path: null, reason: 'the bridge path is not absolute' };
  let stat;
  try {
    stat = lstatSync(candidate);
  } catch {
    return { path: null, reason: `the camera bridge is not built (${candidate} is missing)` };
  }
  if (stat.isSymbolicLink()) return { path: null, reason: 'the camera bridge path is a symbolic link' };
  if (!stat.isFile()) return { path: null, reason: 'the camera bridge path is not a file' };
  try {
    accessSync(candidate, fsConstants.X_OK);
  } catch {
    return { path: null, reason: 'the camera bridge is not executable' };
  }
  let real: string;
  let realRoot: string;
  try {
    real = realpathSync(candidate);
    realRoot = realpathSync(root);
  } catch {
    return { path: null, reason: 'the camera bridge path could not be resolved' };
  }
  if (!real.startsWith(realRoot + sep) || basename(real) !== BRIDGE_EXECUTABLE_NAME) {
    return { path: null, reason: 'the camera bridge resolves outside its directory' };
  }
  return { path: candidate };
}
