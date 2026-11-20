import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createMercadoPagoPixClient,
  parseMercadoPagoSignatureHeader,
  verifyMercadoPagoWebhookSignature,
} from '../src/services/mercadoPagoPix.js';

test('parseMercadoPagoSignatureHeader parses ts and v1 and rejects malformed inputs', () => {
  assert.deepEqual(
    parseMercadoPagoSignatureHeader('ts=1731690000,v1=AABBCC1122'),
    { ts: '1731690000', v1: 'aabbcc1122' }
  );
  assert.equal(parseMercadoPagoSignatureHeader('ts=1731690000,v1=not-hex!'), null);
  assert.equal(parseMercadoPagoSignatureHeader('v1=abcd'), null);
  assert.equal(parseMercadoPagoSignatureHeader(''), null);
});

test('verifyMercadoPagoWebhookSignature validates HMAC-SHA256 manifest in constant time', () => {
  const secret = 'mp-webhook-secret-test';
  const requestId = 'req-xyz-123';
  const dataId = '99887766';
  const ts = '1731690000';
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
  const v1 = createHmac('sha256', secret).update(manifest).digest('hex');

  assert.equal(
    verifyMercadoPagoWebhookSignature({
      xSignature: `ts=${ts},v1=${v1}`,
      xRequestId: requestId,
      dataId: '99887766',
      secret,
    }),
    true
  );

  assert.equal(
    verifyMercadoPagoWebhookSignature({
      xSignature: `ts=${ts},v1=${v1}`,
      xRequestId: requestId,
      dataId: '99887766',
      secret: 'wrong-secret',
    }),
    false
  );

  assert.equal(
    verifyMercadoPagoWebhookSignature({
      xSignature: `ts=${ts},v1=${'0'.repeat(v1.length)}`,
      xRequestId: requestId,
      dataId: '99887766',
      secret,
    }),
    false
  );
});

test('createMercadoPagoPixClient defaults to Orders API v1 (/v1/orders) for Pix creation and status checks', async () => {
  const calls = [];
  const client = createMercadoPagoPixClient({
    accessToken: 'TEST-TOKEN-ORDERS',
    webhookSecret: 'SEC-456',
    payerEmail: 'apoio@dividindin.com',
    fetcher: async (url, options) => {
      calls.push({ url, options });
      if (options.method === 'POST') {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: 'ORD01TEST12345',
            status: 'action_required',
            status_detail: 'waiting_transfer',
            total_amount: '15.50',
            transactions: {
              payments: [
                {
                  id: 'PAY01TEST12345',
                  status: 'action_required',
                  date_of_expiration: '2026-11-16T00:00:00.000-03:00',
                  payment_method: {
                    id: 'pix',
                    type: 'bank_transfer',
                    qr_code: '00020126580014br.gov.bcb.pix-orders-mock',
                  },
                },
              ],
            },
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'ORD01TEST12345',
          status: 'processed',
          status_detail: 'accredited',
          total_amount: '15.50',
          total_paid_amount: '15.50',
          external_reference: 'divide-sust:2026-11:uuid-1',
          last_updated_date: '2026-11-15T19:20:00.000Z',
          transactions: {
            payments: [
              {
                id: 'PAY01TEST12345',
                status: 'processed',
                status_detail: 'accredited',
                amount: '15.50',
              },
            ],
          },
        }),
      };
    },
  });

  assert.equal(client.isEnabled, true);
  assert.equal(client.apiMode, 'orders');

  const created = await client.createPixPayment({
    amountCents: 1550,
    description: 'Apoio Teste',
    externalReference: 'divide-sust:2026-11:uuid-1',
    idempotencyKey: 'idem-orders-1',
  });
  assert.equal(created.paymentId, 'ORD01TEST12345');
  assert.equal(created.status, 'pending');
  assert.equal(created.qrCode, '00020126580014br.gov.bcb.pix-orders-mock');
  assert.match(calls[0].url, /\/v1\/orders$/);

  const postBody = JSON.parse(calls[0].options.body);
  assert.equal(postBody.type, 'online');
  assert.equal(postBody.processing_mode, 'automatic');
  assert.equal(postBody.total_amount, '15.50');
  assert.deepEqual(postBody.transactions.payments[0].payment_method, {
    id: 'pix',
    type: 'bank_transfer',
  });
  assert.equal(calls[0].options.headers['X-Idempotency-Key'], 'idem-orders-1');

  const status = await client.getPaymentStatus('ORD01TEST12345');
  assert.match(calls[1].url, /\/v1\/orders\/ORD01TEST12345$/);
  assert.equal(status.paymentId, 'ORD01TEST12345');
  assert.equal(status.status, 'approved');
  assert.equal(status.amountCents, 1550);
  assert.equal(status.externalReference, 'divide-sust:2026-11:uuid-1');
});

test('createMercadoPagoPixClient also supports legacy Payments API when apiMode is payments', async () => {
  const calls = [];
  const client = createMercadoPagoPixClient({
    accessToken: 'TEST-TOKEN-123',
    webhookSecret: 'SEC-456',
    notificationUrl: 'https://dividindin.com/api/sustainability/webhook/mercadopago',
    payerEmail: 'apoio@dividindin.com',
    apiMode: 'payments',
    fetcher: async (url, options) => {
      calls.push({ url, options });
      if (options.method === 'POST') {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: 55443322,
            status: 'pending',
            date_of_expiration: '2026-11-16T00:00:00.000-03:00',
            point_of_interaction: {
              transaction_data: {
                qr_code: '00020126580014br.gov.bcb.pix-mp-qr-mock',
              },
            },
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 55443322,
          status: 'approved',
          transaction_amount: 15.5,
          external_reference: 'divide-sust:2026-11:uuid-1',
          date_approved: '2026-11-15T18:55:00.000-03:00',
        }),
      };
    },
  });

  assert.equal(client.isEnabled, true);
  assert.equal(client.apiMode, 'payments');
  assert.equal(client.hasWebhookSecret, true);

  const created = await client.createPixPayment({
    amountCents: 1550,
    description: 'Apoio Teste',
    externalReference: 'divide-sust:2026-11:uuid-1',
    idempotencyKey: 'idem-1',
  });
  assert.equal(created.paymentId, '55443322');
  assert.equal(created.status, 'pending');
  assert.equal(created.qrCode, '00020126580014br.gov.bcb.pix-mp-qr-mock');

  const postBody = JSON.parse(calls[0].options.body);
  assert.equal(postBody.transaction_amount, 15.5);
  assert.equal(postBody.payment_method_id, 'pix');
  assert.equal(postBody.payer.email, 'apoio@dividindin.com');
  assert.equal(postBody.notification_url, 'https://dividindin.com/api/sustainability/webhook/mercadopago');
  assert.equal(calls[0].options.headers['X-Idempotency-Key'], 'idem-1');

  const status = await client.getPaymentStatus('55443322');
  assert.equal(status.paymentId, '55443322');
  assert.equal(status.status, 'approved');
  assert.equal(status.amountCents, 1550);
  assert.equal(status.externalReference, 'divide-sust:2026-11:uuid-1');
});

test('createMercadoPagoPixClient fails clearly when unconfigured or API rejects request', async () => {
  const disabled = createMercadoPagoPixClient({ accessToken: '' });
  assert.equal(disabled.isEnabled, false);
  await assert.rejects(() => disabled.createPixPayment({ amountCents: 1000 }), /não configurado/i);

  const failing = createMercadoPagoPixClient({
    accessToken: 'BAD-TOKEN',
    fetcher: async () => ({
      ok: false,
      status: 401,
      json: async () => ({ message: 'invalid token' }),
    }),
  });
  await assert.rejects(() => failing.getPaymentStatus('123'), /invalid token/i);
});
