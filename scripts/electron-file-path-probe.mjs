/**
 * Does a dropped `File` still carry `.path` in this Electron? (2026-09-23 feature pass, Feature B.)
 *
 * The Files pane's drop target read `file.path`. Electron removed that non-standard property in
 * v32; this app runs v43. The reading is on the **running renderer**, not on documentation.
 *
 * Control: `File` itself exists and constructs, and `name` — a standard property — is present on the
 * same prototype chain. Without the control, a `false` could mean "no File in this context".
 */
import { openProbe, format } from './probe.mjs';

const probe = await openProbe({ port: 9222 });
const result = await probe.read({
  question: 'does a File constructed in the renderer expose a non-standard `path` property?',
  read: `(() => { const f = new File(['x'], 'probe.txt'); return { hasPathProp: 'path' in f, pathValue: String(f.path), electron: navigator.userAgent.match(/Electron\\/([\\d.]+)/)?.[1] ?? 'unknown' }; })()`,
  control: `(() => { const f = new File(['x'], 'probe.txt'); return f.name === 'probe.txt' && typeof File === 'function'; })()`,
});
console.log(format(result));
await probe.close?.();
