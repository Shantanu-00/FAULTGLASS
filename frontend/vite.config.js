import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    rollupOptions: { input: { twin: 'index.html', console: 'console.html', field: 'field.html' } },
  },
  server: { port: 5173, strictPort: true },
});
