/**
 * S5 (defect 184): command-line switches a **packaged** Sidekick refuses before any of its own code runs.
 *
 * The fuses (`build/fuses.mjs`) switch off `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and Node's `--inspect`. No
 * fuse covers Chromium's `--remote-debugging-port` / `--remote-debugging-pipe`: a packaged app honours them,
 * and they hand anyone who can start the app a full DevTools protocol connection to its windows — every
 * preload bridge, under this app's identity and permissions. So `entry.js` calls [refusedSwitch] first and
 * exits on a hit.
 *
 * **Development runs are untouched** (`app.isPackaged` false): the supervised verification sessions start
 * `electron .` with `--remote-debugging-port=9222` on purpose, and `scripts/probe.mjs` depends on it.
 *
 * Electron-free and dependency-free so `entry.js` can require it before `main.js` and a test can call it.
 */
export const REFUSED_SWITCHES: readonly string[] = [
  '--remote-debugging-port',
  '--remote-debugging-pipe',
  '--remote-debugging-address',
  '--remote-allow-origins',
  '--inspect',
  '--inspect-brk',
  '--inspect-port',
  '--inspect-publish-uid',
  '--js-flags',
];

/** The first refused switch in [argv], or null. Matches `--x`, `--x=…` and Chromium's `-x` spelling. */
export function refusedSwitch(argv: readonly string[], packaged: boolean): string | null {
  if (!packaged) return null;
  for (const raw of argv) {
    const arg = raw.startsWith('--') ? raw : raw.startsWith('-') ? `-${raw}` : null;
    if (arg === null) continue;
    const name = arg.split('=', 1)[0]!.toLowerCase();
    if (REFUSED_SWITCHES.includes(name)) return name;
  }
  return null;
}
