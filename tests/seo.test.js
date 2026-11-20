import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  ATELIER_NAME,
  CANONICAL_ORIGIN,
  OG_IMAGE_HEIGHT,
  OG_IMAGE_WIDTH,
  SEO_DESCRIPTION,
  SEO_FOOTER_LINE_1,
  SEO_FOOTER_LINE_2,
  SEO_TITLE,
  SITE_NAME,
  buildRobotsMetaContent,
  buildRobotsTxt,
  buildSeoHeadTags,
  buildSitemapXml,
  buildStructuredData,
  serializeJsonLd,
} from '../src/domain/seo.js';

test('SEO constants match approved product copy and dimensions', () => {
  assert.equal(SITE_NAME, 'DiviDinDin!');
  assert.equal(ATELIER_NAME, 'Yamahata Lab');
  assert.equal(SEO_TITLE, 'DiviDinDin! — Rachador de despesas 100% GRÁTIS');
  assert.equal(
    SEO_DESCRIPTION,
    'Aproveite o momento, a conta a gente faz! Calculadora de distribuição de gastos compartilhados.'
  );
  assert.equal(
    SEO_FOOTER_LINE_1,
    'ferramenta 100% gratuita | não coletamos dados pessoais'
  );
  assert.equal(SEO_FOOTER_LINE_2, 'Yamahata Lab');
  assert.equal(OG_IMAGE_WIDTH, 1200);
  assert.equal(OG_IMAGE_HEIGHT, 630);
});

test('buildRobotsTxt blocks private invites and APIs in production, and blocks all on staging', () => {
  const prod = buildRobotsTxt({ canonicalOrigin: CANONICAL_ORIGIN, isIndexable: true });
  assert.match(prod, /Allow: \//);
  assert.match(prod, /Disallow: \/e\//);
  assert.match(prod, /Disallow: \/api\//);
  assert.match(prod, /Sitemap: https:\/\/dividindin\.com\/sitemap\.xml/);

  const staging = buildRobotsTxt({ canonicalOrigin: CANONICAL_ORIGIN, isIndexable: false });
  assert.equal(staging, 'User-agent: *\nDisallow: /\n');
});

test('buildSitemapXml outputs canonical root URL', () => {
  const xml = buildSitemapXml({ canonicalOrigin: 'https://dividindin.com/' });
  assert.match(xml, /<loc>https:\/\/dividindin\.com\/<\/loc>/);
});

test('buildStructuredData emits UtilitiesApplication WebApplication with free offer and Yamahata Lab', () => {
  const graph = buildStructuredData({ canonicalOrigin: CANONICAL_ORIGIN, basePath: '/' })['@graph'];
  const org = graph.find(item => item['@type'] === 'Organization');
  const website = graph.find(item => item['@type'] === 'WebSite');
  const app = graph.find(item => item['@type'] === 'WebApplication');

  assert.equal(graph[0]['@type'], 'WebSite');
  assert.equal(org.name, 'Yamahata Lab');
  assert.equal(org.url, undefined);
  assert.equal(website.name, 'DiviDinDin!');
  assert.deepEqual(website.alternateName, ['DiviDinDin', 'dividindin.com']);
  assert.equal(website.url, 'https://dividindin.com/');
  assert.equal(app.applicationCategory, 'UtilitiesApplication');
  assert.equal(app.isAccessibleForFree, true);
  assert.equal(app.inLanguage, 'pt-BR');
  assert.equal(app.image, 'https://dividindin.com/og-image.png');
  assert.deepEqual(app.offers, { '@type': 'Offer', price: '0', priceCurrency: 'BRL' });
});

test('buildSeoHeadTags differentiates indexable production from noindex staging and escapes payloads', () => {
  assert.equal(buildRobotsMetaContent({ isIndexable: true }), 'index, follow, max-image-preview:large');
  assert.equal(buildRobotsMetaContent({ isIndexable: false }), 'noindex, nofollow');

  const prodHtml = buildSeoHeadTags({
    isIndexable: true,
    basePath: '/',
    googleSiteVerification: 'token-"123"',
  });
  assert.match(prodHtml, /<meta name="robots" content="index, follow, max-image-preview:large" \/>/);
  assert.match(prodHtml, /<meta name="application-name" content="DiviDinDin!" \/>/);
  assert.match(prodHtml, /<meta property="og:site_name" content="DiviDinDin!" \/>/);
  assert.match(prodHtml, /<link rel="canonical" href="https:\/\/dividindin\.com\/" \/>/);
  assert.match(prodHtml, /<meta property="og:image" content="https:\/\/dividindin\.com\/og-image\.png" \/>/);
  assert.match(prodHtml, /<meta name="twitter:card" content="summary_large_image" \/>/);
  assert.match(prodHtml, /<meta name="google-site-verification" content="token-&quot;123&quot;" \/>/);
  assert.match(prodHtml, /<script type="application\/ld\+json">.*UtilitiesApplication.*<\/script>/);

  const stagingHtml = buildSeoHeadTags({
    isIndexable: false,
    googleSiteVerification: 'ignored',
  });
  assert.match(stagingHtml, /<meta name="robots" content="noindex, nofollow" \/>/);
  assert.match(stagingHtml, /<meta property="og:url" content="https:\/\/dividindin\.com\/" \/>/);
  assert.match(stagingHtml, /<meta property="og:image" content="https:\/\/dividindin\.com\/og-image\.png" \/>/);
  assert.doesNotMatch(stagingHtml, /rel="canonical"/);
  assert.doesNotMatch(stagingHtml, /application\/ld\+json/);
  assert.doesNotMatch(stagingHtml, /google-site-verification/);

  const escapedJson = serializeJsonLd({ raw: '</script>' });
  assert.doesNotMatch(escapedJson, /<\/script>/);
  assert.match(escapedJson, /\\u003c\/script\\u003e/);
});

test('index.html exposes Google-compatible ICO and 48px-multiple PNG favicons backed by public assets', () => {
  assert.equal(existsSync(new URL('../public/favicon.ico', import.meta.url)), true);
  assert.equal(existsSync(new URL('../public/icons/favicon-48.png', import.meta.url)), true);
  assert.equal(existsSync(new URL('../public/icons/favicon-96.png', import.meta.url)), true);
  assert.equal(existsSync(new URL('../public/icons/icon-192.png', import.meta.url)), true);

  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const icoPos = html.indexOf('favicon.ico');
  const png48Pos = html.indexOf('icons/favicon-48.png');
  const png96Pos = html.indexOf('icons/favicon-96.png');
  const svgPos = html.indexOf('favicon.svg');

  assert.ok(icoPos > 0);
  assert.ok(png48Pos > icoPos);
  assert.ok(png96Pos > png48Pos);
  assert.ok(svgPos > png96Pos);
});
