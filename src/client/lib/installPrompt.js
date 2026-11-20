import {
  detectInstallGuideBrowser,
  isMobileClient,
  normalizeBasePath,
  resolveInstallAvailability,
  shouldShowPostLoginInstallPrompt,
} from '../../domain/pwa.js';
import { api } from './api.js';

let initialized = false;
let configuredBasePath = '/';
let deferredPrompt = null;
let installedInSession = false;
let browserGuide = null;
let bravePromptSuppressed = false;
let braveSuppressionTimer = null;
const listeners = new Set();

function isRunningStandalone() {
  if (installedInSession) return true;
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(display-mode: standalone)')?.matches) return true;
  if (window.navigator?.standalone === true) return true;
  if (typeof document !== 'undefined' && document.referrer.startsWith('android-app://')) return true;
  return false;
}

function hasWebInstallApi() {
  return typeof Navigator !== 'undefined' && typeof Navigator.prototype?.install === 'function';
}

function isStagingHttpPreview() {
  if (typeof window === 'undefined') return false;
  return configuredBasePath === '/divide/' && !window.isSecureContext;
}

function notify() {
  const state = getInstallState();
  for (const listener of listeners) {
    listener(state);
  }
}

/**
 * Returns the current PWA install availability state and browser-specific guide key.
 * @returns {{ status: 'standalone' | 'prompt-ready' | 'manual-guide' | 'unsupported', browserGuide: 'safari-ios' | 'safari-mac' | 'brave' | null }}
 */
export function getInstallState() {
  return {
    status: resolveInstallAvailability({
      isStandalone: isRunningStandalone(),
      hasDeferredPrompt: Boolean(deferredPrompt),
      supportsWebInstall: hasWebInstallApi(),
      browserGuide,
      promptSuppressed: bravePromptSuppressed,
      allowPreview: isStagingHttpPreview(),
    }),
    browserGuide,
  };
}

/**
 * Returns only the current PWA install availability status string.
 * @returns {'standalone' | 'prompt-ready' | 'manual-guide' | 'unsupported'}
 */
export function getInstallStatus() {
  return getInstallState().status;
}

/**
 * Subscribes to install state transitions ({ status, browserGuide }).
 * @param {(state: { status: string, browserGuide: string | null }) => void} listener
 * @returns {() => void}
 */
export function subscribeInstallState(listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function scheduleBraveSuppressionCheck() {
  if (typeof window === 'undefined' || braveSuppressionTimer || deferredPrompt || isRunningStandalone()) {
    return;
  }

  const checkSuppressed = async () => {
    braveSuppressionTimer = null;
    if (deferredPrompt || isRunningStandalone() || hasWebInstallApi()) return;

    if (typeof navigator.getInstalledRelatedApps === 'function') {
      try {
        const related = await navigator.getInstalledRelatedApps();
        if (Array.isArray(related) && related.length > 0) return;
      } catch {
        // Ignore unsupported or restricted related-apps checks.
      }
    }

    bravePromptSuppressed = true;
    notify();
  };

  const delayMs = window.isSecureContext ? 1200 : 0;
  const startTimer = () => {
    if (deferredPrompt || isRunningStandalone() || braveSuppressionTimer) return;
    braveSuppressionTimer = window.setTimeout(checkSuppressed, delayMs);
  };

  if (document.readyState === 'complete') {
    startTimer();
  } else {
    window.addEventListener('load', startTimer, { once: true });
  }
}

/**
 * Initializes PWA Service Worker registration, browser install listeners, and Safari/Brave guide detection.
 * Safe to call multiple times; listeners are bound once.
 * @param {string} [basePath]
 */
export function initPwaInstall(basePath = '/') {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  const normalizedBase = normalizeBasePath(basePath);
  configuredBasePath = normalizedBase;

  browserGuide = detectInstallGuideBrowser({
    userAgent: window.navigator?.userAgent || '',
    maxTouchPoints: window.navigator?.maxTouchPoints || 0,
  });

  if ('serviceWorker' in navigator && window.isSecureContext) {
    const register = () => {
      navigator.serviceWorker
        .register(`${normalizedBase}sw.js`, { scope: normalizedBase })
        .catch(() => {
          // Non-fatal: e.g. self-signed staging certificates do not block normal web usage.
        });
    };
    if (document.readyState === 'complete') {
      register();
    } else {
      window.addEventListener('load', register, { once: true });
    }
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    if (braveSuppressionTimer) {
      window.clearTimeout(braveSuppressionTimer);
      braveSuppressionTimer = null;
    }
    bravePromptSuppressed = false;
    deferredPrompt = event;
    notify();
  });

  window.addEventListener('appinstalled', () => {
    if (braveSuppressionTimer) {
      window.clearTimeout(braveSuppressionTimer);
      braveSuppressionTimer = null;
    }
    deferredPrompt = null;
    bravePromptSuppressed = false;
    installedInSession = true;
    api.reportPwaInstalled('appinstalled');
    notify();
  });

  const standaloneMedia = window.matchMedia?.('(display-mode: standalone)');
  standaloneMedia?.addEventListener?.('change', notify);

  if (typeof window.navigator?.brave?.isBrave === 'function') {
    window.navigator.brave.isBrave()
      .then((isBrave) => {
        if (!isBrave) return;
        browserGuide = detectInstallGuideBrowser({
          userAgent: window.navigator?.userAgent || '',
          maxTouchPoints: window.navigator?.maxTouchPoints || 0,
          hasBraveApi: true,
        });
        scheduleBraveSuppressionCheck();
        notify();
      })
      .catch(() => {
        // Ignore blocked Brave detection API.
      });
  }
}

/**
 * Triggers the browser-controlled install confirmation flow.
 * Must be invoked directly from a user gesture handler.
 * @returns {Promise<'accepted' | 'dismissed' | 'unavailable'>}
 */
export async function promptAppInstall() {
  if (isRunningStandalone()) return 'unavailable';

  if (hasWebInstallApi() && !deferredPrompt) {
    try {
      await navigator.install();
      installedInSession = true;
      api.reportPwaInstalled('navigator-install');
      notify();
      return 'accepted';
    } catch (error) {
      if (error?.name === 'AbortError') return 'dismissed';
      console.error('Erro ao iniciar instalação do app:', error);
      return 'unavailable';
    }
  }

  if (!deferredPrompt) return 'unavailable';

  const promptEvent = deferredPrompt;
  deferredPrompt = null;

  try {
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice?.outcome === 'accepted') {
      installedInSession = true;
      notify();
      return 'accepted';
    }
    notify();
    return 'dismissed';
  } catch (error) {
    console.error('Erro ao exibir prompt de instalação:', error);
    notify();
    return 'unavailable';
  }
}

export function isMobileBrowserEnvironment() {
  if (typeof window === 'undefined') return false;
  return isMobileClient({
    userAgent: window.navigator?.userAgent || '',
    maxTouchPoints: window.navigator?.maxTouchPoints || 0,
    viewportWidth: window.innerWidth || 0,
    hasCoarsePointer: Boolean(window.matchMedia?.('(pointer: coarse)')?.matches),
  });
}

export function evaluatePostLoginInstallPrompt(authAction = 'login') {
  const installState = getInstallState();
  const decision = shouldShowPostLoginInstallPrompt({
    authAction,
    installStatus: installState.status,
    isMobile: isMobileBrowserEnvironment(),
  });
  return {
    ...decision,
    browserGuide: installState.browserGuide,
  };
}
