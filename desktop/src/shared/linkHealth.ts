/**
 * What went wrong with the link, in words a person can act on — and the fourth pairing state.
 *
 * ### Why this exists
 *
 * `link.ts` assigned `this.lastError = error.message` and that string reached the status bar. On
 * 2026-09-02 a user saw:
 *
 * ```
 * 1288490715584:error:10000416:SSL routines:OPENSSL_internal:SSLV3_ALERT_CERTIFICATE_UNKNOWN:
 * ../../third_party/boringssl/src/ssl/tls_record.cc:489:SSL alert number 46
 * ```
 *
 * A file path and a line number from a vendored crypto library, in the first screen a new user
 * meets. Nobody can act on it, and it is the *internal* form of a fact the product already knows
 * how to say.
 *
 * ### The fourth state, which is the substantive part
 *
 * Trust is **two independent stores** and either side can drop it alone. When the phone forgets this
 * Mac — one tap on its Mac tab — the Mac keeps its own entry, keeps showing the phone's name in the
 * sidebar, and retries forever against a device that will never accept it. Measured, not
 * hypothesised: 47 of these alerts in one outage, and the phone logged `Forgot 3030c8eb…` at the
 * moment it began.
 *
 * So `paired` is not a boolean. There are three states and the third had no representation:
 *
 * - **unpaired** — no entry on this Mac. Show the QR.
 * - **paired** — an entry, and no evidence against it.
 * - **repudiated** — an entry the *phone* no longer honours. We are not paired in any useful sense,
 *   and no amount of retrying changes that. This is the one that was drawn as "Reconnecting…".
 *
 * ### Does this need a wire message?
 *
 * **No, and it could not have one for the failing case.** When the phone has forgotten this Mac the
 * TLS handshake fails, so there is no channel; any message announcing it would need the connection
 * whose absence is the thing being announced. The alert *is* the signal, it arrives reliably, and
 * alert 46 is specific enough to act on.
 *
 * A `pair.forgotten` courtesy message on the *live* session — the phone had five seconds of open
 * channel before teardown — would make the common case immediate rather than discovered on the next
 * failed reconnect. It is worth having and it is **not a substitute**: it cannot be sent when the
 * Mac is offline at the moment of forgetting, which is exactly when this state persists longest. The
 * mapping below stays load-bearing either way.
 */

/** TLS alert numbers, from the wire. Only 46 has been observed from this phone. */
const ALERT_CERTIFICATE_UNKNOWN = 46;
const ALERT_BAD_CERTIFICATE = 42;
const ALERT_UNKNOWN_CA = 48;

export type LinkFailureKind =
  /** The phone refused our certificate. It does not have us in its trust store. */
  | 'certificate-refused'
  /** Nothing answered — wrong network, phone asleep, app not running. */
  | 'unreachable'
  /** We reached it and it stopped answering. */
  | 'dropped'
  /** Our own protocol handling failed. A bug on this side. */
  | 'protocol'
  /** Anything else. The raw text is kept for the log and never shown. */
  | 'unknown';

export interface LinkFailure {
  kind: LinkFailureKind;
  /** One sentence for a person, naming what to do. Never contains the raw error. */
  message: string;
  /** The original text, for the log and the debug HUD only. */
  raw: string;
}

/** True when `raw` reports a TLS alert the peer sent us, rather than a local failure. */
function peerAlert(raw: string): number | null {
  const m = /SSL alert number (\d+)/i.exec(raw);
  return m ? Number(m[1]) : null;
}

/**
 * Classify a raw error string into something showable.
 *
 * Keyed on the **alert number** rather than the symbolic name: the number is the wire's own value
 * and is stable across TLS stacks, while `SSLV3_ALERT_CERTIFICATE_UNKNOWN` is BoringSSL's spelling
 * and the surrounding text is a path into a vendored source tree that changes with every Electron
 * bump. The symbolic name is accepted as a fallback because it costs one clause.
 *
 * The message never interpolates `raw`. That is the whole point of the function.
 */
export function classifyLinkError(raw: string | undefined): LinkFailure | null {
  if (!raw) return null;
  const text = String(raw);
  const alert = peerAlert(text);

  if (
    alert === ALERT_CERTIFICATE_UNKNOWN ||
    alert === ALERT_BAD_CERTIFICATE ||
    alert === ALERT_UNKNOWN_CA ||
    /CERTIFICATE_UNKNOWN|BAD_CERTIFICATE|UNKNOWN_CA/i.test(text)
  ) {
    return {
      kind: 'certificate-refused',
      message:
        'Your phone no longer recognises this Mac. Open ConnectSuite on the phone and scan a new ' +
        'pairing code — this usually means the Mac was removed from the phone’s paired list.',
      raw: text,
    };
  }

  if (/ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|EHOSTDOWN|No phone answered/i.test(text)) {
    return {
      kind: 'unreachable',
      message:
        'Could not reach your phone. Check that both are on the same Wi-Fi and that ConnectSuite ' +
        'is running on the phone.',
      raw: text,
    };
  }

  if (/ECONNRESET|EPIPE|closed the connection|socket hang up/i.test(text)) {
    return {
      kind: 'dropped',
      message: 'The connection to your phone dropped. Reconnecting.',
      raw: text,
    };
  }

  if (/protocol error|PROTOCOL_MISMATCH|BAD_REQUEST/i.test(text)) {
    return {
      kind: 'protocol',
      message:
        'This Mac and your phone disagree about the protocol. Update both to the same version.',
      raw: text,
    };
  }

  return {
    kind: 'unknown',
    message: 'The connection to your phone failed. See the log for details.',
    raw: text,
  };
}

/** Pairing as three states rather than a boolean. */
export type PairingHealth =
  | { kind: 'unpaired' }
  | { kind: 'paired' }
  | { kind: 'repudiated'; sinceMillis: number };

/**
 * The single fact the sidebar and the pairing screen must both read.
 *
 * They disagreed on 2026-09-02: the sidebar said *"Samsung SM-S938B · Reconnecting"* while the
 * pairing screen asked for a scan — two surfaces answering one question differently, on the first
 * screen a new user meets. The sidebar read the stored device name, the pairing screen read
 * `paired`, and nothing reconciled them.
 *
 * `CLAUDE.md` already records the general form as defect 27 and again in `ShellStatus.setStatus`:
 * *"four views of one fact"*. This adds the fact they were missing — that a stored pairing can be
 * repudiated by the other end — and puts it where both can read it.
 *
 * [lastFailure] is only consulted when a pairing exists; a certificate refusal while unpaired is
 * the ordinary state of an unpaired Mac and says nothing.
 */
export function pairingHealth(
  hasStoredPairing: boolean,
  lastFailure: LinkFailure | null,
  nowMillis: number,
): PairingHealth {
  if (!hasStoredPairing) return { kind: 'unpaired' };
  if (lastFailure?.kind === 'certificate-refused') {
    return { kind: 'repudiated', sinceMillis: nowMillis };
  }
  return { kind: 'paired' };
}

/**
 * Pairing copy and the tone precedence live in `./linkTone`, which is script-safe so the renderer
 * can load it as a plain `<script>`. Re-exported here so callers have one import, and **required
 * rather than duplicated** — the renderer and the tests must run the same code, which is defect
 * 46's rule.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const tone = require('./linkTone') as {
  pairingLabel: (h: PairingHealth | undefined) => string;
  needsPairing: (h: PairingHealth | undefined) => boolean;
  linkTone: (p: string | undefined, h: PairingHealth | undefined, l: boolean, e: string | undefined) => LinkTone;
  linkToneLabel: (p: string | undefined, h: PairingHealth | undefined, l: boolean) => string;
};

/** The four tones the dots, chips and island all read. */
export type LinkTone = 'live' | 'working' | 'down' | 'idle';

export const pairingLabel = tone.pairingLabel;
export const needsPairing = tone.needsPairing;
export const linkTone = tone.linkTone;
export const linkToneLabel = tone.linkToneLabel;
