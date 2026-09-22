import { app, protocol } from 'electron';
import { randomBytes } from 'node:crypto';
import { createReadStream, promises as fsp, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { parseByteRange } from '../shared/byteRange';
import { log } from './logger';

/**
 * Full-size photos and videos **for viewing**, kept apart from files the person saved.
 *
 * ### Why a cache, and why not the receive folder
 *
 * The Photos pane's preview used to be the grid's 256 px thumbnail stretched into a 320 px well
 * (Feature C, 2026-09-23). The real bytes come from `media.original`, and until now that verb only
 * ever wrote into the person's receive folder — a *save*. Looking at a photo is not saving it, and
 * filling `~/Downloads/Sidekick` with every photo someone clicked would be the app deciding what
 * they keep. So originals fetched for viewing land here, in the OS temp directory, and **Save to
 * Mac** stays the one action that puts a file in the receive folder.
 *
 * ### What lives here, and for how long
 *
 * These are private photos on disk, so the lifetime is as short as the feature allows: the folder
 * is emptied when the app starts, when the link to the phone drops, and when the app quits, and at
 * most [KEEP] originals are held at once (oldest removed first). Nothing here is logged beyond a
 * count and a byte total — no names.
 *
 * ### How the page reaches them: `sidekick-media://`
 *
 * The renderer's CSP allows `data:` images and nothing from disk, and it should stay that way. The
 * narrow opening is one privileged scheme whose URLs carry **an opaque random token**, never a path:
 * the handler looks the token up in [served] and refuses anything else with 404. A page that could
 * name a path could read any file this user can; a page that can only name a token this module
 * minted can read exactly the files this module put here.
 *
 * It answers `Range` requests (`shared/byteRange.ts`) — a `<video>` seeks by asking for bytes, and a
 * handler that answered 200 with the whole file every time would play but never seek.
 */
const SCHEME = 'sidekick-media';
const KEEP = 12;

interface Served {
  path: string;
  mime: string;
  bytes: number;
  at: number;
}

const served = new Map<string, Served>();
/** media id → token, so the same photo selected twice is not fetched twice. */
const byMediaId = new Map<string, { token: string; name: string }>();

export function previewDir(): string {
  return join(app.getPath('temp'), 'sidekick-preview');
}

/** Must run before `app.whenReady` — Chromium fixes its scheme table at startup. */
export function registerPreviewScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
  ]);
}

/** After ready: empty whatever an earlier run left, then start answering. */
export function servePreviews(): void {
  clearPreviews('app start');
  protocol.handle(SCHEME, async (request) => {
    const token = new URL(request.url).pathname.replace(/^\/+/, '');
    const entry = served.get(token);
    if (!entry) return new Response('not found', { status: 404 });
    const range = parseByteRange(request.headers.get('range'), entry.bytes);
    const headers: Record<string, string> = {
      'content-type': entry.mime,
      'accept-ranges': 'bytes',
      'cache-control': 'no-store',
    };
    if (range.kind === 'unsatisfiable') {
      return new Response(null, { status: 416, headers: { ...headers, 'content-range': `bytes */${entry.bytes}` } });
    }
    const start = range.kind === 'partial' ? range.start : 0;
    const end = range.kind === 'partial' ? range.end : entry.bytes - 1;
    const body = Readable.toWeb(createReadStream(entry.path, { start, end })) as unknown as ReadableStream;
    headers['content-length'] = String(end - start + 1);
    if (range.kind === 'partial') {
      headers['content-range'] = `bytes ${start}-${end}/${entry.bytes}`;
      return new Response(body, { status: 206, headers });
    }
    return new Response(body, { status: 200, headers });
  });
}

/** A preview already fetched for this media id, if it is still on disk. */
export function cachedPreview(mediaId: string): { url: string; name: string; bytes: number; mime: string } | null {
  const hit = byMediaId.get(mediaId);
  if (!hit) return null;
  const entry = served.get(hit.token);
  if (!entry) return null;
  return { url: `${SCHEME}://preview/${hit.token}`, name: hit.name, bytes: entry.bytes, mime: entry.mime };
}

/** Where the next original for viewing should be written. The folder is created on demand. */
export async function previewFolder(): Promise<string> {
  const dir = previewDir();
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** Registers a file that has landed in [previewDir] and returns the URL the page may load. */
export function rememberPreview(
  mediaId: string,
  file: { path: string; name: string; mime: string; bytes: number },
): string {
  const token = randomBytes(18).toString('base64url');
  served.set(token, { path: file.path, mime: file.mime, bytes: file.bytes, at: Date.now() });
  byMediaId.set(mediaId, { token, name: file.name });
  evictBeyond(KEEP);
  return `${SCHEME}://preview/${token}`;
}

function evictBeyond(keep: number): void {
  if (served.size <= keep) return;
  const oldest = [...served.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, served.size - keep);
  for (const [token, entry] of oldest) {
    served.delete(token);
    for (const [id, hit] of byMediaId) if (hit.token === token) byMediaId.delete(id);
    void fsp.rm(entry.path, { force: true });
  }
}

/** Empties the cache. Synchronous so it can run from `will-quit`. */
export function clearPreviews(why: string): void {
  const held = served.size;
  const bytes = [...served.values()].reduce((s, e) => s + e.bytes, 0);
  served.clear();
  byMediaId.clear();
  try {
    rmSync(previewDir(), { recursive: true, force: true });
  } catch (error) {
    log.warn('photos', `could not empty the preview cache (${why}): ${String(error)}`);
    return;
  }
  if (held > 0 || why === 'app start') {
    log.info('photos', `preview cache emptied (${why}): ${held} original(s), ${bytes} bytes`);
  }
}
