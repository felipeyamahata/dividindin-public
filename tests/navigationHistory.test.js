import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEventPath,
  buildHistoryState,
  buildHomePath,
  computeFullNavStack,
  computeScreenStack,
  isAppHistoryState,
  normalizeBasePath,
  parseEventCodeFromPath,
  planHistoryReconciliation,
  resolveBackStep,
} from '../src/domain/navigationHistory.js';

describe('navigationHistory path helpers', () => {
  it('normalizes base paths and builds home/event paths', () => {
    assert.equal(normalizeBasePath(''), '');
    assert.equal(normalizeBasePath('/'), '');
    assert.equal(normalizeBasePath('/divide'), '/divide');
    assert.equal(normalizeBasePath('/divide/'), '/divide');

    assert.equal(buildHomePath(''), '/');
    assert.equal(buildHomePath('/divide'), '/divide/');
    assert.equal(buildEventPath('', 'abc123'), '/e/abc123');
    assert.equal(buildEventPath('/divide', 'abc123'), '/divide/e/abc123');
  });

  it('parses event invite codes from root and /divide pathnames', () => {
    assert.equal(parseEventCodeFromPath('/'), null);
    assert.equal(parseEventCodeFromPath('/divide/'), null);
    assert.equal(parseEventCodeFromPath('/e/viagem-2026'), 'viagem-2026');
    assert.equal(parseEventCodeFromPath('/divide/e/churras_01'), 'churras_01');
  });
});

describe('computeScreenStack & computeFullNavStack', () => {
  it('builds home-rooted hierarchy through event, detail, expense form, and profile', () => {
    const stack = computeScreenStack({
      basePath: '/divide',
      baseEntryKind: 'home',
      eventCode: 'trip01',
      selectedExpenseId: 42,
      isAddExpenseOpen: true,
      isProfileOpen: true,
    });

    assert.deepEqual(
      stack.map(f => [f.screen, f.url]),
      [
        ['home', '/divide/'],
        ['event', '/divide/e/trip01'],
        ['detail', '/divide/e/trip01'],
        ['expense-form', '/divide/e/trip01'],
        ['profile', '/divide/e/trip01'],
      ]
    );
  });

  it('starts stack at event when opened directly via deep link', () => {
    const stack = computeScreenStack({
      basePath: '',
      baseEntryKind: 'event',
      eventCode: 'deep99',
      selectedSettlementId: 7,
    });

    assert.deepEqual(
      stack.map(f => [f.screen, f.detailKind, f.detailId, f.url]),
      [
        ['event', null, null, '/e/deep99'],
        ['detail', 'settlement', 7, '/e/deep99'],
      ]
    );
  });

  it('appends active overlay layers ordered by priority then activation sequence', () => {
    const screenStack = computeScreenStack({ eventCode: 'trip01' });
    const full = computeFullNavStack(screenStack, [
      { id: 'confirm-dialog', priority: 100, seq: 3 },
      { id: 'event-card-menu', priority: 20, seq: 1 },
      { id: 'edit-event', priority: 10, seq: 2 },
    ]);

    assert.deepEqual(
      full.map(f => f.layerId || f.screen),
      ['home', 'event', 'edit-event', 'event-card-menu', 'confirm-dialog']
    );
  });
});

describe('isAppHistoryState & buildHistoryState', () => {
  it('tags and validates session-scoped history state payloads', () => {
    const [frame] = computeScreenStack({ eventCode: 'ev1' }).slice(1);
    const state = buildHistoryState({ sessionId: 'sess-1', index: 1, frame });

    assert.equal(isAppHistoryState(state, 'sess-1'), true);
    assert.equal(isAppHistoryState(state, 'sess-2'), false);
    assert.equal(isAppHistoryState({ index: 0 }, 'sess-1'), false);
    assert.equal(isAppHistoryState(null, 'sess-1'), false);
  });
});

describe('planHistoryReconciliation', () => {
  it('pushes new frames when navigating forward', () => {
    const committed = computeScreenStack({});
    const desired = computeScreenStack({ eventCode: 'ev1', selectedExpenseId: 10 });

    const plan = planHistoryReconciliation(committed, desired);
    assert.equal(plan.type, 'push');
    assert.equal(plan.startIndex, 1);
    assert.deepEqual(plan.frames.map(f => f.screen), ['event', 'detail']);
  });

  it('replaces top entry when modal closes directly into a new screen at same depth', () => {
    const home = computeScreenStack({});
    const committed = computeFullNavStack(home, [{ id: 'new-event', priority: 10, seq: 1 }]);
    const desired = computeScreenStack({ eventCode: 'new01' });

    const plan = planHistoryReconciliation(committed, desired);
    assert.equal(plan.type, 'replace');
    assert.equal(plan.index, 1);
    assert.equal(plan.frame.screen, 'event');
    assert.equal(plan.frame.url, '/e/new01');
  });

  it('replaces and pushes when top layer transforms into deeper stack', () => {
    const home = computeScreenStack({});
    const committed = computeFullNavStack(home, [{ id: 'new-event', priority: 10, seq: 1 }]);
    const desired = computeFullNavStack(
      computeScreenStack({ eventCode: 'new01' }),
      [{ id: 'claim-sheet', priority: 10, seq: 2 }]
    );

    const plan = planHistoryReconciliation(committed, desired);
    assert.equal(plan.type, 'replace-and-push');
    assert.equal(plan.replaceIndex, 1);
    assert.equal(plan.replaceFrame.screen, 'event');
    assert.equal(plan.startIndex, 2);
    assert.equal(plan.pushFrames[0].layerId, 'claim-sheet');
  });

  it('issues negative delta back operation when stack shrinks', () => {
    const committed = computeScreenStack({
      eventCode: 'ev1',
      selectedExpenseId: 5,
      isProfileOpen: true,
    });
    const desired = computeScreenStack({ eventCode: 'ev1' });

    const plan = planHistoryReconciliation(committed, desired);
    assert.deepEqual(plan, { type: 'back', delta: -2, targetIndex: 1 });
  });

  it('returns noop when committed and desired stacks match', () => {
    const stack = computeScreenStack({ eventCode: 'ev1', isDonateOpen: true });
    assert.deepEqual(planHistoryReconciliation(stack, stack), { type: 'noop' });
  });
});

describe('resolveBackStep', () => {
  it('resolves overlay layer and screen back actions accurately', () => {
    const base = computeScreenStack({
      eventCode: 'ev1',
      selectedExpenseId: 9,
      isAddExpenseOpen: true,
      isDonateOpen: true,
      isProfileOpen: true,
    });
    const withLayer = computeFullNavStack(base, [{ id: 'profile-dialog', seq: 1 }]);

    assert.deepEqual(
      resolveBackStep({ currentFrames: withLayer, targetIndex: withLayer.length - 2 }),
      { action: 'close-layer', layerId: 'profile-dialog' }
    );
    assert.deepEqual(
      resolveBackStep({ currentFrames: base, targetIndex: base.length - 2 }),
      { action: 'close-profile' }
    );
    assert.deepEqual(
      resolveBackStep({ currentFrames: base.slice(0, 5), targetIndex: 3 }),
      { action: 'close-donate' }
    );
    assert.deepEqual(
      resolveBackStep({ currentFrames: base.slice(0, 4), targetIndex: 2 }),
      { action: 'close-expense-form' }
    );
    assert.deepEqual(
      resolveBackStep({ currentFrames: base.slice(0, 3), targetIndex: 1 }),
      { action: 'close-detail' }
    );
    assert.deepEqual(
      resolveBackStep({ currentFrames: base.slice(0, 2), targetIndex: 0 }),
      { action: 'leave-event' }
    );
  });
});
