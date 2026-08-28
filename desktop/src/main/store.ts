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
  },
});

export type { PairedPhone };
