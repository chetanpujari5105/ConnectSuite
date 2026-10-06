import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  AppEntry,
  ClipEntry,
  LocalClipEntry,
  ConnectionStatus,
  GeometryStamp as InputGeometry,
  InputResult,
  MediaBucket,
  MediaItem,
  PairingQrPayload,
  PhoneAck,
  PhoneContact,
  PhoneNotification,
  PhoneResult,
  CallLogEntry,
  IncomingCall,
  RemoteState,
  SmsMessage,
  SmsThread,
} from './shared/protocol';
import type { PullOutcome, PushOutcome } from './main/files';
import type { FloatState } from './main/float';
import type { ShareCardSnapshot } from './main/share';
import type { SharePagePayload } from './main/shareWindow';
import type { CameraFrameMessage, CameraPaneState, CameraResult } from './main/camera';
import type { WebcamResult, WebcamStatus } from './main/webcam';
import type { SpikeStatus } from './main/webcamSpike';

/**
 * The floating mirror window's bridge — audit S4, defect 183. Exactly what `float.html`'s scripts call:
 * the mirror stream, input, and the window's own controls. No SMS, calls, pairing, Forget, files,
 * clipboard or history. `ipcPolicy.test.ts` holds this list equal to what the page uses and to what
 * `IPC_POLICY` allows the float role; the main process re-checks every call regardless.
 */
contextBridge.exposeInMainWorld('connect', {
  /** `reason` is carried so the log can say which of the three callers asked, and why. */
  mirrorKeyframe: (reason?: string) => ipcRenderer.invoke('mirror-keyframe', reason),
  /**
   * One line from a renderer into the Mac's own log file.
   *
   * The float window had no way to say anything durable. Its decode path could fail for an entire
   * session and leave nothing behind but a devtools console nobody opens — which is the debt-list
   * failure in a different medium: a record that exists and is never read costs what no record
   * costs. `send`, not `invoke`: a log line must never make the caller wait, and it has no answer.
   */
  logLine: (where: string, line: string) => ipcRenderer.send('renderer-log', where, line),
  mirrorCapture: (dataUrl: string) => ipcRenderer.invoke('mirror-capture', dataUrl),

  /**
   * Input, as intents. The renderer works out *where on the picture* it clicked and nothing more;
   * the main process owns the socket, the rate limit, and the one-request-at-a-time rule.
   *
   * Every one of these resolves to an [InputResult] and none of them rejects. A tap that did not
   * happen still has to say so — the user is looking at a phone that did not react — but it says
   * so as `{ ok: false, reason, fixHint }` rather than as a rejection, because `invoke` rewraps a
   * rejection as `Error invoking remote method 'input-key': Error: …` and puts nine words of
   * Electron internals in front of a sentence the phone wrote for a person to read. Defect 22.
   */
  inputTap: (point: {
    x: number;
    y: number;
    durationMs?: number;
    geom: InputGeometry;
  }): Promise<InputResult> => ipcRenderer.invoke('input-tap', point),
  inputSwipe: (swipe: {
    points: Array<{ x: number; y: number }>;
    durationMs?: number;
    geom: InputGeometry;
  }): Promise<InputResult> => ipcRenderer.invoke('input-swipe', swipe),
  inputScroll: (scroll: {
    x: number;
    y: number;
    dx: number;
    dy: number;
    durationMs?: number;
    geom: InputGeometry;
  }): Promise<InputResult> => ipcRenderer.invoke('input-scroll', scroll),
  inputGlobal: (action: string): Promise<InputResult> => ipcRenderer.invoke('input-global', action),

  /*

  /** Encoded H.264 access units. The renderer decodes; the main process never touches pixels. */
  onVideoFrame: (
    callback: (frame: {
      keyframe: boolean;
      config: boolean;
      ptsUs: number;
      data: Uint8Array;
      arrivedAt: number;
    }) => void,
  ) => ipcRenderer.on('video-frame', (_event, frame) => callback(frame)),
  /**
   * Phase changes from the phone: waiting on the user, prompting, starting, running, stopped.
   *
   * `mirror.start` acks before consent is even asked for, so these are the only thing that says
   * what is happening between the click and the first frame. The canvas shows the newest one.
   */
  onMirrorState: (
    callback: (state: {
      state?: string;
      message?: string;
      fixHint?: string;
      width?: number;
      height?: number;
      bitrate?: number;
      frameRate?: number;
    }) => void,
  ) => ipcRenderer.on('mirror-state', (_event, state) => callback(state)),
  /**
   * The phone turned, with the geometry it now captures at.
   *
   * Separate from `onMirrorState` because a rotation is not a phase change: the session never
   * stopped running. It arrives just before the new parameter sets on the video channel.
   */
  onMirrorRotate: (
    callback: (rotate: { width?: number; height?: number; dpi?: number; rotation?: number }) => void,
  ) => ipcRenderer.on('mirror-rotate', (_event, rotate) => callback(rotate)),
  /**
   * Carries the phone's own reason string, which is what goes on the canvas.
   *
   * `transient` is true only for a secure surface — the one failure that leaves the session
   * running. It is here because the renderer cannot tell the two apart from the frame stream: a
   * blanked screen keeps producing frames, so "frames are still arriving" means nothing. See
   * defect 23 and [OverlayEnds] in renderer/mirror.ts.
   */
  onMirrorStopped: (
    callback: (info: { reason?: string; fixHint?: string; transient?: boolean }) => void,
  ) => ipcRenderer.on('mirror-stopped', (_event, info) => callback(info)),
  /**
   * Appearance. `appearance` is what the user chose; `theme` is what that resolves to right now.
   *
   * Both are returned together, always, because they answer different questions and a renderer
   * that has one has to guess the other — `system` says nothing about what is on screen. The
   * listener fires on a user change *and* when macOS flips under a running app.
   */
  appearanceGet: (): Promise<{
    ok: boolean;
    data: { appearance: 'system' | 'light' | 'dark'; theme: 'light' | 'dark' };
  }> => ipcRenderer.invoke('appearance-get'),
  onAppearance: (
    callback: (state: { appearance: 'system' | 'light' | 'dark'; theme: 'light' | 'dark' }) => void,
  ) => ipcRenderer.on('appearance', (_event, state) => callback(state)),

  /**
   * The detached mirror window.
   *
   * Every one of these is a *lifecycle or a pointer position*, never a window rectangle. The
   * geometry invariant lives in `shared/floatGeometry.ts` and is applied in the main process, so a
   * renderer is never in a position to set a width without re-clamping Y — there is no channel that
   * would let it. The README asks for the lifecycle to sit behind four methods precisely so the
   * window can become an `NSWindow` later without a renderer change; this is the wire that keeps
   * that true.
   */
  /**
   * The start contract's asking half: "my listeners are up, what is the stream?"
   *
   * Replaces a push from `main.ts` on a window event that said nothing about whether this page was
   * listening yet. See shared/streamStart.ts — defect 105.
   */
  streamStart: () => ipcRenderer.invoke('stream-start'),
  /** Debug switches the renderer needs — currently only `delayFloatListeners`. Empty in a package. */
  debugSwitches: () => ipcRenderer.invoke('debug-switches'),
  floatClose: () => ipcRenderer.invoke('float-close'),
  floatMinimize: () => ipcRenderer.invoke('float-minimize'),
  floatSmartFit: () => ipcRenderer.invoke('float-smart-fit'),
  floatSetPinned: (pinned: boolean) => ipcRenderer.invoke('float-set-pinned', pinned),
  /** Title-bar drag. `pointer` is in screen points; `grab` is its offset inside the window. */
  floatMove: (pointer: { x: number; y: number }, grab: { x: number; y: number }) =>
    ipcRenderer.invoke('float-move', { pointer, grab }),
  /** Corner drag. X only — see `boundsForCornerDrag` for why Y is not offered. */
  floatResize: (pointer: { x: number }) => ipcRenderer.invoke('float-resize', pointer),
  floatState: (): Promise<FloatState> => ipcRenderer.invoke('float-state'),

  /**
   * Bring the main window forward. Defect 117.
   *
   * Reached from the float window's control strip, and it is the *only* thing in this app that a
   * renderer can do to the main window's visibility. It returns whether the float is still open,
   * because that is the one fact a user pressing it needs — see `onRailPress` in float.ts.
   */
  showMainWindow: (): Promise<{ floatStillOpen: boolean }> => ipcRenderer.invoke('main-window-show'),
  onFloatChanged: (callback: (state: FloatState) => void) =>
    ipcRenderer.on('float-changed', (_event, state) => callback(state)),

  onStatus: (callback: (status: ConnectionStatus) => void) =>
    ipcRenderer.on('status', (_event, status) => callback(status)),
});
