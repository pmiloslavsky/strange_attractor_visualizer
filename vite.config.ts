import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the built site works from any subpath (GitHub Pages
  // project sites, Netlify/Vercel previews) without reconfiguration.
  base: './',
  build: {
    target: 'es2022',
  },
});
