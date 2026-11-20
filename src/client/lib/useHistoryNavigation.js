import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import {
  buildHistoryState,
  computeFullNavStack,
  frameFromHistoryState,
  isAppHistoryState,
  planHistoryReconciliation,
  resolveBackStep,
} from '../../domain/navigationHistory.js';

const activeLayers = new Map();
const layerListeners = new Set();
const EMPTY_LAYERS = [];
let layersSnapshot = EMPTY_LAYERS;
let nextLayerSeq = 1;

function emitLayersChange() {
  layersSnapshot = activeLayers.size ? Array.from(activeLayers.values()) : EMPTY_LAYERS;
  for (const listener of layerListeners) {
    listener();
  }
}

function subscribeLayers(listener) {
  layerListeners.add(listener);
  return () => layerListeners.delete(listener);
}

function getLayersSnapshot() {
  return layersSnapshot;
}

function getEmptyLayersSnapshot() {
  return EMPTY_LAYERS;
}

function registerLayer(id, priority, onBack) {
  const existing = activeLayers.get(id);
  activeLayers.set(id, {
    id,
    priority,
    seq: existing ? existing.seq : nextLayerSeq++,
    onBack,
  });
  emitLayersChange();
}

function unregisterLayer(id) {
  if (!activeLayers.has(id)) return;
  activeLayers.delete(id);
  emitLayersChange();
}

function triggerLayerBack(id) {
  const layer = activeLayers.get(id);
  layer?.onBack?.();
}

function triggerAllLayersBack() {
  const ordered = [...activeLayers.values()].sort((a, b) => {
    const pDiff = (b.priority ?? 10) - (a.priority ?? 10);
    if (pDiff !== 0) return pDiff;
    return (b.seq ?? 0) - (a.seq ?? 0);
  });
  for (const layer of ordered) {
    layer.onBack?.();
  }
}

function createSessionId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Registers a modal, dialog, or menu overlay on the shared back-navigation stack.
 * When the user presses Android/browser Back while this layer is topmost, `onBack` runs.
 * @param {string} id Unique layer identifier.
 * @param {boolean} isOpen Whether the layer is currently open and dismissible.
 * @param {() => void} onBack Callback invoked when system Back dismisses this layer.
 * @param {{ priority?: number }} [options] Optional priority (higher stays on top).
 */
export function useBackLayer(id, isOpen, onBack, options = {}) {
  const priority = options?.priority ?? 10;
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    if (!isOpen || !id) return undefined;
    registerLayer(id, priority, () => onBackRef.current?.());
    return () => unregisterLayer(id);
  }, [id, isOpen, priority]);
}

/**
 * Synchronizes React navigation state and active overlay layers with `window.history`.
 * Ensures Android hardware/gesture Back and browser Back mirror header/modal back actions.
 * @param {object} params
 * @param {boolean} params.enabled
 * @param {Array<object>} params.screenStack
 * @param {(step: { action: string, layerId?: string }) => void} params.onStepBack
 * @param {(state: object) => void} params.onRestoreState
 * @param {(pathname: string, state: unknown) => void} params.onExternalUrlChange
 */
export function useHistoryNavigation({
  enabled,
  screenStack,
  onStepBack,
  onRestoreState,
  onExternalUrlChange,
}) {
  const activeLayerList = useSyncExternalStore(
    subscribeLayers,
    getLayersSnapshot,
    getEmptyLayersSnapshot
  );

  const desiredFrames = useMemo(
    () => computeFullNavStack(screenStack, activeLayerList),
    [screenStack, activeLayerList]
  );

  const sessionIdRef = useRef(null);
  if (!sessionIdRef.current) {
    sessionIdRef.current = createSessionId();
  }

  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const desiredFramesRef = useRef(desiredFrames);
  desiredFramesRef.current = desiredFrames;

  const initializedRef = useRef(false);
  const committedFramesRef = useRef([]);
  const inFlightBackRef = useRef(null);

  const onStepBackRef = useRef(onStepBack);
  onStepBackRef.current = onStepBack;

  const onRestoreStateRef = useRef(onRestoreState);
  onRestoreStateRef.current = onRestoreState;

  const onExternalUrlChangeRef = useRef(onExternalUrlChange);
  onExternalUrlChangeRef.current = onExternalUrlChange;

  const reconcile = useCallback(() => {
    if (typeof window === 'undefined' || !enabledRef.current) return;
    if (inFlightBackRef.current) return;

    const sessionId = sessionIdRef.current;
    const frames = desiredFramesRef.current;
    if (!frames.length) return;

    if (!initializedRef.current) {
      initializedRef.current = true;
      const rootFrame = frames[0];
      window.history.replaceState(
        buildHistoryState({ sessionId, index: 0, frame: rootFrame }),
        '',
        rootFrame.url
      );
      committedFramesRef.current = [rootFrame];
      if (frames.length === 1) return;
    }

    const plan = planHistoryReconciliation(committedFramesRef.current, frames);

    if (plan.type === 'noop') return;

    if (plan.type === 'replace') {
      window.history.replaceState(
        buildHistoryState({ sessionId, index: plan.index, frame: plan.frame }),
        '',
        plan.frame.url
      );
      committedFramesRef.current = frames;
      return;
    }

    if (plan.type === 'push') {
      for (let i = 0; i < plan.frames.length; i += 1) {
        const frame = plan.frames[i];
        window.history.pushState(
          buildHistoryState({ sessionId, index: plan.startIndex + i, frame }),
          '',
          frame.url
        );
      }
      committedFramesRef.current = frames;
      return;
    }

    if (plan.type === 'replace-and-push') {
      window.history.replaceState(
        buildHistoryState({ sessionId, index: plan.replaceIndex, frame: plan.replaceFrame }),
        '',
        plan.replaceFrame.url
      );
      for (let i = 0; i < plan.pushFrames.length; i += 1) {
        const frame = plan.pushFrames[i];
        window.history.pushState(
          buildHistoryState({ sessionId, index: plan.startIndex + i, frame }),
          '',
          frame.url
        );
      }
      committedFramesRef.current = frames;
      return;
    }

    if (plan.type === 'back') {
      const targetIndex = Math.max(0, plan.targetIndex);
      const timerId = window.setTimeout(() => {
        if (!inFlightBackRef.current) return;
        inFlightBackRef.current = null;
        committedFramesRef.current = committedFramesRef.current.slice(0, targetIndex + 1);
        reconcile();
      }, 250);
      inFlightBackRef.current = { targetIndex, timerId };
      window.history.go(plan.delta);
    }
  }, []);

  useEffect(() => {
    reconcile();
  }, [enabled, desiredFrames, reconcile]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const handlePopState = (event) => {
      const sessionId = sessionIdRef.current;
      const rawState = event.state;

      if (inFlightBackRef.current) {
        const { targetIndex, timerId } = inFlightBackRef.current;
        window.clearTimeout(timerId);
        inFlightBackRef.current = null;
        if (isAppHistoryState(rawState, sessionId)) {
          committedFramesRef.current = committedFramesRef.current.slice(0, rawState.index + 1);
        } else {
          committedFramesRef.current = committedFramesRef.current.slice(0, Math.max(1, targetIndex + 1));
        }
        reconcile();
        return;
      }

      if (!enabledRef.current) return;

      if (isAppHistoryState(rawState, sessionId)) {
        const prevFrames = committedFramesRef.current;
        const prevIndex = prevFrames.length - 1;
        const targetIndex = rawState.index;

        if (targetIndex < prevIndex) {
          committedFramesRef.current = prevFrames.slice(0, targetIndex + 1);
          if (prevIndex - targetIndex === 1) {
            const step = resolveBackStep({ currentFrames: prevFrames, targetIndex });
            if (step.action === 'close-layer') {
              triggerLayerBack(step.layerId);
            } else {
              onStepBackRef.current?.(step);
            }
          } else {
            triggerAllLayersBack();
            onRestoreStateRef.current?.(rawState);
          }
          return;
        }

        if (targetIndex > prevIndex) {
          // Browser Forward navigation: sync committed depth and restore screen state.
          const syntheticFrame = frameFromHistoryState(rawState, window.location.pathname);
          const padded = [...prevFrames];
          while (padded.length < targetIndex) {
            padded.push(syntheticFrame);
          }
          padded[targetIndex] = syntheticFrame;
          committedFramesRef.current = padded;
          onRestoreStateRef.current?.(rawState);
          return;
        }

        return;
      }

      // Navigated to an untagged or pre-session URL on the same origin.
      triggerAllLayersBack();
      committedFramesRef.current = [];
      onExternalUrlChangeRef.current?.(window.location.pathname, rawState);
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      if (inFlightBackRef.current) {
        window.clearTimeout(inFlightBackRef.current.timerId);
        inFlightBackRef.current = null;
      }
    };
  }, [reconcile]);
}
