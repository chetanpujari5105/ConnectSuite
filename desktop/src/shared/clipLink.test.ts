import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// `clipLink.ts` is written in the renderer's plain-script shape — no top-level `export`, a
// `module.exports` shim at the foot — so it is loadable by a `<script>` tag, `require`-able from
// `main/main.ts`, and `require`-able here. One implementation, three consumers.
const require_ = createRequire(import.meta.url);
const { openableUrl, MAX_URL_CHARS } = require_('./clipLink.ts') as {
  openableUrl: (text: string | undefined | null) => string | null;
  MAX_URL_CHARS: number;
};

test('an http or https URL is openable, whitespace and all', () => {
  assert.equal(openableUrl('https://example.com/a-thing'), 'https://example.com/a-thing');
  assert.equal(openableUrl('http://10.0.0.1:8080/x'), 'http://10.0.0.1:8080/x');
  assert.equal(openableUrl('  https://example.com  '), 'https://example.com');
});

test('the string that is returned is the one on screen, not a normalised one', () => {
  // `new URL('https://Example.COM')` gives `https://example.com/` — a different string from the one
  // the row displays. Opening something other than what is drawn is small here and is the same
  // class of surprise this file exists to refuse.
  assert.equal(openableUrl('https://Example.COM'), 'https://Example.COM');
});

test('every scheme but http and https is refused, including the harmless-looking ones', () => {
  for (const text of [
    'file:///Users/someone/.ssh/id_rsa',
    'x-apple.systempreferences://com.apple.preference.security',
    'javascript:alert(1)',
    'vnc://10.0.0.5',
    'smb://server/share',
    'mailto:someone@example.com',
    'tel:+919800000001',
  ]) {
    assert.equal(openableUrl(text), null, `${text} was called openable`);
  }
});

test('prose containing a link is not a link', () => {
  // The button and the row's own text would otherwise disagree about what is about to happen.
  assert.equal(openableUrl('Read https://example.com later'), null);
  assert.equal(openableUrl('https://example.com is the one'), null);
  // Two links have no single answer, so there is no button.
  assert.equal(openableUrl('https://a.example\nhttps://b.example'), null);
});

test('plain text, empty and absent all answer null', () => {
  assert.equal(openableUrl('Meeting notes — Project ConnectSuite'), null);
  assert.equal(openableUrl('example.com'), null, 'no scheme is not a URL, it is a word with a dot');
  assert.equal(openableUrl(''), null);
  assert.equal(openableUrl(undefined), null);
  assert.equal(openableUrl(null), null);
});

test('the length bound is stated rather than left to openExternal', () => {
  const long = `https://example.com/${'a'.repeat(MAX_URL_CHARS)}`;
  assert.equal(openableUrl(long), null);
  // The control: one character under the bound still answers, so the refusal above is the bound
  // doing its job and not the function refusing every long string it is shown.
  const atLimit = `https://e.co/${'a'.repeat(MAX_URL_CHARS - 'https://e.co/'.length)}`;
  assert.equal(atLimit.length, MAX_URL_CHARS);
  assert.equal(openableUrl(atLimit), atLimit);
});
