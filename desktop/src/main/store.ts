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
  },
});

export type { PairedPhone };
