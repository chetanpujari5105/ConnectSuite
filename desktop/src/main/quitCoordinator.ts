/**
 * Quit, in one place: what has to finish before the app may exit, how long it may take, and the one
 * teardown that closes the link. Defect 200.
 *
 * ### Why this exists
 *
 * On 2026-10-07 the first named *Quit Sidekick* left a windowless main process alive for minutes and a
 * second click exited at once. The cause is **not established** (`docs/defects.md` → 200). What the code
 * had was a prepended `before-quit` listener that held **every** first quit while `webcam` was set —
 * which is always — and re-issued `app.quit()` after the webcam's dispose, with no bound and no log, beside
 * a second `before-quit` listener that closed the link on every quit event, including the re-issued one.
 * So the stall could not be placed: nothing said whether the hold began, whether the cleanup settled, or
 * whether the re-issued quit was reached.
 *
 * This does not claim to fix a cause nobody has found. It removes what the code reading implicates and
 * makes the next occurrence name its stage:
 *
 * - **An idle quit is not held.** With no work pending, the first `before-quit` runs the teardown once
 *   and lets the quit proceed — the same plain path the second click took, which exited.
 * - **Cleanup starts once.** A repeated quit while it runs is held again and starts nothing.
 * - **The wait is bounded.** Whatever the cleanup does, `quit()` is re-issued once, at `boundMs` at the
 *   latest. Nothing is killed and `app.exit()` is never called: a deadline that passes is *logged*, with
 *   what was still unfinished, and the ordinary quit path (windows, `will-quit`) runs as it would.
 * - **Every stage logs**, without content: held (and for what), each item settled or failed (by error
 *   name only) with its time, the deadline if reached, the quit re-issued, and `will-quit` reached.
 *
 * ### What the hold protects, and what it does not
 *
 * The teardown (closing the video socket and the link) runs **after** the cleanup when there is work, so
 * the webcam's `webcam.stop` `shutdown` goes out while the link is still up and the bridge child is reaped
 * before the app exits — the intent the old gate's comment stated, which its sibling listener defeated by
 * closing the link at once. If the deadline passes first, the link is closed anyway and a bridge child
 * may outlive the app; the deadline line says so and names its pid.
 *
 * File transfers are **not** work here, deliberately. A pull or push interrupted by quit is the same as
 * one interrupted by a dropped link: the partial file and its resume record are kept and it resumes on
 * the next connection (defect 157). Holding quit for a transfer would make Quit wait on the network.
 *
 * ### The seam
 *
 * Electron-free: `main.ts` passes `app`, and the tests pass an `EventEmitter` and a fake clock to the same
 * function. **No test here can prove that Electron's process exits** after `quit()` is re-issued — the
 * stage the windows closing on 2026-10-07 points at. The `will-quit reached` line is what would show it.
 */

/** One thing that must finish, or be given up on, before the app exits. */
export interface QuitWork {
  /** A fixed label for the log. Never user content. */
  readonly name: string;
  /** True while there is something to stop. Read once, at the first quit. */
  pending(): boolean;
  /** Stops it. Called at most once. */
  cleanup(): Promise<void>;
  /** A non-sensitive detail for the deadline line, e.g. `bridge pid 123`. */
  detail?(): string | null;
}

export interface QuitEventSource {
  prependListener(event: 'before-quit', listener: (event: { preventDefault(): void }) => void): unknown;
  on(event: 'will-quit', listener: () => void): unknown;
  quit(): void;
}

export interface QuitTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
}

export interface QuitLog {
  info(tag: string, message: string): void;
  warn(tag: string, message: string): void;
}

export interface QuitCoordinatorDeps {
  app: QuitEventSource;
  work: readonly QuitWork[];
  /** Closes what quit closes (the video socket, the link). Runs exactly once. */
  teardown(): void;
  boundMs?: number;
  timers?: QuitTimers;
  log: QuitLog;
}

/** Above the bridge's 2 s graceful + 1 s SIGTERM reap and the webcam's 5 s request timeout. */
export const QUIT_CLEANUP_BOUND_MS = 10_000;

export type QuitPhase = 'open' | 'held' | 'released';

export interface QuitCoordinator {
  phase(): QuitPhase;
}

const TAG = 'quit';

const realTimers: QuitTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

export function installQuitCoordinator(deps: QuitCoordinatorDeps): QuitCoordinator {
  const boundMs = deps.boundMs ?? QUIT_CLEANUP_BOUND_MS;
  const timers = deps.timers ?? realTimers;
  const { log } = deps;

  let phase: QuitPhase = 'open';
  let requestedAt = 0;
  let repeats = 0;
  let tornDown = false;

  const teardownOnce = () => {
    if (tornDown) return;
    tornDown = true;
    try {
      deps.teardown();
    } catch (error) {
      log.warn(TAG, `teardown threw ${errorName(error)}; quitting regardless`);
    }
  };

  const release = (why: string) => {
    if (phase === 'released') return;
    phase = 'released';
    teardownOnce();
    log.info(TAG, `quit re-issued (${why}) ${timers.now() - requestedAt} ms after it was requested`);
    deps.app.quit();
  };

  deps.app.prependListener('before-quit', (event) => {
    if (phase === 'released') return;

    if (phase === 'held') {
      repeats += 1;
      event.preventDefault();
      log.info(TAG, `quit requested again while cleanup runs (repeat ${repeats}); nothing new started — it proceeds by itself within ${boundMs} ms of the first request`);
      return;
    }

    requestedAt = timers.now();
    const busy = deps.work.filter((w) => {
      try {
        return w.pending();
      } catch (error) {
        log.warn(TAG, `${w.name}: could not tell whether it has work (${errorName(error)}); treating it as busy`);
        return true;
      }
    });

    if (busy.length === 0) {
      phase = 'released';
      teardownOnce();
      log.info(TAG, `quit requested; nothing to wait for (${deps.work.length} checked) — proceeding`);
      return;
    }

    phase = 'held';
    event.preventDefault();
    log.info(TAG, `quit held for ${busy.map((w) => w.name).join(', ')}; bound ${boundMs} ms`);

    const unfinished = new Set(busy.map((w) => w.name));
    const deadline = timers.setTimeout(() => {
      const left = busy
        .filter((w) => unfinished.has(w.name))
        .map((w) => {
          const d = w.detail?.() ?? null;
          return d ? `${w.name} (${d})` : w.name;
        });
      log.warn(TAG, `cleanup bound of ${boundMs} ms reached with ${left.join(', ')} unfinished; quitting without it — anything it was stopping may outlive the app`);
      release('bound reached');
    }, boundMs);

    const settled = busy.map((w) => {
      const started = timers.now();
      // Started synchronously, inside the quit event; a synchronous throw becomes a logged failure.
      let running: Promise<void>;
      try {
        running = Promise.resolve(w.cleanup());
      } catch (error) {
        running = Promise.reject(error);
      }
      return running
        .then(
          () => {
            unfinished.delete(w.name);
            log.info(TAG, `${w.name} cleanup finished in ${timers.now() - started} ms${phase === 'released' ? ', after the quit was re-issued' : ''}`);
          },
          (error: unknown) => {
            unfinished.delete(w.name);
            log.warn(TAG, `${w.name} cleanup failed (${errorName(error)}) after ${timers.now() - started} ms${phase === 'released' ? ', after the quit was re-issued' : ''}`);
          },
        );
    });

    void Promise.all(settled).then(() => {
      if (phase === 'released') return;
      timers.clearTimeout(deadline);
      release('cleanup settled');
    });
  });

  deps.app.on('will-quit', () => {
    log.info(TAG, `will-quit reached ${requestedAt ? `${timers.now() - requestedAt} ms after quit was requested` : '(no before-quit seen)'}`);
  });

  return { phase: () => phase };
}
