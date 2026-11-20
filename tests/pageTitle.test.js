import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BRAND_NAME, formatDocumentTitle } from '../src/domain/pageTitle.js';
import { SEO_TITLE } from '../src/domain/seo.js';

test('formatDocumentTitle returns SEO title on public landing screen', () => {
  assert.equal(formatDocumentTitle({ screenMode: 'landing' }), SEO_TITLE);
  assert.equal(formatDocumentTitle({ screenMode: 'landing', isLoading: true }), SEO_TITLE);
  assert.equal(formatDocumentTitle({ screenMode: 'landing', isError: true }), BRAND_NAME);
  assert.equal(formatDocumentTitle({ screenMode: 'landing', isMaintenance: true }), BRAND_NAME);
});

test('formatDocumentTitle returns DiviDinDin! on event selection and non-event screens', () => {
  assert.equal(formatDocumentTitle(), BRAND_NAME);
  assert.equal(formatDocumentTitle({ screenMode: 'home', eventTitle: 'Qualquer' }), 'DiviDinDin!');
  assert.equal(formatDocumentTitle({ screenMode: 'profile', eventTitle: 'Qualquer' }), 'DiviDinDin!');
  assert.equal(formatDocumentTitle({ screenMode: 'donate', eventTitle: 'Qualquer' }), 'DiviDinDin!');
  assert.equal(formatDocumentTitle({ screenMode: 'event', eventTitle: 'Churrasco', isLoading: true }), 'DiviDinDin!');
  assert.equal(formatDocumentTitle({ screenMode: 'event', eventTitle: 'Churrasco', isError: true }), 'DiviDinDin!');
  assert.equal(formatDocumentTitle({ screenMode: 'event', eventTitle: 'Churrasco', isMaintenance: true }), 'DiviDinDin!');
});

test('formatDocumentTitle prefixes event name when viewing an event or its expense flow', () => {
  assert.equal(
    formatDocumentTitle({ screenMode: 'event', eventTitle: '  Viagem Praia  ' }),
    'Viagem Praia - DiviDinDin!'
  );
  assert.equal(
    formatDocumentTitle({ screenMode: 'expense', eventTitle: 'Churrasco' }),
    'Churrasco - DiviDinDin!'
  );
  assert.equal(
    formatDocumentTitle({ screenMode: 'event', eventTitle: '   ' }),
    'DiviDinDin!'
  );
});
