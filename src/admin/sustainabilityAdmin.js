import { Router } from 'express';
import { config } from '../config.js';
import { getDb } from '../db/connection.js';
import {
  deleteSustainabilityCost,
  deleteSustainabilityDonation,
  listSustainabilityCosts,
  listSustainabilityDonations,
  recordSustainabilityDonation,
  updateSustainabilitySettings,
  upsertSustainabilityCost,
} from '../db/sustainability.js';
import { createUsdRateProvider } from '../domain/usdRate.js';
import { resolveMonthlySnapshot } from '../routes/sustainability.js';
import { renderSustainabilityAdminHtml } from './sustainabilityAdminHtml.js';

const PROXY_HEADERS = [
  'cf-connecting-ip',
  'cf-ray',
  'x-forwarded-for',
  'x-forwarded-host',
  'forwarded',
  'via',
];

/**
 * Verifies that a request came directly over loopback, LAN, or Tailscale without passing through a public proxy/tunnel.
 * @param {import('express').Request} req
 * @returns {boolean}
 */
export function isPrivateTailscaleRequest(req) {
  if (PROXY_HEADERS.some((header) => req.headers?.[header] !== undefined)) {
    return false;
  }
  const ip = String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  if (!ip) return false;
  if (ip === '127.0.0.1' || ip === '::1') return true;
  if (ip.startsWith('10.') || ip.startsWith('192.168.')) return true;
  if (ip.startsWith('100.')) {
    const secondOctet = Number(ip.split('.')[1]);
    if (Number.isInteger(secondOctet) && secondOctet >= 64 && secondOctet <= 127) {
      return true;
    }
  }
  if (ip.toLowerCase().startsWith('fd7a:115c:a1e0:')) return true;
  return false;
}

/**
 * Builds full admin state payload (settings, all costs, recent donations, live snapshot).
 */
async function buildAdminState(db, usdRateProvider, paymentMode) {
  const { settings, snapshot } = await resolveMonthlySnapshot(db, usdRateProvider, { paymentMode });
  const costs = listSustainabilityCosts(db, { activeOnly: false });
  const donations = listSustainabilityDonations(db, { limit: 40 });
  return { settings, snapshot, costs, donations };
}

/**
 * Creates the Tailscale-only sustainability admin router (HTML UI + JSON API).
 * @param {{ usdRateProvider?: ReturnType<typeof createUsdRateProvider>, dbOverride?: import('node:sqlite').DatabaseSync, paymentMode?: string }} [options]
 */
export function createSustainabilityAdminRouter({
  usdRateProvider = createUsdRateProvider(),
  dbOverride = null,
  paymentMode = config.mercadoPagoAccessToken ? 'mercadopago' : 'static-pix',
} = {}) {
  const router = Router();
  const resolveDb = () => dbOverride || getDb();

  router.use((req, res, next) => {
    if (!isPrivateTailscaleRequest(req)) {
      return res.status(403).json({ error: 'Acesso restrito à rede privada Tailscale' });
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    next();
  });

  router.get('/sustentabilidade', (req, res) => {
    const basePath = req.baseUrl.startsWith('/divide') ? '/divide' : '';
    res.type('html').send(renderSustainabilityAdminHtml({
      basePath,
      environmentLabel: config.isProd ? 'production' : 'staging',
    }));
  });

  router.get('/api/sustainability/state', async (_req, res) => {
    try {
      res.json(await buildAdminState(resolveDb(), usdRateProvider, paymentMode));
    } catch (err) {
      res.status(500).json({ error: err.message || 'Erro ao carregar estado' });
    }
  });

  router.put('/api/sustainability/settings', async (req, res) => {
    try {
      const db = resolveDb();
      updateSustainabilitySettings(db, req.body || {});
      usdRateProvider.clearCache();
      res.json(await buildAdminState(db, usdRateProvider, paymentMode));
    } catch (err) {
      res.status(400).json({ error: err.message || 'Configuração inválida' });
    }
  });

  router.post('/api/sustainability/costs', async (req, res) => {
    try {
      const db = resolveDb();
      upsertSustainabilityCost(db, req.body || {});
      res.json(await buildAdminState(db, usdRateProvider, paymentMode));
    } catch (err) {
      res.status(400).json({ error: err.message || 'Custo inválido' });
    }
  });

  router.delete('/api/sustainability/costs/:id', async (req, res) => {
    try {
      const db = resolveDb();
      deleteSustainabilityCost(db, req.params.id);
      res.json(await buildAdminState(db, usdRateProvider, paymentMode));
    } catch (err) {
      res.status(400).json({ error: err.message || 'Erro ao remover custo' });
    }
  });

  router.post('/api/sustainability/donations', async (req, res) => {
    try {
      const db = resolveDb();
      recordSustainabilityDonation(db, req.body || {});
      res.json(await buildAdminState(db, usdRateProvider, paymentMode));
    } catch (err) {
      res.status(400).json({ error: err.message || 'Doação inválida' });
    }
  });

  router.delete('/api/sustainability/donations/:id', async (req, res) => {
    try {
      const db = resolveDb();
      deleteSustainabilityDonation(db, req.params.id);
      res.json(await buildAdminState(db, usdRateProvider, paymentMode));
    } catch (err) {
      res.status(400).json({ error: err.message || 'Erro ao remover lançamento' });
    }
  });

  return router;
}
