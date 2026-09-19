/**
 * The one way this repo reads the Mac's DOM for a number that will be written down.
 *
 * ### Why this exists rather than a rule
 *
 * `CLAUDE.md` already carries "the instrument gets its own control before the reading counts", in
 * three separate sittings, with worked examples. It kept being broken **by the person who had just
 * written it**, because taking a control is a separate voluntary act from taking a reading, and
 * nobody feels the need for one while reading a number that looks right.
 *
 * Three faults in three sittings, all the same failure:
 *
 * | Fault | What was actually wrong |
 * |---|---|
 * | a 2.5 s wait against a 16 s page | the **wait** was shorter than the operation |
 * | an exact match against a nav labelled `"Notifications27"` | the **selector** matched nothing |
 * | a photo grid measured while its section was `hidden` | the **target** was not there to be read |
 *
 * None is carelessness of a different kind. All three are *reading zero and reporting it as a fact*,
 * and each produced a plausible number with no way to separate "the thing is false" from "I could
 * not see it". So the control stops being optional: it is a required argument, a fixed sleep is not
 * expressible, and no result is a bare scalar.
 *
 * ### What it does not cover, stated so nobody assumes more
 *
 * It cannot help when the control is itself wrong, and it cannot tell you the question was the wrong
 * question. It is scoped to **CDP reads that feed a claim in `docs/testing.md`**. Ad-hoc poking at a
 * running app stays ad-hoc; the moment a number is going to be written down, it comes through here.
 *
 * ### The seam
 *
 * [createProbe] takes an `evaluate` function and knows nothing about CDP, so `probe.test.mjs` runs
 * its whole decision surface against a fake page with no browser. [openProbe] is the thin part that
 * builds one over a real WebSocket. Same rule as `src/shared/` on the Mac and `SingleFlight` on the
 * phone: the part that needs a test does not import the thing that cannot be tested.
 */

/** How a probe stopped. Only `settled` and `immediate` may be quoted as a finding. */
export const STOPPED = Object.freeze({
  /** No `settle` was asked for: one read, one answer. */
  IMMEDIATE: 'immediate',
  /** The `until` predicate came true inside the deadline. */
  SETTLED: 'settled',
  /** The deadline expired first. **This is not a reading**, it is where the instrument gave up. */
  DEADLINE: 'deadline',
});

/**
 * Helpers installed in the page before every read.
 *
 * `one()` is the visibility-and-exactly-one-node assertion, in the same expression as the read
 * rather than beside it. Two of the three faults above die here: a selector matching nothing throws
 * instead of yielding 0, and a selector matching the app window *and* the pane throws instead of
 * silently taking the first in document order.
 */
export const PRELUDE = `
globalThis.__probe = {
  one: function (sel) {
    var all = document.querySelectorAll(sel);
    if (all.length === 0) throw new Error('PROBE_NO_MATCH: nothing matches ' + sel);
    if (all.length > 1) throw new Error('PROBE_AMBIGUOUS: ' + all.length + ' nodes match ' + sel + ' — narrow it until it can only be the thing');
    var el = all[0];
    var vis = typeof el.checkVisibility === 'function'
      ? el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true })
      : (!el.hidden && el.offsetParent !== null);
    var r = el.getBoundingClientRect();
    if (!vis || r.height <= 0) {
      throw new Error('PROBE_NOT_VISIBLE: ' + sel + ' (hidden=' + el.hidden + ', height=' + r.height + ') — a hidden element reports no size and cannot scroll, so anything it says about itself is void');
    }
    return el;
  },
  count: function (sel) { return document.querySelectorAll(sel).length; },
  text: function (sel) { return (globalThis.__probe.one(sel).textContent || '').replace(/\\s+/g, ' ').trim(); },

  /*
   * The scrolling ancestor of an element — FOUND, never assumed.
   *
   * Written because the assumption was wrong twice in one week, both times costing a false
   * finding. The Files pane's probe scrolled \`section[data-screen=...]\` and read no movement;
   * O4's probe did the same and reported a card unreachable. Neither section is the scroller:
   * \`#page\` is, and every pane's section reports scrollHeight === clientHeight because the
   * overflow is one level up. A probe that scrolls the wrong node gets a stationary rect and a
   * confident wrong answer, which is this repo's most-repeated failure with a CSS costume.
   *
   * So: walk up, read the computed overflow, and take the first ancestor that can actually
   * scroll. Returns null when nothing can, which is a real answer and not a failure.
   */
  scroller: function (el) {
    var node = el.parentElement;
    while (node && node !== document.documentElement) {
      var overflow = getComputedStyle(node).overflowY;
      if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) return node;
      node = node.parentElement;
    }
    return null;
  },

  /*
   * Is this element on screen, and if not, can a person get to it?
   *
   * **The one thing every pane uses**, replacing the per-sitting geometry probe. Defect 85 was a
   * card 828px down an 865px window; three days later O4 landed a card at 1007px in the same
   * window, in the pane being fixed. Twice is a pattern, and a rule nobody can call is a rule
   * that gets re-derived per sitting and re-derived wrongly.
   *
   * It reports THREE outcomes, because "not visible right now" is not one answer:
   *
   *   visible    — on screen as the pane sits
   *   reachable  — off screen, and scrolling its scroller brings it fully into view
   *   stranded   — off screen and scrolling does not help. This is the defect.
   *
   * It restores the scroll position it found, so a reading does not leave the pane somewhere the
   * next reading did not expect.
   */
  onScreen: function (sel) {
    var el = globalThis.__probe.one(sel);
    var h = window.innerHeight;
    /*
     * The visible band, which is the viewport intersected with **every clipping ancestor**.
     *
     * The first version of this used the viewport alone, and it was wrong in the one direction
     * that matters: an element inside a scroll port whose box ends *above* the viewport bottom
     * reads as fully visible while its lower part is clipped by the port. On this app that is not
     * a corner case — \`#page\` is \`overflow-y: auto\` and its bottom sits ~46px above the viewport
     * because the dock is under it, so every card near the foot of a pane was measured wrong.
     *
     * Caught 2026-09-05 on the Calls pane's app-call note: viewport 841, note bottom 826, verdict
     * \`visible\` with \`fraction: 1\` — and \`#page\` ending at 795, so 31px of the sentence was not
     * drawn. This is defect 85's own instrument having defect 85's bug.
     */
    var band = function () {
      var top = 0, bottom = h;
      for (var node = el.parentElement; node && node !== document.documentElement; node = node.parentElement) {
        var cs = getComputedStyle(node);
        if (cs.overflowY === 'visible' && cs.overflowX === 'visible') continue;
        var nb = node.getBoundingClientRect();
        if (nb.top > top) top = nb.top;
        if (nb.bottom < bottom) bottom = nb.bottom;
      }
      return { top: top, bottom: bottom };
    };
    var seen = function () {
      var r = el.getBoundingClientRect();
      var b = band();
      var shown = Math.max(0, Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top));
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height),
               clipTop: Math.round(b.top), clipBottom: Math.round(b.bottom),
               fraction: r.height ? +(shown / r.height).toFixed(2) : 0 };
    };
    var at_rest = seen();
    if (at_rest.fraction >= 1) {
      return { verdict: 'visible', atRest: at_rest, viewportH: h, scrolledBy: 0, scroller: null };
    }
    var box = globalThis.__probe.scroller(el);
    if (!box) {
      return { verdict: 'stranded', atRest: at_rest, afterScroll: at_rest, viewportH: h,
               scrolledBy: 0, scroller: null, why: 'no scrolling ancestor — scrolling cannot reach it' };
    }
    /*
     * Every scrollable ancestor is recorded, not just the one \`scroller()\` chose.
     *
     * \`scrollIntoView\` scrolls **all** of them — including ancestors with \`overflow: hidden\`,
     * which are still scroll ports and simply have no scrollbar. Restoring one and walking away
     * left \`.app-window\` sitting at \`scrollTop: 199.5\` with its own header and sidebar above
     * the viewport, invisibly, for the rest of the session: no scrollbar to show it, no wheel
     * target to undo it, and every scroll offset anyone would think to read still saying zero.
     *
     * It cost two screenshots before \`shot.mjs\` grew a precondition that refuses them, and the
     * cause was this line. An instrument that leaves the app in a state it did not find it in is a
     * stimulus with an unreported side effect — the same shape as a probe reporting bytes queued
     * as bytes delivered, one layer over.
     */
    var chain = [];
    for (var node = el; node && node !== document.documentElement; node = node.parentElement) {
      chain.push([node, node.scrollTop, node.scrollLeft]);
    }
    var held = box.scrollTop;
    el.scrollIntoView({ block: 'center' });
    var after = seen();
    var moved = box.scrollTop - held;
    for (var j = 0; j < chain.length; j++) {
      chain[j][0].scrollTop = chain[j][1];
      chain[j][0].scrollLeft = chain[j][2];
    }
    var name = box.id ? '#' + box.id : box.tagName.toLowerCase() + '.' + String(box.className || '').split(' ')[0];
    return {
      verdict: after.fraction >= 1 ? 'reachable' : 'stranded',
      atRest: at_rest, afterScroll: after, viewportH: h, scrolledBy: moved, scroller: name
    };
  }
};
'ok'
`;

/** Turn a function or a string into an expression the page can evaluate. */
function sourceOf(what) {
  if (typeof what === 'string') return what;
  if (typeof what === 'function') return `(${what.toString()})()`;
  throw new TypeError('probe: read/control must be a string expression or a function');
}

/**
 * A probe over an injected `evaluate`.
 *
 * `evaluate(expression)` resolves with the page's value, or rejects if the page threw. That is the
 * whole contract, and it is why this file has no WebSocket in it.
 */
export function createProbe(evaluate, { now = () => Date.now(), sleep = defaultSleep } = {}) {
  let preludeInstalled = false;

  async function ensurePrelude() {
    if (preludeInstalled) return;
    await evaluate(PRELUDE);
    preludeInstalled = true;
  }

  /**
   * One reading, with its control, its provenance, and how it stopped.
   *
   * `control` is required and has no default. It must come back **truthy and non-zero**, and it must
   * describe something you already know is there — "the table exists", "the nav has eleven items".
   * A control that can only be true when the reading is true is not a control.
   *
   * `settle` replaces every fixed sleep: `{ until, within, poll }`. A bare wait is the 2.5 s fault,
   * and it is not expressible here — there is no `delay` option, deliberately.
   */
  async function read(spec) {
    const { question, read: readSpec, control, settle } = spec ?? {};

    if (!question || typeof question !== 'string') {
      throw new TypeError('probe.read: `question` is required — a result with no question cannot be reviewed');
    }
    if (readSpec === undefined) throw new TypeError('probe.read: `read` is required');
    if (control === undefined) {
      throw new TypeError(
        `probe.read(${JSON.stringify(question)}): \`control\` is required and has no default. ` +
          'Name something you already know is true that this query must also return. ' +
          'Without it, zero and "I could not see it" are the same answer.',
      );
    }
    if (spec.text !== undefined || spec.match !== undefined) {
      throw new TypeError(
        `probe.read(${JSON.stringify(question)}): text matching is refused for presence questions. ` +
          'The copy explaining an absence contains the words for the thing that is absent — a ' +
          "/drop|upload|send to phone/ scan once matched the degraded banner's own sentence. " +
          'Use probe.presence({ controls }) and count elements instead.',
      );
    }

    await ensurePrelude();

    const readSrc = sourceOf(readSpec);
    const controlSrc = sourceOf(control);
    const startedAt = now();
    let polls = 0;
    let value;
    let controlValue;
    let stopped = STOPPED.IMMEDIATE;

    const takeOne = async () => {
      polls += 1;
      controlValue = await evaluate(controlSrc);
      if (!controlValue) {
        throw new ProbeControlFailure(question, controlSrc, controlValue);
      }
      value = await evaluate(readSrc);
      return value;
    };

    if (!settle) {
      await takeOne();
    } else {
      const { until, within, poll = 500 } = settle;
      if (typeof until !== 'function') {
        throw new TypeError('probe.read: settle.until must be a predicate on the value');
      }
      if (!Number.isFinite(within) || within <= 0) {
        throw new TypeError('probe.read: settle.within (ms) is required — a wait with no deadline cannot report that it gave up');
      }
      stopped = STOPPED.DEADLINE;
      const deadline = startedAt + within;
      for (;;) {
        await takeOne();
        if (until(value)) {
          stopped = STOPPED.SETTLED;
          break;
        }
        if (now() >= deadline) break;
        await sleep(Math.min(poll, Math.max(0, deadline - now())));
      }
    }

    return finish({ question, value, controlValue, controlSrc, readSrc, startedAt, polls, stopped, now });
  }

  /**
   * A presence question, answered by **counting controls** rather than searching text.
   *
   * `controls` is a selector enumerating things you can act on — buttons, inputs, drop handlers.
   * This is the other half of the text-matcher refusal above: an affordance is an element, and the
   * sentence apologising for its absence is not one.
   */
  async function presence(spec) {
    const { question, controls, control } = spec ?? {};
    if (!controls || typeof controls !== 'string') {
      throw new TypeError('probe.presence: `controls` must be a selector enumerating actionable elements');
    }
    const result = await read({
      question,
      read: `__probe.count(${JSON.stringify(controls)})`,
      control,
      ...(spec.settle ? { settle: spec.settle } : {}),
    });
    return { ...result, controls };
  }

  /**
   * A stimulus. Separate from a read because it is not one, and because a stimulus reported without
   * its effect is how a probe once reported 12 MB "delivered" that had never left the machine.
   *
   * `expect` is required: an expression that must become true for the stimulus to count as landed.
   * The returned result carries `landed`, and a stimulus that did not land is not a premise.
   */
  async function act(spec) {
    const { what, run, expect, within = 5000 } = spec ?? {};
    if (!what || typeof what !== 'string') throw new TypeError('probe.act: `what` is required');
    if (run === undefined) throw new TypeError('probe.act: `run` is required');
    if (expect === undefined) {
      throw new TypeError(
        `probe.act(${JSON.stringify(what)}): \`expect\` is required. A stimulus reported without ` +
          'its effect is a request, not a measurement — and an absence read before the action ' +
          'actually happened is not a negative reading, it is no reading at all.',
      );
    }
    await ensurePrelude();
    const startedAt = now();
    await evaluate(sourceOf(run));
    const expectSrc = sourceOf(expect);
    let landed = false;
    for (;;) {
      landed = Boolean(await evaluate(expectSrc));
      if (landed || now() >= startedAt + within) break;
      await sleep(100);
    }
    return {
      what,
      landed,
      waitedMs: now() - startedAt,
      stopped: landed ? STOPPED.SETTLED : STOPPED.DEADLINE,
      run: sourceOf(run),
      expect: expectSrc,
    };
  }

  return { read, presence, act };
}

function finish({ question, value, controlValue, controlSrc, readSrc, startedAt, polls, stopped, now }) {
  const result = {
    question,
    value,
    control: controlValue,
    polls,
    waitedMs: now() - startedAt,
    stopped,
    /**
     * Whether this may be quoted as a finding.
     *
     * False on a deadline, always. A run that hit its deadline has proven the instrument stopped and
     * nothing about the thing measured — the same sentence as `stopped=page cap` on the pager probe,
     * and the reason that one printed `sums=not tested — capped` rather than `NO`.
     */
    reportable: stopped !== STOPPED.DEADLINE,
    source: { read: readSrc, control: controlSrc },
  };
  return result;
}

/** Thrown when the control did not come back true. Never returns a value the caller could quote. */
export class ProbeControlFailure extends Error {
  constructor(question, controlSource, got) {
    super(
      `CONTROL FAILED for ${JSON.stringify(question)}: the control returned ${JSON.stringify(got)}. ` +
        'The reading was not taken. Nothing about the target is known — this says the query could ' +
        `not see a thing you already knew was there.\n  control: ${controlSource}`,
    );
    this.name = 'ProbeControlFailure';
    this.question = question;
    this.controlSource = controlSource;
    this.got = got;
  }
}

function defaultSleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * One line carrying everything a reviewer needs: the value, its control, and how it stopped.
 *
 * **Refuses an `act` result**, and that refusal is the whole reason this check exists. An act
 * carries `what`/`landed`, not `question`/`value`/`reportable`, so passing one here used to print
 *
 *     undefined → undefined  [control=undefined …] NOT REPORTABLE — the instrument gave up
 *
 * over a stimulus that had **landed perfectly** — a confident, specific, wrong answer about the
 * instrument's own run, which is the exact family `probe.mjs` exists to stop. It was hit by the
 * probe written for contact photographs on 2026-09-05, twice in one run, next to readings that
 * were correct. Use [formatAct] for a stimulus; they are different things and now say so.
 */
export function format(result) {
  if (result && result.landed !== undefined && result.question === undefined) {
    throw new TypeError(
      'probe.format: that is an `act` result, not a read. Use formatAct() — formatting a stimulus ' +
        'as a reading prints "NOT REPORTABLE" over an action that landed.',
    );
  }
  const head = `${result.question} → ${JSON.stringify(result.value)}`;
  const prov = `control=${JSON.stringify(result.control)} polls=${result.polls} waited=${result.waitedMs}ms stopped=${result.stopped}`;
  return result.reportable ? `${head}  [${prov}]` : `${head}  [${prov}] NOT REPORTABLE — the instrument gave up, this is not a reading`;
}

/** One line for a stimulus: what it did, whether it landed, and how long it waited to find out. */
export function formatAct(result) {
  const head = `${result.what} → ${result.landed ? 'landed' : 'DID NOT LAND'}`;
  const prov = `waited=${result.waitedMs}ms stopped=${result.stopped}`;
  return result.landed
    ? `${head}  [${prov}]`
    : `${head}  [${prov}] NOT A PREMISE — nothing measured after this is about the state you wanted`;
}

/**
 * A probe over a real Chrome DevTools Protocol session.
 *
 * The thin half. Everything with a decision in it is in [createProbe] above, which is why this
 * function has no logic worth testing and the tests do not start a browser.
 */
export async function openProbe({ port = 9222, endpoint = 'http://localhost', userGesture = false, window: want = 'index' } = {}) {
  const targets = await (await fetch(`${endpoint}:${port}/json`)).json();
  const pages = targets.filter((t) => t.type === 'page');
  if (pages.length === 0) throw new Error(`probe: no page target on :${port}`);
  /*
   * **Name the window, never take the first one.**
   *
   * This used to be `pages.find(...)` — the first page target, whichever it happened to be. That is
   * fine while the app has one window and silently wrong the moment it has two: the float window
   * opened during a latency run, sorted ahead of the main window in `/json`, and the next probe
   * attached to it and died on `document.querySelector('[data-nav="mirror"]')` being null. It died
   * loudly *this* time. A probe whose selectors happen to exist in both windows would not have.
   *
   * That is the control table's own entry with the target swapped rather than the query — "you are
   * looking at a different machine", one scale down — so the fix is the same: the caller says which
   * window it means, matched on the page's URL, and an ambiguous match refuses instead of guessing.
   */
  const matching = pages.filter((t) => (t.url ?? '').includes(`/renderer/${want}.`));
  if (matching.length === 0) {
    throw new Error(
      `probe: no page whose URL names "${want}" on :${port}. Open pages: ` +
        pages.map((t) => `${t.title} <${t.url}>`).join(', '),
    );
  }
  if (matching.length > 1) {
    throw new Error(
      `probe: ${matching.length} pages match "${want}" on :${port} — refusing to guess. ` +
        matching.map((t) => `${t.title} <${t.url}>`).join(', '),
    );
  }
  const page = matching[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 0;
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    const resolve = pending.get(msg.id);
    if (resolve) {
      pending.delete(msg.id);
      resolve(msg);
    }
  };
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error(`probe: could not open ${page.webSocketDebuggerUrl}`));
  });

  /**
   * One CDP command over the single socket. `evaluate` and `rawCapture` are both built on it.
   *
   * Kept private and unexported: the rule `probe.test.mjs` enforces is that there is **one
   * transport**, and widening this into a general escape hatch would defeat it. The two things
   * built on it are named, and a third needs a reason written down here first.
   */
  const send = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, (msg) => {
        if (msg.error) {
          reject(new Error(`probe: ${method} failed — ${msg.error.message ?? JSON.stringify(msg.error)}`));
          return;
        }
        resolve(msg.result);
      });
      ws.send(JSON.stringify({ id, method, params }));
    });

  const evaluate = (expression) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, (msg) => {
        const details = msg.result?.exceptionDetails;
        if (details) {
          // The page's own message, not a generic failure. `PROBE_NOT_VISIBLE` and
          // `PROBE_AMBIGUOUS` reach the caller intact and say which selector was at fault.
          reject(new Error(details.exception?.description ?? details.text ?? 'page threw'));
          return;
        }
        resolve(msg.result?.result?.value);
      });
      ws.send(
        JSON.stringify({
          id,
          method: 'Runtime.evaluate',
          params: { expression, returnByValue: true, awaitPromise: true, userGesture },
        }),
      );
    });

  const probe = createProbe(evaluate);
  return {
    ...probe,
    /**
     * The transport, exposed deliberately and named so it can be grepped.
     *
     * It exists for two callers: a stimulus that needs `userGesture` (a real click), and a script
     * whose reading is gated by its **own separately tested predicate** — `step70-watch.mjs`, whose
     * gate lives in `step70-gate.mjs` with its own fixtures precisely so it can be read and tested
     * without a phone ringing.
     *
     * It is not a way around the control. A number that is going to be written into
     * `docs/testing.md` goes through [read], which will not run without one. The point of the scan
     * in `probe.test.mjs` is that there is **one transport**, not that there is one caller.
     */
    rawEvaluate: evaluate,

    /**
     * A PNG of the page, base64, for `shot.mjs`.
     *
     * A picture is not a reading and nothing here quotes a pixel — which is exactly why it does not
     * go through [read]: a `control` on an image would be theatre. The preconditions that make a
     * shot comparable (not zoomed, the routed pane is the visible one) are `shot.mjs`'s, taken
     * through `act` and `rawEvaluate`, and they **gate the capture** rather than sitting beside it.
     */
    rawCapture: async ({ clip } = {}) => {
      const result = await send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: Boolean(clip),
        ...(clip ? { clip } : {}),
      });
      return result.data;
    },

    /**
     * Emulate a viewport, for `shot.mjs --viewport=WxH`. `null` clears it.
     *
     * The third use of the transport, and the reason: the design's demo size is 1440 × 920 and the
     * owner's display offers 841px of window height, so a shot at the size the design is scored at
     * cannot be taken from the real window at all. Emulation changes the layout viewport only —
     * the sidecar says so — and `shot.mjs` clears it after every capture, because a window left
     * emulated is a live app drawn at a size nobody chose.
     */
    rawEmulate: async (viewport) => {
      if (!viewport) {
        await send('Emulation.clearDeviceMetricsOverride', {});
        return;
      }
      await send('Emulation.setDeviceMetricsOverride', {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: viewport.dpr ?? 0,
        mobile: false,
      });
    },

    close: () => ws.close(),
  };
}
