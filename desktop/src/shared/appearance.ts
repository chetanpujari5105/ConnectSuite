/*
 * The appearance preference, and the one rule that turns it into a drawn theme.
 *
 * ### Why this is a file rather than three lines in main.ts
 *
 * There are two inputs — what the user chose (`system` / `light` / `dark`) and what macOS is
 * currently doing — and exactly one output, the theme actually painted. That is a state machine
 * with an edge, and this repo's most expensive test failure (defect 67) was a state machine whose
 * *decision* had eleven passing tests while the *write* that fed it was wrong in a place no test
 * could reach. The fix there was to move the transition somewhere a JVM test could call it.
 *
 * So the rule lives here, in `shared/`, which is the electron-free layer: `resolveTheme` can be
 * called by a `node --test` file with no Electron, no window and no `nativeTheme`. Both the main
 * process and the renderer call *this*, rather than each expressing the rule again — the
 * "one home, or the two will disagree eventually" rule.
 *
 * ### Why `system` is not simply `prefers-color-scheme`
 *
 * It would work, and it would be a second writer. `tokens.css` is stamped via `data-theme`, and a
 * media query in the stylesheet would decide the same fact from a different source on a different
 * clock — the status-island defect (96) exactly, where a pill took its text from one place and its
 * tone from another and contradicted the strip beside it. One writer: main owns `nativeTheme`,
 * resolves it here, and tells the renderer what to stamp.
 */

/** What the user picked in Settings → General → Appearance. Persisted. */
type Appearance = 'system' | 'light' | 'dark';

/** What actually gets drawn. There is no third value; `system` is never a theme. */
type Theme = 'light' | 'dark';

const APPEARANCES: readonly Appearance[] = ['system', 'light', 'dark'];

/**
 * Resolve the preference against what the OS reports.
 *
 * `systemPrefersDark` is only consulted for `system`, which is the whole point of the other two:
 * choosing Light on a Mac in dark mode has to mean Light, not "light unless the OS disagrees".
 */
function resolveTheme(appearance: Appearance, systemPrefersDark: boolean): Theme {
  if (appearance === 'light') return 'light';
  if (appearance === 'dark') return 'dark';
  return systemPrefersDark ? 'dark' : 'light';
}

/**
 * Narrow an unknown persisted value to an `Appearance`.
 *
 * A store read can return anything — a hand-edited JSON file, a value written by a build that had
 * a fourth option, `undefined` on first run. The default is `system`, because an app that follows
 * the Mac it is running on is the right first-run behaviour and it is what the OS itself does.
 */
function asAppearance(value: unknown): Appearance {
  return APPEARANCES.includes(value as Appearance) ? (value as Appearance) : 'system';
}

/**
 * The window ground, as a hex string, for a resolved theme.
 *
 * This exists because `BrowserWindow`'s `backgroundColor` is painted **before any stylesheet
 * loads**, so it cannot read `--canvas` and cannot be themed by CSS. It is the flash you see for
 * one frame on launch and on every resize past the rendered area — and with a hardcoded `#07070a`
 * it was a black flash in front of a light app. The two values here are `--canvas` in each theme
 * and they have to be kept in step with `tokens.css` by hand; `check-color-tokens.mjs` asserts
 * that they are, because "keep these in step" is otherwise a rule enforced by someone remembering.
 */
const WINDOW_GROUND: Record<Theme, string> = { dark: '#0a0a0a', light: '#f4f4f7' };

/** The float window's ground — `--float-canvas`, same argument as above. */
const FLOAT_GROUND: Record<Theme, string> = { dark: '#0a0a0a', light: '#f4f4f8' };

if (typeof globalThis !== 'undefined') {
  const g = globalThis as Record<string, unknown>;
  g.resolveTheme = resolveTheme;
  g.asAppearance = asAppearance;
  g.APPEARANCES = APPEARANCES;
  g.WINDOW_GROUND = WINDOW_GROUND;
  g.FLOAT_GROUND = FLOAT_GROUND;
}

if (typeof module !== 'undefined') {
  module.exports = { resolveTheme, asAppearance, APPEARANCES, WINDOW_GROUND, FLOAT_GROUND };
}
