/**
 * The capability chip: what it is called, and the sentence it says out loud.
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

/**
 * The wire's capability id → what a person reads.
 *
 * **The chips showed the raw ids until 2026-09-16 — departure O13.** `mirror`, `sms`, `mic`,
 * lowercase, in a sentence-case interface. That is `CLAUDE.md`'s package-id rule in a second
 * namespace: *a handle may appear as a handle, never as the only thing a user reads*. `sms` and
 * `mic` are the two that make it plain — one is an initialism that should be capitalised and the
 * other is an abbreviation nobody says out loud.
 *
 * **The handle is not hidden**, it is moved: every chip carries `title="<label> — capability id:
 * <id>"`, so somebody grepping `docs/protocol.md` or `CapabilityContract.kt` can still get from the
 * screen to the wire. Same treatment as defect 28's notification rows, which set the fallback in
 * the mono face with a `package id` chip beside it.
 *
 * A capability with no entry here falls back to **its own id**, deliberately and without a warning
 * shape around it: that is the honest answer for a name this Mac has not met, and it is exactly
 * what `AppLabels.of` does for a package with no launcher icon. The fallback is correct and must
 * not be "fixed" — what matters is that it comes through this function, so a new capability appears
 * as a readable gap rather than as a silently-wrong word.
 */
const CAPABILITY_LABELS: Record<string, string> = {
  mirror: 'Mirror',
  input: 'Input',
  notifications: 'Notifications',
  sms: 'SMS',
  calls: 'Calls',
  contacts: 'Contacts',
  files: 'Files',
  photos: 'Photos',
  clipboard: 'Clipboard',
  remote: 'Media remote',
  apps: 'Apps',
  mic: 'Microphone',
};

function capabilityLabel(capability: string): string {
  return CAPABILITY_LABELS[capability] ?? capability;
}

/**
 * The tail of the sentence — everything after the name.
 *
 * It exists so the renderer does not have to slice the name off the front of [chipLabel], which it
 * did by `label.slice(capability.length)`. That worked only while the visible text and the label's
 * prefix were the same string, and the moment the visible text became a *readable* name the slice
 * would have cut the wrong number of characters and silently eaten part of the state. One function
 * per part, and neither caller does arithmetic on the other's output.
 */
function chipTail(available: boolean, reason?: string): string {
  if (available) return ': available';
  // The reason is optional on the wire, so a phone that does not send one still gets a chip that
  // states the fact. "unavailable" alone is worse than "unavailable, missing SMS" and far better
  // than a colour.
  return reason ? `: unavailable, ${reason}` : ': unavailable';
}

/** The whole sentence, name included. The chip's accessible name is this, assembled from two nodes. */
function chipLabel(capability: string, available: boolean, reason?: string): string {
  return `${capabilityLabel(capability)}${chipTail(available, reason)}`;
}

// `typeof` on an undeclared identifier is safe in JS, so this is a no-op in the browser where
// there is no `module`, and the export under `node --test`. @types/node already declares it.
if (typeof module !== 'undefined') {
  module.exports = { chipLabel, chipTail, capabilityLabel, CAPABILITY_LABELS };
}
