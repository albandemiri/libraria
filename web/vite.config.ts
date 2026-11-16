/// <reference types="vitest/config" />
import { reactRouter } from '@react-router/dev/vite';
import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';

export default defineConfig({
  // The React Router plugin builds the app; Vitest renders modules directly without it.
  plugins: [!process.env.VITEST && reactRouter()],
  server: {
    port: 5174,
    strictPort: true,
    // @libraria/design is a symlink to ../design; its tokens.css is served from there.
    fs: { allow: ['.', '../design'] },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./app/test-setup.ts'],
    globals: false,
    // Playwright's end-to-end specs run with `npm run e2e`, not Vitest.
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
});
