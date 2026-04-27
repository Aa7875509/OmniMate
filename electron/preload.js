import { contextBridge, ipcRenderer } from 'electron';

/**
 * IPC 使用结构化克隆；Vue reactive/ref 为 Proxy 时会报 "could not be cloned"。
 * LLM 侧配置均为可 JSON 序列化的纯数据，用 JSON 转为普通对象最稳妥。
 */
function cloneForIpc(value) {
  if (value == null) {
    return value;
  }
  if (typeof value !== 'object') {
    return value;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return { ...value };
  }
}

const electronAPI = {
  platform: process.platform,
  ping: () => ipcRenderer.invoke('app:ping'),
  llm: {
    listProviders: () => ipcRenderer.invoke('llm:list-providers'),
    switchProvider: (providerId, config = {}) =>
      ipcRenderer.invoke('llm:switch-provider', { providerId, config: cloneForIpc(config) }),
    configureProvider: (providerId, config = {}) =>
      ipcRenderer.invoke('llm:configure-provider', { providerId, config: cloneForIpc(config) }),
    chat: (prompt, options = {}) => ipcRenderer.invoke('llm:chat', { prompt, options: cloneForIpc(options) }),
    chatStream: (prompt, options = {}, handlers = {}) =>
      new Promise((resolve, reject) => {
        const requestId =
          options.requestId ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const { requestId: _ignoredRequestId, ...providerOptions } = options ?? {};
        const onChunkChannel = 'llm:chat-stream-chunk';
        const onDoneChannel = 'llm:chat-stream-done';
        const onErrorChannel = 'llm:chat-stream-error';

        const cleanup = () => {
          ipcRenderer.removeListener(onChunkChannel, onChunk);
          ipcRenderer.removeListener(onDoneChannel, onDone);
          ipcRenderer.removeListener(onErrorChannel, onError);
        };

        const onChunk = (_event, payload = {}) => {
          if (payload.requestId !== requestId) {
            return;
          }
          handlers.onChunk?.(payload.chunk ?? '');
        };

        const onDone = (_event, payload = {}) => {
          if (payload.requestId !== requestId) {
            return;
          }
          cleanup();
          resolve(payload.result);
        };

        const onError = (_event, payload = {}) => {
          if (payload.requestId !== requestId) {
            return;
          }
          cleanup();
          const error = new Error(payload.error ?? '未知流式请求错误');
          if (payload.aborted) {
            error.name = 'AbortError';
          }
          reject(error);
        };

        ipcRenderer.on(onChunkChannel, onChunk);
        ipcRenderer.on(onDoneChannel, onDone);
        ipcRenderer.on(onErrorChannel, onError);

        ipcRenderer.send('llm:chat-stream', {
          requestId,
          prompt,
          options: cloneForIpc(providerOptions),
        });
      }),
    cancelChatStream: (requestId) => ipcRenderer.send('llm:chat-stream-cancel', { requestId }),
    getContext: () => ipcRenderer.invoke('llm:get-context'),
    clearContext: () => ipcRenderer.invoke('llm:clear-context'),
    setContextWindow: (maxMessages) => ipcRenderer.invoke('llm:set-context-window', maxMessages),
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
