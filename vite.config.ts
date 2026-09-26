import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the built site works from any subpath (GitHub Pages
  // project sites, Netlify/Vercel previews) without reconfiguration.
  base: './',
  build: {
    target: 'es2022',
  },
  server: {
    // Native file events on Windows sometimes drop the second of two quick
    // saves, leaving the dev server serving a stale module. Polling is cheap
    // for a project this size and makes reloads reliable.
    watch: { usePolling: true, interval: 150 },
  },
});
