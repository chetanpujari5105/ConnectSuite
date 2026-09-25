import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { SHARE_ASK, SHARE_FILE, MAC_EXT } from '../shared/extensions';

/**
 * **Whether this Mac may advertise `share.file: 2`, decided in one place and failing closed.**
 *
 * Version 2 moves real bytes onto this Mac's disk. Until the synthetic end-to-end run (Feature A
 * slice 3e) has passed, the only permitted version-2 session is a **development** one that can
 * receive nothing but allow-listed synthetic probe bytes, into nothing but the app-private scratch
 * folder. So activation needs every one of these at once, and any one missing leaves the Mac at
 * version 1, where no offer can be accepted and no pull can be authorised:
 *
 * | Condition | Why |
 * |---|---|
 * | not a packaged build | a shipped app never has a development path to version 2 |
 * | `shareV2` switch | the explicit request; nothing else implies it |
 * | `shareAcceptProbe` switch **and** at least one allow-listed digest | synthetic-only mode: an ordinary offer is declined, never held |
 * | `shareDevReceive` switch | the destination is the scratch folder, never the configured one |
 *
 * Nothing here turns version 2 on. It is the gate a later, approved run passes through; every run
 * without all four switches — every run so far — advertises version 1 exactly as before.
 */
export interface ShareV2Inputs {
  packaged: boolean;
  shareV2: boolean;
  shareAcceptProbe: boolean;
  acceptProbeDigests: number;
  shareDevReceive: boolean;
}

export type ShareV2Activation =
  | { active: true; syntheticOnly: true; scratchOnly: true }
  | { active: false; why: string };

export function shareV2Activation(i: ShareV2Inputs): ShareV2Activation {
  if (i.packaged) return { active: false, why: 'a packaged build never advertises share.file 2' };
  if (!i.shareV2) return { active: false, why: 'shareV2 is off (the default)' };
  const missing: string[] = [];
  if (!i.shareAcceptProbe) missing.push('shareAcceptProbe');
  if (i.acceptProbeDigests < 1) missing.push('an allow-listed digest (CONNECTSUITE_SHARE_ACCEPT_SHA256)');
  if (!i.shareDevReceive) missing.push('shareDevReceive');
  if (missing.length > 0) {
    return { active: false, why: `shareV2 asked for without ${missing.join(', ')} — refused, staying at share.file 1` };
  }
  return { active: true, syntheticOnly: true, scratchOnly: true };
}

/**
 * **The two facts production sharing waits on, as this build records them.** Each is a statement
 * about evidence that exists outside the code, so each flips only in the commit that records that
 * evidence — and `shareActivation.test.ts` pins both, so flipping one is a visible, reviewed change
 * rather than a default someone edits in passing.
 *
 * - `syntheticRunPassed` — Feature A slice 3e (`docs/phase-7-share-3e-runbook.md`) has moved synthetic
 *   bytes from the SM-S938B into the scratch folder, verified, on hardware. **Not run.**
 * - `receiveFolderCleanupScoped` — the ownership ledger's sweep can be scoped to the person's receive
 *   folder by the folder identity each entry proves (runbook §11). **Built (`byRecordedParent`, with
 *   `shareLedgerParent.test.ts`), not yet reviewed against this gate**, so still false. Without it, a
 *   production transfer would leave partials in the person's folder that no sweep may delete.
 */
export const SHARE_PRODUCTION_READINESS: Readonly<{ syntheticRunPassed: boolean; receiveFolderCleanupScoped: boolean }> =
  Object.freeze({ syntheticRunPassed: false, receiveFolderCleanupScoped: false });

export interface ShareAskInputs {
  /** The development activation above. Open means synthetic-only, and the two never coexist. */
  development: ShareV2Activation;
  readiness: { syntheticRunPassed: boolean; receiveFolderCleanupScoped: boolean };
}

export type ShareAskActivation =
  | { active: true; syntheticOnly: false }
  | { active: false; blockers: string[] };

/**
 * **Whether this Mac may promise `share.ask`** — hold every ordinary version-2 offer for a person's
 * Accept, into the configured receive folder. Fails closed and names every blocker, not the first:
 * a reader deciding what is left needs the whole list. Closed whenever the development gate is open,
 * because that gate's promise is the opposite one (decline everything ordinary). There is no switch
 * that forces it open; the only inputs are the readiness facts.
 */
export function shareAskActivation(i: ShareAskInputs): ShareAskActivation {
  const blockers: string[] = [];
  if (i.development.active) blockers.push('the synthetic-only development gate is open, and its promise is the opposite one');
  if (!i.readiness.syntheticRunPassed) blockers.push('the synthetic end-to-end run (slice 3e) has not passed on hardware');
  if (!i.readiness.receiveFolderCleanupScoped) {
    blockers.push('receive-folder cleanup scoping (runbook §11) is not yet recorded as reviewed');
  }
  return blockers.length === 0 ? { active: true, syntheticOnly: false } : { active: false, blockers };
}

/**
 * What this Mac puts in `hello.ext`. Version 1 unless one of the two gates is open: the development
 * gate adds `share.file: 2` alone (synthetic-only — **never** `share.ask`), and the production gate adds
 * `share.file: 2` with `share.ask: 1`. `shareAskActivation` cannot be open while the development gate
 * is, so the two additions never meet.
 */
export function advertisedExt(
  activation: ShareV2Activation,
  ask: ShareAskActivation = { active: false, blockers: ['not evaluated'] },
): Readonly<Record<string, number>> {
  if (ask.active && !activation.active) return Object.freeze({ ...MAC_EXT, [SHARE_FILE]: 2, [SHARE_ASK]: 1 });
  return activation.active ? Object.freeze({ ...MAC_EXT, [SHARE_FILE]: 2 }) : MAC_EXT;
}

/**
 * **How the receiver behaves, decided in one place from the two gates** — and the only route by which
 * the development allowlist reaches it.
 *
 * - development gate open → version 2, synthetic-only, and the tester's allowlist (auto-accept of an
 *   allow-listed synthetic probe, and nothing else);
 * - `share.ask` open → version 2, **Ask for every offer, and an empty allowlist** whatever the
 *   environment says: in production nothing is accepted without a person's click;
 * - neither → version 1, empty allowlist.
 *
 * The `packaged` guard alone did not give this: a development build run with `shareAcceptProbe` and
 * digests but without `shareV2` has the development gate closed, so with `share.ask` open the receiver
 * would have held offers for a person **and** auto-accepted any allow-listed probe. Found in the
 * production-readiness review, 2026-09-25, before `share.ask` was ever opened.
 */
export interface ReceiverMode {
  version2: { allowed: boolean; syntheticOnly: boolean };
  acceptProbeDigests: ReadonlySet<string>;
}

export function receiverMode(dev: ShareV2Activation, ask: ShareAskActivation, digests: ReadonlySet<string>): ReceiverMode {
  if (dev.active) return { version2: { allowed: true, syntheticOnly: true }, acceptProbeDigests: digests };
  if (ask.active) return { version2: { allowed: true, syntheticOnly: false }, acceptProbeDigests: new Set() };
  return { version2: { allowed: false, syntheticOnly: true }, acceptProbeDigests: new Set() };
}

export const SCRATCH_FOLDER_NAME = 'dev-share-receive';

/** The one development destination: `<userData>/dev-share-receive`, and no other path. */
export function scratchFolderPath(userData: string): string {
  return join(userData, SCRATCH_FOLDER_NAME);
}

export type ScratchFolder = { ok: true; folder: string } | { ok: false; reason: string };

/**
 * Resolves the scratch folder, and proves it is what its name says: a real directory (not a
 * symlink) whose real path is `<real userData>/dev-share-receive`. Creates it **only** when
 * [create] is true and it is absent — which `main.ts` asks for at the first version-2 offer and never
 * before, so a run that is not a version-2 development session never creates it.
 */
export async function resolveScratchFolder(userData: string, create: boolean): Promise<ScratchFolder> {
  const folder = scratchFolderPath(userData);
  const realUserData = await fsp.realpath(userData).catch(() => null);
  if (realUserData === null) return { ok: false, reason: 'the app data folder is not readable' };
  let st = await fsp.lstat(folder).catch(() => null);
  if (st === null) {
    if (!create) return { ok: false, reason: 'the scratch folder does not exist yet' };
    try {
      // Not recursive: the app data folder must already exist, and nothing above it is created.
      await fsp.mkdir(folder, { mode: 0o700 });
    } catch (error) {
      return { ok: false, reason: `the scratch folder could not be created (${(error as NodeJS.ErrnoException).code ?? 'error'})` };
    }
    st = await fsp.lstat(folder).catch(() => null);
  }
  if (st === null || st.isSymbolicLink() || !st.isDirectory()) {
    return { ok: false, reason: 'the scratch path is not a real folder (a link or a file); it was left alone' };
  }
  const real = await fsp.realpath(folder).catch(() => null);
  if (real !== join(realUserData, SCRATCH_FOLDER_NAME)) {
    return { ok: false, reason: 'the scratch folder does not resolve inside the app data folder' };
  }
  return { ok: true, folder };
}
