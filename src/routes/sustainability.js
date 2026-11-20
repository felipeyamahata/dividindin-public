import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { config } from '../config.js';
import { getDb } from '../db/connection.js';
import {
  cancelProviderDonation,
  confirmProviderDonation,
  createPendingProviderDonation,
  getDonationByProviderPayment,
  getMonthDonationsTotalCents,
  getSustainabilitySettings,
  listSustainabilityCosts,
  updateCachedUsdRate,
} from '../db/sustainability.js';
import { recordActivityLog } from '../db/telemetry.js';
import { buildPixPayload, maskPixKey } from '../domain/pix.js';
import {
  computeMonthlySustainabilitySnapshot,
  getCurrentMonthKey,
  validateDonationAmountCents,
} from '../domain/sustainability.js';
import { createUsdRateProvider } from '../domain/usdRate.js';
import {
  createMercadoPagoPixClient,
  verifyMercadoPagoWebhookSignature,
} from '../services/mercadoPagoPix.js';

const EXTERNAL_REF_PREFIX = 'divide-sust_';

function isDividindinExternalRef(externalRef) {
  const ref = String(externalRef || '');
  return ref.startsWith(EXTERNAL_REF_PREFIX) || ref.startsWith('divide-sust:');
}

function parseMonthFromExternalRef(externalRef, fallbackMonthKey) {
  const match = /^divide-sust[_:](\d{4}-\d{2})[_:]/.exec(String(externalRef || ''));
  return match ? match[1] : fallbackMonthKey;
}

/**
 * Resolves the live sustainability snapshot using the active DB and USD rate provider.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {ReturnType<typeof createUsdRateProvider>} usdRateProvider
 * @param {{ paymentMode?: 'mercadopago' | 'static-pix' }} [options]
 */
export async function resolveMonthlySnapshot(db, usdRateProvider, { paymentMode = 'static-pix' } = {}) {
  const settings = getSustainabilitySettings(db);
  const costs = listSustainabilityCosts(db, { activeOnly: true });
  const monthKey = getCurrentMonthKey();
  const confirmedCents = getMonthDonationsTotalCents(db, monthKey);

  const rateResult = await usdRateProvider.resolveRate({
    useAuto: settings.useAutoUsd,
    fallbackRate: settings.usdBrlFallback,
    persistedRate: settings.usdBrlCached,
    persistedAt: settings.usdBrlCachedAt,
    onRateFetched: (rate, isoTime) => {
      try {
        updateCachedUsdRate(db, rate, isoTime);
      } catch {
        // Cache persistence is best-effort.
      }
    },
  });

  const isMp = paymentMode === 'mercadopago';
  const snapshot = computeMonthlySustainabilitySnapshot({
    monthKey,
    costs,
    confirmedCents,
    usdToBrlRate: rateResult.rate,
    rateSource: rateResult.source,
    rateUpdatedAt: rateResult.updatedAt,
    introText: settings.introText,
    pixEnabled: isMp || Boolean(settings.pixKey),
  });

  return {
    settings,
    snapshot: {
      ...snapshot,
      paymentMode: isMp ? 'mercadopago' : 'static-pix',
    },
  };
}

/**
 * Reconciles a Mercado Pago payment status against SQLite if it belongs to DiviDinDin!.
 */
async function syncMercadoPagoPayment({ db, mpClient, paymentId, fallbackMonthKey, resourceType }) {
  const payment = await mpClient.getPaymentStatus(paymentId, { resourceType });
  if (!isDividindinExternalRef(payment.externalReference)) {
    return { ignored: true, status: payment.status };
  }

  if (payment.status === 'approved') {
    const monthKey = parseMonthFromExternalRef(payment.externalReference, fallbackMonthKey);
    const { donation, newlyConfirmed } = confirmProviderDonation(db, {
      provider: 'mercadopago',
      providerPaymentId: payment.paymentId,
      amountCents: payment.amountCents,
      monthKey,
      confirmedAt: payment.dateApproved || undefined,
      note: 'Mercado Pago Pix automático',
    });
    if (newlyConfirmed) {
      try {
        recordActivityLog(db, {
          eventType: 'sustainability_pix_confirmed',
          metadata: { provider: 'mercadopago', amount_cents: donation.amount_cents },
        });
      } catch {
        // Telemetry failure must not break confirmation.
      }
    }
    return { ignored: false, status: 'confirmed', donation };
  }

  if (['cancelled', 'rejected', 'refunded', 'charged_back'].includes(payment.status)) {
    cancelProviderDonation(db, {
      provider: 'mercadopago',
      providerPaymentId: payment.paymentId,
    });
    return { ignored: false, status: 'cancelled' };
  }

  return { ignored: false, status: 'pending' };
}

/**
 * Creates the public sustainability API router (/api/sustainability).
 * @param {{
 *   usdRateProvider?: ReturnType<typeof createUsdRateProvider>,
 *   mercadoPagoClient?: ReturnType<typeof createMercadoPagoPixClient>,
 *   dbOverride?: import('node:sqlite').DatabaseSync,
 * }} [options]
 */
export function createSustainabilityRouter({
  usdRateProvider = createUsdRateProvider(),
  mercadoPagoClient = createMercadoPagoPixClient({
    accessToken: config.mercadoPagoAccessToken,
    webhookSecret: config.mercadoPagoWebhookSecret,
    notificationUrl: config.mercadoPagoNotificationUrl,
    payerEmail: config.mercadoPagoPayerEmail,
    apiMode: config.mercadoPagoApiMode,
  }),
  dbOverride = null,
} = {}) {
  const router = Router();
  const resolveDb = () => dbOverride || getDb();
  const activePaymentMode = mercadoPagoClient.isEnabled ? 'mercadopago' : 'static-pix';

  router.get('/', async (_req, res) => {
    try {
      const db = resolveDb();
      const { snapshot } = await resolveMonthlySnapshot(db, usdRateProvider, {
        paymentMode: activePaymentMode,
      });
      res.setHeader('Cache-Control', 'no-store');
      res.json(snapshot);
    } catch (err) {
      res.status(500).json({ error: err.message || 'Erro ao carregar meta de autossustentabilidade' });
    }
  });

  router.post('/pix', async (req, res) => {
    try {
      const amountCents = validateDonationAmountCents(req.body?.amountCents);
      const db = resolveDb();
      const settings = getSustainabilitySettings(db);
      const monthKey = getCurrentMonthKey();

      if (mercadoPagoClient.isEnabled) {
        const refToken = randomUUID();
        const externalReference = `${EXTERNAL_REF_PREFIX}${monthKey}_${refToken}`;
        const created = await mercadoPagoClient.createPixPayment({
          amountCents,
          description: 'Apoio DiviDinDin',
          externalReference,
          idempotencyKey: refToken,
        });

        createPendingProviderDonation(db, {
          monthKey,
          amountCents,
          provider: 'mercadopago',
          providerPaymentId: created.paymentId,
          expiresAt: created.expiresAt,
          note: 'Mercado Pago Pix automático',
        });

        try {
          recordActivityLog(db, {
            eventType: 'sustainability_pix_generated',
            userId: req.user?.id || null,
            metadata: { provider: 'mercadopago', amount_cents: amountCents },
          });
        } catch {
          // Telemetry failure must not block donation flow.
        }

        res.setHeader('Cache-Control', 'no-store');
        return res.json({
          mode: 'mercadopago',
          paymentId: created.paymentId,
          payload: created.qrCode,
          expiresAt: created.expiresAt,
          amountCents,
          merchantName: settings.merchantName,
          merchantCity: settings.merchantCity,
          pixKeyMasked: 'Mercado Pago Pix',
        });
      }

      if (!settings.pixKey) {
        return res.status(503).json({
          error: 'Chave Pix ainda não configurada pelo administrador.',
        });
      }

      const monthCompact = monthKey.replace('-', '');
      const payload = buildPixPayload({
        pixKey: settings.pixKey,
        merchantName: settings.merchantName,
        merchantCity: settings.merchantCity,
        amountCents,
        txid: `DIVIDE${monthCompact}`,
        description: 'Apoio DiviDinDin',
      });

      try {
        recordActivityLog(db, {
          eventType: 'sustainability_pix_generated',
          userId: req.user?.id || null,
          metadata: { provider: 'static-pix', amount_cents: amountCents },
        });
      } catch {
        // Telemetry failure must not block donation flow.
      }

      res.setHeader('Cache-Control', 'no-store');
      return res.json({
        mode: 'static-pix',
        payload,
        amountCents,
        merchantName: settings.merchantName,
        merchantCity: settings.merchantCity,
        pixKeyMasked: maskPixKey(settings.pixKey),
      });
    } catch (err) {
      return res.status(400).json({ error: err.message || 'Não foi possível gerar o Pix' });
    }
  });

  router.get('/pix/:paymentId/status', async (req, res) => {
    try {
      const paymentId = String(req.params.paymentId || '').trim();
      const db = resolveDb();
      const localRow = getDonationByProviderPayment(db, {
        provider: 'mercadopago',
        providerPaymentId: paymentId,
      });

      if (!localRow) {
        return res.status(404).json({ error: 'Cobrança Pix não encontrada.' });
      }

      res.setHeader('Cache-Control', 'no-store');

      if (localRow.status === 'confirmed') {
        const { snapshot } = await resolveMonthlySnapshot(db, usdRateProvider, {
          paymentMode: activePaymentMode,
        });
        return res.json({ status: 'confirmed', snapshot });
      }

      if (localRow.status === 'cancelled') {
        return res.json({ status: 'cancelled' });
      }

      if (!mercadoPagoClient.isEnabled) {
        return res.json({ status: localRow.status });
      }

      const synced = await syncMercadoPagoPayment({
        db,
        mpClient: mercadoPagoClient,
        paymentId,
        fallbackMonthKey: localRow.month_key,
      });

      if (synced.status === 'confirmed') {
        const { snapshot } = await resolveMonthlySnapshot(db, usdRateProvider, {
          paymentMode: activePaymentMode,
        });
        return res.json({ status: 'confirmed', snapshot });
      }

      return res.json({ status: synced.status });
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Erro ao consultar status do Pix' });
    }
  });

  router.post('/webhook/mercadopago', async (req, res) => {
    try {
      if (!mercadoPagoClient.isEnabled) {
        return res.status(503).json({ error: 'Mercado Pago não configurado.' });
      }

      const dataId = req.query?.['data.id'] || req.body?.data?.id || req.body?.id;
      const rawTopic = req.query?.type || req.query?.topic || req.body?.type || req.body?.topic;
      const topic = rawTopic ? String(rawTopic).trim().toLowerCase() : '';

      if (mercadoPagoClient.hasWebhookSecret) {
        const isValid = verifyMercadoPagoWebhookSignature({
          xSignature: req.headers['x-signature'],
          xRequestId: req.headers['x-request-id'],
          dataId,
          secret: mercadoPagoClient.webhookSecret,
        });
        if (!isValid) {
          return res.status(401).json({ error: 'Assinatura de webhook inválida.' });
        }
      }

      if ((topic && topic !== 'order' && topic !== 'payment') || !dataId) {
        return res.status(200).json({ ok: true, ignored: true });
      }

      const db = resolveDb();
      const result = await syncMercadoPagoPayment({
        db,
        mpClient: mercadoPagoClient,
        paymentId: String(dataId),
        fallbackMonthKey: getCurrentMonthKey(),
        resourceType: topic === 'order' ? 'order' : topic === 'payment' ? 'payment' : undefined,
      });

      return res.status(200).json({ ok: true, ...result });
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Erro ao processar webhook Mercado Pago' });
    }
  });

  return router;
}

export default createSustainabilityRouter();
