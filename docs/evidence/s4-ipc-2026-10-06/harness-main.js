// Isolated S4 proof. Own temp profile, hidden windows, no network, never Sidekick's main.js.
// Real compiled guard + policy + preloads + pages; every handler is a recording stand-in.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const DIST = path.resolve(process.argv.find((a) => a.endsWith('/dist')));
app.setPath('userData', path.join(__dirname, 'ud'));
const { WindowRegistry, guardIpc } = require(path.join(DIST, 'main', 'ipcAuth.js'));
const { IPC_POLICY } = require(path.join(DIST, 'main', 'ipcPolicy.js'));
const PAGE = (p) => path.join(DIST, 'renderer', p);
const windows = new WindowRegistry();
const refusals = [];
const ipc = guardIpc(ipcMain, windows, IPC_POLICY, { warn: (m) => refusals.push(m) });
const ran = [];
for (const channel of Object.keys(IPC_POLICY)) {
  const record = () => { ran.push(channel); return { ok: true, stub: true }; };
  if (['renderer-log', 'route-changed', 'camera-frame-ack', 'fs-drag', 'fs-grant-source', 'share-window-close', 'share-window-height'].includes(channel)) ipc.on(channel, record);
  else ipc.handle(channel, record);
}
app.on('window-all-closed', () => {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mk = (preload, extra = {}) => new BrowserWindow({ show: false, webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, ...extra } });
const keys = (w) => w.webContents.executeJavaScript('Object.keys(window.connect || {}).sort()');
const rawInvoke = (frameOrContents, channel, args = []) =>
  frameOrContents.executeJavaScript(`window.raw.invoke(${JSON.stringify(channel)}, ...${JSON.stringify(args)}).then((r) => r, (e) => ({ threw: String(e.message).slice(0, 80) }))`);
app.whenReady().then(async () => {
  app.dock?.hide();
  const out = {};
  // 1. The three real windows, real preloads, real pages.
  const main = mk(path.join(DIST, 'preload.js')); windows.register('main', main.webContents, PAGE('index.html'));
  const float = mk(path.join(DIST, 'preloadFloat.js')); windows.register('float', float.webContents, PAGE('float.html'));
  const share = mk(path.join(DIST, 'preloadShare.js')); windows.register('share', share.webContents, PAGE('share-window.html'));
  await Promise.all([main.loadFile(PAGE('index.html')), float.loadFile(PAGE('float.html')), share.loadFile(PAGE('share-window.html'))]);
  await sleep(1200);
  const forbidden = /sms|call|dial|pair|forget|^fs|clip|contact|notif|activity|settings|logTail|download|media|camera|webcam|apps/i;
  for (const [name, w] of [['main', main], ['float', float], ['share', share]]) {
    const k = await keys(w);
    out[`${name}Bridge`] = { methods: k.length, forbiddenExposed: name === 'main' ? '(main: all documented operations)' : k.filter((m) => forbidden.test(m)) };
  }
  out.floatCallsSms = await float.webContents.executeJavaScript('typeof window.connect.smsSend');
  out.shareCallsPairing = await share.webContents.executeJavaScript('typeof window.connect.pairingQr');
  out.startupCallsAllowed = ipc.counts();
  const ranBefore = ran.length;

  // 2. A compromised float page (raw ipcRenderer) in the REGISTERED float window.
  const evilFloat = mk(path.join(__dirname, 'attacker-preload.js'));
  windows.register('float', evilFloat.webContents, PAGE('float.html'));
  await evilFloat.loadFile(PAGE('float.html')); await sleep(200);
  out.compromisedFloat = {
    smsSend: await rawInvoke(evilFloat.webContents, 'sms-send', [{ threadId: 't', body: 'hi' }]),
    forgetDevice: await rawInvoke(evilFloat.webContents, 'forget-device'),
    pairingQr: await rawInvoke(evilFloat.webContents, 'pairing-qr', [true]),
    control_floatState: await rawInvoke(evilFloat.webContents, 'float-state'),
  };
  // 3. The replaced float window (the first one) is now a stranger — even for its own channels.
  out.replacedFloatWindow = await float.webContents.executeJavaScript('window.connect.floatState().then((r) => r)');
  // 4. An unregistered window showing the real main page.
  const stranger = mk(path.join(__dirname, 'attacker-preload.js'));
  await stranger.loadFile(PAGE('index.html')); await sleep(200);
  out.unregisteredWindow = { forgetDevice: await rawInvoke(stranger.webContents, 'forget-device') };
  // 5. A registered main window whose frame is not its own page.
  const wrongPage = mk(path.join(__dirname, 'attacker-preload.js'));
  windows.register('main', wrongPage.webContents, PAGE('index.html'));
  await wrongPage.loadFile(path.join(__dirname, 'other.html')); await sleep(200);
  out.wrongPage = { clipUse: await rawInvoke(wrongPage.webContents, 'clip-use', ['x']) };
  // 6. A subframe of a registered main window (preload reaches iframes only with nodeIntegrationInSubFrames).
  const host = mk(path.join(__dirname, 'attacker-preload.js'), { nodeIntegrationInSubFrames: true });
  windows.register('main', host.webContents, path.join(__dirname, 'frame-host.html'));
  await host.loadFile(path.join(__dirname, 'frame-host.html')); await sleep(400);
  const child = host.webContents.mainFrame.frames[0];
  out.subframe = {
    childClipUse: child ? await rawInvoke(child, 'clip-use', ['x']) : 'no child frame',
    control_topFrameClipUse: await rawInvoke(host.webContents, 'clip-use', ['control']),
  };
  // 7. Invalid payload from the legitimate main window.
  windows.register('main', main.webContents, PAGE('index.html'));
  out.invalidPayload = await main.webContents.executeJavaScript(`window.connect.setManualAddress(42).then((r) => r)`);
  out.forbiddenRan = ran.slice(ranBefore).filter((c) => ['sms-send', 'forget-device', 'pairing-qr'].includes(c));
  out.ranAfterStartup = ran.slice(ranBefore);
  out.refusalLinesSample = refusals.slice(-6);
  out.counts = ipc.counts();
  console.log('RESULT ' + JSON.stringify(out));
  app.quit();
});
