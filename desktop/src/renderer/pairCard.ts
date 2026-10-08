/**
 * The pairing card's two shapes — the code (`34:11219`) and *No network* (`34:12152`).
 *
 * ### Why this file exists rather than four lines in `renderer.ts`
 *
 * `renderer.ts` is reachable by no test, and this is defect 67's exact shape: a rule about **when**
 * a screen changes, written where only a person looking at the screen can see it. The decision
 * (`pairCardView`) and the write (`applyPairCard`) are both here so a test can drive the
 * transition in both directions, which is the half that goes wrong — a screen that enters a state
 * correctly and never leaves it looks perfect in every screenshot anybody takes of it.
 *
 * ### The card is not merely hidden in the second shape
 *
 * The handoff: *"No network replaces the code with an explanation, because a code carries an
 * address and there is none to put in one."* So the title changes too. *"Scan this with your
 * phone"* over an explanation of why there is nothing to scan is the status island's two-writers
 * failure in one card: each half current, the pair contradicting.
 *
 * Plain script, like `stateBlock.ts`: no `export`, the bindings at the foot.
 */

interface PairCardView {
  kind: 'code' | 'no-network' | 'code-failed' | 'phone-remembered';
  /** The card's `h2`. One writer for both shapes, so the two cannot drift apart. */
  title: string;
  /** Whether the QR plate, its note and the standing instructions are on the card at all. */
  showCode: boolean;
  /**
   * The label on the card's **one** control. In the code shape that is `#new-qr`; in the other it
   * is the state block's own action, and `#new-qr` is not drawn at all — *Show a fresh code* over
   * a card explaining there is no code is a button that would have to lie to be pressed.
   */
  action: string;
  headline: string;
  body: string;
}

const PAIR_CARD_CODE: PairCardView = {
  kind: 'code',
  title: 'Scan this with your phone',
  showCode: true,
  action: 'Show a fresh code',
  headline: '',
  body: '',
};

/**
 * The words, and they are chosen to say what is true of **this Mac** rather than of the phone.
 *
 * A person on this screen with no network has done nothing wrong and their phone is not at fault;
 * the sentence that would be easiest to write — *"couldn't reach your phone"* — is a claim this end
 * cannot support, because it never looked for one.
 */
const PAIR_CARD_NO_NETWORK: PairCardView = {
  kind: 'no-network',
  title: 'This Mac is not on a network',
  showCode: false,
  action: 'Check again',
  headline: 'There is no address to put in a code',
  body:
    'A pairing code carries the address your phone connects back to, and this Mac does not have ' +
    'one yet. Join the Wi-Fi your phone is on — or turn on the phone’s hotspot and join that — ' +
    'and the code appears here.',
};

/**
 * The third shape (2026-10-07): the main process could not make a code at all — `pairing-qr` rejected
 * (`Link not ready` in the first moments after launch, or the code could not be armed or drawn). Before
 * this, `showQr` let the rejection go unhandled and the card kept whatever it last showed, or nothing,
 * with no sentence. Found by the isolated renderer harness's `failing` mode. Nothing was paired and
 * nothing was sent, and the card says so rather than guessing at a cause it was not told.
 */
const PAIR_CARD_FAILED: PairCardView = {
  kind: 'code-failed',
  title: 'No pairing code yet',
  showCode: false,
  action: 'Try again',
  headline: 'This Mac could not make a pairing code',
  body:
    'Nothing was paired and nothing was sent to a phone. This can happen in the first moments after ' +
    'Sidekick opens. Try again; if it keeps happening, quit Sidekick and open it again.',
};

/**
 * The fourth shape (defect 207): this Mac still stores a phone, so its hello would not ask any phone
 * for a code, and a code drawn here would be refused (`TOKEN_MISSING`) however it was scanned. On
 * 2026-10-08 an identity change left exactly that — a stale record, an "armed" code that could never
 * pair, and *Forget this phone* only in Settings, which the pinned pairing screen hid. The way out is
 * on this card now, and the card says what pressing it does.
 */
function pairCardRemembered(phoneName: string | null): PairCardView {
  const who = phoneName ?? 'this phone';
  return {
    kind: 'phone-remembered',
    title: 'This Mac still remembers a phone',
    showCode: false,
    action: `Forget ${who}`,
    headline: `Paired with ${phoneName ?? 'a phone'}`,
    body:
      'A pairing code only works once this Mac has forgotten the phone it is paired with. If that ' +
      'phone no longer connects — after reinstalling Sidekick on either side, or after this Mac’s key ' +
      'changed — forget it here, then scan the new code. Forgetting ends any connection to it now. ' +
      'Remove this Mac on the phone too, under Paired Macs.',
  };
}

function pairCardView(reachable: boolean | 'failed' | { remembered: string | null }): PairCardView {
  if (typeof reachable === 'object') return pairCardRemembered(reachable.remembered);
  if (reachable === 'failed') return PAIR_CARD_FAILED;
  return reachable ? PAIR_CARD_CODE : PAIR_CARD_NO_NETWORK;
}

interface PairCardNodes {
  title: HTMLElement;
  /** The standing *open ConnectSuite on the phone…* paragraph. Rich markup, so it is hidden, never rewritten. */
  sub: HTMLElement;
  qr: HTMLElement;
  note: HTMLElement;
  /** Where the explanation is drawn. Empty and hidden in the code shape. */
  offline: HTMLElement;
  button: HTMLElement;
}

/**
 * Applies a view to the card. Every node is written on every call — including the ones the shape
 * does not use — because a write that only ever turns things *off* is a state a screen can enter
 * and not leave.
 */
function applyPairCard(nodes: PairCardNodes, view: PairCardView, recheck: () => void): void {
  nodes.title.textContent = view.title;
  nodes.sub.hidden = !view.showCode;
  nodes.qr.hidden = !view.showCode;
  nodes.note.hidden = !view.showCode;
  nodes.button.hidden = !view.showCode;
  if (view.showCode) nodes.button.textContent = view.action;

  nodes.offline.replaceChildren();
  nodes.offline.hidden = view.showCode;
  if (!view.showCode) {
    nodes.offline.appendChild(
      stateBlock({
        kind: 'blocked',
        headline: view.headline,
        body: view.body,
        action: { label: view.action, run: recheck },
        compact: true,
      }),
    );
  }
}

{
  const g = globalThis as Record<string, unknown>;
  g.pairCardView = pairCardView;
  g.applyPairCard = applyPairCard;
}
