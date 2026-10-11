import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The Overview pill row under the device card, read from the page and the script that wires it.
 *
 * 2026-10-11: *View activity* left the row (Recent activity's **View all** and the sidebar's
 * Activity both still reach the pane) and **Send files** took the second slot. The order is the tab
 * order, so it is asserted from the markup rather than from a rendered tree a double cannot lay out.
 */
const html = readFileSync(join(__dirname, 'index.html'), 'utf8');
const script = readFileSync(join(__dirname, 'renderer.ts'), 'utf8');

function pillRow(): string {
  const at = html.indexOf('id="overview-pill-row"');
  assert.ok(at > 0, 'control: the pill row is in the page');
  const end = html.indexOf('</div>', at);
  return html.slice(at, end);
}

test('the row is Start mirroring, Send files, Device info — in that order, and nothing else', () => {
  const ids = [...pillRow().matchAll(/<button\b[^>]*\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ['hero-mirror', 'hero-send', 'hero-info']);
});

test('View activity is gone from the page and from the script — and Activity is still reachable', () => {
  assert.equal(html.includes('hero-activity'), false);
  assert.equal(html.includes('>View activity<'), false);
  assert.equal(script.includes('hero-activity'), false);
  // The two doors that remain: Recent activity's View all, and the sidebar route.
  assert.ok(html.includes('id="recent-all"'), 'control: View all is still on the card');
  assert.match(script, /el\('recent-all'\)[\s\S]{0,200}route\('activity'\)/);
});

test('Send files has an accessible name, the upload glyph, and the Device info style', () => {
  const tag = /<button\b[^>]*\bid="hero-send"[^>]*>([\s\S]*?)<\/button>/.exec(pillRow());
  assert.ok(tag, 'control: the button is in the row');
  assert.match(tag[0], /class="button hero-pill-action"/, 'secondary, like Device info — never the lime primary');
  assert.match(tag[1]!.replace(/<[^>]+>/g, '').trim(), /^Send files$/);
  assert.match(script, /el\('hero-send'\)\.prepend\(iconSvg\('upload', 15\)\)/);
  // The reason a disabled button is disabled is spoken, not only hovered.
  assert.match(tag[0], /aria-describedby="hero-send-why"/);
  assert.ok(html.includes('id="hero-send-why"'));
});
