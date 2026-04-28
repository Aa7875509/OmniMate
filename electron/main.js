import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LLMService } from './ai/LLMService.js';
import { transcribePcm16k } from './xfyun/xfyunIat.js';
import { loadXfyunConfig, saveXfyunConfig } from './xfyun/xfyunConfigStore.js';

const currentDir = dirname(fileURLToPath(import.meta.url));
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const llmService = new LLMService();
const streamControllers = new Map();

// 开发模式使用独立临时目录，避免多次启动时 Electron 缓存目录被占用。
if (isDev) {
  app.setPath('userData', join(app.getPath('temp'), 'omni-mate-dev'));
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1380,
    height: 860,
    minWidth: 1200,
    minHeight: 820,
    title: 'Omni Mate',
    backgroundColor: '#0f172a',
    autoHideMenuBar: true,
    webPreferences: {
      // vite-plugin-electron 会将 preload.js 输出为 preload.mjs。
      preload: join(currentDir, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // 外部链接交给系统浏览器打开，避免在 Electron 窗口内加载未知页面。
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    // 打包后主进程位于 dist-electron，渲染产物位于相邻的 dist 目录。
    mainWindow.loadFile(join(currentDir, '../dist/index.html'));
  }
}

app.whenReady().then(() => {
  ipcMain.handle('app:ping', () => 'pong');
  ipcMain.handle('llm:list-providers', () => llmService.listProviders());
  ipcMain.handle('llm:switch-provider', (_event, payload = {}) =>
    llmService.switchProvider(payload.providerId, payload.config),
  );
  ipcMain.handle('llm:configure-provider', (_event, payload = {}) =>
    llmService.configureProvider(payload.providerId, payload.config),
  );
  ipcMain.handle('llm:chat', (_event, payload = {}) => llmService.chat(payload));
  ipcMain.on('llm:chat-stream', async (event, payload = {}) => {
    const requestId = payload.requestId;
    if (!requestId) {
      return;
    }

    const controller = new AbortController();
    streamControllers.set(requestId, controller);

    try {
      const result = await llmService.chatStream({
        prompt: payload.prompt,
        options: payload.options,
        signal: controller.signal,
        onChunk: (chunk) => {
          event.sender.send('llm:chat-stream-chunk', { requestId, chunk });
        },
      });

      event.sender.send('llm:chat-stream-done', { requestId, result });
    } catch (error) {
      event.sender.send('llm:chat-stream-error', {
        requestId,
        error: error instanceof Error ? error.message : String(error),
        aborted: error?.name === 'AbortError',
      });
    } finally {
      streamControllers.delete(requestId);
    }
  });
  ipcMain.on('llm:chat-stream-cancel', (_event, payload = {}) => {
    const requestId = payload.requestId;
    if (!requestId) {
      return;
    }
    streamControllers.get(requestId)?.abort();
  });
  ipcMain.handle('llm:get-context', () => llmService.getContext());
  ipcMain.handle('llm:clear-context', () => llmService.clearContext());
  ipcMain.handle('llm:set-context-window', (_event, maxMessages) =>
    llmService.setContextWindow(maxMessages),
  );

  const userDataPath = () => app.getPath('userData');

  ipcMain.handle('xfyun:get-config', async () => loadXfyunConfig(userDataPath()));
  ipcMain.handle('xfyun:save-config', async (_event, config = {}) =>
    saveXfyunConfig(userDataPath(), config),
  );
  ipcMain.handle('xfyun:transcribe-pcm', async (_event, payload) => {
    const cfg = await loadXfyunConfig(userDataPath());
    let buf;
    if (payload instanceof Uint8Array) {
      buf = Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);
    } else if (payload instanceof ArrayBuffer) {
      buf = Buffer.from(payload);
    } else {
      buf = Buffer.from(payload ?? []);
    }
    return transcribePcm16k({
      appId: cfg.appId,
      apiKey: cfg.apiKey,
      apiSecret: cfg.apiSecret,
      pcm: buf,
    });
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
