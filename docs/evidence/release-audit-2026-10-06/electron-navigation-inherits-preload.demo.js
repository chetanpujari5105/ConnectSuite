const { app, BrowserWindow } = require('electron');
const path = require('path');
app.setPath('userData', path.join(__dirname, 'ud'));
app.whenReady().then(async () => {
  app.dock?.hide();
  const w = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  await w.loadFile(path.join(__dirname, 'page.html'));
  const sandboxed = await w.webContents.executeJavaScript('typeof require');
  // Same navigation Chromium performs when a file is dropped outside a drop handler: a top-level file:// navigation.
  await w.webContents.executeJavaScript(`location.href = ${JSON.stringify('file://' + path.join(__dirname, 'dropped.html'))}`);
  await new Promise(r => setTimeout(r, 1500));
  console.log(JSON.stringify({ url: w.webContents.getURL().split('/').pop(), title: w.getTitle(), typeofRequireInPage: sandboxed }));
  // Control: same navigation with a will-navigate guard must stay on page.html.
  const g = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true } });
  g.webContents.on('will-navigate', (e) => e.preventDefault());
  await g.loadFile(path.join(__dirname, 'page.html'));
  await g.webContents.executeJavaScript(`location.href = ${JSON.stringify('file://' + path.join(__dirname, 'dropped.html'))}`);
  await new Promise(r => setTimeout(r, 1500));
  console.log(JSON.stringify({ control_with_guard_url: g.webContents.getURL().split('/').pop() }));
  app.quit();
});
