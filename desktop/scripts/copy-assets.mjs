import { cp, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// tsc only emits .js; the renderer's HTML and CSS have to land next to it so the packaged app
// has a single self-contained dist/ directory.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(resolve(root, 'dist/renderer'), { recursive: true });
for (const asset of ['index.html', 'styles.css']) {
  await cp(resolve(root, 'src/renderer', asset), resolve(root, 'dist/renderer', asset));
}
