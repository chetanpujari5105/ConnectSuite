/**
 * The float window's control strip — what is on it, in order, and nothing about how it is drawn.
 *
 * **The table has outlived one layout already** (defect 118: a right-edge vertical rail became a
 * bottom bar) and the file kept its name because the table is *the controls*, not *the rail*. That
 * it survived the move untouched except for one added field is the argument for it existing: the
 * layout changed in `float.css`, `float.html` and `shared/floatGeometry.ts`, and what each control
 * *is* did not change at all.
 *
 * ### Why the buttons moved, and what was actually wrong
 *
 * They were a **hover dock**: a pill at `bottom: 36px` over the picture, `opacity: 0` until the
 * pointer entered the window. The report said they *"sit at the top … where other app windows can
 * cover them"*. Measured on the running window before anything was changed, they were at **92% of the
 * way down**, not the top — so that half of the report does not describe this build. What does
 * describe it is the rest of the sentence, and it is three separate faults:
 *
 *  - **`opacity: 0` at rest.** A control nobody can see is a control nobody knows is there, and the
 *    float window is the one window in this app whose whole purpose is to be watched while something
 *    else has focus — which is exactly when the pointer is not in it.
 *  - **Over the picture.** The pill sat on a strip of the phone's own screen. `float.css` already
 *    warns that an invisible pill over a canvas that takes input is *"a silent dead zone"*; the
 *    canvas took input as of 2026-09-14 and the warning came true.
 *  - **On the phone's nav bar.** At 36px up a ratio-locked window it lands on Android's own gesture
 *    bar, so the Mac's Home button and the phone's Home sit on top of each other.
 *
 * So the strip is **always visible and part of the window's chrome** rather than drawn over the
 * picture. Anchored to the window frame, which is what "never behind unrelated content" can actually
 * mean for a window: no arrangement of other applications can cover part of a window without
 * covering that part of the picture too.
 *
 * It was a vertical rail on the right edge (`RAIL = 36`, a width) until **defect 118**, and is a
 * horizontal bar along the bottom now (`BOTTOM_BAR = 40`, a height) — the shape Android's own
 * navigation bar has, under the screen rather than beside it.
 *
 * ### Why this is a file
 *
 * An icon name that is not in an enumeration is an icon nobody can check — the empty-ring defect. The
 * main window's names live in `navModel.iconNamesUsedByTheShell()`; the float does not load
 * `navModel.js`, so its own table lives here and `floatRail.test.ts` asserts every name resolves
 * through the real `iconSvg`. A button added tomorrow is inside that check.
 *
 * Plain script, never an `export` — defect 94.
 */

/** One control on the strip. `global` is an `input.global` action; the others are Mac-side. */
interface FloatRailItem {
  id: string;
  /**
   * The accessible name — what a screen reader announces, and the full sentence where one is owed.
   *
   * It was also the tooltip until defect 118. The two split because the reveal control's accessible
   * name has to carry the whole promise (*"…without closing this one"*, defect 117, asserted by
   * test) and a tooltip that long sits over the picture for a second and a half. So [tooltip] is a
   * separate field **in this same table** — not a second copy in the HTML or the CSS, which is the
   * drift this file's header is about and which defect 97 is the worked example of.
   */
  label: string;
  /**
   * The short text the hover tooltip shows. Defaults to [label] where a short form would say the
   * same thing, so the common case cannot drift by having two literals at all.
   */
  tooltip?: string;
  icon: string;
  kind: 'global' | 'shot' | 'reveal';
  /** The `input.global` wire name, for `kind: 'global'` only. */
  action?: string;
  /** Whether the control is disabled when the phone is not advertising `input`. */
  needsInput: boolean;
}

/**
 * The strip, top to bottom.
 *
 * Back, Home and Recents in the order Android itself draws them, so muscle memory carries over.
 * Screenshot is a canvas readback on this Mac and needs nothing from the phone, which is why it is
 * the one action that stays live when input is off. Reveal is last and separated in the CSS: it is
 * about this Mac's windows and not about the phone at all.
 */
const FLOAT_RAIL: FloatRailItem[] = [
  { id: 'back', label: 'Back', icon: 'back', kind: 'global', action: 'back', needsInput: true },
  { id: 'home', label: 'Home', icon: 'home', kind: 'global', action: 'home', needsInput: true },
  { id: 'recents', label: 'Recents', icon: 'recents', kind: 'global', action: 'recents', needsInput: true },
  { id: 'shot', label: 'Save a screenshot of this window', tooltip: 'Screenshot', icon: 'capture', kind: 'shot', needsInput: false },
  {
    id: 'reveal',
    // Says what it does to *both* windows, because the fear this control has to answer is that it
    // closes the floating one. Defect 117.
    label: 'Show the ConnectSuite window without closing this one',
    tooltip: 'Show ConnectSuite',
    icon: 'overview',
    kind: 'reveal',
    needsInput: false,
  },
];

/**
 * What the tooltip says for a control — the short form where there is one, the accessible name
 * otherwise.
 *
 * A function rather than a field every row must fill, so a control added tomorrow gets a correct
 * tooltip by default instead of an empty one. The fallback is the *same string* the screen reader
 * hears, so there is nothing to keep in step.
 */
function floatRailTooltip(item: FloatRailItem): string {
  return item.tooltip ?? item.label;
}

/**
 * The index where the Mac-side controls begin — where the group separator is drawn.
 *
 * Computed from the table rather than inferred by a CSS selector, and that is not a style choice.
 * The first version was `.bar-button.bar-mac:first-of-type::before`, which **matched nothing**:
 * `:first-of-type` is about the element type, so it means *the first `button`* — which is Back, and
 * Back has no `bar-mac` class, so the compound selector never matched and the hairline never drew.
 * `tsc` was clean, every stylesheet test passed, and the rule was dead. That is the empty-ring icon
 * defect in CSS, and the reason this repo counts *construction* rather than *mention*.
 *
 * Returns -1 when there is no boundary, which is a real answer for a bar of one kind of control.
 */
function floatRailGroupStart(): number {
  return FLOAT_RAIL.findIndex((item) => item.kind !== 'global');
}

/** Every icon name the strip asks for — the enumeration `floatRail.test.ts` asserts over. */
function floatRailIconNames(): string[] {
  return FLOAT_RAIL.map((item) => item.icon);
}

// Plain-script globals for the page; module.exports for `node --test`. Never `export` — defect 94.
{
  const g = globalThis as unknown as Record<string, unknown>;
  g.FLOAT_RAIL = FLOAT_RAIL;
  g.floatRailIconNames = floatRailIconNames;
  g.floatRailTooltip = floatRailTooltip;
  g.floatRailGroupStart = floatRailGroupStart;
}
if (typeof module !== 'undefined') module.exports = { FLOAT_RAIL, floatRailIconNames, floatRailTooltip, floatRailGroupStart };
