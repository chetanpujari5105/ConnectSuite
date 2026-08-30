/**
 * The detached mirror window — a real second `BrowserWindow`, and the Electron half of slice 2b.
 *
 * The handoff's defining sentence for this feature is a constraint, not a description:
 *
 * > The mirrored phone screen exists in **two views of one session** — an embedded preview on the
 * > Mirror page, and an optional detached, draggable, ratio-locked floating window. Opening or
 * > closing the detached window never starts, stops, or duplicates the mirroring session.
 *
 * So nothing in this file touches `mirror.start`, `mirror.stop`, the video socket, or the quality
 * config. It opens and closes a window. The session outlives it in both directions, and the red
 * light closes the window only — which is the row in the README's interaction table most likely to
 * be got wrong, because "close the mirror" and "stop mirroring" sound like the same act.
 *
 * ### Why the lifecycle is behind named methods
 *
 * The README asks for exactly four — `openFloat`, `closeFloat`, `smartFit`, `setWidth` — *"and let
 * nothing else read the coordinates directly, so they can be replaced with `BrowserWindow` /
 * `WebviewWindow` / `NSWindow` calls without touching the UI."* That is followed here, with two
 * additions the README's own interaction table requires and its method list does not name:
 *
 *  - [moveTo], because the table has a *Drag title bar* row and a drag has to move the window.
 *  - [setPinned], because it has a *Pin* row and always-on-top is not a coordinate.
 *
 * They are listed here rather than smuggled in, because a fifth method that nobody wrote down is
 * how a four-method isolation becomes a seven-method one.
 *
 * ### Where the arithmetic is not
 *
 * None of it is here. Every method below computes its window through
 * [resolveBounds](../shared/floatGeometry.ts), which is the electron-free layer and the only place
 * a width becomes a height and a Y. This file holds a `BrowserWindow` and a work area; that file
 * holds the invariant and is the one with tests. The split is the same one that took `session.ts`
 * out of `link.ts`.
 */

import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';

import {
  DEFAULT_WIDTH,
  boundsForCornerDrag,
  boundsForDrag,
  resolveBounds,
  type Bounds,
  type WorkArea,
} from '../shared/floatGeometry.js';

/** What both renderers are told about the window, and the only shape either of them reads. */
export interface FloatState {
  open: boolean;
  focused: boolean;
  pinned: boolean;
  /** Null while the window is closed — there is no position to report, and 0 would be a lie. */
  bounds: Bounds | null;
}

export class FloatMirrorWindow {
  private window: BrowserWindow | null = null;

  /**
   * Always-on-top, kept here rather than on the window.
   *
   * The README calls it *"a single shared `isAlwaysOnTop`"* — the title-bar pin and the inspector
   * toggle are two controls over one fact. Holding it outside the `BrowserWindow` is what lets it
   * survive a close and be restored on the next open, so pinning, closing and reopening does not
   * quietly unpin.
   */
  private pinned = false;

  /**
   * The width the window had when it was last closed.
   *
   * Reopening at the size you left is the behaviour the README implies by making close a
   * window-only act — "session, device, quality and toggles all persist" is about the session, and
   * a window that forgot its size every time would be the same kind of surprise one layer down.
   */
  private lastWidth = DEFAULT_WIDTH;

  /** Where the window was, for the same reason. Null until it has been opened once. */
  private lastPosition: { x: number; y: number } | null = null;

  constructor(
    private readonly preload: string,
    private readonly page: string,
    /** Told on every change, so both renderers can draw the button's two states. */
    private readonly onChanged: (state: FloatState) => void,
    /**
     * Called once the float window's renderer is ready for frames.
     *
     * The window opens mid-stream, so it has no parameter sets and no reference frame. This is the
     * hook that replays the retained SPS/PPS and asks the phone for an IDR — see main.ts. It is a
     * callback rather than a direct call because this file must not know what a video socket is.
     */
    private readonly onReady: (target: BrowserWindow) => void,
  ) {}

  // ---- The four methods the README names --------------------------------------------------------

  /**
   * Open the window, or focus the one that is already open.
   *
   * *"`isOpen ? focus() : open()` — never a second instance."* The check is here rather than in the
   * button, because a button is not the only thing that can ask: a ⌘⇧-shortcut, a tray item and a
   * second click while the window is loading all arrive at this method, and only this method knows
   * whether a window exists.
   */
  openFloat(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.focus();
      this.publish();
      return;
    }

    const area = this.workArea();
    const bounds = resolveBounds(
      {
        x: this.lastPosition?.x ?? Math.round(area.width - this.lastWidth - 40),
        y: this.lastPosition?.y ?? 60,
        width: this.lastWidth,
      },
      area,
    );

    const float = new BrowserWindow({
      ...bounds,
      // Frameless: the design draws its own 34px title bar, its own traffic lights and its own pin
      // button, and TITLE is part of the geometry invariant. A native title bar would add a second
      // height this file does not control, and the ratio would drift by however tall it is.
      frame: false,
      // Resizing is ours. A native resize would set a width *and* a height, and a height that did
      // not come from the width is the one way out of the 9:19.5 lock — so the OS is not given the
      // chance, and the corner handle in the renderer is the only path.
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      minimizable: true,
      title: 'Phone screen',
      backgroundColor: '#0b0c12',
      show: false,
      webPreferences: {
        preload: this.preload,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    this.window = float;
    void float.loadFile(this.page);

    float.once('ready-to-show', () => {
      float.show();
      // Restore the shared pin state onto the new window, not onto a fresh default.
      float.setAlwaysOnTop(this.pinned, 'floating');
      this.onReady(float);
      this.publish();
    });
    float.on('focus', () => this.publish());
    float.on('blur', () => this.publish());
    float.on('closed', () => {
      this.window = null;
      this.publish();
    });
  }

  /**
   * Close the window. **The window only.**
   *
   * The README's red-light row: *"Closes the window only — session, device, quality and toggles all
   * persist."* Position and width are remembered here so the next open is where you left it.
   */
  closeFloat(): void {
    const float = this.window;
    if (!float || float.isDestroyed()) return;
    this.remember(float.getBounds());
    float.close();
  }

  /**
   * Back to the 300pt medium default, Y re-clamped with it.
   *
   * The README binds this to a double-click on the title bar *and* to the green light, so both
   * gestures land here rather than each doing their own arithmetic.
   */
  smartFit(): void {
    this.place((current) => ({ x: current.x, y: current.y, width: DEFAULT_WIDTH }));
  }

  /**
   * Set the width, from a size preset or from a corner drag that has already been resolved.
   *
   * Nothing else sets a width, and this sets nothing but a width — height and Y follow inside
   * [resolveBounds]. That is what makes *"every width change re-clamps Y with the same expression
   * drag uses"* a property of the code's shape rather than a thing four call sites remember.
   */
  setWidth(width: number): void {
    this.place((current) => ({ x: current.x, y: current.y, width }));
  }

  // ---- The two the interaction table needs and the method list does not name ---------------------

  /** Drag the title bar. `grab` is the pointer's offset inside the window, held for the gesture. */
  moveTo(pointer: { x: number; y: number }, grab: { x: number; y: number }): void {
    const float = this.living();
    if (!float) return;
    const bounds = float.getBounds();
    float.setBounds(boundsForDrag(pointer, grab, bounds.width, this.workArea()));
    this.remember(float.getBounds());
    this.publish();
  }

  /** Drag the bottom-right corner. Only the pointer's X is read; see `boundsForCornerDrag`. */
  resizeCorner(pointer: { x: number }): void {
    const float = this.living();
    if (!float) return;
    const bounds = float.getBounds();
    float.setBounds(boundsForCornerDrag(pointer, { x: bounds.x, y: bounds.y }, this.workArea()));
    this.remember(float.getBounds());
    this.publish();
  }

  /** The single shared always-on-top, which the title-bar pin and any inspector toggle both drive. */
  setPinned(pinned: boolean): void {
    this.pinned = pinned;
    const float = this.living();
    if (float) float.setAlwaysOnTop(pinned, 'floating');
    this.publish();
  }

  minimize(): void {
    this.living()?.minimize();
  }

  // ---- Reading -----------------------------------------------------------------------------------

  state(): FloatState {
    const float = this.living();
    return {
      open: float !== null,
      focused: float?.isFocused() ?? false,
      pinned: this.pinned,
      bounds: float ? float.getBounds() : null,
    };
  }

  /** The window itself, for the frame broadcast in main.ts. Null while closed. */
  webContents(): BrowserWindow | null {
    return this.living();
  }

  // ---- Internals ---------------------------------------------------------------------------------

  private living(): BrowserWindow | null {
    return this.window && !this.window.isDestroyed() ? this.window : null;
  }

  /**
   * The work area of the display the window is actually on, in that display's own coordinates.
   *
   * `getDisplayMatching` rather than `getPrimaryDisplay`: on a two-monitor desk the clamp has to be
   * against the screen the window is on, or dragging the window to the second display would snap it
   * back to the first one's edges. While closed there is no window to match, so the cursor's display
   * is used — which is where the window is about to be opened.
   */
  private workArea(): WorkArea {
    const float = this.living();
    const display = float
      ? screen.getDisplayMatching(float.getBounds())
      : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    return { width: display.workArea.width, height: display.workArea.height };
  }

  /** The one interior door: read the current bounds, ask for new ones, resolve, set, remember. */
  private place(request: (current: Bounds) => { x: number; y: number; width: number }): void {
    const float = this.living();
    if (!float) return;
    const bounds = resolveBounds(request(float.getBounds()), this.workArea());
    float.setBounds(bounds);
    this.remember(bounds);
    this.publish();
  }

  private remember(bounds: Bounds): void {
    this.lastWidth = bounds.width;
    this.lastPosition = { x: bounds.x, y: bounds.y };
  }

  private publish(): void {
    this.onChanged(this.state());
  }
}
