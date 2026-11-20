export const NAV_STATE_MARKER = '__divideNav';

/**
 * Normalizes a router base path (`''` or `'/divide'`).
 * @param {string} [basePath]
 * @returns {string}
 */
export function normalizeBasePath(basePath = '') {
  if (!basePath || basePath === '/') return '';
  return basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
}

/**
 * Builds the root home URL path for the app.
 * @param {string} [basePath]
 * @returns {string}
 */
export function buildHomePath(basePath = '') {
  return `${normalizeBasePath(basePath)}/`;
}

/**
 * Builds the event URL path for a given invite code.
 * @param {string} basePath
 * @param {string} eventCode
 * @returns {string}
 */
export function buildEventPath(basePath, eventCode) {
  return `${normalizeBasePath(basePath)}/e/${eventCode}`;
}

/**
 * Extracts an event invite code from a browser pathname (`/e/:code` or `/divide/e/:code`).
 * @param {string} pathname
 * @returns {string | null}
 */
export function parseEventCodeFromPath(pathname = '') {
  const match = String(pathname).match(/\/(?:divide\/)?e\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

/**
 * Builds a serializable `window.history.state` payload for a navigation frame.
 * @param {object} params
 * @param {string} params.sessionId
 * @param {number} params.index
 * @param {object} params.frame
 * @returns {object}
 */
export function buildHistoryState({ sessionId, index, frame }) {
  return {
    [NAV_STATE_MARKER]: true,
    sessionId,
    index,
    screen: frame.screen,
    eventCode: frame.eventCode || null,
    detailKind: frame.detailKind || null,
    detailId: frame.detailId ?? null,
    layerId: frame.layerId || null,
  };
}

/**
 * Checks whether a raw `history.state` entry belongs to the active Divide session.
 * @param {unknown} rawState
 * @param {string} [sessionId]
 * @returns {boolean}
 */
export function isAppHistoryState(rawState, sessionId) {
  if (!rawState || typeof rawState !== 'object') return false;
  if (rawState[NAV_STATE_MARKER] !== true) return false;
  if (sessionId && rawState.sessionId !== sessionId) return false;
  return Number.isInteger(rawState.index) && rawState.index >= 0;
}

/**
 * Reconstructs a navigation frame from a persisted `history.state` entry.
 * @param {object} rawState
 * @param {string} url
 * @returns {object}
 */
export function frameFromHistoryState(rawState, url) {
  let key = rawState.screen || 'home';
  if (rawState.layerId) {
    key = `layer:${rawState.layerId}`;
  } else if (rawState.screen === 'event' && rawState.eventCode) {
    key = `event:${rawState.eventCode}`;
  } else if (rawState.screen === 'detail' && rawState.detailKind) {
    key = `detail:${rawState.detailKind}:${rawState.detailId}`;
  }
  return {
    key,
    screen: rawState.screen,
    url,
    eventCode: rawState.eventCode || null,
    detailKind: rawState.detailKind || null,
    detailId: rawState.detailId ?? null,
    layerId: rawState.layerId || null,
  };
}

/**
 * Computes the ordered stack of screen frames from current React navigation state.
 * @param {object} params
 * @param {string} [params.basePath]
 * @param {'home' | 'event'} [params.baseEntryKind]
 * @param {string | null} [params.eventCode]
 * @param {string | number | null} [params.selectedExpenseId]
 * @param {string | number | null} [params.selectedSettlementId]
 * @param {boolean} [params.isAddExpenseOpen]
 * @param {boolean} [params.isDonateOpen]
 * @param {boolean} [params.isProfileOpen]
 * @returns {Array<object>}
 */
export function computeScreenStack({
  basePath = '',
  baseEntryKind = 'home',
  eventCode = null,
  selectedExpenseId = null,
  selectedSettlementId = null,
  isAddExpenseOpen = false,
  isDonateOpen = false,
  isProfileOpen = false,
}) {
  const homeUrl = buildHomePath(basePath);
  const homeFrame = {
    key: 'home',
    screen: 'home',
    url: homeUrl,
    eventCode: null,
    detailKind: null,
    detailId: null,
    layerId: null,
  };

  const stack = [];
  let currentUrl = homeUrl;
  let activeEventCode = null;

  if (eventCode) {
    activeEventCode = eventCode;
    currentUrl = buildEventPath(basePath, eventCode);
    if (baseEntryKind !== 'event') {
      stack.push(homeFrame);
    }
    stack.push({
      key: `event:${eventCode}`,
      screen: 'event',
      url: currentUrl,
      eventCode,
      detailKind: null,
      detailId: null,
      layerId: null,
    });

    if (selectedExpenseId != null) {
      stack.push({
        key: `detail:expense:${selectedExpenseId}`,
        screen: 'detail',
        url: currentUrl,
        eventCode,
        detailKind: 'expense',
        detailId: selectedExpenseId,
        layerId: null,
      });
    } else if (selectedSettlementId != null) {
      stack.push({
        key: `detail:settlement:${selectedSettlementId}`,
        screen: 'detail',
        url: currentUrl,
        eventCode,
        detailKind: 'settlement',
        detailId: selectedSettlementId,
        layerId: null,
      });
    }

    if (isAddExpenseOpen) {
      const top = stack[stack.length - 1];
      stack.push({
        key: 'expense-form',
        screen: 'expense-form',
        url: currentUrl,
        eventCode,
        detailKind: top?.detailKind || null,
        detailId: top?.detailId ?? null,
        layerId: null,
      });
    }
  } else {
    stack.push(homeFrame);
  }

  if (isDonateOpen) {
    const top = stack[stack.length - 1];
    stack.push({
      key: 'donate',
      screen: 'donate',
      url: currentUrl,
      eventCode: activeEventCode,
      detailKind: top?.detailKind || null,
      detailId: top?.detailId ?? null,
      layerId: null,
    });
  }

  if (isProfileOpen) {
    const top = stack[stack.length - 1];
    stack.push({
      key: 'profile',
      screen: 'profile',
      url: currentUrl,
      eventCode: activeEventCode,
      detailKind: top?.detailKind || null,
      detailId: top?.detailId ?? null,
      layerId: null,
    });
  }

  return stack;
}

/**
 * Appends active overlay/modal layers on top of the screen stack in priority/activation order.
 * @param {Array<object>} screenStack
 * @param {Array<{ id: string, priority?: number, seq?: number }>} [activeLayers]
 * @returns {Array<object>}
 */
export function computeFullNavStack(screenStack, activeLayers = []) {
  if (!activeLayers.length) return screenStack;
  const top = screenStack[screenStack.length - 1];
  const sorted = [...activeLayers].sort((a, b) => {
    const pDiff = (a.priority ?? 10) - (b.priority ?? 10);
    if (pDiff !== 0) return pDiff;
    return (a.seq ?? 0) - (b.seq ?? 0);
  });

  const layerFrames = sorted.map((layer) => ({
    key: `layer:${layer.id}`,
    screen: top.screen,
    url: top.url,
    eventCode: top.eventCode || null,
    detailKind: top.detailKind || null,
    detailId: top.detailId ?? null,
    layerId: layer.id,
  }));

  return [...screenStack, ...layerFrames];
}

/**
 * Compares two navigation frames for identity equivalence.
 * @param {object | undefined} a
 * @param {object | undefined} b
 * @returns {boolean}
 */
export function framesEqual(a, b) {
  if (!a || !b) return false;
  return (
    a.key === b.key &&
    a.url === b.url &&
    a.screen === b.screen &&
    (a.eventCode || null) === (b.eventCode || null) &&
    (a.detailKind || null) === (b.detailKind || null) &&
    (a.detailId ?? null) === (b.detailId ?? null) &&
    (a.layerId || null) === (b.layerId || null)
  );
}

/**
 * Computes the minimal History API operation needed to reconcile `committedFrames` to `desiredFrames`.
 * @param {Array<object>} committedFrames
 * @param {Array<object>} desiredFrames
 * @returns {object}
 */
export function planHistoryReconciliation(committedFrames, desiredFrames) {
  if (!desiredFrames.length) return { type: 'noop' };

  if (!committedFrames.length) {
    if (desiredFrames.length === 1) {
      return { type: 'replace', index: 0, frame: desiredFrames[0] };
    }
    return {
      type: 'replace-and-push',
      replaceIndex: 0,
      replaceFrame: desiredFrames[0],
      startIndex: 1,
      pushFrames: desiredFrames.slice(1),
    };
  }

  const cLen = committedFrames.length;
  const dLen = desiredFrames.length;
  const cLast = cLen - 1;
  const dLast = dLen - 1;

  let commonLen = 0;
  while (commonLen < cLen && commonLen < dLen && framesEqual(committedFrames[commonLen], desiredFrames[commonLen])) {
    commonLen += 1;
  }

  if (dLast < cLast) {
    return {
      type: 'back',
      delta: dLast - cLast,
      targetIndex: dLast,
    };
  }

  if (dLast === cLast) {
    if (commonLen === dLen) return { type: 'noop' };
    if (commonLen < cLast) {
      const targetIndex = Math.min(cLast - 1, commonLen);
      return {
        type: 'back',
        delta: targetIndex - cLast,
        targetIndex,
      };
    }
    return {
      type: 'replace',
      index: dLast,
      frame: desiredFrames[dLast],
    };
  }

  // dLast > cLast
  if (commonLen === cLen) {
    return {
      type: 'push',
      startIndex: cLen,
      frames: desiredFrames.slice(cLen),
    };
  }

  if (commonLen === cLast) {
    return {
      type: 'replace-and-push',
      replaceIndex: cLast,
      replaceFrame: desiredFrames[cLast],
      startIndex: cLen,
      pushFrames: desiredFrames.slice(cLen),
    };
  }

  const targetIndex = Math.min(cLast - 1, commonLen);
  return {
    type: 'back',
    delta: targetIndex - cLast,
    targetIndex,
  };
}

/**
 * Resolves the UI action corresponding to a single backward `popstate` step.
 * @param {object} params
 * @param {Array<object>} params.currentFrames
 * @param {number} params.targetIndex
 * @returns {{ action: string, layerId?: string }}
 */
export function resolveBackStep({ currentFrames, targetIndex }) {
  if (!Array.isArray(currentFrames) || targetIndex >= currentFrames.length - 1) {
    return { action: 'noop' };
  }
  const popped = currentFrames[currentFrames.length - 1];
  if (!popped) return { action: 'noop' };
  if (popped.layerId) {
    return { action: 'close-layer', layerId: popped.layerId };
  }
  if (popped.screen === 'profile') return { action: 'close-profile' };
  if (popped.screen === 'donate') return { action: 'close-donate' };
  if (popped.screen === 'expense-form') return { action: 'close-expense-form' };
  if (popped.screen === 'detail') return { action: 'close-detail' };
  if (popped.screen === 'event') return { action: 'leave-event' };
  return { action: 'noop' };
}
