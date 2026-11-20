import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EVENT_TABS,
  TAB_TRANSITION_TIMING,
  getTabSlideDirection,
} from '../src/domain/tabTransition.js';

test('getTabSlideDirection computes signed order between known tabs', () => {
  assert.equal(getTabSlideDirection(EVENT_TABS, 'expenses', 'settlement'), 1);
  assert.equal(getTabSlideDirection(EVENT_TABS, 'expenses', 'group'), 1);
  assert.equal(getTabSlideDirection(EVENT_TABS, 'settlement', 'group'), 1);
  assert.equal(getTabSlideDirection(EVENT_TABS, 'group', 'expenses'), -1);
  assert.equal(getTabSlideDirection(EVENT_TABS, 'group', 'settlement'), -1);
  assert.equal(getTabSlideDirection(EVENT_TABS, 'settlement', 'settlement'), 0);
  assert.equal(getTabSlideDirection(EVENT_TABS, 'expenses', 'unknown'), 0);
  assert.equal(getTabSlideDirection(null, 'expenses', 'settlement'), 0);
});

test('TAB_TRANSITION_TIMING preserves horizontal enter and exit durations', () => {
  assert.equal(TAB_TRANSITION_TIMING.enterSlideDurationMs, 600);
  assert.equal(TAB_TRANSITION_TIMING.exitSlideDurationMs, 460);
});
