import type { ReceiveState, ShareCardSnapshot } from './share';

/**
 * The receive card's boundary — what the renderer may ask for, and when an Accept is honoured.
 *
 * **The renderer supplies two things and nothing else: an `offerId` and a word.** No path, no name,
 * no payload. Everything that decides where bytes land — the folder, the checks, the session, the
 * offer itself — is looked up in the main process from the `offerId`, by [ShareReceiver.decide],
 * which re-checks the destination (usable, space, hard links), the negotiated version and the session
 * before a byte moves. An object with any other key is refused whole, so a compromised page cannot
 * smuggle a path in beside a valid id.
 *
 * **Accept needs the window in front of a person.** A hidden, minimised or unfocused window cannot
 * have been clicked by someone looking at the card, so an Accept from it is refused and the offer
 * keeps waiting. Decline is always honoured: it is the safe direction.
 */

const OFFER_ID = /^s-[A-Za-z0-9_-]{22}$/;

export type ParsedDecision =
  | { ok: true; offerId: string; decision: 'accept' | 'decline' }
  | { ok: false; why: string };

export function parseShareDecision(raw: unknown): ParsedDecision {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, why: 'not an object' };
  const keys = Object.keys(raw).sort();
  if (keys.length !== 2 || keys[0] !== 'decision' || keys[1] !== 'offerId') {
    return { ok: false, why: `unexpected fields: ${keys.join(', ')}` };
  }
  const { offerId, decision } = raw as { offerId: unknown; decision: unknown };
  if (typeof offerId !== 'string' || !OFFER_ID.test(offerId)) return { ok: false, why: 'not an offer id' };
  if (decision !== 'accept' && decision !== 'decline') return { ok: false, why: 'decision must be accept or decline' };
  return { ok: true, offerId, decision };
}

export interface WindowFacts {
  exists: boolean;
  visible: boolean;
  minimized: boolean;
  focused: boolean;
}

export function acceptAllowed(w: WindowFacts): { ok: true } | { ok: false; why: string } {
  if (!w.exists || !w.visible || w.minimized) return { ok: false, why: 'the window is hidden' };
  if (!w.focused) return { ok: false, why: 'the window is not in front' };
  return { ok: true };
}

/** A new offer needs a native banner when nobody can be looking at the card. */
export function shouldNotifyNewOffer(w: WindowFacts): boolean {
  return acceptAllowed(w).ok === false;
}

export type DecisionResult = { ok: true; state: ReceiveState | undefined } | { ok: false; reason: string };

export interface Decider {
  state(offerId: string): ReceiveState | undefined;
  decide(offerId: string, decision: 'accept' | 'decline'): Promise<void>;
}

/** The whole `share-decide` handler, less Electron: parse, gate, then [Decider.decide]. */
export async function handleShareDecision(raw: unknown, w: WindowFacts, receiver: Decider): Promise<DecisionResult> {
  const parsed = parseShareDecision(raw);
  if (!parsed.ok) return { ok: false, reason: `refused: ${parsed.why}` };
  if (receiver.state(parsed.offerId) !== 'awaiting-decision') return { ok: false, reason: 'that offer is not waiting for a decision' };
  if (parsed.decision === 'accept') {
    const gate = acceptAllowed(w);
    if (!gate.ok) return { ok: false, reason: `not accepted: ${gate.why}; the offer is still waiting` };
  }
  await receiver.decide(parsed.offerId, parsed.decision);
  return { ok: true, state: receiver.state(parsed.offerId) };
}

/** The folder as a person reads it: the home folder as `~`. Display only. */
export function displayFolder(folder: string, home: string): string {
  if (home && (folder === home || folder.startsWith(`${home}/`))) return `~${folder.slice(home.length)}`;
  return folder;
}

/** The snapshots as they cross IPC: the folder shown, never used, by the renderer. */
export function forRenderer(snapshots: ShareCardSnapshot[], home: string): ShareCardSnapshot[] {
  return snapshots.map((s) => ({ ...s, folder: displayFolder(s.folder, home) }));
}
