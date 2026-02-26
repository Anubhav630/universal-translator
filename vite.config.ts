import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Copy RunAnywhere WASM binaries into dist/assets
 * so Vercel can serve them in production.
 */
function copyWasmPlugin(): Plugin {
  return {
    name: 'copy-wasm',
    writeBundle(options) {
      const outDir = options.dir ?? path.resolve(__dirname, 'dist');
      const assetsDir = path.join(outDir, 'assets');

      fs.mkdirSync(assetsDir, { recursive: true });

      // ---------- LlamaCpp ----------
      const llamaDir = path.resolve(
        __dirname,
        'node_modules/@runanywhere/web-llamacpp/wasm'
      );

      const llamaFiles = [
        'racommons-llamacpp.wasm',
        'racommons-llamacpp.js',
        'racommons-llamacpp-webgpu.wasm',
        'racommons-llamacpp-webgpu.js',
      ];

      for (const file of llamaFiles) {
        const src = path.join(llamaDir, file);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(assetsDir, file));
          console.log(`✓ Copied ${file}`);
        }
      }

      // ---------- Sherpa ONNX ----------
      const sherpaDir = path.resolve(
        __dirname,
        'node_modules/@runanywhere/web-onnx/wasm/sherpa'
      );

      const sherpaOut = path.join(assetsDir, 'sherpa');
      fs.mkdirSync(sherpaOut, { recursive: true });

      if (fs.existsSync(sherpaDir)) {
        for (const file of fs.readdirSync(sherpaDir)) {
          fs.copyFileSync(
            path.join(sherpaDir, file),
            path.join(sherpaOut, file)
          );
          console.log(`✓ Copied sherpa/${file}`);
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), copyWasmPlugin()],

  worker: {
    format: 'es',
  },

  optimizeDeps: {
    exclude: [
      '@runanywhere/web',
      '@runanywhere/web-llamacpp',
      '@runanywhere/web-onnx',
    ],
  },

  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },

  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },

  assetsInclude: ['**/*.wasm'],
});