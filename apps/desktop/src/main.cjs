const { app, BrowserWindow, dialog } = require('electron');
const { readFileSync } = require('node:fs');
const path = require('node:path');

function serverUrl() {
  const file = path.join(app.getPath('userData'), 'server-url.txt');
  let configured = process.env.LOJA_SERVER_URL;
  if (!configured) {
    try {
      configured = readFileSync(file, 'utf8').trim();
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const url = new URL(configured || (process.defaultApp ? 'http://127.0.0.1:5173' : 'http://127.0.0.1:8080'));
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/'
      || url.search || url.hash) throw new Error('Informe a origem HTTP/HTTPS da loja, com porta quando necessária.');
  return url;
}

function openWindow() {
  const url = serverUrl();
  const window = new BrowserWindow({
    width: 1440, height: 900, minWidth: 760, minHeight: 560,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  for (const eventName of ['will-navigate', 'will-redirect']) {
    window.webContents.on(eventName, (event, next) => {
      if (new URL(next).origin !== url.origin) event.preventDefault();
    });
  }
  return window.loadURL(url.href);
}

app.whenReady().then(openWindow).catch(error => {
  dialog.showErrorBox('Conexão com a Loja de Roupas', error.message);
  app.quit();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
