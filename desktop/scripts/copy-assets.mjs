import { cp, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// tsc only emits .js; the renderer's HTML and CSS have to land next to it so the packaged app
// has a single self-contained dist/ directory.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(resolve(root, 'dist/renderer'), { recursive: true });
// Every asset the renderer loads must be listed here: a stylesheet or a page missing from this
// array builds clean, typechecks clean, and ships an unstyled — or missing — window. float.html and
// float.css are the detached mirror window's page and its own sheet; it deliberately does not load
// styles.css, which is the main window's component layer for panes it does not have.
for (const asset of ['index.html', 'tokens.css', 'styles.css', 'float.html', 'float.css']) {
  await cp(resolve(root, 'src/renderer', asset), resolve(root, 'dist/renderer', asset));
}
