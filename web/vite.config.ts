import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  envDir: resolve(webDir, '..'),
  plugins: [react()],
  server: {
    port: 5173
  }
});
