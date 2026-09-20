/**
 * The state block (Figma component 11, `28:1226`) and the Disconnected banner (component 12,
 * `32:4380`) — one builder each, used by every pane.
 *
 * `docs/empty-and-failure-states.md` counted **five competing vocabularies** for the same six facts
 * across nineteen panes. The handoff settles it (§5, component 11), and this file is where the
 * settlement lives, so a pane cannot invent a seventh by writing its own markup:
 *
 * | Kind | The fact | Action |
 * |---|---|---|
 * | `empty` | nothing has arrived yet, and what would make something arrive | optional |
 * | `unavailable` | the feature is not built; carries a mono handle | none |
 * | `loading` | what is being read, with a count where one exists | none |
 * | `permission` | the phone's own reason, and where to fix it | one, only if the user can act |
 * | `error` | what happened, what was *not* changed, the machine code in mono | retry |
 * | `wall` | the platform forbids it | **never** — there is nothing to retry |
 * | `blocked` | a precondition **this end** owes is missing, and the user can supply it | one |
 *
 * `blocked` is the seventh and was added for pairing's *No network* (`34:12152`). It is not one of
 * the six wearing a different name: `permission` is the *phone's* refusal, `wall` is the
 * *platform's*, `error` is an operation that ran and failed — and this is an operation that cannot
 * start because something on this Mac is absent. Drawing it as `permission` would tell a person
 * their phone had refused something; as `error`, that something broke; as `empty`, that nothing had
 * arrived yet. It takes `permission`'s amber, because it is a real limitation, and it keeps an
 * action, because unlike a `wall` there is one.
 *
 * The wall rule is enforced here rather than trusted to callers: an action handed to a `wall` is
 * dropped and the block records that it was (`data-refused-action`), so the test can see the refusal
 * rather than an absence that could mean anything.
 *
 * Tone is the **state's**, never the pane's: amber for permission and wall (a real limitation), red
 * for error (a real failure), neutral for the rest. No lime — lime is not allowed on a state.
 *
 * Plain script, like `icons.ts`: no `export`, the builders hung on `globalThis` at the foot.
 */

type StateKind = 'empty' | 'unavailable' | 'loading' | 'permission' | 'error' | 'wall' | 'blocked';

interface StateAction {
  label: string;
  icon?: string;
  run: () => void;
}

interface StateBlockSpec {
  kind: StateKind;
  headline: string;
  body?: string;
  /** A mono line: the wire namespace for `unavailable`, the machine code for `error`. */
  code?: string;
  /** Overrides the kind's default glyph — an `empty` block may carry its pane's own icon. */
  icon?: string;
  action?: StateAction;
  /** `compact` sits inside a column; the default sits centred in a pane-sized region. */
  compact?: boolean;
}

declare function iconSvg(name: string, size?: number): SVGSVGElement;

/** The glyph each kind draws when the caller names none. Every name is in `iconNamesUsedByTheShell`. */
const STATE_ICONS: Record<StateKind, string> = {
  empty: 'info',
  unavailable: 'info',
  loading: 'spinner',
  permission: 'lock',
  error: 'x-circle',
  wall: 'alert',
  blocked: 'link-minus',
};

/** Which kinds may carry an action at all. `wall` is the one that may not, ever. */
function stateAllowsAction(kind: StateKind): boolean {
  return kind !== 'wall' && kind !== 'unavailable' && kind !== 'loading';
}

/** The tone a kind draws in. Pure, so the test asserts the rule rather than a class name. */
function stateTone(kind: StateKind): 'neutral' | 'warning' | 'danger' {
  if (kind === 'error') return 'danger';
  if (kind === 'permission' || kind === 'wall' || kind === 'blocked') return 'warning';
  return 'neutral';
}

function stateBlock(spec: StateBlockSpec): HTMLElement {
  const block = document.createElement('div');
  block.className = `state-block${spec.compact ? ' compact' : ''}`;
  block.dataset.kind = spec.kind;
  block.dataset.tone = stateTone(spec.kind);
  // A loading block announces itself; the others are read when reached.
  block.setAttribute('role', spec.kind === 'loading' ? 'status' : 'group');

  const badge = document.createElement('span');
  badge.className = 'state-badge';
  badge.setAttribute('aria-hidden', 'true');
  badge.appendChild(iconSvg(spec.icon ?? STATE_ICONS[spec.kind], spec.compact ? 18 : 24));
  block.appendChild(badge);

  const headline = document.createElement('div');
  headline.className = 'state-headline';
  headline.textContent = spec.headline;
  block.appendChild(headline);

  if (spec.body) {
    const body = document.createElement('p');
    body.className = 'state-body';
    body.textContent = spec.body;
    block.appendChild(body);
  }
  if (spec.code) {
    const code = document.createElement('div');
    code.className = 'state-code mono';
    code.textContent = spec.code;
    block.appendChild(code);
  }
  if (spec.action) {
    if (!stateAllowsAction(spec.kind)) {
      block.dataset.refusedAction = spec.action.label;
    } else {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'button secondary state-action';
      if (spec.action.icon) {
        const glyph = iconSvg(spec.action.icon, 14);
        glyph.setAttribute('aria-hidden', 'true');
        button.appendChild(glyph);
      }
      button.appendChild(document.createTextNode(spec.action.label));
      button.addEventListener('click', () => spec.action!.run());
      block.appendChild(button);
    }
  }
  return block;
}

/**
 * `09:42`, the time last-known content was true. The handoff: *"content stays, timestamped
 * `as of 09:42`"*. Null when nothing was ever received, so the banner claims no moment it has not
 * got.
 */
function asOfLabel(atMs: number | null): string | null {
  if (!atMs) return null;
  return new Date(atMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

/**
 * The Disconnected component's pane banner. The pane keeps its content and says how old it is;
 * nothing is queued, and the sentence says so because that is what a person worries about first.
 */
function disconnectedBanner(what: string, asOfMs: number | null): HTMLElement {
  const banner = document.createElement('div');
  banner.className = 'disconnected-banner';
  banner.setAttribute('role', 'status');
  const glyph = document.createElement('span');
  glyph.className = 'disconnected-glyph';
  glyph.setAttribute('aria-hidden', 'true');
  glyph.appendChild(iconSvg('link-minus', 16));
  banner.appendChild(glyph);
  const text = document.createElement('span');
  text.className = 'disconnected-text';
  const at = asOfLabel(asOfMs);
  text.textContent = at
    ? `Your phone is not connected. ${what} as of ${at}; nothing is sent until it is back.`
    : `Your phone is not connected. Nothing is sent until it is back.`;
  banner.appendChild(text);
  return banner;
}

{
  const g = globalThis as Record<string, unknown>;
  g.stateBlock = stateBlock;
  g.disconnectedBanner = disconnectedBanner;
  g.__stateBlockRules = { STATE_ICONS, stateAllowsAction, stateTone, asOfLabel };
}
