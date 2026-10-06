import { navigationDecision } from './windowGuard';
import { validateArgs, type ArgsSpec } from '../shared/ipcSchema';

/**
 * The main process's IPC authorization boundary — audit S4, defect 183.
 *
 * A narrow preload decides what a page can *ask*; this decides what the main process will *do*, and it
 * is the boundary. Every handler is registered through [guardIpc], which, before the handler runs:
 *
 * 1. identifies the sender as one of the windows this process created and registered — by object
 *    identity, never by anything the renderer says about itself — and refuses an unknown sender, a
 *    destroyed or replaced window, a subframe, and a frame not showing that window's own page;
 * 2. checks the window's role is allowed on this channel ([IPC_POLICY] in `ipcPolicy.ts`);
 * 3. validates the arguments against the channel's spec.
 *
 * A refusal returns a short, non-sensitive reason and is logged by channel and reason only — never
 * the payload, which may be somebody's message or number. Allowed calls are counted beside refusals.
 *
 * Electron-free: it takes `ipcMain`-shaped and `WebContents`-shaped objects, so the tests drive the same
 * code `main.ts` runs.
 */

export type WindowRole = 'main' | 'float' | 'share';

export interface FrameLike {
  url: string;
  parent: unknown;
}

export interface ContentsLike {
  isDestroyed(): boolean;
}

export interface IpcEventLike {
  sender: ContentsLike;
  senderFrame?: FrameLike | null;
}

export interface ChannelPolicy {
  roles: readonly WindowRole[];
  args: ArgsSpec;
  /** For the matrix: what the channel does. */
  effect: 'read' | 'sensitive-read' | 'action' | 'window' | 'pairing' | 'debug';
}

export interface Refused {
  ok: false;
  refused: true;
  reason: string;
}

/** The windows this process created, by role. One live window per role. */
export class WindowRegistry {
  private readonly entries = new Map<WindowRole, { contents: ContentsLike; page: string }>();

  /** Registered when the window is created, before its page loads. Replaces any earlier window of the role. */
  register(role: WindowRole, contents: ContentsLike, page: string): void {
    this.entries.set(role, { contents, page });
  }

  /** Called when a window closes; a later window of the same role must register again. */
  unregister(role: WindowRole, contents: ContentsLike): void {
    if (this.entries.get(role)?.contents === contents) this.entries.delete(role);
  }

  /** The live contents registered for [role], or null. */
  contentsOf(role: WindowRole): ContentsLike | null {
    const entry = this.entries.get(role);
    return entry && !entry.contents.isDestroyed() ? entry.contents : null;
  }

  /** Who sent [event] — or why nobody we trust did. */
  identify(event: IpcEventLike): { ok: true; role: WindowRole } | { ok: false; reason: string } {
    for (const [role, entry] of this.entries) {
      if (entry.contents !== event.sender) continue;
      if (entry.contents.isDestroyed()) return { ok: false, reason: 'the window is gone' };
      const frame = event.senderFrame;
      if (!frame) return { ok: false, reason: 'no sender frame' };
      if (frame.parent !== null && frame.parent !== undefined) return { ok: false, reason: 'a subframe' };
      if (!navigationDecision(frame.url, [entry.page]).allow) return { ok: false, reason: "not the window's own page" };
      return { ok: true, role };
    }
    return { ok: false, reason: 'an unknown sender' };
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any -- listener types are Electron's; the guard checks at runtime. */
export interface IpcMainLike {
  handle(channel: string, listener: (event: any, ...args: any[]) => unknown): void;
  on(channel: string, listener: (event: any, ...args: any[]) => void): void;
}

export interface GuardLog {
  warn(message: string): void;
}

export interface GuardedIpc {
  handle(channel: string, listener: (event: any, ...args: any[]) => unknown): void;
  on(channel: string, listener: (event: any, ...args: any[]) => void): void;
  /** Allowed and refused calls since launch — the denominator for every refusal line. */
  counts(): { allowed: number; refused: number };
  /** Every channel registered through this guard, for the coverage tests. */
  registered(): string[];
}

/** Refuses a channel with no policy at registration time, so an unguarded channel cannot exist. */
export function guardIpc(
  ipc: IpcMainLike,
  windows: WindowRegistry,
  policy: Readonly<Record<string, ChannelPolicy>>,
  log: GuardLog,
): GuardedIpc {
  let allowed = 0;
  let refused = 0;
  const channels: string[] = [];

  const check = (channel: string, event: IpcEventLike, args: unknown[]): Refused | null => {
    const rule = policy[channel]!;
    const who = windows.identify(event);
    let reason: string | null = null;
    if (!who.ok) reason = who.reason;
    else if (!rule.roles.includes(who.role)) reason = `not allowed from the ${who.role} window`;
    else reason = validateArgs(rule.args, args);
    if (reason === null) {
      allowed += 1;
      return null;
    }
    refused += 1;
    log.warn(`refused ${channel}: ${reason} — ${refused} refused / ${allowed} allowed since launch`);
    return { ok: false, refused: true, reason: `refused: ${reason}` };
  };

  const policyFor = (channel: string): void => {
    if (!policy[channel]) throw new Error(`IPC channel ${channel} has no policy — add it to IPC_POLICY`);
    channels.push(channel);
  };

  return {
    handle(channel, listener) {
      policyFor(channel);
      ipc.handle(channel, (event: IpcEventLike, ...args: unknown[]) => {
        const refusal = check(channel, event, args);
        return refusal ?? listener(event, ...args);
      });
    },
    on(channel, listener) {
      policyFor(channel);
      ipc.on(channel, (event: IpcEventLike, ...args: unknown[]) => {
        if (check(channel, event, args) === null) listener(event, ...args);
      });
    },
    counts: () => ({ allowed, refused }),
    registered: () => [...channels],
  };
}

/**
 * Paths this process produced and handed to the main window — the only paths `fs-drag` may drag and
 * `reveal-saved` may reveal. A renderer cannot add one; a path is granted only from a pull or a save
 * this process completed. Bounded; the oldest grant goes first.
 */
export class ResourceGrants {
  private readonly paths = new Set<string>();

  constructor(private readonly max = 2_000) {}

  grant(path: string): void {
    this.paths.delete(path);
    this.paths.add(path);
    while (this.paths.size > this.max) this.paths.delete(this.paths.values().next().value as string);
  }

  has(path: string): boolean {
    return this.paths.has(path);
  }

  size(): number {
    return this.paths.size;
  }
}
