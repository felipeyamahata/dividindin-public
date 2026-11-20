/**
 * Builds the public event invitation URL from window/request location details.
 * @param {string} origin
 * @param {string} pathname
 * @param {string} eventCode
 * @returns {string}
 */
export function buildInviteUrl(origin, pathname, eventCode) {
  const cleanCode = String(eventCode || '').trim();
  if (!cleanCode) return '';
  const cleanOrigin = String(origin || '').replace(/\/+$/, '');
  const base = String(pathname || '').startsWith('/divide') ? '/divide' : '';
  return `${cleanOrigin}${base}/e/${encodeURIComponent(cleanCode)}`;
}

/**
 * Builds the share title, WhatsApp/Web Share message text, and fallback copy bundle for an event invite.
 * @param {{ eventTitle?: string, origin: string, pathname: string, eventCode: string }} params
 * @returns {{ url: string, title: string, text: string, shareMessage: string }}
 */
export function buildInviteSharePayload({ eventTitle, origin, pathname, eventCode }) {
  const url = buildInviteUrl(origin, pathname, eventCode);
  const cleanTitle = String(eventTitle || '').trim();
  const title = cleanTitle ? `DiviDinDin — ${cleanTitle}` : 'DiviDinDin';
  const roleLabel = cleanTitle ? ` do rolê ${cleanTitle}` : ' do rolê';
  const text = `Vamo rachar a conta${roleLabel}? Clique no link abaixo e entre no DiviDinDin! Fica muito mais fácil dividir os gastos assim!`;
  const shareMessage = url ? `${text}\n${url}` : text;
  return { url, title, text, shareMessage };
}
