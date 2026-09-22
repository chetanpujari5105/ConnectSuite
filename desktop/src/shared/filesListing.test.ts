import { test } from 'node:test';
import assert from 'node:assert/strict';
const { visibleEntries, fileBadge, mayHaveThumbnail, listingFooter } = require('./filesListing.ts');

const e = (name: string, over: Record<string, unknown> = {}) => ({
  id: `id:${name}`, name, dir: false, size: 10, mtimeMs: 1000, mime: 'text/plain', ...over,
});
const names = (xs: Array<{ name: string }>) => xs.map((x) => x.name);
const opts = (over: Record<string, unknown> = {}) => ({ query: '', sort: 'name', dir: 'asc', ...over });

test('name order is natural — IMG_2 before IMG_10 — and folders stay first', () => {
  const list = [e('IMG_10.jpg'), e('Camera', { dir: true, size: 0 }), e('IMG_2.jpg')];
  assert.deepEqual(names(visibleEntries(list, opts())), ['Camera', 'IMG_2.jpg', 'IMG_10.jpg']);
  assert.deepEqual(names(visibleEntries(list, opts({ dir: 'desc' }))), ['Camera', 'IMG_10.jpg', 'IMG_2.jpg']);
});

test('size sorts files by size and never scatters folders by their reported 0', () => {
  const list = [e('big', { size: 900 }), e('A', { dir: true, size: 0 }), e('small', { size: 1 })];
  assert.deepEqual(names(visibleEntries(list, opts({ sort: 'size', dir: 'desc' }))), ['A', 'big', 'small']);
});

test('an unreported date sorts last in BOTH directions — reversing never calls it newest', () => {
  const list = [e('old', { mtimeMs: 1 }), e('unknown', { mtimeMs: 0 }), e('new', { mtimeMs: 9 })];
  assert.deepEqual(names(visibleEntries(list, opts({ sort: 'date', dir: 'desc' }))), ['new', 'old', 'unknown']);
  assert.deepEqual(names(visibleEntries(list, opts({ sort: 'date', dir: 'asc' }))), ['old', 'new', 'unknown']);
});

test('type groups by the phone’s MIME type; the client’s default is treated as unknown', () => {
  const list = [e('b.png', { mime: 'image/png' }), e('x.bin', { mime: 'application/octet-stream' }), e('a.pdf', { mime: 'application/pdf' })];
  assert.deepEqual(names(visibleEntries(list, opts({ sort: 'type' }))), ['a.pdf', 'b.png', 'x.bin']);
  assert.deepEqual(names(visibleEntries(list, opts({ sort: 'type', dir: 'desc' }))), ['b.png', 'a.pdf', 'x.bin']);
});

test('the filter matches the name or the resolved app label, case-insensitively, and keeps the order', () => {
  const list = [e('com.whatsapp', { dir: true, displayName: 'WhatsApp' }), e('Report.PDF'), e('notes.txt')];
  assert.deepEqual(names(visibleEntries(list, opts({ query: 'whats' }))), ['com.whatsapp']);
  assert.deepEqual(names(visibleEntries(list, opts({ query: '  pdf ' }))), ['Report.PDF']);
  assert.deepEqual(visibleEntries(list, opts({ query: 'zzz' })), []);
});

test('the input is never reordered in place — the loaded order is the pager’s cursor', () => {
  const list = [e('b'), e('a')];
  visibleEntries(list, opts());
  assert.deepEqual(names(list), ['b', 'a']);
});

test('badges come from the real extension, thumbnails are only asked of images and videos', () => {
  assert.equal(fileBadge({ name: 'scan.pdf', dir: false }), 'PDF');
  assert.equal(fileBadge({ name: 'README', dir: false }), 'FILE');
  assert.equal(fileBadge({ name: 'x.jpeg', dir: false }), 'JPEG');
  assert.equal(mayHaveThumbnail({ dir: false, mime: 'image/heic' }), true);
  assert.equal(mayHaveThumbnail({ dir: false, mime: 'application/pdf' }), false);
  assert.equal(mayHaveThumbnail({ dir: true, mime: 'inode/directory' }), false);
});

test('the footer never claims a folder-wide answer while more is unloaded', () => {
  assert.equal(listingFooter({ shown: 200, loaded: 200, hasMore: false, query: '', sorted: false }), '200 items loaded');
  const partial = listingFooter({ shown: 3, loaded: 200, hasMore: true, query: 'ipsum', sorted: true });
  assert.equal(partial, '3 of 200 items loaded match “ipsum” · more in this folder — filtering and sorting cover only what is loaded');
});
