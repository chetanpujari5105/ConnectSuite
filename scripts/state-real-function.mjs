/** Real function still works after the migration — the panes fetch, list and act on live data. */
import { openProbe, format } from '/Users/chetan/Desktop/ConnectSuite/scripts/probe.mjs';
const probe = await openProbe({ port: 9222 });
const r = await probe.read({
  question: 'the migrated panes still work on the phone’s real data',
  read: `(async () => {
    const out = {};
    shell.route('files'); await new Promise(r => setTimeout(r, 1400));
    out.fileRows = document.querySelectorAll('#files-table .files-row, #files-table tr').length;
    out.filesStateBlocks = document.querySelectorAll('#files-state .state-block').length;
    shell.route('photos'); await new Promise(r => setTimeout(r, 1600));
    out.albums = document.querySelectorAll('.photos-album').length;
    out.photosBannerHidden = document.getElementById('photos-banner')?.hidden;
    shell.route('apps'); await new Promise(r => setTimeout(r, 1600));
    out.appTiles = document.querySelectorAll('.apps-tile').length;
    out.appsBannerHidden = document.getElementById('apps-banner')?.hidden;
    shell.route('activity'); await new Promise(r => setTimeout(r, 1400));
    out.activityRows = document.querySelectorAll('.activity-row, .activity-line').length;
    out.activityStateBlocks = document.querySelectorAll('section[data-screen="activity"] .state-block').length;
    shell.route('overview');
    return out;
  })()`,
  control: `document.querySelectorAll('section.screen').length`,
});
console.log('  ' + format(r));
const v = r.value;
const ok = [
  ['Files lists real entries and draws no state card', v.fileRows > 0 && v.filesStateBlocks === 0],
  ['Photos lists real albums with no banner', v.albums > 0 && v.photosBannerHidden === true],
  ['Apps lists real tiles with no banner', v.appTiles > 0 && v.appsBannerHidden === true],
  ['Activity lists real rows and draws no state card', v.activityRows > 0 && v.activityStateBlocks === 0],
];
let bad = 0;
for (const [what, good] of ok) { console.log(`  ${good ? 'OK  ' : 'FAIL'} ${what}`); if (!good) bad++; }
console.log(`\n${bad ? bad + ' FAILED' : 'ALL READINGS OK'}\n`);
await probe.close(); process.exit(bad ? 1 : 0);
