import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
    // The source is public and "the engineer reading the source for signs of
    // copy-paste" is one of the red-team personas in §9.1. Maps are separate
    // files, so they cost a visitor nothing and cost a reader nothing to get.
    sourcemap: true,
    // Shaders and the three core are the two big chunks; splitting them keeps
    // a shader edit from busting the vendor cache and vice versa.
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('node_modules/react')) return 'react';
          return undefined;
        },
      },
    },
    reportCompressedSize: true,
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx', 'src/**/*.test.ts'],
    css: true,
    restoreMocks: true,
  },
});
