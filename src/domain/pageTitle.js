export const BRAND_NAME = 'DiviDinDin!';
export const LANDING_TITLE = 'DiviDinDin! — Rachador de despesas 100% GRÁTIS';

/**
 * Formats the browser tab document title based on the active screen and event context.
 * @param {{ eventTitle?: string | null, screenMode?: 'landing' | 'home' | 'event' | 'profile' | 'expense' | 'donate', isLoading?: boolean, isError?: boolean, isMaintenance?: boolean }} [params]
 * @returns {string}
 */
export function formatDocumentTitle({
  eventTitle = '',
  screenMode = 'home',
  isLoading = false,
  isError = false,
  isMaintenance = false,
} = {}) {
  if (screenMode === 'landing' && !isError && !isMaintenance) {
    return LANDING_TITLE;
  }
  if (isLoading || isError || isMaintenance || screenMode === 'home' || screenMode === 'profile' || screenMode === 'donate') {
    return BRAND_NAME;
  }
  const cleanTitle = String(eventTitle || '').trim();
  return cleanTitle ? `${cleanTitle} - ${BRAND_NAME}` : BRAND_NAME;
}
