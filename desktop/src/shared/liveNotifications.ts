/**
 * The keys posted natively and not yet seen, **and the handle to each one's banner**, in one object.
 *
 * ### Why these two things are one object rather than two fields
 *
 * They were nearly two: a `Set<string>` for the badge and a `Map<string, Notification>` for
 * retention, side by side in {@link NativeNotifier}. Two containers holding the same lifetime is the
 * shape defect 67 is about — the invariant lives in the writes, the writes are in a class that needs
 * Electron, and no test can reach them. A key released from one and left in the other is a badge
 * that counts a banner nobody can click, or a banner retained forever for a key nobody holds, and
 * both are silent.
 *
 * So the lifetime has exactly one home. The badge is {@link size}; retention is the same map. There
 * is no way to fix one and forget the other, and this file has no import from `electron`, so the
 * whole decision surface is unit-testable.
 *
 * ### What the retention is for
 *
 * Electron's `Notification` delivers `click` through the instance. Nothing in the platform keeps
 * that instance alive: `const native = new Notification(…); native.show();` leaves it referenced by
 * nobody the moment the function returns, and a collected instance takes its listeners with it. The
 * banner stays on screen and the click goes nowhere — measured on 2026-09-04, a banner clicked
 * minutes after posting was lost and one clicked within a second was delivered.
 *
 * ### The residual, stated rather than hidden
 *
 * A handle is released when its key leaves — clicked, removed on the phone, or marked seen. A banner
 * still on screen at that moment stops being clickable, which is the same defect in a narrower
 * window. Holding it longer means holding it until macOS says it closed, and Electron's `close` is
 * not guaranteed to arrive on macOS, so that trade is a bounded silence against an unbounded leak on
 * an app meant to run all day. The bounded one is chosen deliberately; `NativeNotifier.onRemoved`
 * carries the note.
 */
export class LiveNotifications<T> {
  private readonly live = new Map<string, T>();

  /**
   * Hold `handle` under `key`.
   *
   * Returns the handle it replaced, or `null`. A second post under one key is an ordinary event —
   * messaging apps put one notification per conversation and update it — and only one handle can be
   * held per key, so the caller is handed the superseded one to close rather than left with a banner
   * on screen that nothing can deliver a click for.
   */
  retain(key: string, handle: T): T | null {
    const superseded = this.live.get(key) ?? null;
    this.live.set(key, handle);
    return superseded;
  }

  /** Release one key. Returns its handle, or `null` when nothing was held — which is a reading. */
  release(key: string): T | null {
    const handle = this.live.get(key);
    if (handle === undefined) return null;
    this.live.delete(key);
    return handle;
  }

  /** Release everything, returning what was held so the caller can act on each. */
  releaseAll(): T[] {
    const handles = [...this.live.values()];
    this.live.clear();
    return handles;
  }

  has(key: string): boolean {
    return this.live.has(key);
  }

  /** What the badge counts. One number, because there is one container. */
  get size(): number {
    return this.live.size;
  }
}
