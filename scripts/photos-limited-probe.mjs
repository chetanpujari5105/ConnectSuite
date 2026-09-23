/**
 * What does the Mac's Photos pane say about photo access? Defect 139, read on hardware.
 *
 * Selected-only access on the phone is sent as `photos` advertised **and** named in `limited` with
 * the phone's sentence; the pane is supposed to draw *Some photos allowed* with that sentence, and
 * nothing at all once access is whole. This reads the one element that carries it, `#photos-banner`.
 *
 * **Privacy, by construction.** The pane is the owner's photo library. This reads the banner's
 * words and a *count* of album rows — never an album name, a caption or a thumbnail — and takes no
 * screenshot. The banner's words are our copy plus the phone's sentence, neither of which is theirs.
 *
 * **The control** is that count: a pane with albums drawn is a pane that was there to be read, so
 * a hidden banner beside it means "no notice" rather than "nothing rendered". It is the hidden-grid
 * fault in CLAUDE.md's table, answered in the same expression as the read.
 *
 * Usage: node scripts/photos-limited-probe.mjs      (the Mac app on --remote-debugging-port=9222)
 */
import { openProbe, format } from './probe.mjs';

const probe = await openProbe({ port: 9222 });

const CONTROL = `__probe.one('section[data-screen="photos"]').querySelectorAll('#photos-albums > *').length`;

const routed = await probe.act({
  what: 'route the Mac to Photos',
  run: `document.querySelector('[data-nav="photos"]').click()`,
  expect: `!__probe.one('section[data-screen="photos"]').hidden &&
    __probe.one('section[data-screen="photos"]').querySelectorAll('#photos-albums > *').length > 0`,
  within: 15000,
});
if (!routed.landed) {
  console.error(JSON.stringify(routed, null, 2));
  console.error('\nNOT A READING: the Photos pane did not show albums, so the banner was not measured.');
  probe.close();
  process.exit(3);
}

const reading = await probe.read({
  question: 'What access notice does the Photos pane draw?',
  control: CONTROL,
  read: `(function () {
    var pane = __probe.one('section[data-screen="photos"]');
    var banner = pane.querySelector('#photos-banner');
    if (!banner) throw new Error('PROBE_NO_MATCH: no #photos-banner in the Photos section');
    var headline = banner.querySelector('.state-headline');
    var bodies = Array.prototype.slice.call(banner.querySelectorAll('.state-body'));
    return {
      albumRows: pane.querySelectorAll('#photos-albums > *').length,
      bannerHidden: banner.hidden,
      headline: headline ? headline.textContent : null,
      body: bodies.map(function (b) { return b.textContent; })
    };
  })()`,
});

const v = reading.value;
console.log(format(reading));
console.log(JSON.stringify({
  notice: v.bannerHidden ? 'none' : v.headline,
  phoneSentence: v.bannerHidden ? null : v.body,
  control: { albumRows: v.albumRows },
  reportable: reading.reportable,
}, null, 2));

probe.close();
process.exit(reading.reportable ? 0 : 3);
