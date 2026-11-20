import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { buildWebAppManifest, normalizeBasePath } from './src/domain/pwa.js';
import {
  CANONICAL_ORIGIN,
  buildRobotsTxt,
  buildSeoHeadTags,
  buildSitemapXml,
} from './src/domain/seo.js';

function resolveSeoConfig() {
  const isVercelProd = Boolean(process.env.VERCEL)
    && process.env.VERCEL_ENV !== 'preview'
    && process.env.VERCEL_ENV !== 'development';
  return {
    isIndexable: process.env.SEO_INDEXABLE === 'true' || isVercelProd,
    canonicalOrigin: process.env.CANONICAL_ORIGIN || CANONICAL_ORIGIN,
    googleSiteVerification: process.env.VITE_GOOGLE_SITE_VERIFICATION || '',
  };
}

function seoPlugin() {
  let resolvedBase = '/';

  return {
    name: 'divide-seo',
    configResolved(config) {
      resolvedBase = normalizeBasePath(config.base);
    },
    transformIndexHtml(html) {
      const tags = buildSeoHeadTags(resolveSeoConfig());
      return html.replace('<!-- SEO_META_TAGS -->', tags);
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = req.url?.split('?')[0];
        const seo = resolveSeoConfig();
        if (pathname === '/robots.txt' || pathname === `${resolvedBase}robots.txt`) {
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end(buildRobotsTxt(seo));
          return;
        }
        if (seo.isIndexable && (pathname === '/sitemap.xml' || pathname === `${resolvedBase}sitemap.xml`)) {
          res.setHeader('Content-Type', 'application/xml; charset=utf-8');
          res.end(buildSitemapXml(seo));
          return;
        }
        next();
      });
    },
    generateBundle() {
      const seo = resolveSeoConfig();
      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: buildRobotsTxt(seo),
      });
      if (seo.isIndexable) {
        this.emitFile({
          type: 'asset',
          fileName: 'sitemap.xml',
          source: buildSitemapXml(seo),
        });
      }
    },
  };
}

function pwaManifestPlugin() {
  let resolvedBase = '/';

  return {
    name: 'divide-pwa-manifest',
    configResolved(config) {
      resolvedBase = normalizeBasePath(config.base);
    },
    configureServer(server) {
      const manifestUrl = `${resolvedBase}manifest.webmanifest`;
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] === manifestUrl || req.url?.split('?')[0] === '/manifest.webmanifest') {
          res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
          res.end(JSON.stringify(buildWebAppManifest(resolvedBase), null, 2));
          return;
        }
        next();
      });
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.webmanifest',
        source: JSON.stringify(buildWebAppManifest(resolvedBase), null, 2),
      });
    },
  };
}

export default defineConfig({
  base: process.env.VITE_BASE_PATH || (process.env.VERCEL ? '/' : '/divide/'),
  plugins: [
    tailwindcss(),
    react(),
    pwaManifestPlugin(),
    seoPlugin(),
  ],
  server: {
    port: 5173,
    proxy: {
      '/divide/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/divide/, ''),
      },
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
