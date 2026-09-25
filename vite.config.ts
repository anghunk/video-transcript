import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const PUBLIC_ASSET_PATHS = new Set([
  '/logo.webp',
  '/sw.js',
  '/site.webmanifest',
  '/favicon-16x16.png',
  '/favicon-32x32.png',
  '/apple-touch-icon.png',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/pwa-maskable-512.png',
]);

/** 开发环境把 SPA 路由重写到 public 下的入口文件。 */
function publicIndexFallback(): Plugin {
  return {
    name: 'public-index-fallback',
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        const pathname = (request as { url?: string }).url?.split('?')[0];
        if (
          pathname === '/'
          || pathname === '/app'
          || pathname === '/projects'
          || pathname?.startsWith('/projects/')
        ) {
          (request as { url?: string }).url = '/public/index.html';
        } else if (pathname && PUBLIC_ASSET_PATHS.has(pathname)) {
          (request as { url?: string }).url = `/public${pathname}`;
        }
        next();
      });
    },
  };
}

/** 构建时把 PWA 入口文件按站点根路径原样输出，避免被 Vite 改写为哈希资源。 */
function emitPwaAssets(): Plugin {
  return {
    name: 'emit-pwa-assets',
    apply: 'build',
    generateBundle() {
      for (const pathname of PUBLIC_ASSET_PATHS) {
        this.emitFile({
          type: 'asset',
          fileName: pathname.slice(1),
          source: readFileSync(new URL(`./public${pathname}`, import.meta.url)),
        });
      }
    },
  };
}

export default defineConfig(({ command }) => ({
  root: command === 'build' ? 'public' : undefined,
  publicDir: false,
  /* 使用外置 WASM 入口，避免把约 26 MB 的 ONNX Runtime 文件复制进 dist。 */
  resolve: {
    conditions: [
      'module',
      'browser',
      'development|production',
      'onnxruntime-web-use-extern-wasm',
    ],
  },
  plugins: [
    react(),
    command === 'serve' ? publicIndexFallback() : undefined,
    command === 'build' ? emitPwaAssets() : undefined,
  ],
  build: {
    target: 'es2022',
    outDir: command === 'build' ? '../dist' : 'dist',
    emptyOutDir: true,
  },
}));
