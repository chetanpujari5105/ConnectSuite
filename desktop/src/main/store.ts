import { app } from 'electron';
import Store from 'electron-store';
import type { ConnectionStatus } from '../shared/protocol';
import { legacyUserDataDir, migrateLegacySettings, type SettingsMigration } from './legacyData';

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
  /**
   * Where phone files land on this Mac, or null for `~/Downloads/Sidekick`.
   *
   * A path, not a bookmark: the app is not sandboxed, so there is no security scope to store. What a
   * path cannot survive — a rename, an unplugged drive — is answered in `downloads.ts` by refusing
   * with the folder named, never by recreating it somewhere nobody is looking.
   */
  receiveFolder: string | null;
}

/**
 * Small persistent settings blob. Only non-secret material lives here — the TLS private key goes
 * through safeStorage in identity.ts instead.
 */
/**
 * The one-time ConnectSuite settings fill, run **here** because it must precede the store's
 * construction: `electron-store` writes every default into `sidekick.json` when it opens it, after
 * which no key is ever missing and a fill-missing migration would copy nothing. The logger is not
 * up yet at import time, so the outcome is kept and `main.ts` logs it once it is.
 */
export const settingsMigration: SettingsMigration = (() => {
  try {
    const userData = app.getPath('userData');
    return migrateLegacySettings(legacyUserDataDir(userData), userData);
  } catch (error) {
    return { outcome: 'failed', reason: String(error) };
  }
})();

export const store = new Store<Schema>({
  name: 'sidekick',
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
    receiveFolder: null,
  },
});

export type { PairedPhone };
