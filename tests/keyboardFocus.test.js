import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createKeyboardFocusState,
  isKeyboardAnchored,
  isKeyboardInputField,
  reduceKeyboardFocusState,
} from '../src/domain/keyboardFocus.js';

test('isKeyboardInputField identifies text/select controls and excludes buttons/radios', () => {
  assert.equal(isKeyboardInputField({ tagName: 'INPUT', type: 'text' }), true);
  assert.equal(isKeyboardInputField({ tagName: 'input', type: 'password' }), true);
  assert.equal(isKeyboardInputField({ tagName: 'INPUT' }), true);
  assert.equal(isKeyboardInputField({ tagName: 'TEXTAREA' }), true);
  assert.equal(isKeyboardInputField({ tagName: 'SELECT' }), true);

  assert.equal(isKeyboardInputField({ tagName: 'INPUT', type: 'radio' }), false);
  assert.equal(isKeyboardInputField({ tagName: 'INPUT', type: 'checkbox' }), false);
  assert.equal(isKeyboardInputField({ tagName: 'INPUT', type: 'submit' }), false);
  assert.equal(isKeyboardInputField({ tagName: 'BUTTON' }), false);
  assert.equal(isKeyboardInputField({ tagName: 'DIV' }), false);
  assert.equal(isKeyboardInputField(null), false);
});

test('reduceKeyboardFocusState keeps container anchored across pointerdown -> blur -> tap release', () => {
  let state = createKeyboardFocusState();
  assert.equal(isKeyboardAnchored(state), false);

  state = reduceKeyboardFocusState(state, { type: 'FIELD_FOCUS' });
  assert.equal(isKeyboardAnchored(state), true);

  // Tapping an action button locks anchor before input blur occurs
  state = reduceKeyboardFocusState(state, { type: 'ACTION_POINTER_DOWN' });
  assert.equal(state.isTapLocked, true);
  assert.equal(isKeyboardAnchored(state), true);

  // Input loses focus during the tap; anchor must remain locked until click/release finishes
  state = reduceKeyboardFocusState(state, { type: 'FIELD_BLUR', nextFocusedIsField: false });
  assert.equal(state.hasFocusedField, false);
  assert.equal(state.isTapLocked, true);
  assert.equal(isKeyboardAnchored(state), true);

  // Once the tap completes, anchor releases cleanly
  state = reduceKeyboardFocusState(state, { type: 'ACTION_TAP_RELEASE' });
  assert.equal(isKeyboardAnchored(state), false);
});

test('reduceKeyboardFocusState handles field-to-field focus, external blur, and unanchored taps', () => {
  let state = createKeyboardFocusState();

  // Tapping a button while unanchored should not lock anything
  state = reduceKeyboardFocusState(state, { type: 'ACTION_POINTER_DOWN' });
  assert.equal(state.isTapLocked, false);
  assert.equal(isKeyboardAnchored(state), false);

  state = reduceKeyboardFocusState(state, { type: 'FIELD_FOCUS' });
  // Moving directly to another keyboard field keeps anchor active
  state = reduceKeyboardFocusState(state, { type: 'FIELD_BLUR', nextFocusedIsField: true });
  assert.equal(isKeyboardAnchored(state), true);

  // External blur (e.g. keyboard Done / tap outside) releases anchor immediately
  state = reduceKeyboardFocusState(state, { type: 'FIELD_BLUR', nextFocusedIsField: false });
  assert.equal(isKeyboardAnchored(state), false);

  // Reset clears both flags
  state = reduceKeyboardFocusState({ hasFocusedField: true, isTapLocked: true }, { type: 'RESET' });
  assert.deepEqual(state, { hasFocusedField: false, isTapLocked: false });
});
