'use strict';

/**
 * Electron's entry point.
 *
 * S5 (defect 184): a packaged build refuses debugging switches before any app code runs — see
 * `src/main/releaseGuards.ts`. The guard is required **only when packaged**, so a development run of any
 * `dist/` — including the rollback copies made before the guard existed — starts exactly as before.
 */
const { app } = require('electron');

const refused = app.isPackaged ? require('./dist/main/releaseGuards.js').refusedSwitch(process.argv, true) : null;
if (refused !== null) {
  process.stderr.write(`Sidekick: ${refused} is not accepted by a release build; exiting.\n`);
  app.exit(78);
} else {
  require('./dist/main/main.js');
}
