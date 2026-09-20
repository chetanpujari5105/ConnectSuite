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

/**
 * A tooltip that says something the element does not already say — and nothing otherwise.
 *
 * The sibling rule, and a genuinely different one: above, a title equal to the element's text is
 * exactly right, because the text is *visually* clipped and `textContent` still holds all of it.
 * Here nothing is clipped and the two strings are simply the same, which is a tooltip that teaches
 * a person tooltips here say nothing.
 *
 * Found by the shell sweep's by-kind breakdown rather than by looking: Overview's `recent-when`
 * shows `activityClock` and its tooltip shows `activityWhen`, and **past an hour `activityWhen`
 * returns `activityClock`** — so a row older than an hour has a tooltip repeating itself, and a
 * newer one does not. 2 of 4 on screen. A count of 194 tooltips would never have shown it; a
 * column counting the ones that duplicate their own text showed it immediately.
 */
function titleIfItAdds(el: HTMLElement, text: string): void {
  const own = (el.textContent ?? '').trim();
  if (text.trim() && text.trim() !== own) el.title = text;
  else el.removeAttribute('title');
}

{
  const g = globalThis as Record<string, unknown>;
  g.titleWhenClipped = titleWhenClipped;
  g.titleIfItAdds = titleIfItAdds;
}
