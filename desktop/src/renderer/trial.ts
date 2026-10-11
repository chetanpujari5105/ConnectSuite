/**
 * The beta trial on the Mac's screen (2026-10-12): the screen shown in place of a phone pane while
 * access is not valid, the token entry used there and in Settings › About, the quiet days-left line,
 * and the two gentle notices.
 *
 * It **draws** a verdict and never takes one: every sentence and every state comes from the main
 * process (`src/main/trial.ts`, copy in `src/shared/trial.ts`), where the token is verified and the
 * link is gated. A renderer that decided access itself would be a second writer of one fact.
 *
 * Activity and Settings are never covered — what a person has is never hidden or deleted, and Activity
 * can still be exported. Module-free like the other panes; the class hangs on `globalThis` for
 * `trialView.test.ts`.
 */

interface TrialCheckView {
  state: 'not-enforced' | 'no-key' | 'none' | 'clock-back' | 'not-yet' | 'expired' | 'valid';
  blocks: boolean;
  label: string | null;
  notAfter: string | null;
  daysLeft: number;
  headline: string;
  body: string;
  line: string;
  notice: { days: 7 | 1; text: string } | null;
}

interface TrialResult {
  ok: boolean;
  cancelled?: boolean;
  message: string;
  data: TrialCheckView;
}

interface TrialBridge {
  trialStatus(): Promise<{ ok: boolean; data: TrialCheckView }>;
  trialEnter(text: string): Promise<TrialResult>;
  trialOpenFile(): Promise<TrialResult>;
  trialNoticeShown(days: 7 | 1): Promise<unknown>;
}

/** The two panes that stay open whatever the trial says: what is the person's is never hidden. */
const TRIAL_OPEN_ROUTES: readonly string[] = ['activity', 'settings'];

class TrialView {
  private verdict: TrialCheckView | null = null;
  /**
   * The last thing the entry said, kept across redraws so a refusal does not vanish on a re-check —
   * and tied to the state it answered, so it goes when that state does. A thank-you under a later
   * *"your date looks earlier"* or *"ended on"* screen thanked the person for access being refused
   * (2026-10-12, seen on the clock-back screen).
   */
  private message: { ok: boolean; text: string; state: TrialCheckView['state'] | null } | null = null;
  private busy = false;

  constructor(
    private readonly bridge: TrialBridge,
    /** `#trial-gate`, inside `#page`. */
    private readonly gate: HTMLElement,
    private readonly hooks: {
      toast(text: string): void;
      route(id: string): void;
      paired(): boolean;
      /** Told after every verdict, so the shell can re-apply the gate and Settings can redraw. */
      changed(): void;
    },
  ) {}

  /** Asks the main process once; afterwards `trial-changed` pushes. */
  async load(): Promise<void> {
    const result = await this.bridge.trialStatus().catch(() => null);
    if (result?.ok) this.apply(result.data);
  }

  apply(verdict: TrialCheckView): void {
    this.verdict = verdict;
    if (this.message && this.message.state !== verdict.state) this.message = null;
    this.drawGate();
    if (verdict.notice) {
      const days = verdict.notice.days;
      this.hooks.toast(verdict.notice.text);
      void this.bridge.trialNoticeShown(days).catch(() => undefined);
    }
    this.hooks.changed();
  }

  /** Redraws the screen for the verdict already held — no notice is repeated. */
  redraw(): void {
    this.drawGate();
    this.hooks.changed();
  }

  /** The page subtitle while the screen covers a pane: the verdict's own quiet line. */
  subtitle(): string {
    return this.verdict?.line ?? '';
  }

  /** Whether `routeId` is covered by the trial screen right now. */
  covers(routeId: string): boolean {
    return this.verdict?.blocks === true && !TRIAL_OPEN_ROUTES.includes(routeId);
  }

  /** The quiet line and the entry, for Settings › About. */
  settingsBlock(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'trial-settings';
    const line = document.createElement('p');
    line.className = 'trial-line';
    line.id = 'trial-line';
    line.textContent = this.verdict?.line ?? 'Checking beta access…';
    wrap.appendChild(line);
    if (this.verdict && this.verdict.state !== 'not-enforced') wrap.appendChild(this.entry('settings'));
    return wrap;
  }

  private drawGate(): void {
    this.gate.replaceChildren();
    const v = this.verdict;
    if (!v || !v.blocks) return;
    this.gate.appendChild(
      stateBlock({ kind: v.state === 'no-key' ? 'error' : 'permission', headline: v.headline, body: v.body }),
    );
    if (v.state !== 'no-key') this.gate.appendChild(this.entry('gate'));
    if (this.hooks.paired()) {
      const doors = document.createElement('div');
      doors.className = 'trial-doors';
      for (const [route, label] of [['activity', 'Open Activity'], ['settings', 'Open Settings']] as const) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'button secondary';
        b.textContent = label;
        b.addEventListener('click', () => this.hooks.route(route));
        doors.appendChild(b);
      }
      this.gate.appendChild(doors);
    }
  }

  /** Paste or open a token. Built per surface, with ids that say which, so a driver names it. */
  private entry(where: 'gate' | 'settings'): HTMLElement {
    const box = document.createElement('div');
    box.className = 'trial-entry';
    const label = document.createElement('label');
    label.className = 'trial-entry-label';
    label.htmlFor = `trial-token-${where}`;
    label.textContent = this.verdict?.state === 'valid' ? 'Enter a new beta token' : 'Beta token';
    const field = document.createElement('textarea');
    field.id = `trial-token-${where}`;
    field.className = 'trial-token';
    field.rows = 3;
    field.spellcheck = false;
    field.placeholder = 'SIDEKICK-TRIAL-1.…';
    const actions = document.createElement('div');
    actions.className = 'trial-entry-actions';
    const use = document.createElement('button');
    use.type = 'button';
    use.id = `trial-use-${where}`;
    use.className = 'button primary-action';
    use.textContent = 'Use this token';
    const open = document.createElement('button');
    open.type = 'button';
    open.id = `trial-open-${where}`;
    open.className = 'button secondary';
    open.textContent = 'Open token file…';
    const said = document.createElement('p');
    said.className = 'trial-message';
    said.id = `trial-message-${where}`;
    said.setAttribute('role', 'status');
    if (this.message) {
      said.textContent = this.message.text;
      said.dataset.ok = String(this.message.ok);
    }
    const run = async (call: () => Promise<TrialResult>) => {
      if (this.busy) return;
      this.busy = true;
      use.disabled = true;
      open.disabled = true;
      const result = await call().catch(() => null);
      this.busy = false;
      use.disabled = false;
      open.disabled = false;
      if (result?.cancelled) return;
      // The answer is recorded against the verdict it came with, before that verdict is applied — so
      // applying it keeps the answer, and the redraw it causes (the gate here, Settings via `changed`)
      // draws it. Clearing first and writing after is what lost a refusal made in Settings while access
      // was valid, and threw on the way (2026-10-12).
      this.message = result
        ? { ok: result.ok, text: result.message, state: result.data.state }
        : { ok: false, text: 'Sidekick could not check that token. Try again.', state: this.verdict?.state ?? null };
      said.textContent = this.message.text;
      said.dataset.ok = String(this.message.ok);
      if (result) this.apply(result.data);
      else this.hooks.changed();
      if (result?.ok) this.hooks.toast(result.message);
    };
    use.addEventListener('click', () => {
      const text = field.value.trim();
      if (!text) {
        this.message = { ok: false, text: 'Paste the token first — it starts with SIDEKICK-TRIAL-1.', state: this.verdict?.state ?? null };
        said.textContent = this.message.text;
        said.dataset.ok = 'false';
        return;
      }
      void run(() => this.bridge.trialEnter(text));
    });
    open.addEventListener('click', () => void run(() => this.bridge.trialOpenFile()));
    actions.append(use, open);
    box.append(label, field, actions, said);
    return box;
  }
}

(globalThis as Record<string, unknown>).TrialView = TrialView;
(globalThis as Record<string, unknown>).TRIAL_OPEN_ROUTES = TRIAL_OPEN_ROUTES;
