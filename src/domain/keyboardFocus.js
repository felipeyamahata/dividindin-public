const NON_KEYBOARD_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

/**
 * Determines whether a DOM-like target element opens an on-screen keyboard when focused.
 * @param {{ tagName?: string, type?: string } | null | undefined} target
 * @returns {boolean}
 */
export function isKeyboardInputField(target) {
  if (!target || typeof target.tagName !== 'string') return false;
  const tag = target.tagName.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const type = String(target.type || 'text').toLowerCase();
  return !NON_KEYBOARD_INPUT_TYPES.has(type);
}

/**
 * Creates the initial keyboard focus anchor state.
 * @returns {{ hasFocusedField: boolean, isTapLocked: boolean }}
 */
export function createKeyboardFocusState() {
  return { hasFocusedField: false, isTapLocked: false };
}

/**
 * Returns true while the modal/card should stay anchored at the top for mobile keyboard ergonomics.
 * @param {{ hasFocusedField?: boolean, isTapLocked?: boolean } | null | undefined} state
 * @returns {boolean}
 */
export function isKeyboardAnchored(state) {
  return Boolean(state?.hasFocusedField || state?.isTapLocked);
}

/**
 * Pure reducer managing keyboard focus anchoring and tap-cycle locking so mobile blur
 * cannot shift an action button away before click/submit fires.
 * @param {{ hasFocusedField: boolean, isTapLocked: boolean }} state
 * @param {{ type: 'FIELD_FOCUS' | 'FIELD_BLUR' | 'ACTION_POINTER_DOWN' | 'ACTION_TAP_RELEASE' | 'RESET', nextFocusedIsField?: boolean }} event
 * @returns {{ hasFocusedField: boolean, isTapLocked: boolean }}
 */
export function reduceKeyboardFocusState(state, event) {
  const current = state || createKeyboardFocusState();
  switch (event?.type) {
    case 'FIELD_FOCUS':
      return current.hasFocusedField ? current : { ...current, hasFocusedField: true };
    case 'FIELD_BLUR': {
      const nextFocused = Boolean(event.nextFocusedIsField);
      return current.hasFocusedField === nextFocused ? current : { ...current, hasFocusedField: nextFocused };
    }
    case 'ACTION_POINTER_DOWN':
      return isKeyboardAnchored(current) && !current.isTapLocked
        ? { ...current, isTapLocked: true }
        : current;
    case 'ACTION_TAP_RELEASE':
      return current.isTapLocked ? { ...current, isTapLocked: false } : current;
    case 'RESET':
      return !current.hasFocusedField && !current.isTapLocked ? current : createKeyboardFocusState();
    default:
      return current;
  }
}
