import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Bonjour } from 'bonjour-service';
import { PORT_CONTROL, SERVICE_TYPE, type ConnectionStatus } from '../shared/protocol';
import { log } from './logger';
import { store } from './store';

const exec = promisify(execFile);

export interface Candidate {
  host: string;
  port: number;
  via: NonNullable<ConnectionStatus['via']>;
}

/** How long each strategy gets before we fall through to the next one. */
export const CANDIDATE_TIMEOUT_MS = 2_000;

/**
 * Candidate addresses for the phone, in the order docs/protocol.md fixes.
 *
 * The gateway probe is the one that matters most in practice: on the Samsung hotspot the Mac's
 * default gateway *is* the phone, and that AP drops multicast, so mDNS is usually dead exactly
 * when the user needs it. Hard-coding 192.168.43.1 would not do — One UI has used several
 * subnets — so we read the actual route.
 */
export async function* discoverCandidates(): AsyncGenerator<Candidate> {
  const seen = new Set<string>();
  const emit = (host: string | null | undefined, via: Candidate['via']): Candidate | null => {
    if (!host || seen.has(host)) return null;
    seen.add(host);
    return { host, port: PORT_CONTROL, via };
  };

  const last = emit(store.get('lastAddress'), 'last-known');
  if (last) yield last;

  const gateway = emit(await defaultGateway(), 'gateway');
  if (gateway) yield gateway;

  for (const host of await browseMdns(CANDIDATE_TIMEOUT_MS)) {
    const candidate = emit(host, 'mdns');
    if (candidate) yield candidate;
  }

  const tailscale = emit(store.get('tailscaleAddress'), 'tailscale');
  if (tailscale) yield tailscale;

  const manual = emit(store.get('manualAddress'), 'manual');
  if (manual) yield manual;
}

/** The phone is the gateway whenever the Mac is on its hotspot. */
export async function defaultGateway(): Promise<string | null> {
  try {
    const { stdout } = await exec('/sbin/route', ['-n', 'get', 'default'], { timeout: 2000 });
    const match = stdout.match(/gateway:\s*([0-9a-fA-F.:]+)/);
    return match?.[1] ?? null;
  } catch (error) {
    log.warn('discovery', `No default route: ${String(error)}`);
    return null;
  }
}

/** Browses `_connectsuite._tcp` for a fixed window and returns whatever answered. */
export function browseMdns(timeoutMs = CANDIDATE_TIMEOUT_MS): Promise<string[]> {
  return new Promise((resolve) => {
    const found: string[] = [];
    let bonjour: Bonjour | null = null;
    try {
      bonjour = new Bonjour();
    } catch (error) {
      log.warn('discovery', `mDNS unavailable: ${String(error)}`);
      resolve(found);
      return;
    }

    const browser = bonjour.find({ type: SERVICE_TYPE, protocol: 'tcp' }, (service) => {
      // Prefer the IPv4 address: the phone binds v4 sockets and a link-local v6 hop from the
      // Mac's Wi-Fi interface will simply time out.
      const v4 = service.addresses?.find((address) => address.includes('.') && !address.includes(':'));
      if (v4 && !found.includes(v4)) found.push(v4);
    });

    setTimeout(() => {
      try {
        browser.stop();
        bonjour?.destroy();
      } catch {
        /* browser already torn down */
      }
      if (found.length > 0) log.info('discovery', `mDNS found ${found.join(', ')}`);
      resolve(found);
    }, timeoutMs);
  });
}
