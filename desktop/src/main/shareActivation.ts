import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { SHARE_FILE, MAC_EXT } from '../shared/extensions';

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

/** What this Mac puts in `hello.ext`. Version 1 unless [activation] is active. */
export function advertisedExt(activation: ShareV2Activation): Readonly<Record<string, number>> {
  return activation.active ? Object.freeze({ ...MAC_EXT, [SHARE_FILE]: 2 }) : MAC_EXT;
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
