/**
 * What the menu-bar item shows, and the one place that writes it — only when something changed.
 *
 * `refreshTray()` in main.ts runs on every link status, which is every 30 s retry while the phone is
 * away, and it used to call `setTitle`, `setToolTip` and `setContextMenu` on each one whether or not
 * anything had changed. Each call asks AppKit to redraw the status item. The packaged app that hung on
 * 2026-10-14/15 had its main thread blocked inside exactly that drawing (macOS's own hang report,
 * docs/overnight-report-2026-10-15.md). That report does not prove a redraw *caused* the hang; this
 * removes the redraws nobody needed, which is the part of the trigger this repo owns.
 *
 * Electron-free, so a test reaches the comparison; main.ts maps each item's `action` to its click.
 */

export type TrayAction = 'open' | 'reconnect' | 'toggle' | 'quit';

export interface TrayMenuItem {
  readonly label?: string;
  readonly enabled?: boolean;
  readonly type?: 'separator';
  readonly action?: TrayAction;
}

export interface TrayFace {
  readonly title: string;
  readonly tooltip: string;
  readonly menu: readonly TrayMenuItem[];
}

/** The tray's whole appearance as a value: the connection dot, the status sentence, the menu. */
export function trayFace(connected: boolean, label: string): TrayFace {
  return {
    title: connected ? '●' : '○',
    tooltip: label,
    menu: [
      { label, enabled: false },
      { type: 'separator' },
      { label: 'Open Sidekick', action: 'open' },
      { label: 'Reconnect now', enabled: !connected, action: 'reconnect' },
      { label: connected ? 'Disconnect' : 'Connect', action: 'toggle' },
      { type: 'separator' },
      { label: 'Quit', action: 'quit' },
    ],
  };
}

export interface TraySetters {
  setTitle(title: string): void;
  setToolTip(tooltip: string): void;
  setMenu(items: readonly TrayMenuItem[]): void;
}

export class TrayWriter {
  private last: { title: string; tooltip: string; menuKey: string } | null = null;

  constructor(private readonly target: TraySetters) {}

  /** Applies only the parts of `face` that differ from what was last applied. */
  write(face: TrayFace): void {
    const menuKey = JSON.stringify(face.menu);
    const last = this.last;
    if (last?.title !== face.title) this.target.setTitle(face.title);
    if (last?.tooltip !== face.tooltip) this.target.setToolTip(face.tooltip);
    if (last?.menuKey !== menuKey) this.target.setMenu(face.menu);
    this.last = { title: face.title, tooltip: face.tooltip, menuKey };
  }
}
