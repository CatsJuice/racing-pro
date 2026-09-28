import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves the project under /<repo>/; the workflow sets BASE_PATH
  base: process.env.BASE_PATH ?? '/',
  server: { port: 5173 },
});
