import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** 开发环境把 SPA 路由重写到 public 下的入口文件。 */
function publicIndexFallback(): Plugin {
  return {
    name: 'public-index-fallback',
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        const pathname = (request as { url?: string }).url?.split('?')[0];
        if (pathname === '/' || pathname === '/app') {
          (request as { url?: string }).url = '/public/index.html';
        } else if (pathname === '/logo.png') {
          (request as { url?: string }).url = '/public/logo.png';
        }
        next();
      });
    },
  };
}

export default defineConfig(({ command }) => ({
  root: command === 'build' ? 'public' : undefined,
  publicDir: false,
  plugins: [
    react(),
    command === 'serve' ? publicIndexFallback() : undefined,
  ],
  build: {
    target: 'es2022',
    outDir: command === 'build' ? '../dist' : 'dist',
    emptyOutDir: true,
  },
}));
