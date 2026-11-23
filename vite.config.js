import { defineConfig } from 'vite';
import { resolve } from 'node:path';
// Relative base so the same build works on any static host and inside Capacitor (https://localhost).
// Student and food/drinks staff endpoints.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist', emptyOutDir: true, target: 'es2020',
    rollupOptions: { input: { main: resolve(__dirname, 'index.html'), admin: resolve(__dirname, 'A1121/index.html'), delivery: resolve(__dirname, '1121/index.html'), drinksAdmin: resolve(__dirname, 'A1026/index.html'), drinksDelivery: resolve(__dirname, '1026/index.html') } },
  },
});
