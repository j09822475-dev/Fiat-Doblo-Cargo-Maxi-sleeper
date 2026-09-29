import { defineConfig } from 'vite';

// base: './' — сайт открывается из любой папки и с GitHub Pages
export default defineConfig({
  base: './',
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  test: { environment: 'node' },
} as never);
