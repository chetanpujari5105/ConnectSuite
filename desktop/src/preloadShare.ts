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
 * The share receive window's bridge — audit S4, defect 183. Exactly what `share-window.html`'s scripts
 * call: its own state, its decisions and actions on the offers it was shown, its size, and appearance.
 * Nothing else. The main process binds every action to the offers last pushed to this very window.
 */
contextBridge.exposeInMainWorld('connect', {
  shareDecide: (offerId: string, decision: 'accept' | 'decline'): Promise<{ ok: boolean; reason?: string }> =>
    ipcRenderer.invoke('share-decide', { offerId, decision }),
  /**
   * The receive window (docs/feature-a-receive-window.md). Its page reads its state and reports its
   * height; the main window's card may only ask for it to be shown. Every request is an `offerId` at
   * most — the main process refuses these from any page but the one each belongs to.
   */
  shareWindowState: (): Promise<SharePagePayload | null> => ipcRenderer.invoke('share-window-state'),
  onShareWindow: (callback: (state: SharePagePayload) => void) =>
    ipcRenderer.on('share-window', (_event, state: SharePagePayload) => callback(state)),
  shareWindowClose: (): void => ipcRenderer.send('share-window-close'),
  shareWindowHeight: (height: number): void => ipcRenderer.send('share-window-height', height),
  /** Cancel, Try again, Open, Show in Finder — from the receive window only; the path stays in main. */
  shareAct: (action: 'cancel' | 'retry' | 'open' | 'reveal', offerId: string): Promise<{ ok: boolean; reason?: string }> =>
    ipcRenderer.invoke(`share-${action}`, { offerId }),
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
});
