/**
 * Enough of the DOM to construct and drive a renderer view class in a test.
 *
 * ### Why this exists — three sightings, one cause
 *
 * `showsState` (Files pane), the missing Restore row, and a watcher send that never reached the
 * list: three breaks, all in the renderer, all with a green suite. The cause is the same each time
 * and it is structural rather than careless — **the view classes are reachable by no test.** The
 * renderer is loaded as plain `<script>` tags, so the seam rule hangs the *pure* halves on
 * `globalThis`, and everything that actually draws was left outside. `clipboard.test.ts` went
 * further and deleted `class ClipboardView` from the source before evaluating it.
 *
 * Two of the three defects were in that class.
 *
 * ### What this is, said plainly, because it is a model
 *
 * **This is a model of the DOM, and `CLAUDE.md` is right that a test which models the thing under
 * test can stop being able to fail.** The mitigation is knowing exactly which half is modelled:
 *
 * - The **view class** is the real one. It is imported and executed, not re-implemented, not
 *   regex-stripped, not paraphrased in the test.
 * - The **DOM** is this double. So a bug in *browser* semantics — cascade order, layout, focus,
 *   event bubbling — is invisible here and always will be.
 *
 * That division is the point rather than a compromise. All three sightings were view-class logic:
 * which element got which text, whether a refresh was triggered, which of two homes drew a line.
 * None needed a browser. The things that *do* need one keep going through `scripts/probe.mjs`
 * against the real page, and the two are not substitutes: this one runs in milliseconds on every
 * commit, that one reads what a person would actually see.
 *
 * When a view starts depending on real layout, this double will not tell you — and the honest
 * response is a probe read, not a bigger double.
 */

type Listener = (event: unknown) => void;

export class FakeElement {
  readonly children: FakeElement[] = [];
  readonly listeners = new Map<string, Listener[]>();

  className = '';
  hidden = false;
  type = '';
  checked = false;
  /** How many times [focus] was called. Storage only — see that method. */
  focusCount = 0;
  /**
   * Layout and scroll numbers, as **storage with no layout behind them**.
   *
   * They are here because views read them — the notifications pane anchors its scroll to a row so
   * an arriving notification does not throw the reader back to the top. A test can set them to
   * construct a scrolled list and assert what the view does with the numbers; what it can never
   * assert is that the numbers are *right*, because nothing here lays anything out. That division
   * is the same one this file states for the DOM as a whole, and it is why the scroll-anchoring
   * behaviour itself belongs to a probe read against the real page.
   */
  scrollTop = 0;
  scrollHeight = 0;
  clientHeight = 0;
  offsetTop = 0;
  offsetHeight = 0;
  selectionStart: number | null = null;
  disabled = false;
  title = '';
  /** Form-control fields. Storage only: the double has no validation and no range clamping. */
  id = '';
  htmlFor = '';
  min = '';
  max = '';
  value = '';
  /**
   * Attributes, `style` and `dataset` as plain maps.
   *
   * Added when the Activity pane needed them, and added here rather than worked around in that
   * pane's test — this file's own instruction. They are storage and nothing more: the double has
   * no cascade and no layout, so a `style` written here proves the view *set* something, never
   * that anything was painted. That is the same division the header states for the DOM as a whole.
   */
  readonly attributes = new Map<string, string>();
  /**
   * `style` as a plain map, plus the two methods a custom property needs.
   *
   * `el.style.foo = 'x'` covers a named property; a **custom** property has to go through
   * `setProperty`, because `--tint` is not a valid identifier. The notifications pane sets one per
   * row, so without these the whole pane throws rather than drawing. Storage either way: there is
   * no cascade and no layout here, so a `style` written proves the view *set* something and never
   * that anything was painted.
   */
  readonly style: Record<string, string> & {
    setProperty(name: string, value: string): void;
    getPropertyValue(name: string): string;
  } = Object.assign(Object.create(null) as Record<string, string>, {
    setProperty(this: Record<string, string>, name: string, value: string) {
      this[name] = value;
    },
    getPropertyValue(this: Record<string, string>, name: string) {
      return this[name] ?? '';
    },
  });
  readonly dataset: Record<string, string> = {};
  /** Set by `createElementNS`, so a test can tell an `<svg>` subtree from an HTML one. */
  namespace: string | null = null;

  /**
   * This element's own text, when it has no element children.
   *
   * Declared explicitly, and the reason is worth a line: it was **accidentally deleted** while this
   * file was being extended for the Activity pane, and `tsc` never noticed — `tsconfig.json`
   * excludes `*.testkit.ts` from the project, so the harness every view test runs through is the
   * one file in `src/` that is not typechecked. The symptom was `textContent` returning `undefined`
   * from a fresh element where a real one returns `''`, which is the sort of thing a test asserts
   * around rather than reports.
   */
  private ownText = '';

  constructor(readonly tagName: string) {}

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    // `class` and `className` are the same thing in a browser, and an SVG element can only be
    // classed the first way — `className` on an SVGElement is a read-only SVGAnimatedString. A
    // double that kept them apart would make `queryAll('.foo')` silently miss every SVG node, which
    // is the hidden-grid failure rebuilt inside the harness.
    if (name === 'class') this.className = value;
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  /** Concatenates children like the real one, so a container's text is its subtree's text. */
  get textContent(): string {
    if (this.children.length === 0) return this.ownText;
    return this.children.map((child) => child.textContent).join('');
  }

  set textContent(value: string) {
    this.children.length = 0;
    this.ownText = value;
  }

  /**
   * Turn this element's own text into a leading text node, so appending after setting keeps both.
   *
   * The double used to drop it: `el.textContent = 'why'` followed by `el.appendChild(hint)` read
   * back as just the hint, because the getter preferred children over `ownText`. A real DOM keeps
   * the text node and returns `'why hint'`. That is exactly the shape `RemoteView.showNotice`
   * writes — a reason, then a fix hint appended beside it — so the double was silently deleting the
   * more important half of a refusal message and a test asserting on it would have failed for a
   * reason that had nothing to do with the pane.
   */
  private absorbOwnText(): void {
    if (this.ownText === '' || this.children.length > 0) return;
    const node = new FakeElement('#text');
    node.ownText = this.ownText;
    this.children.push(node);
    this.ownText = '';
  }

  get classList() {
    const write = (mutate: (names: Set<string>) => void) => {
      const names = new Set(this.className.split(' ').filter(Boolean));
      mutate(names);
      this.className = [...names].join(' ');
    };
    return {
      toggle: (name: string, on: boolean) => write((names) => (on ? names.add(name) : names.delete(name))),
      add: (...added: string[]) => write((names) => added.forEach((n) => names.add(n))),
      remove: (...removed: string[]) => write((names) => removed.forEach((n) => names.delete(n))),
      contains: (name: string) => this.className.split(' ').includes(name),
    };
  }

  /** Set by every insertion, so [closest] has a chain to walk. */
  parent: FakeElement | null = null;

  append(...kids: FakeElement[]): void {
    this.absorbOwnText();
    for (const kid of kids) kid.parent = this;
    this.children.push(...kids);
  }

  /** The single-child form. Real elements have both and views use whichever reads better. */
  appendChild(kid: FakeElement): FakeElement {
    this.absorbOwnText();
    kid.parent = this;
    this.children.push(kid);
    return kid;
  }

  replaceChildren(...kids: FakeElement[]): void {
    for (const gone of this.children) gone.parent = null;
    this.children.length = 0;
    this.ownText = '';
    for (const kid of kids) kid.parent = this;
    this.children.push(...kids);
  }

  addEventListener(type: string, fn: Listener): void {
    const existing = this.listeners.get(type) ?? [];
    existing.push(fn);
    this.listeners.set(type, existing);
  }

  /** Fires a listener the way a person would. Used by tests as `click()` / `change()`. */
  dispatch(type: string): void {
    for (const fn of this.listeners.get(type) ?? []) fn({ type, target: this });
  }

  click(): void {
    this.dispatch('click');
  }

  /**
   * Records that focus was asked for; it does not model focus.
   *
   * Added when the Calls dialler started calling it — the double's own instruction is to extend it
   * rather than work around it. What a test may assert is that a view *asked* for focus. Whether
   * anything is focused, whether a `focus` event fired, and what `:focus-visible` then paints are
   * browser semantics this file does not have and never claims to.
   */
  focus(): void {
    this.focusCount += 1;
  }

  /** Storage, like the layout numbers. The double has no selection model. */
  setSelectionRange(start: number, _end: number): void {
    this.selectionStart = start;
  }

  /**
   * `closest`, over the same tiny grammar as [queryAll], walking up through [parent].
   *
   * Added for the notifications pane, which asks whether the focused input is inside its reply box.
   * It needs a parent chain, which is why [parent] exists — the double had none until now, and a
   * `closest` that always answered `null` would have made the pane's focus rule untestable *and*
   * silently green.
   */
  closest(selector: string): FakeElement | null {
    let node: FakeElement | null = this;
    while (node) {
      if (node.matches(selector)) return node;
      node = node.parent;
    }
    return null;
  }

  /**
   * `matches` for the handful of selectors views actually use.
   *
   * `:active` is answered **false**, always, and that is a real limitation rather than a stub: the
   * double has no pointer, so a view that branches on `:active` is untested on that branch here.
   * `RemoteView.tick` does exactly that — it skips redrawing a slider the user is dragging — so the
   * dragging half of that behaviour belongs to a probe read and not to this file. Saying so is the
   * point; a `matches` that silently returned false for everything would look like coverage.
   */
  matches(selector: string): boolean {
    if (selector === ':active') return false;
    if (selector.startsWith('.')) return this.className.split(' ').includes(selector.slice(1));
    return this.tagName === selector;
  }

  /** First match, or null. Same tiny grammar as [queryAll], and the same refusal on anything else. */
  querySelector(selector: string): FakeElement | null {
    return this.queryAll(selector)[0] ?? null;
  }

  /** Every descendant, self excluded — the walk `queryAll` is built on. */
  descendants(): FakeElement[] {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }

  /**
   * A deliberately tiny selector engine: `tag`, `.class`, `tag.class`, and a **descendant chain**
   * of those separated by spaces (`.notif-reply input`). Nothing else — no `>`, no attributes, no
   * commas.
   *
   * It refuses anything it does not understand rather than returning `[]`, because a selector this
   * cannot parse silently matching nothing is the *hidden grid* failure from `CLAUDE.md` rebuilt
   * inside the test harness — a query that cannot see its target reporting an absence.
   *
   * The descendant form was added for the notifications pane, which reaches its reply input as
   * `.notif-reply input`. It is a **descendant** match and not a child match, which is what the
   * space means in CSS; anyone adding `>` should add it explicitly rather than letting this stand
   * in for it.
   */
  queryAll(selector: string): FakeElement[] {
    const steps = selector.trim().split(/\s+/);
    if (steps.length === 0) {
      throw new Error(`domDouble: unsupported selector ${JSON.stringify(selector)} — extend the double rather than working around it`);
    }
    let scope: FakeElement[] = [this];
    for (const step of steps) {
      const match = /^([a-z]+)?(?:\.([\w-]+))?$/.exec(step);
      if (!match || (!match[1] && !match[2])) {
        throw new Error(`domDouble: unsupported selector ${JSON.stringify(selector)} — extend the double rather than working around it`);
      }
      const [, tag, className] = match;
      const next: FakeElement[] = [];
      for (const root of scope) {
        for (const el of root.descendants()) {
          if ((!tag || el.tagName === tag) && (!className || el.className.split(' ').includes(className))) {
            if (!next.includes(el)) next.push(el);
          }
        }
      }
      scope = next;
    }
    return scope;
  }
}

/**
 * The document double. Views build their own subtrees, so only the two factories are needed.
 *
 * `createElementNS` is here because a pane that draws a chart draws SVG, and a double that silently
 * had no `createElementNS` would fail with a `TypeError` in the test rather than covering the pane
 * — which is the same outcome as not testing it, arrived at more confusingly.
 */
export function installFakeDocument(): { restore: () => void } {
  const before = (globalThis as Record<string, unknown>).document;
  (globalThis as Record<string, unknown>).document = {
    createElement: (tag: string) => new FakeElement(tag),
    createElementNS: (ns: string, tag: string) => {
      const element = new FakeElement(tag);
      element.namespace = ns;
      return element;
    },
    // A text node is an element with no tag as far as this double is concerned — `textContent`
    // concatenation up the tree is the only property any view reads it for.
    createTextNode: (text: string) => {
      const node = new FakeElement('#text');
      node.textContent = text;
      return node;
    },
    /**
     * **Always null unless a test sets it.** The double has no focus model — nothing here can take
     * focus, and [FakeElement.focus] only records that it was asked for.
     *
     * It exists because a view reading `document.activeElement` would otherwise get `undefined` and
     * die on the `instanceof` below. A test that wants the focused-input branch assigns this
     * directly, which is the honest shape: the branch is exercised, and the *focus* is a fiction the
     * test is declaring rather than a state the harness produced.
     */
    activeElement: null as FakeElement | null,
  };
  /*
   * `HTMLInputElement` exists so `active instanceof HTMLInputElement` is answerable at all.
   * `FakeElement` extends it, so **every** double element passes that check — the double cannot
   * tell an input from a div, and a view relying on the distinction alone is untested here. The
   * notifications pane does not: it narrows with `closest('.notif-reply')` immediately after, which
   * this double does model.
   */
  if (!(globalThis as Record<string, unknown>).HTMLInputElement) {
    (globalThis as Record<string, unknown>).HTMLInputElement = FakeElement;
  }
  return {
    restore: () => {
      (globalThis as Record<string, unknown>).document = before;
    },
  };
}

/**
 * A `window` with timers that **do not fire**, and one that says so.
 *
 * Views schedule work on `setInterval` and `setTimeout` — a progress bar that ticks, a notice that
 * clears itself after six seconds. Letting those run under `node --test` makes a test's result
 * depend on how long the process happened to take, which is a flake generator; letting them be
 * `undefined` makes the constructor throw.
 *
 * So they are recorded and never run, and the recording is exposed: a test can assert *that* a
 * timer was scheduled, and can run one deliberately with [fireTimer]. What it cannot do is wait for
 * one, which is the honest division — anything that genuinely needs wall-clock behaviour is a probe
 * read against the real window.
 */
export function installFakeWindow(): {
  restore: () => void;
  timers: { id: number; kind: 'timeout' | 'interval'; delay: number; fn: () => void }[];
  fireTimer: (id: number) => void;
} {
  const before = (globalThis as Record<string, unknown>).window;
  const timers: { id: number; kind: 'timeout' | 'interval'; delay: number; fn: () => void }[] = [];
  let next = 1;
  const schedule = (kind: 'timeout' | 'interval') => (fn: () => void, delay = 0) => {
    const id = next++;
    timers.push({ id, kind, delay, fn });
    return id;
  };
  const cancel = (id: number) => {
    const at = timers.findIndex((t) => t.id === id);
    if (at >= 0) timers.splice(at, 1);
  };
  (globalThis as Record<string, unknown>).window = {
    setTimeout: schedule('timeout'),
    setInterval: schedule('interval'),
    clearTimeout: cancel,
    clearInterval: cancel,
    requestAnimationFrame: (fn: () => void) => {
      fn();
      return 0;
    },
  };
  return {
    restore: () => {
      (globalThis as Record<string, unknown>).window = before;
    },
    timers,
    fireTimer: (id: number) => timers.find((t) => t.id === id)?.fn(),
  };
}

/** One element, ready to be handed to a view constructor. */
export function el(tagName = 'div', className = ''): FakeElement {
  const element = new FakeElement(tagName);
  element.className = className;
  return element;
}
