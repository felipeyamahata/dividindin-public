/**
 * Pure domain logic for monthly self-sustainability goals, cost normalization, and progress computation.
 */

export const SUPPORTED_CURRENCIES = new Set(['BRL', 'USD']);
export const SUPPORTED_CYCLES = new Set(['monthly', 'annual']);
export const MIN_DONATION_CENTS = 100; // R$ 1,00
export const MAX_DONATION_CENTS = 100_000_000; // R$ 1.000.000,00
export const DEFAULT_INTRO_TEXT =
  'O DiviDinDin! é 100% gratuito e sem anúncios! Abaixo estão os custos mensais estimados para mantê-lo no ar. Apoie com qualquer valor a partir de R$ 1,00 e ajude a manter essa ferramenta gratuita e autossustentável!';

const MONTH_NAMES_PT = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/**
 * Returns the YYYY-MM month key in America/Sao_Paulo timezone.
 * @param {Date} [date]
 * @returns {string}
 */
export function getCurrentMonthKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  return `${year}-${month}`;
}

/**
 * Formats a YYYY-MM month key in lowercase Portuguese (e.g. "novembro de 2026").
 * @param {string} monthKey
 * @returns {string}
 */
export function formatMonthLabelPt(monthKey) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthKey || ''));
  if (!match) return String(monthKey || '');
  const monthIdx = Number(match[2]) - 1;
  const monthName = MONTH_NAMES_PT[monthIdx] || match[2];
  return `${monthName} de ${match[1]}`;
}

/**
 * Converts a single cost item into its monthly BRL centavos value.
 * @param {{ amount_cents?: number, amountCents?: number, currency?: string, billing_cycle?: string, billingCycle?: string }} item
 * @param {number} usdToBrlRate
 * @returns {number}
 */
export function convertCostItemToMonthlyBrlCents(item, usdToBrlRate) {
  const rawCents = Number(item?.amount_cents ?? item?.amountCents ?? 0);
  if (!Number.isFinite(rawCents) || rawCents <= 0) return 0;
  const currency = String(item?.currency || 'BRL').toUpperCase();
  const cycle = String(item?.billing_cycle ?? item?.billingCycle ?? 'monthly').toLowerCase();
  const rate = Number.isFinite(Number(usdToBrlRate)) && Number(usdToBrlRate) > 0
    ? Number(usdToBrlRate)
    : 5.8;

  const brlCents = currency === 'USD' ? Math.round(rawCents * rate) : Math.round(rawCents);
  return cycle === 'annual' ? Math.round(brlCents / 12) : brlCents;
}

/**
 * Builds the complete monthly sustainability snapshot consumed by the UI and API.
 * @param {{
 *   monthKey: string,
 *   costs: Array<object>,
 *   confirmedCents: number,
 *   usdToBrlRate: number,
 *   rateSource?: string,
 *   rateUpdatedAt?: string | null,
 *   introText?: string,
 *   pixEnabled?: boolean,
 * }} params
 */
export function computeMonthlySustainabilitySnapshot({
  monthKey,
  costs = [],
  confirmedCents = 0,
  usdToBrlRate = 5.8,
  rateSource = 'manual',
  rateUpdatedAt = null,
  introText = '',
  pixEnabled = false,
}) {
  const normalizedCosts = (costs || [])
    .filter((item) => item && item.is_active !== 0 && item.isActive !== false)
    .map((item) => {
      const amountCents = Math.round(Number(item.amount_cents ?? item.amountCents ?? 0));
      const currency = String(item.currency || 'BRL').toUpperCase() === 'USD' ? 'USD' : 'BRL';
      const billingCycle = String(item.billing_cycle ?? item.billingCycle ?? 'monthly').toLowerCase() === 'annual'
        ? 'annual'
        : 'monthly';
      const monthlyBrlCents = convertCostItemToMonthlyBrlCents({ amountCents, currency, billingCycle }, usdToBrlRate);
      return {
        id: item.id,
        label: String(item.label || '').trim(),
        amountCents,
        currency,
        billingCycle,
        monthlyBrlCents,
      };
    })
    .filter((item) => item.label && item.monthlyBrlCents >= 0);

  const goalCents = normalizedCosts.reduce((sum, item) => sum + item.monthlyBrlCents, 0);
  const safeConfirmedCents = Math.max(0, Math.round(Number(confirmedCents || 0)));
  const remainingCents = Math.max(0, goalCents - safeConfirmedCents);
  const surplusCents = Math.max(0, safeConfirmedCents - goalCents);

  const rawPercent = goalCents > 0
    ? Math.round((safeConfirmedCents / goalCents) * 1000) / 10
    : (safeConfirmedCents > 0 ? 100 : 0);
  const clampedPercent = Math.min(100, Math.max(0, rawPercent));

  return {
    monthKey,
    monthLabel: formatMonthLabelPt(monthKey),
    goalCents,
    confirmedCents: safeConfirmedCents,
    remainingCents,
    surplusCents,
    isGoalCovered: goalCents > 0 ? safeConfirmedCents >= goalCents : false,
    rawPercent,
    clampedPercent,
    usdToBrlRate: Math.round(Number(usdToBrlRate) * 10000) / 10000,
    rateSource,
    rateUpdatedAt: rateUpdatedAt || null,
    introText: String(introText || '').trim() || DEFAULT_INTRO_TEXT,
    pixEnabled: Boolean(pixEnabled),
    costs: normalizedCosts,
  };
}

/**
 * Validates and normalizes a donation amount in centavos.
 * @param {number} amountCents
 * @returns {number}
 */
export function validateDonationAmountCents(amountCents) {
  const cents = Number(amountCents);
  if (!Number.isInteger(cents) || cents < MIN_DONATION_CENTS || cents > MAX_DONATION_CENTS) {
    throw new Error('Informe um valor entre R$ 1,00 e R$ 1.000.000,00.');
  }
  return cents;
}

/**
 * Validates and normalizes a cost item payload from the admin portal.
 * @param {{
 *   label?: string,
 *   amountCents?: number,
 *   currency?: string,
 *   billingCycle?: string,
 *   sortOrder?: number,
 *   isActive?: boolean,
 * }} input
 */
export function validateCostItemInput(input) {
  const label = String(input?.label || '').trim();
  if (!label || label.length > 80) {
    throw new Error('Informe uma descrição de custo com até 80 caracteres.');
  }
  const amountCents = Number(input?.amountCents);
  if (!Number.isInteger(amountCents) || amountCents < 1 || amountCents > MAX_DONATION_CENTS) {
    throw new Error('Informe um valor positivo em centavos.');
  }
  const currency = String(input?.currency || 'BRL').trim().toUpperCase();
  if (!SUPPORTED_CURRENCIES.has(currency)) {
    throw new Error('Moeda deve ser BRL ou USD.');
  }
  const billingCycle = String(input?.billingCycle || 'monthly').trim().toLowerCase();
  if (!SUPPORTED_CYCLES.has(billingCycle)) {
    throw new Error('Ciclo deve ser monthly ou annual.');
  }
  const sortOrder = Number.isInteger(Number(input?.sortOrder)) ? Number(input.sortOrder) : 0;
  const isActive = input?.isActive !== false;

  return { label, amountCents, currency, billingCycle, sortOrder, isActive };
}
