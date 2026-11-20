import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeAnchoredMenuPosition,
  computeMorphDelta,
  getEventCardMenuItems,
  isEventCreator,
} from '../src/domain/eventMenu.js';

test('isEventCreator recognizes creator and rejects guests or missing ids', () => {
  assert.equal(isEventCreator({ created_by: 'u1' }, { id: 'u1' }), true);
  assert.equal(isEventCreator({ created_by: 'u1' }, { id: 'u2' }), false);
  assert.equal(isEventCreator({ created_by: null }, { id: 'u1' }), false);
  assert.equal(isEventCreator({ created_by: 'u1' }, null), false);
});

test('getEventCardMenuItems exposes details, rename, and delete only to creator', () => {
  const items = getEventCardMenuItems({ isCreator: true });
  assert.deepEqual(
    items.map((item) => ({ id: item.id, disabled: item.disabled, tone: item.tone })),
    [
      { id: 'details', disabled: false, tone: 'default' },
      { id: 'rename', disabled: false, tone: 'default' },
      { id: 'delete', disabled: false, tone: 'danger' },
    ],
  );
});

test('getEventCardMenuItems exposes details and enabled leave option to guests', () => {
  const items = getEventCardMenuItems({ isCreator: false });
  assert.deepEqual(
    items.map((item) => ({
      id: item.id,
      disabled: item.disabled,
      unavailable: item.unavailable,
      tone: item.tone,
    })),
    [
      { id: 'details', disabled: false, unavailable: false, tone: 'default' },
      { id: 'leave', disabled: false, unavailable: false, tone: 'danger' },
    ],
  );
});

test('computeAnchoredMenuPosition aligns right edge and opens below when space fits', () => {
  const pos = computeAnchoredMenuPosition({
    triggerRect: { left: 320, right: 364, top: 120, bottom: 164 },
    menuRect: { width: 196, height: 148 },
    viewportWidth: 390,
    viewportHeight: 844,
  });
  assert.deepEqual(pos, { left: 168, top: 170, placement: 'bottom' });
});

test('computeAnchoredMenuPosition flips upward near viewport bottom and clamps inside margins', () => {
  const pos = computeAnchoredMenuPosition({
    triggerRect: { left: 16, right: 60, top: 760, bottom: 804 },
    menuRect: { width: 196, height: 148 },
    viewportWidth: 390,
    viewportHeight: 844,
  });
  assert.deepEqual(pos, { left: 8, top: 606, placement: 'top' });
});

test('computeMorphDelta computes clamped spatial deltas from modal back to card', () => {
  const delta = computeMorphDelta({
    originRect: { left: 20, top: 140, width: 350, height: 150 },
    targetRect: { left: 16, top: 200, width: 358, height: 500 },
  });
  assert.deepEqual(delta, { dx: 0, dy: -235, sx: 0.978, sy: 0.3 });

  assert.deepEqual(computeMorphDelta({ originRect: null, targetRect: { width: 300, height: 400 } }), {
    dx: 0,
    dy: 10,
    sx: 0.96,
    sy: 0.96,
  });
});
