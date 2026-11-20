import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const isProd = process.env.NODE_ENV === 'production';

// Load host-local env secrets cleanly without overwriting PM2/shell-provided vars.
if (!process.env.NODE_TEST_CONTEXT && process.env.NODE_ENV !== 'test' && typeof process.loadEnvFile === 'function') {
  const envCandidates = isProd
    ? [path.join(projectRoot, 'data/.env.production'), path.join(projectRoot, '.env.production'), path.join(projectRoot, '.env')]
    : [path.join(projectRoot, 'data/.env.development'), path.join(projectRoot, '.env.local'), path.join(projectRoot, '.env')];
  for (const candidate of envCandidates) {
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
    }
  }
}

const defaultDb = isProd ? 'divide.sqlite' : 'divide-dev.sqlite';
// The presentation snapshot uses a new ephemeral development secret on each start.
const defaultSecret = randomBytes(32).toString('hex');

if (isProd && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) {
  throw new Error('SESSION_SECRET must be configured with at least 32 characters in production');
}

export const config = {
  port: Number(process.env.PORT || 3001),
  host: process.env.HOST || '0.0.0.0',
  databasePath: process.env.DATABASE_PATH || path.resolve(__dirname, `../data/${defaultDb}`),
  sessionSecret: process.env.SESSION_SECRET || defaultSecret,
  googleClientId: (process.env.GOOGLE_CLIENT_ID || '').trim(),
  pixKey: (process.env.PIX_KEY || '').trim(),
  pixMerchantName: (process.env.PIX_MERCHANT_NAME || 'YAMAHATA LAB').trim(),
  pixMerchantCity: (process.env.PIX_MERCHANT_CITY || 'SAO PAULO').trim(),
  usdBrlFallback: Number(process.env.USD_BRL_FALLBACK || 5.8),
  mercadoPagoAccessToken: (process.env.MERCADO_PAGO_ACCESS_TOKEN || '').trim(),
  mercadoPagoWebhookSecret: (process.env.MERCADO_PAGO_WEBHOOK_SECRET || '').trim(),
  mercadoPagoNotificationUrl: (process.env.MERCADO_PAGO_NOTIFICATION_URL || '').trim(),
  mercadoPagoPayerEmail: (process.env.MERCADO_PAGO_PAYER_EMAIL || 'apoio@dividindin.com').trim(),
  mercadoPagoApiMode: (process.env.MERCADO_PAGO_API_MODE || 'orders').trim().toLowerCase() === 'payments'
    ? 'payments'
    : 'orders',
  isProd,
  serveStatic: process.env.SERVE_STATIC ? process.env.SERVE_STATIC === 'true' : !isProd,
};
