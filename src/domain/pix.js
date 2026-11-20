/**
 * Pure EMV QRCPS-MPM (Pix BRCode) payload generator and CRC16-CCITT calculator.
 */

const PIX_GUI = 'br.gov.bcb.pix';
const DEFAULT_COUNTRY_CODE = 'BR';
const DEFAULT_CURRENCY_NUMERIC = '986'; // BRL
const DEFAULT_MCC = '0000';

/**
 * Normalizes text for EMV Pix fields: removes diacritics, restricts to printable ASCII,
 * trims, collapses whitespace, and slices to maxLength.
 * @param {string} value
 * @param {number} maxLength
 * @param {string} fallback
 * @returns {string}
 */
export function sanitizePixText(value, maxLength, fallback = '') {
  const cleaned = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const base = cleaned || fallback;
  return base.slice(0, maxLength);
}

/**
 * Formats an EMV TLV field (`ID + 2-digit length + value`).
 * @param {string} id
 * @param {string} value
 * @returns {string}
 */
function tlv(id, value) {
  const str = String(value ?? '');
  const len = String(str.length).padStart(2, '0');
  return `${id}${len}${str}`;
}

/**
 * Computes CRC16-CCITT (poly 0x1021, init 0xFFFF) as uppercase 4-char hex.
 * @param {string} payloadWithoutCrc
 * @returns {string}
 */
export function computeCrc16Ccitt(payloadWithoutCrc) {
  let crc = 0xffff;
  for (let i = 0; i < payloadWithoutCrc.length; i += 1) {
    crc ^= (payloadWithoutCrc.charCodeAt(i) & 0xff) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Masks a Pix key for subtle UI confirmation without exposing full raw data unnecessarily.
 * @param {string} pixKey
 * @returns {string}
 */
export function maskPixKey(pixKey) {
  const key = String(pixKey || '').trim();
  if (!key) return '';
  if (key.length <= 8) return `${key.slice(0, 2)}***${key.slice(-2)}`;
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

/**
 * Builds a static Pix BRCode (Copia e Cola) string for an optional amount in centavos.
 * @param {{
 *   pixKey: string,
 *   merchantName?: string,
 *   merchantCity?: string,
 *   amountCents?: number,
 *   txid?: string,
 *   description?: string,
 * }} params
 * @returns {string}
 */
export function buildPixPayload({
  pixKey,
  merchantName = 'YAMAHATA LAB',
  merchantCity = 'SAO PAULO',
  amountCents = 0,
  txid = '***',
  description = '',
}) {
  const cleanKey = String(pixKey || '').trim();
  if (!cleanKey) {
    throw new Error('Chave Pix não configurada.');
  }

  const safeName = sanitizePixText(merchantName, 25, 'YAMAHATA LAB').toUpperCase();
  const safeCity = sanitizePixText(merchantCity, 15, 'SAO PAULO').toUpperCase();
  const cleanTxid = sanitizePixText(txid, 25, '***').replace(/[^a-zA-Z0-9*]/g, '') || '***';
  const safeDescription = sanitizePixText(description, 40, '');

  const merchantAccountSubfields = [
    tlv('00', PIX_GUI),
    tlv('01', cleanKey),
  ];
  if (safeDescription) {
    merchantAccountSubfields.push(tlv('02', safeDescription));
  }

  const fields = [
    tlv('00', '01'), // Payload Format Indicator
    tlv('26', merchantAccountSubfields.join('')), // Merchant Account Information (Pix)
    tlv('52', DEFAULT_MCC), // Merchant Category Code
    tlv('53', DEFAULT_CURRENCY_NUMERIC), // Transaction Currency (BRL)
  ];

  const cents = Number(amountCents || 0);
  if (Number.isInteger(cents) && cents > 0) {
    fields.push(tlv('54', (cents / 100).toFixed(2)));
  } else if (cents < 0 || !Number.isInteger(cents)) {
    throw new Error('Valor em centavos inválido para Pix.');
  }

  fields.push(
    tlv('58', DEFAULT_COUNTRY_CODE),
    tlv('59', safeName),
    tlv('60', safeCity),
    tlv('62', tlv('05', cleanTxid)),
  );

  const withoutCrc = `${fields.join('')}6304`;
  return `${withoutCrc}${computeCrc16Ccitt(withoutCrc)}`;
}
