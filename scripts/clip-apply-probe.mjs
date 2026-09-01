/**
 * Drives the **shipping** `ClipboardClient` against the **real** macOS pasteboard.
 *
 * ### Why this exists rather than a unit test
 *
 * `CLAUDE.md`: prefer making the code testable over mocking Electron, and `src/shared/` is where a
 * testable seam belongs. The echo rule went there and `clipEcho.test.ts` proves it with no browser.
 * What cannot go there is the part that *writes the pasteboard* — and that is exactly the half this
 * change added, so the half a mock would confirm and never test.
 *
 * A mocked `clipboard` here would prove that `ClipboardClient` calls the function we told it to
 * call. It would not prove that ⌘V produces the text, which is the entire claim. So this loads the
 * compiled class, hands it a real `clip.push` payload, and reads the pasteboard back through the
 * same API a paste would.
 *
 * ### What it does to the machine, said out loud
 *
 * It writes the pasteboard, four times. It captures what was there first and puts it back at the
 * end, and prints both so a failure to restore is visible rather than silent.
 *
 * Run: cd desktop && npx electron ../scripts/clip-apply-probe.mjs
 */
import { app, clipboard } from 'electron';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ClipboardClient } = require('../desktop/dist/main/clipboard.js');

const CHECKS = [];
const check = (what, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  CHECKS.push(ok);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}\n         got ${JSON.stringify(got)}`);
};

app.whenReady().then(() => {
  const theirs = clipboard.readText();
  console.log(`\nThe machine's own clipboard, captured first: ${theirs.length} chars\n`);

  const arrived = [];
  // No link: `send` is reached but never gets past the interlock, which is the point of the last
  // check. Nothing in the applied path needs one.
  const clip = new ClipboardClient(() => null, (entry) => arrived.push(entry));

  console.log('1. Something is already on this Mac’s clipboard when an entry arrives');
  clipboard.writeText('WORK-IN-PROGRESS-abc');
  clip.onPush({ kind: 'text', text: 'FROM-THE-PHONE-xyz', atMs: Date.now(), source: 'phone' });

  check('the arriving text is on the pasteboard — ⌘V would produce it', clipboard.readText(), 'FROM-THE-PHONE-xyz');
  check('the renderer was told it was applied', arrived.map((e) => e.applied), [true]);

  const entries = clip.entries();
  // **Newest first, and the order is load-bearing rather than incidental.** The displaced entry is
  // captured before the arrival is stored, so the arrival sits above it — which is what the row's
  // copy asserts: *"What was on this Mac's clipboard before the entry above replaced it."* The
  // first version of this probe expected the opposite order and read a real, correct product as
  // broken in two checks; the third then "restored" the arriving text over itself and called that a
  // failed undo. One wrong assumption in the instrument, three confident wrong findings.
  check('the arrival is newest and the displaced entry sits under it', entries.map((e) => e.kind), ['text', 'displaced']);
  check('the displaced entry holds what was about to be lost', entries[1].text, 'WORK-IN-PROGRESS-abc');

  console.log('\n2. The interlock survives the round trip');
  // Checked **before** Restore, and the ordering is a finding rather than a tidy-up. The interlock
  // is a **single slot**: a local write moves it, and Restore is a local write. Running Restore
  // first left `lastReceived` holding the restored text, so the phone's own entry was no longer
  // recognised as an echo and went to the link.
  //
  // That is correct and it is a real property worth stating: a clip that arrives, is displaced by a
  // Restore, and is then copied again **can** travel back — **one hop**, terminating, because the
  // far side's interlock refuses to return it. The alternative is remembering every text ever
  // received, which is a larger store of other people's clipboard content than this feature is
  // willing to hold for a saved round trip.
  clipboard.writeText('FROM-THE-PHONE-xyz');
  clip.send().then((result) => {
    check('sending the phone’s own entry back is refused', result, {
      ok: false,
      reason: 'That is the entry the phone just sent — not sending it back.',
    });

    console.log('\n3. The control — a different clipboard is NOT refused');
    // Without this the check above is worthless: a `send` that refused everything (no link, say)
    // would satisfy it perfectly. This must fail for a *different* reason — reaching the link and
    // finding none — which is what proves the refusal above was the interlock.
    clipboard.writeText('SOMETHING-THE-PERSON-COPIED');
    clip.send().then((second) => {
      const passedTheInterlock =
        second.ok === false && second.reason !== 'That is the entry the phone just sent — not sending it back.';
      check('a genuinely new clip gets past the interlock and fails at the link instead', passedTheInterlock, true);
      console.log(`         (it stopped at: ${JSON.stringify(second.reason)})`);

      console.log('\n4. Restore is an undo');
      clip.use(entries[1].text);
      check('the pasteboard is back to what the person had', clipboard.readText(), 'WORK-IN-PROGRESS-abc');

      clipboard.writeText(theirs);
      console.log(`\nClipboard restored: ${clipboard.readText() === theirs ? 'yes' : 'NO — RESTORE FAILED'}`);
      const failed = CHECKS.filter((c) => !c).length;
      console.log(failed === 0 ? `\nAll ${CHECKS.length} checks ok.\n` : `\n${failed} of ${CHECKS.length} FAILED.\n`);
      app.exit(failed === 0 ? 0 : 1);
    });
  });
});
