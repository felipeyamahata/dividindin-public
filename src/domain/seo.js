import { BRAND_NAME, LANDING_TITLE } from './pageTitle.js';
import { normalizeBasePath } from './pwa.js';

export const CANONICAL_ORIGIN = 'https://dividindin.com';
export const SITE_NAME = BRAND_NAME;
export const ATELIER_NAME = 'Yamahata Lab';
export const SEO_TITLE = LANDING_TITLE;
export const SEO_DESCRIPTION = 'Aproveite o momento, a conta a gente faz! Calculadora de distribuição de gastos compartilhados.';
export const SEO_FOOTER_LINE_1 = 'ferramenta 100% gratuita | não coletamos dados pessoais';
export const SEO_FOOTER_LINE_2 = ATELIER_NAME;
export const SEO_FOOTER_COPY = `${SEO_FOOTER_LINE_1} | ${SEO_FOOTER_LINE_2}`;
export const OG_IMAGE_PATH = 'og-image.png';
export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;
export const OG_IMAGE_ALT = 'DiviDinDin! — Aproveite o momento, a conta a gente faz! Calculadora de distribuição de gastos compartilhados por Yamahata Lab.';

/**
 * Normalizes an origin URL by stripping trailing slashes.
 * @param {string} [origin]
 * @returns {string}
 */
export function normalizeOrigin(origin = CANONICAL_ORIGIN) {
  const trimmed = String(origin || CANONICAL_ORIGIN).trim().replace(/\/+$/, '');
  return trimmed || CANONICAL_ORIGIN;
}

/**
 * Escapes text for safe embedding inside HTML attribute values.
 * @param {string} value
 * @returns {string}
 */
export function escapeHtmlAttr(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/**
 * Serializes JSON-LD safely for embedding inside a <script> tag.
 * @param {unknown} data
 * @returns {string}
 */
export function serializeJsonLd(data) {
  return JSON.stringify(data)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

/**
 * Builds an absolute URL combining origin, Vite base path, and asset path.
 * @param {string} [origin]
 * @param {string} [basePath]
 * @param {string} [assetPath]
 * @returns {string}
 */
export function buildAbsoluteUrl(origin = CANONICAL_ORIGIN, basePath = '/', assetPath = '') {
  const cleanOrigin = normalizeOrigin(origin);
  const cleanBase = normalizeBasePath(basePath);
  const cleanAsset = String(assetPath || '').replace(/^\/+/, '');
  return `${cleanOrigin}${cleanBase}${cleanAsset}`;
}

/**
 * Resolves the robots meta directive for production vs non-production builds.
 * @param {{ isIndexable?: boolean }} [options]
 * @returns {string}
 */
export function buildRobotsMetaContent({ isIndexable = true } = {}) {
  return isIndexable ? 'index, follow, max-image-preview:large' : 'noindex, nofollow';
}

/**
 * Builds robots.txt content protecting private invite links (/e/*) and API paths.
 * Disallows all crawling outside indexable production builds.
 * @param {{ canonicalOrigin?: string, isIndexable?: boolean }} [options]
 * @returns {string}
 */
export function buildRobotsTxt({ canonicalOrigin = CANONICAL_ORIGIN, isIndexable = true } = {}) {
  if (!isIndexable) {
    return 'User-agent: *\nDisallow: /\n';
  }
  const cleanOrigin = normalizeOrigin(canonicalOrigin);
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /e/',
    'Disallow: /divide/e/',
    'Disallow: /api/',
    'Disallow: /divide/api/',
    'Disallow: /admin/',
    'Disallow: /divide/admin/',
    `Sitemap: ${cleanOrigin}/sitemap.xml`,
    '',
  ].join('\n');
}

/**
 * Builds sitemap.xml listing only the public canonical landing URL.
 * @param {{ canonicalOrigin?: string }} [options]
 * @returns {string}
 */
export function buildSitemapXml({ canonicalOrigin = CANONICAL_ORIGIN } = {}) {
  const canonicalUrl = buildAbsoluteUrl(canonicalOrigin, '/');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    '  <url>',
    `    <loc>${escapeHtmlAttr(canonicalUrl)}</loc>`,
    '  </url>',
    '</urlset>',
    '',
  ].join('\n');
}

/**
 * Builds Schema.org JSON-LD structured data describing DiviDinDin! and Yamahata Lab.
 * @param {{ canonicalOrigin?: string }} [options]
 * @returns {object}
 */
export function buildStructuredData({ canonicalOrigin = CANONICAL_ORIGIN } = {}) {
  const canonicalUrl = buildAbsoluteUrl(canonicalOrigin, '/');
  const imageUrl = buildAbsoluteUrl(canonicalOrigin, '/', OG_IMAGE_PATH);
  const cleanSiteName = SITE_NAME.replace(/!+$/u, '');
  const domainHost = new URL(canonicalUrl).hostname.toLowerCase();
  const alternateSiteNames = Array.from(new Set([cleanSiteName, domainHost].filter(Boolean)));

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${canonicalUrl}#website`,
        name: SITE_NAME,
        alternateName: alternateSiteNames,
        url: canonicalUrl,
        inLanguage: 'pt-BR',
        publisher: { '@id': `${canonicalUrl}#atelier` },
      },
      {
        '@type': 'WebApplication',
        '@id': `${canonicalUrl}#app`,
        name: SITE_NAME,
        alternateName: SEO_TITLE,
        url: canonicalUrl,
        description: SEO_DESCRIPTION,
        applicationCategory: 'UtilitiesApplication',
        operatingSystem: 'Web',
        inLanguage: 'pt-BR',
        isAccessibleForFree: true,
        image: imageUrl,
        creator: { '@id': `${canonicalUrl}#atelier` },
        publisher: { '@id': `${canonicalUrl}#atelier` },
        offers: {
          '@type': 'Offer',
          price: '0',
          priceCurrency: 'BRL',
        },
      },
      {
        '@type': 'Organization',
        '@id': `${canonicalUrl}#atelier`,
        name: ATELIER_NAME,
      },
    ],
  };
}

/**
 * Formats <meta>, <link rel="canonical">, and JSON-LD head tags for index.html injection.
 * @param {{
 *   isIndexable?: boolean,
 *   canonicalOrigin?: string,
 *   googleSiteVerification?: string,
 * }} [options]
 * @returns {string}
 */
export function buildSeoHeadTags({
  isIndexable = false,
  canonicalOrigin = CANONICAL_ORIGIN,
  googleSiteVerification = '',
} = {}) {
  const canonicalUrl = buildAbsoluteUrl(canonicalOrigin, '/');
  const imageUrl = buildAbsoluteUrl(canonicalOrigin, '/', OG_IMAGE_PATH);
  const verification = String(googleSiteVerification || '').trim();

  const metaTags = [
    ['name', 'robots', buildRobotsMetaContent({ isIndexable })],
    ['name', 'description', SEO_DESCRIPTION],
    ['name', 'author', ATELIER_NAME],
    ['name', 'application-name', SITE_NAME],
    ...(isIndexable && verification ? [['name', 'google-site-verification', verification]] : []),
    ['property', 'og:type', 'website'],
    ['property', 'og:locale', 'pt_BR'],
    ['property', 'og:site_name', SITE_NAME],
    ['property', 'og:title', SEO_TITLE],
    ['property', 'og:description', SEO_DESCRIPTION],
    ['property', 'og:url', canonicalUrl],
    ['property', 'og:image', imageUrl],
    ['property', 'og:image:type', 'image/png'],
    ['property', 'og:image:width', String(OG_IMAGE_WIDTH)],
    ['property', 'og:image:height', String(OG_IMAGE_HEIGHT)],
    ['property', 'og:image:alt', OG_IMAGE_ALT],
    ['name', 'twitter:card', 'summary_large_image'],
    ['name', 'twitter:title', SEO_TITLE],
    ['name', 'twitter:description', SEO_DESCRIPTION],
    ['name', 'twitter:image', imageUrl],
    ['name', 'twitter:image:alt', OG_IMAGE_ALT],
  ];

  const lines = metaTags.map(
    ([attr, key, content]) => `    <meta ${attr}="${escapeHtmlAttr(key)}" content="${escapeHtmlAttr(content)}" />`
  );

  if (isIndexable) {
    lines.push(`    <link rel="canonical" href="${escapeHtmlAttr(canonicalUrl)}" />`);
    const jsonLd = serializeJsonLd(buildStructuredData({ canonicalOrigin }));
    lines.push(`    <script type="application/ld+json">${jsonLd}</script>`);
  }

  return lines.join('\n');
}
