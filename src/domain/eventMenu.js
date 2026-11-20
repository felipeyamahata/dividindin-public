/**
 * Pure domain helpers for event card menu permissions and viewport-aware anchoring.
 */

export function isEventCreator(event, user) {
  return Boolean(user?.id && event?.created_by && event.created_by === user.id);
}

/**
 * Returns the ordered contextual options for an event card in the selector list.
 * Creators can inspect details, rename, or delete; guests can inspect details or see the disabled leave option.
 * @param {{ isCreator: boolean }} params
 */
export function getEventCardMenuItems({ isCreator }) {
  if (isCreator) {
    return [
      { id: 'details', label: 'detalhes', disabled: false, unavailable: false, tone: 'default' },
      { id: 'rename', label: 'renomear', disabled: false, unavailable: false, tone: 'default' },
      { id: 'delete', label: 'excluir evento', disabled: false, unavailable: false, tone: 'danger' },
    ];
  }
  return [
    { id: 'details', label: 'detalhes', disabled: false, unavailable: false, tone: 'default' },
    { id: 'leave', label: 'sair do evento', disabled: false, unavailable: false, tone: 'danger' },
  ];
}

/**
 * Computes viewport-safe fixed coordinates for a menu anchored below (or above) its right-edge trigger.
 */
export function computeAnchoredMenuPosition({
  triggerRect,
  menuRect,
  viewportWidth,
  viewportHeight,
  gap = 6,
  margin = 8,
}) {
  const menuWidth = menuRect?.width || 188;
  const menuHeight = menuRect?.height || 132;

  const preferredLeft = triggerRect.right - menuWidth;
  const maxLeft = Math.max(margin, viewportWidth - menuWidth - margin);
  const left = Math.round(Math.min(Math.max(preferredLeft, margin), maxLeft));

  const spaceBelow = viewportHeight - triggerRect.bottom - gap - margin;
  const spaceAbove = triggerRect.top - gap - margin;
  const openAbove = spaceBelow < menuHeight && spaceAbove > spaceBelow;

  const rawTop = openAbove ? triggerRect.top - menuHeight - gap : triggerRect.bottom + gap;
  const maxTop = Math.max(margin, viewportHeight - menuHeight - margin);
  const top = Math.round(Math.min(Math.max(rawTop, margin), maxTop));

  return {
    left,
    top,
    placement: openAbove ? 'top' : 'bottom',
  };
}

/**
 * Computes relative translation/scale transforms from a centered modal box back to an origin card rect.
 */
export function computeMorphDelta({ originRect, targetRect }) {
  if (!originRect || !targetRect || !targetRect.width || !targetRect.height) {
    return { dx: 0, dy: 10, sx: 0.96, sy: 0.96 };
  }
  const dx = Math.round((originRect.left + originRect.width / 2) - (targetRect.left + targetRect.width / 2));
  const dy = Math.round((originRect.top + originRect.height / 2) - (targetRect.top + targetRect.height / 2));
  const rawSx = originRect.width / targetRect.width;
  const rawSy = originRect.height / targetRect.height;
  return {
    dx,
    dy,
    sx: Number(Math.min(Math.max(rawSx, 0.35), 1.25).toFixed(3)),
    sy: Number(Math.min(Math.max(rawSy, 0.2), 1.25).toFixed(3)),
  };
}
