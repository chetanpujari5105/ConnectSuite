/**
 * `ext` on `hello` / `hello.ack` — docs/protocol.md → Extensions, rules 1–4. The phone's
 * `Extensions.kt` implements the same rules, and both are tested against one fixture,
 * `docs/fixtures/ext-negotiation.json`, so the two parsers cannot drift apart unnoticed.
 */

export const SHARE_FILE = 'share.file';

/** What this Mac build implements: it can receive and answer a one-file share offer, version 1. */
export const MAC_EXT: Readonly<Record<string, number>> = Object.freeze({ [SHARE_FILE]: 1 });

/** Rules 1–3: anything but a plain object is `{}`; a value that is not an integer ≥ 1 drops that key only. */
export function parseExt(raw: unknown): Record<string, number> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 2_147_483_647) {
      out[key] = value;
    }
  }
  return out;
}

/** Rule 4: negotiated only when both sides advertise it, at the lower version; otherwise null. */
export function negotiate(
  mine: Readonly<Record<string, number>>,
  theirs: Readonly<Record<string, number>>,
  name: string,
): number | null {
  const a = mine[name];
  const b = theirs[name];
  if (a === undefined || b === undefined) return null;
  return Math.min(a, b);
}

/** Every extension both sides advertised, at its negotiated version. */
export function negotiateAll(
  mine: Readonly<Record<string, number>>,
  theirs: Readonly<Record<string, number>>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of Object.keys(mine)) {
    const v = negotiate(mine, theirs, name);
    if (v !== null) out[name] = v;
  }
  return out;
}
