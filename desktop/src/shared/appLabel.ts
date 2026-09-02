/**
 * One answer to "what do we call this app in a sentence", for every pane that has to.
 *
 * ### Defect 46, and why this is not a copy of notifyLabels.ts
 *
 * `AppLabels.of` on the phone returns the package name as its honest answer for a package with no
 * launcher icon. **That fallback is correct and must not be "fixed."** There is genuinely no better
 * label, and inventing one — title-casing the last path segment, say — replaces an honest handle
 * with a fabricated name.
 *
 * What was missing on the Mac is the other half of CLAUDE.md's rule: a package id may appear as a
 * machine handle, **never as the only thing a user reads**. The remote had four sentences that
 * named an app and not one of them marked the handle:
 *
 * | Site | Was | With `com.spotify.music` and no label |
 * |---|---|---|
 * | `renderer/remote.ts` now-playing note | `appName ?? package ?? 'an app'` | "Paused in com.spotify.music." |
 * | `main/remote.ts` refusal reason | `appName ?? package ?? 'That app'` | "com.spotify.music does not allow seeking…" |
 * | `renderer/remote.ts` seek title | `appName ?? 'This app'` | "This app does not allow seeking…" |
 * | `renderer/remote.ts` skip title | `appName ?? 'This app'` | "This app does not allow skipping…" |
 *
 * **The last two are wrong too, and the register said so before they were counted.** Defect 46's
 * record names `appName ?? 'an app'` as one of its two wrong fixes: it makes the sentence safe and
 * throws away the only identifying information there is, so a user whose label failed to resolve is
 * told "This app" and nothing tells anyone the resolution failed. The handle should appear; it must
 * not appear *alone*. Enumerating found four sites where the record, written from a screenshot of
 * two, had said three. That is defect 28's lesson landing for the third time: grep for every
 * package name reaching a string, not the ones a screenshot showed you.
 *
 * ### Why here, and why this shape
 *
 * `src/shared/` is the electron-free layer, which is where a testable seam belongs — and this one
 * has to be reachable from **both** sides of the same defect: `main/remote.ts` is a real module and
 * `renderer/remote.ts` is a plain `<script>` with no module loader. The other wrong fix the record
 * names is copying `notifyLabels.ts` into the remote, because a second copy is the copy that does
 * not get the next fix.
 *
 * So this is written in the renderer's plain-script shape — no top-level `export`, a `module.exports`
 * shim at the foot — which makes it loadable by a `<script>` tag, `require`-able from the main
 * process, and `require`-able from `node --test`. One implementation, three consumers. Its
 * declarations are global to the TypeScript project, so `main/remote.ts` gets full types from the
 * same file it calls at runtime.
 *
 * `notifyLabels.ts` now **delegates** to [resolveAppLabel] rather than holding a second copy of the
 * same six lines — plain scripts share one global scope, so two definitions of `appLabelOf` do not
 * merely duplicate, they collide, and the compiler said so the moment this file was added. The
 * names here are `resolveAppLabel` and `appPhrase` so the pane keeps its own vocabulary at its own
 * call sites while there is one implementation underneath.
 *
 * The notifications pane's own strings are deliberately left where they are. It is correct, it is guarded by its own enumeration,
 * and rewriting a working pane is not what defect 46 asked for. What has changed is that the marking
 * *convention* now has one definition, so a third pane has something to call instead of a third
 * copy to write.
 */

/** The two fields any payload carrying an app has. Both optional: the wire says so. */
interface AppLabelSource {
  appName?: string | null;
  package?: string | null;
}

interface ResolvedAppLabel {
  /** What a person reads. Never empty. */
  label: string;
  /** True when [label] is the package id itself, because no name resolved. */
  isPackageFallback: boolean;
  /** True when there was neither a name nor a package — [label] is the caller's generic. */
  isUnknown: boolean;
}

/**
 * The app's label, and whether it is really a package id wearing a name's clothes.
 *
 * `whenUnknown` is the caller's generic for the case where the wire carried neither field, and it
 * differs by sentence position — "Paused in **an app**" against "**That app** does not allow…".
 * It is a parameter rather than a constant because a shared module that picks one of them is a
 * shared module half the callers have to work around.
 *
 * A blank or whitespace `appName` counts as unresolved rather than as an empty label: a sentence
 * headed by nothing at all is worse than one headed by a handle.
 */
function resolveAppLabel(one: AppLabelSource, whenUnknown: string): ResolvedAppLabel {
  const name = (one.appName ?? '').trim();
  const pkg = (one.package ?? '').trim();
  if (name.length > 0 && name !== pkg) return { label: name, isPackageFallback: false, isUnknown: false };
  if (pkg.length > 0) return { label: pkg, isPackageFallback: true, isUnknown: false };
  return { label: whenUnknown, isPackageFallback: false, isUnknown: true };
}

/**
 * The app, ready to drop into a sentence, with the handle marked when it is a handle.
 *
 * The clause is parenthetical rather than `notifyLabels.ts`'s em-dash form, and the difference is
 * deliberate: that one names a *tile* and stands alone, while these sit mid-sentence, where
 * "com.spotify.music — app name unavailable does not allow seeking" is unreadable. Same rule, same
 * words, punctuation that fits where it is used.
 */
function appPhrase(one: AppLabelSource, whenUnknown: string): string {
  const { label, isPackageFallback } = resolveAppLabel(one, whenUnknown);
  return isPackageFallback ? `${label} (app name unavailable)` : label;
}

/** The remote's now-playing line. */
function remoteNowPlayingNoteOf(state: AppLabelSource & { playing?: boolean }): string {
  return `${state.playing ? 'Playing' : 'Paused'} in ${appPhrase(state, 'an app')}.`;
}

/** The main process's refusal, sent to the pane as the reason nothing was sent. */
function remoteUnsupportedReasonOf(state: AppLabelSource, what: string): string {
  return `${appPhrase(state, 'That app')} does not allow ${what} from a remote, so nothing was sent.`;
}

/** The tooltip on a scrubber the session says cannot be seeked. */
function remoteSeekDisabledTitleOf(state: AppLabelSource): string {
  return `${appPhrase(state, 'This app')} does not allow seeking from a remote.`;
}

/** The tooltip and screen-reader clause on a disabled skip button. */
function remoteSkipTitleOf(state: AppLabelSource, what: string): string {
  return `${appPhrase(state, 'This app')} does not allow skipping to ${what} from a remote.`;
}

/**
 * **Every** string the remote puts in front of a person that names an app.
 *
 * The enumeration is the test surface, exactly as `notifyLabels.userVisibleStringsOf` is for the
 * notifications pane — and for the same reason. Defect 46 was found by running defect 28's rule
 * over a pane the 28 guard did not cover, and a guard that covers a *line* rather than a pane is
 * how the fourth site went uncounted. A sentence added to the remote later is covered the day it is
 * added, provided it comes from here.
 *
 * The two `what` values for skipping are enumerated rather than parameterised away because they are
 * the two the pane actually draws, and a guard over a function nobody calls with real arguments is
 * coverage on paper.
 */
function remoteUserVisibleStrings(state: AppLabelSource & { playing?: boolean }): string[] {
  return [
    remoteNowPlayingNoteOf(state),
    remoteSeekDisabledTitleOf(state),
    remoteSkipTitleOf(state, 'the next track'),
    remoteSkipTitleOf(state, 'the previous track'),
    remoteUnsupportedReasonOf(state, 'skipping to the next track'),
    remoteUnsupportedReasonOf(state, 'skipping to the previous track'),
    remoteUnsupportedReasonOf(state, 'seeking'),
  ];
}

// The same names on `globalThis`, for the reason `shared/activity.ts` and `shared/filesRoots.ts`
// carry this block: in the renderer these are already global, and under `node --test` this file is
// a CommonJS module whose declarations are module-scoped — so `RemoteView.render` would throw
// `remoteNowPlayingNoteOf is not defined` the moment a view test mounted the pane.
{
  const g = globalThis as Record<string, unknown>;
  g.resolveAppLabel = resolveAppLabel;
  g.appPhrase = appPhrase;
  g.remoteNowPlayingNoteOf = remoteNowPlayingNoteOf;
  g.remoteUnsupportedReasonOf = remoteUnsupportedReasonOf;
  g.remoteSeekDisabledTitleOf = remoteSeekDisabledTitleOf;
  g.remoteSkipTitleOf = remoteSkipTitleOf;
  g.remoteUserVisibleStrings = remoteUserVisibleStrings;
}

// Reachable from the pane (a plain script in one global scope), from the main process (`require`),
// and from `node --test` (the same `require`). `typeof` on an undeclared identifier is safe in JS,
// so this is a no-op in the browser.
if (typeof module !== 'undefined') {
  module.exports = {
    resolveAppLabel,
    appPhrase,
    remoteNowPlayingNoteOf,
    remoteUnsupportedReasonOf,
    remoteSeekDisabledTitleOf,
    remoteSkipTitleOf,
    remoteUserVisibleStrings,
  };
}
