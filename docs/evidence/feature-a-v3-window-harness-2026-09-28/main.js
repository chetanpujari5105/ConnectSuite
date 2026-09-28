// Isolated harness for the receive window: the real page from a SCRATCH build, a stand-in preload with
// the real bridge's shape, synthetic offers only. No link, no phone, no store, no real dist.
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const DIST = process.env.HARNESS_DIST;
app.setPath('userData', path.join(__dirname, 'userdata'));
let payload = { subject: null, offers: [], phone: 'Synthetic Phone', thumb: null };
const calls = [];
let w;
app.whenReady().then(() => {
  const area = screen.getPrimaryDisplay().workArea;
  w = new BrowserWindow({
    x: area.x + area.width - 360 - 16, y: area.y + 16, width: 360, height: 120,
    title: 'Incoming file', frame: false, resizable: false, minimizable: false, maximizable: false,
    fullscreenable: false, skipTaskbar: true, show: false, alwaysOnTop: false, acceptFirstMouse: false,
    hasShadow: true, transparent: true, vibrancy: 'popover', visualEffectState: 'active', backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, zoomFactor: 1 },
  });
  ipcMain.handle('share-window-state', () => payload);
  ipcMain.on('share-window-height', (_e, h) => {
    calls.push(`height:${Math.round(h)}`);
    if (typeof h !== 'number' || !Number.isFinite(h)) return;
    const hh = Math.round(Math.min(560, Math.max(120, h)));
    const b = w.getBounds(); w.setBounds({ ...b, height: hh });
    if (!w.isVisible()) w.showInactive();
  });
  ipcMain.on('share-window-close', () => { calls.push('close-window'); w.hide(); });
  ipcMain.handle('share-decide', (_e, a) => { calls.push(`decide:${a.decision}:${a.offerId}`); return { ok: true }; });
  for (const act of ['cancel', 'retry', 'open', 'reveal']) ipcMain.handle(`share-${act}`, (_e, a) => { calls.push(`${act}:${a.offerId}`); return { ok: true }; });
  // Harness-only channels, reached through window.__harness (the page never references it).
  ipcMain.on('h-push', (_e, p) => { payload = p; calls.push('pushed'); w.webContents.send('share-window', payload); if (!w.isVisible()) w.showInactive(); });
  ipcMain.handle('h-calls', () => calls.slice());
  ipcMain.handle('h-facts', () => ({ visible: w.isVisible(), focused: w.isFocused(), bounds: w.getBounds() }));
  w.loadFile(path.join(DIST, 'renderer', 'share-window.html'));
});
app.on('window-all-closed', () => app.quit());
