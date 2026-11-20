import { BRAND_NAME } from './pageTitle.js';

export const PWA_BACKGROUND_COLOR = '#0b0b0b';
export const PWA_THEME_COLOR = '#0b0b0b';
export const PWA_DESCRIPTION = 'Divisão de despesas entre amigos, simples e sem atrito.';

/**
 * Normalizes a base path so it always starts and ends with '/'.
 * @param {string} [basePath]
 * @returns {string}
 */
export function normalizeBasePath(basePath = '/') {
  const trimmed = String(basePath || '/').trim();
  if (!trimmed || trimmed === '/') return '/';
  const clean = trimmed.replace(/^\/+|\/+$/g, '');
  return clean ? `/${clean}/` : '/';
}

/**
 * Builds the Web App Manifest payload for the configured base path.
 * @param {string} [basePath]
 * @returns {object}
 */
export function buildWebAppManifest(basePath = '/') {
  const base = normalizeBasePath(basePath);
  return {
    id: base,
    name: BRAND_NAME,
    short_name: BRAND_NAME,
    description: PWA_DESCRIPTION,
    start_url: base,
    scope: base,
    display: 'standalone',
    background_color: PWA_BACKGROUND_COLOR,
    theme_color: PWA_THEME_COLOR,
    lang: 'pt-BR',
    icons: [
      {
        src: `${base}icons/icon-192.png`,
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: `${base}icons/icon-512.png`,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: `${base}icons/icon-maskable-512.png`,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}

/**
 * Identifies browsers that may require a manual install guide when native prompting is unavailable or suppressed.
 * @param {{ userAgent?: string, maxTouchPoints?: number, hasBraveApi?: boolean }} [env]
 * @returns {'safari-ios' | 'safari-mac' | 'brave-mobile' | 'brave-desktop' | null}
 */
export function detectInstallGuideBrowser({
  userAgent = '',
  maxTouchPoints = 0,
  hasBraveApi = false,
} = {}) {
  const ua = String(userAgent || '');
  if (hasBraveApi) {
    return /\b(Android|Mobile|iPhone|iPad|iPod)\b/i.test(ua) ? 'brave-mobile' : 'brave-desktop';
  }
  if (!ua) return null;

  const isSafariEngine = /Safari/i.test(ua)
    && !/(Chrome|CriOS|Chromium|Edg|EdgiOS|EdgA|FxiOS|Firefox|OPR|Opera|SamsungBrowser|Brave)/i.test(ua);
  if (!isSafariEngine) return null;

  if (/\b(iPhone|iPad|iPod)\b/i.test(ua) || (/\bMacintosh\b/i.test(ua) && Number(maxTouchPoints) > 1)) {
    return 'safari-ios';
  }
  if (/\bMacintosh\b/i.test(ua)) {
    return 'safari-mac';
  }
  return null;
}

/**
 * Returns concise step-by-step instructions for browsers without programmatic install prompting.
 * @param {'safari-ios' | 'safari-mac' | 'brave-mobile' | 'brave-desktop' | null} browserGuide
 * @returns {{ title: string, steps: string[] } | null}
 */
export function getInstallGuideContent(browserGuide) {
  switch (browserGuide) {
    case 'safari-ios':
      return {
        title: 'instalar no safari',
        steps: [
          'toque no botão compartilhar na barra do safari',
          'role e toque em "adicionar à tela de início"',
          'confirme em "adicionar" para abrir sem barra',
        ],
      };
    case 'safari-mac':
      return {
        title: 'instalar no safari',
        steps: [
          'abra "arquivo" no menu do safari (ou toque em compartilhar)',
          'escolha "adicionar ao dock"',
          'confirme para abrir o DiviDinDin! em janela própria',
        ],
      };
    case 'brave-mobile':
      return {
        title: 'instalar no brave',
        steps: [
          'abra o menu do brave (⋮ ou ☰)',
          'toque em "instalar e criar atalho"',
        ],
      };
    case 'brave-desktop':
      return {
        title: 'instalar no brave',
        steps: [
          'abra o menu do brave (⋮ ou ☰)',
          'vá em "salvar e compartilhar"',
          'clique em "instalar página como app..."',
        ],
      };
    default:
      return null;
  }
}

/**
 * Resolves the UI availability state for the in-app install button.
 * Never returns an installable state while running in standalone/installed mode.
 * @param {{
 *   isStandalone?: boolean,
 *   hasDeferredPrompt?: boolean,
 *   supportsWebInstall?: boolean,
 *   browserGuide?: 'safari-ios' | 'safari-mac' | 'brave-mobile' | 'brave-desktop' | null,
 *   promptSuppressed?: boolean,
 *   allowPreview?: boolean,
 * }} [state]
 * @returns {'standalone' | 'prompt-ready' | 'manual-guide' | 'unsupported'}
 */
export function resolveInstallAvailability({
  isStandalone = false,
  hasDeferredPrompt = false,
  supportsWebInstall = false,
  browserGuide = null,
  promptSuppressed = false,
  allowPreview = false,
} = {}) {
  if (isStandalone) return 'standalone';
  if (hasDeferredPrompt || supportsWebInstall) return 'prompt-ready';
  if (browserGuide === 'safari-ios' || browserGuide === 'safari-mac') return 'manual-guide';
  if ((browserGuide === 'brave-mobile' || browserGuide === 'brave-desktop') && promptSuppressed) {
    return 'manual-guide';
  }
  if (allowPreview) return 'prompt-ready';
  return 'unsupported';
}

/**
 * Identifies smartphone and touch-tablet mobile clients versus desktop browsers.
 */
export function isMobileClient({
  userAgent = '',
  maxTouchPoints = 0,
  viewportWidth = 0,
  hasCoarsePointer = false,
} = {}) {
  const ua = String(userAgent || '');
  if (/\b(Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile)\b/i.test(ua)) {
    return true;
  }
  if (/\bMacintosh\b/i.test(ua) && Number(maxTouchPoints) > 1) {
    return true;
  }
  return Boolean(hasCoarsePointer) && Number(viewportWidth) > 0 && Number(viewportWidth) <= 900;
}

/**
 * Evaluates whether the post-login install prompt should appear for a mobile browser user.
 * Triggers on every explicit login action whenever the user is in a mobile browser (not standalone PWA).
 */
export function shouldShowPostLoginInstallPrompt({
  authAction = 'login',
  installStatus = 'unsupported',
  isMobile = false,
} = {}) {
  if (authAction !== 'login' || !isMobile || installStatus === 'standalone') {
    return { show: false, mode: 'none' };
  }
  if (installStatus === 'manual-guide') {
    return { show: true, mode: 'install-manual' };
  }
  return { show: true, mode: 'install-native' };
}
