/**
 * The "Floating window" toolbar button's two states. Handoff §2.
 *
 * > States: **"Floating window"** by default → after opening, **"Show floating window"** with a
 * > 6px `#32E58A` dot before the label, which only refocuses the existing window. **Never create a
 * > second instance.** On close it reverts to "Floating window" and mirroring continues.
 *
 * **The second state closes rather than focuses, from 2026-09-14, and that is a departure from the
 * handoff above.** Owner's decision, on the plainest possible grounds: a control whose second press
 * does not undo its first is not a toggle, and every user of this button pressed it again expecting
 * the window to go away. It also leaked an open float across two diagnostic runs in Slice 43,
 * because "close it again" was the obvious cleanup and did nothing.
 *
 * What is lost, said rather than glossed: **the refocus affordance**. A float hidden behind other
 * windows is now raised by clicking it or via the dock, not from here. That is the trade the owner
 * accepted; if it bites, the third state — focus when open-and-unfocused, close when open-and-focused
 * — is the repair, and it is a hidden mode, which is why it was not the first move.
 *
 * Three strings and a boolean, pulled out of `renderer.ts` for the same reason `notifyLabels.ts`
 * was pulled out of `notifications.ts`: it is a rule with a wrong answer, and a rule with a wrong
 * answer wants a test rather than a reading. The wrong answer here is specific and easy to ship —
 * a button that still says "Floating window" while a floating window is open reads as broken,
 * because pressing it appears to do nothing. That is the silent-no-op shape this project keeps
 * finding, one layer up from the code that usually causes it.
 *
 * Note what is *not* here: the never-a-second-instance rule. That is enforced in
 * `main/float.ts:openFloat`, because a button is not the only thing that can ask for the window —
 * a keyboard shortcut, a tray item, and a second click while the window is still loading all
 * arrive at the same method, and only that method knows whether a window exists. A guard in the
 * button would be a guard three callers can walk past.
 *
 * Plain script, like the rest of the renderer: the CSP-locked page has no module loader, so the
 * `module.exports` shim at the foot is what `node --test` reaches.
 */

interface FloatButtonLabels {
  /** What the button says. */
  label: string;
  /** The accessible name and the tooltip, which must agree with the label and with each other. */
  description: string;
  /** Whether the 6px green dot is drawn before the label. */
  dot: boolean;
}

/**
 * The button's presentation for a given window state.
 *
 * `description` is returned rather than derived at the call site so the `aria-label` and the
 * `title` cannot drift from the visible label — defect 26 is what a control whose accessible name
 * says something different from its face costs, and the cheapest fix is for one function to own
 * all three.
 */
function floatButtonLabelsFor(open: boolean): FloatButtonLabels {
  return open
    ? {
        label: 'Close floating window',
        description: 'Close the floating mirror window',
        dot: true,
      }
    : {
        label: 'Floating window',
        description: 'Open mirror in floating window',
        dot: false,
      };
}

// Reachable from renderer.ts (plain scripts, one global scope) and from `node --test` (the shim).
if (typeof module !== 'undefined') {
  module.exports = { floatButtonLabelsFor };
}
