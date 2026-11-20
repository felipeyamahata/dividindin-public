import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { DEFAULT_INTRO_TEXT, validateCostItemInput, validateDonationAmountCents } from '../domain/sustainability.js';

const LEGACY_DEFAULT_INTRO_TEXTS = new Set([
  'o diviDinDin! é 100% gratuito e sem anúncios. esses são os custos reais para mantê-lo no ar — qualquer valor via pix ajuda a manter o projeto autossustentável.',
  [
    'o DiviDinDin! é 100% gratuito e sem anúncios.',
    'abaixo estão os custos mensais estimados para mantê-lo no ar.',
    'apoie com qualquer valor a partir de R$ 1,00 e ajude a manter essa ferramenta gratuita e autossustentável!',
  ].join('\n'),
  [
    'O DiviDinDin! é 100% gratuito e sem anúncios!',
    'Abaixo estão os custos mensais estimados para mantê-lo no ar. Apoie com qualquer valor a partir de R$ 1,00 e ajude a manter essa ferramenta gratuita e autossustentável!',
  ].join('\n'),
]);

/**
 * Ensures the singleton settings row exists and returns it with env defaults applied if empty.
 * @param {import('node:sqlite').DatabaseSync} db
 */
export function getSustainabilitySettings(db) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR IGNORE INTO sustainability_settings (
      id, pix_key, merchant_name, merchant_city, usd_brl_fallback, use_auto_usd, intro_text, updated_at
    ) VALUES (1, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    config.pixKey || '',
    config.pixMerchantName || 'YAMAHATA LAB',
    config.pixMerchantCity || 'SAO PAULO',
    Number.isFinite(config.usdBrlFallback) && config.usdBrlFallback > 0 ? config.usdBrlFallback : 5.8,
    DEFAULT_INTRO_TEXT,
    now,
  );

  const row = db.prepare('SELECT * FROM sustainability_settings WHERE id = 1').get();
  return {
    pixKey: row.pix_key || config.pixKey || '',
    merchantName: row.merchant_name || config.pixMerchantName || 'YAMAHATA LAB',
    merchantCity: row.merchant_city || config.pixMerchantCity || 'SAO PAULO',
    usdBrlFallback: Number(row.usd_brl_fallback || 5.8),
    usdBrlCached: row.usd_brl_cached != null ? Number(row.usd_brl_cached) : null,
    usdBrlCachedAt: row.usd_brl_cached_at || null,
    useAutoUsd: Boolean(row.use_auto_usd),
    introText: !row.intro_text || LEGACY_DEFAULT_INTRO_TEXTS.has(row.intro_text) ? DEFAULT_INTRO_TEXT : row.intro_text,
    updatedAt: row.updated_at,
  };
}

/**
 * Updates singleton sustainability settings from the Tailscale admin portal.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{
 *   pixKey?: string,
 *   merchantName?: string,
 *   merchantCity?: string,
 *   usdBrlFallback?: number,
 *   useAutoUsd?: boolean,
 *   introText?: string,
 * }} patch
 */
export function updateSustainabilitySettings(db, patch) {
  const current = getSustainabilitySettings(db);
  const nextPixKey = patch.pixKey !== undefined ? String(patch.pixKey).trim().slice(0, 140) : current.pixKey;
  const nextName = patch.merchantName !== undefined
    ? (String(patch.merchantName).trim().slice(0, 25) || 'YAMAHATA LAB')
    : current.merchantName;
  const nextCity = patch.merchantCity !== undefined
    ? (String(patch.merchantCity).trim().slice(0, 15) || 'SAO PAULO')
    : current.merchantCity;
  const parsedFallback = patch.usdBrlFallback !== undefined ? Number(patch.usdBrlFallback) : current.usdBrlFallback;
  if (!Number.isFinite(parsedFallback) || parsedFallback <= 0.5 || parsedFallback >= 100) {
    throw new Error('Cotação fallback deve estar entre 0,50 e 100,00.');
  }
  const nextUseAuto = patch.useAutoUsd !== undefined ? Boolean(patch.useAutoUsd) : current.useAutoUsd;
  const nextIntro = patch.introText !== undefined
    ? (String(patch.introText).trim().slice(0, 320) || DEFAULT_INTRO_TEXT)
    : current.introText;
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE sustainability_settings
    SET pix_key = ?,
        merchant_name = ?,
        merchant_city = ?,
        usd_brl_fallback = ?,
        use_auto_usd = ?,
        intro_text = ?,
        updated_at = ?
    WHERE id = 1
  `).run(nextPixKey, nextName, nextCity, parsedFallback, nextUseAuto ? 1 : 0, nextIntro, now);

  return getSustainabilitySettings(db);
}

/**
 * Persists the latest fetched USD -> BRL rate so restarts keep a warm fallback.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} rate
 * @param {string} cachedAt
 */
export function updateCachedUsdRate(db, rate, cachedAt) {
  getSustainabilitySettings(db);
  db.prepare(`
    UPDATE sustainability_settings
    SET usd_brl_cached = ?, usd_brl_cached_at = ?
    WHERE id = 1
  `).run(Number(rate), String(cachedAt));
}

/**
 * Lists cost items ordered by sort_order then creation date.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ activeOnly?: boolean }} [options]
 */
export function listSustainabilityCosts(db, { activeOnly = false } = {}) {
  const sql = activeOnly
    ? 'SELECT * FROM sustainability_costs WHERE is_active = 1 ORDER BY sort_order ASC, created_at ASC'
    : 'SELECT * FROM sustainability_costs ORDER BY sort_order ASC, created_at ASC';
  return db.prepare(sql).all();
}

/**
 * Creates or updates a sustainability cost item.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ id?: string, label: string, amountCents: number, currency: string, billingCycle: string, sortOrder?: number, isActive?: boolean }} input
 */
export function upsertSustainabilityCost(db, input) {
  const clean = validateCostItemInput(input);
  const now = new Date().toISOString();
  const id = input?.id ? String(input.id).trim() : randomUUID();

  const existing = db.prepare('SELECT id FROM sustainability_costs WHERE id = ?').get(id);
  if (existing) {
    db.prepare(`
      UPDATE sustainability_costs
      SET label = ?, amount_cents = ?, currency = ?, billing_cycle = ?, sort_order = ?, is_active = ?, updated_at = ?
      WHERE id = ?
    `).run(clean.label, clean.amountCents, clean.currency, clean.billingCycle, clean.sortOrder, clean.isActive ? 1 : 0, now, id);
  } else {
    db.prepare(`
      INSERT INTO sustainability_costs (id, label, amount_cents, currency, billing_cycle, sort_order, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, clean.label, clean.amountCents, clean.currency, clean.billingCycle, clean.sortOrder, clean.isActive ? 1 : 0, now, now);
  }

  return db.prepare('SELECT * FROM sustainability_costs WHERE id = ?').get(id);
}

/**
 * Deletes a sustainability cost item by ID.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} id
 */
export function deleteSustainabilityCost(db, id) {
  const result = db.prepare('DELETE FROM sustainability_costs WHERE id = ?').run(String(id));
  return result.changes > 0;
}

/**
 * Sums confirmed donations in centavos for the specified YYYY-MM month key.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} monthKey
 * @returns {number}
 */
export function getMonthDonationsTotalCents(db, monthKey) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(amount_cents), 0) AS total
    FROM sustainability_donations
    WHERE month_key = ? AND status = 'confirmed'
  `).get(String(monthKey));
  return Number(row?.total || 0);
}

/**
 * Lists recent confirmed donations, optionally filtered by monthKey.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ monthKey?: string, limit?: number }} [options]
 */
export function listSustainabilityDonations(db, { monthKey = '', limit = 40 } = {}) {
  const safeLimit = Math.min(200, Math.max(1, Number(limit || 40)));
  if (monthKey) {
    return db.prepare(`
      SELECT * FROM sustainability_donations
      WHERE month_key = ? AND status = 'confirmed'
      ORDER BY confirmed_at DESC, created_at DESC
      LIMIT ?
    `).all(String(monthKey), safeLimit);
  }
  return db.prepare(`
    SELECT * FROM sustainability_donations
    WHERE status = 'confirmed'
    ORDER BY confirmed_at DESC, created_at DESC
    LIMIT ?
  `).all(safeLimit);
}

/**
 * Records a confirmed donation entry (called from Tailscale admin on reconciliation).
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ monthKey: string, amountCents: number, note?: string, confirmedAt?: string }} input
 */
export function recordSustainabilityDonation(db, { monthKey, amountCents, note = '', confirmedAt = '' }) {
  const cleanMonth = String(monthKey || '').trim();
  if (!/^\d{4}-\d{2}$/.test(cleanMonth)) {
    throw new Error('Mês de referência inválido (use AAAA-MM).');
  }
  const cleanCents = validateDonationAmountCents(amountCents);
  const cleanNote = String(note || '').trim().slice(0, 120) || null;
  const now = new Date().toISOString();
  const safeConfirmedAt = confirmedAt ? String(confirmedAt).trim() : now;
  const id = randomUUID();

  db.prepare(`
    INSERT INTO sustainability_donations (id, month_key, amount_cents, status, provider, note, confirmed_at, created_at)
    VALUES (?, ?, ?, 'confirmed', 'manual', ?, ?, ?)
  `).run(id, cleanMonth, cleanCents, cleanNote, safeConfirmedAt, now);

  return db.prepare('SELECT * FROM sustainability_donations WHERE id = ?').get(id);
}

/**
 * Persists a pending provider Pix charge so polling and webhooks can track and reconcile it.
 */
export function createPendingProviderDonation(db, {
  monthKey,
  amountCents,
  provider,
  providerPaymentId,
  expiresAt = null,
  note = null,
}) {
  const cleanMonth = String(monthKey || '').trim();
  if (!/^\d{4}-\d{2}$/.test(cleanMonth)) {
    throw new Error('Mês de referência inválido.');
  }
  const cleanCents = validateDonationAmountCents(amountCents);
  const now = new Date().toISOString();
  const id = randomUUID();

  db.prepare(`
    INSERT INTO sustainability_donations (
      id, month_key, amount_cents, status, provider, provider_payment_id, expires_at, note, confirmed_at, created_at
    ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    cleanMonth,
    cleanCents,
    String(provider),
    String(providerPaymentId),
    expiresAt ? String(expiresAt) : null,
    note ? String(note).slice(0, 120) : null,
    now,
    now,
  );

  return db.prepare('SELECT * FROM sustainability_donations WHERE id = ?').get(id);
}

/**
 * Looks up a donation row by provider and external payment ID.
 */
export function getDonationByProviderPayment(db, { provider, providerPaymentId }) {
  return db.prepare(`
    SELECT * FROM sustainability_donations
    WHERE provider = ? AND provider_payment_id = ?
  `).get(String(provider), String(providerPaymentId));
}

/**
 * Atomically promotes a pending provider charge to confirmed (or inserts idempotently if missing).
 * Returns `{ donation, newlyConfirmed }`.
 */
export function confirmProviderDonation(db, {
  provider,
  providerPaymentId,
  amountCents,
  monthKey,
  confirmedAt = '',
  note = 'Mercado Pago Pix automático',
}) {
  const cleanProvider = String(provider);
  const cleanPaymentId = String(providerPaymentId);
  const now = confirmedAt ? String(confirmedAt) : new Date().toISOString();

  const existing = getDonationByProviderPayment(db, {
    provider: cleanProvider,
    providerPaymentId: cleanPaymentId,
  });

  if (existing) {
    if (existing.status === 'confirmed') {
      return { donation: existing, newlyConfirmed: false };
    }
    const cleanCents = validateDonationAmountCents(amountCents || existing.amount_cents);
    const result = db.prepare(`
      UPDATE sustainability_donations
      SET status = 'confirmed',
          amount_cents = ?,
          confirmed_at = ?,
          note = COALESCE(note, ?)
      WHERE id = ? AND status != 'confirmed'
    `).run(cleanCents, now, String(note).slice(0, 120), existing.id);

    const updated = db.prepare('SELECT * FROM sustainability_donations WHERE id = ?').get(existing.id);
    return { donation: updated, newlyConfirmed: result.changes > 0 };
  }

  const cleanMonth = String(monthKey || '').trim();
  if (!/^\d{4}-\d{2}$/.test(cleanMonth)) {
    throw new Error('Mês de referência inválido.');
  }
  const cleanCents = validateDonationAmountCents(amountCents);
  const id = randomUUID();
  db.prepare(`
    INSERT INTO sustainability_donations (
      id, month_key, amount_cents, status, provider, provider_payment_id, note, confirmed_at, created_at
    ) VALUES (?, ?, ?, 'confirmed', ?, ?, ?, ?, ?)
  `).run(id, cleanMonth, cleanCents, cleanProvider, cleanPaymentId, String(note).slice(0, 120), now, now);

  const inserted = db.prepare('SELECT * FROM sustainability_donations WHERE id = ?').get(id);
  return { donation: inserted, newlyConfirmed: true };
}

/**
 * Marks a pending provider payment as cancelled when rejected/expired/cancelled upstream.
 */
export function cancelProviderDonation(db, { provider, providerPaymentId }) {
  db.prepare(`
    UPDATE sustainability_donations
    SET status = 'cancelled'
    WHERE provider = ? AND provider_payment_id = ? AND status = 'pending'
  `).run(String(provider), String(providerPaymentId));
}

/**
 * Removes a donation entry by ID (for correcting admin entry mistakes).
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} id
 */
export function deleteSustainabilityDonation(db, id) {
  const result = db.prepare('DELETE FROM sustainability_donations WHERE id = ?').run(String(id));
  return result.changes > 0;
}
