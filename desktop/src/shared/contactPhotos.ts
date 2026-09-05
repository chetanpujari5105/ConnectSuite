/**
 * Contact photographs, fetched once per number and drawn into a disc that already reads correctly.
 *
 * ### What this is for
 *
 * A call card and a call log draw an avatar disc with initials on a per-contact hue. That disc is
 * a placeholder for a picture the phone already holds: on this handset **224 of 665 contacts have
 * a photo** (`docs/testing.md` → Phase 7 Slice 22), so a third of every list is a picture the user
 * set themselves and the app was not showing.
 *
 * ### Why the fetch is per number and not part of the list
 *
 * `call.log` carries numbers, not contact ids, and it carries no photo — `docs/protocol.md` says
 * plainly that binary does not travel in these messages, with `contacts.get` as one of the two
 * bounded exceptions. So there is no contract change here at all: the Mac asks
 * `contacts.get {number, withPhoto:true}` per **distinct** number and holds what comes back.
 *
 * That makes this cache the entire feature. Without it a 50-row log is 50 requests on every
 * redraw, and this pane redraws whenever a call starts, ends, or a tab is clicked.
 *
 * ### The three things it has to get right
 *
 * 1. **A miss is remembered.** Two thirds of contacts have no photo, and a number that is not in
 *    the book has no contact at all. Both answer `null`, and `null` is cached exactly as hard as a
 *    hit is — otherwise the common case is the one that asks forever.
 * 2. **A second caller joins the run in flight.** The live card and the log row for the same
 *    person are drawn in the same frame from two different code paths. `CLAUDE.md` records what
 *    happens when two correct triggers both start the same fetch — the Files pane settled on the
 *    one state its type was built to make impossible — and the fix there is the fix here: a
 *    second caller awaits the first request rather than starting a second.
 * 3. **It is bounded and it is dropped with the link.** A name resolved against a phone that has
 *    since been unpaired is a claim this Mac cannot stand behind, and so is a face.
 *
 * ### Not a matching rule
 *
 * [photoKey] normalises punctuation so two spellings of one number share a cache entry. It is
 * deliberately *not* an implementation of the phone's number matching — `PhoneLookup` compares
 * normalised digits with the country code optional, that rule lives on the phone so there is one
 * of it, and a second one here would disagree eventually. A key that is too specific costs one
 * extra request; a second matching rule costs a wrong face on a call card.
 */

/** Resolves one number to a drawable image source, or `null` when there is no photo. */
type ContactPhotoFetch = (number: string) => Promise<string | null>;

/**
 * The cache key for a number, and nothing more. See the file comment: this is not number matching.
 */
function photoKey(number: string): string {
  return number.replace(/[^\d+]/g, '');
}

/**
 * How many photographs are held at once.
 *
 * This handset has 224 contacts with a photo, so the whole book fits and the cap is really a bound
 * on a pathological log rather than a working limit. It is an entry count rather than a byte
 * budget because the phone already enforces the bytes — `docs/protocol.md` caps one photo at
 * 64 KiB and the phone downscales rather than refusing — so the worst case here is bounded on both
 * sides, and a byte-counting eviction would be a second budget disagreeing with the first.
 */
const MAX_PHOTOS = 300;

class ContactPhotos {
  /** key → image source, or `null` meaning **asked, and there is no photo**. Insertion-ordered. */
  private held = new Map<string, string | null>();

  /** key → the request already in the air. See rule 2 in the file comment. */
  private inFlight = new Map<string, Promise<string | null>>();

  private hits = 0;
  private misses = 0;
  private found = 0;
  private absent = 0;
  private skipped = 0;
  private failed = 0;

  /**
   * @param onSettled reported when the last request in flight finishes, never on a schedule.
   *
   * This exists because of the rule `CLAUDE.md` states about instruments: *report the effect, not
   * the stimulus*. A tally printed at the end of a render would say `0 found` every time — the
   * discs have been asked for and nothing has come back yet — which is a true number about the
   * wrong moment, and the shape that let a probe report 12 MB delivered over zero bytes. A batch
   * that has actually settled is the only point at which `found` and `none` mean anything.
   */
  constructor(
    private readonly fetcher: ContactPhotoFetch,
    private readonly onSettled: (tally: string) => void = () => {},
    private readonly limit: number = MAX_PHOTOS,
  ) {}

  /**
   * Every counter beside the one that gives it meaning, per `CLAUDE.md`.
   *
   * `found` alone cannot tell a book with few photographs from a fetch that is failing, and those
   * need opposite fixes. `skipped` is here because it is the largest number of the six and would
   * otherwise be invisible: it counts the rows this never asked about at all.
   */
  tally(): string {
    return (
      `${this.found} found / ${this.absent} none / ${this.failed} failed, ` +
      `${this.skipped} not asked, cache ${this.hits} hit / ${this.misses} missed, ` +
      `${this.held.size} held`
    );
  }

  /**
   * What is known right now: an image source, `null` for known-absent, `undefined` for unasked.
   *
   * Three-valued on purpose. A caller that collapsed `null` and `undefined` would either redraw
   * nothing for a contact it has already resolved, or ask again for every contact that has no
   * photograph — which is two thirds of them.
   */
  cached(number: string): string | null | undefined {
    const key = photoKey(number);
    if (!key) return null;
    const held = this.held.get(key);
    if (held === undefined) this.misses += 1;
    else this.hits += 1;
    return held;
  }

  /**
   * Fetch one number's photograph, joining a request already in the air for the same key.
   *
   * Never rejects. A refusal from the phone — no such contact, contacts not granted, the link gone
   * — is `null`, the same answer as a contact with no photograph, because the caller's response to
   * all of them is identical: keep the initials that are already drawn. The *reason* is not
   * discarded silently though; `failed` counts it and it reaches the tally, which is the
   * difference between this and the `runCatching { }.getOrNull()` that defect 57 came out of.
   */
  async resolve(number: string): Promise<string | null> {
    const key = photoKey(number);
    if (!key) return null;

    const held = this.held.get(key);
    if (held !== undefined) return held;

    const running = this.inFlight.get(key);
    if (running) return running;

    const run = this.fetcher(number)
      .then((source) => {
        if (source) this.found += 1;
        else this.absent += 1;
        this.remember(key, source);
        return source;
      })
      .catch(() => {
        this.failed += 1;
        // Deliberately **not** remembered. A photograph that failed because the link dropped is a
        // question this Mac has not had answered, and caching the failure would mean the face
        // never appears again on a link that has since come back.
        return null;
      })
      .finally(() => {
        this.inFlight.delete(key);
        if (this.inFlight.size === 0) this.onSettled(this.tally());
      });

    this.inFlight.set(key, run);
    return run;
  }

  /** Counts a row this deliberately did not ask about, so the tally's denominator stays honest. */
  countSkipped(): void {
    this.skipped += 1;
  }

  /** Drops everything. The link went away, and a face outliving its link is a stale claim. */
  clear(): void {
    this.held.clear();
    this.inFlight.clear();
  }

  private remember(key: string, source: string | null): void {
    // Oldest-first eviction, which is insertion order because a `Map` preserves it and nothing
    // here re-inserts on read. Not an LRU: an LRU would need a touch on every `cached()` call,
    // which happens once per disc per redraw, to buy an eviction order that only matters on a
    // phone book larger than the cap.
    while (this.held.size >= this.limit) {
      const oldest = this.held.keys().next();
      if (oldest.done) break;
      this.held.delete(oldest.value);
    }
    this.held.set(key, source);
  }
}

/*
 * ### Why there is not one `export` keyword in this file
 *
 * The page loads this as a plain `<script>`. A file with an `export` compiles to CommonJS, whose
 * first emitted statement is `Object.defineProperty(exports, …)` — and `exports` does not exist in
 * a browser, so the **whole script throws on its first line** and nothing below ever runs.
 *
 * That trap has a survivor and it is worth knowing which: a `function` declaration is hoisted onto
 * `globalThis` before the body executes, so a file exporting only functions still works, by
 * accident, with the block below never running. A **`class` is not hoisted that way**, so the same
 * file exporting a class is simply absent from the page — measured here, 2026-09-05: `ContactPhotos`
 * was `undefined` while `photoKey`, declared four lines away in the same file, was a function.
 *
 * Eight of the ten shared files loaded into the renderer already avoid `export` for this reason.
 * `discHue.ts` was the ninth and did not, and is the survivor described above.
 *
 * So: declarations are plain, `globalThis` is how the page gets them, and `module.exports` is how
 * the tests do. Tests reach it with `createRequire`, like `islandRota.test.ts`.
 */
{
  const g = globalThis as Record<string, unknown>;
  g.ContactPhotos = ContactPhotos;
  g.photoKey = photoKey;
}

// `module` is undefined in the browser, so this is a no-op there and exists only for the tests.
if (typeof module !== 'undefined') {
  module.exports = { ContactPhotos, photoKey, MAX_PHOTOS };
}
