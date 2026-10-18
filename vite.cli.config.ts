import { defineConfig } from 'vite'

// Bundles the CLI into a single file Node can run, no TypeScript loader needed.
export default defineConfig({
  build: {
    ssr: 'cli/vulngate.ts',
    outDir: 'dist-cli',
    emptyOutDir: true,
    target: 'node20',
    minify: false,
    rollupOptions: {
      output: {
        entryFileNames: 'vulngate.mjs',
        banner: '#!/usr/bin/env node',
      },
    },
  },
})
