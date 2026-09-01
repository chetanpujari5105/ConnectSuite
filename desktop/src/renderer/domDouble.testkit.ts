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
  disabled = false;
  private ownText = '';

  constructor(readonly tagName: string) {}

  /** Concatenates children like the real one, so a container's text is its subtree's text. */
  get textContent(): string {
    if (this.children.length === 0) return this.ownText;
    return this.children.map((child) => child.textContent).join('');
  }

  set textContent(value: string) {
    this.children.length = 0;
    this.ownText = value;
  }

  get classList() {
    return {
      toggle: (name: string, on: boolean) => {
        const names = new Set(this.className.split(' ').filter(Boolean));
        if (on) names.add(name);
        else names.delete(name);
        this.className = [...names].join(' ');
      },
      contains: (name: string) => this.className.split(' ').includes(name),
    };
  }

  append(...kids: FakeElement[]): void {
    this.children.push(...kids);
  }

  replaceChildren(...kids: FakeElement[]): void {
    this.children.length = 0;
    this.ownText = '';
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

  /** Every descendant, self excluded — the walk `queryAll` is built on. */
  descendants(): FakeElement[] {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }

  /**
   * A deliberately tiny selector engine: `tag`, `.class`, and `tag.class`. Nothing else.
   *
   * It refuses anything it does not understand rather than returning `[]`, because a selector this
   * cannot parse silently matching nothing is the *hidden grid* failure from `CLAUDE.md` rebuilt
   * inside the test harness — a query that cannot see its target reporting an absence.
   */
  queryAll(selector: string): FakeElement[] {
    const match = /^([a-z]+)?(?:\.([\w-]+))?$/.exec(selector.trim());
    if (!match || (!match[1] && !match[2])) {
      throw new Error(`domDouble: unsupported selector ${JSON.stringify(selector)} — extend the double rather than working around it`);
    }
    const [, tag, className] = match;
    return this.descendants().filter(
      (el) =>
        (!tag || el.tagName === tag) && (!className || el.className.split(' ').includes(className)),
    );
  }
}

/** The document double. Only `createElement` is needed: views build their own subtrees. */
export function installFakeDocument(): { restore: () => void } {
  const before = (globalThis as Record<string, unknown>).document;
  (globalThis as Record<string, unknown>).document = {
    createElement: (tag: string) => new FakeElement(tag),
  };
  return {
    restore: () => {
      (globalThis as Record<string, unknown>).document = before;
    },
  };
}

/** One element, ready to be handed to a view constructor. */
export function el(tagName = 'div', className = ''): FakeElement {
  const element = new FakeElement(tagName);
  element.className = className;
  return element;
}
