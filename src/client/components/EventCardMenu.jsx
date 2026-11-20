import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Info, LogOut, MoreVertical, Pencil, Trash2 } from 'lucide-react';
import {
  computeAnchoredMenuPosition,
  getEventCardMenuItems,
} from '../../domain/eventMenu.js';
import { closeAnimatedPopover } from '../lib/dialogTopLayer.js';
import { useBackLayer } from '../lib/useHistoryNavigation.js';
import './EventCardMenu.css';

const ITEM_ICONS = {
  details: Info,
  rename: Pencil,
  delete: Trash2,
  leave: LogOut,
};

function supportsNativePopover() {
  return typeof HTMLElement !== 'undefined' && Object.hasOwn(HTMLElement.prototype, 'popover');
}

function supportsAnchorPositioning() {
  return typeof window !== 'undefined' && Boolean(window.CSS?.supports?.('position-area', 'block-end'));
}

function getEnabledMenuButtons(groupEl) {
  if (!groupEl) return [];
  return [...groupEl.querySelectorAll('button')].filter(
    (item) => !item.disabled && item.getAttribute('aria-disabled') !== 'true',
  );
}

function showPopoverAnchored(menuEl, triggerEl) {
  try {
    menuEl.showPopover({ source: triggerEl });
  } catch {
    menuEl.showPopover();
  }
}

export function EventCardMenu({ event, isCreator, onAction, onOpenChange }) {
  const uid = useId();
  const triggerId = `event-menu-trigger-${uid}`;
  const menuId = `event-menu-popover-${uid}`;
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const groupRef = useRef(null);
  const pointerOpenRef = useRef(false);
  const enterOnOpenRef = useRef(false);
  const [isOpen, setIsOpen] = useState(false);

  const items = useMemo(() => getEventCardMenuItems({ isCreator }), [isCreator]);
  const nativePopover = useMemo(() => supportsNativePopover(), []);

  useEffect(() => {
    onOpenChange?.(isOpen);
  }, [isOpen, onOpenChange]);

  const syncPosition = useCallback(() => {
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    if (nativePopover && supportsAnchorPositioning()) return;

    const triggerRect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    if (!menuRect.width && !menuRect.height) return;

    const pos = computeAnchoredMenuPosition({
      triggerRect,
      menuRect,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });
    menu.style.setProperty('--menu-left', `${pos.left}px`);
    menu.style.setProperty('--menu-top', `${pos.top}px`);
    menu.dataset.placement = pos.placement;
  }, [nativePopover]);

  const closeMenu = useCallback(async ({ restoreFocus = false, fromPointer = false } = {}) => {
    const menu = menuRef.current;
    const trigger = triggerRef.current;
    setIsOpen(false);
    if (!menu) return;
    if (restoreFocus && trigger) {
      trigger.focus({ focusVisible: !fromPointer, preventScroll: true });
    }
    if (nativePopover) {
      await closeAnimatedPopover(menu);
    }
  }, [nativePopover]);

  useBackLayer(
    `event-card-menu-${event?.id ?? uid}`,
    isOpen,
    () => {
      void closeMenu({ restoreFocus: false });
    },
    { priority: 20 }
  );

  // Attach standard HTML attributes without React 18 unknown-prop warnings, and install focusgroup fallback when absent.
  useEffect(() => {
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    const group = groupRef.current;
    if (!trigger || !menu || !group) return undefined;

    if (nativePopover) {
      menu.setAttribute('popover', 'auto');
      trigger.setAttribute('commandfor', menuId);
      trigger.setAttribute('command', 'toggle-popover');
    }

    group.setAttribute('focusgroup', 'menu nomemory');

    if ('focusGroup' in HTMLElement.prototype) return undefined;

    group.setAttribute('role', 'menu');
    group.querySelectorAll('button:not([role])').forEach((btn) => {
      btn.setAttribute('role', 'menuitem');
    });

    const handleFallbackArrows = (e) => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
      const enabled = getEnabledMenuButtons(group);
      if (!enabled.length) return;
      const current = enabled.indexOf(document.activeElement);
      const next = e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? enabled.length - 1
          : current < 0
            ? (e.key === 'ArrowUp' ? enabled.length - 1 : 0)
            : (current + (e.key === 'ArrowUp' ? -1 : 1) + enabled.length) % enabled.length;
      e.preventDefault();
      e.stopImmediatePropagation();
      enabled[next].focus({ preventScroll: true });
    };

    group.addEventListener('keydown', handleFallbackArrows, true);
    return () => group.removeEventListener('keydown', handleFallbackArrows, true);
  }, [items, menuId, nativePopover]);

  // Native popover toggle lifecycle (positioning, focus entry on keyboard open, outside focus dismissal).
  useEffect(() => {
    const menu = menuRef.current;
    const trigger = triggerRef.current;
    const group = groupRef.current;
    if (!menu || !trigger || !group || !nativePopover) return undefined;

    const handleToggle = (e) => {
      const opening = e.newState === 'open';
      setIsOpen(opening);
      if (opening) {
        menu.removeAttribute('data-closing');
        syncPosition();
        requestAnimationFrame(syncPosition);
        if (enterOnOpenRef.current) {
          enterOnOpenRef.current = false;
          const first = getEnabledMenuButtons(group)[0];
          first?.focus({ preventScroll: true });
        }
      } else {
        enterOnOpenRef.current = false;
        pointerOpenRef.current = false;
      }
    };

    menu.addEventListener('toggle', handleToggle);
    return () => menu.removeEventListener('toggle', handleToggle);
  }, [nativePopover, syncPosition]);

  // Reposition fallback menu during scroll/resize and dismiss if focus leaves menu system.
  useEffect(() => {
    if (!isOpen) return undefined;
    if (!nativePopover) syncPosition();

    const handleViewportUpdate = () => syncPosition();
    const handleDocumentFocusIn = (e) => {
      const menu = menuRef.current;
      const trigger = triggerRef.current;
      if (!menu || !trigger) return;
      if (menu.contains(e.target) || trigger.contains(e.target)) return;
      closeMenu({ restoreFocus: false });
    };

    const handleOutsideFallback = (e) => {
      if (nativePopover) return;
      const menu = menuRef.current;
      const trigger = triggerRef.current;
      if (menu?.contains(e.target) || trigger?.contains(e.target)) return;
      setIsOpen(false);
    };

    const handleFallbackEscape = (e) => {
      if (nativePopover || e.key !== 'Escape') return;
      e.preventDefault();
      closeMenu({ restoreFocus: true, fromPointer: false });
    };

    window.addEventListener('resize', handleViewportUpdate);
    window.addEventListener('scroll', handleViewportUpdate, true);
    document.addEventListener('focusin', handleDocumentFocusIn);
    if (!nativePopover) {
      document.addEventListener('pointerdown', handleOutsideFallback);
      document.addEventListener('keydown', handleFallbackEscape);
    }

    return () => {
      window.removeEventListener('resize', handleViewportUpdate);
      window.removeEventListener('scroll', handleViewportUpdate, true);
      document.removeEventListener('focusin', handleDocumentFocusIn);
      if (!nativePopover) {
        document.removeEventListener('pointerdown', handleOutsideFallback);
        document.removeEventListener('keydown', handleFallbackEscape);
      }
    };
  }, [isOpen, nativePopover, syncPosition, closeMenu]);

  const handleTriggerPointerDown = (e) => {
    e.stopPropagation();
    pointerOpenRef.current = true;
    enterOnOpenRef.current = false;
    if (e.pointerType === 'mouse') {
      e.preventDefault();
    }
  };

  const handleTriggerKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      const menu = menuRef.current;
      const group = groupRef.current;
      if (!menu || !group) return;
      const currentlyOpen = nativePopover ? menu.matches(':popover-open') : isOpen;
      if (!currentlyOpen) {
        enterOnOpenRef.current = true;
        pointerOpenRef.current = false;
        triggerRef.current?.click();
      } else {
        getEnabledMenuButtons(group)[0]?.focus({ preventScroll: true });
      }
    }
  };

  const handleTriggerClick = (e) => {
    e.stopPropagation();
    const isKeyboardActivation = e.detail === 0;
    if (isKeyboardActivation) {
      enterOnOpenRef.current = true;
      pointerOpenRef.current = false;
    }

    if (nativePopover && 'commandForElement' in HTMLButtonElement.prototype) {
      return;
    }

    e.preventDefault();
    const menu = menuRef.current;
    const trigger = triggerRef.current;
    if (!menu || !trigger) return;

    if (nativePopover) {
      if (menu.matches(':popover-open')) {
        closeMenu({ restoreFocus: isKeyboardActivation, fromPointer: !isKeyboardActivation });
      } else {
        showPopoverAnchored(menu, trigger);
      }
      return;
    }

    setIsOpen((prev) => {
      const next = !prev;
      if (next && isKeyboardActivation) {
        requestAnimationFrame(() => getEnabledMenuButtons(groupRef.current)[0]?.focus({ preventScroll: true }));
      }
      return next;
    });
  };

  const handleMenuKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeMenu({ restoreFocus: true, fromPointer: false });
      return;
    }
    if (e.key === 'Tab') {
      closeMenu({ restoreFocus: false });
    }
  };

  const handleItemPointerMove = (e) => {
    const item = e.currentTarget;
    if (item.disabled || item.getAttribute('aria-disabled') === 'true') return;
    if (document.activeElement !== item) {
      item.focus({ focusVisible: false, preventScroll: true });
    }
  };

  const handleItemClick = async (e, item) => {
    e.stopPropagation();
    if (item.disabled || item.unavailable) {
      e.preventDefault();
      return;
    }
    await closeMenu({ restoreFocus: false });
    onAction(item.id, event);
  };

  return (
    <div className="events-home__event-menu-wrap" onClick={(e) => e.stopPropagation()}>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        className="events-home__event-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={`opções de ${event.title}`}
        onPointerDown={handleTriggerPointerDown}
        onKeyDown={handleTriggerKeyDown}
        onClick={handleTriggerClick}
      >
        <MoreVertical size={20} aria-hidden="true" />
      </button>

      <div
        ref={menuRef}
        id={menuId}
        className={`event-card-menu${!nativePopover && isOpen ? ' event-card-menu--fallback-open' : ''}`}
        hidden={!nativePopover && !isOpen}
        onKeyDown={handleMenuKeyDown}
      >
        <div ref={groupRef} className="event-card-menu__group" aria-labelledby={triggerId}>
          {items.map((item, idx) => {
            const Icon = ITEM_ICONS[item.id] || Info;
            return (
              <React.Fragment key={item.id}>
                {item.tone === 'danger' && <hr className="event-card-menu__divider" />}
                <button
                  type="button"
                  className={`event-card-menu__item event-card-menu__item--${item.tone}`}
                  style={{ '--item-index': idx }}
                  disabled={item.disabled}
                  aria-disabled={item.disabled ? 'true' : undefined}
                  onPointerMove={handleItemPointerMove}
                  onClick={(e) => handleItemClick(e, item)}
                >
                  <span className="event-card-menu__icon" aria-hidden="true">
                    <Icon size={16} />
                  </span>
                  <span className="event-card-menu__label">{item.label}</span>
                  {item.unavailable && (
                    <span className="event-card-menu__tag">indisponível</span>
                  )}
                </button>
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}
