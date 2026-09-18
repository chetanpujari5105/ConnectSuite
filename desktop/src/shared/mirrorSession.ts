/**
 * Whether a mirror session exists, and which of Start / Stop that puts on screen.
 *
 * Until 2026-09-17 nothing in the renderer held this fact. `renderer.ts` enabled both buttons from
 * one input — does the phone advertise `mirror` — so the Mirror inspector drew a full-weight
 * *Stop mirroring* above a full-weight *Start mirroring* while nothing was running, and the same the
 * other way round mid-session. The decision was never wrong; there was nothing to decide from.
 *
 * The transitions live here rather than in `MirrorView` for the reason `CLAUDE.md` gives about
 * `LinkState.afterSessionEnded`: when a defect is about *when* something becomes true, the test has
 * to reach the write. `MirrorView` needs a canvas, a decoder and a bridge; this needs nothing.
 *
 * No `export`: the page loads this as a classic script (defect 94).
 */

type MirrorSession = 'idle' | 'starting' | 'active';

type MirrorSessionEvent =
  /** The Mac asked the phone to start. Stop is offered from this moment — consent can take a while. */
  | 'start-requested'
  /** The phone rejected the start (denied, locked, no projection). */
  | 'start-failed'
  /** `mirror.state` arrived as `running`. */
  | 'phone-running'
  /** `mirror-stopped` that ends the session. */
  | 'stopped'
  /** `mirror-stopped` with `transient` — SECURE_SURFACE; the session is still running. */
  | 'stopped-transient'
  /** The Mac asked the phone to stop. */
  | 'stop-requested';

interface MirrorButtons {
  startShown: boolean;
  startEnabled: boolean;
  stopShown: boolean;
}

function mirrorSessionAfter(session: MirrorSession, event: MirrorSessionEvent): MirrorSession {
  switch (event) {
    case 'start-requested':
      return session === 'active' ? 'active' : 'starting';
    case 'phone-running':
      return 'active';
    case 'start-failed':
      return session === 'starting' ? 'idle' : session;
    case 'stopped':
    case 'stop-requested':
      return 'idle';
    case 'stopped-transient':
      return session;
  }
}

/**
 * Exactly one of the two is on screen. Start is *shown* whenever idle and *enabled* only while the
 * phone advertises mirroring; Stop never depends on the capability, because a capability that drops
 * mid-session must not strand the session it was running.
 */
function mirrorButtons(canMirror: boolean, session: MirrorSession): MirrorButtons {
  const idle = session === 'idle';
  return { startShown: idle, startEnabled: idle && canMirror, stopShown: !idle };
}

{
  const g = globalThis as Record<string, unknown>;
  g.mirrorSessionAfter = mirrorSessionAfter;
  g.mirrorButtons = mirrorButtons;
}
if (typeof module !== 'undefined') {
  module.exports = { mirrorSessionAfter, mirrorButtons };
}
