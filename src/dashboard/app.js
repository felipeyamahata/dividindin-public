import express from 'express';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { config } from '../config.js';
import { getDashboardMetrics } from '../domain/analytics.js';
import { renderDashboardHtml } from './html.js';

const DEFAULT_PRESENCE_TIMEOUT_MS = 800;
const DEFAULT_METRICS_CACHE_TTL_MS = 5000;

function isPrivateNetworkIp(rawAddress = '') {
  const ip = String(rawAddress).replace(/^::ffff:/, '');
  if (!ip) return false;
  if (ip === '127.0.0.1' || ip === '::1') return true;
  if (ip.startsWith('10.') || ip.startsWith('192.168.')) return true;
  // Tailscale CGNAT range: 100.64.0.0/10 (100.64.0.0 - 100.127.255.255)
  if (ip.startsWith('100.')) {
    const secondOctet = Number(ip.split('.')[1]);
    if (Number.isInteger(secondOctet) && secondOctet >= 64 && secondOctet <= 127) {
      return true;
    }
  }
  // Tailscale IPv6 ULA prefix: fd7a:115c:a1e0::/48
  if (ip.toLowerCase().startsWith('fd7a:115c:a1e0:')) return true;
  return false;
}

function getStorageStats(dbPath) {
  const safeSize = (target) => {
    try {
      return existsSync(target) ? statSync(target).size : 0;
    } catch {
      return 0;
    }
  };
  const dbBytes = safeSize(dbPath);
  const walBytes = safeSize(`${dbPath}-wal`);
  const shmBytes = safeSize(`${dbPath}-shm`);
  return {
    dbPath,
    dbBytes,
    walBytes,
    shmBytes,
    totalBytes: dbBytes + walBytes + shmBytes,
  };
}

async function resolvePresenceSnapshot({ presenceUrl, presenceFetcher, fallback }) {
  if (!presenceUrl && !presenceFetcher) {
    return {
      source: 'fallback-sql',
      degraded: false,
      reason: 'presence-endpoint-disabled',
      windowMinutes: fallback.windowMinutes,
      maxUsers: 2000,
      rssMb: null,
      count: fallback.count,
      recent60mCount: fallback.recent60mCount,
      pwaCount: 0,
      browserCount: 0,
      users: fallback.users,
    };
  }

  try {
    const fetcher = presenceFetcher || (async (url) => {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(DEFAULT_PRESENCE_TIMEOUT_MS),
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.json();
    });

    const live = await fetcher(presenceUrl);
    if (!live || live.degraded) {
      return {
        source: 'fallback-sql',
        degraded: true,
        reason: live?.reason || 'circuit-breaker',
        windowMinutes: fallback.windowMinutes,
        maxUsers: live?.maxUsers || 2000,
        rssMb: live?.rssMb ?? null,
        count: fallback.count,
        recent60mCount: fallback.recent60mCount,
        pwaCount: 0,
        browserCount: 0,
        users: fallback.users,
      };
    }

    return {
      source: 'memory-ttl',
      degraded: false,
      reason: null,
      windowMinutes: live.ttlMinutes || 5,
      maxUsers: live.maxUsers || 2000,
      rssMb: live.rssMb ?? null,
      uptimeSeconds: live.uptimeSeconds ?? null,
      count: Number(live.count || 0),
      recent60mCount: fallback.recent60mCount,
      pwaCount: Number(live.pwaCount || 0),
      browserCount: Number(live.browserCount || 0),
      users: Array.isArray(live.users) ? live.users : [],
    };
  } catch {
    return {
      source: 'fallback-sql',
      degraded: true,
      reason: 'api-timeout-or-unreachable',
      windowMinutes: fallback.windowMinutes,
      maxUsers: 2000,
      rssMb: null,
      count: fallback.count,
      recent60mCount: fallback.recent60mCount,
      pwaCount: 0,
      browserCount: 0,
      users: fallback.users,
    };
  }
}

/**
 * Creates the read-only Tailscale-only analytics dashboard Express application.
 */
export function createDashboardApp({
  dbPath = process.env.DATABASE_PATH || path.resolve(path.dirname(config.databasePath), 'divide.sqlite'),
  environmentLabel = process.env.DASHBOARD_ENV || 'production',
  port = Number(process.env.DASHBOARD_PORT || 3003),
  readOnly = true,
  dbHandle = null,
  presenceUrl = process.env.PRESENCE_URL ?? 'http://127.0.0.1:3001/internal/presence',
  presenceFetcher = null,
  cacheTtlMs = DEFAULT_METRICS_CACHE_TTL_MS,
} = {}) {
  const app = express();
  const metricsCache = new Map();

  app.use((req, res, next) => {
    const remoteIp = req.socket?.remoteAddress || '';
    if (!isPrivateNetworkIp(remoteIp)) {
      return res.status(403).json({ error: 'Acesso restrito à rede privada Tailscale' });
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  function withDb(callback) {
    if (dbHandle) {
      return callback(dbHandle);
    }
    if (!existsSync(dbPath)) {
      throw new Error(`Banco de dados ainda não encontrado em ${dbPath}`);
    }
    const db = new DatabaseSync(dbPath, { readOnly });
    try {
      db.exec('PRAGMA busy_timeout = 3000;');
      return callback(db);
    } finally {
      db.close();
    }
  }

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      app: 'dividindin-dashboard',
      environment: environmentLabel,
      port,
      readOnly,
      dbExists: Boolean(dbHandle) || existsSync(dbPath),
    });
  });

  app.get('/api/metrics', async (req, res) => {
    try {
      const days = Number(req.query.days || 14);
      const logLimit = Number(req.query.logLimit || 80);
      const logType = typeof req.query.logType === 'string' ? req.query.logType : '';
      const bypassCache = req.query.fresh === '1';
      const cacheKey = `${days}:${logLimit}:${logType}`;
      const nowMs = Date.now();

      if (!bypassCache && cacheTtlMs > 0) {
        const cached = metricsCache.get(cacheKey);
        if (cached && nowMs - cached.storedAt < cacheTtlMs) {
          return res.json(cached.payload);
        }
      }

      const metrics = withDb((db) => getDashboardMetrics(db, { days, logLimit, logType }));
      const presence = await resolvePresenceSnapshot({
        presenceUrl,
        presenceFetcher,
        fallback: metrics.presenceFallback,
      });

      const payload = {
        ...metrics,
        presence,
        environment: environmentLabel,
        storage: dbHandle
          ? { dbPath: ':memory:', dbBytes: 0, walBytes: 0, shmBytes: 0, totalBytes: 0 }
          : getStorageStats(dbPath),
      };

      if (cacheTtlMs > 0) {
        if (metricsCache.size >= 24) metricsCache.clear();
        metricsCache.set(cacheKey, { storedAt: nowMs, payload });
      }

      res.json(payload);
    } catch (err) {
      res.status(503).json({ error: err.message || 'Erro ao ler métricas do SQLite' });
    }
  });

  app.get('/', (_req, res) => {
    res.type('html').send(renderDashboardHtml({ environmentLabel, port }));
  });

  return app;
}
