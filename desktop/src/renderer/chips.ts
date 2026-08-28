/**
 * The sentence a capability chip says out loud.
 *
 * Split out of renderer.ts so it can be tested. Like every file under renderer/, it is a plain
 * script rather than a module — index.html loads it with its own <script> tag and the CSP-locked
 * page has no module loader — so it declares a global instead of exporting one, and the shim at
 * the bottom is what makes it reachable from `node --test`. `module` is undefined in the browser,
 * so the shim is skipped there.
 *
 * Why the label exists at all: the chip used to be a name and a background colour, and the colour
 * carried the entire on/off distinction (defect 26). A screen reader read out twelve capability
 * names with no indication which were available. This is the text that fixes that, and — once the
 * phone started sending its reasons (defect 24) — it carries the reason too.
 */
function chipLabel(capability: string, available: boolean, reason?: string): string {
  if (available) return `${capability}: available`;
  // The reason is optional on the wire, so a phone that does not send one still gets a chip that
  // states the fact. "unavailable" alone is worse than "unavailable, missing SMS" and far better
  // than a colour.
  return reason ? `${capability}: unavailable, ${reason}` : `${capability}: unavailable`;
}

// `typeof` on an undeclared identifier is safe in JS, so this is a no-op in the browser where
// there is no `module`, and the export under `node --test`. @types/node already declares it.
if (typeof module !== 'undefined') module.exports = { chipLabel };
