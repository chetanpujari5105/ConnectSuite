/**
 * The four controls a Settings pane is built out of.
 *
 * Module-free like the other renderer files.
 *
 * ### Why they are here and not in `renderer.ts`
 *
 * They were there, and `renderer.ts` is reachable by no test — it needs `connect`, `shell` and a
 * live DOM at module scope. That is the position three renderer-only defects have already shipped
 * from, and a fourth came out of Overview on this same day. Settings is now six panes and about
 * forty rows, and exactly one of those rows has behaviour rather than copy: {@link settingToggle},
 * which asks the system what actually happened and follows *that* rather than what it asked for.
 * A switch drawing its own intention is a check that does not gate, and it is silent when it is
 * wrong — the box says on, the login item is off, and nothing on screen disagrees.
 *
 * So the four move here together. Splitting them would leave `settingRow` alone in `renderer.ts`
 * with three callers in another file, which is the two-homes shape rather than a seam.
 *
 * ### What is deliberately still in `renderer.ts`
 *
 * The **panes**. Every one of them closes over `connect` and `shell`, and a Settings pane is copy
 * plus a call to one of these four — there is no decision in a pane worth reaching. What is worth
 * reaching is the control, and that is what came out.
 */

function settingRow(label: string, sub: string, control: HTMLElement): HTMLElement {
  const row = document.createElement('div');
  row.className = 'setting-row';
  const text = document.createElement('span');
  text.className = 'setting-row-text';
  const name = document.createElement('span');
  name.className = 'setting-label';
  name.textContent = label;
  const note = document.createElement('span');
  note.className = 'setting-sub';
  note.textContent = sub;
  text.append(name, note);
  const slot = document.createElement('span');
  slot.className = 'setting-control';
  slot.appendChild(control);
  row.append(text, slot);
  return row;
}


/**
 * A row whose control is a checkbox that reports the main process's answer rather than its own.
 *
 * `read` runs once at build time and `write` returns what the system says afterwards — the two are
 * separate because every toggle in this app that matters has a state somebody else owns, and a
 * checkbox drawing its own `checked` is a check that does not gate. If `write` comes back with a
 * different value, the box follows the system and `onDisagree` gets to say so.
 */
function settingToggle(
  label: string,
  sub: string,
  read: () => Promise<boolean>,
  write: (on: boolean) => Promise<boolean>,
  onDisagree?: (asked: boolean, actual: boolean) => void,
): HTMLElement {
  // The handoff's switch: a 42x24 track with an 18px knob. A `<button role="switch">` rather than a
  // styled checkbox, because the design's control has no box to draw and this shape carries the
  // state in `aria-checked` where a screen reader and `probe.mjs` can both read it.
  const track = document.createElement('button');
  track.type = 'button';
  track.className = 'switch';
  track.setAttribute('role', 'switch');
  track.setAttribute('aria-checked', 'false');
  track.setAttribute('aria-label', label);
  const knob = document.createElement('span');
  knob.className = 'switch-knob';
  knob.setAttribute('aria-hidden', 'true');
  track.appendChild(knob);

  const paint = (on: boolean) => {
    track.setAttribute('aria-checked', String(on));
    track.classList.toggle('is-on', on);
  };
  void read().then(paint);
  track.addEventListener('click', () => {
    const asked = track.getAttribute('aria-checked') !== 'true';
    // Painted optimistically and then corrected: the round trip is a few milliseconds and a switch
    // that waits for it feels broken. What it must not do is *stay* painted on an answer the system
    // did not give, which is the correction below.
    paint(asked);
    void write(asked).then((actual) => {
      paint(actual);
      if (actual !== asked) onDisagree?.(asked, actual);
    });
  });
  return settingRow(label, sub, track);
}

/**
 * A row for something the design draws and this build does not have, with **which kind** it is.
 *
 * The same two words the Mirror pane's limit rows use, and for the same reason: *"Android forbids
 * this"* and *"nobody has built it"* are different facts, and a person deciding whether to go
 * looking in Settings needs to know which one they are reading. A greyed control would say neither.
 */
function settingLimit(name: string, kind: 'wall' | 'unbuilt', why: string): HTMLElement {
  const tag = document.createElement('span');
  tag.className = `limit-tag ${kind}`;
  tag.textContent = kind === 'wall' ? 'Not possible' : 'Not yet';
  return settingRow(name, why, tag);
}

/** A right-aligned value, the design's own row shape for a fact with no control. */
function settingValue(label: string, sub: string, value: string): HTMLElement {
  const span = document.createElement('span');
  span.className = 'setting-value';
  span.textContent = value;
  return settingRow(label, sub, span);
}

/**
 * Settings → Connection → *Trusted device*: the sentence, from the same status the strip reads.
 *
 * **Why it is here, and why it is painted rather than built (2026-10-07).** Stage B of the supervised
 * verification forgot the legacy pairing and paired again with v2, and the open Connection pane kept
 * saying *"Paired before secure pairing — forget and pair again"* over a phone that had just been
 * verified. The sentence was chosen once, when the pane was built, from whatever `lastStatus` held then;
 * a Settings pane is rebuilt only on open and on a theme change, never on a pairing change. Re-opening
 * the tab redrew it — a workaround, not a fix. So the sentence has one writer, [paintTrustedDevice],
 * called from `render()` on every status and from the pane when it is built.
 *
 * Three states, because *unpaired* is its own fact: after Forget there is no certificate to remove, and
 * the old v2 sentence ("Removes the phone's certificate…") described a phone that was no longer there.
 */
function trustedDeviceSentence(status: { paired?: boolean; pairedLegacy?: boolean } | null): string {
  if (!status?.paired) return 'No phone is paired with this Mac. Pair one by scanning the code shown on the Overview.';
  if (status.pairedLegacy) {
    return 'Paired before secure pairing \u2014 forget and pair again to verify this phone. Forgetting removes its certificate; you will pair again from scratch.';
  }
  return 'Paired with secure pairing. Forgetting removes the phone\u2019s certificate from the trust store; you will pair again from scratch.';
}

/** The element currently showing [trustedDeviceSentence], if a Connection pane is built. */
let trustedDeviceNote: HTMLElement | null = null;
/** The last status seen, so a pane built between two statuses draws the current one. */
let trustedDeviceStatus: { paired?: boolean; pairedLegacy?: boolean } | null = null;

/** Called by `render()` on every status, and by the pane with its own note element when it is built. */
function paintTrustedDevice(status: { paired?: boolean; pairedLegacy?: boolean } | null, note?: HTMLElement): void {
  trustedDeviceStatus = status;
  if (note) trustedDeviceNote = note;
  if (trustedDeviceNote) trustedDeviceNote.textContent = trustedDeviceSentence(trustedDeviceStatus);
}

/** The Trusted device row: the Forget button, and a note [paintTrustedDevice] keeps current. */
function trustedDeviceRow(forget: HTMLElement, status: { paired?: boolean; pairedLegacy?: boolean } | null): HTMLElement {
  const row = settingRow('Trusted device', trustedDeviceSentence(status), forget);
  const note = row.querySelector('.setting-sub') as HTMLElement | null;
  if (note) paintTrustedDevice(status, note);
  return row;
}

// The seam: the four controls, for `settingsControls.test.ts`.
(globalThis as Record<string, unknown>).settingRow = settingRow;
(globalThis as Record<string, unknown>).settingToggle = settingToggle;
(globalThis as Record<string, unknown>).settingLimit = settingLimit;
(globalThis as Record<string, unknown>).settingValue = settingValue;
(globalThis as Record<string, unknown>).trustedDeviceSentence = trustedDeviceSentence;
(globalThis as Record<string, unknown>).paintTrustedDevice = paintTrustedDevice;
(globalThis as Record<string, unknown>).trustedDeviceRow = trustedDeviceRow;
