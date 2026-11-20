let supportsDisplayTransition;

/**
 * Probes whether discrete CSS `display` transitions actually keep an element visible.
 * Avoids relying solely on CSS.supports() due to Firefox bug 1882408.
 * @returns {boolean}
 */
function canTransitionDisplay() {
  if (supportsDisplayTransition !== undefined) return supportsDisplayTransition;
  if (typeof window === 'undefined' || !window.CSS?.supports?.('transition-behavior', 'allow-discrete') || !document.body) {
    return false;
  }
  const probe = document.createElement('div');
  probe.style.cssText = 'transition: display 1s allow-discrete !important; display: block;';
  document.body.appendChild(probe);
  getComputedStyle(probe).display;
  probe.style.display = 'none';
  supportsDisplayTransition = getComputedStyle(probe).display === 'block';
  probe.remove();
  return supportsDisplayTransition;
}

function supportsTopLayerExit() {
  return typeof window !== 'undefined' && Boolean(window.CSS?.supports?.('overlay', 'auto')) && canTransitionDisplay();
}

async function runTopLayerExit(element, busy, closeFn) {
  if (!element || busy) return;
  const reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!supportsTopLayerExit() && !reducedMotion) {
    if (element.hasAttribute('data-closing')) return;
    element.setAttribute('data-closing', '');
    const animations = element.getAnimations({ subtree: true });
    if (animations.length > 0) {
      await Promise.race([
        Promise.allSettled(animations.map((a) => a.finished)),
        new Promise((resolve) => setTimeout(resolve, 600)),
      ]);
    }
    if (!element.hasAttribute('data-closing')) return;
    element.removeAttribute('data-closing');
  }
  closeFn();
}

/**
 * Closes a modal <dialog> cleanly while preserving top-layer exit transitions on Safari and Firefox.
 * @param {HTMLDialogElement | null} dialog
 * @param {boolean} [busy]
 */
export async function closeAnimatedDialog(dialog, busy = false) {
  if (!dialog || !dialog.open) return;
  await runTopLayerExit(dialog, busy, () => {
    if (dialog.open) dialog.close();
  });
}

/**
 * Closes a [popover] element cleanly while preserving top-layer exit transitions on Safari and Firefox.
 * @param {HTMLElement | null} popover
 * @param {boolean} [busy]
 */
export async function closeAnimatedPopover(popover, busy = false) {
  if (!popover || !popover.matches?.(':popover-open')) return;
  await runTopLayerExit(popover, busy, () => {
    if (popover.matches?.(':popover-open')) popover.hidePopover();
  });
}

function isOutsideRect(event, element) {
  const rect = element.getBoundingClientRect();
  return (
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom
  );
}

/**
 * Polyfills light-dismiss (`closedby="any"`) in browsers without native HTMLDialogElement.closedBy.
 * Requires both pointerdown and pointerup outside the dialog box so text-selection drags never dismiss.
 * @param {HTMLDialogElement} dialog
 * @param {() => boolean} getBusy
 * @param {() => void} onDismiss
 * @returns {() => void}
 */
export function attachDialogOutsideFallback(dialog, getBusy, onDismiss) {
  if ('closedBy' in HTMLDialogElement.prototype) return () => {};
  let pressedOutside = false;
  const onPointerDown = (event) => {
    pressedOutside = isOutsideRect(event, dialog);
  };
  const onPointerUp = (event) => {
    const releasedOutside = pressedOutside && isOutsideRect(event, dialog);
    pressedOutside = false;
    if (releasedOutside && !getBusy()) onDismiss();
  };
  dialog.addEventListener('pointerdown', onPointerDown);
  dialog.addEventListener('pointerup', onPointerUp);
  return () => {
    dialog.removeEventListener('pointerdown', onPointerDown);
    dialog.removeEventListener('pointerup', onPointerUp);
  };
}

function legacyCopy(text, container) {
  const host = container?.isConnected ? container : document.body;
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.setAttribute('aria-hidden', 'true');
  field.tabIndex = -1;
  field.style.cssText =
    'position:fixed;inset-block-start:0;inset-inline-start:0;width:1px;height:1px;padding:0;border:0;opacity:0.001;pointer-events:none;font-size:16px;';
  host.append(field);
  try {
    // Modal <dialog> makes document.body inert, so the temporary field must live inside the open dialog to receive selection.
    field.focus({ preventScroll: true });
    field.select();
    field.setSelectionRange(0, text.length);
    if (document.activeElement !== field) {
      return false;
    }
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    field.remove();
    previousFocus?.focus({ preventScroll: true });
  }
}

/**
 * Copies text with the Async Clipboard API and synchronous execCommand fallback for non-HTTPS origins.
 * Pass the open modal <dialog> as container so top-layer inertness does not block selection.
 * @param {string} text
 * @param {HTMLElement | null} [container]
 * @returns {Promise<boolean>}
 */
export async function copyTextToClipboard(text, container = null) {
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to synchronous copy attempt inside user gesture.
  }
  return legacyCopy(text, container);
}
