import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      'three/examples/jsm/utils/BufferGeometryUtils': path.resolve(__dirname, 'src/buffer-geometry-utils-patch.js'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
});
