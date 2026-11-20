import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeRemainingLoadingMs,
  EVENT_LOADING_ENTRY_FLIGHT_MS,
  EVENT_LOADING_EXIT_FLIGHT_MS,
  MIN_EVENT_LOADING_MS,
} from '../src/domain/loadingTransition.js';

describe('loadingTransition timing helpers', () => {
  it('enforces a 1500ms minimum loading window', () => {
    assert.equal(MIN_EVENT_LOADING_MS, 1500);
    assert.equal(computeRemainingLoadingMs({ startedAt: 1000, now: 1250 }), 1250);
    assert.equal(computeRemainingLoadingMs({ startedAt: 1000, now: 2500 }), 0);
    assert.equal(computeRemainingLoadingMs({ startedAt: 1000, now: 2800 }), 0);
  });

  it('handles clock skew and custom minimum durations safely', () => {
    assert.equal(computeRemainingLoadingMs({ startedAt: 1000, now: 900 }), 1500);
    assert.equal(computeRemainingLoadingMs({ startedAt: 1000, now: 1120, minDurationMs: 260 }), 140);
    assert.equal(computeRemainingLoadingMs({ startedAt: Number.NaN, now: 1000 }), 0);
  });

  it('exposes entry flight shorter than minimum loading window and positive exit flight', () => {
    assert.ok(EVENT_LOADING_ENTRY_FLIGHT_MS > 0 && EVENT_LOADING_ENTRY_FLIGHT_MS <= MIN_EVENT_LOADING_MS);
    assert.ok(EVENT_LOADING_EXIT_FLIGHT_MS > 0);
  });
});
