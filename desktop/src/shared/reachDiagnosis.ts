/**
 * Why no address answered — one diagnosis out of every address a connection round tried.
 *
 * ### The defect this exists for (2026-11-10)
 *
 * A tester's phone sat on *"Code scanned. Verifying your Mac…"* for the code's whole five minutes
 * while the Mac read *"Not paired · no answer on any known address"*. The Mac knew more than that
 * and threw it away twice:
 *
 *  - `link.ts` logged each address's own reason (`connect ECONNREFUSED`, `timed out`, …) and then
 *    **overwrote** the recorded failure with `No phone answered on any known address` when the round
 *    ended, so the per-address reason never outlived the loop;
 *  - `classifyLinkError` folded `ECONNREFUSED`, `EHOSTUNREACH`, `ENETUNREACH` and a timeout into one
 *    sentence. Those are four different situations with four different next steps.
 *
 * ### What each outcome is evidence of, and what it is not
 *
 * | outcome | what happened | what a person does |
 * |---|---|---|
 * | `answered` | TCP connected and the phone then refused or failed | not a reachability problem — no sentence from here |
 * | `handshake-stalled` | TCP connected; TLS did not finish in time | the phone was reached — retry, keep it awake |
 * | `refused` | something at that address answered "no listener" | Sidekick is not running there, or it is another device |
 * | `host-unreachable` | the OS failed the send at once (`EHOSTUNREACH`, `EHOSTDOWN`) | check macOS's Local Network switch |
 * | `silent` | nothing came back before the timeout | different networks, or the network isolates clients |
 * | `bad-address` | the text is not an address (`ENOTFOUND`) | retype it |
 * | `no-route` | this Mac has no route at all (`ENETUNREACH`) | join a network |
 *
 * `host-unreachable` is **worded as a possibility**. macOS answers a blocked local-network send with
 * `EHOSTUNREACH`, and so does a host that is simply not on the link; one result, two causes, so the
 * sentence names the check rather than asserting the cause.
 *
 * The outcomes are ordered by **how far the attempt got**, because the attempt that got furthest is
 * the one that says most: a stalled handshake proves the address and the network are right, which a
 * timeout on some other address cannot contradict.
 */

export type ReachOutcome =
  /** The phone completed TCP and then said something — a refusal, an alert, a protocol reason. */
  | 'answered'
  | 'handshake-stalled'
  | 'refused'
  | 'host-unreachable'
  | 'silent'
  | 'bad-address'
  | 'no-route'
  | 'other';

export interface ReachAttempt {
  host: string;
  /** How discovery came by this address — `last-known`, `gateway`, `mdns`, `manual`, … */
  via: string;
  /** Whether TCP connected before the attempt ended. */
  tcpConnected: boolean;
  /** Whether it ended on this Mac's own timeout rather than on an error. */
  timedOut: boolean;
  /** The error's `code` (`ECONNREFUSED`, …), when it ended on an error that carried one. */
  code: string | null;
}

export interface ReachDiagnosis {
  /**
   * macOS is probably refusing Sidekick the local network — see [localNetworkSuspected]. When true it
   * outranks [kind] in the sentence, because every other address fails for the same reason.
   */
  localNetworkSuspected: boolean;
  /** `nothing-to-try` when discovery produced no address at all. */
  kind: ReachOutcome | 'nothing-to-try';
  /** The addresses that produced [kind], in the order they were tried. */
  hosts: string[];
  /** How many addresses the round tried — the denominator for [hosts]. */
  tried: number;
}

/** Furthest-reaching first. `diagnoseReach` reports the first of these any attempt produced. */
const PRECEDENCE: ReachOutcome[] = [
  'answered',
  'handshake-stalled',
  'refused',
  'host-unreachable',
  'silent',
  'bad-address',
  'no-route',
  'other',
];

export function outcomeOf(attempt: ReachAttempt): ReachOutcome {
  if (attempt.tcpConnected) return attempt.timedOut ? 'handshake-stalled' : 'answered';
  if (attempt.timedOut || attempt.code === 'ETIMEDOUT') return 'silent';
  switch (attempt.code) {
    case 'ECONNREFUSED':
      return 'refused';
    case 'EHOSTUNREACH':
    case 'EHOSTDOWN':
      return 'host-unreachable';
    case 'ENETUNREACH':
    case 'EADDRNOTAVAIL':
    case 'ENETDOWN':
      return 'no-route';
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 'bad-address';
    default:
      return 'other';
  }
}

/**
 * Whether this round looks like macOS withholding **Local Network** access from Sidekick.
 *
 * ### What can and cannot be known
 *
 * There is no API by which an app reads this permission, so nothing here is a reading of the
 * setting. It is an inference from one structural fact: **the send to this Mac's own default gateway
 * failed outright** — not refused, not timed out, an error before TCP. The gateway is the one local
 * address known to be on the link and alive, since the system is routing through it at that moment;
 * the OS declining to send to it is the anomaly a blocked app produces and an ordinary network does
 * not.
 *
 * Keyed on that structure rather than on an errno: which errno macOS returns for a denied send was
 * looked for on 2026-11-10 and **not confirmed**, so no single code is trusted to mean it.
 *
 * It is withdrawn by any attempt that proves local sends work — a TCP connection, or a refusal,
 * which is a reply from the local network.
 *
 * **Not reached by any test or run:** a real denial. The dev app is launched from Terminal, which
 * macOS exempts from local network privacy, and the owner's setting was not changed to produce one.
 */
export function localNetworkSuspected(attempts: readonly ReachAttempt[]): boolean {
  const sendsWork = attempts.some((attempt) => attempt.tcpConnected || outcomeOf(attempt) === 'refused');
  if (sendsWork) return false;
  return attempts.some(
    (attempt) =>
      attempt.via === 'gateway' &&
      !attempt.tcpConnected &&
      !attempt.timedOut &&
      attempt.code !== null &&
      outcomeOf(attempt) !== 'silent' &&
      outcomeOf(attempt) !== 'bad-address',
  );
}

export function diagnoseReach(attempts: readonly ReachAttempt[]): ReachDiagnosis {
  if (attempts.length === 0) return { localNetworkSuspected: false, kind: 'nothing-to-try', hosts: [], tried: 0 };
  const outcomes = attempts.map(outcomeOf);
  const kind = PRECEDENCE.find((candidate) => outcomes.includes(candidate)) ?? 'other';
  const hosts = attempts.filter((_, index) => outcomes[index] === kind).map((attempt) => attempt.host);
  return { localNetworkSuspected: localNetworkSuspected(attempts), kind, hosts: [...new Set(hosts)], tried: attempts.length };
}

const HOTSPOT =
  'Turn on the phone’s hotspot, join it from this Mac, and scan a fresh code — that takes the network out of the question.';

/** Worded as "looks like": it is an inference, and the setting itself cannot be read. */
export const LOCAL_NETWORK_SUSPECTED =
  'It looks like macOS is not letting Sidekick use the local network: this Mac could not even send to its own ' +
  'router. Open System Settings → Privacy & Security → Local Network, turn Sidekick on, then quit and reopen ' +
  'Sidekick. If Sidekick is not in that list, or is already on, restart the Mac and try once more.';

/**
 * One sentence for a person, naming the next step — or null when reachability is not the story.
 *
 * `answered` is null on purpose: a phone that completed TCP and then refused or failed has its own
 * reason, recorded by the attempt itself, and "no answer" over it would be false. Hosts are addresses
 * the Mac itself tried.
 */
export function reachSentence(diagnosis: ReachDiagnosis): string | null {
  if (diagnosis.localNetworkSuspected) return LOCAL_NETWORK_SUSPECTED;
  const where = diagnosis.hosts.slice(0, 2).join(' or ');
  switch (diagnosis.kind) {
    case 'handshake-stalled':
      return (
        `This Mac reached the phone at ${where}, but the secure connection did not finish in time. ` +
        'Keep Sidekick open on the phone’s screen and try again.'
      );
    case 'refused':
      return (
        `A device at ${where} answered, but Sidekick is not listening there. Open Sidekick on the phone; ` +
        'if the phone shows a different address, type that one below.'
      );
    case 'host-unreachable':
      return (
        `This Mac could not send anything to ${where}. macOS may be blocking Sidekick from the local network: ` +
        'open System Settings → Privacy & Security → Local Network, turn Sidekick on, then try again. ' +
        'If it is already on, the phone is not on this network.'
      );
    case 'silent':
      return (
        `No answer from ${where}. The phone and this Mac are on different networks, or this network stops ` +
        `devices talking to each other (common on guest, office and hostel Wi-Fi). ${HOTSPOT}`
      );
    case 'bad-address':
      return `“${where}” is not an address this Mac can use. Type the phone’s address like 192.168.1.42.`;
    case 'no-route':
      return 'This Mac is not connected to a network. Join the same Wi-Fi as the phone, or the phone’s hotspot.';
    case 'nothing-to-try':
      return (
        'This Mac has no address to try for the phone: nothing announced itself on this network. ' +
        'Type the address the phone shows under “this phone’s address”, or use the phone’s hotspot.'
      );
    default:
      return null;
  }
}

/** For the log: every address with its own outcome, so the ratio survives. Never shown to a person. */
export function reachSummary(attempts: readonly ReachAttempt[]): string {
  if (attempts.length === 0) return 'no addresses to try';
  return attempts
    .map((attempt) => `${attempt.host} (${attempt.via}): ${outcomeOf(attempt)}${attempt.code ? ` ${attempt.code}` : ''}`)
    .join('; ');
}
