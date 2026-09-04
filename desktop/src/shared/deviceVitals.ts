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
  g.batteryRing = batteryRing;
  g.storageRing = storageRing;
  g.humanBytes = humanBytes;
}
if (typeof module !== 'undefined') {
  module.exports = {
    deviceStatusRings,
    batteryRing,
    storageRing,
    humanBytes,
    BATTERY_LOW_PERCENT,
    STORAGE_LOW_FRACTION,
  };
}
