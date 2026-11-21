import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // bombadil-kit is linked from the repo root (file:../..), outside this app:
  // serve it, and resolve its peers from this app as a real install would.
  server: { fs: { allow: ['../..'] } },
  resolve: { preserveSymlinks: true },
});
