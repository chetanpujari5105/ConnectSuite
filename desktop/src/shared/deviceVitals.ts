/**
 * The Overview pane's **Device status** card — O4.
 *
 * ### Why this ships two rings and not the design's three
 *
 * `ConnectSuite.dc.html` draws battery, storage **and memory**. There is no memory ring and there is
 * not going to be one: free RAM on Android is not a fact a person can act on, because the OS
 * deliberately fills it. *"1.2 GB free of 12 GB"* is alarming, meaningless, and looks exactly like
 * information — which is the decoration this project rules out everywhere else. Recorded as a
 * departure in `docs/design-departures.md` → O4 rather than left as an omission somebody fixes.
 *
 * ### Unknown is not empty, and empty is not zero
 *
 * Three states per ring, and they must be visibly distinct for the reason defect 85 exists: a phone
 * that has not reported yet, a phone that reported *"I cannot tell you"*, and a real reading of
 * zero. The first two both arrive as an absence, and the third looks like the second on any ring
 * drawn from a number alone.
 *
 * ### No `export` keyword, and that is load-bearing
 *
 * The renderer loads `src/shared/*.js` as plain `<script>` tags, so a CommonJS `exports.foo = …`
 * throws `ReferenceError: exports is not defined` on the first line and every function in the file
 * is undefined. That shipped once already — `clipPhoneState.ts`, with 484 tests green, because the
 * tests reach the module through `tsx`, a path the renderer never takes. Plain declarations, two
 * bindings at the bottom; `filesRoots.ts` is the same shape.
 */

/** What `battery.state` carries. `level` is null when the phone cannot report it. */
interface BatteryState {
  level: number | null;
  charging: boolean;
  capacityUnknown: boolean;
}

/** What `storage.state` carries. Either half may be null, and null is not zero. */
interface StorageState {
  freeBytes: number | null;
  totalBytes: number | null;
}

/** One ring, as the pane draws it. */
interface RingView {
  id: 'battery' | 'storage';
  label: string;
  /**
   * 0-1, or `null` when there is no arc to draw.
   *
   * **Null is a state, not a zero.** A ring drawn at 0 for an unknown value is a confident claim
   * that the battery is flat, which is the failure this card would otherwise repeat.
   */
  fraction: number | null;
  /** The number under the ring. Never a bare "0%" for something unknown. */
  value: string;
  /** The one-line sub-caption. Says which of the three states this is. */
  caption: string;
  tone: 'ok' | 'low' | 'unknown';
}

/** Bytes as a person would say them. Two significant figures is what fits under a ring. */
function humanBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/**
 * Below this, the battery ring reads `low`.
 *
 * A judgement, not a measurement — it is where the phone's own UI turns red. A constant so it has
 * one home rather than being a literal inside a comparison.
 */
const BATTERY_LOW_PERCENT = 20;

/** Below this fraction free, the storage ring reads `low`. */
const STORAGE_LOW_FRACTION = 0.1;

function batteryRing(state: BatteryState | null): RingView {
  // Never reported: the phone has not sent one yet, or does not send them at all.
  if (state === null) {
    return {
      id: 'battery',
      label: 'Battery',
      fraction: null,
      value: '—',
      caption: 'Waiting for the phone to report',
      tone: 'unknown',
    };
  }
  // Reported, and the answer was "I cannot tell you". A different sentence from the one above,
  // because one resolves on its own and the other never will.
  if (state.capacityUnknown || state.level === null) {
    return {
      id: 'battery',
      label: 'Battery',
      fraction: null,
      value: '—',
      caption: 'This phone does not report its level',
      tone: 'unknown',
    };
  }
  return {
    id: 'battery',
    label: 'Battery',
    fraction: state.level / 100,
    value: `${state.level}%`,
    caption: state.charging ? 'Charging' : 'On battery',
    // Charging at 5% is not a warning — it is the situation resolving itself.
    tone: state.level < BATTERY_LOW_PERCENT && !state.charging ? 'low' : 'ok',
  };
}

function storageRing(state: StorageState | null): RingView {
  if (state === null) {
    return {
      id: 'storage',
      label: 'Storage',
      fraction: null,
      value: '—',
      caption: 'Waiting for the phone to report',
      tone: 'unknown',
    };
  }
  const { freeBytes, totalBytes } = state;
  if (freeBytes === null || totalBytes === null || totalBytes <= 0) {
    return {
      id: 'storage',
      label: 'Storage',
      fraction: null,
      value: '—',
      caption: 'This phone did not report its storage',
      tone: 'unknown',
    };
  }
  return {
    id: 'storage',
    label: 'Storage',
    fraction: (totalBytes - freeBytes) / totalBytes,
    // The ring fills with what is USED and the number says what is FREE, which is the pair a person
    // actually wants. "88% used" over a ring 88% full is one fact twice.
    //
    // The word "free" is in the CAPTION, not here: the value sits inside a 72px ring, and
    // "13.7 GB free" overflowed it — seen in a screenshot, not in any test, because a DOM double
    // has no layout and every assertion about this string passed while it spilled over its arc.
    value: humanBytes(freeBytes),
    caption: `free of ${humanBytes(totalBytes)}`,
    tone: freeBytes / totalBytes < STORAGE_LOW_FRACTION ? 'low' : 'ok',
  };
}

/**
 * What the **chrome** says about the battery — the sidebar device card and the connected-device
 * strip, which is the O4 ring's fact in two much smaller boxes.
 *
 * **It was three boxes until 2026-09-16.** The Overview hero carried a Battery row too, which made
 * three copies of one percentage on one viewport; the row is gone (departure O11) and `detail`, the
 * labelled form that existed only for it, went with it. The remaining two surfaces are 40px mono
 * slots and both read `text`.
 *
 * ### Why this is here and not three expressions of the same idea in `shell.ts`
 *
 * The ring above already decides what each battery state means. A second decision in the shell
 * would be the same rule with a second home, which this project has a section about: the two
 * disagree eventually and the copy is the one that is wrong.
 *
 * ### Why `show` is false for a phone that cannot report
 *
 * The slot is removed rather than filled with a dash, and the original argument for that still
 * holds: a lone `—` between "Connected" and a divider is a glyph with no label, which a reader has
 * to decode instead of read. The ring has a caption and can say *"This phone does not report its
 * level"*; a 40px mono slot cannot. **The fact is not hidden** — it is on the O4 ring with its
 * caption, and in Settings → Advanced, where facts live.
 *
 * ### Why the link state is an argument
 *
 * **A percentage drawn while the link is down is a claim about now, made from a reading that may be
 * hours old.** That is defect 96 exactly — a stale value wearing the live surface's authority — and
 * the fix there was the same one as here: the chrome is the present tense, so it shows nothing
 * rather than something it cannot vouch for. History belongs to Activity.
 */
function batterySlot(state: BatteryState | null, live: boolean): {
  show: boolean;
  /** The 40px mono form, for the device card and the strip. The only form there is. */
  text: string;
  tone: 'ok' | 'low' | 'unknown';
} {
  const ring = batteryRing(state);
  if (!live || ring.fraction === null) {
    return { show: false, text: '', tone: ring.tone };
  }
  return { show: true, text: ring.value, tone: ring.tone };
}

/**
 * The Settings → Advanced line for `battery.state` — the surface with room to explain.
 *
 * ### Why this is not the slot's sentence
 *
 * The chrome removes itself when it has nothing to say, which is right for a 40px mono box and
 * useless here: *Advanced* is where somebody goes **because** the chrome is blank, so the one thing
 * this line may never do is go blank too. It has four answers where the slot has two, and the two
 * extra are the pair defect 85 exists for — *nothing has arrived* and *the phone says it cannot
 * tell you* are different facts and only one of them will ever resolve.
 *
 * ### Why the age is on the line
 *
 * A stationary battery reports about once an hour. A bare `46%` in a diagnostics pane is a number
 * with no denominator: it cannot be told from a reading taken at the start of the session, which is
 * the whole question a person reads this line to answer. `docs/protocol.md` gives `battery.state`
 * no timestamp, so this is the **arrival** time on this Mac and the wording says `received`, never
 * `measured` — the phone's own clock is not on the wire and must not be implied.
 *
 * It said `not subscribed on this build (battery.state is unhandled)` for a phase, which was a
 * true sentence about the build it was written for and a false one about every build since.
 */
function batteryDiagnostic(
  state: BatteryState | null,
  receivedAtMs: number | null,
  nowMs: number,
): string {
  if (state === null || receivedAtMs === null) return 'no battery.state received this session';
  const age = ageWords(nowMs - receivedAtMs);
  if (state.capacityUnknown || state.level === null) {
    // Not the same as silence, and the distinction is the reason this line is four-valued.
    return `the phone reports it cannot read its level · received ${age}`;
  }
  return `${state.level}% · ${state.charging ? 'charging' : 'on battery'} · received ${age}`;
}

/** Coarse on purpose: this line answers "is it current", not "when exactly". */
function ageWords(elapsedMs: number): string {
  // A clock that has gone backwards — a sleep, an NTP step — is not a negative age, it is an
  // unknown one. Saying "-4s ago" is the instrument reporting its own fault as a measurement.
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return 'at an unknown time';
  const seconds = Math.round(elapsedMs / 1000);
  if (seconds < 90) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

/** Both rings, in the order the design draws them. */
function deviceStatusRings(
  battery: BatteryState | null,
  storage: StorageState | null,
): RingView[] {
  return [batteryRing(battery), storageRing(storage)];
}

{
  const g = globalThis as Record<string, unknown>;
  g.deviceStatusRings = deviceStatusRings;
  g.batterySlot = batterySlot;
  g.batteryDiagnostic = batteryDiagnostic;
  g.batteryRing = batteryRing;
  g.storageRing = storageRing;
  g.humanBytes = humanBytes;
}
if (typeof module !== 'undefined') {
  module.exports = {
    deviceStatusRings,
    batterySlot,
    batteryDiagnostic,
    batteryRing,
    storageRing,
    humanBytes,
    BATTERY_LOW_PERCENT,
    STORAGE_LOW_FRACTION,
  };
}
