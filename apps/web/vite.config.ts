import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The web app imports the tested physics engine and contract types straight from ../../packages,
// so the browser runs exactly the code the validator ran.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: '127.0.0.1',
    proxy: { '/api': 'http://127.0.0.1:8787' },
    fs: { allow: ['../..'] },
  },
});
