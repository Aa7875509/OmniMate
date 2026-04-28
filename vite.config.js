import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import electron from 'vite-plugin-electron/simple';
import renderer from 'vite-plugin-electron-renderer';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [
    vue(),
    electron({
      main: {
        entry: 'electron/main.js',
        vite: {
          build: {
            rollupOptions: {
              /** 勿打包 ws：其内部 require('events') 在 Rolldown ESM 产物中会触发「无 require」报错 */
              external: ['ws'],
            },
          },
        },
      },
      preload: {
        input: resolve(import.meta.dirname, 'electron/preload.js'),
      },
    }),
    renderer(),
  ],
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
    },
  },
});
