/**
 * A tooltip for text the layout has actually clipped — and for nothing else.
 *
 * ### The reading this is for
 *
 * `scripts/shell-parity-sweep.mjs` counted **203** native `title` attributes across the app, and
 * the useful number in that sweep is not the total: nine `activity-detail` tooltips carried a
 * string **identical to the element's own visible text**, 9 of 9. The intent was right — the class
 * is `text-overflow: ellipsis`, so a clipped detail needs somewhere to reveal the rest — but the
 * attribute was set on every row, including the ones that fit. A tooltip repeating what is already
 * on screen teaches a person that tooltips here say nothing, which costs the ones that do.
 *
 * ### Why this is a function and not two lines at the call site
 *
 * Because it is a decision about a *transition* — text becomes clipped when the column narrows and
 * un-clipped when it widens — and the half that goes wrong is the second one: a title set while
 * narrow and never cleared is a stale tooltip that outlives the clipping it described. So the
 * clear is unconditional and is what the test drives.
 *
 * ### What it does not claim
 *
 * `scrollWidth > clientWidth` is the browser's own answer and it is only available **after
 * layout** — the caller runs this once the node is in the document. In a DOM double both numbers
 * are whatever the test set, which is a hypothesis rather than a measurement, and the double says
 * so in its own header. The real count is a browser reading.
 *
 * Plain script, like `stateBlock.ts`: no `export`, the binding at the foot.
 */
function titleWhenClipped(el: HTMLElement, text: string): void {
  // Strictly greater: equal widths are a fitting string, and a sub-pixel rounding tie is not a
  // reason to show a tooltip that repeats the line under the pointer.
  if (el.scrollWidth > el.clientWidth) el.title = text;
  else el.removeAttribute('title');
}

{
  const g = globalThis as Record<string, unknown>;
  g.titleWhenClipped = titleWhenClipped;
}
