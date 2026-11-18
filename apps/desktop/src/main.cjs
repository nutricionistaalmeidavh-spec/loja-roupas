const { app, BrowserWindow } = require('electron');
const path = require('node:path');
function openWindow() {
  const window = new BrowserWindow({
    width: 1440, height: 900, minWidth: 760, minHeight: 560,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
  });
  // Sem navegação para sites externos; frontend mesmo do Web/PWA.
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  if (!app.isPackaged) {
    void window.loadURL('http://127.0.0.1:5173');
  } else {
    void window.loadFile(path.resolve(app.getAppPath(), '../web/dist/index.html'));
  }
}
app.whenReady().then(openWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
