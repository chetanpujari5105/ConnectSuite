import { createPublicKey, verify as verifySignature, type KeyObject } from 'node:crypto';

/**
 * The beta trial's pure core (2026-10-12): the token format, its Ed25519 check, the verdict, the clock
 * rule, the notices and every sentence a person reads about any of them.
 *
 * ### What a token is
 *
 *     SIDEKICK-TRIAL-1.<base64url(payload JSON)>.<base64url(Ed25519 signature)>
 *
 * The signature covers the ASCII bytes of `SIDEKICK-TRIAL-1.<payload>`, so the version cannot be
 * swapped under a payload. The payload is `{ v, id, label, notBefore, notAfter }`; both dates are
 * **absolute** instants, so a reinstall, a new profile or a second Mac finds the same end date — there
 * is no first-run record to restart. The owner signs with a private key that never leaves their Mac
 * (`scripts/issue-trial-token.mjs`); the app holds only the public key (`src/main/trialKey.ts`).
 *
 * ### What it does not do, said once
 *
 * Nothing here talks to a network. A token is checked on this Mac and nothing is sent anywhere, which
 * is what keeps *"nothing leaves your network"* true. The cost is the one the proposal states: an
 * offline token keeps honest people honest — it cannot be revoked before its end date, it works on any
 * Mac it is copied to (allowed, by decision), and no offline scheme survives a modified app.
 *
 * Imported by the main process and by `scripts/issue-trial-token.mjs` (Node runs this `.ts` directly),
 * so the issuer and the verifier share one definition of the format rather than two that can drift.
 * Never loaded by the renderer — it imports `node:crypto`.
 */

export const TRIAL_TOKEN_PREFIX = 'SIDEKICK-TRIAL-1';
export const DAY_MS = 86_400_000;
/** How far backwards the clock may move before the check refuses it: a correction, travel, a timezone. */
export const CLOCK_TOLERANCE_MS = DAY_MS;
/** A token longer than this is refused as malformed — a sanity bound, not a policy. */
const MAX_SPAN_MS = 400 * DAY_MS;

export interface TrialPayload {
  v: 1;
  /** Random, for the owner's ledger and for telling two tokens apart. */
  id: string;
  /** Who it was issued to, shown back in Settings. */
  label: string;
  /** ISO instants. */
  notBefore: string;
  notAfter: string;
}

// ---- format -----------------------------------------------------------------------------------

/** The payload as the issuer encodes it — fixed field order, base64url. */
export function encodePayload(p: TrialPayload): string {
  const canonical = { v: p.v, id: p.id, label: p.label, notBefore: p.notBefore, notAfter: p.notAfter };
  return Buffer.from(JSON.stringify(canonical), 'utf8').toString('base64url');
}

/** The exact bytes the signature covers. */
export function signingInput(payloadB64: string): string {
  return `${TRIAL_TOKEN_PREFIX}.${payloadB64}`;
}

export function assembleToken(payloadB64: string, signature: Uint8Array): string {
  return `${signingInput(payloadB64)}.${Buffer.from(signature).toString('base64url')}`;
}

const B64URL = /^[A-Za-z0-9_-]+$/;
const ID = /^[A-Za-z0-9_-]{16,64}$/;

/** The payload's own rules. A signed token that breaks them is still refused. */
function validPayload(raw: unknown): TrialPayload | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1) return null;
  if (typeof r.id !== 'string' || !ID.test(r.id)) return null;
  if (typeof r.label !== 'string' || r.label.trim().length === 0 || r.label.length > 80 || /[\u0000-\u001f]/.test(r.label)) return null;
  if (typeof r.notBefore !== 'string' || typeof r.notAfter !== 'string') return null;
  const from = Date.parse(r.notBefore);
  const to = Date.parse(r.notAfter);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > MAX_SPAN_MS) return null;
  return { v: 1, id: r.id, label: r.label, notBefore: r.notBefore, notAfter: r.notAfter };
}

/**
 * What a refused text most likely was, for the sentence that answers it — never for the decision, which
 * is the signature's alone. `cut-off`: the prefix is there and the rest is incomplete, or the start is
 * missing. `checksum`: a 64-character hex string (the download's SHA-256 sits beside the download).
 */
export type MalformedWhy = 'cut-off' | 'checksum' | 'url' | 'email' | 'wrong-format';

export type TokenCheck =
  /** `token` is the cleaned text that verified — the exact token as issued, and what is stored. */
  | { kind: 'ok'; payload: TrialPayload; token: string }
  /** Not a token at all, or a signed payload that breaks its own rules. */
  | { kind: 'malformed'; why: MalformedWhy }
  /** Well formed, and not signed by the key this build trusts — another key, or any edit. */
  | { kind: 'bad-signature' }
  /** This build carries no usable public key: nothing can verify. A build fault, not the person's. */
  | { kind: 'no-key' };

function publicKeyFrom(spkiB64: string | null): KeyObject | null {
  if (!spkiB64) return null;
  try {
    const key = createPublicKey({ key: Buffer.from(spkiB64, 'base64'), format: 'der', type: 'spki' });
    return key.asymmetricKeyType === 'ed25519' ? key : null;
  } catch {
    return null;
  }
}

/** Whether this build carries a key that can verify anything at all. */
export function trialKeyUsable(publicKeySpkiB64: string | null): boolean {
  return publicKeyFrom(publicKeySpkiB64) !== null;
}

// ---- a forgiving paste (2026-10-14) ----------------------------------------------------------------
//
// A person's copy is not the issuer's output. Mail wraps it, a chat app quotes it in curly quotes or
// backticks, autocorrect turns `-` into `–`, a web page carries zero-width characters, and a sentence
// ends with a full stop. So the text is cleaned — and **only** cleaned: every character that survives
// is one the issuer wrote, the cleaned text must have the exact shape of a token, and the same Ed25519
// check then runs on it. Nothing here can turn a text that was not signed into one that verifies.

/** Characters with no width, which a web page or a chat app leaves inside copied text. */
const INVISIBLE = /[\u200b-\u200d\u2060\ufeff\u00ad\u180e]/g;
/** Look-alike dashes: hyphens, figure, en and em dashes, the minus sign, fullwidth and small hyphens. */
const DASHES = /[\u2010-\u2015\u2212\ufe58\ufe63\uff0d]/g;
const DOUBLE_QUOTES = /[\u201c-\u201f\u00ab\u00bb\u2033\u301d\u301e\uff02]/g;
const SINGLE_QUOTES = /[\u2018-\u201b\u2039\u203a\u2032\u00b4\uff07]/g;
/** A signature is 64 bytes: 86 base64url characters, unpadded. */
const SIGNATURE_CHARS = 86;
const SHAPE = new RegExp(`${TRIAL_TOKEN_PREFIX}\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]{${SIGNATURE_CHARS}}`);
/** What may wrap a token or follow it: quotes, backticks, brackets, sentence punctuation, an ellipsis. */
const WRAPPING = /^["'`(<[{]+|["'`)>\]}.,;:!?\u2026]+$/g;

/** Look-alike characters put back to the ASCII the issuer wrote, invisible ones and quote markers removed. */
function normalised(text: string): string {
  return text
    .replace(INVISIBLE, '')
    .replace(DASHES, '-')
    .replace(DOUBLE_QUOTES, '"')
    .replace(SINGLE_QUOTES, "'")
    .replace(/^[ \t]*>+/gm, '');
}

/**
 * The token inside whatever was pasted: the first `SIDEKICK-TRIAL-1.<payload>.<86-char signature>` once
 * whitespace is gone, or — when there is none — the compacted text with its wrapping stripped, so a
 * refusal is decided on what the person meant to paste.
 */
export function cleanPastedToken(text: string): string {
  const compact = normalised(text).replace(/\s+/g, '');
  const found = SHAPE.exec(compact);
  return found ? found[0] : compact.replace(WRAPPING, '');
}

/** Which kind of wrong text a refused paste most likely was. Only ever chooses a sentence. */
function malformedWhy(original: string, cleaned: string): MalformedWhy {
  const at = cleaned.indexOf(`${TRIAL_TOKEN_PREFIX}`);
  if (at >= 0) {
    const rest = cleaned.slice(at).replace(WRAPPING, '');
    return /^[A-Za-z0-9_.-]+$/.test(rest) ? 'cut-off' : 'wrong-format';
  }
  const flat = normalised(original);
  if (/\b(?:https?:\/\/|www\.)\S/i.test(flat)) return 'url';
  if (/[^\s@<>"']+@[^\s@<>"']+\.[A-Za-z]{2,}/.test(flat)) return 'email';
  if (/(?:^|[^0-9A-Fa-f])[0-9A-Fa-f]{64}(?![0-9A-Fa-f])/.test(flat)) return 'checksum';
  // Another version's token is the wrong format, not a cut-off one of ours.
  if (/SIDEKICK-TRIAL-/i.test(cleaned)) return 'wrong-format';
  // The tail of a token with its start missing: base64url pieces joined by dots, long enough to be one.
  if (cleaned.length >= 40 && /^[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(cleaned)) return 'cut-off';
  return 'wrong-format';
}

/**
 * What a refused text was made of, for the log: character classes and counts only. **Never** any of
 * the text — a refused paste can be anything that was on the clipboard, a password included.
 */
export function describeRefusedText(text: string): string {
  const count = (re: RegExp) => (text.match(re) ?? []).length;
  const trimmed = text.trim();
  return [
    `${text.length} characters`,
    `upper ${count(/[A-Z]/g)}`,
    `lower ${count(/[a-z]/g)}`,
    `digits ${count(/[0-9]/g)}`,
    `dots ${count(/\./g)}`,
    `dashes ${count(/-/g)}`,
    `underscores ${count(/_/g)}`,
    `spaces ${count(/[ \t\u00a0]/g)}`,
    `line breaks ${count(/\r\n|\r|\n|\u2028|\u2029/g)}`,
    `other ASCII ${count(/[\x21-\x2c\x2f\x3a-\x40\x5b-\x5e\x60\x7b-\x7e]/g)}`,
    `non-ASCII ${count(/[^\x00-\x7f]/g)}`,
    `invisible ${count(INVISIBLE)}`,
    `hex-only ${/^[0-9A-Fa-f]+$/.test(trimmed) ? 'yes' : 'no'}`,
  ].join(', ');
}

/**
 * Checks a pasted or opened token against this build's public key, after `cleanPastedToken`. A token
 * pasted out of an email arrives wrapped, quoted, or inside a sentence; it is found and checked as issued.
 */
export function verifyTrialToken(text: string, publicKeySpkiB64: string | null): TokenCheck {
  const compact = cleanPastedToken(text);
  const malformed = (): TokenCheck => ({ kind: 'malformed', why: malformedWhy(text, compact) });
  const parts = compact.split('.');
  if (parts.length !== 3 || parts[0] !== TRIAL_TOKEN_PREFIX) return malformed();
  const [, body, sig] = parts as [string, string, string];
  if (!B64URL.test(body) || !B64URL.test(sig)) return malformed();
  const signature = Buffer.from(sig, 'base64url');
  if (signature.length !== 64) return malformed();
  const key = publicKeyFrom(publicKeySpkiB64);
  if (!key) return { kind: 'no-key' };
  // The last of 86 characters carries four padding bits, and Node ignores them: without this, 15 of 63
  // substitutions of the last character verified as the same signature (2026-10-14). One spelling only.
  if (signature.toString('base64url') !== sig) return { kind: 'bad-signature' };
  let signed = false;
  try {
    signed = verifySignature(null, Buffer.from(signingInput(body), 'ascii'), key, signature);
  } catch {
    signed = false;
  }
  if (!signed) return { kind: 'bad-signature' };
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return { kind: 'malformed', why: 'wrong-format' };
  }
  const payload = validPayload(raw);
  return payload ? { kind: 'ok', payload, token: compact } : { kind: 'malformed', why: 'wrong-format' };
}

// ---- the verdict ------------------------------------------------------------------------------

export type TrialState = 'not-enforced' | 'no-key' | 'none' | 'clock-back' | 'not-yet' | 'expired' | 'valid';

export interface TrialVerdict {
  state: TrialState;
  /** True when the Mac must not start a connection to the phone. A running session is never cut. */
  blocks: boolean;
  label: string | null;
  notBefore: string | null;
  notAfter: string | null;
  /** Whole days left, rounded up, while valid; otherwise 0. */
  daysLeft: number;
  /** For the blocking screen. */
  headline: string;
  body: string;
  /** The quiet line in Settings → About. */
  line: string;
}

/** `29 Nov 2026`, in this Mac's own time zone. */
export function formatDay(ms: number): string {
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const WHO = 'the person who invited you to the beta';
const NOTHING_LOST =
  'Nothing has been deleted: your Activity, your settings and the files you received are all still ' +
  'here, and Activity can still be exported.';

export function evaluateTrial(i: {
  enforced: boolean;
  keyPresent: boolean;
  token: TrialPayload | null;
  now: number;
  mark: number | null;
}): TrialVerdict {
  const label = i.token?.label ?? null;
  const notBefore = i.token?.notBefore ?? null;
  const notAfter = i.token?.notAfter ?? null;
  const from = notBefore ? Date.parse(notBefore) : NaN;
  const to = notAfter ? Date.parse(notAfter) : NaN;
  const make = (state: TrialState, headline: string, body: string, line: string, daysLeft = 0): TrialVerdict => ({
    state,
    blocks: state !== 'valid' && state !== 'not-enforced',
    label,
    notBefore,
    notAfter,
    daysLeft,
    headline,
    body,
    line,
  });

  if (!i.enforced) {
    const extra = i.token ? ` A token for ${i.token.label} runs until ${formatDay(to)}.` : '';
    return make(
      'not-enforced',
      'Beta access is not checked in this development build',
      `Development builds of Sidekick skip the beta check; a packaged build always makes it.${extra}`,
      `Development build — beta access is not checked.${extra}`,
    );
  }
  if (!i.keyPresent) {
    return make(
      'no-key',
      'This copy of Sidekick can’t check beta tokens',
      'It was built without the key that checks them, so no token can work in it. This is a problem ' +
        `with the build, not with your token — tell ${WHO}.`,
      'This build can’t check beta tokens.',
    );
  }
  if (i.mark !== null && i.now < i.mark - CLOCK_TOLERANCE_MS) {
    return make(
      'clock-back',
      'This Mac’s date looks earlier than before',
      `Sidekick last ran on ${formatDay(i.mark)}, but this Mac’s date now reads ${formatDay(i.now)}. It ` +
        'can’t check your beta access until the date is right. Open System Settings › General › Date & ' +
        `Time and check it. If the date is already right, ask ${WHO} for a new token — entering it fixes this.`,
      'Waiting for this Mac’s date to be right.',
    );
  }
  if (!i.token) {
    return make(
      'none',
      'Enter your beta token',
      'You need a beta token from the person who invited you. Paste it or open the token file. ' +
        'It is checked on this Mac, and nothing is sent anywhere.',
      'No beta token entered.',
    );
  }
  if (i.now < from) {
    return make(
      'not-yet',
      `Your beta access starts on ${formatDay(from)}`,
      `This token begins on ${formatDay(from)}, and Sidekick will connect from then — there is nothing ` +
        'to do now. If that date looks wrong, check this Mac’s Date & Time in System Settings.',
      `Beta access starts on ${formatDay(from)}.`,
    );
  }
  if (i.now >= to) {
    return make(
      'expired',
      `Your beta access ended on ${formatDay(to)}`,
      `Thank you for testing Sidekick. To keep using it, ask ${WHO} for a new token and enter it below. ` +
        NOTHING_LOST,
      `Beta access ended on ${formatDay(to)}.`,
    );
  }
  const daysLeft = Math.ceil((to - i.now) / DAY_MS);
  return make(
    'valid',
    'Beta access',
    '',
    `Beta access until ${formatDay(to)} · ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left · for ${i.token.label}`,
    daysLeft,
  );
}

/**
 * The latest time this Mac has been seen at. It only moves forward; a clock that went backwards
 * leaves it where it was, so the refusal holds until the date is right (or a newer token resets it).
 */
export function nextMark(mark: number | null, now: number): number {
  return mark === null ? now : Math.max(mark, now);
}

// ---- entering a token -------------------------------------------------------------------------

const NEXT = 'Your token starts with SIDEKICK-TRIAL-1 — copy that instead, or open the token file.';

/** What the entry says when a token cannot be used, by what was wrong with it — each with the next step. */
export function enteredTokenMessage(check: Exclude<TokenCheck, { kind: 'ok' }>): string {
  switch (check.kind) {
    case 'malformed':
      return malformedMessage(check.why);
    case 'bad-signature':
      return 'Part of this token changed on the way, or it was made for a different copy of Sidekick — its ' +
        'signature doesn’t match. Copy it again or open the token file; if it still doesn’t work, ask ' +
        `${WHO} for a new one.`;
    case 'no-key':
      return `This copy of Sidekick was built without the key that checks tokens, so none can work in it. Tell ${WHO}.`;
  }
}

function malformedMessage(why: MalformedWhy): string {
  switch (why) {
    case 'cut-off':
      return 'This token is cut off — part of it is missing. Copy all of it again, from ' +
        `${TRIAL_TOKEN_PREFIX} to its last character, or open the token file instead.`;
    case 'checksum':
      return `That looks like a download checksum, not a beta token. The checksum only checks the download. ${NEXT}`;
    case 'url':
      return `That looks like a web address, not a beta token. ${NEXT}`;
    case 'email':
      return `That looks like an email address, not a beta token. ${NEXT}`;
    case 'wrong-format':
      return `That isn’t a Sidekick beta token. A token is one long piece of text that starts with ${TRIAL_TOKEN_PREFIX}. ` +
        'Copy it again from the message you were sent, or open the token file.';
  }
}

/**
 * Whether a token that verified may replace what is stored, and whether it resets the clock check.
 *
 * Only a token **issued later** (a later `notBefore`) than the one held — or the first one — resets it:
 * that is the way back from a clock that was wrong, and an older token can never be used to lower it.
 */
export function enteredTokenDecision(i: {
  current: TrialPayload | null;
  entered: TrialPayload;
  now: number;
}): { accept: boolean; resetMark: boolean; message: string } {
  const from = Date.parse(i.entered.notBefore);
  const to = Date.parse(i.entered.notAfter);
  if (i.now >= to) {
    return { accept: false, resetMark: false, message: `This token ended on ${formatDay(to)}. Ask ${WHO} for a new one.` };
  }
  if (i.now < from) {
    return { accept: false, resetMark: false, message: `This token starts on ${formatDay(from)}. Enter it again on or after that day.` };
  }
  if (i.current && i.current.id === i.entered.id) {
    return { accept: true, resetMark: false, message: `This token is already in use — beta access until ${formatDay(to)}.` };
  }
  const resetMark = i.current === null || from > Date.parse(i.current.notBefore);
  return { accept: true, resetMark, message: `Thank you — beta access until ${formatDay(to)}.` };
}

// ---- notices ----------------------------------------------------------------------------------

/** A gentle notice is due at 7 days and at 1 day, once each, and only while access is valid. */
export function noticeDue(v: { state: TrialState; daysLeft: number }, shown: readonly number[]): 7 | 1 | null {
  if (v.state !== 'valid') return null;
  if (v.daysLeft <= 1) return shown.includes(1) ? null : 1;
  if (v.daysLeft <= 7) return shown.includes(7) ? null : 7;
  return null;
}

export function noticeText(days: 7 | 1, notAfter: string): string {
  const end = formatDay(Date.parse(notAfter));
  return days === 7
    ? `Your Sidekick beta access ends in 7 days, on ${end}. A new token can be entered any time in Settings › About.`
    : `Your Sidekick beta access ends within a day, on ${end}. A new token can be entered in Settings › About.`;
}
