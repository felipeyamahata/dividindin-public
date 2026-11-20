import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPixPayload,
  computeCrc16Ccitt,
  maskPixKey,
  sanitizePixText,
} from '../src/domain/pix.js';

test('computeCrc16Ccitt matches standard EMV Pix test vector', () => {
  assert.equal(computeCrc16Ccitt('123456789'), '29B1');
});

test('sanitizePixText removes accents, collapses spaces, and caps length', () => {
  assert.equal(sanitizePixText('  São   Paulo — SP  ', 15), 'Sao Paulo SP');
  assert.equal(sanitizePixText('DiviDinDin! Apoio Mensal Extra', 20), 'DiviDinDin! Apoio Me');
});

test('buildPixPayload generates valid EMV BRCode with CRC16 and amount', () => {
  const payload = buildPixPayload({
    pixKey: '123e4567-e89b-12d3-a456-426614174000',
    merchantName: 'Yamahata Lab',
    merchantCity: 'São Paulo',
    amountCents: 1550,
    txid: 'DIVIDE2026',
  });

  assert.match(payload, /^000201/);
  assert.match(payload, /br\.gov\.bcb\.pix/);
  assert.match(payload, /5303986/);
  assert.match(payload, /540515\.50/);
  assert.match(payload, /5802BR/);
  assert.match(payload, /5912YAMAHATA LAB/);
  assert.match(payload, /6009SAO PAULO/);
  assert.match(payload, /6304[0-9A-F]{4}$/);

  const bodyWithoutCrc = payload.slice(0, -4);
  const crc = payload.slice(-4);
  assert.equal(computeCrc16Ccitt(bodyWithoutCrc), crc);
});

test('buildPixPayload omits field 54 when amountCents is 0 and rejects invalid key/amount', () => {
  const openAmountPayload = buildPixPayload({ pixKey: 'teste@exemplo.com', amountCents: 0 });
  assert.equal(openAmountPayload.includes('54'), false);

  assert.throws(() => buildPixPayload({ pixKey: '' }), /Chave Pix/);
  assert.throws(() => buildPixPayload({ pixKey: 'chave', amountCents: -10 }), /Valor em centavos/);
});

test('maskPixKey obscures middle portion of Pix keys', () => {
  assert.equal(maskPixKey('123e4567-e89b-12d3-a456-426614174000'), '123e••••4000');
  assert.equal(maskPixKey('abc123'), 'ab***23');
});
