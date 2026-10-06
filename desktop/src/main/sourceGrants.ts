import { basename, dirname } from 'node:path';

/**
 * Which local files `fs-send` may read — audit S4 follow-up, defect 183.
 *
 * ### Why this replaced a set of paths
 *
 * The first S4 build kept a plain set and let the main window's preload add to it (`fs-grant-source`)
 * whenever a file was dropped. A compromised main renderer with raw IPC could send any readable path
 * there and then call `fs-send`: measured through the production handlers on 2026-10-06, the synthetic
 * file was opened and hashed in full, and only the harness's missing phone stood between it and an
 * upload (`docs/evidence/s4-file-grant-2026-10-06/`). A narrow preload and a sender check were both
 * working; neither is a statement about *who chose the file*.
 *
 * So a grant is now created only by something the renderer cannot drive — a native open panel, or a
 * native confirmation sheet listing the exact paths of a drop — and it is bound to:
 *
 * - **the window that asked** (object identity), so a replaced or closed window's grants are dead;
 * - **the file's identity** (`dev`, `ino`) when it was chosen, so a different file later put at the same
 *   path is not the chosen one;
 * - **a lifetime** ([SOURCE_GRANT_TTL_MS]), checked when each send begins, so a choice made this
 *   morning does not still let a renderer read that file this evening.
 *
 * Electron-free: owners are opaque objects and the clock is injected.
 */

/** One hour from the choice to the start of its send. A batch item that starts later must be chosen again. */
export const SOURCE_GRANT_TTL_MS = 60 * 60 * 1_000;

export interface FileIdentity {
  dev: number;
  ino: number;
}

export type GrantRefusal = 'not-chosen' | 'other-window' | 'expired' | 'changed';

interface Grant {
  owner: object;
  identity: FileIdentity;
  issuedAt: number;
}

export class SourceGrants {
  private readonly grants = new Map<string, Grant>();

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly ttlMs = SOURCE_GRANT_TTL_MS,
    private readonly max = 2_000,
  ) {}

  /** The person chose [path] in [owner]'s native panel or confirmation sheet. */
  grant(path: string, owner: object, identity: FileIdentity): void {
    this.grants.delete(path);
    this.grants.set(path, { owner, identity: { dev: identity.dev, ino: identity.ino }, issuedAt: this.now() });
    while (this.grants.size > this.max) this.grants.delete(this.grants.keys().next().value as string);
  }

  /**
   * May [owner] read [path] now? [identity] is the file at that path **now** (null: it cannot be
   * stat'ed). An expired grant is removed; a grant from another window is left for its own window.
   */
  check(path: string, owner: object, identity: FileIdentity | null): { ok: true } | { ok: false; refusal: GrantRefusal } {
    const grant = this.grants.get(path);
    if (!grant) return { ok: false, refusal: 'not-chosen' };
    if (grant.owner !== owner) return { ok: false, refusal: 'other-window' };
    if (this.now() - grant.issuedAt > this.ttlMs) {
      this.grants.delete(path);
      return { ok: false, refusal: 'expired' };
    }
    if (!identity || identity.dev !== grant.identity.dev || identity.ino !== grant.identity.ino) {
      return { ok: false, refusal: 'changed' };
    }
    return { ok: true };
  }

  /** A window closed: nothing it chose may be read on its behalf again. */
  revokeOwner(owner: object): number {
    let removed = 0;
    for (const [path, grant] of this.grants) {
      if (grant.owner === owner) {
        this.grants.delete(path);
        removed += 1;
      }
    }
    return removed;
  }

  size(): number {
    return this.grants.size;
  }
}

/** The sentence a refused send returns to the pane. Never names the file's path. */
export function grantRefusalText(refusal: GrantRefusal): string {
  switch (refusal) {
    case 'not-chosen':
      return 'That file was not chosen here, so it was not sent.';
    case 'other-window':
      return 'That file was chosen in a window that has since closed — choose it again.';
    case 'expired':
      return 'That file was chosen more than an hour ago — choose it again to send it.';
    case 'changed':
      return 'That file changed or moved after it was chosen — choose it again to send it.';
  }
}

/** Most paths the drop confirmation lists one by one; above this it lists folders with counts. */
export const DROP_LIST_FILES_MAX = 12;
/** Most distinct folders one drop may come from. Above this the sheet cannot show where every file is from. */
export const DROP_FOLDERS_MAX = 12;

export type DropConfirmation =
  | { kind: 'ask'; message: string; detail: string }
  | { kind: 'refuse'; reason: string };

/**
 * The native sheet's text for a drop of [paths] (regular files only, already stat'ed).
 *
 * The sheet is the whole proof that a person chose these files, so it must show **where every one of
 * them is**: each path when there are few; every source folder with its count when there are many —
 * so one file from `~/.ssh` cannot hide as the thirteenth of a list. A drop from more folders than the
 * sheet can show is refused with a pointer to **Send to phone…**, which uses the open panel instead.
 */
export function dropConfirmation(paths: readonly string[], home: string | null): DropConfirmation {
  const shown = (p: string) => (home && (p === home || p.startsWith(`${home}/`)) ? `~${p.slice(home.length)}` : p);
  const n = paths.length;
  const message = n === 1 ? `Send “${basename(paths[0]!)}” to your phone?` : `Send these ${n} files to your phone?`;
  if (n <= DROP_LIST_FILES_MAX) {
    return { kind: 'ask', message, detail: paths.map(shown).join('\n') };
  }
  const folders = new Map<string, number>();
  for (const p of paths) folders.set(dirname(p), (folders.get(dirname(p)) ?? 0) + 1);
  if (folders.size > DROP_FOLDERS_MAX) {
    return {
      kind: 'refuse',
      reason: `Those ${n} files come from ${folders.size} folders — too many to show for confirmation. Use Send to phone… to choose them.`,
    };
  }
  const lines = [...folders].map(([folder, count]) => `${count} file${count === 1 ? '' : 's'} from ${shown(folder)}`);
  return { kind: 'ask', message, detail: lines.join('\n') };
}
