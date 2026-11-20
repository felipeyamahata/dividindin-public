import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { config } from './config.js';
import { getDb } from './db/connection.js';
import { startMaintenanceScheduler } from './db/maintenance.js';
import { resolveRateLimitIp } from './domain/clientIp.js';
import { presenceTracker } from './domain/presence.js';
import { authMiddleware } from './middleware/auth.js';
import { createLoadSheddingMiddleware } from './middleware/loadShedding.js';
import authRoutes from './routes/auth.js';
import eventRoutes from './routes/events.js';
import expenseRoutes from './routes/expenses.js';
import settlementRoutes from './routes/settlements.js';
import sustainabilityRoutes from './routes/sustainability.js';
import { createSustainabilityAdminRouter } from './admin/sustainabilityAdmin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(__dirname, '../dist');

const app = express();

// Allow deployed frontend, same-origin requests, and explicitly configured development origins.
const allowedOrigins = new Set([
  'https://dividindin.com',
  'https://www.dividindin.com',
  ...(process.env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean),
]);
if (!config.isProd) {
  for (const origin of ['http://localhost:5173', 'http://127.0.0.1:5173']) allowedOrigins.add(origin);
}

function isOriginAllowed(origin, req) {
  if (!origin) return true;
  const cleanOrigin = origin.replace(/\/+$/, '').toLowerCase();

  // Same-origin check: does origin match Host header?
  const host = req.headers.host;
  if (host) {
    const cleanHost = host.toLowerCase();
    if (cleanOrigin === `http://${cleanHost}` || cleanOrigin === `https://${cleanHost}`) {
      return true;
    }
  }

  // Pre-configured allowed origins
  if (allowedOrigins.has(cleanOrigin)) return true;

  // Development & staging environments (Tailscale / local network)
  if (!config.isProd) {
    try {
      const parsed = new URL(cleanOrigin);
      if (
        parsed.hostname === 'localhost' ||
        parsed.hostname === '127.0.0.1' ||
        parsed.hostname.endsWith('.ts.net') ||
        parsed.hostname.startsWith('100.')
      ) {
        return true;
      }
    } catch {
      // Invalid URL syntax
    }
  }

  return false;
}

app.use((req, res, next) => {
  const origin = req.headers.origin;
  res.setHeader('Vary', 'Origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  if (origin) {
    if (!isOriginAllowed(origin, req)) {
      if (req.path.startsWith('/api') || req.path.startsWith('/divide/api')) {
        return res.status(403).json({ error: 'Origem não permitida' });
      }
      return next();
    }
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Client-Mode');
    res.setHeader('Access-Control-Max-Age', '86400');
  }

  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Cloudflared typically connects over loopback. Trust its client IP only when
// explicitly enabled and the direct peer is loopback; block direct public access.
const buckets = new Map();
app.use((req, res, next) => {
  const now = Date.now();
  const ip = resolveRateLimitIp(req, {
    isProd: config.isProd,
    trustCloudflareProxy: process.env.TRUST_CLOUDFLARE_PROXY === 'true',
    allowDevSimulatedIp: process.env.ALLOW_DEV_SIMULATED_IP === 'true',
  });
  const auth = /\/api\/auth\/(login|register|google)$/.test(req.path);
  const invite = req.method === 'GET' && /\/api\/events\/[^/]+$/.test(req.path);
  const kind = auth ? 'auth' : invite ? 'invite' : 'general';
  const limit = auth ? 30 : invite ? 120 : 450;
  const key = `${kind}:${ip}`;
  let bucket = buckets.get(key);
  if (!bucket || bucket.reset <= now) bucket = { count: 0, reset: now + 60000 };
  bucket.count++;
  buckets.set(key, bucket);
  if (buckets.size > 10000) {
    for (const [k, v] of buckets) if (v.reset <= now) buckets.delete(k);
    if (buckets.size > 10000) buckets.delete(buckets.keys().next().value);
  }
  if (bucket.count > limit) {
    res.setHeader('Retry-After', Math.ceil((bucket.reset - now) / 1000));
    return res.status(429).json({ error: 'Muitas solicitações. Tente novamente em instantes.' });
  }
  next();
});

app.use(createLoadSheddingMiddleware());
app.use(express.json({ limit: '128kb' }));
app.use(cookieParser());
app.use(authMiddleware);

// Mount API routes on both /api and /divide/api for reverse-path flexibility
const apiRouter = express.Router();
apiRouter.use('/auth', authRoutes);
apiRouter.use('/events', eventRoutes);
apiRouter.use('/expenses', expenseRoutes);
apiRouter.use('/sustainability', sustainabilityRoutes);
apiRouter.use('/', settlementRoutes);
apiRouter.use('/', expenseRoutes);

app.use('/divide/api', apiRouter);
app.use('/api', apiRouter);

// Tailscale-only sustainability admin portal (never reachable through Cloudflare Tunnel)
const sustainabilityAdminRouter = createSustainabilityAdminRouter();
app.use('/divide/admin', sustainabilityAdminRouter);
app.use('/admin', sustainabilityAdminRouter);

// Health check endpoint
const sendHealth = (req, res) => res.json({
  status: 'ok',
  app: 'dividindin',
  mode: config.serveStatic ? 'fullstack' : 'headless-api',
  environment: config.isProd ? 'production' : 'development',
  port: config.port,
});
app.get('/health', sendHealth);
app.get('/divide/health', sendHealth);

// Loopback-only presence snapshot for the private analytics dashboard (never reachable through Cloudflare Tunnel).
function isDirectLoopback(req) {
  const peer = req.socket?.remoteAddress || '';
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer)) return false;
  const proxyHeaders = ['cf-connecting-ip', 'cf-ray', 'x-forwarded-for', 'x-forwarded-host', 'forwarded', 'via'];
  return !proxyHeaders.some((header) => req.headers[header] !== undefined);
}

app.get('/internal/presence', (req, res) => {
  if (!isDirectLoopback(req)) {
    return res.status(403).json({ error: 'Acesso restrito ao loopback local' });
  }
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ...presenceTracker.snapshot({ limit: Number(req.query.limit || 100) }),
    uptimeSeconds: Math.round(process.uptime()),
  });
});

// In Headless mode (Production port 3001), do NOT serve static frontend files.
// Port 3001 acts strictly as a dedicated API & SQLite Database Engine.
if (!config.serveStatic) {
  app.use((req, res) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/divide/api')) {
      return res.status(404).json({ error: 'Endpoint não encontrado' });
    }
    res.json({
      app: 'dividindin-api',
      mode: 'headless-data-service',
      environment: config.isProd ? 'production' : 'development',
      port: config.port,
      frontend: 'https://dividindin.com',
      status: 'online',
    });
  });
} else if (existsSync(distPath)) {
  // Development / Staging mode (Port 3002): serve full UI for interactive testing
  app.use('/divide', express.static(distPath));
  app.use('/', express.static(distPath));

  // SPA fallback middleware
  app.use((req, res) => {
    // API 404 guard
    if (req.path.startsWith('/api') || req.path.startsWith('/divide/api')) {
      return res.status(404).json({ error: 'Endpoint não encontrado' });
    }

    if (req.path === '/' || req.path === '') {
      return res.redirect('/divide/');
    }

    res.sendFile(path.join(distPath, 'index.html'));
  });
} else {
  // Helpful fallback during development before first build
  app.use((req, res) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/divide/api')) {
      return res.status(404).json({ error: 'Endpoint não encontrado' });
    }
    res.send(`
      <!DOCTYPE html>
      <html>
        <head><title>Dividindin</title><meta charset="utf-8"></head>
        <body style="font-family: sans-serif; text-align: center; padding: 50px;">
          <h1>Dividindin API Online</h1>
          <p>Execute <code>npm run build</code> para gerar os assets do frontend.</p>
        </body>
      </html>
    `);
  });
}

getDb();
startMaintenanceScheduler(getDb);

if (config.isProd && process.env.TRUST_CLOUDFLARE_PROXY !== 'true') {
  console.warn('⚠️  TRUST_CLOUDFLARE_PROXY is not set to "true": behind Cloudflare Tunnel all users share one rate-limit bucket.');
}

app.listen(config.port, config.host, () => {
  console.log(`🚀 Dividindin server (${config.serveStatic ? 'Fullstack' : 'Headless API'}) listening on http://${config.host}:${config.port}`);
  console.log(`📱 Tailscale URL: http://staging.example.ts.net:${config.port}${config.serveStatic ? '/divide' : '/health'}`);
});
