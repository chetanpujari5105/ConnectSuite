import Store from 'electron-store';
import type { ConnectionStatus } from '../shared/protocol';

interface PairedPhone {
  deviceId: string;
  deviceName: string;
  /** The phone certificate fingerprint we pin from here on. */
  fingerprint: string;
  pairedAt: number;
}

interface Schema {
  paired: PairedPhone | null;
  lastAddress: string | null;
  manualAddress: string | null;
  tailscaleAddress: string | null;
  lastDiscoveryVia: ConnectionStatus['via'] | null;
  autoConnect: boolean;
  /**
   * Watch this Mac's clipboard and send each copy without a click.
   *
   * **On by default, and persisted, because a privacy switch that forgets is not a switch.** The
   * value is a preference and holds no clipboard content — the histories stay memory-only and the
   * `docs/protocol.md` rule about nothing at rest is untouched by it.
   */
  watchClipboard: boolean;
  /**
   * Play a sound with a native notification.
   *
   * **Off by default**, and that is the decision rather than an oversight: the phone in your pocket
   * has already made a sound for this notification, and a second one per message is what makes
   * people uninstall a mirror. The banner still appears; only the sound is opt-in.
   */
  notificationSound: boolean;
  /**
   * Appearance: `system`, `light` or `dark`.
   *
   * Defaults to `system`, which is what macOS itself does and the only default that is right on a
   * Mac whose owner switches at sunset. It is a `string` in the schema rather than the union so a
   * hand-edited or future value cannot make the app unstartable; `asAppearance` narrows it on read.
   */
  appearance: string;
}

/**
 * Small persistent settings blob. Only non-secret material lives here — the TLS private key goes
 * through safeStorage in identity.ts instead.
 */
export const store = new Store<Schema>({
  name: 'connectsuite',
  defaults: {
    paired: null,
    lastAddress: null,
    manualAddress: null,
    tailscaleAddress: null,
    lastDiscoveryVia: null,
    autoConnect: true,
    watchClipboard: true,
    notificationSound: false,
    appearance: 'system',
  },
});

export type { PairedPhone };
