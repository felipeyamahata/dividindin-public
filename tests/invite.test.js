import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInviteSharePayload, buildInviteUrl } from '../src/domain/invite.js';

test('buildInviteUrl respects /divide subpath and strips trailing slashes', () => {
  assert.equal(
    buildInviteUrl('https://dividindin.com/', '/divide/e/abc123', 'abc123'),
    'https://dividindin.com/divide/e/abc123'
  );
  assert.equal(
    buildInviteUrl('https://dividindin.com', '/e/abc123', 'abc 123'),
    'https://dividindin.com/e/abc%20123'
  );
  assert.equal(buildInviteUrl('https://dividindin.com', '/divide', ''), '');
});

test('buildInviteSharePayload formats friendly invite message with event name and link', () => {
  const payload = buildInviteSharePayload({
    eventTitle: 'Churrasco na Praia',
    origin: 'https://dividindin.com',
    pathname: '/e/churras99',
    eventCode: 'churras99',
  });

  assert.equal(payload.title, 'DiviDinDin — Churrasco na Praia');
  assert.equal(payload.url, 'https://dividindin.com/e/churras99');
  assert.equal(
    payload.text,
    'Vamo rachar a conta do rolê Churrasco na Praia? Clique no link abaixo e entre no DiviDinDin! Fica muito mais fácil dividir os gastos assim!'
  );
  assert.equal(payload.shareMessage, `${payload.text}\n${payload.url}`);
});

test('buildInviteSharePayload handles blank event title gracefully', () => {
  const payload = buildInviteSharePayload({
    eventTitle: '   ',
    origin: 'http://s10e:3002',
    pathname: '/divide/e/xyz',
    eventCode: 'xyz',
  });

  assert.equal(payload.title, 'DiviDinDin');
  assert.ok(payload.text.startsWith('Vamo rachar a conta do rolê?'));
  assert.equal(payload.shareMessage, `${payload.text}\nhttp://s10e:3002/divide/e/xyz`);
});
