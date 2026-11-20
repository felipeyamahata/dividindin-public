/**
 * Pure domain functions for fractional shares calculations and conversions.
 * Guarantees zero balance drift by distributing remainder cents deterministically.
 */

/**
 * Calculates deterministic centavo and percentage allocations from integer shares.
 * Sum of all allocated cents is guaranteed to match totalCents exactly.
 *
 * @param {number} totalCents - Total amount in cents (>= 0).
 * @param {string[]} participantIds - Array of active participant IDs.
 * @param {Record<string, number|string>} sharesMap - Map of participant ID to manual share count.
 * @param {number} fallbackShare - Default share assigned to fallback participants (>= 1).
 * @returns {Record<string, { share: number, isManual: boolean, placeholderShare: number, totalShares: number, cents: number, percentage: number }>}
 */
export function calculateSharesAllocation(totalCents = 0, participantIds = [], sharesMap = {}, fallbackShare = 1) {
  if (!Array.isArray(participantIds) || participantIds.length === 0) {
    return {};
  }

  const safeTotalCents = Math.max(0, Math.floor(Number(totalCents)) || 0);
  const safeFallbackShare = Number.isSafeInteger(Number(fallbackShare)) && Number(fallbackShare) >= 1
    ? Math.floor(Number(fallbackShare))
    : 1;

  // Normalize shares: explicit manual integer >= 1 vs fallback share
  const normalizedShares = {};
  let totalShares = 0;

  for (const id of participantIds) {
    const raw = Number(sharesMap?.[id]);
    const isManual = sharesMap?.[id] !== undefined && sharesMap[id] !== '' && Number.isSafeInteger(raw) && raw >= 1;
    const share = isManual ? raw : safeFallbackShare;
    normalizedShares[id] = { share, isManual };
    totalShares += share;
  }

  if (totalShares <= 0) {
    totalShares = participantIds.length;
    for (const id of participantIds) {
      normalizedShares[id] = { share: 1, isManual: false };
    }
  }

  if (safeTotalCents <= 0) {
    const zeroResult = {};
    for (const id of participantIds) {
      const { share, isManual } = normalizedShares[id];
      zeroResult[id] = {
        share,
        isManual,
        placeholderShare: safeFallbackShare,
        totalShares,
        cents: 0,
        percentage: totalShares > 0 ? (share / totalShares) * 100 : 0,
      };
    }
    return zeroResult;
  }

  let sumAllocated = 0;
  const allocations = participantIds.map((id, index) => {
    const { share, isManual } = normalizedShares[id];
    const rawAmount = (safeTotalCents * share) / totalShares;
    const base = Math.floor(rawAmount);
    const fraction = rawAmount - base;
    sumAllocated += base;
    const percentage = (share / totalShares) * 100;
    return { id, index, share, isManual, base, fraction, percentage };
  });

  const remainder = safeTotalCents - sumAllocated;
  // Distribute remainder cents to highest fractional parts, breaking ties by initial index
  const sorted = [...allocations].sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let i = 0; i < remainder; i++) {
    sorted[i % sorted.length].base += 1;
  }

  const result = {};
  for (const alloc of allocations) {
    result[alloc.id] = {
      share: alloc.share,
      isManual: alloc.isManual,
      placeholderShare: safeFallbackShare,
      totalShares,
      cents: alloc.base,
      percentage: alloc.percentage,
    };
  }

  return result;
}

/**
 * Calculates greatest common divisor of two integers.
 */
function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x;
}

/**
 * Derives simplified integer shares from an amount distribution map.
 * Keeps fallback participants unassigned (only manual participants get explicit shares).
 *
 * @param {string[]} participantIds - Array of active participant IDs.
 * @param {Record<string, number>} amountsMap - Map of participant ID to amount in cents.
 * @param {number} totalCents - Total amount in cents.
 * @param {string[]} manualIds - List of participant IDs explicitly entered by the user.
 * @returns {{ shares: Record<string, number>, fallbackShare: number }}
 */
export function deriveSharesFromAmounts(participantIds = [], amountsMap = {}, totalCents = 0, manualIds = []) {
  if (!Array.isArray(participantIds) || participantIds.length === 0) {
    return { shares: {}, fallbackShare: 1 };
  }

  const manualSet = new Set(Array.isArray(manualIds) ? manualIds : []);

  // If no one is manual, everything remains fallback with 1 share
  if (manualSet.size === 0) {
    return { shares: {}, fallbackShare: 1 };
  }

  const centsList = participantIds.map(id => Math.max(0, Math.floor(Number(amountsMap?.[id])) || 0));
  const maxCents = Math.max(...centsList);
  const minCents = Math.min(...centsList);

  // If all non-zero amounts are equal, all shares are 1
  if (maxCents === 0 || maxCents - minCents <= 2) {
    const finalShares = {};
    for (const id of participantIds) {
      if (manualSet.has(id)) {
        finalShares[id] = 1;
      }
    }
    return { shares: finalShares, fallbackShare: 1 };
  }

  // Calculate GCD of non-zero cents
  const nonZero = centsList.filter(c => c > 0);
  let g = nonZero[0] || 1;
  for (let i = 1; i < nonZero.length; i++) {
    g = gcd(g, nonZero[i]);
  }

  const fallbackIds = participantIds.filter(id => !manualSet.has(id));

  // If GCD simplifies amounts to reasonable integer parts (<= 100), use direct division
  if (g > 1 && maxCents / g <= 100) {
    const rawShares = {};
    for (const id of participantIds) {
      const c = Math.max(0, Math.floor(Number(amountsMap?.[id])) || 0);
      rawShares[id] = Math.max(1, Math.round(c / g));
    }

    const fallbackShare = fallbackIds.length > 0 ? (rawShares[fallbackIds[0]] || 1) : 1;

    const finalShares = {};
    for (const id of participantIds) {
      if (manualSet.has(id)) {
        finalShares[id] = rawShares[id];
      }
    }
    return { shares: finalShares, fallbackShare };
  }

  // Fallback normalization against minimum positive cents
  const baseUnit = minCents > 0 ? minCents : Math.max(1, Math.floor(totalCents / participantIds.length));
  const rawShares = {};
  for (const id of participantIds) {
    const c = Math.max(0, Math.floor(Number(amountsMap?.[id])) || 0);
    rawShares[id] = Math.max(1, Math.round(c / baseUnit));
  }

  const fallbackShare = fallbackIds.length > 0 ? (rawShares[fallbackIds[0]] || 1) : 1;

  const finalShares = {};
  for (const id of participantIds) {
    if (manualSet.has(id)) {
      finalShares[id] = rawShares[id];
    }
  }

  return { shares: finalShares, fallbackShare };
}
