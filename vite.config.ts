import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1421,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**', '**/crates/**'] },
  },
  envPrefix: ['VITE_'],
  build: { target: 'safari15.4', sourcemap: false },
});
