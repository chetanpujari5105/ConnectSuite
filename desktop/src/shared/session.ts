import type { LimitedCapability, UnavailableCapability } from './protocol';

/**
 * Everything the Mac believes *because a session told it so*, in one object.
 *
 * It is one object rather than three fields for a specific reason. Defect 25 was a field that
 * `teardown()` forgot: the capability list outlived the connection that justified it, so the Mac
 * went on offering `Start mirroring` and a notifications card for a phone it was no longer talking
 * to. The fix at the time was to add the missing line — which leaves the next field to be added
 * exactly as easy to forget, and `unavailable` was added the same day.
 *
 * Grouping them makes the clear a single assignment (`this.session = clearedSession()`) and makes
 * a half-cleared session unrepresentable: a new session-scoped fact has to be added to
 * [SessionScoped], and it is then blanked by [clearedSession] without anyone remembering to.
 *
 * The rule for what belongs here: if the answer to "is this still true once the socket closes?" is
 * no, it belongs. Address and device name deliberately do *not* — they survive a drop and are what
 * the reconnect is aimed at.
 */
export interface SessionScoped {
  /** Authorises the video and bulk sockets. Meaningless without the control session that issued it. */
  sessionToken: string | null;
  /** What the phone said it can do. A claim about a connection, not about a phone. */
  capabilities: string[];
  /** What it said it cannot do, and why. Same lifetime as the claim it is the other half of. */
  unavailable: UnavailableCapability[];
  /** What it offers only in part, and how (defect 139). The same claim, so the same lifetime. */
  limited: LimitedCapability[];
  /**
   * Extensions both sides advertised at `hello` (docs/protocol.md → Extensions), name → version.
   * Fixed for the session (rule 5) and gone with it: a reconnect renegotiates.
   */
  negotiated: Record<string, number>;
}

/** A session's worth of state, blanked. The only way the link should clear it. */
export function clearedSession(): SessionScoped {
  return { sessionToken: null, capabilities: [], unavailable: [], limited: [], negotiated: {} };
}

/**
 * Emitted by `LinkClient` when a session that had a token ends — a user Disconnect, the phone closing
 * the connection, a protocol error — carrying **that** session's token (defect 157). Work bound to the
 * session (a bulk pull claims with its token) listens for it and stops; work bound to a replacement
 * session carries a different token and is left alone. One name, so the emitter and the listeners
 * cannot drift apart.
 */
export const SESSION_ENDED_EVENT = 'session-ended';

export interface SessionEnded {
  /** The token of the session that ended — never the replacement's. */
  token: string;
  /** Why it ended, as `teardown` was told. */
  reason: string;
}
