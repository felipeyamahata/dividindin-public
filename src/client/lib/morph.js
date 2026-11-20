const MORPH_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

export function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function captureAvatarSnapshot(element) {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  return {
    rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    cloneNode: element.cloneNode(true),
  };
}

export const captureBrandMarkSnapshot = captureAvatarSnapshot;

const DEFAULT_AVATAR_HEADER_STYLES = {
  backgroundColor: '#1c1c1b',
  boxShadow: 'inset 0 0 0 2.5px #55554f',
};

const DEFAULT_AVATAR_TARGET_STYLES = {
  backgroundColor: '#272923',
  boxShadow: 'inset 0 0 0 0px transparent',
};

/**
 * Animates a fixed circular clone between header and subpage target rects (FLIP) without clipping.
 */
export function launchCircleFlight({
  cloneNode,
  hideTargetEl,
  fromRect,
  toRect,
  duration = 400,
  direction = 'forward',
  headerStyles = DEFAULT_AVATAR_HEADER_STYLES,
  targetStyles = DEFAULT_AVATAR_TARGET_STYLES,
  onFinish,
}) {
  if (!cloneNode || !fromRect || !toRect || !fromRect.width || !toRect.width || prefersReducedMotion()) {
    onFinish?.();
    return () => {};
  }

  const baseRect = direction === 'forward' ? toRect : fromRect;
  const otherRect = direction === 'forward' ? fromRect : toRect;
  const scaleX = otherRect.width / baseRect.width;
  const scaleY = otherRect.height / baseRect.height;
  const dx = (otherRect.left + otherRect.width / 2) - (baseRect.left + baseRect.width / 2);
  const dy = (otherRect.top + otherRect.height / 2) - (baseRect.top + baseRect.height / 2);

  const flight = cloneNode;
  flight.classList.add('avatar-flight-clone');
  Object.assign(flight.style, {
    position: 'fixed',
    left: `${baseRect.left}px`,
    top: `${baseRect.top}px`,
    width: `${baseRect.width}px`,
    height: `${baseRect.height}px`,
    margin: '0',
    zIndex: '40',
    pointerEvents: 'none',
    transformOrigin: 'center center',
    willChange: 'transform',
  });

  if (hideTargetEl) hideTargetEl.style.opacity = '0';
  document.body.appendChild(flight);

  const headerKeyframe = {
    transform: `translate(${dx}px, ${dy}px) scale(${scaleX}, ${scaleY})`,
    ...headerStyles,
  };
  const targetKeyframe = {
    transform: 'translate(0px, 0px) scale(1, 1)',
    ...targetStyles,
  };

  const keyframes = direction === 'forward'
    ? [headerKeyframe, targetKeyframe]
    : [targetKeyframe, headerKeyframe];

  const animation = flight.animate(keyframes, {
    duration,
    easing: MORPH_EASING,
    fill: 'forwards',
  });

  let cleaned = false;
  let canceled = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    flight.remove();
    if (hideTargetEl) hideTargetEl.style.opacity = '';
  };

  animation.onfinish = () => {
    cleanup();
    if (!canceled) onFinish?.();
  };

  return () => {
    canceled = true;
    animation.cancel();
    cleanup();
  };
}

export const launchAvatarFlight = launchCircleFlight;

const RECEIPT_TOOTH_TOP = 'conic-gradient(from 135deg at 50% 0%, var(--receipt-bg) 90deg, transparent 0)';
const RECEIPT_TOOTH_BOTTOM = 'conic-gradient(from -45deg at 50% 100%, var(--receipt-bg) 90deg, transparent 0)';

function createReceiptEdge(position, bgColor) {
  const edge = document.createElement('div');
  edge.className = `receipt-morph__edge receipt-morph__edge--${position}`;
  edge.style.setProperty('--receipt-bg', bgColor);
  edge.style.backgroundImage = position === 'top' ? RECEIPT_TOOTH_TOP : RECEIPT_TOOTH_BOTTOM;
  return edge;
}

export function captureExpenseBubbleSnapshot(element, { expenseId, isOwn, scrollTop = 0 }) {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const computed = window.getComputedStyle(element);
  const contentScope = document.createElement('div');
  contentScope.className = `receipt-morph__bubble-scope expense-feed__item${isOwn ? ' expense-feed__item--own' : ''}`;
  const bubbleClone = element.cloneNode(true);
  bubbleClone.classList.add('receipt-morph__bubble-inner');
  bubbleClone.removeAttribute('data-expense-id');
  bubbleClone.removeAttribute('aria-label');
  bubbleClone.setAttribute('tabindex', '-1');
  contentScope.appendChild(bubbleClone);

  return {
    expenseId,
    isOwn: Boolean(isOwn),
    scrollTop,
    rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    borderRadius: computed.borderRadius || '18px',
    backgroundColor: computed.backgroundColor || (isOwn ? 'rgb(216, 255, 53)' : 'rgb(25, 25, 25)'),
    bubbleContentNode: contentScope,
  };
}

/**
 * Animates a shared surface morph between a feed expense bubble and the thermal receipt viewport.
 */
export function launchReceiptMorph({
  direction = 'forward',
  fromRect,
  toRect,
  fromRadius,
  toRadius,
  fromBackground,
  toBackground,
  bubbleContentNode,
  receiptContentNode,
  receiptScrollTop = 0,
  hideTargetEl,
  duration = 380,
  onFinish,
}) {
  if (!fromRect || !toRect || !fromRect.width || !toRect.width || prefersReducedMotion()) {
    onFinish?.();
    return () => {};
  }

  const flight = document.createElement('div');
  flight.className = 'receipt-morph__flight';
  flight.setAttribute('aria-hidden', 'true');
  flight.inert = true;

  const isForward = direction === 'forward';
  const paperBg = isForward ? toBackground : fromBackground;

  Object.assign(flight.style, {
    position: 'fixed',
    left: `${fromRect.left}px`,
    top: `${fromRect.top}px`,
    width: `${fromRect.width}px`,
    height: `${fromRect.height}px`,
    borderRadius: fromRadius,
    backgroundColor: fromBackground,
    border: `1px solid ${isForward ? 'rgba(60, 60, 57, 1)' : 'rgba(60, 60, 57, 0)'}`,
    zIndex: '35',
    pointerEvents: 'none',
    boxSizing: 'border-box',
  });

  const topEdge = createReceiptEdge('top', paperBg);
  const bottomEdge = createReceiptEdge('bottom', paperBg);
  topEdge.style.opacity = isForward ? '0' : '1';
  bottomEdge.style.opacity = isForward ? '0' : '1';
  flight.appendChild(topEdge);
  flight.appendChild(bottomEdge);

  const stageClip = document.createElement('div');
  stageClip.className = 'receipt-morph__clip';
  flight.appendChild(stageClip);

  let bubbleLayer = null;
  if (bubbleContentNode) {
    bubbleLayer = document.createElement('div');
    bubbleLayer.className = 'receipt-morph__layer';
    bubbleLayer.style.opacity = isForward ? '1' : '0';
    bubbleLayer.style.height = `${isForward ? fromRect.height : toRect.height}px`;
    bubbleLayer.style.bottom = 'auto';
    bubbleLayer.appendChild(bubbleContentNode.cloneNode(true));
    stageClip.appendChild(bubbleLayer);
  }

  let receiptLayer = null;
  if (!isForward && receiptContentNode) {
    receiptLayer = document.createElement('div');
    receiptLayer.className = 'receipt-morph__layer receipt-morph__layer--receipt';
    const receiptCopy = receiptContentNode.cloneNode(true);
    receiptCopy.style.width = `${fromRect.width}px`;
    receiptCopy.style.marginTop = `-${receiptScrollTop}px`;
    receiptLayer.appendChild(receiptCopy);
    stageClip.appendChild(receiptLayer);
  }

  if (hideTargetEl) hideTargetEl.style.opacity = '0';
  document.body.appendChild(flight);

  const animations = [];
  animations.push(
    flight.animate(
      [
        {
          left: `${fromRect.left}px`,
          top: `${fromRect.top}px`,
          width: `${fromRect.width}px`,
          height: `${fromRect.height}px`,
          borderRadius: fromRadius,
          backgroundColor: fromBackground,
          borderColor: isForward ? 'rgba(60, 60, 57, 1)' : 'rgba(60, 60, 57, 0)',
        },
        {
          left: `${toRect.left}px`,
          top: `${toRect.top}px`,
          width: `${toRect.width}px`,
          height: `${toRect.height}px`,
          borderRadius: toRadius,
          backgroundColor: toBackground,
          borderColor: isForward ? 'rgba(60, 60, 57, 0)' : 'rgba(60, 60, 57, 1)',
        },
      ],
      { duration, easing: MORPH_EASING, fill: 'forwards' }
    )
  );

  if (isForward) {
    if (bubbleLayer) {
      animations.push(
        bubbleLayer.animate(
          [
            { opacity: 1, transform: 'scale(1)' },
            { opacity: 0, transform: 'scale(0.97)' },
          ],
          { duration: 140, easing: 'ease-out', fill: 'forwards' }
        )
      );
    }
    const edgeDelay = Math.max(0, duration - 170);
    const edgeDur = duration - edgeDelay;
    [topEdge, bottomEdge].forEach(edge => {
      animations.push(
        edge.animate(
          [{ opacity: 0 }, { opacity: 1 }],
          { delay: edgeDelay, duration: edgeDur, easing: 'ease-out', fill: 'forwards' }
        )
      );
    });
  } else {
    if (receiptLayer) {
      animations.push(
        receiptLayer.animate(
          [{ opacity: 1 }, { opacity: 0 }],
          { duration: 130, easing: 'ease-out', fill: 'forwards' }
        )
      );
    }
    [topEdge, bottomEdge].forEach(edge => {
      animations.push(
        edge.animate(
          [{ opacity: 1 }, { opacity: 0 }],
          { duration: 130, easing: 'ease-out', fill: 'forwards' }
        )
      );
    });
    if (bubbleLayer) {
      const bubbleDelay = Math.max(0, duration - 150);
      animations.push(
        bubbleLayer.animate(
          [
            { opacity: 0, transform: 'scale(0.97)' },
            { opacity: 1, transform: 'scale(1)' },
          ],
          { delay: bubbleDelay, duration: 150, easing: MORPH_EASING, fill: 'forwards' }
        )
      );
    }
  }

  let cleaned = false;
  let canceled = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    flight.remove();
    if (hideTargetEl) hideTargetEl.style.opacity = '';
  };

  animations[0].onfinish = () => {
    cleanup();
    if (!canceled) onFinish?.();
  };

  return () => {
    canceled = true;
    animations.forEach(anim => anim.cancel());
    cleanup();
  };
}

/**
 * Animates the DDD brand mark SVG between header and loading overlay rects (FLIP).
 */
export function launchBrandMarkFlight({
  cloneNode,
  hideTargetEl,
  fromRect,
  toRect,
  duration = 340,
  color = '#d8ff36',
  onFinish,
}) {
  if (!cloneNode || !fromRect || !toRect || !fromRect.width || !toRect.width || prefersReducedMotion()) {
    onFinish?.();
    return () => {};
  }

  const scaleX = fromRect.width / toRect.width;
  const scaleY = fromRect.height / toRect.height;
  const dx = (fromRect.left + fromRect.width / 2) - (toRect.left + toRect.width / 2);
  const dy = (fromRect.top + fromRect.height / 2) - (toRect.top + toRect.height / 2);

  const flight = cloneNode;
  flight.querySelectorAll?.('.brand-mark__d').forEach((node) => {
    node.classList.remove('brand-mark__d', 'brand-mark__d--1', 'brand-mark__d--2', 'brand-mark__d--3');
  });
  Object.assign(flight.style, {
    position: 'fixed',
    left: `${toRect.left}px`,
    top: `${toRect.top}px`,
    width: `${toRect.width}px`,
    height: `${toRect.height}px`,
    margin: '0',
    zIndex: '70',
    color,
    pointerEvents: 'none',
    transformOrigin: 'center center',
    willChange: 'transform',
  });

  if (hideTargetEl) hideTargetEl.style.opacity = '0';
  document.body.appendChild(flight);

  const animation = flight.animate(
    [
      { transform: `translate(${dx}px, ${dy}px) scale(${scaleX}, ${scaleY})` },
      { transform: 'translate(0px, 0px) scale(1, 1)' },
    ],
    {
      duration,
      easing: MORPH_EASING,
      fill: 'forwards',
    }
  );

  let cleaned = false;
  let canceled = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    flight.remove();
    if (hideTargetEl) hideTargetEl.style.opacity = '';
  };

  animation.onfinish = () => {
    cleanup();
    if (!canceled) onFinish?.();
  };

  return () => {
    canceled = true;
    animation.cancel();
    cleanup();
  };
}
