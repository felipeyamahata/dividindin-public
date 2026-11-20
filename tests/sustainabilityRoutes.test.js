import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { DatabaseSync } from 'node:sqlite';

import { initSchema } from '../src/db/schema.js';
import { computeCrc16Ccitt } from '../src/domain/pix.js';
import { getCurrentMonthKey } from '../src/domain/sustainability.js';
import { createUsdRateProvider } from '../src/domain/usdRate.js';
import { createSustainabilityRouter } from '../src/routes/sustainability.js';
import { createSustainabilityAdminRouter, isPrivateTailscaleRequest } from '../src/admin/sustainabilityAdmin.js';

function createTestHarness({ mercadoPagoClient } = {}) {
  const db = new DatabaseSync(':memory:');
  initSchema(db);
  const usdRateProvider = createUsdRateProvider({
    fetcher: async () => ({ USDBRL: { bid: '6.00' } }),
  });

  const app = express();
  app.use(express.json());
  app.use('/api/sustainability', createSustainabilityRouter({ usdRateProvider, dbOverride: db, mercadoPagoClient }));
  app.use('/divide/admin', createSustainabilityAdminRouter({
    usdRateProvider,
    dbOverride: db,
    paymentMode: mercadoPagoClient?.isEnabled ? 'mercadopago' : 'static-pix',
  }));
  app.use('/admin', createSustainabilityAdminRouter({
    usdRateProvider,
    dbOverride: db,
    paymentMode: mercadoPagoClient?.isEnabled ? 'mercadopago' : 'static-pix',
  }));

  return { db, app };
}

test('isPrivateTailscaleRequest allows loopback/Tailscale and blocks proxy headers or public IPs', () => {
  assert.equal(isPrivateTailscaleRequest({ headers: {}, socket: { remoteAddress: '127.0.0.1' } }), true);
  assert.equal(isPrivateTailscaleRequest({ headers: {}, socket: { remoteAddress: '::ffff:100.64.0.1' } }), true);
  assert.equal(isPrivateTailscaleRequest({ headers: {}, socket: { remoteAddress: '8.8.8.8' } }), false);
  assert.equal(
    isPrivateTailscaleRequest({ headers: { 'cf-connecting-ip': '1.2.3.4' }, socket: { remoteAddress: '127.0.0.1' } }),
    false
  );
  assert.equal(
    isPrivateTailscaleRequest({ headers: { 'x-forwarded-for': '1.2.3.4' }, socket: { remoteAddress: '100.64.0.1' } }),
    false
  );
});

test('sustainability public API and Tailscale admin API end-to-end flow', async () => {
  const { db, app } = createTestHarness();
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Initial public snapshot has 0 goal and pix disabled
    const initRes = await fetch(`${baseUrl}/api/sustainability`);
    assert.equal(initRes.status, 200);
    const initData = await initRes.json();
    assert.equal(initData.goalCents, 0);
    assert.equal(initData.pixEnabled, false);

    // 2. Pix generation fails with 503 before key is configured
    const noPixRes = await fetch(`${baseUrl}/api/sustainability/pix`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amountCents: 1000 }),
    });
    assert.equal(noPixRes.status, 503);

    // 3. Proxy header on admin route is blocked (simulating Cloudflare Tunnel request)
    const blockedAdmin = await fetch(`${baseUrl}/admin/api/sustainability/state`, {
      headers: { 'cf-ray': 'abc123' },
    });
    assert.equal(blockedAdmin.status, 403);

    // 4. Admin HTML resolves API_BASE correctly for /divide/admin/sustentabilidade
    const htmlRes = await fetch(`${baseUrl}/divide/admin/sustentabilidade`);
    assert.equal(htmlRes.status, 200);
    const html = await htmlRes.text();
    assert.match(html, /const API_BASE = '\/divide\/admin\/api\/sustainability'/);

    // 5. Configure Pix key in admin
    const setRes = await fetch(`${baseUrl}/admin/api/sustainability/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pixKey: '123e4567-e89b-12d3-a456-426614174000',
        merchantName: 'Yamahata Lab',
        merchantCity: 'Sao Paulo',
        usdBrlFallback: 5.75,
        useAutoUsd: true,
      }),
    });
    assert.equal(setRes.status, 200);

    // 6. Add annual USD cost (US$ 12.00/year * 6.00 / 12 = R$ 6.00/month = 600 cents) and monthly BRL cost (3000 cents)
    await fetch(`${baseUrl}/admin/api/sustainability/costs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'Domínio .com', amountCents: 1200, currency: 'USD', billingCycle: 'annual' }),
    });
    await fetch(`${baseUrl}/admin/api/sustainability/costs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'Energia S10e', amountCents: 3000, currency: 'BRL', billingCycle: 'monthly' }),
    });

    // 7. Confirm a R$ 18,00 donation (50% of R$ 36,00)
    const monthKey = getCurrentMonthKey();
    const donRes = await fetch(`${baseUrl}/admin/api/sustainability/donations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ monthKey, amountCents: 1800, note: 'Pix teste' }),
    });
    assert.equal(donRes.status, 200);

    // 8. Public snapshot reflects goal, confirmed amount, and progress
    const pubRes = await fetch(`${baseUrl}/api/sustainability`);
    assert.equal(pubRes.status, 200);
    const pubData = await pubRes.json();
    assert.equal(pubData.goalCents, 3600);
    assert.equal(pubData.confirmedCents, 1800);
    assert.equal(pubData.remainingCents, 1800);
    assert.equal(pubData.clampedPercent, 50);
    assert.equal(pubData.pixEnabled, true);
    assert.equal(pubData.costs.length, 2);

    // 9. Generate static Pix payload via public endpoint
    const pixRes = await fetch(`${baseUrl}/api/sustainability/pix`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amountCents: 1800 }),
    });
    assert.equal(pixRes.status, 200);
    const pixData = await pixRes.json();
    assert.equal(pixData.mode, 'static-pix');
    assert.equal(pixData.amountCents, 1800);
    assert.equal(pixData.pixKeyMasked, '123e••••4000');
    assert.equal(computeCrc16Ccitt(pixData.payload.slice(0, -4)), pixData.payload.slice(-4));
  } finally {
    server.closeAllConnections?.();
    server.close();
    db.close();
  }
});

test('Mercado Pago Pix polling and signed webhook confirm donations idempotently and ignore external orders', async () => {
  const monthKey = getCurrentMonthKey();
  const paymentsById = new Map();
  let seq = 1000;
  const webhookSecret = 'test-mp-webhook-secret';

  const mockMpClient = {
    isEnabled: true,
    hasWebhookSecret: true,
    webhookSecret,
    async createPixPayment({ amountCents, externalReference }) {
      seq += 1;
      const paymentId = String(seq);
      paymentsById.set(paymentId, {
        paymentId,
        status: 'pending',
        amountCents,
        externalReference,
        dateApproved: null,
      });
      return {
        paymentId,
        status: 'pending',
        qrCode: `000201-MOCK-MP-${paymentId}`,
        expiresAt: '2026-11-16T00:00:00.000-03:00',
      };
    },
    async getPaymentStatus(paymentId) {
      const found = paymentsById.get(String(paymentId));
      if (!found) {
        throw new Error('Payment not found');
      }
      return found;
    },
  };

  const { db, app } = createTestHarness({ mercadoPagoClient: mockMpClient });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const signWebhook = (dataId, requestId = 'req-1', ts = '1731690000') => {
    const manifest = `id:${String(dataId).toLowerCase()};request-id:${requestId};ts:${ts};`;
    const v1 = createHmac('sha256', webhookSecret).update(manifest).digest('hex');
    return { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId };
  };

  try {
    // Cost goal: R$ 50,00
    await fetch(`${baseUrl}/admin/api/sustainability/costs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'Energia', amountCents: 5000, currency: 'BRL', billingCycle: 'monthly' }),
    });

    // Public snapshot shows mercadopago mode & pixEnabled even without manual pixKey
    const snapRes = await fetch(`${baseUrl}/api/sustainability`);
    const snap0 = await snapRes.json();
    assert.equal(snap0.paymentMode, 'mercadopago');
    assert.equal(snap0.pixEnabled, true);
    assert.equal(snap0.confirmedCents, 0);

    // 1. Create dynamic Pix payment (R$ 15,00)
    const pixRes = await fetch(`${baseUrl}/api/sustainability/pix`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amountCents: 1500 }),
    });
    assert.equal(pixRes.status, 200);
    const pix1 = await pixRes.json();
    assert.equal(pix1.mode, 'mercadopago');
    assert.equal(pix1.paymentId, '1001');

    // Pending payment does NOT count toward confirmedCents yet
    const statusPendingRes = await fetch(`${baseUrl}/api/sustainability/pix/1001/status`);
    const statusPending = await statusPendingRes.json();
    assert.equal(statusPending.status, 'pending');
    const snapWhilePending = await (await fetch(`${baseUrl}/api/sustainability`)).json();
    assert.equal(snapWhilePending.confirmedCents, 0);

    // 2. Payment approves at Mercado Pago -> status poll confirms and updates snapshot
    paymentsById.get('1001').status = 'approved';
    paymentsById.get('1001').dateApproved = '2026-11-15T19:00:00.000-03:00';
    const statusConfirmedRes = await fetch(`${baseUrl}/api/sustainability/pix/1001/status`);
    const statusConfirmed = await statusConfirmedRes.json();
    assert.equal(statusConfirmed.status, 'confirmed');
    assert.equal(statusConfirmed.snapshot.confirmedCents, 1500);
    assert.equal(statusConfirmed.snapshot.clampedPercent, 30);

    // Repeat poll remains idempotent
    const repeatRes = await fetch(`${baseUrl}/api/sustainability/pix/1001/status`);
    const repeat = await repeatRes.json();
    assert.equal(repeat.status, 'confirmed');
    assert.equal(repeat.snapshot.confirmedCents, 1500);

    // 3. Create second payment R$ 20,00 and confirm via signed webhook
    const pix2 = await (await fetch(`${baseUrl}/api/sustainability/pix`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amountCents: 2000 }),
    })).json();
    assert.equal(pix2.paymentId, '1002');
    paymentsById.get('1002').status = 'approved';

    // Invalid webhook signature is rejected with 401
    const badSigRes = await fetch(`${baseUrl}/api/sustainability/webhook/mercadopago?data.id=1002&type=payment`, {
      method: 'POST',
      headers: { 'x-signature': 'ts=1,v1=deadbeef', 'x-request-id': 'req-bad' },
    });
    assert.equal(badSigRes.status, 401);

    // Valid Orders webhook (type=order + uppercase alphanumeric ORD id) confirms second donation -> total R$ 35,00 (70%)
    const okSigRes = await fetch(`${baseUrl}/api/sustainability/webhook/mercadopago`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...signWebhook('1002'),
      },
      body: JSON.stringify({ type: 'order', data: { id: '1002' } }),
    });
    assert.equal(okSigRes.status, 200);
    const snapAfterWebhook = await (await fetch(`${baseUrl}/api/sustainability`)).json();
    assert.equal(snapAfterWebhook.confirmedCents, 3500);
    assert.equal(snapAfterWebhook.clampedPercent, 70);

    // 4. Unrelated payment in Felipe's Mercado Pago account is ignored cleanly
    paymentsById.set('9999', {
      paymentId: '9999',
      status: 'approved',
      amountCents: 99900,
      externalReference: 'unrelated-personal-transfer',
      dateApproved: '2026-11-15T19:05:00.000-03:00',
    });
    const ignoredRes = await fetch(`${baseUrl}/api/sustainability/webhook/mercadopago?data.id=9999&type=payment`, {
      method: 'POST',
      headers: signWebhook('9999', 'req-ext'),
    });
    assert.equal(ignoredRes.status, 200);
    const ignoredBody = await ignoredRes.json();
    assert.equal(ignoredBody.ignored, true);

    const finalSnap = await (await fetch(`${baseUrl}/api/sustainability`)).json();
    assert.equal(finalSnap.confirmedCents, 3500);
    assert.equal(finalSnap.monthKey, monthKey);
  } finally {
    server.closeAllConnections?.();
    server.close();
    db.close();
  }
});
