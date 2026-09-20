import test from 'node:test';
import assert from 'node:assert/strict';

import { acceleratorFor, buildAppMenu, type MenuRoute } from './appMenu';

const ROUTES: MenuRoute[] = [
  { id: 'overview', label: 'Overview', shortcut: '⌘1' },
  { id: 'mirror', label: 'Mirror', shortcut: '⌘2' },
  { id: 'apps', label: 'Apps', shortcut: '⌘0' },
  { id: 'settings', label: 'Settings', shortcut: '⌘,' },
  { id: 'camera', label: 'Camera', shortcut: '' },
];

const build = (routes = ROUTES, packaged = true) =>
  buildAppMenu(routes, {
    appName: 'Sidekick',
    showDeveloperItems: !packaged,
    route: () => {},
    palette: () => {},
  });

const menu = (template: any[], label: string) =>
  template.find((m) => m.label === label)?.submenu ?? [];

test('the design’s glyphs become Electron’s spelling', () => {
  assert.equal(acceleratorFor('⌘1'), 'Cmd+1');
  assert.equal(acceleratorFor('⌘,'), 'Cmd+,');
  assert.equal(acceleratorFor('⌘⇧M'), 'Cmd+Shift+M');
});

/** Not `''`. An empty accelerator is a binding to nothing and Electron complains about it. */
test('a route with no shortcut gets no accelerator at all', () => {
  assert.equal(acceleratorFor(''), undefined);
  assert.equal(acceleratorFor('  '), undefined);
  const camera = menu(build(), 'Go').find((i: any) => i.label === 'Camera');
  assert.ok(camera, 'control: the route is in the menu');
  assert.equal(camera.accelerator, undefined);
});

test('every route reaches the menu, in order, with its own shortcut', () => {
  const go = menu(build(), 'Go').filter((i: any) => i.label && i.label !== 'Search…');
  assert.deepEqual(
    go.map((i: any) => [i.label, i.accelerator]),
    [
      ['Overview', 'Cmd+1'],
      ['Mirror', 'Cmd+2'],
      ['Apps', 'Cmd+0'],
      ['Settings', 'Cmd+,'],
      ['Camera', undefined],
    ],
  );
});

/**
 * The item that is easiest to leave out and costs the most. Without an Edit menu macOS has nowhere
 * to send ⌘C / ⌘V / ⌘X / ⌘A, and copy and paste stop working in every text field in the app.
 */
test('the Edit menu carries the clipboard roles, so text fields keep working', () => {
  const roles = menu(build(), 'Edit').map((i: any) => i.role);
  for (const role of ['cut', 'copy', 'paste', 'selectAll', 'undo', 'redo']) {
    assert.ok(roles.includes(role), `Edit has no ${role} — ⌘${role[0]!.toUpperCase()} is now dead`);
  }
});

/**
 * The defect. Electron's default View menu offered Force Reload and Toggle Developer Tools to
 * every user of a shipped build — measured live on 2026-09-20 through System Events.
 */
test('a packaged build offers no reload and no devtools', () => {
  const roles = menu(build(ROUTES, true), 'View').map((i: any) => i.role);
  for (const role of ['reload', 'forceReload', 'toggleDevTools']) {
    assert.ok(!roles.includes(role), `a shipped menu offers ${role}`);
  }
  assert.ok(roles.includes('togglefullscreen'), 'control: the View menu is not simply empty');
  assert.ok(roles.includes('zoomIn'), 'zoom is a preference and stays');
});

test('control: a development build keeps them, so the packaged reading means something', () => {
  const roles = menu(build(ROUTES, false), 'View').map((i: any) => i.role);
  for (const role of ['reload', 'forceReload', 'toggleDevTools']) {
    assert.ok(roles.includes(role), `development lost ${role}`);
  }
});

/** The app menu is named for the product, and so are the three items macOS builds from that name. */
test('the app menu is the product’s name, not the package’s', () => {
  const template = build();
  assert.equal(template[0]!.label, 'Sidekick');
  const labels = menu(template, 'Sidekick').map((i: any) => i.label).filter(Boolean);
  assert.deepEqual(labels, ['About Sidekick', 'Hide Sidekick', 'Quit Sidekick']);
  assert.ok(!JSON.stringify(template).includes('sidekick-desktop'));
});

test('the menu items route, and the palette item opens the palette', () => {
  const went: string[] = [];
  let palettes = 0;
  const template = buildAppMenu(ROUTES, {
    appName: 'Sidekick',
    showDeveloperItems: false,
    route: (id) => went.push(id),
    palette: () => { palettes += 1; },
  });
  const go = menu(template, 'Go');
  (go.find((i: any) => i.label === 'Mirror') as any).click();
  (go.find((i: any) => i.label === 'Search…') as any).click();
  assert.deepEqual(went, ['mirror']);
  assert.equal(palettes, 1);
});

/** An empty list is the state between launch and the renderer's first message. It must still work. */
test('before the renderer reports its routes, Edit still exists', () => {
  const template = build([]);
  assert.ok(menu(template, 'Edit').some((i: any) => i.role === 'paste'));
  assert.equal(menu(template, 'Go').filter((i: any) => i.label && i.label !== 'Search…').length, 0);
});
