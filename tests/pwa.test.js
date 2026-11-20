import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWebAppManifest,
  detectInstallGuideBrowser,
  getInstallGuideContent,
  isMobileClient,
  normalizeBasePath,
  resolveInstallAvailability,
  shouldShowPostLoginInstallPrompt,
} from '../src/domain/pwa.js';

test('normalizeBasePath always wraps non-root paths with leading and trailing slashes', () => {
  assert.equal(normalizeBasePath(), '/');
  assert.equal(normalizeBasePath('/'), '/');
  assert.equal(normalizeBasePath(''), '/');
  assert.equal(normalizeBasePath('/divide'), '/divide/');
  assert.equal(normalizeBasePath('/divide/'), '/divide/');
  assert.equal(normalizeBasePath('divide'), '/divide/');
});

test('buildWebAppManifest builds standalone DiviDinDin! manifest for root and subpath bases', () => {
  const rootManifest = buildWebAppManifest('/');
  assert.equal(rootManifest.id, '/');
  assert.equal(rootManifest.name, 'DiviDinDin!');
  assert.equal(rootManifest.short_name, 'DiviDinDin!');
  assert.equal(rootManifest.start_url, '/');
  assert.equal(rootManifest.scope, '/');
  assert.equal(rootManifest.display, 'standalone');
  assert.deepEqual(
    rootManifest.icons.map((icon) => [icon.src, icon.sizes, icon.purpose]),
    [
      ['/icons/icon-192.png', '192x192', 'any'],
      ['/icons/icon-512.png', '512x512', 'any'],
      ['/icons/icon-maskable-512.png', '512x512', 'maskable'],
    ]
  );

  const subManifest = buildWebAppManifest('/divide/');
  assert.equal(subManifest.id, '/divide/');
  assert.equal(subManifest.start_url, '/divide/');
  assert.equal(subManifest.scope, '/divide/');
  assert.equal(subManifest.icons[0].src, '/divide/icons/icon-192.png');
});

test('resolveInstallAvailability hides install CTA in standalone mode and reveals only when promptable', () => {
  assert.equal(
    resolveInstallAvailability({ isStandalone: true, hasDeferredPrompt: true, supportsWebInstall: true }),
    'standalone'
  );
  assert.equal(
    resolveInstallAvailability({ isStandalone: false, hasDeferredPrompt: true, supportsWebInstall: false }),
    'prompt-ready'
  );
  assert.equal(
    resolveInstallAvailability({ isStandalone: false, hasDeferredPrompt: false, supportsWebInstall: true }),
    'prompt-ready'
  );
  assert.equal(
    resolveInstallAvailability({ isStandalone: false, hasDeferredPrompt: false, supportsWebInstall: false }),
    'unsupported'
  );
  assert.equal(
    resolveInstallAvailability({ isStandalone: false, hasDeferredPrompt: false, supportsWebInstall: false, allowPreview: true }),
    'prompt-ready'
  );
  assert.equal(
    resolveInstallAvailability({ isStandalone: true, hasDeferredPrompt: false, supportsWebInstall: false, allowPreview: true }),
    'standalone'
  );
  assert.equal(
    resolveInstallAvailability({ isStandalone: false, browserGuide: 'safari-ios' }),
    'manual-guide'
  );
  assert.equal(
    resolveInstallAvailability({ isStandalone: false, browserGuide: 'safari-mac' }),
    'manual-guide'
  );
  assert.equal(
    resolveInstallAvailability({ isStandalone: false, browserGuide: 'brave-mobile', promptSuppressed: false }),
    'unsupported'
  );
  assert.equal(
    resolveInstallAvailability({ isStandalone: false, browserGuide: 'brave-mobile', promptSuppressed: true }),
    'manual-guide'
  );
  assert.equal(
    resolveInstallAvailability({ isStandalone: false, browserGuide: 'brave-desktop', promptSuppressed: true }),
    'manual-guide'
  );
  assert.equal(
    resolveInstallAvailability({ isStandalone: false, hasDeferredPrompt: true, browserGuide: 'brave-desktop', promptSuppressed: true }),
    'prompt-ready'
  );
  assert.equal(
    resolveInstallAvailability({ isStandalone: true, browserGuide: 'safari-ios' }),
    'standalone'
  );
});

test('detectInstallGuideBrowser detects Safari iOS, iPadOS, macOS, and Brave mobile/desktop without false positives on Chrome', () => {
  const safariIosUa = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  const safariMacUa = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
  const chromeMacUa = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
  const chromeAndroidUa = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
  const chromeIosUa = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.108 Mobile/15E148 Safari/604.1';

  assert.equal(detectInstallGuideBrowser({ userAgent: safariIosUa }), 'safari-ios');
  assert.equal(detectInstallGuideBrowser({ userAgent: safariMacUa, maxTouchPoints: 5 }), 'safari-ios');
  assert.equal(detectInstallGuideBrowser({ userAgent: safariMacUa, maxTouchPoints: 0 }), 'safari-mac');
  assert.equal(detectInstallGuideBrowser({ userAgent: chromeMacUa }), null);
  assert.equal(detectInstallGuideBrowser({ userAgent: chromeIosUa }), null);
  assert.equal(detectInstallGuideBrowser({ userAgent: chromeMacUa, hasBraveApi: true }), 'brave-desktop');
  assert.equal(detectInstallGuideBrowser({ userAgent: chromeAndroidUa, hasBraveApi: true }), 'brave-mobile');
});

test('getInstallGuideContent returns tailored instructions for Safari and Brave mobile/desktop guides', () => {
  for (const [guide, expectedSteps] of [
    ['safari-ios', 3],
    ['safari-mac', 3],
    ['brave-mobile', 2],
    ['brave-desktop', 3],
  ]) {
    const content = getInstallGuideContent(guide);
    assert.ok(content);
    assert.ok(content.title.length > 0);
    assert.equal(content.steps.length, expectedSteps);
  }
  assert.equal(getInstallGuideContent(null), null);
});

test('isMobileClient distinguishes mobile devices and iPadOS from desktop browsers', () => {
  assert.equal(isMobileClient({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari/537.36' }), true);
  assert.equal(isMobileClient({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Mobile/15E148' }), true);
  assert.equal(isMobileClient({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 }), true);
  assert.equal(isMobileClient({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', viewportWidth: 390, hasCoarsePointer: true }), true);
  assert.equal(isMobileClient({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 0, viewportWidth: 1440 }), false);
  assert.equal(isMobileClient({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', viewportWidth: 800, hasCoarsePointer: false }), false);
});

test('shouldShowPostLoginInstallPrompt always prompts on explicit mobile browser logins and never on standalone PWA or desktop', () => {
  assert.deepEqual(
    shouldShowPostLoginInstallPrompt({ authAction: 'login', installStatus: 'prompt-ready', isMobile: true }),
    { show: true, mode: 'install-native' },
  );
  assert.deepEqual(
    shouldShowPostLoginInstallPrompt({ authAction: 'login', installStatus: 'manual-guide', isMobile: true }),
    { show: true, mode: 'install-manual' },
  );
  assert.deepEqual(
    shouldShowPostLoginInstallPrompt({ authAction: 'login', installStatus: 'unsupported', isMobile: true }),
    { show: true, mode: 'install-native' },
  );
  assert.deepEqual(
    shouldShowPostLoginInstallPrompt({ authAction: 'login', installStatus: 'standalone', isMobile: true }),
    { show: false, mode: 'none' },
  );
  assert.deepEqual(
    shouldShowPostLoginInstallPrompt({ authAction: 'login', installStatus: 'prompt-ready', isMobile: false }),
    { show: false, mode: 'none' },
  );
  assert.deepEqual(
    shouldShowPostLoginInstallPrompt({ authAction: 'register', installStatus: 'prompt-ready', isMobile: true }),
    { show: false, mode: 'none' },
  );
  assert.deepEqual(
    shouldShowPostLoginInstallPrompt({ authAction: 'session-cache', installStatus: 'prompt-ready', isMobile: true }),
    { show: false, mode: 'none' },
  );
});
