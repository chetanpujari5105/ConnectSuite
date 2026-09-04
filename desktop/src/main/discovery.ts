import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Bonjour } from 'bonjour-service';
import { pairIntentKey, pairIntentMatches } from '../shared/protocol';
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

/**
 * Watches mDNS for a phone that has **scanned this Mac's code** — F6 / P3.
 *
 * ### What it is for
 *
 * `docs/phase-7-pairing-flow.md` J1 and J2 are the same Mac screen: *code up, nothing scanned* and
 * *code up, scanned, and the phone is now looking for us*. To the person holding the phone those
 * are completely different situations, and the Mac showing one sentence for both means the first
 * thirty seconds of a failed pairing are indistinguishable from the first thirty seconds of a
 * working one.
 *
 * The phone publishes `TXT_PAIR_INTENT` carrying {@link pairIntentKey} of the fingerprint it just
 * scanned, from the moment it scans until the pairing resolves. Matching it against **our own**
 * fingerprint is what makes this a statement about *this* Mac rather than about any phone that
 * happens to be pairing with anything on the network.
 *
 * ### A positive is trustworthy; a negative is not, and that is load-bearing
 *
 * `docs/protocol.md` says so where the constant is declared, and it decides the whole shape of this
 * function. mDNS is the least reliable of the three discovery paths — it is dropped by client
 * isolation, by some routers' multicast handling, and by a phone that has simply not published yet.
 * So this **only ever reports a sighting**. It never reports an absence, has no "not scanned"
 * callback, and its caller must not render one: a Mac saying *"nobody has scanned this code"* over a
 * phone that scanned it forty seconds ago would be a confident wrong answer in the one place a
 * stranger has no way to check it.
 *
 * Stopping is the caller's job and it must happen: the browser holds a socket.
 */
export function watchForPairIntent(
  ourFingerprint: string,
  onSighting: (deviceName: string | null) => void,
): { stop: () => void } {
  const wanted = pairIntentKey(ourFingerprint);
  let bonjour: Bonjour | null = null;
  let stopped = false;
  let browser: { stop: () => void } | null = null;

  try {
    bonjour = new Bonjour();
  } catch (error) {
    // Unavailable is not "nobody scanned". The caller is told nothing, which leaves its screen
    // saying what it said before, which is the honest outcome.
    log.warn('pair-intent', `mDNS unavailable, so a scan cannot be seen: ${String(error)}`);
    return { stop: () => undefined };
  }

  // **Armed, said out loud.** Without this line a watch that never fires is indistinguishable from
  // a watch that was never started — and since the only other line this function writes is a
  // sighting, "nothing in the log" would have meant both. That is `CLAUDE.md`'s rule about a route
  // with no log line, applied before it costs anybody a debugging session.
  log.info('pair-intent', `Watching mDNS for a phone publishing ${wanted} — a sighting only; an absence means nothing`);

  browser = bonjour.find({ type: SERVICE_TYPE, protocol: 'tcp' }, (service) => {
    if (stopped) return;
    // The comparison lives in `shared/protocol.ts` so a test can reach it without a network. See
    // `pairIntentMatches` for why it is against *our own* fingerprint and not against any `pair`
    // attribute on the network.
    if (!pairIntentMatches(service.txt as Record<string, unknown> | undefined, ourFingerprint)) return;
    log.info(
      'pair-intent',
      `A phone published our key ${wanted} — it has scanned this code (${service.name ?? 'unnamed'})`,
    );
    onSighting(typeof service.name === 'string' ? service.name : null);
  });

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      try {
        browser?.stop();
        bonjour?.destroy();
      } catch {
        /* already torn down */
      }
      log.info('pair-intent', `Stopped watching for ${wanted}`);
    },
  };
}
