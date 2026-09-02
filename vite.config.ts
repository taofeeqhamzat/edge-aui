import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import path from 'path';

export default defineConfig({
  plugins: [
    wasm()
  ],
  resolve: {
    alias: {
      '@': path.resolve('./src')
    }
  },
  worker: {
    format: 'es',
    plugins: () => [
      wasm()
    ]
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    }
  },
  build: {
    target: 'esnext'
  }
});
