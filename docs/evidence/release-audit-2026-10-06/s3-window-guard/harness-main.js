// Isolated S3 proof. Own temp profile, hidden windows, no network, no IPC handlers registered, never Sidekick's main.js.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const DIST = path.resolve(process.argv.find((a) => a.endsWith('/dist')));
const guarded = process.argv.includes('--guarded');
app.setPath('userData', path.join(__dirname, 'ud-' + (guarded ? 'g' : 'u')));
const { guardWindow } = require(path.join(DIST, 'main', 'windowGuard.js'));
const PAGES = ['index.html', 'float.html', 'share-window.html'].map((p) => path.join(DIST, 'renderer', p));
const refusals = [];
app.on('window-all-closed', () => {}); // keep running while the harness opens and destroys windows
if (guarded) app.on('web-contents-created', (_e, c) => guardWindow(c, PAGES, (what, reason) => refusals.push(`${what}: ${reason}`)));
const DROPPED = pathToFileURL(path.join(__dirname, 'dropped.html')).href;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const win = (page) => new BrowserWindow({ show: false, webPreferences: { preload: path.join(DIST, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
app.whenReady().then(async () => {
  app.dock?.hide();
  const out = { mode: guarded ? 'guarded (the product\'s web-contents-created hook)' : 'UNGUARDED control' };
  for (const page of PAGES) {
    const w = win();
    const loadError = await w.loadFile(page).then(() => null, (e) => String(e.message).slice(0, 60));
    await sleep(300);
    if (w.isDestroyed()) { out[path.basename(page)] = { loadError, destroyed: true }; continue; }
    out[path.basename(page) + ':loadError'] = loadError;
    out[path.basename(page)] = await w.webContents.executeJavaScript(`({ bridge: typeof window.connect === 'object' && window.connect !== null, methods: window.connect ? Object.keys(window.connect).length : 0, nodeRequire: typeof require })`);
    w.destroy();
  }
  const w = win(); await w.loadFile(PAGES[0]); await sleep(300);
  // 1. a scripted top-level navigation to an untrusted local file (what a drop would request)
  await w.webContents.executeJavaScript(`location.href = ${JSON.stringify(DROPPED)}; 0`).catch(() => {});
  await sleep(1200);
  out.afterScriptedNavigation = { url: path.basename(new URL(w.webContents.getURL()).pathname), title: w.getTitle() };
  // 2. window.open of the same file
  const before = BrowserWindow.getAllWindows().length;
  out.windowOpenReturned = await w.webContents.executeJavaScript(`String(window.open(${JSON.stringify(DROPPED)}))`).catch((e) => 'threw');
  await sleep(800);
  out.windowsBefore = before; out.windowsAfter = BrowserWindow.getAllWindows().length;
  // 3. a synthetic (not OS-level) dragover on the real page: is the renderer drop guard installed?
  if (guarded) {
    const w2 = win(); await w2.loadFile(PAGES[0]); await sleep(300);
    out.syntheticDragover = await w2.webContents.executeJavaScript(`(() => { const dt = new DataTransfer(); const e = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }); document.body.dispatchEvent(e); return { defaultPrevented: e.defaultPrevented, dropEffect: dt.dropEffect }; })()`);
    w2.destroy();
  }
  out.refusals = refusals;
  console.log('RESULT ' + JSON.stringify(out));
  app.quit();
});
