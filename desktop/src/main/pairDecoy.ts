import type { Candidate } from './discovery';

/**
 * H7's decoy: a development-only candidate the Mac tries **first while pairing is armed**, so an impostor
 * stand-in (`scripts/pair-decoy.mjs`) can answer before the real phone on real hardware. Loopback and a
 * fixed port, deliberately not configurable — the decoy is this Mac's own stand-in, never another
 * machine. Reached only through the `pairDecoyFirst` switch, which main.ts reads behind
 * `!app.isPackaged`. What it lets a run show: the Mac refuses a device that answers without proving the
 * pairing code, sends it nothing, and the real phone still pairs in the same attempt.
 */
export const PAIR_DECOY_HOST = '127.0.0.1';
export const PAIR_DECOY_PORT = 42611;

export async function* withPairDecoy(armed: () => boolean, rest: () => AsyncIterable<Candidate>): AsyncGenerator<Candidate> {
  if (armed()) yield { host: PAIR_DECOY_HOST, port: PAIR_DECOY_PORT, via: 'manual' };
  yield* rest();
}
