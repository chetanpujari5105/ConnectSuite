/**
 * What the ConnectSuite → Sidekick rename left behind on this Mac, and the copy-only compatibility
 * that reads it.
 *
 * ### Why there is anything to read
 *
 * The rename changed `package.json`'s `name` (and, packaged, `productName`), and Electron derives
 * `userData` from it. So an upgraded Mac has two folders side by side in `Application Support`:
 * the old one still holding the ConnectSuite settings, TLS identity, logs and Activity history, and
 * a new one that starts empty. Nothing here moves, renames or deletes anything in the old folder,
 * or anything in `~/Downloads/ConnectSuite`. Every function **reads** the old side; the only writes
 * are to the new Sidekick folder.
 *
 * ### What is deliberately not migrated
 *
 * - **The TLS identity.** The old `key.enc` is sealed by a Keychain item named for the old app, so
 *   reusing it means reading another app's Keychain secret. The phone must re-pair; this file only
 *   answers *whether an old identity exists*, so the refusal can say why.
 * - **The pairing record.** The phone pinned the old identity, so a copied `paired` would produce a
 *   failed connection where the honest next step is the pairing screen.
 * - **Logs.** Diagnostics tied to their date; the startup log names where the old ones are.
 *
 * No Electron import, so every function here is reachable from a file-level test.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { RENAME_REFUSAL } from '../shared/linkHealth';
import { parseActivityLine } from './activityLine';

/**
 * The folder names ConnectSuite builds used, beside the current `userData`: the development build
 * (`package.json` `name`) and the packaged build (`productName`). The first that exists wins.
 */
const LEGACY_USERDATA_NAMES = ['connectsuite-desktop', 'ConnectSuite'] as const;

/** The old settings store's file name — `electron-store`'s `name: 'connectsuite'`. */
const LEGACY_SETTINGS_FILE = 'connectsuite.json';
const SETTINGS_FILE = 'sidekick.json';

/** One file in the new folder records what has already been migrated. Written only on success. */
const MARKER_FILE = 'legacy-migration.json';

/**
 * The settings copied, each with the test a value must pass to be copied.
 *
 * Not copied: `paired` (see the header), and `lastAddress` / `lastDiscoveryVia`, which describe how
 * the old pairing last reached the phone and mean nothing without it.
 */
const SETTINGS_RULES: Record<string, (value: unknown) => boolean> = {
  appearance: (v) => v === 'system' || v === 'light' || v === 'dark',
  autoConnect: (v) => typeof v === 'boolean',
  watchClipboard: (v) => typeof v === 'boolean',
  notificationSound: (v) => typeof v === 'boolean',
  manualAddress: (v) => v === null || (typeof v === 'string' && v.trim().length > 0),
  tailscaleAddress: (v) => v === null || (typeof v === 'string' && v.trim().length > 0),
};

const MIGRATED_SETTINGS = Object.keys(SETTINGS_RULES);

interface Marker {
  settings?: { at: string; copied: string[] };
  activity?: { at: string; written: number };
  /**
   * Whether this Mac still owes the phone a re-pair because of the rename. Decided once; cleared
   * only by a completed connection on the Sidekick identity. `decidedAt` / `clearedAt` say when.
   */
  rePair?: { pending: boolean; decidedAt: string; clearedAt?: string };
}

/** The ConnectSuite `userData` folder beside this one, or `null` if none exists. */
export function legacyUserDataDir(userDataDir: string): string | null {
  const parent = dirname(userDataDir);
  for (const name of LEGACY_USERDATA_NAMES) {
    const candidate = join(parent, name);
    if (candidate !== userDataDir && existsSync(candidate)) return candidate;
  }
  return null;
}

/** Whether ConnectSuite left a TLS identity behind — the fact the rename-specific refusal needs. */
export function hasLegacyIdentity(legacyDir: string | null): boolean {
  return legacyDir !== null && existsSync(join(legacyDir, 'identity', 'cert.pem'));
}

/** The old logs folder, when it exists, for one startup line. */
export function legacyLogsDir(legacyDir: string | null): string | null {
  if (legacyDir === null) return null;
  const dir = join(legacyDir, 'logs');
  return existsSync(dir) ? dir : null;
}

/** `~/Downloads/ConnectSuite`, when it exists. Only ever revealed; never written to. */
export function legacyDownloadsFolder(home: string): string | null {
  const dir = join(home, 'Downloads', 'ConnectSuite');
  return existsSync(dir) ? dir : null;
}

function readMarker(dir: string): Marker {
  try {
    const raw = JSON.parse(readFileSync(join(dir, MARKER_FILE), 'utf8')) as unknown;
    return raw && typeof raw === 'object' ? (raw as Marker) : {};
  } catch {
    return {};
  }
}

function writeMarker(dir: string, update: Marker): void {
  writeAtomic(join(dir, MARKER_FILE), JSON.stringify({ ...readMarker(dir), ...update }, null, 2));
}

/** Write through a temporary file and a rename, so a crash never leaves a half-written file. */
function writeAtomic(path: string, text: string): void {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

function readJsonObject(path: string): Record<string, unknown> | 'absent' | 'malformed' {
  if (!existsSync(path)) return 'absent';
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : 'malformed';
  } catch {
    return 'malformed';
  }
}

export type SettingsMigration =
  | { outcome: 'already-done' }
  | { outcome: 'no-legacy' }
  | { outcome: 'failed'; reason: string }
  | { outcome: 'migrated'; copied: string[]; kept: string[]; rejected: string[] };

/**
 * Fill the Sidekick settings file's **missing** keys from the ConnectSuite one, once.
 *
 * Must run before `electron-store` opens `sidekick.json`: the store writes every default into the
 * file when it is constructed, after which every key "already has a value" and a fill-missing rule
 * would copy nothing ever.
 *
 * A key already present in `sidekick.json` is never touched. A value that fails its rule is left
 * out and named in `rejected`. The marker is written only after the file is written, so a failure
 * part-way is retried on the next launch — and because the rule is fill-missing, a retry cannot
 * overwrite anything the first attempt wrote.
 */
export function migrateLegacySettings(legacyDir: string | null, userDataDir: string): SettingsMigration {
  if (readMarker(userDataDir).settings) return { outcome: 'already-done' };
  if (legacyDir === null) return { outcome: 'no-legacy' };
  const old = readJsonObject(join(legacyDir, LEGACY_SETTINGS_FILE));
  if (old === 'absent') return { outcome: 'no-legacy' };
  if (old === 'malformed') return { outcome: 'failed', reason: `${LEGACY_SETTINGS_FILE} is not a JSON object` };

  const target = join(userDataDir, SETTINGS_FILE);
  const current = readJsonObject(target);
  // A malformed Sidekick file is not ours to repair: electron-store decides what to do with it.
  if (current === 'malformed') return { outcome: 'failed', reason: `${SETTINGS_FILE} is not a JSON object` };
  const next: Record<string, unknown> = current === 'absent' ? {} : { ...current };

  const copied: string[] = [];
  const kept: string[] = [];
  const rejected: string[] = [];
  for (const key of MIGRATED_SETTINGS) {
    if (!(key in old)) continue;
    if (key in next) {
      kept.push(key);
      continue;
    }
    if (!SETTINGS_RULES[key]!(old[key])) {
      rejected.push(key);
      continue;
    }
    next[key] = old[key];
    copied.push(key);
  }

  try {
    mkdirSync(userDataDir, { recursive: true });
    if (copied.length > 0) writeAtomic(target, JSON.stringify(next, null, '\t'));
    writeMarker(userDataDir, { settings: { at: new Date().toISOString(), copied } });
  } catch (error) {
    return { outcome: 'failed', reason: String(error) };
  }
  return { outcome: 'migrated', copied, kept, rejected };
}

export type ActivityMigration =
  | { outcome: 'already-done' }
  | { outcome: 'no-legacy' }
  | { outcome: 'failed'; reason: string }
  | {
      outcome: 'merged';
      legacyRead: number;
      legacyUnreadable: number;
      currentRead: number;
      currentUnreadable: number;
      duplicates: number;
      written: number;
    };

/** Two events are the same event when everything but their sequence number agrees. */
function identityOf(event: ActivityEvent): string {
  return `${event.at} ${event.category} ${event.kind} ${event.detail}`;
}

function readEvents(path: string): { events: ActivityEvent[]; unreadable: number } {
  if (!existsSync(path)) return { events: [], unreadable: 0 };
  const events: ActivityEvent[] = [];
  let unreadable = 0;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.trim().length === 0) continue;
    const event = parseActivityLine(line);
    if (event) events.push(event);
    else unreadable += 1;
  }
  return { events, unreadable };
}

/**
 * Merge ConnectSuite's Activity history into Sidekick's, once.
 *
 * The two files number their events independently — both start at `seq` 1 — and the pane keys rows
 * on `seq`, so a plain concatenation would put two rows under one key. The merge therefore drops
 * exact duplicates (same time, category, kind and detail), orders by time with ConnectSuite's events
 * ahead of Sidekick's on a tie, and renumbers from 1.
 *
 * The Sidekick file as it stood is kept beside the result as `activity.jsonl.pre-migration`, and the
 * ConnectSuite file is only read. Must run before the Activity store loads the file.
 */
export function mergeLegacyActivity(legacyDir: string | null, userDataDir: string): ActivityMigration {
  if (readMarker(userDataDir).activity) return { outcome: 'already-done' };
  if (legacyDir === null) return { outcome: 'no-legacy' };
  const legacyPath = join(legacyDir, 'logs', 'activity.jsonl');
  if (!existsSync(legacyPath)) return { outcome: 'no-legacy' };

  try {
    const legacy = readEvents(legacyPath);
    const currentPath = join(userDataDir, 'logs', 'activity.jsonl');
    const current = readEvents(currentPath);

    const seen = new Set<string>();
    const merged: ActivityEvent[] = [];
    let duplicates = 0;
    // Legacy first, so a stable sort keeps it ahead of Sidekick's events at an equal timestamp.
    for (const event of [...legacy.events, ...current.events]) {
      const id = identityOf(event);
      if (seen.has(id)) {
        duplicates += 1;
        continue;
      }
      seen.add(id);
      merged.push(event);
    }
    merged.sort((a, b) => a.at - b.at);
    const renumbered = merged.map((event, index) => ({ ...event, seq: index + 1 }));

    if (existsSync(currentPath) && !existsSync(`${currentPath}.pre-migration`)) {
      copyFileSync(currentPath, `${currentPath}.pre-migration`);
    }
    mkdirSync(dirname(currentPath), { recursive: true });
    writeAtomic(currentPath, renumbered.map((event) => JSON.stringify(event)).join('\n') + '\n');
    writeMarker(userDataDir, { activity: { at: new Date().toISOString(), written: renumbered.length } });
    return {
      outcome: 'merged',
      legacyRead: legacy.events.length,
      legacyUnreadable: legacy.unreadable,
      currentRead: current.events.length,
      currentUnreadable: current.unreadable,
      duplicates,
      written: renumbered.length,
    };
  } catch (error) {
    return { outcome: 'failed', reason: String(error) };
  }
}

/**
 * Decide, once, whether this Mac has to be re-paired because of the rename.
 *
 * Pending only when ConnectSuite left an identity **and** Sidekick holds no pairing yet. The old
 * identity folder alone is not the trigger: it stays on disk forever, so a Mac that has already
 * re-paired — or a Mac whose Sidekick pairing predates this build, as on the development machine —
 * would otherwise blame the rename for every later, unrelated refusal.
 *
 * Once decided, the stored answer wins on every later launch, whatever is on disk by then. It is
 * written only when it can be persisted; if it cannot, the in-memory answer is still returned.
 */
export function decideRePair(
  legacyDir: string | null,
  userDataDir: string,
  sidekickHasPairing: boolean,
): { pending: boolean; decided: 'stored' | 'now' } {
  const stored = readMarker(userDataDir).rePair;
  if (stored && typeof stored.pending === 'boolean') return { pending: stored.pending, decided: 'stored' };
  const pending = hasLegacyIdentity(legacyDir) && !sidekickHasPairing;
  try {
    mkdirSync(userDataDir, { recursive: true });
    writeMarker(userDataDir, { rePair: { pending, decidedAt: new Date().toISOString() } });
  } catch {
    // Unpersisted, the decision is re-taken next launch from the same facts — which is harmless,
    // because a successful connection in between changes `sidekickHasPairing` to true.
  }
  return { pending, decided: 'now' };
}

/**
 * The phone accepted the Sidekick identity: the rename is paid for. Returns whether anything
 * changed, so the caller tells the window only once.
 */
export function clearRePairPending(userDataDir: string): boolean {
  const stored = readMarker(userDataDir).rePair;
  if (!stored || stored.pending !== true) return false;
  writeMarker(userDataDir, {
    rePair: { ...stored, pending: false, clearedAt: new Date().toISOString() },
  });
  return true;
}

/** What the pairing screen says about the rename: the approved sentence while pending, else nothing. */
export function pairingRenameNotice(rePairPending: boolean): string | null {
  return rePairPending ? RENAME_REFUSAL : null;
}

export { MARKER_FILE, MIGRATED_SETTINGS };
