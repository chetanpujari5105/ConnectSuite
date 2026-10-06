// Electron fuses for the packaged app — audit S5, defect 184. Dependency-free on purpose: electron-builder
// 25.1.8 has no `electronFuses` option and `@electron/fuses` is not installed, and installing a package was
// not approved. This reads and writes the fuse wire Electron compiles into its framework binary.
//
// ## The wire, read rather than assumed (2026-10-07)
//
// `dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX`, then one byte of wire version, one byte of length, then one ASCII byte
// per fuse: '1' enabled, '0' disabled, 'r' removed. Electron 43.4.1's arm64 framework, from the local cache:
// version 1, length 9, `101100011`. The index of each fuse is Electron's `FuseV1Options` order; the first
// nine are named below. A wire with another version, a shorter length, or a sentinel found zero or two times
// is REFUSED — a layout change must stop the build, never flip the wrong byte.
//
// ## What is flipped, and what is deliberately not
//
// | # | fuse | default | packaged | why |
// |---|---|---|---|---|
// | 0 | RunAsNode | on | **off** | `ELECTRON_RUN_AS_NODE=1` would run any script as this signed app |
// | 2 | EnableNodeOptionsEnvironmentVariable | on | **off** | `NODE_OPTIONS=--require …` injects code at start |
// | 3 | EnableNodeCliInspectArguments | on | **off** | `--inspect` opens a debugger on the main process |
// | 4 | EnableEmbeddedAsarIntegrityValidation | off | **on** | the archive must match the hash in Info.plist |
// | 5 | OnlyLoadAppFromAsar | off | **on** | no loose `app/` folder beside the archive is loaded instead |
// | 1 | EnableCookieEncryption | off | unchanged | encrypts cookies with a keychain key; this app keeps nothing in cookies, and turning it on is a keychain change to measure first |
// | 6 | LoadBrowserProcessSpecificV8Snapshot | off | unchanged | not used |
// | 7 | GrantFileProtocolExtraPrivileges | on | unchanged | every page is `file://`; turning it off needs the real app's pages proven first |
// | 8 | WasmTrapHandlers | on | unchanged | a performance feature, not a boundary |
//
// `--remote-debugging-port` is a Chromium switch no fuse covers; `src/main/releaseGuards.ts`, called from
// `entry.js`, refuses it in a packaged build before any app code runs.
import { readFileSync, writeFileSync } from 'node:fs';

export const SENTINEL = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX', 'ascii');

export const FUSE = Object.freeze({
  RunAsNode: 0,
  EnableCookieEncryption: 1,
  EnableNodeOptionsEnvironmentVariable: 2,
  EnableNodeCliInspectArguments: 3,
  EnableEmbeddedAsarIntegrityValidation: 4,
  OnlyLoadAppFromAsar: 5,
  LoadBrowserProcessSpecificV8Snapshot: 6,
  GrantFileProtocolExtraPrivileges: 7,
  WasmTrapHandlers: 8,
});

/** What the packaged app ships with. Only these indices are written; every other byte is left as built. */
export const RELEASE_FUSES = Object.freeze({
  [FUSE.RunAsNode]: false,
  [FUSE.EnableNodeOptionsEnvironmentVariable]: false,
  [FUSE.EnableNodeCliInspectArguments]: false,
  [FUSE.EnableEmbeddedAsarIntegrityValidation]: true,
  [FUSE.OnlyLoadAppFromAsar]: true,
});

/** Finds the wire in [binary]. Throws unless there is exactly one, at version 1, long enough for every named fuse. */
export function locateWire(binary) {
  const first = binary.indexOf(SENTINEL);
  if (first < 0) throw new Error('fuses: no fuse sentinel in this binary');
  if (binary.indexOf(SENTINEL, first + 1) >= 0) throw new Error('fuses: the fuse sentinel appears more than once');
  const at = first + SENTINEL.length;
  const version = binary[at];
  const length = binary[at + 1];
  if (version !== 1) throw new Error(`fuses: wire version ${version}, expected 1 — refusing to guess its layout`);
  if (length < Object.keys(FUSE).length) throw new Error(`fuses: wire length ${length} is shorter than the ${Object.keys(FUSE).length} fuses named here`);
  return { start: at + 2, length };
}

/** The wire as a string of '0'/'1'/'r', one character per fuse. */
export function readWire(binary) {
  const { start, length } = locateWire(binary);
  return binary.subarray(start, start + length).toString('ascii');
}

/**
 * Writes [wanted] (index → boolean) into a copy of [binary] and returns it. A fuse marked removed ('r') by
 * Electron cannot be set and throws; so does any byte that is not '0' or '1' before the write.
 */
export function withFuses(binary, wanted) {
  const out = Buffer.from(binary);
  const { start, length } = locateWire(out);
  for (const [key, on] of Object.entries(wanted)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= length) throw new Error(`fuses: index ${key} outside a wire of ${length}`);
    const current = String.fromCharCode(out[start + index]);
    if (current !== '0' && current !== '1') throw new Error(`fuses: fuse ${index} is '${current}' (removed or unknown) and cannot be set`);
    out[start + index] = (on ? '1' : '0').charCodeAt(0);
  }
  return out;
}

/** Applies [wanted] to the binary at [path] in place, then reads it back; throws unless every fuse took. */
export function applyFuses(path, wanted = RELEASE_FUSES) {
  const before = readWire(readFileSync(path));
  writeFileSync(path, withFuses(readFileSync(path), wanted));
  const after = readWire(readFileSync(path));
  for (const [key, on] of Object.entries(wanted)) {
    if (after[Number(key)] !== (on ? '1' : '0')) throw new Error(`fuses: fuse ${key} did not take (wire now ${after})`);
  }
  return { before, after };
}
