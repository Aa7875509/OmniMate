# Omni Mate

一个基于 Electron + Vue 3 + Vite 的桌面应用模板。

## 开发

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
```

## 项目结构

- `electron/main.js`：Electron 主进程
- `electron/preload.js`：预加载脚本，向渲染进程暴露安全 API
- `src/`：Vue 3 渲染进程代码
- `dist/`：Vue 构建输出
- `dist-electron/`：Electron 构建输出
