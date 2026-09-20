import type { MenuItemConstructorOptions } from 'electron';

/**
 * The macOS menu bar, which this app did not have.
 *
 * ### What was there, measured rather than assumed
 *
 * With no `Menu.setApplicationMenu`, Electron installs its own default. Read live through
 * `System Events` on 2026-09-20:
 *
 * ```
 * menu bar items         : Apple, Electron, File, Edit, View, Window
 * the app menu's items   : About sidekick-desktop … Hide sidekick-desktop … Quit sidekick-desktop
 * View                   : Reload, Force Reload, Toggle Developer Tools, …
 * ```
 *
 * Three separate things wrong, and none of them is cosmetic. The app is called **Electron** in the
 * one place macOS always shows an app's name. The About, Hide and Quit items say
 * **`sidekick-desktop`** — the npm package name, which is not a product name and was never meant
 * to be read by anyone. And **Force Reload and Toggle Developer Tools are offered to users**: a
 * person exploring the menu bar of a shipped app can throw away the renderer's state, or open a
 * devtools pane over a window whose layout is specified to the half-pixel.
 *
 * ### Why the routes come from the renderer rather than from a list here
 *
 * `navModel.SCREENS` is already the single source for the sidebar rows, the ⌘K palette and the
 * twelve page titles, and this repo's own rule is that a hand-written second copy is the copy that
 * stops matching. `navModel.ts` is a renderer module — it knows about icons and nav-pill offsets —
 * so main importing it would be the coupling pointed the wrong way. The renderer hands over the
 * list it already has, and the menu is a **view** of it. A route added to `SCREENS` appears in all
 * three surfaces or in none.
 *
 * ### The accelerators are the same keys the renderer binds, and that is deliberate
 *
 * A menu accelerator is consumed by the menu, so ⌘1…⌘0 stop reaching the page once they are here.
 * They therefore route through the same `shell.route` the sidebar calls, over one IPC message —
 * not a second navigation path. What this buys is the thing a palette cannot: **the shortcuts
 * become discoverable**, printed beside their destinations in the place a Mac user looks for them.
 *
 * And the Edit menu is not optional furniture. Without one, macOS has nothing to send ⌘C, ⌘V, ⌘X,
 * ⌘A or ⌘Z to, and **copy and paste stop working in every text field in the app** — the manual
 * address on the pairing screen, the message composer, the Apps search. It is the first thing a
 * hand-written menu loses and the last thing anybody tests.
 */

export interface MenuRoute {
  id: string;
  label: string;
  /** As `navModel` writes it: `⌘1`, `⌘,`, or empty for a route with no shortcut. */
  shortcut: string;
}

/**
 * `⌘1` → `Cmd+1`. Electron wants its own spelling, and the design writes the glyphs.
 *
 * Returns `undefined` for a route with no shortcut, which is not the same as an empty accelerator:
 * an empty string is a binding to nothing, and Electron logs about it.
 */
export function acceleratorFor(shortcut: string): string | undefined {
  const key = shortcut.replace('⌘', '').replace('⇧', '').trim();
  if (!key) return undefined;
  const shift = shortcut.includes('⇧') ? 'Shift+' : '';
  return `Cmd+${shift}${key}`;
}

export interface AppMenuHandlers {
  /** Route the visible window to a screen id. */
  route: (id: string) => void;
  /** Open the ⌘K palette. */
  palette: () => void;
  /** Whether developer items may be shown. `app.isPackaged === false` in development. */
  showDeveloperItems: boolean;
  appName: string;
}

export function buildAppMenu(
  routes: MenuRoute[],
  { route, palette, showDeveloperItems, appName }: AppMenuHandlers,
): MenuItemConstructorOptions[] {
  const go: MenuItemConstructorOptions[] = routes.map((screen) => ({
    label: screen.label,
    accelerator: acceleratorFor(screen.shortcut),
    click: () => route(screen.id),
  }));

  return [
    {
      label: appName,
      submenu: [
        { role: 'about', label: `About ${appName}` },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide', label: `Hide ${appName}` },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit', label: `Quit ${appName}` },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'Go',
      submenu: [
        { label: 'Search…', accelerator: 'Cmd+K', click: () => palette() },
        { type: 'separator' },
        ...go,
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'togglefullscreen' },
        /*
         * Zoom is kept and Reload is not. They look alike and are not: zoom is a preference a
         * person may want, and `shot.mjs` already refuses to photograph a zoomed window rather
         * than pretending the setting does not exist. A reload throws away the renderer's state —
         * the open thread, the loaded album, an unsent message — with no warning and no undo.
         */
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        ...(showDeveloperItems
          ? ([
              { type: 'separator' },
              { role: 'reload' },
              { role: 'forceReload' },
              { role: 'toggleDevTools' },
            ] as MenuItemConstructorOptions[])
          : []),
      ],
    },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'front' }] },
  ];
}
