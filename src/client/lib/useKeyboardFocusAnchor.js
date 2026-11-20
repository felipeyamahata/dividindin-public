import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createKeyboardFocusState,
  isKeyboardAnchored,
  isKeyboardInputField,
  reduceKeyboardFocusState,
} from '../../domain/keyboardFocus.js';

const ACTION_SELECTOR = 'button:not(:disabled), a[href], [role="button"], label, input[type="submit"]:not(:disabled), input[type="button"]:not(:disabled)';

/**
 * Coordinates mobile keyboard viewport sizing and focus anchoring with a tap-cycle lock
 * so tapping an action button while an input is focused cannot shift the button away
 * before click/submit fires.
 * @param {{ isOpen?: boolean, onBeforeAnchorChange?: () => void, tapReleaseDelayMs?: number }} [options]
 */
export function useKeyboardFocusAnchor({
  isOpen = true,
  onBeforeAnchorChange,
  tapReleaseDelayMs = 400,
} = {}) {
  const [focusState, setFocusState] = useState(createKeyboardFocusState);
  const [visibleHeight, setVisibleHeight] = useState(null);

  const stateRef = useRef(focusState);
  const containerRef = useRef(null);
  const blurRafRef = useRef(null);
  const releaseTimerRef = useRef(null);
  const beforeChangeRef = useRef(onBeforeAnchorChange);
  beforeChangeRef.current = onBeforeAnchorChange;

  const clearBlurRaf = useCallback(() => {
    if (blurRafRef.current) {
      cancelAnimationFrame(blurRafRef.current);
      blurRafRef.current = null;
    }
  }, []);

  const clearReleaseTimer = useCallback(() => {
    if (releaseTimerRef.current) {
      clearTimeout(releaseTimerRef.current);
      releaseTimerRef.current = null;
    }
  }, []);

  const dispatch = useCallback((action) => {
    const prev = stateRef.current;
    const next = reduceKeyboardFocusState(prev, action);
    if (next === prev) return;
    if (isKeyboardAnchored(prev) !== isKeyboardAnchored(next)) {
      beforeChangeRef.current?.();
    }
    stateRef.current = next;
    setFocusState(next);
  }, []);

  const releaseAnchor = useCallback(() => {
    clearBlurRaf();
    clearReleaseTimer();
    dispatch({ type: 'RESET' });
  }, [clearBlurRaf, clearReleaseTimer, dispatch]);

  useEffect(() => {
    if (!isOpen) {
      releaseAnchor();
      return undefined;
    }
    const viewport = window.visualViewport;
    if (!viewport) return undefined;
    const update = () => setVisibleHeight(viewport.height);
    update();
    viewport.addEventListener('resize', update);
    return () => viewport.removeEventListener('resize', update);
  }, [isOpen, releaseAnchor]);

  useEffect(() => {
    if (!focusState.isTapLocked) return undefined;

    const scheduleRelease = (delayMs) => {
      clearReleaseTimer();
      releaseTimerRef.current = setTimeout(() => {
        releaseTimerRef.current = null;
        dispatch({ type: 'ACTION_TAP_RELEASE' });
      }, delayMs);
    };

    const handlePointerEnd = () => scheduleRelease(tapReleaseDelayMs);
    const handleClick = () => scheduleRelease(0);

    window.addEventListener('pointerup', handlePointerEnd, true);
    window.addEventListener('pointercancel', handlePointerEnd, true);
    window.addEventListener('click', handleClick, false);

    return () => {
      window.removeEventListener('pointerup', handlePointerEnd, true);
      window.removeEventListener('pointercancel', handlePointerEnd, true);
      window.removeEventListener('click', handleClick, false);
    };
  }, [focusState.isTapLocked, tapReleaseDelayMs, clearReleaseTimer, dispatch]);

  useEffect(() => () => {
    clearBlurRaf();
    clearReleaseTimer();
  }, [clearBlurRaf, clearReleaseTimer]);

  const onFocusCapture = useCallback((event) => {
    containerRef.current = event.currentTarget;
    clearBlurRaf();
    if (isKeyboardInputField(event.target)) {
      dispatch({ type: 'FIELD_FOCUS' });
    }
  }, [clearBlurRaf, dispatch]);

  const onBlurCapture = useCallback((event) => {
    const container = event.currentTarget;
    containerRef.current = container;
    const related = event.relatedTarget;
    if (related && container.contains(related) && isKeyboardInputField(related)) {
      clearBlurRaf();
      dispatch({ type: 'FIELD_BLUR', nextFocusedIsField: true });
      return;
    }
    clearBlurRaf();
    blurRafRef.current = requestAnimationFrame(() => {
      blurRafRef.current = null;
      const active = document.activeElement;
      const stillInside = Boolean(
        containerRef.current &&
        active &&
        containerRef.current.contains(active) &&
        isKeyboardInputField(active)
      );
      dispatch({ type: 'FIELD_BLUR', nextFocusedIsField: stillInside });
    });
  }, [clearBlurRaf, dispatch]);

  const onPointerDownCapture = useCallback((event) => {
    containerRef.current = event.currentTarget;
    if (!isKeyboardAnchored(stateRef.current)) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target || isKeyboardInputField(target)) return;
    if (target.closest(ACTION_SELECTOR)) {
      clearReleaseTimer();
      dispatch({ type: 'ACTION_POINTER_DOWN' });
    }
  }, [clearReleaseTimer, dispatch]);

  return {
    isAnchored: isKeyboardAnchored(focusState),
    visibleHeight,
    containerProps: {
      onFocusCapture,
      onBlurCapture,
      onPointerDownCapture,
    },
    releaseAnchor,
  };
}
