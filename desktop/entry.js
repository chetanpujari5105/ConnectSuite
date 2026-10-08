'use strict';

/**
 * Electron's entry point.
 *
 * S5 (defect 184): a packaged build refuses debugging switches before any app code runs — see
 * `src/main/releaseGuards.ts`. The guard is required **only when packaged**, so a development run of any
 * `dist/` — including the rollback copies made before the guard existed — starts exactly as before.
 */
const { app, dialog } = require('electron');

const refused = app.isPackaged ? require('./dist/main/releaseGuards.js').refusedSwitch(process.argv, true) : null;
if (refused !== null) {
  process.stderr.write(`Sidekick: ${refused} is not accepted by a release build; exiting.\n`);
  app.exit(78);
} else {
  /*
   * Defect 207 (b, c) — before main.js, because its modules read `userData` as they load. A development
   * build gets its own profile folder (seeded once, copy only); then one process per profile: a second
   * copy says so and quits having written nothing. See `src/main/profile.ts`.
   */
  const profile = require('./dist/main/profile.js');
  const plan = profile.planProfile({ appData: app.getPath('appData'), packaged: app.isPackaged, env: process.env });
  const seeded = plan.seedFrom ? profile.seedDevelopmentProfile(plan.seedFrom, plan.dir) : null;
  app.setPath('userData', plan.dir);
  if (!app.requestSingleInstanceLock()) {
    process.stderr.write(`Sidekick: another copy is already using ${plan.dir}; exiting without changes.\n`);
    app.whenReady().then(() => {
      dialog.showMessageBoxSync({ type: 'info', ...profile.secondInstancePrompt(plan.dir) });
      app.exit(0);
    });
  } else {
    globalThis.__sidekickProfile = { dir: plan.dir, seed: seeded ? seeded.outcome : 'not-applicable', seedError: seeded ? seeded.error : undefined };
    require('./dist/main/main.js');
  }
}
