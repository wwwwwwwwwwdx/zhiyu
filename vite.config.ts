import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // three 独立 chunk 未压缩约 521kB（gzip 132kB）且会被强缓存，调高阈值避免误报
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // 拆分重依赖，降低单包体积并改善缓存
        manualChunks: {
          three: ['three'],
          react: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
