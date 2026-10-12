// Throwaway Electron main for the local actor tests: one window on the fake pane, its own userData.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const scenario = (process.argv.find((a) => a.startsWith('--scenario=')) || '--scenario=normal').split('=')[1];
app.setPath('userData', path.join(__dirname, 'ud'));
app.whenReady().then(() => {
  const w = new BrowserWindow({ width: 500, height: 400, show: false, webPreferences: { backgroundThrottling: false } });
  w.loadFile(path.join(__dirname, 'renderer', 'index.html'), { search: 's=' + scenario });
});
app.on('window-all-closed', () => app.quit());
