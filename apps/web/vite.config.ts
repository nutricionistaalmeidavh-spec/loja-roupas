import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiProxy = { '/v1': { target: 'http://127.0.0.1:3000', changeOrigin: false } };

export default defineConfig({
  plugins: [react()],
  preview: { host: '127.0.0.1', port: 5173, strictPort: true, proxy: apiProxy },
  server: {
    host: '127.0.0.1', port: 5173, strictPort: true,
    // Apenas desenvolvimento. Em produção servir UI e API pelo mesmo origin LAN/HTTPS.
    proxy: apiProxy,
  },
});
