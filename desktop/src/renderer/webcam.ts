/**
 * "Use as webcam" — Camera v2, Sidekick Camera (docs/protocol.md → Webcam). A section of the Camera
 * pane, clearly separate from Camera v1's preview above it, with its own namespace (`webcam.*`), its own
 * controls and its own state.
 *
 * ### What this section can and cannot do
 *
 * - It **asks**. *Ask phone* sends one `webcam.request`; the camera opens only when the phone's owner taps
 *   Start camera there. A meeting app opening Sidekick Camera can make the Mac ask once — the section says
 *   so — but nothing here, and nothing about a device being listed or opened, is consent.
 * - It **never resumes**. Coming back to the pane, or the phone reconnecting, draws how the last session
 *   ended and offers to ask again; it does not ask by itself.
 * - It does **not** stop on leaving the pane, unlike Camera v1's preview: a webcam session exists for an
 *   app on this Mac (a meeting), which keeps running when this window is elsewhere. It ends when the last
 *   such app stops using Sidekick Camera, on Stop here or on the phone, or on sleep, lock or quit.
 * - It shows **no picture**. The development preview was deferred; the picture goes only to Sidekick
 *   Camera, which needs the signed extension.
 *
 * Module-free like every pane: the page loads plain scripts, so the pure half hangs on `globalThis` at the
 * foot and `webcamView.test.ts` runs it rather than a copy.
 */

/** The main process's `WebcamStatus`, as this page receives it over IPC. */
interface WcStatus {
  bridge: 'absent' | 'stopped' | 'starting' | 'running' | 'failed';
  bridgeDetail: string | null;
  device: 'unknown' | 'installed' | 'not-installed';
  producer: 'unknown' | 'configured' | 'unconfigured' | 'refused';
  consumers: number;
  phone: { kind: 'not-connected' } | { kind: 'older-phone' } | { kind: 'unavailable'; reason: string } | { kind: 'ready' };
  blocker: string | null;
  session: null | {
    phase: 'requesting' | 'awaiting-approval' | 'starting' | 'running';
    sessionId: string | null;
    trigger: 'consumer' | 'person';
    facing: 'front' | 'back';
    generation: number;
    size: null | { width: number; height: number; targetWidth: number | null; targetHeight: number | null };
  };
  lastEnded: null | {
    sessionId: string | null;
    reason: string;
    code: string | null;
    framesSent: number | null;
    framesDropped: number | null;
    received: number;
    forwarded: number;
  };
}

interface WcResult {
  ok: boolean;
  reason?: string;
}

interface WebcamBridgeApi {
  webcamCurrent(): Promise<WcStatus>;
  webcamAsk(facing: 'front' | 'back'): Promise<WcResult>;
  webcamStop(): Promise<WcResult>;
  webcamSwitch(facing: 'front' | 'back'): Promise<WcResult>;
  onWebcamState(callback: (status: WcStatus) => void): void;
}

interface WcSpec {
  block: { kind: StateKind; headline: string; body: string[]; code?: string } | null;
  /** The live line, while a session is up. */
  status: string | null;
  canAsk: boolean;
  /** Cancel the request still waiting on the phone. */
  canCancel: boolean;
  canStop: boolean;
  /** The other camera, while a session is up. */
  switchTo: 'front' | 'back' | null;
  /** Said before the click (docs/protocol.md → Consumer episodes): what Ask phone will lead to. */
  note: string | null;
}

/** How a session ended, for this Mac's owner. Every `WebcamEndReason`; an unknown one says so plainly. */
const WEBCAM_ENDINGS: Readonly<Record<string, string>> = {
  declined: 'You declined on the phone.',
  expired: 'Nobody answered on the phone within 30 seconds.',
  'permission-denied': "Android's camera permission was not allowed for Sidekick on the phone.",
  'camera-unavailable': "The phone's camera could not be opened.",
  'camera-in-use': 'Another app, or Sidekick mirroring, was using the phone first.',
  'stopped-by-mac': 'Stopped from this Mac.',
  'mac-failed': 'This Mac could not continue the webcam.',
  'no-consumers': 'No app on this Mac was using Sidekick Camera any more.',
  'stopped-on-phone': 'Stopped on the phone.',
  'left-screen': "The phone's webcam screen was closed or the phone was locked.",
  'stream-closed': 'The picture connection to the phone ended.',
  'capture-failed': "The phone's camera or encoder failed.",
  'too-hot': 'The phone got too hot.',
  refused: 'The phone refused the request.',
  'request-failed': 'The request did not reach the phone.',
  disconnected: 'The connection to the phone ended.',
  'disconnected-here': 'You disconnected the phone from this Mac.',
  'mac-shutdown': 'This Mac slept, locked, switched user or quit.',
  'stream-lost': 'The picture connection closed.',
  'malformed-stream': 'The picture from the phone could not be read, so this Mac stopped it.',
  'bridge-failed': "This Mac's camera helper stopped working.",
  'producer-refused': 'Sidekick Camera refused this copy of Sidekick.',
  'device-not-installed': 'Sidekick Camera is no longer installed on this Mac.',
};

function webcamEnding(reason: string): string {
  return WEBCAM_ENDINGS[reason] ?? `It ended (${reason}).`;
}

function webcamPanelSpec(status: WcStatus | null): WcSpec {
  const none: WcSpec = { block: null, status: null, canAsk: false, canCancel: false, canStop: false, switchTo: null, note: null };
  if (status === null) {
    return { ...none, block: { kind: 'loading', headline: 'Checking Sidekick Camera…', body: [] } };
  }
  const session = status.session;
  if (session) {
    const other = session.facing === 'front' ? 'back' : 'front';
    const asked = session.trigger === 'consumer' ? 'An app on this Mac started Sidekick Camera, so your phone was asked.' : 'You asked your phone.';
    switch (session.phase) {
      case 'requesting':
        return { ...none, block: { kind: 'loading', headline: 'Asking your phone…', body: [asked] }, canCancel: true };
      case 'awaiting-approval':
        return {
          ...none,
          block: {
            kind: 'loading',
            headline: 'Waiting for you to allow it on your phone',
            body: [asked, 'The camera stays off until Start camera is tapped on the phone.'],
          },
          canCancel: true,
        };
      case 'starting':
        return {
          ...none,
          block: { kind: 'loading', headline: 'Allowed on your phone — starting', body: [`The ${session.facing} camera is starting.`] },
          canStop: true,
          switchTo: other,
        };
      case 'running': {
        const size = session.size
          ? `${session.size.width}×${session.size.height}` +
            (session.size.targetWidth && session.size.targetHeight &&
            (session.size.targetWidth !== session.size.width || session.size.targetHeight !== session.size.height)
              ? ` (target ${session.size.targetWidth}×${session.size.targetHeight})`
              : '')
          : 'size not reported';
        return {
          ...none,
          status: `Live as Sidekick Camera · ${session.facing} camera · ${size}`,
          canStop: true,
          switchTo: other,
          note: status.consumers === 0 ? 'No app on this Mac is using Sidekick Camera, so this session stops.' : null,
        };
      }
    }
  }

  if (status.blocker !== null) {
    const ended = status.lastEnded ? ` Last session: ${webcamEnding(status.lastEnded.reason)}` : '';
    const phone = status.phone.kind;
    return {
      ...none,
      block: {
        kind: phone === 'not-connected' ? 'blocked' : 'unavailable',
        headline: phone === 'not-connected' ? 'Your phone is not connected' : 'Not available on this Mac yet',
        body: [status.blocker + ended],
        code: setupLine(status),
      },
    };
  }

  const note =
    status.consumers === 0
      ? 'No app on this Mac is using Sidekick Camera right now, so a session you allow will stop as soon as it starts.'
      : 'An app on this Mac is using Sidekick Camera. Allowing on the phone sends it the picture.';
  if (status.lastEnded) {
    return {
      ...none,
      block: { kind: 'empty', headline: 'Webcam stopped', body: [webcamEnding(status.lastEnded.reason), countsLine(status.lastEnded)].filter((l): l is string => l !== null) },
      canAsk: true,
      note,
    };
  }
  return {
    ...none,
    block: {
      kind: 'empty',
      headline: 'Use your phone as this Mac’s webcam',
      body: ['When an app here starts Sidekick Camera, Sidekick asks your phone once. You can also ask now. The phone’s owner decides on the phone, every time.'],
    },
    canAsk: true,
    note,
  };
}

/** What blocks setup, as the facts the bridge reported — for the person diagnosing it. */
function setupLine(status: WcStatus): string {
  return `bridge ${status.bridge} · Sidekick Camera ${status.device} · producer identity ${status.producer}`;
}

function countsLine(ended: NonNullable<WcStatus['lastEnded']>): string | null {
  if (ended.framesSent === null && ended.received === 0) return null;
  return `${ended.framesSent ?? '?'} sent by the phone · ${ended.received} received here · ${ended.forwarded} passed to Sidekick Camera`;
}

class WebcamView {
  private status: WcStatus | null = null;
  private facing: 'front' | 'back' = 'front';
  private lastRefusal: string | null = null;

  constructor(
    private readonly bridge: WebcamBridgeApi,
    private readonly els: { block: HTMLElement; status: HTMLElement; note: HTMLElement; controls: HTMLElement },
  ) {
    bridge.onWebcamState((status) => this.setStatus(status));
    void bridge.webcamCurrent().then((status) => this.setStatus(status));
    this.draw();
  }

  setStatus(status: WcStatus): void {
    this.status = status;
    if (status.session) this.lastRefusal = null;
    this.draw();
  }

  /** What the section shows; the tests read it. */
  spec(): WcSpec {
    return webcamPanelSpec(this.status);
  }

  private draw(): void {
    const spec = this.spec();
    this.els.block.hidden = spec.block === null;
    this.els.block.replaceChildren(...(spec.block ? [stateBlock({ kind: spec.block.kind, headline: spec.block.headline, body: spec.block.body, ...(spec.block.code ? { code: spec.block.code } : {}) })] : []));
    this.els.status.textContent = spec.status ?? '';
    this.els.status.hidden = spec.status === null;
    const note = this.lastRefusal ?? spec.note;
    this.els.note.textContent = note ?? '';
    this.els.note.hidden = note === null;

    const controls: HTMLElement[] = [];
    if (spec.canAsk) {
      const group = document.createElement('div');
      group.className = 'segmented webcam-facing';
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', 'Which phone camera to ask for');
      for (const facing of ['front', 'back'] as const) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `segment${this.facing === facing ? ' is-on' : ''}`;
        button.textContent = facing === 'front' ? 'Front camera' : 'Back camera';
        button.setAttribute('aria-pressed', String(this.facing === facing));
        button.addEventListener('click', () => {
          this.facing = facing;
          this.draw();
        });
        group.appendChild(button);
      }
      controls.push(group);
      controls.push(webcamButton('Ask phone', 'button primary-action webcam-ask', () => void this.ask()));
    }
    if (spec.canCancel) controls.push(webcamButton('Cancel request', 'button webcam-cancel', () => void this.bridge.webcamStop()));
    if (spec.switchTo) {
      const to = spec.switchTo;
      controls.push(webcamButton(to === 'front' ? 'Switch to front camera' : 'Switch to back camera', 'button webcam-switch', () => void this.bridge.webcamSwitch(to)));
    }
    if (spec.canStop) controls.push(webcamButton('Stop webcam', 'button danger webcam-stop', () => void this.bridge.webcamStop()));
    this.els.controls.replaceChildren(...controls);
  }

  private async ask(): Promise<void> {
    const result = await this.bridge.webcamAsk(this.facing);
    // The refusal sentence is the main process's (the blocker, or the phone's own words), never rewritten.
    this.lastRefusal = result.ok ? null : (result.reason ?? 'The phone was not asked.');
    this.draw();
  }
}

function webcamButton(label: string, className: string, run: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.addEventListener('click', run);
  return button;
}

// Hung on the global for webcamView.test.ts, per the renderer's testable-seam rule.
{
  const g = globalThis as Record<string, unknown>;
  g.__webcamRules = { webcamPanelSpec, webcamEnding, WEBCAM_ENDINGS };
  g.WebcamView = WebcamView;
}
