import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import glsl from 'vite-plugin-glsl';
import { prerenderPlugin } from './tools/prerender.mjs';

export default defineConfig({
  plugins: [
    react(),
    /*
     * §5.1's entire justification for choosing Vite over Next.js is that "SEO is
     * solved by build-time prerender of the text layer into index.html". This is
     * that prerender. Without it the built index.html ships an empty div and
     * §6.1's promise of a complete document without a WebGL frame holds only for
     * visitors whose JavaScript ran.
     */
    prerenderPlugin(),
    /*
     * Shader chunks are real .glsl files with #include, not template strings in
     * TypeScript. §5.4 requires a documented chunk library, and a chunk you can
     * open in an editor with GLSL syntax highlighting is one people will read.
     *
     * `minify` stays off. §10 forbids unminified shaders in the *critical
     * path*; these are compiled at runtime out of the JS bundle, which is
     * already minified and gzipped. Stripping the comments would remove the one
     * thing §5.4 requires a chunk to carry — where the maths came from — to
     * save a few hundred bytes after compression.
     */
    glsl({
      include: ['**/*.glsl', '**/*.vert', '**/*.frag'],
      minify: false,
      watch: true,
    }),
  ],
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
