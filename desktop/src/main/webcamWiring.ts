/**
 * Camera v2 (Sidekick Camera) in the running Mac app — the one factory `main.ts` calls, and the one the
 * integration tests call. docs/protocol.md → Webcam.
 *
 * Electron-free on purpose: `main.ts` hands it the real `LinkClient`, `ipcMain`, `powerMonitor` and the
 * real bridge; `webcamWiring.test.ts` hands it labelled stand-ins and the **built** Swift bridge. So the
 * subscriptions and handlers the tests exercise are the ones the app registers, not a second model of them.
 *
 * ### What it decides
 *
 * - **The development advertisement policy** ({@link planWebcam}): `ext.webcam` 1 only in an unpackaged
 *   build with the `webcamDev` switch on (or `WEBCAM_RELEASE`, which is false) **and** the bridge present
 *   beside the app at its one resolved path. No shell, no override, no debug-build fallback.
 * - **What may be asked**: the controller refuses every request while the bridge is absent, Sidekick
 *   Camera is not installed, the build has no producer identity (the Team ID is unset, so every request
 *   is refused today), or the extension refused the producer. Nothing here bypasses that.
 * - **Every ending it must bind**: `webcam.state` for the exact session, the control session ending, sleep,
 *   screen lock, a fast user switch, and quit — which also reaps the bridge ({@link WebcamWiring.dispose}).
 */

import { BridgeProcess, resolveBridgeExecutable, type BridgeLog, type BridgeProcessOptions } from './webcamBridge';
import { WebcamController, type WebcamLinkPort, type WebcamResult, type WebcamStatus } from './webcam';
import type { CameraLog, CameraSocketFactory, CameraTimers } from './camera';
import { MessageType } from '../shared/protocol';
import { WEBCAM_RELEASE, webcamExt } from '../shared/webcamWire';

/** What the app may advertise and spawn, decided once at startup. */
export interface WebcamPlan {
  /** What `hello.ext` gains: `{ webcam: 1 }` or nothing. */
  ext: Readonly<Record<string, number>>;
  /** The development gate (or the release flag) is open. */
  gateOpen: boolean;
  /** The one resolved bridge path, or null with [absentReason]. */
  executable: string | null;
  absentReason: string | null;
}

export function planWebcam(opts: {
  packaged: boolean;
  devSwitch: boolean;
  appPath: string;
  execPath: string;
  release?: boolean;
}): WebcamPlan {
  const release = opts.release ?? WEBCAM_RELEASE;
  const gateOpen = (!opts.packaged && opts.devSwitch) || release;
  if (!gateOpen) {
    return {
      ext: {},
      gateOpen,
      executable: null,
      absentReason: opts.packaged
        ? 'Using the phone as a webcam is not in this build of Sidekick yet.'
        : 'Using the phone as a webcam is a development feature: start Sidekick with the webcamDev debug switch to try it.',
    };
  }
  const resolved = resolveBridgeExecutable({ packaged: opts.packaged, appPath: opts.appPath, execPath: opts.execPath });
  const bridgePresent = resolved.path !== null;
  return {
    ext: webcamExt({ packaged: opts.packaged, devSwitch: opts.devSwitch, bridgePresent, release }),
    gateOpen,
    executable: resolved.path,
    absentReason: resolved.path === null ? `The camera bridge is not available: ${resolved.reason}.` : null,
  };
}

/** The slice of `LinkClient` the webcam needs. `LinkClient` satisfies it; the tests' stand-in does too. */
export interface WebcamWiringLink {
  isConnected(): boolean;
  token(): string | null;
  status(): { address?: string | null; capabilities?: readonly string[]; unavailable?: ReadonlyArray<{ name: string; reason: string }> };
  negotiated(): Readonly<Record<string, number>>;
  request(type: string, payload: Record<string, unknown>, timeoutMs: number): Promise<{ payload?: unknown }>;
  on(event: string, listener: (...args: any[]) => void): unknown;
}

export interface WebcamWiringDeps {
  plan: WebcamPlan;
  link: WebcamWiringLink;
  /** The session-ended event's name on [link] (`SESSION_ENDED_EVENT`). */
  sessionEndedEvent: string;
  /** v1's pinned TLS opener in the app: the socket is pinned to the phone holding the control session. */
  openSocket: CameraSocketFactory;
  /** `ipcMain.handle`. */
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
  /** The renderer's `webcam-state` channel. */
  send(channel: string, payload: unknown): void;
  /** `powerMonitor`. */
  power: { on(event: string, listener: () => void): unknown };
  /** The tests shorten the bridge's deadlines; the app uses the defaults. */
  bridgeOptions?: Partial<Pick<BridgeProcessOptions, 'readyTimeoutMs' | 'gracefulMs' | 'termMs' | 'args'>> & { log?: BridgeLog };
  timers?: CameraTimers;
  log?: CameraLog;
}

export interface WebcamWiring {
  readonly controller: WebcamController;
  /** The running bridge child's pid, or null — for the log, and for the tests to prove it was reaped. */
  bridgePid(): number | null;
  /** Whether quit has anything to wait for: a session, or a bridge child not yet exited. Defect 200. */
  busy(): boolean;
  /** Quit: ends any session (`webcam.stop` `shutdown`), then stops and reaps the bridge. */
  dispose(): Promise<void>;
}

/** The IPC channels the preload exposes. One place, so the preload and this cannot drift. */
export const WEBCAM_IPC = Object.freeze({
  CURRENT: 'webcam-current',
  ASK: 'webcam-ask',
  STOP: 'webcam-stop',
  SWITCH: 'webcam-switch',
  STATE: 'webcam-state',
} as const);

/**
 * The `powerMonitor` events that end a session (docs/protocol.md → `webcam.stop` `shutdown`): sleep,
 * screen lock and a fast user switch. `resume` and `unlock-screen` are deliberately absent — coming back
 * never resumes a camera.
 */
export const WEBCAM_POWER_EVENTS = Object.freeze({
  suspend: 'suspend',
  'lock-screen': 'lock-screen',
  'user-did-resign-active': 'user-switch',
} as const);

export function wireWebcam(deps: WebcamWiringDeps): WebcamWiring {
  const { plan, link } = deps;
  const port: WebcamLinkPort = {
    isConnected: () => link.isConnected(),
    token: () => link.token(),
    address: () => link.status().address ?? null,
    capabilities: () => link.status().capabilities ?? [],
    unavailableReason: (name) => link.status().unavailable?.find((u) => u.name === name)?.reason ?? null,
    negotiated: () => link.negotiated(),
    request: (type, payload, timeoutMs) => link.request(type, payload, timeoutMs),
  };
  const executable = plan.gateOpen ? plan.executable : null;
  let bridge: BridgeProcess | null = null;
  const controller = new WebcamController({
    link: port,
    openSocket: deps.openSocket,
    startBridge: executable
      ? (hooks) =>
          (bridge = new BridgeProcess({
            executable,
            ...hooks,
            ...(deps.bridgeOptions ?? {}),
          }))
      : null,
    bridgeAbsentReason: plan.absentReason ?? undefined,
    emitState: (status: WebcamStatus) => deps.send(WEBCAM_IPC.STATE, status),
    timers: deps.timers,
    log: deps.log,
  });

  // The phone's events, for this connection's current session only — the controller checks the token
  // and the sessionId on every one.
  link.on('message', (envelope: { type?: string; payload?: unknown }) => {
    if (envelope?.type === MessageType.WEBCAM_STATE && envelope.payload) controller.onState(envelope.payload);
  });
  link.on(deps.sessionEndedEvent, (ended: { token: string | null; byThisMac?: boolean }) =>
    controller.onSessionEnded(ended?.token ?? null, ended?.byThisMac === true),
  );
  // Capabilities or `ext` changed (a reconnect, a grant). Redrawn, never asked because of it.
  link.on('status', () => controller.onCapabilitiesChanged());

  for (const [event, lifecycle] of Object.entries(WEBCAM_POWER_EVENTS)) {
    deps.power.on(event, () => void controller.lifecycle(lifecycle));
  }

  deps.handle(WEBCAM_IPC.CURRENT, () => controller.current());
  deps.handle(WEBCAM_IPC.ASK, (_event, facing): Promise<WebcamResult> => controller.askPhone(facing ?? 'front'));
  deps.handle(WEBCAM_IPC.STOP, (): Promise<WebcamResult> => controller.stop());
  deps.handle(WEBCAM_IPC.SWITCH, (_event, facing): Promise<WebcamResult> => controller.switchCamera(facing));

  // The bridge runs while the gate is open, so it can hear a consumer arrive; it asks the phone nothing
  // by itself, and refuses to while the device or the producer identity is missing.
  if (executable) controller.start();

  let disposing: Promise<void> | null = null;
  return {
    controller,
    bridgePid: () => (bridge && !bridge.exited ? bridge.pid : null),
    busy: () => controller.current().session !== null || (bridge !== null && !bridge.exited),
    dispose: () => (disposing ??= controller.lifecycle('quit')),
  };
}
