/**
 * Connection & security — the Sidekick Overview card (Figma component 19, handoff §6).
 *
 * One pure decision: given the link, what the card claims and which actions it offers. The view
 * (`renderer/overview.ts`) only draws what this returns, so the claim and the controls cannot come
 * from two different readings of the link.
 *
 * ### The rules, each from the handoff and each a thing a test asserts
 *
 * - **Encryption is claimed in the present tense only while connected.** The link is TLS 1.3 with
 *   both ends pinned and no plaintext fallback (locked decision #3), so a connected link is always
 *   encrypted — and a card claiming it over a link that is down would be this screen's one security
 *   sentence being wrong in the state where somebody is most likely to read it.
 * - **Connecting offers no action.** The handshake has not finished and nothing has been sent; the
 *   build has no verb that cancels an attempt in flight, so a Cancel button would be a control that
 *   does nothing.
 * - **Disconnected states the last session in the past tense, with its time when this Mac saw one
 *   end,** and offers Reconnect and Troubleshoot. `Disconnect` is absent — there is nothing to
 *   disconnect — and neither action is lime, because the phone is not connected.
 * - **Unpaired claims nothing about a session** and offers nothing: the pairing screen is where a
 *   first connection is made, and the shell routes there on its own.
 *
 * Plain script, no `export` — the page loads this with a `<script>` tag (defect 94).
 */

type SecurityCardState = 'connected' | 'connecting' | 'disconnected' | 'unpaired';

type SecurityAction = 'disconnect' | 'reconnect' | 'troubleshoot';

interface SecurityCardView {
  state: SecurityCardState;
  title: string;
  body: string;
  /** In drawing order. Empty means no action row at all. */
  actions: SecurityAction[];
  /**
   * `inline` puts the one action beside one line of copy; `stacked` gives the actions their own
   * right-aligned row under a hairline. The handoff: an action never begins beside wrapped copy.
   */
  layout: 'inline' | 'stacked';
}

interface SecurityCardInput {
  phase?: string;
  /** False while this Mac trusts no phone. */
  paired: boolean;
  /** `HH:MM` (or `Yesterday HH:MM`) of the last session this Mac saw end, or null if none. */
  endedAt: string | null;
}

const CONNECTING_PHASES = new Set(['searching', 'connecting', 'handshaking', 'reconnecting']);

function securityCard(input: SecurityCardInput): SecurityCardView {
  if (input.phase === 'connected') {
    return {
      state: 'connected',
      title: 'Encrypted connection',
      body: 'TLS 1.3, pinned to this Mac. Only your devices can read this traffic.',
      actions: ['disconnect'],
      layout: 'inline',
    };
  }
  if (!input.paired) {
    return {
      state: 'unpaired',
      title: 'No phone paired',
      body: 'Pair a phone to start an encrypted connection. Nothing is being sent anywhere.',
      actions: [],
      layout: 'inline',
    };
  }
  if (input.phase !== undefined && CONNECTING_PHASES.has(input.phase)) {
    return {
      state: 'connecting',
      title: 'Not encrypted yet',
      body: 'The handshake has not finished, so nothing has been sent.',
      actions: [],
      layout: 'inline',
    };
  }
  return {
    state: 'disconnected',
    title: 'Not connected',
    body: input.endedAt
      ? `The last session was encrypted with TLS 1.3 and ended at ${input.endedAt}. Nothing is being sent now.`
      : 'Nothing is being sent anywhere. The next session is encrypted with TLS 1.3, pinned to this Mac.',
    actions: ['reconnect', 'troubleshoot'],
    layout: 'stacked',
  };
}

if (typeof globalThis !== 'undefined') {
  (globalThis as unknown as Record<string, unknown>).securityCard = securityCard;
}

if (typeof module !== 'undefined') {
  module.exports = { securityCard };
}
