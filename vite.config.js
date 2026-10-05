import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const hlProxy = {
  '/api/info': {
    target: 'https://api.hyperliquid.xyz',
    changeOrigin: true,
    rewrite: () => '/info',
  },
};

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 8080,
    strictPort: true,
    proxy: hlProxy,
  },
  preview: {
    host: '0.0.0.0',
    port: 8080,
    proxy: hlProxy,
  },
});
