import {
  MessageType,
  type AppEntry,
  type AppIcon,
  type PhoneAck,
  type PhoneResult,
} from '../shared/protocol';
import { ask, rows, tell } from './feature';
import type { LinkClient } from './link';
import { log } from './logger';

/**
 * The Mac's half of the app launcher — and it is not a launcher, which is the whole design.
 *
 * `apps.open.ask` **asks the phone to ask its user**. The ack means a notification was posted; it
 * does not mean the app opened, and there is no field on the wire that could say so. That is a
 * measurement rather than a limitation somebody accepted: on this platform a backgrounded app's
 * `startActivity` returns normally, logs nothing, and does not bring the app to the front
 * (`docs/phase-7-apps-proposal.md` §2.4). A verb built on that would report success and do nothing.
 *
 * **So nothing in this file may grow a "did it open?" affordance.** No optimistic tile state, no
 * retry on a launch that "failed", no queue of pending opens — every one of those is reasonable
 * against the word *launch* and wrong against the behaviour, which is exactly why the wire name is
 * `apps.open.ask` and why `scripts/check-apps-verb.mjs` keeps the other one out of this tree.
 *
 * ### Icons are batched here rather than in the renderer
 *
 * The phone caps `packages` at 32 per request, so 122 apps is four batches, not one call. Doing it
 * in the renderer would put the cap in two places and let them drift; doing it here also means the
 * cache lives beside the batching that fills it. [ICON_BATCH] is the phone's own number on purpose
 * — the phone refuses `BAD_REQUEST` above it, which is the check that actually matters.
 */
export class AppsClient {
  /** package → base64 PNG. An icon is immutable for a version, so this does not go stale in place. */
  private icons = new Map<string, string>();

  /** Packages that came back with a per-item error, so a dead tile is not re-asked on every draw. */
  private missing = new Set<string>();

  private listed = 0;
  private iconsMade = 0;
  private iconsFailed = 0;
  private cacheHits = 0;
  private asked = 0;

  constructor(private readonly link: () => LinkClient | null) {}

  /**
   * Every app with a home-screen icon, already sorted by the phone.
   *
   * **The order is not re-sorted here and must not be.** The phone resolved the labels, so it is the
   * only side that can sort by them consistently with its own screens — and a Mac-side sort would be
   * a second expression of a rule that already has a home, which is the shape that eventually
   * disagrees.
   *
   * `count` and `total` are both read, and a gap between them is logged as a truncation rather than
   * quietly dropped. A list that returns its first thousand rows without saying so is an instrument
   * reporting its own bound as the phone's contents.
   */
  async list(): Promise<PhoneResult<{ apps: AppEntry[]; count: number; total: number }>> {
    const result = await ask(
      this.link(),
      'apps',
      MessageType.APPS_LIST,
      {},
      (payload) => ({
        apps: rows(payload, 'apps').map(toApp),
        count: Number(payload.count ?? 0),
        total: Number(payload.total ?? 0),
      }),
    );
    if (result.ok) {
      this.listed = result.data.apps.length;
      const fallbacks = result.data.apps.filter((one) => one.labelIsFallback).length;
      log.info(
        'apps',
        `apps.list → ${result.data.count} of ${result.data.total} packages, ` +
          `${result.data.apps.length - fallbacks} named / ${fallbacks} showing a package id` +
          (result.data.count < result.data.total ? ' — TRUNCATED by the phone cap' : ''),
      );
    }
    return result;
  }

  /**
   * Icons for as many packages as asked, in batches the phone will accept.
   *
   * Returns what it has: already-cached packages come back without a request, and one that failed
   * before is not asked for again. Both counts are logged together — a hit rate with no misses
   * beside it cannot tell a warm cache from one nothing consults.
   */
  async iconsFor(packages: string[], maxEdge = 96): Promise<PhoneResult<Map<string, string>>> {
    const wanted = packages.filter((one) => !this.icons.has(one) && !this.missing.has(one));
    this.cacheHits += packages.length - wanted.length;

    for (let i = 0; i < wanted.length; i += ICON_BATCH) {
      const batch = wanted.slice(i, i + ICON_BATCH);
      const result = await ask(
        this.link(),
        'apps',
        MessageType.APPS_ICON,
        { packages: batch, maxEdge },
        (payload) => rows(payload, 'icons').map(toIcon),
      );
      if (!result.ok) return result;
      for (const icon of result.data) {
        if (icon.data) {
          this.icons.set(icon.package, icon.data);
          this.iconsMade += 1;
        } else {
          this.missing.add(icon.package);
          this.iconsFailed += 1;
        }
      }
    }

    log.info(
      'apps',
      `apps.icon → ${this.iconsMade} made / ${this.iconsFailed} failed / ` +
        `${this.cacheHits} served from cache, over ${this.listed} apps listed`,
    );
    const answer = new Map<string, string>();
    for (const one of packages) {
      const data = this.icons.get(one);
      if (data) answer.set(one, data);
    }
    return { ok: true, data: answer };
  }

  /**
   * Asks the phone to ask its user to open an app.
   *
   * A `PhoneAck` and nothing richer, deliberately. There is no success payload worth reading: the
   * phone answers `{ asked: true }` and the only interesting outcomes are *the question was posted*
   * and *it could not be*. Returning a shape with room for a result would be the first step to
   * something filling it in.
   *
   * The counter is named `asked` rather than `opened` for the same reason. A counter named for
   * something this process cannot observe is where a wrong claim gets a number attached and becomes
   * believable.
   */
  async openAsk(packageName: string): Promise<PhoneAck> {
    const result = await tell(this.link(), 'apps', MessageType.APPS_OPEN_ASK, { package: packageName });
    if (result.ok) {
      this.asked += 1;
      log.info(
        'apps',
        `apps.open.ask → the phone was asked to offer ${packageName} (${this.asked} since launch). ` +
          'Whether it opens is a tap on the phone, and this Mac will never know.',
      );
    }
    return result;
  }

  /**
   * Drops the icon cache on disconnect.
   *
   * Same reasoning as the photo thumbnails: a picture resolved against a phone that has since been
   * unpaired, or whose apps have been updated, is a claim this Mac cannot still stand behind. The
   * `missing` set goes too — a package that failed while the link was dropping deserves another ask.
   */
  clear(): void {
    const held = this.icons.size;
    this.icons.clear();
    this.missing.clear();
    this.listed = 0;
    log.info('apps', `cleared ${held} cached app icons on disconnect`);
  }
}

/** The phone's own cap on `packages`, mirrored so a batch is never refused as BAD_REQUEST. */
const ICON_BATCH = 32;

function toApp(row: Record<string, unknown>): AppEntry {
  return {
    package: String(row.package ?? ''),
    // Never defaulted to the package id here. The phone already falls back to it and *says so*
    // with `labelIsFallback`; reconstructing that fallback on this side would be a second
    // expression of the rule, free to disagree with the phone's about which case it is in.
    label: String(row.label ?? ''),
    updatedMs: Number(row.updatedMs ?? 0),
    ...(row.versionName ? { versionName: String(row.versionName) } : {}),
    ...(row.labelIsFallback === true ? { labelIsFallback: true } : {}),
  };
}

function toIcon(row: Record<string, unknown>): AppIcon {
  return {
    package: String(row.package ?? ''),
    ...(row.mime ? { mime: String(row.mime) } : {}),
    ...(row.width ? { width: Number(row.width) } : {}),
    ...(row.height ? { height: Number(row.height) } : {}),
    ...(row.data ? { data: String(row.data) } : {}),
    ...(row.error ? { error: String(row.error) } : {}),
  };
}
