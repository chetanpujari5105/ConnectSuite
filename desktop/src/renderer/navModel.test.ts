/**
 * The shell's route table and palette.
 *
 * Three things are asserted here that are otherwise only checkable by looking at the running app:
 *
 * 1. **Commands come before navigation in the palette.** The handoff's one explicit instruction
 *    about ⌘K. Shown to fail by swapping the two arrays in the `return` of `paletteResults`.
 * 2. **Every icon the shell asks for exists.** This is the other half of the empty-ring defect:
 *    `icons.test.ts` proves no icon is blank, and this proves the shell never asks for one that
 *    was never authored. Shown to fail by deleting `capture` from ICON_GEOMETRY.
 * 3. **Every unbuilt screen carries a reason, and no built screen carries one.** `CLAUDE.md`
 *    decision 6 as a test. Shown to fail by dropping `unbuiltReason` from Files.
 * 4. **Every deep link points at a screen that exists and an element that exists.** A palette row
 *    that routes nowhere is a keystroke swallowed in silence, which is the failure `runSelected`
 *    already refuses for commands. Shown to fail by pointing `deep.remote` at a deleted id.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  SCREENS,
  PAIRING_SCREEN,
  COMMANDS,
  DEEP_LINKS,
  TOOL_RAIL,
  GLOBAL_ACTIONS,
  iconNamesUsedByTheShell,
  overviewSubtitle,
  initialsFor,
  overviewTitle,
  paletteResults,
  screenById,
  pillOffsetFor,
} = require('./navModel.ts');
const { ICON_NAMES } = require('./icons.ts');

test('the palette puts every command before every navigation row', () => {
  const kinds = paletteResults('').map((r: { kind: string }) => r.kind);
  const firstNav = kinds.indexOf('navigation');
  const lastCommand = kinds.lastIndexOf('command');
  assert.ok(firstNav > -1 && lastCommand > -1, 'the palette should offer both kinds');
  assert.ok(
    lastCommand < firstNav,
    'a command ranked below a screen — the handoff puts commands first',
  );
});

test('control_the ordering assertion can see a palette in the wrong order', () => {
  // The check above is only worth its green if it can go red. Run the same predicate over a
  // deliberately reversed list.
  const reversed = [...paletteResults('')].reverse().map((r: { kind: string }) => r.kind);
  const firstNav = reversed.indexOf('navigation');
  const lastCommand = reversed.lastIndexOf('command');
  assert.ok(lastCommand > firstNav, 'the predicate failed to notice a reversed palette');
});

test('a query filters both halves and keeps commands on top', () => {
  const results = paletteResults('mirror');
  assert.ok(results.length > 1);
  assert.equal(results[0].kind, 'command');
  assert.ok(
    results.some((r: { id: string }) => r.id === 'mirror' ),
    'the Mirror screen should still be reachable by the same word',
  );
});

test('an unknown query returns nothing rather than everything', () => {
  // The failure mode worth guarding: a filter that falls back to the full list on no match looks
  // identical to a working filter until someone types a typo and gets eleven screens back.
  assert.deepEqual(paletteResults('zzzznotathing'), []);
});

test('every icon the shell asks for was actually authored', () => {
  for (const name of iconNamesUsedByTheShell()) {
    assert.ok(ICON_NAMES.includes(name), `the shell asks for icon "${name}" and it does not exist`);
  }
});

test('the enumeration covers the two glyphs the defect was about', () => {
  // Capture and Refresh are the icons that shipped as empty rings. The test above is only the
  // guard it claims to be if they are inside its list — an earlier version enumerated only the
  // sidebar and the dock, passed with `capture` deleted from icons.ts, and would have let the
  // exact defect through a second time.
  const asked = iconNamesUsedByTheShell();
  assert.ok(asked.includes('capture'), 'Capture is not covered by the icon guard');
  assert.ok(asked.includes('refresh'), 'Refresh is not covered by the icon guard');
  // Three since 2026-09-04: Capture, Refresh and Transfer (M5). The count is asserted rather than
  // left open because the rail is a composition the designer drew, and a fourth arriving without a
  // decision is the thing this line is here to make somebody notice.
  assert.equal(TOOL_RAIL.length, 3);
  assert.ok(asked.includes('files'), 'Transfer is not covered by the icon guard');
  assert.equal(GLOBAL_ACTIONS.length, 6, 'six actions performGlobalAction can genuinely perform');
});

test('every unbuilt screen says why, and no built screen pretends to', () => {
  for (const screen of SCREENS) {
    if (screen.state === 'unbuilt') {
      assert.ok(
        typeof screen.unbuiltReason === 'string' && screen.unbuiltReason.length > 30,
        `${screen.id} is unbuilt with no reason — decision 6 says it must say why`,
      );
      // "Coming soon" is the sentence that makes decision 6 useless. A reason names a phase or a
      // concrete missing piece.
      assert.doesNotMatch(
        screen.unbuiltReason,
        /coming soon|stay tuned|work in progress/i,
        `${screen.id}'s reason is a placeholder, not a reason`,
      );
    } else {
      assert.equal(
        screen.unbuiltReason,
        undefined,
        `${screen.id} is built but carries an unbuilt reason`,
      );
    }
  }
});

test('state A is complete on every unbuilt screen', () => {
  // `docs/mac-ui-design-proposals.md` §3 state A asks for four things, and a card missing one of
  // them degrades into the generic "nothing here" pattern the whole four-state model exists to
  // avoid. Asserting all four together, because three of four is the failure that looks fine.
  for (const screen of SCREENS.filter((s: { state: string }) => s.state === 'unbuilt')) {
    assert.ok(screen.unbuiltHeadline, `${screen.id} has no headline`);
    assert.ok(screen.unbuiltReason, `${screen.id} has no reason`);
    assert.ok(screen.unbuiltHandle, `${screen.id} has no wire handle`);
    // The headline must not simply restate the tag above it — that wastes the one line a reader is
    // guaranteed to take in.
    assert.doesNotMatch(screen.unbuiltHeadline, /^not built/i, `${screen.id}'s headline repeats the tag`);
  }
});

test('a screen with no proposed namespace says so rather than inventing one', () => {
  // A plausible-looking `clipboard.*` would send someone to docs/protocol.md looking for something
  // that was never designed. Only the two namespaces the Phase 5 proposals actually name may appear
  // as handles; everything else has to admit there is nothing to grep for.
  const proposed = new Set(['fs.*', 'media.*']);
  for (const screen of SCREENS.filter((s: { state: string }) => s.state === 'unbuilt')) {
    const named = /([a-z]+)\.\*/.exec(screen.unbuiltHandle);
    if (named) {
      assert.ok(
        proposed.has(named[0]),
        `${screen.id} names "${named[0]}", which no proposal defines`,
      );
    } else {
      assert.match(
        screen.unbuiltHandle,
        /no (wire )?namespace proposed|no session store/,
        `${screen.id}'s handle neither names a real namespace nor admits there is none`,
      );
    }
  }
});

test('the sidebar is the handoff eleven plus Apps, in its groups', () => {
  // Twelve, and the twelfth is a recorded departure (docs/design-departures.md): the handoff has no
  // Apps screen because it predates the feature. What this asserts is that it is the *only* one —
  // the count is here so that a thirteenth row cannot arrive without somebody deciding to.
  assert.equal(SCREENS.length, 12);
  assert.equal(SCREENS.filter((s: { group: string }) => s.group === 'MENU').length, 10);
  assert.equal(SCREENS.filter((s: { group: string }) => s.group === 'SYSTEM').length, 2);
  const apps = SCREENS.find((s: { id: string }) => s.id === 'apps');
  assert.ok(apps, 'Apps is a screen');
  // Appended, not inserted. Inserting it would renumber every shortcut after it, which is a much
  // larger departure wearing the same diff.
  assert.equal(SCREENS.filter((s: { group: string }) => s.group === 'MENU').at(-1)?.id, 'apps');
});

test('the Apps screen does not promise a launch', () => {
  // The wire name is apps.open.ask because this platform refuses a background activity start
  // silently. The subtitle is where a user first learns which of the two features this is, and
  // "launch apps from your Mac" would be the same lie one layer up from the protocol.
  const apps = SCREENS.find((s: { id: string }) => s.id === 'apps') as { subtitle: string; title: string };
  assert.doesNotMatch(apps.subtitle, /launch/i, 'the Mac does not launch anything; it asks');
  assert.doesNotMatch(apps.title, /launch/i);
  assert.match(apps.subtitle, /phone/i, 'it says where the tap happens');
});

test('no two screens share an id or a shortcut', () => {
  const ids = SCREENS.map((s: { id: string }) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  const keys = SCREENS.map((s: { shortcut: string }) => s.shortcut).filter((k: string) => k !== '');
  assert.equal(new Set(keys).size, keys.length);
  const commandKeys = COMMANDS.map((c: { shortcut: string }) => c.shortcut);
  assert.equal(new Set(commandKeys).size, commandKeys.length);
});

test('pairing is a route with no sidebar row', () => {
  /*
   * The design has no unpaired state at all (departures row X5). Pairing must be reachable and
   * must not add a twelfth row the designer never drew.
   *
   * **The last assertion used to read `paletteResults('pair').length === 0`** and it went red when
   * the trust deep link landed, carrying `pairing` among its keywords — a row that goes to
   * Settings → Connection and has nothing to do with the pairing screen.
   *
   * That is `CLAUDE.md`'s fourth test variety: an assertion whose subject is a **set** standing in
   * for a fact about **one** thing. The fact is *the pairing screen is not navigable from the
   * palette*; the proxy was *the word "pair" returns nothing*, which any unrelated feature can
   * break by being legitimately named. The count is not raised here — the question is split, and
   * both halves are asserted by name. A row targeting `pairing` still fails, whatever it is called.
   */
  assert.equal(screenById('pairing'), PAIRING_SCREEN);
  assert.equal(SCREENS.some((s: { id: string }) => s.id === 'pairing'), false);
  for (const query of ['pair', 'pairing', 'scan', 'qr', 'code']) {
    for (const row of paletteResults(query) as { id: string; screen?: string }[]) {
      assert.notEqual(row.id, 'pairing', `"${query}" offered the pairing screen`);
      assert.notEqual(row.screen, 'pairing', `"${query}" offered a deep link into pairing`);
    }
  }
});

test('the trust controls answer "pair", because that is what a stuck user types', () => {
  // The other half of the split above, asserted rather than left as a side effect. Somebody whose
  // phone will not pair reaches for the word "pair"; before this row they got nothing at all.
  const rows = paletteResults('pair') as { id: string; screen?: string }[];
  assert.ok(rows.some((r) => r.id === 'deep.trust'), 'nothing answers the commonest distress word');
  assert.ok(rows.every((r) => r.screen !== 'pairing'));
});

test('the pill never leaves the top of the nav, however the list is scrolled', () => {
  // The clamp exists because offsetTop is read from a scrollable nav; a negative offset would
  // park the pill above the first row.
  assert.equal(pillOffsetFor(0), 0);
  assert.equal(pillOffsetFor(228), 228);
  assert.equal(pillOffsetFor(-40), 0);
});


// ---- deep links: the three features the app's own search could not find ------------------------

const { readFileSync } = require('node:fs');
const { join } = require('node:path');

test('every deep link names a screen that exists', () => {
  assert.ok(DEEP_LINKS.length > 0, 'a scan over an empty list passes every assertion below it');
  for (const link of DEEP_LINKS) {
    assert.ok(
      screenById(link.screen),
      `${link.id} routes to "${link.screen}", which is not a screen`,
    );
  }
});

test('every deep link reveals an element index.html actually has', () => {
  // The model cannot see an element deleted from the page, so the page is read. This is the same
  // shape as BootAutoStartTest parsing the manifests: the property is about where a name appears,
  // and only a source scan can see it.
  const html = readFileSync(join(__dirname, 'index.html'), 'utf8');
  const ids = new Set([...html.matchAll(/id="([a-z0-9-]+)"/g)].map((m) => m[1]));
  // Control: the scan must find ids already known to be there, or "not found" means nothing.
  assert.ok(ids.has('remote-card') || ids.size > 20, `the id scan found ${ids.size} ids`);
  assert.ok(ids.size > 20, 'the id scan came back suspiciously empty');
  for (const link of DEEP_LINKS) {
    assert.ok(ids.has(link.reveal), `${link.id} reveals "${link.reveal}", which is not in index.html`);
  }
});

test('the deep link lives inside the screen it says it does', () => {
  // "In Overview" is a claim about where the card is, printed in the palette row. A link whose
  // reveal id sits in a different section would send the user to a screen the card is not on and
  // then flash nothing — a confident wrong answer of exactly the kind this project keeps finding.
  const html = readFileSync(join(__dirname, 'index.html'), 'utf8');
  const sections = [...html.matchAll(/<section class="screen" data-screen="([a-z]+)"/g)].map((m) => ({
    at: m.index,
    name: m[1],
  }));
  assert.ok(sections.length >= 10, `found ${sections.length} screen sections — the scan is wrong`);
  const screenOf = (id) => {
    const at = html.indexOf(`id="${id}"`);
    if (at < 0) return null;
    let current = null;
    for (const section of sections) {
      if (section.at <= at) current = section.name;
      else break;
    }
    return current;
  };
  for (const link of DEEP_LINKS) {
    assert.equal(
      screenOf(link.reveal),
      link.screen,
      `${link.id} says it is in "${link.screen}" and its card is in "${screenOf(link.reveal)}"`,
    );
  }
});

test("the searches that returned nothing on hardware now return the feature", () => {
  // The exact queries `scripts/homeless-features-probe.mjs` measured as empty on 2026-09-02, with
  // the control that a query for a screen still works.
  const found = (query) => paletteResults(query).map((r) => r.label);
  assert.ok(found('mirror').length > 0, 'control — the palette still answers a screen query');
  for (const query of ['music', 'playing', 'remote', 'playback', 'track']) {
    assert.ok(found(query).includes('Now playing'), `"${query}" must reach the media remote`);
  }
  for (const query of ['contact', 'people', 'phone book']) {
    assert.ok(found(query).includes('Contacts'), `"${query}" must reach contacts`);
  }
  /*
   * The two that `docs/phase-7-state.md` §3 lists as the seventh and eighth homeless features, and
   * the queries below are the ones measured empty on **2026-09-15**, control `mirror` → 6.
   *
   * The observation that made these worth adding is not that two rows were missing. It is that
   * **X5 is a snapshot**: both features shipped after the homeless list was written, both went into
   * a pane, and nobody re-asked whether search could find them. This test is the re-asking, made
   * automatic — a new deep-linkable feature that nobody adds a row for now fails here rather than
   * being discovered by a probe a phase later.
   */
  for (const query of ['restore', 'undo', 'displaced', 'replaced', 'put back']) {
    assert.ok(found(query).includes('Restore a replaced clip'), `"${query}" must reach the clipboard undo`);
  }
  for (const query of ['forget', 'trust', 'unpair', 'certificate']) {
    assert.ok(found(query).includes('Trusted device'), `"${query}" must reach the trust controls`);
  }
});

test('a deep link into Settings names its pane, because Settings swaps its body', () => {
  /*
   * Settings is the one screen that replaces its contents rather than scrolling them, so a deep
   * link that routes and stops lands on whichever pane was open last and flashes a card the target
   * is not in — a successful route that arrives nowhere, which is the silent no-op this whole
   * mechanism exists to refuse.
   *
   * Asserted as an invariant over every link rather than about `deep.trust`, so the next one into
   * Settings cannot be added without it.
   */
  const rows = paletteResults('') as { kind: string; screen?: string; settingsPane?: string }[];
  const intoSettings = rows.filter((r) => r.kind === 'deep' && r.screen === 'settings');
  assert.ok(intoSettings.length > 0, 'control — there is at least one to check');
  for (const row of intoSettings) {
    assert.ok(row.settingsPane, `a deep link into Settings with no pane named: ${JSON.stringify(row)}`);
  }
  // And nowhere else: a pane name on a link to another screen is a fact nothing reads.
  for (const row of rows.filter((r) => r.kind === 'deep' && r.screen !== 'settings')) {
    assert.equal(row.settingsPane, undefined, `${JSON.stringify(row)} names a Settings pane`);
  }
});

test('deep links rank last, so a one-letter query still leads with whole screens', () => {
  const rows = paletteResults('c');
  const kinds = rows.map((r) => r.kind);
  const firstDeep = kinds.indexOf('deep');
  if (firstDeep !== -1) {
    assert.ok(
      kinds.slice(firstDeep).every((k) => k === 'deep'),
      'once deep links start they must not be followed by a screen',
    );
    const labels = rows.map((r) => r.label);
    assert.ok(
      labels.indexOf('Calls') < labels.indexOf('Contacts'),
      'Calls is a screen and Contacts is a card inside one; the screen leads',
    );
  }
});

test('a deep link carries where to go and what to reveal, and nothing else does', () => {
  for (const row of paletteResults('')) {
    if (row.kind === 'deep') {
      assert.ok(row.screen && row.reveal, `${row.id} is a deep link with nowhere to go`);
      assert.ok(row.group.startsWith('In '), `${row.id} must say which screen it is in`);
    } else {
      assert.equal(row.screen, undefined, `${row.id} is not a deep link and must not carry a screen`);
    }
  }
});

// ---- D1 / D2: nothing in the shell may be one person's name ------------------------------------

test('no screen title, subtitle or label carries a personal name', () => {
  // The literal that shipped was `Good morning, Chetan` on the Overview screen. This is the general
  // form of it: a scan over every user-visible string this file owns, for anything that looks like
  // a greeting with a name in it. It is not a name detector — it cannot be — it is an assertion
  // that the *shape* which caused D1 does not come back.
  const strings = [
    ...SCREENS.flatMap((s: { title: string; subtitle: string; label: string }) => [
      s.title,
      s.subtitle,
      s.label,
    ]),
    PAIRING_SCREEN.title,
    PAIRING_SCREEN.subtitle,
  ];
  assert.ok(strings.length > 20, `the scan found ${strings.length} strings — it is looking in the wrong place`);
  for (const value of strings) {
    assert.ok(
      !/^Good (morning|afternoon|evening),/.test(value),
      `a greeting with a name in it is back: ${JSON.stringify(value)}`,
    );
  }
});

test('the Overview greeting follows the clock and names nobody', () => {
  const at = (hour: number) => overviewTitle(new Date(2026, 8, 2, hour, 30));
  assert.equal(at(0), 'Good morning');
  assert.equal(at(11), 'Good morning');
  assert.equal(at(12), 'Good afternoon');
  assert.equal(at(17), 'Good afternoon');
  assert.equal(at(18), 'Good evening');
  assert.equal(at(23), 'Good evening');
  for (const hour of [0, 6, 12, 18, 23]) {
    assert.ok(!at(hour).includes(','), 'no name, at any hour — see overviewTitle for why');
  }
});

test('avatar initials come from the machine name, and a digit is not an initial', () => {
  assert.equal(initialsFor("Chetan's MacBook Pro"), 'CM');
  assert.equal(initialsFor('Chetans-MacBook-Pro'), 'CM');
  assert.equal(initialsFor('macbook-pro-3'), 'MP', 'the 3 is not an initial');
  assert.equal(initialsFor('Mac'), 'M');
  // An unparseable or absent name draws a blank avatar rather than somebody else's initials.
  assert.equal(initialsFor(''), '');
  assert.equal(initialsFor(null), '');
  assert.equal(initialsFor('---'), '');
  assert.equal(initialsFor('42'), '');
});

// ---- Tile captions ------------------------------------------------------------------------------

/**
 * Every screen carries a `tileCaption`, and it is meaningfully shorter than its page subtitle.
 *
 * The field exists because reusing `subtitle` on Overview's quick-action tiles truncated **five of
 * the eight** — a tile is half a 1fr column and a page subtitle is a sentence. So the thing to
 * assert is not a spelling but the property that made the field necessary: it has to fit.
 *
 * The threshold is a **character count**, which is a proxy for width and is said to be one here
 * rather than pretended otherwise. The real check is the probe against the running app —
 * `scrollWidth > clientWidth` on every `.quick-sub`, which reads 0 of 8 — and this is the cheap
 * guard that catches a caption someone writes as a sentence months from now, before it reaches a
 * window.
 */
test('every screen has a tile caption, and it is short enough to be one', () => {
  const screens = (globalThis as Record<string, unknown>).SCREENS as Array<{
    id: string;
    subtitle: string;
    tileCaption: string;
  }>;
  assert.ok(screens.length >= 11, `control: only ${screens.length} screens were read`);

  const tooLong: string[] = [];
  for (const screen of screens) {
    assert.ok(screen.tileCaption?.length, `${screen.id} has no tileCaption`);
    // 26 characters is the longest that measured un-truncated in the real tile at 1440px
    // ("Everything at a glance" is 22, "Copy on either side" is 19). A caption over this has not
    // been measured and should be.
    if (screen.tileCaption.length > 26) tooLong.push(`${screen.id}: ${screen.tileCaption}`);
  }
  assert.deepEqual(
    tooLong,
    [],
    'these captions are longer than anything measured un-truncated in a quick-action tile:\n  ' +
      tooLong.join('\n  '),
  );
});

test('a tile caption is not the page subtitle wearing a different name', () => {
  const screens = (globalThis as Record<string, unknown>).SCREENS as Array<{
    id: string;
    subtitle: string;
    tileCaption: string;
  }>;
  // The control: the subtitles this is comparing against are real sentences, or the assertion
  // below is vacuous.
  const sentences = screens.filter((s) => s.subtitle.length > 26).length;
  assert.ok(sentences >= 8, `control: only ${sentences} screens have a sentence-length subtitle`);

  for (const screen of screens) {
    assert.notEqual(
      screen.tileCaption,
      screen.subtitle,
      `${screen.id}'s caption is its subtitle — which is the thing that truncated`,
    );
  }
});

test('Overview\'s subtitle claims sync only while the link is live', () => {
  // It was a static sentence and said "in sync" beside a red Disconnected chip. Red-first: returning
  // the live sentence for every tone turns this red on the second assertion.
  assert.match(overviewSubtitle('live'), /in sync/);
  for (const tone of ['working', 'down', 'idle']) {
    assert.ok(!/in sync/.test(overviewSubtitle(tone)), `${tone} claims sync`);
  }
  assert.notEqual(overviewSubtitle('working'), overviewSubtitle('down'));
});
