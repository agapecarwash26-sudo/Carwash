import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1];

export default defineConfig({
  // Works locally at / and automatically uses /<repo>/ on GitHub Pages.
  base: process.env.GITHUB_ACTIONS === 'true' && repositoryName ? `/${repositoryName}/` : '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
  },
});
