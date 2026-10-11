/**
 * The detail line of the Activity "Disconnected" row: who or what ended the session.
 *
 * A stop this Mac chose is not a failure. The link classifies every stop reason it is handed, and a
 * reason it does not recognise — `app quit`, `tray`, `user disconnected` — becomes its generic
 * *"The connection to your phone failed. See the log for details."*, which is a failure sentence
 * about something nobody failed at. So the caller says what it was doing when it stopped the link,
 * and only a session that ended without the Mac asking keeps the link's own sentence.
 */
export type StopCause = 'user' | 'quit';

export const USER_DISCONNECTED = 'You disconnected the phone from this Mac';
/** A quit, a relaunch, an update restart or a log-out: this Mac's app closing, not the link failing. */
export const APP_QUIT = 'Sidekick was closed on this Mac';

export function disconnectActivityDetail(
  cause: StopCause | null,
  status: { lastError?: string; phase: string },
): string {
  if (cause === 'user') return USER_DISCONNECTED;
  if (cause === 'quit') return APP_QUIT;
  return status.lastError ?? `now ${status.phase}`;
}
