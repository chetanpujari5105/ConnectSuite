/**
 * Refuses a file dropped anywhere a drop zone has not accepted it — audit S3, the renderer's half.
 *
 * Chromium's default for a file dropped on a page that does not handle it is to **navigate the window
 * to that file**, and a page a window navigates to keeps this app's preload bridge. The main process
 * refuses such a navigation (`main/windowGuard.ts`); this stops the drop from asking for one, so the
 * window does not even try.
 *
 * A drop zone keeps working because it runs first: its own `dragover` listener calls
 * `preventDefault()` when it will take the drop (the Files pane's does, only when push is available),
 * and this document-level listener sees `defaultPrevented` and leaves that drop alone. Everywhere else
 * the drag shows the "not allowed" cursor and the drop does nothing.
 *
 * Loaded first on every page (`index.html`, `float.html`, `share-window.html`) as a classic script.
 */

interface DropGuardTarget {
  addEventListener(type: 'dragover' | 'drop', listener: (event: DragEvent) => void): void;
}

function installDropGuard(target: DropGuardTarget): void {
  target.addEventListener('dragover', (event) => {
    if (event.defaultPrevented) return; // a drop zone has accepted this drag
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
  });
  // A zone that accepted the drop has already handled it in its own listener, which ran first.
  target.addEventListener('drop', (event) => event.preventDefault());
}

if (typeof document !== 'undefined') installDropGuard(document);

(globalThis as Record<string, unknown>).installDropGuard = installDropGuard;
