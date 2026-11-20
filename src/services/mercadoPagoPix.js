import { createHmac, timingSafeEqual } from 'node:crypto';

const MERCADO_PAGO_API_BASE = 'https://api.mercadopago.com';

/**
 * Parses Mercado Pago `x-signature` header (`ts=...,v1=...`) into `{ ts, v1 }`.
 * @param {string | undefined | null} headerValue
 * @returns {{ ts: string, v1: string } | null}
 */
export function parseMercadoPagoSignatureHeader(headerValue) {
  const raw = String(headerValue || '').trim();
  if (!raw) return null;
  let ts = '';
  let v1 = '';
  for (const part of raw.split(',')) {
    const eqIndex = part.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = part.slice(0, eqIndex).trim();
    const value = part.slice(eqIndex + 1).trim();
    if (key === 'ts') ts = value;
    if (key === 'v1') v1 = value;
  }
  if (!ts || !v1 || !/^[a-fA-F0-9]+$/.test(v1)) return null;
  return { ts, v1: v1.toLowerCase() };
}

/**
 * Verifies Mercado Pago webhook HMAC-SHA256 signature using constant-time comparison.
 * Manifest template: `id:<lowercase dataId>;request-id:<x-request-id>;ts:<ts>;`
 * @param {{ xSignature?: string, xRequestId?: string, dataId?: string, secret?: string }} params
 * @returns {boolean}
 */
export function verifyMercadoPagoWebhookSignature({ xSignature, xRequestId, dataId, secret }) {
  const cleanSecret = String(secret || '').trim();
  const cleanRequestId = String(xRequestId || '').trim();
  const cleanDataId = String(dataId || '').trim().toLowerCase();
  if (!cleanSecret || !cleanRequestId || !cleanDataId) return false;

  const parsed = parseMercadoPagoSignatureHeader(xSignature);
  if (!parsed) return false;

  const manifest = `id:${cleanDataId};request-id:${cleanRequestId};ts:${parsed.ts};`;
  const expectedHex = createHmac('sha256', cleanSecret).update(manifest).digest('hex');

  const expectedBuf = Buffer.from(expectedHex, 'hex');
  const receivedBuf = Buffer.from(parsed.v1, 'hex');
  if (expectedBuf.length !== receivedBuf.length) return false;
  return timingSafeEqual(expectedBuf, receivedBuf);
}

/**
 * Formats non-secret Mercado Pago error responses including field-level `errors[].details`.
 */
function formatMercadoPagoErrorDetail(data, status) {
  if (Array.isArray(data?.errors) && data.errors.length > 0) {
    const parts = data.errors
      .map((err) => {
        const msg = err?.message || err?.code || '';
        const details = Array.isArray(err?.details) ? err.details.join(', ') : '';
        return [msg, details].filter(Boolean).join(' — ');
      })
      .filter(Boolean);
    if (parts.length > 0) return parts.join('; ');
  }
  return data?.message || data?.error || `HTTP ${status}`;
}

/**
 * Maps Mercado Pago Order/Payment raw statuses to internal normalized states.
 */
function normalizeProviderStatus(rawStatus, statusDetail = '') {
  const s = String(rawStatus || '').trim().toLowerCase();
  const d = String(statusDetail || '').trim().toLowerCase();
  if (s === 'approved' || s === 'processed' || s === 'closed' || s === 'accredited' || d === 'accredited') {
    return 'approved';
  }
  if (['cancelled', 'canceled', 'expired', 'failed', 'rejected', 'refunded', 'charged_back'].includes(s)) {
    return 'cancelled';
  }
  return 'pending';
}

/**
 * Creates a lean, injectable Mercado Pago Pix REST client (Orders API v1 default, plus legacy Payments API).
 * @param {{
 *   accessToken?: string,
 *   webhookSecret?: string,
 *   notificationUrl?: string,
 *   payerEmail?: string,
 *   apiMode?: 'orders' | 'payments',
 *   fetcher?: typeof fetch,
 * }} [options]
 */
export function createMercadoPagoPixClient({
  accessToken = '',
  webhookSecret = '',
  notificationUrl = '',
  payerEmail = 'apoio@dividindin.com',
  apiMode = 'orders',
  fetcher = fetch,
} = {}) {
  const token = String(accessToken || '').trim();
  const secret = String(webhookSecret || '').trim();
  const cleanNotificationUrl = String(notificationUrl || '').trim();
  const cleanPayerEmail = String(payerEmail || 'apoio@dividindin.com').trim();
  const normalizedApiMode = apiMode === 'payments' ? 'payments' : 'orders';

  async function createPixPayment({
    amountCents,
    description = 'Apoio DiviDinDin!',
    externalReference,
    idempotencyKey,
  }) {
    if (!token) {
      throw new Error('Mercado Pago não configurado.');
    }

    const amountFixed = (Number(amountCents) / 100).toFixed(2);
    if (normalizedApiMode === 'orders') {
      const orderBody = {
        type: 'online',
        processing_mode: 'automatic',
        external_reference: externalReference,
        total_amount: amountFixed,
        description: String(description).slice(0, 120),
        payer: {
          email: cleanPayerEmail,
        },
        transactions: {
          payments: [
            {
              amount: amountFixed,
              payment_method: {
                id: 'pix',
                type: 'bank_transfer',
              },
            },
          ],
        },
      };

      const response = await fetcher(`${MERCADO_PAGO_API_BASE}/v1/orders`, {
        method: 'POST',
        signal: AbortSignal.timeout(8000),
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(orderBody),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = formatMercadoPagoErrorDetail(data, response.status);
        console.error('[MercadoPago] POST /v1/orders failed:', response.status, JSON.stringify(data));
        throw new Error(`Erro no Mercado Pago (Orders) ao gerar Pix: ${detail}`);
      }

      const firstTx = data?.transactions?.payments?.[0] || {};
      const qrCode = firstTx?.payment_method?.qr_code
        || firstTx?.point_of_interaction?.transaction_data?.qr_code
        || data?.type_response?.qr_data
        || '';
      if (!data?.id || !qrCode) {
        throw new Error('Resposta da Orders API sem QR Code Pix.');
      }

      return {
        paymentId: String(data.id),
        status: normalizeProviderStatus(data.status || firstTx.status, data.status_detail || firstTx.status_detail),
        qrCode: String(qrCode),
        expiresAt: firstTx.date_of_expiration || data.expiration_time || null,
      };
    }

    const paymentBody = {
      transaction_amount: Number(amountFixed),
      description: String(description).slice(0, 120),
      payment_method_id: 'pix',
      external_reference: externalReference,
      payer: {
        email: cleanPayerEmail,
      },
    };
    if (cleanNotificationUrl) {
      paymentBody.notification_url = cleanNotificationUrl;
    }

    const response = await fetcher(`${MERCADO_PAGO_API_BASE}/v1/payments`, {
      method: 'POST',
      signal: AbortSignal.timeout(8000),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(paymentBody),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = data?.message || data?.error || `HTTP ${response.status}`;
      throw new Error(`Erro no Mercado Pago ao gerar Pix: ${detail}`);
    }

    const txData = data?.point_of_interaction?.transaction_data || {};
    if (!data?.id || !txData.qr_code) {
      throw new Error('Resposta do Mercado Pago sem QR Code Pix.');
    }

    return {
      paymentId: String(data.id),
      status: normalizeProviderStatus(data.status, data.status_detail),
      qrCode: String(txData.qr_code),
      expiresAt: data.date_of_expiration || null,
    };
  }

  async function getPaymentStatus(paymentId, { resourceType } = {}) {
    if (!token) {
      throw new Error('Mercado Pago não configurado.');
    }
    const cleanId = String(paymentId || '').trim();
    if (!cleanId) {
      throw new Error('ID do pagamento ausente.');
    }

    const useOrders = resourceType === 'order'
      || (resourceType !== 'payment' && (normalizedApiMode === 'orders' || cleanId.toUpperCase().startsWith('ORD')));
    const endpoint = useOrders
      ? `${MERCADO_PAGO_API_BASE}/v1/orders/${encodeURIComponent(cleanId)}`
      : `${MERCADO_PAGO_API_BASE}/v1/payments/${encodeURIComponent(cleanId)}`;

    const response = await fetcher(endpoint, {
      method: 'GET',
      signal: AbortSignal.timeout(6000),
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = data?.message || data?.errors?.[0]?.message || data?.error || `HTTP ${response.status}`;
      throw new Error(`Erro ao consultar pagamento no Mercado Pago: ${detail}`);
    }

    if (useOrders) {
      const payments = Array.isArray(data?.transactions?.payments) ? data.transactions.payments : [];
      const primaryTx = payments[0] || {};
      const orderNorm = normalizeProviderStatus(data.status, data.status_detail);
      const txNorm = payments.some((tx) => normalizeProviderStatus(tx.status, tx.status_detail) === 'approved')
        ? 'approved'
        : normalizeProviderStatus(primaryTx.status, primaryTx.status_detail);
      const finalStatus = orderNorm === 'approved' || txNorm === 'approved'
        ? 'approved'
        : (orderNorm === 'cancelled' || txNorm === 'cancelled' ? 'cancelled' : 'pending');

      return {
        paymentId: String(data.id),
        status: finalStatus,
        amountCents: Math.round(Number(data.total_paid_amount || data.total_amount || primaryTx.amount || 0) * 100),
        externalReference: String(data.external_reference || ''),
        dateApproved: primaryTx.date_approved || data.last_updated_date || null,
      };
    }

    return {
      paymentId: String(data.id),
      status: normalizeProviderStatus(data.status, data.status_detail),
      amountCents: Math.round(Number(data.transaction_amount || 0) * 100),
      externalReference: String(data.external_reference || ''),
      dateApproved: data.date_approved || null,
    };
  }

  return {
    isEnabled: Boolean(token),
    apiMode: normalizedApiMode,
    hasWebhookSecret: Boolean(secret),
    webhookSecret: secret,
    createPixPayment,
    getPaymentStatus,
  };
}
