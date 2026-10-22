import { defineConfig } from 'vite';

export default defineConfig({
    root: 'prototype',
    base: './',
    build: {
        outDir: '../dist/prototype',
        emptyOutDir: true,
    },
    server: {
        port: 5173,
        strictPort: true,
    },
    test: {
        include: ['tests/**/*.test.js'],
    },
});
