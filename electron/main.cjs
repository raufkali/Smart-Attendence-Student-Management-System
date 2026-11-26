const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

let mainWindow = null;
let serverProcess = null;
const PORT = process.env.PORT || '3000';

function getLanIpAddresses() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const entries of Object.values(nets)) {
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.family === 'IPv4' && !entry.internal) ips.push(entry.address);
    }
  }
  return ips;
}

function startLocalApiServer() {
  const serverEntry = path.resolve(__dirname, '..', 'server.ts');
  serverProcess = spawn('npx', ['tsx', serverEntry], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, NODE_ENV: 'production', PORT },
    stdio: 'inherit',
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    title: 'ScholarGrid — Smart Attendance & Institution Management',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.handle('get-lan-urls', () => {
  return getLanIpAddresses().map((ip) => `http://${ip}:${PORT}`);
});

app.whenReady().then(() => {
  startLocalApiServer();
  setTimeout(createWindow, 1200);
});

app.on('window-all-closed', () => {
  if (serverProcess) serverProcess.kill();
  if (process.platform !== 'darwin') app.quit();
});
