/**
 * Payload rules for IPC — audit S4 (`docs/phase-2-hardening-proposals.md` §S4).
 *
 * Every channel's arguments are checked against one of these before its handler runs, so a renderer
 * that is buggy or compromised cannot reach a feature with a payload of the wrong type, the wrong size
 * or an unknown field. Pure and main-process only (it is not a renderer script).
 *
 * A check returns `null` when the value passes and a short reason when it does not. Reasons name the
 * argument and the rule, never the value — the value may be somebody's message or phone number.
 */

export type Check = (value: unknown, at: string) => string | null;

/** The positional arguments a channel takes. Extra arguments are refused. */
export type ArgsSpec = readonly Check[];

export function str(o: { min?: number; max: number; pattern?: RegExp }): Check {
  return (v, at) => {
    if (typeof v !== 'string') return `${at} must be a string`;
    if (v.length < (o.min ?? 0)) return `${at} is too short`;
    if (v.length > o.max) return `${at} is longer than ${o.max}`;
    if (o.pattern && !o.pattern.test(v)) return `${at} has the wrong shape`;
    return null;
  };
}

export function num(o: { min: number; max: number; int?: boolean }): Check {
  return (v, at) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return `${at} must be a finite number`;
    if (o.int && !Number.isInteger(v)) return `${at} must be an integer`;
    if (v < o.min || v > o.max) return `${at} is out of range`;
    return null;
  };
}

export const bool: Check = (v, at) => (typeof v === 'boolean' ? null : `${at} must be true or false`);

export function oneOf(...values: readonly (string | number | boolean | null)[]): Check {
  return (v, at) => (values.includes(v as never) ? null : `${at} is not one of the allowed values`);
}

/** Absent (`undefined`) is allowed; anything present must pass [check]. */
export function opt(check: Check): Check {
  return (v, at) => (v === undefined ? null : check(v, at));
}

/** A plain object with exactly these keys (each checked; unknown keys refused). */
export function obj(shape: Record<string, Check>): Check {
  return (v, at) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return `${at} must be an object`;
    for (const key of Object.keys(v)) if (!(key in shape)) return `${at} has an unexpected field`;
    for (const [key, check] of Object.entries(shape)) {
      const bad = check((v as Record<string, unknown>)[key], `${at}.${key}`);
      if (bad) return bad;
    }
    return null;
  };
}

export function arr(item: Check, o: { min?: number; max: number }): Check {
  return (v, at) => {
    if (!Array.isArray(v)) return `${at} must be a list`;
    if (v.length < (o.min ?? 0)) return `${at} has too few items`;
    if (v.length > o.max) return `${at} has more than ${o.max} items`;
    for (let i = 0; i < v.length; i++) {
      const bad = item(v[i], `${at}[${i}]`);
      if (bad) return bad;
    }
    return null;
  };
}

/** Accepts one of several shapes. */
export function either(...checks: Check[]): Check {
  return (v, at) => (checks.some((c) => c(v, at) === null) ? null : `${at} has the wrong shape`);
}

/** No arguments at all. */
export const NONE: ArgsSpec = [];

/** The reason [args] fails [spec], or null. Too many arguments is a failure; missing ones are `undefined`. */
export function validateArgs(spec: ArgsSpec, args: readonly unknown[]): string | null {
  if (args.length > spec.length) return `takes at most ${spec.length} argument(s)`;
  for (let i = 0; i < spec.length; i++) {
    const bad = spec[i]!(args[i], `argument ${i + 1}`);
    if (bad) return bad;
  }
  return null;
}

// ---- shapes reused across channels ---------------------------------------------------------------

/** Identifiers the phone or this Mac minted: opaque, short, printable. */
export const id = str({ min: 1, max: 512 });
export const shortText = str({ max: 2_000 });
export const messageText = str({ max: 64 * 1024 });
export const localPath = str({ min: 1, max: 4_096 });
export const point = obj({ x: num({ min: -1e6, max: 1e6 }), y: num({ min: -1e6, max: 1e6 }) });
export const limit = opt(num({ min: 1, max: 5_000, int: true }));
export const epochMs = opt(num({ min: 0, max: 1e15 }));
