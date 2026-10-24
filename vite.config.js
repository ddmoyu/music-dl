import { defineConfig } from 'vite';
import { localServicePlugin } from './scripts/local-service.js';

export default defineConfig({
    plugins: [localServicePlugin()],
    base: './',
    build: {
        outDir: 'dist/app',
        emptyOutDir: true,
    },
    server: {
        port: 5175,
        strictPort: true,
    },
    test: {
        include: ['tests/**/*.test.js'],
    },
});
