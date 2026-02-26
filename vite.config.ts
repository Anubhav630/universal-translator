import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],

  // ---------------------------------------------------------------------------
  // Worker configuration
  // ---------------------------------------------------------------------------
  worker: {
    format: 'es',
  },

  // ---------------------------------------------------------------------------
  // Dependency optimization
  // ---------------------------------------------------------------------------
  // RunAnywhere packages ship pre-built ES modules that dynamically import
  // their own WASM files at runtime (e.g. racommons-llamacpp-webgpu.js).
  // If Vite pre-bundles these packages it rewrites their internal import paths,
  // breaking the dynamic WASM fetch. Excluding them forces Vite to serve the
  // originals straight from node_modules untouched.
  optimizeDeps: {
    exclude: [
      '@runanywhere/web',
      '@runanywhere/web-llamacpp',
      '@runanywhere/web-onnx',
    ],
  },

  // ---------------------------------------------------------------------------
  // Dev-server
  // ---------------------------------------------------------------------------
  server: {
    headers: {
      // Required for SharedArrayBuffer (multi-threaded WASM in ONNX backend)
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    // Allow Vite to serve files directly out of node_modules so that the
    // dynamically-imported WASM JS shims (e.g. racommons-llamacpp-webgpu.js)
    // are reachable at their real paths.
    fs: {
      allow: ['..'],
    },
  },

  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
