import { defineConfig } from 'vite';
export default defineConfig({
    test: { include: ['tests/**/*.test.js'] },
    root: 'prototype',
    base: './',
    build: { outDir: '../dist/prototype', emptyOutDir: true },
    server: { port: 5174, strictPort: true },
});
