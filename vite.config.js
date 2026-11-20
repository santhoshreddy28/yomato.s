import { defineConfig } from 'vite';
import { resolve } from 'node:path';
// Relative base so the same build works on any static host and inside Capacitor (https://localhost).
// Three separate endpoints:  /  (students)   /A1121/ (admin)   /1121/ (delivery)
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist', emptyOutDir: true, target: 'es2020',
    rollupOptions: { input: { main: resolve(__dirname, 'index.html'), admin: resolve(__dirname, 'A1121/index.html'), delivery: resolve(__dirname, '1121/index.html') } },
  },
});
